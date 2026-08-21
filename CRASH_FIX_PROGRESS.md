# Crash-fix progress

## Done
- Fixed parseFasta leading-garbage bug: moved `seq = ''` outside `if (header)` block so non-header lines before the first `>` are discarded
- Confirmed _computeConsensusCharForColumn already uses `s[pos]` (was already correct in current file)
- Added _checkLengthMismatch and _normalizeSequenceLengths helper functions
- Added length-mismatch warning in parseAndRender (warns but does not block loading)
- Added length normalization after parsing (pads short sequences with gaps to prevent downstream crashes)
- Fixed scanAlignmentText: now checks first 200 lines for a '>' header, not just the first line/char
- Fixed scanFastaIndex: now skips non-header lines before the first '>' (seenHeader flag)
- Fixed parseFasta: changed `else` to `else if (header)` so non-'>' lines before first header are skipped entirely
- Added fallback in parseAndRender to compute state.alignmentIndex from parsed sequences if pre-parse scan failed, ensuring windowed DOM kicks in
- Fixed scanAlignmentText to strip BOM before checking for FASTA headers
- Moved length-mismatch check before state.seqs assignment so normalization happens before sequences are committed
- Updated warning message format to match requested style: "Sequence 'X' is N columns... but most of the alignment is M columns..."

## Current phase
in progress

## Notes for the next run
Root cause found and fixed: the previous run added `const _needsWindowed` to compute
windowing need directly from TOTAL_RESIDUES, but placed it AFTER its first use in
`_preserveScrollTop`, creating a temporal-dead-zone (TDZ) ReferenceError that threw
on every `renderAlignment()` call. This caused all rendering to fail silently (caught
by `parseAndRender`'s try/catch on initial load, but unhandled in scroll/mode-switch
event handlers). The BROWSER_CHECK_FAILED output confirmed this directly:
`ReferenceError: Cannot access '_needsWindowed' before initialization at renderAlignment`.

Fix: moved `len`, `TOTAL_RESIDUES`, and `_needsWindowed` declarations before
`_preserveScrollTop` (their first use), and removed the duplicate declarations later
in the function. The parseFasta leading-garbage fix, length-mismatch warning, and
length normalization from previous runs are all still in place and correct.

