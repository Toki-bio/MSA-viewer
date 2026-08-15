# Reads-pile progress

## Done
- Phase 0: extracted track-packing logic into reusable `assignReadTracks()` function
- Phase 1: compute per-read genomic start/end and assign packed tracks in handleBamFile
- Phase 2: replaced per-read DOM row loop with SVG track-band layout in renderReadsAlignment
- Phase 3: bordered bars with cap marks, alternating track shading, click-to-highlight, hover tooltips

## Current phase
Phase 4 (not started)

## Notes for the next run
- `renderReadsAlignment()` now draws each read as a bordered rect (`stroke: #4a7fa8`,
  `stroke-width: 1.5`) with start/end cap marks (vertical lines, `stroke: #2c5d80`,
  `stroke-width: 2`, full track height). Track backgrounds alternate (`#f0f4f8` even,
  `#ffffff` odd). Clicking a bar highlights it (`stroke: #d9402b`, `stroke-width: 3`) and
  shows read info in a status line div (`id=readsStatusLine`) above the SVG. Hovering
  shows a tooltip via `showTooltipAt()` with name/pos/cigar/mapq.
- Module-level `_readsHighlightedBar` tracks the currently selected bar; reset to null
  on every `renderReadsAlignment()` call.
- Bar geometry: `rh = TRACK_H - 4 = 12px`, bar y offset `ry + 2` to center in track.
  Cap marks span full `TRACK_H = 16px` for visibility above/below bar.
- `read.cigar` is an array of `{len, op}` objects; format with
  `read.cigar.map(c => c.len + c.op).join('')`.
- Phase 4 needs: diff vs bases display toggle (checkbox created from JS), mismatch
  letters inside bars in diff mode, colored bases inside bars in bases mode using
  existing `baseColorRef()` palette. State for the toggle should be module-level
  (not on `state` core alignment fields). The `columns` array in `bamState` has
  per-read CIGAR-expanded typed entries — use those to determine match/mismatch/
  insertion/deletion/soft-clip per position.
