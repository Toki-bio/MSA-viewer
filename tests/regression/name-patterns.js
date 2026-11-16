// Colour Names -> Name patterns (owner, 2026-11-16): the list shows the obvious patterns in the names and
// colours the names by one of them. The answers are read here from the example files with plain regexes,
// not from the viewer.
// Run: node tests/regression/name-patterns.js   (CHECK_FILTER="part of name" runs some)
const fs = require('fs');
const path = require('path');
const { start } = require('../lib/static-server');
const { launch, closeLaunched } = require('../lib/browser');

const ROOT = path.join(__dirname, '..', '..');
const namesOf = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .filter(l => l.startsWith('>')).map(l => l.slice(1).trim());
// value -> count, from a regex over the names (group 1 is the value)
const tally = (names, re) => {
    const m = {};
    names.forEach(n => { const x = n.match(re); if (x) m[x[1]] = (m[x[1]] || 0) + 1; });
    return m;
};
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

const CHECKS = [];
const check = (name, fn) => CHECKS.push({ name, fn });

async function open(page, baseUrl, file) {
    await page.goto(baseUrl + '/index.html?url=' + file, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof state !== 'undefined' && state.seqs.length > 0, null, { timeout: 20000 });
}
async function openMenu(page) {
    await page.click('.section-header[data-section="colourseqs"]');
    await page.waitForTimeout(250);
}
// the list as shown: [{label, chips: {value: count}}]
const shown = (page) => page.evaluate(() => [...document.querySelectorAll('#namePatternsList .np-row')].map(r => ({
    label: r.querySelector('.np-label').textContent,
    chips: Object.fromEntries([...r.querySelectorAll('.np-chip')].map(c => [c.querySelector('.np-val').textContent, +c.querySelector('.np-n').textContent])),
})));
const rowWith = (list, want) => list.findIndex(r => same(r.chips, want));

// a file, and the pattern that must be in its list (value -> count), read from the names here
const CASES = [
    ['examples/svk_k4.fa', 'K1-K4', /^(K\d)_/],
    ['examples/gallery/subfamilies.fa', 'sfA/sfB/sfC', /^(sf[ABC])_/],
    ['examples/demo/alu_subfamilies.fa', 'AluY/AluSx/AluJb', /^(Alu[A-Za-z]+)_/],
    ['examples/demo/alu_subfamilies.fa', 'strand + / -', /\d([+-])$/],
    ['examples/demo/andricus_cytb.fa', 'mt / NUMT', /_(mt|NUMT)_/],
    ['examples/compat/fasta_ncbi_headers_dup.fa', 'alpha / beta', / synthetic (alpha|beta)_/],
];
for (const [file, what, re] of CASES) {
    check(`${file}: the list offers ${what}, with the right counts`, async (page, baseUrl) => {
        const want = tally(namesOf(file), re);
        await open(page, baseUrl, file);
        await openMenu(page);
        const list = await shown(page);
        const i = rowWith(list, want);
        return { pass: Object.keys(want).length >= 2 && i >= 0, detail: JSON.stringify({ want, list: list.map(r => r.label + ' ' + JSON.stringify(r.chips)) }).slice(0, 600) };
    });
}

check('_R_ at the start (MAFFT reverse complement) is offered on its own', async (page, baseUrl) => {
    await open(page, baseUrl, 'examples/demo/alu_subfamilies.fa');
    // every third name gets _R_, as MAFFT --adjustdirection writes it
    const names = namesOf('examples/demo/alu_subfamilies.fa').map((n, i) => (i % 3 === 0 ? '_R_' + n : n));
    const want = { '_R_': names.filter(n => n.startsWith('_R_')).length, 'no _R_': names.filter(n => !n.startsWith('_R_')).length };
    await page.evaluate((nm) => { state.seqs.forEach((q, i) => { q.header = q.fullHeader = nm[i]; }); renderAlignment(); }, names);
    await openMenu(page);
    const list = await shown(page);
    // the subfamily field must still be found under the _R_ prefix
    const fam = tally(names.map(n => n.replace(/^_R_/, '')), /^(Alu[A-Za-z]+)_/);
    return { pass: rowWith(list, want) >= 0 && rowWith(list, fam) >= 0, detail: JSON.stringify(list.map(r => r.label + ' ' + JSON.stringify(r.chips))).slice(0, 600) };
});

