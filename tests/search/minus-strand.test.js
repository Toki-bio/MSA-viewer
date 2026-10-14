// Sequence search (blast-worker.js): a Plus/Minus hit is reported in the
// query's own coordinates, as BLAST does.
//
// Before the 2026-10-14 audit fix, a hit found with the reverse-complemented
// query kept the coordinates of that reverse complement: a hit on query
// 101..160 was reported as 1..60, and the hit bar was drawn over the wrong end
// of the query. The aligned strings now read along the plus strand of the
// query, with the subject reverse-complemented beside it.
//
//   node tests/search/minus-strand.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'blast-worker.js'), 'utf8');
const ctx = { self: { addEventListener() {}, postMessage() {} }, console, importScripts() {},
  Math, Float64Array, Uint8Array, Uint16Array, Int32Array, Map, Set };
vm.createContext(ctx);
vm.runInContext(src + ';this.SD=searchDatabase;this.BI=buildInvertedIndex;this.PF=parseFasta;'
  + 'this.enc=encodeSeq;this.rc=revComp;this.preset=applyScoringPreset;', ctx);

let seed = 3;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const R = n => Array.from({ length: n }, () => 'ACGT'[Math.floor(rnd() * 4)]).join('');

let failed = 0;
function expect(name, ok, detail) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : ' - ' + detail}`);
  if (!ok) failed++;
}

const q = R(160);
const subj = R(200) + ctx.rc(q.substring(100, 160)) + R(200);
const db = ctx.PF('>s1 test\n' + subj + '\n');
db.forEach(s => { s._enc = ctx.enc(s.seq); });
const idx = ctx.BI(db);

for (const preset of ['water', 'blastn']) {
  ctx.preset(preset);
  const h = ctx.SD(q, db, idx, 5)[0].hsps[0];
  const qAligned = h.querySeq.replace(/-/g, '');
  const sAligned = h.hitSeq.replace(/-/g, '');
  // water's local alignment may run on into the random flanks: exact ends only for blastn
  if (preset === 'blastn') expect(`${preset}: Plus/Minus hit on query 101..160 is reported as 101..160`,
    h.strand === '-' && h.queryStart === 101 && h.queryEnd === 160 && h.hitStart === 201 && h.hitEnd === 260,
    JSON.stringify({ strand: h.strand, q: [h.queryStart, h.queryEnd], s: [h.hitStart, h.hitEnd] }));
  expect(`${preset}: Plus/Minus hit covers query 101..160`, h.strand === '-' && h.queryStart <= 101 && h.queryEnd >= 160,
    JSON.stringify({ q: [h.queryStart, h.queryEnd] }));
  expect(`${preset}: aligned query reads along the plus strand; subject is its reverse complement`,
    qAligned === q.substring(h.queryStart - 1, h.queryEnd).toUpperCase()
      && sAligned === ctx.rc(subj.substring(h.hitStart - 1, h.hitEnd)).toUpperCase(),
    JSON.stringify({ qAligned: qAligned.slice(0, 20), sAligned: sAligned.slice(0, 20) }));
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
