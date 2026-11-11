// Probe: focus on a drop-down (SELECT) inside an open window, then Ctrl+U / Ctrl+R / Ctrl+Z.
const L = 'C:/work/MSA-viewer-new/tests/lib/';
const { start } = require(L + 'static-server');
const { launch, loadFasta } = require(L + 'browser');
const FA = '>s0\nACGTACGTACGTAAAC\n>s1\nACGTTCGTACGTAAAC\n>s2\nACGTACGAACGTAAAC\n>s3\nACGTACGTACCTAAAC\n';
const snap = (page) => page.evaluate(() => state.seqs.map(s => s.header + ':' + s.seq).join('|') + ' undo' + state.deletedHistory.length);
(async () => {
  const { server, baseUrl } = await start();
  const browser = await launch();
  const page = await browser.newPage();
  await page.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
  const out = {};
  for (const [name, open, modal] of [
      ['stats', () => document.getElementById('statsButton').click(), '#statsModal'],
      ['tree', () => document.getElementById('buildTreeButton').click(), '#treeBuilderModal'],
      ['dot', () => document.getElementById('dotPlotButton')?.click(), '#dotPlotModal']]) {
    await page.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
    await loadFasta(page, FA);
    await page.evaluate(() => { state.selectedRows = new Set([1]); renderAlignment(); });
    const before = await snap(page);
    await page.evaluate(open); await page.waitForTimeout(800);
    const info = await page.evaluate((m) => {
      const sels = [...document.querySelectorAll(m + ' select')].filter(s => s.getClientRects().length);
      if (!sels.length) return { n: 0 };
      sels[0].focus();
      return { n: sels.length, id: sels[0].id, focused: document.activeElement === sels[0], away: _alignmentKeysAway() };
    }, modal);
    const r = { info };
    if (info.n) {
      await page.keyboard.press('Control+u'); await page.waitForTimeout(200);
      r.afterU = await snap(page);
      await page.keyboard.press('Control+r'); await page.waitForTimeout(200);
      r.afterR = await snap(page);
      r.changed = r.afterR !== before;
    }
    r.before = before;
    out[name] = r;
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
