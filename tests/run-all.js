// Runs every test suite and prints a summary; exits 1 if any suite fails.
//
//   node tests/run-all.js            # everything (all MACSE fixtures and corpus sets)
//   node tests/run-all.js --quick    # MACSE subsets only (a few minutes faster)
//   node tests/run-all.js --no-browser   # skip the suites that need Chromium
//   node tests/run-all.js --only regression   # only the suites whose name contains the text
//
// Time limits (2026-10-23): every browser suite fails a check that runs past CHECK_TIMEOUT_MS
// (default 180 s; tests/lib/check-timeout.js), and this runner kills a suite that runs past
// SUITE_TIMEOUT_MS (default 60 min) with its whole process tree and counts it as TIMEOUT.
//
// Browser suites drive a local Chrome/Chromium through playwright-core (see
// tests/lib/browser.js; set BROWSER_PATH if it is not found).
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const quick = process.argv.includes('--quick');
const noBrowser = process.argv.includes('--no-browser');
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? (process.argv[onlyIdx + 1] || '').toLowerCase() : null;
if (only !== null && (!only || only.startsWith('--'))) {   // "--only" with no text would run nothing, or everything
  console.error('usage: node tests/run-all.js --only <text in a suite name>');
  process.exit(2);
}
const SUITE_TIMEOUT_MS = +process.env.SUITE_TIMEOUT_MS > 0 ? +process.env.SUITE_TIMEOUT_MS : 3600000;

// Runs one suite; past SUITE_TIMEOUT_MS it is killed with its process tree (taskkill /T on Windows,
// where a plain kill would orphan the headless Chrome; SIGTERM elsewhere, which playwright turns into
// a browser close) and reported as timed out.
function runSuite(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    let timedOut = false;
    let escalate = null;
    const timer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;   // it just finished: no kill of a dead (or reused) pid
      timedOut = true;
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else {
        child.kill('SIGTERM');
        escalate = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 10000);   // a stalled loop ignores SIGTERM
      }
    }, SUITE_TIMEOUT_MS);
    child.on('exit', code => { clearTimeout(timer); if (escalate) clearTimeout(escalate); resolve({ code, timedOut }); });
    child.on('error', () => { clearTimeout(timer); resolve({ code: 1, timedOut }); });
  });
}

const MACSE_FIXTURES_QUICK = '202190at40674,167757at40674,162343at40674';
const MACSE_CORPUS_QUICK = 'r001,r002,r003,r004,r005,r006,r007,r008,r010,r011';

