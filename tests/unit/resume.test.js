'use strict';
// Progress file for --resume (tests/lib/resume.js). node tests/unit/resume.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const resume = require(path.join(__dirname, '..', 'lib', 'resume'));
const { loadProgress, startFresh, record, forSuite, gitState } = resume;
const ROOT = path.join(__dirname, '..', '..');
let fail = 0;
function check(name, fn) {
  try { const r = fn(); if (r !== true) { fail++; console.log('FAIL', name, '-', r); } else console.log('ok  ', name); }
  catch (e) { fail++; console.log('FAIL', name, '- threw', e.message); }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-resume-test-'));
let n = 0;
const newFile = () => path.join(dir, 'p' + (n++) + '.jsonl');
const A = { commit: 'a'.repeat(40), dirty: false }, B = { commit: 'b'.repeat(40), dirty: false };
function seeded(state) {
  const f = newFile();
  startFresh(f, state);
  record(f, { t: 'suite', key: 'unit: x | tests/unit/x.js' });
  record(f, { t: 'check', suite: 'regression', name: 'Dot plot range' });
  record(f, { t: 'check', suite: 'regression', name: 'Another' });
  return f;
}

check('same commit, clean tree: passed suites and checks are returned', () => {
  const p = loadProgress(seeded(A), A);
  return p.usable && p.suites.has('unit: x | tests/unit/x.js') && p.checks.get('regression').size === 2 || JSON.stringify(p);
});
check('a different commit is not reused, with a message naming both', () => {
  const p = loadProgress(seeded(A), B);
  return !p.usable && p.suites.size === 0 && /aaaaaaaaaa/.test(p.message) && /bbbbbbbbbb/.test(p.message) || JSON.stringify(p);
});
check('a dirty tree now is not reused', () => {
  const p = loadProgress(seeded(A), { commit: A.commit, dirty: true });
  return !p.usable && /uncommitted/.test(p.message) || JSON.stringify(p);
});
check('progress written on a dirty tree is not reused later either', () => {
  const p = loadProgress(seeded({ commit: A.commit, dirty: true }), A);
  return !p.usable && /uncommitted/.test(p.message) || JSON.stringify(p);
});
check('only passes are remembered: a check that failed is never in the file, so it runs again', () => {
  const f = newFile(); startFresh(f, A);
  record(f, { t: 'check', suite: 'regression', name: 'passed one' });   // the failed one is simply never recorded
  const p = loadProgress(f, A);
  return p.checks.get('regression').has('passed one') && !p.checks.get('regression').has('failed one');
});
check('a corrupted progress file is ignored with a message, no crash', () => {
  const f = newFile(); fs.writeFileSync(f, 'this is not json\n{{{');
  const p = loadProgress(f, A);
  return !p.usable && /corrupted/.test(p.message) && p.suites.size === 0 || JSON.stringify(p);
});
check('a truncated last line (kill mid-write) loses only that line', () => {
  const f = seeded(A); fs.appendFileSync(f, '{"t":"check","suite":"regres');
  const p = loadProgress(f, A);
  return p.usable && p.checks.get('regression').size === 2 && /unreadable/.test(p.message) || JSON.stringify(p);
});
check('a missing file is a fresh start, not an error', () => {
  const p = loadProgress(path.join(dir, 'nope.jsonl'), A);
  return !p.usable && /starting fresh/.test(p.message);
});
check('startFresh overwrites an old file', () => {
  const f = seeded(A); startFresh(f, A);
  const p = loadProgress(f, A);
  return p.usable && p.suites.size === 0 && p.checks.size === 0;
});
check('forSuite: skips only when CHECK_RESUME=1, and records passes to the file', () => {
  const st = gitState(ROOT);
  const f = seeded(st);
  const keep = { f: process.env.CHECK_RESUME_FILE, r: process.env.CHECK_RESUME };
  process.env.CHECK_RESUME_FILE = f; process.env.CHECK_RESUME = '';
  const off = forSuite('regression', ROOT);
  process.env.CHECK_RESUME = '1';
  const on = forSuite('regression', ROOT);
  on.record('New pass');
  const again = forSuite('regression', ROOT);
  if (keep.f === undefined) delete process.env.CHECK_RESUME_FILE; else process.env.CHECK_RESUME_FILE = keep.f;
  if (keep.r === undefined) delete process.env.CHECK_RESUME; else process.env.CHECK_RESUME = keep.r;
  // with uncommitted edits to tracked files the progress must not be reused, so nothing is skipped then
  if (st.dirty) return off.skip.size === 0 && on.skip.size === 0 || 'dirty tree: expected nothing skipped';
  return off.skip.size === 0 && on.skip.has('Dot plot range') && again.skip.has('New pass') || JSON.stringify([...on.skip]);
});
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp dir */ }
process.exit(fail ? 1 : 0);
