// The genome view in a real page: entry, reference through .fai, exact scroll, reads by window, cache, options.
// A reference and BAM are built in memory; depth and bases are checked against the list the BAM was built from, not against the
// page's own code. Larger runs against the bench oracle live outside the repo. Run: node tests/regression/genome.js
// (CHECK_FILTER="part of name" runs some.)
const { start } = require('../lib/static-server');
const { launch, closeLaunched, loadFasta } = require('../lib/browser');
const { buildBam, syntheticReads, mulberry } = require('../lib/synth-bam.js');
const fs = require('fs'), os = require('os'), path = require('path');

const CHECKS = [];
const check = (name, fn, opts) => CHECKS.push({ name, fn, opts });

// ---- test data ------------------------------------------------------------------------------------------------------
const REFS = [['chrA', 3000000], ['chrB', 200000]];
let data = null;
function fastaOf(seqs, width = 60) {
  let text = '', fai = '';
  for (const [name, seq] of seqs) {
    const head = '>' + name + ' test\n', off = Buffer.byteLength(text) + head.length, lines = [];
    for (let i = 0; i < seq.length; i += width) lines.push(seq.slice(i, i + width));
    text += head + lines.join('\n') + '\n';
    fai += [name, seq.length, off, width, width + 1].join('\t') + '\n';
  }
  return { text, fai };
}
function getData() {
  if (data) return data;
  const rnd = mulberry(99), seqs = REFS.map(([n, L]) => { const a = Buffer.alloc(L); for (let i = 0; i < L; i++) a[i] = 'ACGT'.charCodeAt((rnd() * 4) | 0); return [n, a.toString('latin1')]; });
  // a stretch of chrA with no reads at all: an empty window is normal
  const reads = syntheticReads().filter(r => !(r.ref === 0 && r.pos + 300000 > 1200000 && r.pos < 1400000));
  const { bam, bai } = buildBam(REFS, reads, false), { text, fai } = fastaOf(seqs);
  data = { seqs: Object.fromEntries(seqs), reads, bam, bai, fasta: Buffer.from(text), fai: Buffer.from(fai) };
  return data;
}
const span = c => c.reduce((n, [l, o]) => n + ('MDN=X'.includes(o) ? l : 0), 0);
function depthAt(reads, ref, p) {   // from the reads the BAM was built from
  let d = 0;
  for (const r of reads) {
    if (r.ref !== ref || r.pos > p) continue;
    let q = r.pos;
    for (const [l, o] of r.cigar) { if ('M=XD'.includes(o)) { if (p >= q && p < q + l) d++; q += l; } else if (o === 'N') q += l; }
  }
  return d;
}
const file = (name, buffer) => ({ name, mimeType: 'application/octet-stream', buffer });
const refFiles = () => { const d = getData(); return [file('g.fa', d.fasta), file('g.fa.fai', d.fai)]; };
const allFiles = () => { const d = getData(); return [...refFiles(), file('r.bam', d.bam), file('r.bam.bai', d.bai)]; };

async function idle(page) { await page.waitForFunction(() => typeof _genomeIdle === 'function' && _genomeIdle(), null, { timeout: 30000 }); }
async function open(page, files) {
  await page.setInputFiles('#genomeFileInput', files);
  await page.waitForFunction(() => typeof _genome !== 'undefined' && _genome && _readsView, null, { timeout: 15000 });
  await idle(page);
}
async function jump(page, text) {
  await page.fill('#readsJumpBox', text);
  await page.press('#readsJumpBox', 'Enter');
  await page.waitForTimeout(30);
  await idle(page);
}
const left = page => page.evaluate(() => _readsLeft());
async function zoom(page, cell) { await page.evaluate(c => { const v = _readsView; _readsZoomTo(c, _READS_NAME_W + (v.w - _READS_NAME_W) / 2); }, cell); await page.waitForTimeout(30); await idle(page); }
const centreBase = page => page.evaluate(() => { const v = _readsView; return (_readsLeft() + (v.w - _READS_NAME_W) / 2) / v.cell; });
const canvasBox = page => page.evaluate(() => { const b = document.getElementById('readsCanvas').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
async function dragBy(page, dx, dy = 0) {
  const b = await canvasBox(page), y = b.y + b.h - 60, x = b.x + b.w / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx / 2 + Math.sign(dx) * 3, y + dy / 2); await page.mouse.move(x + dx, y + dy); await page.mouse.up();
}

// ---- step 4: entry, reference, exact scroll -----------------------------------------------------------------------------
check('open: FASTA and .fai alone show the reference, with no row in the alignment', async (page) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await open(page, refFiles());
  const r = await page.evaluate(() => ({ seqs: state.seqs.length, reads: !!document.getElementById('modeReads').checked, chrom: [...document.querySelectorAll('#genomeChrom option')].map(o => o.textContent), name: bamState.refName, len: bamState.refEnd, jumpShown: getComputedStyle(document.getElementById('readsJumpBox')).display !== 'none' && document.getElementById('readsJumpBox').offsetWidth > 0 }));
  const ok = !errors.length && r.seqs === 0 && r.reads && r.chrom.length === 2 && /chrA/.test(r.chrom[0]) && r.name === 'chrA' && r.len === 3000000 && r.jumpShown;
  return { pass: ok, detail: JSON.stringify({ ...r, errors }) };
});

check('reference: letters at 200 random positions equal the FASTA, including across line ends', async (page) => {
  const d = getData(), rnd = mulberry(4);
  await open(page, refFiles());
  let bad = 0, n = 0, first = '';
  for (let i = 0; i < 200; i++) {
    const name = i % 4 === 3 ? 'chrB' : 'chrA', L = name === 'chrA' ? 3000000 : 200000, p = i < 10 ? [0, 59, 60, 61, 119, 120, L - 1, L - 2, L - 60, 16384][i] : (rnd() * L) | 0, nm = i < 10 ? 'chrA' : name, LL = nm === 'chrA' ? 3000000 : 200000, q = Math.min(p, LL - 1);
    await page.fill('#readsJumpBox', `${nm}:${(q + 1).toLocaleString('en-US')}`);
    await page.press('#readsJumpBox', 'Enter');
    await idle(page);
    const got = await page.evaluate(q => [bamState.refName, _readsRefChar(q)], q); n++;
    if (got[0] !== nm || got[1] !== d.seqs[nm][q]) { bad++; first = first || `${nm}:${q + 1} ${got} want ${d.seqs[nm][q]}`; }
  }
  return { pass: !bad && n === 200, detail: `${bad} of ${n} wrong; ${first}` };
});

