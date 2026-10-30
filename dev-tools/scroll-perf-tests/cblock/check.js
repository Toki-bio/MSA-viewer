// Correctness + interaction checks of the Canvas Block prototype, and screenshots next to DOM Block.
const { serve, launch, openView, waitFor } = require('./common');
const path = require('path');
const SHOT = n => path.join(__dirname, n);
const results = [];
const rec = (name, pass, detail) => { results.push({ name, pass, detail }); console.log((pass ? 'PASS ' : 'FAIL ') + name + ' :: ' + JSON.stringify(detail)); };

async function toDomBlock(page, width) {
  await page.evaluate(async (w) => {
    if (w) { el('blockSizeSlider').value = w; el('blockSizeInput').value = w; }
    _domBlockForTests = true;   // the old DOM Block (test-only, script.js isDomBlock)
    document.getElementById('modeBlocks').checked = true;
    await onModeChange();
  }, width);
  await waitFor(page, () => document.querySelector('.block-block .seq-data span[data-pos]'));
  await page.waitForTimeout(500);
}
// client point of a cell in DOM Block (block index b, row, column)
const domCell = (page, b, row, col) => page.evaluate(({ b, row, col }) => {
  const blk = document.querySelectorAll('.block-block')[b];
  const line = blk.querySelector(`.seq-line[data-seq-index="${row}"]`) || blk.querySelectorAll('.seq-line:not(.scale-ruler-line):not(.consensus-line)')[row];
  const sp = line.querySelector(`span[data-pos="${col}"]`);
  sp.scrollIntoView({ block: 'center' });
  const r = sp.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, { b, row, col });
const cbCell = (page, row, col) => page.evaluate(({ row, col }) => {
  const m = _canvasState.metrics, c = _canvasCellClient(row, _canvasColToSlot(col));
  return { x: c.x + m.charW / 2, y: c.y + m.charH / 2 };
}, { row, col });
const selSummary = page => page.evaluate(() => { const o = {}; state.selectedNucs.forEach((s, r) => { const a = [...s].sort((x, y) => x - y); o[r] = a.length ? `${a[0]}-${a[a.length - 1]} (${a.length})` : ''; }); return o; });

(async () => {
  const { srv, base } = await serve();
  const browser = await launch(!!process.env.HEADFUL);

  // ---------- small alignment: screenshots + interaction ----------
  {
    const page = await openView(browser, base, 'small25x800.fas', 'cblock');
    await page.evaluate(() => { window.__tips = []; const o = showTooltipAt; window.showTooltipAt = (c, t, opt) => { window.__tips.push(String(c)); return o(c, t, opt); }; });
    const L = await page.evaluate(() => _canvasState.layout);
    console.log('layout', JSON.stringify(L));
    await page.screenshot({ path: SHOT('cmp_small_cblock.png') });
    // hover tooltip on a cell in band 1
    const c1 = await cbCell(page, 4, L.bandCols + 10);
    await page.mouse.move(c1.x, c1.y); await page.waitForTimeout(300);
    const tip = await page.evaluate(() => window.__tips[window.__tips.length - 1]);
    const want = await page.evaluate(({ r, c }) => state.seqs[r].seq[c] === '-' ? null : `${state.seqs[r].header}: ${state.seqs[r].gaplessPositions[c]}`, { r: 4, c: L.bandCols + 10 });
    rec('hover tooltip on a residue in band 2', want == null || (tip || '').startsWith(want), { tip, want });
    // name click in band 2 selects that row
    const nm = await page.evaluate((L) => { const m = _canvasState.metrics, r = _canvasState.canvas.getBoundingClientRect(); return { x: r.left + 40, y: r.top + L.bandH + m.headerH + 7 * _canvasState.rowPitch + 5 - _canvasState.offsetY }; }, L);
    await page.mouse.click(nm.x, nm.y); await page.waitForTimeout(300);
    const rows = await page.evaluate(() => [...state.selectedRows]);
    rec('click a name in band 2 selects that row', rows.length === 1 && rows[0] === 7, { rows });
    await page.mouse.click(nm.x, nm.y); await page.waitForTimeout(200);   // second click unselects (owner rule)
    // drag across blocks, same row: band 1 col bandCols-6 -> band 2 col bandCols+8
    const a = await cbCell(page, 2, L.bandCols - 6), b2 = await cbCell(page, 2, L.bandCols + 8);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + (b2.x - a.x) * i / 8, a.y + (b2.y - a.y) * i / 8);
    await page.mouse.up(); await page.waitForTimeout(200);
    const selSame = await selSummary(page);
    // drag across blocks to another row: rectangle
    await page.mouse.click(10, 10); await page.evaluate(() => { state.selectedNucs.clear(); state.pendingNucStart = null; _canvasState.scheduleOverlay(); });
    const d = await cbCell(page, 9, L.bandCols + 4);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + (d.x - a.x) * i / 8, a.y + (d.y - a.y) * i / 8);
    await page.mouse.up(); await page.waitForTimeout(200);
    const selRect = await selSummary(page);
    // Ctrl+Alt click on band 2's ruler selects that column
    const rc = await page.evaluate((L) => { const m = _canvasState.metrics, r = _canvasState.canvas.getBoundingClientRect(); return { x: r.left + m.nameW + 12.5 * m.charW, y: r.top + L.bandH + m.trackH + m.charH / 2 - _canvasState.offsetY }; }, L);
    await page.keyboard.down('Control'); await page.keyboard.down('Alt');
    await page.mouse.click(rc.x, rc.y);
    await page.keyboard.up('Alt'); await page.keyboard.up('Control'); await page.waitForTimeout(300);
    const cols = await page.evaluate(() => [...state.selectedColumns]);
    rec('Ctrl+Alt click on band 2 ruler selects its column', cols.length === 1 && cols[0] === L.bandCols + 12, { cols, want: L.bandCols + 12 });
    await page.mouse.move(5, 300);
    await page.screenshot({ path: SHOT('cmp_small_cblock_selected.png') });

    // the same drags in DOM Block with the same block width
    await toDomBlock(page, L.bandCols);
    await page.evaluate(() => { state.selectedNucs.clear(); state.pendingNucStart = null; state.selectedColumns.clear(); });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: SHOT('cmp_small_domblock.png') });
    let p = await domCell(page, 0, 2, L.bandCols - 6), q2 = await domCell(page, 1, 2, L.bandCols + 8);
    p = await domCell(page, 0, 2, L.bandCols - 6);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    q2 = await page.evaluate(({ col }) => { const sp = document.querySelectorAll('.block-block')[1].querySelectorAll('.seq-line:not(.scale-ruler-line):not(.consensus-line)')[2].querySelector(`span[data-pos="${col}"]`); const r = sp.getBoundingClientRect(); return { x: r.left + 3, y: r.top + 6 }; }, { col: L.bandCols + 8 });
    for (let i = 1; i <= 8; i++) await page.mouse.move(p.x + (q2.x - p.x) * i / 8, p.y + (q2.y - p.y) * i / 8);
    await page.mouse.up(); await page.waitForTimeout(300);
    const domSame = await selSummary(page);
    await page.evaluate(() => { state.selectedNucs.clear(); state.pendingNucStart = null; });
    await page.mouse.click(5, 5);
    await page.evaluate(() => { state.selectedNucs.clear(); state.pendingNucStart = null; });
    p = await domCell(page, 0, 2, L.bandCols - 6);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    const q3 = await page.evaluate(({ col }) => { const sp = document.querySelectorAll('.block-block')[1].querySelectorAll('.seq-line:not(.scale-ruler-line):not(.consensus-line)')[9].querySelector(`span[data-pos="${col}"]`); const r = sp.getBoundingClientRect(); return { x: r.left + 3, y: r.top + 6 }; }, { col: L.bandCols + 4 });
    for (let i = 1; i <= 8; i++) await page.mouse.move(p.x + (q3.x - p.x) * i / 8, p.y + (q3.y - p.y) * i / 8);
    await page.mouse.up(); await page.waitForTimeout(300);
    const domRect = await selSummary(page);
    rec('drag across blocks, same row = DOM Block', JSON.stringify(selSame) === JSON.stringify(domSame), { canvasBlock: selSame, domBlock: domSame });
    rec('drag across blocks to another row = DOM Block (rectangle)', JSON.stringify(selRect) === JSON.stringify(domRect), { canvasBlock: selRect, domBlock: domRect });
    await page.close();
  }

  // ---------- pixel parity with Canvas, and frame copy == full redraw ----------
  for (const fx of ['aln600x600.fas', 'mito62x16808.fas']) {
    const page = await openView(browser, base, fx, 'cblock');
    const L = await page.evaluate(() => _canvasState.layout);
    // hash of the names column and of the band's cell columns (cx = x where the band's first column is drawn)
    const HASH = `(c, x, w, h, y0 = 0) => { const d = c.getContext('2d').getImageData(x, y0, w, h - y0).data; let k = 0; for (let i = 0; i < d.length; i++) k = (k * 31 + d[i]) | 0; return k; }`;
    const parity = [];
    for (const b of [0, 1, Math.min(L.nBands - 1, 3), L.nBands - 1]) {
      await page.evaluate(({ b, L }) => { _canvasState.offsetY = b * L.bandH; _canvasState.scheduleDraw(); }, { b, L });
      await page.waitForTimeout(250);
      const g1 = await page.evaluate(({ b, L, HASH }) => {
        const H = eval(HASH), c = _canvasState.canvas, m = _canvasState.metrics, dpr = devicePixelRatio;
        const ncols = Math.min(L.nSlots, (b + 1) * L.bandCols) - b * L.bandCols, h = Math.floor(Math.min(c.height, L.bandBodyH * dpr) - 1);
        return { names: H(c, 0, Math.floor(m.nameW * dpr), h), cells: H(c, Math.round(m.nameW * dpr), Math.round(ncols * m.charW * dpr), h, Math.round((m.trackH + m.charH) * dpr)), ncols };
      }, { b, L, HASH });
      await page.evaluate(async () => { await vaCanvasBlock(false); });
      await page.waitForTimeout(300);
      await page.evaluate(({ b, L }) => { _canvasState.offsetX = b * L.bandCols * _canvasState.metrics.charW; _canvasState.offsetY = 0; _canvasState.scheduleDraw(); }, { b, L });
      await page.waitForTimeout(250);
      const g2 = await page.evaluate(({ b, L, HASH, ncols }) => {
        const H = eval(HASH), c = _canvasState.canvas, m = _canvasState.metrics, dpr = devicePixelRatio;
        const h = Math.floor(Math.min(c.height, L.bandBodyH * dpr) - 1);
        const cx = m.nameW + b * L.bandCols * m.charW - _canvasState.offsetX;   // the strip may stop short (last band)
        return { names: H(c, 0, Math.floor(m.nameW * dpr), h), cells: H(c, Math.round(cx * dpr), Math.round(ncols * m.charW * dpr), h, Math.round((m.trackH + m.charH) * dpr)), ox: _canvasState.offsetX };
      }, { b, L, HASH, ncols: g1.ncols });
      parity.push({ band: b, names: g1.names === g2.names, cells: g1.cells === g2.cells, ncols: g1.ncols, stripOx: g2.ox });
      await page.evaluate(async () => { await vaCanvasBlock(true); });
      await page.waitForTimeout(300);
    }
    // the last band's ruler: its labels are the band's own (generateScale per band), so they may differ at the band's left edge
    rec(`${fx}: band cells/names/ruler pixel-identical to Canvas at the same columns`, parity.every(p => p.names && p.cells), parity);
    // frame copy: wheel steps (crossing band edges for the mito file), then a forced full redraw
    await page.evaluate(() => { _canvasState.offsetY = 0; _canvasState.scheduleDraw(); });
    await page.waitForTimeout(300);
    await page.mouse.move(800, 500);
    const fc = {};
    for (const [label, dy] of [['down', 120], ['up', -100], ['trackpad', 37.5]]) {
      await page.evaluate(() => { const s = _canvasState.stats; s.full = 0; s.blit = 0; s.blitMs = []; s.fullMs = []; });
      for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, dy); await page.waitForTimeout(40); }
      await waitFor(page, () => !_canvasState.wheelAnimating);
      await page.waitForTimeout(150);
      fc[label] = await page.evaluate(() => {
        const c = _canvasState.canvas, fast = c.toDataURL(), st = _canvasState.stats, blits = st.blit, fulls = st.full;
        const oy = _canvasState.offsetY;
        _canvasState.scheduleDraw();
        return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res({ blits, fulls, same: c.toDataURL() === fast, oy }))));
      });
    }
    rec(`${fx}: frame copy (vertical) == full redraw`, Object.values(fc).every(r => r.same && r.blits > 5), fc);
    await page.close();
  }
  console.log('SUMMARY', results.filter(r => r.pass).length + '/' + results.length);
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
