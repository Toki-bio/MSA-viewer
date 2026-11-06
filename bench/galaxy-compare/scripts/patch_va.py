#!/usr/bin/env python3
"""Apply prototype performance fixes to a COPY of ViewAlign's script.js.

Fix 1  Repeat Finder: don't build one <option> per sequence on every file load
       while the panel is closed (openRepeatFinder fills it when opened).
Fix 2  Consensus + conservation column counting: charCodeAt into a typed array
       instead of toUpperCase() + object per residue. Same results: first-seen
       key order is kept, and any non-ASCII character falls back to the original.
The originals stay available as *_orig for an equality check.
usage: patch_va.py <script.js in> <script.js out>
"""
import sys

src = open(sys.argv[1], encoding='utf-8').read()

def sub(old, new, count=1):
    global src
    n = src.count(old)
    if n != count:
        sys.exit(f'expected {count} match(es), found {n}: {old[:70]!r}')
    src = src.replace(old, new)

# ---- Fix 1 -------------------------------------------------------------
sub("""    _lastRepeatResults = [];
    _lastRepeatView = null;
    _repeatFinderSeqIndex = 0;
    _fillRepeatFinderSeqSelect(0);""",
"""    _lastRepeatResults = [];
    _lastRepeatView = null;
    _repeatFinderSeqIndex = 0;
    // PERF: one <option> per sequence was built on every load even with the panel closed
    // (100,000 options for a 100k-row file). openRepeatFinder fills it when the panel opens.
    const _rfModal = document.getElementById('repeatFinderModal');
    if (_rfModal && getComputedStyle(_rfModal).display !== 'none') {
        _fillRepeatFinderSeqSelect(0);
    } else {
        const _rfSel = document.getElementById('repeatFinderSeqSelect');
        if (_rfSel) _rfSel.innerHTML = '';
        _repeatFinderListObjs = [];
        _repeatFinderSeqObj = null;
    }""")

# ---- Fix 2a: consensus -------------------------------------------------
sub("function _computeConsensusCharForColumn(seqArray, pos, opts) {",
"""// PERF: typed-array column counting. Builds the same `counts` object (same keys, same
// first-seen order) as the original loop, then hands over to the unchanged decision logic.
const _colCountBuf = new Int32Array(128);
function _computeConsensusCharForColumn(seqArray, pos, opts) {
    const isProtein = !!opts.isProtein;
    const buf = _colCountBuf; buf.fill(0);
    const order = [];
    let rows = 0, nonGap = 0;
    for (const s of seqArray) {
        rows++;
        let c = s.charCodeAt(pos);
        if (c !== c) continue;                       // past the end: gap
        if (c >= 128) return _computeConsensusCharForColumn_orig(seqArray, pos, opts);
        if (c >= 97 && c <= 122) c -= 32;
        if (c === 45 || c === 46 || c === 126) continue;   // - . ~
        if (!isProtein && c === 85) c = 84;          // U -> T
        nonGap++;
        if (buf[c]++ === 0) order.push(c);
    }
    const counts = {};
    for (const c of order) counts[String.fromCharCode(c)] = buf[c];
    return _consensusDecide(counts, rows, nonGap, opts);
}

function _computeConsensusCharForColumn_orig(seqArray, pos, opts) {""")

# split the original: counting part stays in _orig, decision part becomes _consensusDecide
sub("""        nonGap++;
        counts[b] = (counts[b] || 0) + 1;
    }
    if (nonGap === 0) return '-';
    if (nonGap / rows < coverageMin) return '-';""",
"""        nonGap++;
        counts[b] = (counts[b] || 0) + 1;
    }
    return _consensusDecide(counts, rows, nonGap, opts);
}

function _consensusDecide(counts, rows, nonGap, opts) {
    const { threshold, coverageMin, consType, fallbackMode } = opts;
    const isProtein = !!opts.isProtein;
    if (nonGap === 0) return '-';
    if (nonGap / rows < coverageMin) return '-';""")

