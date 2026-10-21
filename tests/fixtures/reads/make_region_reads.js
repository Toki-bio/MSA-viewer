// Audit fixture: a 3 kb region with a two-exon CDS on + and a CDS on -, reads with known mutations.
// node tests/fixtures/reads/make_region_reads.js [outdir] [depth]   (default: this folder/region, 40x)
// Used by the regression checks "GenBank genes ..." and the reads checks; deterministic.
const fs = require('fs'), path = require('path');
const OUT = process.argv[2] || path.join(__dirname, 'region'), DEPTH = +(process.argv[3] || 40);
let s = 11;
const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
const B = 'ACGT', pick = () => B[rnd() * 4 | 0];
const AA = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG', code = {};
{ let i = 0; for (const a of 'TCAG') for (const b of 'TCAG') for (const c of 'TCAG') code[a + b + c] = AA[i++]; }
const rc = x => x.split('').reverse().map(c => ({ A: 'T', C: 'G', G: 'C', T: 'A' }[c])).join('');
const randCodons = n => { let o = ''; while (o.length < 3 * n) { const c = pick() + pick() + pick(); if (code[c] !== '*') o += c; } return o; };
// region: 1-based features. CDS1 = join(201..500, 801..1100) on +; CDS2 = complement(1601..2200)
const L = 3000;
const ref = Array.from({ length: L }, pick);
const cds1 = 'ATG' + randCodons(198) + 'TAA';           // 600 nt
cds1.slice(0, 300).split('').forEach((c, i) => ref[200 + i] = c);
cds1.slice(300).split('').forEach((c, i) => ref[800 + i] = c);
const cds2 = 'ATG' + randCodons(198) + 'TGA';           // 600 nt, sense strand
rc(cds2).split('').forEach((c, i) => ref[1600 + i] = c);
const refS = ref.join('');
// mutations (0-based reference positions)
function codonOf1(k) { // codon k (1-based) of CDS1 -> reference positions of its 3 bases
  const cdsPos = [...Array(300).keys()].map(i => 200 + i).concat([...Array(300).keys()].map(i => 800 + i));
  return [0, 1, 2].map(j => cdsPos[3 * (k - 1) + j]);
}
function codonOf2(k) { // codon k of CDS2 (minus): sense base j sits at reference 2199 - (3(k-1)+j)
  return [0, 1, 2].map(j => 2199 - (3 * (k - 1) + j));
}
const muts = [];
const senseCodon = (pos, minus) => pos.map(p => minus ? rc(refS[p]) : refS[p]).join('');
function oneBase(codonPos, minus, want, k0) {
  for (let k = k0; ; k++) {
    const pos = (minus ? codonOf2 : codonOf1)(k), c = senseCodon(pos, minus);
    for (const j of [2, 1, 0]) for (const x of B) {
      if (x === c[j]) continue;
      const m = c.slice(0, j) + x + c.slice(j + 1);
      const ok = want === 'syn' ? code[m] === code[c] : want === 'stop' ? code[m] === '*' : code[m] !== code[c] && code[m] !== '*';
      if (ok) { const p = pos[j]; return { pos: p, ref: refS[p], alt: minus ? rc(x) : x, codon: k, change: `${c}>${m} ${code[c]}${k}${code[m]}`, gene: minus ? 'geneB' : 'geneA' }; }
    }
  }
}
muts.push({ name: 'A_syn_het_exon1', hom: false, ...oneBase(null, false, 'syn', 30) });
muts.push({ name: 'A_missense_hom_exon2', hom: true, ...oneBase(null, false, 'mis', 140) });
muts.push({ name: 'intron_hom', hom: true, pos: 650, ref: refS[650], alt: refS[650] === 'A' ? 'G' : 'A', gene: 'intron' });
muts.push({ name: 'B_stop_hom', hom: true, ...oneBase(null, true, 'stop', 50) });
muts.push({ name: 'B_missense_het', hom: false, ...oneBase(null, true, 'mis', 120) });
muts.push({ name: 'B_del1_het', hom: false, pos: codonOf2(170)[1], del: 1, gene: 'geneB' });
function hap(het) {
  const h = refS.split('');
  for (const m of muts) { if (!m.hom && !het) continue; if (m.del) h[m.pos] = ''; else h[m.pos] = m.alt; }
  return h;
}
const haps = [hap(true), hap(false)];
const RL = 150, reads = [];
const nReads = Math.round(L * DEPTH / RL);
for (let r = 0; r < nReads; r++) {
  const start = Math.floor(rnd() * (L - RL + 1)), h = haps[r % 2], cig = [];
  let p = start, bases = '';
  const op = o => { if (cig.length && cig[cig.length - 1][1] === o) cig[cig.length - 1][0]++; else cig.push([1, o]); };
  while (bases.length < RL && p < L) { if (h[p] === '') op('D'); else { let b = h[p]; if (rnd() < 0.003) b = B.replace(b, '')[rnd() * 3 | 0]; bases += b; op('M'); } p++; }
  if (bases.length < RL || cig[0][1] !== 'M') continue;
  reads.push({ start, line: [`read${r + 1}`, rnd() < 0.5 ? 0 : 16, 'region1', start + 1, 60, cig.map(c => c.join('')).join(''), '*', 0, 0, bases, 'F'.repeat(bases.length)].join('\t') });
}
reads.sort((a, b) => a.start - b.start);
const gb = `LOCUS       region1     ${L} bp    DNA     linear   SYN 22-OCT-2026
DEFINITION  synthetic region with two genes (audit fixture).
ACCESSION   region1
FEATURES             Location/Qualifiers
     source          1..${L}
     gene            201..1100
                     /gene="geneA"
     CDS             join(201..500,801..1100)
                     /gene="geneA"
                     /codon_start=1
     gene            complement(1601..2200)
                     /gene="geneB"
     CDS             complement(1601..2200)
                     /gene="geneB"
                     /codon_start=1
ORIGIN
${refS.toLowerCase().match(/.{1,60}/g).map((l, i) => String(i * 60 + 1).padStart(9) + ' ' + l.match(/.{1,10}/g).join(' ')).join('\n')}
//
`;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'region.gb'), gb);
fs.writeFileSync(path.join(OUT, 'region.fa'), '>region1\n' + refS.match(/.{1,60}/g).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'region_bed6.bed'), 'region1\t200\t1100\tgeneA\t0\t+\nregion1\t1600\t2200\tgeneB\t0\t-\n');
fs.writeFileSync(path.join(OUT, 'region_bed12.bed'), 'region1\t200\t1100\tgeneA\t0\t+\t200\t1100\t0\t2\t300,300,\t0,600,\nregion1\t1600\t2200\tgeneB\t0\t-\t1600\t2200\t0\t1\t600,\t0,\n');
fs.writeFileSync(path.join(OUT, `reads_${DEPTH}x.sam`), `@HD\tVN:1.6\tSO:coordinate\n@SQ\tSN:region1\tLN:${L}\n` + reads.map(r => r.line).join('\n') + '\n');
// Indels in truth.json are left-normalised (the standard form, as the caller reports them): a deletion in a repeat
// is the same event at any offset of it. The reads are written as planted.
for (const m of muts) if (m.del) { while (m.pos > 0 && refS[m.pos - 1] === refS[m.pos + m.del - 1]) m.pos--; }
fs.writeFileSync(path.join(OUT, 'truth.json'), JSON.stringify({ muts, cds1, cds2 }, null, 1));
console.log(reads.length, 'reads'); muts.forEach(m => console.log(m.name, '@' + (m.pos + 1), m.change || (m.del ? 'del' : m.ref + '>' + m.alt)));
