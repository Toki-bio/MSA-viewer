# Canvas-edit progress

## Done
- Phase 0: hit-testing foundation — `_canvasHitTest()` + hover tracking (commit pending)
- Phase 1: click-to-select single residue — canvas mousedown does selection on hit-test, highlight rect in draw() (commit pending)
- Phase 2: drag-range selection — `handleMouseMove` nuc-branch made Canvas-aware, uses `_canvasHitTest` + `_canvasState.scheduleDraw()` (commit 72b640c)
- Phase 3: column and row selection — added `_canvasHitTestRuler`/`_canvasHitTestName` + `_canvasRowFromClientY`/`_canvasColFromClientX` helpers; canvas mousedown handles Ctrl+Alt column select and Ctrl/Shift row select; `handleMouseMove` col/row branches made Canvas-aware; `draw()` renders selected columns and rows as semi-transparent strips (commit pending)
- Phase 4: hover tooltip — canvas mousemove listener shows `showTooltipAt` tooltip with "header: gaplessPos" for non-gap residues, mirroring DOM mode's `.seq-data > span[data-pos]` mouseover handler; tooltip hidden on mouseleave from canvas (commit pending)
- Phase 5: right-click context menu — canvas `contextmenu` listener uses `_canvasHitTestName`/`_canvasHitTest` to get row index, calls `showContextMenu(e, index)` with `e.clientX/e.clientY` for positioning; name column and data area both open the same context menu Full/Block mode opens (commit pending)

## Current phase
Phase 6 (not started)

## Notes for the next run
Phase 6 — GeneDoc edit-mode tools (expect multiple runs; stop at a safe sub-point if needed):
- When `state.editModeActive` is true and the user is in Canvas mode, dragging within a row should perform the same move/slide/gap-insertion mutations Full/Block mode's edit-drag tools perform.
- Read `handleGeneDocEditMouseDown`, `handleGeneDocEditDragMove`, `handleGeneDocEditDragEnd` — these currently work on DOM spans and use `getGeneDocCharWidth(span)` to measure pixel-to-column conversion. Canvas mode needs its own mousedown/move/up that uses `_canvasHitTest` + `_canvasState.metrics.charW` instead.
- The underlying mutation functions (`geneDocMoveTextString`, `geneDocSlideTextString`, `geneDocInsertDashString`, `geneDocDeleteDashString`) already operate on `state.seqs` strings directly — they are DOM-agnostic. Canvas mode just needs to call them, then redraw via `_canvasState.scheduleDraw()`.
- `setGeneDocEditMode` currently calls `isSpanRenderMode()` and refuses to activate in Canvas mode. This gate needs to be relaxed for Canvas mode (or a separate Canvas edit mode path added).
- Known limitation from Phase 5: the "Rename sequence" context menu item doesn't work in Canvas mode because `showContextMenu` uses `e.target` (the canvas element) to create an inline input — it tries `e.target.innerHTML = ''` and `e.target.appendChild(input)` on the canvas. This could be fixed by using a prompt/modal or by temporarily switching to Full mode for rename.
