// The genome view: a whole genome with its BAM, read only where you look. The frame is the whole chromosome in absolute
// coordinates (bamState.refStart 0, refEnd its length); only the contents are a window: the reads of a run of tiles
// (genome-window.js) and a stretch of bases (bamState.refBase). So the Reads view's canvas, layout, zoom and mouse run as they are.
// script.js asks `if (_genome)` at the few places that assume a whole reference. Loaded after script.js.
const _GENOME_GATE = 16 * 1048576;       // compressed bytes of reads a view may cost; wider, nothing is read
const _GENOME_REF_MIN = 262144;          // bases read at a time, at least
const _GENOME_REF_MAX_SPAN = 4000000;    // a view wider than this has no letters or reads: no bases are read for it
const _GENOME_CALL_WAIT = 150;           // ms of rest before SampleCall runs on a new window

function _genomeIdle() {
    const g = _genome;
    return !!g && !g.adopting && !g.refBusy && !g.callsTimer && !g.opening && !(g.loader && g.loader.busy()) && !(_readsView && _readsView.raf);
}

// ---- opening -----------------------------------------------------------------------------------------------------------
async function _genomeOpen(files) {
    const f = GenomeWindow.pickFiles(files);
    if (f.errors.length) { showMessage(f.errors.join(' '), 9000); return; }
    try {
        const fai = GenomeFasta.parseFai(await f.fai.text());
        if (!fai.length) { showMessage(`${f.fai.name} lists no sequences.`, 6000); return; }
        let header = null, index = null, refIds = new Map();
        if (f.bam) {
            header = await BamParser.readBamHeaderFromFile(f.bam);
            index = BamParser.parseBAI(new Uint8Array(await f.bai.arrayBuffer()));
            if (index.refs.length !== header.refNames.length) throw new Error(`the index (${f.bai.name}) is not this BAM's: ${index.refs.length} references in the index, ${header.refNames.length} in the BAM`);
            await BamParser.checkIndex(f.bam, index);
            const big = header.refNames.find((n, i) => header.refLengths[i] >= 2 ** 29);
            if (big) throw new Error(`${big} is over 512 Mb, which a .bai cannot address`);
            const m = GenomeWindow.matchChromosomes(fai, header.refNames, header.refLengths);
            if (m.error) { showMessage(m.error, 12000); return; }
            refIds = m.refId;
        }
        await GenomeFasta.checkFai(f.fasta, fai);   // after the BAM: another assembly is the better thing to say
        if (state.seqs && state.seqs.length && !confirm('Opening a genome closes the alignment that is open. Go on?')) return;
        if (_genome) _genomeClose();
        _clearFailedLoad();
        // the dialog says closed: nothing of the alignment may come back through Undo or a trim restore
        state.deletedHistory = []; state.redoHistory = []; state.trimBackup = null; state.trimBackupColState = null;
        // renderAlignment's "Leaving Canvas" block is past its genome return: its deferred jobs would run on (GLM audit #5)
        if (_canvasDeferredToken) { _canvasDeferredToken.cancelled = true; _canvasDeferredToken = null; }
        _readsFilter = { ..._READS_FILTER_DEFAULT };
        _readsOpts = { ..._READS_OPTS_DEFAULT };
        _genome = { fasta: f.fasta, bam: f.bam, index, fai, refIds, sampleName: f.bam ? f.bam.name.replace(/\.bam$/i, '') : f.fasta.name, left: 0, barLeft: 0, dir: 1, gateBytes: _GENOME_GATE,
            budget: GenomeWindow.CACHE_BYTES, adopting: false, adoptAgain: false, refBusy: 0, callsTimer: 0, moved: 0, opening: false, tooWide: false, waiting: false, tlenMedian: 0, chrom: null };
        document.body.classList.add('genome-mode');
        const reads = document.getElementById('modeReads');
        if (reads) { reads.checked = true; _lastModeRadioId = 'modeReads'; }
        _genomeUi(true);
        _genomeShow(fai[0].name);
        syncQuickModeSwitch();
        const n = fai.length, src = el('sourceInfo');
        if (src) src.textContent = f.bam ? `${f.fasta.name} + ${f.bam.name}` : f.fasta.name;
        showMessage(`${f.fasta.name}: ${n.toLocaleString()} sequence${n === 1 ? '' : 's'}` + (f.bam ? `, reads from ${f.bam.name}, read where you look.` : ', no reads.'), 4000);
    } catch (e) {
        console.error('genome open:', e);
        showMessage('The genome could not be opened: ' + e.message, 9000);
    }
}

