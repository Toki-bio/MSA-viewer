# MSA Viewer: a browser-based platform for multiple sequence alignment visualization, editing, and analysis

## Target
**Bioinformatics (Oxford) — Application Note**
- 4 pages, ~2,600 words + 1–2 figures
- 10–15 references

---

## Summary

MSA Viewer is a browser-based platform for interactive visualization, editing, and analysis of multiple sequence alignments. It supports DNA, RNA, protein, and coding-sequence data across five interchangeable view modes, including a Canvas-based renderer with viewport culling for large alignments and an IGV-style compact read-packing mode for next-generation sequencing reads. Built-in analysis tools include codon-aware frame detection with 17 selectable genetic codes, synonymous/non-synonymous mutation classification, dot-plot self-comparison with automatic region detection, tandem repeat and target-site duplication finding, and UPGMA tree reconstruction. Alignments can be edited through a GeneDoc-style residue editor and exported as publication-quality SVG vector graphics or Word-compatible RTF files with per-residue conservation shading. An optional companion Node.js server provides MAFFT realignment, BLAST search, SSH remote file loading, and on-the-fly BAM-to-SAM conversion via samtools. The viewer runs entirely in modern web browsers with no installation required and is freely available at https://toki-bio.github.io/MSA-viewer/ under the MIT license.

**Availability:** https://toki-bio.github.io/MSA-viewer/ — source code, manual, and example data at https://github.com/Toki-bio/MSA-viewer
**Contact:** [email]
**Supplementary information:** Comprehensive manual (manual.html), example alignments, and server setup guide included in the repository.

---

## 1. Introduction

Multiple sequence alignment (MSA) is a foundational technique in computational biology, essential for phylogenetic inference, protein structure prediction, functional motif detection, and comparative genomics. While mature alignment construction tools exist — MAFFT (Katoh & Standley, 2013), Clustal Omega (Sievers et al., 2011), MUSCLE (Edgar, 2004) — the downstream viewing and editing of alignments remains fragmented across desktop applications that require platform-specific installation and lack modern web-based interactivity.

Desktop viewers such as Jalview (Waterhouse et al., 2009), AliView (Larsson, 2014), and SeaView (Gouy et al., 2010) provide rich feature sets but are tied to Java or native binaries and cannot easily integrate with web-based workflows or NGS pipelines. The browser-based MSAViewer (Yachdav et al., 2016) demonstrated the value of JavaScript-based MSA visualization, but its scope is limited to display with minimal editing or analysis functionality. Meanwhile, tools like IGV (Robinson et al., 2011) excel at read-level visualization but do not handle codon-level analysis or traditional MSA editing workflows. No existing tool combines interactive MSA editing, NGS read alignment viewing, coding-sequence analysis, and publication-quality export in a single browser-based platform.

Here we present MSA Viewer, a self-contained browser application that bridges these gaps. It provides four interchangeable view modes, GeneDoc-style interactive editing, MACSE-inspired codon analysis with 17 selectable genetic codes, and an IGV-style compact read-packing mode for SAM alignments — all running client-side without installation. An optional local server extends functionality with MAFFT realignment, BLAST search, and remote file access via SSH.

---

## 2. Features and Implementation

### 2.1 Architecture

MSA Viewer is implemented as a single-page web application in vanilla JavaScript (~10,500 lines) with standard HTML and CSS. It has no framework dependencies, no build step, and no required installation — only a modern web browser is needed. The client runs on GitHub Pages for zero-configuration deployment. An optional Node.js Express server (`server.js`) provides backend services (MAFFT, BLAST, samtools) when additional compute resources are available locally. The server is not required for core viewing and editing functionality.

### 2.2 Data Loading and Format Support

Alignments can be loaded through six mechanisms: text paste, drag-and-drop, file picker, URL fetch, SSH remote loading (via the server), or GenBank accession lookup with automatic alignment. Supported input formats include FASTA (interleaved or sequential), GCG Multiple Sequence Format (MSF), and SAM. BAM and CRAM files are supported through a server-side `samtools view` pipeline that converts them to SAM for client-side parsing.

The SAM parser auto-detects the format by checking for `@HD` or `@SQ` header lines, or tab-separated alignment records with CIGAR strings. All eleven CIGAR operations (M, I, D, S, H, N, P, =, X) are expanded into gapped alignments against a pileup consensus reference built from all mapped reads. Secondary, supplementary, and unmapped reads are filtered. The resulting alignment renders identically to FASTA-derived data in all view modes.

