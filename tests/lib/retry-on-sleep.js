'use strict';
// Rerun a check that failed because the machine slept (2026-11-04). Rule, and nothing wider:
//   - a check that PASSED is never rerun;
//   - a check that FAILED with no recorded sleep gap overlapping its attempt is never rerun;
//   - a check that FAILED while the machine slept is rerun (the caller's attempt() starts a fresh
//     browser), at most 2 times; the last rerun's result is the result and must pass by itself.
// The whole attempt is the span (browser launch, page load, the check, closing): sleep during any of
// them can cause the failure, and the rerun must pass by itself anyway.
// An attempt that throws (e.g. the browser would not launch) is a failed attempt, not a crash of the run.
// The runners print the retry count in their final line so a clean run with retries is not mistaken
// for an uninterrupted one, and label a pass that needed a rerun "PASS after retry".
const { startSleepWatch } = require('./sleep-watch');

function createRetrier(opts) {
  const o = opts || {};
  const watch = o.watch || startSleepWatch(o);
  const now = o.now || Date.now;
  const log = o.log || (s => console.log(s));
  const graceMs = o.graceMs >= 0 ? o.graceMs : 60000;
  const maxRetries = Number.isInteger(o.maxRetries) && o.maxRetries >= 0 ? o.maxRetries : 2;
  const retried = [];

  // attempt(n): n = 0 for the first run, 1..2 for reruns (a shared-browser suite relaunches its browser when n > 0); runs the check once and returns { pass, detail }. Returns the final outcome.
  async function run(name, attempt) {
    let outcome, retries = 0;
    for (;;) {
      const t0 = now();
      try { outcome = await attempt(retries); }
      catch (e) { outcome = { pass: false, detail: 'threw: ' + (e && e.message || e) }; }
      if (outcome.pass || retries >= maxRetries) break;
      const slept = watch.sleptBetween(retries ? t0 : t0 - graceMs, now());   // first attempt: also a sleep that ended just before it (a check can fail right after wake)
      if (!(slept > 0)) break;
      retries++;
      if (retries === 1) retried.push(name);
      log(`[RETRY] ${name}: slept ${Math.round(slept / 1000)} s during this attempt (rerun ${retries}/${maxRetries}, fresh browser); the failed attempt took ${now() - t0} ms: ${outcome.detail || '(no detail)'}`);
    }
    if (retries && outcome.pass) outcome = { ...outcome, afterRetry: true };
    return outcome;
  }
  // 'PASS', 'PASS after retry' or 'FAIL' for the result line
  function label(outcome) { return outcome.pass ? (outcome.afterRetry ? 'PASS after retry' : 'PASS') : 'FAIL'; }
  function suffix() {
    return (retried.length ? ` (${retried.length} check(s) retried after the machine slept: ${retried.join('; ')})` : '') +
      (watch.synthetic ? ' [SYNTHETIC SLEEP GAP ACTIVE (SLEEP_WATCH_TEST_GAP): not a real run]' : '');
  }
  return { run, label, suffix, retried, watch };
}

// A CHECK_FILTER that matches no check is not a pass. Alone (or with --only) the runner exits 1; under
// tests/run-all.js (which sets CHECK_NOMATCH_EXIT) it exits with that code so the parent can say
// "no match" for this suite instead of a failure.
function exitNoMatch(filter) {
  console.log(`no check matched CHECK_FILTER "${filter}"`);
  process.exit(+process.env.CHECK_NOMATCH_EXIT > 0 ? +process.env.CHECK_NOMATCH_EXIT : 1);
}

module.exports = { createRetrier, exitNoMatch };
