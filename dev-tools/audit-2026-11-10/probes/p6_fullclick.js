// Probe Q2 in Full and DOM Block: focus on a Stats button, then a plain click on a residue span (and a Canvas residue).
const L = 'C:/work/MSA-viewer-new/tests/lib/';
const { start } = require(L + 'static-server');
const { launch, loadFasta, setMode } = require(L + 'browser');
let FA = ''; for (let i = 0; i < 6; i++) FA += `>s${i}\n` + 'ACGTACGTACGTAAACACGTACGTACGTAAAC'.repeat(3) + '\n';
(async () => {
  const { server, baseUrl } = await start();
  const browser = await launch({ canvasBlock: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const out = [];
  for (const mode of ['full', 'canvas', 'block']) {
    for (const mods of [[], ['Control'], ['Shift']]) {
      await page.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
      await loadFasta(page, FA);
      await setMode(page, mode); await page.waitForTimeout(400);
      await page.evaluate(() => document.getElementById('statsButton').click()); await page.waitForTimeout(800);
      await page.evaluate(() => { const b = [...document.querySelectorAll('#statsModal button')].find(x => x.getClientRects().length); b.focus(); });
      const pt = await page.evaluate(() => {
        const w = document.getElementById('statsModal');
        const spans = [...document.querySelectorAll('#alignmentContainer .seq-data span, #alignmentContainer canvas')].filter(x => x.getClientRects().length);
        for (const s of spans) { const r = s.getBoundingClientRect(); const x = r.left + Math.min(r.width / 2, 60), y = r.top + Math.min(r.height / 2, 60); const h = document.elementFromPoint(x, y); if (h && !w.contains(h) && (h === s || s.contains(h))) return { x, y, tag: h.tagName + '.' + h.className }; }
        return null;
      });
      let post = null;
      if (pt) {
        for (const m of mods) await page.keyboard.down(m);
        await page.mouse.click(pt.x, pt.y);
        for (const m of mods) await page.keyboard.up(m);
        await page.waitForTimeout(200);
        post = await page.evaluate(() => ({ active: document.activeElement.id || document.activeElement.tagName, away: _alignmentKeysAway(), selNucs: state.selectedNucs.size }));
      }
      out.push({ mode, mods: mods.join('+') || 'plain', pt: pt && pt.tag, post });
    }
  }
  console.log(out.map(o => JSON.stringify(o)).join('\n'));
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
