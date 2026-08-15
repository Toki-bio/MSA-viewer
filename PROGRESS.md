# Reads-pile progress

## Done
- Phase 0: extracted track-packing logic into reusable `assignReadTracks()` function
- Phase 1: compute per-read genomic start/end and assign packed tracks in handleBamFile
- Phase 2: replaced per-read DOM row loop with SVG track-band layout in renderReadsAlignment

## Current phase
Phase 3 (not started)

## Notes for the next run
- `renderReadsAlignment()` now builds a sticky DOM reference row + sticky DOM scale ruler
  (unchanged from before), followed by a single SVG (`id=readsPileSvg`) with one horizontal
  band per packed track. Each read is a plain `rect` positioned by genomic coordinate.
  `nTracks` visual rows replace `reads.length` DOM rows.
- Layout constants in `renderReadsAlignment()`: `cellW = 12`, `NAME_W = 160`, `TRACK_H = 16`.
  The sticky DOM elements use `160px` for the name column width, matching `NAME_W`.
- Track bands are at `y = t * TRACK_H` for track `t`. Read bars use `fill: #c8d8e8`,
  `stroke: #8ab4d6`, `stroke-width: 0.5`, `rx: 2` — plain rectangles, no styling detail yet.
- Reads are grouped by track in a single pass (`trackGroups` array) for O(n) efficiency.
- `bamState.nTracks` and `read.track` are set in `handleBamFile()` (Phase 1).
- `baseColorRef()` is still used for the reference row bases.
- `columns` (per-read CIGAR-expanded typed entries) are destructured from `bamState` but
  not yet used in the SVG renderer — Phase 3+ will use them for diff/bases display.
- `renderCompactAlignment()` (the dead mode) remains as the reference for SVG patterns.
- Phase 3 needs: bordered bars with visible stroke + start/end cap marks, alternating track
  background shading, click-to-highlight (thicker stroke + status line), hover tooltip
  with name/pos/cigar/mapq. Reuse `showTooltipAt()` / `hideTooltip()` for tooltips.
