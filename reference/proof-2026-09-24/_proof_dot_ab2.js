// Second round of old/new measurements. node scratch/_proof_dot_ab2.js <repo-root> <label>
const path = require('path');
const root = path.resolve(process.argv[2]);
const { start } = require(path.join(root, 'tests/lib/static-server'));
const { launch } = require(path.join(root, 'tests/lib/browser'));
(async () => {
  const { server, baseUrl } = await start();
  const b = await launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await p.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
  const out = { label: process.argv[3] };
  await p.evaluate(() => {
    window.rnd = (n, seed) => { let s = seed, o = ''; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; o += 'ACGT'[(s >>> 16) & 3]; } return o; };
    window.isDot = (r, c) => {
      const S = _dotPlotState;
      if (typeof _dotIsDot === 'function') return _dotIsDot(r, c);
      const i = r * S.cols + c;
      if (S.spinMode && S.matchMap) return !!S.matchMap[i];
      return (S.scores[i] - S.scoreMin) / ((S.scoreMax - S.scoreMin) || 1) >= S.threshold;
    };
    window.setMode = (mode, win, thr) => {
      document.querySelector(`input[name="dotPlotMode"][value="${mode}"]`).checked = true; _dotOnModeChange();
      document.getElementById('dotPlotWindow').value = win;
      if (thr != null) document.getElementById('dotPlotThreshold').value = thr;
      document.getElementById('dotPlotRevComp').checked = false;
    };
  });
  // a. Word/Window input after switching to Dotter mode, with the default value 6 still in it
  out.inputInDotterMode = await p.evaluate(() => {
    const w = document.getElementById('dotPlotWindow'); w.value = 6;
    document.querySelector('input[name="dotPlotMode"][value="doter"]').checked = true; _dotOnModeChange();
    const r = { min: w.min, max: w.max, step: w.step, value: w.value, valid: w.checkValidity() };
    w.stepUp(); r.afterStepUp = w.value; w.value = r.value; w.stepDown(); r.afterStepDown = w.value;
    return r;
  });
  // b. SPIN mode at zoom 0.598 (the screenshot case): along the 100 bp off-diagonal repeat,
  //    how many plot pixels show a dot (SPIN draws dots white on black)
  out.spinZoomOutDiagonal = await p.evaluate(async () => {
    const r = rnd(100, 77); const s = rnd(400, 5) + r + rnd(200, 2) + r;
    setMode('spin', 6); await openDotPlot(s, s, 'A', 'B');
    const S = _dotPlotState, z = 0.598; S.zoom = z;
    if (typeof _dotSetSpacer === 'function') _dotSetSpacer();
    const vp = document.getElementById('dotPlotViewport'); vp.scrollLeft = vp.scrollTop = 0;
    _dotRender();
    let cellsOn = 0; for (let k = 10; k < 90; k++) if (isDot(700 + k, 400 + k)) cellsOn++;
    const g = document.getElementById('dotPlotCanvas').getContext('2d');
    const seen = new Set(); let lit = 0;
    for (let k = 10; k < 90; k++) {
      const x = Math.floor(50 + (400 + k + 0.5) * z), y = Math.floor(50 + (700 + k + 0.5) * z);
      const key = x + ',' + y; if (seen.has(key)) continue; seen.add(key);
      if (g.getImageData(x, y, 1, 1).data[0] > 128) lit++;
    }
    return { cellsWithDotOnRepeat: cellsOn + '/80', pixelsOnRepeat: seen.size, pixelsLit: lit };
  });
  // c. Unrelated random 500 x 500, Dotter 11 / 55%: dots within 5 positions of a diagonal's end
  //    (where the window is clipped) versus elsewhere, per cell
  out.edgeDots = await p.evaluate(async () => {
    setMode('doter', 11, 55); await openDotPlot(rnd(500, 11), rnd(500, 13), 'A', 'B');
    const S = _dotPlotState; let edge = 0, edgeN = 0, mid = 0, midN = 0;
    for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) {
      const distToEnd = Math.min(r, c, S.rows - 1 - r, S.cols - 1 - c);
      if (distToEnd < 5) { edgeN++; if (isDot(r, c)) edge++; } else { midN++; if (isDot(r, c)) mid++; }
    }
    return { edgeDotRate: (edge / edgeN).toFixed(4), interiorDotRate: (mid / midN).toFixed(4), edge, mid };
  });
  // d. Threshold meaning: A and B identical except 3 mismatches inside one 11-wide window.
  //    True identity of the window centred there = 8/11 = 72.7%.
  out.thresholdMeaning = await p.evaluate(async () => {
    const A = rnd(60, 21); const Bs = A.split('');
    for (const i of [28, 30, 32]) Bs[i] = ({ A: 'C', C: 'G', G: 'T', T: 'A' })[Bs[i]];
    const res = {};
    for (const thr of [70, 75]) {
      setMode('doter', 11, thr); await openDotPlot(A, Bs.join(''), 'A', 'B');
      res['dotAt30_thr' + thr] = isDot(30, 30);
    }
    const S = _dotPlotState;
    res.rawScoreAt30 = S.scores[30 * S.cols + 30];
    res.scoreRange = [S.scoreMin, S.scoreMax];
    return res;
  });
  // e. Browser canvas limit: can a 48051 x 48051 canvas hold a drawing at all?
  out.canvasLimit = await p.evaluate(() => {
    const test = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); if (!g) return 'no context'; g.fillStyle = '#f00'; g.fillRect(0, 0, w, h); return Array.from(g.getImageData(1, 1, 1, 1).data).join(','); };
    return { '32000x100': test(32000, 100), '48051x48051': test(48051, 48051), '12051x12051': test(12051, 12051) };
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close(); server.close();
})();
