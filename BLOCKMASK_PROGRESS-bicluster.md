## Current phase

Fixed `bestRowSplit`'s `ROW_MIN_GAP_ABS` fallback default from 0.15 to 0.08 so the real 0.68→0.77 match-rate gap in `mosaic_subset`'s planted 5-of-20 shared-tail group is no longer rejected. Awaiting verification via `node tests/bicluster/oracle.js`.