function _genomeEmptyBam() {
    return { reads: [], allReads: [], downsampled: [], refName: null, refSeq: null, refStart: 0, refEnd: 0, columns: [], readOrder: [] };
}

function _genomeClose() {
    const g = _genome;
    if (!g) return;
    if (g.loader) g.loader.stop();
    clearTimeout(g.callsTimer);
    if (g.cache) g.cache.clear();
    _readsDispose();
    _genome = null;
    bamState = _genomeEmptyBam();
    document.body.classList.remove('genome-mode');
    _genomeUi(false);
    const c = document.getElementById('modeCanvas');
    if (c) { c.checked = true; _lastModeRadioId = 'modeCanvas'; }
    const win = document.getElementById('variantsWindow');
    if (win) win.style.display = 'none';
    alignmentContainer.innerHTML = '';
    const src = el('sourceInfo');
    if (src) src.textContent = 'No file loaded';
}

function _genomeUi(on) {
    ensureSampleRowButton();
    const group = document.getElementById('readsZoomGroup'), jb = document.getElementById('readsJumpBox');
    let sel = document.getElementById('genomeChrom'), close = document.getElementById('genomeCloseBtn');
    if (!sel) {
        sel = document.createElement('select');
        sel.id = 'genomeChrom'; sel.title = 'Chromosome'; sel.setAttribute('aria-label', 'Chromosome');
        sel.style.cssText = 'max-width:130px;height:18px;font-size:11px;margin-right:5px;';
        sel.addEventListener('change', () => _genome && _genomeShow(sel.value));
        group.insertBefore(sel, group.firstChild);
        close = document.createElement('button');
        close.id = 'genomeCloseBtn'; close.type = 'button'; close.textContent = 'Close genome'; close.title = 'Close the genome and its reads';
        close.style.cssText = 'font-size:10px;height:18px;padding:0 8px;margin-left:5px;cursor:pointer;border:1px solid #999;border-radius:3px;background:#f0f0f0;white-space:nowrap;';
        close.addEventListener('click', () => { _genomeClose(); renderAlignment(); updateBamButtonVisibility(); });
        group.appendChild(close);
    }
    sel.style.display = close.style.display = on ? '' : 'none';
    if (on) {
        sel.innerHTML = '';
        for (const e of _genome.fai) { const o = document.createElement('option'); o.value = e.name; o.textContent = e.name; sel.appendChild(o); }
    }
    if (jb) {
        if (!jb.dataset.plain) jb.dataset.plain = jb.placeholder;
        jb.placeholder = on ? 'chr7:1,000,000' : jb.dataset.plain;
    }
    const qs = document.getElementById('quickModeSwitch');
    if (qs) qs.style.display = on ? 'none' : '';   // one view here: the alignment views have nothing to show
}

