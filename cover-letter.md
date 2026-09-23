# Cover Letter

**To:** Editor-in-Chief, *Bioinformatics*
**Subject:** Application Note submission — ViewAlign

---

Dear Editor,

Please consider our manuscript "**ViewAlign: a browser-based platform for multiple sequence alignment visualisation, editing, and analysis**" for publication as an Application Note in *Bioinformatics*.

**What ViewAlign is.** ViewAlign brings together, on one alignment, the operations our own sequence comparisons kept needing at the same time: reading the file, editing and realigning it, inspecting codons, grouping sequences into subfamilies, searching for motifs, and producing a shaded figure. Each of these stays adjustable while the others are in view — a shading threshold, a colour, a genetic code or a grouping rule is changed by looking at the result rather than chosen in advance. ViewAlign runs in the browser, so this workspace is reached from a URL without installation.

**What it offers.** Nine input formats are recognised from content (FASTA, MSF, Clustal, PHYLIP, NEXUS, Stockholm, GenBank, SAM, BAM/CRAM), and GenBank records can be fetched by accession. Four view modes include a read view for SAM, BAM and CRAM, all decoded in the browser. The note describes in particular:
- conservation shading with three independently coloured, live thresholds over a gap-inclusive or non-gap denominator;
- a configurable consensus that can be inserted, substituted for a selection, or used as a profile to add new sequences without disturbing existing columns;
- residue-level editing with a labelled undo history, and realignment of a selected block by MAFFT compiled to WebAssembly;
- codon-aware display with 15 NCBI genetic codes, classifying substitutions from the alignment itself;
- subfamily clustering by shared diagnostic positions, reporting the positions that support each group — to our knowledge not otherwise available in an alignment viewer;
- figure export as SVG and as Word-compatible RTF that carries the shading.

**How it relates to existing tools.** The manuscript is explicit that the individual capabilities have precedents — GeneDoc for tiered shading and RTF export, MACSE for coding alignments, character-based DNA barcoding for diagnostic positions — and that UGENE and MEGA offer broader or deeper functionality in several areas. Our contribution is how these operations are combined on one alignment and how directly they can be adjusted; Supplementary Table S1 compares the mechanisms tool by tool.

**Availability and testing.** The application is freely accessible at https://toki-bio.github.io/MSA-viewer/, with source code (MIT licence), a 13-section manual, and example data at https://github.com/Toki-bio/MSA-viewer. The examples include one alignment in every supported format, format edge cases, and files written by other programs and databases with the results an independent parser gives; the viewer reads all of them as expected in Chrome, Edge, Firefox and WebKit. An optional Node.js server adds local BLAST database hosting and SSH file access.

We confirm that this manuscript has not been published elsewhere and is not under consideration by another journal. All authors have approved the manuscript and agree with its submission to *Bioinformatics*.

Sincerely,
[Author names]
[Institution]
[Email]
