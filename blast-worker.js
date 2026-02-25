'use strict';
// ============================================================
//  blast-worker.js  — Smith-Waterman BLAST in the browser
//  Runs as a Web Worker; communicates via postMessage.
//  Caches downloaded FASTA files in IndexedDB so subsequent
//  searches are instant (no re-download needed).
// ============================================================

// ── DNA encoding ─────────────────────────────────────────────
const BASE_MAP = new Uint8Array(128);
BASE_MAP['A'.charCodeAt(0)] = 0; BASE_MAP['C'.charCodeAt(0)] = 1;
BASE_MAP['G'.charCodeAt(0)] = 2; BASE_MAP['T'.charCodeAt(0)] = 3;
BASE_MAP['a'.charCodeAt(0)] = 0; BASE_MAP['c'.charCodeAt(0)] = 1;
BASE_MAP['g'.charCodeAt(0)] = 2; BASE_MAP['t'.charCodeAt(0)] = 3;

// Full IUPAC complement lookup (string-indexed for readability)
const COMPL = {A:'T',C:'G',G:'C',T:'A',R:'Y',Y:'R',S:'S',W:'W',
               K:'M',M:'K',B:'V',D:'H',H:'D',V:'B',N:'N',
               a:'t',c:'g',g:'c',t:'a',r:'y',y:'r',s:'s',w:'w',
               k:'m',m:'k',b:'v',d:'h',h:'d',v:'b',n:'n'};

function encodeSeq(s, maxLen) {
    const len = Math.min(s.length, maxLen);
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = BASE_MAP[s.charCodeAt(i)] || 0;
    return arr;
}

function revComp(s) {
    const out = new Array(s.length);
    for (let i = 0; i < s.length; i++) out[s.length - 1 - i] = COMPL[s[i]] || 'N';
    return out.join('');
}

// ── Smith-Waterman with traceback ────────────────────────────
const MATCH = 2, MISMATCH = -3, GAP_EXT = -2;

function smithWaterman(query, subject) {
    const q = query.substring(0, 600);
    const s = subject.substring(0, 600);
    const m = q.length, n = s.length;

    const H  = new Int32Array((m + 1) * (n + 1));
    const TB = new Uint8Array((m + 1) * (n + 1));  // 1=diag 2=up 3=left

    let maxScore = 0, maxI = 0, maxJ = 0;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const base = i * (n + 1) + j;
            const d    = q[i - 1] === s[j - 1] ? MATCH : MISMATCH;
            const diag = H[(i - 1) * (n + 1) + (j - 1)] + d;
            const up   = H[(i - 1) * (n + 1) + j] + GAP_EXT;
            const left = H[i * (n + 1) + (j - 1)] + GAP_EXT;
            const best = Math.max(0, diag, up, left);
            H[base] = best;
            TB[base] = best === 0 ? 0 : best === diag ? 1 : best === up ? 2 : 3;
            if (best > maxScore) { maxScore = best; maxI = i; maxJ = j; }
        }
    }
    if (maxScore === 0) return null;

    let alignQ = '', alignS = '';
    let i = maxI, j = maxJ;
    while (i > 0 && j > 0 && H[i * (n + 1) + j] > 0) {
        const dir = TB[i * (n + 1) + j];
        if (dir === 1) { alignQ = q[i - 1] + alignQ; alignS = s[j - 1] + alignS; i--; j--; }
        else if (dir === 2) { alignQ = q[i - 1] + alignQ; alignS = '-' + alignS; i--; }
        else               { alignQ = '-' + alignQ; alignS = s[j - 1] + alignS; j--; }
    }
    const qStart = i + 1, sStart = j + 1;

    let identity = 0, gaps = 0, midline = '';
    for (let k = 0; k < alignQ.length; k++) {
        if (alignQ[k] !== '-' && alignQ[k] === alignS[k]) { identity++; midline += '|'; }
        else if (alignQ[k] === '-' || alignS[k] === '-')  { gaps++;     midline += ' '; }
        else                                               {             midline += '.'; }
    }

    const alignLen = alignQ.length;
    const percent  = alignLen > 0 ? ((identity / alignLen) * 100).toFixed(1) : '0.0';
    const bitScore = parseFloat(Math.max(0, (maxScore * 0.625 - Math.log(0.41)) / Math.log(2)).toFixed(1));

    return { score: maxScore, bitScore, identity, gaps, alignLen, percent,
             queryStart: qStart, queryEnd: maxI,
             hitStart: sStart,   hitEnd: maxJ,
             querySeq: alignQ, hitSeq: alignS, midline, strand: '+' };
}

