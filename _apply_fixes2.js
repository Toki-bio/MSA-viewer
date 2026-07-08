const fs = require('fs');
let js = fs.readFileSync('script.js', 'utf8');

// Add _frozen to state object (if not present)
if (!js.includes('_frozen')) {
    js = js.replace(
        'rowIndexA: -1,\n    rowIndexB: -1\n};',
        'rowIndexA: -1,\n    rowIndexB: -1,\n    _frozen: false\n};'
    );
    console.log('_frozen state: ADDED');
} else {
    console.log('_frozen state: already present');
}

// Add match-only letter condition: skip white cells
if (!js.includes('id[idx] > 240')) {
    js = js.replace(
        "const chA = S.seqA[i] || 'N', chB = S.seqB[j] || 'N';",
        "const idx = (i * S.cols + j) * 4;\n                if (id[idx] > 240 && id[idx+1] > 240 && id[idx+2] > 240) continue;\n                const chA = S.seqA[i] || 'N', chB = S.seqB[j] || 'N';"
    );
    console.log('Match-only letters: ADDED');
} else {
    console.log('Match-only letters: already present');
}

// Add freeze helpers before _initDotPlotEvents (skip if already present)
if (!js.includes('function _dotUnfreeze()')) {
    const beforeInit = 'function _initDotPlotEvents() {';
    const helpers = [
        'function _dotUnfreeze() {',
        '    const S = _dotPlotState;',
        '    S._frozen = false; S._frozenRow = S._frozenCol = undefined; S._frozenSlider = undefined;',
        "    const sl = document.getElementById('dotPlotFreezeSlider');",
        "    if (sl) sl.style.display = 'none';",
        "    const fl = document.getElementById('dotPlotFreezeLabel');",
        "    if (fl) fl.style.display = 'none';",
        '}',
        '',
        'function _dotUpdateFreezeSlider() {',
        '    const S = _dotPlotState;',
        '    if (!S._frozen || S._frozenRow == null) return;',
        '    const maxNeg = Math.min(S._frozenRow, S._frozenCol);',
        '    const maxPos = Math.min(S.rows - 1 - S._frozenRow, S.cols - 1 - S._frozenCol);',
        "    const sl = document.getElementById('dotPlotFreezeSlider');",
        '    if (sl) {',
        '        sl.min = -maxNeg;',
        '        sl.max = maxPos;',
        '        sl.value = S._frozenSlider || 0;',
        "        sl.style.display = 'inline-block';",
        '    }',
        "    const fl = document.getElementById('dotPlotFreezeLabel');",
        '    if (fl) {',
        "        fl.textContent = 'Slider: 0';",
        "        fl.style.display = 'inline';",
        '    }',
        '}',
        '',
        'function _initDotPlotEvents() {'
    ].join('\r\n');
    js = js.replace(beforeInit, helpers);
    console.log('Helper funcs: ADDED');
} else {
    console.log('Helper funcs: already present');
}

// Add frozen guard to _dotUpdateHoverInfo panelEl block
// Strategy: find the "if (panelEl) {" inside _dotUpdateHoverInfo and add frozen guard
const fnSearch = 'function _dotUpdateHoverInfo(row, col) {';
const fnStart = js.indexOf(fnSearch);

// Find the second occurrence of "if (panelEl) {" (first is the variable declaration line 5)
let occurrence = 0, panelIfIdx = -1;
for (let i = fnStart; i < fnStart + 3000; i++) {
    if (js.substring(i, i + 14) === 'if (panelEl) {') {
        occurrence++;
        if (occurrence === 2) { panelIfIdx = i; break; }
    }
}
if (panelIfIdx < 0) { console.log('panelEl block NOT FOUND'); process.exit(1); }

// Check if frozen guard already present
if (js.includes("S._frozen") && js.substring(fnStart, fnStart + 800).includes("S._frozen")) {
    console.log('Frozen guard: already present');
} else {
    // Find the closing brace of the if (panelEl) { ... } block
    let depth = 0, closeIdx = -1;
    for (let i = panelIfIdx; i < Math.min(panelIfIdx + 3000, js.length); i++) {
        if (js[i] === '{') depth++;
        else if (js[i] === '}') { depth--; if (depth === 0) { closeIdx = i; break; } }
    }
    if (closeIdx < 0) { console.log('panelEl close NOT FOUND'); process.exit(1); }

    const inner = js.substring(panelIfIdx + 14, closeIdx);
    const frozenGuard = [
        '',
        '        if (S._frozen) {',
        "            panelEl.style.border = '2px solid #4a9eff';",
        "            panelEl.style.background = '#f0f8ff';",
        '        } else {',
        "            panelEl.style.border = '1px solid #d8d8d8';",
        "            panelEl.style.background = '#f7f7f7';",
        inner,
        '        }',
        '    '
    ].join('\r\n');

    js = js.substring(0, panelIfIdx + 14) + frozenGuard + js.substring(closeIdx + 1);
    console.log('Frozen guard: ADDED');
}

fs.writeFileSync('script.js', js, 'utf8');
new Function(js);
console.log('JS syntax: OK');
console.log('ALL DONE');
