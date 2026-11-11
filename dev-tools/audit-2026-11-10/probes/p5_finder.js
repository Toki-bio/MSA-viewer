// Probe: during Realign Selected (busy overlay up), Ctrl+K opens the function finder; typing a command and Enter runs it.
const L = 'C:/work/MSA-viewer-new/tests/lib/';
const { start } = require(L + 'static-server');
const { launch, loadFasta } = require(L + 'browser');
const big = () => { let x = 7; const r = () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; let base = ''; for (let i = 0; i < 4000; i++) base += 'ACGT'[Math.floor(r() * 4)]; let f = ''; for (let i = 0; i < 40; i++) { let q = ''; for (let j = 0; j < base.length; j++) { const u = r(); q += u < 0.06 ? 'ACGT'[Math.floor(r() * 4)] : u < 0.09 ? '' : base[j]; } f += `>s${i}\n${q}\n`; } return f; };
(async () => {
  const { server, baseUrl } = await start();
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
  await loadFasta(page, big());
  const names = await page.evaluate(() => window.ViewAlignFinder ? ViewAlignFinder.list().filter(x => /duplicat|reverse comp|delete sel/i.test(x.name)).map(x => x.name + ' [' + x.kind + ',' + x.ok + ']') : 'no finder');
  await page.evaluate(() => { state.selectedRows = new Set(Array.from({length: 40}, (_, i) => i)); renderAlignment(); });
  const n0 = await page.evaluate(() => state.seqs.length);
  await page.evaluate(() => document.getElementById('realignSelectedButton').click());
  await page.waitForFunction(() => { const b = document.getElementById('busyOverlay'); return !!b && !b.hidden; }, null, { timeout: 15000 });
  await page.keyboard.press('Control+k'); await page.waitForTimeout(200);
  const focusAfterK = await page.evaluate(() => document.activeElement.id);
  await page.keyboard.type('Duplicate'); await page.waitForTimeout(300);
  const shown = await page.evaluate(() => [...document.querySelectorAll('#finderList .finder-row')].slice(0, 3).map(r => r.textContent.slice(0, 50)));
  const busyBeforeEnter = await page.evaluate(() => !document.getElementById('busyOverlay').hidden); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const mid = await page.evaluate(() => ({ busy: !document.getElementById('busyOverlay').hidden, rows: state.seqs.length, undo: state.deletedHistory.map(h => h.type).slice(-3) }));
  await page.waitForFunction(() => { const b = document.getElementById('busyOverlay'); return !b || b.hidden; }, null, { timeout: 180000 });
  await page.waitForTimeout(400);
  const end = await page.evaluate(() => ({ rows: state.seqs.length, msg: document.getElementById('statusMessage').textContent.slice(0, 100) }));
  console.log(JSON.stringify({ busyBeforeEnter, names, n0, focusAfterK, shown, mid, end }, null, 1));
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
