// Oracle audit, part 2: the Statistics window's exports (CSV/TSV/XLSX of the combined, identity-only and
// distance-only matrices), the pair filter for both metrics, the pair list and Save pairs, with awkward names,
// duplicate names and the two-sequence case. node stats_oracle2.js <repo>
const path = require('path');
const ROOT = process.argv[2] || path.join(__dirname, '..', '..');   // node tests/probes/stats_oracle2.js
const { start } = require(path.join(ROOT, 'tests/lib/static-server'));
const { findChrome, loadFasta } = require(path.join(ROOT, 'tests/lib/browser'));
const { chromium } = require(path.join(ROOT, 'node_modules/playwright-core'));

const FIXTURES = [
  { name: 'awkward names + duplicate name', fa: '>A&B <x> "q"\nACGTACGTACGTACGT\n>plain, with comma\nACGTACGTACGTACGA\n>plain, with comma\nACGTACGTACGTTTTT\n>tab\there\nACGTACGTACGAAAAA\n>s5\nACGTAAAAAAAAAAAA\n' },
  { name: 'two sequences', fa: '>x\nACGTACGTAC\n>y\nACGTACGTAA\n' },
];
const csvCell = v => /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
function parseCsvLine(line) {   // RFC 4180, one line (fixture has no embedded newlines)
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
const xmlUnesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function parseSheet(bytes) {
  const txt = new TextDecoder('latin1').decode(Uint8Array.from(bytes));   // stored zip: the XML is plain inside
  const m = txt.match(/<sheetData>([\s\S]*?)<\/sheetData>/); if (!m) return null;
  const cells = {};
  for (const c of m[1].matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const col = c[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1, row = +c[2] - 1;
    let v = null;
    if (c[4] != null) { const t = c[4].match(/<t[^>]*>([\s\S]*?)<\/t>/); const n = c[4].match(/<v>([\s\S]*?)<\/v>/); v = t ? { s: xmlUnesc(Buffer.from(t[1], 'latin1').toString('utf8')) } : n ? { n: parseFloat(n[1]) } : { s: '' }; }
    cells[row + ',' + col] = v;
  }
  return cells;
}

(async () => {
  const { server, baseUrl } = await start();
  const b = await chromium.launch({ executablePath: findChrome(), headless: true });
  const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${baseUrl}/index.html?view=canvas`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window._dl = [];
    window._statsDownload = (blob, name) => blob.arrayBuffer().then(buf => _dl.push({ name, bytes: Array.from(new Uint8Array(buf)) }));
    navigator.clipboard.writeText = t => { window._copied = t; return Promise.resolve(); };
  });
  let bad = 0;
  for (const fx of FIXTURES) {
    const diffs = [];
    await loadFasta(page, fx.fa);
    await page.evaluate(() => { ['msaviewer_statsLabels', 'msaviewer_statsHeat'].forEach(k => localStorage.removeItem(k)); openStats(); });
    await page.waitForFunction(() => state._statsData && document.querySelector('#statsSummaryTab table.stats-mx'), null, { timeout: 60000 });
    const D = await page.evaluate(() => { const d = state._statsData; return { n: d.n, names: d.names, identity: d.identity, distance: d.distance, combined: d.combined, pid: Array.from(d.pid[d.mode]), views: [...document.querySelectorAll('#statsSummaryTab .stats-view button')].map(b => b.dataset.view), saves: [...document.querySelectorAll('.stats-save')].map(b => [b.dataset.fmt, b.dataset.kind || '']) }; });
    const n = D.n, pid = (i, j) => D.pid[i * n + j];
    // the strings
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (D.identity[i][j] !== pid(i, j).toFixed(1)) diffs.push(`identity[${i}][${j}] ${D.identity[i][j]}`);
      if (D.distance[i][j] !== (i === j ? 0 : 1 - pid(i, j) / 100).toFixed(2)) diffs.push(`distance[${i}][${j}] ${D.distance[i][j]}`);
    }
    // every save entry: CSV/TSV parse back to the grid; XLSX cells match
    for (const [fmt, kind] of D.saves) {
      await page.evaluate(([fmt, kind]) => { _dl.length = 0; saveStatsMatrix(fmt, kind || undefined); }, [fmt, kind]);
      await page.waitForFunction(() => _dl.length === 1, null, { timeout: 5000 });
      const f = await page.evaluate(() => _dl[0]);
      const k = kind || 'combined', grid = [[''].concat(D.names)].concat(D[k].map((r, i) => [D.names[i]].concat(r)));
      const tag = `${fmt}${kind ? ':' + kind : ''} (${f.name})`;
      if (!new RegExp((kind === 'identity' ? '_identity' : kind === 'distance' ? '_distance' : '_matrix') + '\\.' + fmt + '$').test(f.name)) diffs.push(`${tag}: file name`);
      if (fmt === 'xlsx') {
        const cells = parseSheet(f.bytes);
        if (!cells) { diffs.push(`${tag}: no sheetData`); continue; }
        let wrong = 0, first = null;
        for (let i = 0; i < grid.length; i++) for (let j = 0; j < grid[0].length; j++) {
          const want = grid[i][j], got = cells[i + ',' + j];
          const ok = (i === 0 || j === 0) ? (got && got.s === want) || (want === '' && (!got || got.s === '')) : want === '' ? (!got || got.s === '' || got.n === undefined && !got.s) : got && got.n !== undefined && Math.abs(got.n - parseFloat(want)) < 1e-9;
          if (!ok) { wrong++; if (!first) first = `r${i}c${j} want ${JSON.stringify(want)} got ${JSON.stringify(got)}`; }
        }
        if (wrong) diffs.push(`${tag}: ${wrong} cells differ (${first})`);
        const txt = new TextDecoder('latin1').decode(Uint8Array.from(f.bytes));
        if (!/<sheet name="/.test(txt) || !/<pane /.test(txt)) diffs.push(`${tag}: sheet name or frozen pane missing`);
      } else {
        const text = Buffer.from(f.bytes).toString('utf8').replace(/^﻿/, '');
        const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
        const rows = lines.map(l => fmt === 'csv' ? parseCsvLine(l) : l.split('\t'));
        const same = rows.length === grid.length && rows.every((r, i) => r.length === grid[0].length && r.every((v, j) => v === grid[i][j]));
        if (!same) diffs.push(`${tag}: parsed table differs from the grid (rows ${rows.length} vs ${grid.length}; first row ${JSON.stringify(rows[0]).slice(0, 120)})`);
        if (fmt === 'tsv' && D.names.some(nm => /\t/.test(nm)) && rows[0].length === grid[0].length) diffs.push(`${tag}: a name with a tab survived unchanged in a TSV (ambiguous columns)`);
      }
    }
    // Copy = combined grid as TSV
    await page.evaluate(() => { window._copied = null; copyStatsMatrix(); });
    await page.waitForTimeout(200);
    const copied = await page.evaluate(() => window._copied);
    const cgrid = [[''].concat(D.names)].concat(D.combined.map((r, i) => [D.names[i]].concat(r)));
    const crow = copied ? copied.replace(/\n$/, '').split('\n').map(l => l.split('\t')) : [];
    if (!(crow.length === cgrid.length && crow.every((r, i) => r.join('\t') === cgrid[i].join('\t')))) diffs.push(`Copy differs from the combined grid${D.names.some(nm => /\t/.test(nm)) ? ' (a name holds a tab)' : ''}`);
    // the pair filter, both metrics, both operators, vs the oracle over the same pid values
    const thresholds = [['identity', 'ge', 90], ['identity', 'le', 80], ['distance', 'le', 0.1], ['distance', 'ge', 0.2]];
    for (const [kind, op, value] of thresholds) {
      const r = await page.evaluate(([kind, op, value]) => {
        document.getElementById('statsFilterKind').value = kind; document.getElementById('statsFilterKind').dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('statsFilterOp').value = op; document.getElementById('statsFilterOp').dispatchEvent(new Event('change', { bubbles: true }));
        const v = document.getElementById('statsFilterValue'); v.value = String(value); v.dispatchEvent(new Event('input', { bubbles: true }));
        return new Promise(res => setTimeout(() => res({ count: document.getElementById('statsFilterCount').textContent, hits: (state._statsHits || []).map(h => [h[0], h[1]]), filter: state._statsFilter }), 500));
      }, [kind, op, value]);
      let want = 0; const seqs = new Set();
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const x = kind === 'identity' ? pid(i, j) : 1 - pid(i, j) / 100;
        const hit = op === 'ge' ? x >= value - 1e-9 : x <= value + 1e-9;
        if (hit) { want++; seqs.add(i); seqs.add(j); }
      }
      const got = parseInt(r.count) || 0;
      if (got !== want || r.hits.length !== want) diffs.push(`filter ${kind} ${op} ${value}: shown "${r.count}", hits ${r.hits.length}, oracle ${want} pairs / ${seqs.size} sequences`);
      else if (want && !new RegExp(`${want} pairs? · ${seqs.size} sequences?`).test(r.count)) diffs.push(`filter ${kind} ${op} ${value}: count text "${r.count}" vs ${want}/${seqs.size}`);
      // pair list and Save pairs on the first threshold with hits
      if (want && kind === 'identity' && op === 'ge') {
        const pl = await page.evaluate(() => { const v = [...document.querySelectorAll('#statsSummaryTab .stats-view button')].map(b => b.dataset.view).find(x => x !== 'matrix'); _statsSetView(v); const rows = [...document.querySelectorAll('#statsSummaryTab table.stats-pairs tbody tr')].map(tr => [...tr.cells].map(td => td.textContent)); _statsSetView('matrix'); return rows; });
        if (pl.length !== want) diffs.push(`pair list shows ${pl.length} rows, filter has ${want}`);
        else for (const row of pl) { const i = D.names.indexOf(row[1]), j = D.names.indexOf(row[2]); if (i < 0 || j < 0) { diffs.push(`pair list names not found: ${row[1]} / ${row[2]}`); break; } }
        await page.evaluate(() => { _dl.length = 0; _statsSavePairs('pairs'); _statsSavePairs('names'); _statsSavePairs('fasta'); _statsSavePairs('fasta-raw'); });
        await page.waitForFunction(() => _dl.length === 4, null, { timeout: 5000 });
        const files = await page.evaluate(() => _dl.map(f => ({ name: f.name, text: new TextDecoder().decode(Uint8Array.from(f.bytes)) })));
        const pairs = files.find(f => /_pairs_id_ge90\.tsv$/.test(f.name)); if (!pairs) diffs.push(`Save pairs: table file name (${files.map(f => f.name)})`);
        else { const rows = pairs.text.replace(/\r\n/g, '\n').trim().split('\n'); if (rows.length !== want + 1 || !/^sequence_1\tsequence_2\tidentity_pct_over_shorter_seq\tdistance$/.test(rows[0])) diffs.push(`Save pairs table: ${rows.length - 1} rows (filter ${want}), header ${JSON.stringify(rows[0])}`); }
        const names = files.find(f => /_names\.txt$/.test(f.name)); if (!names || names.text.trim().split('\n').length !== seqs.size) diffs.push(`Save pairs names: ${names && names.text.trim().split('\n').length} vs ${seqs.size}`);
        const fa = files.find(f => /_aligned\.fasta$/.test(f.name)), raw = files.find(f => /_ungapped\.fasta$/.test(f.name));
        if (!fa || (fa.text.match(/^>/gm) || []).length !== seqs.size) diffs.push('Save pairs aligned FASTA: record count');
        if (!raw || /[-.]/.test(raw.text.split('\n').filter(l => l && l[0] !== '>').join(''))) diffs.push('Save pairs ungapped FASTA still has gaps');
      }
    }
    await page.evaluate(() => { const v = document.getElementById('statsFilterValue'); v.value = ''; v.dispatchEvent(new Event('input', { bubbles: true })); });
    console.log(`${diffs.length ? 'DIFF' : 'OK  '} ${fx.name}: n=${n} saves=${JSON.stringify(D.saves)}`);
    diffs.forEach(d => console.log('   - ' + d));
    bad += diffs.length;
    await page.evaluate(() => document.getElementById('statsCloseBtn').click());
  }
  await b.close(); server.close();
  console.log(bad ? `\n${bad} difference(s)` : '\nno differences');
})().catch(e => { console.error(e); process.exit(1); });
