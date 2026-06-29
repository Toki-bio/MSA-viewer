# MSA Viewer: a browser-based platform for multiple sequence alignment visualization, editing, and analysis

## Target
**Bioinformatics (Oxford) — Application Note**
- 4 pages, ~2,600 words + 1–2 figures
- 13 references

---

## Summary

MSA Viewer is a browser-based platform for interactive visualization, editing, and analysis of multiple sequence alignments. It supports DNA, RNA, protein, and coding-sequence data across five interchangeable view modes, including a Canvas-based renderer with viewport culling that automatically activates for large alignments and an IGV-style compact read-packing mode for next-generation sequencing reads. Eight input formats are supported — FASTA, MSF, Clustal, PHYLIP, NEXUS, Stockholm, SAM, and BAM/CRAM — with automatic format detection. Built-in analysis tools include codon-aware frame detection with 17 selectable genetic codes, synonymous/non-synonymous mutation classification, dot-plot self-comparison with automatic region detection, tandem repeat and target-site duplication (TSD) finding, UPGMA tree reconstruction, and regular-expression motif search. Alignments can be edited through a GeneDoc-style residue editor, sorted by name, length, or similarity, and exported as publication-quality SVG vector graphics or Word-compatible RTF files with per-residue conservation shading. A recent-files history with localStorage persistence tracks opened files and clipboard pastes. An optional companion Node.js server provides MAFFT realignment, BLAST search, SSH remote file loading, and on-the-fly BAM-to-SAM conversion via samtools. The viewer runs entirely in modern web browsers with no installation required and is freely available at https://toki-bio.github.io/MSA-viewer/ under the MIT license.

**Availability:** https://toki-bio.github.io/MSA-viewer/ — source code, comprehensive manual, and example data at https://github.com/Toki-bio/MSA-viewer
**Contact:** [email]
**Supplementary information:** 9-section manual (manual.html), example alignments, server setup guide, and feature inventory table included in the repository.

---

## 1. Introduction

Multiple sequence alignment (MSA) is a foundational technique in computational biology, essential for phylogenetic inference, protein structure prediction, functional motif detection, and comparative genomics. While mature alignment construction tools exist — MAFFT (Katoh & Standley, 2013), Clustal Omega (Sievers et al., 2011), MUSCLE (Edgar, 2004) — the downstream viewing and editing of alignments remains fragmented across desktop applications that require platform-specific installation and lack modern web-based interactivity.

Desktop viewers such as Jalview (Waterhouse et al., 2009), AliView (Larsson, 2014), and SeaView (Gouy et al., 2010) provide rich feature sets but are tied to Java or native binaries. The browser-based MSAViewer (Yachdav et al., 2016) demonstrated the value of JavaScript-based MSA visualization, but its scope is limited to display with minimal editing or analysis functionality. IGV (Robinson et al., 2011) excels at read-level visualization but does not handle codon-level analysis or traditional MSA editing workflows. Furthermore, no existing tool accepts the full range of alignment formats (FASTA, MSF, Clustal, PHYLIP, NEXUS, Stockholm, SAM, BAM/CRAM) in a single interface, forcing users to convert between formats with external tools.

Here we present MSA Viewer, a self-contained browser application that bridges these gaps. It combines interactive editing, NGS read alignment viewing, coding-sequence analysis, and publication-quality export in a zero-installation package, with automatic format detection across eight input types and a Canvas rendering mode that scales to thousands of sequences.

---

## 2. Features and Implementation

### 2.1 Architecture

MSA Viewer is implemented as a single-page web application in vanilla JavaScript (~12,000 lines) with standard HTML and CSS. It has no framework dependencies, no build step, and no required installation — only a modern web browser is needed. The client runs on GitHub Pages for zero-configuration deployment. An optional Node.js Express server (`server.js`) provides backend services (MAFFT, BLAST, samtools) when additional compute resources are available. The server is not required for core functionality.

### 2.2 Data Loading and Format Support

Eight input formats are supported with automatic detection, eliminating the need for pre-conversion:

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

Alignments can be loaded through six mechanisms: text paste, drag-and-drop, file picker, URL fetch, SSH remote loading (via the server), or GenBank accession lookup with automatic alignment. A recent-files history panel stores metadata and full text (up to 100 KB per entry) in localStorage, allowing users to reload previous files and clipboard pastes across browser sessions.

