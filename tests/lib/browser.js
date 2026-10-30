// Shared headless-Chrome launch helper for the test suite. Drives an
// installed Chrome/Chromium directly via playwright-core, so the tests never
// download a browser (no full Playwright install needed).
const { chromium } = require('playwright-core');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/opt/pw-browsers/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function findChrome() {
  const fs = require('fs');
  // BROWSER_PATH=<exe> runs the suites in another Chromium (e.g. Edge)
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No local Chrome/Chromium/Edge found - set BROWSER_PATH=<executable> (see tests/lib/browser.js CHROME_CANDIDATES)');
}

// opts.scrollbars: show real scrollbars (headless Chrome hides them by default, so a layout that
// jumps when a scrollbar appears cannot be seen without this)
// Every browser launched here is remembered until it disconnects, so a runner can close what a
// timed-out check left open (a check that launches its own browser never reaches its finally)
const _launched = new Set();
async function launch(opts = {}) {
  // BROWSER=firefox uses Playwright's Firefox (one-time: npx playwright-core install firefox)
  // BROWSER=webkit uses Playwright's WebKit, the nearest to Safari on Windows
  let browser;
  if (process.env.BROWSER === 'firefox' || process.env.BROWSER === 'webkit') {
    browser = await require('playwright-core')[process.env.BROWSER].launch({ headless: true });
  } else {
    const extra = opts.scrollbars ? { ignoreDefaultArgs: ['--hide-scrollbars'] } : {};
    browser = await chromium.launch({ executablePath: findChrome(), headless: true, ...extra });
  }
  if (!opts.canvasBlock) _domBlockHook(browser);
  _launched.add(browser);
  browser.on('disconnected', () => _launched.delete(browser));
  return browser;
}
// The Block view is drawn by the Canvas renderer (Canvas Block). The checks written for the old
// DOM Block keep testing it: every page of a browser from launch() starts with
// window.__vaDomBlockForTests set, which makes the Block radio show the DOM Block (script.js
// _domBlockForTests, also ?view=domblock), whatever URL the check navigates to.
// launch({ canvasBlock: true }) leaves it out (checks of Canvas Block itself).
function _domBlockHook(browser) {
  const add = (ctx) => ctx.addInitScript(() => { window.__vaDomBlockForTests = true; });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => { const c = await newContext(...a); await add(c); return c; };
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...a) => { const p = await newPage(...a); await add(p.context()); return p; };
}
// Closes every browser still open except those in `keep` (each under its own time limit); returns how many were closed
async function closeLaunched(limitMs = 10000, keep = []) {
  let n = 0;
  const keepSet = new Set(keep);
  for (const b of [..._launched]) {
    if (keepSet.has(b)) continue;
    if (!b.isConnected()) { _launched.delete(b); continue; }
    n++;
    await Promise.race([b.close().catch(() => {}), new Promise(r => setTimeout(r, limitMs))]);
    _launched.delete(b);
  }
  return n;
}

// Generates a synthetic FASTA alignment of nSeq sequences x nCol columns.
// Deterministic (seeded by index), no randomness, so results are reproducible.
// Only used for small sizes passed directly as a string - see
// loadSyntheticFasta for large sizes, which builds the string inside the
// page instead of serializing it over CDP (multi-million-char page.evaluate
// arguments are slow to serialize as JSON across the CDP connection - this
// was measured directly: a 6M-residue regression check took 40+ minutes
// with the string built in Node and passed as an argument, vs seconds when
// built in-page).
function makeFasta(nSeq, nCol, alphabet = 'ACGT') {
  let fasta = '';
  for (let i = 0; i < nSeq; i++) {
    let s = '';
    for (let j = 0; j < nCol; j++) s += alphabet[(i * 7 + j) % alphabet.length];
    fasta += `>seq${i}\n${s}\n`;
  }
  return fasta;
}

