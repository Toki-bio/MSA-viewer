// Runs every test suite and prints a summary; exits 1 if any suite fails.
//
//   node tests/run-all.js            # everything (all MACSE fixtures and corpus sets)
//   node tests/run-all.js --quick    # MACSE subsets only (a few minutes faster)
//   node tests/run-all.js --no-browser   # skip the suites that need Chromium
//   node tests/run-all.js --only regression   # only the suites whose name contains the text
//   node tests/run-all.js --resume   # continue an interrupted run (see below)
//
// Time limits (2026-10-23): every browser suite fails a check that runs past CHECK_TIMEOUT_MS
// (default 180 s; tests/lib/check-timeout.js), and this runner kills a suite that runs past
// SUITE_TIMEOUT_MS (default 60 min; the regression suite 2 h, it has outgrown 60 min) with its whole
// process tree and counts it as TIMEOUT. Time the machine spent asleep does not count towards the limit.
//
// Laptop sleep (2026-11-04): a 1 s heartbeat (tests/lib/sleep-watch.js) records wall-clock gaps above
// 30 s (SLEEP_GAP_MS). A check that FAILED while such a gap overlapped it, or within 60 s after one, is rerun in a fresh browser,
// at most 2 times, and the rerun's result is the result (tests/lib/retry-on-sleep.js). The log shows
// "[RETRY] <name>: the machine slept N s during this check" and the final count line says how many
// checks were retried. A pass is never rerun and a failure without a sleep gap is never rerun.
// Retries are in the regression, functional, correctness and a11y runners.
//
// Resume (2026-11-04): passes are written as they happen to a progress file in the OS temp dir
// (tests/lib/resume.js; suites that passed, and passed check names inside the regression suite).
// `--resume` skips what passed earlier on the SAME commit; failed and unfinished items run again. If the
// commit differs or tracked files have uncommitted changes it says so and starts fresh. A run without
// --resume starts fresh and overwrites the file. The summary says "resumed: N suites, M checks passed
// earlier" so a resumed result is not mistaken for a complete run; exit code is 1 on any failure.
//
// Browser suites drive a local Chrome/Chromium through playwright-core (see
// tests/lib/browser.js; set BROWSER_PATH if it is not found).
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { startSleepWatch } = require('./lib/sleep-watch');
const resumeLib = require('./lib/resume');

const ROOT = path.join(__dirname, '..');
const quick = process.argv.includes('--quick');
const noBrowser = process.argv.includes('--no-browser');
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? (process.argv[onlyIdx + 1] || '').toLowerCase() : null;
if (only !== null && (!only || only.startsWith('--'))) {   // "--only" with no text would run nothing, or everything
  console.error('usage: node tests/run-all.js --only <text in a suite name>');
  process.exit(2);
}
const resumeRequested = process.argv.includes('--resume');
const SUITE_TIMEOUT_ENV = +process.env.SUITE_TIMEOUT_MS > 0 ? +process.env.SUITE_TIMEOUT_MS : 0;
const DEFAULT_SUITE_TIMEOUT_MS = 3600000;
const sleepWatch = startSleepWatch();
const suiteTimeoutMs = suite => SUITE_TIMEOUT_ENV || suite.timeoutMs || DEFAULT_SUITE_TIMEOUT_MS;
const suiteKey = suite => suite.name + ' | ' + suite.args.join(' ');

