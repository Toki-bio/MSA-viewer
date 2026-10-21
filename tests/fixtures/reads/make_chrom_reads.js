// A 200 kb "chromosome" (chrT) with the two-gene region of tests/fixtures/reads/region (region.fa) embedded at
// 100,001-103,000, sparse reads along the whole chromosome and the region's 40x reads shifted onto it; a second
// reference (chrU) with reads too. Coordinate-sorted SAM + BAM (sam2bam.js); the .bai index is made by
// samtools (samtools index chrom_reads.bam) and committed, so the index reader is tested against the real tool.
//   node tests/fixtures/reads/make_chrom_reads.js [outdir]
const fs = require('fs'), path = require('path');
const { samToBam } = require('./sam2bam.js');
const OUT = process.argv[2] || path.join(__dirname, 'chrom');
const R = path.join(__dirname, 'region');
let s = 99;
const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
const B = 'ACGT', pick = () => B[rnd() * 4 | 0];
const OFF = 100000;
const region = fs.readFileSync(path.join(R, 'region.fa'), 'utf8').replace(/\r/g, '').split('\n').slice(1).join('');
const chrT = Array.from({ length: OFF }, pick).join('') + region + Array.from({ length: 200000 - OFF - region.length }, pick).join('');
const chrU = Array.from({ length: 50000 }, pick).join('');
const lines = [];
const sparse = (name, seq, n) => {
    for (let i = 0; i < n; i++) {
        const st = Math.floor(rnd() * (seq.length - 150));
        if (name === 'chrT' && st + 150 > OFF && st < OFF + region.length) continue;   // the region has its own reads
        lines.push({ ref: name, pos: st, line: [`${name}_s${i}`, rnd() < 0.5 ? 0 : 16, name, st + 1, 60, '150M', '*', 0, 0, seq.substr(st, 150), 'F'.repeat(150)].join('\t') });
    }
};
sparse('chrT', chrT, 1500);
sparse('chrU', chrU, 300);
for (const l of fs.readFileSync(path.join(R, 'reads_40x.sam'), 'utf8').replace(/\r/g, '').split('\n')) {
    if (!l || l[0] === '@') continue;
    const f = l.split('\t');
    f[2] = 'chrT'; f[3] = String(+f[3] + OFF);
    lines.push({ ref: 'chrT', pos: +f[3] - 1, line: f.join('\t') });
}
lines.sort((a, b) => (a.ref === b.ref ? a.pos - b.pos : a.ref < b.ref ? -1 : 1));
const sam = `@HD\tVN:1.6\tSO:coordinate\n@SQ\tSN:chrT\tLN:${chrT.length}\n@SQ\tSN:chrU\tLN:${chrU.length}\n` + lines.map(x => x.line).join('\n') + '\n';
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'chrom_reads.bam'), samToBam(sam));
fs.writeFileSync(path.join(OUT, 'chrT.fa'), '>chrT\n' + chrT.match(/.{1,60}/g).join('\n') + '\n');
// the gene region as samtools faidx writes it (chrT:100001-103000)
fs.writeFileSync(path.join(OUT, 'chrT_region.fa'), `>chrT:${OFF + 1}-${OFF + region.length}\n` + region.match(/.{1,60}/g).join('\n') + '\n');
console.log(lines.length, 'reads;', lines.filter(x => x.ref === 'chrT' && x.pos + 150 > OFF && x.pos < OFF + region.length).length, 'overlap the region');
