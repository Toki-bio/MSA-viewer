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

## GLM audit of Repeat Finder + dot plot (started 2026-09-28)

- 16 narrow glm.js tasks (9 Repeat Finder/TSD, 7 dot plot) against a frozen snapshot of v210:
  worktree C:/work/MSA-viewer-glm-audit2 at e0e6204.
- Generator: C:/work/glm-harness/make_viewalign_repeat_dot_audit_tasks.py;
  runner: run_viewalign_repeat_dot_audit.sh (resumes, skips done tasks);
  outputs: glm-harness/out/viewalign-rdaudit-*.json.
- Every finding is checked against the code (quote exists, input reproduces) before any fix.
- Result (all 16 tasks ran; 3 needed a rerun after HTTP 429). Fixed in v211, each covered by the
  "Audit fixes" regression check, which fails on v210:
  - Dot: SPIN region ends were w-1 too long (the word worker marks every cell of a word);
    a newer plot could get the older plot's worker result (both listeners took the first reply;
    now a new job terminates the busy worker, and openDotPlot drops stale generations);
    closing the window did not cancel a pending live recalculation (it reopened);
    left-edge resize went off screen; go-to-region centred on the row span; context radius 0/negative;
    fit floor 0.01 px/cell too high for lopsided plots (now 0.001); exact-cell image capped at 4e6
    cells; threshold sliders redraw once per frame; X never matches in nucleotide plots.
  - Repeats: inverted pairs listed twice (mirror); U did not pair with A, IUPAC complements forced
    to N; tandem arrays listed once per shifted start and per multiple of the unit; 0% divergence
    was read as 15 (repeats) / 20 (TSD), TSD pre-SINE end 0 read as 30; negative Min length hung
    the tab; Clear highlights redrew with the current radio mode; lowercase TSD marks wiped all
    soft-masking; copied TSD table lacked the "note" column for misses.
  - Rejected (checked, not real): Fit leaves the crosshair behind (Full view handler redraws it);
    1 GB exact image at 300 kb (cell limit makes it impossible).
  - Left open (judgement calls): N/N in TSD flanks counts 0.5 mismatch; conservation needs >= 3
    rows; TSD results keyed by row index go stale after row edits until re-run; undo of lowercase
    marks restores by row index; reference-row name regex matches inside words.

## Search highlights, fast gap tools, Selections panel (v212, 2026-09-30)

Reported in real use: after editing, search-shaded residues were shifted; "Clear selection"
hard to find and not covering all kinds; Ins Gap Other took ~2 s.

- Search highlights are now a layer derived from state (`_getSearchHitsForRow`, cached per row
  by sequence string + `_searchLayerVersion`). Rows are built with their hit classes
  (createSequenceLine) and every in-place path (`repaintResidueSpan`) recomputes them. Causes
  found: (1) classes were painted onto spans once and in-place repaints either dropped them or
  left them on the old columns (Move/Slide drag overlay showed the old highlights through);
  (2) redraws re-ran each search from its *label*, so both-strand ("X (fwd)") and restriction
  ("EcoRI GAATTC") highlights vanished after any redraw; (3) windowed scroll never painted
  them; (4) match counts came from the rendered spans (off-screen rows missed); (5) regex was
  upper-cased (\w became \W). Entries now store searchValue/useRegex/maxMismatches/enabled;
  old snapshots are read (restriction keys too).
- Gap tools (Ins/Del Gap Seq/Other/All, single gap) patch the DOM in place
  (`patchColumnsInPlace`): one appended span per row when the width grows, ruler/`--cols`
  updated, conservation + consensus recomputed from the edit column, consensus line rebuilt;
  on-screen cells repainted at once, other rows in idle slices (`_staleRows`), a scroll
  finishes rows it reveals. Falls back to renderAlignment for windowed DOM, codon/diff/trim/
  cluster/repeat/blockmask views, or a full last block in Block mode. 200 x 1000 Full mode:
  ~1.3 s -> ~0.3 s to first paint (trace). Equivalence to a full redraw is a regression check.
- Selections panel (top menu, appears when anything is listed; detachable like other menus):
  rows, columns, residues, each search, TSD marks, repeat highlights, name colours. On/off
  (off = moved to `state.selectionStash`, so no command sees it; rows/residues stashed by
  sequence object), go-to (steps), remove, Clear selection, Clear all, Hide/Show all, Undo of
  the last removal. Esc with no menu/dialog open clears rows/columns/residues. Saved in
  snapshots (`selections` in the payload).
- Checks (fail on v211): search highlights through edits + drag overlay; windowed/restriction/
  regex; gap tool in-place == full redraw; Selections panel round trip.

## GLM audit of v212 (started 2026-09-30)

- 18 narrow glm.js tasks (6 search layer, 4 in-place gap patch, 7 Selections panel, 1 Canvas
  redraw) against a frozen snapshot: worktree C:/work/MSA-viewer-glm-audit3 at 6113f85 (v212).
- Generator: C:/work/glm-harness/make_viewalign_v212_audit_tasks.py; runner:
  run_viewalign_v212_audit.sh (resumes, skips done tasks); outputs:
  glm-harness/out/viewalign-v212audit-*.json; run log glm-harness/v212-audit-run.log.
