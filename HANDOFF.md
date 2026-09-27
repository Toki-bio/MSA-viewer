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

Tests: `bash tests/run-regression.sh` (44 browser checks then; 48 after the perf pass + compat 77 files + oracles),
`node tests/functional/run-all.js` (5). Every fix above has a check that fails on the
previous code.

## Performance pass (2026-09-27)

Measured with `dev-tools/perf/bench-interactions.js` (real mouse input in Chrome; baseline
`bench-2026-09-27-rsi.json` / `-syn.json`, after: `bench-2026-09-27-after.json`).
rsi_subfam_input_30k, 601 x 524, 316,050 residue spans:

| action | before | after |
|---|---|---|
| Ctrl-click a name (row) | 180-620 ms | ~85 ms |
| Shift-click 150 rows | 1.0-1.75 s | 0.33 s |
| Ctrl+Alt-click a column | 1.4-2.1 s | ~170 ms |
| 201-column range | 2.1-4.7 s | 0.52 s |
| click a residue | 1.6 s | 0.15 s |
| Highlight diffs on / off | 8-12 s | 1.0-1.2 s |
| zoom step | 5-13 s | 1.2-1.3 s |
| sort by name | 7-9.5 s | 1.6 s |
| full redraw | 5.6 s | 1.4 s |

Causes found (Chrome traces: `dev-tools/perf/trace-clicks.js`, `trace-actions.js`) and fixes:
- Every residue span had `position:relative; z-index:1`: 316k paint layers, hit-tested on each
  mouse press/move/release. Removed (screenshots byte-identical).
- Rows: a document-wide query per selected row -> one pass, toggle only what changed.
- Columns: a `<style>` rule listing every selected column, re-matched against all spans ->
  class toggled on the changed columns' spans only. Fixed on the way: clearing after a redraw
  left columns highlighted.
- Each full layout of 316k spans cost ~2 s: rows off screen now skip style/layout/paint
  (`content-visibility` on `.seq-data` in non-windowed blocks, placeholder = columns x 1ch,
  1em). Geometry and screenshots identical at top/middle/bottom (`dev-tools/perf/verify-content-visibility.js`).
- Highlight diffs and its threshold: class toggle in place instead of a redraw (screenshots
  identical to a redraw). Zoom: no 0.1 s font-size transition on big views.
- Redraws predicted to take > 1 s show "Redrawing the alignment..." first. No Stop button on
  redraws (half a redraw leaves a broken view); Stop needs chunked or worker work.
- GLM perf audit (8 tasks, `C:/work/glm-harness/out/viewalign-perf-*.json`): tasks 1-5 useful
  and matched the measurements; the render-call batches were unreliable.

## Conventions

- Release: bump `?v=` for changed js/css in index.html and `BUILD_TAG` (script.js line 3);
  commit with the Co-Authored-By trailer in the message; `bash update-version-json.sh` makes its
  own commit: amend that one with the trailer too; push.
- Line endings in git: `styles.css` is stored CRLF (add with `git -c core.autocrlf=false`),
  everything else LF. Check `git diff --cached --numstat` before committing.
- GLM: read-only glm.js tasks, one question each, on a frozen `git worktree add --detach`
  snapshot; every finding checked against the source before use. Playbook:
  `C:/work/glm-harness/GLM_PLAYBOOK.md`.

## Next

1. Remaining perf items and the Stop button (todo.md, "Now"); the performance pass itself is
   done (above).
2. Fix problems found during real use.
3. Freeze, preprint, journal (above).
