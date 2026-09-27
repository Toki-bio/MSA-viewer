# ViewAlign — where things stand (2026-09-27)

Read this first. Details live in the commit messages (`git log`), `manual.html`,
`manuscript.md`, and the files linked below.

## Phase

The viewer is in **real-use testing**: the author uses it for SINEderella work and reports
problems; each is fixed with a regression check. After that: **freeze** (GitHub release tag
+ Zenodo DOI), then a **bioRxiv preprint**, then a journal. Nothing is frozen or posted yet.

## Publication plan (decided 2026-09-27, not final)

- Authors (manuscript.md, between `<!-- authors -->` markers): Sergei A. Kosushkin,
  Darya V. Zakirova, Alisher A. Abdullaev, Center for Advanced Technologies, Talabalar
  Street, Tashkent 100174, Uzbekistan; ORCIDs as in Genes 2026 17(9), doi:10.3390/genes17091117.
  **Open:** corresponding author, contact e-mail, funding statement, co-author consent.
- Preprint first (bioRxiv), then a journal. Options checked 2026-09-27:
  - *Bioinformatics* Application Note (~2,600 words, or ~2,000 + 1 figure): current
    manuscript is ~2,375 words, no figure. Original Papers there need a new method with
    real biological data; software alone does not qualify. Preprints allowed; direct
    bioRxiv -> Bioinformatics transfer supported. Fully OA with an APC.
  - *NAR Web Server issue*: now year-round proposals from November (one-page proposal
    first), published on acceptance, issue on 1 July; reviews test function and usability.
    Best fit for a full-length paper. NAR's preprint policy still to be checked.
  - A full-length version would add the measured validation (below), a SINE use case,
    and the results of the human testing.
- Word export: `NODE_PATH=<docx node_modules> node dev-tools/build_manuscript_docx.js`
  writes `submission/ViewAlign_Application_Note.docx` (untracked; `submission/` also holds
  the superseded draft r9).

## Work 2026-09-24 .. 27 (summary; commits have the detail)

Statistics window (rebuilt)
- Follows Easel: esl-alistat card shows exactly what esl-alistat prints; identity is
  esl-alipid's (identical / shorter unaligned length), with "shared columns" as an option.
  Tooltips quote the Easel man pages / source. Was: a card labelled esl-alipid computing
  the definition the esl-alipid manual calls "not robust".
- Window: drag, resize from all edges/corners, maximize, minimize, dock on the right.
- Matrices: named tables (angled/vertical/numbered labels), windowed rows for large n,
  Distance / Identity % switch, find row/column, column selection for Copy, pair filter
  (>=/<=, list, save pairs / names / FASTA), Save as CSV/TSV/xlsx, heatmap (4 palettes,
  range, reverse).

Codon analysis (rebuilt)
- Translation track: codon boxes coloured by amino-acid class, letter over the middle base.
- Frameshifts judged against the other sequences (majority codon position per column), not
  by a gap's own length; leading/trailing gaps never count.
- Fixed: RNA translated as X, marks on unchanged bases, ambiguous codons classified,
  out-of-frame reading after a gap, cells widened by borders (misaligned columns).

Trees
- No invented distance for pairs without shared bases; saturated JC69/K80 pairs no longer
  produce NaN branch lengths (both filled and reported in red in the tree window).
- NJ: tie-break toward the closer pair, and the minimum-Q bug that tie-break introduced
  (found by the GLM audit) fixed; checked against the Wikipedia 5-taxon example and a
  long-branch case. Fit: no padding overflow.

Display / interface
- Display menu relabelled (Sticky on the Name Len row; Letters: Case / Colours; Frame /
  Code labels). Name Len: No limit works, typing not clamped per keystroke, presets keep
  No limit. Names end in one "…" with a 1ch gap. Detached panels look like windows.
- All dialogs: one title-bar style, 26px close button.
- Shade menu: colour swatches beside the labels (the hover picker covered them).
- Variable sites: top threshold reachable (max n-1), message when nothing qualifies.
- Scrollbar resyncs on zoom (Full mode no longer snaps back).
- Alignment menu: selectable k for Reorder by similarity / Reorder only (same setting as
  Clustering > Group by k-mer k).

Audits
- GLM feature audit, 20 tasks: `reference/glm-audit-2026-09-27/SUMMARY.md` (16 fixed,
  10 rejected with reasons).
- Tree probe: `dev-tools/tree-audit/run-audit.js` (all three original defects fixed).
- Manuscript 2.7 corrected to the new codon display.

Tests: `bash tests/run-regression.sh` (44 browser checks + compat 77 files + oracles),
`node tests/functional/run-all.js` (5). Every fix above has a check that fails on the
previous code.

## Conventions

- Release: bump `?v=` for changed js/css in index.html and `BUILD_TAG` (script.js line 3);
  commit; `bash update-version-json.sh`; amend with the Co-Authored-By trailer; push.
- Line endings in git: `styles.css` is stored CRLF (add with `git -c core.autocrlf=false`),
  everything else LF. Check `git diff --cached --numstat` before committing.
- GLM: read-only glm.js tasks, one question each, on a frozen `git worktree add --detach`
  snapshot; every finding checked against the source before use. Playbook:
  `C:/work/glm-harness/GLM_PLAYBOOK.md`.

## Next

1. Performance pass on big alignments (row and column selection are slow; find other slow
   spots) and a progress notice with Cancel for anything over ~1 s. See `todo.md`.
2. Fix problems found during real use.
3. Freeze, preprint, journal (above).
