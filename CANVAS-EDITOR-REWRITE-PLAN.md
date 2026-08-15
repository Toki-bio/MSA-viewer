# Option B: canvas-based rendering (scoped future project)

Written 2026-08-15. This document scopes the harder, higher-ceiling
alternative so it's ready to pick up later without re-deriving the
tradeoffs from scratch.

**Status of Option A as of 2026-08-15 (v173): viewing AND editing are both
fast now, in all three DOM-based modes, and the scroll/render machinery
behind Full and Block windowing is now one shared implementation instead
of two parallel copies.** v173 extracted `_createWindowedScrollController`
(rAF-coalescing, suppress-next-scroll-event, bind-once-per-container) and
`_removeNodesBetweenSpacers` (the between-two-spacers DOM swap) out of the
duplicated Full-mode and Block-mode scroll listeners into one shared
implementation each mode instantiates. This doesn't change behavior - the
full 46-check regression suite (including both 40M-residue stress tests)
passed byte-for-byte identically before and after - but it removes the
main risk this triplication created: any future fix to the rAF-coalescing
or scroll-suppression logic (both areas that have already had real,
subtle bugs surface in this session) previously had to be applied and
re-verified in two places by hand, with no compiler or test catching a
missed spot. What v173 did NOT do: merge the row-window vs block-window
*rendering* logic itself (what gets built for each visible unit) into one
function - Full mode's per-row + per-column windowing and Block mode's
per-block windowing are different enough in shape (2D vs 1D) that forcing
them into one code path would trade real clarity for a forced abstraction,
not gain any actual duplication removal, so the two `_buildBlockElement`
vs `createSequenceLine`-in-a-loop rendering paths remain intentionally
separate. Block mode is now windowed too
(v172) - it renders only the column-chunk block(s) currently scrolled into
view (+ overscan), backed by the same top/bottom-spacer pattern as Full
mode's row windowing, rather than every block for the whole alignment up
front. On the same 40M-residue synthetic file that hung past 60s before,
it now completes in ~11s (matching Full mode's own first-paint conservation
cost at that scale) and keeps the DOM bounded to 2 blocks/~4,000 rows
instead of ~334 blocks/~668,000 rows. One real bug surfaced and got fixed
during this: the initial (pre-measurement) fallback height estimate for
"how tall is one block" was borrowed from Full mode's per-row fallback
(16px) - correct order of magnitude for a single row, wildly wrong for a
block that contains every row stacked together, which made the very first
windowed render think dozens of blocks fit in the viewport instead of ~1
and build all of them. Fixed by estimating from sequence count instead
until a real block has been measured. Row windowing (v167/v168) and column windowing (v169) mean Full
mode windows rows and columns together, so alignments large in either or
both dimensions stay responsive to scroll. Edit-mode reshading (v170) is
now genuinely incremental (recomputes only the edited columns, not the
whole alignment) - exiting edit mode after a small edit on the real
5.97M-residue test file dropped from ~655ms to ~13-16ms, verified
byte-for-byte identical to a full recompute. v171 closed the remaining gap
in the safety net rather than the performance itself: direct measurement
(40M-residue synthetic alignment) confirmed Block mode - never windowed,
untouched all session - genuinely hangs past 60s at that scale, the same
bug class as the original Full-mode freeze; the existing "Large alignment"
warning dialog now gates Block mode too, not just Full, and its wording is
corrected to reflect that Full mode's windowing actually works now (it
previously still said "no windowing... can fully freeze"). Along the way,
a real bug surfaced and got fixed: the dialog's cancel-revert tracked a
`_lastModeRadioId` variable that was never updated when the app's own
auto-switch-to-Canvas heuristic fired (only user-driven mode changes
updated it), so its stale default could coincidentally equal the mode
being canceled and make "revert" silently a no-op. What's *not* done yet:
Block mode itself has no windowing (only a warning against using it at
scale), and unifying Block/Canvas/Full into one always-windowed,
always-editable renderer (they're still three separate code paths with
three different performance profiles). That's the next step if more
headroom is still needed before reaching for Option B below.

## Prior art (researched 2026-08-15)

- **Jalview** (the field-standard desktop MSA editor, 20+ years of
  development) still has a documented hang on rapid scroll past ~10,000
  columns per its own changelog - real confirmation this is a genuinely
  hard problem class, not something this codebase uniquely got wrong.
  Its actual source lives on a self-hosted Bitbucket/Crucible instance
  (University of Dundee), not readily fetchable; github.com/jalview/jalview
  is an empty mirror.
