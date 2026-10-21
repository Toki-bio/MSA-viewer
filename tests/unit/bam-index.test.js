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
  // reg2bins: the spec's example values
  check('reg2bins(0, 1) is bins 0, 1, 9, 73, 585, 4681', BP.reg2bins(0, 1).join() === '0,1,9,73,585,4681', BP.reg2bins(0, 1).join());
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
