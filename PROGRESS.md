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
- Phase 7b: TSD marking in Canvas mode — `draw()` renders TSD marks (color/bold styles) by checking `state.tsdMarks` per visible cell; `_scrollToColumn()` made Canvas-aware (pans via `_canvasState.offsetX` instead of `container.scrollLeft`); 'lowercase' style works via sequence modification (commit pending)

## Current phase
Phase 7c (not started)
Breakpoint marker hover — breakpoint markers in DOM mode have hover tooltips; Canvas mode doesn't draw them yet.

## Notes for the next run
Phase 7b is complete. TSD marks are drawn in Canvas mode's `draw()` function:
- 'color' style: overrides bgFill with TSD color and textFill with '#111', uses existing glyph cache
- 'bold' style: draws text directly in bold (bypassing glyph cache which uses non-bold font), restores fontStr after
- 'lowercase' style: modifies `state.seqs` directly, Canvas mode draws modified sequence as-is

`_scrollToColumn()` now works in Canvas mode by setting `_canvasState.offsetX` and scheduling a redraw, instead of setting `container.scrollLeft` (which is meaningless in Canvas mode's absolutely-positioned canvas layout).

Known limitation: Canvas mode doesn't respect the residue case toggle (`residue-case-upper`/`residue-case-lower` CSS classes). This affects 'lowercase' TSD style if the user has case override active. This is a pre-existing Canvas mode limitation, not TSD-specific.

Remaining Phase 7 sub-phases:
- 7c: Breakpoint marker hover — breakpoint markers in DOM mode have hover tooltips; Canvas mode doesn't draw them yet.
- 7d: Search-hit highlighting/click-to-scroll — search hits are CSS classes on DOM spans; Canvas mode needs to draw them in `draw()`.

Known limitation from Phase 5: the "Rename sequence" context menu item doesn't work in Canvas mode because `showContextMenu` uses `e.target` (the canvas element) to create an inline input — it tries `e.target.innerHTML = ''` and `e.target.appendChild(input)` on the canvas. This could be fixed by using a prompt/modal or by temporarily switching to Full mode for rename.

Note: In Canvas mode, a plain click on a residue does nucleotide selection (two-click system from Phase 1), NOT residue-typing mode entry. In DOM mode, a plain click auto-enters residue-typing mode. This is an intentional design difference — to enter edit mode in Canvas, use the Edit toggle button.
