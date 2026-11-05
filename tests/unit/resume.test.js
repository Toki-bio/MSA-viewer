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
// Dot plot audit3: finding 0. The child's own start state is not proof: a header written for a clean commit
// must not collect passes from a child that started on an edited tree or another commit.
function forSuiteWith(f, gs) {
  const keep = { f: process.env.CHECK_RESUME_FILE, r: process.env.CHECK_RESUME };
  process.env.CHECK_RESUME_FILE = f; process.env.CHECK_RESUME = '';
  const warns = []; const old = console.warn; console.warn = s => warns.push(s);
  try { return { s: forSuite('regression', ROOT, gs), warns }; }
  finally {
    console.warn = old;
    if (keep.f === undefined) delete process.env.CHECK_RESUME_FILE; else process.env.CHECK_RESUME_FILE = keep.f;
    if (keep.r === undefined) delete process.env.CHECK_RESUME; else process.env.CHECK_RESUME = keep.r;
  }
}
check('audit3 0: a child that starts on an edited tree records nothing into a clean-header file, so --resume cannot trust it', () => {
  const f = newFile(); startFresh(f, A);
  const { s, warns } = forSuiteWith(f, () => ({ commit: A.commit, dirty: true, status: ' M script.js' }));
  s.recordResult('edited-tree pass', { pass: true });
  const p = loadProgress(f, A);
  return p.usable && !p.checks.has('regression') && warns.length === 1 || JSON.stringify({ c: [...p.checks.keys()], warns });
});
check('audit3 0: a child on another commit than the header records nothing', () => {
  const f = newFile(); startFresh(f, A);
  const { s } = forSuiteWith(f, () => B);
  s.recordResult('other-commit pass', { pass: true });
  return !loadProgress(f, A).checks.has('regression');
});
check('audit3 0: a child on the same clean commit as the header still records', () => {
  const f = newFile(); startFresh(f, A);
  const { s, warns } = forSuiteWith(f, () => A);
  s.recordResult('good pass', { pass: true });
  return loadProgress(f, A).checks.get('regression').has('good pass') && warns.length === 0;
});
check('audit3 29: gitState uses one git call and agrees with rev-parse / status', () => {
  const { spawnSync } = require('child_process');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const st = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const g = gitState(ROOT);
  return g.commit === head && g.dirty === (st.length > 0) || JSON.stringify({ g, head, st });
});
// Dot plot audit3: findings 6 and 8. A run in which nothing ran is not "all suites passed".
function runNode(args, env) {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
check('audit3 8: --only that matches no suite does not print "all suites passed" and exits 1', () => {
  const r = runNode(['tests/run-all.js', '--only', 'zz no such suite zz'], { CHECK_RESUME_FILE: path.join(dir, 'only-none.jsonl') });
  return r.code === 1 && !/all suites passed/.test(r.out) && /nothing/.test(r.out) || JSON.stringify(r);
});
check('audit3 6: the a11y runner honours CHECK_FILTER: a filter matching nothing exits 1 (3 under the parent) and runs no check', () => {
  try { require.resolve('playwright-core'); } catch (e) { return true; }   // the browser runner cannot even load without it (a --no-browser setup)
  const a = runNode(['tests/a11y/check.js'], { CHECK_FILTER: 'zz no such check zz', CHECK_NOMATCH_EXIT: '' });
  const b = runNode(['tests/a11y/check.js'], { CHECK_FILTER: 'zz no such check zz', CHECK_NOMATCH_EXIT: '3' });
  return a.code === 1 && b.code === 3 && /no check matched/.test(a.out) && !/\[PASS\]/.test(a.out) || JSON.stringify({ a, b });
});
check('audit3 8: a --resume run where every wanted suite had passed earlier says so plainly and exits 0 (clean tree only)', () => {
  const g = gitState(ROOT);
  if (g.dirty) return true;   // resume refuses a dirty tree by design; this check has teeth once the work is committed
  const f = path.join(dir, 'allresumed.jsonl');
  startFresh(f, g);
  const first = runNode(['tests/run-all.js', '--only', 'release version consistency'], { CHECK_RESUME_FILE: f });
  if (first.code !== 0) return 'first run failed: ' + first.out.slice(-300);
  const second = runNode(['tests/run-all.js', '--resume', '--only', 'release version consistency'], { CHECK_RESUME_FILE: f });
  return second.code === 0 && !/all suites passed/.test(second.out) && /nothing was run: all 1 suite\(s\) had already passed/.test(second.out) || JSON.stringify(second);
});
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp dir */ }
process.exit(fail ? 1 : 0);
