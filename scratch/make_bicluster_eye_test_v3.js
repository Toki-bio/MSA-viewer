/**
 * Eye-test v3: same 24 x 48 template as v1/v2.
 * Only the middle 16 columns change: TWO zones, different row sets.
 *
 *   cols  0-15  CORE        all 24: ACGTACGTACGTACGT
 *   cols 16-23  ZONE A (8)  6 groupA = CCCCCCCC; groupB and bg mixed A/T
 *   cols 24-31  ZONE B (8)  6 groupB = GGGGGGGG; groupA and bg mixed A/T
 *   cols 32-47  END         all 24: TTTTTTTTTTTTTTTT
 *
 * groupA and groupB do not overlap. This is the "two independent
 * column ranges" case, still inside the original 48-col frame.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const BC = require('../block-bicluster.js');

const CORE = 'ACGTACGTACGTACGT';
const END = 'TTTTTTTTTTTTTTTT';
const A8 = 'CCCCCCCC';
const B8 = 'GGGGGGGG';

function mix(seed, n, alphabet) {
  let x = seed | 0;
  let s = '';
  for (let i = 0; i < n; i++) {
    x = (x + 0x6D2B79F5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    s += alphabet[Math.floor(u * alphabet.length)];
  }
  return s;
}

function snp(seq, pos, to) {
  return seq.slice(0, pos) + to + seq.slice(pos + 1);
}

function family(name) { return name.split('_')[0]; }

const rows = [];
for (let i = 0; i < 6; i++) {
  const core = i === 0 ? snp(CORE, 3, 'A') : CORE;
  const a = i === 1 ? snp(A8, 3, 'A') : A8;
  rows.push({ name: 'groupA_' + String(i).padStart(2, '0'), seq: core + a + mix(5000 + i, 8, 'AT') + END });
}
for (let i = 0; i < 6; i++) {
  const core = i === 0 ? snp(CORE, 7, 'T') : CORE;
  const b = i === 1 ? snp(B8, 2, 'A') : B8;
  rows.push({ name: 'groupB_' + String(i).padStart(2, '0'), seq: core + mix(6000 + i, 8, 'AT') + b + END });
}
for (let i = 0; i < 12; i++) {
  const core = (i % 5 === 0) ? snp(CORE, 11, 'A') : CORE;
  rows.push({
    name: 'bg_' + String(i).padStart(2, '0'),
    seq: core + mix(7000 + i, 16, 'AT') + END
  });
}

function dist(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

function reorderBySimilarity(list) {
  const used = new Array(list.length).fill(false);
  const order = [0];
  used[0] = true;
  while (order.length < list.length) {
    const last = order[order.length - 1];
    let best = -1, bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      let d = dist(list[last].seq, list[i].seq);
      if (d === bestD && best >= 0 && family(list[i].name) === family(list[last].name)
          && family(list[best].name) !== family(list[last].name)) {
        best = i;
      } else if (d < bestD) { bestD = d; best = i; }
    }
    used[best] = true;
    order.push(best);
  }
  return order.map(i => list[i]);
}

const reordered = reorderBySimilarity(rows);
const fasta = reordered.map(r => '>' + r.name + '\n' + r.seq).join('\n') + '\n';
fs.writeFileSync(path.join(__dirname, 'bicluster_eye_test_v3.fa'), fasta);

const mask = BC.computeBiclusterMask(fasta, {});
const lines = [];
lines.push('Planted (24x48; middle 16 columns are TWO zones, different rows):');
lines.push('  cols  1-16: CORE, all 24 rows ACGTACGTACGTACGT');
lines.push('  cols 17-24: six groupA_* = CCCCCCCC; others mixed A/T');
lines.push('  cols 25-32: six groupB_* = GGGGGGGG; others mixed A/T');
lines.push('  cols 33-48: END, all 24 rows TTTTTTTTTTTTTTTT');
lines.push('  groupA and groupB do not overlap.');
lines.push('  File order: ' + reordered.map(r => r.name).join(', '));
lines.push('');
lines.push('What computeBiclusterMask currently returns:');
mask.blocks.forEach((b, i) => {
  const names = (b.rows === 'all')
    ? 'ALL 24 rows'
    : b.rows.map(k => mask.row_headers[k]).join(', ');
  const coh = b.coherence == null ? 'null' : b.coherence.toFixed(3);
  lines.push('  block ' + i + ': cols ' + (b.col_start + 1) + '-' + (b.col_end + 1)
    + '  nRows=' + (b.rows === 'all' ? 24 : b.rows.length)
    + '  coherence=' + coh);
  lines.push('           ' + names);
});
fs.writeFileSync(path.join(__dirname, 'bicluster_eye_test_v3.KEY.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
