// Which DOM nodes/reasons invalidate style/layout/paint during 12 wheel steps in a DOM mode.
const { chromium } = require('playwright-core'); const { spawn } = require('child_process');
const mode = process.argv[2] || 'single', ALN = process.argv[3] || '_perf_600x600.fas', PORT = +(process.argv[4] || 3026), ROOT = 'C:/work/MSA-viewer-new';
async function waitFor(page, fn, arg, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return; await page.waitForTimeout(200); } throw new Error('timeout'); }
(async () => {
  const srv = spawn('python', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }); const cdp = await page.context().newCDPSession(page);
  await page.goto(`http://localhost:${PORT}/index.html?url=${encodeURIComponent('/' + ALN)}&title=t`, { waitUntil: 'load' });
  await waitFor(page, () => typeof state !== 'undefined' && state.seqs && state.seqs.length > 0, null, 120000);
  await waitFor(page, () => document.querySelector('.block-block, #alignmentCanvas'), null, 120000); await page.waitForTimeout(800);
  await page.evaluate(async (m) => { window.showLargeAlignmentDialog = async () => 'proceed'; document.getElementById('modeCanvas').checked = false; document.getElementById('modeSingle').checked = (m === 'single'); document.getElementById('modeBlocks').checked = (m === 'blocks'); await onModeChange(); }, mode);
  await waitFor(page, () => document.querySelector('.block-block'), null, 120000); await page.waitForTimeout(1500);
  const box = await page.evaluate(() => { const r = document.getElementById('alignmentContainer').getBoundingClientRect(); return { x: r.left + (Math.min(r.right, innerWidth) - r.left) * 0.6, y: r.top + (Math.min(r.bottom, innerHeight) - r.top) * 0.5 }; });
  const ev = []; cdp.on('Tracing.dataCollected', d => ev.push(...d.value));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking,disabled-by-default-devtools.timeline.stack', transferMode: 'ReportEvents' });
  for (let i = 0; i < 12; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 120 }); await new Promise(r => setTimeout(r, 16)); }
  await page.waitForTimeout(400); await cdp.send('Tracing.end'); await new Promise(r => cdp.once('Tracing.tracingComplete', r));
  const cnt = new Map();
  for (const e of ev) { if (!/InvalidationTracking|ScheduleStyleRecalculation|InvalidateLayout/.test(e.name)) continue; const d = e.args.data || {}; const st = (d.stackTrace || []).slice(0, 2).map(f => f.functionName + ':' + f.lineNumber).join(' < '); const k = `${e.name} | ${d.nodeName || ''} | ${d.reason || ''} ${d.extraData || ''} | ${st}`; cnt.set(k, (cnt.get(k) || 0) + 1); }
  console.log(`[${mode}] invalidation events over 12 steps:`); [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(String(v).padStart(6), k));
  const paints = ev.filter(e => e.name === 'Paint' && e.ph === 'X'); console.log('Paint events', paints.length, 'clip rects (first 5):', paints.slice(0, 5).map(p => JSON.stringify(p.args.data && p.args.data.clip)).join(' '));
  const layouts = ev.filter(e => e.name === 'Layout' && e.ph === 'X'); console.log('Layout events', layouts.length, layouts.slice(0, 3).map(l => JSON.stringify(l.args.beginData && { dirty: l.args.beginData.dirtyObjects, total: l.args.beginData.totalObjects, partial: l.args.beginData.partialLayout })).join(' '));
  await browser.close(); srv.kill();
})().catch(e => { console.error(e); process.exit(1); });
