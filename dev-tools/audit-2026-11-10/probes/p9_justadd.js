// Probe Q7: Add Sequences "align to consensus" (no busy overlay). The user closes the dialog and edits (Ctrl+U) while it
// runs; the stale path pops the top undo step: whose?
const L = 'C:/work/MSA-viewer-new/tests/lib/';
const { start } = require(L + 'static-server');
const { launch, loadFasta } = require(L + 'browser');
const big = () => { let x = 7; const r = () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; let base = ''; for (let i = 0; i < 4000; i++) base += 'ACGT'[Math.floor(r() * 4)]; let f = '', add = ''; for (let i = 0; i < 46; i++) { let q = ''; for (let j = 0; j < base.length; j++) { const u = r(); q += u < 0.06 ? 'ACGT'[Math.floor(r() * 4)] : u < 0.09 ? '' : base[j]; } if (i < 40) f += `>s${i}\n${q}\n`; else add += `>a${i}\n${q}\n`; } return { f, add }; };
(async () => {
  const { server, baseUrl } = await start();
  const browser = await launch();
  const page = await browser.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
  const { f, add } = big();
  await loadFasta(page, f);
  await page.evaluate((add) => {
    pushUndo('user-earlier-edit');
    state.selectedRows = new Set([3]); renderAlignment();
    openAddSequencesModal();
    document.getElementById('addSeqInput').value = add;
    const cb = document.getElementById('addSeqAlignCons'); if (cb) cb.checked = true;
    window.__t0 = performance.now();
    window.__p = addSequencesJustAdd().then(() => { window.__done = performance.now() - window.__t0; });
  }, add);
  await page.waitForTimeout(150);
  const during = await page.evaluate(() => ({ done: window.__done, modal: document.getElementById('addSeqModal').style.display }));
  await page.evaluate(() => closeAddSequencesModal());
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+u'); await page.waitForTimeout(100);
  const afterKey = await page.evaluate(() => ({ rows: state.seqs.length, undo: state.deletedHistory.map(h => h.type).slice(-4), done: window.__done }));
  await page.evaluate(() => window.__p);
  const end = await page.evaluate(() => ({ rows: state.seqs.length, undo: state.deletedHistory.map(h => h.type).slice(-4), msg: document.getElementById('statusMessage').textContent.slice(0, 110), ms: Math.round(window.__done) }));
  console.log(JSON.stringify({ during, afterKey, end }, null, 1));
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
