# Cover Letter

**To:** Editor-in-Chief, *Bioinformatics*
**Subject:** Application Note submission — ViewAlign

---

Dear Editor,

Please consider our manuscript "**ViewAlign: a browser-based platform for multiple sequence alignment visualization, editing, and analysis**" for publication as an Application Note in *Bioinformatics*.

**What ViewAlign is.** ViewAlign is a self-contained browser application for working with multiple sequence alignments. It combines format detection (8 formats including SAM and BAM/CRAM), five view modes (including GPU-composited Canvas rendering and IGV-style compact read packing), GeneDoc-style residue-level editing with full undo history, browser-based MAFFT alignment via WebAssembly, codon-aware analysis with 17 genetic codes, position-pattern-based sequence clustering, a flexible colour-labelling system, and publication-quality export (SVG, Word-compatible RTF with conservation shading) — all in a single page with zero installation, no dependencies, and no server requirement for core functionality.

**Why it is novel.** Existing MSA viewers are either desktop-native (Jalview, AliView, SeaView — requiring Java or platform-specific installation), browser-based but read-only (MSAViewer.js), or read-alignment-specific (IGV). No current tool provides the full editing-to-export workflow in a browser without installation. Key distinguishing features include:
- GeneDoc-style residue editing (Move NoGaps, Slide KeepGaps, type-to-edit) in a browser — a first
- Browser-based MAFFT via WebAssembly (no server, no alignment service dependency)
- Subfamily clustering with fuzzy merging and configurable quality thresholds — unique among MSA viewers
- IGV-style compact read-packing mode alongside traditional MSA views — bridging NGS and comparative genomics
- RTF export with per-residue conservation shading — directly usable in Word manuscripts
- 17 genetic code variants for codon analysis (MACSE-inspired), a residue case toggle, and an 8-format parser with automatic detection

**Why it matters.** The current MSA workflow typically requires 3–4 separate tools: a desktop viewer for inspection, a command-line aligner for realignment, a separate clustering script or phylogenetics package for subfamily analysis, and a figure editor for publication graphics. ViewAlign consolidates this into one browser tab with no installation barrier, making sophisticated MSA analysis accessible to researchers who lack computational infrastructure or who work across operating systems.

**Availability.** The application is freely accessible at https://toki-bio.github.io/MSA-viewer/, with source code (MIT license), a 13-section manual with sidebar navigation, and example data at https://github.com/Toki-bio/MSA-viewer. The client has no dependencies and runs in all modern browsers. An optional Node.js server enables BLAST, SSH remote access, and BAM/CRAM support.

We confirm that this manuscript has not been published elsewhere and is not under consideration by another journal. All authors have approved the manuscript and agree with its submission to *Bioinformatics*.

Sincerely,
[Author names]
[Institution]
[Email]
