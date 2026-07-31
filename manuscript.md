# ViewAlign: a browser-based platform for multiple sequence alignment visualization, editing, and analysis

> **Revision note (v132, 2026-07-29) — DELETE THIS BLOCK BEFORE SUBMISSION.**
> Round 1: draft aligned with the current viewer (`script.js` v132) — view-mode naming, nine input formats, conservation vs residue colour schemes, browser-based BLAST worker, Canvas description, snapshot/shortcut caveats.
> Round 2 (post-audit): removed unsubstantiated test-count and benchmark claims; corrected zoom (200%), block width (40–300), CIGAR ops (nine), Highlight-diffs opacity (40%), clustering parameters (2–20, 80/70/60, retry-based cap relaxation), TSD parameters, and module line count (~18,000). Removed MSF from export list. Cited refs 10–12/14 and added Camacho (BLAST+) as ref 15. Summary cut to ~145 words. Limitations extended (name colouring, protein-analysis asymmetry, DOM size ceiling).
> Round 3: Table 1 converted from a 50-row ✓/— matrix to an 11-row descriptive table across four tool groups, after verification showed the binary form both flattened depth differences (sequence colouring) and carried more absence claims than could be substantiated. Introduction and Discussion reframed around delivery rather than feature count, conceding UGENE explicitly. Jalview's subfamily analysis, sequence ID colouring, column hiding by annotation, and `.jvp`-from-URL acknowledged.
> Round 4: comparison table moved to Supplementary Table S1 (`supplementary.md`); Section 2 compressed 1,884 to 1,411 words with parameter ranges devolved to the manual; Introduction and Discussion compressed to remove duplicated prior-art argument; Target corrected against OUP guidelines (4 pages, ~2,600 words).
> Round 5: Summary rebuilt around shading, consensus, and multi-motif search; dropped Canvas threshold, read tracks, genetic-code count, and the GeneDoc-style framing. Trees corrected to UPGMA and NJ with distance models (ref 18 added). Reads mode reframed to its actual case (one long sequence vs many short overlapping ones). Internal class name removed from Section 2.8. Discussion: UGENE concession corrected after checking its conservation highlighting (single threshold, fixed colours) and row grouping (identical rows only); GeneDoc reduced to one mention.

## Target
**Bioinformatics (Oxford) — Application Note**
- Journal limit: **4 pages maximum ≈ 2,600 words** (per OUP author guidelines)
- No in-text figure or table; the comparison table is Supplementary Table S1, so the full budget is available to the text
- Supplementary material is referred to in the Summary, as the Application Note format requires
- 18 references

---

## Summary

Multiple sequence alignment viewing, editing, and downstream analysis are typically split across several desktop tools, each requiring installation. ViewAlign consolidates this workflow in the browser, with no installation. Nine formats are detected from content and read directly. Conservation shading uses three independent live thresholds, each with its own colour, over a selectable gap-inclusive or non-gap denominator, so a cutoff that exposes a motif is found by dragging rather than by repeated dialog entry. The consensus is configurable rather than fixed: separate coverage and plurality gates, selectable ambiguity output and sub-threshold fallback, and a result that can be inserted, substituted for a selection, or used as a profile against which new sequences are aligned without disturbing existing columns. Multiple motif searches coexist on one alignment, each in its own colour, individually clearable and preserved in saved sessions, with mismatch tolerance, both-strand and regular-expression matching. Sequences group into subfamilies by shared diagnostic positions, and each group collapses to a single consensus row. Alignments are edited residue-by-residue with full undo history and realigned in the browser by a WebAssembly build of MAFFT; figures export as SVG or as Word-compatible RTF carrying the shading.

**Availability and implementation:** Freely available at https://toki-bio.github.io/MSA-viewer/ under the MIT license; source code and a 13-section manual at https://github.com/Toki-bio/MSA-viewer. An optional Node.js server adds BLAST database hosting, SSH file access, and samtools BAM/CRAM conversion.

**Supplementary information:** Supplementary Table S1 (comparison with existing tools), a 13-section user manual, full parameter ranges for the clustering, dot plot, and repeat/TSD tools, example datasets in each supported format, and a deployment guide are available at the repository.

**Contact:** [email]

---

## 1. Introduction

Multiple sequence alignment (MSA) is foundational to phylogenetic inference, motif detection, and comparative genomics. Mature construction tools exist — MAFFT (Katoh & Standley, 2013), Clustal Omega (Sievers et al., 2011), MUSCLE (Edgar, 2004) — but the downstream viewing and editing of alignments remains fragmented across desktop applications requiring platform-specific installation.

