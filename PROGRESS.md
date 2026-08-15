# Canvas-edit progress

## Done
- Phase 0: hit-testing foundation — `_canvasHitTest()` + hover tracking (commit pending)

## Current phase
Phase 1 (not started)

## Notes for the next run
Phase 0 added:
- `_canvasHitTest(clientX, clientY)` returns `{row, col}` or `null`. Uses
  `_canvasState.canvas.getBoundingClientRect()`, `_canvasState.metrics`
  (charW, charH, nameW), and `_canvasState.offsetX/offsetY` for pan offset.
- `_canvasHoverCell` module-level variable updated on canvas `mousemove`.
- `m.nameW` is now stored in `_canvasState.metrics` during
  `_renderCanvasAlignment` (where NAME_W is computed).
- `_canvasState.canvas` and `_canvasState.seqsLen` are now set during render.

Phase 1 should:
- On `mousedown` on the canvas data area, call `_canvasHitTest`, then mirror
  the state mutations in `handleNucleotideSelectMouseDown` for a single click
  (read that function first — it sets `state.selectedNucs`,
  `state.pendingNucStart`, `state.isDragging`, etc.).
- Add a highlight rect draw step to `_renderCanvasAlignment`'s `draw()`
  function, gated on whether the cell is in `state.selectedNucs`.
- Clicking the name column (col < 0 in hit-test terms, i.e. null return)
  should do nothing yet — that's Phase 3.
- The existing mousedown handler for panning (dragging=true) must still work;
  a left-click on a residue should select it, while a drag that moves should
  pan. Distinguish by hit-test: if hit-test returns a cell, it's a selection
  click; if null, it's a pan. (Phase 2 will refine this into drag-range.)
