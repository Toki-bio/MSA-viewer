// Probe Q8b: codon aligner (fast engine and MACSE) on CDS rows where one row carries '*' and lower case.
const L = 'C:/work/MSA-viewer-new/tests/lib/';
const { start } = require(L + 'static-server');
const { launch, loadFasta } = require(L + 'browser');
const cds = 'ATGGCTAAAGGTCTGCTGGAAGCTCGTAAAGGTGAAGCTCTGGCTAAAGGTCTGTAA';
const FA = `>c1\n${cds}\n>c2\n${cds.slice(0, 20)}*${cds.slice(21)}\n>c3\n${cds.slice(0, 30).toLowerCase()}${cds.slice(30)}\n`;
(async () => {
  const { server, baseUrl } = await start();
  const browser = await launch();
  const page = await browser.newPage();
  page.on('dialog', d => d.accept());
  const out = {};
  for (const eng of ['fast', 'macse']) {
    await page.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
    await loadFasta(page, FA);
    const before = await page.evaluate(() => state.seqs.map(s => s.seq.replace(/[-.]/g, '')));
    await page.evaluate((eng) => { const s = document.getElementById('mafftSeqType'); s.value = 'codon'; s.dispatchEvent(new Event('change')); const e = document.getElementById('codonEngine'); if (e) { e.value = eng; e.dispatchEvent(new Event('change')); } window.__p = realignAll(); }, eng);
    await page.evaluate(() => window.__p);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ rows: state.seqs.map(s => s.seq.replace(/[-.]/g, '')), msg: document.getElementById('statusMessage').textContent.slice(0, 120), eng: document.getElementById('codonEngine')?.value }));
    out[eng] = { same: JSON.stringify(after.rows) === JSON.stringify(before), before, after };
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
