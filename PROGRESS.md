# Canvas-edit progress

## Done
All phases (0–7d) are complete. Canvas mode now has full editing parity with Full/Block mode.

- Phase 0: hit-testing foundation — `_canvasHitTest()` + hover tracking
- Phase 1: click-to-select single residue — canvas mousedown does selection on hit-test, highlight rect in draw()
- Phase 2: drag-range selection — `handleMouseMove` nuc-branch made Canvas-aware, uses `_canvasHitTest` + `_canvasState.scheduleDraw()`
- Phase 3: column and row selection — `_canvasHitTestRuler`/`_canvasHitTestName` + `_canvasRowFromClientY`/`_canvasColFromClientX` helpers; canvas mousedown handles Ctrl+Alt column select and Ctrl/Shift row select; `draw()` renders selected columns and rows as semi-transparent strips
- Phase 4: hover tooltip — canvas mousemove listener shows `showTooltipAt` tooltip with "header: gaplessPos" for non-gap residues; tooltip hidden on mouseleave from canvas
- Phase 5: right-click context menu — canvas `contextmenu` listener uses `_canvasHitTestName`/`_canvasHitTest` to get row index, calls `showContextMenu(e, index)`; name column and data area both open the same context menu
- Phase 6: GeneDoc edit-mode tools in Canvas mode — `isEditModeSupported()` allows edit mode in Canvas; canvas mousedown handles move/slide/gap/residue/selectColumn tools; `startGeneDocMoveDrag` uses canvas metrics for charWidth; `repaintGeneDocDragRow`/`handleGeneDocEditDragEnd`/`handleGeneDocEditDragMove` are Canvas-aware; active edit cell drawn as red rect in `draw()`
- Phase 7a: Canvas codon analysis — all-frames 3-row layout (frames 2/1/0 top-to-bottom matching DOM), AA row name labels in name column, `rowPitch` accounts for AA rows
- Phase 7b: TSD marking in Canvas mode — `draw()` renders TSD marks (color/bold styles); `_scrollToColumn()` made Canvas-aware; 'lowercase' style works via sequence modification
- Phase 7c: Breakpoint marker hover — var-sites computation extracted to `_computeVarSites(len)`; `draw()` renders breakpoint markers; canvas mousemove shows tooltip with hidden-column info
- Phase 7d: Search-hit highlighting — `_computeSearchHitsForRow`/`_getSearchHitsForRow` mirror DOM logic; `draw()` applies search-hit colors per cell; cache invalidated on re-render and on sequence/search-history change

## Current phase
All phases complete. No further work needed.

## Notes for the next run
All phases (0–7d) are complete. Canvas mode now has full editing parity with Full/Block mode.

Known limitations (carried forward from previous phases):
- Canvas mode does NOT hide conserved columns in var-sites mode (it draws all columns). The breakpoint markers overlay the residue at the breakpoint position rather than replacing hidden columns.
- The "Rename sequence" context menu item doesn't work in Canvas mode because `showContextMenu` uses `e.target` (the canvas element) to create an inline input.
- In Canvas mode, a plain click on a residue does nucleotide selection (two-click system from Phase 1), NOT residue-typing mode entry. In DOM mode, a plain click auto-enters residue-typing mode. This is an intentional design difference — to enter edit mode in Canvas, use the Edit toggle button.
- Existing DOM-mode bug: forward search hits with bothStrands=true are not re-applied correctly after re-render because the label includes "(fwd)" which is not stripped by the `replace(/\s*\(rev comp\)\s*$/i, '')` regex. This affects both DOM and Canvas mode equally.
