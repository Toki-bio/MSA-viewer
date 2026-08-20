# Crash-fix progress

## Done
- Fixed parseFasta leading-garbage bug: moved `seq = ''` outside `if (header)` block so non-header lines before the first `>` are discarded
- Confirmed _computeConsensusCharForColumn already uses `s[pos]` (was already correct in current file)
- Added _checkLengthMismatch and _normalizeSequenceLengths helper functions
- Added length-mismatch warning in parseAndRender (warns but does not block loading)
- Added length normalization after parsing (pads short sequences with gaps to prevent downstream crashes)

## Current phase
in progress

## Notes for the next run
All 4 fixes applied and committed (hash a014012). The normalization is the key crash fix - padding short sequences to uniform length prevents any downstream code from encountering undefined positions. Waiting for check results to confirm the real file loads without crashing, the warning appears, and all tests pass.

## BROWSER_CHECK_FAILED (run 2, 20260820-233443)
```
[PASS] real repro file load: completed in 6733ms
[FAIL] post-load check failed (page crashed or became unresponsive): evaluate timed out - page likely unresponsive
[PASS] (1750ms) loads without console errors
[PASS] (3673ms) mode switching: full/block/canvas all render rows
[PASS] (3310ms) large (crazy) alignment triggers windowed DOM path
[PASS] (3465ms) consensus row respects column windowing on horizontal scroll (v179 regression) - 58.5ms, 201 consensus spans
[PASS] (5365ms) spanCache stays bounded during scroll in edit mode (spanCache regression) - max spanCache size 93
[PASS] (1912ms) GeneDoc residue typing + undo/redo round-trips correctly
[PASS] (3377ms) column selection highlights only currently-visible rows after scroll
[PASS] (2429ms) Canvas auto-switch threshold matches ALIGN_CRAZY_VOLUME (v179 regression) - 4500000 residues stayed in DOM mode as expected
[PASS] (2371ms) recent-files history: max-count setting survives a real page reload - max-count 11 correctly survived a real page reload
[PASS] (7006ms) recent-files history: file entries do not cache truncated text - file-type history entry correctly stores text=null (forces a real re-open)
[PASS] (1494ms) recent-files history: full source path visible without hovering, and a real preview panel appears on hover - full path visible, hover preview shows sequence content and stats
[PASS] (1183ms) local-path load: a non-JSON server response gives a clear message, not a raw parse error - clear message: Could not read local file: this feature requires the optional local server (server.js) - it is not available on the static/public deployment
[PASS] (1736ms) version indicator never depends on the rate-limited GitHub API - version indicator reads a same-origin file, no external API dependency
[PASS] (1114ms) Recent Files reopen: File System Access handle logic (permission granted/denied/missing) - granted/denied/missing handle paths all behave correctly
[PASS] (2417ms) recent-files history: explicit up/down stepper buttons work (replacing the native spinner) - up/down buttons correctly change and persist the max count

15/15 passed

[PASS] tests/regression/run-all.js
[PASS] (1655ms) Reads mode: SAM loads 3 mapped reads with correct track packing - 3 reads, 2 tracks, 3 bars rendered
[PASS] (1366ms) Clustering: 10 sequences in 2 clear groups cluster correctly - 2 clusters: A=0, B=1, 10 assigned
[PASS] (1279ms) Colouring: clusterByName groups identically-prefixed names, applyPatternColour colours by regex - 2 clusters (Human x3, Mouse x3), 3 names coloured by pattern
[PASS] (1279ms) Search: exact and fuzzy motif matching with correct match counts - exact: 1 match/1 seq, 1-mismatch: 2 matches/2 seqs, 2-mismatch seq correctly excluded
[PASS] (1522ms) Dot plot: self-comparison produces points along the main diagonal - 20x20 self-comparison, 20 diagonal matches, canvas 385x385

5/5 passed

[PASS] tests/functional/run-all.js

1 check(s) FAILED
```
The wrapper script ran BROWSER_CHECK_CMD after this run's commit and it
failed (see output above). The commit was NOT reverted - fix it forward
in the next run, or a human can inspect and revert manually. Remove this
section once resolved.
