// Scroll smoothness and costs: DOM Block vs Canvas (strip) vs Canvas Block prototype.
//   node measure.js <fixture.fas> [modes=block,canvas,cblock]   (HEADFUL=1 for a visible browser)
// 1600x900 viewport, app default zoom; 60 wheel steps of 120 px at 16 ms cadence (as the 2026-10-16 study).
const { serve, waitFor, q } = require('./common');
const { chromium } = require('playwright-core');
const FX = process.argv[2] || 'aln600x600.fas';
const MODES = (process.argv[3] || 'block,canvas,cblock').split(',');
const HEADFUL = !!process.env.HEADFUL;
(async () => {
  const { srv, base } = await serve();
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: !HEADFUL,
    args: ['--enable-gpu-rasterization', '--enable-features=LongAnimationFrameMonitoring', '--js-flags=--expose-gc'] });
  const out = [];
  for (const mode of MODES) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    await page.addInitScript(() => {
      window.showLargeAlignmentDialog = async () => 'proceed';
      window.__firstFrame = null;
      const tick = () => { if (window.__firstFrame == null && typeof _canvasState !== 'undefined' && _canvasState.stats && _canvasState.stats.full > 0) window.__firstFrame = performance.now(); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    // canvas / cblock open directly (time to first frame); DOM Block opens via Canvas, then switches
    const view = mode === 'cblock' ? 'cblock' : 'canvas';
    await page.goto(`${base}/index.html?url=${encodeURIComponent('/fx/' + FX)}&title=t&view=${view}`, { waitUntil: 'load' });
    await waitFor(page, () => typeof state !== 'undefined' && state.seqs && state.seqs.length > 0 && window.__firstFrame != null, null, 180000);
    const ttff = await page.evaluate(() => window.__firstFrame);
    await waitFor(page, () => !!(state.conservationDataCache && state.conservationDataCache.data), null, 120000).catch(() => {});
    await page.waitForTimeout(1500);
    const dims = await page.evaluate(() => [state.seqs.length, state.seqs[0].seq.length]);
    // switch cost: into DOM Block (from Canvas), into Canvas Block (from Canvas strip), Canvas strip re-render
    const switchMs = await page.evaluate(async (mode) => {
      window.showLargeAlignmentDialog = async () => 'proceed';
      const t0 = performance.now();
      if (mode === 'block') { _domBlockForTests = true; document.getElementById('modeBlocks').checked = true; await onModeChange(); }
      else if (mode === 'cblock') { await vaCanvasBlock(false); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const t1 = performance.now(); await vaCanvasBlock(true); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t1; }
      else { await vaCanvasBlock(true); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const t1 = performance.now(); await vaCanvasBlock(false); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t1; }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t0;
    }, mode);
    if (mode === 'block') await waitFor(page, () => document.querySelector('.block-block .seq-data span[data-pos]'), null, 180000);
    await page.waitForTimeout(1500);
    const mem = await page.evaluate(() => { try { gc(); } catch (e) {} return { heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), domNodes: document.getElementsByTagName('*').length }; });
    const info = await page.evaluate(() => ({ blockWidth: +el('blockSizeSlider').value, layout: _canvasState.layout, isCanvas: !!document.getElementById('alignmentCanvas') }));
    await page.evaluate(() => {
      window.__f = { ts: [], loaf: [], on: false };
      const loop = t => { if (window.__f.on) window.__f.ts.push(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
      try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (window.__f.on) window.__f.loaf.push(e.duration); }).observe({ type: 'long-animation-frame', buffered: false }); } catch (e) {}
    });
    const cdp = await page.context().newCDPSession(page);
    const box = await page.evaluate(() => { const r = document.getElementById('alignmentContainer').getBoundingClientRect(); return { x: r.left + Math.min(r.width, innerWidth - r.left) * 0.6, y: r.top + (Math.min(r.bottom, innerHeight) - r.top) * 0.5 }; });
    const pos = () => page.evaluate(() => { if (document.getElementById('alignmentCanvas')) return [_canvasState.offsetX, _canvasState.offsetY]; const c = document.getElementById('alignmentContainer'), d = document.scrollingElement; return [c.scrollLeft + d.scrollLeft, c.scrollTop + d.scrollTop]; });
    async function run(label, dx, dy, n = 60) {
      const p0 = await pos();
      await page.evaluate(() => { window.__f.ts = []; window.__f.loaf = []; window.__f.on = true; if (typeof _canvasState !== 'undefined' && _canvasState.stats) { const s = _canvasState.stats; s.full = 0; s.blit = 0; s.blitMs = []; s.fullMs = []; window.__allBlit = []; const ob = s.blitMs; } });
      // collect every copy-frame time (stats keep only the last 64)
      await page.evaluate(() => { if (typeof _canvasState === 'undefined' || !_canvasState.stats) return; const s = _canvasState.stats; const push = s.blitMs.push.bind(s.blitMs); window.__allBlit = []; s.blitMs.push = (v) => { window.__allBlit.push(v); return push(v); }; });
      const t0 = Date.now();
      for (let i = 0; i < n; i++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: dx, deltaY: dy });
        const w = t0 + (i + 1) * 16 - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w));
      }
      await page.waitForTimeout(400);
      const f = await page.evaluate(() => { window.__f.on = false; const st = (typeof _canvasState !== 'undefined' && document.getElementById('alignmentCanvas')) ? { blit: _canvasState.stats.blit, full: _canvasState.stats.full, blitMs: window.__allBlit || [], fullMs: _canvasState.stats.fullMs.slice() } : null; return { ts: window.__f.ts, loaf: window.__f.loaf, st }; });
      const p1 = await pos();
      const d = []; for (let i = 1; i < f.ts.length; i++) d.push(f.ts[i] - f.ts[i - 1]);
      const r = { fx: FX, mode, label, frames: d.length, p50: +q(d, 0.5).toFixed(1), p95: +q(d, 0.95).toFixed(1), max: +Math.max(0, ...d).toFixed(1), over34: d.filter(x => x > 34).length,
        loaf: f.loaf.length, loafMax: +Math.max(0, ...f.loaf).toFixed(0), moved: [p1[0] - p0[0], p1[1] - p0[1]] };
      if (f.st) Object.assign(r, { copies: f.st.blit, fulls: f.st.full, copyP95: +q(f.st.blitMs, 0.95).toFixed(2), copyMax: +Math.max(0, ...f.st.blitMs).toFixed(2), fullMed: +q(f.st.fullMs, 0.5).toFixed(1) });
      console.log(JSON.stringify(r)); out.push(r);
    }
    await page.mouse.move(box.x, box.y);
    await run('down', 0, 120); await run('up', 0, -120);
    if (mode === 'canvas') { await run('right', 120, 0); await run('left', -120, 0); }
    // full redraw of a whole view (Canvas modes)
    const fullDraw = await page.evaluate(async () => { if (!document.getElementById('alignmentCanvas')) return null; const a = []; for (let i = 0; i < 8; i++) { _canvasState.scheduleDraw(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); a.push(_canvasState.stats.lastDrawMs); } a.sort((x, y) => x - y); return +a[4].toFixed(1); });
    // vertical scrollbar drag: 30 steps of the bar (Canvas modes: bar -> offsetY)
    let barDrag = null;
    if (info.isCanvas) {
      barDrag = await page.evaluate(async () => {
        const bar = document.querySelector('.vertical-scrollbar'); if (!bar || bar.style.visibility === 'hidden') return null;
        const s = _canvasState.stats; s.full = 0; s.blit = 0;
        const ts = []; let on = true; const loop = t => { if (on) { ts.push(t); requestAnimationFrame(loop); } }; requestAnimationFrame(loop);
        bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        for (let i = 0; i < 30; i++) { bar.scrollTop += 150; bar.dispatchEvent(new Event('scroll')); await new Promise(r => setTimeout(r, 16)); }
        await new Promise(r => setTimeout(r, 200)); on = false;
        bar.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        const d = []; for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]); d.sort((a, b) => a - b);
        return { copies: s.blit, fulls: s.full, p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d[d.length - 1].toFixed(1) };
      });
    }
    // resize: 1600 -> 1200 px wide (Canvas Block re-wraps; DOM Block = the "Screen" re-fit of the block width)
    await page.evaluate(() => { window.__rz = null; window.addEventListener('resize', () => { const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => { window.__rz = performance.now() - t; })); }, { once: true }); });
    await page.setViewportSize({ width: 1200, height: 900 });
    await waitFor(page, () => window.__rz != null, null, 30000);
    let resize = await page.evaluate(() => ({ resizeToFrameMs: +window.__rz.toFixed(1), relayoutMs: typeof _canvasState !== 'undefined' ? +(_canvasState.relayoutMs || 0).toFixed(2) : null, bands: _canvasState.layout ? _canvasState.layout.bandCols : null }));
    if (mode === 'block') resize.screenRefitMs = await page.evaluate(async () => { const t = performance.now(); setBlockSizeToScreen(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return +(performance.now() - t).toFixed(0); });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(800);
    // selection drag across blocks: press in block 1 near its end, 20 moves to block 2, 5 rows down
    const drag = await (async () => {
      await page.evaluate(() => { state.selectedNucs.clear(); state.pendingNucStart = null; });
      const pts = await page.evaluate((mode) => {
        const bw = mode === 'cblock' ? _canvasState.layout.bandCols : +el('blockSizeSlider').value;
        const c0 = Math.max(0, bw - 6), c1 = mode === 'canvas' ? bw + 8 : bw + 8, r0 = 2, r1 = 7;
        if (document.getElementById('alignmentCanvas')) {
          if (mode === 'canvas') { _canvasState.offsetX = Math.max(0, (bw - 60) * _canvasState.metrics.charW); _canvasState.offsetY = 0; }
          else _canvasState.offsetY = 0;
          _canvasState.scheduleDraw();
          const m = _canvasState.metrics;
          const P = (r, c) => { const k = _canvasCellClient(r, c); return { x: k.x + m.charW / 2, y: k.y + m.charH / 2 }; };
          return { a: P(r0, c0), b: P(r1, c1), cols: [c0, c1] };
        }
        const blks = document.querySelectorAll('.block-block');
        const sp = (b, r, c) => blks[b].querySelectorAll('.seq-line:not(.scale-ruler-line):not(.consensus-line)')[r].querySelector(`span[data-pos="${c}"]`);
        const s0 = sp(0, r0, c0); if (!s0) return null;
        s0.scrollIntoView({ block: 'center' });
        const ra = s0.getBoundingClientRect(), s1 = sp(1, r1, c1); if (!s1) return null;
        const rb = s1.getBoundingClientRect();
        return { a: { x: ra.left + ra.width / 2, y: ra.top + ra.height / 2 }, b: { x: rb.left + rb.width / 2, y: rb.top + rb.height / 2 }, cols: [c0, c1] };
      }, mode);
      if (!pts || pts.b.y > 900 || pts.b.y < 0) return { skipped: 'block 2 not on screen with block 1 (rows too many)', pts };
      await page.waitForTimeout(300);
      await page.evaluate(() => { window.__f.ts = []; window.__f.on = true; });
      const t0 = Date.now();
      await page.mouse.move(pts.a.x, pts.a.y); await page.mouse.down();
      for (let i = 1; i <= 20; i++) { await page.mouse.move(pts.a.x + (pts.b.x - pts.a.x) * i / 20, pts.a.y + (pts.b.y - pts.a.y) * i / 20); await page.waitForTimeout(16); }
      await page.mouse.up(); await page.waitForTimeout(200);
      const wall = Date.now() - t0;
      const f = await page.evaluate(() => { window.__f.on = false; return window.__f.ts; });
      const d = []; for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]);
      const sel = await page.evaluate(() => { let n = 0, rows = 0; state.selectedNucs.forEach(s => { n += s.size; rows++; }); return { cells: n, rows }; });
      return { wallMs: wall, p95: +q(d, 0.95).toFixed(1), max: +Math.max(0, ...d).toFixed(1), sel };
    })();
    const summary = { fx: FX, dims, mode, ttffMs: mode === 'block' ? null : +ttff.toFixed(0), switchMs: +switchMs.toFixed(0), ...mem, blockWidth: info.blockWidth, bandCols: info.layout && info.layout.bandCols, fullDrawMs: fullDraw, barDrag, resize, drag };
    console.log('SUMMARY ' + JSON.stringify(summary)); out.push(summary);
    await page.close();
  }
  require('fs').writeFileSync(require('path').join(__dirname, `meas_${FX.replace('.fas', '')}${HEADFUL ? '_headful' : ''}.json`), JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