check('jump box: chr7:1,000,000, a range, an alias, and refusals', async (page) => {
  await open(page, refFiles());
  await jump(page, 'chrA:1,000,000');
  const a = await centreBase(page);
  await jump(page, 'chrB:5000-6000');
  const b = await page.evaluate(() => [bamState.refName, Math.round(_readsLeft() / _readsView.cell)]);
  await jump(page, 'A:2,000');   // no chr
  const c = await page.evaluate(() => bamState.refName);
  await jump(page, 'chrZ:5');
  const msg = await page.evaluate(() => document.getElementById('statusMessage')?.textContent || '');
  const stay = await page.evaluate(() => bamState.refName);
  await jump(page, '99,999,999');
  const past = await page.evaluate(() => [bamState.refName, document.body.textContent.includes('outside')]);
  const ok = Math.abs(a - 999999.5) <= 1 && b[0] === 'chrB' && Math.abs(b[1] - 4999) <= 1 && c === 'chrA' && stay === 'chrA' && past[0] === 'chrA' && past[1];
  return { pass: ok, detail: JSON.stringify({ a, b, c, msg, stay, past }) };
});

// A .fai that says 250 Mb on a short FASTA: scrolling needs no bases
const bigFai = () => [file('g.fa', Buffer.from('>big\n' + 'ACGT'.repeat(15) + '\n')), file('g.fa.fai', Buffer.from('big\t250000000\t5\t60\t61\n'))];

check('scroll at 250 Mb: a jump is centred to the pixel, in spite of the 188:1 scrollbar mapping', async (page) => {
  await open(page, bigFai());
  const out = [];
  for (const p of [123456789, 200000001, 249999000, 1000]) {
    await jump(page, `big:${p}`);
    out.push(await page.evaluate(p => { const v = _readsView; return _READS_NAME_W + (p - 1) * v.cell - _readsLeft() - (_READS_NAME_W + (v.w - _READS_NAME_W) / 2); }, p));
  }
  return { pass: out.every(x => Math.abs(x) < 0.51), detail: JSON.stringify(out) };
});

check('scroll at 250 Mb: dragging moves the view by exactly the mouse, and it stays there', async (page) => {
  await open(page, bigFai());
  await jump(page, 'big:123,456,789');
  await page.evaluate(() => { _readsView.cell = _READS_CELL; _readsSizeSpacer(_readsView); _readsCentre(123456789); });
  const out = [];
  for (const dx of [-5, 7, -40, 13, -500, 400]) {   // the last two move the scrollbar too (188:1): its scroll event must not move the view
    const a = await left(page);
    await dragBy(page, dx);
    await page.waitForTimeout(80);   // a scroll echo would arrive here
    out.push((await left(page)) - a);
  }
  const want = [5, -7, 40, -13, 500, -400];
  return { pass: out.every((x, i) => Math.abs(x - want[i]) < 0.01), detail: JSON.stringify(out) };
});

check('scroll at 250 Mb: zoom keeps the base under the mouse', async (page) => {
  await open(page, bigFai());
  await jump(page, 'big:123,456,789');
  const b = await canvasBox(page), x = b.x + 400;
  const baseAt = () => page.evaluate(px => (px + _readsLeft() - _READS_NAME_W) / _readsView.cell, 400);
  await page.mouse.move(x, b.y + 200);
  const before = await baseAt(), out = [];
  for (const dy of [120, 120, -120]) {
    await page.keyboard.down('Control'); await page.mouse.wheel(0, dy); await page.keyboard.up('Control');
    await page.waitForTimeout(60);
    out.push((await baseAt()) - before);
  }
  return { pass: out.every(d => Math.abs(d) < 0.01), detail: JSON.stringify(out) };
});

check('scroll at 250 Mb: a sideways wheel moves by its pixels, the bar reaches the far end', async (page) => {
  await open(page, bigFai());
  await jump(page, 'big:123,456,789');
  await page.evaluate(() => { _readsView.cell = _READS_CELL; _readsSizeSpacer(_readsView); _readsCentre(123456789); });
  const b = await canvasBox(page);
  await page.mouse.move(b.x + 300, b.y + 200);
  const a = await left(page);
  await page.mouse.wheel(30, 0);
  await page.waitForTimeout(80);
  const moved = (await left(page)) - a;
  await page.evaluate(() => { alignmentContainer.scrollLeft = 1e9; });   // what the thumb does
  await page.waitForTimeout(120);
  const end = await page.evaluate(() => { const v = _readsView; return v.fullW - v.w - _readsLeft(); });
  return { pass: Math.abs(moved - 30) < 0.01 && Math.abs(end) < 200, detail: JSON.stringify({ moved, end }) };
});

check('entry: a drop with a .fai opens the genome; a drop without one takes the old path', async (page) => {
  const drop = (names) => page.evaluate(async (names) => {
    const dt = new DataTransfer();
    for (const n of names) dt.items.add(new File([n.endsWith('.fai') ? 'chrD\t8\t6\t8\t9\n' : '>chrD\nACGTACGT\n>chrE\nACGTACGA\n'], n));
    const z = document.getElementById('dropZone');
    z.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 400));
    return { genome: !!_genome, rows: state.seqs.length };
  }, names);
  const plain = await drop(['plain.fa']);
  const stayed = plain.genome === false && plain.rows === 2;
  page.once('dialog', d => d.accept());
  const g = await drop(['d.fa', 'd.fa.fai']);
  return { pass: stayed && g.genome === true && g.rows === 0, detail: JSON.stringify({ plain, g }) };
});

