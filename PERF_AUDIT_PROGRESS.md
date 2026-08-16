# Perf-audit progress

## Done
- Phase 0: Built complete call graph from `_refreshUnifiedWindowOnScroll` (commit pending)

## Current phase
Phase 1 (complete)

## Call graph from `_refreshUnifiedWindowOnScroll` (scroll-triggered refresh path)

### Entry point
- **`_refreshUnifiedWindowOnScroll(container)`** — reads cached params `p = _unifiedWindowRenderParams` (set by `renderUnifiedWindowedDom`). Computes `blockStart`/`blockEnd` from `effectiveScrollTop`/`blockHeightPx` (block-level windowing, 1-block overscan). Captures `effectiveScrollTop`/`effectiveClientHeight`/`effectiveScrollLeft`/`effectiveClientWidth` once before any DOM mutation. Calls `_removeNodesBetweenSpacers(topSpacer, bottomSpacer)`, then for each visible block `b` in `[blockStart, blockEnd]`: computes `start = b * p.blockWidth`, `end = Math.min(start + p.blockWidth, p.len)` (block range), calls `_buildUnifiedBlock(b, start, end, p.len, blockHeightPx, rowHeightPx, effectiveScrollTop, effectiveClientHeight, effectiveScrollLeft, effectiveClientWidth, charWidthPx, nameColWidthPx, p.nameLen, p.stickyNames, p.standard, p.ambiguous, p.blackThresh, p.darkThresh, p.lightThresh, p.enableBlack, p.enableDark, p.enableLight, p.conservationData, p.shouldRenderConsensus, p.consensusPosition, p.consensus, p.options, headerHeightPx)`. After the loop, resizes spacers and calls `_syncSelectionDomFromState()`.
  - `p.len` = full alignment length (used for `numBlocks` and spacer sizing only, not iteration).
  - `p.conservationData` = pre-computed full-length array (cached, not recomputed on scroll).
  - `p.consensus` = full-length consensus array (cached, not recomputed on scroll).
  - Also calls `_measureUnifiedColumnMetrics(null)` (returns cached charWidthPx/nameColWidthPx, O(1)) and reads `_unifiedHeaderHeightPx` (cached, O(1)).

### `_buildUnifiedBlock(blockIndex, start, end, len, blockHeightPx, rowHeightPx, effectiveScrollTop, clientHeight, scrollLeft, clientWidth, charWidthPx, nameColWidthPx, nameLen, stickyNames, standard, ambiguous, blackThresh, darkThresh, lightThresh, enableBlack, enableDark, enableLight, conservationData, shouldRenderConsensus, consensusPosition, consensus, options, headerHeightPxIn)`
- `blockLen = end - start` (block width).
- Computes `colStart`/`colEnd` from `scrollLeft`/`clientWidth`/`charWidthPx` (windowed, 20-col overscan): `colStart = Math.max(start, Math.floor(scrollLeft / charWidthPx) - 20)`, `colEnd = Math.min(end - 1, Math.ceil((scrollLeft + visibleDataWidth) / charWidthPx) - 1 + 20)`. `needsColWindow = colStart > start || colEnd < end - 1`.
- Ruler: `rulerLen = colEnd - colStart + 1` (windowed). Calls `generateScaleHTML(rulerLen, 10, colStart)` or `generateScale(rulerLen, 10, colStart)`. Applies `_applyColumnWindowStyle(scaleDataDiv, blockLen, colStart - start, charWidthPx)` if `needsColWindow`.
- Top consensus: `addConsensusLine(blockDiv, consensus, colStart, colEnd + 1, ...)` (windowed — the already-fixed bug). Applies `_applyColumnWindowStyle` if `needsColWindow`.
- Row windowing: `rowStart`/`rowEnd` from `effectiveScrollTop`/`clientHeight`/`rowHeightPx` (windowed, 15-row overscan). Builds top/bottom row spacers.
- For each row `i` in `[rowStart, rowEnd]`: `createSequenceLine(i, colStart, colEnd + 1, ...)`. Applies `_applyColumnWindowStyle` if `needsColWindow`.
- Bottom consensus: same as top consensus (windowed).

