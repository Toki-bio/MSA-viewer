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
All fixes from previous runs are verified in place. The crash mechanism was: pre-parse scan returned null for files with leading garbage (or BOM), causing state.alignmentIndex to be null, which made needsWindowedDom falsy, so the non-windowed DOM path was used for a 3.7M-residue alignment, creating millions of DOM nodes. Fixed by: (1) scanAlignmentText checking first 200 lines for '>' and stripping BOM, (2) scanFastaIndex skipping non-header lines, (3) parseFasta skipping non-'>' lines before first header, (4) fallback computing alignmentIndex from parsed sequences, (5) _normalizeSequenceLengths padding short sequences, (6) _checkLengthMismatch providing a clear warning. Verified all conservation/consensus/rendering code handles out-of-bounds access with `|| '-'` fallback. Verified windowed DOM renderer only creates visible blocks/rows. Verified no unbounded deferred work after parseAndRender returns.
