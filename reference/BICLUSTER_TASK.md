# Frozen task: 2D similarity rectangles in ViewAlign

**Status: spec of record. Extractive engine is in use (2026-09-12).**
Show bicluster no longer calls `splitAndMerge`. If a later note disagrees
with §§1–3, those sections still win. §7 is a progress log, not a new task.

Sources (read in full before this was written): the user's own messages in
Claude session `f7c3e3d1-5797-4495-97c2-ba3a7ac9c28d` (Sep 10–12 2026);
`cluster.js` (`SINEClusterer.findBestGroup`); `manual.html` §4 Clustering
and §4.7 2D block mask; `block-mask.js`; `block-bicluster.js`;
`reference/BICLUSTER_ALGORITHM_NOTES.md`; user memories
`feedback_bicluster_verification_checklist.md` and
`feedback_always_reorder_alignments_by_similarity.md`.

---

## 1. What this is

An alignment is a 2D matrix: **rows = sequences, columns = positions**.
Inside it there are **rectangles** of varying height, width, and place:
a set of sequences that share a nucleotide pattern over a column range.

**Working 1D analog (already in the app):** Clustering → **Cluster Now**.
At each column, sequences that share a base are a candidate group. Near-
identical candidate row-sets are fuzzy-merged. A group is kept if it has
enough **diagnostic features** at the current **quality %** and **Min
Size**. Tighten knobs → fewer, cleaner groups. Loosen knobs → more,
weaker groups. Zero clusters is a **threshold result**, not a dead
algorithm. Output is a list of row-groups for the (trimmed) alignment.
Columns are features used to group rows; they are not themselves grouped
into a region.

**This task is the same idea in 2D.** Same evidence rule (“these rows
share this base here”), same class of adjustable bars. The supporting
positions define a **column extent**, so the output is a **rectangle**
(those rows × that stretch), drawn on the alignment.

Examples the user gave (illustrations of the object, not presets):

- Full-height left flank: all rows × flank length (unalignable unique
  sequence in a full rectangle).
- Mosaic tRNA: two stacked rectangles in the same columns (two types).
- SINE crop: cols 1–40 unrelated flanks, all rows; cols 41–151 SINE
  bodies, all rows; 3′ mosaic — five sequences share a long 3′ flank to
  the end, everyone else one rectangle of “no shared similarity.”
- Nested C then G: depending on **current thresholds**, the data may
  support a longer rectangle on the six sequences that have both runs,
  and/or a C-rectangle on nine sequences, and/or a G-rectangle — because
  those are regions of similarity, not because the UI has two modes.

There is **no reference row**. Rows and columns are the same kind of axis.
If two sequences share 10 bp, that is a rectangle **at some setting**.
If a human can see a rectangle, the math at some threshold must be able
to report it.

---

## 2. What this is not

- Not a unique **partition / tiling** of every cell into exactly one
  block. Cluster Now does not tile the alignment; it extracts groups.
  Rectangles may overlap (same rows in two column regions; or a tighter
  subset in a shorter range).
- Not “two squint levels” or a list of named cartoons (v1…v7) as the
  product. Those files are only for the user to look at.
- Not the old **2D block mask** (`block-mask.js`): that picks a reference
  row, finds column zones from that row, then clusters rows inside the
  zone. The user rejected that asymmetry.
- Not further patches to `splitAndMerge` in `block-bicluster.js`. That
  file implements the research-notes **split-and-merge partition**. That
  is a different product. It recovered a pure C-block and still failed
  the task.
- Not Gblocks/trimAl (columns only, all rows).

`reference/BICLUSTER_ALGORITHM_NOTES.md` is research, not this spec. It
correctly states: no reference row; span-based gaps (Simmons &
Ochoterena, already in `_computeVarSites`). It then proposes two
families (Cheng–Church grow/shrink; Horowitz–Pavlidis split-and-merge).
**The implementation that was built chose split-and-merge. That choice
is not the user's task.** The closest sentence in those notes to the
user's “stack of rectangles” is the plaid / overlapping-layer remark,
not the recursive partition.

`tests/bicluster/VALIDATION_PLAN.md` and the oracle **tiling invariant**
belong to the partition attempt. They are historical. Do not treat them
as acceptance of this task.

---

## 3. Object, score, knobs

**Object:** `{ rows: [i…], col_start, col_end }` with `|rows| >= Min Size`
(default 3; 1 is never a group; 2 is allowed only if Min Size is 2).

**Evidence (same shape as Cluster Now):** a column is a feature of a
row-set if members share a base (or in-span gap as a real state) with
quality margin against the sequences **outside** the group. Quality is
size-tiered (small/medium/large %), same idea as Clustering §4.3.
Internal gap vs terminal padding: same rule as Display → Variable sites
(`_computeVarSites`).