function _genomeShow(name) {
    const g = _genome, e = g.fai.find(x => x.name === name);
    if (!e) return;
    if (g.loader) g.loader.stop();
    clearTimeout(g.callsTimer); g.callsTimer = 0;
    if (g.cache) { g.budget = g.cache.budget; g.cache.clear(); }
    const refId = g.refIds.has(name) ? g.refIds.get(name) : -1;
    Object.assign(g, { chrom: e, refId, cache: new GenomeWindow.TileCache(g.budget), win: { ws: 0, we: 0, t0: -1, t1: -1, id: 0, sig: '', lo: 0, hi: 0 }, plan: null, prevWin: null, tracksHigh: 0, left: 0, barLeft: 0,
        refLo: 0, refHi: 0, refChain: Promise.resolve(), refFailed: false, refNoFit: false, readFailed: '', lastA: -1, lastB: -1, tooWide: false, waiting: false, callsId: -1, wideBytes: 0 });
    const cache = g.cache, loader = refId < 0 ? null : GenomeWindow.createLoader({
        load: (t, isStale) => GenomeWindow.loadTile(BamParser, g.bam, g.index, refId, t, e.length, { isStale }),
        cache, group: GenomeWindow.GROUP,
        onTiles: () => { if (g.loader === loader && _genome === g) _genomeAdopt(); },
        onError: err => {
            console.error('genome read:', err);
            if (!err.indexMisfit) { showMessage('The BAM could not be read: ' + err.message + '. If the file changed on disk, open it again.', 9000); return; }
            // reading on cannot help: said once, on the screen too, and nothing here may pass for a place with no reads
            if (g.loader !== loader || _genome !== g) return;
            g.readFailed = err.message; g.waiting = false;
            showMessage('The reads could not be read: ' + err.message + '.', 12000);
            _readsSchedule();
        },
    });
    g.loader = loader;
    // a filter is the reader's and stays; sort and group are tied to a position of the last chromosome (GLM audit #24)
    _readsOpts = { ..._readsOpts, sort: 'start', sortPos: null, group: 'none', groupPos: null };
    bamState = { ..._genomeEmptyBam(), sampled: [], fileReads: [], groupRanges: [], alignedBases: 0, nTracks: 0, sampleName: g.sampleName, skipped: {}, refName: name, bamRefName: name, offset: 0, refSeq: '', refBase: 0, refStart: 0, refEnd: e.length };
    _readsSyncFilterBoxes();
    const sel = document.getElementById('genomeChrom');
    if (sel) sel.value = name;
    if (_readsView) _readsDispose();
    renderAlignment();
    const v = _readsView;
    if (v) {
        v.cell = Math.max(_readsMinCell(v), Math.min(_READS_CELL, 1));
        _readsSizeSpacer(v);
        _readsSetLeft(refId < 0 ? 0 : GenomeWindow.firstRead(g.index, refId) * v.cell);
        _readsDraw();
    }
}

function _genomeRender() {
    const g = _genome, r = document.getElementById('modeReads');
    // a mode radio moved: the toolbar was just synced for that mode, and without this the chromosome list and Close went (GLM audit #18)
    if (r && !r.checked) { r.checked = true; _lastModeRadioId = 'modeReads'; syncQuickModeSwitch(); }
    renderReadsAlignment();
    g.prevWin = { reads: bamState.reads, start: g.win.ws };
    const win = document.getElementById('variantsWindow');
    if (win && win.style.display !== 'none') _fillVariantsTable();
    syncCodonModePanel();
}

// ---- place ---------------------------------------------------------------------------------------------------------------
// The exact place is _genome.left; scrollLeft is only the thumb, written here and remembered so that a scroll event from it can be told
// from one by the user on the bar.
function _genomeSyncBar(v) {
    const g = _genome;
    alignmentContainer.scrollLeft = g.left / (_readsScrollRatio(v) || 1);
    g.barLeft = alignmentContainer.scrollLeft;
}
function _genomeSetLeft(px) {
    const g = _genome, v = _readsView;
    const left = Math.max(0, Math.min(px, Math.max(0, v.fullW - v.w)));
    if (left !== g.left) { g.dir = left > g.left ? 1 : -1; g.moved = performance.now(); }
    g.left = left;
    _genomeSyncBar(v);
    window._syncHorizontalScrollbar?.();
    _readsSchedule();
}
function _genomeOnScroll() {
    const g = _genome, v = _readsView;
    if (!g || !v) return;
    const s = alignmentContainer.scrollLeft;
    if (Math.abs(s - g.barLeft) > 0.5) {
        const left = s * _readsScrollRatio(v);
        g.dir = left > g.left ? 1 : -1; g.moved = performance.now();
        g.left = left; g.barLeft = s;
    }
    _readsSchedule();
}
function _genomeWire(v) {
    v.canvas.addEventListener('wheel', e => {
        if (e.ctrlKey) return;
        const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
        if (!dx) return;
        e.preventDefault();
        _readsSetLeft(_readsLeft() + dx);
    }, { passive: false });
}
function _genomeJump(text) {
    const g = _genome, L = GenomeWindow.parseLocus(text, g.fai);
    if (L.error) { showMessage(L.error, 6000); return; }
    if (L.name && L.name !== g.chrom.name) _genomeShow(L.name);
    if (!L.rest) return;
    const r = _readsParseJump(L.rest);
    if (r.error === '') return;
    if (r.error) { showMessage(r.error, 6000); return; }
    if (r.single) { readsGoTo(r.from, { sort: false }); return; }
    _readsFit(r.from, r.to);
}
const _genomeCoverageOnly = v => { const g = _genome, w = g.win; return g.tooWide || ((v.w - _READS_NAME_W) / v.cell) * (bamState.alignedBases || 0) / Math.max(1, w.we - w.ws) > _READS_MAX_DRAWN; };

