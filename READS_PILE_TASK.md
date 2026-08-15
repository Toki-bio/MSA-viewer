# Task: rebuild Reads mode as a packed pile view (tview/IGV-style)

You are working alone across many separate invocations (no memory between
runs except what's in this repo). Read `PROGRESS.md` first — it tells you
exactly which phase to do next and what's already done. If `PROGRESS.md`
doesn't exist yet, this is the first run: create it and start Phase 0.

## Context

This is a multi-sequence-alignment (MSA) web viewer/editor. It has a
"Reads" display mode for viewing SAM/BAM-derived reads against a loaded
reference. Today, Reads mode renders one full-width DOM row per read (a
function early in the file that loops over every read and builds a row),
which is correct but not useful for a real pile: reads have no visible
start/end boundary, there's no packing (a 32-read pile can need only a
handful of visual tracks since most reads don't overlap in position), and
every read repeats its full name down the left margin.

Meanwhile, a *different*, unrelated rendering path already implements
proper track-packing and SVG bar-drawing for read piles — it was built for
a different data source (gapped MSA rows) and is currently wired to a
dead UI mode nobody can reach (no radio button routes to it in the page).
Your job across these phases is to **port that existing packing/drawing
logic into the actual live Reads-mode code path**, not invent a new
system from scratch — the hard geometry problems (track assignment,
coverage counting, SVG bar layout) are already solved once in this
codebase; find that code first each phase before writing anything new.

Key existing pieces to find and reuse (search for them, don't guess names):
- The object that holds parsed SAM/BAM data (reads array with per-read
  CIGAR-derived columns typed as match/mismatch/insertion/deletion/soft-
  clip, one array per read) — this is what Reads mode currently loops over
  to build one row per read.
- The unrelated renderer that already does greedy track-packing (sorts by
  start position, walks tracks, assigns a read to the first track whose
  last-occupied end is before this read's start) and draws each packed
  read as an SVG `rect` with a coverage histogram above it, a reference
  row, and a scale ruler — all sticky. This exists already; read it fully
  before writing your own version of anything it already does.
- The function that decides whether the "Reads" option is visible/enabled
  in the mode switcher, and the function that computes a read's genomic
  span from its CIGAR string.

## Ground rules (non-negotiable, every phase)

1. **One phase per run.** Do not attempt the next phase in the same
   invocation where you finished the current one. Finish, update
   `PROGRESS.md`, commit, and stop.
2. **Commit at the end of every phase** with `git add -A && git commit -m
   "..."` — specific, describing what changed and where. Never `--amend`.
3. **Only edit the files already given to you in this chat session.** Do
   not reference any other filename in this repo, for any reason, in your
   reply — any exact filename that appears anywhere in this conversation,
   even inside a sentence telling you NOT to touch it, gets silently
   auto-added to your context by the tool running you, which has already
   caused repeated failures on a different task. If you genuinely believe
   a file you don't have access to needs a change, say so in
   `PROGRESS.md` under a `## Notes` heading and stop — don't try to add it.
4. **Never break existing FASTA/MSA loading, Full/Block/Canvas modes, or
   editing.** This work is scoped entirely to the Reads display path. If
   you're touching a function also used by other modes, read every call
   site first and make sure your change is additive/conditional, not a
   behavior change for the paths that already work.
5. **If a phase is bigger than expected**, stop at a safe sub-point, note
   exactly where and why in `PROGRESS.md` under "Phase N (in progress)",
   commit what compiles/works, and end the run.
6. **If genuinely blocked** (missing info, contradictory requirement,
   existing code doesn't do what this doc assumes), write what's blocking
   you in `PROGRESS.md` under "BLOCKED", commit, and stop. Don't guess.
7. **No automated browser testing available to you in this environment.**
   A human will run the real acceptance test (loading the actual sample
   ref+SAM files and checking the rendered pile) after each phase or at
   natural checkpoints. Your job is to make the code correct by careful
   reading and reasoning, not to self-verify visually.

## PROGRESS.md format (create/update every run)

```markdown
# Reads-pile progress

## Done
- Phase 0: <one-line summary> (commit <hash>)

## Current phase
Phase N (in progress / blocked / not started)
<details>

## Notes for the next run
<anything not obvious from the code>
```

## Phases

**Phase 0 — survey and extract, no behavior change yet.**
Find both code paths described above (current Reads-mode per-row renderer,
and the existing track-packing/SVG-bar renderer used by the dead mode).
Extract the track-packing logic (sort-by-start, greedy-assign-to-track)
into its own pure, reusable function if it isn't already one on its own
(e.g. `assignReadTracks(reads)` returning each read's assigned track
index) — don't duplicate the algorithm, factor it out so both the old
dead path and the new Reads path can call the same implementation. Add 3-4
hand-worked examples in a comment showing the packer assigns tracks
correctly for a small set of overlapping/non-overlapping synthetic reads
(same rigor as the codebase's other geometry helpers already document).
No wiring into the live Reads render path yet.

**Phase 1 — normalize BAM-parsed reads into the packer's input shape.**
The live Reads-mode data source (reads array with CIGAR-derived per-column
types) needs its `start`/`end` genomic span computed per read (there
should already be a CIGAR-span helper — find and reuse it, don't
reimplement) and fed through `assignReadTracks()` from Phase 0. Store the
per-read track assignment somewhere reachable at render time (e.g. as a
property on each read object). Still no visual change — this phase is
purely computing and storing `read.track` for each read.

**Phase 2 — replace the per-row loop with track-row SVG layout.**
Build the pile's layout structure: reference row (sticky), scale ruler
(sticky), and one horizontal band per assigned track (not per read — a
track can hold multiple non-overlapping reads). Reuse the sticky/SVG
patterns from the existing track-packing renderer rather than inventing a
new layout approach. At this point reads can render as plain rectangles
with no styling detail yet — the goal of this phase is structural: fewer
visual rows than reads, correctly positioned by genomic coordinate.

**Phase 3 — draw each read as a bordered bar with visible boundaries.**
Each read becomes a rounded rect with a clearly visible stroke (not a
barely-visible 0.5px line — use something with real contrast) plus a
small vertical cap mark at both the start and end+1 position so adjacent/
touching reads are still visually distinguishable. Alternate track-row
background shading so tracks themselves are visually separated too.
Clicking a bar should highlight it (thicker stroke) and show its
name/pos/cigar/mapq somewhere the user can see (a small status line is
fine — do not repeat full names down the left margin per read, that's the
exact problem this rebuild is fixing). Hovering a bar should show a
tooltip with the same info, reusing whatever tooltip helper the rest of
the app already uses.

**Phase 4 — diff vs. bases display toggle.**
Add a small piece of state (module-level or on the reads data object,
your choice, but keep it out of the main `state` object's core alignment
fields — this is view-only Reads-mode UI state) tracking `'diff'` vs
`'bases'` display mode, default `'diff'`. In `'diff'` mode, matched
positions inside a bar show no glyph (or a dot), mismatches show the
letter — this is close to today's existing behavior, just now happening
inside packed bars instead of per-row text. In `'bases'` mode, every
aligned position inside a bar shows its actual base, colored using
whatever nucleotide color palette the rest of the app already uses for
bases (find and reuse the existing color-by-base function/map, don't
invent new colors). Wire a checkbox for this **by creating it from JS**
(`document.createElement`, inserted next to wherever the existing Reads-
mode controls live in the DOM at runtime) — you only have the one JS file
in this chat, not the page markup file, and that's intentional: do not ask
to add it, build any new control programmatically instead. Same for any
new CSS you'd otherwise want — set styles inline via `.style.xxx` in JS
rather than adding a stylesheet rule.

**Phase 5 — soft-clip / insertion / deletion visual treatment.**
Using the CIGAR-derived per-column type already present in each read's
column data (match/mismatch/insertion/deletion/soft-clip — read how
today's per-row renderer already distinguishes these, they're typed
already, you're just changing how they're drawn), render: soft-clipped
portions with a lighter fill and dashed stroke on just that portion of
the bar; insertions as a small vertical tick or extension at that
position; deletions as a visible gap/grey segment inside the bar rather
than solid fill straight through. At low zoom (bar width per residue
below a reasonable threshold — check what threshold the existing
track-packing renderer already uses for its own low-zoom "diff ticks
only" fallback, reuse that same number if reasonable), switch to a
thin-line-plus-mismatch-ticks rendering, but keep the start/end cap marks
visible even in that mode.

**Phase 6 — gate the SAM/BAM UI control behind eligibility.**
Find wherever the SAM/BAM load button lives (there should be one, wired
to a hidden file input and a click handler, with a real `id` you can
`document.getElementById` — you can toggle its existing `.style.display`
from JS without needing the page markup file, same as you're already
doing for other UI state in this codebase). It should be hidden by
default and only appear once a single reference sequence is loaded (not
before any file is loaded, not when multiple sequences are loaded).
Extract this eligibility check into its own named function so it can be
called from every place state changes: after a successful reference load,
after a successful SAM/BAM attach, after the user clears/reloads. After a
successful SAM/BAM attach: auto-switch the display to Reads mode, and
show a brief status message with the read count and reference name (there
may already be a message-showing helper — find and reuse it). Add a
"Clear reads" control near the SAM/BAM button — **create this one from JS**
(`document.createElement`, same as Phase 4's checkbox) since it's new,
not an existing element — that clears the loaded reads data and hides the
SAM/BAM button's un-eligible state appropriately, without unloading the
reference itself.

**Phase 7 — remove the now-dead old per-row Reads rendering code.**
Once Phases 2-6 are done and the new packed-pile path is the only path
Reads mode uses, delete the old per-read-row loop entirely (don't leave
it as dead code "just in case" — if you're unsure it's safe to delete,
that's a sign a prior phase isn't actually fully wired yet; note that in
`PROGRESS.md` instead of deleting prematurely).

## When all phases are done

Update `PROGRESS.md`'s "Done" section to say so explicitly, and stop.