**Column extent:** the rectangle's columns are the supporting features
grown/trimmed to a contiguous range (small gaps in the feature list may
bridge; a long break ends the rectangle). **Min Features** is the
minimum number of supporting columns, same role as Cluster Now.

**Knobs (must be user-visible, same nature as Clustering):**

| Knob | Role (1D Cluster Now) | Role (2D) |
|------|------------------------|-----------|
| Min Size | min sequences in a group | min **height** of a rectangle |
| Min Features | min diagnostic positions | min **width** of supporting columns |
| Quality % (S/M/L) | how strictly members share a base vs outside | same, per column in the rectangle |
| Max Iter | more rounds, weaker leftover groups | more rectangles from leftover rows/columns |
| (optional later) count vs % min-size | Variable-sites pattern | same if a small subgroup is missed |

Tightening knobs is “squinting less”: fewer, stricter rectangles.
Loosening is “squinting more”: larger or noisier rectangles. That is
one adjustable system, not named presets as the product. V1–V5 on the
**old** mask may later become saved 2D-threshold presets; they are not
the algorithm.

**Display:** translucent rectangles on the real ViewAlign alignment
(existing overlay). Different row-groups in the same columns get
different colours. Full-height conserved stretches are not the same
colour as a subset find. A 1-row box is never a find. Sequences shown
to the user are **similarity-ordered**. Dashed outline if member rows
are not contiguous on screen. Opacity adjustable.

**Workflow:** small alignment (tens of columns, not the 1663-col file
while developing). Clickable `?url=` link. After Show: **exact
coordinates** of the first rectangle and the **bases that support it**.
User confirms or corrects. Then a harder composition, same small canvas.

---

## 4. Can it be done?

**Yes.** It is not an open research problem in this repo.

Cluster Now already finds the row-sets from `(column, base)` evidence
with the knobs above. The missing piece is: take those features, turn
them into a **contiguous column range**, emit a rectangle, draw it.
Cluster Now already runs on the alignments this app sees. The overlay
renderer already draws `{col_start, col_end, rows}`.

What failed for ~12 hours was implementing a **different object** (a
recursive partition with no user threshold that means “how similar”).
Recovering one planted C-block inside that partition is not this task.

---

## 5. Actionable plan (do in this order; do not skip)

1. **Stop** changing `splitAndMerge` / window-scan heuristics.
2. **Engine:** from `cluster.js` `findBestGroup` (or the already-ported
   `_findBestDiagnosticGroup`), get `(row-set, feature columns)`. Grow
   the feature columns to `[col_start, col_end]`. Repeat on leftover
   rows (Max Iter). Also run on leftover column ranges so a C-region and
   a G-region can both appear. Allow overlapping rectangles.
3. **Gaps:** use span-based coverage, not cluster.js's “gap is never
   diagnostic,” for in-span deletions — already the app's Display rule.
4. **UI:** Show bicluster reads the Clustering knobs (Min Size, Min
   Features, quality %, Max Iter) — do not invent a second knob language.
   Draw via `renderBlockMaskOverlay`.
5. **Check (mechanical, before any “done”):**
   - `clean_core`: no subset rectangles (uniform = one full-height
     rectangle or none extra).
   - 24×48 eye-tests: at default knobs, list every rectangle as
     `cols a–b, n rows, names, supporting bases`. User looks at a
     `?url=` link.
   - Same file: Cluster Now on the C-columns alone should name the same
     C-row-set as the C-rectangle (1D analog must agree on rows).
   - No 1-row groups.
6. **Do not** require the old tiling oracle. Update or replace it.
7. **GLM/aider** only after step 5 exists as a script that **fails on
   current `block-bicluster.js`**. Not before.

Acceptance is the user's eye on a small link plus that script, not Stage
1 / 108 from the partition sweep.

---

## 6. Manuscripts and current tools (what to pick up)

Read so the spec does **not** change. This section only names what already
matches §1–§3 and what to ignore.

### What Claude already used (kept)

- **Simmons & Ochoterena (2000)** — in-span gap = state; terminal gap =
  missing. Already in ViewAlign Variable Sites. Keep.
- **Castanho, Aidos & Madeira (2024)** *Biclustering data analysis*
  (Briefings in Bioinformatics), updating Madeira & Oliveira 2004 — our
  rectangles are **constant-column** (and often overall-constant)
  biclusters: a row subset in which each column of the range has one
  shared base. Not Cheng–Church “coherent values” (additive row+column
  effects on continuous expression). Overlapping solutions are a
  recognized output type. Keep the names; do not import MSR.
