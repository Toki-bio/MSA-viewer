// Minimal SAM -> BAM writer for test fixtures (no samtools needed): BGZF blocks of at most 64 KB with the BC
// extra field, the BAM header (@SQ from the text or from the reads), records with 4-bit sequences and Phred
// qualities, and the BGZF end-of-file block. Tags are not written.
//   node tests/fixtures/reads/sam2bam.js in.sam out.bam      or   require('./sam2bam.js').samToBam(text) -> Buffer
const fs = require('fs'), zlib = require('zlib');

const CIGAR_OPS = 'MIDNSHP=X';
const NT16 = '=ACMGRSVTWYHKDBN';

function bgzf(raw) {
    const blocks = [];
    for (let o = 0; o < raw.length || o === 0; o += 0xff00) {
        const chunk = raw.subarray(o, Math.min(raw.length, o + 0xff00));
        const cdata = zlib.deflateRawSync(chunk, { level: 6 });
        const head = Buffer.from([31, 139, 8, 4, 0, 0, 0, 0, 0, 255, 6, 0, 66, 67, 2, 0, 0, 0]);
        head.writeUInt16LE(head.length + cdata.length + 8 - 1, 16);       // BSIZE = total block size - 1
        const tail = Buffer.alloc(8);
        tail.writeUInt32LE(zlib.crc32(chunk) >>> 0, 0);
        tail.writeUInt32LE(chunk.length, 4);
        blocks.push(head, cdata, tail);
        if (!raw.length) break;
    }
    blocks.push(Buffer.from('1f8b08040000000000ff0600424302001b0003000000000000000000', 'hex'));   // EOF block
    return Buffer.concat(blocks);
}

function reg2bin(beg, end) {
    end -= 1;
    if (beg >> 14 === end >> 14) return ((1 << 15) - 1) / 7 + (beg >> 14);
    if (beg >> 17 === end >> 17) return ((1 << 12) - 1) / 7 + (beg >> 17);
    if (beg >> 20 === end >> 20) return ((1 << 9) - 1) / 7 + (beg >> 20);
    if (beg >> 23 === end >> 23) return ((1 << 6) - 1) / 7 + (beg >> 23);
    if (beg >> 26 === end >> 26) return ((1 << 3) - 1) / 7 + (beg >> 26);
    return 0;
}

function samToBam(text) {
    const lines = String(text).replace(/\r/g, '').split('\n').filter(l => l);
    const head = lines.filter(l => l[0] === '@');
    const recs = lines.filter(l => l[0] !== '@').map(l => l.split('\t'));
    const refs = [];
    for (const l of head) if (l.startsWith('@SQ')) {
        const sn = /\tSN:([^\t]+)/.exec(l), ln = /\tLN:(\d+)/.exec(l);
        if (sn) refs.push([sn[1], ln ? +ln[1] : 0]);
    }
    if (!refs.length) for (const f of recs) if (f[2] !== '*' && !refs.some(r => r[0] === f[2])) refs.push([f[2], 1 << 29]);
    const refIndex = new Map(refs.map((r, i) => [r[0], i]));
    const parts = [];
    const htext = Buffer.from(head.join('\n') + (head.length ? '\n' : ''));
    const h = Buffer.alloc(8); h.write('BAM\x01', 0, 'latin1'); h.writeInt32LE(htext.length, 4);
    parts.push(h, htext);
    const nref = Buffer.alloc(4); nref.writeInt32LE(refs.length); parts.push(nref);
    for (const [name, len] of refs) {
        const nb = Buffer.from(name + '\0');
        const b = Buffer.alloc(4 + nb.length + 4);
        b.writeInt32LE(nb.length, 0); nb.copy(b, 4); b.writeInt32LE(len, 4 + nb.length);
        parts.push(b);
    }
    for (const f of recs) {
        const name = Buffer.from(f[0] + '\0');
        const cig = f[5] === '*' ? [] : (f[5].match(/\d+[MIDNSHP=X]/g) || []).map(t => (parseInt(t) << 4) | CIGAR_OPS.indexOf(t.slice(-1)));
        const seq = f[9] === '*' ? '' : f[9].toUpperCase();
        const lseq = seq.length;
        const refID = f[2] === '*' ? -1 : refIndex.get(f[2]);
        const pos = parseInt(f[3]) - 1;
        let span = 0; for (const c of cig) if ('MDN=X'.includes(CIGAR_OPS[c & 15])) span += c >>> 4;
        const nextRef = f[6] === '*' ? -1 : f[6] === '=' ? refID : refIndex.get(f[6]);
        const size = 32 + name.length + 4 * cig.length + ((lseq + 1) >> 1) + lseq;
        const b = Buffer.alloc(4 + size);
        let o = 0;
        b.writeInt32LE(size, o); o += 4;
        b.writeInt32LE(refID, o); o += 4;
        b.writeInt32LE(pos, o); o += 4;
        b.writeUInt8(name.length, o); o += 1;
        b.writeUInt8(Math.min(255, parseInt(f[4]) || 0), o); o += 1;
        b.writeUInt16LE(reg2bin(Math.max(0, pos), Math.max(0, pos) + Math.max(1, span)), o); o += 2;
        b.writeUInt16LE(cig.length, o); o += 2;
        b.writeUInt16LE(parseInt(f[1]) || 0, o); o += 2;
        b.writeInt32LE(lseq, o); o += 4;
        b.writeInt32LE(nextRef === undefined ? -1 : nextRef, o); o += 4;
        b.writeInt32LE(f[7] === '*' ? -1 : parseInt(f[7]) - 1, o); o += 4;
        b.writeInt32LE(parseInt(f[8]) || 0, o); o += 4;
        name.copy(b, o); o += name.length;
        for (const c of cig) { b.writeUInt32LE(c >>> 0, o); o += 4; }
        for (let i = 0; i < lseq; i += 2) {
            const hi = Math.max(0, NT16.indexOf(seq[i])), lo = i + 1 < lseq ? Math.max(0, NT16.indexOf(seq[i + 1])) : 0;
            b.writeUInt8((hi << 4) | lo, o); o += 1;
        }
        const q = f[10] || '*';
        for (let i = 0; i < lseq; i++) { b.writeUInt8(q === '*' ? 0xff : q.charCodeAt(i) - 33, o); o += 1; }
        parts.push(b);
    }
    return bgzf(Buffer.concat(parts));
}

module.exports = { samToBam };
if (require.main === module) fs.writeFileSync(process.argv[3], samToBam(fs.readFileSync(process.argv[2], 'utf8')));
