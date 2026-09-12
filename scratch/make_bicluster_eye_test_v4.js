/**
 * Eye-test v4: same 24x48 as v1, but the right 16 columns are random
 * instead of TTTTTTTTTTTTTTTT. The C-motif is still in the middle.
 *
 * Planted:
 *   cols  0-15  CORE   all 24: ACGTACGTACGTACGT
 *   cols 16-31  TAIL   6 groupA = CCCCCCCCCCCCCCCC; 18 bg mixed A/G/T
 *   cols 32-47  NOISE  every row independent ACGT (no shared motif)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const BC = require('../block-bicluster.js');

const CORE = 'ACGTACGTACGTACGT';
const TAIL_A = 'CCCCCCCCCCCCCCCC';

function mix(seed, n, alphabet) {
  let x = seed | 0, s = '';
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
  const tail = i === 1 ? snp(TAIL_A, 8, 'G') : TAIL_A;
  rows.push({ name: 'groupA_' + String(i).padStart(2, '0'), seq: core + tail + mix(8000 + i, 16, 'ACGT') });
}
for (let i = 0; i < 18; i++) {
  const core = (i % 6 === 0) ? snp(CORE, 7, 'T') : CORE;
  rows.push({
    name: 'bg_' + String(i).padStart(2, '0'),
    seq: core + mix(8100 + i, 16, 'AGT') + mix(8200 + i, 16, 'ACGT')
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
fs.writeFileSync(path.join(__dirname, 'bicluster_eye_test_v4.fa'), fasta);

const mask = BC.computeBiclusterMask(fasta, {});
const lines = [];
lines.push('Planted:');
lines.push('  cols  1-16: CORE, all 24 rows ACGTACGTACGTACGT');
lines.push('  cols 17-32: six groupA_* = CCCCCCCCCCCCCCCC; 18 bg_* mixed');
lines.push('  cols 33-48: NOISE, no shared motif (this is the change from v1)');
lines.push('  File order: ' + reordered.map(r => r.name).join(', '));
lines.push('');
lines.push('What computeBiclusterMask currently returns:');
mask.blocks.forEach((b, i) => {
  const names = (b.rows === 'all') ? 'ALL 24 rows' : b.rows.map(k => mask.row_headers[k]).join(', ');
  const coh = b.coherence == null ? 'null' : b.coherence.toFixed(3);
  lines.push('  block ' + i + ': cols ' + (b.col_start + 1) + '-' + (b.col_end + 1)
    + '  nRows=' + (b.rows === 'all' ? 24 : b.rows.length)
    + '  coherence=' + coh);
  lines.push('           ' + names);
});
fs.writeFileSync(path.join(__dirname, 'bicluster_eye_test_v4.KEY.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
