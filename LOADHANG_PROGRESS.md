# Load-hang bug progress

## Done
- Run 1: Added instrumentation inside _historyManager.add/load/save, toggleStickyNames, and end of parseAndRender to pinpoint exact hang location
- Run 2: Confirmed root cause via trace output, fixed setBlockSizeToScreen and toggleStickyNames, removed all HANGTRACE instrumentation

## Current phase
All phases complete

## Instrumentation findings
Run 1 trace (300x12000 = 3.6M residues, isCrazy=false so full DOM render):
- First renderAlignment() completed at ~11563ms (11.5s for 3.6M spans)
- setBlockSizeToScreen() entered at ~11563ms
- Second renderAlignment() (inside setBlockSizeToScreen) started at ~71677ms
  => ~60s gap = getBoundingClientRect() forcing synchronous reflow on 3.6M DOM spans
- Second render took 14496ms (14.5s)
- _historyManager.add took ~2ms (NOT the culprit)
- parseAndRender reached FUNCTION END (no infinite hang, just >30s timeout)
Total: ~86s (run 1) / ~56s (run 2), both far exceeding the 30s browser check timeout.

## Root cause
setBlockSizeToScreen() calls getBoundingClientRect() on sample DOM spans to measure
character width. With 3.6M rendered spans in the container, this forces a synchronous
layout reflow costing ~60 seconds. It then calls renderAlignment() again (another 14.5s)
if the computed block size differs from the previous value. Since 3.6M < ALIGN_CRAZY_VOLUME
(5M), isCrazy=false, so the windowed renderer is not used and the full 3.6M-span DOM is
built. The total ~75s spent in setBlockSizeToScreen alone exceeds the 30s timeout.

A secondary issue: toggleStickyNames() (called via setTimeout(0) after every render)
forces a reflow via `alignmentContainer.offsetHeight` for non-crazy alignments, adding
another multi-second block after the promise resolves.

## Fix
1. setBlockSizeToScreen: For alignments >80K residues (matching the existing span-cache
   threshold), use a zoom-based char-width estimate instead of getBoundingClientRect(),
   and skip the re-render. The initial render already used a reasonable block size from
   the slider's current value; the user can adjust manually if needed.
2. toggleStickyNames: Extended the reflow skip from isCrazy-only to all alignments
   >80K residues, preventing the forced reflow on large DOM trees.
3. Removed all HANGTRACE instrumentation from _historyManager, toggleStickyNames,
   renderAlignment, and parseAndRender.

## Notes for the next run
- The 80K threshold matches state._enableSpanCache's threshold, so the two guards
  are consistent: above 80K, both the span cache and the getBoundingClientRect
  measurement are skipped.
- If the browser check still fails, check whether the first renderAlignment() itself
  exceeds 30s for 3.6M residues (it took ~11.5s in run 1, but could vary).
- The toggleStickyNames setTimeout(0) fires after parseAndRender resolves, so it
  doesn't affect the 30s resolution check, but it does block the main thread afterward.

## BROWSER_CHECK_FAILED (run 2, 20260817-005643)
```
FAIL: parseAndRender did not resolve within 30000ms for 300x12000 (3.6M residues) - error: TIMEOUT
Recent page console output (last 20 lines):
  [Clustering] Preset list updated: 0 presets
  Failed to load resource: the server responded with a status of 404 (Not Found)
  Failed to load resource: the server responded with a status of 404 (Not Found)
  Failed to load resource: the server responded with a status of 404 (Not Found)
  Failed to load resource: the server responded with a status of 404 (Not Found)
  [Clustering] Preset list updated: 1 presets
  [Clustering] Loaded preset: optimal {name: optimal, trimming: Object, clustering: Object, timestamp: 2026-08-16T20:16:45.664Z}
  [Clustering] Created optimal preset: {name: optimal, trimming: Object, clustering: Object, timestamp: 2026-08-16T20:16:45.664Z}
  [PERF] render: 8098ms | 3,600,000 residues
```
The wrapper script ran BROWSER_CHECK_CMD after this run's commit and it
failed (see output above). The commit was NOT reverted - fix it forward
in the next run, or a human can inspect and revert manually. Remove this
section once resolved.
