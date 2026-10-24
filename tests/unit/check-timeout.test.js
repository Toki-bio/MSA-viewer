'use strict';
// The per-check time limit of the browser suites (tests/lib/check-timeout.js). node tests/unit/check-timeout.test.js
const path = require('path');
const { withTimeout, checkTimeoutMs } = require(path.join(__dirname, '..', 'lib', 'check-timeout'));
let fail = 0;
async function check(name, fn) {
  try { const r = await fn(); if (r !== true) { fail++; console.log('FAIL', name, '-', r); } else console.log('ok  ', name); }
  catch (e) { fail++; console.log('FAIL', name, '- threw', e.message); }
}
(async () => {
  await check('a check that finishes in time passes its result through', async () => {
    const r = await withTimeout(new Promise(res => setTimeout(() => res({ pass: true, detail: 'x' }), 20)), 2000);
    return r.pass === true && r.detail === 'x' || JSON.stringify(r);
  });
  await check('a check that never settles is failed at the limit, with the limit in the message', async () => {
    const t0 = Date.now();
    let msg = '';
    try { await withTimeout(new Promise(() => {}), 150); } catch (e) { msg = e.message; }
    const dt = Date.now() - t0;
    return /timed out after 150 ms/.test(msg) && dt >= 140 && dt < 1500 || `msg=${msg} dt=${dt}`;
  });
  await check('a check that rejects in time rejects with its own error', async () => {
    let msg = '';
    try { await withTimeout(Promise.reject(new Error('boom')), 2000); } catch (e) { msg = e.message; }
    return msg === 'boom' || msg;
  });
  await check('the limit: 180 s by default, CHECK_TIMEOUT_MS overrides it, a check\'s own timeoutMs wins', async () => {
    const d = checkTimeoutMs({}, {});
    const env = checkTimeoutMs({}, { CHECK_TIMEOUT_MS: '5000' });
    const own = checkTimeoutMs({ timeoutMs: 7000 }, { CHECK_TIMEOUT_MS: '5000' });
    return d === 180000 && env === 5000 && own === 7000 || JSON.stringify({ d, env, own });
  });
  await check('a late settlement after the limit is not an unhandled rejection', async () => {
    let unhandled = 0;
    const h = () => { unhandled++; };
    process.on('unhandledRejection', h);
    try { await withTimeout(new Promise((_, rej) => setTimeout(() => rej(new Error('late')), 100)), 30); } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
    process.off('unhandledRejection', h);
    return unhandled === 0 || `unhandled=${unhandled}`;
  });
  await check('the suite runner refuses --only without a suite name (it would run nothing, or everything)', async () => {
    const { spawnSync } = require('child_process');
    const cwd = path.join(__dirname, '..', '..');
    const r1 = spawnSync(process.execPath, ['tests/run-all.js', '--only', '--quick'], { cwd, encoding: 'utf8' });
    const r2 = spawnSync(process.execPath, ['tests/run-all.js', '--only'], { cwd, encoding: 'utf8' });
    return r1.status === 2 && r2.status === 2 && /usage/.test(r1.stderr) || `status ${r1.status}/${r2.status}: ${r1.stderr.slice(0, 80)}`;
  });
  console.log(fail ? `\n${fail} failed` : '\nall passed');
  process.exit(fail ? 1 : 0);
})();
