# ViewAlign: rules for every Claude session

ViewAlign is built and maintained across many separate Claude sessions. A session does not
know what earlier sessions fixed. Fixes were lost because they had no test, so a later change
undid them without anyone noticing. These rules exist to stop that.

## Fixing a bug

1. Write a regression check first: a real user-path interaction (real mouse/keyboard events
   where possible) in `tests/regression/run-all.js`, or the suite that fits. Run it and see it
   FAIL on the current code.
2. Fix the bug. See the check PASS.
3. Comment the check with what used to go wrong, so the next session knows why it exists.

A fix without a check is not done.

## Never weaken a test without asking the user

Do not change what an existing check expects, loosen its thresholds, skip it or delete it to
make your change pass. A failing check means you broke something: find what. If you believe
the expected behaviour itself should change, stop and ask the user first, and say which check.
(Example of the damage: a check was written to require the consensus row to show column
selection; the user considers that a bug.)

## Before every push

- Run the regression suite: `node tests/regression/run-all.js` (one check:
  `CHECK_FILTER="part of name" node tests/regression/run-all.js`).
- For changes outside small UI fixes, run everything: `node tests/run-all.js --quick`.
- Push only when they pass. Report failures honestly.

## Laptop sleep and interrupted runs

- A check that FAILED while the machine slept (a wall-clock gap above 30 s, `SLEEP_GAP_MS`) is rerun in a
  fresh browser, at most 2 times; the rerun must pass by itself. The log shows `[RETRY] <name>: the machine
  slept N s ...` and the final count line says how many were retried. Passes and failures without a sleep
  gap are never rerun. The span is the whole attempt (browser launch, page load, check, close): the log says
  `slept N s during this attempt`, and a check that failed with the browser failing to launch counts as a failed
  attempt (retried if the machine slept, else FAIL; the run continues). The failed attempt's detail and duration are
  printed in the `[RETRY]` line, and a pass after a rerun is labelled `[PASS after retry]`. `SLEEP_WATCH_TEST_GAP`
  injects a FAKE gap (loud `[WARN]`, marked count line, no passes recorded for resume). The suite time limit in `tests/run-all.js` does not count sleep (regression: 2 h).
- A `CHECK_FILTER` that matches no check is not a pass: the runner prints `no check matched CHECK_FILTER` and exits 1
  (alone or with `--only`); under a full `tests/run-all.js` the suite shows as `no match` (neither pass nor fail),
  and if nothing matched in any suite the whole run exits 1.
- `node tests/run-all.js --resume` continues an interrupted run: suites and regression checks that passed on
  the SAME commit are skipped; failed and unfinished ones run again. A different commit or uncommitted edits
  to tracked files means a fresh start (it says so). The summary says "resumed: N suites, M checks passed
  earlier". Progress file: `viewalign-test-progress-*.jsonl` in the OS temp dir. Without `--resume` a run
  starts fresh. Code: `tests/lib/sleep-watch.js`, `retry-on-sleep.js`, `resume.js`.

## Rewrites

Large alignments use a different renderer (windowed: `renderUnifiedWindowedDom`,
`_refreshUnifiedWindowOnScroll`, `_buildUnifiedBlock`, `_incrementalUpdateBlockRows`) from small
ones (full DOM), and Canvas mode is a third. A behaviour fixed in one path is often missing from
the others. When you change or rewrite a rendering, selection, scrolling or editing path:
- test the behaviour in Full, Block and Canvas modes, with a small alignment and one above
  `ALIGN_WINDOWED_DOM_THRESHOLD` (e.g. `loadSyntheticFasta(page, 1500, 4000)`);
- read `git log -S` for the functions you touch and keep the earlier fixes.

## Practical notes

- Headless Chrome hides scrollbars and is Linux: Windows-only behaviour (scrollbar thumb
  snap-back, fonts such as Times New Roman/Segoe UI, 1x pixel rounding) will not show. Reason
  about it and test what you can (e.g. whole-pixel positions, drags that stray off a control).
- `state` is a top-level `const` in script.js: in tests use `typeof state !== 'undefined'`,
  not `window.state`.
- Bump the cache-busting `?v=` in index.html for script.js/styles.css when you change them.
- The version must agree in package.json, `RELEASE_VERSION` in script.js (and CITATION.cff /
  .zenodo.json if present); `tests/meta/version.test.js` checks it.
- The public site deploys from `main` (.github/workflows/pages.yml); tests run on every push
  (.github/workflows/tests.yml).
