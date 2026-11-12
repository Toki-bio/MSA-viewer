// Worked examples ("Example ↗" pills and ?demo=<id>; owner, 2026-11-09). For every example: the page opened as the pill
// opens it (?url=<file>&title=&demo=<id>) loads the file, really runs the feature (its state is checked, not a flag the
// example code sets), shows a note that closes, and logs no error. One more check: each pill sits visibly in its panel or
// window and opens the right link in a new tab; and a file that fails to load shows the load error and no note.
// Run: node tests/regression/demos.js   (CHECK_FILTER="part of name" runs some)
// FILES mirrors DEMOS in script.js: change both when an example file changes.
const { start } = require('../lib/static-server');
const { launch, closeLaunched } = require('../lib/browser');

const FILES = {
    kmer: { file: 'examples/demo/alu_subfamilies.fa' },
    snp: { file: 'examples/demo/alu_subfamilies.fa' },
    bicluster: { file: 'examples/demo/alu_subfamilies.fa' },
    trim: { file: 'examples/svk_k4.fa' },
    autocolour: { file: 'examples/demo/alu_subfamilies.fa' },
    macse: { file: 'examples/demo/cmah_primates.fa' },
    codon: { file: 'examples/real/ncbi_NC_012920_human_mito.gb' },
    dotplot: { file: 'examples/demo/alu_copy.fa' },
    repeats: { file: 'examples/synthetic/synth_msa.fa' },
    resites: { file: 'examples/real/ncbi_NC_012920_human_mito.gb' },
    reads: { file: 'examples/synthetic/synth_ref.fa', reads: 'examples/synthetic/synth_reads.bam' },
    tree: { file: 'examples/demo/andricus_cytb.fa' },
};

// What each feature leaves behind when it really ran: read from the feature's own state and DOM
const PROBES = {
    kmer: () => {
        const m = state.clusterMap || {}, v = Object.values(m), groups = new Set(v.map(x => x.cluster).filter(c => c >= 0));
        return { ok: state.clusterSource === 'kmers' && v.length === state.seqs.length && groups.size >= 2, detail: { src: state.clusterSource, n: v.length, groups: groups.size } };
    },
    snp: () => {
        const v = Object.values(state.clusterMap || {}), groups = new Set(v.map(x => x.cluster).filter(c => c >= 0));
        return { ok: state.clusterSource === 'diagnostics' && groups.size >= 2, detail: { src: state.clusterSource, groups: groups.size, status: document.getElementById('clusteringStatus')?.textContent } };
    },
    bicluster: () => {
        const b = state.blockMask && state.blockMask.blocks;
        const status = document.getElementById('blockMaskStatus')?.textContent || '';
        return { ok: Array.isArray(b) && b.length > 0 && /rectangle/.test(status), detail: { blocks: b && b.length, status } };
    },
    trim: () => {
        const tb = state.trimBoundaries, L = state.seqs[0].seq.length;
        const from = document.getElementById('trimKeepFrom').value, to = document.getElementById('trimKeepTo').value;
        // a preview: something would be cut, and nothing was (svk_k4.fa has 231 columns)
        return { ok: !!tb && (tb.leftTrimEnd >= 0 || tb.rightTrimStart < L) && L === 231 && from !== '' && to !== '' && document.getElementById('showConsensus').checked, detail: { tb, L, from, to } };
    },
    autocolour: () => {
        const cols = new Set(colourState.mappings.values());
        return { ok: colourState.mappings.size === state.seqs.length && cols.size >= 2, detail: { mapped: colourState.mappings.size, colours: cols.size } };
    },
    macse: () => {
        const st = window._lastCodonAlignStats;
        return { ok: !!st && st.engine === 'macse' && document.getElementById('mafftSeqType').value === 'codon', detail: { engine: st && st.engine, type: document.getElementById('mafftSeqType').value } };
    },
    codon: () => {
        const cd = state._codonData;
        return { ok: document.getElementById('codonAnalysis').checked && !!cd && cd.genes > 0 && Array.isArray(cd.stops) && cd.stops[0].length > 0, detail: { genes: cd && cd.genes, stops: cd && cd.stops && cd.stops[0].length } };
    },
    dotplot: () => {
        const S = _dotPlotState, vis = getComputedStyle(document.getElementById('dotPlotModal')).display !== 'none';
        // matchMap: one byte per cell, non-zero where a word matches (a self plot has at least its diagonal)
        let dots = 0; if (S.matchMap) for (const v of S.matchMap) if (v) dots++;
        return { ok: vis && !S.computing && S.rows > 0 && S.cols > 0 && dots >= Math.min(S.rows, S.cols) / 2, detail: { vis, computing: S.computing, dots, rows: S.rows, cols: S.cols } };
    },
    repeats: () => {
        const vis = getComputedStyle(document.getElementById('repeatFinderModal')).display !== 'none';
        const rows = document.querySelectorAll('#repeatResults tbody tr').length;
        return { ok: vis && _lastRepeatResults.length > 0 && rows > 0, detail: { vis, results: _lastRepeatResults.length, rows } };
    },
    resites: () => {
        const labels = (state.searchHistory || []).map(h => h.label + ':' + h.matchCount);
        const has = n => (state.searchHistory || []).some(h => h.label.startsWith(n + ' ') && h.matchCount > 0);
        return { ok: has('EcoRI') && has('BamHI') && has('HindIII'), detail: labels };
    },
    reads: () => ({ ok: bamState.reads.length > 0 && document.getElementById('modeReads').checked, detail: { reads: bamState.reads.length, mode: document.getElementById('modeReads').checked } }),
    tree: () => {
        const vis = document.getElementById('treeBuilderModal').style.display !== 'none';
        const nwk = document.getElementById('treeNewickOutput');
        const t = (nwk && (nwk.value || nwk.textContent)) || '';
        return { ok: vis && /^\(.*\);?\s*$/s.test(t.trim()) && t.includes('JQ416415'), detail: { vis, nwk: t.slice(0, 60) } };
    },
};

