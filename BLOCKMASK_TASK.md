# Task: 2D block-mask overlay on the alignment ("squint view")

You are working alone across many separate invocations (no memory between
runs except what's in this repo). Read `BLOCKMASK_PROGRESS.md` first. If it
doesn't exist yet, this is the first run: create it and start.

Do the work on branch `blockmask` (a worktree at `../MSA-viewer-blockmask`
is fine). Commit in small, described steps. Do NOT push; the human reviews
diffs and pushes.

## What this is

A coarse structural summary of an MSA, drawn as translucent rectangles
**over the actual alignment residues** so it can be visually checked against
the sequence. Each rectangle is a 2D block: a column range × a row range,
coloured by block type. Think "squint your eyes at the alignment" — fine
per-column noise blurs out, coarse structure (conserved core, mosaic
subset, decaying flank, unique-sequence flank) remains.

Block types (fill colours are defaults, user-adjustable):

| type | meaning | default colour |
|---|---|---|
| `CONSERVATIVE` | high identity, ~all rows agree | `#16a34a` |
| `MOSAIC` | elevated identity but only a SUBSET of rows agree (its own rectangle covers only those rows) | `#f59e0b` |
| `DECAY_SLOPE` | identity trending down over several windows without a sharp edge (LINE-like erosion) | `#8b5cf6` |
| `DIVERGENT` | background identity — ordinary flank / unrelated DNA | `#cbd5e1` |
| `SIMPLE_REPEAT` | consensus itself is a tandem repeat here | `#ec4899` |

Ship in two stages (both are in scope for this task, stage 1 first and
fully working before stage 2):

- **Stage 1 — precomputed overlay.** A mask JSON (produced offline by the
  reference Python) is loaded via a URL param and rendered as the overlay,
  with colour + opacity controls. Thresholds are baked into the JSON.
- **Stage 2 — live port.** Port the reference algorithm to JS
  (`block-mask.js`), run it in-browser on the loaded alignment, expose the
  six "squint" knobs as sliders under the Clustering panel. Recompute on
  slider release, redraw the same overlay layer stage 1 built.

## The algorithm — reference implementation

`reference/block_schematic.py` in this repo is the source of truth (Python +
numpy, ~430 lines, no other deps). **Port its behaviour exactly.** Key
entry point: `classify_blocks_2d(path, flank=200)` → `(blocks, bg, L, n_rows)`.

Pipeline (all in the reference file, read it — this is a summary):

1. `_stitched_arrays` / `windowed_tracks`: build a stitched 3-zone x-axis
   `[-flank .. 0 .. L-1 .. L-1+flank]` where `L` = consensus element
   length. Each row's flank bases are taken from its OWN ungapped sequence
   outward from the element edge (not from the gapped MSA columns — flank
   columns are not homologous). Per-x: `pair_id` (plurality-agreement),
   `cover`, and a per-x majority base `maj_full`.
2. `bg` = median `pair_id` in the far quarter of each flank.
3. 1D pass (`classify_blocks`): per-x label from `pair_id > bg + BG_MARGIN`
   (elevated) and `window_mosaic` std `> MOSAIC_STD`; `DIVERGENT` runs
   adjacent to elevated blocks with a declining trend get promoted to
   `DECAY_SLOPE`; contiguous same-label x collapse to 1D blocks.
4. 2D pass (`classify_blocks_2d`):
   - Zone the x-axis into **three independent regimes** — left flank
     `[0,flank)`, element core `[flank, flank+L)`, right flank
     `[flank+L, N)`. NEVER bridge a zone across an element/flank boundary.
   - Within each regime, merge adjacent elevated (CONSERVATIVE/MOSAIC) 1D
     windows into zones, bridging up to `ZONE_BRIDGE` non-elevated
     positions. Discard zones narrower than `MIN_ZONE_W`.
   - Per zone: ONE `row_partition_for_window` over the zone's full width —
     per-row match-rate to `maj_full`, then `cluster_by_value` (gap
     clustering, same algorithm as `edge_profile.cluster_edges`: a real gap
     must be `>= ROW_MIN_GAP_ABS` AND `>= ROW_MIN_GAP_RATIO ×` median gap;
     groups smaller than `ROW_MIN_GROUP` fold into a neighbour).
   - If `< 2` real groups, or the largest group covers `>= ZONE_SPLIT_MAX_MAIN`
     of rows → leave the zone's 1D sub-blocks (uniform, full height).
   - Else emit one rectangle per group spanning the whole zone: rank-0
     (largest) labelled `CONSERVATIVE` if its own mean plurality-agreement
     `> bg + 2·BG_MARGIN` else `MOSAIC`; other groups `MOSAIC`; rows in no
     group → a `DIVERGENT` residual rectangle.
   - "Squint" absorb pass: full-height blocks narrower than `MIN_BLOCK_W`
     merge into their wider full-height neighbour. Row-split rectangles are
     never absorbed. Iterate to fixpoint.

The six knobs (module globals in the reference; must become the JS sliders):
`WIN`, `MOSAIC_STD`, `BG_MARGIN`, `MIN_ZONE_W`, `MIN_BLOCK_W`,
`ROW_MIN_GROUP`, `ROW_MIN_GAP_ABS`, `ZONE_BRIDGE`. Reference preset ranges
(coarsest→finest) are in `reference/granularity_presets.json`.

**Element core span** comes from the displayed consensus row: the contiguous
uppercase / non-gap span (`consensus_index` + the `nzc` logic in the
reference). In the viewer, use the same consensus the viewer already
computes/shows.

## Stage 1 spec

### Mask JSON schema

```json
{
  "alignment_id": "oma_SINE16b_wide300",
  "n_rows": 49,
  "n_cols": 1049,
  "elem_col_start": 280,
  "elem_col_end": 624,
  "row_headers": ["oma_SINE16b", "AYEL01065449.1:14329-14679(+)", "..."],
  "params": { "WIN": 20, "MIN_ZONE_W": 18, "...": "..." },
  "blocks": [
    { "type": "CONSERVATIVE", "col_start": 280, "col_end": 624, "rows": "all" },
    { "type": "MOSAIC", "col_start": 625, "col_end": 690,
      "rows": [1,4,7,9,12,18,20,33,41,44], "group_rank": 1 },
    { "type": "DIVERGENT", "col_start": 625, "col_end": 690,
      "rows": [27], "group_rank": "residual" }
  ]
}
```

- `col_start`/`col_end` are **0-based inclusive alignment column indices**
  (already mapped from the reference's stitched x-axis back to real MSA
  columns — the Python emitter does this, not the viewer).
- `rows` is `"all"` or an explicit list of **0-based row indices into
  `row_headers`**. The viewer maps `row_headers` → its own current rows by
  header string (sequences may have been reordered/filtered).
- Blocks tile the alignment; overlapping `col` ranges only occur between a
  full-height block and the row-split rectangles that replaced part of it —
  the Python emitter guarantees split zones are clipped out of full-height
  blocks, so the viewer can render in array order without z-fighting.

### Loading

- URL param `&mask=<url>` alongside the existing `&url=<alignment>`. Fetch,
  validate against the schema, store on state. Malformed → non-fatal
  console warning + a toast, no overlay.
- Header match: build `header → currentRowIndex` from `state.seqs`. A block
  whose `rows` list has any unmatched header → drop those, keep the rest;
  if none match, skip the block. Report counts in the panel.

### Rendering

- A dedicated SVG layer (`#blockMaskLayer`) above the residue grid, below
  the hover/selection layer. Same absolute-position + scroll-sync as the
  reads-pile SVG (search `trackGroups` / `TRACK_H` in `script.js` for the
  precedent).
- Per block: `<rect x={col_start·charWidthPx} y={rowTop·rowHeightPx}
  width={(col_end-col_start+1)·charWidthPx} height={nRows·rowHeightPx}
  fill={typeColour} fill-opacity={globalOpacity}>`.
- `rows:"all"` → full grid height. Explicit list → if the mapped row
  indices are contiguous, one rect; if not, one rect per maximal
  contiguous run (never one-rect-per-row unless truly scattered).
- Must honour column virtualization: only emit rects for the visible
  column window (+ the same overscan the grid uses), re-emit on
  scroll/zoom. Respect `charWidthPx`/`rowHeightPx` from
  `_measureUnifiedColumnMetrics` / `_unifiedRowHeightPx`.
- Canvas mode: out of scope for stage 1 (overlay only in DOM mode; disable
  the toggle or no-op with a note if Canvas mode is active).

### Row reorder on entering mask mode

Entering "2D block mask" mode reorders rows so every block's members are
contiguous: order = rank-0 group of the first split zone, then its other
groups, then residual, then remaining split zones, then all-rows-only rows
in their existing relative order. Reuse the existing header-keyed reorder
(the "Order loaded" path around `script.js:8246` — sort `state.seqs` by a
header→position map, append unmatched). Push an undo step
(`pushUndo('reorder')`). Leaving mask mode does NOT auto-restore order
(user has undo).

### Controls (new panel section under Clustering)

- Enable/disable toggle.
- Global opacity slider (0.1–0.9, default 0.55).
- Per-type colour pickers (5), seeded with the defaults above; persist to
  `localStorage` like other viewer prefs.
- Read-only line: "mask: N blocks, M split zones, K rows unmatched".

## Stage 2 spec

- New file `block-mask.js` (loaded from `index.html` like `cluster.js`),
  exposing `computeBlockMask(seqs, consensusSeq, params) -> maskJSON` (same
  schema as stage 1, so the renderer is shared).
- Faithful port of `reference/block_schematic.py`. Keep function names
  aligned (`stitchedArrays`, `windowedTracks`, `windowMosaic`,
  `clusterByValue`, `rowPartitionForWindow`, `classifyBlocks`,
  `classifyBlocks2d`). Pure functions, no DOM.
- Numeric parity: integer column indices identical to Python; row-membership
  lists set-equal; block count/types/`group_rank` identical. Floating
  intermediates may differ < 1e-9 but must not change any branch.
- Clustering panel: a "2D block mask" mode radio alongside the existing
  cluster modes. Six sliders (`WIN` 8–48, `MOSAIC_STD` 0.06–0.20,
  `BG_MARGIN` 0.05–0.16, `MIN_ZONE_W` 8–45, `MIN_BLOCK_W` 5–45,
  `ROW_MIN_GROUP` 3–8, `ROW_MIN_GAP_ABS` 0.08–0.28, `ZONE_BRIDGE` 1–6) with
  a "preset" dropdown (V1..V5 from `granularity_presets.json`). Recompute on
  `change` (slider release), not `input`.
- A `&mask=` URL param still overrides (precomputed wins over live compute
  when both present); document this.

## Parity tests

`tests/blockmask-parity.test.js` (match the repo's existing test style —
see `tests/` and `FUNCTIONAL_TESTS_TASK.md`).

Fixtures in `tests/fixtures/blockmask/`:
`<name>.aln.fa` + `<name>.expected.json` for:
`oma_SINE16b_wide300`, `oma_SINE16_top100`, `oma_SINE10_val`,
`synth_twotype` (clean 2-tRNA-type mosaic), `synth_gradient` (single
conserved group + decay tail). The `.expected.json` files are produced by
the reference Python (`reference/emit_fixture.py <aln> > <name>.expected.json`)
and committed — do not regenerate them in JS.

Test: for each fixture, `computeBlockMask` on the parsed alignment must
produce blocks equal to `.expected.json` under the parity rules above.
Stage 1 renderer test: load a fixture mask, assert one `<rect>` per
expected visible block with the right `x/y/width/height` (± 0.5px) at a
known zoom.

## Acceptance criteria

1. `?url=<SINE16b aln>&mask=<SINE16b mask>` renders the overlay aligned to
   the residues; toggling opacity/colours works; entering mask mode groups
   the split-zone rows contiguously.
2. Overlay stays aligned through horizontal + vertical scroll and zoom
   in/out, on a 49-row and on a 500+-row alignment.
3. Stage 2: all parity fixtures pass; changing a slider + releasing
   recomputes and redraws within ~1s on the 500-row alignment.
4. No regression: existing clustering, reorder, colour, reads-pile,
   Canvas-mode paths unaffected (run the existing test suite).
5. `BLOCKMASK_PROGRESS.md` reflects final state; `manual.html` gets a short
   "2D block mask" section in the existing use-case style.
