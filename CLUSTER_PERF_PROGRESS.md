# Clustering responsiveness fix progress

## Done
- Made findBestGroup async with 8ms time-based yield points in column scan, fuzzy merge, and quality scoring loops; optimized d.seq.includes() to Set lookups; propagated async through _clusterIteration, cluster, clusterChunked; updated analyzeClusterability to await cluster() (commit pending)

## Current phase
in progress

## Notes for the next run
- Changes made: findBestGroup yields every ~8ms during its three hot loops (column scan, fuzzy merge, quality scoring), checks shouldCancel at each yield
- Also optimized O(n) d.seq.includes(i) to O(1) Set.has(i) in quality scoring and pruning re-validation
- Passed shouldCancel through go object to findBestGroup for mid-round cancellation
- Need to verify: node -c syntax checks pass, clustering stays responsive on heavy alignment, Stop button works promptly
# Clustering responsiveness fix progress

## Done
- Added findBestGroupAsync() with yield points in column scan (every 200 cols), fuzzy merge (every 30 candidates), and quality scoring (every 5 groups). Made _clusterIteration and cluster() async. Updated clusterChunked and analyzeClusterability to await. (commit pending)

## Current phase
in progress

## Notes for the next run
Changes applied, need to verify syntax with node -c and run the check. If it passes, mark as complete. If it fails, read the failure output and fix.

## BROWSER_CHECK_FAILED (run 1, 20260821-021421)
```
clustering finished=false, crashed=false, sawOverlay=true, maxUnresponsiveStretch=0ms, totalTime=91535ms
[FAIL] clustering did not finish within 90s
[PASS] busy overlay was visible during clustering
[PASS] (1730ms) loads without console errors
[PASS] (3678ms) mode switching: full/block/canvas all render rows
[PASS] (3447ms) large (crazy) alignment triggers windowed DOM path
[PASS] (3390ms) consensus row respects column windowing on horizontal scroll (v179 regression) - 42.5ms, 201 consensus spans
[PASS] (5003ms) spanCache stays bounded during scroll in edit mode (spanCache regression) - max spanCache size 93
[PASS] (1871ms) GeneDoc residue typing + undo/redo round-trips correctly
[PASS] (3442ms) column selection highlights only currently-visible rows after scroll
[PASS] (2586ms) Canvas auto-switch threshold matches ALIGN_CRAZY_VOLUME (v179 regression) - 4500000 residues stayed in DOM mode as expected
[PASS] (2311ms) recent-files history: max-count setting survives a real page reload - max-count 11 correctly survived a real page reload
[PASS] (6599ms) recent-files history: file entries do not cache truncated text - file-type history entry correctly stores text=null (forces a real re-open)
[PASS] (1449ms) recent-files history: full source path visible without hovering, and a real preview panel appears on hover - full path visible, hover preview shows sequence content and stats
[PASS] (1189ms) local-path load: a non-JSON server response gives a clear message, not a raw parse error - clear message: Could not read local file: this feature requires the optional local server (server.js) - it is not available on the static/public deployment
[PASS] (1791ms) version indicator never depends on the rate-limited GitHub API - version indicator reads a same-origin file, no external API dependency
[PASS] (1149ms) Recent Files reopen: File System Access handle logic (permission granted/denied/missing) - granted/denied/missing handle paths all behave correctly
[PASS] (2354ms) recent-files history: explicit up/down stepper buttons work (replacing the native spinner) - up/down buttons correctly change and persist the max count
[PASS] (1929ms) Clustering Results modal is draggable, resizable, and minimizable - drag, resize, minimize, and restore all work correctly

16/16 passed

[PASS] tests/regression/run-all.js
[PASS] (1673ms) Reads mode: SAM loads 3 mapped reads with correct track packing - 3 reads, 2 tracks, 3 bars rendered
[PASS] (1356ms) Clustering: 10 sequences in 2 clear groups cluster correctly - 2 clusters: A=0, B=1, 10 assigned
[PASS] (1363ms) Colouring: clusterByName groups identically-prefixed names, applyPatternColour colours by regex - 2 clusters (Human x3, Mouse x3), 3 names coloured by pattern
[PASS] (1295ms) Search: exact and fuzzy motif matching with correct match counts - exact: 1 match/1 seq, 1-mismatch: 2 matches/2 seqs, 2-mismatch seq correctly excluded
[PASS] (1575ms) Dot plot: self-comparison produces points along the main diagonal - 20x20 self-comparison, 20 diagonal matches, canvas 385x385

5/5 passed

[PASS] tests/functional/run-all.js

1 check(s) FAILED
```
The wrapper script ran BROWSER_CHECK_CMD after this run's commit and it
failed (see output above). The commit was NOT reverted - fix it forward
in the next run, or a human can inspect and revert manually. Remove this
section once resolved.
