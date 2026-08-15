# Task: make Canvas mode editable, phase by phase

You are working alone across many separate invocations (no memory between
runs except what's in this repo). Read `PROGRESS.md` first — it tells you
exactly which phase to do next and what's already done. If `PROGRESS.md`
doesn't exist yet, this is the first run: create it and start Phase 0.

## Context (script.js, ~17,000 lines, do not paste it back to me)

This is a multi-sequence-alignment (MSA) web viewer/editor. It has four
view modes selected by radio buttons `#modeSingle` (Full), `#modeBlocks`
(Block), `#modeCanvas` (Canvas), `#modeReads` (Reads). Full and Block are
DOM-per-residue (`<span data-pos="N">`) and already support the full
editing toolset. Canvas mode (`_renderCanvasAlignment`, `_initCanvasMetrics`,
search for both) draws the alignment as `<canvas>` pixels instead of DOM —
it is currently VIEW-ONLY: no click handling, no selection, no editing.
It is already fast at any file size (viewport-culled drawing) — that part
does not need to change. Your job is to add the missing interaction layer
on top of the existing canvas drawing code, port by port, until Canvas
mode has full editing parity with Full/Block mode.

Key existing building blocks to reuse, not reinvent:
- `getVisibleRowColumnRange(container, rowHeightPx, charWidthPx, nameColWidthPx, overscanRows, overscanCols)`
  — pure geometry helper, converts scroll position to visible row/col range.
  The same math (clientX/clientY → row/col index) is what you need for
  hit-testing; look at how it derives row/col from pixel offsets and reuse
  the same formulas for point hit-testing (not just range hit-testing).
- `state.seqs`, `state.selectedNucs`, `state.editModeActive`, and the other
  state fields Full/Block mode already read/write for selection and
  editing — DO NOT invent parallel state for Canvas mode. Read how
  `handleNucleotideSelectMouseDown`, `handleColumnSelectMouseDown`,
  `handleRowSelectMouseDown` mutate state today in DOM mode, then make
  Canvas mode's new mouse handlers mutate the SAME state, then trigger a
  redraw (`_renderCanvasAlignment` or a lighter incremental repaint if one
  exists) so the two view modes stay interchangeable — a user must be able
  to select something in Canvas, switch to Full, and see the same
  selection, and vice versa.
- `_measureFullModeColumnMetrics` / `_fullModeCharWidthPx` /
  `_fullModeRowHeightPx` and Canvas's own internal metrics
  (`_initCanvasMetrics`) — Canvas mode likely already has its own
  charWidth/rowHeight/nameColWidth measurements for drawing; use those for
  hit-testing math, don't remeasure with different logic.

## Ground rules (non-negotiable, every phase)

1. **Never break Full, Block, or view-only Canvas.** Every phase must leave
   the app in a working state for every existing mode. `script.js` is large
   enough that a single turn already uses most of your available context —
   there is no budget for an in-conversation self-check turn, so get it
   right in one pass: re-read the exact SEARCH text before writing each
   block, and mentally trace the edit rather than relying on a retry loop.
   A wrapper script runs `node -c script.js` after you exit and will
   automatically revert your commit (and note it in `PROGRESS.md` under
   `## BLOCKED`) if it doesn't pass — a caught syntax error costs the whole
   run's work, not just a warning.
2. **One phase per run.** Do not attempt Phase N+1 in the same invocation
   where you finished Phase N. Finish the current phase, update
   `PROGRESS.md`, commit, and stop. A separate invocation will pick up the
   next phase later — this is intentional, it's how a human reviewer
   checks in on your work between phases.
3. **Commit at the end of every phase** with `git add -A && git commit -m
   "..."` — a clear, specific message (what interaction was added, what
   file/function it touches). Never `--amend`. Never touch git history.
4. **Only edit `script.js` and `PROGRESS.md`. Never open, touch, or ask to
   add `styles.css`, `index.html`, `manual.html`, or any other file** — not
   even for a cursor change. For cursor/hover feedback, set it inline in
   JS (`canvas.style.cursor = '...'`, exactly like the existing pan code
   already does a few lines above where you're editing) instead of adding
   a CSS rule. This isn't a style preference: adding any file not already
   in the chat mid-run forces a second, much more expensive turn that
   resends everything already sent once — confirmed this alone was enough
   to blow past the model's context ceiling and silently crash the entire
   run with zero work saved. Do not bump `BUILD_TAG`.
5. **If a phase turns out to be bigger than expected**, stop at a safe
   sub-point, note exactly where you stopped and why in `PROGRESS.md`
   under "Phase N (in progress)", commit what compiles and works, and end
   the run. Do not leave the file in a broken/uncommitted state.
6. **If you get stuck or genuinely cannot make progress** (missing
   information, contradictory requirement, existing code doesn't do what
   this doc assumes), write exactly what's blocking you in `PROGRESS.md`
   under "BLOCKED", commit, and stop. Do not guess and silently ship
   something that might be wrong — a human will read `PROGRESS.md` and
   unblock you before the next run.

## PROGRESS.md format (create/update this every run)

```markdown
# Canvas-edit progress

## Done
- Phase 0: <one-line summary> (commit <hash>)
- Phase 1: <one-line summary> (commit <hash>)

## Current phase
Phase N (in progress / blocked / not started)
<details: what's done so far this phase, what's left, any blocker>

## Notes for the next run
<anything the next invocation needs to know that isn't obvious from the code>
```

## Phases (do them in this order, one per run)

**Phase 0 — hit-testing foundation, no visible behavior change yet.**
Add a pure function `_canvasHitTest(clientX, clientY)` that returns
`{row, col}` (or `null` if outside the data area) using the canvas
element's `getBoundingClientRect()` plus whatever charWidth/rowHeight/
nameColWidth Canvas mode already measures for drawing. Add a `mousemove`
listener on the canvas that just calls this and stores the result in a
module-level `_canvasHoverCell` variable — no visual feedback yet, no
redraw. Write 3-4 hand-worked examples in a code comment showing the
math is correct (pick specific pixel coordinates, compute expected
row/col by hand, confirm the formula gives that answer) — the same
rigor `getVisibleRowColumnRange` itself already documents.

**Phase 1 — click-to-select a single residue.**
On `mousedown` on the canvas (data area, not the name column), compute
`{row, col}` via `_canvasHitTest`, set the SAME selection state Full/Block
mode's `handleNucleotideSelectMouseDown` sets for a single-residue click
(read that function first, mirror its state mutations, not its DOM
mutations), then trigger a redraw so the selected cell is visibly
highlighted (add a thin highlight rect draw step to `_renderCanvasAlignment`
gated on whether that cell is in `state.selectedNucs` or equivalent).
Clicking the name column should do nothing yet (that's Phase 3).

**Phase 2 — drag-range selection.**
Extend Phase 1's mousedown into a mousedown+mousemove+mouseup drag that
selects a rectangular range of residues, mirroring whatever range-select
state mutation Full/Block mode's drag-select path uses. Redraw the
highlight rect live as the drag moves (throttle to animation frames, not
every mousemove event — reuse the same rAF-coalescing pattern already in
`_createWindowedScrollController` if applicable, don't invent a new one).

**Phase 3 — column and row selection.**
Clicking a column-ruler position (if Canvas mode draws one) selects the
whole column, mirroring `handleColumnSelectMouseDown`'s state mutations.
Clicking a sequence name in the sticky name column selects the whole row,
mirroring `handleRowSelectMouseDown`'s state mutations.

**Phase 4 — hover tooltip.**
Wire the Phase 0 hover-cell tracking to whatever tooltip mechanism
Full/Block mode already uses (`showTooltipAt` or similar) — show the same
info (residue, position, sequence name) on hover in Canvas mode.

**Phase 5 — right-click context menu.**
On the canvas, right-click at a hit-tested cell should open the same
context menu Full/Block mode opens (`showContextMenu` or similar),
positioned at the click point, operating on whatever cell/selection is
under the cursor.

**Phase 6 — GeneDoc edit-mode tools (the big one — expect this to take
multiple runs; that's fine, use the "stop at a safe sub-point" rule).**
When `state.editModeActive` is true and the user is in Canvas mode,
dragging within a selected region should perform the same move/slide/
gap-insertion mutations Full/Block mode's edit-drag tools perform. Read
`editDrag`/`editCell` state and whatever functions currently only work
against DOM spans; you'll need to make the underlying mutation functions
DOM-agnostic (operate on `state.seqs` directly, which they likely already
do) and just make sure Canvas mode's drag handler calls into the same
mutation path Full/Block's DOM drag handler calls, then redraws instead
of relying on DOM updates.

**Phase 7 — remaining parity items** (codon-analysis click-to-jump, TSD
marking clicks, breakpoint marker hover, search-hit highlighting/
click-to-scroll). Do these as sub-phases (7a, 7b, 7c, 7d), one per run,
same pattern as above: find the existing Full/Block handler, mirror its
state mutation, wire a canvas-native hit-test + redraw in its place.

## When all phases are done

Update `PROGRESS.md`'s "Done" section to say so explicitly, and stop.
Do not attempt further changes without new instructions.
