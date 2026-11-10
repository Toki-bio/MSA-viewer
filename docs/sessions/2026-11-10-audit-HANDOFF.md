# Audit of 2026-11-10: handout for the GLM check and for the next fixes

This file is for a local Claude Code session. It has two jobs:

1. run the GLM check on the fixes of batches 1 to 3 (builds v332, v333, v334), and
2. carry on with the open findings listed at the end.

Follow CLAUDE.md throughout: a failing check first for every fix, never weaken a check without asking the
owner, run the suites before every push.

## Prompt to give local Claude Code

> Read docs/sessions/2026-11-10-audit-HANDOFF.md and CLAUDE.md. Run the GLM check described there on the batch 1
> to batch 3 changes (commits "v332: audit batch 1", "v333: audit batch 2", "v334: audit batch 3"), using the GLM harness on this machine the same way as for the earlier
> GLM audits (see dev-tools/reads-audit/REPORT.md). Check every GLM finding against the code before believing it.
> For each confirmed finding: write a regression check that fails first, fix it, and report. Do not start on the
> open findings until the GLM check is done and I say so.

## What batch 1 changed (v332)

All in `script.js`; checks in `tests/regression/run-all.js` (names start with "Audit H1", "Audit H3", "Audit U1").

| Finding | What used to happen | Change |
|---|---|---|
| H1, H2 | Keys worked while MAFFT ran (the busy overlay blocked only the mouse). Ctrl+Up during Realign Selected moved rows and the result was written into the old row numbers: one sequence got another's residues. Ctrl+Z during a run removed the realign's undo step. | `_alignmentKeysAway()` returns `'busy'` while `#busyOverlay` is shown; `handleKeyDown` then does nothing (and keeps modifier shortcuts from the browser, so Ctrl+R cannot reload the page mid-run). Second guard: `_mafftAlignWithUi` compares `state.seqs` and `_seqsFingerprint()` before and after the run and returns `null` with a message when they differ. `realignSequenceAgainstConsensus` has the same comparison. |
| H3, U3 | With focus on a button of Statistics, Info, Tree, Colour history, Repeat Finder, Group explorer, Add Sequences or the Sequence editor, Ctrl+R / Ctrl+U / Ctrl+B / Ctrl+D / Ctrl+Up edited the alignment behind the window. | `_alignmentKeysAway()` returns `'window'` when focus is inside one of `EXCLUSIVE_MODAL_IDS` or `statsModal`, or when Info, Add Sequences or the Sequence editor is open at all. Text fields keep their native keys; the Sequence editor keeps its own Ctrl+Z / Ctrl+Y. |
| U5 | Ctrl+D deleted columns with focus in a number box or a drop-down. | The Ctrl+D branch uses `_isTextEntry`. |
| U1 | Ctrl+L outside the Input box reloaded the Input box text: all edits and the undo history were gone without a question. | It asks first when `state.deletedHistory` is not empty. |

`_dropNoOpUndo` skips its pop once when the stale-result guard found that the caller's undo step is no longer
the last one (`_skipNextNoOpDrop`, cleared by a 0 ms timer).

## What batch 2 changed (v333)

Checks: "Audit H4", "Audit H5", "Audit H8" in `tests/regression/run-all.js`.

| Finding | What used to happen | Change |
|---|---|---|
| H4 | MAFFT drops `*`: a row came back one residue short, with the case after the `*` shifted, and a success message. | `_alignerGuardInput` sends `*` as a placeholder (X for protein, N otherwise); `_alignerRestoreResidues` writes every residue of the result back from the row that was sent, position by position, and throws when a row comes back with a different number of residues. Used in `_mafftAlignWithUiRun` and `alignSequenceToConsensusProfile`. The codon aligner path is not covered. |
| H5 | Region realign with Adjust direction also reverse-complemented a row NAMED like an internal row id (`r2`). | realign-region.js: rows that carry `_rk` are looked up by that key only (`inKeySet`, `lookupHeader`, `applyOrder`). |
| H8 | An RNA alignment got its consensus in T; an inserted consensus row turned the alignment into DNA for RevComp. | `_getConsensusOptions().isRna` (`_alignmentIsRnaCached`); `_consensusDecide` gives U for T when it is set. |

## What batch 3 changed (v334)

Checks: "Audit H6", "Audit H7", "Audit M1".

| Finding | What used to happen | Change |
|---|---|---|
| H7 | Clustal and Stockholm rows were keyed by name: two rows with one name became one row of double length. | `_interleavedRows()`: a row is the n-th line with its name within a block. A blank line, a Clustal conservation line and a Stockholm `#=GC` line end a block. |
| H6 | `parseFasta` deleted every digit, so a NEXUS 0/1 matrix did not survive Save FASTA or a snapshot. | A FASTA record made only of digits, `?`, `-`, `.` (with at least one digit) is kept as a row of states (`_fastaStateRow`). Numbers beside letters are still layout. |
| M1 | MSF `Name: seq1 oo  Len: 8` gave the name "seq1 oo" and nothing loaded. | A trailing ` oo` is dropped from the name. |

## What the GLM check should look at

Read-only tasks, each answered with exact code quotes:

1. `handleKeyDown` and `_alignmentKeysAway`: is there any key path that still changes `state.seqs`, the
   selection or the undo history while `'busy'` or `'window'` is returned? Other `keydown` listeners in
   script.js (search `addEventListener('keydown'`) are not covered by the guard: list each and say whether it
   can edit the alignment.
