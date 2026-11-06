// Time until shading (conservation) and consensus caches are complete, and node count after forced GC.
//   node compute_va.js <va|va_fix> <datasetId>
const { chromium } = require('playwright-core');
const [viewer, id] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const cdp = await p.context().newCDPSession(p); await cdp.send('Performance.enable');
  const t0 = Date.now();
  await p.goto(`http://127.0.0.1:8765/${viewer}/index.html?url=/api/datasets/${id}/display&title=${id}`);
  let ready = null, cons = null, consen = null;
  while (Date.now() - t0 < 300000) {
    const btn = await p.$('#alignLoadProceed'); if (btn && await btn.isVisible().catch(() => false)) await btn.click();
    const s = await p.evaluate(() => {
      if (typeof state === 'undefined' || !state.seqs || !state.seqs.length) return {};
      const len = state.seqs.reduce((m, q) => Math.max(m, q.seq.length), 0);
      const c = state.conservationDataCache, k = state.consensusCache;
      return { rows: state.seqs.length, cons: !!(c && c.data && c.len === len && c.data.length === len && c.data[len - 1]),
        consen: !!(k && k.values && k.len === len && k.values[len - 1] !== undefined) };
    });
    const now = Date.now() - t0;
    if (s.rows && ready === null) ready = now;
    if (s.cons && cons === null) cons = now;
    if (s.consen && consen === null) consen = now;
    if (cons !== null && consen !== null) break;
    await p.waitForTimeout(50);
  }
  const nodes = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'Nodes').value;
  const before = await nodes();
  await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.collectGarbage'); await p.waitForTimeout(500);
  const after = await nodes();
  const inDoc = await p.evaluate(() => document.getElementsByTagName('*').length);
  const fp = await p.evaluate(async () => {
    const h = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].slice(0, 6).map((x) => x.toString(16).padStart(2, '0')).join('');
    return { seqs: await h(state.seqs.map((q) => q.header + '\n' + q.seq).join('\n')), consensus: await h(state.consensusCache.values.join('')),
      shading: await h(JSON.stringify(state.conservationDataCache.data, (k, v) => (v instanceof Set ? [...v] : v))) };
  });
  console.log(JSON.stringify({ viewer, id, rowsSeenMs: ready, shadingDoneMs: cons, consensusDoneMs: consen, nodesBeforeGC: before, nodesAfterGC: after, elementsInDocument: inDoc, heapMB: Math.round((await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576), fp }));
  await b.close();
})();
