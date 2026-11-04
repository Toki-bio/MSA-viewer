'use strict';
// Sleep detection (tests/lib/sleep-watch.js) and the retry-after-sleep rule (tests/lib/retry-on-sleep.js),
// with an injected clock. node tests/unit/sleep-watch.test.js
const path = require('path');
const { startSleepWatch } = require(path.join(__dirname, '..', 'lib', 'sleep-watch'));
const { createRetrier } = require(path.join(__dirname, '..', 'lib', 'retry-on-sleep'));
let fail = 0;
async function check(name, fn) {
  try { const r = await fn(); if (r !== true) { fail++; console.log('FAIL', name, '-', r); } else console.log('ok  ', name); }
  catch (e) { fail++; console.log('FAIL', name, '- threw', e.message); }
}
function clock() { const c = { t: 1000000, now: () => c.t, adv: ms => { c.t += ms; } }; return c; }
function watch(c, extra) { return startSleepWatch({ now: c.now, autoStart: false, env: {}, ...extra }); }

(async () => {
  await check('a gap above the 30 s default is recorded', async () => {
    const c = clock(), w = watch(c);
    c.adv(1000); w.tick(); c.adv(120000); w.tick();
    return w.gaps.length === 1 && w.gaps[0].end - w.gaps[0].start === 120000 || JSON.stringify(w.gaps);
  });
  await check('ordinary 1 s ticks and a 29 s stall record nothing', async () => {
    const c = clock(), w = watch(c);
    for (let i = 0; i < 20; i++) { c.adv(1000); w.tick(); }
    c.adv(29000); w.tick();
    return w.gaps.length === 0 || JSON.stringify(w.gaps);
  });
  await check('SLEEP_GAP_MS overrides the threshold', async () => {
    const c = clock(), w = watch(c, { env: { SLEEP_GAP_MS: '5000' } });
    c.adv(6000); w.tick();
    return w.gaps.length === 1 && w.thresholdMs === 5000 || JSON.stringify(w.gaps);
  });
  await check('overlap arithmetic: before, inside, straddling edges, after, two gaps summed', async () => {
    const c = clock(), w = watch(c);
    const t = c.t;
    c.adv(100000); w.tick();        // gap A: t .. t+100000
    c.adv(10000); w.tick();         // ordinary 10 s
    c.adv(50000); w.tick();         // gap B: t+110000 .. t+160000
    const r = [
      w.sleptBetween(t - 5000, t - 1),            // before everything: 0
      w.sleptBetween(t + 10000, t + 30000),       // inside A: 20000
      w.sleptBetween(t - 10000, t + 10000),       // straddles A's start: 10000
      w.sleptBetween(t + 90000, t + 120000),      // straddles A's end and B's start: 10000 + 10000
      w.sleptBetween(t, t + 160000),              // both gaps: 150000
      w.sleptBetween(t + 100000, t + 110000),     // between the gaps: 0
      w.sleptBetween(t + 170000, t + 180000),     // after: 0
    ];
    return JSON.stringify(r) === JSON.stringify([0, 20000, 10000, 20000, 150000, 0, 0]) || JSON.stringify(r);
  });
  await check('sleptBetween notices a gap that ended just now even before the heartbeat ran', async () => {
    const c = clock(), w = watch(c);
    const t0 = c.t; c.adv(90000);
    return w.sleptBetween(t0, c.t) === 90000 || w.sleptBetween(t0, c.t);
  });

  // ---- retry rule
  function setup(outcomes, sleepEach) {   // outcomes: results of successive attempts; sleepEach: ms the machine slept in each
    const c = clock(), w = watch(c), lines = [];
    const r = createRetrier({ watch: w, now: c.now, log: s => lines.push(s) });
    let calls = 0; const ns = [];
    const attempt = async n => { ns.push(n); const i = calls++; c.adv(2000); if (sleepEach[i]) c.adv(sleepEach[i]); return outcomes[Math.min(i, outcomes.length - 1)]; };
    return { r, attempt, lines, calls: () => calls, ns: () => ns };
  }
  const P = { pass: true, detail: '' }, F = { pass: false, detail: 'timed out after 180000 ms' };
  await check('fail + sleep gap: rerun once, the passing rerun is the result, [RETRY] line printed, counted', async () => {
    const s = setup([F, P], [300000, 0]);
    const out = await s.r.run('chk A', s.attempt);
    return out.pass && s.calls() === 2 && JSON.stringify(s.ns()) === '[0,1]' && /^\[RETRY\] chk A: the machine slept 302 s during this check/.test(s.lines[0]) &&
      s.r.retried.length === 1 && /1 check\(s\) retried/.test(s.r.suffix()) || JSON.stringify({ out, c: s.calls(), l: s.lines });
  });
  await check('fail without a gap: not rerun, no retry counted', async () => {
    const s = setup([F, P], [0, 0]);
    const out = await s.r.run('chk B', s.attempt);
    return !out.pass && s.calls() === 1 && s.lines.length === 0 && s.r.suffix() === '' || s.calls();
  });
  await check('pass (even with a sleep gap in its span): never rerun', async () => {
    const s = setup([P], [300000]);
    const out = await s.r.run('chk C', s.attempt);
    return out.pass && s.calls() === 1 && s.lines.length === 0 || s.calls();
  });
  await check('stops after 2 reruns when every attempt fails and slept', async () => {
    const s = setup([F], [100000, 100000, 100000, 100000]);
    const out = await s.r.run('chk D', s.attempt);
    return !out.pass && s.calls() === 3 && s.lines.length === 2 && s.r.retried.length === 1 || s.calls();
  });
  await check('a rerun that fails (no sleep this time) stays failed and is not rerun again', async () => {
    const s = setup([F, F, P], [100000, 0, 0]);
    const out = await s.r.run('chk E', s.attempt);
    return !out.pass && s.calls() === 2 || s.calls();
  });
  await check('a gap from an EARLIER check does not trigger a rerun of a later failure', async () => {
    const c = clock(), w = watch(c), lines = [];
    const r = createRetrier({ watch: w, now: c.now, log: s => lines.push(s) });
    c.adv(500000); w.tick();      // slept before the check started
    let calls = 0;
    const out = await r.run('chk F', async () => { calls++; c.adv(2000); return F; });
    return !out.pass && calls === 1 || calls;
  });
  process.exit(fail ? 1 : 0);
})();
