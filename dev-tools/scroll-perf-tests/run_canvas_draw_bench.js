const { chromium } = require('playwright-core'); const path = require('path');
(async () => {
  for (const headless of [true, false]) {
    const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless });
    const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
    await p.goto('file:///' + path.resolve(__dirname, 'canvas_draw_bench.html').replace(/\\/g, '/'));
    await p.waitForFunction(() => window.__done, null, { timeout: 180000 });
    console.log(`===== ${headless ? 'headless' : 'headful'}\n` + await p.evaluate(() => window.__done));
    await b.close();
  }
})();
