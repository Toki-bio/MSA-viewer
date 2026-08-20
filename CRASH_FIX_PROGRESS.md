# Crash-fix progress

## Done
- (none yet)

## Current phase
in progress

## Notes for the next run
First run. Need to find the crash mechanism in the deferred rendering pipeline.
# Crash-fix progress

## Done
- Fixed parseFasta leading-garbage bug: moved `seq = ''` outside `if (header)` block so non-header lines before the first `>` are discarded
- Fixed _computeConsensusCharForColumn bug: changed `s.seq[pos]` to `s[pos]` (seqArray is strings, not objects)
- Added _checkLengthMismatch and _normalizeSequenceLengths helper functions
- Added length-mismatch warning in parseAndRender (warns but does not block loading)
- Added length normalization after parsing (pads short sequences with gaps to prevent downstream crashes)

## Current phase
in progress

## Notes for the next run
Applied 4 fixes: (1) parseFasta leading-garbage, (2) _computeConsensusCharForColumn string access bug, (3) length-mismatch warning, (4) length normalization. The normalization is the key crash fix - padding short sequences to uniform length prevents any downstream code from encountering undefined positions. Need to verify the check passes.
