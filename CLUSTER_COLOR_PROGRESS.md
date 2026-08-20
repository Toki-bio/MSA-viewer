
## BROWSER_CHECK_FAILED (run 2, 20260821-011300)
```
[PASS] captured colours for all 10 sequences before reorder
[PASS] all 10 sequences kept their own colour after reordering
[PASS] (1641ms) loads without console errors
[PASS] (3661ms) mode switching: full/block/canvas all render rows
[PASS] (3131ms) large (crazy) alignment triggers windowed DOM path
[PASS] (3436ms) consensus row respects column windowing on horizontal scroll (v179 regression) - 48.0ms, 201 consensus spans
[PASS] (5706ms) spanCache stays bounded during scroll in edit mode (spanCache regression) - max spanCache size 93
[PASS] (1930ms) GeneDoc residue typing + undo/redo round-trips correctly
[PASS] (3702ms) column selection highlights only currently-visible rows after scroll
[PASS] (2523ms) Canvas auto-switch threshold matches ALIGN_CRAZY_VOLUME (v179 regression) - 4500000 residues stayed in DOM mode as expected
[PASS] (2298ms) recent-files history: max-count setting survives a real page reload - max-count 11 correctly survived a real page reload
[PASS] (7881ms) recent-files history: file entries do not cache truncated text - file-type history entry correctly stores text=null (forces a real re-open)
[PASS] (1600ms) recent-files history: full source path visible without hovering, and a real preview panel appears on hover - full path visible, hover preview shows sequence content and stats
[PASS] (1206ms) local-path load: a non-JSON server response gives a clear message, not a raw parse error - clear message: Could not read local file: this feature requires the optional local server (server.js) - it is not available on the static/public deployment
[PASS] (1740ms) version indicator never depends on the rate-limited GitHub API - version indicator reads a same-origin file, no external API dependency
[PASS] (1154ms) Recent Files reopen: File System Access handle logic (permission granted/denied/missing) - granted/denied/missing handle paths all behave correctly
[PASS] (2424ms) recent-files history: explicit up/down stepper buttons work (replacing the native spinner) - up/down buttons correctly change and persist the max count
[PASS] (1803ms) Clustering Results modal is draggable, resizable, and minimizable - drag, resize, minimize, and restore all work correctly

16/16 passed

[PASS] tests/regression/run-all.js
[PASS] (1650ms) Reads mode: SAM loads 3 mapped reads with correct track packing - 3 reads, 2 tracks, 3 bars rendered
[FAIL] (1382ms) Clustering: 10 sequences in 2 clear groups cluster correctly - some group A sequences unassigned: [null,null,null,null,null]
[PASS] (1334ms) Colouring: clusterByName groups identically-prefixed names, applyPatternColour colours by regex - 2 clusters (Human x3, Mouse x3), 3 names coloured by pattern
[PASS] (1325ms) Search: exact and fuzzy motif matching with correct match counts - exact: 1 match/1 seq, 1-mismatch: 2 matches/2 seqs, 2-mismatch seq correctly excluded
[PASS] (1624ms) Dot plot: self-comparison produces points along the main diagonal - 20x20 self-comparison, 20 diagonal matches, canvas 385x385

4/5 passed

[FAIL] tests/functional/run-all.js did not pass

1 check(s) FAILED
```
The wrapper script ran BROWSER_CHECK_CMD after this run's commit and it
failed (see output above). The commit was NOT reverted - fix it forward
in the next run, or a human can inspect and revert manually. Remove this
section once resolved.
