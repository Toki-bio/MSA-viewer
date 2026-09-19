# Audit brief — ViewAlign changes of 2026-08-06 (v146 → v160)

You are auditing and pressure-testing one day's work on ViewAlign, a browser MSA
viewer/editor. You have a local browser and filesystem. **Assume every claim below is
wrong until you reproduce it.** They were made by the developer who wrote the code, and
several of that developer's earlier hypotheses in this same session turned out to be
wrong when measured — the sticky-name theory, the `visible`-engine design, a "this was
always broken" claim, and an over-broad "BAM never loaded" claim were all corrected only
because someone measured. Treat this document as a set of falsifiable assertions, not as
documentation.

This is a **large task, expected to span several sessions.** Work through it in the order
below and keep a running checkpoint file (see *Working across sessions*).

---

## 1. Environment

Repo: `C:\work\MSA-viewer` (git, branch `main`). Baseline for this audit is commit
`6179494` (v146); head is **`8051f18` (v161)** — see *Findings so far*, one claim has
already been refuted and fixed. Deployed copy: <https://toki-bio.github.io/MSA-viewer/>.

**Do not test against `localhost:3000`** — a different, stale clone ("Qwen MSA Viewer")
has historically been running there. Serve the repo yourself on another port and confirm
`script.js` reports the expected `BUILD_TAG` before trusting any measurement.

Browser automation used originally: `puppeteer-core` driving installed Chrome at
`C:/Program Files/Google/Chrome/Application/chrome.exe`. Install `puppeteer-core` outside
the repo (the repo is deliberately dependency-free — `package.json` must stay untouched).

Useful launch flags when timing anything: `--disable-backgrounding-occluded-windows`,
`--disable-renderer-backgrounding`, `--disable-background-timer-throttling`. Without them
a non-foreground window throttles `requestAnimationFrame` and timings are meaningless.

### Test fixtures

`example-colour-names.fa` is committed in the repo (12 seqs × 120 cols, 5 designed
families). The others were scratch files and **you must regenerate them**:

- `sub_101.fa` — first 101 records of
  <https://raw.githubusercontent.com/Toki-bio/Tal/main/ccr/alignments/ccr_a_ccr_rand100.aln.fa>
  (101 × 960 = 96,960 residues). Real data; most numbers below use it.
- `big_200x2000.fa` — synthetic, 200 × 2000 = 400,000 residues, ~8% divergence plus
  random indels. Exceeds the 150,000-residue Canvas auto-switch, which matters.
- `ref.fa` + `reads.sam` — synthetic reference (1 × 300 bp) and a coordinate-sorted SAM
  of ~35 reads of 50M each, tiled every 7 bp, 2 mismatches per read. For Reads mode.

Serve fixtures with CORS if you load them via the `?url=` parameter from another origin.

---

## 2. What changed (commits, newest first)

| Commit | Version | Area |
|---|---|---|
| `62b44a4` | v160 | Chunked clusterer, progress + Stop |
| `cff1ae6` | v159 | Guide-tree grouping (`_kmerGuideTree`, `cutGuideTree`) |
| `c473e5d` | v158 | Busy indicator (`runWithProgress`), SVG-export guard |
| `aa202d0` | v157 | RTF export: shading restored, O(L²·N) loop removed |
| `235729f` | v156 | Manual screenshot (`img/`) |
| `2934d6c` | v155 | `example-colour-names.fa` + worked example |
| `36b3ade` | v154 | Manual: clustering docs |
| `83f5aa3` | v153 | "Optimal"→"Defaults", Clusterability survey |
| `76beb51` | v152 | Zero-cluster explanation |
| `984cef4` | — | Orphaned CSS removal |
| `f1f9562` | v151 | Manual: edit mode, tree |
| `f81e153` | v150 | Tree: unrooted, full screen, resize, SVG/PNG export |
| `bf24294` | v149 | Undo/redo control redesign; tree zoom/swap/re-root |
| `bfb048c` | v148 | Undo for width-changing edits; undo speed; BAM/SAM ref matching |
| `f363ba1` | v147 | Drag editing performance; Slide-left regression fix |

Net: +1903 / −176 across `script.js`, `tree-draw.js`, `styles.css`, `index.html`,
`manual.html`, plus two new files.

---

## 2a. Findings so far — do not re-report

**[P1, claim 6] REFUTED and fixed in `8051f18` (v161).** The residue test was
`/[A-Za-z]/`, which excludes `*`. The FASTA reader keeps `*` deliberately, so
`trimAlignmentWidthTo('ACD--*', 5)` returned `true` and produced `'ACD--'` — a deleted
stop codon.

Checking the same assumption elsewhere found a **second, older** path the audit had not
reached: `isGeneDocResidueChar` also classified `*` as a gap, so the edit tools consumed
it — `geneDocMoveTextString('AC*DEF', 3, -1)` gave `'ACD-EF'`. That one arrived with the
original GeneDoc toolbar, before this session.

