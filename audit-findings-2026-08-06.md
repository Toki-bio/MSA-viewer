# ViewAlign audit findings — v146 to v161

Audit range: `6179494` (v146) through `8051f18` (v161)  
Mode: read-only testing; no application source files changed  
Runtime: Chrome, locally served copies of v146 and v161

## Executive summary

- **Confirmed:** 16 claims
- **Partial:** 5 claims
- **Refuted:** 3 claims
- **Current actionable defects:** 2

The stop-codon data-loss defect previously found in claim 6 is fixed in v161. Re-attacks with `*`, `?`, digits, Unicode, unequal row lengths, growth, and shrinkage did not find another width-trimming data-loss path.

## Actionable findings

### [P1] Clusterability can make false “data has no structure” conclusions

`_clusterabilityGrid()` describes its final run as “the loosest combination the panel allows,” but uses `minOccurrences: 2`; the panel permits 1.

```js
// script.js:8919–8923
// The loosest combination the panel allows: if this finds nothing, nothing will.
add('everything loosest', {
    minSize: 2, minPerfect: 1, minOccurrences: 2,
    qualitySmall: 40, qualityMedium: 30, qualityLarge: 20
});
```

Reproduction:

1. Construct 24 sequences split into two 12-sequence groups with one diagnostic feature.
2. Run clustering with the survey's loosest settings (`minOccurrences: 2`).
3. Run again with the UI-permitted `minOccurrences: 1`.

Observed:

- `minOccurrences: 2`: 0 clusters, 0 assigned.
- `minOccurrences: 1`: 1 cluster, 12 assigned.

The report can therefore reach:

> No settings produced any cluster ... That points at the data rather than the thresholds.

without testing the actual lowest threshold.

The “inert” interpretation is also too strong. On `sub_101.fa`, `Min Size 2` assigned 20 sequences, while “everything loosest” assigned 22. Nevertheless, the report labels Min Features, Min Occurrences, and Quality inert because it tests each only against the original baseline. At least one of those parameters matters in interaction with Min Size.

Relevant code: `script.js:8908–8924`, `script.js:8995–9008`, `index.html:394–395`.

### [P2] Drag canvas ignores active trim and selection decorations

`canUseGeneDocDragOverlay()` correctly rejects breakpoints, variable sites, selected columns, repeat/TSD highlights, codon mode, and live conservation. It does not reject:

- `state.trimBoundaries`
- `state.softTrimBoundaries`
- `state.selectedNucs`
- `state.selectedRows`

All four returned `true` in v161 testing.

```js
// script.js:13647–13655
function canUseGeneDocDragOverlay(rowIndex) {
    return isSpanRenderMode()
        && !state.editLiveConservation
        && !(state._brkBeforePos && state._brkBeforePos.size)
        && !(state._diffColumns && state._diffColumns.size)
        && !(state.selectedColumns && state.selectedColumns.size)
        && !(state.repeatHighlights && state.repeatHighlights.size)
        && !(state.tsdMarks && state.tsdMarks.get(rowIndex)?.size)
        && !document.body.classList.contains('codon-mode');
}
```

The canvas paints changed cells using only the residue scheme foreground/background (`script.js:13752–13759`). It cannot reproduce:

- soft-trim opacity/background,
- hard-trim colors,
- yellow nucleotide selection,
- green selected-row background.

These decorations therefore disappear from repositioned cells during a drag. Mouse-up reconciles the DOM, so this is transient visual corruption rather than sequence loss.

## Claim-by-claim results

### [claim 1] Baseline and optimized drag cost

status: **PARTIAL**

evidence:

- v146 handler: 275.3, 167.3, and 164.7 ms for three one-column steps.
- v161: 25-column test averaged 0.32 ms per step; median 0.2 ms; maximum 4.2 ms.
- v146 span-cache size was zero on the 101 × 960 fixture.

notes: The root cause and large improvement were reproduced. The exact 1,423 ms frame and 41.7 s total were not.

### [claim 2] Canvas drag does not mutate alignment DOM

status: **CONFIRMED**

evidence:

- 25 drag steps produced zero alignment-container mutations.
- One canvas layer was active and contained 23,277 nontransparent pixels.
- Zero overlay canvases remained after mouse-up.

notes: Documented fallback states engaged correctly. Claim 7 records additional missing guard states.

### [claim 3] Edit-mode entry and exit performance

status: **REFUTED**

evidence:

