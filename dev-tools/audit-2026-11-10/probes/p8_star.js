// Probe Q8: '*' kept through Add & Align when names carry descriptions / repeat; new rows pasted with gaps.
const L = 'C:/work/MSA-viewer-new/tests/lib/';
const { start } = require(L + 'static-server');
const { launch, loadFasta } = require(L + 'browser');
const FA = '>p1 first protein\nMKVLA*GHHEE\n>p2 second one\nMKVLAQGHHEE\n>p1 first protein\nMKVIAQGHHE*\n';
(async () => {
  const { server, baseUrl } = await start();
  const browser = await launch();
  const page = await browser.newPage();
  page.on('dialog', d => d.accept());
  const res = {};
  for (const add of ['>n1 new\nMKVLA*GHH\n', '>n1 new\nMK-VLA*GHH\n']) {
    await page.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
    await loadFasta(page, FA);
    await page.evaluate((add) => { document.getElementById('addSeqInput').value = add; addSequencesAndAlign(); }, add);
    await page.waitForFunction(() => { const b = document.getElementById('busyOverlay'); return !b || b.hidden; }, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    res[add.replace(/\n/g, '|')] = await page.evaluate(() => ({ rows: state.seqs.map(s => s.fullHeader + ': ' + s.seq), msg: document.getElementById('statusMessage').textContent.slice(0, 120) }));
  }
  console.log(JSON.stringify(res, null, 1));
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