Desktop viewers such as Jalview (Waterhouse et al., 2009), AliView (Larsson, 2014), and SeaView (Gouy et al., 2010) are rich but tied to Java or native binaries, and each reads only a subset of the common formats. Integrated toolkits go further: UGENE (Okonechnikov et al., 2012) combines broad format support, editing, translation, dot plots, repeat and restriction-site search, tree building, and BLAST in one application, and MEGA (Kumar et al., 2018) couples editing to phylogenetic inference — but both must be installed. In the browser, MSAViewer (Yachdav et al., 2016) demonstrated JavaScript MSA visualization without interactive editing, and its reference implementation has been unmaintained since 2022; IGV (Robinson et al., 2011) excels at read-level visualization but offers neither codon analysis nor MSA editing (Supplementary Table S1). The gap is therefore not feature count but delivery: the analytical breadth of an installed toolkit has not previously been available without installation.

We present ViewAlign, a self-contained browser application that closes this gap, combining automatic format detection, interactive editing, NGS read viewing, coding-sequence analysis, and publication-quality export with no framework dependencies. The individual capabilities are not unprecedented. Multi-tier conservation shading and shading-preserving RTF export originate with GeneDoc (Nicholas et al., 1997) and BoxShade; frameshift-aware treatment of coding alignments with MACSE (Ranwez et al., 2011); Jalview classifies synonymous and missense variants imported from Ensembl or VCF; and character-based diagnosis of groups by shared nucleotide positions is established in DNA barcoding (Sarkar et al., 2008; Fedosov et al., 2022). The contribution is the combination, delivered without installation, together with the way inherited capabilities are operated (Section 3).

---

## 2. Features and Implementation

### 2.1 Architecture

ViewAlign is a single-page application in vanilla JavaScript (~18,000 lines across six client modules), with no framework, build step, or installation. The client is served statically; an optional Node.js Express server adds a BLAST database registry, SSH file fetch, BAM/CRAM conversion via samtools (Li et al., 2009), and server-side MAFFT, and is required for none of viewing, editing, in-browser MAFFT, or export. The MAFFT module was compiled from v7.525 source (Katoh & Standley, 2013) with Emscripten, producing a 340 KB WebAssembly binary.

### 2.2 Data Loading and Format Support

Nine formats are recognised from content rather than from file extension: FASTA, MSF, Clustal, PHYLIP, NEXUS, Stockholm, GenBank flatfile, SAM, and BAM/CRAM. Alignments load by paste, drag-and-drop, file picker, URL fetch, or SSH (server). GenBank records are read from flatfiles, not fetched by accession. The Clustal, PHYLIP, NEXUS, and Stockholm parsers accept both sequential and interleaved layouts. SAM support is purpose-built for the read view of Section 2.3 rather than general: primary mapped records are retained and their CIGAR strings expanded, and the reference row is a majority-base pileup derived from the reads themselves, so no external reference file is needed; base qualities and multi-reference files are not handled. BAM and CRAM are converted by samtools on the optional server. A recent-files panel retains text in localStorage for reload across browser sessions.

### 2.3 View Modes

Four view modes are available. **Full** scrolls continuously for browsing and editing. **Block** wraps the alignment into blocks of a set width — 40 to 300 columns, or fitted automatically to the window as it is resized — with the sequence names repeated above each block, for figure work. **Canvas** is a 2D renderer with viewport culling that draws only the visible cells, and activates itself above 150,000 residues with a message advising a return to Full or Block for editing, so rendering performance is never a setting the user has to maintain. **Reads** addresses a narrower case: comparing one long sequence against many short, partly overlapping ones. Reads from SAM or BAM are laid out against the long sequence as a reference, with a scale ruler and mismatch highlighting, so partial-coverage evidence for a single locus can be inspected in the same tool as the alignment it informs. Two overlays help isolate variation in Full and Block: one hides fully conserved columns outright, the other keeps them in place but fades them into the background so that the variable columns stand out without losing the coordinate frame. Motif search, codon overlay, clustering highlights, and sequence-name colouring operate in Full and Block only.

### 2.4 Visualization and Customization

**Conservation shading** follows the tiered model of GeneDoc (Nicholas et al., 1997) — two to four user-defined conservation levels — and extends it in three ways. The thresholds are live sliders, so the alignment re-shades continuously as one is dragged and a cutoff is found by inspection rather than by repeated trial; each tier carries its own colour picker; and the frequency denominator switches between non-gap positions and all positions, which changes what "conserved" means wherever coverage is ragged. Six residue colour schemes (monochrome, nucleotide, purine/pyrimidine, ambiguity, and two amino acid palettes) apply independently of conservation. Sequence names can be renamed inline, truncated by slider, and pinned during horizontal scrolling; zoom spans 50–200%.

### 2.5 Consensus Construction and Use