check('entry: opening a genome over an alignment asks; No keeps the alignment, Yes closes it', async (page) => {
  await loadFasta(page, '>a\nACGTACGTAC\n>b\nACGTACGTAA\n');
  page.once('dialog', d => d.dismiss());
  await page.setInputFiles('#genomeFileInput', refFiles());
  await page.waitForTimeout(300);
  const kept = await page.evaluate(() => [state.seqs.length, !!_genome]);
  page.once('dialog', d => d.accept());
  await open(page, refFiles());
  const closed = await page.evaluate(() => [state.seqs.length, !!_genome]);
  return { pass: kept[0] === 2 && !kept[1] && closed[0] === 0 && closed[1], detail: JSON.stringify({ kept, closed }) };
});

check('entry: wrong sets are refused with the file named, nothing opened', async (page) => {
  const d = getData(), msgs = [];
  const tryOpen = async files => { await page.setInputFiles('#genomeFileInput', files); await page.waitForTimeout(250); msgs.push(await page.evaluate(() => [!!_genome, document.getElementById('statusMessage')?.textContent || ''])); };
  await tryOpen([file('g.fa', d.fasta)]);
  await tryOpen([...refFiles(), file('r.bam', d.bam)]);
  await tryOpen([...refFiles(), file('r.bam', d.bam), file('r.bam.csi', Buffer.from('x'))]);
  const otherAsm = Buffer.from(d.fai.toString().replace('3000000', '3000001'));
  await tryOpen([file('g.fa', d.fasta), file('g.fa.fai', otherAsm), file('r.bam', d.bam), file('r.bam.bai', d.bai)]);
  const ok = msgs.every(m => !m[0]) && /fai/.test(msgs[0][1]) && /samtools index/.test(msgs[1][1]) && /csi/.test(msgs[2][1]) && /assembly/.test(msgs[3][1]);
  return { pass: ok, detail: JSON.stringify(msgs) };
});

check('close: Close leaves the start page; a plain load after a genome is a plain load', async (page) => {
  await open(page, allFiles());
  await page.click('#genomeCloseBtn');
  await page.waitForTimeout(100);
  const a = await page.evaluate(() => [!!_genome, bamState.reads.length, bamState.refSeq, !!_readsView, document.body.classList.contains('genome-mode'), /No sequences loaded/.test(alignmentContainer.textContent)]);
  await open(page, allFiles());
  await loadFasta(page, '>a\nACGTACGTAC\n>b\nACGTACGTAA\n');
  const b = await page.evaluate(() => [!!_genome, state.seqs.length, !document.getElementById('modeReads').checked, !!document.querySelector('.seq-line, #alignmentCanvas')]);
  const ok = !a[0] && a[1] === 0 && a[2] === null && !a[3] && !a[4] && a[5] && !b[0] && b[1] === 2 && b[2] && b[3];
  return { pass: ok, detail: JSON.stringify({ a, b }) };
});

// ---- step 5: reads in the page ---------------------------------------------------------------------------------------------
check('reads: depth and bases at random positions and on tile edges equal the reads the BAM was built from', async (page) => {
  const d = getData(), rnd = mulberry(8), T = 16384;
  await open(page, allFiles());
  const spots = [16383, 16384, 32767, 32768, 49151, 49152];
  for (let i = 0; i < 60; i++) spots.push((rnd() * 1100000) | 0);
  for (let i = 0; i < 12; i++) { const t = 1 + ((rnd() * 60) | 0); spots.push(t * T - 1, t * T); }
  let bad = 0, first = '', n = 0, covered = 0;
  for (const p of spots) {
    await jump(page, `chrA:${p + 1}`);
    await page.evaluate(() => _readsCalls());
    const got = await page.evaluate(p => { const c = SampleCall.countsAt(bamState.calls && bamState.calls.counts, p); return { depth: c ? c.depth : 0, sum: c ? c.A[0] + c.A[1] + c.C[0] + c.C[1] + c.G[0] + c.G[1] + c.T[0] + c.T[1] : 0 }; }, p);
    const want = depthAt(d.reads, 0, p); n++; covered += want > 0;
    if (got.depth !== want || got.sum !== want) { bad++; first = first || `chrA:${p + 1} got ${JSON.stringify(got)} want ${want}`; }
  }
  return { pass: !bad && covered > 20, detail: `${bad} of ${n} wrong, ${covered} covered; ${first}` };
});

check('reads: every read of a window is drawn once, none twice, long reads from far left included', async (page) => {
  const d = getData();
  await open(page, allFiles());
  await jump(page, 'chrA:700000');
  await zoom(page, 0.1);
  const r = await page.evaluate(() => { const k = bamState.allReads.map(x => x.name + '/' + x.pos); return { n: k.length, uniq: new Set(k).size, ws: _genome.win.ws, we: _genome.win.we }; });
  const want = d.reads.filter(x => x.ref === 0 && x.pos < r.we && x.pos + span(x.cigar) > r.ws).length;
  return { pass: r.n === r.uniq && r.n === want && r.n > 0, detail: JSON.stringify({ ...r, want }) };
});

check('reads: moving swaps the window without a rebuild: same canvas, same place, reads keep their rows', async (page) => {
  await open(page, allFiles());
  await jump(page, 'chrA:700000');
  await zoom(page, 0.2);
  await page.evaluate(() => { window.__c = document.getElementById('readsCanvas'); window.__tracks = new Map(bamState.reads.map(r => [GenomeWindow.readKey(r), r.track])); window.__win = _genome.win.ws; });
  let swaps = 0, jumped = 0, kept = 0, off = 0;
  for (let i = 0; i < 60; i++) {
    const a = await left(page);
    await dragBy(page, i < 35 ? -400 : 300);
    await idle(page);
    off += Math.abs((await left(page)) - a - (i < 35 ? 400 : -300));
    const s = await page.evaluate(() => { let j = 0, k = 0; for (const r of bamState.reads) { const key = GenomeWindow.readKey(r), t = window.__tracks.get(key); if (t !== undefined) { k++; if (t !== r.track) j++; } } window.__tracks = new Map(bamState.reads.map(r => [GenomeWindow.readKey(r), r.track])); const moved = _genome.win.ws !== window.__win; window.__win = _genome.win.ws; return { j, k, moved, same: document.getElementById('readsCanvas') === window.__c }; });
    jumped += s.j; kept += s.k; swaps += s.moved;
    if (!s.same) return { pass: false, detail: 'the canvas was rebuilt at move ' + i };
  }
  return { pass: swaps >= 3 && !jumped && kept > 100 && off < 0.01, detail: JSON.stringify({ swaps, jumped, kept, off }) };
});

