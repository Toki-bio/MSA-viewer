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
Root cause of the crash identified: the pre-parse scan (scanAlignmentText) returns null when the file has leading garbage (e.g., MAFFT version banner) before the first '>' header. This leaves state.alignmentIndex null, so state.alignmentIndex?.needsWindowedDom is undefined (falsy), and the non-windowed DOM path is used instead of the windowed one. For a 1919x1920 alignment (~3.7M residues), the non-windowed path creates one <span> per residue - millions of DOM nodes - which crashes the browser tab during interaction.

Four fixes applied this run:
1. scanAlignmentText: now checks first 200 lines for a '>' header, not just the first line/char
2. scanFastaIndex: now skips non-header lines before the first '>' (seenHeader flag)
3. parseFasta: changed `else` to `else if (header)` so non-'>' lines before first header are skipped entirely, not accumulated-then-discarded
4. parseAndRender: added fallback to compute state.alignmentIndex from parsed sequences if pre-parse scan failed, ensuring windowed DOM kicks in

Previous fixes from run 1 (still in place): parseFasta seq='' reset, _checkLengthMismatch, _normalizeSequenceLengths, length-mismatch warning.