In most viewers the consensus is a display artefact: one row drawn beneath the alignment from a fixed rule. ViewAlign exposes the rule, and then reuses the result as an operand elsewhere in the interface.

**Construction.** Each column passes two independent gates. A coverage gate rejects columns whose non-gap fraction falls below a threshold (default 30%), so ragged alignment ends yield gaps rather than a confident-looking consensus resting on two or three sequences. A frequency gate then requires the commonest residue to reach a plurality threshold (default 50%) measured over the full column depth including gaps, so that the consensus and the conservation shading agree on what a column's depth is. Output is either a single base — preferring a standard A/C/G/T residue, normalising U to T, breaking ties alphabetically — or an IUPAC ambiguity code where standard bases tie. Columns failing the frequency gate are not silently gapped: a fallback selector emits a gap, an N, or an IUPAC code summarising every base present, which distinguishes absent data from genuine polymorphism. The computation runs in small slices that keep the interface responsive, so a consensus remains available even for alignments too large to render conventionally.

**Reduction.** Any selection of two or more sequences can be summarised in place, either inserted as a labelled row beneath the selection or substituted for it.

**Anchoring.** Adding sequences to a curated alignment normally forces a choice between realigning everything, which discards the curation, and MAFFT's `--keeplength`, which discards the new sequence's insertions. ViewAlign takes a third route: the gapped consensus is treated as a profile of residue columns separated by insertion slots, the degapped consensus and the new sequence are aligned pairwise, and the result is mapped back onto that layout. Existing columns keep their contents and their order; a slot is widened only where the new sequence needs more insertion columns than the alignment already has, and that widening is propagated to every row as gap padding. The curation survives, and so do the insertions.

### 2.6 Editing and Sequence Management

Rows are reordered by drag, by three sort criteria, or by a k-mer guide tree with optimal leaf ordering; the resulting order exports as JSON and can be reapplied to a reloaded file, decoupling ordering from alignment content. Colour is assigned manually, by n-gram Jaccard similarity of sequence names, by regular expression on names, or by cluster membership, and then acts as selection metadata: sequences can be copied, grouped, or sorted by colour, and every assignment records the method that produced it. Edit Mode provides GeneDoc-style residue editing, gap-column insertion and deletion, and the Move NoGaps and Slide KeepGaps tools, with an undo history whose labelled dropdown restores any earlier state in one click. A selected column block can be de-gapped, or realigned on its own and spliced back without disturbing the flanking regions — so a locally misaligned segment is repaired without putting the rest of a curated alignment at risk.

### 2.7 Codon-Aware Analysis

Codon-aware display activates on nucleotide alignments in Full and Block modes whose length is divisible by three. Bases are coloured by codon position, in-frame stop codons are highlighted, frameshift-inducing indels are underlined, and substitutions are marked synonymous or non-synonymous against a reference sequence; a translated amino acid track sits beneath each row. A selector offers 15 NCBI genetic codes, which stop detection, mutation classification, and translation all follow. Because the analysis is post-hoc, frameshift marking serves mainly to show where codon-aware realignment may be needed.

### 2.8 Sequence Clustering

A position-pattern clustering algorithm groups sequences by shared diagnostic positions. At each column it collects the sequences carrying each base, keeps candidate groups above a minimum size, and scores them by the fraction of positions at which members agree; near-identical groups are then fuzzy-merged (Jaccard index ≥ 90%, size difference ≤ 5). Minimum cluster size, diagnostic-feature count, per-tier quality thresholds, size breakpoints, and edge trimming are configurable, and parameter sets save as presets for reproducible runs; full ranges are given in the manual. Candidate groups are capped at half the available sequences to prevent degenerate whole-dataset clusters, with an automatic retry under a relaxed cap if nothing passes. Results are presented as diagnostic-feature tables, and clusters compose with the operations of Section 2.5: each can be collapsed to a single consensus row, reducing a family to one sequence per subfamily without discarding the positions that justified the grouping.

### 2.9 Additional Analysis Tools

The remaining tools are documented in full in the manual and summarised here. A **dot plot** performs self- or pairwise comparison in word-match (SPIN) or sliding-window (Dotter) modes; an automatic detector ranks the strongest diagonal runs into a navigable list, so a repeat structure is inspected by clicking through candidates rather than by scanning the plot. **Motif search** accumulates rather than replaces: successive searches coexist on the same alignment, each assigned its own highlight colour, individually clearable, and preserved in saved sessions, so several motifs can be compared in one view. Queries accept mismatch tolerance, both strands, and regular expressions evaluated against degapped sequences, and fifty restriction enzyme sites are pre-loaded. A **repeat and TSD finder** locates tandem, direct, and inverted repeats and target-site duplications, marking the pairs it finds reversibly. **Trees** are built by UPGMA or Neighbor-Joining (Saitou & Nei, 1987) over p-distance, Jukes-Cantor, or Kimura two-parameter distances, and export as Newick with branch lengths. **Snapshots** store the alignment together with colour assignments, search highlights, and selections, and reopen from a URL. **BLAST** runs in a browser Web Worker against databases registered on the optional server, caching database FASTA in IndexedDB, with optional `blastn` acceleration where BLAST+ is installed (Camacho et al., 2009); it is unavailable on the static deployment.

