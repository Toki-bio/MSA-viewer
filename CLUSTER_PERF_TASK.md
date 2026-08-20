# Task: make clustering yield to the browser regularly, instead of freezing the tab

You are working alone across many separate invocations (no memory between
runs except what's in this repo). Read `CLUSTER_PERF_PROGRESS.md` first. If
it doesn't exist yet, this is the first run: create it and start.

## Context

A user asked for a "Clustering..." progress popup so they'd know the app
isn't hung during a heavy clustering run. Investigation found that this UI
already exists (`showBusy()`/`hideBusy()` in `script.js` - a real overlay
with a spinner, label, and Stop button, already wired up to
`clusterSequences()`), but it doesn't help, because the actual problem is
worse than a missing indicator: **the clustering computation blocks the
browser's main thread so completely that nothing can render, including
that existing overlay - not even the CSS spinner animation can play.**

Confirmed directly: loading a synthetic 300-sequence x 3000-column
gap-sparse alignment (900,000 residues - not even that large) and running
clustering made the page **completely unresponsive to any interaction for
84+ seconds straight**, then the tab **crashed** (Chrome's "Target crashed"
event). This is a real, reproducible performance/architecture bug, not
just a missing UI element.

**The mechanism (search for it yourself, this is a lead not gospel):**
`cluster.js` has both a synchronous `cluster()` method and an async
`clusterChunked()` method - the comment on `clusterChunked` says it "yields
between rounds, so the indicator can update and Stop can take effect," and
`script.js`'s `clusterSequences()` does call `clusterChunked()`, not the
sync version. So yielding BETWEEN rounds is intended to happen. But a
single ROUND's own work - the `findBestGroup()` / `_clusterIteration()`
call inside one round - is itself a large, unbounded, fully synchronous
scan (nested loops over every column x every available sequence, with
further nested work for fuzzy-merging and quality scoring) with no yield
points inside it at all. For a real dataset, ONE round's own work is
apparently enough to block the thread for 80+ seconds by itself - yielding
only between rounds isn't fine-grained enough.

## Your job

1. Confirm the above via your own reading of `cluster.js` (function names:
   `cluster`, `clusterChunked`, `_clusterIteration`, `findBestGroup`) -
   don't just trust this description, verify which specific loop(s) are
   the expensive, non-yielding part for a case with many sequences and many
   columns.
2. Break up the expensive per-round work so it yields to the browser
   periodically DURING a single round, not just between rounds - e.g.
   process the column scan in chunks (some number of columns per
   microtask/animation-frame slice), `await` a yield point between chunks,
   and only proceed once the browser has had a chance to paint. The exact
   granularity is your call, balance responsiveness against not making
   clustering itself dramatically slower - yielding too often (e.g. every
   single column) has real overhead too.
3. Make sure `showBusy()`'s existing spinner/label actually animates and
   the existing Stop button actually takes effect promptly during a heavy
   run, now that the thread isn't blocked continuously - this the
   observable proof the fix worked, not just "it didn't crash."
4. Confirm the tab no longer crashes and no longer goes fully unresponsive
   for extended periods on a heavy synthetic run (multiple runs' worth of
   testing this, one clean pass is not enough - performance/responsiveness
   bugs like this can vary run to run).

## How this gets tested

A Playwright check script (run by the wrapper after each commit, not by
you) loads a synthetic heavy alignment, starts clustering without waiting
for it to finish, and polls the page's responsiveness every second for up
to 90 seconds (a `page.evaluate()` ping with its own short timeout, same
technique used to find this bug in the first place) - it requires the page
to stay responsive throughout (no single unresponsive gap longer than a
few seconds) and to finish without crashing. It also reruns the full
existing regression + functional suites to catch regressions.

## Ground rules (non-negotiable, every run)

1. Only edit `cluster.js` and/or `script.js`, plus
   `CLUSTER_PERF_PROGRESS.md` for your own notes. Do not touch tests or
   other files.
2. **Commit incrementally.** If you land one real, working improvement,
   commit it right then rather than queuing everything for one commit at
   the end.
3. Run `node -c script.js` and `node -c cluster.js` yourself before
   committing, to catch syntax errors before the wrapper's own gate does.
4. **This wrapper will NOT honor a "done" claim unless this exact run's own
   check passed.** If it fails, its output is appended to
   `CLUSTER_PERF_PROGRESS.md` for you to read and fix forward next run.
5. If genuinely blocked, say so under `## BLOCKED` in
   `CLUSTER_PERF_PROGRESS.md`, commit, and stop.

## CLUSTER_PERF_PROGRESS.md format

```markdown
# Clustering responsiveness fix progress

## Done
- <one-line summary per run> (commit <hash>)

## Current phase
<in progress / blocked / All phases complete>

## Notes for the next run
<what you found, what you fixed, what's left>
```

## When done

Once clustering on a heavy alignment stays responsive (spinner keeps
animating, Stop button works promptly) and doesn't crash, the check passes
reliably (not just once), and the full test suites still pass, mark
"Current phase" as "All phases complete" and stop.
