# Reads-pile progress

## Done
- Phase 0: extracted track-packing logic into reusable `assignReadTracks()` function
- Phase 1: compute per-read genomic start/end and assign packed tracks in handleBamFile
- Phase 2: replaced per-read DOM row loop with SVG track-band layout in renderReadsAlignment
- Phase 3: bordered bars with cap marks, alternating track shading, click-to-highlight, hover tooltips
- Phase 4: diff vs bases display toggle with per-base rendering inside bars
- Phase 5: soft-clip/insertion/deletion visual treatment + low-zoom thin-line rendering
- Phase 6: gated SAM/BAM button behind single-reference eligibility, added "Clear reads" control (JS-created), reset bamState on new file load

## Current phase
Phase 7 (not started)

## Notes for the next run
- Phase 6 added `updateBamButtonVisibility()` (checks `state.seqs.length === 1`),
  `ensureClearReadsButton()` (creates "Clear reads" button from JS, inserted after
  `bamButton`), and `clearReadsData()` (resets bamState, switches to Block mode).
- The BAM button is assumed to have id `bamButton` (not visible in the JS file; if the
  human tester finds the button visibility isn't toggling, the actual HTML id may differ
  and `updateBamButtonVisibility` should be updated to match).
- `bamState` is now reset in `parseAndRender` when loading a new file, and if the user
  was in Reads mode, they're switched back to Block mode automatically.
- `handleBamFile` already auto-switches to Reads mode and shows a status message
  (done in Phase 1); Phase 6 just added the `updateBamButtonVisibility()` call after.
- Phase 7 should remove dead code: `_getReadBasesByRefPos` (no longer called in the
  render loop, replaced by `_getReadCigarFeatures` in Phase 5) and `renderCompactAlignment`
  (the dead mode's renderer — no radio button routes to it, `assignReadTracks` is still
  needed by `renderReadsAlignment` so keep that).
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
