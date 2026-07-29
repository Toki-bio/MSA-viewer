# ViewAlign: a browser-based platform for multiple sequence alignment visualization, editing, and analysis

> **Revision note (v132, 2026-07-29):** Draft aligned with the current viewer (`script.js` v132). Corrections: view-mode naming (Reads vs Compact), nine input formats including GenBank flatfile, conservation vs residue colour schemes, browser-based BLAST worker, line counts, Canvas description, snapshot/shortcut caveats, and limitations paragraph. Remove this block before submission.

## Target
**Bioinformatics (Oxford) — Application Note**
- ~3,000 words + 1 comparison table
- 14 references

---

## Summary

ViewAlign is a browser-based platform for interactive visualization, editing, and analysis of multiple sequence alignments. It supports DNA, RNA, protein, and coding-sequence data across four view modes — Full, Block, Canvas, and Reads — with automatic switching to Canvas when alignments exceed 150,000 total residues. Nine input formats are supported — FASTA, MSF, Clustal, PHYLIP, NEXUS, Stockholm, GenBank flatfile, SAM, and BAM/CRAM — with automatic format detection. Built-in analysis tools include codon-aware frame detection with 15 selectable NCBI genetic codes, synonymous/non-synonymous mutation classification, a position-pattern-based sequence clustering algorithm with fuzzy merging and configurable quality thresholds, dot-plot self-comparison with region detection, tandem repeat and target-site duplication finding, UPGMA tree reconstruction, and regular-expression motif search. Sequences can be individually colour-labelled, sorted by name, length, or similarity, and edited through a GeneDoc-style residue editor with full undo history. A residue-case toggle (upper/lower/as-is) provides GeneDoc-compatible display conventions. The viewer exports publication-quality SVG vector graphics and Word-compatible RTF with per-residue conservation shading. A snapshot system saves and restores viewer states including colour assignments, search highlights, and column selections (Full/Block modes). Browser-based alignment is provided by a WebAssembly-compiled MAFFT module (disttbfast, v7.525) requiring no server. An optional Node.js server enables local BLAST database hosting, SSH remote file access, and BAM/CRAM conversion via samtools; when the server is running, BLAST search uses a browser Web Worker with Smith–Waterman scoring and IndexedDB caching of database FASTA files, with optional `blastn` acceleration when BLAST+ is installed. The viewer runs entirely in modern browsers with no installation and is freely available at https://toki-bio.github.io/MSA-viewer/ under the MIT license.

**Availability:** https://toki-bio.github.io/MSA-viewer/ — source code and 13-section manual at https://github.com/Toki-bio/MSA-viewer
**Contact:** [email]
**Supplementary information:** Comprehensive manual (manual.html), example alignments, server setup guide, and feature inventory included in the repository.

---

## 1. Introduction

Multiple sequence alignment (MSA) is a foundational technique in computational biology, essential for phylogenetic inference, functional motif detection, and comparative genomics. While mature alignment construction tools exist — MAFFT (Katoh & Standley, 2013), Clustal Omega (Sievers et al., 2011), MUSCLE (Edgar, 2004) — the downstream viewing and editing of alignments remains fragmented across desktop applications requiring platform-specific installation.

Desktop viewers such as Jalview (Waterhouse et al., 2009), AliView (Larsson, 2014), and SeaView (Gouy et al., 2010) provide rich feature sets but are tied to Java or native binaries. The browser-based MSAViewer (Yachdav et al., 2016) demonstrated JavaScript-based MSA visualization but is limited to display without editing or analysis. IGV (Robinson et al., 2011) excels at read-level visualization but lacks codon-level analysis or traditional MSA editing. Furthermore, no existing tool accepts the full range of alignment formats — FASTA, MSF, Clustal, PHYLIP, NEXUS, Stockholm, GenBank, SAM, and BAM/CRAM — in a single interface, compelling users to pre-convert between formats.

Here we present ViewAlign, a self-contained browser application that bridges these gaps. It combines automatic format detection, interactive editing, NGS read alignment viewing, coding-sequence analysis, and publication-quality export in a zero-installation package with no framework dependencies. Table 1 compares ViewAlign with five established tools across 50+ features; no existing tool supports the full combination of formats, editing, codon analysis, NGS integration, and BLAST search offered by ViewAlign.

---

## 2. Features and Implementation

### 2.1 Architecture

