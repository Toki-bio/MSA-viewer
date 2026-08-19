# ViewAlign pre-submission audit

**Audited commit/tag:** 0186d68 (script.js `BUILD_TAG = 'v179'`)
**Date:** 2026-08-20

## Executive summary
Audit in progress. First critical findings (build-tag drift, stale performance
thresholds in the manuscript) recovered below after a wrapper-side process
issue (see Notes). Not yet submit-ready: the manuscript's version note and
several numeric claims are stale relative to the current codebase.

## Critical findings (must fix before submission)
| ID | Location | Claim | Evidence | Recommended fix |
|----|----------|-------|----------|-----------------|
| C1 | `manuscript.md:3-4` vs `script.js:3` | Manuscript's revision note is pinned to `script.js` v132 ("Round 1: draft aligned with the current viewer (`script.js` v132)...") | `script.js:3`: `const BUILD_TAG = 'v179';`. The codebase has advanced 47 build tags past the manuscript's last cited revision. Every feature claim needs re-verification against v179, not v132. | Re-audit remaining manuscript claims against current (v179) code (sections 2-8 of this audit do so). Update or remove the revision note to reflect the actual build being submitted, and delete the note entirely before submission per its own instruction. |
| C2 | `manuscript.md:53` vs `script.js:5354,6532` | "[Canvas] activates itself above 150,000 residues" | `script.js:6532`: `const ALIGN_CRAZY_VOLUME = 5_000_000;`; `script.js:5354`: `const CANVAS_AUTO_THRESHOLD = ALIGN_CRAZY_VOLUME;` — the real auto-Canvas threshold is 5,000,000 residues, not 150,000. A code comment near the constant confirms 150,000 was a stale prior value: "Was 150,000...a holdover from before DOM mode had windowing at all." | Update manuscript §2 (view modes paragraph) to state 5,000,000 (or describe it qualitatively, e.g. "multi-million residue," if an exact number is undesirable). |
| C3 | `manuscript.md:97` vs `script.js:6540` | Limitations: "DOM-based Full and Block modes stay responsive to roughly 200 sequences × 5,000 columns, beyond which Canvas is required." | `script.js:6540`: `const ALIGN_WINDOWED_DOM_THRESHOLD = 500_000;` triggers a windowed-DOM rendering path (not a switch to Canvas) between 500K and 5,000,000 residues; Canvas only auto-activates at 5,000,000 (see C2). The manuscript's "beyond which Canvas is required" is wrong for the entire 500K-5M residue range, where windowed DOM keeps Full/Block responsive without Canvas. | Correct the Limitations sentence: windowed DOM extends Full/Block responsiveness to roughly 500,000 residues; Canvas activates automatically above 5,000,000. |

## Major findings (should fix)
| ID | Location | Claim | Evidence | Recommended fix |
|----|----------|-------|----------|-----------------|

## Minor / style findings
- ...

## Verified claims (spot-check sample)
- ...

## Cross-document inconsistencies
- ...

## Limitations paragraph review
[Pending]

## Word count
- Body words (excl. refs): ~2,500 (per run 3's estimate: Summary ~260, Introduction ~450, Section 2 ~1,420, Discussion/Conclusion ~400)
- Within Application Note limit: Yes - manuscript's own Target section states a 2,600-word OUP limit (note: presubmission-audit-prompt.md's ~3,000-word figure is a rough/stale estimate, not authoritative)

## Suggested author actions (prioritized checklist)
1. Update or remove the manuscript's v132 revision note; delete it entirely before submission (its own text says to).
2. Fix the "150,000 residues" Canvas-activation claim to 5,000,000.
3. Fix the Limitations sentence about the DOM/Canvas cutover to describe the real 500K (windowed DOM) / 5M (Canvas) split.
