const L = 'C:/work/MSA-viewer-new/tests/lib/';
const { start } = require(L + 'static-server');
const { launch, loadFasta } = require(L + 'browser');
const FA = '>s0\nACGTACGTACGTAAAC\n>s1\nACGTTCGTACGTAAAC\n>s2\nACGTACGAACGTAAAC\n>s3\nACGTACGTACCTAAAC\n';
const big = () => { let x = 7; const r = () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; let base = ''; for (let i = 0; i < 1500; i++) base += 'ACGT'[Math.floor(r() * 4)]; let f = ''; for (let i = 0; i < 40; i++) { let q = ''; for (let j = 0; j < base.length; j++) { const u = r(); q += u < 0.06 ? 'ACGT'[Math.floor(r() * 4)] : u < 0.09 ? '' : base[j]; } f += `>s${i}\n${q}\n`; } return f; };
const busy = (page) => page.waitForFunction(() => { const b = document.getElementById('busyOverlay'); return !!b && !b.hidden; }, null, { timeout: 15000 });
const idle = (page) => page.waitForFunction(() => { const b = document.getElementById('busyOverlay'); return !b || b.hidden; }, null, { timeout: 180000 });
const swap = (page) => page.evaluate(() => { const a = state.seqs[4]; state.seqs[4] = state.seqs[5]; state.seqs[5] = a; });
(async () => {
  const { server, baseUrl } = await start();
  const browser = await launch();
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss());
  const out = {};
  const go = async (fa) => { await page.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' }); await loadFasta(page, fa); };
  // (a) Ctrl+A with focus on a drop-down inside the Tree window
  await go(FA);
  await page.evaluate(() => { state.selectedRows = new Set([1]); renderAlignment(); document.getElementById('buildTreeButton').click(); });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.getElementById('treeDistanceModel').focus());
  await page.keyboard.press('Control+a'); await page.waitForTimeout(200);
  out.ctrlA = await page.evaluate(() => ({ away: _alignmentKeysAway(), rows: [...state.selectedRows] }));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
  // (b) Escape during a run
  await go(big());
  await page.evaluate(() => { state.selectedRows = new Set([5, 6]); renderAlignment(); document.getElementById('realignSelectedButton').click(); });
  await busy(page);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  out.escDuringRun = await page.evaluate(() => ({ busy: !document.getElementById('busyOverlay').hidden, rows: [...state.selectedRows] }));
  await idle(page);
  // (c) rows changed during a region realign: which message?
  await go(big());
  await page.evaluate(() => { state.selectedColumns = new Set(Array.from({ length: 1200 }, (_, i) => i + 10)); renderAlignment(); realignSelectedBlock({ skipPrompt: true, applyAdjustFull: true, applyReorder: false }); });
  await busy(page); await swap(page); await idle(page); await page.waitForTimeout(300);
  out.regionStale = await page.evaluate(() => ({ msg: document.getElementById('statusMessage').textContent.slice(0, 100) }));
  // (d) Add & Align: rows changed during the run -> undo steps left
  await go(big());
  const u0 = await page.evaluate(() => state.deletedHistory.length);
  await page.evaluate(() => { const t = document.getElementById('addSeqInput'); t.value = '>new1\nACGTACGTACGTAGCTAGCTAGCATCGATCGATCGTACGTAGCTAGCTAG\n'; addSequencesAndAlign(); });
  await busy(page); await swap(page); await idle(page); await page.waitForTimeout(300);
  out.addStale = await page.evaluate((u0) => ({ undoDelta: state.deletedHistory.length - u0, rows: state.seqs.length, msg: document.getElementById('statusMessage').textContent.slice(0, 100), lastType: state.deletedHistory.at(-1)?.type }), u0);
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
