# Task: fix a browser-crash bug triggered by an uneven-length row in a large alignment, and add a length-mismatch warning

You are working alone across many separate invocations (no memory between
runs except what's in this repo). Read `CRASH_FIX_PROGRESS.md` first. If it
doesn't exist yet, this is the first run: create it and start.

## Context

A real user reported that loading a real ~1919-sequence FASTA alignment
crashed the browser tab entirely (Chrome's "Target crashed" event), instead
of showing a clear error. Investigation (already done, trust this - don't
re-derive it) found the exact cause: the file had ~10 lines of stray
terminal output (a version-listing banner) accidentally prepended before
the first `>` header. `parseFasta()` in `script.js` has a bug: it
accumulates non-`>` lines into a `seq` variable starting from before any
header is seen (`header` starts as `''`), and since the reset-on-new-header
logic only fires `if (header)` (truthy), that leading garbage never gets
cleared - it silently rides along and gets PREPENDED onto the first real
sequence's data. So the first sequence ends up 188 characters longer than
every other row in the alignment (2108 vs 1920), and this went completely
unnoticed - no error, no warning, just silent corruption.

**That data-corruption part matters, but it's secondary.** The DANGEROUS
part, and your actual job, is: loading this corrupted alignment (real scale,
~1919 rows, one row longer than the rest) reliably crashes the browser
tab. Confirmed empirically:
- The exact same real file with the corruption manually stripped (all rows
  uniform length) loads fine in ~1 second, no crash.
- A synthetic alignment of ~1919 rows with one row deliberately made 188
  characters longer, using DENSE sequence content (no gaps), does NOT
  crash - loads fine at that same scale.
- The REAL file's actual sequence content is very gap-sparse (long runs of
  `-` characters with small scattered nucleotide fragments) - this appears
  to matter, since dense synthetic data of the same shape didn't reproduce
  the crash. The interaction between (a) one row longer than the rest and
  (b) real-world gap-sparse content at real scale (~1919 rows) is the
  trigger, but the exact code path was not pinned down before handing this
  off.
- **Most useful lead:** the crash does NOT happen synchronously inside
  `parseAndRender()` - that call was observed to complete normally
  (resolved its promise in ~6 seconds, with `state.seqs` correctly
  populated: 1919 sequences, 2 distinct lengths as expected). The crash
  happens SOMETIME AFTER that promise resolves, when the page is
  interacted with again (a later `page.evaluate()` call times out /
  "Target crashed" fires during a ~8-15s window after load). This strongly
  suggests something deferred - a `requestAnimationFrame`, `setTimeout`,
  or chunked/incremental continuation kicked off by `renderAlignment()` or
  the windowed-DOM setup - keeps running (or grows unboundedly) in the
  background after `parseAndRender` itself returns, and that background
  work is what actually crashes the tab. Look for anything scheduled to
  continue asynchronously after the main render call returns - conservation
  pre-calculation, consensus computation, or windowed-DOM chunk scheduling
  are the most likely candidates given they're the parts of the pipeline
  known to run in slices/chunks for large alignments.

## IMPORTANT UPDATE - your first attempt did not actually fix the crash

A previous set of commits on this branch (already applied - you'll see them
in the file) added: (1) a real fix for the leading-garbage parsing bug
(confirmed working - the corrupted file's first sequence now comes out at
the correct length, no more silent corruption), (2) a length-mismatch
warning (confirmed working correctly on a genuine mismatch test), and (3) a
fallback that computes `state.alignmentIndex` from parsed sequences if the
pre-parse scan returns null, intended to make sure the windowed-DOM
rendering path still kicks in for a large alignment even when the initial
scan fails.

**That third fix does not actually prevent the crash.** Careful, repeated
re-testing (multiple runs, explicit crash-event monitoring, not just a
single quick check) confirms the real repro file still reliably crashes
the browser tab - sometimes within a couple seconds, sometimes after
`parseAndRender` itself has already resolved and even a *subsequent*
`page.evaluate()` call just to read `state.alignmentIndex` crashes the
page. This means either: the `alignmentIndex` fallback isn't actually
computing what it should (check `classifyAlignmentSize` - does it
correctly compute `needsWindowedDom` for a ~1919-row, ~1920-column
alignment, and does something downstream actually gate on that flag before
choosing the DOM-per-residue vs windowed-DOM render path?), or the crash is
in something else entirely that doesn't care about that flag at all.

Do not trust a single quick check run as confirmation of a fix - re-run the
real repro file's check multiple times, and specifically watch whether a
crash happens well AFTER `parseAndRender` resolves (not just during it),
since that's the actual observed pattern.

## Your job, in order

1. **Find the actual crash mechanism.** Somewhere in `script.js`'s
   rendering/conservation/consensus/windowing pipeline, code almost
   certainly assumes every row has the same length (a normal assumption for
   a real alignment) and does something that blows up - unboundedly, or
   with pathological time/memory complexity - when one row is a different
   length, specifically at real scale with gap-heavy data. Likely
   candidates to check first (not confirmed, just informed guesses):
   conservation/consensus computation across columns, `gaplessPositions`
   calculation (called per-sequence in `_pushParsedFastaSequence`), or the
   windowed-DOM row-rendering setup. Search for anywhere columns are
   iterated up to a shared "alignment length" while indexing into
   individual sequences without bounds-checking that specific row's actual
   length.
2. **Fix the actual crash mechanism** so a length-mismatched alignment,
   however large, never crashes or hangs the tab - it should render
   (however imperfectly) or fail gracefully, not take down the whole page.
3. **Add a length-mismatch warning at load time** (in `parseAndRender`,
   right after sequences are parsed, before they're committed to
   `state.seqs`): if parsed sequences don't all have the same length, show
   a clear message naming which sequence(s) differ and by how much (e.g.
   "Sequence 'X' is 2108 columns, but most of the alignment is 1920 -
   check for stray text before its '>' header, or use Realign All if this
   is intentionally unaligned data"). **This must NOT block loading** - the
   user explicitly decided on "warn but allow" over "hard reject", in case
   someone intentionally loads unaligned sequences to align them with the
   in-app MAFFT "Realign All" feature. Just warn, then proceed exactly as
   today otherwise.
4. Also fix the root parsing bug itself while you're in there: in
   `parseFasta()`, any non-`>` line encountered before the first `>` header
   is seen should be discarded, not silently accumulated into the first
   real sequence. (Search for the function - it's the one with `let seq =
   '', header = '';` and a loop over lines.)

## How to test against the real repro file

A Playwright check script (see Ground Rules - you don't run this yourself,
the wrapper does after each commit) loads the exact real file that
originally crashed. You don't have read access to that file's content and
don't need it - work from the bug description above, the code, and the
check's pass/fail feedback across runs.

## Ground rules (non-negotiable, every run)

1. Only edit `script.js`, plus `CRASH_FIX_PROGRESS.md` for your own notes.
   Do not touch tests, other client modules, or anything else.
2. **Commit incrementally, not just once at the end of the run.** If you
   make a real, working, non-breaking improvement (e.g., the length-warning
   addition, or a partial fix to the crash), commit it right then. Don't
   queue everything for one commit at the end - if a run gets cut off
   mid-way, whatever's already committed survives; whatever isn't, doesn't.
3. Run `node -c script.js` yourself before committing anything, to catch
   syntax errors before the wrapper's own gate does.
4. **This wrapper will NOT honor a "done" claim unless this exact run's own
   check passed.** The check verifies the real file loads without crashing,
   that a length-mismatch warning appears, AND that the full existing
   regression + functional test suites (which you are not touching) still
   pass. If the check fails, its output is appended to
   `CRASH_FIX_PROGRESS.md` for you to read and fix forward next run.
5. If genuinely blocked, say so plainly under `## BLOCKED` in
   `CRASH_FIX_PROGRESS.md`, commit, and stop.

## CRASH_FIX_PROGRESS.md format

```markdown
# Crash-fix progress

## Done
- <one-line summary per run> (commit <hash>)

## Current phase
<in progress / blocked / All phases complete>

## Notes for the next run
<what you found, what you ruled out, where to look next>
```

## When done

Once the crash is fixed (verified by the check passing - real file loads,
no crash, warning shown), the parseFasta leading-garbage bug is also fixed,
and the full test suites still pass, mark "Current phase" as "All phases
complete" and stop.
