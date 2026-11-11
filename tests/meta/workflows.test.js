// The public site must wait for the tests: .github/workflows/pages.yml deploys only after the Tests
// workflow has passed for a push to main (audit 2026-11-10, T2; the owner chose "wait for the tests").
// What used to go wrong: pages.yml ran on every push to main, beside the tests, so a commit that failed
// its tests was on the public site about an hour before the failure showed.
//
//   node tests/meta/workflows.test.js
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
// a Windows checkout has CRLF line ends (core.autocrlf); the line patterns below expect LF
const read = f => fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8').replace(/\r\n/g, '\n');
// comments say what the file used to do: judge the YAML without them
const noComments = s => s.split('\n').map(l => l.replace(/(^|\s)#.*$/, '')).join('\n');
const pages = noComments(read('pages.yml'));
const tests = noComments(read('tests.yml'));
const testsName = (tests.match(/^name:\s*(.+)$/m) || [])[1];
const onBlock = (pages.match(/^on:\n((?:[ \t]+.*\n|\n)+)/m) || [])[1] || '';

const problems = [];
if (/^\s+push:/m.test(onBlock)) problems.push('pages.yml still deploys on a push, without waiting for the tests');
if (!/^\s+workflow_run:/m.test(onBlock)) problems.push('pages.yml is not started by the end of a workflow run');
const named = (onBlock.match(/workflows:\s*\[([^\]]*)\]/) || [])[1];
if (!named || !testsName || named.trim().replace(/^["']|["']$/g, '') !== testsName.trim())
  problems.push(`pages.yml waits for "${named}" but tests.yml is named "${testsName}"`);
if (!/branches:\s*\[main\]/.test(onBlock)) problems.push('the workflow_run trigger is not limited to main');
if (!/workflow_run\.conclusion\s*==\s*'success'/.test(pages)) problems.push('the deploy job does not require the test run to have passed');
if (!/ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha/.test(pages)) problems.push('the deploy does not check out the commit that was tested');
if (!/^\s+push:/m.test(tests)) problems.push('tests.yml does not run on a push, so nothing would ever deploy');

if (problems.length) {
  console.error('FAIL\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`pages.yml deploys only after "${testsName}" has passed on main`);
