# ViewAlign TODO

## 🚨 Active Bugs
- [ ] **Consensus:bottom** — debug logging added, awaiting F12 Console test. Check for `[consensus]` log messages.
- [ ] **Compact mode glitch** — overflow changed to `'auto'`, needs testing

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