### Functions called by `_buildUnifiedBlock`

- **`generateScale(maxLength, interval=10, startPos=0)`** — `maxLength = rulerLen` (windowed). Creates array of `maxLength` chars. Loops `for (absPos = firstMultiple; absPos < endAbs; absPos += interval)` where `endAbs = startPos + maxLength`. Cost O(windowed cols).
- **`generateScaleHTML(maxLength, interval, startPos)`** — calls `generateScale(maxLength, interval, startPos)` (windowed), then loops `for (i = 0; i < maxLength; i++)` building one span per windowed column. Checks `state._diffColumns.has(absPos)` per column (Set O(1)). Cost O(windowed cols).
- **`_applyColumnWindowStyle(dataEl, len, colStart, charWidthPx)`** — sets `width = len * charWidthPx` and `paddingLeft = colStart * charWidthPx`. `len` = `blockLen` (block width, NOT windowed) — correct: the element's declared width must span the full block so horizontal scroll math works. O(1).
- **`addConsensusLine(parent, consensus, start, end, nameLen, stickyNames, blackThresh, darkThresh, lightThresh, enableBlack, enableDark, enableLight, showLength, position, options)`** — `start`/`end` = `colStart`/`colEnd + 1` (windowed). Loops `for (pos = start; pos < end; pos++)` building one span per windowed column. Per-span: `getResidueAnnotationClasses(base)` (O(1) string ops), `consensusDisplayBase(base, pos, threshold)` (loops over `state.seqs` for THIS column only — O(nSeq) per column, but only windowed columns), `state._diffColumns.has(pos)` (O(1)), trim/soft-trim checks (O(1)), hover listener attach (O(1)), `registerSpanInCache` if span cache enabled (O(1)). After loop: `_applyLineHighlights(dataSpan)` if repeat highlights. Cost O(windowed cols × nSeq).
  - `consensusDisplayBase(base, pos, threshold)` — loops `state.seqs.map(s => s.seq[pos])` once per call. Called once per windowed consensus column. O(nSeq) per column, windowed columns only. SAFE (windowed × nSeq).
  - `getResidueAnnotationClasses(base, ...)` — pure string/class computation, O(1). SAFE.

- **`createSequenceLine(index, start, end, nameLen, stickyNames, standard, ambiguous, blackThresh, darkThresh, lightThresh, enableBlack, enableDark, enableLight, showLength, conservationData)`** — `start`/`end` = `colStart`/`colEnd + 1` (windowed). Builds name span (O(1)). Builds data span: loops `for (pos = start; pos < end; pos++)` building one span per windowed column. Per-column work:
  - Breakpoint marker check: `brkBeforePos.has(pos)` (Set O(1)).
  - `getResidueAnnotationClasses(base, standard, ambiguous, effectiveColorScheme)` (O(1)).
  - `conservationData[pos]` lookup (O(1) array index).
  - `applyConservationShadeClass(baseUp, posData, renderConfig)` (O(1)).
  - Codon analysis: `state._codonData.phase[index][pos]` (O(1)), `.stops[index].includes(pos)` (O(stops per row) — small), `.frameShifts[index]` loop (per-row, tiny — a handful of frameshifts per row, not alignment-width), `.synNonSyn[index][pos]` (O(1)).
  - `state._diffColumns.has(pos)` (O(1)).
  - `selectedCols.has(pos)` (O(1)).
  - `getTsdMarkDisplay(index, pos)` — `state.tsdMarks?.get(rowIndex)` (Map O(1)), `.has(pos)` (Set O(1)). O(1).
  - After loop: `state._enableSpanCache` check, register spans in cache (O(windowed cols)).
  - `_applyLineHighlights(dataSpan)` if `state.repeatHighlights.size > 0`.
  - Cost O(windowed cols) + O(windowed cols) for span cache. SAFE (windowed).
  - **`_applyLineHighlights(dataSpan)`** — loops `dataSpan.children` (windowed spans only), inner loop over `state.repeatHighlights` Map. Cost O(windowed cols × numRepeatHighlights). Bounded by windowed cols. SAFE.
  - **Codon `.frameShifts[index]` inner loop**: `for (const fs of state._codonData.frameShifts[index])` runs per column. `frameShifts[index]` is the list of frameshifts for ONE row — typically tiny (a handful per row), not alignment-width. SAFE in practice, but technically O(windowed cols × frameshiftsPerRow). Not a full-width bug.

