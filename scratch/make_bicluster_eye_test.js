/**
 * Small planted alignment for visual review of the current bicluster
 * algorithm. Motifs are chosen so a human can read them without a key:
 *
 *   cols  0-15  CORE   every row is ACGTACGTACGTACGT (one SNP on a few rows)
 *   cols 16-31  TAIL   six groupA rows are CCCCCCCCCCCCCCCC; others unique
 *   cols 32-47  END    every row is TTTTTTTTTTTTTTTT (second conserved region)
 *
 * The right-hand conserved block is intentional: without it, column-purity
 * cannot carve the middle tail out (only 6/24 rows match there), and the
 * current algorithm then misses groupA. That limitation is documented; this
 * file is the case the current code CAN recover, so a human can see it.
 *
 * 24 rows x 48 columns. Names encode membership (groupA_* vs bg_*).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const BC = require('../block-bicluster.js');

const CORE = 'ACGTACGTACGTACGT';
const TAIL_A = 'CCCCCCCCCCCCCCCC';
const END = 'TTTTTTTTTTTTTTTT';

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

const rows = [];
for (let i = 0; i < 6; i++) {
  const core = i === 0 ? snp(CORE, 3, 'A') : CORE;
  const tail = i === 1 ? snp(TAIL_A, 8, 'G') : TAIL_A;
  rows.push({ name: 'groupA_' + String(i).padStart(2, '0'), seq: core + tail + END });
}
for (let i = 0; i < 18; i++) {
  const core = (i % 6 === 0) ? snp(CORE, 7, 'T') : CORE;
  rows.push({
    name: 'bg_' + String(i).padStart(2, '0'),
    seq: core + mix(2000 + i, 16, 'AGT') + END
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
      const d = dist(list[last].seq, list[i].seq);
      if (d < bestD) { bestD = d; best = i; }
    }
    used[best] = true;
    order.push(best);
  }
  return order.map(i => list[i]);
}

const reordered = reorderBySimilarity(rows);
const fasta = reordered.map(r => '>' + r.name + '\n' + r.seq).join('\n') + '\n';
const outFa = path.join(__dirname, 'bicluster_eye_test.fa');
fs.writeFileSync(outFa, fasta);

const mask = BC.computeBiclusterMask(fasta, {});
const lines = [];
lines.push('Planted (what a correct answer looks like):');
lines.push('  24 rows x 48 columns, already ordered by similarity.');
lines.push('  cols  1-16 (0-based 0-15): CORE, all 24 rows share ACGTACGTACGTACGT');
lines.push('  cols 17-32 (0-based 16-31): six groupA_* rows share CCCCCCCCCCCCCCCC;');
lines.push('       the 18 bg_* rows do not share that motif');
lines.push('  cols 33-48 (0-based 32-47): END, all 24 rows share TTTTTTTTTTTTTTTT');
lines.push('  groupA rows: groupA_00 .. groupA_05');
lines.push('');
lines.push('What computeBiclusterMask currently returns:');
mask.blocks.forEach((b, i) => {
  const names = (b.rows === 'all')
    ? 'ALL 24 rows'
    : b.rows.map(k => mask.row_headers[k]).join(', ');
  const coh = b.coherence == null ? 'null' : b.coherence.toFixed(3);
  lines.push('  block ' + i + ': cols ' + (b.col_start + 1) + '-' + (b.col_end + 1)
    + '  (' + (b.col_end - b.col_start + 1) + ' wide)'
    + '  nRows=' + (b.rows === 'all' ? 24 : b.rows.length)
    + '  coherence=' + coh);
  lines.push('           ' + names);
});
const outKey = path.join(__dirname, 'bicluster_eye_test.KEY.txt');
fs.writeFileSync(outKey, lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log('wrote', outFa);
console.log('wrote', outKey);
