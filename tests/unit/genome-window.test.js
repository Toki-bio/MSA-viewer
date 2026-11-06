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

(async () => {
  const s = await loadSet();
  await readerOptions(s);
  await tiles(s);
  rows();
  cache();
  await loader();
  await calls(s);
  await realIndex();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
