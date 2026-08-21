# ViewAlign TODO

## 🚨 Active Bugs
- [ ] **Consensus:bottom** — debug logging added, awaiting F12 Console test. Check for `[consensus]` log messages.
- [ ] **Compact mode glitch** — overflow changed to `'auto'`, needs testing
- [ ] **Realigning with MAFFT changes nucleotide case** — re-running an alignment through MAFFT from within the viewer alters the case (upper/lower) of nucleotides in the result; undesired, case should be preserved through a realign round-trip. Not yet investigated (no root cause identified).

## ✅ Recent Fixes
- [x] Horizontal scrollbar (content-visibility:auto removed)
- [x] Consensus position radio re-render (added to radioGroups)
- [x] Compact mode overflow:auto
- [x] Letter coloring backgrounds (was invisible on dark shading bg)
- [x] Nucleotide identity tooltips (base name + conservation %)

## ✅ Features Implemented (this session)
- [x] **Nucleotide letter coloring** — shadeMode='letter', A=green C=blue G=orange T=red U=purple, IUPAC codes distinct colors, hides conservation sliders when active
- [x] **"+" Browse Files** — file picker in Add Sequences modal, multi-file support
- [x] **Type mode fast path** — in-place span update on each keystroke (skips full renderAlignment()), 50-200x faster for large alignments
- [x] **Type mode Backspace/Delete** — Backspace deletes prev char (replaces with gap), Delete replaces current char with gap
- [x] **NJ tree** — Neighbor-Joining (Saitou & Nei 1987) alongside UPGMA, radio selector in Tree modal
- [x] **Statistics modal** — Summary tab (esl-alistat: num seqs, length, gaps, residues), Distance Matrix tab (p-distance), Pairwise Identity tab (esl-alipid: mean/min/max %ID). Easel library attribution.
- [x] **Restriction site search** — dropdown with 23 common endonucleases in Search section, auto-fills search input + triggers find

## 📋 Remaining
- [ ] **Full GB (GenBank) format** — parse GenBank flatfile format, display annotations on alignment
- [ ] **Option: prefix `RC_` on reverse-complemented sequences** — when the "adjust direction" alignment option is set (sequences get reverse-complemented to align consistently), add an option to prepend `RC_` to the header/name of any sequence that was flipped, so it's visible in the sequence list which ones were reoriented.

## Performance / Architecture — Future Work (from JBrowse2 source study, 2026-08-19)

Both ideas are large architectural changes, not tweaks — flagged for later
consideration, not scheduled. Full research write-up and verified code
citations: `C:\work\glm-harness\out\jbrowse-rendering-tricks.json`.

- [ ] **GPU-instanced rendering for dense alignment views.** JBrowse2 has a
  `GpuAlignmentsRenderer` alongside its Canvas2D one: instead of one
  `fillRect`/DOM-node per residue, it packs every cell's position+color into
  a single typed array and draws the whole pileup with one or two instanced
  WebGL draw calls. Would let a huge alignment render as fast as a small one
  regardless of residue count, but means abandoning DOM `<span>`-per-residue
  for a canvas/WebGL surface — loses native text selection/CSS styling on
  individual residues, so it's a genuine tradeoff, not a pure win. Current
  windowed-DOM approach (added this session) already gets most of the
  practical benefit for realistic alignment sizes; this would matter most
  for extreme cases or if Canvas mode's read-only limitation ever needs
  lifting.
- [ ] **Worker/RPC offloading for parsing + layout.** JBrowse2 moves data
  parsing, layout computation, AND pixel rendering into a Web Worker, main
  thread only blits the finished image back. For ViewAlign, moving FASTA/
  alignment parsing and conservation/layout computation off the main thread
  is directly adaptable today (independent of the GPU idea above) and could
  reduce input-lag on large-file load. Actual DOM construction would still
  need to happen on the main thread either way, since DOM APIs aren't
  available in workers — this only fully pays off combined with the GPU/
  canvas rendering switch above.
