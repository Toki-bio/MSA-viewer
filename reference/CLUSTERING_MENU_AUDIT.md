# Clustering menu audit

Usability verdict on the Clustering panel (commits through `86e2abf`, paint modes). Not a rewrite plan.

## Terms

Use these and not “block” for a 2D find (that word is the old mask / split-and-merge).

| Term | Meaning |
|------|---------|
| **Type** | Sequences that share the same pattern in the same column range (the C-run, the G-run). This is what you choose. |
| **Rectangle** | That type drawn on the alignment (rows × columns). One type may paint as several boxes if members are not sitting together. |
| **Stack** | The contiguous majority: members of a type that currently sit next to each other. |
| **Orphan** | A member of a type that is not in the stack (same type, wrong place in the list). |
| **Group** | Cluster Now’s 1D list of sequences (shared features, no required column box). A rectangle is a group plus where it sits. |
| **Mosaicism** | Two (or more) types cannot share one row order without leaving orphans **above a threshold**. Equivalently: the orphan set after stacking type A does **not match** the orphan set after stacking type B. If the same copies are leftovers no matter which type you stack, that is list-order noise, not mosaic. |

Paint modes only change how a type is drawn. **Stack this type** (click a rectangle) writes row order; Undo reverses it. Clicking C then looking at who is still an orphan for G (and the reverse) is how you read mosaicism.

## The quirk

The bicluster row contradicts itself. The paint dropdown says alignment order is never changed. The **Group rows** button next to it rewrites the MSA. Both Group rows buttons call `groupRowsByBlockMask`, written for the old mask. If nothing is showing it still says click “Show mask” first. Status, Clear, and opacity are shared, so Show mask and Show bicluster overwrite each other.

## Verdict

Keep **Cluster Now**, its knobs, **Clusterability**, and **Show bicluster** (extractive rectangles plus paint modes).

Remove from the menu: **Show mask**, V1–V5 squint presets, Advanced squint knobs, and split-and-merge as a product.

Do not merge Cluster Now away — merge its *output* with the overlay so one run can list groups and draw rectangles.

Group rows should not sit next to paint-without-reorder until it is a different action.

| Keep | Gone | Merge | Rewrite |
|------|------|-------|---------|
| Cluster Now, knobs, Clusterability, bicluster paint | Show mask, V1–V5, squint sliders, split-and-merge UI | 1D list + 2D overlay as two views of one run | Group rows, bicluster heading, Presets nesting |

## Every section, top to bottom

Nested as the panel actually is: Trimming, then Cluster Now knobs, then a Presets heading that also contains both 2D overlays.

| Section | What it does | Usability | Verdict |
|---------|--------------|-----------|---------|
| Detach / Dock | Float the whole Clustering panel | Fine. Easy to miss while hunting knobs. | Keep |
| Trimming | Edge-gap preview / hard delete / soft-exclude / local Undo | Useful prep. Wrong house: it is an alignment edit, and Show bicluster ignores soft trim while Cluster Now honors it. | Keep, move or label as prep. Make bicluster use the same sequences. |
| Min Size / Min Features / Max Iter | Cluster Now and Show bicluster both read these | The right knobs. Cluster Now is a green button with no 2D counterpart up here. | Keep. One Run control should sit here. |
| Quality + Size Breakpoints + Min Occur | Three quality tiers, two size cutovers, plus a second feature floor | Min Features and Min Occur both claim to be “minimum diagnostic positions.” Min Occur sits under Size Breakpoints, which it is not. JS fallbacks (90/80/70, Min Occur 5) disagree with the HTML defaults (80/70/60, 3). | Keep the math. Relabel, regroup. Fix fallbacks. |
| Cluster Now | 1D groups, colors names, opens a results modal | Working analog. Does not draw rectangles and does not reorder. | Keep. Pair with overlay instead of a second engine. |
| Presets Save / Load / Defaults | localStorage named snapshots of trim + knobs | Defaults is `createOptimalPreset`: it writes an “optimal” preset and resets fields. Delete exists in code, not in the UI. Dropdown sits below Clusterability, not next to Save/Load. | Keep Save/Load. Rename Defaults. Put the list next to Save. |
| Clusterability | Grid of Cluster Now runs; does not apply settings | Honest about zero clusters. Slow on large files, but it says so. | Keep |
| Guide-tree groups | Cut the 6-mer tree into N groups; every row assigned; no diagnostics | A different product (order/similarity), parked under Presets. | Keep, but move next to other reorder tools. |
| 2D block mask + V1–V5 + Show mask | Reference-row squint overlay; rejected as the 2D task | Still the parent heading. Manual §4.7 still documents this as the 2D feature. | Gone from the menu |
| Bicluster + paint + Show + Clear + Group rows | Extractive rectangles; paint modes; shared overlay | The real 2D feature, still titled “experimental”, tooltip still describes split-and-merge, nested under the dead mask, sharing Clear/status/opacity/Group rows. | Promote to the 2D section. Fix chrome. Separate paint from reorder. |

