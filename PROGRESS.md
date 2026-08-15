# Reads-pile progress

## Done
- Phase 0: extracted track-packing logic into reusable `assignReadTracks()` function
- Phase 1: compute per-read genomic start/end and assign packed tracks in handleBamFile
- Phase 2: replaced per-read DOM row loop with SVG track-band layout in renderReadsAlignment
- Phase 3: bordered bars with cap marks, alternating track shading, click-to-highlight, hover tooltips
- Phase 4: diff vs bases display toggle with per-base rendering inside bars

## Current phase
Phase 5 (not started)

## Notes for the next run
- Phase 4 added `_readsDisplayMode` module-level variable ('diff' default, 'bases' alternative).
- `ensureReadsDisplayToggle()` creates a "Show bases" checkbox from JS, inserted after the
  quick mode switcher. Visibility toggled in `syncQuickModeSwitch()` based on `isReadsMode`.
- `_getReadBasesByRefPos(read, refSeq)` walks the CIGAR and returns a Map of
  refPos -> {base, type} for M/=/X positions. Insertions/deletions/skips/soft-clips are
  not in the map (no reference column to draw in). This is self-contained and does not
  depend on `bamState.columns` / `BamParser.expandCigar` (whose exact property names are
  unknown since BamParser is not in this file).
- Per-base text drawn as SVG `<text>` elements with `pointer-events: none`,
  `dominant-baseline: middle`, font-size 9, monospace. Mismatches in 'diff' mode are
  red (#e74c3c). All bases in 'bases' mode use `baseColorRef()`.
- `cellW >= 7` gate prevents drawing text when cells are too narrow (Phase 5 will add
  thin-line fallback below this threshold).
- `read.cigar` is an array of `{len, op}` objects; `read.seq` is the read sequence string;
  `read.pos` is 0-based genomic position; `bamState.refSeq` is indexed by absolute
  genomic position.
- Phase 5 needs: soft-clip (lighter fill, dashed stroke on clipped portion), insertion
  (vertical tick/extension), deletion (grey gap segment inside bar), low-zoom
  thin-line-plus-mismatch-ticks rendering with cap marks still visible. Use
  `_getReadBasesByRefPos` or walk CIGAR directly for per-position types.
