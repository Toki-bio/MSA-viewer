// 8 rows: a conserved core for all, then a tail where 3 rows share a real
// sequence, 4 rows have independent random tails (background), and 1 row
// is a genuine short outlier (almost no real data) - engineered to try to
// isolate that lone row as its own tiny residual group during row-split
// clustering, the exact shape that produced a singleton leaf before the
// _mergeUndersizedLeaves fix.
const fs = require('fs');

function rnd(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
const r = rnd(42);
const BASES = ['A', 'C', 'G', 'T'];
function randSeq(len, rr) {
  let s = '';
  for (let i = 0; i < len; i++) s += BASES[Math.floor(rr() * 4)];
  return s;
}

const core = randSeq(30, rnd(1));
const sharedTail = randSeq(20, rnd(2));

const rows = [];
for (let i = 0; i < 3; i++) rows.push({ name: 'shared' + i, seq: core + sharedTail });
for (let i = 0; i < 4; i++) rows.push({ name: 'bg' + i, seq: core + randSeq(20, rnd(100 + i)) });
rows.push({ name: 'outlier', seq: core.slice(0, 5) + '-'.repeat(45) }); // genuine short outlier

let out = '';
rows.forEach(row => { out += '>' + row.name + '\n' + row.seq + '\n'; });
fs.writeFileSync('scratch/small_singleton_test.fa', out);
console.log('wrote', rows.length, 'rows,', rows[0].seq.length, 'cols');
