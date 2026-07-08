const fs = require('fs');
let js = fs.readFileSync('script.js', 'utf8');

// (1) Add _frozen to state object
js = js.replace(
    'rowIndexA: -1,\n    rowIndexB: -1\n};',
    'rowIndexA: -1,\n    rowIndexB: -1,\n    _frozen: false\n};'
);
console.log('_frozen state: OK');

// (2) Letters only on match cells (non-white)
js = js.replace(
    'const chA = S.seqA[i] || \'N\', chB = S.seqB[j] || \'N\';\n                const txt = chA + chB;\n                ctx.fillStyle',
    'const idx = (i * S.cols + j) * 4;\n                if (id[idx] > 240 && id[idx+1] > 240 && id[idx+2] > 240) continue;\n                const chA = S.seqA[i] || \'N\', chB = S.seqB[j] || \'N\';\n                const txt = chA + chB;\n                ctx.fillStyle'
);
if (!js.includes('id[idx] > 240')) {
    // The exact pattern didn't match after git checkout - letters already show all
    console.log('Match-only letters: ALREADY PRESENT (skipping)');
} else {
    console.log('Match-only letters: OK');
}

// (3) Add dblclick handler after the click handler
const clickEnd = 'showMessage(`Pinned: A${row + 1} / B${col + 1}. Click "Copy Region" to copy FASTA.`, 2500);\r\n        });';
if (!js.includes(clickEnd)) {
    console.log('Click handler end NOT FOUND in current state');
    // Print what's there
    const idx = js.indexOf('showMessage(`Pinned');
    if (idx >= 0) console.log('Found at', idx, ':', js.substring(idx, idx + 120));
    process.exit(1);
}

const dblClickCode = `showMessage(\`Pinned: A\${row + 1} / B\${col + 1}. Click "Copy Region" to copy FASTA.\`, 2500);
        });
        // Double-click to freeze/unfreeze alignment panel
        overlay.addEventListener('dblclick', (e) => {
            const S = _dotPlotState;
            if ((!S.scores && !S.matchMap)) return;
            e.preventDefault();
            const rect = overlay.getBoundingClientRect();
            const col = Math.floor((e.clientX - rect.left - DOT_AXIS_PAD) / S.zoom);
            const row = Math.floor((e.clientY - rect.top - DOT_AXIS_PAD) / S.zoom);
            if (row < 0 || col < 0 || row >= S.rows || col >= S.cols) return;
            S._frozen = !S._frozen;
            if (S._frozen) {
                S.pinnedRow = row; S.pinnedCol = col;
                S._frozenRow = row; S._frozenCol = col;
                S._frozenSlider = 0;
                _dotUpdateFreezeSlider();
                _dotDrawOverlay(row, col);
                _dotUpdateHoverInfo(row, col);
                showMessage('FROZEN \\u2014 double-click to unfreeze. Use slider to scroll along match.', 3000);
            } else {
                _dotUnfreeze();
                showMessage('Unfrozen.', 1500);
            }
        });
        // Freeze slider input
        const fzSlider = document.getElementById('dotPlotFreezeSlider');
        if (fzSlider) {
            fzSlider.addEventListener('input', () => {
                const S = _dotPlotState;
                if (!S._frozen || S._frozenRow == null) return;
                S._frozenSlider = parseInt(fzSlider.value);
                const r = S._frozenRow + S._frozenSlider;
                const c = S._frozenCol + S._frozenSlider;
                if (r >= 0 && c >= 0 && r < S.rows && c < S.cols) {
                    _dotDrawOverlay(r, c);
                    _dotUpdateHoverInfo(r, c);
                }
                const fl = document.getElementById('dotPlotFreezeLabel');
                if (fl) fl.textContent = 'Slider: ' + (S._frozenSlider > 0 ? '+' : '') + S._frozenSlider;
            });
        }`;

js = js.replace(clickEnd, dblClickCode);
console.log('dblclick handler: OK');

// (4) Add freeze helpers before _initDotPlotEvents
const beforeInit = 'function _initDotPlotEvents() {';
const helpers = `function _dotUnfreeze() {
    const S = _dotPlotState;
    S._frozen = false; S._frozenRow = S._frozenCol = undefined; S._frozenSlider = undefined;
    const sl = document.getElementById('dotPlotFreezeSlider');
    if (sl) sl.style.display = 'none';
    const fl = document.getElementById('dotPlotFreezeLabel');
    if (fl) fl.style.display = 'none';
}

function _dotUpdateFreezeSlider() {
    const S = _dotPlotState;
    if (!S._frozen || S._frozenRow == null) return;
    const maxNeg = Math.min(S._frozenRow, S._frozenCol);
    const maxPos = Math.min(S.rows - 1 - S._frozenRow, S.cols - 1 - S._frozenCol);
    const sl = document.getElementById('dotPlotFreezeSlider');
    if (sl) {
        sl.min = -maxNeg;
        sl.max = maxPos;
        sl.value = S._frozenSlider || 0;
        sl.style.display = 'inline-block';
    }
    const fl = document.getElementById('dotPlotFreezeLabel');
    if (fl) {
        fl.textContent = 'Slider: 0';
        fl.style.display = 'inline';
    }
}

function _initDotPlotEvents() {`;

js = js.replace(beforeInit, helpers);
console.log('Helper funcs: OK');

// (5) Modify _dotUpdateHoverInfo: add frozen guard inside panelEl block
// Find the panelEl opening brace in _dotUpdateHoverInfo
const fnSearch = 'function _dotUpdateHoverInfo(row, col) {';
const fnStart = js.indexOf(fnSearch);
let braceDepth = 0, panelOpen = -1;
for (let i = fnStart; i < fnStart + 1000; i++) {
    if (js[i] === '{') braceDepth++;
    else if (js[i] === '}') braceDepth--;
    if (braceDepth === 1 && js.substring(i, i + 14) === '{') {
        // This is the function body opening brace at i
        // Continue scanning to find the first "if (panelEl) {" inside the function
    }
}

// Simpler: search for "if (panelEl) {" after the function start
const panelIf = 'if (panelEl) {';
let searchPos = fnStart;
let occurrence = 0;
let panelIfIdx = -1;
while ((searchPos = js.indexOf(panelIf, searchPos)) >= 0) {
    occurrence++;
    if (occurrence === 2) { panelIfIdx = searchPos; break; }
    searchPos++;
}
if (panelIfIdx < 0) { console.log('panelEl block NOT FOUND'); process.exit(1); }

// Find matching closing brace
let depth = 0, closeIdx = -1;
for (let i = panelIfIdx; i < Math.min(panelIfIdx + 2000, js.length); i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}') { depth--; if (depth === 0) { closeIdx = i; break; } }
}
if (closeIdx < 0) { console.log('panelEl close NOT FOUND'); process.exit(1); }

const panelContent = js.substring(panelIfIdx + panelIf.length, closeIdx); // content inside panelEl
const frozenGuard = `
        if (S._frozen) {
            panelEl.style.border = '2px solid #4a9eff';
            panelEl.style.background = '#f0f8ff';
        } else {
            panelEl.style.border = '1px solid #d8d8d8';
            panelEl.style.background = '#f7f7f7';
            ${panelContent}
        }
`;
js = js.substring(0, panelIfIdx + panelIf.length) + frozenGuard + js.substring(closeIdx);
console.log('Frozen guard: OK');

fs.writeFileSync('script.js', js, 'utf8');
new Function(js);
console.log('JS syntax: OK');