- v146 entry: 0.1 ms.
- v161 entry/cache harvest: 48.3 ms.
- v146 exit: 190.5 ms.
- v161 exit: 0.1 ms with no edits; 143.7 ms after edits.

notes: Exit behavior improved as claimed, but the stated 1,365 → 86 ms entry comparison was not reproduced; direct entry was faster on v146.

### [claim 4] Undo/redo performance

status: **PARTIAL**

evidence:

- v161 undo: 211.4 ms; redo: 153.2 ms.
- v146 undo: 193.4 ms.
- Instrumentation recorded zero full `renderAlignment()` calls for v161 undo and redo.

notes: The no-full-render implementation is confirmed; the claimed ~45 ms latency and speedup were not reproduced.

### [claim 5] Slide-left correctness and inverse property

status: **CONFIRMED**

evidence: Exhaustive length-eight binary residue/gap cases covered 448 valid slide positions. Right→left and left→right produced zero failures when trailing slack and adjacency requirements were met.

### [claim 6] Width-changing undo cannot delete residues

status: **CONFIRMED**

evidence:

- v161 reports `*`, `?`, `1`, and `Ω` as residues and refuses truncation over them.
- `-`, `.`, `~`, spaces, and tabs are gaps.
- Growing unequal rows padded them correctly.
- Shrinking rows with gap-only suffixes succeeded.
- `geneDocMoveTextString('AC*DEF', 3, -1)` left the sequence unchanged.

notes: The original v160 `*` loss is fixed by `8051f18`; this audit did not rediscover it as a current defect.

### [claim 7] Correct on-screen shading during drag

status: **REFUTED**

evidence: Conservation overlay painting worked and untouched DOM cells retained their shading. However, the overlay remained enabled for hard/soft trim, nucleotide selection, and row selection, and cannot reproduce those decorations.

### [claim 8] BAM/SAM file-button reference matching

status: **CONFIRMED**

evidence: A 300 bp reference with a descriptive `fullHeader` and 35 tiled `50M` SAM reads loaded through `handleBamFile()`. Result: 35 reads, reference `chr1`, Reads mode active.

notes: Real binary BAM remains untested.

### [claim 9] RTF shading

status: **CONFIRMED**

evidence:

- Captured RTF color table contained black, dark grey, light grey, and consensus grey.
- Highlight indices 0–4 were present.
- Export and screen repaint paths use the same conservation-shading classifier.
- In-place versus full-render DOM comparisons matched across monochrome, nucleotide, and AA Clustal schemes with top/bottom consensus and an active nucleotide selection.

### [claim 10] SVG guard in Canvas/Reads views

status: **CONFIRMED**

evidence: With sequences loaded but no residue spans, SVG export returned: “SVG export needs Block or Full view — the current view draws no per-residue cells.”

### [claim 11] RTF performance

status: **CONFIRMED**

evidence:

- 101 × 960: v146 6,703.5 ms; v161 76.5 ms.
- 200 × 2000: v161 255.8 ms.
- Output sizes: 1,472,626 and 6,037,485 bytes.

notes: Ratios and order of magnitude match the claim.

### [claim 12] Diagnostic clustering cost

status: **PARTIAL**

evidence:

- `sub_101.fa`: 2,749.8 ms total; 2,747.7 ms inside two `findBestGroup()` calls.
- A simple 200 × 2000 synthetic fixture took only 71.6 ms because its structure produced few candidates.
- A five-family 200 × 2000 fixture took 162,350.7 ms for one round, 162,349.4 ms inside `findBestGroup()`.

notes: Cost concentration is confirmed. The exact “4× data → 186× time” ratio is fixture-dependent and was not reproduced exactly; measured structured-fixture scaling was about 59×.

### [claim 13] Guide-tree grouping performance

status: **CONFIRMED**

evidence:

- Guide-tree cut of `sub_101.fa` into eight groups: 315.6 ms, all 101 assigned.
- Diagnostic clusterer at defaults: 2,749.8 ms, zero assigned.
- Group sizes: 92, 3, 1, 1, 1, 1, 1, 1.

### [claim 14] Pre-v158 operations painted zero frames

status: **PARTIAL**

evidence: Baseline long operations were synchronous and lacked a yield before blocking. The v146 RTF operation blocked for 6.7 s.

notes: The brief does not identify the claimed set of ten operations, so all ten were not replayed individually.

### [claim 15] `runWithProgress` yields before work

status: **CONFIRMED**

