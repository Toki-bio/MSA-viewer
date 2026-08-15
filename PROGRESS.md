# Reads-pile progress

## Done
- Phase 0: extracted track-packing logic into reusable `assignReadTracks()` function

## Current phase
Phase 1 (not started)

## Notes for the next run
- `assignReadTracks(reads)` is defined just before `renderCompactAlignment()` in script.js.
  It sorts reads in place by `start`, sets `read.track` on each, and returns the track count.
- The live Reads-mode data is in `bamState` (reads array with CIGAR-derived `columns` per read).
  Each read has `.pos` (0-based genomic start) and `.cigar` (array of {len, op}).
  Use `computeReadSpan(read.cigar)` to get the reference span, then `.start = read.pos` and
  `.end = read.pos + span - 1` for the packer.
- `renderCompactAlignment()` now calls `assignReadTracks(reads)` instead of inline packing.
- The old dead mode (`renderCompactAlignment`) is wired to `modeCompact` radio, which has
  no visible radio button in the page — it's unreachable from the UI.
- `renderReadsAlignment()` is the current live per-row renderer that loops over
  `bamState.reads` and builds one DOM row per read. It will be replaced in Phase 2.