### 2.3 View Modes

Four interchangeable view modes serve different analytical needs:

- **Single mode**: continuous scrolling alignment optimized for browsing and editing alignments of typical size.
- **Block mode**: fixed-width blocks (configurable 20–100 columns) with repeating sequence labels, designed for publication-quality inspection and figure preparation.
- **Canvas mode**: a GPU-composited 2D canvas renderer that draws only the visible viewport, eliminating per-residue DOM nodes. This mode handles alignments of thousands of sequences and tens of thousands of columns with responsive scrolling, addressing the fundamental limitation of DOM-based MSA rendering. Navigation is via mouse wheel or click-drag panning.
- **Compact mode**: SVG-based read-packing tracks inspired by IGV. A coverage histogram is displayed at the top, with reads rendered as bars and mismatch positions marked in red. A greedy track-assignment algorithm packs hundreds or thousands of reads into minimal vertical space.
- **Highlight Diffs**: a cross-mode overlay that dims fully-conserved columns to 25% opacity (CSS in DOM modes, lighter fill in Canvas mode), drawing attention to variable sites.

The viewer supports conservation shading (Identity, Similarity, Clustal, Zappo), nucleotide colour schemes (Default, Taylor, Nucleobase), customizable threshold controls for highlight intensity, an adjustable consensus line with configurable threshold and minimum coverage, variable zoom (50%–500%), sticky sequence name columns, and a snapshot system for saving and restoring complete viewer states.

### 2.4 Interactive Editing

Alignment editing follows the GeneDoc paradigm. In Edit Mode, users can type individual residues, insert or delete gap columns, and select column ranges by clicking or dragging. A full-sequence text editor (SeqEdit) provides bulk operations: degap, reverse, complement, reverse-complement, uppercase, and lowercase conversion. Rows can be selected (Ctrl+Click), duplicated, deleted, reverse-complemented, and reordered by drag-and-drop or keyboard shortcuts. New sequences can be appended with automatic gap-padding, or realigned against the existing alignment via MAFFT in add-keep-length mode. All editing operations are tracked in a full undo/redo history.

### 2.5 Codon-Aware Analysis

Inspired by MACSE (Ranwez et al., 2011), MSA Viewer provides codon-aware visualization for protein-coding sequence alignments. When activated on a nucleotide alignment whose length is a multiple of three, the tool:

- Colour-codes each nucleotide by codon position (blue for first, green for second, orange for third);  
- Highlights in-frame stop codons (TAA, TAG, TGA) with red backgrounds and bold white text;  
- Marks frameshift-inducing indels with wavy red underlines;  
- Classifies each substitution relative to a reference sequence as synonymous (green underline) or non-synonymous (double red underline);  
- Displays a translated amino acid track below each nucleotide sequence, with stop codons shown in bold red.

A dropdown selector supports 17 genetic code variants (NCBI translation tables 1–6, 9–14, 16, 21, 22), covering standard, vertebrate mitochondrial, invertebrate mitochondrial, ciliate nuclear, euplotid, ascidian mitochondrial, and other alternative codes. All downstream analyses — stop codon detection, mutation classification, and amino acid translation — respect the selected code.

### 2.6 Additional Analysis Tools

**Dot plot.** The dot-plot module performs self-comparison or pairwise comparison of the alignment with adjustable sliding window size (1–61) and identity threshold (0–100%). A context-radius control reveals flanking nucleotides on hover, shown alongside the aligned sequence pair with mismatch highlighting. An automatic region detector identifies the top 30 diagonal runs and presents them in a navigable sidebar — clicking any region scrolls the alignment to the corresponding position. Plots can be exported as publication-quality PNG or SVG.

**Repeat and TSD Finder.** A dedicated analysis modal scans the alignment for tandem repeats and target-site duplications with configurable minimum repeat length, copy number, mismatch tolerance, and flanking window size. Found TSD pairs can be marked directly in the alignment using colour highlighting, bold text, or lowercase residue styles. This functionality is particularly useful for transposable element annotation.

