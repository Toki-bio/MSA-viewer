# Reads, codon analysis and MACSE: usability audit (2026-10-22, v271)

**Goal under test:** a user checks a gene for mutations from sequencing reads. They load the gene, load its
reads, see each change's evidence in the original reads (depth, alleles, strands), and read off the change's
effect on the codon and amino acid. Codon realignment (MACSE) is used where indels break the frame.

**Method.**
1. **Walkthrough.** A user's walkthrough was scripted on a realistic test region:
   `tests/fixtures/reads/region`, made by `make_region_reads.js`.
   - It is 3 kb long, with two genes: geneA `join(201..500,801..1100)` on the + strand and geneB
     `complement(1601..2200)`.
   - The reads carry known changes:
     - synonymous (heterozygous);
     - missense R140Q;
     - an intron change;
     - stop S51\* on the minus strand;
     - heterozygous missense G120E;
     - a heterozygous 1-base frameshift.
   - The script is `walk.js`. Every claim below was checked on this data, not on the code alone.
2. **GLM audit.** 13 read-only tasks over the code areas involved, with a checklist covering the SAM/BAM
   specification, genetics and usability (`glm-harness/make_va_reads_audit.py`). It produced 26 findings; 23 of
   them quote the code exactly. Every finding was checked against the code; see `glm-findings.json`.
3. **igv.js source.** igv.js (commit b5d6480, MIT) was read for the coverage, downsampling, sort and popup
   designs.
4. **Testing.** Every fix has a regression check seen failing on the code before it. The BAM index reader is
   tested against `samtools index` and `samtools view -c`, run on KIT.

## What was wrong, and what was done

| # | Found | Fix |
|---|---|---|
| 1 | GenBank CDS features were parsed and dropped. Codon analysis guessed a frame from ATG counts, so on the test region the synonymous change was called non-synonymous and R140Q synonymous. | CDS, tRNA and rRNA features become the annotation track (`join`, `complement`, `codon_start`). `/transl_table` sets the genetic code. |
| 2 | BED12 exons were ignored, so geneA was translated through its intron (5 stops in the reference itself). | BED12 blocks and thick start/end are read. Codon analysis joins the coding exons in transcript order, and the track draws introns. |
| 3 | More than 1000 reads made the whole file refused. In BAM the cap was taken before the gene's reference was chosen, so a multi-reference BAM could lose all the gene's reads. | Every read is parsed. The display shows 50 reads per 100 bp (fixed-seed reservoir, as igv.js), and every read counts. |
| 4 | BAM kept duplicate, QC-failed, secondary, supplementary and unmapped reads. | One flag filter for SAM, BAM and CRAM; the message gives the counts. |
| 5 | A whole-genome BAM cannot be decompressed in a browser. | A `.bai` picked with the BAM means only the loaded region's blocks are read, as htslib's query does (bins plus a linear-index cut at both ends). On the test file this reads 0.03 of 0.1 MB, with the same reads as `samtools view -c` for every region. |
| 6 | Reads matched only a row of exactly the BAM's name. | A `chr` prefix, a version suffix, case, a single sequence of the same length, and `samtools faidx` regions (`chr7:1001-2000`, reads shifted) also match. Otherwise the message lists both sets of names. Also: a headerless SAM, and a BAM named `.sam`. |
| 7 | A heterozygous deletion was called homozygous (above 50%), which made a false frameshift in the sample row. | Homozygous at 80% or more, as for bases. Indels are left-normalised, so the same event at two offsets of a repeat is one call. |
| 8 | Changes were only listed in a message: no depth, no strands, no codon, no amino-acid change, no way back to the reads. | A **Variants** window: depth, allele %, alt and ref reads per strand, effect per gene, `c.` and `p.` (e.g. p.R140Q), notes (one-strand evidence, low depth, heterozygous indel), and TSV export. Clicking a row opens the reads at that position, sorted by base. |
| 9 | The Reads view had no coverage, no allele counts and no strand information. | A coverage row computed from all reads, coloured where non-reference bases reach 20%. Hovering gives counts per base and strand; clicking sorts the reads. Bars are coloured by strand, MAPQ 0 reads are faded, and inserted bases are in the tooltip. |
| 10 | A translated codon had no number. | Tooltip: `R (CGA), codon 140`, numbered as in the reference, also for a sample row that starts inside the gene. |
| 11 | MACSE run on a gene region with flanks and introns invented 21 frameshifts per row. Its summary counted padding at read ends as frameshifts. | A warning before codon-aligning rows that have stops in every frame. The summary counts only internal frameshifts. |
| 12 | MACSE and the fast engine ignored the genetic-code menu: a mitochondrial gene got 2 false frameshifts per row. | The chosen code is passed to both (v269). |
| 13 | **Sample → row**, a second time: duplicate row and duplicate insertion columns. An edited reference left stale calls. CRAM lost its base qualities. | Repeating selects the existing row; another sample gets its own row and reuses insertion columns; the reference is re-synced; CRAM qualities are kept. |

Smaller fixes:
- translations of same-named genes are no longer merged;
- the Auto frame message names the Pos button;
- Copy AA reports the right count;
- insertion positions are written as `a^b`;
- a synthetic example whose reverse read was stored reverse-complemented.

## GLM findings (26)

- **14 real, all fixed:** #3, #6, #8–#12, #15, #16, #18, #19, #21, #22, #25.
- **7 already fixed independently by the walkthrough:** #1, #2, #4, #5, #14, #24, #26.
- **3 refuted on the code:**
  - #7: it is already a non-breaking space;
  - #13: every deleted base is drawn;
  - #23: soft clips are drawn.
- **2 left:** #17 (internal, no user effect) and #20 (a deletion running past the reference end).

For CONFIRMED-type findings, precision was again high. One finding (#3, indel left-normalisation) was a real
calling bug that the walkthrough had not found.

## Still open

- **Rendering:** the Reads view is SVG, one element per reference base for the reference letters and ruler.
  Loading a 200 kb reference takes about 6.5 s, and longer references get slower. igv.js draws to a canvas
  instead.
- **No base-quality shading** of mismatches, and no MAPQ filter control. igv.js fades bases below Q20.
- **RNA-seq:** spliced reads (`N`) are drawn as solid bars.
- **One row per sample:** a heterozygous indel cannot be shown in a single sample row. It is listed in Variants
  and shown in the reads.
- **Indexes:** only `.bai` is read; `.csi` and CRAM's `.crai` are not.
- **Narrow windows:** the toolbar wraps when the Selections menu appears, so the rows move under the mouse
  between clicks. This predates this work.
