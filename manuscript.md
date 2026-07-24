# ViewAlign: a browser-based platform for multiple sequence alignment visualization, editing, and analysis

## Target
**Bioinformatics (Oxford) — Application Note**
- ~3,000 words + 1 comparison table
- 14 references

---

## Summary

ViewAlign is a browser-based platform for interactive visualization, editing, and analysis of multiple sequence alignments. It supports DNA, RNA, protein, and coding-sequence data across five interchangeable view modes including a GPU-culled Canvas renderer and an IGV-style read-packing mode for NGS data. Eight input formats — FASTA, MSF, Clustal, PHYLIP, NEXUS, Stockholm, SAM, and BAM/CRAM — are supported with automatic format detection. Built-in analysis tools include codon-aware visualization with 15 selectable NCBI genetic codes, synonymous/non-synonymous classification, and frameshift detection; a position-pattern clustering algorithm (SINEClusterer) for subfamily annotation; dot-plot self-comparison with region detection; tandem repeat and TSD finding; UPGMA tree reconstruction; regex motif search; and integrated BLAST search with dynamic local database management. Sequences can be colour-labelled, sorted, and edited through a GeneDoc-style residue editor with full undo history. A WebAssembly compilation of MAFFT v7.525 — compiled from source by the authors — enables browser-side realignment without a server. The viewer exports publication-quality SVG and RTF with per-residue conservation shading, and a snapshot system saves complete viewer states. ViewAlign runs entirely in modern browsers with no installation and is freely available at https://toki-bio.github.io/MSA-viewer/ under the MIT license.

**Availability:** https://toki-bio.github.io/MSA-viewer/ — source code and 13-section manual at https://github.com/Toki-bio/MSA-viewer
**Contact:** [email]
**Supplementary information:** Comprehensive manual (manual.html), example alignments, server setup guide, and feature inventory included in the repository.

---

## 1. Introduction

Multiple sequence alignment (MSA) is a foundational technique in computational biology, essential for phylogenetic inference, functional motif detection, and comparative genomics. While mature alignment construction tools exist — MAFFT (Katoh & Standley, 2013), Clustal Omega (Sievers et al., 2011), MUSCLE (Edgar, 2004) — the downstream viewing and editing of alignments remains fragmented across desktop applications requiring platform-specific installation.

Desktop viewers such as Jalview (Waterhouse et al., 2009), AliView (Larsson, 2014), and SeaView (Gouy et al., 2010) provide rich feature sets but are tied to Java or native binaries. The browser-based MSAViewer (Yachdav et al., 2016) demonstrated JavaScript-based MSA visualization but is limited to display without editing or analysis. IGV (Robinson et al., 2011) excels at read-level visualization but lacks codon-level analysis or traditional MSA editing. Furthermore, no existing tool accepts the full range of alignment formats — FASTA, MSF, Clustal, PHYLIP, NEXUS, Stockholm, SAM, and BAM/CRAM — in a single interface, compelling users to pre-convert between formats.

Here we present ViewAlign, a self-contained browser application that bridges these gaps. It combines automatic format detection, interactive editing, NGS read alignment viewing, coding-sequence analysis, and publication-quality export in a zero-installation package with no framework dependencies. Table 1 compares ViewAlign with five established tools across 50+ features; no existing tool supports the full combination of formats, editing, codon analysis, NGS integration, and BLAST search offered by ViewAlign.

---

## 2. Features and Implementation

### 2.1 Architecture

ViewAlign is a single-page web application in vanilla JavaScript (~16,900 lines across six modules) with standard HTML and CSS. It has no framework dependencies, build step, or required installation. The client is hosted on GitHub Pages; an optional Node.js Express server (`server.js`) provides backend services (MAFFT, BLAST, samtools). The server is not required for core functionality. The MAFFT WebAssembly module was compiled from MAFFT v7.525 source (Katoh & Standley, 2013) using Emscripten, enabling browser-side realignment without a server; the compilation produces a 340 KB WASM binary with a JavaScript glue layer. The codebase has been validated with 1,200+ automated test checks covering all parser formats, codon analysis, conservation calculation, search functions, colour shading, and snapshot serialization. On a desktop workstation (Intel i7-12700K, 32 GB RAM, Node.js v22), parsers process a 200-sequence × 5,000-column alignment in 27–82 ms, conservation calculation in 64 ms, and codon analysis across all three reading frames in 1.9 s; Smith-Waterman alignment of 2,000 bp × 2,000 bp sequences completes in 106 ms.

### 2.2 Data Loading and Format Support

