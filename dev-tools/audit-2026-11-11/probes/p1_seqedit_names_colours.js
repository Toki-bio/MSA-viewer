// Browser probe (NOT RUN yet: a browser test suite was running on this machine). Settles, through the user path:
//  q15b #0  Sequence editor Apply renames a row whose name is not the first word of its long name
//           (NEXUS "Homo_sapiens" / "Homo sapiens" becomes "Homo"; its name colour is left under the old name).
//  q15b #2  multi-row editor: a record line ">" with no name gives the row an empty name.
//  q17 #0   Rename A -> B while another row is named B; Undo: the other B row keeps A's colour, not its own.
// Expected on 9688515 if the findings are right: printed values marked "<-- defect".
//   node dev-tools/audit-2026-11-11/probes/p1_seqedit_names_colours.js
const L = require('path').join(__dirname, '../../../tests/lib/');
const { start } = require(L + 'static-server');
const { launch, loadFasta } = require(L + 'browser');
const FA = '>s0\nACGTACGTAC\n>s1\nACGTTCGTAC\n>s2\nACGTACGAAC\n>B\nACGTACGTAA\n';
(async () => {
    const { server, baseUrl } = await start();
    const browser = await launch();
    const page = await browser.newPage();
    page.on('dialog', d => d.dismiss());
    await page.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
    await loadFasta(page, FA);

    // q15b #0: give row 0 a NEXUS-style name pair, colour it, edit one residue in the editor, Apply
    await page.evaluate(() => {
        state.seqs[0].header = 'Homo_sapiens'; state.seqs[0].fullHeader = 'Homo sapiens';
        colourState.mappings.set('Homo_sapiens', '#ff0000');
        renderAlignment();
        openSeqEditor(0);
        const t = document.getElementById('seqEditTextarea');
        t.value = t.value.replace(/\nA/, '\nT');
    });
    await page.click('#seqEditApplyBtn');
    await page.waitForTimeout(300);
    const r0 = await page.evaluate(() => ({ header: state.seqs[0].header, full: state.seqs[0].fullHeader,
        colourNew: colourState.mappings.get(state.seqs[0].header) || null }));
    console.log('q15b#0', JSON.stringify(r0), r0.header !== 'Homo_sapiens' ? '<-- defect: renamed by an edit' : 'ok');

    // q15b #2: multi editor, first record's ">" line emptied
    await page.evaluate(() => {
        state.selectedRows = new Set([1, 2]); renderAlignment();
        openSeqEditor();
        const t = document.getElementById('seqEditTextarea');
        t.value = t.value.replace(/^>[^\n]*/, '>');
    });
    await page.click('#seqEditApplyBtn');
    await page.waitForTimeout(300);
    const r1 = await page.evaluate(() => JSON.stringify(state.seqs[1].header));
    console.log('q15b#2 row 1 name', r1, r1 === '""' ? '<-- defect: empty name' : 'ok');

    // q17 #0: B is red; s2 is blue; rename s2 -> B; Undo; colour of the original B row
    await page.evaluate(() => {
        colourState.mappings.set('B', '#ff0000'); colourState.mappings.set('s2', '#0000ff');
        _commitSeqRename(2, 'B');
    });
    const afterRename = await page.evaluate(() => colourState.mappings.get('B'));
    await page.evaluate(() => undoDelete());
    const afterUndo = await page.evaluate(() => ({ B: colourState.mappings.get('B'), s2: colourState.mappings.get('s2'),
        names: state.seqs.map(q => q.header) }));
    console.log('q17#0', JSON.stringify({ afterRename, afterUndo }),
        afterUndo.B !== '#ff0000' ? '<-- defect: original B lost its colour after Undo' : 'ok');

    await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