// ---- after each frame: what this view wants ---------------------------------------------------------------------------------
function _genomeAfterDraw(v, a, b, X) {
    const g = _genome;
    _genomeDrawHatch(v, a, b, X);
    if (v.covMax != null && !g.tooWide) _genomeCovLabel(v, _READS_REF_H + _READS_SCALE_H, v.covMax);
    if (a === g.lastA && b === g.lastB) return;
    g.lastA = a; g.lastB = b;
    const wasWide = g.tooWide, wasWaiting = g.waiting;
    if (b - a <= _GENOME_REF_MAX_SPAN) {
        const screen = b - a, w = g.win;
        let lo = a - screen, hi = b + screen;
        // the loaded reads stay inside the bases, unless they are far away
        if (w.hi > w.lo && Math.max(hi, w.hi) - Math.min(lo, w.lo) <= 2 * _GENOME_REF_MAX_SPAN) { lo = Math.min(lo, w.lo); hi = Math.max(hi, w.hi); }
        _genomeEnsureRef(Math.max(0, lo), Math.min(g.chrom.length, hi));
    }
    if (g.loader && !g.readFailed) {
        g.wideBytes = GenomeWindow.indexBytes(g.index, g.refId, a, b);
        g.tooWide = g.wideBytes > g.gateBytes && b - a > GenomeWindow.TILE;   // the index cannot see finer than a tile: zooming in must reach the reads
        if (g.tooWide) { g.loader.stop(); g.waiting = false; } else {
            g.plan = GenomeWindow.planView({ a, b, dir: g.dir, chrLen: g.chrom.length });
            g.waiting = a < g.win.ws || Math.min(b, g.chrom.length) > g.win.we;
            g.loader.want(g.plan);
            if (g.win.t0 < 0 || g.plan.first < g.win.t0 || g.plan.last > g.win.t1) _genomeAdopt();
        }
    }
    if (g.tooWide !== wasWide) { _readsSizeSpacer(v); }
    if (g.tooWide !== wasWide || g.waiting !== wasWaiting) _readsSchedule();
    if (g.callsId !== g.win.id && !g.callsTimer) _genomeQueueCalls();
}
function _genomeWideText() {
    return `Zoom in to read: about ${(_genome.wideBytes / 1048576).toFixed(0)} MB of reads in this view. Coverage of a view this wide is not shown yet.`;
}
function _genomeDrawHatch(v, a, b, X) {
    const g = _genome, { ctx, w, h } = v, head = _readsHeadH(), covTop = _READS_REF_H + _READS_SCALE_H;
    if (g.tooWide) {
        ctx.fillStyle = '#666'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(_genomeWideText(), 12, covTop + _COV_H / 2);
        ctx.textAlign = 'center';
        return;
    }
    if (!g.loader) return;
    if (!g.hatch) {
        const c = document.createElement('canvas'); c.width = c.height = 8;
        const x = c.getContext('2d'); x.strokeStyle = '#d0d0d0'; x.lineWidth = 2;
        x.beginPath(); x.moveTo(-2, 10); x.lineTo(10, -2); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke();
        g.hatch = ctx.createPattern(c, 'repeat');
    }
    // what is not in the window has not been read: never to be taken for no reads
    const end = Math.min(b, g.chrom.length), gaps = [[a, Math.min(end, g.win.ws)], [Math.max(a, g.win.we), end]];
    if (g.win.t0 < 0 || g.readFailed) gaps.splice(0, 2, [a, end]);
    for (const [s, e] of g.win.cuts || []) gaps.push([Math.max(a, s), Math.min(end, e)]);
    ctx.fillStyle = g.hatch;
    for (const [s, e] of gaps) {
        if (e <= s) continue;
        const x0 = Math.max(0, X(s)), x1 = Math.min(w, X(e));
        ctx.fillRect(x0, covTop, x1 - x0, _COV_H);
        ctx.fillRect(x0, head, x1 - x0, h - head);
    }
    if (g.readFailed) {
        ctx.fillStyle = '#a00'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(`The reads could not be read: ${g.readFailed}`, 12, covTop + _COV_H / 2);
        ctx.textAlign = 'center';
    }
}
// Drawn last, at the left of the screen: the name column it has in the Reads view scrolls away at once on a chromosome
function _genomeCovLabel(v, top, max) {
    const { ctx } = v, text = `coverage 0-${max}`;
    ctx.font = '10px monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(0, top + 1, ctx.measureText(text).width + 8, 13);
    ctx.fillStyle = '#444'; ctx.fillText(text, 4, top + 8);
    ctx.textAlign = 'center';
}

