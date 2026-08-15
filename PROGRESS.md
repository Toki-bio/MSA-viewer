# Canvas-edit progress

## Done
- Phase 0: hit-testing foundation — `_canvasHitTest()` + hover tracking (commit pending)
- Phase 1: click-to-select single residue — canvas mousedown does selection on hit-test, highlight rect in draw() (commit pending)
- Phase 2: drag-range selection — `handleMouseMove` nuc-branch made Canvas-aware, uses `_canvasHitTest` + `_canvasState.scheduleDraw()` (commit 72b640c)
- Phase 3: column and row selection — added `_canvasHitTestRuler`/`_canvasHitTestName` + `_canvasRowFromClientY`/`_canvasColFromClientX` helpers; canvas mousedown handles Ctrl+Alt column select and Ctrl/Shift row select; `handleMouseMove` col/row branches made Canvas-aware; `draw()` renders selected columns and rows as semi-transparent strips (commit pending)
- Phase 4: hover tooltip — canvas mousemove listener shows `showTooltipAt` tooltip with "header: gaplessPos" for non-gap residues, mirroring DOM mode's `.seq-data > span[data-pos]` mouseover handler; tooltip hidden on mouseleave from canvas (commit pending)
- Phase 5: right-click context menu — canvas `contextmenu` listener uses `_canvasHitTestName`/`_canvasHitTest` to get row index, calls `showContextMenu(e, index)` with `e.clientX/e.clientY` for positioning; name column and data area both open the same context menu Full/Block mode opens (commit pending)
- Phase 6: GeneDoc edit-mode tools in Canvas mode — `isEditModeSupported()` allows edit mode in Canvas; canvas mousedown handles move/slide/gap/residue/selectColumn tools; `startGeneDocMoveDrag` uses canvas metrics for charWidth; `repaintGeneDocDragRow`/`handleGeneDocEditDragEnd`/`handleGeneDocEditDragMove` (selectColumn) are Canvas-aware; `updateEditActiveCell`/`fastUpdateEditCellAt` schedule canvas redraws; active edit cell drawn as red rect in `draw()` (commit pending)

## Current phase
Phase 7a (in progress)

### What's done
- Extracted codon analysis computation into `_updateCodonAnalysisState(len)` helper function
- Canvas mode now calls `_updateCodonAnalysisState(len)` instead of clearing codon data to `null`
- Added `rowPitch` (CHAR_H + AA row height) to `_canvasState` and all Canvas rendering calculations
- Canvas `draw()` now renders AA translation rows below each sequence when codon analysis is active
- All hit-testing functions (`_canvasHitTest`, `_canvasHitTestName`, `_canvasRowFromClientY`) updated to use `rowPitch`
- Selection highlights (rows, nucs, pending nuc, edit cell) updated to use `rowPitch` for y-positioning
- `codon-mode` body class is now active in Canvas mode (was previously cleared)
- `syncCodonModePanel()` shows the frame switcher panel in Canvas mode

### What's left for 7a
- Click-to-jump: clicking an AA row in Canvas mode should scroll to the corresponding nucleotide column (not yet implemented)
- All-frames mode (`state._codonActiveFrame === -1`): currently draws only the best frame's AA row; DOM mode draws 3 AA rows (frames 0, 1, 2). The `rowPitch` only accounts for 1 AA row.
- AA row name label ("Pos 1:") not drawn in Canvas mode (DOM mode shows it in the name column)

## Notes for the next run
Phase 7a is partially complete. The drawing foundation is in place. The remaining items (click-to-jump, all-frames 3-row layout, AA row labels) can be done in a follow-up run or deferred to a later sub-phase.

For all-frames mode: would need `aaRowCount = state._codonActiveFrame === -1 ? 3 : 1` and `rowPitch = CHAR_H + aaRowCount * aaRowH`. Draw 3 AA rows per sequence using `state._codonFrames.frames[fr].aaSeq[i]` for frames 0, 1, 2.

Remaining Phase 7 sub-phases:
- 7b: TSD marking clicks — TSD marks are drawn on DOM spans; Canvas mode needs to draw them in `draw()`.
- 7c: Breakpoint marker hover — breakpoint markers in DOM mode have hover tooltips; Canvas mode doesn't draw them yet.
- 7d: Search-hit highlighting/click-to-scroll — search hits are CSS classes on DOM spans; Canvas mode needs to draw them in `draw()`.

Known limitation from Phase 5: the "Rename sequence" context menu item doesn't work in Canvas mode because `showContextMenu` uses `e.target` (the canvas element) to create an inline input — it tries `e.target.innerHTML = ''` and `e.target.appendChild(input)` on the canvas. This could be fixed by using a prompt/modal or by temporarily switching to Full mode for rename.

Note: In Canvas mode, a plain click on a residue does nucleotide selection (two-click system from Phase 1), NOT residue-typing mode entry. In DOM mode, a plain click auto-enters residue-typing mode. This is an intentional design difference — to enter edit mode in Canvas, use the Edit toggle button.
