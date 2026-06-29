# MSA Viewer — Expanded Feature Inventory

> Supplementary material for the Bioinformatics Application Note.  
> Each feature includes its novelty relative to existing browser-based MSA viewers.

---

## 📥 Input & Format Support

| Feature | What it does | Why it's novel |
|---------|-------------|----------------|
| **8 input formats** | FASTA, MSF, Clustal, PHYLIP, NEXUS, Stockholm, SAM, BAM/CRAM | No other browser-based viewer accepts SAM/BAM/CRAM as input. Most desktop tools require pre-conversion. |
| **Automatic format detection** | Detects format from content, not filename extension | Eliminates a common user friction point. SAM is distinguished from FASTA by CIGAR and `@HD` headers. |
| **SAM CIGAR expansion** | All 11 CIGAR operations (M, I, D, N, S, H, P, =, X, B, soft-clip variants) expanded to gapped alignment | Full BAM/SAM specification support — not just M/I/D. |
| **Pileup consensus** | When loading SAM, a majority-rule consensus is computed from mapped reads as the reference | Enables immediate visual comparison of reads against the consensus without a separate reference file. |
| **BAM/CRAM server pipeline** | POST `/api/bam2sam` runs `samtools view` with path-traversal guards | Converts BAM directly in-browser via the optional server — no CLI needed. |
| **SSH remote loading** | Load alignments directly from a remote server via SSH | Unique among web-based viewers — useful for HPC users. |
| **Recent files history** | localStorage-backed history with metadata, adjustable size (1–50), one-click reload | Full text stored (100 KB cap per entry) — no need to re-read files across sessions. |
| **URL parameter loading** | `?file=URL` and `?snapshotFile=URL` auto-load | Enables direct sharing of alignments with a single link. |

---

## 🖥️ Visualization & Rendering

| Feature | What it does | Why it's novel |
|---------|-------------|----------------|
| **5 interchangeable view modes** | Full, Block, Canvas, Compact, Variable Sites Only | Most viewers offer 1–2 modes. Five modes cover every workflow from editing to publication to NGS. |
| **Canvas renderer with viewport culling** | GPU-composited 2D canvas; draws only visible rows/columns per frame | Auto-activates at 150,000 total residues. Handles alignments that crash DOM-based viewers. No framework — pure Canvas API. |
| **Auto-detection threshold** | Canvas mode kicks in automatically for large alignments with a toast notification | User doesn't need to know about performance limits — the tool adapts. |
| **CSS performance layer** | `content-visibility: auto`, `contain: layout style`, `will-change: scroll-position` | DOM mode stays responsive past 200 sequences × 5,000 columns without a virtual DOM library. |
| **Compact mode (IGV-style)** | SVG-based read packing with greedy track assignment, coverage histogram, mismatch markers | Brings IGV-style NGS visualization into a general MSA tool — not a separate application. |
| **Compact: Diffs only** | Hairlines (4 px) showing only variant positions | Reduces visual noise to the minimum — hundreds of reads collapse to a single-column-width signal. |
| **Compact: Pairs** | Dashed connections between paired-end reads from SAM flags 0x1/0x40/0x80 | Visualizes insert-size relationships directly in the alignment — no separate pair plot needed. |
| **4 conservation shading modes** | Identity, Similarity, Clustal, Zappo | Standard set, equal to desktop tools. |
| **Customizable shading thresholds** | Black, Dark, Light thresholds with independently adjustable highlight colours via colour pickers | Most viewers have fixed thresholds. MSA Viewer lets you adjust both threshold values and highlight colours. |
| **Consensus sequence** | Plurity/majority consensus above or below alignment, with configurable threshold and minimum coverage | Standard, but the threshold customization is more flexible than most. |
| **Per-sequence colour labelling** | Assign custom background colours to individual sequences or groups; colour inspector panel tracks assignments | Sequences can be coloured by taxonomy, cluster membership, or any user criteria. Colours persist through edits. |
| **Sticky sequence names** | Locked in place during horizontal scrolling | Eliminates the "scrolled-right, lost the names" problem without a separate panel. |
| **Inline name editing** | Double-click a sequence name to rename it | No dialog box — direct inline edit. |
| **Adjustable name length** | Slider truncates names to configurable width | Essential for datasets with long FASTA headers. |
| **Zoom 50%–500%** | Residues and text scale continuously | Wider range than most viewers. |
| **Sequence sorting** | Sort by name (A→Z), length (gapless, desc), or pairwise similarity to the first sequence | Three sort criteria — most viewers offer none or one. |
| **Cross-mode Highlight Diffs** | Fully-conserved columns dimmed to 25% opacity across all view modes | Computes conserved-column set once, reuses for Variable Sites Only mode. | 
| **Variable Sites Only** | Hides fully-conserved columns entirely | Collapses invariant regions — alignment stays meaningful even at extreme zoom-out. |

---

## ✏️ Editing & Sequence Management