// Runs one suite; past SUITE_TIMEOUT_MS it is killed with its process tree (taskkill /T on Windows,
// where a plain kill would orphan the headless Chrome; SIGTERM elsewhere, which playwright turns into
// a browser close) and reported as timed out.
function runSuite(args, limitMs, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env });
    let timedOut = false;
    let escalate = null;
    const started = Date.now();
    // limit counts awake time only: a laptop that slept for an hour must not time the suite out
    const timer = setInterval(() => {
      if (Date.now() - started - sleepWatch.sleptBetween(started, Date.now()) <= limitMs) return;
      clearInterval(timer);
      if (child.exitCode !== null || child.signalCode !== null) return;   // it just finished: no kill of a dead (or reused) pid
      timedOut = true;
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else {
        child.kill('SIGTERM');
        escalate = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 10000);   // a stalled loop ignores SIGTERM
      }
    }, 1000);
    child.on('exit', code => { clearInterval(timer); if (escalate) clearTimeout(escalate); resolve({ code, timedOut }); });
    child.on('error', () => { clearInterval(timer); if (escalate) clearTimeout(escalate); resolve({ code: 1, timedOut }); });
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
  { name: 'unit: sleep detection and retry after sleep', args: ['tests/unit/sleep-watch.test.js'] },
  { name: 'unit: resume progress file', args: ['tests/unit/resume.test.js'] },
  { name: 'release version consistency', args: ['tests/meta/version.test.js'] },
  { name: 'correctness (consensus, parsers, exports, rendering)', args: ['tests/correctness/run.js'], browser: true },
  { name: 'input compatibility (examples/)', args: ['tests/compat/run.js'], browser: true },
  { name: 'functional', args: ['tests/functional/run-all.js'], browser: true },
  { name: 'regression', args: ['tests/regression/run-all.js'], browser: true, timeoutMs: 7200000 },
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
  // progress file: passes are recorded as they happen; --resume reuses it only for the same clean commit
  const state = resumeLib.gitState(ROOT);
  const progressFile = process.env.CHECK_RESUME_FILE || resumeLib.defaultProgressFile(ROOT);
  let prior = null;
  if (resumeRequested) {
    prior = resumeLib.loadProgress(progressFile, state);
    if (prior.message) console.log(`[RESUME] ${prior.message}`);
    if (!prior.usable) prior = null;
  }
  let recordFile = progressFile;
  if (!prior && !resumeLib.startFresh(progressFile, state)) recordFile = '';   // unwritable: warned, no recording, no resume
  const recordGuard = { baseline: state, root: ROOT };
  // exit code 3 from a suite = "CHECK_FILTER matched none of my checks" (not a pass, not a failure); with --only the suite exits 1 instead
  const NOMATCH_EXIT = 3;
  const childEnv = { ...process.env, CHECK_RESUME_FILE: recordFile, CHECK_RESUME: prior ? '1' : '', ...(only === null ? { CHECK_NOMATCH_EXIT: String(NOMATCH_EXIT) } : {}) };
  let resumedSuites = 0;
  const resumedChecks = prior ? [...prior.checks.values()].reduce((n, set) => n + set.size, 0) : 0;
  if (prior) console.log(`[RESUME] same commit ${state.commit.slice(0, 10)}: ${prior.suites.size} suite(s) and ${resumedChecks} check(s) passed earlier are skipped`);
  for (const suite of SUITES) {
    if (only !== null && !suite.name.toLowerCase().includes(only)) continue;
    if (suite.browser && noBrowser) { results.push({ ...suite, status: 'skipped' }); continue; }
    if (prior && prior.suites.has(suiteKey(suite))) { resumedSuites++; results.push({ ...suite, status: 'resumed' }); console.log(`\n=== ${suite.name}: passed earlier on this commit, skipped (--resume)`); continue; }
    console.log(`\n=== ${suite.name}: node ${suite.args.join(' ')}`);
    const t0 = Date.now();
    const r = await runSuite(suite.args, suiteTimeoutMs(suite), childEnv);
    const seconds = ((Date.now() - t0) / 1000).toFixed(0);
    if (r.timedOut) console.log(`[TIMEOUT] ${suite.name}: killed after ${seconds} s (limit ${suiteTimeoutMs(suite)} ms of awake time)`);
    const noMatch = !r.timedOut && process.env.CHECK_FILTER && only === null && r.code === NOMATCH_EXIT;
    const status = r.timedOut ? 'TIMEOUT' : noMatch ? 'no match' : r.code === 0 ? 'pass' : 'FAIL';
    if (status === 'pass' && !process.env.CHECK_FILTER) resumeLib.record(recordFile, { t: 'suite', key: suiteKey(suite) }, recordGuard);   // a filtered pass ran only part of the suite
    results.push({ ...suite, status, seconds });
  }

  console.log('\n=== Summary');
  for (const r of results) console.log(`${r.status.padEnd(7)} ${r.seconds ? (r.seconds + ' s').padStart(6) : '      '}  ${r.name}`);
  const failed = results.filter(r => r.status === 'FAIL' || r.status === 'TIMEOUT').length;
  if (prior) console.log(`resumed: ${resumedSuites} suites, ${resumedChecks} checks passed earlier (not rerun in this result)`);
  const noMatchCount = results.filter(r => r.status === 'no match').length;
  const ranOk = results.filter(r => r.status === 'pass').length;
  if (noMatchCount) console.log(`${noMatchCount} suite(s) had no check matching CHECK_FILTER "${process.env.CHECK_FILTER}" (not counted as passed or failed)`);
  // nothing ran = no suite passed or failed in this run (audit3 6, 8). Two cases, two plain answers:
  //  - every wanted suite had passed earlier on this commit (--resume): not a failure, exit 0, said plainly;
  //  - a CHECK_FILTER that matched nothing, or --no-browser/--only leaving nothing to run: nothing was verified, exit 1.
  const allResumed = ranOk === 0 && !failed && resumedSuites > 0 && noMatchCount === 0;
  const nothingRan = ranOk === 0 && !failed && !allResumed;
  if (nothingRan && noMatchCount) console.log('no check matched CHECK_FILTER in any suite: nothing was verified');
  else if (nothingRan) console.log('no suite was run (all skipped or left out by --only/--no-browser): nothing was verified');
  console.log(failed ? `\n${failed} suite(s) failed` : allResumed ? `\nnothing was run: all ${resumedSuites} suite(s) had already passed on this commit (--resume)` : nothingRan ? '\nnothing ran' : '\nall suites passed');
  process.exit(failed || nothingRan ? 1 : 0);
})();
