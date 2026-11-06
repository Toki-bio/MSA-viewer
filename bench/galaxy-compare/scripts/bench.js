// Black-box benchmark of three browser MSA viewers on identical files.
// Same browser, same machine, same input path a user (or Galaxy) would use.
//   node bench.js <datasetId> <viewer va|av2|ajs> <rep>   -> prints one JSON line
const { chromium } = require('playwright-core');
const crypto = require('crypto');
const BASE = 'http://127.0.0.1:8765';
const [id, viewer, rep] = process.argv.slice(2);
const LOAD_TIMEOUT = 240000;
const nSeq = Number((id.match(/_(\d+)(k?)_x/) || [])[1]) * (/_\d+k_x/.test(id) ? 1000 : 1);

const URL = {
  va: `${BASE}/va/index.html?url=/api/datasets/${id}/display&title=${id}`,
  av2: `${BASE}/av2/index.html?id=${id}`,
  ajs: `${BASE}/ajs/index.html?id=${id}`,
  va_fix: `${BASE}/va_fix/index.html?url=/api/datasets/${id}/display&title=${id}`,
}[viewer];

// "Alignment is on screen" per viewer (checked against screenshots in probe runs)
const READY_VA = (n) => typeof state !== 'undefined' && state.seqs && state.seqs.length === n &&
    !!document.querySelector('#alignmentContainer') && document.querySelector('#alignmentContainer').getBoundingClientRect().height > 100;
const READY = {
  va: READY_VA, va_fix: READY_VA,
  av2: () => { const l = document.querySelector('.av2-letters, .av2-blocks, .av2-blocksandletters canvas');
    return !!l && !!document.querySelector('.unpinned-table, .pinned-table'); },
  ajs: () => { const c = document.querySelector('.alignmentjs-container canvas'); return !!c && c.width > 0; },
}[viewer];

// element to put the mouse over for wheel scrolling
const SCROLL_TARGET = { va: '#alignmentContainer', va_fix: '#alignmentContainer', av2: '.av2-wheel-scroller, .av2-virtualized-matrix', ajs: '.alignmentjs-container canvas' }[viewer];

(async () => {
  const out = { id, viewer, rep: Number(rep), nSeq };
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome',
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-precise-memory-info', '--js-flags=--max-old-space-size=6000'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  let crashed = null;
  page.on('crash', () => { crashed = 'renderer crashed'; });
  page.on('pageerror', (e) => { (out.errors = out.errors || []).push(e.message.slice(0, 160)); });
  await page.addInitScript(() => {
    window.__lt = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); })
      .observe({ type: 'longtask', buffered: true }); } catch (e) { /* no longtask */ }
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  try {
    const t0 = Date.now();
    await page.goto(URL, { waitUntil: 'load', timeout: LOAD_TIMEOUT });
    // ViewAlign asks before loading very large inputs; click Proceed like a user would.
    const deadline = t0 + LOAD_TIMEOUT;
    let clickedProceed = false;
    for (;;) {
      if (crashed) throw new Error(crashed);
      if (Date.now() > deadline) throw new Error('load timeout');
      if (viewer.startsWith('va') && !clickedProceed) {
        const b = await page.$('#alignLoadProceed');
        if (b && await b.isVisible().catch(() => false)) { await b.click(); clickedProceed = true; }
      }
      const ok = await page.evaluate(READY, nSeq).catch(() => false);
      if (ok) break;
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    out.readyMs = Date.now() - t0;
    out.proceedDialog = clickedProceed;
    // interactive: main thread quiet (no long task) for 1 s
    const navStart = await page.evaluate(() => performance.timeOrigin);
    for (;;) {
      if (crashed) throw new Error(crashed);
      if (Date.now() > deadline) throw new Error('settle timeout');
      const lastEnd = await page.evaluate(() => { const l = window.__lt; if (!l.length) return 0; const e = l[l.length - 1]; return e[0] + e[1]; });
      const now = await page.evaluate(() => performance.now());
      if (now - lastEnd > 1000) { out.interactiveMs = Math.round(Math.max(lastEnd, out.readyMs)); break; }
      await page.waitForTimeout(200);
    }
    out.longTaskTotalMs = await page.evaluate(() => Math.round(window.__lt.reduce((a, e) => a + e[1], 0)));
    out.maxLongTaskMs = await page.evaluate(() => Math.round(Math.max(0, ...window.__lt.map((e) => e[1]))));
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    out.heapMB = Math.round(m.JSHeapUsedSize / 1048576);
    out.domNodes = m.Nodes;

    // Scrolling with real wheel input over the alignment
    // largest visible match = the main alignment panel (AV2 has several hidden/thin copies)
    const box = await page.evaluate((sel) => { let best = null, area = 0;
      for (const e of document.querySelectorAll(sel)) { const r = e.getBoundingClientRect(); if (r.width * r.height > area) { area = r.width * r.height; best = r; } }
      if (!best || area < 1000) return null;
      return { x: best.x + best.width / 2, y: best.y + Math.min(best.height / 2, 400) }; }, SCROLL_TARGET);
    if (!box) throw new Error('no scroll target');
    await page.mouse.move(box.x, box.y);
    const shot = async () => crypto.createHash('md5').update(await page.screenshot({ type: 'png' })).digest('hex');
    for (const [axis, dx, dy] of [['v', 0, 240], ['h', 240, 0]]) {
      const before = await shot();
      await page.evaluate(() => { window.__fr = []; window.__run = true;
        const f = (t) => { window.__fr.push(t); if (window.__run) requestAnimationFrame(f); }; requestAnimationFrame(f);
        window.__lt0 = window.__lt.length; });
      for (let i = 0; i < 40; i++) { await page.mouse.wheel(dx, dy); await page.waitForTimeout(16); }
      await page.waitForTimeout(400);
      const fr = await page.evaluate(() => { window.__run = false;
        const d = []; for (let i = 1; i < window.__fr.length; i++) d.push(window.__fr[i] - window.__fr[i - 1]);
        const lt = window.__lt.slice(window.__lt0).map((e) => e[1]);
        return { d, lt }; });
      const after = await shot();
      const d = fr.d.sort((a, b) => a - b);
      const q = (p) => d.length ? +d[Math.min(d.length - 1, Math.floor(p * d.length))].toFixed(1) : null;
      out[`scroll_${axis}`] = { moved: before !== after, frames: d.length, medianFrameMs: q(0.5), p95FrameMs: q(0.95),
        maxFrameMs: d.length ? +d[d.length - 1].toFixed(1) : null, framesOver50ms: d.filter((x) => x > 50).length,
        longTasks: fr.lt.length, longTaskMaxMs: Math.round(Math.max(0, ...fr.lt)) };
    }
    await page.screenshot({ path: `/home/claude/bench/out/shots/${viewer}_${id}_r${rep}.png` });
    out.status = 'ok';
  } catch (e) {
    out.status = 'fail'; out.reason = e.message.slice(0, 200);
    try { await page.screenshot({ path: `/home/claude/bench/out/shots/${viewer}_${id}_r${rep}_FAIL.png`, timeout: 5000 }); } catch (_) {}
  }
  console.log(JSON.stringify(out));
  await browser.close().catch(() => {});
  process.exit(0);
})();