const _genomeLocus = (a, b) => `${_genome.chrom.name}:${(a + 1).toLocaleString()}-${b.toLocaleString()}`;
function _genomeWindowNote() { const w = _genome.win; return `in ${_genomeLocus(w.ws, w.we)} only (the loaded window)`; }
function _genomeStatusHead() {
    const g = _genome, w = g.win;
    const lost = g.refFailed ? (g.refNoFit ? ' (the .fai does not fit the FASTA here: no bases, changes or coverage)' : ' (the bases could not be read: no changes or coverage here)') : '';
    if (!g.loader) return (g.bam ? `${g.chrom.name}: not in the BAM` : `${g.chrom.name}: reference only, no reads`) + lost;
    if (g.readFailed) return `${g.chrom.name}: ${g.readFailed}`;
    if (g.tooWide) return `${g.chrom.name}: zoom in to read reads`;
    if (g.waiting) return `reading ${g.chrom.name}...`;
    const n = bamState.allReads.length, drawn = bamState.reads.length < n ? `, ${bamState.reads.length.toLocaleString()} drawn` : '', cut = w.cuts && w.cuts.length ? ` (cut at ${(w.cuts[0][0] + 1).toLocaleString()}-${w.cuts[0][1].toLocaleString()}${w.cuts.length > 1 ? ` and ${w.cuts.length - 1} more` : ''}: too many reads here, the hatched depth is not known)` : '';
    return `${n.toLocaleString()} reads in window ${w.t0 < 0 ? g.chrom.name : _genomeLocus(w.ws, w.we)}${drawn}, ${(g.cache.bytes / 1048576).toFixed(1)} MB held${cut}${lost}`;
}

// ---- bases -----------------------------------------------------------------------------------------------------------------
function _genomeEnsureRef(lo, hi) {
    const g = _genome, chrom = g.chrom;
    if (g.refFailed) return g.refChain;   // said once; a chromosome switch tries again (GLM audit #3: asked for ever, a message each time)
    g.refBusy++;
    g.refChain = g.refChain.then(async () => {
        try {
            if (g.chrom !== chrom || (g.refLo <= lo && hi <= g.refHi && g.refHi > g.refLo)) return;
            if (!chrom.fits) { await GenomeFasta.checkEntry(g.fasta, chrom); chrom.fits = true; }   // once, when the chromosome is opened
            const pad = Math.max(0, (_GENOME_REF_MIN - (hi - lo)) >> 1), a = Math.max(0, lo - pad), b = Math.min(chrom.length, hi + pad);
            const s = (await GenomeFasta.readBases(g.fasta, chrom, a, b)).toUpperCase();
            if (g.chrom !== chrom || _genome !== g) return;
            bamState.refSeq = s; bamState.refBase = a;
            g.refLo = a; g.refHi = b;
            _readsSchedule();
        } catch (e) {
            console.error('genome bases:', e);
            if (g.chrom === chrom) { g.refFailed = true; g.refNoFit = !!e.faiMismatch; }
            showMessage(e.faiMismatch ? e.message : 'The FASTA could not be read: ' + e.message + '. If the file changed on disk, open it again.', 9000);
        } finally { g.refBusy--; }
    });
    return g.refChain;
}