check('Colour paints each value of the pattern in its own colour; an unticked value stays uncoloured', async (page, baseUrl) => {
    const file = 'examples/svk_k4.fa';
    const names = namesOf(file);
    await open(page, baseUrl, file);
    await openMenu(page);
    const list = await shown(page);
    const i = rowWith(list, tally(names, /^(K\d)_/));
    if (i < 0) return { pass: false, detail: 'no K row' };
    const row = `#namePatternsList .np-row[data-p="${i}"]`;
    // untick K2
    const k2 = await page.evaluate((sel) => [...document.querySelectorAll(sel + ' .np-chip')].findIndex(c => c.querySelector('.np-val').textContent === 'K2'), row);
    await page.locator(`${row} .np-chip`).nth(k2).locator('input').click();
    await page.click(`${row} .np-apply`);
    await page.waitForTimeout(300);
    const got = await page.evaluate(() => state.seqs.map(q => [q.header, colourState.mappings.get(q.header) || null]));
    const colourOf = {};
    let ok = true;
    for (const [h, c] of got) {
        const k = h.match(/^(K\d)_/)[1];
        if (k === 'K2') { if (c) ok = false; continue; }
        if (!c) { ok = false; continue; }
        if (colourOf[k] && colourOf[k] !== c) ok = false;
        colourOf[k] = c;
    }
    const distinct = new Set(Object.values(colourOf)).size === 3;
    // the painted name cells show it
    const painted = await page.evaluate(() => [...document.querySelectorAll('.seq-name, .sequence-name, [data-row] .name')].length);
    return { pass: ok && distinct, detail: JSON.stringify({ colourOf, painted }) };
});

check('names with no shared parts: the list says there is nothing to offer', async (page, baseUrl) => {
    await open(page, baseUrl, 'examples/demo/alu_subfamilies.fa');
    // unique serial names, like the w12407 plate names
    await page.evaluate(() => { state.seqs.forEach((q, i) => { q.header = q.fullHeader = 'w' + (10007 + i * 7919 % 90000); }); renderAlignment(); });
    await openMenu(page);
    const t = await page.evaluate(() => document.getElementById('namePatternsList').textContent);
    return { pass: /No part of the names/.test(t), detail: t.slice(0, 200) };
});

check('the list follows a newly opened alignment', async (page, baseUrl) => {
    await open(page, baseUrl, 'examples/svk_k4.fa');
    await openMenu(page);
    const before = await shown(page);
    await open(page, baseUrl, 'examples/gallery/subfamilies.fa');
    await openMenu(page);
    const after = await shown(page);
    const want = tally(namesOf('examples/gallery/subfamilies.fa'), /^(sf[ABC])_/);
    return { pass: rowWith(after, want) >= 0 && rowWith(before, want) < 0, detail: JSON.stringify({ before: before.length, after: after.map(r => r.label) }) };
});

// GLM audit 2026-11-16: rows with one short name and different descriptions all got the last group's colour
check('rows sharing a short name across values are left uncoloured, not painted with the wrong colour', async (page, baseUrl) => {
    await open(page, baseUrl, 'examples/svk_k4.fa');
    const r = await page.evaluate(() => {
        const d = ['human', 'human', 'mouse', 'mouse', 'rat', 'rat'];
        state.seqs = state.seqs.slice(0, 6);
        // seq1 is both human and mouse; rat rows have names of their own
        const h = ['seq1', 'seq1', 'seq1', 'seq1', 'r5', 'r6'];
        state.seqs.forEach((q, i) => { q.header = h[i]; q.fullHeader = h[i] + ' ' + d[i]; });
        renderAlignment();
        refreshNamePatterns(true);
        const i = _namePatterns.list.findIndex(x => x.groups.some(g => g.value === 'human'));
        applyNamePattern(i);
        return { found: i >= 0, seq1: colourState.mappings.get('seq1') || null, r5: colourState.mappings.get('r5') || null, r6: colourState.mappings.get('r6') || null };
    });
    return { pass: r.found && r.seq1 === null && !!r.r5 && r.r5 === r.r6, detail: JSON.stringify(r) };
});

