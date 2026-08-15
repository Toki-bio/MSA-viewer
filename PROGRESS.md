# Reads-pile progress

## Done
- Phase 0: extracted track-packing logic into reusable `assignReadTracks()` function
- Phase 1: compute per-read genomic start/end and assign packed tracks in handleBamFile

## Current phase
Phase 2 (not started)

## Notes for the next run
- `assignReadTracks(reads)` is defined just before `renderCompactAlignment()` in script.js.
  It sorts reads in place by `start`, sets `read.track` on each, and returns the track count.
- The live Reads-mode data is in `bamState` (reads array with CIGAR-derived `columns` per read).
  Each read now has `.start` (genomic start = `.pos`), `.end` (genomic end = `.pos + span - 1`),
  and `.track` (assigned track index from the packer). `bamState.nTracks` holds the track count.
- `computeReadSpan(read.cigar)` sums M/D/N/=/X operations to get the reference span.
- `renderCompactAlignment()` (the dead mode) already calls `assignReadTracks(reads)` and draws
  packed SVG bars — its layout/geometry code is the reference for Phase 2.
- `renderReadsAlignment()` is the current live per-row renderer that loops over
  `bamState.reads` and builds one DOM row per read. It will be replaced in Phase 2.
- `bamState.reads` is already sorted by position before track assignment (the sort in
  `assignReadTracks` by `start` is consistent with the existing `pos` sort).
- `bamState` fields: reads, refName, refSeq, refStart, refEnd, columns, readOrder, nTracks.
  `columns[i]` is the per-read CIGAR-expanded column array with typed entries
  (match/mismatch/insertion/deletion/softclip/intron), each having `.type` and `.base`.
