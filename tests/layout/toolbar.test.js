// Toolbar layout: in every toolbar state (plain, Canvas, codon analysis, reads)
// and at common window sizes, no two toolbar items overlap, none extends past
// the window, and no button or label wraps onto a second line.
//
//   node tests/layout/toolbar.test.js
const path = require('path');
const { start } = require('../lib/static-server');
const { findChrome } = require('../lib/browser');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..', '..');

const SCAN = () => {
  const out = [];
  const vw = document.documentElement.clientWidth;
  const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const name = e => (e.id || e.className || e.tagName).toString().split(' ')[0] + ` "${(e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)}"`;
  // the items laid out side by side: row children, and the menus inside the menu group
  const items = [];
  for (const row of document.querySelectorAll('#controls > .control-row')) {
    for (const c of row.children) {
      if (!visible(c)) continue;
      if (c.classList.contains('standard-menu-group')) {
        for (const m of c.children) if (visible(m)) items.push(m.querySelector(':scope > .section-header') || m);
      } else items.push(c);
    }
  }
  const rects = items.map(e => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width > 0 && r.height > 0);
  for (let i = 0; i < rects.length; i++) {
    const [a, ra] = rects[i];
    if (ra.right > vw + 1 || ra.left < -1) out.push(`${name(a)} outside the window (${Math.round(ra.left)}-${Math.round(ra.right)}, window ${vw})`);
    for (let j = i + 1; j < rects.length; j++) {
      const [b, rb] = rects[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 1 && oy > 1) out.push(`${name(a)} overlaps ${name(b)} by ${Math.round(ox)}px`);
    }
  }
  // text clipped or wrapped onto a second line
  for (const e of document.querySelectorAll('#controls > .control-row button, #controls > .control-row label, #controls > .control-row .section-header, #controls > .control-row span')) {
    if (!visible(e) || e.closest('.control-group')) continue;
    const r = e.getBoundingClientRect();
    if (r.height > 26) out.push(`${name(e)} wraps (${Math.round(r.height)}px tall)`);
  }
  const info = document.getElementById('sourceInfo');
  if (info && info.scrollWidth > info.clientWidth + 2) out.push(`file info cut off ("${info.textContent.trim().slice(0, 40)}")`);
  return out;
};

(async () => {
  const { server, baseUrl } = await start();
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const problems = [];
  for (const [w, h] of [[1920, 1080], [1536, 864], [1366, 768], [1280, 720]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(baseUrl + '/index.html?view=block', { waitUntil: 'networkidle' });
    const open = async rel => { await page.setInputFiles('#fileInput', path.join(ROOT, rel)); await page.waitForTimeout(1500); };
    const scan = async state => (await page.evaluate(SCAN)).forEach(p => problems.push(`${w}x${h} ${state}: ${p}`));
    const setMode = id => page.evaluate(id => { document.getElementById(id).checked = true; onModeChange(); }, id);

    await scan('empty page');
    await open('examples/synthetic/synth_msa.fa');
    await scan('alignment');
    await setMode('modeCanvas'); await page.waitForTimeout(800);
    await scan('Canvas');
    // the view switch stays on the menu line from 1536 px up (Arial headers at a 10 px gap pushed it onto a line of its
    // own; the owner accepted a second line at 1280-1366 for the aa | Aa | AA switch on the mode row, 2026-10-23)
    if (w >= 1536) {
      const split = await page.evaluate(() => { const m = document.querySelector('#menuRow .standard-menu-group').getBoundingClientRect(), v = document.getElementById('modeRow').getBoundingClientRect(); return Math.abs((m.top + m.bottom) / 2 - (v.top + v.bottom) / 2) > 6; });
      if (split) problems.push(`${w}x${h} Canvas: the view switch is on a second line`);
    }
    await setMode('modeBlocks'); await page.waitForTimeout(500);
    await page.evaluate(() => document.getElementById('codonAnalysis').click()); await page.waitForTimeout(800);
    const codonShown = await page.evaluate(() => !!document.getElementById('codonModePanel').getClientRects().length);
    if (!codonShown) problems.push(`${w}x${h}: codon frame bar not shown in codon mode`);
    await scan('codon analysis');
    await page.evaluate(() => document.getElementById('codonAnalysis').click()); await page.waitForTimeout(500);
    await open('examples/real/htslib_ce_CHROMOSOME_II.fa');
    await open('examples/real/htslib_range.bam'); await page.waitForTimeout(500);
    const readsShown = await page.evaluate(() => !!document.getElementById('clearReadsButton')?.getClientRects().length);
    if (!readsShown) problems.push(`${w}x${h}: Clear reads not shown in reads mode`);
    await scan('reads');
    if (errors.length) problems.push(`${w}x${h}: page errors: ${errors.join('; ')}`);
    await page.close();
  }
  // A page opened straight in Canvas (the default view), as a user opens it: at 1280 px, and at 1366 px with a row
  // selected (the selection adds toolbar items), the toolbar is at most two lines (the mode row with the view and
  // case switches may take a line of its own there: owner's decision 2026-10-23); Arial headers with the serif's
  // spacing had made it two lines even without the case switch, and nothing may make it three.
  for (const [w, h, sel] of [[1280, 720, false], [1366, 700, true]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(baseUrl + '/index.html?view=canvas', { waitUntil: 'networkidle' });
    await page.setInputFiles('#fileInput', path.join(ROOT, 'examples/synthetic/synth_msa.fa')); await page.waitForTimeout(1500);
    if (sel) { await page.evaluate(() => { state.selectedRows = new Set([1]); updateRowSelections(); }); await page.waitForTimeout(400); }
    const ht = await page.evaluate(() => Math.round(document.getElementById('controls').getBoundingClientRect().height));
    if (ht > 62) problems.push(`${w}x${h} opened in Canvas${sel ? ', row selected' : ''}: the toolbar takes three lines (${ht}px)`);
    await page.close();
  }
  await browser.close(); server.close();
  if (problems.length) { console.log(problems.map(p => 'FAIL ' + p).join('\n')); console.log(`\n${problems.length} problem(s)`); process.exit(1); }
  console.log('PASS toolbar: no overlaps, nothing off-screen or wrapped, in 5 states at 4 window sizes');
})().catch(e => { console.error(e); process.exit(1); });
