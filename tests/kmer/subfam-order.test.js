// kmer-tree.js must give the same leaf order as the independent C and Python/numpy implementations
// of the k-mer ordering used by SubFam (github.com/Toki-bio/SubFam, kmer_order.c): same distances,
// same tie-breaking, on inputs with exact duplicates and indels. See fixtures/subfam_order/README.md.
const fs = require('fs'), path = require('path');
const KT = require('../../kmer-tree.js');
const dir = path.join(__dirname, 'fixtures', 'subfam_order');
function readFa(p) {
  const names = [], seqs = []; let cur = null;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('>')) { names.push(line.slice(1).trim()); cur = []; seqs.push(cur); } else if (cur) cur.push(line.trim());
  }
  return { names, seqs: seqs.map(s => ({ seq: s.join('') })) };
}
let failed = 0;
for (const c of ['toy400', 'fam8_indel_trunc', 'duplicates']) {
  const { names, seqs } = readFa(path.join(dir, c + '.fa'));
  for (const [tag, k, canonical] of [['k6c0', 6, false], ['k8c1', 8, true]]) {
    const want = fs.readFileSync(path.join(dir, `${c}.${tag}.order`), 'utf8').split('\n').filter(Boolean);
    const got = KT.guideTree(seqs, k, { canonical }).order.map(i => names[i]);
    const ok = got.length === want.length && got.every((x, i) => x === want[i]);
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c} ${tag}: leaf order equals the C/Python order (${seqs.length} sequences)`);
  }
}
process.exit(failed ? 1 : 0);
