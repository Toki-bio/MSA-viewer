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
- Phase 7c: Breakpoint marker hover — var-sites computation extracted to `_computeVarSites(len)` called before Canvas path; `draw()` renders breakpoint markers (brkStyle color+symbol) at `state._brkBeforePos` positions; canvas mousemove shows tooltip with hidden-column info (commit pending)

## Current phase
Phase 7d (not started)
Search-hit highlighting/click-to-scroll — search hits are CSS classes on DOM spans; Canvas mode needs to draw them in `draw()`.

## Notes for the next run
Phase 7c is complete. Breakpoint markers are now drawn in Canvas mode:
- The var-sites computation (`_computeVarSites(len)`) was extracted into a standalone function and called before the Canvas path's early `return`, so `state._diffColumns`, `state._brkBeforePos`, and `state._brkInfo` are available in Canvas mode.
- The original inline var-sites computation block (after the Canvas return) was replaced with a comment — the function handles it for all modes now.
- Canvas mode's `draw()` renders breakpoint markers at each position in `state._brkBeforePos` using `brkStyle.color` as background and `brkStyle.symbol` as the glyph, drawn on top of the residue at that position.
- The canvas `mousemove` handler checks for breakpoint markers before residue tooltips — if the hovered column has a breakpoint, it shows a tooltip with "N columns hidden (positions X–Y)" matching DOM mode's `.col-breakpoint` title attribute.

Known limitation: Canvas mode does NOT hide conserved columns in var-sites mode (it draws all columns). The breakpoint markers overlay the residue at the breakpoint position rather than replacing hidden columns. Full var-sites column hiding in Canvas mode would require a visual-to-column mapping that affects hit-testing, selection, and scrolling — left for a future phase if needed.

Remaining Phase 7 sub-phases:
- 7d: Search-hit highlighting/click-to-scroll — search hits are CSS classes on DOM spans; Canvas mode needs to draw them in `draw()`.

Known limitation from Phase 5: the "Rename sequence" context menu item doesn't work in Canvas mode because `showContextMenu` uses `e.target` (the canvas element) to create an inline input — it tries `e.target.innerHTML = ''` and `e.target.appendChild(input)` on the canvas. This could be fixed by using a prompt/modal or by temporarily switching to Full mode for rename.

Note: In Canvas mode, a plain click on a residue does nucleotide selection (two-click system from Phase 1), NOT residue-typing mode entry. In DOM mode, a plain click auto-enters residue-typing mode. This is an intentional design difference — to enter edit mode in Canvas, use the Edit toggle button.