// ---- the window --------------------------------------------------------------------------------------------------------------
function _genomeAdopt() {
    const g = _genome;
    g.adoptAgain = true;
    if (g.adopting) return;
    g.adopting = true;
    (async () => {
        try { while (g.adoptAgain && _genome === g) { g.adoptAgain = false; await _genomeAdoptOnce(g); } }
        catch (e) { console.error('genome window:', e); }
        finally { g.adopting = false; }
    })();
}
function _genomeTileReads(t, sig) {
    if (t._sig === sig) return;
    const kept = t.own.filter(r => _readsPasses(r)), d = _downsampleReads(kept, _readsFilter.perWindow);
    t._sig = sig; t._kept = kept; t._shown = d.shown; t._dropped = d.dropped;
}
async function _genomeAdoptOnce(g) {
    const v = _readsView, plan = g.plan, chrom = g.chrom;
    if (!v || !plan) return;
    let centre = -1;
    const mid = (plan.first + plan.last) >> 1;
    for (let d = 0; d <= plan.last - plan.first && centre < 0; d++) { if (g.cache.has(mid - d)) centre = mid - d; else if (g.cache.has(mid + d)) centre = mid + d; }
    if (centre < 0 || centre < plan.keepFirst || centre > plan.keepLast) return;
    const tiles = GenomeWindow.loadedRun(g.cache, plan.keepFirst, plan.keepLast, centre);
    const sig = JSON.stringify(_readsFilter), t0 = tiles[0].t, t1 = tiles[tiles.length - 1].t;
    if (t0 === g.win.t0 && t1 === g.win.t1 && sig === g.win.sig) return;
    const extra = GenomeWindow.recovered(tiles), fileReads = GenomeWindow.assemble(tiles, extra);
    let lo = tiles[0].start, hi = tiles[tiles.length - 1].end;
    for (const r of fileReads) { if (r.start < lo) lo = r.start; if (r.end + 1 > hi) hi = r.end + 1; }
    hi = Math.min(hi, chrom.length);
    await _genomeEnsureRef(lo, hi);
    if (g.chrom !== chrom || _genome !== g || _readsView !== v) return;
    for (const t of tiles) _genomeTileReads(t, sig);
    const overKept = tiles[0].over.filter(r => _readsPasses(r)), overD = _downsampleReads(overKept, _readsFilter.perWindow);
    const allReads = overKept.slice(), shown = overD.shown.slice(), dropped = overD.dropped.slice();
    tiles.forEach((t, i) => {
        if (extra[i].length) {   // reads a cut tile lost, from this tile's overhang: in file order they come before its own
            const kept = extra[i].filter(r => _readsPasses(r)), d = _downsampleReads(kept, _readsFilter.perWindow);
            for (const r of kept) allReads.push(r);
            for (const r of d.shown) shown.push(r);
            for (const x of d.dropped) dropped.push(x);
        }
        for (const r of t._kept) allReads.push(r);
        for (const r of t._shown) shown.push(r);
        for (const d of t._dropped) dropped.push(d);
    });
    Object.assign(bamState, { fileReads, allReads, sampled: shown, reads: shown, downsampled: dropped });
    const o = _readsOpts;
    if (o.group === 'none' && !o.pairs) {
        const n = GenomeWindow.packWindow(shown, g.prevWin);
        let aligned = 0;
        for (const r of shown) aligned += r.end - r.start + 1;
        bamState.alignedBases = aligned; bamState.groupRanges = [];
        g.tracksHigh = Math.max(g.tracksHigh, n);    // the spacer does not shrink under the user during a visit
        bamState.nTracks = g.tracksHigh;
    } else _readsLayout();
    g.prevWin = { reads: bamState.reads, start: tiles[0].start };
    const last = tiles[tiles.length - 1];
    g.win = { ws: tiles[0].start, we: last.end, t0, t1, id: g.win.id + 1, sig, lo, hi, cuts: GenomeWindow.cutSpans(tiles) };
    const { groups, maxClip } = _readsBuildGroups();
    v.groups = groups; v.maxClip = maxClip; v.reads = bamState.reads; v.drawn = [];
    if (v.selected && !bamState.reads.includes(v.selected)) {
        const key = GenomeWindow.readKey(v.selected);
        v.selected = bamState.reads.find(r => GenomeWindow.readKey(r) === key) || null;
    }
    v.canvas.setAttribute('aria-label', `Reads on ${bamState.refName}: ${_readsDefaultStatus()}`);
    const b = Math.min(g.lastB, chrom.length);
    g.waiting = g.lastA < g.win.ws || b > g.win.we;
    _readsSizeSpacer(v);
    _readsFillFilterCounts();
    _genomeQueueCalls();
    _readsDraw();
}
function _genomeSetFilter(next) {
    _readsFilter = next;
    _genome.win = { ..._genome.win, sig: '' };
    _genomeAdopt();
}

