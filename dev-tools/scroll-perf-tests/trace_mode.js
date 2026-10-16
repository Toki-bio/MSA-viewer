// CPU profile + devtools trace of 20 vertical wheel steps in one ViewAlign mode.
//   node trace_mode.js <single|blocks|canvas> <served path> [port]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const mode = process.argv[2] || 'canvas', ALN = process.argv[3] || '_perf_600x600.fas', PORT = +(process.argv[4] || 3023);
const ROOT = 'C:/work/MSA-viewer-new';
async function waitFor(page, fn, arg, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return; await page.waitForTimeout(200); } throw new Error('timeout'); }
(async () => {
  const srv = spawn('python', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: !process.env.HEADFUL });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const cdp = await page.context().newCDPSession(page);
  await page.goto(`http://localhost:${PORT}/index.html?url=${encodeURIComponent('/' + ALN)}&title=t`, { waitUntil: 'load' });
  await waitFor(page, () => typeof state !== 'undefined' && state.seqs && state.seqs.length > 0, null, 120000);
  await waitFor(page, () => document.querySelector('.block-block, #alignmentCanvas'), null, 120000);
  await page.waitForTimeout(800);
  await page.evaluate(async (m) => { window.showLargeAlignmentDialog = async () => 'proceed'; document.getElementById('modeCanvas').checked = (m === 'canvas'); document.getElementById('modeSingle').checked = (m === 'single'); document.getElementById('modeBlocks').checked = (m === 'blocks'); await onModeChange(); }, mode);
  await waitFor(page, (m) => m === 'canvas' ? document.getElementById('alignmentCanvas') : document.querySelector('.block-block'), mode, 120000);
  if (process.env.INJECT_CSS) { await page.evaluate(css => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }, process.env.INJECT_CSS); console.log('injected:', process.env.INJECT_CSS); }
  await page.waitForTimeout(1500);
  const box = await page.evaluate(() => { const r = document.getElementById('alignmentContainer').getBoundingClientRect(); const vw = Math.min(r.right, innerWidth), vh = Math.min(r.bottom, innerHeight); return { x: r.left + (vw - r.left) * 0.6, y: r.top + (vh - r.top) * 0.5 }; });
  async function steps(n, dx, dy) { for (let i = 0; i < n; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: dx, deltaY: dy }); await new Promise(r => setTimeout(r, 16)); } await page.waitForTimeout(400); }
  // 1. CPU profile
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
  await steps(20, 0, 120);
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map(n => [n.id, n]));
  for (let i = 0; i < profile.samples.length; i++) { const n = byId.get(profile.samples[i]); const k = (n.callFrame.functionName || '(anon)') + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); }
  const tot = [...self.values()].reduce((a, b) => a + b, 0) / 1000;
  console.log(`[${mode}] CPU profile over 20 steps: total sampled ${tot.toFixed(0)} ms; top self-time:`);
  [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log('   ', (v / 1000).toFixed(1).padStart(7), 'ms', k));
  // 2. Trace by category
  const ev = []; cdp.on('Tracing.dataCollected', d => ev.push(...d.value));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc,viz', transferMode: 'ReportEvents' });
  await steps(20, 0, -120);
  await cdp.send('Tracing.end'); await new Promise(r => cdp.once('Tracing.tracingComplete', r));
  const dur = new Map(), cnt = new Map();
  for (const e of ev) if (e.ph === 'X' && e.dur) { dur.set(e.name, (dur.get(e.name) || 0) + e.dur); cnt.set(e.name, (cnt.get(e.name) || 0) + 1); }
  console.log(`[${mode}] trace over 20 steps (ms, count) - top event names:`);
  [...dur.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).forEach(([k, v]) => console.log('   ', (v / 1000).toFixed(1).padStart(8), String(cnt.get(k)).padStart(6), k));
  await browser.close(); srv.kill();
})().catch(e => { console.error(e); process.exit(1); });
