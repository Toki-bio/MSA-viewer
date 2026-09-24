// Sort buttons: do the arrow labels render, and does each button sort correctly?
// Expected orders are computed here in Node from examples/svk_k4.fa, independently of script.js.
//   node scratch/_proof_sort_arrows.js            (Chrome)
//   BROWSER=firefox|webkit node scratch/_proof_sort_arrows.js
const fs = require('fs');
const path = require('path');
const { launch } = require('../tests/lib/browser');
const { start } = require('../tests/lib/static-server');

const recs = [];
for (const line of fs.readFileSync(path.join(__dirname, '..', 'examples', 'svk_k4.fa'), 'utf8').split(/\r?\n/)) {
  if (line.startsWith('>')) recs.push({ name: line.slice(1).trim().split(/\s+/)[0], seq: '' });
  else if (line.trim()) recs[recs.length - 1].seq += line.trim();
}
const ungappedLen = s => s.replace(/[-.]/g, '').length;
const identityTo = (ref, s) => { let m = 0, t = 0; for (let p = 0; p < ref.length; p++) { const a = ref[p], b = s[p] || '-'; if (a !== '-' && a !== '.' && b !== '-' && b !== '.') { t++; if (a === b) m++; } } return t ? m / t : 0; };

(async () => {
  const { server, baseUrl } = await start();
  const b = await launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
  await p.setInputFiles('#fileInput', path.join(__dirname, '..', 'examples', 'svk_k4.fa'));
  await p.waitForTimeout(2000);
  const ua = await p.evaluate(() => navigator.userAgent);
  const engine = /Firefox\/[\d.]+/.exec(ua)?.[0] || /Version\/[\d.]+ Safari/.exec(ua)?.[0] || /Chrome\/[\d.]+/.exec(ua)?.[0];

  // Open the Actions menu the way a user does, by hovering its header
  await p.hover('.section-header[data-section="actions"]');
  await p.waitForTimeout(400);
  const labels = await p.evaluate(() => ['sortByNameButton', 'sortByLengthButton', 'sortBySimButton'].map(id => {
    const e = document.getElementById(id); const r = e.getBoundingClientRect();
    return { id, text: e.textContent, codepoints: [...e.textContent].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' '), visible: r.width > 0 && r.height > 0 };
  }));
  const r0 = await p.locator('#sortByNameButton').boundingBox(), r2 = await p.locator('#sortBySimButton').boundingBox();
  const shot = path.join(__dirname, '_fig', `sort_buttons_${engine.replace(/[^A-Za-z0-9.]+/g, '_')}.png`);
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  await p.screenshot({ path: shot, clip: { x: r0.x - 6, y: r0.y - 6, width: r2.x + r2.width - r0.x + 12, height: r0.height + 12 } });

  const orderNow = () => p.evaluate(() => state.seqs.map(s => s.header));
  const results = [];
  let current = recs.map(r => r.name);
  const bySeq = Object.fromEntries(recs.map(r => [r.name, r.seq]));
  const clickAndCheck = async (id, expectFn) => {
    const expected = expectFn(current.slice());
    await p.click('#' + id);
    await p.waitForTimeout(500);
    const got = await orderNow();
    results.push({ button: id, match: JSON.stringify(got) === JSON.stringify(expected), first3: got.slice(0, 3) });
    current = got;
  };
  // Array.prototype.sort is stable, so ties keep the order they had before the click
  await clickAndCheck('sortByLengthButton', o => o.sort((a, b) => ungappedLen(bySeq[b]) - ungappedLen(bySeq[a])));
  await clickAndCheck('sortBySimButton', o => { const ref = bySeq[o[0]]; return o.sort((a, b) => identityTo(ref, bySeq[b]) - identityTo(ref, bySeq[a])); });
  await clickAndCheck('sortByNameButton', o => o.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));

  console.log(JSON.stringify({ engine, labels, results, screenshot: path.relative(path.join(__dirname, '..'), shot), pageErrors: errs }, null, 1));
  await b.close(); server.close();
})();
