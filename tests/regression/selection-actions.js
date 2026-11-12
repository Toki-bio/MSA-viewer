// Selections menu: Names / FASTA / Gather on the lines that stand for sequences (owner, 2026-11-12: Rows, Residues,
// Search hits; FASTA = whole rows as aligned, gaps kept; Gather = together under the topmost of them).
// The answers come from examples/svk_k4.fa read here, not from the viewer.
// Run: node tests/regression/selection-actions.js   (CHECK_FILTER="part of name" runs some)
const fs = require('fs');
const path = require('path');
const { start } = require('../lib/static-server');
const { launch, closeLaunched } = require('../lib/browser');

const FILE = 'examples/svk_k4.fa';
const REC = fs.readFileSync(path.join(__dirname, '..', '..', FILE), 'utf8').replace(/\r/g, '').trim().split('>').filter(Boolean)
    .map(b => { const [h, ...s] = b.split('\n'); return { h: h.trim(), s: s.join('').trim() }; });
const NAMES = REC.map(r => r.h);

const CHECKS = [];
const check = (name, fn) => CHECKS.push({ name, fn });

async function open(page, baseUrl) {
    await page.goto(baseUrl + '/index.html?url=' + FILE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof state !== 'undefined' && state.seqs.length > 0, null, { timeout: 20000 });
    await page.evaluate(() => { window.__copied = []; navigator.clipboard.writeText = t => { window.__copied.push(t); return Promise.resolve(); }; });
}
// select, then open the Selections menu the way a user does
async function selectAndOpen(page, how) {
    await page.evaluate(how);
    await page.evaluate(() => { _refreshRowColNucDom(); scheduleSelectionsPanelRefresh(); });
    await page.waitForTimeout(150);
    await page.click('.section-header[data-section="selections"]');
    await page.waitForTimeout(200);
}
const lineSel = (key) => `#selectionsList .sel-item[data-key="${key}"]`;
async function actions(page, key) {
    await page.click(`${lineSel(key)} .sel-more`);
    await page.waitForTimeout(150);
    return page.evaluate(() => [...document.querySelectorAll('#selectionsList .sel-actions button')].map(b => ({ t: b.textContent, d: b.disabled })));
}
const clickAction = (page, label) => page.locator('#selectionsList .sel-actions button', { hasText: label }).click();
const namesShown = (page) => page.evaluate(() => {
    const w = document.getElementById('selNamesWindow');
    return { vis: !!w && getComputedStyle(w).display !== 'none', text: document.getElementById('selNamesText')?.value };
});

check('rows: Names lists the selected sequences top to bottom', async (page, baseUrl) => {
    await open(page, baseUrl);
    await selectAndOpen(page, () => { state.selectedRows = new Set([30, 3, 12]); });
    const acts = await actions(page, 'rows');
    await clickAction(page, 'Names');
    await page.waitForTimeout(150);
    const n = await namesShown(page);
    const want = [3, 12, 30].map(i => NAMES[i]).join('\n');
    const okActs = JSON.stringify(acts) === JSON.stringify([{ t: 'Names', d: false }, { t: 'FASTA', d: false }, { t: 'Gather', d: false }]);
    return { pass: okActs && n.vis && n.text === want, detail: JSON.stringify({ acts, n, want }) };
});

check('rows: FASTA copies the whole rows as aligned, gaps kept', async (page, baseUrl) => {
    await open(page, baseUrl);
    await selectAndOpen(page, () => { state.selectedRows = new Set([30, 3, 12]); });
    await actions(page, 'rows');
    await clickAction(page, 'FASTA');
    await page.waitForTimeout(200);
    const got = await page.evaluate(() => window.__copied);
    const want = [3, 12, 30].map(i => `>${REC[i].h}\n${REC[i].s}`).join('\n');
    const gapped = [3, 12, 30].some(i => REC[i].s.includes('-'));
    return { pass: gapped && got.length === 1 && got[0] === want, detail: JSON.stringify({ gapped, got: got.map(t => t.slice(0, 120)), want: want.slice(0, 120) }) };
});

check('rows: Gather puts them together under the topmost, in order; the selection follows; Undo restores the order', async (page, baseUrl) => {
    await open(page, baseUrl);
    await selectAndOpen(page, () => { state.selectedRows = new Set([30, 3, 12]); });
    await actions(page, 'rows');
    await clickAction(page, 'Gather');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ order: state.seqs.map(q => q.header), sel: [...state.selectedRows].sort((a, b) => a - b).map(i => state.seqs[i].header) }));
    const members = [3, 12, 30].map(i => NAMES[i]);
    const want = [];
    NAMES.forEach((n, i) => { if (members.includes(n)) { if (i === 3) want.push(...members); } else want.push(n); });
    await page.click('#undoButton');
    await page.waitForTimeout(400);
    const undone = await page.evaluate(() => state.seqs.map(q => q.header));
    const ok = JSON.stringify(after.order) === JSON.stringify(want) && JSON.stringify(after.sel) === JSON.stringify(members) && JSON.stringify(undone) === JSON.stringify(NAMES);
    return { pass: ok, detail: JSON.stringify({ first8: after.order.slice(0, 8), want8: want.slice(0, 8), sel: after.sel, undoOk: JSON.stringify(undone) === JSON.stringify(NAMES) }) };
});

