'use strict';
// A time limit per check for the browser suites (owner's request, 2026-10-23): one check that never
// settles (a waitForFunction without a timeout, a page that never goes idle, an infinite retry loop)
// used to hold the whole suite open for hours. Each runner races a check against this limit and fails
// it with "timed out after N ms"; the browser is then closed, which rejects the check's pending calls.
//   default 180 s (the slowest check, 130,000 sequences, takes ~90 s); CHECK_TIMEOUT_MS overrides;
//   check(name, fn, { timeoutMs }) sets a check's own limit.
const DEFAULT_CHECK_TIMEOUT_MS = 180000;

function checkTimeoutMs(opts, env) {
  if (opts && opts.timeoutMs > 0) return opts.timeoutMs;
  const e = +(env || process.env).CHECK_TIMEOUT_MS;
  return e > 0 ? e : DEFAULT_CHECK_TIMEOUT_MS;
}

function withTimeout(promise, ms) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); });
  const guarded = Promise.resolve(promise).finally(() => clearTimeout(timer));
  guarded.catch(() => {});   // a settlement after the limit must not surface as an unhandled rejection
  return Promise.race([guarded, limit]);
}

module.exports = { withTimeout, checkTimeoutMs, DEFAULT_CHECK_TIMEOUT_MS };
