// Word size vs match count, and the alignment-column readout, on the current code
const { start } = require('../tests/lib/static-server');
const { launch } = require('../tests/lib/browser');
(async () => {
  const { server, baseUrl } = await start();
  const b = await launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
  const out = await p.evaluate(async () => {
    const rnd = (n, seed) => { let s = seed, o = ''; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; o += 'ACGT'[(s >>> 16) & 3]; } return o; };
    const A = rnd(800, 31), B = rnd(800, 57);
    const res = { dotsByWordSize: {} };
    for (const w of [4, 6, 8, 12]) {
      document.querySelector('input[name="dotPlotMode"][value="spin"]').checked = true; _dotOnModeChange();
      document.getElementById('dotPlotWindow').value = w;
      await openDotPlot(A, B, 'A', 'B');
      let n = 0; for (const v of _dotPlotState.matchMap) n += v; res.dotsByWordSize[w] = n;
    }
    document.getElementById('dotPlotWindow').value = 4;
    await openDotPlot('ACGTACGTAC', 'ACGTACGTAC', 'A', 'B', { alignedSeqA: 'AC--GTACGTAC', alignedSeqB: 'ACGTACGT--AC' });
    _dotUpdateHoverInfo(2, 8);
    res.hoverReadout = { position: 'A pos 3 (G), B pos 9 (A)', shown: document.getElementById('dotPlotAlignMeta').textContent,
      expected: 'A pos 3 is column 5 of AC--GTACGTAC; B pos 9 is column 11 of ACGTACGT--AC' };
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close(); server.close();
})();