Eight input formats are supported with automatic detection:

| Format | Extension | Detection |
|--------|-----------|-----------|
| FASTA | .fasta, .fa | `>` header lines |
| MSF | .msf | `MSF:` header block |
| Clustal | .aln | `CLUSTAL` or `MUSCLE` header |
| PHYLIP | .phy | `nSeqs length` first-line pattern |
| NEXUS | .nex, .nxs | `#NEXUS` or `begin data` blocks |
| Stockholm | .sth | `# STOCKHOLM 1.0` header |
| SAM | .sam | `@HD`/`@SQ` headers or tab-separated CIGAR |
| BAM/CRAM | .bam, .cram | Server-side `samtools view` pipeline |

Alignments are loaded via text paste, drag-and-drop, file picker, URL fetch, SSH remote loading (server), or GenBank accession lookup. The SAM parser expands all eleven CIGAR operations into gapped alignments against a pileup consensus from mapped reads; secondary and unmapped reads are filtered. Clustal, PHYLIP, NEXUS, and Stockholm parsers handle both sequential and interleaved layouts. A recent-files panel stores metadata and full text (up to 100 KB per entry) in localStorage, enabling reload across browser sessions with adjustable history size (1–50 entries).

### 2.3 View Modes

Five interchangeable view modes with automatic mode selection for large datasets:

- **Full mode**: continuous scrolling alignment for browsing and editing.
- **Block mode**: fixed-width blocks (configurable 20–100 columns) with repeating sequence labels for publication-quality inspection.
- **Canvas mode**: GPU-composited 2D canvas renderer with viewport culling — draws only visible rows and columns per frame, eliminating per-residue DOM nodes. Activates automatically when the alignment exceeds 150,000 total residues (~100 sequences × 1,500 columns); users can switch back to DOM modes for editing. Navigation is via mouse wheel or click-drag panning.
- **Compact mode**: SVG-based read-packing tracks with coverage histogram. Reads are rendered as horizontal bars with mismatch positions marked in red. Optional controls: "Diffs only" (4-pixel hairlines, only mismatches visible) and "Pairs" (dashed lines connecting paired-end reads from SAM flags with mate-pair position).
- **Variable sites only** and **Highlight Diffs**: cross-mode overlays. Variable sites mode hides fully-conserved columns entirely. Highlight Diffs dims them to 25% opacity. Both reuse the same conserved-column computation.

### 2.4 Visualization and Customization

Conservation shading supports four modes (Identity, Similarity, Clustal, Zappo) with independently adjustable Black, Dark, and Light thresholds whose highlight colours are user-customizable via colour pickers. A consensus sequence can be shown above or below the alignment with configurable plurality/majority threshold and minimum coverage. Users can assign persistent custom background colours to individual sequences or groups via the Colour menu, with a colour inspector panel tracking the assignment history. Sequence names can be renamed by double-clicking (inline edit), truncated to a configurable length via a slider, and locked in place during horizontal scrolling (sticky names). Zoom is adjustable from 50% to 500%.

### 2.5 Editing and Sequence Management

Rows are selected by clicking or Ctrl+Clicking names, and reordered by drag-and-drop. Three sort functions (A→Z, length descending, similarity to first) reorder all sequences at once. Sequence order can be exported as a portable JSON file and reimported later, decoupling ordering from the alignment file. The colour system supports manual assignment (per-sequence colour pickers), automatic colouring by name similarity (Levenshtein-clustered header prefixes with configurable sensitivity and discrete/gradient modes), regex-pattern matching on sequence names, and cluster-membership colouring — all tracked in a colour history inspector. Colour assignments function as selection metadata: sequences can be copied, grouped, or sorted by colour in one click.

Edit Mode provides GeneDoc-style residue-level editing: type individual residues, insert or delete gap columns, and select column ranges. All operations are tracked in a random-access undo/redo stack with a visual dropdown history. A dedicated sequence text editor (SeqEdit) offers bulk transformations: degap, reverse, complement, reverse-complement, uppercase, and lowercase conversion with optional automatic length normalization. Selected column blocks can be de-gapped (with automatic all-gap column removal) or realigned in isolation via Ctrl+Shift+R, which extracts the block, de-gaps, runs MAFFT, and splices the result back without disturbing adjacent regions. Rows are reorderable by drag-and-drop, three sort criteria (name, length, similarity), or a k-mer UPGMA guide tree with optimal leaf ordering. Selected sequences can be replaced with their majority-rule consensus in a single operation, reducing alignment size while preserving subfamily signal. New sequences can be appended with gap-padding or realigned against the existing alignment via MAFFT in add-keep-length mode with automatic insertion-column propagation.

