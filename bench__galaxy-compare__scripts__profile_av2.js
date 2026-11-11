// Where does AV2 spend time while wheel-scrolling? CPU profile, self time grouped by function.
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto('http://127.0.0.1:8765/av2/index.html?id=aa_10k_x400');
  await p.waitForTimeout(6000);
  const gl = await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl');
    const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : String(!!c); });
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await p.mouse.move(800, 600);
  await cdp.send('Profiler.start');
  for (let i = 0; i < 15; i++) { await p.mouse.wheel(0, 240); await p.waitForTimeout(30); }
  await p.waitForTimeout(800);
  const { profile } = await cdp.send('Profiler.stop');
  const dt = {}; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]); const f = n.callFrame;
    const key = (f.functionName || '(anon)') + ' @' + (f.url.split('/').pop() || '-') + ':' + f.lineNumber;
    dt[key] = (dt[key] || 0) + (profile.timeDeltas[i] || 0) / 1000;
  }
  const total = Object.entries(dt).filter(([k]) => !k.startsWith('(idle)')).reduce((a, [, v]) => a + v, 0);
  console.log('WebGL renderer:', gl);
  console.log('busy ms:', total.toFixed(0));
  for (const [k, v] of Object.entries(dt).filter(([k]) => !k.startsWith('(idle)')).sort((a, b) => b[1] - a[1]).slice(0, 15))
    console.log(v.toFixed(0).padStart(6), 'ms', k);
  await b.close();
})();
