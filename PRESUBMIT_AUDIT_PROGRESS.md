# Pre-submission audit progress

## Done
The GLM loop (6 runs) produced 3 verified critical findings (C1-C3) before
being retired due to repeated context-limit crashes on this document (see
history below). Claude then finished the audit directly in one pass:
targeted, cited spot-checks across all 8 sections of
`presubmission-audit-prompt.md`, prioritizing the highest-risk claims
(version drift, mode restrictions, server-dependency, references, hygiene)
rather than an exhaustive row-by-row pass over every numeric parameter in
Section 2's must-verify table. Full results in `PRESUBMIT_AUDIT_FINDINGS.md`:
4 critical findings (C1-C4), 1 major (M1), 4 minor/style findings, 8 verified
claims, 2 cross-document inconsistencies, word count and Limitations review.

## Current phase
All phases complete (to the depth described above - see
`PRESUBMIT_AUDIT_FINDINGS.md`'s Executive Summary and item 8 of its
"Suggested author actions" for what was and wasn't covered).

## Notes for the next run
This loop is retired - no further runs should be launched against this
worktree. If someone wants the remaining Section 2 must-verify rows done
exhaustively (UI control specifics, consensus/clustering/codon default
parameters, BLAST/snapshot/MAFFT/dot-plot/tree specifics, manual
cross-references), that is real remaining work, listed explicitly in
`PRESUBMIT_AUDIT_FINDINGS.md` item 8.

### History (why this loop was abandoned after 6 runs)
- Runs 1 and 2 lost real, correct analysis entirely: they queued all edits
  for one commit at the very end and hit the 262144-token context/output
  limit before that commit ever executed, so nothing was written to disk.
- Run 3 wrote its findings into `presubmission-audit-prompt.md` (the
  read-only instructions file) instead of `PRESUBMIT_AUDIT_FINDINGS.md`,
  leaving the real findings file empty - violated the "only edit
  FINDINGS.md and PROGRESS.md" rule. A human reverted the instructions
  file and moved the findings (C1-C3) into the correct file, independently
  re-verifying each one against `script.js`/`manuscript.md` first.
- Runs 4 and 5 were no-ops (redundant re-analysis, no new commit) or hit
  the same context-limit crash as runs 1-2, again losing real analysis
  (including a useful meta-observation that the audit prompt's own cited
  line numbers are stale from v132) before it could be committed.
- Run 6 crashed the same way within seconds of starting.
- Root cause: `presubmission-audit-prompt.md` is inherently a large
  cross-referencing checklist naming ~30 files; verifying even one real
  chunk of it pulls in enough manuscript/manual/script.js content to sit
  right at the context ceiling, so any run doing substantial real work was
  one long turn away from losing everything. This document is a poor fit
  for the small-context aider-loop model that worked well for narrower,
  single-file tasks earlier in this project (functional tests, feature
  audit) - a lesson worth remembering for future large-checklist tasks.