const CHECKS = [];
const check = (name, fn) => CHECKS.push({ name, fn });

function demoQuery(id) {
    const f = FILES[id], q = new URLSearchParams();
    q.set('url', f.file);
    if (f.reads) q.set('reads', f.reads);
    q.set('title', 'test ' + id);
    q.set('demo', id);
    return q.toString();
}
// page errors and console errors, except the optional server's /api/ that the static test server does not have
function watchErrors(page) {
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => {
        if (m.type() !== 'error') return;
        const url = (m.location() && m.location().url) || '';
        if (/Failed to load resource/.test(m.text()) && /\/api\//.test(url)) return;
        errors.push('console: ' + m.text() + (url ? ' @ ' + url : ''));
    });
    return errors;
}
const loaded = (page, ms = 20000) => page.waitForFunction(() => typeof state !== 'undefined' && state.seqs.length > 0, null, { timeout: ms });

for (const id of Object.keys(FILES)) {
    check(`demo ${id}: the example loads its file, runs the feature, shows a note that closes, no errors`, async (page, baseUrl) => {
        const errors = watchErrors(page);
        await page.goto(baseUrl + '/index.html?' + demoQuery(id), { waitUntil: 'networkidle' });
        await loaded(page);
        const loadedOk = await page.evaluate(() => ({ n: state.seqs.length, name: state.currentFilename }));
        // the note comes when the analysis has finished (MACSE runs in a worker)
        await page.waitForSelector('#demoNote', { state: 'visible', timeout: 60000 });
        await page.waitForTimeout(300);
        const probe = await page.evaluate(`(${PROBES[id].toString()})()`);
        const note = await page.evaluate(() => {
            const n = document.getElementById('demoNote'), b = n.getBoundingClientRect(), x = document.getElementById('demoNoteClose');
            const de = document.documentElement;
            return { text: n.textContent.trim(), inView: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
                small: b.width * b.height < innerWidth * innerHeight / 6, closeLabel: x && x.getAttribute('aria-label'),
                page: [de.scrollWidth, de.scrollHeight] };
        });
        // close it with a real click
        const xb = await page.locator('#demoNoteClose').boundingBox();
        await page.mouse.click(xb.x + xb.width / 2, xb.y + xb.height / 2);
        await page.waitForTimeout(150);
        const gone = await page.evaluate(() => !document.getElementById('demoNote') || getComputedStyle(document.getElementById('demoNote')).display === 'none');
        // the note adds no scrolling to the page (the page's size is the same with it and without it)
        const pageAfter = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
        note.sameSize = note.page[0] === pageAfter[0] && note.page[1] === pageAfter[1];
        // the feature's result stays after the note is closed
        const after = await page.evaluate(`(${PROBES[id].toString()})()`);
        const ok = loadedOk.n > 0 && probe.ok && after.ok && note.text.length > 80 && note.inView && note.small && !!note.closeLabel && note.sameSize && gone && !errors.length;
        return { pass: ok, detail: JSON.stringify({ loadedOk, probe, note: { ...note, text: note.text.slice(0, 50) }, gone, errors }) };
    });
}