**Advanced squint knobs:** eight sliders belong to Show mask. They sit visually under bicluster. Releasing a slider replaces a live bicluster overlay with the old mask. Gone with Show mask.

## Three ways to “cluster”

- **Cluster Now** — keep. Same evidence rule as the 2D rectangles. List + name colors + modal. Respects soft trim. Does not paint boxes. Does not change order.
- **Show bicluster** — keep, promote. Same knobs, overlay. Ignores soft trim. Status names the first rectangle, usually the conserved flank.
- **Guide-tree groups** — move. Fast, assigns everyone, finds no diagnostic positions. Ordering aid, not a clustering method in this panel.

Show mask is a fourth run button with a second parameter set. One evidence rule should have one knob strip and two views: list (Cluster Now) and rectangles (overlay).

## Latest commits: gone, merged, or improved

| Lineage | Commits / surface | Action |
|---------|-------------------|--------|
| Show mask / V1–V5 / squint | `block-mask.js` UI; manual §4.7 | Gone from the menu. Keep the file only if `?mask=` still loads it. |
| split-and-merge bicluster | `fa08172` through `2858c1f` | Gone as a product. `splitAndMerge` is still in `block-bicluster.js` but Show bicluster does not call it. |
| Group rows on bicluster | `c7e5fe3`, both buttons → `groupRowsByBlockMask` | Not gone as an idea. Gone from the paint row until it groups current overlay members. Error string still says Show mask. |
| Extractive rectangles | `extractSimilarityRectangles`; `86e2abf` paint modes | Keep and improve. Paint modes stay selectable until a default is chosen. |
| Planted FASTA / overlay checks | v1–v7, orphans, `scratch/verify_*` | Keep for eye-tests. Do not promote cartoons into UI presets. |
| Cluster Now + Clusterability + trim + presets | Older, stable | Keep. Merge with bicluster at the UI layer. |
| Cache-bust / version chrome | `script.js?v=201` vs `BUILD_TAG v186` vs `#versionIndicator v179` | Improve. Three version strings is a trust leak. |

### Improve, do not reinvent

- **Paint modes** — leave the dropdown until a default is chosen. Do not put reorder on that row.
- **Bicluster heading** — still says “experimental” and “splits by row OR column.” Call it 2D rectangles.
- **Status line** — “First: cols 1–16, all rows” hides the C-block. Prefer the first subset find.
- **Min Features vs Min Occur** — Min Occur is raw (pos,base) hits before scoring; Min Features is how many survive quality. The UI titles are copies of each other.
- **Results modal** — Highlight in alignment exists; “show as rectangles” does not.

## Recommended panel shape

1. **Prep** — Trim (preview / hard / soft). Cluster Now and 2D both use this slice.
2. **Evidence knobs** — Min Size, Min Features, Max Iter, quality, breakpoints, Min Occur (relabeled). Presets Save/Load/Defaults.
3. **Run** — Cluster Now (list + colors). Show rectangles (overlay, same knobs). Clusterability as a survey.
4. **Paint** — one box / two layers / strict. Opacity. Clear. No Group rows here.
5. **Order (separate)** — Guide-tree groups, and a Group-rows that stacks members of the current overlay. Undoable, explicit that it writes row order.

Do not hide Cluster Now in favor of only rectangles. Do not keep Show mask “just in case” above bicluster. Do not run MAFFT from this panel to recover orphans — that is Realign Block.

## Test dataset for the slow walk

- FASTA (Ctrl+click in the editor): [clustering_audit_walk.fa](../scratch/clustering_audit_walk.fa)
- Local viewer: [open audit-walk](http://127.0.0.1:8765/index.html?url=http://127.0.0.1:8765/scratch/clustering_audit_walk.fa&title=audit-walk)
