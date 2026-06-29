# MSA Viewer: a browser-based platform for multiple sequence alignment visualization, editing, and analysis

## Target
**Bioinformatics (Oxford) — Application Note**
- 4 pages, ~2,600 words + 1–2 figures
- 13 references

---

## Summary

MSA Viewer is a browser-based platform for interactive visualization, editing, and analysis of multiple sequence alignments. It supports DNA, RNA, protein, and coding-sequence data across five interchangeable view modes, including a Canvas-based renderer with automatic viewport-culling activation for large alignments and an IGV-style compact read-packing mode. Eight input formats are supported — FASTA, MSF, Clustal, PHYLIP, NEXUS, Stockholm, SAM, and BAM/CRAM — with automatic format detection. Built-in analysis tools include codon-aware frame detection with 17 selectable genetic codes, synonymous/non-synonymous mutation classification, a position-pattern-based sequence clustering algorithm with fuzzy merging and configurable quality thresholds, dot-plot self-comparison with region detection, tandem repeat and target-site duplication finding, UPGMA tree reconstruction, and regular-expression motif search. Sequences can be individually colour-labelled, sorted by name, length, or similarity, and edited through a GeneDoc-style residue editor with full undo history. The viewer exports publication-quality SVG vector graphics and Word-compatible RTF with per-residue conservation shading. A snapshot system saves and restores complete viewer states including colour assignments, search highlights, and column selections. A recent-files history with localStorage persistence tracks opened files and clipboard pastes. An optional Node.js server provides MAFFT realignment, BLAST search, SSH remote file loading, and BAM-to-SAM conversion. The viewer runs entirely in modern browsers with no installation and is freely available at https://toki-bio.github.io/MSA-viewer/ under the MIT license.

**Availability:** https://toki-bio.github.io/MSA-viewer/ — source code, comprehensive manual, and example data at https://github.com/Toki-bio/MSA-viewer
**Contact:** [email]
**Supplementary information:** 9-section manual (manual.html), example alignments, server setup guide, and feature inventory table included in the repository.

---

## 1. Introduction

Multiple sequence alignment (MSA) is a foundational technique in computational biology, essential for phylogenetic inference, functional motif detection, and comparative genomics. While mature alignment construction tools exist — MAFFT (Katoh & Standley, 2013), Clustal Omega (Sievers et al., 2011), MUSCLE (Edgar, 2004) — the downstream viewing and editing of alignments remains fragmented across desktop applications requiring platform-specific installation.

Desktop viewers such as Jalview (Waterhouse et al., 2009), AliView (Larsson, 2014), and SeaView (Gouy et al., 2010) provide rich feature sets but are tied to Java or native binaries. The browser-based MSAViewer (Yachdav et al., 2016) demonstrated JavaScript-based MSA visualization but is limited to display without editing or analysis. IGV (Robinson et al., 2011) excels at read-level visualization but lacks codon-level analysis or traditional MSA editing. Furthermore, no existing tool accepts the full range of alignment formats — FASTA, MSF, Clustal, PHYLIP, NEXUS, Stockholm, SAM, and BAM/CRAM — in a single interface, compelling users to pre-convert between formats.

Here we present MSA Viewer, a self-contained browser application that bridges these gaps. It combines automatic format detection, interactive editing, NGS read alignment viewing, coding-sequence analysis, and publication-quality export in a zero-installation package with no framework dependencies.

---

## 2. Features and Implementation

### 2.1 Architecture

MSA Viewer is a single-page web application in vanilla JavaScript (~12,000 lines) with standard HTML and CSS. It has no framework dependencies, build step, or required installation. The client is hosted on GitHub Pages; an optional Node.js Express server (`server.js`) provides backend services (MAFFT, BLAST, samtools). The server is not required for core functionality.

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

Rows are selected by clicking or Ctrl+Clicking names, and reordered by drag-and-drop. Three sort operations are available: alphabetical by name, by gapless sequence length (descending), and by pairwise similarity to the first sequence. All operations — row deletion, duplication, reverse-complement, column deletion, gap insertion, and residue typing — are tracked in an undo/redo stack with a visual dropdown history.

Edit Mode provides GeneDoc-style residue-level editing: type individual residues, insert or delete gap columns, and select column ranges. A dedicated sequence text editor (SeqEdit) offers bulk transformations: degap, reverse, complement, reverse-complement, uppercase, and lowercase conversion with optional automatic length normalization. New sequences can be appended with gap-padding or realigned against the existing alignment via MAFFT in add-keep-length mode. A selected block of columns can be realigned in isolation (Ctrl+Shift+R).

### 2.6 Codon-Aware Analysis

Inspired by MACSE (Ranwez et al., 2011), codon-aware visualization activates on nucleotide alignments with length divisible by three. Nucleotides are colour-coded by codon position (blue=first, green=second, orange=third). In-frame stop codons are highlighted with red backgrounds and bold white text. Frameshift-inducing indels are marked with wavy red underlines. Substitutions are classified as synonymous (green underline) or non-synonymous (double red underline) relative to a reference sequence. A translated amino acid track is displayed below each nucleotide sequence.

