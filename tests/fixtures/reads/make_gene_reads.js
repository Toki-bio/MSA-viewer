// Builds gene_ref.fa, gene_reads.sam and truth.json: an invented 903 bp coding sequence with 30 bp flanks,
// and 100 bp reads from two haplotypes that carry known changes (homozygous ones on both). Deterministic.
// Used by tests/unit/sample-call.test.js and the "Sample row" regression checks.
//   node tests/fixtures/reads/make_gene_reads.js
const fs = require('fs'), path = require('path');
const OUT = __dirname;
let s = 7;
const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;   // 32-bit: a plain multiply loses precision
const B = 'ACGT', pick = () => B[rnd() * 4 | 0];
const AA = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG', code = {};
{ let i = 0; for (const a of 'TCAG') for (const b of 'TCAG') for (const c of 'TCAG') code[a + b + c] = AA[i++]; }

let cds = 'ATG';
while (cds.length < 900) { const c = pick() + pick() + pick(); if (code[c] !== '*') cds += c; }
cds += 'TAA';
const flank = n => Array.from({ length: n }, pick).join('');
const ref = flank(30) + cds + flank(30);
const cs = k => 30 + 3 * (k - 1);           // 0-based start of codon k (1-based)

// one-base change in codon k (from codon k on, first codon that allows it): kind 'syn' | 'mis' | 'stop'
function oneBase(k, kind) {
    for (; ; k++) {
        const p = cs(k), c = ref.slice(p, p + 3);
        for (const j of [2, 1, 0]) for (const x of B) {
            if (x === c[j]) continue;
            const m = c.slice(0, j) + x + c.slice(j + 1);
            const ok = kind === 'syn' ? code[m] === code[c] : kind === 'stop' ? code[m] === '*' : code[m] !== code[c] && code[m] !== '*';
            if (ok) return { pos: p + j, ref: c[j], alt: x, codon: k, change: `${c}>${m} ${code[c]}>${code[m]}` };
        }
    }
}
const muts = [
    { name: 'syn_hom', hom: true, ...oneBase(20, 'syn') },
    { name: 'missense_het', hom: false, ...oneBase(60, 'mis') },
    { name: 'stop_hom', hom: true, ...oneBase(120, 'stop') },
    { name: 'stop_het', hom: false, ...oneBase(150, 'stop') },
    { name: 'del1_hom', hom: true, pos: cs(200) + 1, del: 1 },               // frameshift
    { name: 'del3_het', hom: false, pos: cs(250), del: 3 },                  // in frame, one haplotype
    { name: 'ins3_hom', hom: true, pos: cs(280), ins: 'GGC' },               // in frame, before codon 280
];

// a haplotype as one entry per reference position: '' deleted, else (inserted bases +) the base
function hap(het) {
    const h = ref.split('').map(b => ({ ins: '', base: b }));
    for (const m of muts) {
        if (!m.hom && !het) continue;
        if (m.del) for (let k = 0; k < m.del; k++) h[m.pos + k].base = '';
        else if (m.ins) h[m.pos].ins = m.ins;
        else h[m.pos].base = m.alt;
    }
    return h;
}
const haps = [hap(true), hap(false)];
const L = 100, reads = [];
for (let start = 0; start < ref.length; start += 8) for (const hi of [0, 1]) {
    const h = haps[hi], cig = [];
    let p = start, bases = '';
    const op = (o, n = 1) => { if (cig.length && cig[cig.length - 1][1] === o) cig[cig.length - 1][0] += n; else cig.push([n, o]); };
    while (bases.length < L && p < ref.length) {
        const e = h[p];
        if (e.ins && bases.length) { bases += e.ins; op('I', e.ins.length); }   // a read does not start with an insertion
        if (e.base === '') op('D');
        else { let b = e.base; if (rnd() < 0.003) b = B.replace(b, '')[rnd() * 3 | 0]; bases += b; op('M'); }
        p++;
    }
    if (bases.length < L || cig[0][1] !== 'M') continue;
    reads.push([`r${reads.length + 1}_h${hi + 1}`, rnd() < 0.5 ? 0 : 16, 'gene', start + 1, 60, cig.map(c => c.join('')).join(''),
        '*', 0, 0, bases, 'I'.repeat(bases.length)].join('\t'));
}
fs.writeFileSync(path.join(OUT, 'gene_ref.fa'), '>gene\n' + ref.match(/.{1,60}/g).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'gene_reads.sam'), `@HD\tVN:1.6\tSO:coordinate\n@SQ\tSN:gene\tLN:${ref.length}\n` + reads.join('\n') + '\n');
// Indels in truth.json are left-normalised (the standard form, as the caller reports them): a deletion or insertion
// in a repeat is the same event at any offset of it. The reads are written as planted.
function leftNormalise(m, refStr) {
    if (m.del) { while (m.pos > 0 && refStr[m.pos - 1] === refStr[m.pos + m.del - 1]) m.pos--; }
    else if (m.ins) { while (m.pos > 1 && refStr[m.pos - 1] === m.ins[m.ins.length - 1]) { m.ins = m.ins[m.ins.length - 1] + m.ins.slice(0, -1); m.pos--; } }
    return m;
}
for (const m of muts) leftNormalise(m, ref);
fs.writeFileSync(path.join(OUT, 'truth.json'), JSON.stringify({ cdsStart: 30, cdsLength: cds.length, reads: reads.length, muts }, null, 1) + '\n');
console.log(`${reads.length} reads; ` + muts.map(m => `${m.name} @${m.pos + 1}${m.change ? ' ' + m.change : ''}`).join('; '));
