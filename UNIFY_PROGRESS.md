# Unify-render progress

## Done
- Phase 0: design note for unifying Full/Block windowed DOM rendering
- Phase 1: built unified windowed-render functions additively, not yet wired (commit ea8529c)

## Current phase
Phase 2 (not started)

## Notes for the next run
- Phase 2: wire Full mode to `renderUnifiedWindowedDom` instead of
  `renderFullModeWindowedRows`. Pass `blockWidth = len` (so numBlocks = 1).
- CRITICAL: In `renderAlignment()`'s Full mode branch, the ruler and
  consensus are currently built OUTSIDE the windowed area (before/after the
  `renderFullModeWindowedRows` call). When switching to the unified path,
  those external builds must be SKIPPED — the unified function builds
  ruler + consensus INSIDE the block.
- The `renderAlignment()` Full mode branch code to skip is:
  1. The `scaleDiv` ruler block (before the `if (state.alignmentIndex?.isCrazy)` check)
  2. The `addConsensusLine` calls before/after `renderFullModeWindowedRows`
- The unified function call should be:
  `renderUnifiedWindowedDom(alignmentContainer, len, len, nameLen, stickyNames, standard, ambiguous, blackThresh, darkThresh, lightThresh, enableBlack, enableDark, enableLight, conservationData, shouldRenderConsensus, consensusPosition, consensus, options, _preserveScrollTop)`
  (blockWidth = len for Full mode)
- After wiring, trace through by hand that the unified function produces
  the same spacer structure, row range, and column range as the old function.
- Document the trace in UNIFY_PROGRESS.md under Phase 2.
- Leave Block mode on its old path (`renderBlockModeWindowedBlocks`).
- Leave `renderFullModeWindowedRows` in place (dead code, not yet deleted).
- If CSS targeting `.block-block` causes visual issues in Full mode,
  note it in `## Notes` — a CSS file change may be needed (ground rule 3).
- Phase 1 implementation details:
  - New functions: `renderUnifiedWindowedDom`, `_buildUnifiedBlock`,
    `_refreshUnifiedWindowOnScroll`, `_setupUnifiedScrollListener`
  - New variables: `_unifiedRowHeightPx`, `_unifiedBlockHeightPx`,
    `_unifiedCharWidthPx`, `_unifiedNameColWidthPx`, `_unifiedWindowRenderParams`
  - New measurement helpers: `_measureUnifiedRowHeight`,
    `_measureUnifiedColumnMetrics`, `_unifiedFallbackBlockHeightPx`,
    `_measureUnifiedBlockHeight`
  - Spacer classes: `unified-mode-spacer` (block-level), `unified-row-spacer`
    (row-level within blocks)
  - Scroll controller: `_unifiedScrollController` (isActiveFn checks both
    modeSingle and modeBlocks)
  - Row windowing overscan: 15 rows (same as Full mode)
  - Column windowing overscan: 20 cols (same as Full mode)
  - Block-level windowing overscan: 1 (same as Block mode)
  - Column windowing within blocks: only applied when block is wider than
    viewport (`colStart > start || colEnd < end - 1`); otherwise all columns
    rendered (same as current Block mode)
  - Guard: if `colStart > colEnd` (block entirely past viewport horizontally),
    falls back to rendering all columns in the block
