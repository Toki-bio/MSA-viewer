# Task: verify save→reload round-trip fidelity for FASTA alignments

You are working alone across many separate invocations (no memory between
runs except what's in this repo). Read `ROUNDTRIP_PROGRESS.md` first. If it
doesn't exist yet, this is the first run: create it and start.

## Context

This is a browser-based MSA (multiple sequence alignment) viewer/editor
being prepared for a bioinformatics publication. A prior sweep (see
`ROBUSTNESS_PROGRESS.md` if present in git history - it may not be in this
worktree's checkout, check `git log --all` if you want the full history)
verified FASTA *parsing* edge cases. This task is different: it verifies
that **saving an alignment and reloading it produces byte-for-byte
equivalent data** - the "round trip." A parser can be perfectly correct
and an exporter can still lose information (or vice versa) - each half
needs to be checked, and so does the combination.

`downloadAlignment()` in script.js is the export path: builds
`>${s.fullHeader || s.header}\n${s.seq}` per sequence and triggers a file
download. The import path is `parseFasta()` (called from `parseAndRender`).

## Your job

For each case below: construct the input alignment, trace it through
`parseFasta` → `state.seqs`, then trace THAT through `downloadAlignment`'s
export logic, then trace the exported string back through `parseFasta`
again (simulating reload) → compare the twice-parsed result to the
once-parsed result. They must be identical. Read the actual code carefully
and trace it by hand (you have no browser) - do not assume symmetry, verify
it line by line.

Cases to check, one per run:
1. **Case preservation**: mixed-case sequence data (e.g. `AcGtacGT` or
   lowercase throughout, common in soft-masked genomic data where lowercase
   = repeat-masked). Does `_sanitizeFastaSequence`'s regex replacement
   preserve original case, or does anything anywhere force uppercase/
   lowercase? Does round-tripping through export→reimport preserve case?
2. **Gap character round-trip**: alignments with `-` gaps (and recall from
   the parsing sweep: `.` and `~` also get normalized to `-` on import).
   After export, gaps are written as `-` (from the already-normalized
   `state.seqs`). Does re-importing that produce the exact same gap
   pattern, or could repeated normalization ever shift/duplicate/lose gap
   positions? Check column alignment is preserved (same sequence length,
   same gap positions) after a full round trip.
3. **Header round-trip with special characters**: headers containing
   characters that are meaningful in FASTA format itself - e.g. a header
   containing a literal `>` character mid-string (not at the start), or a
   header containing a newline-like sequence if the original input had one
   embedded oddly. Does export always produce a syntactically valid FASTA
   file that `parseFasta` can correctly re-parse (correct sequence
   boundaries), or could a pathological header break record boundaries on
   reimport?
4. **Multi-round-trip stability**: does exporting and reimporting TWICE in
   a row (not just once) produce the same result as once? (i.e. is the
   transformation idempotent, or does something drift/degrade on repeated
   application - e.g. repeated `.replace(/\./g, '-')` calls are idempotent,
   but check whether anything else in the chain isn't.)

## Ground rules (non-negotiable, every run)

1. One case per run. Trace it fully by hand through the actual current
   code (search for the real function definitions yourself - do not trust
   line numbers or exact code from this task description, they may be
   stale).
2. If a case reveals a real bug (data doesn't round-trip correctly), fix it
   with the minimal correct change and explain exactly what would have been
   lost/corrupted and for what kind of real input.
3. If a case is already correct, say so explicitly with the traced
   reasoning that confirms it - a confirmed-correct finding is as valuable
   as a bug fix.
4. **Only edit `script.js` and `ROUNDTRIP_PROGRESS.md`.** Do not reference
   any other filename in this repo, for any reason, in your reply - any
   exact filename that appears anywhere in this conversation, even inside a
   sentence telling you NOT to touch it, gets silently auto-added to your
   context by the tool running you.
5. Commit at the end of every run with `git add -A && git commit -m "..."` -
   specific, describing what changed and where. Never `--amend`.
6. **This wrapper will NOT honor a "done" claim unless this exact run's own
   browser check passed.** Don't declare "All phases complete" without that.
7. If genuinely blocked, say so plainly under `## BLOCKED`, commit, and stop.

## Browser check (self-verification, no browser access needed on your end)

`BROWSER_CHECK_CMD` runs automatically after each of your commits - it
constructs each of the 4 cases above, does a real parse → export → reparse
round trip in headless Chrome, and asserts the twice-parsed result exactly
matches the once-parsed result (same sequence count, same headers, same
sequence strings, same case). Its pass/fail output gets appended to
`ROUNDTRIP_PROGRESS.md` automatically if it fails.

## ROUNDTRIP_PROGRESS.md format

```markdown
# Round-trip fidelity progress

## Done
- <one-line summary per run, naming which case> (commit <hash>)

## Current phase
<in progress / blocked / All phases complete>

## Confirmed bugs found and fixed
<list, one per bug, with the exact input that exposed it and the fix>

## Cases checked and already correct
<list, one per case, with the traced reasoning>

## Notes for the next run
<anything not obvious from the code>
```

## When all phases are done

Once all 4 cases are resolved AND this run's own browser check passes,
mark "Current phase" as "All phases complete" and stop.