- Every finding gets checked against the code (quote exists, input reproduces) before any fix.
- Tasks 1-9 (canvas, patch 1-4, search 1-4) checked. Fixed (check "v212 audit fixes" fails on v212):
  mismatch-search hits painted at cols[idx+pos] (findFuzzyMatches gives absolute positions; the
  old redraw path had the same shift); empty regex matches painted/counted; lowercase u in regex;
  invalid regex (message overwritten, mangled rev-comp entry stored, unvalidated with no rows);
  regex + both strands complemented the regex text (now forward only, said in the message);
  both-strand message counted a sequence twice; legacy snapshots lost mismatches (now from
  view.maxMismatches) and regex-ness (now from metacharacters); gap edit inside the trailing
  filler run reported as a change; in-place patch guard now checks every row's span cache;
  residue-selection classes restored after each idle repaint slice / scroll completion.
- Rejected: seq-length label stale (gap edits keep residue counts; equivalence check covers it);
  mixed shading between idle slices and missing-cache/row-identity risks (every path that could
  cause them renders, which cancels pending work); left-slide contract (unreachable); captured
  canvas scheduleDraw (no caller stores it); duplicate hexToRgb (pre-v212, out of scope).
- Tasks 10-15 (search 5-6, sel 1-4). Fixed: Canvas bold TSD mark hid the search colour; drag
  overlay start hits now recorded at drag start; TSD/repeat/name-colour off/on replaced instead
  of merging (a second off lost the first batch; on dropped marks made while off), TSD stash
  aliased the live Map, repeats toggle threw with no repeat state, their "(+N off)" counts;
  Undo bundle kept rows/residues by index (now by sequence object); observer null guard;
  duplicate columns in the range formatter. Check "Selections off/on merges ..." fails on v212.
- Rejected: "undo does not repaint repeats" (renderAlignment's row builder applies them);
  CSS in swatch colour (escaped, colours come from pickers/palettes); pending residue anchor
  dropped on off/on (intended). Go-to cursor math GLM could not read: checked by hand, correct.
- Tasks 16-18 (sel 5-7). Fixed: snapshot load kept the previous session's name colours, TSD
  marks and repeats when the snapshot had none (now restored exactly; fresh file load also
  clears TSD marks/repeats, which are keyed by row index); restored columns past the width;
  switched-off rows/residues and the Undo bundle were orphaned by data undo/redo and column
  deletion (state.seqs replaced by copies; now matched again by sequence name); switched-off
  columns not shifted by Insert gap column / Delete columns; Esc in a Type-mode cell cleared
  the selection (now leaves the cell); a focused checkbox swallowed the first Esc (only text
  fields count as open); duplicate context-menu label line. Checks "... merges ..." and
  "... survive undo ..." fail on v212.
- Rejected: Esc with the (non-blocking) Statistics window open clears the selection (design:
  Esc does not close that window, the clear is undoable); Ctrl+A selecting switched-off rows
  (select all means all; the stash stays); no-op Move up pushes undo (pre-v212, out of scope).
- Author's answer (2026-09-30): clear. v214: a new file clears name colours and their history
  (presets kept); snapshots still restore theirs. Check "Name colours: cleared ..." fails on v213.

## Touchpad scroll jump-back and TSD flanks (2026-09-30, v217)

- Horizontal two-finger scrolling (Full view, 50%, B.aln.fa 201 x 2019) jumped back / stalled.
  Cause: the persistent scroll bar and the alignment echoed each other (alignment scroll ->
  bar.scrollLeft = x -> bar scroll event, one frame later -> alignment.scrollLeft = bar.scrollLeft).
  The `syncing` guard only covered the synchronous part. Every scroll step became a programmatic
  scroll, which cancels the browser's smooth/inertial scrolling. Reproduced with a compositor
  gesture (CDP Input.synthesizeScrollGesture, gestureSourceType 'mouse'; 'touch' does not scroll
  in headless): swipe of 2700 px stopped at 1036-1547 px with 9-51 write-backs; now completes,
  0 writes. Wheel events do not reproduce it (main thread only). Fix: `makeBarInputGuard` -
  a bar's scroll event drives the view only within 350 ms of real input on the bar (wheel,
  press, touch, key); alignment -> bar never writes an equal value; same for the vertical bar and
  for Canvas (offsetX/offsetY had the same echo). The setupMenuScrollBehavior handler (forced
  layout per name cell on every scroll) is disabled, not the cause.
- TSD results: 3 bases on each side of both copies, small grey (`_tsdFlanks`, stored with each
  result at analysis time). Not added to Copy table (format unchanged).
- Check "Touchpad-style horizontal scroll ..." fails on v216 (swipe stops at 577 of 1200 px).
  "Horizontal scrollbar follows zoom" now dispatches a wheel event first (a bare bar.scrollLeft
  write is our own mirror, not user input).

## Colouring / marking conflict study (2026-09-30, awaiting decisions)

- Read dev-tools/colour-conflicts/STUDY.md. Browser probes: probe.js (136 layer pairs, both
  orders, clears, redraw, Canvas), anchor-probe.js (marks through 7 kinds of edit).
- Headline: three drawing mechanisms (class !important, inline !important, painted once)
  decide who wins by accident. Selections invisible under SNP letters and colour schemes; TSD
  colour marks invisible on shaded residues (DOM only); repeat highlights lost on any redraw;
  TSD marks and residue selections land on another sequence after a row delete/move.
- Section 7 of the study lists the decisions needed before changing anything.

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