**UPGMA Tree.** A guide tree can be constructed from pairwise identity distances (fraction of identical non-gap positions). The output includes a Newick-format string with branch lengths, downloadable as a `.nwk` file, and a text-based tree visualization.

### 2.7 Export

Export options cover multiple downstream needs: FASTA (full alignment or selected sequences), MSF (with GCG header), RTF (Word-compatible with per-residue conservation shading, a scale ruler showing column numbers every ten positions, and a consensus line), and SVG (current viewport or complete alignment as vector graphics). A complete table of all features is provided in the supplementary manual.

---

## 3. Usage Example

A typical workflow for analyzing a coding-sequence alignment:

1. Load a FASTA alignment of orthologous CDS sequences by pasting or drag-and-drop.  
2. Switch to Block mode with Clustal shading for initial inspection.  
3. Enable Highlight Diffs to visually isolate variable positions.  
4. Activate Codon Analysis and select the appropriate genetic code for the organism.  
5. Scan for premature stop codons (red highlight) and frameshifts (wavy red underline) — these indicate potential sequencing errors, pseudogenes, or annotation issues.  
6. Examine clusters of non-synonymous mutations (double red underline) for candidate sites under positive selection.  
7. Export the annotated view as RTF for supplementary material, or as SVG for a publication figure.  
8. Open the Dot Plot to identify large-scale duplications, inversions (using reverse-complement mode), or recombination signals.  
9. Use the Repeat Finder to detect transposable element boundaries through TSD detection.  
10. Build a UPGMA tree to confirm expected phylogenetic relationships among the sequences.

For NGS read alignments, a SAM file can be loaded directly — the viewer auto-detects the format, builds a pileup consensus, and displays reads in Compact mode with coverage histogram, mismatch marks, and optional paired-end connections.

---

## 4. Discussion and Conclusion

MSA Viewer addresses the gap between desktop alignment tools and modern web-based bioinformatics workflows. By providing interactive editing, NGS read visualization, coding-sequence analysis, and publication-quality export in a zero-installation browser application, it lowers the barrier to entry for alignment inspection while supporting advanced analytical workflows. The modular architecture — purely client-side by default with an optional server for MAFFT, BLAST, and SSH — makes it suitable for both quick ad-hoc alignment viewing and integrated bioinformatics pipelines.

### 4.1 Performance Considerations

MSA Viewer provides two rendering paths. The default DOM-based renderer (Single and Block modes) builds one HTML span per residue position and uses CSS optimizations — `content-visibility: auto` on sequence rows, `contain: layout style` on data regions, and GPU-composited scrolling — to deliver responsive interaction for alignments up to approximately 200 sequences × 5,000 columns (~1 million residues) on modern hardware. For larger alignments, the Canvas mode renders the alignment on a 2D canvas with viewport culling, drawing only the visible rows and columns on each frame. This eliminates the per-residue DOM overhead entirely and scales to thousands of sequences and tens of thousands of columns with responsive scroll performance, matching the approach used by MSAViewer (Yachdav et al., 2016) and IGV.js (Robinson et al., 2011).

### 4.2 Future Directions

Planned enhancements include protein-level dot plot analysis with BLOSUM substitution matrices, structural feature annotation tracks, deeper phylogenetic integration with external tree viewers, and a WebAssembly-based MAFFT module that would eliminate the server dependency for realignment operations entirely.

---

## References

1. Katoh, K. & Standley, D.M. (2013) MAFFT multiple sequence alignment software version 7: improvements in performance and usability. *Mol. Biol. Evol.*, 30, 772–780.
2. Sievers, F. et al. (2011) Fast, scalable generation of high-quality protein multiple sequence alignments using Clustal Omega. *Mol. Syst. Biol.*, 7, 539.
3. Edgar, R.C. (2004) MUSCLE: multiple sequence alignment with high accuracy and high throughput. *Nucleic Acids Res.*, 32, 1792–1797.
4. Waterhouse, A.M. et al. (2009) Jalview Version 2—a multiple sequence alignment editor and analysis workbench. *Bioinformatics*, 25, 1189–1191.
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

- **manual.html**: 9-section comprehensive manual (625 lines) covering all features, formats, keyboard shortcuts, and workflows  
- **Example datasets**: FASTA, MSF, and SAM test files for demonstration  
- **Server setup guide**: included in the repository README  
- **Feature inventory**: Complete table of 15+ feature categories with descriptions