// GLM audit 2026-11-16: with the menu open, a newly loaded file left the old file's patterns on show
check('with Colour Names open, loading another file updates the list', async (page, baseUrl) => {
    await open(page, baseUrl, 'examples/svk_k4.fa');
    await openMenu(page);
    await page.evaluate(async () => {
        const t = await (await fetch('examples/gallery/subfamilies.fa')).text();
        const dt = new DataTransfer(); dt.items.add(new File([t], 'subfamilies.fa'));
        const inp = document.querySelector('input[type=file]'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => state.seqs.length === 30, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    const list = await shown(page);
    const want = tally(namesOf('examples/gallery/subfamilies.fa'), /^(sf[ABC])_/);
    return { pass: rowWith(list, want) >= 0, detail: JSON.stringify(list.map(r => r.label + ' ' + JSON.stringify(r.chips))).slice(0, 400) };
});

// ---- owner 2026-11-16 "do all 5, with test": names built here, the answer tallied here from the names ----
// put these definition lines on the rows (short name = first word, as the reader keeps it), then open the menu
async function withNames(page, baseUrl, lines) {
    await open(page, baseUrl, 'examples/svk_k4.fa');
    await page.evaluate((L) => {
        const base = state.seqs;
        state.seqs = L.map((l, i) => Object.assign({}, base[i % base.length], { header: l.split(/\s/)[0], fullHeader: l }));
        renderAlignment();
    }, lines);
    await openMenu(page);
    return shown(page);
}
const rows = (list) => list.map(r => r.label + ' ' + JSON.stringify(r.chips)).join(' || ').slice(0, 700);

check('1a: a field counted from the end (names of different length end in _seed1/_seed2)', async (page, baseUrl) => {
    const pre = ['MEG-RL', 'consensus_12seqs', 'r1_r3_P1_hla020', 'r9_ext', 'r10_r8_P18del'];
    const L = [];
    for (let i = 0; i < 40; i++) L.push(`${pre[i % 5]}_${i}_seed${1 + (Math.floor(i / 5) % 2)}`);
    const list = await withNames(page, baseUrl, L);
    return { pass: rowWith(list, tally(L, /_(seed\d)$/)) >= 0, detail: rows(list) };
});

check('1b: key=value is a field of its own, wherever it stands (family=)', async (page, baseUrl) => {
    const F = ['Squam1', 'Squam1', 'Squam3', 'Oph', 'Squam1'];
    const L = [];
    for (let i = 0; i < 30; i++) L.push(`s${i} ${i % 3 ? '' : 'aliases=SINE-1_Pmo,SINE3 '}family=${F[i % 5]} id=SCKB${1000 + i}`);
    const list = await withNames(page, baseUrl, L);
    const i = rowWith(list, tally(L, /family=(\S+)/));
    return { pass: i >= 0 && /family=/.test(list[i].label), detail: rows(list) };
});

check('1c: a value with "_" inside (B2_Mm2_chr19_...) is offered whole', async (page, baseUrl) => {
    const fam = ['B3', 'B2_Mm2', 'B3A', 'B2_Mm1t'], cnt = [12, 10, 8, 6];
    const L = [];
    fam.forEach((f, k) => { for (let j = 0; j < cnt[k]; j++) L.push(`${f}_chr19_${3000 + 977 * L.length}_${3200 + 977 * L.length}`); });
    const list = await withNames(page, baseUrl, L);
    return { pass: rowWith(list, tally(L, /^(.+?)_chr19_/)) >= 0, detail: rows(list) };
});

check('2: more than 12 values (17 chromosomes): the 12 largest are offered, and the label says so', async (page, baseUrl) => {
    const L = [];
    for (let k = 1; k <= 17; k++) for (let j = 0; j < 19 - k; j++) L.push(`chr${k}:${1000 + 37 * L.length}-${1300 + 37 * L.length}(${L.length % 2 ? '+' : '-'})`);
    const all = tally(L, /^(chr\d+):/);
    const top = Object.fromEntries(Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 12));
    const list = await withNames(page, baseUrl, L);
    const i = rowWith(list, top);
    return { pass: i >= 0 && /12 largest of 17/.test(list[i].label), detail: rows(list) };
});

check('3: a [tag] only some names carry is offered, and the strand is still found behind it', async (page, baseUrl) => {
    const L = [];
    for (let i = 0; i < 45; i++) L.push(`${i % 7 ? '' : '_R_'}NC_1425${10 + (i % 4)}.1:${1000 + 91 * i}-${1400 + 91 * i}(${i % 5 < 2 ? '-' : '+'})${i % 3 ? '' : ' [soft]'}`);
    const list = await withNames(page, baseUrl, L);
    const tag = { '[soft]': L.filter(l => /\[soft\]/.test(l)).length, 'no [soft]': L.filter(l => !/\[soft\]/.test(l)).length };
    const strand = tally(L, /\(([+-])\)/);
    const ti = rowWith(list, tag), si = rowWith(list, strand);
    return { pass: ti >= 0 && si >= 0 && /tag/.test(list[ti].label) && /strand/.test(list[si].label), detail: rows(list) };
});

check('4a: free-text descriptions: the genus first, no rows of sentence words', async (page, baseUrl) => {
    const G = ['Thermocyclops', 'Cyclops', 'Mesocyclops'];
    const tail = ['18S ribosomal RNA gene, partial sequence', 'small subunit ribosomal RNA gene, partial sequence',
        'isolate T12 18S small subunit ribosomal RNA gene', 'voucher NTU 2 18S ribosomal RNA gene, partial sequence'];
    const L = [];
    for (let i = 0; i < 36; i++) L.push(`${['HQ', 'GQ', 'KP', 'LC'][i % 4]}${845900 + 13 * i}.1 ${G[i % 3]} sp${i % 5} ${tail[(i * 7) % 4]}`);
    const list = await withNames(page, baseUrl, L);
    const g = rowWith(list, tally(L, /^\S+ (\w+)/));
    const junk = list.filter(r => Object.keys(r.chips).some(v => /^(ribosomal|RNA|subunit|gene|partial|small|18S)$/.test(v)));
    return { pass: g === 0 && junk.length === 0, detail: rows(list) };
});

check('4b: ranking: in the Alu demo the subfamily comes before the strand; a one-sided _R_ comes after the strand', async (page, baseUrl) => {
    const file = 'examples/demo/alu_subfamilies.fa';
    await open(page, baseUrl, file);
    await openMenu(page);
    const list = await shown(page);
    const fam = rowWith(list, tally(namesOf(file), /^(Alu[A-Za-z]+)_/)), str = rowWith(list, tally(namesOf(file), /\d([+-])$/));
    const L = [];
    for (let i = 0; i < 50; i++) L.push(`${i < 2 ? '_R_' : ''}CM0631${i % 9}.1:${1000 + 77 * i}-${1400 + 77 * i}(${i % 2 ? '+' : '-'})`);
    const list2 = await withNames(page, baseUrl, L);
    const s2 = list2.findIndex(r => /strand/.test(r.label)), r2 = list2.findIndex(r => /_R_/.test(r.label));
    return { pass: fam === 0 && str > fam && s2 >= 0 && (r2 < 0 || r2 > s2), detail: JSON.stringify({ fam, str, s2, r2 }) + ' ' + rows(list2) };
});

check('5: digits are ignored only in values seen once (B2 and B3 stay apart; dup1..dup6 -> dup#)', async (page, baseUrl) => {
    const L = [];
    for (let i = 0; i < 5; i++) L.push(`B2_x${i}`, `B3_x${i}`, `ID_x${i}`);
    const list = await withNames(page, baseUrl, L);
    const merged = list.filter(r => Object.keys(r.chips).some(v => /^B#$/.test(v)));
    const L2 = [];
    for (let i = 0; i < 6; i++) L2.push(`f0_c${i}`, `f1_c${i}`, `f2_c${i}`, `dup${30 + i}`);
    const list2 = await withNames(page, baseUrl, L2);
    const want = { 'dup#': 6, f0: 6, f1: 6, f2: 6 };
    return { pass: merged.length === 0 && rowWith(list, tally(L, /^(B\d|ID)_/)) >= 0 && rowWith(list2, want) >= 0, detail: rows(list) + ' ## ' + rows(list2) };
});

// tester 2026-11-16: opened with the keyboard (Tab to the header, Enter), the list was empty
check('opened with the keyboard, the menu shows the list', async (page, baseUrl) => {
    await open(page, baseUrl, 'examples/svk_k4.fa');
    await page.mouse.move(5, 890);
    const HDR = '.section-header[data-section="colourseqs"]';
    let hops = 0;
    for (; hops < 80; hops++) {
        await page.keyboard.press('Tab');
        if (await page.evaluate((s) => document.activeElement === document.querySelector(s), HDR)) break;
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const list = await shown(page);
    return { pass: hops < 80 && rowWith(list, tally(namesOf('examples/svk_k4.fa'), /^(K\d)_/)) >= 0, detail: JSON.stringify({ hops, list }) };
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
