# Submission plan — Bioinformatics Application Note

Snapshot is `main` (commit `5b93334`, build v187). The uncommitted 2D
rectangle work stays out of this submission. No second GitHub repository:
reviewers open https://toki-bio.github.io/MSA-viewer/ and
https://github.com/Toki-bio/MSA-viewer. Tag `main` only after the claim
fixes below are committed. A Zenodo archive of that tag waits for acceptance.

## Done in this pass

Checked the August audit (`PRESUBMIT_AUDIT_FINDINGS.md`, C2–C4) against
committed `main`, then continued through Summary and Section 2. Corrected
in `manuscript.md`, and mirrored in `manual.html` or `cover-letter.md`
where those documents said something else:

- Canvas auto-activates above 5,000,000 residues (`ALIGN_CRAZY_VOLUME`),
  not 150,000. The message reports the residue count. It does not tell the
  user to return to Full or Block.
- Full and Block use a windowed display above about 500,000 residues
  (`ALIGN_WINDOWED_DOM_THRESHOLD`). Canvas is not required at
  200 sequences × 5,000 columns.
- The “~18,000 lines across six client modules” sentence is removed.
  `index.html` on `main` loads eleven scripts, and the count had already
  drifted once.
- Shading is three enableable levels (Black, Dark, Light checkboxes), not
  a user-chosen two-to-four.
- Canvas draws the amino-acid translation track. Codon-position colour,
  stops, frameshifts, and synonymy marks stay in Full and Block. Motif
  search, clustering highlights, and sequence-name colouring stay in Full
  and Block (`isMotifSearchSupported`).
- Section 2.10 says trees export as Newick, not only UPGMA.
- Cover letter no longer says no current tool provides the “full”
  editing-to-export workflow, and it says MSAViewer rather than
  MSAViewer.js.

Verified and left unchanged: nine parsers; block width 40–300; zoom
50–200%; six residue schemes; consensus defaults 30% coverage and 50%
plurality, frequency denominator includes gaps; fallback gap/N/IUPAC;
15 genetic-code options; fuzzy-merge Jaccard ≥ 90% and group-size
difference ≤ 5; candidate cap at half the pool with a relaxed retry;
50 restriction enzymes; MAFFT WASM file is 346,033 bytes (~340 KB);
manual still has 13 sections. Show 2D stays in the manual and out of
the note.

## Still to do, in order

1. **You fill the placeholders.** `manuscript.md` Contact is `[email]`.
   `cover-letter.md` still has `[Author names]`, `[Institution]`, `[Email]`.
2. **Delete the revision-note block** at the top of `manuscript.md` in the
   file you upload. Leave it in the repo until that export. It now includes
   rounds 6 and 7.
3. **Commit the claim fixes, then tag** that commit as the submission
   snapshot. Do not include `scratch/` or the uncommitted 2D files.
4. **Manual leftovers that are not paper claims:** section 5.4 still has a
   “[Screenshot needed]” note. The comparison-table sources in
   `supplementary.md` were consulted 29 July 2026 and were not re-checked
   against the other programs.

## Out of this submission

Dirt, axis bias, and same-row rectangle collapse are local edits on top of
`main`. They are not described in `manuscript.md`.
