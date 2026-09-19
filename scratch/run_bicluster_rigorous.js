/**
 * Rigorous follow-up: Node recovery + Playwright overlay on named 24x48
 * cases. Writes scratch/bicluster_rigorous.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const BC = require('../block-bicluster.js');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const INDEX = path.resolve('C:/work/MSA-viewer/index.html');
const CORE = 'ACGTACGTACGTACGT';
const END = 'TTTTTTTTTTTTTTTT';

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
function snp(seq, pos, to) { return seq.slice(0, pos) + to + seq.slice(pos + 1); }
function mutate(seq, rate, seed) {
  let x = seed | 0;
  return seq.split('').map(ch => {
    x = (x + 0x6D2B79F5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    if (u >= rate) return ch;
    return 'ACGT'.replace(ch, '')[Math.floor(u * 10) % 3];
  }).join('');
}
function family(name) { return name.split('_')[0]; }
function dist(a, b) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; }
function reorder(list) {
  const used = new Array(list.length).fill(false);
  const order = [0]; used[0] = true;
  while (order.length < list.length) {
    const last = order[order.length - 1];
    let best = -1, bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      const d = dist(list[last].seq, list[i].seq);
      if (d < bestD) { bestD = d; best = i; }
    }
    used[best] = true; order.push(best);
  }
  return order.map(i => list[i]);
}
function writeFa(name, rows) {
  const ordered = reorder(rows);
  const fa = ordered.map(r => '>' + r.name + '\n' + r.seq).join('\n') + '\n';
  const p = path.join(__dirname, name);
  fs.writeFileSync(p, fa);
  return p;
}

function setEq(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x,y)=>x-y), sb = [...b].sort((x,y)=>x-y);
  return sa.every((v,i) => v === sb[i]);
}
function recover(mask, plantedRows, c0, c1, tol) {
  for (const b of mask.blocks) {
    if (Math.abs(b.col_start - c0) > tol || Math.abs(b.col_end - c1) > tol) continue;
    if (plantedRows === 'all') {
      if (b.rows === 'all' || (Array.isArray(b.rows) && b.rows.length === mask.n_rows)) return true;
    } else if (Array.isArray(b.rows) && setEq(b.rows, plantedRows)) return true;
  }
  return false;
}

// --- build named cases ------------------------------------------------
const rowsV5 = [];
for (let i = 0; i < 6; i++) {
  rowsV5.push({ name: 'groupA_' + String(i).padStart(2,'0'),
    seq: mix(8300+i,16,'ACGT') + (i===1?snp('C'.repeat(16),8,'G'):'C'.repeat(16)) + mix(8400+i,16,'ACGT') });
}
for (let i = 0; i < 18; i++) {
  rowsV5.push({ name: 'bg_' + String(i).padStart(2,'0'),
    seq: mix(8500+i,16,'ACGT') + mix(8600+i,16,'AGT') + mix(8700+i,16,'ACGT') });
}
const faV5 = writeFa('bicluster_eye_test_v5.fa', rowsV5);

const rowsV6 = [];
for (let i = 0; i < 6; i++) rowsV6.push({ name: 'both_' + String(i).padStart(2,'0'), seq: CORE + 'C'.repeat(8) + 'G'.repeat(8) + END });
for (let i = 0; i < 3; i++) rowsV6.push({ name: 'onlyC_' + String(i).padStart(2,'0'), seq: CORE + 'C'.repeat(8) + mix(8800+i,8,'AT') + END });
for (let i = 0; i < 3; i++) rowsV6.push({ name: 'onlyG_' + String(i).padStart(2,'0'), seq: CORE + mix(8900+i,8,'AT') + 'G'.repeat(8) + END });
for (let i = 0; i < 12; i++) rowsV6.push({ name: 'bg_' + String(i).padStart(2,'0'), seq: CORE + mix(9000+i,16,'AT') + END });
const faV6 = writeFa('bicluster_eye_test_v6.fa', rowsV6);

const rowsV7 = [];
for (let i = 0; i < 6; i++) rowsV7.push({ name: 'groupA_' + String(i).padStart(2,'0'), seq: CORE + mutate('C'.repeat(16), 0.15, 11000+i) + END });
for (let i = 0; i < 18; i++) rowsV7.push({ name: 'bg_' + String(i).padStart(2,'0'), seq: CORE + mix(11100+i,16,'AGT') + END });
const faV7 = writeFa('bicluster_eye_test_v7.fa', rowsV7);

const existing = {
  v1: path.join(__dirname, 'bicluster_eye_test.fa'),
  v2: path.join(__dirname, 'bicluster_eye_test_v2.fa'),
  v3: path.join(__dirname, 'bicluster_eye_test_v3.fa'),
  v4: path.join(__dirname, 'bicluster_eye_test_v4.fa'),
};

const nodeChecks = [
  { id: 'v1', fa: existing.v1, plants: [
    { rows: 'all', c0:0, c1:15 },
    { rows: 'named:groupA', c0:16, c1:31, n:6 },
    { rows: 'all', c0:32, c1:47 }
  ]},
  { id: 'v2', fa: existing.v2, plants: [
    { rows: 'all', c0:0, c1:15 },
    { rows: 'named:groupA', c0:16, c1:31, n:6 },
    { rows: 'named:groupB', c0:16, c1:31, n:6 },
    { rows: 'all', c0:32, c1:47 }
  ]},
  { id: 'v3', fa: existing.v3, plants: [
    { rows: 'all', c0:0, c1:15 },
    { rows: 'named:groupA', c0:16, c1:23, n:6 },
    { rows: 'named:groupB', c0:24, c1:31, n:6 },
    { rows: 'all', c0:32, c1:47 }
  ]},
  { id: 'v4', fa: existing.v4, plants: [
    { rows: 'all', c0:0, c1:15 },
    { rows: 'named:groupA', c0:16, c1:31, n:6 }
  ]},
  { id: 'v5_no_flanks', fa: faV5, plants: [
    { rows: 'named:groupA', c0:16, c1:31, n:6 }
  ]},
  { id: 'v6_nested', fa: faV6, plants: [
    { rows: 'named:both+onlyC', c0:16, c1:23, n:9 },
    { rows: 'named:both+onlyG', c0:24, c1:31, n:9 }
  ]},
  { id: 'v7_mut15', fa: faV7, plants: [
    { rows: 'named:groupA', c0:16, c1:31, n:6 }
  ]},
];

function namedRows(headers, pred) {
  const idx = [];
  headers.forEach((h, i) => { if (pred(h)) idx.push(i); });
  return idx;
}

function score(fa, plants) {
  const mask = BC.computeBiclusterMask(fs.readFileSync(fa, 'utf8'), {});
  const H = mask.row_headers;
  const details = [];
  let ok = 0;
  for (const p of plants) {
    let rows = p.rows;
    if (rows === 'named:groupA') rows = namedRows(H, h => h.startsWith('groupA_'));
    else if (rows === 'named:groupB') rows = namedRows(H, h => h.startsWith('groupB_'));
    else if (rows === 'named:both+onlyC') rows = namedRows(H, h => h.startsWith('both_') || h.startsWith('onlyC_'));
    else if (rows === 'named:both+onlyG') rows = namedRows(H, h => h.startsWith('both_') || h.startsWith('onlyG_'));
    const hit = recover(mask, rows, p.c0, p.c1, 1);
    if (hit) ok++;
    const splits = mask.blocks.filter(b => b.rows !== 'all').map(b => ({
      cols: (b.col_start+1)+'-'+(b.col_end+1), n: b.rows.length, coh: b.coherence
    }));
    details.push({ want: p, hit, nWant: Array.isArray(rows) ? rows.length : 'all' });
  }
  return {
    nBlocks: mask.blocks.length,
    splits: mask.blocks.filter(b => b.rows !== 'all').map(b => ({
      cols: (b.col_start+1)+'-'+(b.col_end+1),
      n: b.rows.length,
      coh: b.coherence == null ? null : +b.coherence.toFixed(3),
      names: b.rows.map(k => H[k])
    })),
    alls: mask.blocks.filter(b => b.rows === 'all').map(b => ({
      cols: (b.col_start+1)+'-'+(b.col_end+1),
      coh: b.coherence == null ? null : +b.coherence.toFixed(3)
    })),
    plantedOk: ok + '/' + plants.length,
    allOk: ok === plants.length,
    details
  };
}

const COLORS = { CONSERVATIVE: '#16a34a', MOSAIC: '#f59e0b', DECAY_SLOPE: '#8b5cf6', DIVERGENT: '#cbd5e1', SIMPLE_REPEAT: '#ec4899' };

async function overlay(page, fasta) {
  await page.goto('file:///' + INDEX.replace(/\\/g, '/'), { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('#fileInput').setInputFiles(fasta);
  await page.waitForTimeout(1200);
  await page.evaluate(() => computeAndShowBicluster());
  await page.waitForTimeout(500);
  return page.evaluate((COLORS) => {
    const finds = (state.blockMask.blocks || []).filter(b => b.rows !== 'all' && b.type && b.type !== 'DIVERGENT');
    const rects = [...document.querySelectorAll('.block-mask-layer rect')].map(r => r.getAttribute('fill'));
    const count = {};
    for (const f of rects) count[f] = (count[f] || 0) + 1;
    return {
      findTypes: finds.map(b => ({
        cols: (b.col_start+1)+'-'+(b.col_end+1),
        n: b.rows.length,
        type: b.type,
        names: b.rows.map(k => state.blockMask.row_headers[k])
      })),
      nRects: rects.length,
      fillCounts: count
    };
  }, COLORS);
}

(async () => {
  const node = {};
  for (const c of nodeChecks) node[c.id] = score(c.fa, c.plants);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const ov = {};
  for (const c of nodeChecks) {
    ov[c.id] = await overlay(page, c.fa);
  }
  await browser.close();

  const out = { at: new Date().toISOString(), node, overlay: ov };
  const outPath = path.join(__dirname, 'bicluster_rigorous.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log('NODE recovery (exact planted rectangles ±1 col):');
  for (const c of nodeChecks) {
    console.log('  ' + (node[c.id].allOk ? 'PASS' : 'FAIL') + '  ' + c.id + '  ' + node[c.id].plantedOk);
    if (!node[c.id].allOk) {
      console.log('       alls', JSON.stringify(node[c.id].alls));
      console.log('       splits', JSON.stringify(node[c.id].splits.map(s => ({ cols:s.cols, n:s.n, coh:s.coh, names:s.names.slice(0,3) }))));
    }
  }
  console.log('\nBROWSER overlay find-colored blocks (not gray):');
  for (const c of nodeChecks) {
    const f = ov[c.id].findTypes;
    console.log('  ' + c.id + '  finds=' + f.length + '  rects=' + ov[c.id].nRects + '  fills=' + JSON.stringify(ov[c.id].fillCounts));
    f.forEach(x => console.log('       ' + x.type + '  cols ' + x.cols + '  n=' + x.n + '  ' + x.names.join(',')));
  }
  console.log('Wrote ' + outPath);
})();