// The "Large alignment, proceed?" dialog only ever appears above
// ALIGN_CRAZY_VOLUME. Waiting the full timeout on every small-alignment
// load/mode-switch (dialog never appears) was the dominant cost in the
// regression suite (a 3-mode-switch check took 62s doing this three times).
// Read the real threshold from the page and only wait for the dialog when
// the current alignment could plausibly trigger it.
async function _mightShowProceedDialog(page) {
  return page.evaluate(() => {
    try {
      const n = (state.seqs?.length || 0) * (state.seqs?.[0]?.seq?.length || 0);
      return typeof ALIGN_CRAZY_VOLUME === 'undefined' || n >= ALIGN_CRAZY_VOLUME * 0.9;
    } catch { return true; }
  }).catch(() => true);
}
async function _dismissProceedDialogIfPresent(page) {
  const timeout = (await _mightShowProceedDialog(page)) ? 8000 : 300;
  const dlg = await page.waitForSelector('#alignLoadProceed', { timeout }).then(() => true).catch(() => false);
  if (dlg) await page.click('#alignLoadProceed');
}

// Loads a FASTA string into the app via the same UI path a real user would
// use (textarea + parseAndRender), including the "Large alignment" proceed
// dialog if it appears. Assumes page is already navigated to the app.
async function loadFasta(page, fasta) {
  await page.evaluate((fasta) => {
    document.getElementById('fastaInput').value = fasta;
    window.__loadPromise = parseAndRender(false);
  }, fasta);
  await _dismissProceedDialogIfPresent(page);
  await page.evaluate(() => window.__loadPromise);
  await page.waitForTimeout(200);
}

// Same as loadFasta, but builds the synthetic FASTA string INSIDE the page
// (only nSeq/nCol cross the CDP boundary, not the multi-million-char
// string itself). Use this for any size that would produce a large string
// (roughly >500K residues) - see the comment on makeFasta above.
async function loadSyntheticFasta(page, nSeq, nCol, alphabet = 'ACGT') {
  await page.evaluate(({ nSeq, nCol, alphabet }) => {
    let fasta = '';
    for (let i = 0; i < nSeq; i++) {
      const chars = new Array(nCol);
      for (let j = 0; j < nCol; j++) chars[j] = alphabet[(i * 7 + j) % alphabet.length];
      fasta += `>seq${i}\n${chars.join('')}\n`;
    }
    document.getElementById('fastaInput').value = fasta;
    window.__loadPromise = parseAndRender(false);
  }, { nSeq, nCol, alphabet });
  // nSeq*nCol is known here without a page round-trip.
  const timeout = (nSeq * nCol >= 4_500_000) ? 8000 : 300;
  const dlg = await page.waitForSelector('#alignLoadProceed', { timeout }).then(() => true).catch(() => false);
  if (dlg) await page.click('#alignLoadProceed');
  await page.evaluate(() => window.__loadPromise);
  await page.waitForTimeout(200);
}

// block: the DOM Block on pages from launch() (window.__vaDomBlockForTests, see _domBlockHook);
// domblock says so explicitly (it also sets the flag on a page without the hook)
async function setMode(page, mode) {
  if (mode === 'domblock') { await page.evaluate(() => { _domBlockForTests = true; }); mode = 'block'; }
  const id = { full: 'modeSingle', block: 'modeBlocks', canvas: 'modeCanvas' }[mode];
  if (!id) throw new Error(`unknown mode: ${mode}`);
  // Full and Block ask "Full mode on a large alignment" for any tall (>500 rows), long (>3000
  // columns) or very large alignment (onModeChange), not only near ALIGN_CRAZY_VOLUME: wait for
  // that dialog whenever the page's own size classification says it comes, and for the switch.
  const asks = await page.evaluate((id) => {
    document.getElementById(id).checked = true;
    window.__modePromise = onModeChange();
    const idx = typeof state !== 'undefined' ? state.alignmentIndex : null;
    return id !== 'modeCanvas' && !!idx && !!(idx.isCrazy || idx.isTall || idx.isLong);
  }, id);
  if (asks) {
    const dlg = await page.waitForSelector('#alignLoadProceed', { timeout: 8000 }).then(() => true).catch(() => false);
    if (dlg) await page.click('#alignLoadProceed');
  } else {
    await _dismissProceedDialogIfPresent(page);
  }
  await page.evaluate(() => window.__modePromise);
  await page.waitForTimeout(200);
}

module.exports = { launch, closeLaunched, makeFasta, loadFasta, loadSyntheticFasta, setMode, findChrome };