// Run SW on both strands; return the hit with the higher score.
// Converts minus-strand coordinates back to forward-strand numbering.
function swBothStrands(query, entrySeq, entryLen) {
    const fwd = smithWaterman(query, entrySeq);
    const rc  = smithWaterman(query, revComp(entrySeq.substring(0, 600)));

    if (!fwd && !rc) return null;
    if (!rc || (fwd && fwd.score >= rc.score)) return fwd;

    // RC hit — convert positions back to forward strand coordinates
    const cap = Math.min(entryLen, 600);
    const rcStart = rc.hitStart;
    const rcEnd   = rc.hitEnd;
    rc.hitStart = cap - rcEnd   + 1;
    rc.hitEnd   = cap - rcStart + 1;
    rc.strand   = '-';
    return rc;
}

// ── Kmer inverted index ───────────────────────────────────────
const KMER      = 9;
const KMER_MASK = (1 << (KMER * 2)) - 1; // 0x3FFFF
const BS_SIZE   = ((1 << (KMER * 2)) >>> 5); // 8192 uint32 words

function buildInvertedIndex(dbSeqs) {
    const posting = new Map();
    const seqBs   = new Uint32Array(BS_SIZE);

    for (let i = 0; i < dbSeqs.length; i++) {
        const enc = dbSeqs[i]._enc;
        if (!enc || enc.length < KMER) continue;
        seqBs.fill(0);
        let h = 0;
        for (let j = 0; j < KMER - 1; j++) h = ((h << 2) | enc[j]) & KMER_MASK;
        for (let j = KMER - 1; j < enc.length; j++) {
            h = ((h << 2) | enc[j]) & KMER_MASK;
            if (seqBs[h >>> 5] & (1 << (h & 31))) continue; // deduplicate per seq
            seqBs[h >>> 5] |= (1 << (h & 31));
            let list = posting.get(h);
            if (!list) { list = []; posting.set(h, list); }
            list.push(i);
        }
    }
    const index = new Map();
    for (const [k, v] of posting) index.set(k, new Int32Array(v));
    return index;
}

function searchDatabase(querySeq, dbSeqs, index, maxHits = 10) {
    const MIN_HITS = 3, MAX_SW = 400;
    const qEnc = encodeSeq(querySeq, 600);
    if (qEnc.length < KMER) return [];

    const counts = new Uint16Array(dbSeqs.length);
    const qBs    = new Uint32Array(BS_SIZE);
    let h = 0;
    for (let i = 0; i < KMER - 1; i++) h = ((h << 2) | qEnc[i]) & KMER_MASK;
    for (let i = KMER - 1; i < qEnc.length; i++) {
        h = ((h << 2) | qEnc[i]) & KMER_MASK;
        if (qBs[h >>> 5] & (1 << (h & 31))) continue;
        qBs[h >>> 5] |= (1 << (h & 31));
        const list = index ? index.get(h) : null;
        if (list) for (let j = 0; j < list.length; j++) counts[list[j]]++;
    }

    const candidates = [];
    for (let i = 0; i < dbSeqs.length; i++) {
        if (counts[i] >= MIN_HITS) candidates.push({ entry: dbSeqs[i], hits: counts[i] });
    }
    candidates.sort((a, b) => b.hits - a.hits);

    const scored = [];
    for (const { entry } of candidates.slice(0, MAX_SW)) {
        const sw = swBothStrands(querySeq, entry.seq, entry.length);
        if (sw && sw.score > 0 && sw.identity > 0) {
            scored.push({ id: entry.id, def: entry.def, length: entry.length,
                          seq: entry.seq,   // full sequence for FASTA copy
                          hsps: [{ ...sw, evalue: 0 }] });
        }
    }
    scored.sort((a, b) => b.hsps[0].bitScore - a.hsps[0].bitScore);
    return scored.slice(0, maxHits);
}

// ── FASTA parser ───────────────────────────────────────────────
function parseFasta(content) {
    const seqs = [];
    // Split on '>' but keep sequences intact
    let start = content.indexOf('>');
    if (start < 0) return seqs;

    while (start < content.length) {
        const next = content.indexOf('>', start + 1);
        const block = next < 0 ? content.substring(start + 1) : content.substring(start + 1, next);
        const nl = block.indexOf('\n');
        if (nl < 0) { start = next; continue; }

        const header = block.substring(0, nl).trim();
        const seq = block.substring(nl + 1).replace(/\s/g, '').toUpperCase()
                         .replace(/[^ACGTRYSWKMBDHVN]/g, 'N');
        if (!seq || seq.length < 20) { start = next < 0 ? content.length : next; continue; }

        // Support both space-separated and tab-separated headers (RepBase .bnk style)
        const tabIdx   = header.indexOf('\t');
        const spaceIdx = header.indexOf(' ');
        const splitAt  = tabIdx >= 0 ? tabIdx : spaceIdx >= 0 ? spaceIdx : header.length;
        const id = header.substring(0, splitAt);

        seqs.push({ id, def: header, seq, length: seq.length });
        start = next < 0 ? content.length : next;
    }
    return seqs;
}

