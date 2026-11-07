/**
 * genome-window.js - the window of the genome view, with no DOM: fixed tiles of reads, what a window of tiles holds, the tile
 * cache, rows that stay as the window moves, the fetch loop, and SampleCall on a window. Design and reasons: DESIGN.md of the
 * genome work. Browser global GenomeWindow, or require() in Node (tests/unit/genome-window.test.js).
 *
 * A tile is 16,384 bp, the .bai's own linear window. It owns the reads starting in it (own); over is the reads starting before
 * it that reach into it. A window of contiguous tiles T1..Tk holds own(T1..Tk) + over(T1): a read starting inside is in exactly
 * one own, and a read starting before overlaps T1, so every overlapping read is there once, with no matching of names.
 * A tile cut at the read cap breaks that: its lost reads that reach the next tile are in that tile's over, see recovered().
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.GenomeWindow = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const TILE = 16384;
    const MAX_TILE_READS = 500000;      // a tile stops here; reads are in position order, so its right part is then missing
    const RECORD_COST = 400;            // bytes of a BamRecord beside its share of the buffer (an estimate)
    const CACHE_BYTES = 384 * 1048576;
    const GROUP = 4;                    // tiles read at once

    function spanOf(cigar) {
        let n = 0;
        for (const c of cigar) if (c.op === 'M' || c.op === '=' || c.op === 'X' || c.op === 'D' || c.op === 'N') n += c.len;
        return n;
    }
    // First and last tile of [beg, end), 0-based half-open
    function tileRange(beg, end) { return [Math.floor(beg / TILE), Math.floor((Math.max(beg + 1, end) - 1) / TILE)]; }
    const readKey = r => r.pos + '|' + r.flag + '|' + r.name + '|' + r.cigar.map(c => c.len + c.op).join('');

    /** One tile from the BAM: { t, start, end, own, over, bytes, cut }, or null if it went stale while reading. */
    async function loadTile(BP, file, index, refId, t, chrLen, opts) {
        const o = opts || {}, start = t * TILE, end = Math.min(chrLen, start + TILE);
        const got = await BP.readBamRegion(file, index, refId, start, end, true, { isStale: o.isStale, maxReads: o.maxReads || MAX_TILE_READS });
        if (got.stale) return null;
        const own = [], over = [];
        for (const r of got.records) {
            r.start = r.pos; r.end = r.pos + spanOf(r.cigar) - 1;
            (r.pos < start ? over : own).push(r);
        }
        // the order of the Reads view (script.js, on load): the file gives the position, the name settles ties
        const byPos = (a, b) => a.pos - b.pos || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        own.sort(byPos); over.sort(byPos);
        // a record holds its whole buffer: a tile with reads costs the buffer
        return { t, start, end, own, over, cut: !!got.cut, bytes: (got.records.length ? got.bytesRead : 0) + got.records.length * RECORD_COST + 64 };
    }

    /**
     * What later tiles hold of the reads a cut tile lost: for each tile of a contiguous run, the reads of its over that are in no tile
     * before it. Those reach the tile from a cut part, and nothing else carries them: without them its first bases drew too low in solid
     * colour. A tile's over is complete unless its own cap fell inside it, and then it has no own, so the whole tile is in cutSpans and the
     * next over takes up what both lost: past a cut tile every position is right or hatched, with no hatch past the tile's end. Reads
     * are matched by key: an over holds other objects than the own of the tile before. Identical records count one by one.
     * The result follows the file: extra[i] comes after everything before tile i and before tile i's own.
     */
    function recovered(tiles) {
        const extra = tiles.map(() => []);
        let cut = false;
        for (let j = 1; j < tiles.length; j++) {
            cut = cut || tiles[j - 1].cut;
            if (!cut || !tiles[j].over.length) continue;
            const at = tiles[j].start, have = new Map();
            const hold = r => { if (r.end >= at) { const k = readKey(r); have.set(k, (have.get(k) || 0) + 1); } };
            tiles[0].over.forEach(hold);
            for (let i = 0; i < j; i++) { extra[i].forEach(hold); tiles[i].own.forEach(hold); }
            for (const r of tiles[j].over) {
                const k = readKey(r), n = have.get(k) || 0;
                if (n) have.set(k, n - 1); else extra[j].push(r);
            }
        }
        return extra;
    }

    /** The reads of contiguous tiles, each once, in position order. extra: recovered(tiles), when the caller has it. */
    function assemble(tiles, extra) {
        if (!tiles.length) return [];
        const add = extra || recovered(tiles), out = tiles[0].over.slice();
        tiles.forEach((t, i) => { for (const r of add[i]) out.push(r); for (const r of t.own) out.push(r); });
        return out;
    }

    /**
     * What a window lacks through the read cap: [from, to) of each cut tile. From the last start kept, not past it: reads with that very start
     * can be the missing ones (GLM audit #2), and every cut tile counts, not only the first (#14).
     */
    function cutSpans(tiles) {
        return tiles.filter(t => t.cut).map(t => [t.own.length ? t.own[t.own.length - 1].start : t.start, t.end]);
    }

    class TileCache {
        constructor(budget) { this.budget = budget || CACHE_BYTES; this.map = new Map(); this.bytes = 0; }
        has(t) { return this.map.has(t); }
        get size() { return this.map.size; }
        get(t) {                                  // a Map keeps insertion order: moved to the end = used last
            const x = this.map.get(t);
            if (x) { this.map.delete(t); this.map.set(t, x); }
            return x;
        }
        peek(t) { return this.map.get(t); }
        put(tile) {
            if (this.map.has(tile.t)) this.drop(tile.t);
            this.map.set(tile.t, tile); this.bytes += tile.bytes;
        }
        drop(t) {
            const x = this.map.get(t);
            if (!x) return;
            this.map.delete(t); this.bytes -= x.bytes;
            // a live read's mate link would keep this tile's buffer in memory
            for (const list of [x.own, x.over]) for (const r of list) if (r._mate) { r._mate._mate = null; r._mate._mateLeft = false; r._mate = null; r._mateLeft = false; }   // _mateLeft too: a frame reads r._mate.start on it (GLM audit #39)
        }
        evict(keepFirst, keepLast) {
            for (const t of [...this.map.keys()]) {
                if (this.bytes <= this.budget) break;
                if (t >= keepFirst && t <= keepLast) continue;
                this.drop(t);
            }
        }
        clear() { for (const t of [...this.map.keys()]) this.drop(t); }
    }

    /** The contiguous cached tiles round `centre`, inside first..last. */
    function loadedRun(cache, first, last, centre) {
        const c = Math.max(first, Math.min(last, centre));
        if (!cache.has(c)) return [];
        let a = c, b = c;
        while (a > first && cache.has(a - 1)) a--;
        while (b < last && cache.has(b + 1)) b++;
        const out = [];
        for (let t = a; t <= b; t++) out.push(cache.get(t));
        return out;
    }

    /**
     * Rows for a new window that keep the rows of the last one. reads: the new window, by start; prev: { reads, start } or null.
     * A read held over keeps its track, by object or, for a tile's overhang copy, by key. New reads to the right go first-fit
     * after each row's last end, as the same sweep going on; new reads to the left first-fit before each row's first start.
     * Returns the number of tracks.
     */
    function packWindow(reads, prev) {
        const held = new Set(reads), gone = new Map();
        let wsNew = Infinity, weNew = 0;
        for (const r of reads) { if (r.start < wsNew) wsNew = r.start; if (r.end > weNew) weNew = r.end; }
        const oldSet = prev ? new Set(prev.reads) : null;
        if (prev) for (const r of prev.reads) if (!held.has(r) && r.end >= wsNew && r.start <= weNew && r.track >= 0) { const k = readKey(r); if (gone.has(k)) gone.get(k).push(r); else gone.set(k, [r]); }
        const ends = [], starts = [], fresh = [];
        const place = (r, t) => {
            r.track = t;
            if (!(r.end + 1 <= ends[t])) ends[t] = r.end + 1;
            if (!(r.start >= starts[t])) starts[t] = r.start;
        };
        for (const r of reads) {
            if (oldSet && oldSet.has(r) && r.track >= 0) { place(r, r.track); continue; }
            // identical records share a key: each old one is used once, or they landed on one row (GLM audit #38)
            const list = gone.size ? gone.get(readKey(r)) : null, was = list && list.shift();
            if (was) { place(r, was.track); continue; }
            fresh.push(r);
        }
        const pivot = prev ? prev.start : -Infinity;
        const right = fresh.filter(r => r.start >= pivot), left = fresh.filter(r => r.start < pivot);
        right.sort((a, b) => a.start - b.start);
        left.sort((a, b) => b.end - a.end);
        for (const r of right) {
            let t = 0;
            while (t < ends.length && ends[t] !== undefined && r.start < ends[t]) t++;
            place(r, t);
        }
        for (const r of left) {
            let t = 0;
            while (t < starts.length && starts[t] !== undefined && r.end >= starts[t]) t++;
            place(r, t);
        }
        return ends.length;
    }

    /**
     * The fetch loop. want({ first, last, keepFirst, keepLast, ahead }) overwrites one slot: first..last are on screen, ahead lists
     * the tiles to read next, nearest first, keepFirst..keepLast stay in the cache. One group is in flight; when it ends the
     * slot is read again, so a drag across a chromosome leaves one stale group at most. A tile outside keepFirst..keepLast
     * is stale: its reading stops between steps. One that finished anyway is kept, already paid for; the cache drops it in turn.
     */
    function createLoader({ load, cache, group, onTiles, onError }) {
        let wanted = null, running = false;
        const size = group || GROUP;
        const isStale = t => !wanted || t < wanted.keepFirst || t > wanted.keepLast;
        function next(w) {
            const list = [];
            for (let t = w.first; t <= w.last && list.length < size; t++) if (!cache.has(t)) list.push(t);
            if (list.length) return list;
            for (const t of w.ahead || []) { if (list.length >= size) break; if (!cache.has(t)) list.push(t); }
            return list;
        }
        async function pump() {
            if (running) return;
            running = true;
            try {
                for (;;) {
                    const list = wanted ? next(wanted) : [];
                    if (!list.length) break;
                    const got = await Promise.all(list.map(t => load(t, () => isStale(t))));
                    const done = got.filter(x => x);
                    for (const tile of done) cache.put(tile);
                    if (wanted) cache.evict(wanted.keepFirst, wanted.keepLast);
                    if (done.length) onTiles(done);
                }
            } catch (e) {
                wanted = null;
                if (onError) onError(e);
            } finally {
                running = false;
            }
        }
        return {
            want(w) { wanted = w; pump(); },
            stop() { wanted = null; },
            busy: () => running,
        };
    }

    /**
     * SampleCall on a window, with sample-call.js unchanged: it takes positions on the string it is given, so it gets the bases
     * of the window and thin copies of the reads with their positions shifted. Reads stay as they are. refSeq starts at refBase and
     * must cover every read. Counts and variants come back in absolute positions, cut to [ws, we): outside it the reads are
     * not all loaded, and depth would be falsely low.
     */
    function callsFor(SampleCall, reads, refSeq, refBase, ws, we, opts) {
        const shifted = new Array(reads.length);
        for (let i = 0; i < reads.length; i++) { const s = Object.create(reads[i]); s.pos = reads[i].pos - refBase; shifted[i] = s; }
        const res = SampleCall.call(shifted, refSeq, opts), c = res.counts;
        const lo = Math.max(c.lo + refBase, ws), hi = Math.max(lo, Math.min(c.hi + refBase, we));
        const a = lo - refBase - c.lo, b = hi - refBase - c.lo, cut = x => x.subarray(a, b);
        const counts = { lo, hi, fwd: c.fwd.map(cut), rev: c.rev.map(cut), del: cut(c.del), ins: cut(c.ins), depth: cut(c.depth), bases: c.bases };
        const variants = [];
        for (const v of res.variants) { const pos = v.pos + refBase; if (pos - 1 >= ws && pos - 1 < we) variants.push({ ...v, pos }); }
        return { variants, counts, covered: [lo, hi], insAfter: new Map([...res.insAfter].map(([p, s]) => [p + refBase, s])), bases: [], window: [ws, we] };
    }

    /**
     * Compressed bytes the reads of [beg, end) take, from the linear index, with no file read (bins can be merged into
     * a chunk spanning the reference, so the chunks would overstate it). Good enough to refuse a view too wide to read.
     */
    function indexBytes(index, refId, beg, end) {
        const ref = index.refs[refId];
        if (!ref || !ref.lin.length) return 0;
        const n = ref.lin.length, w0 = Math.floor(beg / TILE), w1 = Math.floor((Math.max(beg + 1, end) - 1) / TILE) + 1;
        if (w0 >= n) return 0;
        let a = w0; while (a < n && !ref.lin[a].c && !ref.lin[a].u) a++;
        if (a >= n) return 0;
        let b = Math.min(w1, n - 1); while (b > a && !ref.lin[b].c && !ref.lin[b].u) b--;
        return Math.max(0, ref.lin[b].c - ref.lin[a].c);
    }

    /** Start of the first 16 kb window with reads (0 with none): where a chromosome opens. */
    function firstRead(index, refId) {
        const ref = index.refs[refId];
        if (!ref) return 0;
        const w = ref.lin.findIndex(v => v.c || v.u);
        return w > 0 ? w * TILE : 0;
    }

    /**
     * What a view of [a, b) wants, for createLoader: tiles on screen, the window (a screen each side), and what to read next, on the
     * side of travel first. dir: 1 right, -1 left.
     */
    function planView({ a, b, dir, chrLen }) {
        const lastTile = Math.max(0, Math.floor((chrLen - 1) / TILE)), screen = Math.max(1, b - a);
        const [first, last0] = tileRange(a, b), last = Math.min(last0, lastTile);
        const keepFirst = Math.max(0, tileRange(a - screen, a)[0]), keepLast = Math.min(lastTile, tileRange(b, b + screen)[1]);
        const right = [], left = [];
        for (let t = last + 1; t <= keepLast; t++) right.push(t);
        for (let t = first - 1; t >= keepFirst; t--) left.push(t);
        return { first, last, keepFirst, keepLast, ahead: dir < 0 ? left.concat(right) : right.concat(left) };
    }

    const isGenomeSet = files => Array.from(files || []).some(f => /\.fai$/i.test(f.name));

    /** The picked or dropped files of a genome by kind: { fasta, fai, bam, bai, errors }. */
    function pickFiles(files) {
        const all = Array.from(files), errors = [], by = re => all.filter(f => re.test(f.name));
        // a .fa.gz in the same folder is left out when the plain FASTA is there: only a lone .fa.gz is refused (GLM audit #4)
        const fastas = by(/\.(fa|fasta|fna|fas)$/i), fais = by(/\.fai$/i);
        const fai = fais.find(i => fastas.some(f => f.name + '.fai' === i.name)) || fais[0] || null;
        const fasta = (fai && fastas.find(f => f.name + '.fai' === fai.name)) || fastas[0] || null;
        const bam = by(/\.bam$/i)[0] || null, bai = by(/\.bai$/i)[0] || null;
        if (!fasta && by(/\.(fa|fasta|fna|fas)\.b?gz(ip)?$/i).length) errors.push('A compressed FASTA (.gz) cannot be read here yet: open the plain FASTA with its .fai (gunzip, then samtools faidx).');
        else if (!fasta) errors.push('The reference FASTA is missing: select the .fa together with its .fai.');
        if (!fai) errors.push('The .fai is missing: make it with samtools faidx, then select it with the FASTA.');
        if (by(/\.csi$/i).length) errors.push('.csi indexes are not read yet: make a .bai with samtools index.');
        if (by(/\.(cram|crai)$/i).length) errors.push('CRAM and .crai are not read in the genome view yet: use a BAM with its .bai.');
        if (bam && !bai) errors.push('The BAM needs its .bai: make it with samtools index, then select both.');
        if (bai && !bam) errors.push('A .bai came without its BAM: select the BAM too.');
        return { fasta, fai, bam, bai, errors };
    }

    // As BamParser.matchReference: the same name apart from case, a 'chr' prefix, a '.version' suffix or M/MT
    const normName = n => { const s = String(n).toLowerCase().replace(/^chr/, '').replace(/\.\d+$/, ''); return s === 'mt' ? 'm' : s; };

    /** The BAM reference of each .fai sequence: { refId: Map(fai name -> BAM reference index), error }. A chromosome the BAM lacks has no reads. */
    function matchChromosomes(fai, refNames, refLengths) {
        const exact = new Map(refNames.map((n, i) => [n, i])), norm = new Map(refNames.map((n, i) => [normName(n), i])), refId = new Map();
        const differ = [];
        for (const e of fai) {
            const i = exact.has(e.name) ? exact.get(e.name) : norm.get(normName(e.name));
            if (i === undefined) continue;
            if (refLengths[i] !== e.length) differ.push(e.name + ': FASTA ' + e.length.toLocaleString() + ' bp, BAM ' + refLengths[i].toLocaleString() + ' bp');
            else refId.set(e.name, i);
        }
        if (differ.length) return { refId, error: 'The BAM was mapped to another assembly: ' + differ.slice(0, 3).join('; ') + (differ.length > 3 ? '; and ' + (differ.length - 3) + ' more' : '') + '.' };
        if (!refId.size) return { refId, error: 'No chromosome of the FASTA is in the BAM. FASTA: ' + fai.slice(0, 3).map(e => e.name).join(', ') + '; BAM: ' + refNames.slice(0, 3).join(', ') + '.' };
        return { refId, error: null };
    }

    /** What the jump box says: { name (null: this chromosome), rest (a position or range, or '') } or { error }. */
    function parseLocus(text, chromosomes) {
        const t = String(text || '').trim(), find = n => {
            const e = chromosomes.find(c => c.name === n) || chromosomes.find(c => normName(c.name) === normName(n));
            return e ? e.name : null;
        };
        const whole = find(t);
        if (whole && !/^[\d,\s]+$/.test(t)) return { name: whole, rest: '' };
        const colon = t.lastIndexOf(':');
        if (colon <= 0) return { name: null, rest: t };
        const name = t.slice(0, colon).trim(), hit = find(name);
        if (!hit) return { error: 'No chromosome ' + name + ' here.' };
        return { name: hit, rest: t.slice(colon + 1).trim() };
    }

    return { TILE, MAX_TILE_READS, CACHE_BYTES, GROUP, spanOf, tileRange, readKey, loadTile, recovered, assemble, TileCache, loadedRun, packWindow, createLoader, callsFor, indexBytes, firstRead, cutSpans, planView, isGenomeSet, pickFiles, matchChromosomes, parseLocus };
});