- **AlignmentViewer2.0** (sanderlab, React + TypeScript, actively
  maintained, tested on ~23,000-sequence alignments) is the most directly
  comparable prior art - same problem, same web/DOM constraints. Two
  things worth noting:
  - It validates the exact approach taken here: "a virtualized matrix
    together with virtual scrollbars... we only insert the portion of the
    MSA that is visible at any given time." Same core idea as
    `renderFullModeWindowedRows`/`_refreshFullModeWindowOnScroll`.
  - **No third-party virtualization library** (no react-window,
    react-virtualized, etc.) - `package.json` shows a hand-built
    virtualized grid, matching this project's own hand-built approach.
    Confirms that generic single-axis list-virtualization libraries don't
    fit an alignment's specific needs (2D grid, sticky name column) well
    enough that reaching for one would have saved real effort.
  - For the *zoomed-out overview* case specifically (not the main editing
    view), it renders via **PixiJS (WebGL) as tiled images** rather than
    DOM or canvas 2D - avoiding both DOM bloat and browser single-image
    size limits. Not relevant to Option A/B as scoped here, but a genuine,
    separate idea worth considering if an alignment overview/minimap
    feature is ever wanted - `C:/work/SINE_pixel_viewer` (verified:
    `src/viewer.ts` "filters, sorts, windows, and renders alignment data to
    a canvas heatmap") is an existing, unrelated project that already does
    exactly this kind of dense pixel-per-residue canvas rendering, worth a
    look if that path is taken.

## Why this exists

Option A (windowing the existing DOM renderer) fixes the actual bottleneck
proven this session — nothing was ever windowed, not that DOM is inherently
too slow — and gets there without touching a single existing interaction.
It has a real ceiling, though: every scroll tick still creates/destroys real
DOM nodes, which is fundamentally more expensive than a canvas repaint. If,
after Option A is finished and stress-tested, there's still a gap that
matters for real files, this is the path to close it completely.

## What it actually requires

Canvas mode already exists in this app (`_renderCanvasAlignment`,
`_initCanvasMetrics`) and already proves the core technique works here:
viewport-culled drawing, cost bound to visible pixels only, near-instant
first paint regardless of file size. It is currently **view-only** — no
editing, no selection beyond nothing. That's not a limitation of canvas
rendering in general (Monaco and CodeMirror 6 both edit multi-megabyte text
at native speed using exactly this technique) — it's that this app's canvas
mode was never given hit-testing or edit machinery.

Making it editable means every interaction currently "free" via native DOM
event targeting has to be rebuilt as coordinate math against the canvas.
Inventory of what that covers in this codebase (grep `handle.*MouseDown`,
`handle.*Click`, drag handlers):

- Click-to-select a single residue (`handleNucleotideSelectMouseDown`)
- Ctrl+drag range selection across residues
- Column selection (`handleColumnSelectMouseDown`)
- Row selection (`handleRowSelectMouseDown`)
- Row drag-to-reorder (`_startRowReorderDrag` and friends)
- GeneDoc edit-mode tools: move/slide/gap insertion, drag-based residue
  editing (`editDrag`, `editCell` state)
- Right-click context menu positioning (`showContextMenu`)
- Hover tooltips (`showTooltipAt`)
- Codon-analysis click-to-jump between frames
- TSD (target site duplication) marking clicks
- Breakpoint marker hover (title/tooltip)
- Search-hit highlighting and click-to-scroll-to-match

Each of these currently gets correct hit-testing, cursor changes, and event
bubbling for free from the browser's DOM/event model. In a canvas renderer
none of that exists — every one needs: (a) a `mousemove`/`mousedown` handler
on the canvas element translating `clientX/clientY` to row/column indices
via the same kind of arithmetic already proven in `getVisibleRowColumnRange`,
(b) manual hit-testing against whatever's "under the cursor" (a residue? a
breakpoint marker? a name label?), and (c) manual redraw of any visual
feedback (selection highlight, drag preview, hover state) since there's no
CSS `:hover`/`.selected` class to lean on.

## Realistic scope

Not a few sessions — this is genuinely a from-scratch reimplementation of
the interaction layer for a feature-rich editor, while keeping the existing
data model (`state.seqs`, `state.selectedNucs`, etc. — those don't need to
change) and the existing Canvas-mode drawing code as the rendering
foundation. Realistic shape: one interaction category at a time (start with
residue click-select, since it's the simplest and most-used; end with
edit-mode drag tools, the most complex), each with its own test-first spec
the way column windowing was approached, each shippable independently
behind a mode flag so Full/Block/Canvas-view-only keep working throughout.

## Recommendation

Don't start this until Option A is finished, shipped, and stress-tested
against real files for a while. If a genuine, measured gap remains after
that, this doc is the starting point — the interaction inventory above is
the actual work breakdown, and `getVisibleRowColumnRange`'s coordinate math
is already the right building block for the hit-testing layer.
