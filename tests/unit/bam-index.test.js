// Indexed BAM reading (bam-parser.js: parseBAI, baiChunks, readBamRegion) against samtools: the .bai files were
// made by 'samtools index' and the counts by 'samtools view -c' (tests/fixtures/reads/chrom/samtools_counts.json).
// readBamRegion drops unmapped/secondary/QC-failed/duplicate/supplementary reads, which these files do not have.
// Run: node tests/unit/bam-index.test.js
const fs = require('fs'), path = require('path');
const BP = require('../../bam-parser.js');
const ROOT = path.join(__dirname, '..', '..');
const counts = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/reads/chrom/samtools_counts.json'), 'utf8'));
let fails = 0;
const check = (name, ok, detail) => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : ' - ' + detail}`); if (!ok) fails++; };
const asFile = p => new Blob([fs.readFileSync(p)]);
const region = s => { const m = /^([^:]+)(?::(\d+)-(\d+))?$/.exec(s); return { ref: m[1], beg: m[2] ? +m[2] - 1 : 0, end: m[3] ? +m[3] : null }; };
(async () => {
  for (const [bam, bai] of [['tests/fixtures/reads/chrom/chrom_reads.bam', 'tests/fixtures/reads/chrom/chrom_reads.bam.bai'], ['examples/real/htslib_range.bam', 'examples/real/htslib_range.bam.bai']]) {
    const file = asFile(path.join(ROOT, bam));
    const header = await BP.readBamHeaderFromFile(file);
    const index = BP.parseBAI(new Uint8Array(fs.readFileSync(path.join(ROOT, bai))));
    check(`${path.basename(bam)}: header and index agree on the number of references`, index.refs.length === header.refNames.length, `${index.refs.length} vs ${header.refNames.length}`);
    for (const [reg, want] of Object.entries(counts[path.basename(bam)] || {})) {
      if (reg === 'total') continue;
      const r = region(reg), refId = header.refNames.indexOf(r.ref);
      const end = r.end != null ? r.end : header.refLengths[refId];
      const got = await BP.readBamRegion(file, index, refId, r.beg, end);
      check(`${path.basename(bam)} ${reg}: ${want} reads, as samtools view -c`, got.totalReads === want && got.records.length === want, `got ${got.totalReads} (${got.records.length} kept), ${got.chunks} chunks, ${got.bytesRead} bytes`);
    }
  }
  // reading a small region reads far less than the whole file
  const big = asFile(path.join(ROOT, 'tests/fixtures/reads/chrom/chrom_reads.bam'));
  const h = await BP.readBamHeaderFromFile(big), ix = BP.parseBAI(new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/reads/chrom/chrom_reads.bam.bai'))));
  const small = await BP.readBamRegion(big, ix, h.refNames.indexOf('chrT'), 199000 - 1, 200000);
  const whole = await BP.readBamRegion(big, ix, h.refNames.indexOf('chrT'), 0, 200000);
  check('a 1 kb region reads a small part of what the whole reference needs', small.bytesRead * 5 < whole.bytesRead, `${small.bytesRead} vs ${whole.bytesRead}`);
  await tileChecks();
  // reg2bins: the spec's example values
  check('reg2bins(0, 1) is bins 0, 1, 9, 73, 585, 4681', BP.reg2bins(0, 1).join() === '0,1,9,73,585,4681', BP.reg2bins(0, 1).join());
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();

// ---- Regions read as windows: every read overlapping a region, exactly, against a scan of the whole file ----------
// What used to go wrong: baiChunks ended a region at the linear-index entry of the next 16 kb window, taken to be the
// first read past the region. That entry is the first read OVERLAPPING that window, which can start inside the region,
// so it and every read after it were cut: 13 of 2,586 read-in-tile hits on chrom_reads.bam, and with long reads far more.
// htslib's rule (a bin to the right of the region) alone is not enough: samtools merges small bins into a parent, whose
// one chunk can span the reference. So the reader also stops at the first record past the region; the merged-index
// checks below fail on a reader that takes such a chunk whole.
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
function bamRecord(r, rnd) {
  const name = Buffer.from(r.name + '\0'), lSeq = r.cigar.reduce((n, [l, o]) => n + ('MIS=X'.includes(o) ? l : 0), 0);
  const span = r.cigar.reduce((n, [l, o]) => n + ('MDN=X'.includes(o) ? l : 0), 0);
  const sb = (lSeq + 1) >> 1, size = 32 + name.length + 4 * r.cigar.length + sb + lSeq, b = Buffer.alloc(4 + size);
  b.writeInt32LE(size, 0); b.writeInt32LE(r.ref, 4); b.writeInt32LE(r.pos, 8); b[12] = name.length; b[13] = 60;
  b.writeUInt16LE(reg2bin(r.pos, r.pos + span), 14); b.writeUInt16LE(r.cigar.length, 16); b.writeUInt16LE(0, 18);
  b.writeInt32LE(lSeq, 20); b.writeInt32LE(-1, 24); b.writeInt32LE(-1, 28); b.writeInt32LE(0, 32);
  let o = 36; name.copy(b, o); o += name.length;
  for (const [l, op] of r.cigar) { b.writeUInt32LE(l * 16 + 'MIDNSHP=X'.indexOf(op), o); o += 4; }
  for (let i = 0; i < sb; i++) b[o++] = [1, 2, 4, 8][(rnd() * 4) | 0] * 16 + [1, 2, 4, 8][(rnd() * 4) | 0];
  b.fill(0xff, o);
  return { bytes: b, span };
}
// A sorted BAM of reads with its index, built by the rules of htslib's hts_idx_push: each record in the bin of its whole span,
// and the linear index set for EVERY 16 kb window the record overlaps. merged: all of a reference's chunks in bin 0.
function buildBam(refs, reads, merged) {
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
    const { bytes, span } = bamRecord(r, rnd);
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
  for (const p of [16300, 16383, 32767, 49100]) reads.push({ ref: 0, pos: p, name: 'edge' + p, cigar: [[150, 'M']] });   // across a window edge
  for (let i = 0; i < 300; i++) reads.push({ ref: 1, pos: (rnd() * 199000) | 0, name: 'b' + i, cigar: [[150, 'M']] });
  return reads.sort((a, b) => a.ref - b.ref || a.pos - b.pos);
}
const spanOf = c => c.reduce((n, x) => n + ('MDN=X'.includes(x.op) ? x.len : 0), 0);
async function exactOnRegions(label, file, index, all, refId, regions) {
  let wanted = 0, lost = 0, extra = 0, worst = '';
  const here = all.filter(r => r.refID === refId);
  for (const [beg, end] of regions) {
    const want = new Set(here.filter(r => r.pos < end && r.pos + Math.max(1, spanOf(r.cigar)) > beg).map(r => r.name + '/' + r.pos));
    const got = await BP.readBamRegion(file, index, refId, beg, end, true);
    const seen = new Set(got.records.map(r => r.name + '/' + r.pos));
    wanted += want.size;
    const l = [...want].filter(k => !seen.has(k)).length, x = got.records.length - seen.size + [...seen].filter(k => !want.has(k)).length;
    lost += l; extra += x;
    if ((l || x) && !worst) worst = beg + '-' + end + ': ' + l + ' lost, ' + x + ' extra';
  }
  check(label + ': ' + regions.length + ' regions, ' + wanted + ' reads, none lost or extra', !lost && !extra, lost + ' lost, ' + extra + ' extra of ' + wanted + ' (first: ' + worst + ')');
}
const grid = (L, step) => { const g = []; for (let b = 0; b < L; b += step) g.push([b, Math.min(L, b + step)]); return g; };
async function tileChecks() {
  // real samtools index
  const raw = fs.readFileSync(path.join(ROOT, 'tests/fixtures/reads/chrom/chrom_reads.bam')), file = new Blob([raw]);
  const buf = await BP.decompressBAM(file), h = BP.parseBAMHeader(buf), all = BP.parseBAMRecords(buf, h.headerEndOffset, true).records;
  const index = BP.parseBAI(new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/reads/chrom/chrom_reads.bam.bai'))));
  for (const step of [16384, 10000, 7777]) for (let id = 0; id < h.refNames.length; id++) await exactOnRegions('chrom_reads.bam ' + h.refNames[id] + ' tiles of ' + step, file, index, all, id, grid(h.refLengths[id], step));
  // long and spliced reads, with a binned index and with every chunk merged into bin 0
  const refs = [['chrA', 3000000], ['chrB', 200000]], reads = syntheticReads(), rnd = mulberry(3);
  const random = Array.from({ length: 150 }, () => { const b = (rnd() * 2900000) | 0; return [b, b + 1 + ((rnd() * 60000) | 0)]; });
  for (const merged of [false, true]) {
    const name = merged ? 'merged index' : 'binned index', { bam, bai } = buildBam(refs, reads, merged), f = new Blob([bam]), ix = BP.parseBAI(new Uint8Array(bai));
    const b2 = await BP.decompressBAM(f), h2 = BP.parseBAMHeader(b2), recs = BP.parseBAMRecords(b2, h2.headerEndOffset, true).records;
    check(name + ': the built BAM holds every read', recs.length === reads.length, recs.length + ' of ' + reads.length);
    await exactOnRegions(name + ' tiles of 16384', f, ix, recs, 0, grid(refs[0][1], 16384));
    await exactOnRegions(name + ' random regions', f, ix, recs, 0, random);
    await exactOnRegions(name + ' second reference', f, ix, recs, 1, grid(refs[1][1], 16384));
    // the bound: a 16 kb region of a 3 Mb reference may not cost the reference, however its chunks are stored
    const got = await BP.readBamRegion(f, ix, 0, 1500000, 1516384, true);
    check(name + ': a 16 kb region reads under 10% of the file (' + got.fileBytesRead + ' of ' + bam.length + ' bytes)', got.fileBytesRead * 10 < bam.length, got.fileBytesRead + ' of ' + bam.length);
    if (merged) check('merged index: the chunk list itself still spans the reference (the reader is what stops)', BP.baiChunks(ix, 0, 1500000, 1516384).length === 1, 'chunks changed');
  }
}