### 2.6 Codon-Aware Analysis

Inspired by MACSE (Ranwez et al., 2011), codon-aware visualization activates on nucleotide alignments with length divisible by three. Nucleotides are colour-coded by codon position (blue=first, green=second, orange=third). In-frame stop codons are highlighted with red backgrounds and bold white text. Frameshift-inducing indels are marked with wavy red underlines. Substitutions are classified as synonymous (green underline) or non-synonymous (double red underline) relative to a reference sequence. A translated amino acid track is displayed below each nucleotide sequence.

A dropdown selector supports 15 genetic code variants (NCBI tables 1–6, 9–14, 16, 21, 22), covering standard, vertebrate mitochondrial, invertebrate mitochondrial, ciliate nuclear, euplotid, ascidian mitochondrial, and other alternative codes. All downstream analyses — stop codon detection, mutation classification, and amino acid translation — dynamically respect the selected code. ViewAlign's codon analysis is performed post-hoc on pre-aligned sequences, complementary to codon-aware aligners such as MACSE. While MACSE enforces codon correspondence during alignment construction, ViewAlign provides interactive visualization and mutation classification on existing alignments. The frameshift detection feature alerts users to codon boundary disruptions caused by internal indels, indicating where codon-aware realignment may be needed.

### 2.7 Sequence Clustering

A dedicated position-pattern-based clustering algorithm (SINEClusterer, ~400 lines) groups sequences sharing diagnostic nucleotide positions. At each alignment column, the algorithm collects the set of sequences bearing each nucleotide, identifies candidate groups exceeding a minimum size threshold, and scores them by the fraction of positions where group members share the same base. Near-identical groups are fuzzy-merged (Jaccard index ≥ 90%, size difference ≤ 5), and per-group feature sets are deduplicated. Configurable parameters include minimum cluster size, quality thresholds for small/medium/large clusters (default 85%/75%/65%), gap and monomorphic-column filtering, and bounding-region trimming.

Clusters are displayed with diagnostic-feature tables, and sequences can be colour-labelled by cluster membership. A cluster preset system saves and restores parameter configurations. The "group consensus" feature computes and inserts a consensus row for selected sequences, complementing the clustering workflow for subfamily-level annotation of transposable elements.

### 2.8 Additional Analysis Tools

**Dot plot.** Self-comparison or pairwise comparison with adjustable window size, identity threshold, and context radius. An automatic region detector identifies the top 30 diagonal runs; clicking any region scrolls the alignment to the corresponding position. Plots can be exported as PNG or SVG.

**Motif search.** Supports exact motif matching with configurable mismatches (0–10), reverse-complement search, and regular-expression mode. Regex patterns (e.g., `[AG]CGT`, `ATG.{3}TAA`) are evaluated against degapped sequences; matches are highlighted in user-selectable colours. Fifty restriction enzyme recognition sites are pre-loaded.

**Repeat and TSD Finder.** Scans for tandem repeats and target-site duplications with configurable minimum repeat length, copy number, mismatch tolerance, and flanking window size. Found TSD pairs can be marked using colour highlighting, bold text, or lowercase residue styles.

**UPGMA Tree.** Constructed from pairwise identity distances. Outputs Newick format with branch lengths (downloadable as `.nwk`) and a text-based tree visualization.

**Snapshot system.** Saves and restores complete viewer states as JSON files: alignment, colour assignments, search highlights, column selections, view mode, zoom level, and custom colours. Supports URL-based snapshot loading.

**BLAST search.** Right-clicking any sequence opens a BLAST dialog listing all configured databases, fetched dynamically from the server. Users can add new FASTA databases (with automatic `makeblastdb` indexing) or delete existing ones, including all index files. Batch search against all databases is supported.

### 2.9 Export

Export options: FASTA (full alignment or selected sequences), MSF, RTF (Word-compatible with per-residue conservation shading, scale ruler, consensus line, monospace Courier New), and SVG (viewport or full alignment). The alignment can be opened in a standalone browser tab (Ctrl+T).

---

## 3. Discussion and Conclusion

ViewAlign addresses the gap between desktop alignment tools and modern browser-based bioinformatics workflows. By combining automatic format detection across eight input types, five view modes with GPU-composited Canvas rendering, GeneDoc-style interactive editing with full undo history, browser-based MAFFT alignment via WebAssembly, coding-sequence analysis with 15 genetic codes, integrated BLAST search with local database management, and publication-quality export in a zero-installation package, it eliminates the format-conversion and multi-tool switching that fragment current MSA workflows (Table 1).

