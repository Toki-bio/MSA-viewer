// Oracle audit of the Statistics window: an independent implementation of Easel's definitions (esl-alistat,
// esl-alipid as read in the Easel source today) and of ViewAlign's own documented definition ("shared columns"),
// compared number by number with what the window shows and exports. node stats_oracle.js <repo>
const path = require('path'), fs = require('fs');
const ROOT = process.argv[2] || path.join(__dirname, '..', '..');   // node tests/probes/stats_oracle.js
const { start } = require(path.join(ROOT, 'tests/lib/static-server'));
const { findChrome, loadFasta } = require(path.join(ROOT, 'tests/lib/browser'));
const { chromium } = require(path.join(ROOT, 'node_modules/playwright-core'));

// ---- the oracle (Easel semantics) ----
const GAP = new Set(['-', '.', '_']);
function residue(ch, protein) {   // canonical or degenerate: counts as a residue; gaps, * (nonresidue), ~ (missing) do not
  if (ch === undefined || GAP.has(ch) || ch === '*' || ch === '~') return false;
  return /[A-Za-z]/.test(ch);
}
function code(ch, protein) { ch = ch.toUpperCase(); return !protein && ch === 'U' ? 'T' : ch; }   // DNA: U is T
function oracle(seqs, protein) {
  const n = seqs.length, alen = Math.max(...seqs.map(s => s.length));
  const rlen = seqs.map(s => { let r = 0; for (let p = 0; p < alen; p++) if (residue(s[p], protein)) r++; return r; });
  const nres = rlen.reduce((a, b) => a + b, 0);
  const pidEsl = [], pidCols = [], nidM = [];
  let gaps = 0;
  for (let i = 0; i < n; i++) { pidEsl.push(new Array(n).fill(100)); pidCols.push(new Array(n).fill(100)); nidM.push(new Array(n).fill(0)); for (let p = 0; p < alen; p++) { const c = seqs[i][p]; if (!residue(c, protein)) gaps++; /* ViewAlign's Gaps = non-residue cells */ } }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let nid = 0, shared = 0;
    for (let p = 0; p < alen; p++) {
      const a = seqs[i][p], b = seqs[j][p];
      if (!residue(a, protein) || !residue(b, protein)) continue;
      shared++; if (code(a, protein) === code(b, protein)) nid++;
    }
    const minLen = Math.min(rlen[i], rlen[j]);
    pidEsl[i][j] = pidEsl[j][i] = minLen ? nid / minLen * 100 : 0;
    pidCols[i][j] = pidCols[j][i] = shared ? nid / shared * 100 : 0;
    nidM[i][j] = nidM[j][i] = nid;
  }
  let sum = 0, pairs = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const v = pidEsl[i][j]; sum += v; pairs++; min = Math.min(min, v); max = Math.max(max, v); }
  return { n, alen, nres, small: Math.min(...rlen), large: Math.max(...rlen), avglen: nres / n, avgid: pairs ? sum / pairs : 100, gaps, gapPct: gaps / (n * alen) * 100, pidEsl, pidCols, min, max, pairs, rlen };
}

const FIXTURES = [
  { name: 'svk_k4 (owner example)', fa: fs.readFileSync(path.join(ROOT, 'examples', 'svk_k4.fa'), 'utf8') },
  { name: 'clsat panel 116', fa: fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'clsat_panel_116.fa'), 'utf8') },
  { name: 'crafted: lower case, U, N/R, * ~ _ gaps, short row, all-gap row, identical rows, duplicate name',
    fa: '>s1\nACGTACGTACGTACGT\n>s2\nacgtacgtacgtacgt\n>s3\nACGUACGUACGUACGU\n>s4\nACGTNNGTRCGTACGT\n>s5\nACGTAC*TAC~TAC_T\n>s6\nACGTACGT\n>s7\n----------------\n>s1\nACGTACGTACGTACGT\n>s8\n--GTACGT--GTAC--\n' },
  { name: 'protein with X and *', fa: '>p1\nMKV*LLAX\n>p2\nMKVLLLAA\n>p3\nMKV-LLAX\n' },
];

