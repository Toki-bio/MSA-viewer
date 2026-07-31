# Cover Letter

**To:** Editor-in-Chief, *Bioinformatics*
**Subject:** Application Note submission — ViewAlign

---

Dear Editor,

Please consider our manuscript "**ViewAlign: a browser-based platform for multiple sequence alignment visualization, editing, and analysis**" for publication as an Application Note in *Bioinformatics*.

**What ViewAlign is.** ViewAlign is a self-contained browser application for working with multiple sequence alignments. It combines format detection (nine formats including GenBank flatfile, SAM, and BAM/CRAM), four view modes (Full, Block, Canvas with viewport culling, and Reads for mapped NGS data), GeneDoc-style residue-level editing with full undo history, browser-based MAFFT alignment via WebAssembly, codon-aware analysis with 15 NCBI genetic codes, position-pattern-based sequence clustering, a flexible colour-labelling system, and publication-quality export (SVG, Word-compatible RTF with conservation shading) — all in a single page with zero installation, no dependencies, and no server requirement for core functionality.

**Why it is novel.** Existing MSA tools fall into three groups: installed desktop applications (Jalview, AliView, SeaView, and integrated toolkits such as UGENE and MEGA), browser-based but read-only viewers (MSAViewer.js), and read-alignment browsers (IGV). We are explicit in the manuscript that UGENE in particular matches ViewAlign on format breadth and on several analyses; our claim is not that ViewAlign has more features than every desktop toolkit, but that this analytical range has not previously been available without installation. No current tool provides the full editing-to-export workflow in a browser. Key distinguishing features include:
- GeneDoc-style residue editing (Move NoGaps, Slide KeepGaps, type-to-edit) in a browser, with no installation step
- Browser-based MAFFT via WebAssembly (no server, no alignment service dependency)
- Subfamily clustering by shared diagnostic positions, with fuzzy merging and configurable quality thresholds. Other viewers support subfamily analysis by overall similarity (Jalview via tree partitioning, PCA and PaSiMap); grouping by diagnostic residues, and reporting those residues, is to our knowledge not otherwise available
- Synonymous/non-synonymous classification and frameshift detection shown directly in the alignment view, with 15 NCBI genetic codes (MACSE-inspired)
- GeneDoc's multi-tier conservation shading and RTF-into-Word figure export, reimplemented in a browser — the original tool is Windows-only and no longer maintained
- IGV-style Reads mode for mapped BAM/SAM data alongside traditional MSA views, in the same browser tab
- A nine-format parser with automatic detection, including GenBank flatfile and SAM/BAM, running entirely client-side

**Why it matters.** Consolidated MSA workstations exist, but all of them must be installed. For researchers on managed or shared machines, for classroom teaching, and for the common case of inspecting an alignment a collaborator has just sent, installation is the step that does not happen — and the workflow fragments back into a desktop viewer for inspection, a command-line aligner for realignment, a separate script for subfamily analysis, and a figure editor for graphics. ViewAlign delivers that consolidated workflow from a URL, making the analysis accessible to researchers who lack computational infrastructure, lack administrative privileges, or work across operating systems.

**Availability.** The application is freely accessible at https://toki-bio.github.io/MSA-viewer/, with source code (MIT license), a 13-section manual with sidebar navigation, and example data at https://github.com/Toki-bio/MSA-viewer. The client has no dependencies and runs in all modern browsers. An optional Node.js server enables local BLAST database hosting (browser Web Worker search with IndexedDB caching), SSH remote access, and BAM/CRAM support.

We confirm that this manuscript has not been published elsewhere and is not under consideration by another journal. All authors have approved the manuscript and agree with its submission to *Bioinformatics*.

Sincerely,
[Author names]
[Institution]
[Email]
