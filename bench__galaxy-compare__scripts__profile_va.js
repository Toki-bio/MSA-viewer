// Where does ViewAlign spend load time and memory on a tall alignment?
//   node profile_va.js <datasetId>
const { chromium } = require('playwright-core');
const id = process.argv[2] || 'aa_100k_x400';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--enable-precise-memory-info'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  await p.goto(`http://127.0.0.1:8765/va/index.html?url=/api/datasets/${id}/display&title=${id}`);
  for (let i = 0; i < 600; i++) {
    const b2 = await p.$('#alignLoadProceed'); if (b2 && await b2.isVisible().catch(() => false)) await b2.click();
    if (await p.evaluate(() => typeof state !== 'undefined' && state.seqs && state.seqs.length > 0 && /loaded from URL/.test(document.body.innerText))) break;
    await p.waitForTimeout(100);
  }
  await p.waitForTimeout(1500);
  const { profile } = await cdp.send('Profiler.stop');
  // self time per function, and inclusive time per function (top of stacks)
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const self = {}, incl = {};
  const key = (f) => `${f.functionName || '(anon)'} @${f.url.split('/').pop().split('?')[0] || '-'}:${f.lineNumber + 1}`;
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = (profile.timeDeltas[i] || 0) / 1000; let n = byId.get(profile.samples[i]);
    const k0 = key(n.callFrame); if (k0.startsWith('(idle)')) continue; self[k0] = (self[k0] || 0) + dt;
    const seen = new Set();
    while (n) { const k = key(n.callFrame); if (!seen.has(k)) { incl[k] = (incl[k] || 0) + dt; seen.add(k); } n = byId.get(parent.get(n.id)); }
  }
  const top = (o, n) => Object.entries(o).filter(([k]) => /script\.js|\.js:/.test(k) || k.startsWith('(')).sort((a, b) => b[1] - a[1]).slice(0, n);
  console.log('== self time'); for (const [k, v] of top(self, 18)) console.log(v.toFixed(0).padStart(6), k);
  console.log('== inclusive (script.js)'); for (const [k, v] of top(incl, 60).filter(([k]) => /script\.js|parser|\.js:/.test(k)).slice(0, 25)) console.log(v.toFixed(0).padStart(6), k);
  const dom = await p.evaluate(() => {
    const c = {}; for (const e of document.getElementsByTagName('*')) { const k = e.tagName + '.' + String(e.className).split(' ')[0]; c[k] = (c[k] || 0) + 1; }
    const tot = document.getElementsByTagName('*').length;
    const big = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8);
    // which containers hold the most descendants
    const holders = [...document.querySelectorAll('[id]')].map((e) => [e.id, e.getElementsByTagName('*').length]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { tot, big, holders, mode: document.querySelector('input[name="viewMode"]:checked, input[type=radio][id^=mode]:checked')?.id,
      heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576) };
  });
  console.log('== DOM', JSON.stringify(dom));
  const heap = await p.evaluate(() => { const s = state; const out = {};
    for (const k of Object.keys(s)) { const v = s[k];
      if (Array.isArray(v)) out[k] = 'Array(' + v.length + ')';
      else if (v && typeof v === 'object' && v.constructor && v.constructor.name !== 'Object') out[k] = v.constructor.name + (v.length != null ? '(' + v.length + ')' : '');
    } return out; });
  console.log('== state arrays', JSON.stringify(heap).slice(0, 1500));
  await b.close();
})();