ViewAlign is a single-page web application in vanilla JavaScript (~16,900 lines across six modules) with standard HTML and CSS. It has no framework dependencies, build step, or required installation. The client is hosted on GitHub Pages; an optional Node.js Express server (`server.js`) provides backend services (BLAST database registry, SSH file fetch, samtools BAM/CRAM conversion, and server-side MAFFT). The server is not required for core alignment viewing, editing, MAFFT-in-browser, or export. The MAFFT WebAssembly module was compiled from MAFFT v7.525 source (Katoh & Standley, 2013) using Emscripten, enabling browser-side realignment without a server; the compilation produces a 340 KB WASM binary with a JavaScript glue layer. The codebase has been validated with 1,200+ automated test checks covering parser formats, codon analysis, conservation calculation, search functions, colour shading, and snapshot serialization. On a desktop workstation (Intel i7-12700K, 32 GB RAM, Node.js v22), parsers process a 200-sequence × 5,000-column alignment in 27–82 ms, conservation calculation in 64 ms, and codon analysis across all three reading frames in 1.9 s; Smith-Waterman alignment of 2,000 bp × 2,000 bp sequences completes in 106 ms.

### 2.2 Data Loading and Format Support

Nine input formats are supported with automatic detection:

| Format | Extension | Detection |
|--------|-----------|-----------|
| FASTA | .fasta, .fa | `>` header lines |
| MSF | .msf | `MSF:` header block |
| Clustal | .aln | `CLUSTAL` or `MUSCLE` header |
| PHYLIP | .phy | `nSeqs length` first-line pattern |
| NEXUS | .nex, .nxs | `#NEXUS` or `begin data` blocks |
| Stockholm | .sth | `# STOCKHOLM 1.0` header |
| GenBank | .gb, .gbk | `LOCUS` record header |
| SAM | .sam | `@HD`/`@SQ` headers or tab-separated CIGAR |
| BAM/CRAM | .bam, .cram | Server-side `samtools view` pipeline |

Alignments are loaded via text paste, drag-and-drop, file picker, URL fetch (`?data=` or remote URL), or SSH remote loading (server). GenBank records are parsed from pasted or uploaded flatfiles (not live NCBI accession fetch). The SAM parser expands all eleven CIGAR operations into gapped alignments against a pileup consensus from mapped reads; secondary and unmapped reads are filtered. Clustal, PHYLIP, NEXUS, and Stockholm parsers handle both sequential and interleaved layouts. A recent-files panel stores metadata and full text (up to 100 KB per entry) in localStorage, enabling reload across browser sessions with adjustable history size (1–50 entries).

### 2.3 View Modes

Four primary view modes, plus two cross-mode overlays:

- **Full mode**: continuous scrolling alignment for browsing and editing.
- **Block mode**: fixed-width blocks (configurable 20–300 columns, auto-fit to screen width) with repeating sequence labels for publication-quality inspection.
- **Canvas mode**: HTML5 Canvas 2D renderer with viewport culling — draws only visible rows and columns per frame, eliminating per-residue DOM nodes. Activates automatically when the alignment exceeds 150,000 total residues (~100 sequences × 1,500 columns); users can switch back to Full/Block for editing. Navigation is via mouse wheel or click-drag panning. Conservation shading is computed asynchronously after the initial unshaded paint.
- **Reads mode**: IGV-style read tracks for BAM/SAM data loaded against a reference sequence — reference row, scale ruler, and per-read rows with mismatch highlighting. Intended for mapped-read inspection rather than residue-level MSA editing.

**Overlays (Full/Block):** **Variable sites only** hides fully conserved columns; **Highlight diffs** dims conserved columns to 25% opacity. Both reuse the same conserved-column computation.

*Note:* Several analysis tools (motif search, codon overlay, clustering highlights, sequence-name colouring) operate in Full/Block modes only; Canvas and Reads are optimized for large-scale viewing.

### 2.4 Visualization and Customization

**Conservation shading** uses three adjustable frequency tiers (Black, Dark, Light) with user-customizable highlight colours, applied against either non-gap positions only or all positions (including gaps). **Residue colour schemes** (independent of conservation) include Monochrome, Nucleotide, Purine/Pyrimidine, Nucleotide Ambiguity, Amino Acid Clustal-like, and Amino Acid Jalview-like palettes.

A consensus sequence can be shown above or below the alignment with configurable normal/ambiguous consensus type, plurality threshold, and minimum coverage. Users can assign persistent custom background colours to individual sequences or groups via the Colour menu, with a colour inspector panel tracking the assignment history. Sequence names can be renamed by double-clicking (inline edit), truncated to a configurable length via a slider, and locked in place during horizontal scrolling (sticky names). Zoom is adjustable from 50% to 500%.

### 2.5 Editing and Sequence Management

Rows are selected by clicking or Ctrl+Clicking names, and reordered by drag-and-drop. Three sort functions (A→Z, length descending, similarity to first) reorder all sequences at once. Sequence order can be exported as a portable JSON file and reimported later, decoupling ordering from the alignment file. The colour system supports manual assignment (per-sequence colour pickers), automatic colouring by name similarity (n-gram Jaccard clustering of header prefixes with configurable sensitivity and discrete/gradient modes), regex-pattern matching on sequence names, and cluster-membership colouring — all tracked in a colour history inspector. Colour assignments function as selection metadata: sequences can be copied, grouped, or sorted by colour in one click.