// ---- calls ---------------------------------------------------------------------------------------------------------------------
function _genomeQueueCalls() {
    const g = _genome;
    clearTimeout(g.callsTimer);
    g.callsTimer = setTimeout(() => {
        g.callsTimer = 0;
        if (_genome !== g) return;
        const rest = _GENOME_CALL_WAIT - (performance.now() - g.moved);
        if (rest > 0) { g.callsTimer = setTimeout(() => { g.callsTimer = 0; if (_genome === g) _genomeQueueCalls(); }, rest); return; }
        _genomeCalls();
        const win = document.getElementById('variantsWindow');
        if (win && win.style.display !== 'none') _fillVariantsTable();
        _readsSchedule();
    }, _GENOME_CALL_WAIT);
}
// SampleCall on the window, with the Reads view's own defaults. Null with no reads. Kept until the next window.
function _genomeCalls() {
    const g = _genome, w = g.win, v = _readsView;
    if (g.callsId === w.id) return bamState.calls || null;
    const reads = bamState.allReads;
    g.callsId = w.id;
    if (v) { v.covMax = null; v.mixed = null; }
    if (!reads.length) { bamState.calls = null; return null; }
    let lo = w.ws, hi = w.we;
    for (const r of reads) { if (r.start < lo) lo = r.start; if (r.end + 1 > hi) hi = r.end + 1; }
    hi = Math.min(hi, g.chrom.length);
    const base = bamState.refBase || 0;
    if (g.refFailed) return bamState.calls || null;
    if (lo < base || hi > g.refHi) { g.callsId = -1; _genomeEnsureRef(lo, hi).then(() => { if (_genome === g) _genomeQueueCalls(); }); return bamState.calls || null; }
    bamState.calls = GenomeWindow.callsFor(SampleCall, reads, bamState.refSeq.slice(lo - base, hi - base), lo, w.ws, w.we);
    return bamState.calls;
}

// ---- entry ---------------------------------------------------------------------------------------------------------------------
(function () {
    const input = document.getElementById('genomeFileInput'), btn = document.getElementById('openGenomeButton');
    if (btn) btn.addEventListener('click', () => { input.value = ''; input.click(); });
    if (input) input.addEventListener('change', async () => { const files = Array.from(input.files); input.value = ''; if (files.length) await _genomeOpen(files); });
    // A drop holding a .fai is a genome; any other drop passes untouched to the handlers of script.js
    window.addEventListener('drop', e => {
        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files || !GenomeWindow.isGenomeSet(files)) return;
        e.preventDefault(); e.stopImmediatePropagation();
        window._dragOverlayDone?.();
        _genomeOpen(Array.from(files));
    }, true);
})();
