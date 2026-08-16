
## BROWSER_CHECK_FAILED (run 1, 20260817-002038)
```
FAIL: parseAndRender did not resolve within 30000ms for 300x12000 (3.6M residues) - error: TIMEOUT
Recent page console output (last 20 lines):
  [HANGTRACE] renderAlignment before final syncCodonModePanel 11563.100000023842
  [HANGTRACE] renderAlignment DONE 11563.200000047684
  [HANGTRACE] after renderAlignment #1 11563.300000011921
  [HANGTRACE] before setBlockSizeToScreen 11563.300000011921
  [PERF] render: 14496ms | 3,600,000 residues
  [HANGTRACE] renderAlignment after perf log 86173.70000004768
  [HANGTRACE] renderAlignment after applyColourToSeqNames 86173.90000003576
  [HANGTRACE] renderAlignment after reapplySearchHighlights 86174.10000002384
  [HANGTRACE] renderAlignment after applyClusterVisualsFromState 86174.20000004768
  [HANGTRACE] renderAlignment before final syncCodonModePanel 86174.30000001192
  [HANGTRACE] renderAlignment DONE 86174.5
  [HANGTRACE] after setBlockSizeToScreen 86174.60000002384
  [HANGTRACE] before setupHoverMenuReveal 86174.60000002384
  [HANGTRACE] after setupHoverMenuReveal 86174.80000001192
  [HANGTRACE] before showMessage 86174.80000001192
  [HANGTRACE] after showMessage 86175
  [HANGTRACE] before _historyManager.add 86175.10000002384
  [HANGTRACE] after _historyManager.add 86177.20000004768
  [HANGTRACE] before setTimeout 86177.30000001192
  [HANGTRACE] parseAndRender try block complete 86177.40000003576
```
The wrapper script ran BROWSER_CHECK_CMD after this run's commit and it
failed (see output above). The commit was NOT reverted - fix it forward
in the next run, or a human can inspect and revert manually. Remove this
section once resolved.