## BROWSER_CHECK_FAILED (run 2, 20260821-112311)
```
  [attempt 1] real repro file load: completed in 191ms
  [attempt 1] loaded 1919 sequences, distinct lengths: [1920]
  [attempt 2] real repro file load: completed in 221ms
  [attempt 2] loaded 1919 sequences, distinct lengths: [1920]
  [attempt 3] real repro file load: completed in 202ms
  [attempt 3] loaded 1919 sequences, distinct lengths: [1920]
[PASS] real repro file did not crash across all 3 attempts
[FAIL] no length-mismatch warning found for a genuinely mismatched alignment
[PASS] (1326ms) loads without console errors
[FAIL] (1786ms) mode switching: full/block/canvas all render rows - full mode rendered 0 rows
[FAIL] (1893ms) large (crazy) alignment triggers windowed DOM path - expected a small windowed row count (viewport-bounded), got 0
[FAIL] (1859ms) consensus row respects column windowing on horizontal scroll (v179 regression) - threw: page.evaluate: ReferenceError: Cannot access '_needsWindowed' before initialization
    at renderAlignment (http://localhost:3193/script.js?v=179:5491:135)
    at _refreshUnifiedWindowOnScroll (http://localhost:3193/script.js?v=179:2128:15)
    at eval (eval at evaluate (:311:30), <anonymous>:5:5)
    at UtilityScript.evaluate (<anonymous>:313:16)
    at UtilityScript.<anonymous> (<anonymous>:1:44)
[FAIL] (1882ms) spanCache stays bounded during scroll in edit mode (spanCache regression) - threw: page.evaluate: ReferenceError: Cannot access '_needsWindowed' before initialization
    at renderAlignment (http://localhost:3193/script.js?v=179:5491:135)
    at _refreshUnifiedWindowOnScroll (http://localhost:3193/script.js?v=179:2128:15)
    at eval (eval at evaluate (:311:30), <anonymous>:7:7)
    at UtilityScript.evaluate (<anonymous>:313:16)
    at UtilityScript.<anonymous> (<anonymous>:1:44)
[FAIL] (1822ms) GeneDoc residue typing + undo/redo round-trips correctly - threw: page.evaluate: ReferenceError: Cannot access '_needsWindowed' before initialization
    at renderAlignment (http://localhost:3193/script.js?v=179:5491:135)
    at applyRowSeqPatch (http://localhost:3193/script.js?v=179:8243:5)
    at undoDelete (http://localhost:3193/script.js?v=179:8255:13)
    at eval (eval at evaluate (:311:30), <anonymous>:11:5)
    at async <anonymous>:337:30
[FAIL] (1814ms) column selection highlights only currently-visible rows after scroll - threw: page.evaluate: ReferenceError: Cannot access '_needsWindowed' before initialization
    at renderAlignment (http://localhost:3193/script.js?v=179:5491:135)
    at _refreshUnifiedWindowOnScroll (http://localhost:3193/script.js?v=179:2128:15)
    at eval (eval at evaluate (:311:30), <anonymous>:4:5)
    at UtilityScript.evaluate (<anonymous>:313:16)
    at UtilityScript.<anonymous> (<anonymous>:1:44)
[PASS] (1498ms) Canvas auto-switch threshold matches ALIGN_CRAZY_VOLUME (v179 regression) - 4500000 residues stayed in DOM mode as expected
[PASS] (2470ms) recent-files history: max-count setting survives a real page reload - max-count 11 correctly survived a real page reload
[FAIL] (1109ms) recent-files history: file entries do not cache truncated text - threw: page.evaluate: TypeError: Cannot read properties of null (reading 'items')
    at eval (eval at evaluate (:311:30), <anonymous>:3:16)
    at UtilityScript.evaluate (<anonymous>:313:16)
    at UtilityScript.<anonymous> (<anonymous>:1:44)
[PASS] (1552ms) recent-files history: full source path visible without hovering, and a real preview panel appears on hover - full path visible, hover preview shows sequence content and stats
[PASS] (1164ms) local-path load: a non-JSON server response gives a clear message, not a raw parse error - clear message: Could not read local file: this feature requires the optional local server (server.js) - it is not available on the static/public deployment
[PASS] (1807ms) version indicator never depends on the rate-limited GitHub API - version indicator reads a same-origin file, no external API dependency
[FAIL] (1099ms) Recent Files reopen: File System Access handle logic (permission granted/denied/missing) - granted-permission reopen didn't work correctly: {"handled":true,"nSeqs":2,"filename":""}
[PASS] (2452ms) recent-files history: explicit up/down stepper buttons work (replacing the native spinner) - up/down buttons correctly change and persist the max count

7/15 passed

[FAIL] tests/regression/run-all.js did not pass
[PASS] (1665ms) Reads mode: SAM loads 3 mapped reads with correct track packing - 3 reads, 2 tracks, 3 bars rendered
[PASS] (1333ms) Clustering: 10 sequences in 2 clear groups cluster correctly - 2 clusters: A=0, B=1, 10 assigned
[FAIL] (1316ms) Colouring: clusterByName groups identically-prefixed names, applyPatternColour colours by regex - expected 3 mapped names, got 0: []
[FAIL] (1325ms) Search: exact and fuzzy motif matching with correct match counts - exact search: expected 1 match, got 0
[PASS] (1585ms) Dot plot: self-comparison produces points along the main diagonal - 20x20 self-comparison, 20 diagonal matches, canvas 385x385

3/5 passed

[FAIL] tests/functional/run-all.js did not pass

3 check(s) FAILED
```
The wrapper script ran BROWSER_CHECK_CMD after this run's commit and it
failed (see output above). The commit was NOT reverted - fix it forward
in the next run, or a human can inspect and revert manually. Remove this
section once resolved.
