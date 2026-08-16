# Task: fix a confirmed hang in parseAndRender() for large synthetic alignments

You are working alone across many separate invocations (no memory between
runs except what's in this repo). Read `LOADHANG_PROGRESS.md` first. If it
doesn't exist yet, this is the first run: create it and start.

## Confirmed bug (real instrumented reproduction, not a guess)

Loading a 300-sequence x 12000-column synthetic FASTA (3.6M residues,
above `ALIGN_CRAZY_VOLUME`) via the real UI path (`fastaInput` textarea +
`parseAndRender(false)`) HANGS - the promise `parseAndRender` returns never
resolves. Confirmed via headless Chrome with real `console.log` capture
(not just a timeout - the page's OWN internal `[PERF] render: Nms |
3,600,000 residues` log fires, twice, proving `renderAlignment()` (called
inside `parseAndRender`, see below) actually completed - but the outer
`parseAndRender()` async function's promise still never resolves. Waited
5+ minutes with zero further progress after the second `[PERF] render` log.
This is NOT a slow-but-finite case - it's an indefinite hang.

## Where to look

Read `parseAndRender(isFromDrop = false)` in script.js yourself (search for
it - do not assume line numbers, they may have shifted). Its general shape,
from investigation on a specific commit:
1. Parses `fastaInput`'s value, sets `state.seqs`.
2. Calls `renderAlignment()` - this is what logs `[PERF] render: ...ms |
   N residues` (find where that exact log line is - it may be inside
   `renderAlignment` itself or something it calls).
3. After that: calls `updateSourceInfo()`, `renderAlignment()` AGAIN (note:
   investigation found the perf log fires TWICE per load - confirm whether
   the real code path calls `renderAlignment()` twice, e.g. once directly
   and once via `setBlockSizeToScreen()` "Auto-fit block size to screen
   width on every load" - and whether the second render is itself somehow
   hanging, waiting on the first, or entering an unexpected loop),
   `updateBamButtonVisibility()`, `setBlockSizeToScreen()`,
   `setupHoverMenuReveal()`, `showMessage(...)`.
4. Then records load history via `_historyManager.add(...)`, which stores
   `text: inputText.substring(0, 100000)` (a 100KB-capped slice of the
   input) along with other metadata into what is presumably a persistent
   history store (localStorage or similar - find out which). If this
   accumulates entries across many prior loads without bound, or does a
   synchronous write of a large combined payload, that's a plausible hang
   candidate - but this was NOT confirmed, only suspected. Verify for
   yourself with real instrumentation rather than assuming this is the
   cause.
5. A trailing `setTimeout(..., 100)` clears some inline styles - unlikely
   culprit (deferred, should not block promise resolution) but note it
   exists.

Add real `console.log` (or better, `performance.now()` deltas) immediately
before and after EACH of these calls, re-run the browser check described
below, and read its output to find exactly which line the execution never
returns from. Don't guess - trace it for real.

## Ground rules (non-negotiable, every run)

1. Read the ACTUAL current script.js yourself before touching anything.
2. Only add temporary instrumentation first, confirm the exact hang point
   via the browser check's real output, THEN fix it. Don't fix speculatively.
3. **Only edit `script.js` and `LOADHANG_PROGRESS.md`.** Do not reference
   any other filename in this repo, for any reason, in your reply - any
   exact filename that appears anywhere in this conversation, even inside a
   sentence telling you NOT to touch it, gets silently auto-added to your
   context by the tool running you.
4. **Never break loading of normal (non-crazy, below `ALIGN_CRAZY_VOLUME`)
   alignments**, or the "Large alignment, proceed?" dialog flow for crazy
   ones. This must remain a real, working confirmation dialog, not
   something bypassed to dodge the hang.
5. Commit at the end of every run with `git add -A && git commit -m "..."` -
   specific, describing what changed and where. Never `--amend`.
6. If a run is bigger than expected, stop at a safe sub-point, commit what
   compiles, note exactly where you stopped in `LOADHANG_PROGRESS.md`, and
   end the run.
7. Remove your temporary instrumentation once the real fix is confirmed
   working (i.e. don't leave debug console.log spam in the final state) -
   but it's fine to leave it in during intermediate runs while still
   diagnosing.
8. When you believe the bug is fixed, mark `LOADHANG_PROGRESS.md`'s
   "Current phase" as "All phases complete", describing the root cause and
   the fix, and stop.

## Browser check (self-verification, no browser access needed on your end)

A `BROWSER_CHECK_CMD` runs automatically after each of your commits (via
the wrapper script that invokes you) - it loads exactly this 300x12000
scenario in real headless Chrome and asserts `parseAndRender` resolves
within 30 seconds. Its pass/fail output gets appended to
`LOADHANG_PROGRESS.md` automatically if it fails - read that section if
present, it tells you exactly what the last attempt's real runtime
behavior was.

## LOADHANG_PROGRESS.md format

```markdown
# Load-hang bug progress

## Done
- <one-line summary per run> (commit <hash>)

## Current phase
<in progress / blocked / All phases complete>
<details>

## Instrumentation findings
<exact trace output that pinpointed the hang, with numbers>

## Root cause (fill in once found)
<exact mechanism>

## Fix
<what changed and why it's correct, and confirmation the instrumentation was removed>

## Notes for the next run
<anything not obvious from the code>
```
