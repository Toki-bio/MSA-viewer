# ViewAlign — Supplementary Material

*Supplementary material for the Bioinformatics Application Note
"ViewAlign: a browser-based platform for multiple sequence alignment
visualization, editing, and analysis".*

---

## Supplementary Table S1


**Supplementary Table S1.** Positioning of ViewAlign relative to representative multiple sequence alignment tools. Cells describe the documented mechanism by which each capability is delivered, rather than scoring presence or absence, because tools that nominally share a feature often differ in how directly it can be used.

| Dimension | ViewAlign | Integrated desktop toolkits (UGENE⁵, MEGA¹⁰) | Desktop viewer–editors (Jalview², AliView³, SeaView⁴) | Shading utilities (GeneDoc¹³, BoxShade) | Browser / read viewers (MSAViewer⁶, IGV⁷) |
|---|---|---|---|---|---|
| **Deployment** | Runs from a URL; no installation, runtime, or administrative privileges | Native application with a per-platform installer | Native application; Jalview and AliView require a Java runtime | GeneDoc is Windows-only and no longer actively developed; BoxShade is a command-line/web utility | MSAViewer is an embeddable JavaScript component, archived as unmaintained in 2022; IGV is a native application |
| **Input formats** | Nine, auto-detected: FASTA, MSF, Clustal, PHYLIP, NEXUS, Stockholm, GenBank flatfile, SAM, BAM/CRAM | UGENE: comparable breadth, including GenBank and SAM/BAM | Subsets: Jalview reads FASTA, MSF, Clustal, PIR and Stockholm but not PHYLIP or NEXUS; AliView and SeaView add PHYLIP and NEXUS | FASTA, MSF and related alignment formats | FASTA and Clustal (MSAViewer); SAM/BAM/CRAM (IGV) |
| **Alignment editing** | Residue-level editing, gap column insert/delete, GeneDoc-style Move NoGaps and Slide KeepGaps | UGENE: residue and subalignment editing | Full residue and gap editing | GeneDoc: residue edit mode and gap-column clearing | Display only |
| **Editing reversibility** | Undo/redo history shown as a labelled dropdown; clicking any entry returns to that state in one action | UGENE: undo/redo | Undo/redo (Jalview, AliView); not documented for SeaView | No Undo or Redo command appears in GeneDoc's application menus | Not applicable |
| **Realignment** | MAFFT v7.525 compiled to WebAssembly; realign a selected block in place, or append and realign, without leaving the page | UGENE bundles MUSCLE and KAlign; supports region realignment | Invoke a separate aligner program, bundled (SeaView: Clustal Omega, MUSCLE) or user-supplied (AliView: MUSCLE, MAFFT or any other), or a web service | GeneDoc: pairwise alignment only | None |
| **Conservation shading** | Three independent live sliders, each with its own colour picker; the alignment re-shades continuously as a slider is dragged, over a gap-inclusive or non-gap denominator | Highlighting computed relative to a chosen reference sequence | Jalview: one identity-threshold slider and one continuous conservation-intensity slider | GeneDoc: 2–4 levels chosen by radio button with Primary/Secondary/Tertiary percentage entry fields and per-level colour buttons, set in a configuration dialog; BoxShade: thresholds set before rendering | Fixed conservation display |
| **Figure export** | SVG (viewport or full alignment) and RTF carrying per-residue conservation shading into a word processor, from the same shaded view on screen | UGENE: BMP, JPG, PNG, SVG, TIFF, PDF, PS | Jalview: EPS, PNG, SVG, HTML; SeaView: SVG, PDF, PS; AliView: PNG | RTF preserving shading in Word, plus HTML, PICT, metafile and bitmap (GeneDoc); RTF, PDF, PNG (BoxShade) | PNG and SVG |
| **Coding-sequence analysis** | 15 NCBI genetic codes with stop codons, synonymous/non-synonymous classification computed from the alignment, frameshift marking and a translation track, all live in the alignment view | Genetic code selection and translation; MEGA computes selection statistics on sequence sets | SeaView colours by codon, flags stop codons and selects the genetic code; Jalview links cDNA and protein in a split view and classifies synonymous/missense variants imported from Ensembl or VCF | — | None |
| **Sequence colouring** | Manual, name-similarity (n-gram Jaccard), regex and cluster-derived assignment coexisting on one alignment; colour doubles as selection metadata for copy, group and sort; history inspector | User-defined residue colour schemes | Jalview: user-defined residue schemes, plus sequence ID colours derived from tree partitions | GeneDoc: manual shade mode, dragging over residues in a chosen colour | Predefined and user-defined residue schemes (MSAViewer) |
| **Subfamily analysis** | Clusters discovered from shared diagnostic positions, with the supporting positions reported per cluster | Tree-based grouping | Jalview: tree partitioning, PCA and PaSiMap — grouping by overall pairwise similarity | — | None |
| **Similarity search** | Browser Web Worker running Smith–Waterman with IndexedDB caching against user-registered databases; optional `blastn` acceleration via the server | UGENE: local BLAST+ and NCBI BLAST, with custom database construction | Web-service lookups (Jalview) | — | None |
| **Session sharing** | JSON or self-contained HTML snapshot, reopening from a URL query parameter | Project files | Jalview: `.jvp` project files, loadable from a URL | — | Configured in the embedding page |

**Sources:** ²Waterhouse et al. (2009), ³Larsson (2014), ⁴Gouy et al. (2010), ⁵Okonechnikov et al. (2012), ⁶Yachdav et al. (2016), ⁷Robinson et al. (2011), ¹⁰Kumar et al. (2018), ¹³Nicholas et al. (1997). BoxShade (Hofmann & Baron) has no formal publication. Entries describe capability documented in each tool's current documentation or, where available, its published source code (GeneDoc menu and dialog resources; AliView, MSAViewer and igv.js repositories), consulted 29 July 2026. A dash indicates the capability is not documented for that tool, not that it is known to be absent.

---

## Further supplementary material

| Item | Location |
|------|----------|
| User manual (13 sections, with full parameter ranges for the clustering, dot plot, and repeat/TSD tools) | `manual.html` |
| Feature inventory | `features-inventory.md` |
| Example datasets in each supported format | repository root |
| Server deployment guide | `deployment.md` |
| SSH remote-loading guide | `REMOTE_PUSH_TO_LOAD_GUIDE.md` |

All items are available at https://github.com/Toki-bio/MSA-viewer
