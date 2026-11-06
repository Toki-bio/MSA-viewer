# Session 2026-11-06: ViewAlign for Galaxy, comparison, benchmark, perf fixes

Claude session (claude.ai, cloud container). Goal: propose ViewAlign to the Galaxy project as a
visualization; check what Galaxy already has; compare properly; benchmark; fix weaknesses.
Harness, raw results and patch: `bench/galaxy-compare/`. Tested against `main` at `84acbc9`.

## 1. What Galaxy already ships (verified from npm package contents)

| Plugin | Package | Library | Accepts | Features (plugin XML help) |
|---|---|---|---|---|
| "Multiple Sequence Alignment" | `@galaxyproject/alignment@0.0.9` | alignment.js (veg) | `fasta` | axis labels, residue colouring, linked scrolling |
| "Multiple Sequence Alignment and Sequence Logo" | `@galaxyproject/alignmentviewer@0.0.3` | Alignment Viewer 2.0 (sanderlab), pixi.js WebGL | `a2m`, `fasta`, `stockholm` | zoom to residue, DNA/RNA/protein, sequence logo, consensus, conservation, gap stats |

- Both read `#app[data-incoming]` -> `${root}api/datasets/${dataset_id}/display`.
- AV 2.0 treats text starting with `>` as FASTA, otherwise Stockholm.
- Galaxy PR #20907 added AV 2.0 + an A2M datatype (resolved issue #20848, the old static-image MSA plugin).
- Plugins live in `galaxyproject/galaxy-visualizations`; registration via `client/visualizations.yml`
  in the Galaxy repo (Galaxy Charts deploy docs).

## 2. Feature comparison

| | ViewAlign | AV 2.0 | alignment.js |
|---|---|---|---|
| Input | 10 formats auto-detected (README) | FASTA, A2M, Stockholm | FASTA |
| Logo | **none** | yes | no |
| Consensus | threshold (% of all rows, gaps in denominator), min coverage, Normal/Ambiguous ties, gap/N/IUPAC fallback, per-group | yes | no |
| Editing | residue edits, gap columns, block realign, undo/redo | no | no |
| Alignment | MAFFT wasm, codon (MACSE port) | no | no |
| Subfamilies | k-mer / SNP grouping | no | no |
| Trees | UPGMA/NJ, p/JC/K2P, Newick | no | no |
| Annotation | BED track following gaps | annotation columns | no |
| Export | FASTA, SVG, RTF, Newick, HTML snapshot, stats | filtered results (1.0 site) | no |

Pitch angle: alignment **editor + curation workbench** for nucleotide/repeat families,
complementary to AV 2.0 (browsing, logo). Do not claim consensus as a differentiator.

## 3. Benchmark (medians of 3; see bench/galaxy-compare/README.md for method)

| Alignment | ViewAlign | AV 2.0 | alignment.js |
|---|---|---|---|
| 1k x 300 nt | 0.7 s | 0.9 s | 0.3 s |
| 50k x 300 nt | 4.5 s, 183 MB | 1.2 s, 47 MB | 2.4 s |
| 2k x 6,000 nt | 2.8 s | 2.6 s | 0.6 s |
| 500 x 50,000 nt | 4.1 s | **crashed 3/3** | 2.1 s, janky scroll |
| 100k x 400 aa | 10.5 s, 530 MB | 2.1 s, 119 MB | 4.2 s, janky scroll |

- ViewAlign scroll p95 ~16.7 ms (60 fps) at every size, vertical and horizontal.
- AV 2.0 crash depends on **width**: 250 x 50,000 (12.5M) crashed 2/2; 1,250 x 20,000 (25M) fine.
  Its renderer draws the whole alignment into tiles uploaded as WebGL sprites.
