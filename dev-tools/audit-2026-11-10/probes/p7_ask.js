// Probe: while the aligner's yes/no question (_mafftAskYesNo, used by codon mode and region realign) is up, do keys edit?
const L = 'C:/work/MSA-viewer-new/tests/lib/';
const { start } = require(L + 'static-server');
const { launch, loadFasta } = require(L + 'browser');
const FA = '>s0\nACGTACGTACGTAAAC\n>s1\nACGTTCGTACGTAAAC\n>s2\nACGTACGAACGTAAAC\n>s3\nACGTACGTACCTAAAC\n';
(async () => {
  const { server, baseUrl } = await start();
  const browser = await launch();
  const page = await browser.newPage();
  await page.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
  await loadFasta(page, FA);
  await page.evaluate(() => { state.selectedRows = new Set([1]); renderAlignment(); window.__ask = _mafftAskYesNo({ message: 'q?', defaultYes: false, dontAskKey: 'probeAsk', defaultKey: 'probeDef' }); });
  await page.waitForTimeout(300);
  const pre = await page.evaluate(() => ({ active: document.activeElement.textContent, away: _alignmentKeysAway(), rows: state.seqs.length }));
  await page.keyboard.press('Control+u'); await page.waitForTimeout(200);
  const post = await page.evaluate(() => ({ rows: state.seqs.length, undo: state.deletedHistory.map(h => h.type) }));
  console.log(JSON.stringify({ pre, post }));
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