The Canvas renderer's viewport-culling approach draws only visible residues per frame, matching strategies used by IGV.js (Robinson et al., 2011), while DOM-mode CSS optimizations — `content-visibility: auto` and `contain: layout style` — deliver responsive interaction for alignments up to approximately 200 sequences × 5,000 columns. The 15 selectable genetic codes and frameshift detection extend the MACSE paradigm (Ranwez et al., 2011) to a browser environment. The GeneDoc-style residue editor (Nicholas et al., 1997), with Move NoGaps and Slide KeepGaps tools, and the RTF export with per-residue conservation shading bring desktop-quality editing and figure generation to the browser. The position-pattern clustering algorithm enables subfamily-level annotation entirely within the viewing environment, while the colour system — supporting manual, cluster-based, regex-pattern, and name-similarity assignment with history tracking — provides visualization granularity absent from most viewers. Integrated BLAST search with dynamic local database management brings sequence homology analysis directly into the viewing workflow, eliminating the context switch to external BLAST interfaces.

Limitations include the absence of protein-level analyses (BLOSUM-based dot plots, structural feature annotation), 3D structure linking, and deeper phylogenetic integration. Codon analysis is performed post-hoc on pre-aligned sequences and does not modify the alignment to respect codon boundaries, unlike codon-aware aligners such as MACSE (Ranwez et al., 2011); however, frameshift detection alerts users to boundary disruptions where codon-aware realignment may be beneficial. The MAFFT WebAssembly module is compiled from MAFFT v7.525 source and inherits the algorithmic properties of that version. ViewAlign is freely available, runs without installation, and includes a comprehensive 13-section manual.

---

## Table 1

**Table 1.** Feature comparison of ViewAlign with five established MSA viewers and editors.

| Feature | ViewAlign | Jalview² | AliView³ | SeaView⁴ | MSAViewer⁵ | IGV⁶ |
|---------|:---------:|:--------:|:--------:|:--------:|:----------:|:----:|
| **Input formats** | | | | | | |
| FASTA | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| MSF | ✓ | ✓ | ✓ | — | — | — |
| Clustal | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| PHYLIP (sequential + interleaved) | ✓ | ✓ | ✓ | ✓ | — | — |
| NEXUS | ✓ | ✓ | ✓ | ✓ | — | — |
| Stockholm | ✓ | ✓ | — | — | ✓ | — |
| SAM/BAM | ✓ | — | — | — | — | ✓ |
| Auto-detection of format | ✓ | — | — | — | ✓ | ✓ |
| **View modes** | | | | | | |
| Full scrolling | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Fixed-width blocks | ✓ | ✓ | — | ✓ | — | — |
| Canvas (GPU-culled) | ✓ | — | — | — | — | ✓ |
| Read-packing (NGS) | ✓ | — | — | — | — | ✓ |
| Variable-sites-only | ✓ | — | — | — | — | — |
| **Editing** | | | | | | |
| Residue-level editing | ✓ | ✓ | ✓ | ✓ | — | — |
| Gap column insert/delete | ✓ | ✓ | ✓ | ✓ | — | — |
| Undo/redo history | ✓ | ✓ | ✓ | ✓ | — | — |
| Block realignment (in-browser) | ✓ | — | — | — | — | — |
| Append + realign | ✓ | — | — | — | — | — |
| Bulk transforms (degap/rev/comp) | ✓ | ✓ | ✓ | — | — | — |
| **Codon analysis** | | | | | | |
| 15 NCBI genetic codes | ✓ | — | — | — | — | — |
| Syn/non-syn classification | ✓ | — | — | — | — | — |
| Frameshift detection | ✓ | — | — | — | — | — |
| AA translation track | ✓ | — | — | — | — | — |
| **Visualization** | | | | | | |
| Selectable shading (4 modes) | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Adjustable thresholds | ✓ | — | — | — | — | — |
| Custom highlight colours | ✓ | — | — | — | — | — |
| Sequence name colouring | ✓ | — | — | — | — | — |
| Consensus line | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| **Analysis** | | | | | | |
| Position-pattern clustering | ✓ | — | — | — | — | — |
| Dot plot + region detector | ✓ | — | — | — | — | — |
| Motif search (regex + mismatch) | ✓ | — | — | — | ✓ | — |
| TSD finder | ✓ | — | — | — | — | — |
| UPGMA tree | ✓ | ✓ | — | ✓ | — | — |
| Consensus creation (selected seqs) | ✓ | — | — | — | — | — |
| Group → consensus replacement | ✓ | — | — | — | — | — |
| BLAST with local database management | ✓ | — | — | — | — | — |
| **Export** | | | | | | |
| SVG | ✓ | ✓ | — | — | ✓ | — |
| RTF (with conservation shading) | ✓ | — | — | — | — | — |
| FASTA / MSF | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| **Platform** | | | | | | |
| Zero installation | ✓ | — | — | — | ✓ | — |
| No Java dependency | ✓ | — | ✓ | — | ✓ | — |
| Browser-based MAFFT (WASM) | ✓ | — | — | — | — | — |
| SSH remote file loading | ✓ | — | — | — | — | — |
| Snapshot save/restore | ✓ | — | — | — | — | — |
| Restriction enzyme sites (50 enzymes) | ✓ | — | — | — | — | — |
| Colour history inspector | ✓ | — | — | — | — | — |

