# Task: fix cluster colours/highlights breaking when sequences are reordered after clustering

You are working alone across many separate invocations (no memory between
runs except what's in this repo). Read `CLUSTER_COLOR_PROGRESS.md` first. If
it doesn't exist yet, this is the first run: create it and start.

## Context

A real user reported that after running clustering, dragging a sequence to
reorder its row causes cluster colours to end up on the wrong sequences.
This is confirmed, root-caused, and reproduced against real data - trust
this diagnosis, don't re-derive it.

**Root cause:** `state.clusterMap` in `script.js` is a plain object keyed by
row INDEX (position in `state.seqs` at the moment clustering ran), not by
sequence identity. Three places write it this way (search for
`state.clusterMap[` to find them - one uses `state.clusterMap[i]` in a
guide-tree-grouping function, two use `state.clusterMap[seq.index]` in the
main clustering-results handler, one for assigned sequences and one for
unassigned). The consumer, `applyClusterVisualsFromState()` (search for that
function name), reads `nameEl.dataset.seqIndex` - the row's CURRENT
position at render time - and looks up `state.clusterMap[seqIdx]` using
that current position as the key. Reordering rows (drag-and-drop, sort,
guide-tree reorder - anything that changes the order of `state.seqs`)
changes what sequence sits at a given row index, but `clusterMap`'s keys
don't move with it - so after a reorder, row N shows whatever colour was
assigned to row N at clustering time, regardless of which sequence is
actually there now.

There is a second, separate consumer with the exact same bug:
`highlightDiagnosticMutations()` (search for that function name) builds
`seqIndices: new Set(cluster.sequences.map(s => s.index))` - also raw
indices captured at clustering time, used to decide which rows get
diagnostic-feature highlight boxes drawn. Same staleness, same fix needed.

**The proven-correct pattern to copy:** this codebase already has a
SEPARATE, correctly-implemented colour system that does NOT have this bug -
manual/name-based sequence colouring, which uses `colourState.mappings`, a
`Map` keyed by `seq.header` (the sequence's actual name/identity), not row
index. Search for `colourState.mappings` to see this pattern - notice it
survives reordering correctly because sequence identity doesn't change when
row position does. Make `clusterMap` (and the diagnostic-mutation highlight
lookup) follow the same identity-based approach instead of index-based.

## Your job

1. Convert `state.clusterMap` from index-keyed (`clusterMap[i]`) to
   identity-keyed (e.g. `clusterMap` keyed by `seq.header`, or attach the
   cluster assignment directly as a property on each sequence object in
   `state.seqs` - either approach is fine, pick whichever fits the existing
   code shape best with the smallest diff). Update all 3 write sites and
   the `applyClusterVisualsFromState()` read site to match.
2. Fix `highlightDiagnosticMutations()`'s `seqIndices` the same way - it
   needs to resolve to whichever row CURRENTLY holds each cluster member's
   sequence, not the row it was at when clustering ran.
3. Search the file for any OTHER place that reads `cluster.sequences[].index`
   or similar clustering-time-captured indices and assumes `state.seqs`
   hasn't been reordered since - fix anything else you find with the same
   flaw, using the same identity-based approach.
4. Make sure the fix survives ALL the ways `state.seqs` can be reordered in
   this app, not just drag-and-drop - search for other functions that
   reorder/splice/sort `state.seqs` (there's a "sort by 3 criteria" feature
   and a guide-tree reorder feature mentioned in the app's own manuscript -
   find their actual function names in the code) and confirm cluster
   colours/highlights survive those too, not just manual dragging.

## How this gets tested

A Playwright check script (run by the wrapper after each commit, not by
you) clusters a small synthetic alignment, records which sequence has
which colour, reorders sequences via the app's own drag-reorder function,
and confirms each sequence KEEPS its own colour (follows its identity, not
its old row position). It also reruns the full existing regression +
functional test suites to catch any regressions.

## Ground rules (non-negotiable, every run)

1. Only edit `script.js`, plus `CLUSTER_COLOR_PROGRESS.md` for your own
   notes. Do not touch tests or other files.
2. **Commit incrementally.** If you land one real, working piece of the fix
   (e.g., just the write-side conversion, or just one consumer fixed),
   commit it right then rather than queuing everything for one commit at
   the end - a run that gets cut off should keep whatever's already done.
3. Run `node -c script.js` yourself before committing, to catch syntax
   errors before the wrapper's own gate does.
4. **This wrapper will NOT honor a "done" claim unless this exact run's own
   check passed.** If it fails, its output is appended to
   `CLUSTER_COLOR_PROGRESS.md` for you to read and fix forward next run.
5. If genuinely blocked, say so under `## BLOCKED` in
   `CLUSTER_COLOR_PROGRESS.md`, commit, and stop.

## CLUSTER_COLOR_PROGRESS.md format

```markdown
# Cluster-color-reorder fix progress

## Done
- <one-line summary per run> (commit <hash>)

## Current phase
<in progress / blocked / All phases complete>

## Notes for the next run
<what you found, what you fixed, what's left>
```

## When done

Once cluster colours and diagnostic-feature highlights correctly follow
sequence identity through every kind of reorder in the app, the check
passes, and the full test suites still pass, mark "Current phase" as "All
phases complete" and stop.