Fixed at the root: a gap is now defined *positively* as `[-.~\s]` and a residue is
anything else, so an unfamiliar symbol is treated as content rather than as disposable.
A protein regression test covers parse → drag → undo with `*` present.

**What this implies for the rest of the audit:** the "residue means a letter" assumption
may exist in other predicates. Worth grepping for `[A-Za-z]`, `toUpperCase`-based base
comparisons, and anything that decides gap-vs-content, particularly in: consensus
computation, conservation shading, the RTF and SVG exporters, `calculateGaplessPositions`,
degap, trimming, and the clusterer's column scans. Protein alphabets in general (`X`, `B`,
`Z`, `J`, `O`, `U`) are a good attack surface — claim 3 of §6 notes protein was never
tested through the new paths.

## 3. Claims to falsify

Each is stated as measured. Reproduce, then try to break. Numbers were taken on the
machine described above; treat *ratios and orders of magnitude* as the claim, not the
exact millisecond.

### 3.1 Editing performance (v147, v148)

1. Before v147, a Move/Slide drag cost ~247 ms handler + ~1423 ms frame **per column**;
   a 25-column drag took 41.7 s. Root cause: the span cache is disabled above 80,000
   residues, so `refreshSequenceRowDom` always missed and fell back to a full
   `renderAlignment()`.
2. After: drag is ~10 ms/frame, i.e. frame-bound. A canvas overlay paints only the
   repositioned residues; **the DOM is not mutated during a drag at all**.
3. Entering edit mode: 1365 ms → 86 ms (spans are harvested from the DOM rather than
   re-rendered). Exiting: 1398 ms → 60 ms with no edits, ~150–190 ms after edits.
4. Undo/redo: ~380 ms → ~45 ms, zero full renders.

**Attack these:** every "repaint only part of it" optimisation has a staleness window.
Try dragging with breakpoint markers active, variable-sites on, columns selected, TSD
marks present, repeat highlights, codon mode, Live conservation — each is supposed to
fall back to the DOM path. Verify the fallback actually engages and the display is
correct. Scroll mid-drag. Drag past the right end so the alignment grows. Drag in Full
vs Block. Resize the window mid-drag. Check for leftover `<canvas>` elements.

### 3.2 Correctness fixes

5. **Slide-left regression** (`653047d`, pre-session): left slide scanned for *any* gap
   and consumed one hundreds of columns away, rewriting everything from there to the row
   end. Reverted to requiring an adjacent gap. Claim: right and left slide are exact
   inverses when the row has trailing slack, and residue content is never lost.
   Slide-right still shifts the whole tail — that is intended, not a bug.
6. **Undo of width-changing edits**: a drag past the row end pads every row via
   `normalizeAlignmentLengths()`, but undo restored only the edited row. Now the patch
   records alignment width on both sides. `trimAlignmentWidthTo` must **never** remove a
   column containing a residue.
   *Status: refuted once (stop codons) and fixed in v161 — see §2a. Re-attack it: the fix
   changed the definition of a gap, so try other symbols, zero-length and whitespace-only
   sequences, rows of unequal length, and a target width larger than the current one.*
7. **Shading during a drag**: only repositioned residues lose conservation shading; the
   rest of the row keeps it. Verify what is *on screen* (canvas pixels), not DOM classes —
   the DOM is deliberately stale under the overlay.
8. **BAM/SAM reference matching**: `checkRefMatch` was fed `{name: s.name}`, but sequence
   records carry `header`/`fullHeader`. Nothing matched, so **Reads mode never worked**.
   Note the nuance: SAM loaded through the *main input* always worked (it builds a pileup
   reference); only the BAM/SAM *file button* was broken.
9. **RTF export produced no shading at all** — it read `cons.count`, `cons.best`,
   `cons.baseCounts`, none of which `preCalculateConservation` returns. Verify by
   capturing the blob and inspecting the `\colortbl`: it should now contain the three
   shading picker colours plus the consensus grey. Then verify the exported shading
   actually *matches the screen* — that is the real claim, and it is untested beyond the
   colour table.
10. **SVG export silently produced nothing in Canvas/Reads view** (it walks residue spans
    that those modes never create), and Canvas engages automatically above 150k residues.
    Now guarded with a message.

### 3.3 Performance claims

11. RTF export: 6,558 → 81 ms (101×960) and 62,909 → 295 ms (200×2000). Cause was
    `computeConsensusForSequences(...)` called **inside** the per-column loop.
12. Clustering cost is concentrated in `findBestGroup` (2,761 of 2,763 ms in two calls).
    4× the data cost 186× the time.
13. Guide-tree grouping: 397 ms and all 101 sequences assigned, vs 3,349 ms and 0
    clusters from the diagnostic clusterer at defaults.

### 3.4 Feedback / long operations (v158, v160)

14. Before v158, **all ten** button-triggered operations rendered **zero frames** while
    running, so status messages set immediately beforehand never painted. Reproduce the
    original finding on the baseline commit if you want to confirm the premise.