Edit Mode provides GeneDoc-style residue-level editing: type individual residues, insert or delete gap columns, and select column ranges. All operations are tracked in a random-access undo/redo stack with a visual dropdown history. A dedicated sequence text editor (SeqEdit) offers bulk transformations: degap, reverse, complement, reverse-complement, uppercase, and lowercase conversion with optional automatic length normalization. Selected column blocks can be de-gapped (with automatic all-gap column removal) or realigned in isolation via Ctrl+Shift+R when at least two columns are selected — the shortcut extracts the block, de-gaps, runs MAFFT, and splices the result back without disturbing adjacent regions; when fewer than two columns are selected, Ctrl+Shift+R is left to the browser (hard refresh). Rows are reorderable by drag-and-drop, three sort criteria (name, length, similarity), or a k-mer UPGMA guide tree with optimal leaf ordering. Selected sequences can be replaced with their majority-rule consensus in a single operation, reducing alignment size while preserving subfamily signal. New sequences can be appended with gap-padding or realigned against the existing alignment via MAFFT in add-keep-length mode with automatic insertion-column propagation.

### 2.6 Codon-Aware Analysis

Inspired by MACSE (Ranwez et al., 2011), codon-aware visualization activates on nucleotide alignments in Full/Block modes when length is divisible by three. Nucleotides are colour-coded by codon position (blue=first, green=second, orange=third). In-frame stop codons are highlighted with red backgrounds and bold white text. Frameshift-inducing indels are marked with wavy red underlines. Substitutions are classified as synonymous (green underline) or non-synonymous (double red underline) relative to a reference sequence. A translated amino acid track is displayed below each nucleotide sequence.

A dropdown selector supports 15 genetic code variants (NCBI tables 1–6, 9–14, 16, 21, 22), covering standard, vertebrate mitochondrial, invertebrate mitochondrial, ciliate nuclear, euplotid, ascidian mitochondrial, and other alternative codes. All downstream analyses — stop codon detection, mutation classification, and amino acid translation — dynamically respect the selected code. ViewAlign's codon analysis is performed post-hoc on pre-aligned sequences, complementary to codon-aware aligners such as MACSE. While MACSE enforces codon correspondence during alignment construction, ViewAlign provides interactive visualization and mutation classification on existing alignments. The frameshift detection feature alerts users to codon boundary disruptions caused by internal indels, indicating where codon-aware realignment may be needed.

### 2.7 Sequence Clustering

A dedicated position-pattern-based clustering algorithm (SINEClusterer, ~450 lines) groups sequences sharing diagnostic nucleotide positions. At each alignment column, the algorithm collects the set of sequences bearing each nucleotide, identifies candidate groups exceeding a minimum size threshold, and scores them by the fraction of positions where group members share the same base. Near-identical groups are fuzzy-merged (Jaccard index ≥ 90%, size difference ≤ 5), and per-group feature sets are deduplicated. Configurable parameters include minimum cluster size (3–50), perfect-match requirements, quality thresholds for small/medium/large clusters (default 85%/75%/65%, with gap and monomorphic-column filtering), size breakpoints between tiers, bounding region trimming to exclude ragged alignment ends, and upper-bound relaxation for datasets exceeding 30, 50, or 80 sequences.

Clusters are displayed with diagnostic-feature tables, and sequences can be colour-labelled by cluster membership with persistent background colours on sequence names (Full/Block). A cluster preset system saves and restores parameter configurations for reproducible analysis. The "group consensus" feature computes and inserts a consensus row for any selected set of sequences with adjustable threshold, complementing the clustering workflow for subfamily-level annotation of transposable elements.

### 2.8 Additional Analysis Tools

**Dot plot.** Self-comparison or pairwise comparison in SPIN (word-match) or Dotter (sliding-window) modes, with adjustable word/window size (1–61), identity threshold (0–100%), and context radius. An automatic region detector identifies the top 30 diagonal runs and presents them in a navigable sidebar — clicking any region scrolls the plot to the corresponding position. Hovering shows aligned sequence context with mismatch highlighting. Plots can be exported as PNG or SVG. A "Copy Region" button exports the hovered region as FASTA.

**Motif search.** The search bar supports exact motif matching with configurable mismatches (0–10), reverse-complement search, and a regular-expression mode (Full/Block only). Regex patterns (e.g., `[AG]CGT`, `ATG.{3}TAA`) are evaluated against degapped sequences; matches are highlighted in user-selectable colours. Fifty restriction enzyme recognition sites are pre-loaded. Ctrl+Click on any residue instantly searches for that base across the alignment.

