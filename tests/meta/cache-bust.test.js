// Every `file?v=N` in index.html must have been raised after the file last changed.
// What used to go wrong (audit 2026-11-10, H9/T9): finder.js was changed while index.html
// still said finder.js?v=1, so returning users kept the old file from the browser cache
// beside a new script.js. Nothing checked it.
//
// How: for each reference, the commit that last changed the file must be an ancestor of
// (or the same as) the commit that wrote this exact `file?v=N` into index.html. A file
// with uncommitted edits needs a number that is not in the committed index.html.
// Needs the full git history (CI: fetch-depth 0); a shallow clone cannot be checked.
//
//   node tests/meta/cache-bust.test.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const ok = (...args) => { try { git(...args); return true; } catch (_) { return false; } };

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const refs = [...new Set(html.match(/[A-Za-z0-9_.\/-]+\.(?:js|css)\?v=\d+/g) || [])];
if (!refs.length) { console.log('FAIL: no ?v= references found in index.html'); process.exit(1); }

let inGit = true;
try { git('rev-parse', '--git-dir'); } catch (_) { inGit = false; }
if (!inGit) { console.log('not a git checkout: cannot check'); process.exit(0); }
if (git('rev-parse', '--is-shallow-repository') === 'true') {
  console.log('shallow clone: the history is missing, cannot check (use fetch-depth 0)');
  process.exit(0);
}

let headHtml = '';
try { headHtml = git('show', 'HEAD:index.html'); } catch (_) {}
const stale = [];
for (const ref of refs) {
  const file = ref.replace(/\?v=\d+$/, '').replace(/^\.\//, '');
  if (!fs.existsSync(path.join(ROOT, file))) { stale.push(`${ref}: the file does not exist`); continue; }
  const dirty = !ok('diff', '--quiet', 'HEAD', '--', file);
  if (dirty) {
    if (headHtml.includes(ref)) stale.push(`${ref}: ${file} has uncommitted changes and the number was not raised`);
    continue;
  }
  const fileCommit = git('log', '-1', '--format=%H', '--', file);
  if (!fileCommit) continue; // not tracked yet
  if (!headHtml.includes(ref)) continue; // number raised in the working tree
  const refCommit = git('log', '-1', '--format=%H', `-S${ref}`, '--', 'index.html');
  if (!refCommit) { stale.push(`${ref}: no commit wrote this number`); continue; }
  if (fileCommit !== refCommit && !ok('merge-base', '--is-ancestor', fileCommit, refCommit)) {
    stale.push(`${ref}: ${file} changed in ${fileCommit.slice(0, 7)} after the number was set in ${refCommit.slice(0, 7)}`);
  }
}
console.log(`${refs.length} ?v= references in index.html`);
if (stale.length) {
  console.log('FAIL: raise the number for:\n  ' + stale.join('\n  '));
  process.exit(1);
}
console.log('every ?v= is newer than its file');
