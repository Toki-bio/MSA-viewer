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
const { buildBam, syntheticReads, mulberry } = require('../lib/synth-bam.js');
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