### Other functions reachable from the scroll path

- **`_removeNodesBetweenSpacers(topSpacer, bottomSpacer)`** — walks sibling list between two spacers, removes each. Number of removed nodes = previously-rendered blocks (bounded by previous viewport, not full alignment). O(prev viewport blocks). SAFE.
- **`_syncSelectionDomFromState()`** — calls `updateRowSelections()`, `updateColumnSelections()`, `scheduleNucSelectionRefresh()`, `updateEditActiveCell()`.
  - **`updateRowSelections()`** — `document.querySelectorAll('.seq-line.selected')` then `querySelectorAll('.seq-name.selected')` then per selected row `querySelectorAll('.seq-line[data-seq-index="N"]')`. Cost O(selectedRows × DOM query). Bounded by selection size, not alignment width. SAFE.
  - **`updateColumnSelections()`** — clears `state.domSelectedColumns` (removes class from previously-selected spans), then for each `state.selectedColumns` pos: `forEachColumnSpan(pos, callback)`. `forEachColumnSpan` uses `state.spanCache` first (O(1) per row that has a cached span at that pos), falling back to `querySelectorAll` only if cache empty. Cost O(selectedColumns × rowsWithCachedSpan). Bounded by selection size. SAFE.
  - **`scheduleNucSelectionRefresh()`** — rAF-deferred `refreshNucleotideSelectionsImmediate()`. Uses `forEachRowSpanAtPosition` (span cache O(1), fallback querySelectorAll). Bounded by `state.selectedNucs.size`. SAFE.
  - **`updateEditActiveCell()`** — `getSpanElement(row, pos)` (span cache O(1), fallback querySelectorAll). O(1). SAFE.

### Functions called by `createSequenceLine` / `addConsensusLine` (leaf-level)

- **`getResidueAnnotationClasses(base, standard, ambiguous, colorScheme)`** — pure string/class computation, no loops over ranges. O(1). SAFE.
- **`applyConservationShadeClass(baseUp, posData, config)`** — O(1) conditionals. SAFE.
- **`getTsdMarkDisplay(rowIndex, pos)`** — `state.tsdMarks?.get(rowIndex)` (Map O(1)), `.has(pos)` (Set O(1)). O(1). SAFE.
- **`getEffectiveColorScheme(scheme)`** — O(1) (memoized `isProteinAlignment` check). SAFE.
- **`getAlignmentColorScheme()`** — O(1) DOM read. SAFE.
- **`usesMonochromeShading(scheme)`** — O(1). SAFE.
- **`getResidueSchemeStyle(base, scheme)`** — O(1) (class lookup + palette lookup). SAFE.
- **`consensusDisplayBase(base, pos, threshold)`** — loops `state.seqs` once (O(nSeq)) for the single column `pos`. Called once per windowed consensus column. SAFE (windowed × nSeq).
- **`_escapeHtml(s)`** — O(len(s)), called on breakpoint symbol (1 char). O(1). SAFE.
- **`registerSpanInCache(row, pos, span)`** — Map set, O(1). SAFE.
- **`getCachedSpan(row, pos)`** — Map get, O(1). SAFE.
- **`ensureSpanCacheRow(row)`** — Map get/create, O(1). SAFE.
- **`forEachColumnSpan(pos, callback)`** — uses `state.spanCache` (only visible rows have cached spans), fallback `querySelectorAll`. O(visibleRows) per column. SAFE.
- **`forEachRowSpanAtPosition(row, pos, callback)`** — `getCachedSpan` (Map O(1)), fallback `querySelectorAll`. O(1) or O(DOM query). SAFE.
- **`getSpanElement(row, pos)`** — `getCachedSpan` (Map O(1)), fallback `querySelectorAll`. O(1) or O(DOM query). SAFE.