- **Gblocks / trimAl / BMGE** — conserved **columns, all rows**. That is
  only the full-height conserved rectangle. They cannot find a C-run on
  nine of twenty-four sequences. Do not use them as the 2D engine.
- **Horowitz & Pavlidis split-and-merge** and **Cheng & Church MSR** —
  cited in `BICLUSTER_ALGORITHM_NOTES.md`. The built code followed
  split-and-merge. That is the failed product. Do not return to them.

### ViewAlign’s own manuscript (`manuscript.md`)

Section 2.8 already states the 1D method: position-pattern clustering
from shared diagnostic nucleotides, fuzzy-merge, quality tiers, half-
dataset cap, live knobs. The 2D task is that method plus a column
extent. GeneDoc/Jalview/UGENE are discussed there as **column
conservation for all rows** or **groups given then coloured** — not
automatic row×column rectangles.

### Currently available tools (web, 2026) — pick up vs leave

| Tool | What it does | Pick up? |
|------|----------------|----------|
| **Cluster Now** (`cluster.js`) | Discovers row-groups from `(column, base)` evidence with Min Size / Min Features / quality % | **Yes — the engine** |
| **BiMax** (Prelić 2006; in BicAT) | Exact maximal all-1 submatrices on a **binary** matrix; min rows × min cols; overlap allowed | **Idea only:** each `(column, base)` is a 1/0; Cluster Now already builds those 1s. Do not ship BicAT/Java |
| **QUBIC / QUBIC2** | Qualitative biclusters on discretized matrices; overlap; size knobs | Same family as BiMax. Do not add an R/C dependency |
| **BlockMSA** (Wang 2007) | Biclustering to **build** an RNA alignment (BiMax + divide-and-conquer) | No — we already have the MSA |
| **Jalview** | Cut a tree → groups, then group consensus / conservation colour | UX only: sort/group rows (we have Group rows). Groups come from a tree, not from local column evidence — opposite of Cluster Now |
| **AMAS / MAGA** | User **assigns** groups, then highlights group-specific columns | Inverse of this task (we must **find** the groups) |
| **BicAT** (CC, ISA, OPSM, xMotifs, BiMax) | Expression-data GUI, 2006 | Leave. CC/ISA/OPSM are the wrong bicluster type |

**Practical pickup:** keep Cluster Now’s candidate generation and
thresholds; add contiguous column growth (BiMax/QUBIC-style min width,
overlap allowed). That is already §5. Nothing here authorizes a new
algorithm family.

---

## 7. Progress log (2026-09-12)

Do not read this as a new product. It records what was built against
§§1–5 and what the user has already looked at.

### Engine (done)

`block-bicluster.js` `computeBiclusterMask` → `extractSimilarityRectangles`:

1. Full-height **conserved** runs (purity ≥ 0.8 among rows that *cover*
   the column). A run splits when the covering row-set changes, so
   terminal gaps are not painted as shared sequence.
2. **Diagnostic** groups from `_findBestDiagnosticGroup` (Cluster Now:
   `(column, base)` candidates, 90% fuzzy merge, quality tiers). All
   groups that pass Min Size / Min Features / quality %, not only the
   single best. Feature columns grow to a contiguous range (`FEATURE_BRIDGE`
   = 2). In-span gap is a real state (`-`); terminal gap is missing.
3. **Nested** rectangles: intersection of two diagnostic row-sets when
   their column ranges abut or overlap.
4. Leftover-row rounds up to Max Iter, with mild relaxation, never
   1-row groups.

Show bicluster reads the Clustering knobs and draws via
`renderBlockMaskOverlay`. Mixed leftover cells are **unpainted** (not a
tiling). Conserved = green; subset finds cycle amber / purple / pink.

Mechanical check: `scratch/check_extractive_rectangles.js`.

### User eye (confirmed)

| File | User |
|------|------|
| v1 C-block + flanks | matches description |
| v5 C-block, no conserved flanks | matches |
| v6 nested C / G / both | matches |

### Gap cartoons (built; user looking)

| File | Object |
|------|--------|
| `bicluster_gap_g1_terminal_left.fa` | left dashes = missing; conserved flank only on rows that have sequence |
| `bicluster_gap_g2_inspan_deletion.fa` | shared internal `----` is a rectangle |
| `bicluster_gap_g3_c_with_internal_gap.fa` | C-block with two internal gaps still one rectangle (`CCCCCC--CCCCCCCC`) |
| `bicluster_gap_g4_terminal_right.fa` | T-run splits where sequences end |

### Still to look at (not a new spec)

User-confirmed: v1, v5, v6. Gap g1–g4 were handed next.

Added after that, same engine:

