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
Previous fixes (parseFasta leading-garbage, length-mismatch warning, alignmentIndex fallback, length normalization) are all verified in place. The crash STILL happens because renderAlignment() gates the windowed-DOM path on `state.alignmentIndex?.needsWindowedDom`, which can be false/null if the pre-parse scan returned incorrect values or if state.alignmentIndex was not properly set. The non-windowed path then creates ~4M DOM spans synchronously for a 3.7M-residue alignment, crashing the tab.

Fix applied this run: compute `_needsWindowed` DIRECTLY from `TOTAL_RESIDUES > ALIGN_WINDOWED_DOM_THRESHOLD` in renderAlignment(), independent of state.alignmentIndex. Store in `state._needsWindowedDom` for the scroll controller. Added safety net in the non-windowed path to show a message instead of creating millions of nodes if the threshold is exceeded.

Key insight: TOTAL_RESIDUES is already computed in renderAlignment() as `state.seqs.length * len` where `len = Math.max(...state.seqs.map(s => s.seq.length))`. This is the authoritative measure of alignment size, computed from the actual parsed sequences, not from a pre-parse scan that might fail or return wrong values.
