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
    const attempt = async n => { ns.push(n); const i = calls++; c.adv(2000); w.tick(); if (sleepEach[i]) c.adv(sleepEach[i]); return outcomes[Math.min(i, outcomes.length - 1)]; };   // tick after the 2 s of work, as the 1 s heartbeat would
    return { r, attempt, lines, calls: () => calls, ns: () => ns };
  }
  const P = { pass: true, detail: '' }, F = { pass: false, detail: 'timed out after 180000 ms' };
  await check('fail + sleep gap: rerun once, the passing rerun is the result, [RETRY] line printed, counted', async () => {
    const s = setup([F, P], [300000, 0]);
    const out = await s.r.run('chk A', s.attempt);
    return out.pass && s.calls() === 2 && JSON.stringify(s.ns()) === '[0,1]' && /^\[RETRY\] chk A: slept 300 s during this attempt/.test(s.lines[0]) &&
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
    for (let i = 0; i < 61; i++) { c.adv(1000); w.tick(); }   // and woke more than 60 s before it (owner 2026-11-05: up to 60 s counts)
    let calls = 0;
    const out = await r.run('chk F', async () => { calls++; c.adv(2000); return F; });
    return !out.pass && calls === 1 || calls;
  });
  await check('a failure within 60 s after waking is rerun once, and the same sleep does not rerun it again', async () => {
    const c = clock(), w = watch(c), lines = [];
    const r = createRetrier({ watch: w, now: c.now, log: s => lines.push(s) });
    c.adv(500000); w.tick();      // woke just before the check
    let calls = 0;
    const out = await r.run('chk W', async () => { calls++; c.adv(2000); return F; });
    return !out.pass && calls === 2 || calls;
  });
  await check('a retried failure keeps its detail and duration in the [RETRY] line, and the final pass is labelled "PASS after retry"', async () => {
    const s = setup([{ pass: false, detail: 'wrong result 7' }, P], [300000, 0]);
    const out = await s.r.run('chk G', s.attempt);
    return out.pass && out.afterRetry && s.r.label(out) === 'PASS after retry' && /took 302000 ms: wrong result 7/.test(s.lines[0]) && s.r.label(P) === 'PASS' && s.r.label(F) === 'FAIL' || JSON.stringify({ l: s.lines, o: out });
  });
  await check('an attempt that throws (browser would not launch) is a failed attempt: no gap = FAIL and the run goes on', async () => {
    const c = clock(), w = watch(c), lines = [];
    const r = createRetrier({ watch: w, now: c.now, log: s => lines.push(s) });
    const out = await r.run('chk H', async () => { c.adv(1000); throw new Error('launch failed'); });
    const out2 = await r.run('chk H2', async () => P);   // the next check still runs
    return !out.pass && /threw: launch failed/.test(out.detail) && out2.pass && lines.length === 0 || JSON.stringify({ out, lines });
  });
  await check('an attempt that throws while the machine slept is rerun, and the rerun can pass', async () => {
    const c = clock(), w = watch(c), lines = [];
    const r = createRetrier({ watch: w, now: c.now, log: s => lines.push(s) });
    let n = 0;
    const out = await r.run('chk I', async () => { c.adv(1000); w.tick(); if (n++ === 0) { c.adv(200000); throw new Error('Target closed'); } return P; });
    return out.pass && out.afterRetry && n === 2 && /Target closed/.test(lines[0]) || JSON.stringify({ out, lines, n });
  });
  await check('maxRetries null/false/empty means the default 2, not 0; 0 turns retries off', async () => {
    // no sleep gap here, so use the stored value through a throwing probe: check the cap via a slept setup
    const capOf = async v => {
      const c = clock(), w = watch(c), r = createRetrier({ watch: w, now: c.now, maxRetries: v, log: () => {} });
      let n = 0; await r.run('x', async () => { n++; c.adv(1000); w.tick(); c.adv(100000); return F; }); return n - 1;
    };
    return JSON.stringify([await capOf(null), await capOf(false), await capOf(''), await capOf(undefined), await capOf(0), await capOf(1)]) === '[2,2,2,2,0,1]';
  });
  await check('SLEEP_WATCH_TEST_GAP: loud [WARN] at start, and the count line is marked synthetic', async () => {
    const warns = []; const old = console.warn; console.warn = s => warns.push(s);
    let w;
    try { w = startSleepWatch({ env: { SLEEP_WATCH_TEST_GAP: '50:30000' } }); } finally { console.warn = old; }
    const marked = w.synthetic && /FAKE sleep gap/.test(warns.join('')) && /SYNTHETIC SLEEP GAP ACTIVE/.test(createRetrier({ watch: w }).suffix());
    w.stop();
    const plain = createRetrier({ watch: watch(clock()) });
    return marked && !plain.watch.synthetic && plain.suffix() === '' || JSON.stringify(warns);
  });
  process.exit(fail ? 1 : 0);
})();