| File | Object | Default knobs |
|------|--------|----------------|
| `bicluster_gap_g5_nested_and_terminal.fa` | v6 nested C/G **and** 6 late-starting rows | C, G, both, left flank only on rows that have sequence |
| `bicluster_eye_sine_crop.fa` | unrelated 5′ / shared body / 5-row 3′ tail | no box on random flanks; body all 24; tail 5×G |
| `bicluster_eye_test_v7.fa` | 15% mutated C-block | found after expanding a group's features across the window (noisy columns still count if quality % holds) |

Cache: `block-bicluster.js?v=16`, `script.js?v=201`. Checks:
`scratch/check_extractive_rectangles.js`, `scratch/check_paint_modes.js`.

User later confirmed g1–g5, sine-crop, and v7 overlays match.

A small **real** gappy SINE crop (`scratch/cropped_*.fa`) is next for the eye, not more planted cartoons.

---

## 8. Ultimate goal (set 2026-09-12)

The rectangles are not the end product. They are how to **read the 3′
(or 5′) of the element**.

**“Mosaic” is two different things**, and “not in blocks” is **not**
“each copy has a unique partner.” It is **a-b-a-b vertically**: similar
copies never sit one under another in the current list, so no contiguous
stack is visible.

| Outcome | Meaning |
|---------|---------|
| **Ends** | Coverage drops; no more real sequence |
| **Mosaic in contiguous blocks** | Types sit in stacks (v2, v6). Engine paints these today |
| **Mosaic a-b-a-b** | Same types exist, but row order interleaves them. Looks like no blocks |
| **Various lengths** | Same cassette, shrinking height (g4) |

**Same type, wrong place in the list** — paint modes (user, 2026-09-12;
selectable in the UI as `#biclusterPaintMode`):

- **Strict:** drop those orphans; paint only the contiguous majority.
- **Local, one box:** keep every member of the find; scattered / 1-row
  runs stay dashed (red stroke). Alignment order is unchanged.
- **Local, two layers:** paint the contiguous stack solid, and the
  orphans as a paler **local-only** overlay (colored dashed stroke).
  Same type, still belonging to that rectangle, not dropped. Alignment
  order is unchanged.

The **expected** case is **block + orphans** (a real stack, plus a few
same-type copies sitting elsewhere). **a-b-a-b** (similar copies never
adjacent) is a rare edge case, listed only for the whole picture.
Eye-test: `scratch/bicluster_eye_orphans.fa` (4-row C stack + 2 orphans
among background). Conserved flanks stay the same in every paint mode.

If the columns are **already aligned** and only the row order is wrong:
**reorder only, never MAFFT.** That reorder is a **local slice
operation**: no context from the rest of the alignment, and the
resulting order is **not** written back onto the document MSA. It
exists only to **gather data** on possible block composition in that
place. That slice-reorder is still a later tool; the dropdown above is
only how to *paint* the current list.

Crop+MAFFT stays a different tool, for when the **columns** themselves
are scrambled, not for this.

Detection still groups by shared bases, **not** by sitting together.
The paint dropdown then chooses what to draw: drop orphans (strict),
keep them in one dashed find (local one-box), or split stack vs
local-only orphans (local two-layer). None of these rewrites row order.

### Two different “interleaving” failures

A global MAFFT + global similarity order is a compromise. Mosaic at
**both** ends can disagree on the right row order, and sometimes on
column homology.

1. **Row order only.** The groups are still in the matrix; they just
   are not adjacent on screen. Show bicluster already returns those
   row-sets and draws them **dashed**. Detection did not fail. Sorting
   the whole alignment by the other end will scatter *this* end. One
   screen cannot show two incompatible orders as solid rectangles.
2. **Column homology.** MAFFT arranged one end well and the other end
   has the wrong partners in the same columns. Then constant-column
   rectangles **cannot** form until that slice is realigned. ViewAlign
   already has **Realign Block** (selected columns → MAFFT → splice
   back). That *does* rewrite the working alignment (undoable).

These must not be conflated. Dashed ≠ “run MAFFT”. Empty ≠ “reorder rows”.

### Separate option (do not fold into Show bicluster)

Show bicluster stays: rectangles on the **current** alignment, current
row order.

**Local slice-reorder** (later): on a selected column range only, reorder
that slice in isolation (no MAFFT if columns are already aligned). That
order is never written to the MSA. From the slice, keep only **this**
information: which sequences form which rectangles **there**. Paint that
onto the **whole alignment** as it already is. Orphans (same type, wrong
place in the list) are shown as belonging to a **local-only** rectangle —
they are not dropped (that is **strict**) and the main row order does
not change. The current dropdown lets you compare one-box vs two-layer
paint of that idea on the unchanged alignment.

Do **not** silently replace the document MSA or the global row order.

