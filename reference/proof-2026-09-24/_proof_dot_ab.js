// Same measurements on old and new dot-plot code.
//   node scratch/_proof_dot_ab.js <repo-root> <label>
// Serves <repo-root> with that checkout's own tests/lib/static-server.
const path = require('path');
const root = path.resolve(process.argv[2]);
const label = process.argv[3] || root;
const { start } = require(path.join(root, 'tests/lib/static-server'));
const { launch } = require(path.join(root, 'tests/lib/browser'));

(async () => {
  const { server, baseUrl } = await start();
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
  const out = { label, served: root };

  // 0. Word/Window input as the page first shows it (SPIN is the default mode)
  out.inputAtLoad = await p.evaluate(() => { const w = document.getElementById('dotPlotWindow'); return { min: w.min, max: w.max, step: w.step, value: w.value, valid: w.checkValidity(), tooltip: w.title }; });

  await p.evaluate(() => {
    window.rnd = (n, seed) => { let s = seed, o = ''; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; o += 'ACGT'[(s >>> 16) & 3]; } return o; };
    // Dot test exactly as each version draws it: new code has _dotIsDot; old code's
    // _dotBuildImage drew a Dotter dot when (score-min)/(max-min) >= threshold.
    window.isDot = (r, c) => {
      const S = _dotPlotState;
      if (typeof _dotIsDot === 'function') return _dotIsDot(r, c);
      const i = r * S.cols + c;
      if (S.spinMode && S.matchMap) return !!S.matchMap[i];
      return (S.scores[i] - S.scoreMin) / ((S.scoreMax - S.scoreMin) || 1) >= S.threshold;
    };
    window.plot = async (A, B, mode, win, thr) => {
      document.querySelector(`input[name="dotPlotMode"][value="${mode}"]`).checked = true; _dotOnModeChange();
      document.getElementById('dotPlotWindow').value = win;
      if (thr != null) document.getElementById('dotPlotThreshold').value = thr;
      document.getElementById('dotPlotRevComp').checked = false;
      await openDotPlot(A, B, 'A', 'B');
      await new Promise(r => setTimeout(r, 300)); // old code detects regions 50 ms after render
      const S = _dotPlotState;
      let dots = 0; for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) if (isDot(r, c)) dots++;
      return { rows: S.rows, cols: S.cols, dots, regions: (S.regions || []).length };
    };
  });

  // 1. 300 N between random flanks, self plot; count dots inside the N x N block
  for (const mode of ['spin', 'doter']) {
    out['nBlock_' + mode] = await p.evaluate(async (mode) => {
      const s = rnd(200, 5) + 'N'.repeat(300) + rnd(200, 9);
      await plot(s, s, mode, mode === 'spin' ? 6 : 11, 55);
      let inN = 0; for (let r = 200; r < 500; r++) for (let c = 200; c < 500; c++) if (isDot(r, c)) inN++;
      return { dotsInsideNBlock: inN, of: 300 * 300 };
    }, mode);
  }
  // 2. RNA (U) against the same DNA (T)
  out.uVsT = await p.evaluate(async () => plot('ACGU'.repeat(50), 'ACGT'.repeat(50), 'spin', 6));
  // 3. two unrelated random sequences, Dotter window 11, threshold 55%
  out.unrelated = await p.evaluate(async () => plot(rnd(500, 11), rnd(500, 13), 'doter', 11, 55));
  // 4. SPIN, 6 kb sequence carrying the same 200 bp twice
  out.repeat200in6kb = await p.evaluate(async () => { const r = rnd(200, 99); const s = rnd(2800, 1) + r + rnd(2800, 2) + r; const res = await plot(s, s, 'spin', 8); res.len = s.length; return res; });
  // 5. zoom 24 on 2000 bp: canvas size, and whether the canvas actually holds the drawing
  out.zoom24 = await p.evaluate(async () => {
    await plot(rnd(2000, 3), rnd(2000, 3), 'spin', 6);
    const S = _dotPlotState; S.zoom = 24;
    if (typeof _dotSetSpacer === 'function') _dotSetSpacer();
    _dotRender();
    const c = document.getElementById('dotPlotCanvas');
    // SPIN draws a black plot area: the pixel at plot (60,60) should be black or white, never transparent
    const px = Array.from(c.getContext('2d').getImageData(60, 60, 1, 1).data);
    return { canvasWidth: c.width, canvasHeight: c.height, pixelAt60: px };
  });
  // 6. zoomed out (zoom < 1): along a known 100 bp off-diagonal repeat, how many plot pixels are dark
  out.zoomedOutDiagonal = await p.evaluate(async () => {
    const r = rnd(100, 77); const s = rnd(400, 5) + r + rnd(200, 2) + r; // copies at 400 and 700
    await plot(s, s, 'doter', 11, 70);
    const S = _dotPlotState; S.zoom = 0.5;
    if (typeof _dotSetSpacer === 'function') _dotSetSpacer();
    const vp = document.getElementById('dotPlotViewport'); vp.scrollLeft = vp.scrollTop = 0;
    _dotRender();
    const g = document.getElementById('dotPlotCanvas').getContext('2d');
    const seen = new Set(); let dark = 0;
    for (let k = 10; k < 90; k++) { // interior of the repeat: row 700+k, col 400+k
      const x = Math.floor(50 + (400 + k) * 0.5), y = Math.floor(50 + (700 + k) * 0.5);
      const key = x + ',' + y; if (seen.has(key)) continue; seen.add(key);
      if (g.getImageData(x, y, 1, 1).data[0] < 128) dark++;
    }
    return { pixelsOnDiagonal: seen.size, dark };
  });
  // 7. Copy Region after opening a new plot
  out.copyRegionAfterNewPlot = await p.evaluate(async () => {
    await plot(rnd(300, 5), rnd(300, 6), 'spin', 6);
    _dotUpdateHoverInfo(10, 10);
    const before = !!_dotPlotState._copyRegion;
    await plot(rnd(200, 9), rnd(200, 9), 'spin', 6);
    return { regionBefore: before, regionAfterNewPlot: _dotPlotState._copyRegion ? 'kept from previous plot' : null };
  });
  // 8. SPIN mode, pinned position, no hover region: click Copy Region
  out.copyPinnedSpin = await p.evaluate(async () => {
    await plot(rnd(300, 5), rnd(300, 5), 'spin', 6);
    const S = _dotPlotState; S._copyRegion = null; S.pinnedRow = 5; S.pinnedCol = 5;
    try { navigator.clipboard.writeText = async () => {}; } catch (e) {}
    return new Promise(res => {
      const onErr = (ev) => { res({ threw: ev.message }); };
      window.addEventListener('error', onErr, { once: true });
      document.getElementById('dotPlotCopyRegion').click();
      setTimeout(() => { window.removeEventListener('error', onErr); res({ threw: null }); }, 300);
    });
  });
  // 9. exports
  await p.evaluate(async () => { const r = rnd(100, 77); const s = rnd(400, 5) + r + rnd(200, 2) + r; await plot(s, s, 'doter', 11, 70); });
  const dl = async (sel) => { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click(sel)]); return require('fs').readFileSync(await d.path()); };
  const svg = (await dl('#dotPlotExportSvg')).toString('utf8');
  out.svg = { bytes: svg.length, containsImageElement: /<image\b/.test(svg), lineElements: (svg.match(/<line\b/g) || []).length };
  const png = await dl('#dotPlotExport');
  out.png = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  // 10. 12000 x 12000
  out.plot12000 = await p.evaluate(async () => {
    const t0 = performance.now();
    try { await plot(rnd(12000, 1), rnd(12000, 2), 'spin', 8); } catch (e) { return { threw: e.message }; }
    return { ms: Math.round(performance.now() - t0), rows: _dotPlotState.rows, status: document.getElementById('dotPlotStatus').textContent.slice(0, 90) };
  }).catch(e => ({ pageFailed: e.message.slice(0, 120) }));
  out.pageErrors = errs;
  console.log(JSON.stringify(out, null, 1));
  await b.close(); server.close();
})();
