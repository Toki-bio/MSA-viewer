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
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const st = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' });
  if (head.status !== 0 || st.status !== 0) return { commit: null, dirty: true };
  return { commit: head.stdout.trim(), dirty: st.stdout.trim().length > 0 };
}

function defaultProgressFile(root) {
  const id = crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 10);
  return path.join(os.tmpdir(), `viewalign-test-progress-${id}.jsonl`);
}

// Starts a new progress file (overwrites any old one).
function startFresh(file, state) {
  fs.writeFileSync(file, JSON.stringify({ t: 'header', commit: state.commit, dirty: !!state.dirty, started: new Date().toISOString() }) + '\n');
}

function record(file, entry) {
  if (!file) return;
  try { fs.appendFileSync(file, JSON.stringify(entry) + '\n'); } catch (e) { console.warn('[WARN] could not write progress: ' + e.message); }
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
  if (state.dirty || !state.commit) { out.message = 'tracked files have uncommitted changes; progress not reused, starting fresh'; return out; }
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
// that already passed. Returns { file, skip:Set, record(name) }.
function forSuite(suiteName, root) {
  const file = process.env.CHECK_RESUME_FILE || '';
  const skip = new Set();
  if (file && process.env.CHECK_RESUME === '1') {
    const p = loadProgress(file, gitState(root));
    if (p.usable && p.checks.has(suiteName)) for (const n of p.checks.get(suiteName)) skip.add(n);
  }
  return { file, skip, record: name => record(file, { t: 'check', suite: suiteName, name }) };
}
module.exports.forSuite = forSuite;