check('reads: an empty window is a place, not an end: view, jump box and options stay', async (page) => {
  await open(page, allFiles());
  await jump(page, 'chrA:1,350,000');
  const r = await page.evaluate(() => ({ reads: bamState.reads.length, view: !!_readsView, box: document.getElementById('readsJumpBox').offsetWidth > 0, opt: document.getElementById('readsOptionsBtn').offsetWidth > 0, status: _readsDefaultStatus(), html: alignmentContainer.textContent }));
  await jump(page, 'chrA:600,000');
  const back = await page.evaluate(() => bamState.reads.length);
  return { pass: r.reads === 0 && r.view && r.box && r.opt && /window/.test(r.status) && !/No reads loaded/.test(r.html) && back > 0, detail: JSON.stringify({ ...r, html: undefined, back }) };
});

check('reads: while a place is being read it is hatched, never drawn as no coverage', async (page) => {
  await open(page, allFiles());
  await jump(page, 'chrA:600,000');
  await page.evaluate(() => { window.__gate = []; const o = GenomeWindow.loadTile; GenomeWindow.loadTile = async (...a) => { await new Promise(r => window.__gate.push(r)); return o(...a); }; window.__o = o; });
  await page.fill('#readsJumpBox', 'chrA:2,000,000'); await page.press('#readsJumpBox', 'Enter');
  await page.waitForFunction(() => window.__gate.length > 0);
  await page.waitForTimeout(100);
  const during = await page.evaluate(() => { const v = _readsView, y = _readsHeadH() + 30, d = v.ctx.getImageData(Math.floor(v.w * v.dpr / 2) - 40, Math.floor(y * v.dpr), 80, 8).data; let grey = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 225) grey++; return { grey, status: _readsDefaultStatus(), wait: _genome.waiting }; });
  await page.evaluate(() => { GenomeWindow.loadTile = window.__o; for (const r of window.__gate) r(); });
  await idle(page);
  const after = await page.evaluate(() => [_genome.waiting, bamState.reads.length > 0]);
  return { pass: during.grey > 20 && during.wait && /reading/.test(during.status) && !after[0] && after[1], detail: JSON.stringify({ during, after }) };
});

check('reads: a chromosome switch and back reads the right reads, nothing of the last one stays', async (page) => {
  await open(page, allFiles());
  await page.selectOption('#genomeChrom', 'chrB');
  await page.waitForTimeout(40); await idle(page);
  const b = await page.evaluate(() => [bamState.refName, bamState.refEnd, bamState.reads.length, bamState.reads.every(r => r.refID === 1)]);
  await jump(page, 'chrA:600000');
  const a = await page.evaluate(() => [bamState.refName, bamState.reads.every(r => r.refID === 0), bamState.reads.length]);
  // a tile of chrA still being read when the view goes to chrB must not land on chrB
  await jump(page, 'chrA:100,000');
  await page.evaluate(() => { _genome.cache.clear(); window.__gate = []; const o = GenomeWindow.loadTile; GenomeWindow.loadTile = async (...a) => { const t = await o(...a); await new Promise(r => window.__gate.push(r)); return t; }; window.__o = o; _genome.lastA = -1; _readsCentre(100500); });
  await page.waitForFunction(() => window.__gate.length > 0);
  await page.evaluate(() => { GenomeWindow.loadTile = window.__o; });
  await page.selectOption('#genomeChrom', 'chrB');
  await page.evaluate(() => { for (const r of window.__gate) r(); });
  await page.waitForTimeout(40); await idle(page);
  await jump(page, 'chrB:100,000');
  const late = await page.evaluate(() => [bamState.refName, bamState.reads.length, bamState.reads.filter(r => r.refID !== 1).length]);
  return { pass: b[0] === 'chrB' && b[1] === 200000 && b[2] > 0 && b[3] && a[0] === 'chrA' && a[1] && a[2] > 0 && late[0] === 'chrB' && late[2] === 0, detail: JSON.stringify({ a, b, late }) };
});

check('reads: the draw limit goes by the density of the window, not of the chromosome', async (page) => {
  // a window of under a third of the chromosome: past the limit on the window's own density; on the whole chromosome's it would be below
  await open(page, allFiles());
  await page.evaluate(() => { _genome.gateBytes = 1e12; _genome.cache.budget = 1e9; });
  await jump(page, 'chrA:100,000-400,000');
  await idle(page);
  const r = await page.evaluate(() => { const v = _readsView, w = _genome.win; bamState.alignedBases = Math.ceil(1.3 * _READS_MAX_DRAWN * (w.we - w.ws) / ((v.w - _READS_NAME_W) / v.cell)); return { over: _readsCoverageOnly(v), span: w.we - w.ws, chr: bamState.refEnd }; });
  return { pass: r.over && r.span < r.chr / 2, detail: JSON.stringify(r) };
});

check('reads: outside the loaded bases a read shows no changes and the reference no letters', async (page) => {
  await open(page, allFiles());
  await jump(page, 'chrA:700,000');
  // the bases cut to nothing under the view, as while they are being read
  const r = await page.evaluate(() => {
    const v = _readsView, keep = [bamState.refSeq, bamState.refBase];
    const red = () => { _readsDraw(); const y = Math.ceil(_readsHeadH() * v.dpr), d = v.ctx.getImageData(0, y, v.canvas.width, v.canvas.height - y).data;   // the tracks only: coverage has red too
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 110 && d[i + 2] < 110) n++; return n; };
    const withBases = red();
    bamState.refSeq = 'A'; bamState.refBase = 5;
    const without = red(), blank = _readsRefChar(700000);
    const row = v.ctx.getImageData(Math.round(200 * v.dpr), 2, Math.round(600 * v.dpr), Math.round(16 * v.dpr)).data; let ink = 0; for (let i = 0; i < row.length; i += 4) if (row[i] < 220) ink++;
    bamState.refSeq = keep[0]; bamState.refBase = keep[1];
    return { withBases, without, blank: blank === undefined, ink };
  });
  return { pass: r.without === 0 && r.blank && r.withBases > 0 && r.ink === 0, detail: JSON.stringify(r) };
});

