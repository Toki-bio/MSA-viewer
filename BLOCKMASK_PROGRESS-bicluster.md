## Current phase

Implemented all six stubbed functions in block-bicluster.js per their docstring specs. Awaiting verification via `node tests/bicluster/oracle.js`.

## BROWSER_CHECK_FAILED (run 1, 20260912-013323)
```
FAIL (2):
  - mosaic_subset: at least one row-split block found -- zero row-split blocks -- the known 5-of-20 shared-tail group was not detected at all
  - mosaic_subset: a row-split block of plausible size (3-8 rows) exists -- row-split block sizes found: 
```
The wrapper script ran BROWSER_CHECK_CMD after this run's commit and it
failed (see output above). The commit was NOT reverted - fix it forward
in the next run, or a human can inspect and revert manually. Remove this
section once resolved.
