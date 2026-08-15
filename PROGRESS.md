# Canvas-edit progress

## Done
- Phase 0: hit-testing foundation — `_canvasHitTest()` + hover tracking (commit pending)
- Phase 1: click-to-select single residue — canvas mousedown does selection on hit-test, highlight rect in draw() (commit pending)
- Phase 2: drag-range selection — `handleMouseMove` nuc-branch made Canvas-aware, uses `_canvasHitTest` + `_canvasState.scheduleDraw()` (commit 72b640c)

## Current phase
Phase 3 (not started)

## Notes for the next run
Phase 3 should:
- Add column selection: clicking the scale ruler area (top row, above the
  data) in Canvas mode should select the whole column, mirroring
  `handleColumnSelectMouseDown`'s state mutations (Ctrl+Alt+click in DOM
  mode).
- Add row selection: clicking the name column (left side) in Canvas mode
  should select the whole row, mirroring `handleRowSelectMouseDown`'s state
  mutations (Ctrl+click in DOM mode).
- Both need hit-testing to distinguish the ruler area and name column from
  the data area. The canvas mousedown handler already uses `_canvasHitTest`
  for the data area; Phase 3 needs separate hit-tests for the ruler and
  name column regions (or extend `_canvasHitTest` to return a region
  indicator).
- draw() currently only draws `state.selectedNucs` and
  `state.pendingNucStart` highlights. Phase 3 needs to add drawing steps
  for `state.selectedColumns` (highlight the column) and
  `state.selectedRows` (highlight the row's name/background).