check('screen: the coverage scale is on screen away from the chromosome start, and the header names the genome', async (page) => {
  await open(page, allFiles());
  await jump(page, 'chrA:700,000');
  await page.evaluate(() => _readsCalls());
  const r = await page.evaluate(() => {
    const v = _readsView, seen = [], o = v.ctx.fillText;
    v.ctx.fillText = function (s, x, y) { if (/^coverage/.test(s)) seen.push([s, x, this.textAlign]); return o.call(this, s, x, y); };
    _readsDraw(); v.ctx.fillText = o;
    const l = seen[seen.length - 1];
    return { l, shown: !!l && /0-\d+/.test(l[0]) && (l[2] === 'left' ? l[1] >= 0 : l[1] > 60), info: document.getElementById('sourceInfo').textContent };
  });
  await page.click('#genomeCloseBtn');
  const after = await page.evaluate(() => document.getElementById('sourceInfo').textContent);
  return { pass: r.shown && /g\.fa/.test(r.info) && /r\.bam/.test(r.info) && /No file/.test(after), detail: JSON.stringify({ ...r, after }) };
});

// ---- step 6: cache, prefetch, cancel ---------------------------------------------------------------------------------------
check('cache: a walk across the chromosome stays inside the budget', async (page) => {
  await open(page, allFiles());
  await zoom(page, 0.2);
  await page.evaluate(() => { _genome.cache.budget = 3 * 1048576; });
  let max = 0, tiles = 0;
  for (let p = 100000; p < 1150000; p += 45000) { await page.evaluate(p => _readsCentre(p), p); await page.waitForTimeout(30); await idle(page); const s = await page.evaluate(() => [_genome.cache.bytes, _genome.cache.size]); max = Math.max(max, s[0]); tiles = Math.max(tiles, s[1]); }
  return { pass: max <= 3 * 1048576 && tiles > 5, detail: JSON.stringify({ max, tiles }) };
});

check('prefetch: when the view rests the next screen is read, on the side of travel', async (page) => {
  await open(page, allFiles());
  await jump(page, 'chrA:700000');
  await zoom(page, 0.1);
  await dragBy(page, -300); await page.waitForTimeout(30); await idle(page);
  const r = await page.evaluate(() => { const v = _readsView, b = Math.ceil((_readsLeft() + v.w) / v.cell), t = GenomeWindow.tileRange(b, b + 1)[0]; return { next: _genome.cache.has(t + 1), dir: _genome.dir }; });
  return { pass: r.next && r.dir === 1, detail: JSON.stringify(r) };
});

check('cancel: a thumb sweep reads at most a few stale tiles and ends on the last place', async (page) => {
  await open(page, allFiles());
  await zoom(page, 2);
  await page.evaluate(() => { window.__n = 0; const o = GenomeWindow.loadTile; GenomeWindow.loadTile = async (...a) => { window.__n++; return o(...a); }; });
  const sweep = await page.evaluate(async () => { const s = alignmentContainer, m = s.scrollWidth - s.clientWidth; for (let i = 1; i <= 40; i++) { s.scrollLeft = m * i / 41; await new Promise(r => requestAnimationFrame(r)); } return m; });
  await idle(page);
  const r = await page.evaluate(() => { const v = _readsView, c = Math.floor((_readsLeft() + v.w / 2) / v.cell); return { n: window.__n, here: _genome.win.ws <= c && c < _genome.win.we, tiles: 3000000 / 16384 | 0 }; });
  return { pass: r.here && r.n < 80 && sweep > 0, detail: JSON.stringify(r) };
});

// ---- step 7: options on the window ----------------------------------------------------------------------------------------
check('options: a filter that leaves nothing is applied, the frame and place stay, and says window', async (page) => {
  await open(page, allFiles());
  await jump(page, 'chrA:700,000');
  await page.click('#readsOptionsBtn');
  const place = await centreBase(page);
  await page.fill('#readsMinMapq', '61'); await page.press('#readsMinMapq', 'Enter');
  await idle(page);
  const r = await page.evaluate(() => ({ end: bamState.refEnd, start: bamState.refStart, reads: bamState.reads.length, file: bamState.fileReads.length, view: !!_readsView, q: _readsFilter.minMapq }));
  const after = await centreBase(page);
  await page.fill('#readsMinMapq', '0'); await page.press('#readsMinMapq', 'Enter');
  await idle(page);
  const back = await page.evaluate(() => [bamState.reads.length, document.getElementById('readsShowDuplicateText').textContent]);
  return { pass: r.end === 3000000 && r.start === 0 && r.reads === 0 && r.file > 0 && r.view && r.q === 61 && Math.abs(place - after) < 0.5 && back[0] > 0 && /in window/.test(back[1]), detail: JSON.stringify({ r, place, after, back }) };
});

check('options: sort and group work on the window and say so; rows hold while moving under a sort', async (page) => {
  await open(page, allFiles());
  await jump(page, 'chrA:700,000');
  await page.click('#readsOptionsBtn');
  await page.selectOption('#readsSortBy', 'length');
  await idle(page);
  const s = await page.evaluate(() => [_readsOpts.sort, _readsDefaultStatus()]);
  await page.selectOption('#readsSortBy', 'start');
  await page.selectOption('#readsGroupBy', 'strand');
  await idle(page);
  const g = await page.evaluate(() => bamState.groupRanges.map(x => x.label));
  const a = await left(page);
  await page.click('#readsOptionsBtn');
  await dragBy(page, -300); await idle(page);
  const stay = (await left(page)) - a;
  const g2 = await page.evaluate(() => bamState.groupRanges.length);
  return { pass: s[0] === 'length' && /sorted/.test(s[1]) && g.length >= 1 && g.every(x => /in window/.test(x)) && Math.abs(stay - 300) < 0.01 && g2 >= 1, detail: JSON.stringify({ s, g, stay, g2 }) };
});