| Feature | What it does | Why it's novel |
|---------|-------------|----------------|
| **GeneDoc-style residue editor** | Type individual residues, insert/delete gap columns, select column ranges | Browser-based MSA editing is rare. MSAViewer (Yachdav 2016) has no editing mode. |
| **Full undo/redo stack** | All operations tracked with visual dropdown history | Undo dropdown lets you jump to any previous state — not just linear undo. |
| **Drag-and-drop row reordering** | Click-drag sequence names to reorder | Intuitive and immediate. |
| **3 sort operations** | Alphabetical, by length, by similarity | Batch reordering without manual dragging. |
| **Row operations** | Delete, duplicate, reverse-complement selected sequences | Standard editing operations, tracked in undo. |
| **Column operations** | Delete column, insert gap column, select column range | Gap insertion with alignLen adjustment — correctly updates all internal state. |
| **SeqEdit bulk editor** | Degap, reverse, complement, reverse-complement, uppercase, lowercase with optional length normalization | Six bulk transformations unavailable in any other browser viewer. |
| **Add & Align** | Append a new sequence, then realign it against the existing alignment via MAFFT in add-keep-length mode | Preserves existing alignment structure while integrating new sequences. |
| **Block realignment** | Select a column range and press Ctrl+Shift+R to realign only that region | Fixes local misalignments without disturbing correctly-aligned regions. |
| **Edit mode with live conservation** | Conservation shading updates in real time as you type residues | Feedback loop is immediate — no need to exit edit mode to re-check conservation. |

---

## 🔬 Analysis Tools

| Feature | What it does | Why it's novel |
|---------|-------------|----------------|
| **Codon analysis** | Nucleotide colour-coding by codon position (blue/green/orange), stop codon detection, frameshift marking, syn/non-syn classification, amino acid translation track | First browser-based MACSE-inspired codon viewer. 17 selectable genetic codes. |
| **17 genetic codes** | NCBI tables 1–6, 9–14, 16, 21, 22 including vertebrate/invertebrate/yeast/ascidian mitochondrial and ciliate/euplotid nuclear | Covers all commonly-used alternative codes. Only differences from Standard stored; full table built by merge. |
| **Frameshift detection** | Wavy red underlines at indel positions that break the reading frame | Critical for pseudogene and TE annotation — unique among browser viewers. |
| **Synonymous/non-synonymous classification** | Green underline (silent) vs. double red underline (amino acid-changing) per codon | Directly interpretable selection signal in the alignment view. |
| **Position-pattern clustering (SINEClusterer)** | Groups sequences by shared diagnostic nucleotide positions with fuzzy merging, quality scoring, outlier pruning, and progressive threshold relaxation | Novel algorithm purpose-built for TE subfamily detection. 400-line implementation with no external dependency. Only comparable tool is command-line `SubFam`. |
| **Cluster quality tiers** | Small (≤10 seqs, 85% quality), medium (11–20, 75%), large (>20, 65%) with configurable breakpoints | Adaptive quality thresholds prevent over-clustering of divergent copies while maintaining stringency for tight families. |
| **Colour by cluster** | Persistent background colours on sequence names by cluster assignment; hover highlights all members | Makes subfamily membership visually undeniable — no need to cross-reference tables. |
| **Cluster presets** | Save/restore parameter configurations as named presets | Reproducible analysis across different TE families and publications. |
| **Group consensus** | Compute and insert consensus row for any selected set of sequences with adjustable threshold | Complements clustering: cluster → inspect → extract subfamily consensus. |
| **Dot plot** | Self-comparison or pairwise, adjustable window (1–61), identity threshold (0–100%), context radius (5–100 bp), RevComp axis B | Standard features, but region detector + sidebar navigation is unique. |
| **Dot plot: Region detector** | Finds top 30 diagonal runs, displays in navigable sidebar; click to scroll alignment | Bridges dot plot exploration and alignment inspection — no other viewer does this. |
| **Dot plot: Copy Region** | Export hovered region directly as FASTA | Extracts candidate motifs/TEs from dot plot hits. |
| **Dot plot: SVG/PNG export** | Publication-quality export of the dot plot | Directly usable in figures. |
| **Repeat & TSD Finder** | Tandem repeat detection + target-site duplication finder with configurable parameters | TSD detection specifically for TE annotation — uncommon in general MSA tools. |
| **TSD Mark** | Highlight found TSD pairs with colour/bold/lowercase styling; undo support | Non-destructive annotation — can mark, inspect, then revert. |
| **UPGMA tree** | Pairwise identity distances → Newick output with branch lengths, .nwk download, text tree visualization | Lightweight phylogenetic context without external software. |
| **Regex motif search** | Interpret search query as JavaScript RegExp; `.*` checkbox toggle; match-length-aware highlighting | More powerful than exact-match search in most viewers. |
| **Ctrl+Click instant search** | Click any residue to search for that base across the alignment | Saves ~5 keystrokes per search — adds up on large alignments. |

---

## 📤 Export & Publishing

