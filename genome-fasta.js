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

    // 0-based half-open [start, end), clamped to the sequence; case kept, line ends removed.
    async function readBases(file, entry, start, end) {
        const { length, offset, lineBases, lineBytes } = entry;
        start = Math.max(0, Math.floor(start)); end = Math.min(length, Math.floor(end));
        if (!(start < end)) return '';
        const pos = i => offset + Math.floor(i / lineBases) * lineBytes + (i % lineBases);
        const text = latin1(await bytesOf(file, pos(start), pos(end - 1) + 1));
        return text.replace(/[\r\n]/g, '');
    }

    // Cheap check that the .fai belongs to this FASTA: the line before the first sequence line must be '>' + name.
    async function checkFai(file, entries) {
        if (!entries || !entries.length) return;
        const e = entries[0], fname = file && file.name ? file.name : 'the FASTA';
        const bad = why => new Error(`The .fai does not belong to ${fname}: ${why}`);
        const from = Math.max(0, e.offset - (e.name.length + 65536));
        const text = latin1(await bytesOf(file, from, e.offset));
        const body = text.replace(/[\r\n]+$/, '');
        if (body.length === text.length) throw bad(`the byte before the first sequence line is not a line end (first record "${e.name}")`);
        const nl = body.lastIndexOf('\n');
        if (nl < 0 && from > 0) return;   // header longer than the window: cannot judge, accept
        const header = body.slice(nl + 1).replace(/\r$/, '');
        const n = e.name.length + 1;
        if (header.slice(0, n) !== '>' + e.name || (header.length > n && !/\s/.test(header[n])))
            throw bad(`expected a header line starting ">${e.name}" before offset ${e.offset}, found "${header.slice(0, 40)}"`);
    }

    return { parseFai, readBases, checkFai };
});
