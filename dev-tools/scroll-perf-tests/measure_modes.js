// Scroll smoothness of ViewAlign in Full (single), Block and Canvas modes on one alignment.
//   node measure_modes.js <served path e.g. _perf_600x600.fas> [modes=single,blocks,canvas] [port=3019]
// Metrics per mode: mode-switch render time; during 60 wheel steps (vertical then horizontal) at 16 ms cadence:
// rAF frame deltas (p50/p95/max, frames >34 ms), Long Animation Frames (count, max), scroll distance reached, scroll events.
const path = require('path');
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const ALN = process.argv[2] || '_perf_600x600.fas';
const MODES = (process.argv[3] || 'single,blocks,canvas').split(',');
const PORT = +(process.argv[4] || 3019);
const ROOT = 'C:/work/MSA-viewer-new';
const HEADLESS = process.env.HEADFUL ? false : true;
async function waitFor(page, fn, arg, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (await page.evaluate(fn, arg)) return; await page.waitForTimeout(200); }
  throw new Error('waitFor timed out: ' + fn.toString().slice(0, 100));
}
const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
(async () => {
  const srv = spawn('python', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: HEADLESS,
    args: ['--enable-gpu-rasterization', '--enable-features=LongAnimationFrameMonitoring'] });
  const results = [];
  for (const mode of MODES) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    const cdp = await page.context().newCDPSession(page);
    const tLoad0 = Date.now();
    await page.goto(`http://localhost:${PORT}/index.html?url=${encodeURIComponent('/' + ALN)}&title=t`, { waitUntil: 'load' });
    await waitFor(page, () => typeof state !== 'undefined' && state.seqs && state.seqs.length > 0, null, 120000);
    await waitFor(page, () => document.querySelector('.block-block, #alignmentCanvas'), null, 120000);
    const tLoad = Date.now() - tLoad0;
    const dims = await page.evaluate(() => [state.seqs.length, state.seqs[0].seq.length]);
    await page.waitForTimeout(800);
    const switchMs = await page.evaluate(async (m) => {
      window.showLargeAlignmentDialog = async () => 'proceed';
      document.getElementById('modeCanvas').checked = (m === 'canvas');
      document.getElementById('modeSingle').checked = (m === 'single');
      document.getElementById('modeBlocks').checked = (m === 'blocks');
      const t0 = performance.now(); await onModeChange(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t0;
    }, mode);
    await waitFor(page, (m) => m === 'canvas' ? document.getElementById('alignmentCanvas') : document.querySelector('.block-block'), mode, 120000);
    if (process.env.INJECT_CSS) { await page.evaluate(css => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }, process.env.INJECT_CSS); console.log('injected:', process.env.INJECT_CSS); await page.waitForTimeout(3000); }
    await page.waitForTimeout(1200);
    const info = await page.evaluate(() => { const c = document.getElementById('alignmentContainer'); return { spans: c.querySelectorAll('.seq-data > *').length, rows: c.querySelectorAll('.seq-line').length, scrollW: c.scrollWidth, scrollH: c.scrollHeight, cw: c.clientWidth, ch: c.clientHeight }; });
    // frame recorder
    await page.evaluate(() => {
      window.__f = { ts: [], loaf: [], scrolls: 0, on: false };
      const loop = t => { if (window.__f.on) window.__f.ts.push(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
      window.__f.attr = {};
      try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (window.__f.on) { window.__f.loaf.push(e.duration); for (const s of (e.scripts || [])) { const k = (s.invoker || '?') + ' ' + (s.sourceFunctionName || '') + ' ' + (s.sourceURL || '').split('/').pop() + ':' + (s.sourceCharPosition ?? ''); window.__f.attr[k] = (window.__f.attr[k] || 0) + s.duration; } } }).observe({ type: 'long-animation-frame', buffered: false }); } catch (e) { window.__f.loafErr = String(e); }
      document.addEventListener('scroll', (ev) => { if (window.__f.on) { window.__f.scrolls++; window.__f.scroller = ev.target === document ? 'document' : (ev.target.id || ev.target.className); } }, { capture: true, passive: true });
    });
    const box = await page.evaluate(() => { const r = document.getElementById('alignmentContainer').getBoundingClientRect(); const vw = Math.min(r.right, innerWidth), vh = Math.min(r.bottom, innerHeight); return { x: r.left + (vw - r.left) * 0.6, y: r.top + (vh - r.top) * 0.5 }; });
    const pos = () => page.evaluate((m) => { if (m === 'canvas') return [_canvasState.offsetX, _canvasState.offsetY]; const c = document.getElementById('alignmentContainer'), d = document.scrollingElement; return [c.scrollLeft + d.scrollLeft, c.scrollTop + d.scrollTop]; }, mode);
    async function run(label, dx, dy, n = 60) {
      const p0 = await pos();
      await page.evaluate(() => { window.__f.ts = []; window.__f.loaf = []; window.__f.scrolls = 0; window.__f.on = true; });
      const t0 = Date.now();
      for (let i = 0; i < n; i++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: dx, deltaY: dy });
        const target = t0 + (i + 1) * 16; const w = target - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w));
      }
      await page.waitForTimeout(300);
      const f = await page.evaluate(() => { window.__f.on = false; return window.__f; });
      const p1 = await pos();
      const d = []; for (let i = 1; i < f.ts.length; i++) d.push(f.ts[i] - f.ts[i - 1]);
      const wall = Date.now() - t0;
      const r = { mode, label, frames: d.length, p50: +q(d, 0.5).toFixed(1), p95: +q(d, 0.95).toFixed(1), max: +Math.max(0, ...d).toFixed(1), over34: d.filter(x => x > 34).length,
        loaf: f.loaf.length, loafMax: +Math.max(0, ...f.loaf).toFixed(0), scrollEvents: f.scrolls, scroller: f.scroller, attr: Object.entries(f.attr).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,v])=>k+'='+v.toFixed(0)), movedPx: [p1[0] - p0[0], p1[1] - p0[1]], wallMs: wall };
      console.log(JSON.stringify(r)); results.push(r);
    }
    console.log(JSON.stringify({ mode, aln: ALN, dims, loadMs: tLoad, switchMs: +switchMs.toFixed(0), ...info }));
    await run('down', 0, 120); await run('up', 0, -120); await run('right', 120, 0); await run('left', -120, 0);
    await page.close();
  }
  await browser.close(); srv.kill();
})().catch(e => { console.error(e); process.exit(1); });