// ── IndexedDB cache ──────────────────────────────────────────
const IDB_NAME    = 'blast-db-cache-v1';
const IDB_STORE   = 'fastas';

function openIDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
    });
}

function idbGet(db, key) {
    return new Promise((resolve, reject) => {
        const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
        req.onsuccess = e => resolve(e.target.result ?? null);
        req.onerror   = e => reject(e.target.error);
    });
}

function idbPut(db, key, value) {
    return new Promise((resolve, reject) => {
        const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(value, key);
        req.onsuccess = () => resolve();
        req.onerror   = e => reject(e.target.error);
    });
}

// ── In-memory DB state ────────────────────────────────────────
const DB_SEQS = {};
const DB_IDX  = {};

async function ensureDb(dbName, dbUrl, requestId) {
    if (DB_SEQS[dbName]) return;  // already loaded this session

    let idb = null;
    try { idb = await openIDB(); } catch (_) { /* IDB not available, skip cache */ }

    // Check remote file size for cache freshness
    let remoteSize = null;
    try {
        const head = await fetch(dbUrl, { method: 'HEAD' });
        remoteSize = parseInt(head.headers.get('content-length') || '0') || null;
    } catch (_) {}

    let text = null;

    if (idb) {
        const cachedText = await idbGet(idb, dbName);
        const cachedSize = await idbGet(idb, dbName + ':size');
        if (cachedText && (!remoteSize || cachedSize === remoteSize)) {
            self.postMessage({ type: 'progress', requestId, dbName, stage: 'loading from cache' });
            text = typeof cachedText === 'string' ? cachedText : await cachedText.text();
        }
    }

    if (!text) {
        self.postMessage({ type: 'progress', requestId, dbName, stage: 'downloading (first time only)' });
        const resp = await fetch(dbUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${dbUrl}`);
        text = await resp.text();
        if (idb) {
            try {
                await idbPut(idb, dbName, text);
                if (remoteSize) await idbPut(idb, dbName + ':size', remoteSize);
            } catch (_) { /* quota exceeded or private mode — ignore */ }
        }
    }

    self.postMessage({ type: 'progress', requestId, dbName, stage: 'indexing' });
    const seqs = parseFasta(text);
    for (const e of seqs) e._enc = encodeSeq(e.seq, 600);
    DB_SEQS[dbName] = seqs;
    DB_IDX[dbName]  = buildInvertedIndex(seqs);
}

// ── Message handler ───────────────────────────────────────────
self.onmessage = async ({ data }) => {
    const { type, requestId } = data;

    if (type === 'search') {
        const { querySeq, dbName, dbUrl, maxHits } = data;
        try {
            await ensureDb(dbName, dbUrl, requestId);
            self.postMessage({ type: 'progress', requestId, dbName, stage: 'searching' });
            const t0   = Date.now();
            const hits = searchDatabase(querySeq, DB_SEQS[dbName], DB_IDX[dbName], maxHits || 10);
            const ms   = Date.now() - t0;
            self.postMessage({
                type: 'result', requestId, dbName,
                numHits: hits.length, hits, success: true,
                numSeqs: DB_SEQS[dbName].length, searchMs: ms,
            });
        } catch (err) {
            self.postMessage({ type: 'result', requestId, dbName,
                numHits: 0, hits: [], success: false, error: err.message });
        }

    } else if (type === 'clearCache') {
        // Optionally clear IndexedDB cache (called if user wants fresh data)
        try {
            const idb = await openIDB();
            await new Promise((resolve, reject) => {
                const req = idb.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).clear();
                req.onsuccess = resolve; req.onerror = e => reject(e.target.error);
            });
            for (const k of Object.keys(DB_SEQS)) { delete DB_SEQS[k]; delete DB_IDX[k]; }
            self.postMessage({ type: 'cacheCleared', requestId });
        } catch (err) {
            self.postMessage({ type: 'error', requestId, error: err.message });
        }
    }
};
