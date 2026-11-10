// VariantEffect (variant-effect.js): each planted change of tests/fixtures/reads/region gets the effect its
// generator recorded (truth.json "change": codon, amino acids, codon number), on a two-exon + gene and a - gene.
// Run: node tests/unit/variant-effect.test.js
const fs = require('fs'), path = require('path');
const VE = require('../../variant-effect.js');
const DIR = path.join(__dirname, '..', 'fixtures', 'reads', 'region');
const ref = fs.readFileSync(path.join(DIR, 'region.fa'), 'utf8').replace(/\r/g, '').split('\n').slice(1).join('');
const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'));
const AA = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG', code = {};
{ let i = 0; for (const a of 'TCAG') for (const b of 'TCAG') for (const c of 'TCAG') code[a + b + c] = AA[i++]; }
const genes = [
  { name: 'geneA', strand: '+', coding: true, cdsBlocks: [[200, 500], [800, 1100]], codonStart: 1 },
  { name: 'geneB', strand: '-', coding: true, cdsBlocks: [[1600, 2200]], codonStart: 1 },
];
let fails = 0;
const check = (name, ok, detail) => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : ' - ' + detail}`); if (!ok) fails++; };
const m = Object.fromEntries(truth.muts.map(x => [x.name, x]));
const one = (mu) => VE.annotate(mu.del ? { pos: mu.pos + 1, type: 'del', ref: ref[mu.pos] } : { pos: mu.pos + 1, type: 'snv', ref: mu.ref, alt: mu.alt }, ref, genes, code);

// "AGG>AGA R30R": codon 30, synonymous
for (const [name, effect] of [['A_syn_het_exon1', 'synonymous'], ['A_missense_hom_exon2', 'missense'], ['B_stop_hom', 'stop gained'], ['B_missense_het', 'missense']]) {
  const t = m[name], r = one(t)[0];
  const [codons, aa] = t.change.split(' ');
  const wantP = 'p.' + aa.replace(/^(.)(\d+)(.)$/, (x, a, n, b) => a + n + (a === b ? '=' : b));
  check(`${name}: ${effect}, ${wantP}, codon ${codons}`, r.gene === t.gene && r.effect === effect && r.p === wantP && r.codon === codons && r.aaPos === t.codon, JSON.stringify(r));
}
check('intron change: intron, no protein effect', one(m.intron_hom)[0].effect === 'intron' && !one(m.intron_hom)[0].p, JSON.stringify(one(m.intron_hom)));
const d = one(m.B_del1_het)[0];
check('1-base deletion in the - gene: frameshift at codon 170', d.gene === 'geneB' && d.effect === 'frameshift' && d.aaPos === 170 && /^p\.\w170fs$/.test(d.p), JSON.stringify(d));
// codon numbering across the exon junction: geneA codon 101 is the first codon of exon 2 (positions 801-803)
const j = VE.annotate({ pos: 801, type: 'snv', ref: ref[800], alt: ref[800] === 'A' ? 'C' : 'A' }, ref, genes, code)[0];
check('first base of exon 2 is c.301, codon 101', j.c.startsWith('c.301') && j.aaPos === 101, JSON.stringify(j));
// minus strand c. notation: complemented bases, counted from the gene's own start (reference 2200 = c.1)
const k = VE.annotate({ pos: 2200, type: 'snv', ref: ref[2199], alt: ref[2199] === 'T' ? 'C' : 'T' }, ref, genes, code)[0];
check('last reference base of the - gene is c.1 (complemented), start codon', k.c.startsWith('c.1' + { A: 'T', C: 'G', G: 'C', T: 'A' }[ref[2199]]) && k.aaPos === 1 && k.effect === 'start lost', JSON.stringify(k));
// splice site: the first intron base after exon 1 (position 501)
const s = VE.annotate({ pos: 501, type: 'snv', ref: ref[500], alt: ref[500] === 'A' ? 'C' : 'A' }, ref, genes, code)[0];
check('first intron base is a splice site', s.region === 'splice site', JSON.stringify(s));
check('outside both genes: intergenic', VE.annotate({ pos: 50, type: 'snv', ref: ref[49], alt: 'A' }, ref, genes, code)[0].region === 'intergenic', '');
// an in-frame 3-base deletion and an insertion
const d3 = VE.annotate({ pos: 301, type: 'del', ref: ref.substr(300, 3) }, ref, genes, code)[0];
check('3-base deletion in geneA: in-frame deletion', d3.effect === 'in-frame deletion' && d3.c === 'c.101_103del', JSON.stringify(d3));
const i1 = VE.annotate({ pos: 302, type: 'ins', ref: '-', alt: 'G' }, ref, genes, code)[0];
check('1-base insertion in geneA: frameshift, c.101_102insG', i1.effect === 'frameshift' && i1.c === 'c.101_102insG', JSON.stringify(i1));

// An insertion just before the first base of a CDS block (between an intron or upstream base and the block's first
// base) was taken as inside the CDS: the base before it has no transcript position, so it came out as
// c.NaN_NaNinsG, p.MNaNfs and a false frameshift (audit M24). It is not between two coding bases: before exon 2 it is
// at the splice acceptor, before exon 1 (upstream of the start codon) or after the - gene's last base it is no CDS change.
{
  const insAt = pos => VE.annotate({ pos, type: 'ins', ref: '-', alt: 'G' }, ref, genes, code);
  const noNaN = rs => rs.every(r => !/NaN/.test(r.c + r.p) && r.effect !== 'frameshift');
  const e2 = insAt(801), e1 = insAt(201), bEnd = insAt(1601);
  check('insertion before the first base of exon 2: splice site, no NaN, no frameshift', noNaN(e2) && e2[0].gene === 'geneA' && e2[0].region === 'splice site', JSON.stringify(e2));
  check('insertion before the first base of exon 1 (upstream of the start codon): no NaN, no frameshift', noNaN(e1), JSON.stringify(e1));
  check('insertion before the first reference base of the - gene: no NaN, no frameshift', noNaN(bEnd), JSON.stringify(bEnd));
}

// A deletion from the end of an exon into the intron's GT donor was reported only as a frameshift (the CDS bases it
// takes); the splice site it removes was not said (audit L28). geneA exon 1 ends at 500: delete 499..502 (1-based).
{
  const dd = VE.annotate({ pos: 499, type: 'del', ref: ref.substr(498, 4) }, ref, genes, code)[0];
  check('deletion from exon 1 into the splice donor: frameshift and splice site', /frameshift/.test(dd.effect) && /splice site/.test(dd.effect) && dd.c === 'c.299_300del', JSON.stringify(dd));
  // a deletion inside the exon (not reaching the intron) stays a plain frameshift
  const dIn = VE.annotate({ pos: 496, type: 'del', ref: ref.substr(495, 2) }, ref, genes, code)[0];
  check('deletion that stops before the intron: frameshift only', dIn.effect === 'frameshift', JSON.stringify(dIn));
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
