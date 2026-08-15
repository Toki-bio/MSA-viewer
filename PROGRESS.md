# Canvas-edit progress

## Done
- Phase 0: hit-testing foundation — `_canvasHitTest()` + hover tracking (commit pending)
- Phase 1: click-to-select single residue — canvas mousedown does selection on hit-test, highlight rect in draw() (commit pending)
- Phase 2: drag-range selection — `handleMouseMove` nuc-branch made Canvas-aware, uses `_canvasHitTest` + `_canvasState.scheduleDraw()` (commit 72b640c)
- Phase 3: column and row selection — added `_canvasHitTestRuler`/`_canvasHitTestName` + `_canvasRowFromClientY`/`_canvasColFromClientX` helpers; canvas mousedown handles Ctrl+Alt column select and Ctrl/Shift row select; `handleMouseMove` col/row branches made Canvas-aware; `draw()` renders selected columns and rows as semi-transparent strips (commit pending)

## Current phase
Phase 4 (not started)

## Notes for the next run
Phase 4 should:
- Wire the Phase 0 hover-cell tracking (`_canvasHoverCell`) to the tooltip
  mechanism Full/Block mode uses (`showTooltipAt`). Show the same info
  (residue, position, sequence name) on hover in Canvas mode.
- The canvas already has a `mousemove` listener that updates
  `_canvasHoverCell`. Phase 4 needs to add tooltip display logic to that
  listener (or a separate one).
- Look at how DOM mode's `alignmentContainer.addEventListener('mouseover', ...)`
  shows tooltips for `.seq-data > span[data-pos]` elements — mirror that
  info (sequence header, gapless position, base) for the canvas hit-tested
  cell.
- Remember to hide the tooltip on mouseout from the canvas.
