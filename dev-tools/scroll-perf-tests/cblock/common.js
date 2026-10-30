// Server: the worktree at /, fixtures at /fx/. Browser: local Chrome via playwright-core.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const APP = path.join(__dirname, '..', '..', '..');
const FX = __dirname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rs) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const fp = p.startsWith('/fx/') ? path.join(FX, p.slice(4)) : path.join(APP, p);
      fs.readFile(fp, (err, data) => {
        if (err) { rs.writeHead(404); rs.end('nf'); return; }
        rs.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        rs.end(data);
      });
    });
    srv.listen(0, () => res({ srv, base: 'http://localhost:' + srv.address().port }));
  });
}
async function launch(headful) {
  return chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: !headful,
    args: ['--enable-gpu-rasterization', '--enable-features=LongAnimationFrameMonitoring'] });
}
async function waitFor(page, fn, arg, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return; await page.waitForTimeout(100); }
  throw new Error('waitFor timeout ' + fn.toString().slice(0, 120));
}
// open the app on a fixture in a view; view = block | canvas | cblock
async function openView(browser, base, fx, view, vp = { width: 1600, height: 900 }) {
  const page = await browser.newPage({ viewport: vp });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.addInitScript(() => {
    window.showLargeAlignmentDialog = async () => 'proceed';
    window.__firstFrame = null;
    const tick = () => {
      if (window.__firstFrame == null) {
        const c = document.getElementById('alignmentCanvas');
        const ok = (c && typeof _canvasState !== "undefined" && _canvasState.stats && _canvasState.stats.full > 0) || document.querySelector('.block-block .seq-data span[data-pos]');
        if (ok) window.__firstFrame = performance.now();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(`${base}/index.html?url=${encodeURIComponent('/fx/' + fx)}&title=t&view=${view}`, { waitUntil: 'load' });
  await waitFor(page, () => typeof state !== 'undefined' && state.seqs && state.seqs.length > 0);
  await waitFor(page, () => window.__firstFrame != null);
  // shading arrives later (idle job) and re-renders: wait for it
  await waitFor(page, () => !!(state.conservationDataCache && state.conservationDataCache.data), null, 60000).catch(() => {});
  await page.waitForTimeout(1000);
  return page;
}
const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
module.exports = { serve, launch, waitFor, openView, q };
