// Usability walkthrough of the reads -> gene workflow (2026-10-22 audit): prints what a user gets at each step.
// node dev-tools/reads-audit/walk.js <repo> <dir with region.gb, region_bed6.bed, region_bed12.bed, reads_40x.sam, reads_120x.sam, truth.json>
// (make the data: node tests/fixtures/reads/make_region_reads.js <dir> 40 and ... <dir> 120, copy region*.bed/gb from tests/fixtures/reads/region)
const R = process.argv[2], D = process.argv[3];
const truth = require(D + '/truth.json');
const { launch } = require(R + '/tests/lib/browser.js'); const { start } = require(R + '/tests/lib/static-server.js');
const fs = require('fs');
(async () => {
  const { server, baseUrl } = await start(); const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const msgs = [];
  page.on('dialog', d => { msgs.push('DIALOG: ' + d.message().slice(0, 200)); d.accept(); });
  page.on('pageerror', e => msgs.push('PAGEERROR: ' + e.message));
  await page.goto(baseUrl + '/index.html?view=full', { waitUntil: 'networkidle' });
  const status = () => page.evaluate(() => document.getElementById('statusMessage').innerText.replace(/\s+/g, ' ').slice(0, 400));
  const log = (k, v) => console.log(`## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}\n`);

  // W1 GenBank reference
  await page.setInputFiles('#fileInput', D + '/region.gb'); await page.waitForTimeout(2000);
  log('W1 GenBank loaded', await page.evaluate(() => ({ rows: state.seqs.map(s => s.header + ':' + s.seq.length), annot: state.annot ? state.annot.features.map(f => `${f.name} ${f.start}-${f.end} ${f.strand}`) : null, code: document.getElementById('codonCode').value })));
  log('W1 status', await status());

  // W2 reads over the read limit
  await page.setInputFiles('#bamFileInput', D + '/reads_120x.sam'); await page.waitForTimeout(3000);
  log('W2 120x reads (2399)', await status());

  // W3 reads within the limit
  await page.setInputFiles('#bamFileInput', D + '/reads_40x.sam'); await page.waitForTimeout(3000);
  log('W3 40x reads (799)', { status: await status(), mode: await page.evaluate(() => ['modeSingle', 'modeBlocks', 'modeCanvas', 'modeReads'].find(i => document.getElementById(i).checked)), window: await page.evaluate(() => [bamState.refStart, bamState.refEnd, bamState.reads.length]) });
  await page.screenshot({ path: D + '/w3_reads.png' });
  // what the Reads view offers: controls near the mode switch, elements in the container
  log('W3 reads view controls', await page.evaluate(() => {
    const ids = ['readsDisplayToggle', 'readsSampleRowButton', 'clearReadsButton', 'openBamToolbarButton'].map(id => { const e = document.getElementById(id); return id + ':' + (e ? getComputedStyle(e).display : 'none'); });
    const svg = alignmentContainer.querySelector('svg');
    return { ids, svgW: svg && svg.getAttribute('width'), rects: svg ? svg.querySelectorAll('rect').length : 0, texts: svg ? svg.querySelectorAll('text').length : 0, containerScrollW: alignmentContainer.scrollWidth };
  }));

  // W4 Sample -> row
  await page.click('#readsSampleRowButton'); await page.waitForTimeout(1500);
  log('W4 sample row', { status: await status(), rows: await page.evaluate(() => state.seqs.map(s => s.header + ':' + s.seq.length)) });
  log('W4 sample bases at mutations', await page.evaluate((muts) => muts.map(m => `${m.name}@${m.pos + 1}: ref ${state.seqs[0].seq[m.pos]} sample ${state.seqs[1].seq[m.pos]}`), truth.muts));
  log('W4 BAM/reads controls after the sample row', await page.evaluate(() => ['openBamToolbarButton', 'clearReadsButton', 'qmReadsLabel'].map(id => { const e = document.getElementById(id); return id + ':' + (e ? getComputedStyle(e).display : 'none'); })));

  // W5 codon analysis with only the GenBank (no BED)
  await page.evaluate(() => { const c = document.getElementById('codonAnalysis'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1500);
  const codonAt = () => page.evaluate((muts) => {
    const d = state._codonData; if (!d) return 'no codon data';
    return { frame: d.frameOffset, byGene: !!d.byGene, marks: muts.map(m => `${m.name}: ${d.synNonSyn[1][m.pos] || '-'}${d.stops[1].includes(m.pos) ? ' STOP' : ''}`), sampleStops: d.stops[1].length / 3, refStops: d.stops[0].length / 3, fs1: (d.frameShifts[1] || []).map(f => f.pos + 1).slice(0, 6), fs0: (d.frameShifts[0] || []).length };
  }, truth.muts);
  log('W5 codon analysis, GenBank only', { status: await status(), codon: await codonAt() });

  // W6 BED6 annotation (exon-less)
  await page.evaluate(t => setAnnotation(t, 'region_bed6.bed'), fs.readFileSync(D + '/region_bed6.bed', 'utf8'));
  await page.waitForTimeout(1500);
  log('W6 codon analysis with BED6 genes', { status: await status(), codon: await codonAt() });
  log('W6 geneA translation across the intron?', await page.evaluate(() => {
    const d = state._codonData; const a = d.aaSeq[0].filter(e => e.gene === 'geneA'); const b = d.aaSeq[0].filter(e => e.gene === 'geneB');
    const s = x => x.map(e => e.aa).join('');
    return { geneA_len_aa: a.length, geneA_aa: s(a).slice(0, 20) + '...' + s(a).slice(-10), geneA_stops: (s(a).match(/\*/g) || []).length, geneB_len_aa: b.length, geneB_first: s(b).slice(0, 10), geneB_last: s(b).slice(-5) };
  }));

  // W7 BED12 (exon blocks)
  await page.evaluate(t => setAnnotation(t, 'region_bed12.bed'), fs.readFileSync(D + '/region_bed12.bed', 'utf8'));
  await page.waitForTimeout(1500);
  log('W7 BED12', await page.evaluate(() => { const d = state._codonData; const a = d.aaSeq[0].filter(e => e.gene === 'geneA'); return { geneA_len_aa: a.length, stops: a.filter(e => e.aa === '*').length, featureFields: Object.keys(state.annot.features[0]) }; }));
  log('W7 codon marks', await codonAt());

  // W8 amino-acid numbering visible? hover a nonsyn cell
  log('W8 aa numbering in the page', await page.evaluate(() => { const t = document.body.innerText; return { hasR140Q: /R140Q|140/.test(t.slice(0, 5000)) }; }));

  // W9 back to Reads view
  await page.evaluate(() => { const r = document.getElementById('modeReads'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1500);
  log('W9 back to Reads view', { status: await status(), html: await page.evaluate(() => alignmentContainer.innerText.slice(0, 200)) });
  await page.screenshot({ path: D + '/w9_reads_again.png' });

  // W10 translation export of the sample row
  log('W10 AA FASTA', await page.evaluate(() => { try { return buildAATranslationFasta().slice(0, 400); } catch (e) { return 'ERR ' + e.message; } }));
  log('messages', msgs);
  await browser.close(); server.close();
})();
