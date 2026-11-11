# Audit of 2026-11-10: handout for the GLM check and for the next fixes

This file is for a local Claude Code session. It has two jobs:

1. run the GLM check on the fixes of batches 1 to 4 (builds v332 to v335) and of build v336, and
2. carry on with the open findings listed at the end.

Follow CLAUDE.md throughout: a failing check first for every fix, never weaken a check without asking the
owner, run the suites before every push.

## Prompt to give local Claude Code

> Read docs/sessions/2026-11-10-audit-HANDOFF.md and CLAUDE.md. Run the GLM check described there on the batch 1
> to batch 4 changes (commits "v332: audit batch 1", "v333: audit batch 2", "v334: audit batch 3", "v335: audit batch 4"), using the GLM harness on this machine the same way as for the earlier
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

## What batch 4 changed (v335)

Checks: "Audit U2", "Audit M11", "Audit L1" in `tests/regression/run-all.js`; `tests/meta/cache-bust.test.js`.

| Finding | What used to happen | Change |
|---|---|---|
| H9, T9 | `finder.js?v=1` stayed when finder.js changed; nothing checked the numbers. | `finder.js?v=2`. New suite "cache-busting numbers in index.html": the commit that last changed a file must be an ancestor of the commit that wrote its `?v=N`. tests.yml checks out with `fetch-depth: 0` for it (a shallow clone cannot be checked and passes with a notice). |
| U2 | A null or wrong-kind value in localStorage (`msaviewer_brk_style`, `clusteringPresets`, `seqColourPresets`, a null entry in `msaviewer_history`) threw at start-up or when the feature was opened. | `safeLocalGet` returns the fallback when the stored value is null or not the fallback's kind; `applyBrkStyle` keeps only a text colour and symbol; the history drops entries without a name. |
| M11 | MAFFT stopped with "no output" on protein U/O and on nucleotide letters that are no base code (I, E, F, J, L, O, P, Q, Z). | `_alignerGuardInput` sends them as X or N (rows without gaps), `_alignerRestoreResidues` writes them back. Protein or nucleotide is judged as MAFFT does (more than 75 % A, C, G, T, U, N), not by `isProteinAlignment()`. |
| L1 | The Canvas redraw after a zoom step read the font size mid-transition (12.2 px for 12 px). | `setZoom` switches the transition off for Canvas too. |

GLM tasks for batch 4:

13. `_alignerGuardInput`: is the 75 % rule the same as MAFFT's own (`mafft` script / `countATGC`)? Which inputs
    would the viewer call nucleotide and MAFFT protein, or the reverse?
14. `safeLocalGet`: list every caller and its fallback; is there one that stores a list, a number or a string and
    now gets `{}` back?

## What build v336 changed (batches 5 to 8)

Every item has a check named "Audit <number>..." in `tests/regression/run-all.js` unless another file is named.