**Sources:** ²Waterhouse et al. (2009), ³Larsson (2014), ⁴Gouy et al. (2010), ⁵Yachdav et al. (2016), ⁶Robinson et al. (2011). ✓, supported; —, not supported.

---

## References

1. Katoh, K. & Standley, D.M. (2013) MAFFT multiple sequence alignment software version 7: improvements in performance and usability. *Mol. Biol. Evol.*, 30, 772–780.
2. Sievers, F. et al. (2011) Fast, scalable generation of high-quality protein multiple sequence alignments using Clustal Omega. *Mol. Syst. Biol.*, 7, 539.
3. Edgar, R.C. (2004) MUSCLE: multiple sequence alignment with high accuracy and high throughput. *Nucleic Acids Res.*, 32, 1792–1797.
4. Waterhouse, A.M. et al. (2009) Jalview Version 2 — a multiple sequence alignment editor and analysis workbench. *Bioinformatics*, 25, 1189–1191.
5. Larsson, A. (2014) AliView: a fast and lightweight alignment viewer and editor for large datasets. *Bioinformatics*, 30, 3276–3278.
6. Gouy, M., Guindon, S. & Gascuel, O. (2010) SeaView Version 4: a multiplatform graphical user interface for sequence alignment and phylogenetic tree building. *Mol. Biol. Evol.*, 27, 221–224.
7. Robinson, J.T. et al. (2011) Integrative genomics viewer. *Nat. Biotechnol.*, 29, 24–26.
8. Yachdav, G. et al. (2016) MSAViewer: interactive JavaScript visualization of multiple sequence alignments. *Bioinformatics*, 32, 3501–3503.
9. Ranwez, V. et al. (2011) MACSE: Multiple Alignment of Coding SEquences accounting for frameshifts and stop codons. *PLoS ONE*, 6, e22594.
10. Kumar, S. et al. (2018) MEGA X: Molecular Evolutionary Genetics Analysis across computing platforms. *Mol. Biol. Evol.*, 35, 1547–1549.
11. Okonechnikov, K. et al. (2012) Unipro UGENE: a unified bioinformatics toolkit. *Bioinformatics*, 28, 1166–1167.
12. Li, H. et al. (2009) The Sequence Alignment/Map format and SAMtools. *Bioinformatics*, 25, 2078–2079.
13. Nicholas, K.B. et al. (1997) GeneDoc: analysis and visualization of genetic variation. *EMBNEW.NEWS*, 4, 14.
14. Henikoff, S. & Henikoff, J.G. (1992) Amino acid substitution matrices from protein blocks. *Proc. Natl. Acad. Sci. USA*, 89, 10915–10919.

---

## Availability

| Item | Location |
|------|----------|
| Web application | https://toki-bio.github.io/MSA-viewer/ |
| Source code | https://github.com/Toki-bio/MSA-viewer |
| License | MIT |
| Comprehensive manual | https://toki-bio.github.io/MSA-viewer/manual.html |
| Issue tracker | https://github.com/Toki-bio/MSA-viewer/issues |
| Dependencies | None (client); MAFFT, BLAST+, samtools (server, optional) |

---

## Supplementary Information

- **manual.html**: 13-section comprehensive manual with sidebar navigation covering all features, 8 input formats, keyboard shortcuts, credits and attribution, and workflows
- **Example datasets**: FASTA, MSF, Clustal, PHYLIP, NEXUS, SAM, and BAM test files
- **Server setup guide**: included in the repository README
- **Deployment guide**: DEPLOYMENT.md with step-by-step public server deployment instructions
- **Feature inventory**: Complete table of 20+ feature categories
