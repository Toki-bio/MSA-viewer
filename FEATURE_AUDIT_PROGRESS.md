# Feature inventory audit progress

## Done
- Input & Format Support section audited AND applied to features-inventory.md (Claude, at merge time - see note below)
- Visualization & Rendering section audited and applied
- Sequence Colouring System section audited and applied
- Editing Operations section audited and applied

## Current phase
Analysis Tools (next)

## IMPORTANT correction to this progress log (Claude, at merge time)
Corrections 1-4 below (Input & Format Support) were investigated correctly
but the actual edit to `features-inventory.md` was NEVER APPLIED by the run
that wrote them - confirmed by diffing the committed file, which still had
the original stale text ("11 CIGAR operations", "/api/bam2sam", "?file=")
right up until this merge. A stray file also existed
(`I'll start by reading the current...FEATURE_AUDIT_PROGRESS.md` - deleted)
containing a duplicate/abandoned copy of these same progress notes, which is
consistent with that run hitting its context/token limit after investigating
but before successfully writing the real file edit and committing it -
the same failure mode documented elsewhere this session. Independently
re-verified the underlying facts in corrections 1-4 directly against
script.js (CIGAR regex only matches 9 op types incl. no B; no `/api/bam2sam`
anywhere, `BamParser.decompressBAM()` confirmed; `LOCUS` GenBank detection
confirmed; `url`/`data`/`snapshot`/`snapshotFile`/`title` URL params all
confirmed) before applying them - all four were correct, just never written.
**Lesson for future runs: verify with `grep` that your intended text
replacement is actually present in the file on disk before writing "pending
commit" and moving on - the progress log describing a fix is not the same
as the fix existing.**

## Corrections made
1. "8-format automatic detection" → "9-format": Added GenBank (auto-detected by LOCUS header, was completely missing from the doc). Removed CRAM (not supported in code). Clarified BAM is detected by file extension, not content inspection. Updated format count and novelty text.
2. "Full CIGAR expansion for SAM": Corrected "11 CIGAR operations" to "9" (M, I, D, N, S, H, P, =, X). Removed B (not handled by _expandCigar) and removed separate "soft-clip" listing (S IS soft-clip). Added supplementary alignments (flag 0x800) to the filtering description — code filters 0x904 = 0x4|0x100|0x800.
3. "BAM/CRAM via server pipeline" → "Client-side BAM parsing": Complete rewrite. No /api/bam2sam endpoint exists in script.js. BAM is parsed client-side via BamParser.decompressBAM(). CRAM is not supported. Updated to describe actual client-side implementation.
4. "URL parameter loading": Changed ?file= to ?url= (actual parameter name in code). Added ?data= (base64 inline alignment text) and ?snapshot= (base64 snapshot JSON) parameters that the code supports but the doc omitted. Fixed "ViewAlign" typo to "MSA viewer" in novelty text.
5. "5 interchangeable view modes" → "4 interchangeable view modes": Code has 4 mode radios (Full/Block/Canvas/Reads). "Variable Sites Only" is a checkbox overlay, not a mode. "Compact" was renamed to "Reads". Updated mode list and novelty text.
6. "Canvas renderer with automatic activation": Changed threshold from 150,000 to 5,000,000 (code: CANVAS_AUTO_THRESHOLD = ALIGN_CRAZY_VOLUME = 5_000_000). Removed "GPU-composited" (standard Canvas 2D context). Changed "toast notification" to "status message".
7. "Compact mode (IGV-style read packing) — removed, may return" → "Reads mode (IGV-style read packing)": Complete rewrite. Compact was renamed to Reads (modeReads). renderReadsAlignment() implements SVG track packing, mismatch coloring, soft-clip display, deletion gaps, insertion ticks, "Show bases" toggle. Coverage histogram and paired-end connection lines do NOT exist in code — removed. Added accurate features (cap marks, click-to-highlight, status line info).
8. Comparison table "Compact reads" → "Reads mode" and "View modes | 5" → "4" to resolve the Compact/Reads contradiction.
9. "Manual colour assignment" subsection removed entirely: No per-sequence colour picker UI exists. Colours are only assigned via pattern matching, auto-similarity clustering, or preset loading. The claim described a feature (individual sequence colour picker) that does not exist in the code.
10. "Auto-colour by name similarity": Changed "Levenshtein distance" to "position-weighted n-gram Jaccard similarity" — code uses `ngramJaccardSimilarity()`, not Levenshtein.
11. "Auto-colour by name similarity": Changed "0 = permissive, 10 = strict" to "0 = strict 90% threshold, 10 = permissive 40% threshold" — code has `minSim = 0.90 - (sensitivity/10) * 0.50`, so 0 is strictest and 10 is loosest (opposite of what the doc said).
12. "Cluster-based colouring": Changed "Hovering a cluster row in the results panel highlights all member sequences with glow effect" to "A 'Highlight in alignment' button in the results panel highlights all member sequences" — code uses a click button (`highlightCluster()`), not hover, and applies 20% opacity background colour, not a glow effect.
13. "Colour history inspector": Changed method tags from "(Manual, Auto-Similarity, Pattern, Cluster)" to "(Pattern, Auto-Similarity)" — only `applyPatternColour()` and `autoColourBySimilarity()` call `recordColorHistory()`. No "Manual" tag (manual assignment doesn't exist) and no "Cluster" tag (cluster colouring doesn't call `recordColorHistory`).
14. "GeneDoc-style residue editor": Corrected "Typing `-` inserts a gap column" to "Typing `-` or `.` replaces the current residue with a gap character at that position (does not insert a gap column)". Corrected "Conservation shading recomputes live as you type" to "The edited span's shading updates immediately using cached conservation data; full conservation recomputation and gapless position cache updates happen on the next render." Added that the "Live conservation" toggle applies to Move/Slide drags, not typing.
15. "Full undo/redo with visual dropdown": Corrected "TSD marking" in the undo stack list — only lowercase TSD marking uses the main undo stack; colour and bold TSD marking use a separate undo mechanism. Corrected "chronological order" to "reverse chronological order (most recent first)".
16. "Insert group consensus": Corrected "above or below" to "below" (code only inserts below the last selected sequence). Corrected "The threshold is independently adjustable per operation (separate from the global consensus threshold)" — it uses the global consensus controls, not per-operation settings.
17. "Add & Align with consensus profile merging": Corrected to distinguish two separate operations: "Just Add" with "Align to consensus" uses the profile merging algorithm; "Add & Align" performs a full MAFFT realignment. The original claim conflated these.