| Feature | What it does | Why it's novel |
|---------|-------------|----------------|
| **RTF export with conservation shading** | Word-compatible document: Courier New 9pt, per-residue background colours, scale ruler, consensus line | GeneDoc-style output — the gold standard for publication alignment figures, now from a browser. |
| **SVG export (viewport + full alignment)** | Vector graphics of the current view or the entire alignment | Publication-quality. Editable in Inkscape/Illustrator. |
| **FASTA/MSF export** | Full alignment or selected sequences/columns only | Standard. |
| **Open in new tab** | Ctrl+T opens the alignment as standalone HTML | Quick sharing or printing. |
| **Snapshot system** | Save/restore complete viewer state: alignment, colours, search highlights, column selections, view mode, zoom, custom colours | Reproducible figure preparation. URL-loadable (`?snapshotFile=`). |

---

## ⚙️ Server Features (Optional)

| Feature | What it does | Why it's novel |
|---------|-------------|----------------|
| **MAFFT integration** | Realign sequences via server-side MAFFT | Not novel per se, but the add-keep-length and block-realign modes are unique. |
| **BLAST search** | Submit selected sequences to NCBI BLAST | Alternative to copy-paste workflow. |
| **SSH remote file loading** | Load alignments directly from a remote server | HPC integration without SCP. |
| **BAM→SAM pipeline** | Server-side `samtools view` conversion | No CLI needed for BAM inspection. |
| **Security hardening** | CORS origin whitelist, path traversal guards, BLAST parameter sanitization, SSH key path configurable via env var | Production-ready for public deployment. |

---

## 🆕 What's New to Bioinformatics (Novelty Spotlight)

1. **First browser-based codon viewer with 17 genetic codes** — extends the MACSE paradigm (Ranwez et al., 2011) to the web. Synonymous/non-synonymous classification, frameshift detection, and stop codon highlighting with dynamic genetic code switching.

2. **First browser-based SAM/BAM/CRAM reader with full CIGAR expansion** — all 11 CIGAR operations, pileup consensus, compact read-packing mode. Bridges NGS and traditional MSA in one tool.

3. **First position-pattern-based subfamily clustering in a web viewer** — SINEClusterer fills the gap between desktop TE annotation pipelines and interactive exploration. No other viewer (desktop or web) offers this workflow.

4. **Canvas renderer with automatic viewport culling** — handles alignments 10× larger than DOM-based viewers can manage, with seamless fallback. Threshold-based auto-activation removes the performance burden from the user.

5. **IGV-style compact read packing in a general MSA tool** — read alignment visualization with coverage histogram, paired-end connections, and diffs-only mode, all within the same interface as traditional MSA editing.

6. **Customizable multi-threshold conservation shading** — independently adjustable Black/Dark/Light threshold values AND colours via colour pickers. No other viewer offers this level of control over conservation visualization.

7. **GeneDoc-style RTF export from a browser** — per-residue conservation shading in a Word-compatible format with scale ruler and consensus line. Eliminates the need to install desktop software for publication-quality alignment figures.

8. **Comprehensive snapshot system with URL sharing** — saves not just the alignment but colour assignments, search highlights, column selections, and view settings. URL-loadable for direct sharing.

9. **8-format automatic detection with format chaining** — FASTA, MSF, Clustal, PHYLIP, NEXUS, Stockholm, SAM, BAM/CRAM all detected from content. More formats than any other browser-based viewer.

10. **Zero-dependency architecture** — 12,000 lines of vanilla JavaScript, HTML, and CSS. No framework, no build step, no installation. Runs from a static GitHub Pages deployment or any web server.

---

## 📊 Comparison: Browser-Based MSA Viewers

| Feature | MSA Viewer | MSAViewer (Yachdav) | JalviewJS | AliView | IGV.js |
|---------|-----------|---------------------|-----------|---------|--------|
| Formats | 8 | 1 (FASTA) | 5+ | 5+ | SAM/BAM |
| View modes | 5 | 1 | 2 | 2 | 1 (reads) |
| Editing | ✅ GeneDoc-style | ❌ | ❌ | ✅ desktop | ❌ |
| Codon analysis | ✅ 17 codes | ❌ | ❌ | ❌ (desktop only) | ❌ |
| Clustering | ✅ SINEClusterer | ❌ | ❌ | ❌ | ❌ |
| Compact/reads | ✅ IGV-style | ❌ | ❌ | ❌ | ✅ |
| Canvas large-align | ✅ auto | ✅ fixed | ❌ | ✅ (desktop) | ✅ |
| Dot plot | ✅ region nav | ❌ | ❌ | ❌ | ❌ |
| RTF export | ✅ GeneDoc | ❌ | ❌ | ❌ | ❌ |
| Snapshots | ✅ full state | ❌ | ❌ | ❌ | ❌ |
| Regex search | ✅ | ❌ | ❌ | ❌ | ❌ |
| Server | MAFFT+BLAST+BAM | ❌ | ❌ | ❌ | ❌ |
| Frameworks | None (vanilla) | BioJS | BioJS | Java | JS module |

---

*Prepared for Bioinformatics (Oxford) Application Note submission.*
*Corresponding author: [to be filled]*
