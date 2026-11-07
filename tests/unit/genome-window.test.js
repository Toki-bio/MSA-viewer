// The genome view's window (genome-window.js): tiles, assembly, cache, stable rows, the fetch loop, calls on a window.
// Checked against a scan of the whole file and against SampleCall on the whole reference. Run: node tests/unit/genome-window.test.js
const fs = require('fs'), path = require('path');
const BP = require('../../bam-parser.js'), SC = require('../../sample-call.js'), GW = require('../../genome-window.js');
const { buildBam, syntheticReads, mulberry } = require('../lib/synth-bam.js');
const ROOT = path.join(__dirname, '..', '..');
let fails = 0;
const check = (name, ok, detail) => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : ' - ' + detail}`); if (!ok) fails++; };
const spanOf = c => c.reduce((n, x) => n + ('MDN=X'.includes(x.op) ? x.len : 0), 0);
const id = r => r.name + '/' + r.flag + '/' + r.pos;

async function loadSet() {
  const refs = [['chrA', 3000000], ['chrB', 200000]], { bam, bai } = buildBam(refs, syntheticReads(), false);
  const file = new Blob([bam]), index = BP.parseBAI(new Uint8Array(bai));
  const buf = await BP.decompressBAM(file), h = BP.parseBAMHeader(buf);
  return { file, index, L: refs[0][1], all: BP.parseBAMRecords(buf, h.headerEndOffset, true).records.filter(r => r.refID === 0) };
}

async function readerOptions(s) {
  const plain = await BP.readBamRegion(s.file, s.index, 0, 0, 200000, true);
  check('reader: a stale region stops and says so', (await BP.readBamRegion(s.file, s.index, 0, 0, 200000, true, { isStale: () => true })).stale === true, 'no stale flag');
  const cut = await BP.readBamRegion(s.file, s.index, 0, 0, 200000, true, { maxReads: 100 });
  check('reader: a read cap stops at the cap and says so', cut.cut === true && cut.records.length === 100, `${cut.cut} ${cut.records.length}`);
  check('reader: without options nothing is stale or cut', !plain.stale && !plain.cut && plain.records.length > 100, JSON.stringify([plain.stale, plain.cut]));
}

async function tiles(s) {
  check('tile range: [16384, 16385) is tile 1 only', GW.tileRange(16384, 16385).join() === '1,1', GW.tileRange(16384, 16385).join());
  check('tile range: [0, 16385) is tiles 0 and 1', GW.tileRange(0, 16385).join() === '0,1', GW.tileRange(0, 16385).join());
  const load = t => GW.loadTile(BP, s.file, s.index, 0, t, s.L);
  const t1 = await load(1);
  check('tile: own reads start in it', t1.own.length > 0 && t1.own.every(r => r.pos >= 16384 && r.pos < 32768), 'a read starts outside');
  check('tile: over reads start before it and reach it', t1.over.every(r => r.pos < 16384 && r.pos + spanOf(r.cigar) > 16384), 'a read does not reach it');
  check('tile: a read across the left edge is in over', t1.over.some(r => r.name === 'edge16300'), 'edge16300 missing');
  check('tile: a read starting on the tile\'s first base is its own, not over', t1.own.some(r => r.name === 'edge16384') && !t1.over.some(r => r.name === 'edge16384'), 'edge16384 in over');
  check('tile: reads carry start and end as the Reads view wants', t1.own.every(r => r.start === r.pos && r.end === r.pos + spanOf(r.cigar) - 1), 'start/end wrong');
  // every order of fetching, every contiguous window: each overlapping read exactly once
  const rnd = mulberry(21), maxTile = Math.floor((s.L - 1) / GW.TILE), have = new Map();
  let windows = 0, wanted = 0, lost = 0, twice = 0, extra = 0;
  for (let i = 0; i < 120; i++) {
    const a = (rnd() * (maxTile - 12)) | 0, n = 1 + ((rnd() * 12) | 0), order = Array.from({ length: n }, (_, k) => a + k).sort(() => rnd() - 0.5), list = [];
    for (const t of order) if (!have.has(t)) have.set(t, await load(t));
    for (let t = a; t < a + n; t++) list.push(have.get(t));
    const beg = a * GW.TILE, end = (a + n) * GW.TILE, reads = GW.assemble(list), seen = new Map();
    for (const r of reads) seen.set(id(r), (seen.get(id(r)) || 0) + 1);
    const want = s.all.filter(r => r.pos < end && r.pos + Math.max(1, spanOf(r.cigar)) > beg);
    windows++; wanted += want.length;
    for (const r of want) if (!seen.has(id(r))) lost++;
    for (const n2 of seen.values()) if (n2 > 1) twice++;
    extra += seen.size - want.filter(r => seen.has(id(r))).length;
    for (let k = 1; k < reads.length; k++) if (reads[k].pos < reads[k - 1].pos) { check('assembly stays in position order', false, `at ${reads[k].pos}`); break; }
  }
  check(`assembly: ${windows} windows, ${wanted} reads, each exactly once`, !lost && !twice && !extra, `${lost} lost, ${twice} twice, ${extra} extra`);
}

// Every position of a window with cut tiles is either right or hatched. Reads lost from the right part of a cut tile that reach into
// the next tile are only in that tile's `over`, which assemble dropped unless the tile was first: 60x data showed 2, 22, 44 where the
// truth was 60, 64, 62, in solid colour, past the end of the hatch. The oracle is the list the BAM was built from, and every position
// of every contiguous window is compared. The long reads make a cap fall inside `over` (a whole tile hatched, the next one holding
// what both lost); ties and identical records sit across the cut so a read taken twice shows too.
async function cutWindows() {
  const depthOf = (reads, L) => {
    const d = new Int32Array(L + 1);
    for (const r of reads) { let q = r.pos; for (const [l, o] of r.cigar) { if ('M=XD'.includes(o)) { d[q]++; d[q + l]--; q += l; } else if (o === 'N') q += l; } }
    for (let i = 1; i <= L; i++) d[i] += d[i - 1];
    return d;
  };
  const sets = {
    '60x': (L, rnd, reads) => { for (let i = 0; i < 24000; i++) reads.push({ ref: 0, pos: (rnd() * (L - 150)) | 0, name: 'r' + i, cigar: [[150, 'M']] }); },
    'long reads': (L, rnd, reads) => {
      for (let i = 0; i < 9000; i++) reads.push({ ref: 0, pos: (rnd() * (L - 150)) | 0, name: 's' + i, cigar: [[150, 'M']] });
      for (let i = 0; i < 400; i++) reads.push({ ref: 0, pos: (rnd() * (L - 60000)) | 0, name: 'l' + i, cigar: [[5000 + ((rnd() * 50000) | 0), 'M']] });
      for (let i = 0; i < 60; i++) reads.push({ ref: 0, pos: (rnd() * (L - 30000)) | 0, name: 'n' + i, cigar: [[80, 'M'], [20000, 'N'], [70, 'M']] });
    },
    'ties and identical records': (L, rnd, reads) => {
      for (let i = 0; i < 300; i++) { const pos = (rnd() * (L - 400)) | 0; for (let k = 0; k < 20; k++) reads.push({ ref: 0, pos, name: 'd' + (k % 4 ? i * 20 + k : i), cigar: [[300, 'M']] }); }
    },
  };
  for (const [name, fill] of Object.entries(sets)) {
    const L = 100000, rnd = mulberry(5), reads = [];
    fill(L, rnd, reads);
    reads.sort((a, b) => a.pos - b.pos);
    await cutCase(name, L, reads, [40, 300, 900], depthOf);   // below a tile's reads in each set: a cap that cuts nothing fails the check
  }
  // the last small tile of a chromosome: chrM at high depth, where tile 0 is cut and tile 1 is 185 bases
  const L = 16569, rnd = mulberry(8), reads = [];
  for (let i = 0; i < 44000; i++) reads.push({ ref: 0, pos: (rnd() * (L - 150)) | 0, name: 'm' + i, cigar: [[150, 'M']] });
  reads.sort((a, b) => a.pos - b.pos);
  await cutCase('chrM, a last tile of 185 bases', L, reads, [200, 600, 6000], depthOf);
}
async function cutCase(name, L, reads, caps, depthOf) {
  const { bam, bai } = buildBam([['chrA', L]], reads), file = new Blob([bam]), index = BP.parseBAI(new Uint8Array(bai));
  const truth = depthOf(reads, L), refSeq = 'A'.repeat(L), last = Math.floor((L - 1) / GW.TILE);
  const names = new Map();
  for (const r of reads) { const k = r.pos + '|' + r.name; names.set(k, (names.get(k) || 0) + 1); }
  for (const cap of caps) {
    const tiles = [];
    for (let t = 0; t <= last; t++) tiles.push(await GW.loadTile(BP, file, index, 0, t, L, { maxReads: cap }));
    let windows = 0, positions = 0, hatched = 0, wrong = 0, first = '', twice = 0, unordered = 0, cuts = 0;
    for (let a = 0; a <= last; a++) for (let b = a; b <= last; b++) {
      const list = tiles.slice(a, b + 1), win = GW.assemble(list), spans = GW.cutSpans(list), ws = list[0].start, we = list[list.length - 1].end;
      windows++; cuts += spans.length;
      const c = win.length ? GW.callsFor(SC, win, refSeq, 0, ws, we).counts : null, seen = new Map();
      for (const r of win) { const k = r.pos + '|' + r.name; seen.set(k, (seen.get(k) || 0) + 1); }
      for (const [k, n] of seen) if (n > (names.get(k) || 0)) twice++;
      for (let i = 1; i < win.length; i++) if (win[i].pos < win[i - 1].pos) unordered++;
      for (let p = ws; p < we; p++) {
        positions++;
        if (spans.some(([s, e]) => p >= s && p < e)) { hatched++; continue; }
        const got = c && p >= c.lo && p < c.hi ? c.depth[p - c.lo] : 0;
        if (got !== truth[p]) { wrong++; if (!first) first = `tiles ${a}-${b}: position ${p + 1} shows ${got}, truth ${truth[p]}, not hatched`; }
      }
    }
    check(`cut tiles, ${name}, cap ${cap}: ${windows} windows, ${positions} positions (${hatched} hatched, ${cuts} cuts) are right or hatched`, cuts > 0 && !wrong && !twice && !unordered, `${wrong} wrong, ${twice} read twice, ${unordered} out of order; ${first}`);
  }
}

function fakeRead(name, start, len) { return { name, flag: 0, pos: start, start, end: start + len - 1, cigar: [{ op: 'M', len }], track: -1 }; }
function rows() {
  // a walk of windows over one set of reads: objects are renewed for reads that cross a window's left edge, as tile overhangs are
  const rnd = mulberry(5), base = [];
  for (let i = 0; i < 6000; i++) base.push(['r' + i, (rnd() * 600000) | 0, 100 + ((rnd() * 900) | 0)]);
  base.sort((a, b) => a[1] - b[1]);
  let prev = null, moved = 0, kept = 0, jumped = 0, overlaps = 0, pos = 200000;
  const placed = new Map();
  for (let step = 0; step < 300; step++) {
    pos = Math.max(0, Math.min(560000, pos + ((rnd() - 0.5) * 16000) | 0));
    const ws = pos, we = pos + 40000, reads = [];
    for (const [n, st, len] of base) if (st < we && st + len > ws) {
      const old = prev && prev.byName.get(n);
      reads.push(old && st >= ws ? old : fakeRead(n, st, len));
    }
    const nTracks = GW.packWindow(reads, prev && { reads: prev.reads, start: prev.ws });
    const byName = new Map();
    for (const r of reads) {
      byName.set(r.name, r);
      const before = prev && prev.byName.get(r.name);
      if (before) { kept++; if (before.trackThen !== r.track) jumped++; }
      r.trackThen = r.track;
    }
    const rowsOf = Array.from({ length: nTracks }, () => []);
    for (const r of reads) rowsOf[r.track].push(r);
    for (const g of rowsOf) { g.sort((a, b) => a.start - b.start); for (let i = 1; i < g.length; i++) if (g[i].start <= g[i - 1].end) overlaps++; }
    prev = { reads, ws, byName }; moved++;
  }
  check(`stable rows: ${moved} moves, ${kept} reads carried over, none changes row`, kept > 1000 && !jumped, `${jumped} of ${kept} changed row`);
  check('stable rows: no two reads overlap on a row', !overlaps, `${overlaps} overlaps`);
  // going left: a new read before a row's first read shares the row, it does not open a new one
  const was = [fakeRead('m', 1000, 100)], left = [fakeRead('l', 500, 100), was[0]];
  GW.packWindow(was, null);
  check('stable rows: going left reuses a row', GW.packWindow(left, { reads: was, start: 1000 }) === 1 && left[0].track === 0, left.map(r => r.track).join());
  const a = [fakeRead('a', 0, 100), fakeRead('b', 50, 100), fakeRead('c', 120, 10)];
  check('stable rows: with nothing carried it is first-fit', GW.packWindow(a, null) === 2 && a[2].track === 0, a.map(r => r.track).join());
}

function cache() {
  const c = new GW.TileCache(1000), tile = (t, bytes) => ({ t, bytes, own: [], over: [] });
  for (let t = 0; t < 5; t++) c.put(tile(t, 300));
  c.evict(4, 4);
  check('cache: over budget the oldest go', c.bytes <= 1000 && !c.has(0) && c.has(4), `${c.bytes} bytes, has 0: ${c.has(0)}`);
  c.get(2); c.put(tile(5, 300)); c.evict(5, 5);
  check('cache: a tile used lately stays', c.has(2) && !c.has(3), `has 2: ${c.has(2)}, has 3: ${c.has(3)}`);
  const d = new GW.TileCache(100); d.put(tile(1, 300)); d.put(tile(2, 300)); d.evict(1, 2);
  check('cache: the current window never goes, even over budget', d.has(1) && d.has(2), 'evicted');
  const mate = { _mate: null }, r = { _mate: mate }; mate._mate = r;
  const e = new GW.TileCache(1); e.put({ t: 1, bytes: 10, own: [r], over: [] }); e.evict(9, 9);
  check('cache: eviction frees the mate link that would pin the tile', mate._mate === null && r._mate === null, 'still linked');
}

async function loader() {
  const calls = [], gates = [];
  const load = (t, stale) => { calls.push(t); return new Promise(res => gates.push(() => res(stale() ? null : { t, bytes: 1, own: [], over: [] }))); };
  const c = new GW.TileCache(1e6), seen = [];
  const l = GW.createLoader({ load, cache: c, group: 4, onTiles: x => seen.push(...x.map(y => y.t)) });
  const tick = () => new Promise(r => setTimeout(r, 0));
  const open = async () => { while (gates.length) { gates.splice(0).forEach(g => g()); await tick(); await tick(); } };
  l.want({ first: 10, last: 11, keepFirst: 8, keepLast: 13, ahead: [12, 13, 9, 8] });
  await tick();
  check('loader: visible tiles come first, in one group', calls.join() === '10,11', calls.join());
  l.want({ first: 500, last: 500, keepFirst: 499, keepLast: 501, ahead: [501] });
  l.want({ first: 900, last: 900, keepFirst: 899, keepLast: 901, ahead: [901, 899] });
  await tick();
  check('loader: one group in flight whatever the moves', calls.length === 2, calls.join());
  await open();
  check('loader: only the last place wanted is read after a jump', !calls.includes(500) && calls.includes(900), calls.join());
  check('loader: a stale tile does not enter the cache', !c.has(10) && !c.has(11), 'stale tile cached');
  check('loader: then the place ahead, in the direction of travel', calls.indexOf(901) > calls.indexOf(900) && calls.indexOf(899) > calls.indexOf(901), calls.join());
  check('loader: a tile in the cache is not read again', calls.filter(t => t === 900).length === 1, calls.join());
  // finished reading just as the view left: already paid for, so it is kept
  const c3 = new GW.TileCache(1e6); let release;
  const l3 = GW.createLoader({ load: t => new Promise(res => { release = () => res({ t, bytes: 1, own: [], over: [] }); }), cache: c3, onTiles() {} });
  l3.want({ first: 1, last: 1, keepFirst: 0, keepLast: 2, ahead: [] }); await tick();
  l3.want({ first: 1, last: 1, keepFirst: 900, keepLast: 901, ahead: [] }); release(); await tick(); await tick();
  check('loader: a tile that finished after the view left is kept', c3.has(1), 'dropped');
  l3.stop();
  const c2 = new GW.TileCache(1e6);
  let err = null;
  const l2 = GW.createLoader({ load: () => Promise.reject(new Error('file changed')), cache: c2, onTiles() {}, onError: e => { err = e; } });
  l2.want({ first: 1, last: 1, keepFirst: 0, keepLast: 2, ahead: [] });
  await tick(); await tick();
  check('loader: a failed read is reported and the loop ends', err && err.message === 'file changed' && !l2.busy(), String(err));
}

async function calls(s) {
  // SampleCall on a window, against SampleCall on the whole reference: same depth, same counts, same variants inside it
  const rnd = mulberry(9), bases = 'ACGT', L = s.L, a = new Uint8Array(L);
  for (let i = 0; i < L; i++) a[i] = bases.charCodeAt((rnd() * 4) | 0);
  const ref = Buffer.from(a).toString('latin1');
  const dressed = s.all.map(r => { r.start = r.pos; r.end = r.pos + spanOf(r.cigar) - 1; return r; });
  const whole = SC.call(dressed, ref);
  let cmpd = 0, bad = 0, windows = 0, varBad = 0, varN = 0;
  for (let i = 0; i < 25; i++) {
    const ws = 100000 + ((rnd() * 2700000) | 0), we = ws + 20000 + ((rnd() * 60000) | 0);
    const reads = dressed.filter(r => r.start < we && r.end >= ws);
    if (!reads.length) continue;
    let lo = ws, hi = we; for (const r of reads) { if (r.start < lo) lo = r.start; if (r.end + 1 > hi) hi = r.end + 1; }
    const res = GW.callsFor(SC, reads, ref.slice(lo, hi), lo, ws, we);
    windows++;
    const c = res.counts;
    if (c.lo < ws || c.hi > we) bad++;
    for (let p = c.lo; p < c.hi; p++) {
      const x = SC.countsAt(c, p), y = SC.countsAt(whole.counts, p); cmpd++;
      if (!y || x.depth !== y.depth || x.A[0] !== y.A[0] || x.C[1] !== y.C[1] || x.G[0] !== y.G[0] || x.T[1] !== y.T[1]) bad++;
    }
    const want = whole.variants.filter(v => v.pos - 1 >= ws && v.pos - 1 < we).map(v => v.pos + v.type + v.alt).join();
    const got = res.variants.map(v => v.pos + v.type + v.alt).join();
    varN += res.variants.length; if (want !== got) varBad++;
  }
  check(`calls on a window: ${windows} windows, ${cmpd} positions equal to the whole reference`, cmpd > 100000 && !bad, `${bad} differ`);
  check(`calls on a window: same ${varN} variants, absolute positions`, varN > 0 && !varBad, `${varBad} windows differ`);
  check('calls on a window: reads themselves are not moved', dressed.every(r => r.start === r.pos), 'pos changed');
}

async function realIndex() {
  const raw = fs.readFileSync(path.join(ROOT, 'tests/fixtures/reads/chrom/chrom_reads.bam')), file = new Blob([raw]);
  const index = BP.parseBAI(new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/reads/chrom/chrom_reads.bam.bai'))));
  const est = GW.indexBytes(index, 0, 0, 200000), small = GW.indexBytes(index, 0, 100000, 100100);
  check('gate: the index tells a big span from a small one without reading', est > 0 && small < est, `${small} vs ${est}`);
  check('gate: past the end of the index is 0 or small, not an error', GW.indexBytes(index, 0, 1e9, 1e9 + 100) >= 0, 'negative');
  check('gate: an unknown reference is 0', GW.indexBytes(index, 99, 0, 100) === 0, 'not 0');
  const lin = index.refs[0].lin.length;
  check('first read: the first non-empty linear window', GW.firstRead(index, 0) >= 0 && GW.firstRead(index, 0) < lin * GW.TILE, String(GW.firstRead(index, 0)));
  check('first read: a reference with no reads is 0', GW.firstRead({ refs: [{ bins: new Map(), lin: [] }] }, 0) === 0, 'not 0');
}

function planning() {
  const T = GW.TILE, p = GW.planView({ a: 5 * T + 100, b: 5 * T + 200, dir: 1, chrLen: 1000 * T });
  check('plan: on screen is the tile under the view', p.first === 5 && p.last === 5, p.first + '-' + p.last);
  const w = GW.planView({ a: 10 * T, b: 14 * T, dir: 1, chrLen: 1000 * T });
  check('plan: the window is a screen each side, in tiles', w.keepFirst === 6 && w.keepLast === 17, w.keepFirst + '-' + w.keepLast);
  check('plan: moving right, the right side comes first', w.ahead[0] === 14 && w.ahead.indexOf(9) > w.ahead.indexOf(17), w.ahead.join());
  const l = GW.planView({ a: 10 * T, b: 14 * T, dir: -1, chrLen: 1000 * T });
  check('plan: moving left, the left side comes first', l.ahead[0] === 9, l.ahead.join());
  const e = GW.planView({ a: 0, b: 2 * T, dir: -1, chrLen: 3 * T });
  check('plan: stays on the chromosome', e.keepFirst === 0 && e.keepLast === 2 && e.ahead.every(t => t >= 0 && t <= 2), JSON.stringify(e));
  check('plan: the last partial tile counts', GW.planView({ a: T, b: T + 50, dir: 1, chrLen: T + 50 }).keepLast === 1, 'past the end');
}
function files() {
  const F = (...n) => n.map(name => ({ name }));
  check('a set is a genome only with a .fai among the files', GW.isGenomeSet(F('a.fa', 'a.fa.fai')) && !GW.isGenomeSet(F('a.fa')) && !GW.isGenomeSet(F('a.bam', 'a.bam.bai')) && !GW.isGenomeSet([]), 'wrong');
  const all = GW.pickFiles(F('r.bam.bai', 'g.fa.fai', 'r.bam', 'g.fa'));
  check('pick: all four sorted by name', all.fasta.name === 'g.fa' && all.fai.name === 'g.fa.fai' && all.bam.name === 'r.bam' && all.bai.name === 'r.bam.bai' && !all.errors.length, JSON.stringify(all.errors));
  const ref = GW.pickFiles(F('g.fasta', 'g.fasta.fai'));
  check('pick: FASTA and .fai alone are enough', ref.fasta && !ref.bam && !ref.errors.length, JSON.stringify(ref.errors));
  check('pick: a BAM without its .bai says how to make it', /samtools index/.test(GW.pickFiles(F('g.fa', 'g.fa.fai', 'r.bam')).errors.join()), 'no message');
  check('pick: a .bai without a BAM is named', /\.bai/.test(GW.pickFiles(F('g.fa', 'g.fa.fai', 'r.bam.bai')).errors.join()), 'no message');
  check('pick: a .fai without its FASTA is named', /FASTA/.test(GW.pickFiles(F('g.fa.fai')).errors.join()), 'no message');
  check('pick: compressed FASTA is refused', /gz/.test(GW.pickFiles(F('g.fa.gz', 'g.fa.gz.fai')).errors.join()), 'no message');
  check('pick: .csi and .crai are refused', /csi/.test(GW.pickFiles(F('g.fa', 'g.fa.fai', 'r.bam', 'r.bam.csi')).errors.join()) && /crai/.test(GW.pickFiles(F('g.fa', 'g.fa.fai', 'r.cram', 'r.cram.crai')).errors.join()), 'no message');
  // Several BAMs: the first .bam went with the first .bai by name order, so x.bam could open with y.bam.bai, and the reads of x.bam came
  // through the index of y.bam. They are paired by name now.
  const names = p => [p.bam && p.bam.name, p.bai && p.bai.name].join();
  check('pick: x.bam goes with x.bam.bai, not with the .bai that sorts first', names(GW.pickFiles(F('g.fa', 'g.fa.fai', 'x.bam', 'y.bam', 'a.bam.bai', 'x.bam.bai'))) === 'x.bam,x.bam.bai', names(GW.pickFiles(F('g.fa', 'g.fa.fai', 'x.bam', 'y.bam', 'a.bam.bai', 'x.bam.bai'))));
  check('pick: x.bam goes with x.bai', names(GW.pickFiles(F('g.fa', 'g.fa.fai', 'x.bam', 'a.bai', 'x.bai'))) === 'x.bam,x.bai', names(GW.pickFiles(F('g.fa', 'g.fa.fai', 'x.bam', 'a.bai', 'x.bai'))));
  check('pick: the BAM with an index is taken over one without', names(GW.pickFiles(F('g.fa', 'g.fa.fai', 'a.bam', 'x.bam', 'x.bam.bai'))) === 'x.bam,x.bam.bai', names(GW.pickFiles(F('g.fa', 'g.fa.fai', 'a.bam', 'x.bam', 'x.bam.bai'))));
  check('pick: x.bam.bai is taken over x.bai', names(GW.pickFiles(F('g.fa', 'g.fa.fai', 'x.bam', 'x.bai', 'x.bam.bai'))) === 'x.bam,x.bam.bai', names(GW.pickFiles(F('g.fa', 'g.fa.fai', 'x.bam', 'x.bai', 'x.bam.bai'))));
  check('pick: one BAM and one .bai of another name stay a pair (a renamed file); the reader checks the fit', names(GW.pickFiles(F('g.fa', 'g.fa.fai', 'x.bam', 'renamed.bai'))) === 'x.bam,renamed.bai' && !GW.pickFiles(F('g.fa', 'g.fa.fai', 'x.bam', 'renamed.bai')).errors.length, 'not paired');
  check('pick: several BAMs and indexes with no pair by name are refused', /by name/.test(GW.pickFiles(F('g.fa', 'g.fa.fai', 'x.bam', 'y.bam', 'a.bai', 'b.bai')).errors.join()), 'no message');
  const two = GW.pickFiles(F('x.fa', 'g.fa', 'g.fa.fai'));
  check('pick: of two FASTA the one the .fai is named after', two.fasta.name === 'g.fa', two.fasta && two.fasta.name);
}
function chromosomes() {
  const fai = [{ name: 'chr1', length: 100 }, { name: 'chr2', length: 50 }, { name: 'chrM', length: 16 }];
  const same = GW.matchChromosomes(fai, ['chr1', 'chr2'], [100, 50]);
  check('names: exact', same.refId.get('chr1') === 0 && same.refId.get('chr2') === 1 && !same.refId.has('chrM') && !same.error, JSON.stringify(same.error));
  const alias = GW.matchChromosomes(fai, ['1', '2', 'MT'], [100, 50, 16]);
  check('names: chr and MT aliases', alias.refId.get('chr1') === 0 && alias.refId.get('chrM') === 2 && !alias.error, JSON.stringify(alias.error));
  check('names: a different length is another assembly, refused', /chr2/.test(GW.matchChromosomes(fai, ['chr1', 'chr2'], [100, 51]).error || ''), 'no error');
  check('names: nothing in common is refused', /no chromosome/i.test(GW.matchChromosomes(fai, ['x'], [5]).error || ''), 'no error');
}
function locus() {
  const names = [{ name: 'chr7', length: 200 }, { name: 'chrUn:odd', length: 9 }];
  const L = t => GW.parseLocus(t, names);
  check('locus: chr7:1,000,000', L('chr7:1,000,000').name === 'chr7' && L('chr7:1,000,000').rest === '1,000,000', JSON.stringify(L('chr7:1,000,000')));
  check('locus: a position alone stays on this chromosome', L('12,000').name === null && L('12,000').rest === '12,000', JSON.stringify(L('12,000')));
  check('locus: a name alone goes to the chromosome', L('chr7').name === 'chr7' && L('chr7').rest === '', JSON.stringify(L('chr7')));
  check('locus: 7:100-200, the name without chr', L('7:100-200').name === 'chr7', JSON.stringify(L('7:100-200')));
  check('locus: a name with a colon in it', L('chrUn:odd').name === 'chrUn:odd', JSON.stringify(L('chrUn:odd')));
  check('locus: an unknown name is an error', /chr9/.test(L('chr9:5').error || ''), JSON.stringify(L('chr9:5')));
}

function audit() {
  const F = (...n) => n.map(name => ({ name }));
  // #4: a .fa.gz in the folder refused a set that has the plain FASTA too
  const p = GW.pickFiles(F('g.fa.gz', 'g.fa', 'g.fa.fai', 'r.bam', 'r.bam.bai'));
  check('audit: a .fa.gz beside the plain .fa is left out, the plain one opens', p.fasta && p.fasta.name === 'g.fa' && !p.errors.length, JSON.stringify(p.errors));
  const q = GW.pickFiles(F('g.fa.gz', 'g.fa.gz.fai', 'g.fa', 'g.fa.fai'));
  check('audit: of two .fai the plain FASTA\'s is taken', q.fai && q.fai.name === 'g.fa.fai' && !q.errors.length, JSON.stringify([q.fai && q.fai.name, q.errors]));
  check('audit: a .fa.gz with no plain FASTA is still refused', /gz/.test(GW.pickFiles(F('g.fa.gz', 'g.fa.gz.fai')).errors.join()), 'no message');
  // #2 #14: cut tiles
  const own = s => s.map(x => ({ start: x }));
  const cuts = GW.cutSpans([{ start: 0, end: 100, cut: true, own: own([5, 50, 50]) }, { start: 100, end: 200, cut: false, own: own([120]) }, { start: 200, end: 300, cut: true, own: own([]) }]);
  check('audit: a cut tile is marked from its last start kept, every cut tile', JSON.stringify(cuts) === '[[50,100],[200,300]]', JSON.stringify(cuts));
  // #39: drop() cleared _mate but left _mateLeft on the live mate: the next frame read r._mate.start of null
  const live = { _mateLeft: true }, dead = { _mateLeft: false, _mate: live }; live._mate = dead;
  const e = new GW.TileCache(1); e.put({ t: 1, bytes: 10, own: [dead], over: [] }); e.evict(9, 9);
  check('audit: eviction leaves no read marked left mate with no mate', !live._mateLeft && live._mate === null, JSON.stringify({ l: live._mateLeft }));
  // #38: two identical records renewed by a tile reload shared one key, so one row, overlapping
  const mk = () => [fakeRead('d', 100, 50), fakeRead('d', 100, 50)];
  const was = mk(); GW.packWindow(was, null);
  const now = mk(); GW.packWindow(now, { reads: was, start: 0 });
  check('audit: two identical records keep two rows', now[0].track !== now[1].track, now.map(r => r.track).join());
}

(async () => {
  audit();
  const s = await loadSet();
  await readerOptions(s);
  await tiles(s);
  await cutWindows();
  rows();
  cache();
  await loader();
  await calls(s);
  await realIndex();
  planning();
  files();
  chromosomes();
  locus();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