2. Does the guard block something a user needs? Windows meant to stay open beside the alignment (Dot plot,
   Tree, Group explorer, Statistics) block shortcuts only while focus is inside them. Check that a click on
   the alignment always moves focus out of the window, in Canvas, Canvas Block and Full.
3. `_mafftAlignWithUi`: every caller (`realignAll`, `realignSelected`, `realignSelectedBlock`,
   `_realignRectangle`, `addSequencesAndAlign`, RealignRegion's `mafftAlign` callback). For each: does it
   handle `null` without leaving an undo step behind or popping the wrong one? Does any caller change
   `state.seqs` itself between the start of the call and the result (which would now make every run "stale")?
4. The codon path (`_codonAlignWithUi`) goes through the same wrapper: confirm.
5. Mouse paths during a run: the overlay covers the page, but detached panes (`iframe` mirrors) and the
   context menu: can they edit while a job runs?
6. Ctrl+L: the textarea branch (focus in the Input box) still loads without asking. Is there a way to lose
   edits there that the user would not expect?
7. Jobs that show no busy overlay (`realignSequenceAgainstConsensus`, clustering, repeat finder, dot plot):
   which of them write to `state.seqs` after an `await`?

8. Batch 2, `_alignerRestoreResidues`: records are matched to the rows sent by name, in order for repeated
   names. Is there a caller whose result legitimately has a different residue count for a row (it would now
   be refused), or whose input rows contain gaps? Does the codon aligner (`_codonAlignWithUi`) also lose `*`?
9. Batch 2, `isRna` in the consensus options: list every place that builds consensus options by hand instead
   of `_getConsensusOptions()` (they would still give T), and every consumer that compares a consensus
   character with a row character and would now see U where it expected T.
10. Batch 2, `_alignmentIsRnaCached`: its key is the rows array, the row count and the undo/redo lengths. Is
    there an edit that changes a T or U without touching any of these?

11. Batch 3, `_interleavedRows`: a Clustal file whose blocks are separated by neither a blank line nor a
    conservation line would now give one row per block line. Does any writer produce that? Check the
    Stockholm path with `#=GR` lines between sequence lines and with `#=GS` lines inside the alignment.
12. Batch 3, `_fastaStateRow`: which FASTA-like inputs consist only of digits and gap symbols but are not
    state rows (the PIR path passes no raw text; quality lines; a pasted ruler)?

## The two regression checks that failed on Linux: settled 2026-11-10

Neither was a viewer defect; both checks were changed with the owner's yes.

- "Canvas mode: codon analysis draws stops...": the letter-colour tolerance was fitted to one machine's
  antialiasing (19); the frame-3 tag's nearest pixel is 27 off on another. Now 30 (tag colours are 49+ apart).
- "Dot plot: Highlight all marks every shown stretch...": the check scrolled to the top, which put marked row
  100 below the view, then counted tint after a view switch that keeps the place. It now goes back to the
  marked row before the switch.

## Open findings, in the suggested order

Numbers are those of the audit report ("ViewAlign audit 2026-11-10"). All reproduced in a browser unless
marked code-read.

1. **M11** MAFFT fails on protein U/O and nucleotide I/E without naming the row or the letter. (H4 fixed in v333.)
2. (H5 fixed in v333.)
3. (H6, H7, M1 fixed in v334.) **M2** strict PHYLIP names lose a trailing number; binary 0/1 PHYLIP is
   still refused (L15).
   **M3** GenBank qualifier lines starting LOCUS/DEFINITION/ORGANISM rewrite the record.
   **M4** `?` becomes N in protein rows that look like DNA. **M5** Save and snapshots rename rows whose name
   is not the first word of fullHeader. **M6** a snapshot .json with an empty `fasta` keeps the old alignment
   under the new name.
4. (H8 fixed in v333.)
5. **H9 / T9** `finder.js?v=1` was not raised when finder.js changed; the version test should check every
   `?v=` against the file's last change.
6. **T1-T5** CI has been red on main since 2026-11-04; pages.yml deploys without waiting for the tests; 55 %
   of the regression checks run only in the test-only DOM Block view; Canvas Block has no checks for
   selection, undo, gap tools or keys.
7. **H10, H11** optional server: file and SSH routes trust any local program; `DELETE /api/blast-db` unlinks a
   FASTA outside `blast_dbs/`.
8. **U2** one bad value in localStorage (`msaviewer_brk_style = null`, `clusteringPresets = null`, a null entry
   in `msaviewer_history`) leaves the page dead until site data is cleared. **U4** undo wipes name colours
   applied after the undone step.
9. Mediums: **M12-M16** Sequence editor matching by position and keeping digits, Add & Align matching by name,
   groups keyed by first word, second Ctrl+Shift+R hiding the busy overlay. **M17** a drag past the last row
   or column does not select up to the edge. **M18** NJ branch lengths depend on row order
   (script.js `buildNJTreeFromAlignment`, the negative `bj` case). **M19** variable sites count N/X/? as a
   difference. **M20** restriction search misses minus-strand Type IIS sites by default. **M21, M22** repeat
   finder and protein dot plot. **M23-M26** reads: CRLF SAM, insertion before a CDS block, insertion at the
   region end, `=` bases.
10. Lows: see the report (L1-L40, U6-U17). L1 is quick: `setZoom` should switch off the 0.1 s font-size
    transition for Canvas too, because the redraw reads the font size mid-transition (12.08 px for 12 px).
