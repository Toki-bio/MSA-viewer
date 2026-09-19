# ViewAlign — usability advances, ranked for manuscript triage

Working document. Purpose: decide what earns space in the Application Note body,
what is compressed to one clause, and what moves to `manual.html` or
`features-inventory.md` (supplementary).

**Scoring.**
*Significance* — does it change what a user can accomplish, or materially cut
the effort of a real task? A capability that merely exists scores low; one that
removes a blocking step scores high.
*Describeability* — can it be stated in one or two sentences that a reviewer can
check and will not dispute? Claims needing heavy setup, or inviting "X already
does that", score low.

Both 1–5. Every entry is grounded in a verified code reference.

---

## Tier A — manuscript body (high significance, high describeability)

| # | Advance | Sig | Desc | Evidence | Why it earns space |
|---|---------|:---:|:----:|----------|--------------------|
| A1 | **Consensus as an operand, not a display row** — construct (two gates, fallback selector), reduce (insert/replace selection), anchor (profile-based append) | 5 | 5 | `_computeConsensusCharForColumn` [script.js:1509](script.js#L1509); `replaceSelectedWithConsensus` [:6697](script.js#L6697); `alignSequenceToConsensusProfile` [:10246](script.js#L10246) | The profile anchoring solves a real dilemma (realign-and-lose-curation vs `--keeplength`-and-lose-insertions) that every curator hits. Already written as §2.5. |
| A2 | **Live shading thresholds** — three sliders, colour per tier, selectable gap/non-gap denominator; alignment re-shades as you drag | 5 | 5 | `#blackSlider`/`#darkSlider`/`#lightSlider` + pickers [index.html:95–136](index.html#L95-L136); `input` handler with `debounceRender` [script.js:11973](script.js#L11973) | Direct, verified contrast with GeneDoc's `IDD_CONFMODESTYLE` dialog (radio buttons + typed percentages). "Inherited and extended" framing. |
| A3 | **Cluster → collapse pipeline** — discover subfamilies by diagnostic positions, then replace each with its consensus in one action | 5 | 4 | `SINEClusterer` [cluster.js](cluster.js); `replaceSelectedWithConsensus` [script.js:6697](script.js#L6697) | Workflow-level, not feature-level: takes a 300-sequence family to one row per subfamily without leaving the viewer. Needs the CAOS/MolD distinction stated (they take groups as given; this discovers them). |
| A4 | **Colour as selection metadata** — assignments drive copy, group-at-top and sort; every assignment records its provenance method | 4 | 5 | `copySequencesByColor` [:13181](script.js#L13181); `sortSequencesByColor` [:13209](script.js#L13209); `groupColoredSequencesAtTop` [:13241](script.js#L13241); `recordColorHistory(seqName, color, method)` [:13403](script.js#L13403) | Colour stops being decoration and becomes a queryable annotation layer. Genuinely unusual; easy to state in one sentence. |
| A5 | **In-place block realignment** — realign a selected column range without disturbing flanking regions; falls through to the browser's hard-refresh when fewer than two columns are selected | 4 | 5 | `handleKeyDown` guard [:5920](script.js#L5920); `realignSelectedBlock` | Fixes the common "one region is misaligned" case without destroying curation elsewhere. The fall-through is a small, concrete politeness worth one clause. |
| A6 | **Performance adapts without configuration** — Canvas activates automatically above 150,000 residues and says so, advising a switch back for editing | 4 | 5 | `CANVAS_AUTO_THRESHOLD` [:3742](script.js#L3742) with `showMessage` | The user never tunes a rendering setting. Contrast with viewers that expose a "fast mode" checkbox. |

---

## Tier B — one clause in the body, detail to the manual

| # | Advance | Sig | Desc | Evidence | Disposition |
|---|---------|:---:|:----:|----------|-------------|
| B1 | **Undo history with one-click jump** to any earlier state | 4 | 4 | `showUndoRedoDropdown` replays *n* steps [script.js](script.js) | Body clause; contrast with GeneDoc having **no Undo command at all** (verified in `GeneDoc.rc`) belongs in Discussion. |
| B2 | **Guide-tree reorder with optimal leaf ordering** — tries all four subtree orientations at each UPGMA junction, minimising junction distance | 4 | 3 | [script.js:9136–9155](script.js#L9136-L9155) | Real algorithm, correctly implemented, but needs a sentence of setup. One clause in body, full description in manual. |
| B3 | **Sequence order as portable JSON** — decouples ordering from alignment content; rematches by header | 3 | 5 | `exportOrder` [:6135](script.js#L6135) | One clause. Underrated: makes ordering reproducible across files. |
| B4 | **Copy selected columns** — exports a structural region rather than sequences | 3 | 4 | `copySelectedColumns` [:6550](script.js#L6550) | One clause; genuinely uncommon. |
| B5 | **Snapshots carrying colour and search state**, reopening from a URL | 3 | 4 | `_buildSnapshotPayload` [:6890](script.js#L6890) | One clause. Note Jalview `.jvp` also loads from URL — claim the *contents* (colour + search state), not the mechanism. |
| B6 | **Time-sliced consensus with cancellation token** — 8 ms slices, so Copy Consensus works on Canvas alignments never built as DOM | 3 | 4 | `computeConsensusForSequencesChunked` [:1557](script.js#L1557) | Already one sentence in §2.5. Engineering credibility; do not expand. |

---

## Tier C — supplementary / manual only

Real, but each costs more words than it returns in a 3,000-word note.

| Advance | Sig | Desc | Note |
|---------|:---:|:----:|------|
| Name-similarity auto-colour (n-gram Jaccard, discrete/gradient modes) | 3 | 3 | **Inventory says "Levenshtein" — the code uses n-gram Jaccard.** See corrections below. |
| Dot plot region detector, click-to-navigate, Copy Region as FASTA | 3 | 3 | Strong feature, but UGENE also has dot plots; the *region navigator* is the distinguishing part. |
| Repeat/TSD finder with undoable marking styles | 3 | 3 | Domain-specific (TE work); manual. |
| Cluster presets (save/restore parameter sets) | 2 | 4 | Reproducibility argument; one clause at most. |
| SeqEdit bulk transforms with length normalisation | 2 | 4 | Manual. |
| Restriction sites (50 enzymes) | 2 | 5 | Manual. UGENE has REBASE — do not claim novelty. |
| Recent files storing full text (100 KB) in localStorage | 2 | 4 | Manual. |
| Motif search degrades visibly in Canvas/Reads (dimmed controls + explanatory tooltip) | 2 | 4 | `syncSearchControlsAvailability` [:7931](script.js#L7931). Nice honesty touch; manual. |
| Sticky names, name truncation slider | 2 | 5 | Manual. |
| BLAST database CRUD from the viewer modal | 3 | 3 | UGENE also builds custom BLAST DBs. Claim the browser delivery only. |

---

## Corrections required to `features-inventory.md`

Verified against the current code this session. These are wrong as written and
would be checked by a reviewer, since the inventory is cited as supplementary.

| Claim in inventory | Reality | Source |
|---|---|---|
| "Levenshtein clustering" for auto-colour | **n-gram Jaccard similarity** | `ngramJaccardSimilarity` [script.js:13297](script.js#L13297) |
| "17 genetic codes" | **15** | `#codonCode` has 15 options |
| "all 11 CIGAR operations" | **9** (the full SAM set) | `_expandCigar` [:1600](script.js#L1600) |
| "8-format automatic detection" | **9** (GenBank added) | §2.2 parser list |
| "12,000 lines" | **~18,000** across six client modules | `wc -l` |
| "5 interchangeable view modes" | **4** (Compact removed) | `#modeSingle/Blocks/Canvas/Reads` |
| "First browser-based MACSE-inspired codon viewer" | Jalview classifies synonymous/missense variants from Ensembl/VCF | Jalview JAL-2897 |
| "First position-pattern subfamily clustering in any viewer" | CAOS, MolD, DeSignate do character-based diagnosis; Jalview does subfamily analysis by tree/PCA/PaSiMap | published tools |
| "No other viewer offers this" (select→compress→consensus) | Not verified; unsupportable as an absolute | — |
| Comparison table: "Regex search — Jalview ❌" | Jalview has regex search | Jalview help |
| "GeneDoc-style RTF export … no desktop software needed" | Accurate, but GeneDoc *does* export shaded RTF — frame as reimplementation, not novelty | `GeneDoc.rc` |

**Recommended framing throughout:** replace every "first" / "no other tool"
with the inherited-and-extended construction — *"taken from X, extended by Y"* —
which is defensible and cannot be falsified by a reviewer naming a prior tool.

---

## Proposed manuscript allocation

- **Body, full treatment (~600 words):** A1, A2, A3 — plus the Discussion paragraph contrasting operation with GeneDoc.
- **Body, one clause each (~150 words):** A4, A5, A6, B1–B6.
- **Manual / supplementary:** all of Tier C, plus full parameter tables for clustering, dot plot, and repeat/TSD.
- **Cut from body:** §2.9's per-tool parameter ranges (356 words) — these are manual content and are the main reason the draft is over length.
