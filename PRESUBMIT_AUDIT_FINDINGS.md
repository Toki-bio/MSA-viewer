# ViewAlign pre-submission audit

**Audited commit/tag:** 0186d68 -> current worktree HEAD (script.js `BUILD_TAG = 'v179'`)
**Date:** 2026-08-20

## Executive summary
**Not yet submit-ready.** The manuscript's own revision note (still present,
though it says to delete itself) is pinned to v132; the codebase has moved 47
build tags since. Three numeric claims that trace directly to that drift are
demonstrably wrong (C1-C4 below) and should be treated as must-fix. Everything
independently spot-checked beyond the numeric claims - format parsers, BAM/CRAM
server dependency, mode restrictions, all 18 references being cited in-text,
manual section count - held up correctly. This audit is a targeted, cited
spot-check across all 8 sections of `presubmission-audit-prompt.md`, not an
exhaustive line-by-line pass over every parameter in Section 2's must-verify
table; items not explicitly listed under "Verified claims" or a finding ID
were not individually re-derived and should be treated as Unverified, not
Confirmed, until someone does.

## Critical findings (must fix before submission)
| ID | Location | Claim | Evidence | Recommended fix |
|----|----------|-------|----------|-----------------|
| C1 | `manuscript.md:3-4` vs `script.js:3` | Manuscript's revision note is pinned to `script.js` v132 ("Round 1: draft aligned with the current viewer (`script.js` v132)...") | `script.js:3`: `const BUILD_TAG = 'v179';`. The codebase has advanced 47 build tags past the manuscript's last cited revision. Every feature claim needs re-verification against v179, not v132. | Update or remove the revision note to reflect the actual build being submitted, and delete the note entirely before submission per its own instruction. |
| C2 | `manuscript.md:53` vs `script.js:5354,6532` | "[Canvas] activates itself above 150,000 residues" | `script.js:6532`: `const ALIGN_CRAZY_VOLUME = 5_000_000;`; `script.js:5354`: `const CANVAS_AUTO_THRESHOLD = ALIGN_CRAZY_VOLUME;` - the real auto-Canvas threshold is 5,000,000 residues, not 150,000. A code comment near the constant confirms 150,000 was a stale prior value: "Was 150,000...a holdover from before DOM mode had windowing at all." | Update manuscript §2 (view modes paragraph) to state 5,000,000 (or describe it qualitatively, e.g. "multi-million residue," if an exact number is undesirable). |
| C3 | `manuscript.md:97` vs `script.js:6540` | Limitations: "DOM-based Full and Block modes stay responsive to roughly 200 sequences × 5,000 columns, beyond which Canvas is required." | `script.js:6540`: `const ALIGN_WINDOWED_DOM_THRESHOLD = 500_000;` triggers a windowed-DOM rendering path (not a switch to Canvas) between 500K and 5,000,000 residues; Canvas only auto-activates at 5,000,000 (see C2). The manuscript's "beyond which Canvas is required" is wrong for the entire 500K-5M residue range, where windowed DOM keeps Full/Block responsive without Canvas. | Correct the Limitations sentence: windowed DOM extends Full/Block responsiveness to roughly 500,000 residues; Canvas activates automatically above 5,000,000. |
| C4 | `manuscript.md:45` vs actual `<script src>` files in `index.html` | "~18,000 lines across six client modules" | The six files `index.html` actually loads as `<script src>` (`disttbfast.js`, `mafft-wasm.js`, `cluster.js`, `bam-parser.js`, `script.js`, `tree-draw.js` - confirmed this is the correct set of "six," matching the claimed count) sum to 21,069 lines (`wc -l`), not ~18,000 - roughly 17% growth since this number was last corrected (the revision note's own Round 2 entry says it was already fixed once, from an even earlier stale figure). | Update the line count to ~21,000, or reword to avoid a number likely to drift again before submission (e.g. "just over 21,000 lines"). |

## Major findings (should fix)
| ID | Location | Claim | Evidence | Recommended fix |
|----|----------|-------|----------|-----------------|
| M1 | `index.html:1096-1097` | Cache-bust query params on script tags should track the current build | `cluster.js?v=164` and `bam-parser.js?v=164` in `index.html`, while `script.js?v=179` is current. Not a functional bug (only affects whether a browser serves a stale cached copy after a deploy that touched those two files), but an inconsistency a careful reviewer running the live app across two sessions could notice as a version-tracking sloppiness signal. | Bump `cluster.js`/`bam-parser.js` cache-bust params to match `script.js`'s, or move to a single shared build-tag query param for all client-script tags. |

## Minor / style findings
- The manuscript's `> Revision note` block (`manuscript.md:3-8`) is still present and explicitly says "DELETE THIS BLOCK BEFORE SUBMISSION" - must be removed, not just left as an internal note (Section 7 of the audit prompt covers this explicitly).
- `manuscript.md:27` Contact line still has the `[email]` placeholder.
- `cover-letter.md:30-32` still has `[Author names]`, `[Institution]`, `[Email]` placeholders.
- `cover-letter.md:14` claims "No current tool provides the full editing-to-export workflow in a browser" - defensible given the manuscript's own hedging elsewhere (MSAViewer is read-only, IGV doesn't do MSA editing), but "full" is a strong word a reviewer could push on; consider "the combined editing-to-export workflow we describe."

