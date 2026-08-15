# Canvas-edit progress

## Done
- Phase 0: hit-testing foundation — `_canvasHitTest()` + hover tracking (commit pending)
- Phase 1: click-to-select single residue — canvas mousedown does selection on hit-test, highlight rect in draw() (commit pending)

## Current phase
Phase 2 (not started)

## Notes for the next run
Phase 1 added:
- Canvas mousedown handler now calls `_canvasHitTest`; if it returns a cell,
  selection state is mutated mirroring `handleNucleotideSelectMouseDown`
  (full two-click system: first click sets `pendingNucStart`, second click
  on same row completes range). If hit-test returns null, panning proceeds
  as before.
- `handleNucleotideSelectMouseDown` now returns false (instead of showing a
  message) in Canvas/Reads mode, letting the canvas handler own selection.
- `draw()` in `_renderCanvasAlignment` now draws a highlight rect for every
  cell in `state.selectedNucs` (semi-transparent blue fill + border), and a
  dashed border for `state.pendingNucStart`.
- Selection state is shared with Full/Block mode: selecting in Canvas then
  switching to Full shows the same selection (and vice versa).

Phase 2 should:
- Extend the canvas mousedown into a mousedown+mousemove+mouseup drag that
  selects a rectangular range, mirroring `handleMouseMove`'s `dragMode ===
  'nuc'` branch. The drag should update `state.selectedNucs` live and
  redraw via `scheduleDraw()` (throttled to rAF).
- The existing document-level `handleMouseMove` tries to find DOM spans
  (which don't exist in Canvas mode) — Phase 2 needs a canvas-specific
  mousemove handler for drag-range, or the existing handler needs to be
  made Canvas-aware.
