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
check('only passes are remembered: a failed outcome given to the runner path (recordResult) is never written', () => {
  const f = newFile(); startFresh(f, A);
  const keep = process.env.CHECK_RESUME_FILE; process.env.CHECK_RESUME_FILE = f;
  const s = forSuite('regression', ROOT, () => A);
  process.env.CHECK_RESUME_FILE = keep === undefined ? '' : keep; if (keep === undefined) delete process.env.CHECK_RESUME_FILE;
  s.recordResult('failed one', { pass: false, detail: 'x' });
  s.recordResult('passed one', { pass: true });
  const p = loadProgress(f, A);
  return p.checks.get('regression').has('passed one') && !p.checks.get('regression').has('failed one') && p.checks.get('regression').size === 1 || JSON.stringify([...p.checks.get('regression')]);
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
check('forSuite: skips only when CHECK_RESUME=1, and records passes to the file (fixed clean state, independent of the real tree)', () => {
  const st = A, gs = () => A;
  const f = seeded(st);
  const keep = { f: process.env.CHECK_RESUME_FILE, r: process.env.CHECK_RESUME };
  process.env.CHECK_RESUME_FILE = f; process.env.CHECK_RESUME = '';
  const off = forSuite('regression', ROOT, gs);
  process.env.CHECK_RESUME = '1';
  const on = forSuite('regression', ROOT, gs);
  on.record('New pass');
  const again = forSuite('regression', ROOT, gs);
  if (keep.f === undefined) delete process.env.CHECK_RESUME_FILE; else process.env.CHECK_RESUME_FILE = keep.f;
  if (keep.r === undefined) delete process.env.CHECK_RESUME; else process.env.CHECK_RESUME = keep.r;
  return off.skip.size === 0 && on.skip.has('Dot plot range') && again.skip.has('New pass') || JSON.stringify([...on.skip]);
});
check('a partial last line is ended first, so the next pass is not glued onto it and lost', () => {
  const f = seeded(A); fs.appendFileSync(f, '{"t":"check","suite":"regres');
  record(f, { t: 'check', suite: 'regression', name: 'After crash' });
  const p = loadProgress(f, A);
  return p.checks.get('regression').has('After crash') && p.checks.get('regression').size === 3 || JSON.stringify([...p.checks.get('regression')]);
});
check('startFresh on an unwritable path warns and returns false instead of throwing', () => {
  const warns = []; const old = console.warn; console.warn = s => warns.push(s);
  let r;
  try { r = startFresh(dir, A); } finally { console.warn = old; }   // a directory cannot be written as a file
  return r === false && /could not create the progress file/.test(warns.join('')) || JSON.stringify({ r, warns });
});
check('tracked files changing during the run stop recording, with one warning', () => {
  const f = newFile(); startFresh(f, A);
  let status = '';
  const guard = { baseline: { commit: A.commit, dirty: false, status: '' }, root: ROOT, gitState: () => ({ commit: A.commit, dirty: !!status, status }) };
  const warns = []; const old = console.warn; console.warn = s => warns.push(s);
  try {
    record(f, { t: 'check', suite: 'regression', name: 'before edit' }, guard);
    status = ' M tests/x.js\n';
    record(f, { t: 'check', suite: 'regression', name: 'after edit 1' }, guard);
    status = '';   // even if the tree looks clean again, recording stays stopped
    record(f, { t: 'check', suite: 'regression', name: 'after edit 2' }, guard);
  } finally { console.warn = old; }
  const got = loadProgress(f, A).checks.get('regression');
  return got.size === 1 && got.has('before edit') && warns.length === 1 || JSON.stringify({ got: [...got], warns });
});
check('a real run with SLEEP_WATCH_TEST_GAP set records no passes', () => {
  const f = newFile(); startFresh(f, A);
  const keep = process.env.SLEEP_WATCH_TEST_GAP; process.env.SLEEP_WATCH_TEST_GAP = '1000:30000';
  try { record(f, { t: 'suite', key: 'k' }); } finally { if (keep === undefined) delete process.env.SLEEP_WATCH_TEST_GAP; else process.env.SLEEP_WATCH_TEST_GAP = keep; }
  return loadProgress(f, A).suites.size === 0;
});
check('no commit readable (git missing): the message says so, not "uncommitted changes"', () => {
  const p = loadProgress(seeded(A), { commit: null, dirty: true });
  return !p.usable && /git could not report/.test(p.message) && !/uncommitted/.test(p.message) || p.message;
});
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp dir */ }
process.exit(fail ? 1 : 0);
