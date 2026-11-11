// Probe Q10: RNA alignment, undo history full (200 steps); type T over the only... (the same in-place row edit and
// row patch the Type tool does). Is the consensus still in U although the alignment now has a T?
const L = 'C:/work/MSA-viewer-new/tests/lib/';
const { start } = require(L + 'static-server');
const { launch, loadFasta } = require(L + 'browser');
const FA = '>a\nACGUACGUAA\n>b\nACGUACGUAA\n>c\nACGUACGUAA\n';
(async () => {
  const { server, baseUrl } = await start();
  const browser = await launch();
  const page = await browser.newPage();
  const out = {};
  for (const full of [false, true]) {
    await page.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
    await loadFasta(page, FA);
    out[full ? 'full' : 'notFull'] = await page.evaluate((full) => {
      const r = {};
      if (full) for (let i = 0; i < 205; i++) pushUndo('filler');
      r.cons0 = computeConsensusForSequences(state.seqs.map(s => s.seq));
      r.u0 = state.deletedHistory.length;
      // what handleGeneDocResidueKey does when the user types T into every U cell of the 3 rows
      for (let row = 0; row < 3; row++) {
        const before = state.seqs[row].seq; const after = before.replace(/U/g, 'T');
        state.seqs[row].seq = after;
        pushUndoRowPatch('geneDocResidueEdit', row, before, after, before.length, after.length, 'TypeResidue');
      }
      r.u1 = state.deletedHistory.length;
      r.rows = state.seqs.map(s => s.seq).join(',');
      r.isRnaNow = alignmentIsRna();
      r.cons1 = computeConsensusForSequences(state.seqs.map(s => s.seq));
      return r;
    }, full);
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