## Claims confirmed accurate
- Recent files history: localStorage-backed, 100KB cap (substring(0,100000)), adjustable 1-50 (Math.max(1,Math.min(50,n))), one-click reload, survives restarts. All accurate.
- Cross-mode Highlight Diffs + Variable Sites Only: Both use the same diffCols set computed once in _computeVarSites(). Highlight Diffs adds .highlight-diffs body class, Variable Sites Only adds .var-sites-only body class. Structure accurate, but opacity was wrong (document said 25%, CSS is 0.4/40% — corrected).
- Canvas renderer: viewport culling confirmed (draw() computes firstCol/lastCol/firstRow/lastRow from offsets). Auto-activation confirmed (renderAlignment checks TOTAL_RESIDUES > CANVAS_AUTO_THRESHOLD). Mouse wheel + click-drag panning confirmed. User override via _userDismissedAutoCanvas confirmed.
- Reads mode: renderReadsAlignment() confirmed. assignReadTracks() greedy packing confirmed. Soft-clip display, deletion gaps, insertion ticks, mismatch coloring, "Show bases" toggle all confirmed in code. Coverage histogram NOT found. Paired-end connection lines NOT found (SAM pair data stored in _samPair but never drawn).
- Pattern-based colouring: `applyPatternColour()` creates regex with 'i' flag, tests headers, assigns colour, records history with 'Pattern' tag. Accurate.
- Copy by colour: `copySequencesByColor(colour, ungapped, asFasta)` filters by colour from `colourState.mappings`, available in context menu. Accurate.
- Group/sort by colour: `groupColoredSequencesAtTop()` and `sortSequencesByColor()` work as described. Accurate.
- Auto-colour discrete mode: ColorBrewer/Tableau-inspired 12-colour palette + golden-ratio hue distribution for >12 clusters. Accurate.
- Auto-colour gradient mode: HSL shading by normalized key with varying lightness. Accurate.
- "Guarantees identical-prefix sequences always share the same colour": Hard guarantee via `keyToNames` map in `clusterByName()`. Accurate.
- Drag-and-drop row reordering: _startRowReorderDrag, _handleRowReorderMove, _finishRowReorderDrag, _moveDraggedSequences all confirmed. Visual insertion indicator via _getDragIndicatorEl. Multi-selection drag via _getDraggedIndices. Accurate.
- Three sort operations: sortByName (localeCompare), sortByLength (gapless length descending), sortBySimilarity (pairwise identity to first sequence). All accurate.
- Save / Load sequence order: exportOrder (JSON with version/exported/count/order), importOrder (file picker, reorders by header, handles missing/extra). pushUndo called. Accurate.
- Replace selected with consensus: replaceSelectedWithConsensus computes consensus, deletes selected, inserts cons_seqX-Y. pushUndo('replaceWithConsensus'). Accurate.
- Block degapping: degapSelectedBlock('left'|'right') removes gaps, compacts residues, removes all-gap columns. pushUndo called. Accurate.
- Block realignment: realignSelectedBlock extracts block, de-gaps, MAFFT realigns, splices back. Pads to new block width. Accurate.
- SeqEdit bulk transformations: seqEditDegap/Reverse/Complement/RevComp/Uppercase/Lowercase. seqEditPadGaps checkbox for length normalization. pushUndo called. Accurate.
- Reorder by guide tree: _reorderByGuideTree, _kmerGuideTree (6-mer vectors, Jaccard distances, UPGMA, 4-orientation search at junctions). Accurate.

## Needs human decision
(none)

## Notes for the next run
- Editing Operations section complete. Next: Analysis Tools section.
- Novelty Spotlight item 8 still says "IGV-style compact read packing" with "paired-end connection lines, diffs-only mode, coverage histogram" — needs correction in that phase (coverage histogram and paired-end lines don't exist).
- Comparison table "Canvas large-align" row says "auto threshold" without a number — fine for the table, but verify other comparison table claims in the final phase.
- The "Reads mode" row in the comparison table was updated to resolve the BROWSER_CHECK contradiction, but the full comparison table audit is still pending (last phase).