check('residues: Names lists the rows that hold selected residues', async (page, baseUrl) => {
    await open(page, baseUrl);
    await selectAndOpen(page, () => { state.selectedNucs = new Map([[20, new Set([5])], [7, new Set([10, 11])]]); });
    await actions(page, 'nucs');
    await clickAction(page, 'Names');
    await page.waitForTimeout(150);
    const n = await namesShown(page);
    const want = [7, 20].map(i => NAMES[i]).join('\n');
    return { pass: n.vis && n.text === want, detail: JSON.stringify({ n, want }) };
});

// a motif in some rows but not all, chosen here from the file
const MOTIF = (() => {
    const deg = REC.map(r => r.s.replace(/[-.]/g, '').toUpperCase());
    for (let i = 20; i < deg[0].length - 8; i++) {
        const m = deg[0].slice(i, i + 8);
        const k = deg.filter(s => s.includes(m)).length;
        if (k >= 8 && k <= 25) return m;
    }
    return null;
})();
check('search: Names lists exactly the rows with a match (forward strand, gaps ignored)', async (page, baseUrl) => {
    if (!MOTIF) return { pass: false, detail: 'no motif found for the test' };
    await open(page, baseUrl);
    await page.click('.section-header[data-section="search"]');
    await page.fill('#searchInput', MOTIF);
    await page.click('#searchButton');
    await page.waitForTimeout(500);
    await page.click('.section-header[data-section="selections"]');
    await page.waitForTimeout(200);
    const key = await page.evaluate(() => [...document.querySelectorAll('#selectionsList .sel-item')].map(e => e.dataset.key).find(k => k.startsWith('search:')));
    if (!key) return { pass: false, detail: 'no search line' };
    await actions(page, key);
    await clickAction(page, 'Names');
    await page.waitForTimeout(150);
    const n = await namesShown(page);
    const want = REC.filter(r => r.s.replace(/[-.]/g, '').toUpperCase().includes(MOTIF)).map(r => r.h).join('\n');
    return { pass: n.vis && n.text === want, detail: JSON.stringify({ MOTIF, got: (n.text || '').split('\n').length, want: want.split('\n').length }) };
});

check('a switched-off line has its actions disabled; Columns has none; Escape closes the names', async (page, baseUrl) => {
    await open(page, baseUrl);
    await selectAndOpen(page, () => { state.selectedRows = new Set([1, 2]); state.selectedColumns = new Set([4, 5]); });
    const colsMore = await page.locator(`${lineSel('cols')} .sel-more`).count();
    await actions(page, 'rows');
    await clickAction(page, 'Names');
    await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const closed = !(await namesShown(page)).vis;
    await page.locator(`${lineSel('rows')} input[type="checkbox"]`).click();
    await page.waitForTimeout(300);
    const dis = await page.evaluate(() => [...document.querySelectorAll('#selectionsList .sel-actions button')].map(b => b.disabled));
    return { pass: colsMore === 0 && closed && dis.length === 3 && dis.every(Boolean), detail: JSON.stringify({ colsMore, closed, dis }) };
});

(async () => {
    const { server, baseUrl } = await start();
    const filter = process.env.CHECK_FILTER ? process.env.CHECK_FILTER.toLowerCase() : null;
    const list = filter ? CHECKS.filter(c => c.name.toLowerCase().includes(filter)) : CHECKS;
    if (!list.length) { console.log(`no check matched CHECK_FILTER "${process.env.CHECK_FILTER}"`); server.close(); process.exit(1); }
    let fails = 0;
    for (const { name, fn } of list) {
        const t0 = Date.now(); let browser = null, out;
        try {
            browser = await launch({ canvasBlock: true });
            const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
            page.setDefaultTimeout(15000);
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            out = await fn(page, baseUrl);
            if (errors.length) out = { pass: false, detail: out.detail + ' errors: ' + errors.join(' | ') };
        } catch (e) { out = { pass: false, detail: 'threw: ' + e.message.split('\n')[0] }; }
        if (browser) await browser.close().catch(() => {});
        await closeLaunched(5000, []);
        console.log(`[${out.pass ? 'PASS' : 'FAIL'}] (${Date.now() - t0}ms) ${name}${out.pass ? '' : ' - ' + out.detail}`);
        if (!out.pass) fails++;
    }
    server.close();
    console.log(`\n${list.length - fails} of ${list.length} passed`);
    process.exit(fails ? 1 : 0);
})();
