# Task: harden FASTA parsing against edge-case input

You are working alone across many separate invocations (no memory between
runs except what's in this repo). Read `ROBUSTNESS_PROGRESS.md` first. If it
doesn't exist yet, this is the first run: create it and start.

## Context

This is a browser-based MSA (multiple sequence alignment) viewer/editor
being prepared for a bioinformatics publication. Real-world FASTA files are
messy: mixed line endings, empty sequences, single-sequence files, unusual
IUPAC ambiguity codes, very long or unicode headers, trailing whitespace,
blank lines between records. A parser that silently corrupts or drops data
on any of these is a credibility problem for a publication - reviewers will
try exactly this kind of input.

## Your job

Find the FASTA-parsing function(s) in `script.js` yourself (search for
where `fastaInput`'s value gets turned into `state.seqs` - likely inside or
called from `parseAndRender`). For each edge case below, determine whether
it's handled correctly (no data loss, no crash, sensible behavior) by
READING the parsing code carefully - trace exactly what happens to each
case, character by character if needed. Do not guess; you have no browser,
but you can reason precisely about string/regex operations by tracing them.

Edge cases to check, one per run (see phases below):
1. **Mixed line endings**: a FASTA file with some records using `\r\n`
   (Windows) and others using `\n` (Unix) in the same file.
2. **Empty/whitespace-only sequence**: a header line immediately followed by
   another header line (zero-length sequence), or a sequence line that's
   only whitespace.
3. **Single-sequence file**: only one `>header\nSEQ` record, no alignment
   possible - does the app handle this gracefully (no crash, sensible
   message) rather than assuming 2+ sequences everywhere?
4. **Non-standard IUPAC ambiguity codes**: characters beyond ACGTU/acgtu and
   the standard ambiguity codes (RYSWKMBDHVN) - e.g. a stray digit, a `*`
   (stop codon in protein), a `?` (gap placeholder some tools use), or other
   non-alphabetic characters accidentally left in a sequence line.
5. **Very long / unicode headers**: a header line with non-ASCII characters
   (e.g. accented letters, CJK characters, emoji) or an extremely long
   header (500+ characters) - does anything truncate, mis-encode, or break
   downstream (e.g. display, export, search)?
6. **Blank lines between records**: extra blank lines within or between
   FASTA records (valid in many real-world files, some tools emit them).
7. **Trailing whitespace**: trailing spaces/tabs at the end of sequence or
   header lines.

## Ground rules (non-negotiable, every run)

1. **One edge case per run.** Investigate it fully, fix it if broken, verify
   your fix with a fresh instrumented trace if you have any doubt, update
   `ROBUSTNESS_PROGRESS.md`, commit, and stop.
2. If an edge case is ALREADY handled correctly, say so explicitly with the
   reasoning that confirms it (e.g. "the regex `X` already strips `\r`
   before processing, confirmed by tracing input `Y` through it") - don't
   force a fix where none is needed. A "false positive, already fine"
   finding is just as valuable as a real bug fix.
3. **Never change the FASTA format itself or silently drop valid data.** If
   a case is genuinely ambiguous (e.g. what a "?" character should mean),
   note it as "needs human judgment" rather than guessing at intended
   behavior.
4. **Only edit `script.js` and `ROBUSTNESS_PROGRESS.md`.** Do not reference
   any other filename in this repo, for any reason, in your reply - any
   exact filename that appears anywhere in this conversation, even inside a
   sentence telling you NOT to touch it, gets silently auto-added to your
   context by the tool running you.
5. Commit at the end of every run with `git add -A && git commit -m "..."` -
   specific, describing what changed and where. Never `--amend`.
6. **This wrapper will NOT honor a "done" claim unless this exact run's own
   browser check passed.** Don't bother declaring "All phases complete"
   otherwise - it'll just be rewritten and the run wasted. See
   ROBUSTNESS_PROGRESS.md's own notes for confirmation of this mechanism.
7. If genuinely blocked, say so plainly under `## BLOCKED`, commit, and stop.

## Browser check (self-verification, no browser access needed on your end)

`BROWSER_CHECK_CMD` runs automatically after each of your commits - it loads
all 7 edge cases above through the real app and asserts: no page errors, no
silent data loss (sequence count and approximate content preserved), and no
crash. Its pass/fail output gets appended to `ROBUSTNESS_PROGRESS.md`
automatically if it fails.

## ROBUSTNESS_PROGRESS.md format

```markdown
# Robustness sweep progress

## Done
- <one-line summary per run, naming which edge case> (commit <hash>)

## Current phase
<in progress / blocked / All phases complete>
<details>

## Confirmed bugs found and fixed
<list, one per bug, with the case that exposed it and the fix>

## Cases checked and already correct (false positives)
<list, one per case, with the reasoning that confirmed it>

## Needs human judgment
<anything genuinely ambiguous>

## Notes for the next run
<anything not obvious from the code>
```

## When all phases are done

Once all 7 edge cases have been investigated (fixed or confirmed already
correct) AND this run's own browser check passes, mark "Current phase" as
"All phases complete" and stop.
