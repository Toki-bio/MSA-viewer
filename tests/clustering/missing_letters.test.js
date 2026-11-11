'use strict';
// Cluster Now and its feature list (cluster.js), Qwen clustering audit 2026-11-11, owner decisions the same day:
//   C3: N, ambiguity codes and the like (protein X) are missing data, read as gaps, not as letters. Rows that share only N at the same
//       places were made a group, and N columns were listed as the group's characters. Peel already read them so.
//   C7: a "perfect" feature (found only in the group) needs at least 55 % of the group, like a cloudy one. A letter
//       carried by 3 of 100 members was listed as perfect.
//   node tests/clustering/missing_letters.test.js
const fs = require('fs'), path = require('path');
const { SINEClusterer } = new Function(fs.readFileSync(path.join(__dirname, '..', '..', 'cluster.js'), 'utf8') + '; return { SINEClusterer };')();
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };
const quiet = async f => { const l = console.log; console.log = () => {}; try { return await f(); } finally { console.log = l; } };
let x = 7; const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const base = Array.from({ length: 80 }, () => 'ACGT'[Math.floor(rnd() * 4)]).join('');

(async () => {
    // C3: 6 of 30 identical rows carry N at 5 columns, nothing else differs
    const s3 = [];
    for (let i = 0; i < 30; i++) { const a = base.split(''); if (i < 6) [12, 25, 33, 47, 60].forEach(p => { a[p] = 'N'; }); s3.push({ header: 'r' + i, seq: a.join('') }); }
    const r3 = await quiet(() => new SINEClusterer(s3).clusterChunked({}));
    // N reads as a gap: the result must be the one for the same rows with gaps there, and the 6 N rows are no group
    const sizes = r => r.clusters.map(c => c.size).sort((a, b) => a - b).join(',');
    const s3g = s3.map(q => ({ header: q.header, seq: q.seq.replace(/N/g, '-') }));
    const r3g = await quiet(() => new SINEClusterer(s3g).clusterChunked({}));
    const six = r => r.clusters.some(c => c.size === 6);
    ok(!six(r3) && sizes(r3) === sizes(r3g), `C3: N reads as a gap, the 6 N rows are no group (N: ${sizes(r3) || 'none'}; gaps: ${sizes(r3g) || 'none'})`);
    const c3 = new SINEClusterer(s3);
    const f3 = await quiet(() => c3.characterizeGroups([[0, 1, 2, 3, 4, 5]], {}));
    ok(!f3[0].perfectFeatures.some(f => f.char === 'N') && !f3[0].cloudyFeatures.some(f => f.char === 'N'), 'C3: N is never listed as a group character');
    // the same with R (ambiguity code) and, in a protein alignment, X
    const s3r = s3.map((q, i) => ({ header: q.header, seq: i < 6 ? q.seq.replace(/N/g, 'R') : q.seq }));
    const r3r = await quiet(() => new SINEClusterer(s3r).clusterChunked({}));
    ok(!six(r3r) && sizes(r3r) === sizes(r3g), `C3: R reads as a gap too (${sizes(r3r) || 'none'})`);
    const pbase = Array.from({ length: 60 }, () => 'ACDEFGHIKLMNPQRSTVWY'[Math.floor(rnd() * 20)]).join('');
    const s3p = []; for (let i = 0; i < 30; i++) { const a = pbase.split(''); if (i < 6) [7, 19, 33, 41, 52].forEach(p => { a[p] = 'X'; }); s3p.push({ header: 'p' + i, seq: a.join('') }); }
    const r3p = await quiet(() => new SINEClusterer(s3p).clusterChunked({}));
    const r3pg = await quiet(() => new SINEClusterer(s3p.map(q => ({ header: q.header, seq: q.seq.replace(/X/g, '-') }))).clusterChunked({}));
    ok(!six(r3p) && sizes(r3p) === sizes(r3pg), `C3: protein X reads as a gap (X: ${sizes(r3p) || 'none'}; gaps: ${sizes(r3pg) || 'none'})`);
    // a real difference still makes the group (control)
    const s3c = s3.map((q, i) => ({ header: q.header, seq: i < 6 ? q.seq.replace(/N/g, 'T').replace(/^(.{12})./, '$1T') : q.seq }));
    const r3c = await quiet(() => new SINEClusterer(s3c.map((q, i) => ({ header: q.header, seq: i < 6 ? [...base].map((b, p) => [12, 25, 33, 47, 60].includes(p) ? (b === 'A' ? 'C' : 'A') : b).join('') : q.seq }))).clusterChunked({}));
    ok(r3c.clusters.some(c => c.size === 6), `control: rows sharing real letters at 5 columns are a group (clusters: ${r3c.clusters.map(c => c.size).join(',')})`);

    // C7: in a 50-row group only 3 rows carry A at column 41 (the other 47 have a gap there)
    const s7 = []; for (let i = 0; i < 120; i++) { const a = base.split(''); a[40] = i < 3 ? 'A' : '-'; a[20] = i < 50 ? 'G' : 'C'; s7.push({ header: 'q' + i, seq: a.join('') }); }
    const f7 = await quiet(() => new SINEClusterer(s7).characterizeGroups([Array.from({ length: 50 }, (_, i) => i)], {}));
    const p7 = f7[0].perfectFeatures.map(f => f.pos + f.char + ' ' + f.inFreq.toFixed(2));
    ok(!f7[0].perfectFeatures.some(f => f.inFreq < 0.55), `C7: no perfect feature held by under 55 % of the group (${p7.join('; ')})`);
    ok(f7[0].perfectFeatures.some(f => f.pos === 21 && f.char === 'G'), 'control: G at column 21, held by every member and no one else, is perfect');

    console.log(fails ? `${fails} FAILED` : 'all missing-letter checks passed');
    process.exit(fails ? 1 : 0);
})();
