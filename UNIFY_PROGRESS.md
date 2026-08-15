# Unify-render progress

## Done
- Phase 0: design note for unifying Full/Block windowed DOM rendering
- Phase 1: built unified windowed-render functions additively, not yet wired (commit ea8529c)
- Phase 2: wired Full mode to `renderUnifiedWindowedDom` (commit pending)
- Phase 3: wired Block mode to `renderUnifiedWindowedDom` (commit pending)
- Phase 4: unified scroll controllers — `_unifiedScrollController` is the single active controller; old controllers are dead code (commit pending)

## Current phase
Phase 5 (not started)

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

## Phase 3 trace (Block mode equivalence)
- Old path: `renderBlockModeWindowedBlocks` creates `numBlocks = ceil(len /
  blockWidth)` blocks. Two `block-mode-spacer` divs for block-level windowing.
  `_buildBlockElement` builds each visible block with ruler + optional
  consensus + ALL rows + optional consensus. No row windowing within blocks.
  No column windowing within blocks.
- New path: `renderUnifiedWindowedDom(container, len, blockWidth, ...)` creates
  `numBlocks = ceil(len / blockWidth)` (same). Two `unified-mode-spacer` divs
  for block-level windowing. `_buildUnifiedBlock` builds each visible block
  with ruler + optional consensus + 2 `unified-row-spacer` divs + windowed
  rows + optional consensus.
- Block range: both compute `blockStart`/`blockEnd` from `scrollTop /
  blockHeightPx` with overscan=1. Equivalent.
- Row windowing: old renders ALL rows per visible block; new windows rows
  within each block (rowStart/rowEnd from visTop/visBottom relative to
  rowAreaTop, with 15-row overscan). This is a behavioral difference but
  strictly an improvement: the old path built off-screen rows that were
  never visible, the new path skips them. Visual output is identical. The
  row windowing is bounded by the block's own vertical extent
  (`visBottom = min(scrollTop + clientHeight, blockTop + blockHeightPx)`),
  so it never renders rows from adjacent blocks.
- Column windowing: old renders all columns in each block; new only applies
  column windowing when the block is wider than the viewport
  (`needsColWindow = colStart > start || colEnd < end - 1`). For typical
  Block mode (block width 40-80 cols, viewport wider), `needsColWindow` is
  false, so all columns are rendered — same as old behavior. When the block
  IS wider than the viewport (e.g. user sets a very large block width),
  column windowing kicks in, which is an improvement over the old path.
- Spacer structure: old has 2 `block-mode-spacer` divs as direct children of
  container; new has 2 `unified-mode-spacer` divs (block-level) + 2
  `unified-row-spacer` divs inside each block. Inner row spacers serve the
  same purpose as the old spacers did for block-level windowing, but at the
  row level within blocks.
- Scroll refresh: old `_refreshBlockModeWindowOnScroll` rebuilds only blocks
  between spacers; new `_refreshUnifiedWindowOnScroll` also rebuilds only
  blocks between spacers, but each block rebuild includes ruler + consensus
  + row spacers + windowed rows. Slightly more work per scroll tick, but
  ruler + consensus are small DOM and scroll is rAF-coalesced. Acceptable.
- Scroll controller: `_unifiedScrollController` is already active for both
  `modeSingle` and `modeBlocks` (isActiveFn checks both). Since the call
  site now points to `renderUnifiedWindowedDom`, `_blockModeScrollController`
  is never bound (its `bind` is only called from `_setupBlockModeScrollListener`,
  which is only called from `renderBlockModeWindowedBlocks`, which is no
  longer called). No double-fire on fresh page load. Phase 4 will collapse
  the controllers formally.
- CSS note: unified path wraps content in `div.block-block`, same class as
  the old Block mode path used. No CSS change needed.

## Phase 4 trace (scroll controller unification)
- The `_unifiedScrollController` (created in Phase 1) already serves as the
  single collapsed controller instance. Its `isActiveFn` checks both
  `modeSingle` and `modeBlocks` (plus `isCrazy`), and its `refreshFn`
  (`_refreshUnifiedWindowOnScroll`) reads `_unifiedWindowRenderParams`
  which is set by `renderUnifiedWindowedDom` with the correct `blockWidth`
  for whichever mode is active (len for Full, slider value for Block).
- The old controllers are dead code:
  - `_fullModeScrollController`: only bound via `_setupFullModeScrollListener`,
    which is only called from `renderFullModeWindowedRows` (no longer called
    from `renderAlignment()`). Its `suppressNextEvent()` is also only called
    from `renderFullModeWindowedRows`.
  - `_blockModeScrollController`: same — only bound via
    `_setupBlockModeScrollListener`, called from `renderBlockModeWindowedBlocks`
    (no longer called). Its `suppressNextEvent()` is only called from there.
- No double-binding: `_createWindowedScrollController.bind()` is idempotent
  (`if (boundContainer === container) return`), and both modes use the same
  `alignmentContainer` element, so switching Full<->Block on a crazy alignment
  doesn't re-bind — the unified controller stays attached and simply picks
  up the new `_unifiedWindowRenderParams` on the next render.
- Mode-switch safety: when switching to Canvas/Reads, `isActiveFn` returns
  false (neither mode radio checked), so scroll events are ignored. When
  switching back to Full/Block on a crazy alignment, `renderAlignment()` ->
  `renderUnifiedWindowedDom()` -> `_setupUnifiedScrollListener()` re-binds
  (no-op if already bound) and refreshes `_unifiedWindowRenderParams`.
- The old controllers, their setup functions, and the old render/refresh
  functions are all dead code. They will be deleted in Phase 6.

## Notes for the next run
- Phase 5: unify the non-windowed (small-alignment) loops. The `else` branch
  in both Full and Block mode (the `for` loop building all rows/blocks
  directly) can share a helper. For Block mode, the non-windowed path uses
  `_buildBlockElement` in a loop; for Full mode, it builds ruler + consensus
  + rows directly. Apply the "Block with unbounded width" insight: Full mode
  is Block mode with `blockWidth = len`, so the non-windowed Block loop with
  `blockWidth = len` produces one block = one ruler + one consensus + all
  rows, which is exactly what Full mode does.
- Phase 6: delete confirmed-dead code. The following are all dead code
  (no remaining call sites after Phases 2-5):
  - `renderFullModeWindowedRows`, `renderBlockModeWindowedBlocks`
  - `_refreshFullModeWindowOnScroll`, `_refreshBlockModeWindowOnScroll`
  - `_fullModeScrollController`, `_blockModeScrollController`
  - `_setupFullModeScrollListener`, `_setupBlockModeScrollListener`
  - `_fullModeWindowRenderParams`, `_blockModeWindowRenderParams`
  - `_fullModeRowHeightPx`, `_fullModeCharWidthPx`, `_fullModeNameColWidthPx`
  - `_blockModeBlockHeightPx`, `_blockModeFallbackHeightPx`
  - `_measureFullModeRowHeight`, `_measureFullModeColumnMetrics`
  - `_measureBlockModeBlockHeight`
  - `getVisibleRowColumnRange` (only called by dead Full-mode functions;
    unified path computes its own ranges inline in `_buildUnifiedBlock`)
  - NOT dead code (do NOT delete): `_applyColumnWindowStyle` (used by
    `_buildUnifiedBlock`), `_removeNodesBetweenSpacers` (used by
    `_refreshUnifiedWindowOnScroll`), `_createWindowedScrollController`
    (used by `_unifiedScrollController`), `_buildBlockElement` (used by
    non-windowed Block path, will be unified in Phase 5)
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
