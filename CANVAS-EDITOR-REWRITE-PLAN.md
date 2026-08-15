# Option B: canvas-based rendering (scoped future project)

Written 2026-08-15, alongside Option A (DOM virtualization, in progress —
see `AIDER-PLAYBOOK.md` and the `column-windowing` branch). This document
scopes the harder, higher-ceiling alternative so it's ready to pick up later
without re-deriving the tradeoffs from scratch.

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