evidence: At callback start, the overlay existed, was not hidden, had computed `display: flex` and `visibility: visible`, and one animation frame had run. It was hidden after completion.

### [claim 16] Clustering Stop latency

status: **PARTIAL**

evidence:

- Simple 200 × 2000 fixture: longest `findBestGroup()` call 39.9 ms.
- Structured five-family 200 × 2000 fixture: 162,349.4 ms (2.71 minutes) for one `findBestGroup()` call.

notes: Stop is necessarily ignored for the complete round. The known limitation is confirmed; exact latency depends strongly on candidate structure.

### [claim 17] Chunked and synchronous clustering equivalence

status: **CONFIRMED**

evidence: On `example-colour-names.fa` with permissive settings, both implementations returned the same five clusters, sequence indices, one unassigned sequence, and identical summary.

### [claim 18] Re-root and swap correctness

status: **CONFIRMED**

evidence:

- Five repeated reroot/swap/Newick-round-trip cycles preserved leaves A–E.
- Total branch length remained 36.
- Each root had two children.
- Swapping the same node twice restored its original order.

### [claim 19] Unrooted tree geometry

status: **CONFIRMED**

evidence:

- Leaf labels spanned 244.6 px horizontally and 514.2 px vertically.
- Branch pixel/length ratios ranged from 36.77 to 36.88.
- The same live tree supplied rooted and unrooted layouts.

### [claim 20] Tree export, fullscreen, and resize

status: **CONFIRMED**

evidence:

- SVG export contained a white background and no `.tree-hit` elements.
- PNG export produced a nonempty 17,118-byte `image/png`.
- Fullscreen panel measured 1,920 × 1,080 at `(0,0)`.
- Escape exited fullscreen.
- Tree canvas computed `resize: vertical`.

### [claim 21] Tree Newick synchronization and Reset

status: **CONFIRMED**

evidence: Swap and reroot both changed `#treeNewickOutput`; Reset restored the exact original Newick string.

### [claim 22] “Optimal” renamed to “Defaults”

status: **CONFIRMED**

evidence: The button text is “Defaults”; its tooltip explicitly says the values are standard and not data-tuned. Startup and restored parameter objects were identical.

### [claim 23] Clusterability survey behavior

status: **REFUTED**

evidence:

- At defaults the grid contained 14 runs.
- `sub_101.fa` survey took 68,075 ms.
- Current settings assigned 0.
- Min Size 2 assigned 20.
- “Everything loosest” assigned 22.
- Other one-at-a-time variations assigned 0.
- Source inspection confirmed the survey does not mutate the parameter controls.

notes: Mechanics and parameter preservation work, but the interpretations are not reliable. The grid omits `minOccurrences: 1` and cannot detect parameter interactions before declaring settings inert.

### [claim 24] Guide-tree group recovery

status: **CONFIRMED**

evidence:

- `example-colour-names.fa`, five-way cut: group sizes 3, 3, 2, 2, 2.
- Each group contained exactly one designed family; no mixing.
- `sub_101.fa`, eight-way cut: 92, 3, 1, 1, 1, 1, 1, 1.

## Additional pressure tests

### In-place repaint equivalence

In-place repaint output was byte-for-byte identical to a forced full-render DOM snapshot in six combinations:

- monochrome, consensus top/bottom;
- nucleotide, consensus top/bottom;
- AA Clustal, consensus top/bottom.

Each case used protein symbols including `*`, sticky names off, and an active nucleotide selection.

### Mixed edit history

A chain containing:

1. Slide drag,
2. gap insertion,
3. residue typing,
4. column deletion,
5. hard trim and trim undo

was then globally undone, redone, and undone again. All three comparisons matched the expected sequence arrays exactly. Trim undo preserved the four-entry global edit history.

## Remaining unknowns

The following were not verified:

- real binary BAM through the optional server/samtools path;
- Firefox and Safari;
- optional server features (BLAST, SSH, MAFFT);
- touch/pointer input;
- snapshot save/restore after the new editing paths;
- accessibility of the new controls.

Protein symbols were exercised through width trimming, GeneDoc movement, RTF/repaint, and mixed undo paths, but this was not a complete protein-mode audit of every application feature.

## Repository integrity

The audit did not modify tracked application files. At completion, the only untracked repository files were:

- `MSA-errors.md`
- `audit-prompt-2026-08-06.md`
- `independent-audit-prompt.md`
- `usability-advances.md`