## Phase 1 classification

### Entry point
- **`_refreshUnifiedWindowOnScroll`** — **SAFE**. Iterates only over visible blocks `[blockStart, blockEnd]` computed from scroll position. `p.len` used only for `numBlocks` and spacer sizing, not iteration. Calls `_measureUnifiedColumnMetrics(null)` and reads `_unifiedHeaderHeightPx` (both O(1) cached when passed null).

### Block builder
- **`_buildUnifiedBlock`** — **SAFE**. All column iteration uses windowed `colStart`/`colEnd` (computed from `scrollLeft`/`clientWidth`/`charWidthPx`, 20-col overscan). Row iteration uses windowed `rowStart`/`rowEnd` (computed from `effectiveScrollTop`/`clientHeight`/`rowHeightPx`, 15-row overscan). `blockLen` passed to `_applyColumnWindowStyle` is for CSS width only, not iteration. `headerHeightPxIn` is a cached value passed through, not recomputed.

### Ruler
- **`generateScale(maxLength, interval, startPos)`** — **SAFE**. `maxLength = rulerLen = colEnd - colStart + 1` (windowed). Loops `for (absPos = firstMultiple; absPos < endAbs; absPos += interval)` where `endAbs = startPos + maxLength`. O(windowed cols).
- **`generateScaleHTML(maxLength, interval, startPos)`** — **SAFE**. Calls `generateScale(maxLength, interval, startPos)` (windowed), then loops `for (i = 0; i < maxLength; i++)` building one span per windowed column. Checks `state._diffColumns.has(absPos)` per column (Set O(1)). O(windowed cols).

### Column windowing
- **`_applyColumnWindowStyle(dataEl, len, colStart, charWidthPx)`** — **SAFE**. Sets `width = len * charWidthPx` and `paddingLeft = colStart * charWidthPx`. `len = blockLen` (block width, NOT windowed) — correct: the element's declared width must span the full block so horizontal scroll math works. O(1).

### Consensus
- **`addConsensusLine(parent, consensus, start, end, ...)`** — **SAFE** (after prior fix). `start`/`end` = `colStart`/`colEnd + 1` (windowed). Loops `for (pos = start; pos < end; pos++)` building one span per windowed column. Per-span: `getResidueAnnotationClasses` (O(1)), `consensusDisplayBase` (O(nSeq) per column, windowed only), `state._diffColumns.has(pos)` (O(1)), trim/soft-trim checks (O(1)), hover listener attach (O(1)), `registerSpanInCache` (O(1)). After loop: `_applyLineHighlights` if repeat highlights. O(windowed cols × nSeq).
- **`consensusDisplayBase(base, pos, threshold)`** — **SAFE**. Loops `state.seqs.map(s => s.seq[pos])` once per call (O(nSeq)). Called once per windowed consensus column. O(windowed cols × nSeq) total.

