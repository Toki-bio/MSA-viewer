// Load one dataset in each viewer, screenshot, and summarise the DOM.
const { chromium } = require('playwright-core');
const id = process.argv[2] || 'nt_1k_x300';
const BASE = 'http://127.0.0.1:8765';
const urls = {
  va: `${BASE}/va/index.html?url=/api/datasets/${id}/display&title=${id}`,
  av2: `${BASE}/av2/index.html?id=${id}`,
  ajs: `${BASE}/ajs/index.html?id=${id}`,
};
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome',
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-precise-memory-info'] });
  for (const [k, url] of Object.entries(urls)) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const logs = [];
    page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message.slice(0, 200)));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `/home/claude/bench/out/probe_${k}_${id}.png` });
    const info = await page.evaluate(() => ({
      canvases: [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height}`).slice(0, 8),
      svgs: document.querySelectorAll('svg').length,
      nodes: document.getElementsByTagName('*').length,
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
      classes: [...new Set([...document.querySelectorAll('[class]')].map((e) => String(e.className).split(' ')[0]))].slice(0, 60).join(' '),
    }));
    console.log(k, JSON.stringify(info), logs.slice(0, 5));
    await page.close();
  }
  await browser.close();
})();
