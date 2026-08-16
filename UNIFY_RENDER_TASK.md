# Task: unify Full mode and Block mode into one DOM renderer

You are working alone across many separate invocations (no memory between
runs except what's in this repo). Read `UNIFY_PROGRESS.md` first — it tells you
exactly which phase to do next and what's already done. If `UNIFY_PROGRESS.md`
doesn't exist yet, this is the first run: create it and start Phase 0.

## Context

This is a multi-sequence-alignment (MSA) web viewer/editor with four
display modes: Full (`#modeSingle`), Block (`#modeBlocks`), Canvas
(`#modeCanvas`), Reads (`#modeReads`). Full and Block are both DOM-per-
residue renderers and are structurally almost the same thing wearing
different clothes:

- **Block mode** chunks the alignment into fixed-width column blocks
  (`blockWidth`, user-adjustable via a slider), each block getting its own
  ruler + optional consensus row + one row per sequence, stacked
  vertically. Built by `_buildBlockElement(start, end, ...)` per block.
- **Full mode** renders the whole alignment as columns 0..len-1 with ONE
  ruler at the top and ONE consensus row, not repeated. Built by
  `createSequenceLine(index, 0, len, ...)` per sequence row.

The key insight (already verified, not something you need to re-derive):
if you look at Block mode's block-loop (`for (let start = 0; start < len;
start += blockWidth)`), setting `blockWidth` to `len` itself makes that
loop run exactly ONE time — producing exactly one ruler and one consensus
row, i.e. exactly what Full mode already does. **Full mode is
mathematically a special case of Block mode with an unbounded block
width.** That's the structural fact this whole task exists to exploit —
don't invent a different unification strategy without first trying this
one and hitting a real, specific wall.

The complication: on large ("crazy") alignments, both modes are
*windowed* (only currently-visible DOM gets built, for performance) —
but their windowing granularity differs. Full mode windows in 2D: both
which ROWS and which COLUMNS are visible (`renderFullModeWindowedRows`,
`_refreshFullModeWindowOnScroll`, using `getVisibleRowColumnRange`).
Block mode windows in 1D: only which BLOCKS are visible vertically
(`renderBlockModeWindowedBlocks`, `_refreshBlockModeWindowOnScroll`) —
every row of a visible block always renders, block width is already
small enough (typically 40-80 columns) that column-windowing within a
block isn't needed. If Full mode is treated as "one giant block," that
one block would need ~3000+ rows fully rendered with no row-windowing at
all, which is exactly the freeze bug this codebase already fixed once
(see the row-windowing work already in Full mode) — so a naive "reuse
Block mode's windowing as-is for the unified renderer" would silently
reintroduce that freeze on Full mode specifically. The unified windowing
approach needs to keep row-level (and, for narrow-viewport cases,
column-level) granularity available, not just block-level. This is the
central design problem Phase 0 exists to resolve carefully, in writing,
before any code changes.

## Ground rules (non-negotiable, every phase)

1. **One phase per run.** Finish the current phase, update `UNIFY_PROGRESS.md`,
   commit, and stop.
2. **Commit at the end of every phase** with `git add -A && git commit -m
   "..."` — specific, describing what changed and where. Never `--amend`.
3. **Only edit `script.js` and `UNIFY_PROGRESS.md`.** Do not reference any other
   filename in this repo, for any reason, in your reply — any exact
   filename that appears anywhere in this conversation, even inside a
   sentence telling you NOT to touch it, gets silently auto-added to your
   context by the tool running you, which has caused repeated real
   failures on other tasks in this project. If you believe a change to
   another file is genuinely needed, say so in `UNIFY_PROGRESS.md` under
   `## Notes` and stop — don't try to add it.
4. **Never break Canvas mode, Reads mode, or small (non-windowed)
   Full/Block rendering.** This refactor is scoped to the windowed
   (large-alignment) DOM rendering path for Full/Block specifically. If
   you're touching a function also used by other modes or the small-
   alignment path, read every call site first.
5. **Prove equivalence before deleting anything.** At every phase where
   you introduce a new unified code path alongside an old one, leave the
   old one in place and callable until a LATER phase has confirmed (via
   the syntax check + your own careful tracing — you have no browser) that
   the new path produces the same structural output for both a Full-mode
   case and a Block-mode case. Only delete old code once you've
   explicitly reasoned through that equivalence in `UNIFY_PROGRESS.md`.
6. **If a phase is bigger than expected**, stop at a safe sub-point, note
   exactly where and why, commit what compiles, and end the run.
