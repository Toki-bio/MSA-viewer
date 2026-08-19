# Feature inventory audit progress

## Done
- Input & Format Support section audited (pending commit)
- Visualization & Rendering section audited (pending commit)
- Sequence Colouring System section audited (pending commit)

## Current phase
Editing Operations (next)

## Corrections made
1. "8-format automatic detection" → "9-format": Added GenBank (auto-detected by LOCUS header, was completely missing from the doc). Removed CRAM (not supported in code). Clarified BAM is detected by file extension, not content inspection. Updated format count and novelty text.
2. "Full CIGAR expansion for SAM": Corrected "11 CIGAR operations" to "9" (M, I, D, N, S, H, P, =, X). Removed B (not handled by _expandCigar) and removed separate "soft-clip" listing (S IS soft-clip). Added supplementary alignments (flag 0x800) to the filtering description — code filters 0x904 = 0x4|0x100|0x800.
3. "BAM/CRAM via server pipeline" → "Client-side BAM parsing": Complete rewrite. No /api/bam2sam endpoint exists in script.js. BAM is parsed client-side via BamParser.decompressBAM(). CRAM is not supported. Updated to describe actual client-side implementation.
4. "URL parameter loading": Changed ?file= to ?url= (actual parameter name in code). Added ?data= (base64 inline alignment text) and ?snapshot= (base64 snapshot JSON) parameters that the code supports but the doc omitted. Fixed "ViewAlign" typo to "MSA viewer" in novelty text.
5. "5 interchangeable view modes" → "4 interchangeable view modes": Code has 4 mode radios (Full/Block/Canvas/Reads). "Variable Sites Only" is a checkbox overlay, not a mode. "Compact" was renamed to "Reads". Updated mode list and novelty text.
6. "Canvas renderer with automatic activation": Changed threshold from 150,000 to 5,000,000 (code: CANVAS_AUTO_THRESHOLD = ALIGN_CRAZY_VOLUME = 5_000_000). Removed "GPU-composited" (standard Canvas 2D context). Changed "toast notification" to "status message".
7. "Compact mode (IGV-style read packing) — removed, may return" → "Reads mode (IGV-style read packing)": Complete rewrite. Compact was renamed to Reads (modeReads). renderReadsAlignment() implements SVG track packing, mismatch coloring, soft-clip display, deletion gaps, insertion ticks, "Show bases" toggle. Coverage histogram and paired-end connection lines do NOT exist in code — removed. Added accurate features (cap marks, click-to-highlight, status line info).
8. Comparison table "Compact reads" → "Reads mode" and "View modes | 5" → "4" to resolve the Compact/Reads contradiction.

## Claims confirmed accurate
- Recent files history: localStorage-backed, 100KB cap (substring(0,100000)), adjustable 1-50 (Math.max(1,Math.min(50,n))), one-click reload, survives restarts. All accurate.
- Cross-mode Highlight Diffs + Variable Sites Only: Both use the same diffCols set computed once in _computeVarSites(). Highlight Diffs adds .highlight-diffs body class, Variable Sites Only adds .var-sites-only body class. Structure accurate, but opacity was wrong (document said 25%, CSS is 0.4/40% — corrected).
- Canvas renderer: viewport culling confirmed (draw() computes firstCol/lastCol/firstRow/lastRow from offsets). Auto-activation confirmed (renderAlignment checks TOTAL_RESIDUES > CANVAS_AUTO_THRESHOLD). Mouse wheel + click-drag panning confirmed. User override via _userDismissedAutoCanvas confirmed.
- Reads mode: renderReadsAlignment() confirmed. assignReadTracks() greedy packing confirmed. Soft-clip display, deletion gaps, insertion ticks, mismatch coloring, "Show bases" toggle all confirmed in code. Coverage histogram NOT found. Paired-end connection lines NOT found (SAM pair data stored in _samPair but never drawn).

## Needs human decision
(none)

## Notes for the next run
- Novelty Spotlight item 8 still says "IGV-style compact read packing" with "paired-end connection lines, diffs-only mode, coverage histogram" — needs correction in that phase (coverage histogram and paired-end lines don't exist).
- Comparison table "Canvas large-align" row says "auto threshold" without a number — fine for the table, but verify other comparison table claims in the final phase.
- The "Reads mode" row in the comparison table was updated to resolve the BROWSER_CHECK contradiction, but the full comparison table audit is still pending (last phase).