### Sequence rows
- **`createSequenceLine(index, start, end, ...)`** — **SAFE**. `start`/`end` = `colStart`/`colEnd + 1` (windowed). Builds name span (O(1)). Loops `for (pos = start; pos < end; pos++)` building one span per windowed column. Per-column: breakpoint `brkBeforePos.has(pos)` (Set O(1)), `getResidueAnnotationClasses` (O(1)), `conservationData[pos]` (O(1) array index), `applyConservationShadeClass` (O(1)), codon `phase[index][pos]` (O(1)), `stops[index].includes(pos)` (O(stops per row) — small), `frameShifts[index]` loop (per-row, tiny — handful of frameshifts), `synNonSyn[index][pos]` (O(1)), `state._diffColumns.has(pos)` (O(1)), `selectedCols.has(pos)` (O(1)), `getTsdMarkDisplay` (O(1)). After loop: span cache register (O(windowed cols)), `_applyLineHighlights` if repeat highlights. O(windowed cols) total.
- **`_applyLineHighlights(dataSpan)`** — **SAFE**. Loops `dataSpan.children` (windowed spans only), inner loop over `state.repeatHighlights` Map. O(windowed cols × numRepeatHighlights). Bounded by windowed cols.

### Node removal
- **`_removeNodesBetweenSpacers(topSpacer, bottomSpacer)`** — **SAFE**. Walks sibling list between two spacers, removes each. Number of removed nodes = previously-rendered blocks (bounded by previous viewport, not full alignment). O(prev viewport blocks).

### Selection sync
- **`_syncSelectionDomFromState()`** — **SAFE** (with one caveat, see `forEachColumnSpan` below). Calls `updateRowSelections()`, `updateColumnSelections()`, `scheduleNucSelectionRefresh()`, `updateEditActiveCell()`.
- **`updateRowSelections()`** — **SAFE**. `document.querySelectorAll('.seq-line.selected')` then per selected row `querySelectorAll('.seq-line[data-seq-index="N"]')`. In windowed render, DOM only contains visible rows, so querySelectorAll is O(viewport DOM). Cost O(selectedRows × viewport DOM). Bounded by selection size.
- **`updateColumnSelections()`** — **SUSPECT (minor)**. Calls `forEachColumnSpan(pos, callback)` per selected column. `forEachColumnSpan` iterates over ALL entries in `state.spanCache` (see below). Cost O(selectedColumns × totalRowsInCache). Bounded by selection size, not alignment width. Each iteration is very cheap (Map.get + classList.add on a detached span). NOT the "full width, not window" bug class — it's a stale-cache issue.
- **`scheduleNucSelectionRefresh()`** — **SAFE**. rAF-deferred `refreshNucleotideSelectionsImmediate()`. Uses `forEachRowSpanAtPosition` (span cache O(1) per row, fallback querySelectorAll). Bounded by `state.selectedNucs.size`.
- **`updateEditActiveCell()`** — **SAFE**. `getSpanElement(row, pos)` (span cache O(1), fallback querySelectorAll). O(1).

### Span cache helpers
- **`forEachColumnSpan(pos, callback)`** — **SUSPECT (minor)**. Iterates over ALL rows in `state.spanCache` via `state.spanCache.forEach(rowMap => ...)`. The span cache is NOT cleared during scroll-triggered refreshes (`_refreshUnifiedWindowOnScroll` removes old DOM nodes and builds new ones, registering new spans via `registerSpanInCache`, but never removes stale entries for no-longer-visible rows). After scrolling through the entire alignment, the cache can contain entries for ALL rows, with references to detached spans. O(totalRowsInCache) per column, not O(visibleRows). However: (1) cost is bounded by selection size (only called for selected columns), (2) each iteration is very cheap (Map.get + classList.add on a detached span), (3) the cache IS cleared on every full `renderAlignment()` call (mode change, zoom, file load, etc.). NOT the "full width, not window" bug class — it's a stale-cache issue.
- **`forEachRowSpanAtPosition(row, pos, callback)`** — **SAFE**. `getCachedSpan` (Map O(1)), fallback `querySelectorAll`. O(1) or O(DOM query). Not affected by stale cache because it looks up by specific (row, pos), not iterating over all rows.
- **`getSpanElement(row, pos)`** — **SAFE**. `getCachedSpan` (Map O(1)), fallback `querySelectorAll`. O(1) or O(DOM query).
- **`registerSpanInCache(row, pos, span)`** — **SAFE**. Map set, O(1). Overwrites old entry for same (row, pos) pair.
- **`getCachedSpan(row, pos)`** — **SAFE**. Map get, O(1).
- **`ensureSpanCacheRow(row)`** — **SAFE**. Map get/create, O(1).