check('variants: the window says it is only the window; rows follow it; Sample row is not offered', async (page) => {
  await open(page, allFiles());
  await jump(page, 'chrA:700,000');
  await zoom(page, 1);
  await page.click('#readsVariantsButton');
  await idle(page);
  const r = await page.evaluate(() => ({ text: document.getElementById('variantsSummary').textContent, help: document.querySelector('#variantsWindow .var-help').textContent, sample: document.getElementById('readsSampleRowButton').offsetWidth, rows: document.querySelectorAll('#variantsTable tbody tr[data-pos]').length, win: _genome.win, pos: [...document.querySelectorAll('#variantsTable tbody tr[data-pos]')].map(t => +t.dataset.pos) }));
  const inside = r.pos.every(p => p - 1 >= r.win.ws && p - 1 < r.win.we);
  return { pass: /loaded window/.test(r.text) && /chrA:/.test(r.text) && !/column in the alignment/.test(r.help) && r.sample === 0 && r.rows > 0 && inside, detail: JSON.stringify({ ...r, pos: r.pos.length, inside }) };
});

check('wide view: past the gate nothing is read and the screen says why, coverage included', async (page) => {
  await open(page, allFiles());
  await page.evaluate(() => { _genome.gateBytes = 20000; window.__n = 0; const o = GenomeWindow.loadTile; GenomeWindow.loadTile = async (...a) => { window.__n++; return o(...a); }; });
  await page.evaluate(() => { const v = _readsView; _readsZoomTo(_readsMinCell(v), 300); });
  await page.waitForTimeout(100); await idle(page);
  const r = await page.evaluate(() => ({ wide: _genome.tooWide, n: window.__n, text: _genomeWideText(), status: _readsDefaultStatus() }));
  return { pass: r.wide && r.n === 0 && /Zoom in/.test(r.text) && /coverage/i.test(r.text) && /zoom in/i.test(r.status), detail: JSON.stringify(r) };
});

// NA12878 chr20:31.05 Mb: the index sees 16 kb at best and put 22 MB there, past the gate, so even 10 bases said "zoom in" and no
// zoom could help, with 1,292 reads on that spot. Zooming in has to reach the reads: a view of one tile or less is always read.
check('wide view: a dense place past the gate is still read once the view is a tile or less', async (page) => {
  await open(page, allFiles());
  await page.evaluate(() => { _genome.gateBytes = -1; });
  const at = await page.evaluate(() => { const c = _genome.chrom; return { name: c.name, mid: Math.floor(c.length / 2) }; });
  await page.fill('#readsJumpBox', `${at.name}:${at.mid}-${at.mid + 500}`); await page.press('#readsJumpBox', 'Enter');
  await page.waitForTimeout(100); await idle(page);
  const r = await page.evaluate(() => ({ wide: _genome.tooWide, reads: (bamState.allReads || []).length, status: _readsDefaultStatus() }));
  return { pass: !r.wide && r.reads > 0 && !/zoom in/i.test(r.status), detail: JSON.stringify(r) };
});

// NA12878 chr20:31.05 Mb said "6,300 reads in window" with 115,424 loaded and counted: 6,300 were only the ones drawn.
check('status: the count is the reads in the window, and the drawn ones are named as drawn', async (page) => {
  await open(page, allFiles());
  const r = await page.evaluate(() => { const keep = bamState.reads, all = bamState.allReads.length; bamState.reads = bamState.allReads.slice(0, 5); const s = _readsDefaultStatus(); bamState.reads = keep; return { all, s }; });
  return { pass: r.all > 5 && r.s.startsWith(r.all.toLocaleString() + ' reads in window') && /5 drawn/.test(r.s), detail: JSON.stringify(r) };
});

// ---- GLM audit of 03400b1 -------------------------------------------------------------------------------------------------
// #1: Add sequences puts rows in state.seqs without parseAndRender, so the genome stayed on screen and the rows never showed
check('audit: rows added while a genome is open close it and show, they do not vanish behind it', async (page) => {
  await open(page, allFiles());
  await page.click('#addSeqPlusButton');
  await page.fill('#addSeqInput', '>x\nACGTACGT\n>y\nACGTACGA\n');
  await page.click('#addSeqJustAddButton');
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ genome: !!_genome, rows: state.seqs.length, reads: !!document.getElementById('readsCanvas'), body: document.body.classList.contains('genome-mode'), quick: document.getElementById('quickModeSwitch').style.display }));
  return { pass: !r.genome && r.rows === 2 && !r.reads && !r.body && r.quick === '', detail: JSON.stringify(r) };
});

// #35: a load that fails wrote its message over the canvas with the genome still open: chrome of a genome, no genome
check('audit: a failed load leaves no half-open genome; Load with an empty box keeps the genome', async (page) => {
  await open(page, allFiles());
  await page.evaluate(() => { document.getElementById('fastaInput').value = ''; });
  await page.click('#input-section .section-header');
  await page.click('#loadButton');
  await page.waitForTimeout(200);
  const empty = await page.evaluate(() => ({ genome: !!_genome, canvas: !!document.getElementById('readsCanvas')?.isConnected, text: statusMessage.textContent }));
  await page.evaluate(() => { document.getElementById('fastaInput').value = '@r1\nACGT\n+\nIIII\n@r2\nACGT\n+\nIIII\n'; });
  await page.click('#loadButton');
  await page.waitForTimeout(300);
  const fq = await page.evaluate(() => ({ genome: !!_genome, body: document.body.classList.contains('genome-mode'), close: document.getElementById('genomeCloseBtn').offsetWidth, msg: alignmentContainer.textContent.slice(0, 60) }));
  return { pass: empty.genome && empty.canvas && !fq.genome && !fq.body && fq.close === 0 && /FASTQ/.test(fq.msg), detail: JSON.stringify({ empty, fq }) };
});

// #3: when the FASTA stopped being readable the calls asked for the bases again for ever, a message every few hundred ms
check('audit: a FASTA that cannot be read is said once and not asked again and again', async (page) => {
  await open(page, allFiles());
  await jump(page, 'chrA:600,000');
  const r = await page.evaluate(async () => {
    window.__n = 0; window.__m = 0;
    const o = showMessage; window.showMessage = o;
    GenomeFasta.readBases = async () => { window.__n++; throw new Error('gone'); };
    const box = document.getElementById('statusMessage'), mo = new MutationObserver(() => window.__m++); mo.observe(box, { childList: true, characterData: true, subtree: true });
    _readsCentre(2000000);
    await new Promise(r => setTimeout(r, 2500));
    return { reads: window.__n, messages: window.__m, status: _readsDefaultStatus() };
  });
  return { pass: r.reads <= 3 && r.messages <= 3 && /bases/.test(r.status), detail: JSON.stringify(r) };
});

