# GLM (glm.js, glm-5.2) check of manual claims, 2026-09-24

25 claims that an earlier GLM audit had marked MATCH, re-asked one narrow task at a time
(tasks and raw outputs in this folder), then checked independently against the code.

| Claim | Task | GLM verdict | Independent check / action |
|---|---|---|---|
| 3 | 01-genbank-paste-history | MATCH | MATCH |
| 8 | 01-genbank-paste-history | MISMATCH | MISMATCH (BLAST not recorded; reload only for pastes and files with a saved handle) |
| 11 | 02-mafft-adjust-reorder | MATCH | MATCH |
| 12 | 02-mafft-adjust-reorder | MATCH | MATCH |
| 13 | 03-realign-block-addseq | MATCH | MATCH |
| 14 | 03-realign-block-addseq | MISMATCH | MISMATCH (full realignment, not add-keep-length) |
| 15 | 04-blast-sw | MATCH | MATCH |
| 23 | 05-clustering-panel | MATCH | MATCH |
| 25 | 05-clustering-panel | MATCH | MATCH |
| 27 | 05-clustering-panel | MATCH | MATCH |
| 31 | 06-clusterability-2d | UNCLEAR | MATCH (block-bicluster.js 850-887 uses minSize/minPerfect) |
| 34 | 06-clusterability-2d | UNCLEAR | MATCH, plus a gap: no overlay in the windowed display either |
| 35 | 06-clusterability-2d | UNCLEAR | MATCH (5 presets, 8 knobs, recompute on change) |
| 37 | 07-search | MATCH | MATCH |
| 38 | 07-search | MISMATCH | MISMATCH (mismatches ignored with regex) |
| 36 | 07-search | MATCH | MATCH |
| 41 | 08-edit-tools | MISMATCH | MISMATCH (Type takes any letter, stored upper case) |
| 43 | 09-seqedit-undo | MATCH | MATCH |
| 44 | 09-seqedit-undo | MATCH | MATCH |
| 46 | 10-tree-stats | MATCH | MATCH |
| 47 | 10-tree-stats | MATCH | MATCH (tested: drawing shrinks to 25%) |
| 48 | 10-tree-stats | MATCH | MATCH |
| 53 | 11-export-server | MATCH | MATCH (list omits JSON snapshot and order file) |
| 56 | 11-export-server | MISMATCH | Sufficient but untested; code needs Node 14+, tested on 24 |
| 13k | 12-shortcut-bits | MISMATCH | MISMATCH (two separate single columns blocked hard-refresh) - code fixed |
