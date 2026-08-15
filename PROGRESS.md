# Reads-pile progress

## Done
- Phase 0: extracted track-packing logic into reusable `assignReadTracks()` function
- Phase 1: compute per-read genomic start/end and assign packed tracks in handleBamFile
- Phase 2: replaced per-read DOM row loop with SVG track-band layout in renderReadsAlignment
- Phase 3: bordered bars with cap marks, alternating track shading, click-to-highlight, hover tooltips
- Phase 4: diff vs bases display toggle with per-base rendering inside bars
- Phase 5: soft-clip/insertion/deletion visual treatment + low-zoom thin-line rendering
- Phase 6: gated SAM/BAM button behind single-reference eligibility, added "Clear reads" control (JS-created), reset bamState on new file load
- Phase 7: removed dead code — `_getReadBasesByRefPos`, `renderCompactAlignment`, `_updateCompactControlsVisibility`, and all compact-mode references (`useCompact`, `modeCompact` checks, `compactDiffOnly`/`compactPairs` checkboxes)

## Current phase
All phases complete.

## Notes for the next run
- All 7 phases are done. The packed-pile Reads mode is the only Reads rendering path.
- `assignReadTracks()` is still shared by `renderReadsAlignment` (live) — kept.
- `baseColorRef()` is still used by `renderReadsAlignment` — kept.
- The dead compact mode had no radio button in the HTML, so removing its code path
  and references is safe — `document.getElementById('modeCompact')` always returned
  null, making `useCompact` always falsy and `_updateCompactControlsVisibility` a
  no-op that just hid already-invisible elements.
