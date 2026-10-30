// Realistic test alignments: mutated copies of one random root (substitutions, gap runs), seeded.
// node gen_fixtures.js <outdir>
const fs = require('fs'), path = require('path');
const out = process.argv[2] || __dirname;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function make(name, nRows, nCols, seed, div) {
  const r = rng(seed), B = 'ACGT';
  const root = Array.from({ length: nCols }, () => B[(r() * 4) | 0]);
  // a few clades: each row = clade ancestor + private mutations, so columns shade unevenly
  const clades = Array.from({ length: 8 }, () => root.map(c => (r() < div ? B[(r() * 4) | 0] : c)));
  let s = '';
  for (let i = 0; i < nRows; i++) {
    const a = clades[(r() * clades.length) | 0].slice();
    for (let j = 0; j < nCols; j++) if (r() < div / 2) a[j] = B[(r() * 4) | 0];
    // gap runs (indels) and ragged ends
    const nGaps = (r() * 4) | 0;
    for (let g = 0; g < nGaps; g++) { const st = (r() * nCols) | 0, ln = 1 + ((r() * 12) | 0); for (let j = st; j < Math.min(nCols, st + ln); j++) a[j] = '-'; }
    const lead = r() < 0.3 ? (r() * 20) | 0 : 0, trail = r() < 0.3 ? (r() * 20) | 0 : 0;
    for (let j = 0; j < lead; j++) a[j] = '-';
    for (let j = 0; j < trail; j++) a[nCols - 1 - j] = '-';
    s += `>${name}_seq${String(i + 1).padStart(4, '0')}_sample\n${a.join('')}\n`;
  }
  fs.writeFileSync(path.join(out, name + '.fas'), s);
  console.log(name, nRows, 'x', nCols);
}
make('aln600x600', 600, 600, 11, 0.12);
make('mito62x16808', 62, 16808, 22, 0.08);
make('aln2000x2000', 2000, 2000, 33, 0.12);
make('small25x800', 25, 800, 44, 0.12);
