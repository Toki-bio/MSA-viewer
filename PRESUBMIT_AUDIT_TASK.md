# Task: run the pre-submission audit against the live codebase

You are working alone across many separate invocations (no memory between
runs except what's in this repo). Read `PRESUBMIT_AUDIT_PROGRESS.md` first.
If it doesn't exist yet, this is the first run: create it and start.

## Context

This repo (a browser-based MSA viewer/editor) is being prepared for a
journal Application Note submission. `presubmission-audit-prompt.md` in
this repo's root is a detailed, already-written audit checklist that has
never actually been run. It names, by exact relative path, every document
and source file you need (the manuscript draft, the cover letter, the user
manual, the main client script, the server, and a few analysis modules) and
tells you exactly what to check in each. Read it now - it is your actual
audit instructions. This TASK.md only tells you how to pace the work across
runs.

**Hard context-budget rule, more important than anything else below:** open
files ONE AT A TIME as you actually need them for the section you're
currently working on - never open every file `presubmission-audit-prompt.md`
mentions all at once "to have them handy." A previous run crashed with a
262144-token context overflow from doing exactly that. Budget roughly:
read `presubmission-audit-prompt.md` itself, then for whichever section
you're on this run, open only the 1-3 files that specific section needs,
do the checks, write findings, stop. If a section's own must-verify table
has many rows, do as many as fit and leave the rest for the next run - note
exactly which rows are left in the progress file.

## Your job

Work through the numbered sections of `presubmission-audit-prompt.md`'s
"Audit procedure" one section per run, in the order that document lists
them. Its section 2 (feature inventory vs code) is the largest single
section - split it across as many runs as needed, picking up exactly where
the previous run's progress notes left off.

For each item: locate the actual code/file/line, read it, and record a
verdict (Verified / Partial / Unverified / Wrong) with file:line evidence,
using that document's own "Output format" structure. Append findings for
this run's section into `PRESUBMIT_AUDIT_FINDINGS.md` (create it on your
first run using that exact output structure as the skeleton; keep adding to
it across runs rather than starting over).

Every claim needs cited evidence - unverifiable claims go in as Unverified
with what you searched, never silently dropped, never marked Verified on a
guess.

## Ground rules (non-negotiable, every run)

1. **One section per run, strictly - stop even if you have budget left.** A
   previous run analyzed material from several different sections in one
   turn (real, good analysis) and then hit the output-token limit before
   committing any of it, losing everything. Do the current section (or one
   chunk of section 2) thoroughly, commit incrementally as you go (rule 4),
   and stop there even if you could keep going - the next run picks up the
   next section fresh with a full budget of its own.
2. **Only edit `PRESUBMIT_AUDIT_FINDINGS.md` and
   `PRESUBMIT_AUDIT_PROGRESS.md`.** This is a read-only audit - do not
   modify the manuscript, cover letter, manual, client script, server, or
   any other file, even if you find something wrong. Report it as a
   finding; a human decides the actual fix.
3. Open files one at a time, only the ones the current section actually
   needs (see the hard context-budget rule above) - do not pre-open every
   file named anywhere in the audit instructions.
4. **Commit incrementally, not just once at the end of the run.** After
   every few findings (or whenever you finish one must-verify table chunk),
   stop and run `git add -A && git commit -m "..."` right then - do not
   queue up the whole run's findings for one giant edit/commit at the very
   end. A previous run did large amounts of real, correct analysis but lost
   all of it because it hit the output-token limit before its first commit
   ever landed. Small, frequent commits mean a run that gets cut off still
   keeps whatever it already finished. Never `--amend`.
5. **This wrapper will NOT honor a "done" claim unless this exact run's own
   check passed.** The check verifies `PRESUBMIT_AUDIT_FINDINGS.md` exists,
   contains real findings (not a stub), and that a handful of symbols named
   in the audit instructions are still present in the actual codebase.
6. If genuinely blocked, say so plainly under `## BLOCKED` in Progress,
   commit, and stop.

## PRESUBMIT_AUDIT_PROGRESS.md format

```markdown
# Pre-submission audit progress

## Done
- <one-line summary per run, naming which section/chunk> (commit <hash>)

## Current phase
<in progress / blocked / All phases complete>

## Notes for the next run
<anything not obvious, e.g. exactly which must-verify table rows remain>
```

## When all phases are done

Once every section of `presubmission-audit-prompt.md`'s audit procedure
(including every row of its must-verify table) has been covered in
`PRESUBMIT_AUDIT_FINDINGS.md` AND this run's own check passes, mark
"Current phase" as "All phases complete" and stop.