7. **If genuinely blocked** (the unification turns out unsound, a wall you
   can't get past), say so plainly in `UNIFY_PROGRESS.md` under `## BLOCKED`
   with your specific reasoning, commit, and stop. A human will read it
   and decide whether to redirect. Do not force a bad unification through
   just to show progress — a working two-path system is strictly better
   than a broken unified one.
8. **No automated browser testing available to you.** A human will run
   the real regression suite (both modes, small and large alignments,
   scroll behavior, edit mode) after each phase or at natural checkpoints.
   Your job is correctness by careful reading and reasoning, not visual
   self-verification.

## UNIFY_PROGRESS.md format (create/update every run)

```markdown
# Unify-render progress

## Done
- Phase 0: <one-line summary> (commit <hash>)

## Current phase
Phase N (in progress / blocked / not started)
<details>

## Notes for the next run
<anything not obvious from the code>
```

## Phases

**Phase 0 — design note, no code changes.**
Read `renderFullModeWindowedRows`, `_refreshFullModeWindowOnScroll`,
`renderBlockModeWindowedBlocks`, `_refreshBlockModeWindowOnScroll`,
`_buildBlockElement`, `getVisibleRowColumnRange`, and the two
`_createWindowedScrollController` instantiations, side by side. Write a
design note in `UNIFY_PROGRESS.md` answering explicitly:
- What are ALL the concrete differences between the two windowing
  schemes (spacer class names, height-per-unit calculations, what gets
  rebuilt on scroll, what's cached where)?
- Does a single function that windows by "row range within column range
  within a repeating block structure" (i.e. generalizing Full mode's 2D
  row+column windowing to ALSO iterate over blocks, where Block mode's
  blocks are just its existing multi-block case and Full mode is the
  single-unbounded-block case) actually work for both, or is there a
  concrete case where it breaks down? Think through: a Block-mode block
  narrower than the viewport, a Block-mode block with more rows than fit
  vertically (does Block mode currently row-window WITHIN a block at
  all? if not, does it need to for this to be correct, or is it
  currently only safe because block width being small keeps DOM count
  bounded even with all rows rendered per visible block?).
- Propose the concrete shape of the unified function(s) - names,
  parameters, what stays separate vs shared. Do NOT write the
  implementation yet, just the plan, in enough detail that Phase 1 can
  execute it without re-deriving this analysis.
If this analysis concludes full unification is unsound for a specific
reason, say so under `## BLOCKED` with the specific reason instead of
forcing it — that's a valid, useful outcome of this phase.

**Phase 1 — build the unified windowed-render function, additively.**
Following Phase 0's plan, write the new unified function(s) as new code
(new function names, e.g. `renderUnifiedWindowedDom(...)`) without yet
calling them from anywhere live. Keep `renderFullModeWindowedRows` and
`renderBlockModeWindowedBlocks` fully intact and still in use. This phase
is purely additive - the app's behavior must not change at all yet.

**Phase 2 — wire Full mode to the new unified path, behind verification.**
Change Full mode's call site (in `renderAlignment()`) to call the new
unified function instead of `renderFullModeWindowedRows`. Leave Block
mode on its old path. Trace through by hand (reading the code, not
running it) that the unified function produces the same spacer
structure, same row range, same column range for a Full-mode case as the
old function did. Document this trace in `UNIFY_PROGRESS.md`.

**Phase 3 — wire Block mode to the new unified path.**
Same as Phase 2 but for Block mode's call site. After this phase, BOTH
modes call the unified function; the old `renderFullModeWindowedRows`/
`renderBlockModeWindowedBlocks`/`_refreshFullModeWindowOnScroll`/
`_refreshBlockModeWindowOnScroll` become dead code (not yet deleted).

**Phase 4 — unify the scroll controllers.**
`_fullModeScrollController` and `_blockModeScrollController` are already
both built from the shared `_createWindowedScrollController` factory
(from an earlier refactor) - collapse them into one controller instance
if the unified render function makes that possible, or explain in
`UNIFY_PROGRESS.md` why they still need to stay separate if there's a real
reason (e.g. different activation conditions that can't cleanly merge).

**Phase 5 — unify the non-windowed (small-alignment) loops.**
`renderAlignment()` has a second pair of near-duplicate loops for the
non-"crazy" case (the plain `for` loop building all rows directly,
Block's version building all blocks directly). Apply the same "Block
with unbounded width" insight there if it holds, using a shared helper.

**Phase 6 — delete confirmed-dead code.**
Only after Phases 2-5 have made the old functions genuinely unreachable
(confirm via search - no remaining call sites), delete
`renderFullModeWindowedRows`, `renderBlockModeWindowedBlocks`,
`_refreshFullModeWindowOnScroll`, `_refreshBlockModeWindowOnScroll`, and
any other now-dead helper. Do not delete anything still referenced
anywhere, including from a debugger/console-exposed name.

**Phase 7 — final pass.**
Re-read the fully unified render path top to bottom for anything left
inconsistent (stale comments referencing deleted functions, leftover
mode-specific special-casing that's no longer needed, naming that still
says "Full" or "Block" where it's now generic). Clean up. Update any
comments that describe the old two-path architecture.

## When all phases are done

Update `UNIFY_PROGRESS.md`'s "Done" section to say so explicitly, and stop.
