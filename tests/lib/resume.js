'use strict';
// Progress record for `node tests/run-all.js --resume` (2026-11-04). A run that dies (laptop sleep,
// crash, kill) loses everything unless passes are written down as they happen.
// File: JSON lines, append-only (one small appendFileSync per pass, so a kill loses at most the check
// that was running). Line 1 is a header {t:'header', commit, dirty}; then {t:'suite', key} for a passed
// suite and {t:'check', suite, name} for a passed check inside a suite (regression only).
// Only passes are remembered; failed and unfinished items run again. Progress is reused only when the
// commit is the same and the tracked files are clean; otherwise the caller starts fresh.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function gitState(root) {
  // ONE git call (was two: rev-parse + status, ~108 ms per check measured; this is ~60 ms). porcelain v2 with
  // --branch prints the commit as "# branch.oid <sha>" and then the tracked changes, if any.
  const r = spawnSync('git', ['status', '--porcelain=v2', '--branch', '--untracked-files=no'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return { commit: null, dirty: true };
  const lines = r.stdout.split('\n');
  const oid = lines.find(l => l.startsWith('# branch.oid '));
  const commit = oid ? oid.slice('# branch.oid '.length).trim() : '';
  if (!/^[0-9a-f]{40,64}$/.test(commit)) return { commit: null, dirty: true };
  const status = lines.filter(l => l && !l.startsWith('# ')).join('\n');
  return { commit, dirty: status.length > 0, status };
}

function defaultProgressFile(root) {
  const id = crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 10);
  return path.join(os.tmpdir(), `viewalign-test-progress-${id}.jsonl`);
}

// Starts a new progress file (overwrites any old one). Returns false (and warns) if it cannot be
// written: the run then goes on without progress recording and without resume.
function startFresh(file, state) {
  try {
    fs.writeFileSync(file, JSON.stringify({ t: 'header', commit: state.commit, dirty: !!state.dirty, started: new Date().toISOString() }) + '\n');
    return true;
  } catch (e) {
    console.warn(`[WARN] could not create the progress file ${file}: ${e.message}; running without progress recording (no --resume possible)`);
    return false;
  }
}

// A real run with a fake sleep gap (SLEEP_WATCH_TEST_GAP) must not leave passes that a later --resume trusts.
const syntheticGap = () => /^\d+:\d+$/.test(process.env.SLEEP_WATCH_TEST_GAP || '');

// record(file, entry, guard?): guard = { baseline: gitState at the start, root, gitState? }. With a guard,
// tracked files changing during the run (another commit, or a different git status) stop all recording
// (one [WARN]): a pass written after that no longer describes the committed code.
function record(file, entry, guard) {
  if (!file || syntheticGap() || (guard && guard.stopped)) return;
  if (guard) {
    const now = (guard.gitState || gitState)(guard.root);
    const b = guard.baseline;
    if (now.commit !== b.commit || (now.status || '') !== (b.status || '')) {
      guard.stopped = true;
      console.warn('[WARN] tracked files changed during this run; no more passes are recorded for --resume');
      return;
    }
  }
  try {
    let prefix = '';
    try {   // a kill mid-write can leave a partial last line: end it so this entry is not glued onto it
      const size = fs.statSync(file).size;
      if (size > 0) {
        const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(1);
        try { fs.readSync(fd, buf, 0, 1, size - 1); } finally { fs.closeSync(fd); }
        if (buf[0] !== 10) prefix = '\n';
      }
    } catch (e) { /* no file yet: appendFileSync creates it */ }
    fs.appendFileSync(file, prefix + JSON.stringify(entry) + '\n');
  } catch (e) { console.warn('[WARN] could not write progress: ' + e.message); }
}

// Returns { suites:Set, checks:Map(suite -> Set), message, usable }. Never throws.
function loadProgress(file, state) {
  const out = { suites: new Set(), checks: new Map(), message: '', usable: false };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { out.message = 'no progress file to resume from; starting fresh'; return out; }
  const lines = text.split('\n').filter(l => l.trim());
  let header = null;
  try { header = JSON.parse(lines[0]); } catch (e) { /* handled below */ }
  if (!header || header.t !== 'header') { out.message = 'progress file is corrupted (no valid header); ignored, starting fresh'; return out; }
  if (!state.commit) { out.message = 'git could not report the current commit (git missing or not a repository); progress not reused, starting fresh'; return out; }
  if (state.dirty) { out.message = 'tracked files have uncommitted changes; progress not reused, starting fresh'; return out; }
  if (header.dirty) { out.message = 'the earlier run was made on a tree with uncommitted changes; progress not reused, starting fresh'; return out; }
  if (header.commit !== state.commit) { out.message = `progress is from commit ${String(header.commit).slice(0, 10)}, now ${state.commit.slice(0, 10)}; not reused, starting fresh`; return out; }
  let bad = 0;
  for (const l of lines.slice(1)) {
    let e;
    try { e = JSON.parse(l); } catch (x) { bad++; continue; }
    if (e && e.t === 'suite' && typeof e.key === 'string') out.suites.add(e.key);
    else if (e && e.t === 'check' && typeof e.suite === 'string' && typeof e.name === 'string') {
      if (!out.checks.has(e.suite)) out.checks.set(e.suite, new Set());
      out.checks.get(e.suite).add(e.name);
    } else bad++;
  }
  if (bad) out.message = `${bad} unreadable line(s) in the progress file ignored (a kill mid-write)`;
  out.usable = true;
  return out;
}

module.exports = { gitState, defaultProgressFile, startFresh, record, loadProgress };

// For a suite's own runner (the child of tests/run-all.js): CHECK_RESUME_FILE says where to record
// passed checks; CHECK_RESUME=1 (set only when the parent accepted the progress) says to skip those
// that already passed. Returns { file, skip:Set, record(name), recordResult(name, outcome) }; recordResult writes only passes (the runner uses it).
function forSuite(suiteName, root, gitStateFn) {
  const file = process.env.CHECK_RESUME_FILE || '';
  const skip = new Set();
  const gs = gitStateFn || gitState;
  const baseline = gs(root);
  if (file && process.env.CHECK_RESUME === '1') {
    const p = loadProgress(file, baseline);
    if (p.usable && p.checks.has(suiteName)) for (const n of p.checks.get(suiteName)) skip.add(n);
  }
  const guard = { baseline, root, gitState: gs };
  // The child's own start state is no proof: the parent wrote the header for the tree it started on, and the
  // tree may have been edited (or the commit moved) before this child started. Passes recorded on a tree that
  // is not the header's tree would be trusted by a later --resume (audit finding 0). So when the file has a
  // clean header, this child records only if its tree is that same clean commit.
  if (file) {
    let header = null;
    try { header = JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0]); } catch (e) { /* no file or no header: nothing to compare */ }
    if (header && header.t === 'header' && !header.dirty && (header.commit !== baseline.commit || baseline.dirty)) {
      guard.stopped = true;
      console.warn('[WARN] this run started on a tree that is not the one the progress file was written for (other commit or edited tracked files); no passes are recorded for --resume');
    }
  }
  const rec = name => record(file, { t: 'check', suite: suiteName, name }, guard);
  // only a PASS is remembered; a failed check is never written, so it runs again
  return { file, skip, record: rec, recordResult: (name, outcome) => { if (outcome && outcome.pass) rec(name); } };
}
module.exports.forSuite = forSuite;