15. `runWithProgress` shows the indicator, **yields one frame**, then runs. Verify the
    property, not the appearance: at the moment the blocking work starts, the overlay is
    in the DOM, visible, and ≥1 frame has rendered since it appeared.
16. Clustering can be stopped. **Known limit:** `findBestGroup` does not yield, so Stop
    only takes effect after the current round. On a large alignment that round may itself
    be minutes. Quantify this — how long is a Stop actually ignored on `big_200x2000.fa`?
17. `clusterChunked` must produce **identical** clusters, sizes, members and summary to
    the synchronous `cluster()`. Test on data that actually clusters (`minSize: 2`).

### 3.5 Tree (v149, v150)

18. Re-rooting preserves the leaf set and total branch length, survives a Newick round
    trip, produces a bifurcating root, works on a leaf branch. Swapping twice restores
    the original order.
19. Unrooted layout is equal-angle (Felsenstein). Verify it is a real phylogeny, not
    decoration: leaves spread in two dimensions, branch lengths proportional, topology
    matching the rooted view.
20. SVG/PNG export of the tree strips the invisible hit targets and writes a white
    background. Full screen fills the window; Esc exits; the box is resizable.
21. Swap and re-root rewrite `#treeNewickOutput`, and **Reset** restores the computed tree.

### 3.6 Clustering UX (v152, v153, v159)

22. "Optimal" changed nothing — it wrote the values already loaded. Renamed to "Defaults".
23. Clusterability survey runs 14 settings, reports the best, names parameters that
    changed the outcome and those inert across their range, and **leaves the user's
    parameters untouched**. On `sub_101.fa` only Min Size moves the result.
24. Guide-tree cut of `example-colour-names.fa` into 5 recovers exactly the 5 designed
    families with no mixing. On `sub_101.fa` at 8 groups it gives 92,3,1,1,1,1,1,1 —
    i.e. it does not manufacture structure.

---

## 4. Where to attack hardest

Ranked by where damage would be worst and detection hardest:

1. **`trimAlignmentWidthTo`** — the only code that *deletes* columns. Construct cases
   where a residue sits past the target width, where rows have unequal lengths, where the
   alignment shrank for another reason. It must refuse rather than truncate.
2. **The drag overlay's guard conditions** — each is a hand-written predicate. Find a
   state where the overlay is used but shouldn't be, and the DOM underneath goes stale in
   a way that survives mouse-up.
3. **In-place repaint paths** (`reshadeChangedColumnsInPlace`, exit reshade, undo
   reshade). Each claims DOM identical to a full render. Diff every rendered cell (row,
   column, text, class) against a forced full render, under: colour schemes, protein
   alignments, consensus positions top/bottom, selections, sticky names off.
4. **Undo/redo across mixed operation types** — drag, then gap tool, then typing, then
   column delete, then trim; undo all the way back; compare to the original.
5. **Re-rooting repeatedly** — re-root, swap, re-root again, Reset. Branch lengths must
   stay conserved through the whole chain.
6. **Reads mode** — the least-tested area. Only ever exercised with one synthetic SAM.

---

## 5. Known limitations (already stated — do not report as discoveries)

- Stop during clustering waits for the current round.
- Guide-tree grouping finds no diagnostic positions; it groups by overall similarity only.
- Unrooted layout has no equal-daylight refinement.
- Full SVG export of 101×960 is ~26 MB. Not addressed.
- `_reorderByGuideTree`'s reverse-complement helper and MAFFT paths were not touched.
- The manual documents the new tree tools, edit-mode restrictions and clustering
  additions; it does **not** document the busy indicator or guide-tree grouping.
- The manuscript (`manuscript.md`) still describes trees as exporting Newick only, and
  its Reads/BAM claims described a feature that did not function until `bfb048c`.

## 6. Not tested at all — treat as unknown

- Reads mode against a real BAM (binary, via samtools on the optional server).
- Protein alignments through any of the new paths.
- Any of it in Firefox or Safari. Everything was Chrome 150.
- Snapshot save/restore after the new editing paths.
- The server (`server.js`) features: BLAST, SSH, MAFFT.
- Touch/pointer input; only synthetic `MouseEvent`s were used.
- Accessibility of the new controls.

---

## 7. Working across sessions

Keep `audit-findings-2026-08-06.md` beside this file with, per item:

```
### [claim 6] trimAlignmentWidthTo cannot delete residues
status:   CONFIRMED | REFUTED | PARTIAL | UNTESTED
evidence: <command / script / measured numbers>
notes:    <what you tried, including what did NOT break it>
```

Start each session by reading that file and continuing from the first `UNTESTED`. Record
**negative results too** — "tried X, did not break" is worth as much as a bug, because it
stops the next session repeating it.

For anything you refute, give: the reproduction, the observed vs claimed value, and where
in the source the discrepancy lives. Do not fix anything — this is an audit. If you find a
data-loss path, stop and flag it prominently rather than continuing down the list.
