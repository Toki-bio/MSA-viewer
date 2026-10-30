// Selection drag across blocks: DOM Block vs Canvas Block, 25 x 800 (two blocks on screen), 20 moves at 16 ms
const { serve, launch, openView, waitFor, q } = require('./common');
(async () => {
  const { srv, base } = await serve();
  const browser = await launch(false);
  for (const mode of ['block', 'cblock']) {
    const page = await openView(browser, base, process.argv[2] || 'small25x800.fas', 'cblock');
    if (mode === 'block') {
      await page.evaluate(async () => { el('blockSizeSlider').value = _canvasState.layout.bandCols; _canvasBlockLayout = false; document.getElementById('modeBlocks').checked = true; await onModeChange(); });
      await waitFor(page, () => document.querySelector('.block-block .seq-data span[data-pos]')); await page.waitForTimeout(800);
    }
    const res = [];
    for (let rep = 0; rep < 5; rep++) {
      const pts = await page.evaluate((mode) => {
        state.selectedNucs.clear(); state.pendingNucStart = null;
        const bw = +el('blockSizeSlider').value, c0 = bw - 6, c1 = bw + 8;
        if (mode === 'cblock') { const m = _canvasState.metrics; const P = (r, c) => { const k = _canvasCellClient(r, c); return { x: k.x + m.charW / 2, y: k.y + m.charH / 2 }; }; return { a: P(2, c0), b: P(7, c1) }; }
        const blks = document.querySelectorAll('.block-block'); const sp = (b, r, c) => blks[b].querySelectorAll('.seq-line:not(.scale-ruler-line):not(.consensus-line)')[r].querySelector(`span[data-pos="${c}"]`);
        const ra = sp(0, 2, c0).getBoundingClientRect(), rb = sp(1, 7, c1).getBoundingClientRect();
        return { a: { x: ra.left + ra.width / 2, y: ra.top + ra.height / 2 }, b: { x: rb.left + rb.width / 2, y: rb.top + rb.height / 2 } };
      }, mode);
      await page.mouse.click(5, 5); await page.waitForTimeout(200);
      await page.evaluate(() => { state.selectedNucs.clear(); state.pendingNucStart = null; window.__ts = []; window.__on = true; const l = t => { if (window.__on) { window.__ts.push(t); requestAnimationFrame(l); } }; requestAnimationFrame(l); });
      await page.mouse.move(pts.a.x, pts.a.y); await page.mouse.down();
      const t0 = Date.now();
      for (let i = 1; i <= 20; i++) { await page.mouse.move(pts.a.x + (pts.b.x - pts.a.x) * i / 20, pts.a.y + (pts.b.y - pts.a.y) * i / 20); await page.waitForTimeout(16); }
      await page.mouse.up(); const wall = Date.now() - t0; await page.waitForTimeout(150);
      const r = await page.evaluate(() => { window.__on = false; const d = []; for (let i = 1; i < __ts.length; i++) d.push(__ts[i] - __ts[i - 1]); let n = 0; state.selectedNucs.forEach(s => n += s.size); return { d, n }; });
      res.push({ wall, p95: q(r.d, 0.95), max: Math.max(...r.d), cells: r.n });
    }
    console.log(mode, JSON.stringify(res));
    await page.close();
  }
  await browser.close(); srv.close();
})();