The SAM parser expands all eleven CIGAR operations (M, I, D, S, H, N, P, =, X) into gapped alignments against a pileup consensus reference built from all mapped reads. Secondary, supplementary, and unmapped reads are filtered. The Clustal, PHYLIP, NEXUS, and Stockholm parsers handle both sequential and interleaved alignment layouts.

### 2.3 View Modes

Five interchangeable view modes serve different analytical needs, with automatic mode selection for large datasets:

- **Full mode**: continuous scrolling alignment optimized for browsing and editing.
- **Block mode**: fixed-width blocks (configurable 20–100 columns) with repeating sequence labels, designed for publication-quality inspection.
- **Canvas mode**: a GPU-composited 2D canvas renderer that draws only the visible viewport, eliminating per-residue DOM nodes. This mode activates automatically when the alignment exceeds 150,000 total residues (~100 sequences × 1,500 columns), with an explanatory toast message and the option to switch back to DOM modes for editing. Navigation is via mouse wheel or click-drag panning. Conservation shading is fully supported.
- **Compact mode**: SVG-based read-packing tracks inspired by IGV. A coverage histogram is displayed at the top; reads are rendered as bars with mismatch positions marked in red. Optional controls include "Diffs only" (reads reduced to 4-pixel hairlines showing only mismatches) and "Pairs" (dashed lines connecting paired-end reads detected from SAM flags, with mate-pair position from column 8 of the SAM record).
- **Variable sites only** and **Highlight Diffs**: cross-mode overlays. Variable sites mode hides fully-conserved columns, collapsing the alignment to only informative positions. Highlight Diffs dims conserved columns to 25% opacity. Both compute the conserved-column set once per render and apply CSS or Canvas fill styling.

The viewer supports conservation shading (Identity, Similarity, Clustal, Zappo), nucleotide colour schemes (Default, Taylor, Nucleobase), customizable threshold controls for highlight intensity, an adjustable consensus line, variable zoom (50%–500%), sticky sequence name columns, and a snapshot system for saving and restoring complete viewer states including colour assignments, search highlights, and column selections.

### 2.4 Sequence Management and Editing

Rows can be selected (Ctrl+Click), duplicated, deleted, reverse-complemented, and reordered by drag-and-drop or keyboard shortcuts. Three sort operations are available: alphabetical by name, by gapless sequence length (descending), and by pairwise similarity to the first sequence. An undo/redo stack tracks all edit operations.

Alignment editing follows the GeneDoc paradigm. In Edit Mode, users can type individual residues, insert or delete gap columns, and select column ranges. A full-sequence text editor (SeqEdit) provides bulk operations: degap, reverse, complement, reverse-complement, uppercase, and lowercase conversion. New sequences can be appended with automatic gap-padding, or realigned against the existing alignment via MAFFT in add-keep-length mode.

### 2.5 Codon-Aware Analysis

Inspired by MACSE (Ranwez et al., 2011), MSA Viewer provides codon-aware visualization for protein-coding sequence alignments. When activated on a nucleotide alignment whose length is a multiple of three, the tool colour-codes each nucleotide by codon position (blue for first, green for second, orange for third), highlights in-frame stop codons (TAA, TAG, TGA) with red backgrounds, marks frameshift-inducing indels with wavy red underlines, and classifies each substitution as synonymous (green underline) or non-synonymous (double red underline) relative to a reference sequence. A translated amino acid track is displayed below each nucleotide sequence, with stop codons shown in bold red.

A dropdown selector supports 17 genetic code variants (NCBI translation tables 1–6, 9–14, 16, 21, 22), covering standard, vertebrate mitochondrial, invertebrate mitochondrial, ciliate nuclear, euplotid, ascidian mitochondrial, and other alternative codes. All downstream analyses — stop codon detection, mutation classification, and amino acid translation — respect the selected code.

### 2.6 Additional Analysis Tools

**Dot plot.** The dot-plot module performs self-comparison or pairwise comparison of the alignment with adjustable sliding window size (1–61) and identity threshold (0–100%). A context-radius control reveals flanking nucleotides on hover, shown alongside the aligned sequence pair with mismatch highlighting. An automatic region detector identifies the top 30 diagonal runs and presents them in a navigable sidebar; clicking any region scrolls the alignment to the corresponding position. Plots can be exported as publication-quality PNG or SVG.