- AV 2.0 scroll numbers excluded: software WebGL (82% of scroll time in SwiftShader).
- **Pending**: real-GPU run of AV 2.0 scroll + 50k-column crash (needs test files hosted where
  the user's Chrome can reach them, e.g. a `viewalign-bench` repo with Pages; user approval needed).

## 4. Performance fixes (bench/galaxy-compare/viewalign-perf-fixes.patch; NOT applied to main)

| # | Problem (evidence) | Fix |
|---|---|---|
| 1 | `?url=` handler writes the whole file into `#fastaInput`; Chrome keeps textarea text as text node + `<br>` per line: 100k x 400 FASTA = ~1.2M nodes, ~2 s in the setter (profile: anon @script.js:27844) | `_setInputText()`: inputs > 2 MB kept in `_bigInputText`, paste box shows a placeholder; `parseAndRender` reads `_bigInputText ?? fastaInput.value`; `\r` replace only when present |
| 2 | `_computeConsensusCharForColumn` / `_computeConservationForColumn` call `toUpperCase()` + object counting per residue (~5.9 s self time at 100k) | `charCodeAt` into `Int32Array(128)`; same keys in first-seen order; non-ASCII falls back to `*_orig`; decision logic split into `_consensusDecide` unchanged |
| 3 | `_resetRepeatFinderForNewFile` -> `_fillRepeatFinderSeqSelect(0)` builds one `<option>` per row on every load with the panel closed (100,000 options) | fill only if the modal is visible; else clear list (`openRepeatFinder` already refills, `_repeatFinderCurrentRow` detects stale list) |

Results (100k x 400 aa): rows visible 11.5 s -> 3.9 s; shading+consensus complete 24.8 s -> 7.3 s;
nodes 1.8M -> 5k. 50k x 300 nt: 4.5 -> 1.8 s. 500 x 50k nt: 4.1 -> 2.0 s.
Verification: sequence/consensus/shading SHA-256 identical to original on 3 large files;
`equal_va.js` 134,680 column x option comparisons, 0 differences (incl. lowercase, U/N/X/?/~/./*,
IUPAC, ragged rows, non-ASCII); regression suite 275 pass / 2 fail, both failing identically
on unpatched main here ("Canvas mode: codon analysis draws stops...", "Canvas rows have the
Full row height...") - environment (Linux headless), not the patch.

Patch numbering note: in the patch file the order is Repeat Finder (fix 1), counting (fix 2),
textarea (fix 3); the table above is ordered by impact.

## 5. Still to do (per this repo's CLAUDE.md, a fix needs a regression check)

1. Apply the patch on a branch; add regression checks:
   - node count after loading a 10k-row FASTA via `?url=` stays < ~10k;
   - consensus/conservation equality vs `*_orig` (port `equal_va.js`), then drop `*_orig` or keep as test oracle;
   - Repeat Finder list filled when the panel opens after a new file load.
2. Extend `_setInputText()` to the other paste-box writers: script.js lines 1513, 1652, 2026,
   14240, 14386, 14399, 14425, 17918, 27364, 27383, 27409, 27832, 27865 (file open, drop,
   recent files, accession fetch, snapshot, handoff).
3. Embedding: skip `showLargeAlignmentDialog` for `?url=` / new `?embed=1` loads and open in Canvas
   (`runAlignmentPreflight`, `classifyAlignmentSize`: tall > 500 rows, long > 3000 cols, crazy > 5M).
4. Docs: manual "split above 500 x 5,000" vs README prompt "500 x 3,000" vs benchmark (100M residues
   fine) - reconcile; `features-inventory.md` "No other browser-based viewer accepts ... Stockholm"
   is false (AV 2.0 does); inventory says "No CRAM support", README says BAM/CRAM.
5. Consider a sequence logo (AV 2.0 has one; first thing a reviewer compares).
6. Remaining memory: ~306 MB JS heap at 100k x 400 after fixes vs AV 2.0 119 MB - not yet profiled.
7. Real-GPU benchmark of AV 2.0 (section 3).
8. Galaxy: open issue in `galaxyproject/galaxy-visualizations` (draft below), then a Galaxy Charts
   wrapper passing the dataset display URL to `?url=`.

## 6. Galaxy issue draft (updated with benchmark facts)

> **Title:** Proposal: ViewAlign, an alignment editor/analysis visualization for nucleotide and repeat-family MSAs
>
> I'd like to contribute ViewAlign (https://toki-bio.github.io/MSA-viewer, MIT,
> https://github.com/Toki-bio/MSA-viewer) as a Galaxy visualization: a client-side MSA editor and
> curation workbench developed over two years for transposable-element and satellite-DNA work.
>
> It complements the existing plugins: AV 2.0 covers browsing with logo and consensus; ViewAlign adds
> editing (residues, gap columns, block realign, undo), in-browser MAFFT and codon alignment,
> subfamily grouping, configurable consensus, UPGMA/NJ trees, gap-aware BED tracks, and exports
> (FASTA, SVG, RTF, Newick, HTML snapshot). In our tests it scrolls at 60 fps from 1k to 100k rows
> and handles 50,000-column alignments.
>
> Integration: ViewAlign already loads `?url=<dataset>&title=&view=`, so the plugin is a thin Galaxy
> Charts wrapper passing the dataset display URL; no build step, no framework. Server features
> (BLAST databases, SSH) left out.
>
> Questions: (1) can a visualization write an edited alignment/consensus back to the history as a new
> dataset? (2) MACSE port is CeCILL 2.1 (MAFFT BSD): acceptable, or ship without it? (3) bundle size limits?
>
> Happy to write and maintain the plugin.

Before posting: confirm the 50k-column claim wording on a real GPU, and fix item 4 (docs).