### 2.10 Export

Alignments export as FASTA, as SVG (viewport or full alignment), and as RTF carrying per-residue conservation shading into a word processor. Derived outputs save separately: amino acid translations as FASTA, UPGMA trees as Newick, sequence order as JSON, and snapshots as JSON or as a self-contained HTML page.

---

## 3. Discussion and Conclusion

ViewAlign's contribution lies in delivery and in granularity of control rather than in feature count. In the areas this note emphasises, the comparison runs in its favour. UGENE's conservation highlighting applies a single frequency threshold in fixed colours, where ViewAlign exposes three independently coloured tiers and a choice of denominator; UGENE's row grouping collapses identical sequences, where the clustering described in Section 2.8 discovers subfamilies from shared diagnostic positions and reports the positions that support each; and per-sequence name colouring, used here as selection metadata for copying, grouping, and sorting, has no counterpart we could find. Alongside these, a comparable analytical range becomes available from a URL, with no installation, runtime dependency, or administrative privileges — which for users on managed or shared machines, for classroom teaching, and for inspecting an alignment a collaborator has just sent, decides whether the analysis happens at all.

Where a capability is inherited, the difference is usually in how it is operated. Tiered conservation shading and shading-preserving RTF export come from GeneDoc (Nicholas et al., 1997), which set both behind a configuration dialog and offered no undo. Making the thresholds live sliders turns cutoff selection into an act of exploration rather than of specification, and recording every edit in a labelled history makes editing safe enough to attempt. Neither adds a feature; both change what the tool is usable for. The same reasoning covers the analyses positioned in Section 1 — clusters are discovered from position patterns rather than derived for groups already given, and substitutions are classified from the alignment itself rather than from imported annotation.

Limitations. Some capabilities are deliberately out of scope, and users needing them are better served elsewhere: UGENE (Okonechnikov et al., 2012) offers wider format coverage, richer phylogenetics, and restriction analysis, and MEGA (Kumar et al., 2018) far deeper evolutionary inference. Within scope, the following apply. Canvas and Reads modes are view-optimized and support neither motif search, codon overlay, clustering highlights, nor sequence-name colouring. BLAST and BAM/CRAM loading require the optional server. GenBank import is flatfile-based rather than live accession lookup, and snapshots restore Full/Block settings only. Codon analysis is post-hoc and, unlike MACSE (Ranwez et al., 2011), does not adjust alignments to respect codon boundaries. The analysis tools assume a four-letter alphabet, so clustering, codon analysis, dot plots and the repeat/TSD finder remain nucleotide-oriented even though all view modes render protein alignments. DOM-based Full and Block modes stay responsive to roughly 200 sequences × 5,000 columns, beyond which Canvas is required. Protein-level analyses (substitution-matrix dot plots (Henikoff & Henikoff, 1992), structural annotation), 3D structure linking, and the deeper phylogenetic integration offered by MEGA (Kumar et al., 2018) or UGENE are absent. The MAFFT WebAssembly module inherits the algorithmic properties of MAFFT v7.525.

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
15. Camacho, C. et al. (2009) BLAST+: architecture and applications. *BMC Bioinformatics*, 10, 421.
16. Sarkar, I.N. et al. (2008) CAOS software for use in character-based DNA barcoding. *Mol. Ecol. Resour.*, 8, 1256–1259.
17. Fedosov, A.E. et al. (2022) MolD: a software for automated compilation of DNA diagnoses. *Mol. Ecol. Resour.*, 22, 2038–2053.
18. Saitou, N. & Nei, M. (1987) The neighbor-joining method: a new method for reconstructing phylogenetic trees. *Mol. Biol. Evol.*, 4, 406–425.

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

- **Supplementary Table S1** (`supplementary.md`): positioning of ViewAlign relative to representative MSA tools, describing the mechanism by which each capability is delivered
- **manual.html**: 13-section manual with sidebar navigation, covering all features, input formats, keyboard shortcuts, full parameter ranges, credits, and workflows
- **features-inventory.md**: expanded feature inventory
- **Example datasets**: FASTA, MSF, Clustal, PHYLIP, NEXUS, SAM, and BAM test files
- **deployment.md**: public server deployment guide
