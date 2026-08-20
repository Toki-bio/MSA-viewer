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