**Repeat and TSD Finder.** Scans for tandem, direct, and inverted repeats and target-site duplications with configurable minimum repeat length, copy number, mismatch tolerance, and flanking window size. Found TSD pairs can be marked using colour highlighting, bold text, or lowercase residue styles, with an undo option.

**UPGMA Tree.** Constructed from pairwise identity distances. Outputs Newick format with branch lengths (downloadable as `.nwk`) and a text-based tree visualization.

**Snapshot system.** Saves and restores viewer states as JSON files: current alignment, colour assignments, search highlights, column and row selections, zoom level, conservation settings, and Full/Block view mode. Supports URL-based snapshot loading (`?snapshotFile=`). Canvas and Reads modes are not preserved in snapshots.

**BLAST search.** Right-clicking any sequence opens a BLAST dialog listing databases configured on the optional local server (`/api/blast-db`). Each database is served as a FASTA URL; a browser Web Worker performs Smith–Waterman search with IndexedDB caching so repeat queries against the same database are fast. When BLAST+ is installed on the server, `makeblastdb` indexing is supported for optional `blastn` acceleration. A "+ Manage Databases" button opens a modal for uploading new FASTA databases or deleting existing ones. Batch search against all databases is supported. BLAST requires the Node.js server and is not available on the static GitHub Pages deployment alone.

### 2.9 Export

Export options: FASTA (full alignment or selected sequences), MSF, RTF (Word-compatible with per-residue conservation shading, scale ruler, consensus line, monospace Courier New), and SVG (viewport or full alignment). The alignment can be opened in a standalone browser tab (Ctrl+T).

---

## 3. Discussion and Conclusion

ViewAlign addresses the gap between desktop alignment tools and modern browser-based bioinformatics workflows. By combining automatic format detection across nine input types, four view modes with Canvas viewport culling for large alignments, GeneDoc-style interactive editing with full undo history, browser-based MAFFT alignment via WebAssembly, coding-sequence analysis with 15 genetic codes, integrated BLAST search with local database management, and publication-quality export in a zero-installation package, it reduces the format-conversion and multi-tool switching that fragment current MSA workflows (Table 1).

The Canvas renderer's viewport-culling approach draws only visible residues per frame, matching strategies used by IGV.js (Robinson et al., 2011), while DOM-mode CSS containment (`contain: layout style`) delivers responsive interaction for alignments up to approximately 200 sequences × 5,000 columns in Full/Block modes. The 15 selectable genetic codes and frameshift detection extend the MACSE paradigm (Ranwez et al., 2011) to a browser environment. The GeneDoc-style residue editor (Nicholas et al., 1997), with Move NoGaps and Slide KeepGaps tools, and the RTF export with per-residue conservation shading bring desktop-quality editing and figure generation to the browser. The position-pattern clustering algorithm enables subfamily-level annotation entirely within the viewing environment, while the colour system — supporting manual, cluster-based, regex-pattern, and name-similarity assignment with history tracking — provides visualization granularity absent from most viewers.

Limitations include: (i) Canvas and Reads modes are view-optimized and do not support motif search, codon overlay, or clustering visual highlights; (ii) BLAST and BAM/CRAM loading require the optional Node.js server; (iii) GenBank import is flatfile-based, not live accession lookup; (iv) snapshots restore Full/Block settings only; (v) codon analysis is post-hoc on pre-aligned sequences and does not modify alignments to respect codon boundaries, unlike MACSE; (vi) the absence of protein-level analyses (BLOSUM-based dot plots, structural feature annotation), 3D structure linking, and deeper phylogenetic integration. The MAFFT WebAssembly module is compiled from MAFFT v7.525 source and inherits the algorithmic properties of that version. ViewAlign is freely available, runs without installation for core features, and includes a comprehensive 13-section manual.

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
| GenBank flatfile | ✓ | — | — | — | — | — |
| SAM/BAM | ✓ | — | — | — | — | ✓ |
| Auto-detection of format | ✓ | — | — | — | ✓ | ✓ |
| **View modes** | | | | | | |
| Full scrolling | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Fixed-width blocks | ✓ | ✓ | — | ✓ | — | — |
| Canvas (viewport-culled) | ✓ | — | — | — | — | ✓ |
| Read tracks (NGS) | ✓ | — | — | — | — | ✓ |
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
| Conservation frequency shading | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Residue colour schemes | ✓ | — | — | — | — | — |
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
| Dependencies | None (client); MAFFT WASM (client); BLAST+, samtools (server, optional) |

---

## Supplementary Information

- **manual.html**: 13-section comprehensive manual with sidebar navigation covering all features, input formats, keyboard shortcuts, credits and attribution, and workflows
- **Example datasets**: FASTA, MSF, Clustal, PHYLIP, NEXUS, SAM, and BAM test files
- **Server setup guide**: included in the repository README
- **Deployment guide**: deployment.md with step-by-step public server deployment instructions
- **Feature inventory**: Complete table of 20+ feature categories
