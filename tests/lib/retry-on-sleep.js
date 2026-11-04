'use strict';
// Rerun a check that failed because the machine slept (2026-11-04). Rule, and nothing wider:
//   - a check that PASSED is never rerun;
//   - a check that FAILED with no recorded sleep gap overlapping its span is never rerun;
//   - a check that FAILED while the machine slept is rerun (the caller's attempt() starts a fresh
//     browser), at most 2 times; the last rerun's result is the result and must pass by itself.
// The runners print the retry count in their final line so a clean run with retries is not mistaken
// for an uninterrupted one.
const { startSleepWatch } = require('./sleep-watch');

function createRetrier(opts) {
  const o = opts || {};
  const watch = o.watch || startSleepWatch(o);
  const now = o.now || Date.now;
  const log = o.log || (s => console.log(s));
  const maxRetries = o.maxRetries >= 0 ? o.maxRetries : 2;
  const retried = [];

  // attempt(n): n = 0 for the first run, 1..2 for reruns (a shared-browser suite relaunches its browser when n > 0); runs the check once and returns { pass, detail }. Returns the final outcome.
  async function run(name, attempt) {
    let outcome, retries = 0;
    for (;;) {
      const t0 = now();
      outcome = await attempt(retries);
      if (outcome.pass || retries >= maxRetries) break;
      const slept = watch.sleptBetween(t0, now());
      if (!(slept > 0)) break;
      retries++;
      if (retries === 1) retried.push(name);
      log(`[RETRY] ${name}: the machine slept ${Math.round(slept / 1000)} s during this check (rerun ${retries}/${maxRetries}, fresh browser)`);
    }
    return outcome;
  }
  function suffix() {
    return retried.length ? ` (${retried.length} check(s) retried after the machine slept: ${retried.join('; ')})` : '';
  }
  return { run, suffix, retried, watch };
}

module.exports = { createRetrier };