## Verified claims (spot-check sample)
- All 9 claimed input formats have a real parser or, for BAM/CRAM, a real server conversion path: `parseFasta` (script.js:3884), `parseMsf` (3912), `parseClustal` (3740), `parsePhylip` (3764), `parseNexus` (3806), `parseStockholm` (3833), `parseGenBank` (2316), `parseSamToAlignment` (2447), and BAM/CRAM via `POST /api/bam2sam` → `samtools` subprocess in `server.js:1033-1050`.
- Zoom range 50-200% confirmed: `index.html:175` slider tooltip "(50-200%)"; `script.js:6475-6476` comment confirms the same non-linear mapping.
- Motif search is correctly disabled outside Full/Block: `isMotifSearchSupported()` (script.js:9644) returns false when either `#modeCanvas` or `#modeReads` is checked, and `searchMotif()` (9714) checks it before running.
- Codon overlay has no rendering support at all in the Canvas code path (`_renderCanvasAlignment`, script.js:3074, contains no codon-related logic) - consistent with the Limitations claim that Canvas doesn't support codon overlay, though the gating is by absence of a rendering path rather than an explicit mode check (worth noting, not a defect).
- BLAST's static-deployment fallback is real, not just claimed: `script.js:16742` and `16940` show explicit "Server not available" messaging rather than a silent failure or crash when `/api/blast-db` isn't reachable.
- `manual.html` has exactly 13 numbered `<h2>` sections (1. Getting Started through 13. Credits & Attribution), matching both the manuscript's Summary and the cover letter's "13-section manual" claims.
- All 18 references in `manuscript.md`'s reference list are cited at least once in the body text (checked each by author surname/year fragment; two initial "only 1 match" results for Edgar and Li were false alarms from an overly narrow grep pattern, not real omissions - re-verified against the actual body text at lines 33 and 45).
- `supplementary.md` and `features-inventory.md` both exist as claimed in the manuscript's Supplementary Information list.
- Clustering algorithm details independently verified in an earlier pass this session (separate from this audit): `SINEClusterer` fuzzy-merge at Jaccard ≥ 90% with size difference ≤ 5, 50%-of-available-pool candidate cap with an automatic relaxed-cap retry, chunked async variant - all confirmed present in `cluster.js` and matching manuscript §2.8's description.

## Cross-document inconsistencies
- None found beyond the version drift already covered in C1 (which by extension makes every other manuscript claim potentially stale relative to the current code - the specific ones checked here held up; the rest were not individually re-derived, see Executive summary caveat).
- `cover-letter.md:19` uses "MSAViewer.js" while `manuscript.md:35` uses "MSAViewer (Yachdav et al., 2016)" - a minor naming inconsistency between the two documents, not a factual error.

## Limitations paragraph review
The Limitations paragraph (`manuscript.md:97`) is substantively honest about scope (server-only features, GenBank flatfile-only, four-letter-alphabet analysis tools, MAFFT WASM inheriting MAFFT's algorithmic properties) but contains the C3 factual error about the DOM/Canvas size cutover. Once C2/C3 are corrected, the paragraph accurately represents the tool's real constraints - no additional missing limitation was identified in this pass.

## Word count
- Body words (excl. revision note, Target block, References, Availability table, Supplementary list): ~2,500 (Summary ~170-260 depending on what's counted as "main paragraph," Introduction ~450, Section 2 ~1,420, Discussion/Conclusion ~400) - not an exact machine count, a paragraph-level estimate.
- Within Application Note limit: Yes - the manuscript's own Target section states a 2,600-word OUP limit and the estimate above is under it. Note: `presubmission-audit-prompt.md`'s own "~3,000 words" figure for the journal limit is itself stale relative to the manuscript's corrected 2,600-word figure (per the revision note's Round 4 entry) - this is a case where the *audit instructions*, not the manuscript, are out of date.

## Suggested author actions (prioritized checklist)
1. Delete the `> Revision note` block from `manuscript.md` before submission (C1 + hygiene).
2. Fix the "150,000 residues" Canvas-activation claim to 5,000,000 (C2).
3. Fix the Limitations sentence about the DOM/Canvas cutover to describe the real 500K (windowed DOM) / 5M (Canvas) split (C3).
4. Update the "~18,000 lines / six client modules" figure to ~21,000 (C4).
5. Fill in `[email]` (manuscript) and `[Author names]`/`[Institution]`/`[Email]` (cover letter) placeholders.
6. Optional: sync `cluster.js`/`bam-parser.js` cache-bust query params to the current build (M1).
7. Optional: reconcile "MSAViewer.js" vs "MSAViewer" naming between cover letter and manuscript.
8. Not yet done: a full row-by-row pass over Section 2's must-verify table for the remaining UI controls, consensus/clustering/codon default parameters, BLAST/snapshot/MAFFT/dot-plot/tree specifics, and manual cross-references - the items checked here were a representative, high-risk-first sample, not exhaustive coverage. Treat unlisted claims as unverified.
