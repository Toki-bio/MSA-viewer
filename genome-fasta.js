/**
 * genome-fasta.js - read reference bases from a FASTA through its .fai index, one file.slice per request.
 * Works as a browser global (GenomeFasta) and in Node (require). Offsets are plain numbers (no bit operations),
 * so files over 4 GB work.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.GenomeFasta = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function parseFai(text) {
        const out = [], lines = String(text).split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].replace(/\r$/, '');
            if (line === '') continue;
            const c = line.split('\t');
            if (c.length !== 5) throw new Error(`.fai line ${i + 1} is malformed: expected 5 tab-separated columns, found ${c.length}`);
            const nums = c.slice(1).map(s => /^\d+$/.test(s) ? Number(s) : NaN);
            if (nums.some(n => !Number.isFinite(n))) throw new Error(`.fai line ${i + 1} is malformed: length, offset, line bases and line bytes must be numbers`);
            const [length, offset, lineBases, lineBytes] = nums;
            if (lineBases < 1) throw new Error(`.fai line ${i + 1} is malformed: line bases must be at least 1`);
            if (lineBytes < lineBases) throw new Error(`.fai line ${i + 1} is malformed: line bytes (${lineBytes}) is less than line bases (${lineBases})`);
            out.push({ name: c[0], length, offset, lineBases, lineBytes });
        }
        return out;
    }

    async function bytesOf(file, a, b) {
        return new Uint8Array(await file.slice(a, b).arrayBuffer());
    }
    function latin1(u8) {
        let s = '';
        for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
        return s;
    }

    const noFit = (file, why) => {
        const e = new Error(`The .fai does not fit the FASTA (it does not belong to ${file && file.name ? file.name : 'the FASTA'}): ${why}. Make it again with samtools faidx.`);
        e.faiMismatch = true;
        return e;
    };

    // 0-based half-open [start, end), clamped to the sequence; case kept, line ends removed. Every line end of the slice must be where the
    // .fai says, at no extra read: bases shifted by a line of another length are never handed out. A file that ends early gives fewer
    // bases, none of them wrong: a .fai longer than its FASTA is allowed (the 250 Mb scroll checks), and no bases are drawn there.
    async function readBases(file, entry, start, end) {
        const { length, offset, lineBases, lineBytes } = entry;
        start = Math.max(0, Math.floor(start)); end = Math.min(length, Math.floor(end));
        if (!(start < end)) return '';
        const pos = i => offset + Math.floor(i / lineBases) * lineBytes + (i % lineBases);
        const text = latin1(await bytesOf(file, pos(start), pos(end - 1) + 1)), bases = text.replace(/[\r\n]/g, '');
        const whole = text.length === pos(end - 1) + 1 - pos(start);
        let fits = (!whole || bases.length === end - start) && !bases.includes('>');
        for (let p = lineBases - (start % lineBases); fits && p < text.length; p += lineBytes) { const c = text.charCodeAt(p); fits = c === 10 || c === 13; }
        if (!fits) throw noFit(file, `${entry.name}:${start + 1}-${end} is not where the .fai says`);
        return bases;
    }

    const isEnd = b => b === 10 || b === 13;

    // Cheap check that the .fai fits this FASTA at one chromosome: the line before its sequence is '>' + name, the first line ends after
    // lineBases bases, and the sequence ends after `length` bases. Three small slices, whatever the size of the chromosome. Where the file
    // has already ended there is nothing to judge: no wrong base can come from there.
    async function checkEntry(file, e) {
        const bad = why => noFit(file, `${e.name}: ${why}`);
        const from = Math.max(0, e.offset - (e.name.length + 65536));
        const text = latin1(await bytesOf(file, from, e.offset));
        const body = text.replace(/[\r\n]+$/, '');
        if (body.length === text.length) throw bad('the byte before the sequence is not a line end');
        const nl = body.lastIndexOf('\n');
        if (nl >= 0 || from === 0) {   // else the header is longer than the window: cannot judge, accept
            const header = body.slice(nl + 1).replace(/\r$/, '');
            // the header here is bytes, the name decoded text: compare bytes, or a name with an accent was refused (GLM audit #20)
            const want = latin1(new TextEncoder().encode('>' + e.name)), n = want.length;
            if (header.slice(0, n) !== want || (header.length > n && !/\s/.test(header[n])))
                throw bad(`expected a header line starting ">${e.name}" before offset ${e.offset}, found "${header.slice(0, 40)}"`);
        }
        if (!e.length) return;
        // the first line: its last base, the line end, the first base of the next line. Not read whole: one line can be a chromosome
        if (e.length > e.lineBases) {
            const n = e.lineBytes - e.lineBases, at = e.offset + e.lineBases, b = await bytesOf(file, at - 1, at + n + 1);
            const end = n === 1 ? b[1] === 10 : n === 2 && b[1] === 13 && b[2] === 10;
            if (b.length > 1 && (isEnd(b[0]) || !end || isEnd(b[n + 1]) || b[n + 1] === 62)) throw bad(`the first line does not end after ${e.lineBases} bases`);
        }
        // the last base, then a line end or the end of the file, then the next header, a blank line or the end of the file
        const last = e.offset + Math.floor((e.length - 1) / e.lineBases) * e.lineBytes + ((e.length - 1) % e.lineBases);
        const b = await bytesOf(file, last, last + 4);
        if (!b.length) return;
        if (isEnd(b[0]) || b[0] === 62) throw bad(`the sequence does not reach ${e.length} bases`);
        let i = 1;
        if (b[i] === 13) i++;
        if (i < b.length && b[i] !== 10) throw bad(`the sequence does not end after ${e.length} bases`);
        i++;
        if (i < b.length && b[i] !== 62 && !isEnd(b[i])) throw bad(`the sequence does not end after ${e.length} bases`);
    }

    // Before anything is shown: the first record. A later chromosome is checked when it is opened (checkEntry).
    async function checkFai(file, entries) {
        if (entries && entries.length) await checkEntry(file, entries[0]);
    }

    return { parseFai, readBases, checkEntry, checkFai };
});
