# Unify-render progress

## Done
- Phase 0: design note for unifying Full/Block windowed DOM rendering
- Phase 1: built unified windowed-render functions additively, not yet wired (commit ea8529c)
- Phase 2: wired Full mode to `renderUnifiedWindowedDom` (commit pending)

## Current phase
Phase 3 (not started)

## Phase 2 trace (Full mode equivalence)
- Old path: ruler + consensus built externally in `renderAlignment()`, then
  `renderFullModeWindowedRows` builds 2 `full-mode-row-spacer` spacers +
  windowed rows. Column windowing always applied via `_applyColumnWindowStyle`.
- New path: `renderUnifiedWindowedDom(container, len, len, ...)` creates
  numBlocks=1. Two outer `unified-mode-spacer` divs (height 0 since
  blockStart=0, blockEnd=0). `_buildUnifiedBlock` builds ruler + consensus
  + 2 inner `unified-row-spacer` divs + windowed rows inside a
  `div.block-block` wrapper.
- Row range: old uses `getVisibleRowColumnRange(scrollTop, ...)` directly;
  new computes `rowAreaTop = headerHeight` then `visTop = max(scrollTop,
  rowAreaTop)`, subtracting `headerHeight` before dividing by `rowHeightPx`.
  This is more precise (accounts for ruler/consensus height the old code
  ignores) but the difference is bounded by `headerHeight / rowHeightPx`
  (~1-2 rows), well within 15-row overscan. Same visible rows in practice.
- Column range: both clamp to [0, len-1] with 20-col overscan. Equivalent.
- Column windowing: old always applies `_applyColumnWindowStyle`; new only
  applies when `needsColWindow = colStart > start || colEnd < end - 1`.
  For crazy alignments (always wider than viewport), this is always true.
  Edge case: a crazy alignment narrower than the viewport would skip
  column windowing in the new path, but the visual result is the same
  (all columns rendered, no padding needed). Equivalent in practice.
- Spacer structure: old has 2 `full-mode-row-spacer` divs as direct children
  of container; new has 2 `unified-mode-spacer` divs (height 0) + 2
  `unified-row-spacer` divs inside the block. Inner row spacers serve the
  same purpose as the old spacers.
- Scroll refresh: old `_refreshFullModeWindowOnScroll` rebuilds only rows
  between spacers; new `_refreshUnifiedWindowOnScroll` rebuilds the entire
  block (including ruler + consensus). Slightly more work per scroll tick,
  but ruler + consensus are small DOM and scroll is rAF-coalesced. Acceptable.
- CSS note: unified path wraps content in `div.block-block`. If CSS
  targeting `.block-block` causes visual issues in Full mode, a CSS file
  change may be needed (ground rule 3). Noted for human testing.

## Notes for the next run
- Phase 3: wire Block mode to `renderUnifiedWindowedDom` instead of
  `renderBlockModeWindowedBlocks`. Pass `blockWidth` from the slider.
- In `renderAlignment()`'s Block mode branch, replace the
  `renderBlockModeWindowedBlocks(...)` call with
  `renderUnifiedWindowedDom(alignmentContainer, len, blockWidth, ...)`.
  Leave the non-windowed path (small alignments, `_buildBlockElement` loop)
  unchanged for now — Phase 5 will unify that.
- After wiring, trace Block mode equivalence in UNIFY_PROGRESS.md.
- Leave `renderBlockModeWindowedBlocks` in place (dead code, not yet deleted).
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
