// Cost of the operations content-visibility was added to protect (zoom change, Highlight diffs,
// mode switch), Full mode, with and without the content-visibility rule.
//   node op_cost.js <nSeq> <nCol> [port]
const { chromium } = require('playwright-core'); const { spawn } = require('child_process');
const N = +(process.argv[2] || 600), L = +(process.argv[3] || 600), PORT = +(process.argv[4] || 3032), ROOT = 'C:/work/MSA-viewer-new';
const CV_OFF = '.block-block.cv-block .seq-line:not(.scale-ruler-line):not(.consensus-line) > .seq-data{content-visibility:visible !important;contain-intrinsic-size:none !important}';
async function waitFor(page, fn, arg, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return; await page.waitForTimeout(200); } throw new Error('timeout'); }
(async () => {
  const srv = spawn('python', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: !process.env.HEADFUL });
  for (const cvOff of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    if (cvOff) await page.evaluate(css => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }, CV_OFF);
    // synthetic alignment built in-page (same generator idea as tests/lib/browser.js loadSyntheticFasta)
    await page.evaluate(async ([n, l]) => {
      window.showLargeAlignmentDialog = async () => 'proceed';
      const bases = 'ACGT'; let fa = '';
      for (let i = 0; i < n; i++) { let s = ''; for (let j = 0; j < l; j++) s += ((i * 7 + j * 13) % 11 === 0) ? '-' : bases[(i + j * 3) % 4]; fa += '>seq' + i + '\n' + s + '\n'; }
      const file = new File([fa], 'syn.fa', { type: 'text/plain' });
      const input = document.getElementById('fileInput'); const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    }, [N, L]);
    await waitFor(page, () => typeof state !== 'undefined' && state.seqs && state.seqs.length > 0, null, 120000);
    await page.waitForTimeout(500);
    const t = {};
    const timed = async (name, fn) => { t[name] = Math.round(await page.evaluate(async (src) => { const f = new Function('return (' + src + ')')(); const t0 = performance.now(); await f(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t0; }, fn.toString())); };
    await timed('switchToFull', async () => { document.getElementById('modeCanvas').checked = false; document.getElementById('modeBlocks').checked = false; document.getElementById('modeSingle').checked = true; await onModeChange(); });
    await waitFor(page, () => document.querySelector('.block-block'), null, 120000); await page.waitForTimeout(800);
    const spans = await page.evaluate(() => document.querySelectorAll('#alignmentContainer .seq-data > *').length);
    await timed('zoomTo60pct', async () => { const z = document.getElementById('zoomSlider'); z.value = 30; z.dispatchEvent(new Event('input', { bubbles: true })); z.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(800);
    await timed('zoomBack100', async () => { const z = document.getElementById('zoomSlider'); z.value = 50; z.dispatchEvent(new Event('input', { bubbles: true })); z.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(800);
    await timed('highlightDiffsOn', async () => { const c = document.getElementById('highlightDiffs'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(800);
    await timed('highlightDiffsOff', async () => { const c = document.getElementById('highlightDiffs'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(800);
    await timed('switchToBlock', async () => { document.getElementById('modeSingle').checked = false; document.getElementById('modeBlocks').checked = true; await onModeChange(); });
    await page.waitForTimeout(800);
    await timed('switchBackToFull', async () => { document.getElementById('modeBlocks').checked = false; document.getElementById('modeSingle').checked = true; await onModeChange(); });
    console.log(JSON.stringify({ size: `${N}x${L}`, contentVisibility: cvOff ? 'off' : 'on', spans, ms: t }));
    await page.close();
  }
  await browser.close(); srv.kill();
})().catch(e => { console.error(e); process.exit(1); });
