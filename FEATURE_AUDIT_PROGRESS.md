# Feature inventory audit progress

## Done
- Input & Format Support section audited (pending commit)

## Current phase
Visualization & Rendering (next)

## Corrections made
1. "8-format automatic detection" → "9-format": Added GenBank (auto-detected by LOCUS header, was completely missing from the doc). Removed CRAM (not supported in code). Clarified BAM is detected by file extension, not content inspection. Updated format count and novelty text.
2. "Full CIGAR expansion for SAM": Corrected "11 CIGAR operations" to "9" (M, I, D, N, S, H, P, =, X). Removed B (not handled by _expandCigar) and removed separate "soft-clip" listing (S IS soft-clip). Added supplementary alignments (flag 0x800) to the filtering description — code filters 0x904 = 0x4|0x100|0x800.
3. "BAM/CRAM via server pipeline" → "Client-side BAM parsing": Complete rewrite. No /api/bam2sam endpoint exists in script.js. BAM is parsed client-side via BamParser.decompressBAM(). CRAM is not supported. Updated to describe actual client-side implementation.
4. "URL parameter loading": Changed ?file= to ?url= (actual parameter name in code). Added ?data= (base64 inline alignment text) and ?snapshot= (base64 snapshot JSON) parameters that the code supports but the doc omitted. Fixed "ViewAlign" typo to "MSA viewer" in novelty text.

## Claims confirmed accurate
- Recent files history: localStorage-backed, 100KB cap (substring(0,100000)), adjustable 1-50 (Math.max(1,Math.min(50,n))), one-click reload, survives restarts. All accurate.

## Needs human decision
(none)

## Notes for the next run
- Compact/Reads calibration case CONFIRMED: "Compact mode" was renamed to "Reads" mode. The document's "Compact mode" section says "removed, may return" but the comparison table still claims "✅ IGV-style". Needs correction in Visualization & Rendering section AND Comparison table. The actual mode is modeReads (value="reads") with tooltip "IGV-style read tracks for mapped SAM/BAM data against a reference". renderReadsAlignment() implements SVG-based read packing with track assignment via assignReadTracks(), mismatch coloring, soft-clip display, deletion gaps, insertion ticks.
- The document claims "5 interchangeable view modes" but the code has 4: Full (modeSingle), Block (modeBlocks), Canvas (modeCanvas), Reads (modeReads). No Compact mode exists. Needs correction in Visualization & Rendering section.
