// Screenshots of the prototype next to DOM Block and Canvas, same fixture and viewport.
const { serve, launch, openView } = require('./common');
const path = require('path');
(async () => {
  const fx = process.argv[2] || 'aln600x600.fas';
  const { srv, base } = await serve();
  const browser = await launch(!!process.env.HEADFUL);
  for (const view of ['cblock', 'block', 'canvas']) {
    const page = await openView(browser, base, fx, view);
    const info = await page.evaluate(() => ({ L: _canvasState.layout, slider: el('blockSizeSlider').value, canvas: !!document.getElementById('alignmentCanvas'), err: null }));
    console.log(view, JSON.stringify(info));
    await page.screenshot({ path: path.join(__dirname, `shot_${fx.replace('.fas', '')}_${view}.png`) });
    if (view === 'cblock') {
      await page.mouse.move(800, 500); await page.mouse.wheel(0, 2000); await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(__dirname, `shot_${fx.replace('.fas', '')}_${view}_scrolled.png`) });
    }
    await page.close();
  }
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
