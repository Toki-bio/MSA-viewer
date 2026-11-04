'use strict';
// Laptop sleep detector for the test runners (2026-11-04). The owner's laptop sleeps during the ~80 min
// suite; a check that was running then "times out" (wall clock kept running) although nothing is wrong.
// A 1 s heartbeat records every wall-clock gap above a threshold (default 30 s; SLEEP_GAP_MS overrides),
// and sleptBetween(t0, t1) says how much of a span lies inside such gaps.
//   const w = startSleepWatch();  ...  w.sleptBetween(t0, t1)  // ms
// Tests inject the clock: startSleepWatch({ now, autoStart: false }) and call w.tick() by hand.
// SLEEP_WATCH_TEST_GAP="afterMs:gapMs" (tests of the runners only) records one synthetic gap of gapMs
// ending afterMs after the start, to show a [RETRY] in a real run without sleeping the machine.
const DEFAULT_GAP_MS = 30000;

function startSleepWatch(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const now = o.now || Date.now;
  const thresholdMs = o.thresholdMs > 0 ? o.thresholdMs : (+env.SLEEP_GAP_MS > 0 ? +env.SLEEP_GAP_MS : DEFAULT_GAP_MS);
  const intervalMs = o.intervalMs > 0 ? o.intervalMs : 1000;
  const gaps = [];
  let last = now();
  let timer = null, injectTimer = null, synthetic = false;

  function tick() {
    const t = now();
    if (t - last > thresholdMs) gaps.push({ start: last, end: t });
    last = t;
  }
  function sleptBetween(t0, t1) {
    tick();   // a gap that ended just now may not have been recorded yet
    let total = 0;
    for (const g of gaps) {
      const a = Math.max(g.start, t0), b = Math.min(g.end, t1);
      if (b > a) total += b - a;
    }
    return total;
  }
  function stop() { if (timer) clearInterval(timer); if (injectTimer) clearTimeout(injectTimer); timer = injectTimer = null; }

  if (o.autoStart !== false) {
    timer = setInterval(tick, intervalMs);
    if (timer.unref) timer.unref();
    const inj = /^(\d+):(\d+)$/.exec(env.SLEEP_WATCH_TEST_GAP || '');
    if (inj) {
      synthetic = true;
      console.warn(`[WARN] SLEEP_WATCH_TEST_GAP=${env.SLEEP_WATCH_TEST_GAP} is set: a FAKE sleep gap will be injected, so failed checks may be rerun although the machine did not sleep. Not a real result; passes are not recorded for --resume. Unset it for a real run.`);
      injectTimer = setTimeout(() => { const t = now(); gaps.push({ start: t - +inj[2], end: t }); }, +inj[1]);
      if (injectTimer.unref) injectTimer.unref();
    }
  }
  return { tick, sleptBetween, stop, gaps, thresholdMs, get synthetic() { return synthetic; } };
}

module.exports = { startSleepWatch, DEFAULT_GAP_MS };
