# Canvas-edit progress

## Done
- Phase 0: hit-testing foundation — `_canvasHitTest()` + hover tracking (commit pending)
- Phase 1: click-to-select single residue — canvas mousedown does selection on hit-test, highlight rect in draw() (commit pending)
- Phase 2: drag-range selection — `handleMouseMove` nuc-branch made Canvas-aware, uses `_canvasHitTest` + `_canvasState.scheduleDraw()` (commit 72b640c)
- Phase 3: column and row selection — added `_canvasHitTestRuler`/`_canvasHitTestName` + `_canvasRowFromClientY`/`_canvasColFromClientX` helpers; canvas mousedown handles Ctrl+Alt column select and Ctrl/Shift row select; `handleMouseMove` col/row branches made Canvas-aware; `draw()` renders selected columns and rows as semi-transparent strips (commit pending)
- Phase 4: hover tooltip — canvas mousemove listener shows `showTooltipAt` tooltip with "header: gaplessPos" for non-gap residues, mirroring DOM mode's `.seq-data > span[data-pos]` mouseover handler; tooltip hidden on mouseleave from canvas (commit pending)

## Current phase
Phase 5 (not started)

## Notes for the next run
Phase 5 should:
- On the canvas, right-click at a hit-tested cell should open the same
  context menu Full/Block mode opens (`showContextMenu`), positioned at
  the click point, operating on whatever cell/selection is under the cursor.
- Look at how DOM mode's `alignmentContainer.addEventListener('contextmenu', ...)`
  calls `showContextMenu(e, index)` — mirror that for Canvas mode, using
  `_canvasHitTest` to get the row index and `e.clientX/e.clientY` for
  positioning.
- Also consider right-click on the name column (should open context menu
  for that sequence's row) and right-click on the ruler (may not need a
  context menu, or could select the column).
