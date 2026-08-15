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
- Phase 7d: Search-hit highlighting — `_computeSearchHitsForRow`/`_getSearchHitsForRow` mirror `_paintSearchEntryOnAlignment` logic; `draw()` applies search-hit background/text colors per cell; cache invalidated on re-render and on sequence/search-history change (commit pending)

## Current phase
All phases complete.

## Notes for the next run
All phases (0–7d) are complete. Canvas mode now has full editing parity with Full/Block mode.

Phase 7d implementation notes:
- `_computeSearchHitsForRow(rowIndex)` mirrors `_paintSearchEntryOnAlignment`'s logic: builds degapped display string, finds fuzzy/regex matches, maps match positions back to alignment columns, returns Map(col -> color).
- `_getSearchHitsForRow(rowIndex)` caches per-row results, invalidated when the sequence string reference or search history length changes (handles edits and search add/remove without a full re-render).
- `_canvasSearchHitsCache` is also invalidated at the start of `_renderCanvasAlignment` (mode switch, file load, etc.).
- In `draw()`, search hits override bgFill/textFill after TSD marks and before the glyph blit, matching DOM mode's CSS `!important` priority (search hits > TSD marks > conservation shading).
- Click-to-scroll from the search results panel already works via `_scrollToColumn`, which is already Canvas-aware (pans via `_canvasState.offsetX`).
- Search is still initiated from Full/Block mode (search controls are disabled in Canvas mode); search hits are preserved in `state.searchHistory` and rendered when switching to Canvas.

Known limitations (carried forward from previous phases):
- Canvas mode does NOT hide conserved columns in var-sites mode (it draws all columns). The breakpoint markers overlay the residue at the breakpoint position rather than replacing hidden columns.
- The "Rename sequence" context menu item doesn't work in Canvas mode because `showContextMenu` uses `e.target` (the canvas element) to create an inline input.
- In Canvas mode, a plain click on a residue does nucleotide selection (two-click system from Phase 1), NOT residue-typing mode entry. In DOM mode, a plain click auto-enters residue-typing mode. This is an intentional design difference — to enter edit mode in Canvas, use the Edit toggle button.
- Existing DOM-mode bug: forward search hits with bothStrands=true are not re-applied correctly after re-render because the label includes "(fwd)" which is not stripped by the `replace(/\s*\(rev comp\)\s*$/i, '')` regex. This affects both DOM and Canvas mode equally.