// #5: the early return in renderAlignment skipped the block that cancels Canvas's deferred jobs; one of them threw on spliced-out rows
check('audit: opening a genome cancels the deferred jobs of the Canvas it leaves', async (page) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const { loadSyntheticFasta } = require('../lib/browser');
  await loadSyntheticFasta(page, 800, 4000);
  await page.evaluate(() => { document.getElementById('modeCanvas').checked = true; window.__p = onModeChange(); });
  await page.evaluate(() => window.__p);
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => { window.__tok = _canvasDeferredToken; return !!_canvasDeferredToken; });
  page.once('dialog', d => d.accept());
  await open(page, refFiles());
  const r = await page.evaluate(() => ({ now: _canvasDeferredToken, cancelled: window.__tok ? window.__tok.cancelled : null }));
  await page.waitForTimeout(600);
  return { pass: before && r.cancelled === true && r.now === null && !errors.length, detail: JSON.stringify({ before, r, errors }) };
});

// #18: the mode radios are still there; a click sent renderAlignment back to the genome after the toolbar had gone
check('audit: the Canvas radio with a genome open leaves the chromosome list and Close on screen', async (page) => {
  await open(page, allFiles());
  await page.evaluate(() => { const c = document.getElementById('modeCanvas'); c.checked = true; window.__p = onModeChange(); });
  await page.evaluate(() => window.__p);
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => ({ sel: document.getElementById('genomeChrom').offsetWidth, close: document.getElementById('genomeCloseBtn').offsetWidth, reads: document.getElementById('modeReads').checked, view: !!_readsView }));
  return { pass: r.sel > 0 && r.close > 0 && r.reads && r.view, detail: JSON.stringify(r) };
});

// #36: over an empty window Variants said to open a reference and a BAM, both open
check('audit: Variants over a window with no reads says that, not to open a reference', async (page) => {
  await open(page, allFiles());
  await jump(page, 'chrA:1,350,000');
  await page.click('#readsVariantsButton');
  await page.waitForTimeout(100);
  const m = await page.evaluate(() => statusMessage.textContent);
  return { pass: /window/.test(m) && !/open a reference/.test(m), detail: m };
});

// #24: a filter is the reader's, not a chromosome's
check('audit: a filter stays over a chromosome switch; sort and group, tied to a position, do not', async (page) => {
  await open(page, allFiles());
  await jump(page, 'chrA:700,000');
  await page.click('#readsOptionsBtn');
  await page.fill('#readsMinMapq', '20'); await page.press('#readsMinMapq', 'Enter');
  await page.selectOption('#readsSortBy', 'length');
  await idle(page);
  await page.selectOption('#genomeChrom', 'chrB');
  await page.waitForTimeout(40); await idle(page);
  const r = await page.evaluate(() => ({ q: _readsFilter.minMapq, box: document.getElementById('readsMinMapq').value, sort: _readsOpts.sort }));
  return { pass: r.q === 20 && r.box === '20' && r.sort === 'start', detail: JSON.stringify(r) };
});

// #2 #14: only the first cut tile was marked, and from one base past the last read kept, though reads at that very start can be missing
check('audit: every tile cut at the read cap is marked, and from the last start kept', async (page) => {
  await open(page, allFiles());
  await page.evaluate(() => { _genome.cache.clear(); const o = GenomeWindow.loadTile; GenomeWindow.loadTile = (BP, f, ix, id, t, L, op) => o(BP, f, ix, id, t, L, { ...op, maxReads: 3 }); });
  await jump(page, 'chrA:700000-760000');
  const r = await page.evaluate(() => { const w = _genome.win, tiles = []; for (let t = w.t0; t <= w.t1; t++) tiles.push(_genome.cache.peek(t)); return { cuts: w.cuts, tiles: tiles.filter(t => t.cut).length, status: _readsDefaultStatus(), lastStart: tiles.filter(t => t.cut).map(t => (t.own.length ? t.own[t.own.length - 1].start : t.start)) }; });
  return { pass: r.tiles >= 2 && r.cuts && r.cuts.length === r.tiles && r.cuts.every((c, i) => c[0] === r.lastStart[i]) && /cut/.test(r.status), detail: JSON.stringify(r) };
});

// Design: the dialog says the alignment is closed: nothing of it may come back through a tool
// A tile cut at the read cap lost reads that reach the next tile; those are only in the next tile's overhang, which the window dropped.
// The first bases of the next tile drew too low in solid colour (60x data: 2, 22, 44 where the truth was 60, 64, 62). The page's own depth is
// compared at every position with the list the BAM was built from: right, or hatched. Unit level: cutWindows in genome-window.test.js.
check('audit: past a cut tile every position is right or hatched, in the page', async (page) => {
  const L = 200000, rnd = mulberry(5), reads = [];
  for (let i = 0; i < 80000; i++) reads.push({ ref: 0, pos: (rnd() * (L - 150)) | 0, name: 'r' + i, cigar: [[150, 'M']] });
  reads.sort((a, b) => a.pos - b.pos);
  const { bam, bai } = buildBam([['chrD', L]], reads), { text, fai } = fastaOf([['chrD', 'A'.repeat(L)]]);
  await open(page, [file('d.fa', Buffer.from(text)), file('d.fa.fai', Buffer.from(fai)), file('d.bam', bam), file('d.bam.bai', bai)]);
  await page.evaluate(() => { _genome.cache.clear(); _genome.win = { ..._genome.win, t0: -1, t1: -1 }; const o = GenomeWindow.loadTile; GenomeWindow.loadTile = (BP, f, ix, id, t, L, op) => o(BP, f, ix, id, t, L, { ...op, maxReads: 3000 }); });
  await jump(page, 'chrD:20000-60000');
  const r = await page.evaluate(() => {
    const w = _genome.win; _genome.callsId = -1; const c = _genomeCalls().counts;
    return { ws: w.ws, we: w.we, cuts: w.cuts, lo: c.lo, hi: c.hi, depth: Array.from(c.depth), status: _readsDefaultStatus(), n: bamState.allReads.length, file: bamState.fileReads.length };
  });
  const d = new Int32Array(L + 1);
  for (const x of reads) { d[x.pos]++; d[x.pos + 150]--; }
  for (let i = 1; i <= L; i++) d[i] += d[i - 1];
  let wrong = 0, hatched = 0, first = '';
  for (let p = r.ws; p < r.we; p++) {
    if (r.cuts.some(([s, e]) => p >= s && p < e)) { hatched++; continue; }
    const got = p >= r.lo && p < r.hi ? r.depth[p - r.lo] : 0;
    if (got !== d[p]) { wrong++; first = first || `${p + 1}: page ${got}, truth ${d[p]}`; }
  }
  // the status names the stretch that is not known: past the tile the depth is known again
  return { pass: r.cuts.length >= 2 && hatched > 0 && !wrong && r.n === r.file && /cut at [\d,]+-[\d,]+/.test(r.status), detail: JSON.stringify({ wrong, first, hatched, cuts: r.cuts, status: r.status, n: r.n, file: r.file }) };
});

