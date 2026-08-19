# Task: reconcile features-inventory.md against the actual current codebase

You are working alone across many separate invocations (no memory between
runs except what's in this repo). Read `FEATURE_AUDIT_PROGRESS.md` first. If
it doesn't exist yet, this is the first run: create it and start.

## Context

`features-inventory.md` is supplementary material for a Bioinformatics
(Oxford) Application Note submission - it claims specific features exist and
work, in detail, including a comparison table against competing tools
(MSAViewer, JalviewJS, AliView, IGV.js). If a claim in this document is
false or stale, a peer reviewer who actually tries the feature will find
that gap immediately and it damages the submission's credibility. Your job
is to verify every claim against the ACTUAL current code, not trust the
document, and correct anything that's wrong.

**A real, already-confirmed problem, so you understand the shape of what
you're looking for:** the document's own "Compact mode" section (search for
"Compact mode (IGV-style read packing)") is explicitly marked "*removed,
may return*" - but the comparison table further down the same document
still lists "Compact reads: ✅ IGV-style" as a working, shipped feature.
That's an internal self-contradiction. Separately, the actual current UI
(check `index.html` for `name="mode"` radio buttons) has a mode literally
named "Reads" with tooltip "IGV-style read tracks for mapped SAM/BAM data
against a reference" - which suggests Compact mode was not actually removed
but renamed/reimplemented as "Reads" mode at some point after this document
was written, and the document was never updated to match. Verify this
specific case first (or note if a prior run already has) as your calibration
for what "stale/wrong claim" looks like versus "genuinely still true."

## Your job

Work through `features-inventory.md` one `##`-level section per run (Input &
Format Support, Visualization & Rendering, Sequence Colouring System,
Editing Operations, Analysis Tools, Export & Publishing, then the Novelty
Spotlight numbered list, then the Comparison table last). For each claim in
that section:

1. Find the actual function/UI element in `script.js` / `index.html` that
   the claim describes (search by function name if one is given, otherwise
   by behavior description).
2. Confirm it exists and does what's claimed - not just that a
   similarly-named function exists, but that it actually does the described
   thing (read the function body).
3. If the claim is accurate, leave it alone.
4. If the claim is stale, wrong, or the feature was renamed/changed, correct
   the text in `features-inventory.md` directly - keep the same "what it
   does mechanically" + "why it's novel" structure, just make it true. Note
   the correction in `FEATURE_AUDIT_PROGRESS.md`.
5. If you cannot find ANY code matching a claim after a real search (not
   just one grep), flag it prominently rather than guessing - a feature
   that doesn't exist at all in the codebase is a much bigger problem than
   a renamed one, and needs a human decision (cut the claim entirely, or is
   there a good reason you missed it) rather than a unilateral edit.

## Ground rules (non-negotiable, every run)

0. **Context budget is very tight in this task specifically** (script.js is
   already large, and features-inventory.md adds more on top). Two things
   that already caused a prior run to hit the token limit with ZERO progress
   saved, both now required:
   - DO NOT quote more than 1-2 lines of the document back at yourself while
     thinking - refer to section/claim names only (e.g. "the Compact mode
     claim" not the full paragraph). Keep reasoning terse.
   - **Investigate ONE claim, then immediately write and commit that one
     correction, before investigating the next claim.** Do not investigate
     several claims (or a whole section) first and save all the writing for
     the end - a prior run did exactly that, traced everything correctly,
     and then ran out of context before writing a single line, losing all of
     it. One claim fully done (verified AND written AND ready to commit) is
     worth far more than five claims investigated but never written down. If
     you finish a whole section with budget to spare, great - keep going -
     but never let "investigate everything, write at the end" be the plan.
1. One `##` section per run (see the ordered list above). If a section is
   very large, it's fine to do a sub-portion and note exactly where you
   stopped - don't rush to cover a whole section shallowly.
2. **Only edit `features-inventory.md` and `FEATURE_AUDIT_PROGRESS.md`.** Do
   not touch `script.js` or `index.html` - this task is about correcting
   documentation to match code, not changing code. Do not reference any
   other filename in this repo, for any reason, in your reply - any exact
   filename that appears anywhere in this conversation, even inside a
   sentence telling you NOT to touch it, gets silently auto-added to your
   context by the tool running you.
3. Commit at the end of every run with `git add -A && git commit -m "..."` -
   specific, naming which section and what was corrected (or confirmed
   accurate). Never `--amend`.
4. **This wrapper will NOT honor a "done" claim unless this exact run's own
   check passed.** The check is a static existence/consistency check (see
   below), not a browser test - it verifies a fixed list of function names
   still exist and that the Compact/Reads contradiction specifically is
   resolved. Passing it does not mean your edits for OTHER sections were
   necessarily correct - only that you haven't broken the specific things it
   checks. Use your own careful tracing as the real verification for
   everything else.
5. If genuinely blocked (can't find what a claim refers to after real
   effort), say so plainly under `## BLOCKED` for that specific claim inside
   `FEATURE_AUDIT_PROGRESS.md`'s notes, but keep going on other claims in
   the same run rather than stopping the whole run for one unclear item.

## Check (self-verification, no browser needed for this task)

`BROWSER_CHECK_CMD` runs a static Node script (no browser) that verifies:
(a) a fixed list of ~15 function names this task's investigation already
confirmed exist are still present in `script.js` (protects against
accidental edits to the wrong file), and (b) `features-inventory.md` no
longer contains BOTH an unqualified "removed" claim about Compact mode AND
an unqualified "✅" claim for Compact/IGV-style reads in the comparison
table at the same time (the specific contradiction already found). Its
pass/fail output gets appended to `FEATURE_AUDIT_PROGRESS.md` if it fails.

## FEATURE_AUDIT_PROGRESS.md format

```markdown
# Feature inventory audit progress

## Done
- <one-line summary per run, naming which section> (commit <hash>)

## Current phase
<in progress / blocked / All phases complete>

## Corrections made
<list, one per correction, with what was wrong and what it now says>

## Claims confirmed accurate
<list, one per section, brief - don't repeat full claim text>

## Needs human decision
<any claim you could not verify or resolve unilaterally>

## Notes for the next run
<anything not obvious from the document or code>
```

## When all phases are done

Once all sections (including the Comparison table) have been checked AND
this run's own check passes, mark "Current phase" as "All phases complete"
and stop.
