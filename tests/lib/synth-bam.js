// A small sorted BAM and its .bai, built in memory by the rules of htslib, for tests of indexed reading.
const zlib = require('zlib');
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function bgzfBlock(data) {
  const body = zlib.deflateRawSync(data), head = Buffer.from([31, 139, 8, 4, 0, 0, 0, 0, 0, 255, 6, 0, 66, 67, 2, 0, 0, 0]), tail = Buffer.alloc(8);
  head.writeUInt16LE(body.length + 25, 16);
  tail.writeUInt32LE(crc32(data), 0); tail.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, body, tail]);
}
function reg2bin(beg, end) {   // SAMv1 5.3
  end--;
  for (const [sh, first] of [[14, 4681], [17, 585], [20, 73], [23, 9], [26, 1]]) if (beg >> sh === end >> sh) return first + (beg >> sh);
  return 0;
}
function mulberry(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function bamRecord(r, rnd, noisyQual) {
  const name = Buffer.from(r.name + '\0'), lSeq = r.cigar.reduce((n, [l, o]) => n + ('MIS=X'.includes(o) ? l : 0), 0);
  const span = r.cigar.reduce((n, [l, o]) => n + ('MDN=X'.includes(o) ? l : 0), 0);
  const sb = (lSeq + 1) >> 1, size = 32 + name.length + 4 * r.cigar.length + sb + lSeq, b = Buffer.alloc(4 + size);
  b.writeInt32LE(size, 0); b.writeInt32LE(r.ref, 4); b.writeInt32LE(r.pos, 8); b[12] = name.length; b[13] = 60;
  b.writeUInt16LE(reg2bin(r.pos, r.pos + span), 14); b.writeUInt16LE(r.cigar.length, 16); b.writeUInt16LE(0, 18);
  b.writeInt32LE(lSeq, 20); b.writeInt32LE(-1, 24); b.writeInt32LE(-1, 28); b.writeInt32LE(0, 32);
  let o = 36; name.copy(b, o); o += name.length;
  for (const [l, op] of r.cigar) { b.writeUInt32LE(l * 16 + 'MIDNSHP=X'.indexOf(op), o); o += 4; }
  for (let i = 0; i < sb; i++) b[o++] = [1, 2, 4, 8][(rnd() * 4) | 0] * 16 + [1, 2, 4, 8][(rnd() * 4) | 0];
  if (noisyQual) for (; o < b.length; o++) b[o] = 20 + ((rnd() * 8) | 0) * 3; else b.fill(0xff, o);   // noisy: compresses about as a real BAM does
  return { bytes: b, span };
}
// A sorted BAM of reads with its index, built by the rules of htslib's hts_idx_push: each record in the bin of its whole span,
// and the linear index set for EVERY 16 kb window the record overlaps. merged: all of a reference's chunks in bin 0.
function buildBam(refs, reads, merged, opts) {
  const rnd = mulberry(7), text = Buffer.from('@HD\tVN:1.6\tSO:coordinate\n' + refs.map(([n, l]) => '@SQ\tSN:' + n + '\tLN:' + l + '\n').join(''));
  const parts = [Buffer.from('BAM\x01'), Buffer.alloc(4), text, Buffer.alloc(4)];
  parts[1].writeInt32LE(text.length, 0); parts[3].writeInt32LE(refs.length, 0);
  for (const [n, l] of refs) { const nb = Buffer.from(n + '\0'), h = Buffer.alloc(4), t = Buffer.alloc(4); h.writeInt32LE(nb.length, 0); t.writeInt32LE(l, 0); parts.push(h, nb, t); }
  const out = [];
  let comp = 0, pending = [], pendingLen = 0;
  const flush = () => { if (!pendingLen) return; const blk = bgzfBlock(Buffer.concat(pending)); out.push(blk); comp += blk.length; pending = []; pendingLen = 0; };
  const push = b => { pending.push(b); pendingLen += b.length; };
  push(Buffer.concat(parts)); flush();
  const bins = refs.map(() => new Map()), lin = refs.map(() => []);
  const BLOCK = 16000;
  for (const r of reads) {
    const { bytes, span } = bamRecord(r, rnd, opts && opts.noisyQual);
    const beg = { c: comp, u: pendingLen };
    // a record may run across a block edge, as in a real BAM
    let o = 0;
    while (o < bytes.length) { const take = Math.min(bytes.length - o, BLOCK - pendingLen); push(bytes.subarray(o, o + take)); o += take; if (pendingLen >= BLOCK) flush(); }
    const end = { c: comp, u: pendingLen };
    const bin = merged ? 0 : reg2bin(r.pos, r.pos + span), m = bins[r.ref];
    const list = m.get(bin) || m.set(bin, []).get(bin), last = list[list.length - 1];
    if (last && last.end.c === beg.c && last.end.u === beg.u) last.end = end; else list.push({ beg, end });
    for (let w = r.pos >> 14; w <= (r.pos + span - 1) >> 14; w++) if (!lin[r.ref][w]) lin[r.ref][w] = beg;
  }
  flush();
  out.push(bgzfBlock(Buffer.alloc(0)));
  const bam = Buffer.concat(out);
  const vo = v => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v.c) * 65536n + BigInt(v.u)); return b; }, i32 = n => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
  const bai = [Buffer.from('BAI\x01'), i32(refs.length)];
  refs.forEach((_, i) => {
    bai.push(i32(bins[i].size));
    for (const [bin, list] of bins[i]) { const h = Buffer.alloc(8); h.writeUInt32LE(bin, 0); h.writeInt32LE(list.length, 4); bai.push(h); for (const c of list) bai.push(vo(c.beg), vo(c.end)); }
    const l = lin[i]; for (let w = l.length - 2; w >= 0; w--) if (!l[w]) l[w] = l[w + 1];   // empty windows take the next entry (htslib)
    bai.push(i32(l.length)); for (const v of l) bai.push(vo(v));
  });
  return { bam, bai: Buffer.concat(bai) };
}
function syntheticReads() {
  const rnd = mulberry(11), L = 3000000, reads = [];
  for (let i = 0; i < 22000; i++) reads.push({ ref: 0, pos: (rnd() * (L - 200)) | 0, name: 's' + i, cigar: [[150, 'M']] });
  for (let i = 0; i < 40; i++) reads.push({ ref: 0, pos: (rnd() * (L - 80000)) | 0, name: 'long' + i, cigar: [[20000 + ((rnd() * 50000) | 0), 'M']] });   // a few 16 kb windows each
  for (let i = 0; i < 20; i++) reads.push({ ref: 0, pos: (rnd() * (L - 300000)) | 0, name: 'spliced' + i, cigar: [[80, 'M'], [200000, 'N'], [70, 'M']] });
  for (const p of [16300, 16383, 16384, 32767, 32768, 49100]) reads.push({ ref: 0, pos: p, name: 'edge' + p, cigar: [[150, 'M']] });   // across a window edge
  for (let i = 0; i < 300; i++) reads.push({ ref: 1, pos: (rnd() * 199000) | 0, name: 'b' + i, cigar: [[150, 'M']] });
  return reads.sort((a, b) => a.ref - b.ref || a.pos - b.pos);
}
module.exports = { buildBam, syntheticReads, mulberry, bgzfBlock, reg2bin };