**Motif search.** A search bar supports exact motif matching with configurable mismatches, reverse-complement search, and regular-expression mode. Regex patterns (e.g., `[AG]CGT`, `ATG.{3}TAA`) are evaluated against degapped sequences, with all matches highlighted in the user-selected colour. Invalid regex patterns produce a user-friendly error message.

**Repeat and TSD Finder.** Scans the alignment for tandem repeats and target-site duplications with configurable minimum repeat length, copy number, mismatch tolerance, and flanking window size. Found TSD pairs can be marked in the alignment using colour highlighting, bold text, or lowercase residue styles.

**UPGMA Tree.** A guide tree is constructed from pairwise identity distances, outputting a Newick-format string with branch lengths (downloadable as `.nwk`) and a text-based tree visualization.

### 2.7 Export and History

Export options include FASTA (full alignment or selected sequences), MSF, RTF (Word-compatible with per-residue conservation shading, scale ruler, and consensus line using monospace Courier New), and SVG (current viewport or complete alignment). A recent-files panel accessible from the input area provides localStorage-persisted history of opened files and clipboard pastes with metadata (sequence count, column count, timestamp) and one-click reload. The history size is user-adjustable (1–50 entries).

---

## 3. Usage Example

A typical workflow for analyzing a coding-sequence alignment:

1. Load a FASTA, Clustal, or PHYLIP alignment of orthologous CDS sequences — format is auto-detected.  
2. The viewer automatically selects Canvas mode if the alignment exceeds 150,000 residues, or stays in Block mode for smaller datasets.  
3. Enable **Highlight Diffs** to visually isolate variable positions, or **Var Sites Only** to collapse conserved columns entirely.  
4. Activate **Codon Analysis** and select the appropriate genetic code for the organism.  
5. Scan for premature stop codons (red highlight) and frameshifts (wavy red underline).  
6. Examine clusters of non-synonymous mutations (double red underline) for candidate sites under positive selection.  
7. Use regex search (`[AG]CGT.*TAA`) to locate specific motifs across all sequences.  
8. Sort sequences by similarity to identify outlier accessions.  
9. Export the annotated view as RTF for supplementary material or as SVG for a publication figure.  
10. Open the **Dot Plot** to identify large-scale duplications or recombination signals, and build a UPGMA tree to confirm phylogenetic relationships.

For NGS read alignments, a SAM or BAM file is loaded directly — the viewer auto-detects SAM format, builds a pileup consensus, and displays reads in Compact mode with coverage histogram, mismatch marks, and paired-end connections.

---

## 4. Discussion and Conclusion

MSA Viewer addresses the gap between desktop alignment tools and modern web-based bioinformatics workflows. By combining automatic format detection across eight input types, a Canvas rendering mode with auto-activation thresholds, interactive editing, NGS read visualization, coding-sequence analysis, and publication-quality export in a zero-installation browser application, it eliminates the format-conversion and installation barriers that fragment current MSA workflows.

The Canvas renderer's viewport-culling approach matches the rendering strategy used by MSAViewer (Yachdav et al., 2016) and IGV.js (Robinson et al., 2011), while the DOM-based Full and Block modes remain available for smaller alignments where interactive editing is needed. CSS optimizations — `content-visibility: auto`, `contain: layout style`, and GPU-composited scrolling — deliver responsive interaction for alignments up to approximately 200 sequences × 5,000 columns (~1 million residues) without switching to Canvas mode.

The tool's primary limitation is the lack of protein-level analyses (BLOSUM-based dot plots, structural feature annotation) and deeper phylogenetic integration with external tree viewers. A WebAssembly-based MAFFT module is planned to eliminate the server dependency for realignment operations entirely.

MSA Viewer is freely available, runs without installation, and includes a comprehensive 9-section manual covering all features, formats, and workflows.

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
- **Example datasets**: FASTA, MSF, Clustal, PHYLIP, NEXUS, and SAM test files for demonstration
- **Server setup guide**: included in the repository README
- **Deployment guide**: DEPLOYMENT.md with step-by-step instructions for public server deployment
- **Feature inventory**: Complete table of 17+ feature categories
