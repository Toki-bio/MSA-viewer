// Which object keeps detached DOM nodes alive after a large load?
const { chromium } = require('playwright-core');
const id = process.argv[2] || 'nt_10k_x300';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto(`http://127.0.0.1:8765/va_fix/index.html?url=/api/datasets/${id}/display`);
  for (let i = 0; i < 300; i++) {
    const btn = await p.$('#alignLoadProceed'); if (btn && await btn.isVisible().catch(() => false)) await btn.click();
    if (await p.evaluate(() => typeof state !== 'undefined' && state.seqs?.length > 0 && !!state.conservationDataCache)) break;
    await p.waitForTimeout(100);
  }
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const out = [];
    const isNode = (v) => v instanceof Node;
    const countNodes = (v, depth = 0) => {
      if (!v || typeof v !== 'object' || depth > 2) return 0;
      if (isNode(v)) return (v.isConnected ? 0 : 1 + (v.getElementsByTagName ? v.getElementsByTagName('*').length : 0));
      let n = 0;
      if (v instanceof Map) { for (const x of v.values()) n += countNodes(x, depth + 1); return n; }
      if (Array.isArray(v)) { for (const x of v) n += countNodes(x, depth + 1); return n; }
      if (v.constructor === Object) { for (const k of Object.keys(v)) n += countNodes(v[k], depth + 1); }
      return n;
    };
    for (const k of Object.keys(state)) { const n = countNodes(state[k]); if (n > 100) out.push(['state.' + k, n, state[k] && state[k].size !== undefined ? 'size ' + state[k].size : '']); }
    for (const k of Object.getOwnPropertyNames(window)) {
      let v; try { v = window[k]; } catch (e) { continue; }
      if (!v || typeof v !== 'object' || isNode(v) && v.isConnected) continue;
      const n = countNodes(v); if (n > 100) out.push(['window.' + k, n]);
    }
    return out.sort((a, c) => c[1] - a[1]).slice(0, 15);
  });
  console.log(id, JSON.stringify(r));
  await b.close();
})();
