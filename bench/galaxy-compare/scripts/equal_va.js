// New vs original consensus/conservation: must be identical for every column and option set.
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:8765/va_fix/index.html');
  await p.waitForTimeout(1500);
  const res = await p.evaluate(async (files) => {
    const report = [];
    for (const f of files) {
      const txt = await (await fetch(`/api/datasets/${f}/display`)).text();
      // raw rows as in the file (uneven lengths kept), not normalised by the loader
      const rows = txt.split('>').slice(1).map((r) => r.split('\n').slice(1).join(''));
      const objs = rows.map((s) => ({ seq: s }));
      const len = Math.max(...rows.map((s) => s.length));
      let checked = 0, diffs = [];
      const ser = (x) => JSON.stringify(x, (k, v) => (v instanceof Set ? [...v] : v));
      for (const isProtein of [false, true])
        for (const threshold of [0.3, 0.5, 0.7, 1.0])
          for (const coverageMin of [0, 0.3, 0.8])
            for (const consType of ['normal', 'ambiguous'])
              for (const fallbackMode of ['gap', 'n', 'iupac']) {
                const opts = { threshold, coverageMin, consType, fallbackMode, isProtein };
                for (let pos = 0; pos < len; pos++) {
                  const a = _computeConsensusCharForColumn(rows, pos, opts), o = _computeConsensusCharForColumn_orig(rows, pos, opts);
                  checked++; if (a !== o && diffs.length < 5) diffs.push({ kind: 'cons', pos, opts, a, o });
                }
              }
      for (const shade of ['all', 'nongap'])
        for (const unknownN of [true, false])
          for (let pos = 0; pos < len; pos++) {
            const a = ser(_computeConservationForColumn(objs, objs.length, pos, shade, unknownN));
            const o = ser(_computeConservationForColumn_orig(objs, objs.length, pos, shade, unknownN));
            checked++; if (a !== o && diffs.length < 5) diffs.push({ kind: 'conserv', pos, shade, unknownN, a, o });
          }
      report.push({ file: f, columnsChecked: checked, differences: diffs.length, examples: diffs });
    }
    return report;
  }, ['edge_mix', 'nt_1k_x300', 'aa_1k_x400']);
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})();
