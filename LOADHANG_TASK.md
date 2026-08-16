# Task: extend windowed DOM rendering to cover the 3.6M-residue hang case

You are working alone across many separate invocations (no memory between
runs except what's in this repo). Read `LOADHANG_PROGRESS.md` first for
what's already been tried and ruled out - it's extensive, read all of it,
not just the "Current phase" section.

## This is a REVISED task - earlier attempts were solving the wrong layer

Three earlier fix attempts (skip `getBoundingClientRect` in
`setBlockSizeToScreen`, skip a forced reflow in `toggleStickyNames`, swap
`container.clientWidth` for `window.innerWidth`) did NOT fix the hang and
have been superseded - do not re-attempt variations of "avoid a specific
JS-triggered reflow." Real instrumented evidence (a human independently
re-ran this, described below) shows the actual bottleneck is NOT a specific
JS statement at all.

## Confirmed root cause (real evidence, not a guess)

Loading a 300-sequence x 12000-column alignment (3.6M residues) is BELOW
`ALIGN_CRAZY_VOLUME` (5,000,000), so `isCrazy` is false and the alignment
renders via the OLDER, non-windowed DOM path - building all ~3.6 million
individual `<span>` elements directly into the DOM in one go, instead of
the windowed renderer (`renderUnifiedWindowedDom` / `_buildUnifiedBlock` /
`_refreshUnifiedWindowOnScroll`) that's already used for alignments AT or
ABOVE `ALIGN_CRAZY_VOLUME` and already proven fast (tested this session up
to 100M+ residues with flat ~50-65ms scroll-refresh cost).

Direct instrumented proof the bottleneck is NOT a specific JS call:
`parseAndRender`'s own internal trace shows the async function's try block
completing (all statements executed, including `_historyManager.add`) at
~10.3 seconds - well within any reasonable budget. Its returned promise's
`.then()` callback fires correctly at ~9 seconds (confirmed via a listener
attached directly to the promise). But a COMPLETELY UNRELATED
`setTimeout(fn, 0)` callback (`toggleStickyNames`, queued during the same
render cycle) that should fire on the very next event-loop tick does not
actually run until ~98 SECONDS after page load - roughly 88 seconds after
the promise resolved. A trivial, unrelated browser-automation command
(reading a booleqn property) issued around the same time is ALSO blocked
for that same ~88-second window. This means the browser's MAIN THREAD
itself is synchronously blocked for ~88 seconds by something that isn't
attributable to any single logged JS statement - almost certainly the
browser engine's own internal processing (style recalculation, layout,
paint, and/or its internal bookkeeping) of a DOM tree containing 3.6
million raw elements. This is not something skippable via more
JS-level "avoid this one reflow" patches - the DOM tree itself is simply
too large for the browser to process quickly, regardless of what specific
JS code touches it.

## The actual fix: route this size range through the EXISTING windowed renderer

The windowed renderer already exists, is mature, and is already used above
`ALIGN_CRAZY_VOLUME`. The fix is to make the DOM-windowing DECISION use a
separate, LOWER threshold than `ALIGN_CRAZY_VOLUME`, so alignments in this
"medium-large" range (well above small/normal, but below the 5M crazy-dialog
threshold) also get windowed DOM rendering instead of a full unwindowed
build - without changing anything about `ALIGN_CRAZY_VOLUME` itself, which
also still correctly gates the "Large alignment, proceed?" dialog and the
Canvas mode auto-switch (both were carefully tuned from real measurements
in an earlier session and must NOT be touched or affected by this change).

Concretely:
1. Find where `renderAlignment()` (or whatever function it's called from)
   currently decides between the windowed path (`renderUnifiedWindowedDom`
   or similar) and the classic full-DOM-build path. Read the actual current
   code yourself - do not assume the exact function/variable names above are
   still accurate.
2. Introduce a new, separate threshold constant (suggest starting around
   500,000-1,000,000 residues, distinct from `ALIGN_CRAZY_VOLUME` at 5M) that
   gates ONLY the windowed-vs-classic DOM rendering decision for Full/Block
   modes. Do not reuse or modify `ALIGN_CRAZY_VOLUME` itself.
3. Alignments at/above this new threshold (but still below
   `ALIGN_CRAZY_VOLUME`) should render via the windowed path. The "Large
   alignment, proceed?" dialog should still only appear at/above
   `ALIGN_CRAZY_VOLUME`, unchanged - a user loading a 3.6M-residue alignment
   should NOT suddenly see a new dialog they didn't see before, just get
   fast windowed rendering silently.
4. Verify with fresh instrumentation (temporary console.log, same pattern as
   before) that the 300x12000 case now takes the windowed path and resolves
   in well under the 30s check timeout.

## Ground rules (non-negotiable, every run)

1. Read the ACTUAL current script.js yourself before touching anything.
2. **This is a bigger change than earlier attempts - be extra careful not to
   break normal-size alignments (well below the new threshold) or
   already-crazy alignments (at/above `ALIGN_CRAZY_VOLUME`).** Test both
   boundaries conceptually as you write the change, even though you can't
   run the browser yourself.
3. **Never change `ALIGN_CRAZY_VOLUME`'s value or what it gates** (the
   proceed dialog, Canvas auto-switch threshold) - those were carefully
   tuned from real measurements in an earlier session. Add a NEW, separate
   threshold for this specific windowing decision instead.
4. **Only edit `script.js` and `LOADHANG_PROGRESS.md`.** Do not reference any
   other filename in this repo, for any reason, in your reply - any exact
   filename that appears anywhere in this conversation, even inside a
   sentence telling you NOT to touch it, gets silently auto-added to your
   context by the tool running you.
5. Commit at the end of every run with `git add -A && git commit -m "..."` -
   specific, describing what changed and where. Never `--amend`.
6. If a run is bigger than expected, stop at a safe sub-point, commit what
   compiles, note exactly where you stopped in `LOADHANG_PROGRESS.md`, and
   end the run.
7. Remove temporary instrumentation once the real fix is confirmed working,
   but it's fine to leave it in during intermediate diagnostic runs.
8. When you believe the bug is fixed AND this run's own browser check has
   passed, mark `LOADHANG_PROGRESS.md`'s "Current phase" as "All phases
   complete", describing the root cause and the fix, and stop. The wrapper
   running you will NOT honor a "done" claim unless this exact run's browser
   check actually passed - don't bother declaring completion otherwise, it
   will just be rewritten and you'll have wasted the run.

## Browser check (self-verification, no browser access needed on your end)

A `BROWSER_CHECK_CMD` runs automatically after each of your commits - it
loads exactly the 300x12000 scenario in real headless Chrome and asserts
`parseAndRender` resolves within 30 seconds. Its pass/fail output gets
appended to `LOADHANG_PROGRESS.md` automatically if it fails.

## LOADHANG_PROGRESS.md format

```markdown
# Load-hang bug progress

## Done
- <one-line summary per run> (commit <hash>)

## Current phase
<in progress / blocked / All phases complete>
<details>

## Instrumentation findings
<exact trace output>

## Root cause (fill in once found)
<exact mechanism>

## Fix
<what changed and why it's correct>

## Notes for the next run
<anything not obvious from the code>
```
