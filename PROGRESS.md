# Reads-pile progress

## Done
- Phase 0: extracted track-packing logic into reusable `assignReadTracks()` function
- Phase 1: compute per-read genomic start/end and assign packed tracks in handleBamFile
- Phase 2: replaced per-read DOM row loop with SVG track-band layout in renderReadsAlignment
- Phase 3: bordered bars with cap marks, alternating track shading, click-to-highlight, hover tooltips
- Phase 4: diff vs bases display toggle with per-base rendering inside bars
- Phase 5: soft-clip/insertion/deletion visual treatment + low-zoom thin-line rendering

## Current phase
Phase 6 (not started)

## Notes for the next run
- Phase 5 added `_getReadCigarFeatures(read, refSeq)` which returns
  {bases, deletions, insertions, softClipLeft, softClipRight}. This replaces the direct
  use of `_getReadBasesByRefPos` in the rendering loop (which is still available for other
  callers if any).
- Soft-clip extensions: lighter fill (#e8eef5), dashed stroke (3,2), drawn before the main
  bar so they appear behind it. Left soft-clip extends bar left, right extends right.
- Deletion gaps: grey (#b0b0b0) rects inside the bar at deletion reference positions.
- Insertion ticks: orange (#e67e22) vertical lines at insertion positions (between ref
  positions). `ins.refPos` is the reference position before the insertion; visual x is at
  `(refPos + 1) * cellW` (the boundary between refPos and refPos+1).
- Low-zoom (cellW < 7): thin line through bar middle + red mismatch ticks, cap marks still
  visible. The `cellW >= 7` threshold matches the existing gate from Phase 4.
- `_getReadBasesByRefPos` is still defined but no longer called in the render loop; it can
  be removed in Phase 7 if no other callers exist.
- Phase 6 needs: gate SAM/BAM button behind reference eligibility (hidden by default, only
  show when a single reference sequence is loaded), auto-switch to Reads mode on BAM attach,
  "Clear reads" control created from JS, status message with read count and ref name.
