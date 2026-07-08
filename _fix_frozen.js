const fs = require('fs');
let js = fs.readFileSync('script.js', 'utf8');

// Find "if (panelEl) {" inside _dotUpdateHoverInfo
const fnSearch = 'function _dotUpdateHoverInfo(row, col) {';
const fnStart = js.indexOf(fnSearch);
if (fnStart < 0) { console.log('_dotUpdateHoverInfo NOT FOUND'); process.exit(1); }

// Find "if (panelEl) {" inside this function (will be the first one after fnStart)
const panelIf = 'if (panelEl) {';
const panelIfIdx = js.indexOf(panelIf, fnStart);
if (panelIfIdx < 0) { console.log('if (panelEl) NOT FOUND in function'); process.exit(1); }
console.log('panelEl at offset', panelIfIdx - fnStart, 'from function start');

// If frozen guard already present, skip
if (js.indexOf('S._frozen)', panelIfIdx) < panelIfIdx + 200 &&
    js.substring(panelIfIdx, panelIfIdx + 200).includes('S._frozen')) {
    console.log('Frozen guard already present. SKIP.');
    process.exit(0);
}

// Find the matching closing brace
let depth = 0, closeIdx = -1;
for (let i = panelIfIdx; i < Math.min(panelIfIdx + 5000, js.length); i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}') { depth--; if (depth === 0) { closeIdx = i; break; } }
}
if (closeIdx < 0) { console.log('CLOSING BRACE NOT FOUND'); process.exit(1); }

const inner = js.substring(panelIfIdx + 14, closeIdx); // content inside if (panelEl) {

const frozenGuard = 
    '\r\n' +
    '        if (S._frozen) {\r\n' +
    '            panelEl.style.border = "2px solid #4a9eff";\r\n' +
    '            panelEl.style.background = "#f0f8ff";\r\n' +
    '        } else {\r\n' +
    '            panelEl.style.border = "1px solid #d8d8d8";\r\n' +
    '            panelEl.style.background = "#f7f7f7";\r\n' +
    inner +
    '\r\n        }' +
    '\r\n    ';

js = js.substring(0, panelIfIdx + 14) + frozenGuard + js.substring(closeIdx + 1);

fs.writeFileSync('script.js', js, 'utf8');
new Function(js);
console.log('Frozen guard: ADDED');
console.log('JS syntax: OK');
