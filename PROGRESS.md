# Canvas-edit progress

## Done
- Phase 0: hit-testing foundation — `_canvasHitTest()` + hover tracking (commit pending)
- Phase 1: click-to-select single residue — canvas mousedown does selection on hit-test, highlight rect in draw() (commit pending)
- Phase 2: drag-range selection — `handleMouseMove` nuc-branch made Canvas-aware, uses `_canvasHitTest` + `_canvasState.scheduleDraw()` (commit 72b640c)
- Phase 3: column and row selection — added `_canvasHitTestRuler`/`_canvasHitTestName` + `_canvasRowFromClientY`/`_canvasColFromClientX` helpers; canvas mousedown handles Ctrl+Alt column select and Ctrl/Shift row select; `handleMouseMove` col/row branches made Canvas-aware; `draw()` renders selected columns and rows as semi-transparent strips (commit pending)
- Phase 4: hover tooltip — canvas mousemove listener shows `showTooltipAt` tooltip with "header: gaplessPos" for non-gap residues, mirroring DOM mode's `.seq-data > span[data-pos]` mouseover handler; tooltip hidden on mouseleave from canvas (commit pending)
- Phase 5: right-click context menu — canvas `contextmenu` listener uses `_canvasHitTestName`/`_canvasHitTest` to get row index, calls `showContextMenu(e, index)` with `e.clientX/e.clientY` for positioning; name column and data area both open the same context menu Full/Block mode opens (commit pending)
- Phase 6: GeneDoc edit-mode tools in Canvas mode — `isEditModeSupported()` allows edit mode in Canvas; canvas mousedown handles move/slide/gap/residue/selectColumn tools; `startGeneDocMoveDrag` uses canvas metrics for charWidth; `repaintGeneDocDragRow`/`handleGeneDocEditDragEnd`/`handleGeneDocEditDragMove` (selectColumn) are Canvas-aware; `updateEditActiveCell`/`fastUpdateEditCellAt` schedule canvas redraws; active edit cell drawn as red rect in `draw()` (commit pending)
- Phase 7a: Canvas codon analysis — all-frames 3-row layout (frames 2/1/0 top-to-bottom matching DOM), AA row name labels ("Pos N:") in name column, `rowPitch` accounts for `aaRowCount` AA rows, single-frame and all-frames modes both work (commit pending)

## Current phase
Phase 7b (not started)
TSD marking clicks — TSD marks are drawn on DOM spans via `setSpanTsdMarkDisplay`; Canvas mode needs to draw them in `draw()` and handle click-to-mark via hit-testing.

## Notes for the next run
Phase 7a is complete. All-frames mode draws 3 AA rows (frames 2, 1, 0 top-to-bottom) with "Pos N:" name labels, matching DOM mode. Single-frame mode draws 1 AA row with the correct frame label. `rowPitch` = `CHAR_H + aaRowCount * aaRowH` where `aaRowCount` is 3 in all-frames mode, 1 in single-frame mode.

Minor remaining item (not blocking, new feature not parity): click-to-jump on AA rows to scroll to the corresponding nucleotide column. DOM mode doesn't have this either, so it's deferred.

Remaining Phase 7 sub-phases:
- 7b: TSD marking clicks — TSD marks are drawn on DOM spans; Canvas mode needs to draw them in `draw()`.
- 7c: Breakpoint marker hover — breakpoint markers in DOM mode have hover tooltips; Canvas mode doesn't draw them yet.
- 7d: Search-hit highlighting/click-to-scroll — search hits are CSS classes on DOM spans; Canvas mode needs to draw them in `draw()`.

Known limitation from Phase 5: the "Rename sequence" context menu item doesn't work in Canvas mode because `showContextMenu` uses `e.target` (the canvas element) to create an inline input — it tries `e.target.innerHTML = ''` and `e.target.appendChild(input)` on the canvas. This could be fixed by using a prompt/modal or by temporarily switching to Full mode for rename.

Note: In Canvas mode, a plain click on a residue does nucleotide selection (two-click system from Phase 1), NOT residue-typing mode entry. In DOM mode, a plain click auto-enters residue-typing mode. This is an intentional design difference — to enter edit mode in Canvas, use the Edit toggle button.
