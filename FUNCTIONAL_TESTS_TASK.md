# Task: write real functional tests for untested feature areas

You are working alone across many separate invocations (no memory between
runs except what's in this repo). Read `FUNCTIONAL_TESTS_PROGRESS.md` first.
If it doesn't exist yet, this is the first run: create it and start.

## Context

This is a browser-based MSA (multiple sequence alignment) viewer/editor
being prepared for a bioinformatics publication. An earlier audit verified
that the *documentation* describing several features (clustering, name
colouring, search, dot plot, Reads mode) accurately matches the *code*, but
that is NOT the same as verifying the features actually WORK correctly at
runtime - nobody has ever exercised these features in a real browser and
checked their output is correct. That's your job now: write real functional
tests (using Playwright via `playwright-core`, headless Chrome), each one
loading realistic synthetic data, exercising the real feature through the
real UI/function call path, and asserting the actual output is correct -
not just "didn't crash."

## Real entry points (confirmed present in the current codebase - verify
current line numbers/signatures yourself, don't trust these blindly, they
may have shifted)

- **Reads mode**: `renderReadsAlignment()`, `assignReadTracks(reads)`. UI
  radio `#modeReads`. Needs a SAM-format alignment loaded (reads mapped
  against a reference) to have meaningful content to render.
- **Clustering**: `clusterSequences()` (wired to `#clusterNowButton`). Needs
  `#clusterMinSizeInput`, `#clusterMinPerfectInput`,
  `#clusterMaxIterationsInput` set, then triggers SINEClusterer. Results
  likely land in `state` somewhere - find out where by reading the function.
- **Colouring**: `clusterByName(seqNames, maxChars, threshold)` (auto-colour
  by name similarity), `applyPatternColour()` (regex-based), both eventually
  write into a colour-tracking structure in `state` - find the exact field
  by reading the code.
- **Search**: `searchMotif()` (triggered by Enter in `#searchInput`).
  `findMatchesWithMismatches(degapped, motif, maxMismatches)` is the
  matching primitive it likely calls into.
- **Dot plot**: `openDotPlot(seqA, seqB, nameA, nameB, meta)`.

## Your job

Pick ONE feature area per run (see the ordered list below), write ONE new
test into `tests/functional/run-all.js` (create this file on your first
run touching it, following the exact same structure/conventions as the
existing `tests/regression/run-all.js` in this repo - read that file first
for the pattern: a `check(name, async (page) => {...})` helper, a `CASES`
loop, PASS/FAIL console output, process.exit(0/1)). Each test must:

1. Load realistic synthetic data via the real UI path (`fastaInput` +
   `parseAndRender`, or SAM text for Reads mode - construct a small,
   deterministic, hand-computable test case where you know what the
   CORRECT output should be before running it).
2. Trigger the real feature through its real UI/function entry point (not
   by reaching into internals to fake success).
3. Assert something SPECIFIC and CORRECT about the output - e.g. for
   clustering: "these 3 sequences with the exact same diagnostic mutation
   should end up in the same cluster, this 1 divergent sequence should
   not"; for colouring: "these 2 identically-prefixed names get the same
   colour, this differently-prefixed name gets a different one"; for
   search: "a motif with 1 allowed mismatch matches this near-identical
   sequence but not this 2-mismatch one"; for dot plot: "a self-comparison
   of a sequence against itself produces points along the main diagonal";
   for Reads mode: "loading N mapped reads against a reference renders N
   read elements, not 0 and not a crash."
4. If a test reveals the feature is actually BROKEN (not just untested),
   say so clearly in `FUNCTIONAL_TESTS_PROGRESS.md` under a
   `## Bugs found` section with the exact failing assertion and what you
   observed vs. expected - do NOT fix `script.js` to make your own test
   pass without being certain the bug is in the test's understanding vs.
   a real code bug requiring a human decision. If you're confident it's a
   real bug and the fix is small/obvious, you may fix it, but state your
   reasoning explicitly.

Order: Reads mode, Clustering, Colouring, Search, Dot plot.

## Ground rules (non-negotiable, every run)

1. One feature area per run. Write real, specific assertions - "the alignment
   loaded without error" is not a functional test of clustering/colouring/
   search/dot-plot, it's just a smoke test (which tests/regression already
   has). Your job is behavior-correctness, not just crash-prevention.
2. Read `tests/regression/run-all.js` and `tests/lib/browser.js` FIRST (in
   whichever run you first touch `tests/functional/`) to match existing
   conventions - reuse `loadFasta`/`loadSyntheticFasta`/`setMode` from
   `tests/lib/browser.js` rather than reimplementing page-loading logic.
3. **Only edit `tests/functional/run-all.js` and
   `FUNCTIONAL_TESTS_PROGRESS.md`** (and `script.js` ONLY if you find and
   fix a real, small, confidently-diagnosed bug - state your reasoning
   explicitly if you do). Do not reference any other filename in this repo,
   for any reason, in your reply - any exact filename that appears anywhere
   in this conversation, even inside a sentence telling you NOT to touch
   it, gets silently auto-added to your context by the tool running you.
4. Commit at the end of every run with `git add -A && git commit -m "..."` -
   specific, naming which feature area's test was added. Never `--amend`.
5. **This wrapper will NOT honor a "done" claim unless this exact run's own
   check passed.** The check runs your new `tests/functional/run-all.js`
   directly and requires it to execute without crashing (individual test
   assertions failing is fine to report honestly - a crashed test *runner*
   is not).
6. Context budget is tight (script.js is large) - don't quote large chunks
   of files back at yourself while reasoning; keep responses focused on
   writing the actual test code.
7. If genuinely blocked, say so plainly under `## BLOCKED`, commit, and stop.

## FUNCTIONAL_TESTS_PROGRESS.md format

```markdown
# Functional tests progress

## Done
- <one-line summary per run, naming which feature area> (commit <hash>)

## Current phase
<in progress / blocked / All phases complete>

## Bugs found
<list, one per real bug found - what's broken, expected vs actual, whether fixed>

## Notes for the next run
<anything not obvious from the code>
```

## When all phases are done

Once all 5 feature areas have a real functional test in
`tests/functional/run-all.js` AND this run's own check passes, mark
"Current phase" as "All phases complete" and stop.