const SUITES = [
  { name: 'k-mer grouping: equivalence with the old implementation', args: ['tests/kmer/equiv-old.js'] },
  { name: 'k-mer grouping: planted-family recovery', args: ['tests/kmer/recovery.test.js'] },
  { name: 'k-mer grouping: properties', args: ['tests/kmer/properties.test.js'] },
  { name: 'k-mer grouping: leaf order equals SubFam C/Python implementation', args: ['tests/kmer/subfam-order.test.js'] },
  { name: 'k-mer grouping: tree cut vs reference', args: ['tests/kmer/cut-reference-check.js'] },
  { name: 'realign region', args: ['tests/realign-region/run.js'] },
  { name: 'codon alignment (fast engine)', args: ['tests/codon-align/run.js'] },
  { name: 'MACSE port: worker', args: ['tests/macse-port/worker_test.js'] },
  { name: 'MACSE port: identical to MACSE v2.07 on gene fixtures',
    args: ['tests/macse-port/run_fixtures.js', 'tests/codon-align/fixtures', ...(quick ? [MACSE_FIXTURES_QUICK] : [])] },
  { name: 'MACSE port: identical to MACSE v2.07 on the random corpus',
    args: ['tests/macse-port/run_corpus.js', ...(quick ? [MACSE_CORPUS_QUICK] : [])] },
  { name: 'MACSE port: identical to MACSE v2.07 on lower-case input',
    args: ['tests/macse-port/run_corpus.js', '--dir', 'tests/macse-port/corpus-case-lower'] },
  { name: 'MACSE port: identical to MACSE v2.07 on mixed-case input',
    args: ['tests/macse-port/run_corpus.js', '--dir', 'tests/macse-port/corpus-case-mixed'] },
  { name: 'MACSE port: thread pool', args: ['tests/macse-port/run_corpus.js', '--async', '4', 'r002,r012,r013'] },
  { name: 'clustering: SVK subset', args: ['tests/clustering/svk_subset.test.js'] },
  { name: 'clustering: guided small cases', args: ['tests/clustering/guided_small.test.js'] },
  { name: 'clustering: multiple data sets', args: ['tests/clustering/multi_dataset.test.js'] },
  { name: 'bicluster oracle', args: ['tests/bicluster/oracle.js'] },
  { name: 'optional server security', args: ['tests/server/security.test.js'] },
  { name: 'sequence search: Plus/Minus hits in query coordinates', args: ['tests/search/minus-strand.test.js'] },
  { name: 'unit: low-severity audit fixes', args: ['tests/unit/audit-low.test.js'] },
  { name: 'unit: sample row called from reads', args: ['tests/unit/sample-call.test.js'] },
  { name: 'unit: variant effects on genes', args: ['tests/unit/variant-effect.test.js'] },
  { name: 'unit: indexed BAM reading against samtools', args: ['tests/unit/bam-index.test.js'] },
  { name: 'unit: per-check time limit', args: ['tests/unit/check-timeout.test.js'] },
  { name: 'release version consistency', args: ['tests/meta/version.test.js'] },
  { name: 'correctness (consensus, parsers, exports, rendering)', args: ['tests/correctness/run.js'], browser: true },
  { name: 'input compatibility (examples/)', args: ['tests/compat/run.js'], browser: true },
  { name: 'functional', args: ['tests/functional/run-all.js'], browser: true },
  { name: 'regression', args: ['tests/regression/run-all.js'], browser: true },
  { name: 'accessibility (keyboard, names, axe-core)', args: ['tests/a11y/check.js'], browser: true },
  { name: 'browser support (fallbacks, file://)', args: ['tests/browser-support/check.js'], browser: true },
  { name: 'layout: no stray scrollbars', args: ['tests/layout/stray-scrollbars.test.js'], browser: true },
  { name: 'layout: toolbar items never overlap', args: ['tests/layout/toolbar.test.js'], browser: true },
  { name: 'ui: no stale overlays after load or realign', args: ['tests/ui/stale-state.test.js'], browser: true },
  { name: 'ui: menus and windows (clipped text, Tree window, Load anyway)', args: ['tests/ui/menus-windows.test.js'], browser: true },
  { name: 'public site (tools/build-site.sh)', args: ['tests/site/check.js'], browser: true },
];

(async () => {
  const results = [];
  for (const suite of SUITES) {
    if (only !== null && !suite.name.toLowerCase().includes(only)) continue;
    if (suite.browser && noBrowser) { results.push({ ...suite, status: 'skipped' }); continue; }
    console.log(`\n=== ${suite.name}: node ${suite.args.join(' ')}`);
    const t0 = Date.now();
    const r = await runSuite(suite.args);
    const seconds = ((Date.now() - t0) / 1000).toFixed(0);
    if (r.timedOut) console.log(`[TIMEOUT] ${suite.name}: killed after ${seconds} s (SUITE_TIMEOUT_MS=${SUITE_TIMEOUT_MS})`);
    results.push({ ...suite, status: r.timedOut ? 'TIMEOUT' : r.code === 0 ? 'pass' : 'FAIL', seconds });
  }

  console.log('\n=== Summary');
  for (const r of results) console.log(`${r.status.padEnd(7)} ${r.seconds ? (r.seconds + ' s').padStart(6) : '      '}  ${r.name}`);
  const failed = results.filter(r => r.status === 'FAIL' || r.status === 'TIMEOUT').length;
  console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites passed');
  process.exit(failed ? 1 : 0);
})();
