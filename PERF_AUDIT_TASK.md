# Task: audit the windowed-scroll hot path for the "full width, not window" bug class

You are working alone across many separate invocations (no memory between
runs except what's in this repo). Read `PERF_AUDIT_PROGRESS.md` first — it
tells you exactly which phase to do next and what's already done. If
`PERF_AUDIT_PROGRESS.md` doesn't exist yet, this is the first run: create
it and start Phase 0.

## Context

This is a multi-sequence-alignment (MSA) web viewer/editor. Full and Block
display modes share one windowed DOM renderer for large ("crazy")
alignments: on every scroll event, `_refreshUnifiedWindowOnScroll(container)`
rebuilds only the currently-visible rows/columns via `_buildUnifiedBlock(...)`,
which calls `createSequenceLine(...)` per visible row and `addConsensusLine(...)`
for the consensus row, all scoped to a computed `colStart`/`colEnd` window
(not the whole alignment width).

**A real, already-fixed bug in this exact area, so you understand the
shape of what you're looking for:** `_buildUnifiedBlock` used to call
`addConsensusLine(blockDiv, consensus, start, end, ...)` using the BLOCK's
full start/end (the whole alignment width in Full mode's single-block
case) instead of the windowed `colStart`/`colEnd + 1`. Each consensus span
also carries its own hover listener, so this built one span+listener PER
COLUMN of the entire alignment on every scroll-triggered refresh,
regardless of what was actually visible. Measured directly: 290ms of a
348ms total scroll-refresh (84%) on a 6M-residue alignment, scaling
linearly up to 4.3 SECONDS at 100M residues — the exact signature of
unwindowed O(full-width) work hiding inside what looked like an already-
windowed function. Fixed by passing the same `colStart`/`colEnd` already
computed for data rows, plus applying `_applyColumnWindowStyle` so
horizontal scroll position stays correct.

**Already checked and confirmed NOT to have this bug** (so you don't
need to re-investigate these, though feel free to double-check if
something looks off): `reapplySearchHighlights()` / `_paintSearchEntryOnAlignment()`
(only walks DOM elements that already exist in the windowed render, so it's
naturally bounded); the codon-analysis AA-translation-row post-processing
in `renderAlignment()` (derives its own column range from the actual
rendered spans' `data-pos` attributes, i.e. already windowed correctly).

## Your job

Systematically trace every function reachable — directly or transitively —
from a scroll-triggered refresh cycle (`_refreshUnifiedWindowOnScroll` and
everything it calls, all the way down), and for each one determine: does
its cost/DOM-node-count depend on the FULL alignment width or row count,
or only on the windowed range actually passed into it? Any function that
takes a `start`/`end` (or `len`) parameter and loops `for (pos = start; pos
< end; pos++)` or similar is a candidate — check whether the CALLER passes
the true full range or the windowed range at that specific call site.

This is real, careful reading, not guessing - the consensus bug looked
completely reasonable at a glance (it's inside a function called
`_buildUnifiedBlock`, which sounds windowed by name) and only showed up
under direct profiling. Don't rule something out just because it "looks
windowed" - trace the actual argument values at the actual call site.

## Ground rules (non-negotiable, every phase)

1. **One phase per run.** Finish the current phase, update
   `PERF_AUDIT_PROGRESS.md`, commit, and stop.
2. **Commit at the end of every phase** with `git add -A && git commit -m
   "..."` — specific, describing what changed and where. Never `--amend`.
3. **Only edit `script.js` and `PERF_AUDIT_PROGRESS.md`.** Do not reference
   any other filename in this repo, for any reason, in your reply — any
   exact filename that appears anywhere in this conversation, even inside
   a sentence telling you NOT to touch it, gets silently auto-added to
   your context by the tool running you, which has caused repeated real
   failures on other tasks in this project.
4. **You have no browser and cannot run the app.** Every conclusion has to
   come from reading the code carefully, not from running it. A human
   will independently profile and verify every fix you make before it's
   merged - so it's fine (expected, even) to flag something as "I believe
   this is a real bug based on the code, but I can't confirm the actual
   millisecond cost" rather than overclaim certainty you don't have.
5. **Never break Canvas mode, Reads mode, or small (non-windowed)
   alignment rendering.** This audit is scoped to the windowed (large-
   alignment) DOM rendering path specifically.
6. **Don't fix speculatively.** If you find a function that takes a
   suspiciously large range but you can't fully trace whether the caller
   passes windowed or full values, say so explicitly in
   `PERF_AUDIT_PROGRESS.md` as "needs human verification" rather than
   guessing at a fix.
7. **If a phase is bigger than expected**, stop at a safe sub-point,
   note exactly where and why, commit what compiles, and end the run.
8. **If genuinely blocked**, say so plainly in `PERF_AUDIT_PROGRESS.md`
   under `## BLOCKED`, commit, and stop.

## PERF_AUDIT_PROGRESS.md format (create/update every run)

```markdown
# Perf-audit progress

## Done
- Phase 0: <one-line summary> (commit <hash>)

## Current phase
Phase N (in progress / blocked / not started)
<details>

## Confirmed bugs found and fixed
<list, one per bug, with the measurement/reasoning that confirmed it>

## Suspects investigated and ruled out (false positives)
<list, one per suspect, with the reasoning that cleared it>

## Needs human verification
<anything you couldn't fully trace with certainty>

## Notes for the next run
<anything not obvious from the code>
```

## Phases

**Phase 0 — build the call graph, no code changes.**
Starting from `_refreshUnifiedWindowOnScroll`, trace every function it
calls, and every function THOSE call, as deep as it goes (stop at
genuinely leaf-level browser APIs like `document.createElement` or
`getBoundingClientRect`). Write the full call graph into
`PERF_AUDIT_PROGRESS.md`, noting for each function: what range/length
parameters it takes, and what values are passed at each call site
reachable from the scroll-refresh path specifically (a function might be
called from MULTIPLE places in the codebase with different arguments -
you only care about the scroll-refresh call site's actual values). Also
include `_buildUnifiedBlock` itself and everything it calls
(`createSequenceLine`, `addConsensusLine`, `generateScale`,
`generateScaleHTML`, `_applyColumnWindowStyle`, and anything those call
internally - e.g. does `createSequenceLine` call any conservation/
breakpoint/TSD lookup functions that themselves loop over a range?).

**Phase 1 — classify every function in the call graph.**
For each function in Phase 0's graph, classify it as:
- **SAFE**: cost is bounded by the windowed range actually passed at the
  scroll-refresh call site (like data rows already are, and consensus now
  is after the fix).
- **SUSPECT**: cost appears to depend on something larger than the
  windowed range (the full alignment width, the full row count, or
  similar) - name the specific reason.
- **UNCLEAR**: you traced as far as you could but can't be fully certain
  without running the code - describe exactly what's uncertain.
Update `PERF_AUDIT_PROGRESS.md` with this classification for every
function. Do not fix anything yet - this phase is pure analysis.

**Phase 2 onward — investigate and resolve each SUSPECT/UNCLEAR item,
one per run (or grouped if genuinely small/related).**
For each SUSPECT: trace it fully. If it's confirmed to be a real bug
(operates on a larger range than what's visible, in a way that would
scale cost with total alignment size rather than viewport size), fix it
using the same pattern the consensus fix used: find the actual windowed
range already computed at the relevant call site (usually `colStart`/
`colEnd` or `rowStart`/`rowEnd` from `_buildUnifiedBlock`) and pass that
instead of the full range, applying `_applyColumnWindowStyle` if the
element's declared width needs to still span the full un-windowed extent
(for correct horizontal scroll behavior) while its rendered content is
narrower. If it turns out to be a false positive on closer inspection
(like search-highlighting and codon-AA-rows turned out to be), document
the specific reasoning that clears it and move on - don't force a fix
where none is needed.

## When all phases are done

Once every SUSPECT/UNCLEAR item from Phase 1 has been either fixed or
ruled out with documented reasoning, update `PERF_AUDIT_PROGRESS.md`'s
"Current phase" section to say "All phases complete" explicitly, and stop.