### Leaf-level functions (called by createSequenceLine / addConsensusLine)
- **`getResidueAnnotationClasses(base, standard, ambiguous, colorScheme)`** — **SAFE**. Pure string/class computation, no loops over ranges. O(1).
- **`applyConservationShadeClass(baseUp, posData, config)`** — **SAFE**. O(1) conditionals.
- **`getTsdMarkDisplay(rowIndex, pos)`** — **SAFE**. `state.tsdMarks?.get(rowIndex)` (Map O(1)), `.has(pos)` (Set O(1)). O(1).
- **`getEffectiveColorScheme(scheme)`** — **SAFE**. O(1) (memoized `isProteinAlignment` check).
- **`getAlignmentColorScheme()`** — **SAFE**. O(1) DOM read.
- **`usesMonochromeShading(scheme)`** — **SAFE**. O(1).
- **`getResidueSchemeStyle(base, scheme)`** — **SAFE**. O(1) (class lookup + palette lookup).
- **`_escapeHtml(s)`** — **SAFE**. O(len(s)), called on breakpoint symbol (1 char). O(1).
- **`isProteinAlignment(seqs)`** — **SAFE**. Memoized by array identity (`seqs === _proteinMemoArr`). `state.seqs` is the same reference across scroll-refreshes. O(1) after first call.
- **`_measureUnifiedColumnMetrics(null)`** — **SAFE**. Returns cached values when called with null. O(1).
- **`_measureUnifiedHeaderHeight(null)`** — **SAFE**. Returns cached values when called with null. O(1).

## Confirmed bugs found and fixed
(none yet)

## Suspects investigated and ruled out (false positives)
(none yet)

## Needs human verification
- **`forEachColumnSpan` / `updateColumnSelections` stale-cache issue**: The span cache (`state.spanCache`) is NOT cleared during scroll-triggered refreshes (`_refreshUnifiedWindowOnScroll` only removes old DOM nodes via `_removeNodesBetweenSpacers` and builds new ones, registering new spans via `registerSpanInCache` — but never removes stale entries for no-longer-visible rows). After extensive scrolling, the cache can contain entries for ALL rows, with references to detached spans. `forEachColumnSpan` iterates over ALL entries in the cache, making `updateColumnSelections` O(selectedColumns × totalRowsInCache) instead of O(selectedColumns × visibleRows). This is NOT the "full width, not window" bug class — it's a stale-cache issue bounded by selection size, not alignment width. Each iteration is very cheap (Map.get + classList.add on a detached span). The cache IS cleared on every full `renderAlignment()` call (mode change, zoom, file load, etc.), so it only grows during pure scroll sessions. Needs human verification to determine if this causes measurable scroll jank when many columns are selected on a very tall alignment after extensive scrolling.

## Notes for the next run
Phase 1 is complete. All functions in the scroll-refresh call graph have been classified. The only SUSPECT is `forEachColumnSpan` / `updateColumnSelections` (stale span cache growing during scroll), which is a minor issue bounded by selection size, not the "full width" bug class. Next phase (Phase 2): investigate the `forEachColumnSpan` stale-cache issue and decide whether to fix it (e.g., clear stale entries on scroll-refresh by resetting `state.spanCache` at the start of `_refreshUnifiedWindowOnScroll` and rebuilding from the new blocks) or document it as a false positive (cost is bounded by selection size, each iteration is very cheap, and the cache is reset on any full render). If ruled out, mark all phases complete.