// Keyboard: the note's close button is reached with Tab and closes with Enter
check('demo note: the close button is reachable by keyboard and Enter closes the note', async (page, baseUrl) => {
    await page.goto(baseUrl + '/index.html?' + demoQuery('snp'), { waitUntil: 'networkidle' });
    await page.waitForSelector('#demoNote', { state: 'visible', timeout: 30000 });
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    let reached = false;
    for (let i = 0; i < 400 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate(() => document.activeElement && document.activeElement.id === 'demoNoteClose');
    }
    if (reached) await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const gone = await page.evaluate(() => !document.getElementById('demoNote'));
    return { pass: reached && gone, detail: JSON.stringify({ reached, gone }) };
});

// A file that does not load: the normal load error, and no example note
check('demo with a file that fails to load: the load error shows and no note', async (page, baseUrl) => {
    await page.goto(baseUrl + '/index.html?url=examples/no-such-file.fa&demo=snp', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const r = await page.evaluate(() => ({ note: !!document.getElementById('demoNote'), msg: document.getElementById('statusMessage')?.textContent || '', seqs: state.seqs.length }));
    return { pass: !r.note && /Failed to load URL/.test(r.msg) && r.seqs === 0, detail: JSON.stringify(r) };
});

// Every pill: present, visible and not covered in its panel or window, and opens ?url=<file>&demo=<id> in a new tab
check('demo pills: each Example button is visible in its panel and opens its example in a new tab', async (page, baseUrl) => {
    const bad = [], seen = [];
    for (const id of Object.keys(FILES)) {
        await page.goto(baseUrl + '/index.html?url=examples/svk_k4.fa', { waitUntil: 'networkidle' });
        await loaded(page);
        await page.evaluate(() => { window.__opened = []; window.open = (u, t, f) => { window.__opened.push([String(u), t, f]); return null; }; });
        const where = await page.evaluate((id) => {
            const p = document.querySelector(`.demo-pill[data-demo="${id}"]`);
            if (!p) return null;
            if (p.closest('#dotPlotModal')) return 'dotplot';
            if (p.closest('#repeatFinderModal')) return 'repeats';
            if (p.closest('#treeBuilderModal')) return 'tree';
            const sec = p.closest('.menu-section');
            return sec ? 'menu:' + sec.querySelector(':scope > .section-header').dataset.section : 'page';
        }, id);
        if (!where) { bad.push(`${id}: no pill`); continue; }
        // open what holds it, the way a user does
        if (where.startsWith('menu:')) await page.click(`.section-header[data-section="${where.slice(5)}"]`);
        else if (where === 'dotplot') await page.evaluate(async () => { const s = state.seqs[0], u = s.seq.replace(/-/g, ''); await openDotPlot(u, u, s.header, s.header, { rowIndexA: 0, rowIndexB: 0, alignedSeqA: s.seq, alignedSeqB: s.seq }); });
        else if (where === 'repeats') await page.click('#repeatFinderMenuButton', { force: true }).catch(() => page.evaluate(() => openRepeatFinder(0)));
        else if (where === 'tree') await page.evaluate(() => openTreeBuilder());
        await page.waitForTimeout(500);
        const pill = page.locator(`.demo-pill[data-demo="${id}"]`);
        const vis = await pill.evaluate(p => {
            const b = p.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
            const top = document.elementFromPoint(cx, cy);
            return { w: b.width, h: b.height, inView: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight,
                onTop: top === p || p.contains(top), label: p.getAttribute('aria-label'), text: p.textContent, clipped: p.scrollWidth > p.clientWidth + 1 };
        });
        if (!(vis.w > 0 && vis.h > 0 && vis.h <= 20 && vis.inView && vis.onTop && !vis.clipped && vis.label === 'Open a worked example in a new tab')) { bad.push(`${id}: ${JSON.stringify(vis)}`); continue; }
        const b = await pill.boundingBox();
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        await page.waitForTimeout(100);
        const opened = await page.evaluate(() => window.__opened);
        if (opened.length !== 1) { bad.push(`${id}: window.open called ${opened.length} times`); continue; }
        const [u, target, feat] = opened[0], url = new URL(u);
        const f = FILES[id];
        const okUrl = url.searchParams.get('demo') === id && url.searchParams.get('url') === f.file && (url.searchParams.get('reads') || null) === (f.reads || null)
            && !!url.searchParams.get('title') && url.origin + url.pathname === baseUrl + '/index.html' && target === '_blank' && /noopener/.test(feat || '');
        const status = await page.evaluate(async (p) => (await fetch(p)).status, f.file);
        if (!okUrl || status !== 200) bad.push(`${id}: opened ${u} ${target} ${feat}, file status ${status}`);
        else seen.push(id);
    }
    return { pass: !bad.length && seen.length === Object.keys(FILES).length, detail: bad.join(' | ') + ` (ok: ${seen.join(',')})` };
});

// ---- the Examples page (examples.html; owner, 2026-11-12) ------------------------------------------------------------
// Its synthetic examples are made by examples/gallery/make_gallery.js, which also writes truth.json: the answer each
// must give. Each check opens the example as the page's link does and compares what the viewer shows with that answer.
const GALLERY = {
    g_subfam: 'examples/gallery/subfamilies.fa',
    g_tree: 'examples/gallery/tree.fa',
    g_codon: 'examples/gallery/codons.fa',
    g_aa: 'examples/gallery/codons.fa',
    g_consensus: 'examples/gallery/consensus.fa',
};
const TRUTH = require('../../examples/gallery/truth.json');
const GPROBES = {
    // Cluster Now: exactly the three planted subfamilies, one colour each, nobody left over
    g_subfam: (T) => {
        const byName = {};
        for (const s of state.seqs) byName[s.header] = (state.clusterMap || {})[s.header];   // keyed by name: getSeqsForClustering gives each row id = its header
        const per = Object.entries(T.subfamilies.groups).map(([f, names]) => [f, [...new Set(names.map(n => byName[n] ? byName[n].cluster : 'none'))]]);
        const ids = per.map(([, c]) => c[0]);
        const ok = state.clusterSource === 'diagnostics' && per.every(([, c]) => c.length === 1 && c[0] >= 0) && new Set(ids).size === 3;
        return { ok, detail: { src: state.clusterSource, per } };
    },
    // NJ tree: every clade of the tree the sequences were made on is a branch of the tree shown
    g_tree: (T) => {
        const o = document.getElementById('treeNewickOutput');
        const nwk = ((o && (o.value || o.textContent)) || '').trim();
        const sets = []; const all = new Set();
        const stack = [[]];
        const names = nwk.replace(/:[-0-9.eE]+/g, '').replace(/;$/, '');
        let tok = '';
        const flush = () => { const n = tok.trim().replace(/^'|'$/g, ''); tok = ''; if (n) { stack[stack.length - 1].push(n); all.add(n); } };
        for (const ch of names) {
            if (ch === '(') { stack.push([]); }
            else if (ch === ',' ) { flush(); }
            else if (ch === ')') { flush(); const kid = stack.pop(); sets.push(kid.slice()); stack[stack.length - 1].push(...kid); }
            else tok += ch;
        }
        const key = (a) => a.slice().sort().join(',');
        const have = new Set(sets.map(key));
        const comp = (c) => [...all].filter(x => !c.includes(x));
        const missing = T.tree.clades.filter(c => !have.has(key(c)) && !have.has(key(comp(c))));
        const method = document.querySelector('input[name="treeMethod"]:checked')?.value;
        // rooted on the outgroup, so the drawing does not show Out inside one of the clades: Out hangs from the root
        const outAtRoot = /^\(\s*'?Out'?(:[-0-9.eE]+)?\s*,/.test(nwk) || /,\s*'?Out'?(:[-0-9.eE]+)?\s*\)\s*(:[-0-9.eE]+)?;?$/.test(nwk);
        return { ok: method === 'nj' && all.size === 9 && !missing.length && outAtRoot, detail: { method, leaves: all.size, missing, outAtRoot, nwk: nwk.slice(0, 80) } };
    },
    // Codon analysis: the planted changes are marked where they were planted, and nothing else in those rows before the frameshift
    g_codon: (T) => {
        const cd = state._codonData, C = T.codons;
        if (!document.getElementById('codonAnalysis').checked || !cd) return { ok: false, detail: 'codon analysis is off' };
        const row = (n) => state.seqs.findIndex(s => s.header === n);
        const marks = (n) => { const r = cd.synNonSyn[row(n)]; const o = {}; r.forEach((v, c) => { if (v) o[c + 1] = v; }); return o; };
        const syn = marks(C.synonymous.row), mis = marks(C.missense.row);
        const stops = (n) => cd.stops[row(n)].map(c => c + 1);
        const fs = (n) => cd.frameShifts[row(n)];
        const synOk = JSON.stringify(Object.keys(syn).map(Number)) === JSON.stringify(C.synonymous.columns1) && Object.values(syn).every(v => v === 'syn');
        const misOk = JSON.stringify(Object.keys(mis).map(Number)) === JSON.stringify(C.missense.columns1) && Object.values(mis).every(v => v !== 'syn' && v !== 'synmulti');
        const L = state.seqs[0].seq.length;
        const endStop = [L - 2, L - 1, L];
        const stopOk = JSON.stringify(stops(C.stop.row)) === JSON.stringify([...C.stop.columns1, ...endStop]) && JSON.stringify(stops('reference')) === JSON.stringify(endStop);
        const fsRow = fs(C.frameshift.row);
        const fsOk = fsRow.length >= 1 && Math.abs(fsRow[0].runStart + 1 - C.frameshift.column1) <= 1
            && ['reference', C.synonymous.row, C.missense.row, C.stop.row, C.codonDeleted.row].every(n => fs(n).length === 0);
        const delOk = Object.keys(marks(C.codonDeleted.row)).length === 0;
        return { ok: synOk && misOk && stopOk && fsOk && delOk, detail: { syn, mis, stops: stops(C.stop.row), fs: fsRow.map(f => f.runStart + 1), delOk } };
    },
    // AA only: the rows are shown as amino acids, and the reference reads as its planted protein
    g_aa: (T) => {
        const cd = state._codonData;
        const aa = cd ? cd.aaSeq[0].map(x => x.aa).join('') : '';
        return { ok: document.getElementById('aaOnly').checked && document.getElementById('codonAnalysis').checked && aa === T.codons.protein.reference, detail: { aa } };
    },
    // Consensus (Ambiguous) and shading: column by column as the zones were made
    g_consensus: (T) => {
        const cons = computeConsensusForSequences(state.seqs.map(s => s.seq));
        const len = state.seqs[0].seq.length, mode = document.querySelector('input[name="shadeMode"]:checked').value;
        const data = preCalculateConservation(state.seqs, len, mode);
        const b = +document.getElementById('blackInput').value, d = +document.getElementById('darkInput').value, l = +document.getElementById('lightInput').value;
        const shade = data.map(x => !x.hasData || !x.hasValidCoverage ? 'none' : x.conservation * 100 >= b ? 'black' : x.conservation * 100 >= d ? 'dark' : x.conservation * 100 >= l ? 'light' : 'none');
        const badShade = shade.map((s, i) => s === T.consensus.shading[i] ? null : `${i + 1}:${s}/${T.consensus.shading[i]}`).filter(Boolean);
        const type = document.querySelector('input[name="consensusType"]:checked').value;
        return { ok: type === 'ambiguous' && document.getElementById('showConsensus').checked && cons === T.consensus.consensusAmbiguous && !badShade.length,
            detail: { type, cons, want: T.consensus.consensusAmbiguous, badShade: badShade.slice(0, 8) } };
    },
};
for (const id of Object.keys(GALLERY)) {
    check(`examples page ${id}: the synthetic example opens, runs and shows what truth.json says it must; note, no errors`, async (page, baseUrl) => {
        const errors = watchErrors(page);
        const q = new URLSearchParams({ url: GALLERY[id], title: 'test ' + id, demo: id });
        await page.goto(baseUrl + '/index.html?' + q, { waitUntil: 'networkidle' });
        await loaded(page);
        await page.waitForSelector('#demoNote', { state: 'visible', timeout: 60000 });
        await page.waitForTimeout(300);
        const probe = await page.evaluate(`(${GPROBES[id].toString()})(${JSON.stringify(TRUTH)})`);
        const note = await page.evaluate(() => document.getElementById('demoNote').textContent.trim());
        // the AA note quotes the reference protein: it must be the one the file holds (the generator changes it when its draws change)
        const noteOk = note.length > 80 && (id !== 'g_aa' || note.includes(TRUTH.codons.protein.reference));
        return { pass: probe.ok && noteOk && !errors.length, detail: JSON.stringify({ probe, noteOk, note: note.slice(0, 40), errors }) };
    });
}

// The page lists every example, synthetic and real, and each link opens this viewer with an example that exists and a file that loads
check('examples page: lists every example; every link opens the viewer with a known example and a file that is there', async (page, baseUrl) => {
    const errors = watchErrors(page);
    const resp = await page.goto(baseUrl + '/examples.html', { waitUntil: 'networkidle' });
    if (!resp || resp.status() !== 200) return { pass: false, detail: 'examples.html status ' + (resp && resp.status()) };
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href*="demo="]')].map(a => ({ href: a.href, text: a.textContent.trim() })));
    const bad = [], ids = new Set();
    for (const { href } of links) {
        const u = new URL(href);
        const id = u.searchParams.get('demo'), f = u.searchParams.get('url');
        ids.add(id);
        const want = GALLERY[id] || (FILES[id] && FILES[id].file);
        if (u.origin + u.pathname !== baseUrl + '/index.html' || f !== want) { bad.push(`${id}: ${href}`); continue; }
        const st = await page.evaluate(async (p) => (await fetch(p)).status, f);
        if (st !== 200) bad.push(`${id}: file ${st}`);
    }
    const need = [...Object.keys(GALLERY), ...Object.keys(FILES)];
    const missing = need.filter(i => !ids.has(i));
    // phone width: no sideways scrolling
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(200);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    return { pass: !bad.length && !missing.length && !wide && !errors.length, detail: JSON.stringify({ bad, missing, wide, errors, n: links.length }) };
});

// The empty viewer says where the examples are, and the link opens examples.html in a new tab
check('examples page: the empty viewer links to it, in a new tab', async (page, baseUrl) => {
    await page.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
    const a = await page.evaluate(() => {
        const l = document.querySelector('#alignmentContainer a[href="examples.html"]');
        if (!l) return null;
        const b = l.getClientRects()[0], top = b && document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);   // first line box: a link that wraps has a hole in the middle of its bounding box
        return { text: l.textContent.trim(), target: l.target, rel: l.rel, visible: !!b && b.width > 0 && b.height > 0 && (top === l || l.contains(top)) };
    });
    return { pass: !!a && a.visible && a.target === '_blank' && /noopener/.test(a.rel) && /example/i.test(a.text), detail: JSON.stringify(a) };
});

// ---- the runner -------------------------------------------------------------------------------------------------------
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
            out = await fn(page, baseUrl);
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