# ---- Fix 2b: conservation ----------------------------------------------
sub("function _computeConservationForColumn(seqs, seqCount, pos, shadeMode, unknownN = !isProteinAlignment()) {",
"""const _consCountBuf = new Int32Array(128);
function _computeConservationForColumn(seqs, seqCount, pos, shadeMode, unknownN = !isProteinAlignment()) {
    // PERF: typed-array counting; same counts/keys/order as _orig, non-ASCII falls back.
    const buf = _consCountBuf; buf.fill(0);
    const order = [];
    let nonGapCount = 0;
    for (let s = 0; s < seqCount; s++) {
        let c = seqs[s].seq.charCodeAt(pos);
        if (c !== c) continue;                       // past the end: gap
        if (c >= 128) return _computeConservationForColumn_orig(seqs, seqCount, pos, shadeMode, unknownN);
        if (c >= 97 && c <= 122) c -= 32;
        if (c === 45 || c === 46) continue;          // - .
        nonGapCount++;
        if (c === 88 || c === 63 || (unknownN && c === 78)) continue;   // X ? (N)
        if (buf[c]++ === 0) order.push(c);
    }
    if (nonGapCount === 0) return { hasData: false, hasValidCoverage: false };
    let maxCount = 0;
    for (const c of order) if (buf[c] > maxCount) maxCount = buf[c];
    const consensusBases = new Set();
    for (const c of order) if (buf[c] === maxCount) consensusBases.add(String.fromCharCode(c));
    const denominator = shadeMode === 'all' ? seqCount : nonGapCount;
    return {
        consensusBases,
        conservation: maxCount / denominator,
        hasData: true,
        hasValidCoverage: nonGapCount / seqCount >= CONSERVATION_MIN_COVERAGE
    };
}

function _computeConservationForColumn_orig(seqs, seqCount, pos, shadeMode, unknownN = !isProteinAlignment()) {""")

open(sys.argv[2], 'w', encoding='utf-8').write(src)
print('patched')

# ---- Fix 3: keep large inputs out of the <textarea> ---------------------
# Chrome stores textarea text as one text node + one <br> per line: a 100k-row FASTA
# (600k lines) became ~1.2M retained nodes, and setting .value cost ~2 s.
src = open(sys.argv[2], encoding='utf-8').read()
def sub2(old, new, count=1):
    global src
    n = src.count(old)
    if n != count: sys.exit(f'fix3: expected {count}, found {n}: {old[:60]!r}')
    src = src.replace(old, new)
sub2("async function parseAndRender(isFromDrop = false) {",
"""// PERF: inputs above this size are kept in memory, not in the paste box
const BIG_INPUT_CHARS = 2_000_000;
let _bigInputText = null;
function _setInputText(text) {
    if (text && text.length > BIG_INPUT_CHARS) {
        _bigInputText = text;
        fastaInput.value = '';
        fastaInput.placeholder = `${(text.length / 1e6).toFixed(1)} MB loaded (not shown here, to keep the page fast). Paste new text to replace it.`;
    } else {
        _bigInputText = null;
        fastaInput.value = text;
    }
}
if (typeof fastaInput !== 'undefined' && fastaInput) fastaInput.addEventListener('input', () => { _bigInputText = null; });

async function parseAndRender(isFromDrop = false) {""")
sub2("    const inputText = fastaInput.value.trim().replace(/\\r\\n?/g, '\\n'); // CR-only (classic Mac) files too",
"""    let inputText = (_bigInputText ?? fastaInput.value).trim();
    if (inputText.includes('\\r')) inputText = inputText.replace(/\\r\\n?/g, '\\n'); // CR-only (classic Mac) files too""")
sub2("                if (fastaInputEl) fastaInputEl.value = text;\n                state.currentFilename = autoTitle",
     "                if (fastaInputEl) _setInputText(text);\n                state.currentFilename = autoTitle")
open(sys.argv[2], 'w', encoding='utf-8').write(src)
print('fix3 applied (URL load path)')