A dropdown selector supports 17 genetic code variants (NCBI tables 1–6, 9–14, 16, 21, 22), covering standard, vertebrate mitochondrial, invertebrate mitochondrial, ciliate nuclear, euplotid, ascidian mitochondrial, and other alternative codes. All downstream analyses — stop codon detection, mutation classification, and amino acid translation — dynamically respect the selected code.

### 2.7 Sequence Clustering

A dedicated position-pattern-based clustering algorithm (SINEClusterer, ~400 lines) groups sequences sharing diagnostic nucleotide positions. At each alignment column, the algorithm collects the set of sequences bearing each nucleotide, identifies candidate groups exceeding a minimum size threshold, and scores them by the fraction of positions where group members share the same base. Near-identical groups are fuzzy-merged (Jaccard index ≥ 90%, size difference ≤ 5), and per-group feature sets are deduplicated. Configurable parameters include minimum cluster size (3–50), perfect-match requirements, quality thresholds for small/medium/large clusters (default 90%/80%/70%), size breakpoints between tiers, bounding region trimming to exclude ragged alignment ends, and upper-bound relaxation for datasets exceeding 30, 50, or 80 sequences.

Clusters are displayed with diagnostic-feature tables, and sequences can be colour-labelled by cluster membership with persistent background colours on sequence names. A cluster preset system saves and restores parameter configurations for reproducible analysis. The "group consensus" feature computes and inserts a consensus row for any selected set of sequences with adjustable threshold, complementing the clustering workflow for subfamily-level annotation of transposable elements.

### 2.8 Additional Analysis Tools

**Dot plot.** Self-comparison or pairwise comparison with adjustable window size (1–61), identity threshold (0–100%), and context radius. An automatic region detector identifies the top 30 diagonal runs and presents them in a navigable sidebar — clicking any region scrolls the alignment to the corresponding position. Hovering shows aligned sequence context with mismatch highlighting. Plots can be exported as PNG or SVG. A "Copy Region" button exports the hovered region as FASTA.

**Motif search.** The search bar supports exact motif matching with configurable mismatches (0–10), reverse-complement search, and a regular-expression mode. Regex patterns (e.g., `[AG]CGT`, `ATG.{3}TAA`) are evaluated against degapped sequences; matches are highlighted in user-selectable colours. Ctrl+Click on any residue instantly searches for that base across the alignment.

**Repeat and TSD Finder.** Scans for tandem repeats and target-site duplications with configurable minimum repeat length, copy number, mismatch tolerance, and flanking window size. Found TSD pairs can be marked using colour highlighting, bold text, or lowercase residue styles, with an undo option.

**UPGMA Tree.** Constructed from pairwise identity distances. Outputs Newick format with branch lengths (downloadable as `.nwk`) and a text-based tree visualization.

**Snapshot system.** Saves and restores complete viewer states as JSON files: current alignment, colour assignments, search highlights, column selections, view mode, zoom level, and custom colours. Supports URL-based snapshot loading (`?snapshotFile=`).

### 2.9 Export

Export options: FASTA (full alignment or selected sequences), MSF, RTF (Word-compatible with per-residue conservation shading, scale ruler, consensus line, monospace Courier New), and SVG (viewport or full alignment). The alignment can be opened in a standalone browser tab (Ctrl+T).

---

## 3. Discussion and Conclusion

MSA Viewer addresses the gap between desktop alignment tools and modern web-based bioinformatics workflows. By combining automatic format detection across eight input types, a Canvas rendering mode with auto-activation thresholds, interactive editing with full undo history, coding-sequence analysis, and publication-quality export in a zero-installation browser application, it eliminates the format-conversion and installation barriers that fragment current MSA workflows.

The Canvas renderer's viewport-culling approach matches the strategy used by MSAViewer (Yachdav et al., 2016) and IGV.js (Robinson et al., 2011), while CSS optimizations — `content-visibility: auto`, `contain: layout style`, and GPU-composited scrolling — deliver responsive DOM-based interaction for alignments up to approximately 200 sequences × 5,000 columns. The 17 selectable genetic codes and frameshift detection extend the MACSE paradigm (Ranwez et al., 2011) to a browser environment for the first time. The customizable multi-threshold shading system and per-sequence colour labelling provide visualization flexibility absent from most web-based viewers, while the position-pattern clustering algorithm enables subfamily-level annotation of repetitive elements directly within the viewer.

Limitations include the absence of protein-level analyses (BLOSUM-based dot plots, structural feature annotation) and deeper phylogenetic integration. A WebAssembly-based MAFFT module is planned to eliminate the server dependency for realignment. MSA Viewer is freely available, runs without installation, and includes a comprehensive 9-section manual.

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

- **manual.html**: 9-section comprehensive manual covering all features, 8 input formats, keyboard shortcuts, and workflows
- **Example datasets**: FASTA, MSF, Clustal, PHYLIP, NEXUS, and SAM test files
- **Server setup guide**: included in the repository README
- **Deployment guide**: DEPLOYMENT.md with step-by-step public server deployment instructions
- **Feature inventory**: Complete table of 17+ feature categories