(async () => {
  const { server, baseUrl } = await start();
  const b = await chromium.launch({ executablePath: findChrome(), headless: true });
  const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${baseUrl}/index.html?view=canvas`, { waitUntil: 'networkidle' });
  await page.evaluate(() => { window._copied = null; navigator.clipboard.writeText = t => { window._copied = t; return Promise.resolve(); }; });
  let bad = 0;
  for (const fx of FIXTURES) {
    await loadFasta(page, fx.fa);
    const protein = await page.evaluate(() => isProteinAlignment());
    const seqs = await page.evaluate(() => state.seqs.map(s => s.seq));   // what the viewer holds (the parser may normalise)
    const O = oracle(seqs, protein);
    await page.evaluate(() => { ['msaviewer_statsWin', 'msaviewer_statsLabels', 'msaviewer_statsHeat'].forEach(k => localStorage.removeItem(k)); openStats(); });
    await page.waitForFunction(() => state._statsData && document.querySelector('#statsSummaryTab table.stats-mx'), null, { timeout: 60000 });
    const V = await page.evaluate(() => {
      const d = state._statsData, n = d.n;
      const card = {}; document.querySelectorAll('#statsSummaryTab .stats-card tr').forEach(tr => { const k = tr.cells[0]?.textContent.trim(), v = tr.cells[1]?.textContent.trim(); if (k) card[k] = v; });
      const esl = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => d.pid.esl[i * n + j]));
      const cols = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => d.pid.cols[i * n + j]));
      return { n, card, esl, cols, identity: d.identity, distance: d.distance, combined: d.combined, mode: d.mode, counts: d.counts };
    });
    const diffs = [];
    const num = s => parseFloat(String(s).split('(')[0].replace(/[^0-9.\-]/g, ''));   // '1,795 (19.4%)' -> 1795
    const want = { 'Number of sequences': O.n, 'Alignment length': O.alen, 'Total # residues': O.nres, 'Smallest': O.small, 'Largest': O.large, 'Average length': +O.avglen.toFixed(1), 'Average identity': +O.avgid.toFixed(1), 'Gaps': O.gaps };
    for (const [k, w] of Object.entries(want)) { const got = num(V.card[k]); if (Math.abs(got - w) > 0.051) diffs.push(`${k}: shown ${V.card[k]} vs Easel ${w}`); }
    if (V.card['Gaps'] && Math.abs(parseFloat(V.card['Gaps'].split('(')[1]) - O.gapPct) > 0.051) diffs.push(`Gaps %: shown ${V.card['Gaps']} vs ${O.gapPct.toFixed(1)}`);
    if (Math.abs(num(V.card['Mean']) - +O.avgid.toFixed(1)) > 0.051) diffs.push(`Mean: ${V.card['Mean']} vs ${O.avgid.toFixed(1)}`);
    if (Math.abs(num(V.card['Min']) - +O.min.toFixed(1)) > 0.051) diffs.push(`Min: ${V.card['Min']} vs ${O.min.toFixed(1)}`);
    if (Math.abs(num(V.card['Max']) - +O.max.toFixed(1)) > 0.051) diffs.push(`Max: ${V.card['Max']} vs ${O.max.toFixed(1)}`);
    if (num(V.card['Pairs compared']) !== O.pairs) diffs.push(`Pairs: ${V.card['Pairs compared']} vs ${O.pairs}`);
    let cellDiffs = 0, colsDiffs = 0, comb = 0, first = null;
    for (let i = 0; i < O.n; i++) for (let j = 0; j < O.n; j++) {
      if (Math.abs(V.esl[i][j] - O.pidEsl[i][j]) > 1e-9) { cellDiffs++; if (!first) first = `esl[${i}][${j}] viewer ${V.esl[i][j].toFixed(2)} vs Easel ${O.pidEsl[i][j].toFixed(2)}`; }
      if (Math.abs(V.cols[i][j] - O.pidCols[i][j]) > 1e-9) colsDiffs++;
      const expect = j > i ? O.pidEsl[i][j].toFixed(1) : j < i ? (1 - O.pidEsl[i][j] / 100).toFixed(2) : '';
      if (V.mode === 'esl' && V.combined[i][j] !== expect) comb++;
    }
    if (cellDiffs) diffs.push(`${cellDiffs} esl identity cells differ (first: ${first})`);
    if (colsDiffs) diffs.push(`${colsDiffs} shared-columns identity cells differ`);
    if (comb) diffs.push(`${comb} combined-matrix cells differ from the layout (identity above, distance below, diagonal empty)`);
    // exports: TSV copy of the whole matrix equals the combined grid; CSV file equals it too
    await page.click('#statsCopyBtn'); await page.waitForTimeout(200);
    const tsv = await page.evaluate(() => (window._copied || '').trimEnd().split('\n').map(l => l.split('\t')));
    const tsvOk = tsv.length === O.n + 1 && tsv.slice(1).every((r, i) => r.slice(1).every((v, j) => v === V.combined[i][j]));
    if (!tsvOk) diffs.push('TSV copy differs from the shown matrix');
    console.log(`${diffs.length ? 'DIFF' : 'OK  '} ${fx.name}: n=${O.n} alen=${O.alen} protein=${protein} mode=${V.mode} counts=${JSON.stringify(V.counts)}`);
    diffs.forEach(d => console.log('   - ' + d));
    bad += diffs.length;
    await page.evaluate(() => document.getElementById('statsCloseBtn').click());
  }
  await b.close(); server.close();
  console.log(bad ? `\n${bad} difference(s)` : '\nno differences');
})().catch(e => { console.error(e); process.exit(1); });