// A .fai that does not fit its FASTA was taken as long as the first header was in place: the page showed wrong bases and said nothing.
// A re-wrapped FASTA is refused at the door; a record added before the second chromosome is refused when that chromosome is opened.
check('audit: a .fai that does not fit the FASTA is refused, no wrong base is shown', async (page) => {
  const rnd = mulberry(4), seq = n => { let q = ''; for (let i = 0; i < n; i++) q += 'ACGT'[(rnd() * 4) | 0]; return q; };
  const chr1 = seq(4000), chr2 = seq(3000), good = fastaOf([['chr1', chr1], ['chr2', chr2]], 80);
  const refused = await (async () => {
    await page.setInputFiles('#genomeFileInput', [file('a.fa', Buffer.from(fastaOf([['chr1', chr1], ['chr2', chr2]], 60).text)), file('a.fa.fai', Buffer.from(good.fai))]);
    await page.waitForFunction(() => /fit/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
    return page.evaluate(() => ({ genome: typeof _genome !== 'undefined' && !!_genome, said: /does not fit the FASTA/.test(document.body.innerText) }));
  })();
  const moved = fastaOf([['chr1', chr1], ['chrX', seq(500)], ['chr2', chr2]], 80);
  await open(page, [file('b.fa', Buffer.from(moved.text)), file('b.fa.fai', Buffer.from(good.fai))]);
  const first = await page.evaluate(() => bamState.refSeq);
  await page.selectOption('#genomeChrom', 'chr2');
  await page.waitForTimeout(60); await idle(page);
  const r = await page.evaluate(() => ({ name: bamState.refName, ref: bamState.refSeq, status: _genomeStatusHead(), said: /does not fit the FASTA/.test(document.body.innerText) }));
  return { pass: !refused.genome && refused.said && first.startsWith(chr1.slice(0, 40)) && r.name === 'chr2' && r.ref === '' && r.said && /\.fai/.test(r.status), detail: JSON.stringify({ refused, ok1: first.slice(0, 10), ...r, ref: r.ref.slice(0, 20) }) };
});

check('audit: an alignment closed by a genome stays closed: Close shows the start page, Undo and trim restore bring nothing back', async (page) => {
  await loadFasta(page, '>a\nACGTACGTAC\n>b\nACGTACGTAA\n');
  await page.evaluate(() => { pushUndo('test'); state.trimBackup = state.seqs.map(s => ({ ...s })); });
  page.once('dialog', d => d.accept());
  await open(page, refFiles());
  const r = await page.evaluate(() => { const a = { undo: state.deletedHistory.length, redo: state.redoHistory.length, trim: state.trimBackup, rows: state.seqs.length }; return a; });
  await page.click('#genomeCloseBtn');
  const after = await page.evaluate(() => ({ rows: state.seqs.length, start: /No sequences loaded/.test(alignmentContainer.textContent) }));
  return { pass: r.undo === 0 && r.redo === 0 && r.trim === null && r.rows === 0 && after.rows === 0 && after.start, detail: JSON.stringify({ r, after }) };
});

// Refutations kept as checks. #9: refBase cannot leak: a plain load builds bamState anew. #15: a variant row goes to its own base.
check('audit: after a genome, plain reads have no refBase and their mismatches are right', async (page) => {
  await open(page, allFiles());
  await jump(page, 'chrA:700,000');
  const had = await page.evaluate(() => bamState.refBase);
  await page.click('#genomeCloseBtn');
  await loadFasta(page, '>chrZ\n' + 'ACGT'.repeat(50) + '\n');
  const sam = '@SQ\tSN:chrZ\tLN:200\nr1\t0\tchrZ\t11\t60\t20M\t*\t0\t0\t' + 'GTACGTACGTACGTACGTAC' + '\t*\n';
  await page.setInputFiles('#bamFileInput', file('z.sam', Buffer.from(sam)));
  await page.waitForFunction(() => bamState.reads.length > 0);
  const r = await page.evaluate(() => ({ base: bamState.refBase, ch: _readsRefChar(0), g: !!_genome }));
  return { pass: had > 0 && r.base === undefined && r.ch === 'A' && !r.g, detail: JSON.stringify({ had, ...r }) };
});

check('audit: a click on a variant row goes to that base', async (page) => {
  await open(page, allFiles());
  await jump(page, 'chrA:700,000');
  await zoom(page, 1);
  await page.click('#readsVariantsButton');
  await idle(page);
  const r = await page.evaluate(() => { const tr = document.querySelector('#variantsTable tbody tr[data-pos]'); const pos = +tr.dataset.pos; tr.click(); return { pos, focus: bamState.focusPos, centre: (_readsLeft() + (_readsView.w - _READS_NAME_W) / 2) / _readsView.cell }; });
  return { pass: r.focus === r.pos - 1 && Math.abs(r.centre - (r.pos - 1)) < 1, detail: JSON.stringify(r) };
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
      page.setDefaultTimeout(10000);
      await page.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
      out = await fn(page);
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