| Finding | Change |
|---|---|
| M2 | `parsePhylip`: a strict name that ends in a number keeps it. |
| M3, L18 | `_parseGenBankRecord`: header fields are read only before FEATURES; a DEFINITION of several lines is kept whole. |
| M4, L12 | `?` stays `?` in loading, Save and snapshots (`_sanitizeFastaSequence`). |
| M5 | Save, copy and snapshots write the row's name first (`_fastaDefline`), so a renamed row keeps its name. |
| M6, L17 | A snapshot with an empty `fasta`, and a file of names only, are failed loads; the open alignment stays. |
| M7-M9 | Snapshot settings: radio values looked up without building a selector from the file's text (`_radioByValue`), colours through `_safeCssColor`, a saved regex that may run very long is loaded switched off (`_regexMayExplode`). |
| M10 | `_linkAddress()`: a link parameter may not point at the page's own `/api/` routes. |
| M12, M13, L10 | Sequence editor: rows matched by name, digits dropped, two records in the one-row editor refused. |
| M14, L9 | Add & Align matches the result by internal row ids; a cancelled run leaves no undo step. |
| M15 | Group explorer: rows claimed by full name, then by residues, not by first word alone. |
| M16 | Check only (fixed by the busy guard of v332). |
| M17 | A Canvas drag past the last row or column selects up to the edge (`_canvasDragCell`). |
| U4 | Undo and redo keep name colours given after the undone step (`_restoreNameColours`). |
| M18 | NJ branch lengths of a cherry sum to the distance also in the negative case. |
| M19 | Variable sites: `?`, X and (nucleotide) N are no difference. |
| M20 | Restriction search always looks on both strands. |
| L13, L14 | GenBank and A3M detection stricter. |
| U11 | Ctrl+M removed from the key lists; Ctrl+K added to the Info window. |
| U14 | Colour Names also matches the text as typed (`gamma(3)`). |
| U15 | `safeLocalGet` returns stores without a prototype: a preset named `__proto__` is stored. |
| L19 | BED chrom: the loose match needs the chrom as a whole word in the row name. |
| L20 | Statistics .csv: a text cell starting with `=`, `@`, `+`, `-` gets a leading apostrophe. |
| U12 | The Recent list opens under its button; Esc closes it. |
| U8 | Ctrl+H twice: the toolbar comes back with the stylesheet's layout and its current height. |
| M22-M26, L26, L28 | Reads: CRLF SAM, `=` bases, insertions at CDS block starts, deletions into splice sites, BAM SEQ `*`, VCF names without chr and GT 1/2, protein dot plot N. M25 (insertion at a read's end not counted) also changed `tests/fixtures/sample-call-reference.js`, with the owner's yes. Checks in `tests/unit/sample-call.test.js`, `variant-effect.test.js`, `audit-low.test.js` and regression "Reads ...". |
| H11, M27-M32 | server.js: static allowlist (`STATIC_SERVE_ALL=1` serves all), deletes confined to `blast_dbs/`, changing routes loopback only unless `ALLOW_REMOTE_FILE_ACCESS=1`. `tests/server/hardening.test.js`. |
| T2 | pages.yml deploys after the Tests workflow passed for a push to main, and not when a later commit passed already. `tests/meta/workflows.test.js`. tests.yml: 150 min limit, superseded branch runs cancelled. |
| T6 | The regression runner fails a check that passed while the page threw an uncaught error (`allowPageErrors: true` to opt out). |

GLM tasks for v336:

15. `_fastaDefline` and `seqEditApply`: a row whose name contains spaces, `>` or is empty; two rows with one name.
16. `addSequencesAndAlign`: can a row id `rN` collide with a real name in the aligner's output?
17. `_restoreNameColours`: undo of a delete, of a rename, of a reorder; are colours of deleted rows dropped?
18. `safeLocalGet` now returns objects without a prototype: any caller using `.hasOwnProperty` or `instanceof Object` on the result?
19. pages.yml: can a failed or cancelled Tests run, or a pull request run, reach the deploy? Can an older commit be deployed over a newer one?
20. server.js: `isOwnedDbFile` and the loopback test with IPv4-mapped IPv6 addresses and a symlink inside `blast_dbs/`.

## What build v337 changed (H10, owner's yes 2026-11-11)

server.js keeps a random access key in `~/.viewalign/access-key` (mode 600) and prints
`http://localhost:3000/?key=...`. That link sets the cookie `viewalign_key_<port>` (HttpOnly, SameSite=Strict)
and redirects to the address without the key. The file and SSH routes, `/api/ssh-servers`, database add and
delete and MAFFT/BLAST answer 401 without the cookie. `/api/viewer-info` reports `authorized`; the page shows
`#serverKeyNote` and does not ask for the SSH list when it is false. start-server.bat prints the link (not
run here: no Windows). Checks: "access key: ..." in `tests/server/hardening.test.js`, regression "Audit H10".

GLM task 21: can any protected route be reached without the cookie (method override, HEAD, a path form that
`routePath` does not normalise, a route missing from `FILE_ACCESS_ROUTES` / `changesThisMachine`)? Is the key
ever written to a log, an error reply or a served file?

## What build v338 changed

Checks "Audit L15", "Audit L16", "Audit L21" in `tests/regression/run-all.js`.

- **L15** `parsePhylip`: when no reading fits with digits removed, the file is read again keeping digits and taken
  when every row is states (digits, `?`, `-`, `.`) and fits the header: binary 0/1 PHYLIP loads.
- **L16** the full SVG and the RTF export write the letters as the Case setting shows them (`_exportCaseText`).
  The Full-view viewport SVG is not changed.
- **L21, part** Sort by similarity counts U as T in nucleotide alignments. A short fragment still ranks by its
  identity over shared columns (owner's decision what the ranking should be).

## What build v339 changed (findings of the GLM check of v334-v337)

Report: `dev-tools/audit-2026-11-11/glm-check.md`. Checks "GLM 1111 Q15b", "GLM 1111 Q12, Q11b", "GLM 1111 Q16" in
`tests/regression/run-all.js`; `tests/meta/workflows.test.js`.

- **Q15b #0-#2** `seqEditApply`: a row keeps its name when the record's long name was not changed; a changed name
  takes its colour along; `>` with no name keeps the old name (new rows: "unnamed").
- **Q19 #0** pages.yml `cancel-in-progress: false`.
- **Q12 #0, #1** `_dropGapLinePositionNumber`: a number beside a gap-only line that fits the residue count is
  layout (parseFasta, `_seqEditCleanSeq`).
- **Q11b #0, #1** `parseStockholm`: in a file with blank lines between blocks only those end a block; in a file
  without, `#=GC` and the return of the block's first name (after other names) do.
- **Q16 #3** `_alignIdNames`: an aligner error during Add & Align names a pasted row.

Left for the owner: **Q15a #1** (Rename accepts spaces; Save and reload show the first word as the name),
**Q17 #0** (undo of a rename onto an existing name, part of M15), and the UNSURE items of the report (databases
and snapshots readable without the access key; the key cookie is shared by all localhost ports).

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

## Open findings after v336

Numbers are those of the audit report ("ViewAlign audit 2026-11-10").

Waiting for the owner's decision:

- **M21** repeat finder: a pair with a mismatch one base before its end is reported one base short. Keeping the
  longer end on a tie moved the planted pairs in three "Repeat Finder ... owner 2026-10-31" checks, so it was taken
  back out. Tandem coverage is a tuned heuristic too.
- **U9** everything outside the toolbar uses the browser's serif font (Times New Roman on Windows). One line in
  styles.css (`body { font-family: Arial, sans-serif }`), but it changes the look of every window.
- **L24** TSD finder counts IUPAC-compatible bases as mismatches; benchmark figures in existing checks depend on it.
- **L27** a space as thousands separator in a typed position is ambiguous by design.
- **M15, part** name colours are keyed by name, so rows with one name share a colour. **U4, part** colour actions
  are still not undoable.

Not done yet:

- **T3-T5** 55 % of the regression checks run only in the test-only DOM Block view; Canvas Block has no checks for
  selection, undo, gap tools or keys; three checks cannot fail ("column selection highlights only
  currently-visible rows after scroll", the consensus windowing check, the windowed Full selection check).
  Making them strict needs the owner to say what the right behaviour is.
- **T7, T8** runner gaps (exit code 3 collision, suites without a per-check limit) and fixed waits.
- **L8** two start texts. **L11, L21 (fragment ranking), L22, L23, L25, L30-L40**, **U6, U7, U10,
  U13, U16, U17**: see the report.
- Reads: a SAM opened as an alignment still shows `=` as a letter; unclear errors for a cut-off BAM.
- Server: Windows path forms in `/api/local-cat` are untested; dev pages give 404 under the server unless
  `STATIC_SERVE_ALL=1`.
