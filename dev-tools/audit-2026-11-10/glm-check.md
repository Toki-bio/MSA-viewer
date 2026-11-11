# GLM check of v332 + v333 (audit batches 1 and 2), 2026-11-10

Commits checked: b70705a (v332) and 4ed06a5 (v333), diffed against a21f9a3. The task list is the 10 questions in
`docs/sessions/2026-11-10-audit-HANDOFF.md` ("What the GLM check should look at").

**Method.** I froze a copy of 4ed06a5 at `C:\work\MSA-viewer-glm-1110` (top-level .js/.html only, made with git
archive). On it I ran 17 read-only glm.js tasks, one question each (Q1 split in 4 parts; Q3, Q7, Q8 and Q9 split in
2-3). The tasks ran one after another, and each answer had to quote the code exactly.
- Generator: `C:\work\glm-harness\make_va_audit_1110.py`. Runner: `C:\work\glm-harness\run_va_1110.sh`. Both are committed in the local harness repo (0925a71).
- The raw GLM answers are in `glm-raw/`.

Every finding was then checked in two steps: the quote was grepped against the code, and the claim was traced in the
code. Where a claim was checkable, it was reproduced in headless Chrome against the repo at 4ed06a5, using
`tests/lib` (static server + launch). The probe scripts are in `probes/`; the repo's tests and app files were not
changed.

Limits of this check:
- The frozen copy had no styles.css, so the GLM Q5 task could not see any z-index. I settled Q5 from styles.css myself.
- GLM did not cover 13 of the 17 keydown listeners in Q1 part 3b; I read those myself.
- GLM's Q7 part 2 answer was incomplete; I checked those jobs myself.

Line numbers below are of 4ed06a5.

Verdicts: REAL = reproduced (or certain from the code, marked "by code"); REFUTED = shown wrong; UNSURE = not settled.

## Q1. Keys that still edit while 'busy' / 'window'

- **GLM (q1a #0, q1b #0-1): a focused drop-down (SELECT) inside a window lets every shortcut through. REAL.**
  - Cause: `_isTextEntry` counts SELECT as a text field, so the guard exempts it (script.js:16804-16807, `inText`). The text-field branch after that does not treat it as one: `isFormField` at script.js:16846 checks only INPUT/TEXTAREA/contentEditable. The key therefore falls through to the editing switch.
  - Probe p1: focus on `#statsIdMode` (Statistics) or `#treeDistanceModel` (Tree), with `_alignmentKeysAway()` returning 'window'. Ctrl+U added `s1_copy`, and Ctrl+R turned s1 into `rc_s1` behind the window.
  - The quote GLM gave for line 16929 does not exist in the code, but the finding is right.
- **GLM (q1a #1): Ctrl+A on that drop-down selects every row (script.js:16962). REAL.** Probe p4: with focus on `#treeDistanceModel`, Ctrl+A gave selectedRows [0,1,2,3].
- **GLM (q1a #2): Escape runs before the guard and clears the selection during a run (script.js:16772-16795, `clearActiveSelection()` at 16792). REAL, low.**
  - Probe p4: Escape during Realign Selected left selectedRows = [] with the busy overlay still up.
  - The data is not harmed: the realign callers had already captured their row indices.
- **GLM (q1a #3-6, q1b #3-6): ok verdicts.** Agreed: handleKeyUp edits nothing; the Sequence editor's undo stays in the editor; busy returns for every key; Ctrl+D checks `_isTextEntry`.
- **Other keydown listeners (q1c: all ok; q1d covered only 4 of 17).** I read the rest myself. One of them matters:
  - **finder.js:308: Ctrl+K opens the function finder while a job runs, and Enter there runs a command. REAL, medium.**
    - Why the guard misses it: the finder's listener is a window capture listener and calls stopPropagation, so `handleKeyDown` never sees the key. `run()` then calls `it.el.click()` (finder.js:263), and a programmatic click is not stopped by the overlay.
    - Probe p5, during Realign Selected of 40 rows with the busy overlay up: Ctrl+K, typing "Duplicate" and Enter took the rows from 40 to 80, with a 'duplicate' undo step on top.
    - The aligner result was then refused ("The alignment changed..."), so data is safe, but the batch-1 promise that keys do nothing during a job is broken.
  - The other listeners do not edit the alignment:
    - Esc closers: 192, 20434, 27683, 29515, 39392;
    - Enter in their own fields: 9547, 28378, 28400, 28741, 34728, 35037, 36013;
    - Sequence editor: 28694;
    - BLAST hit bar: 33685;
    - stats Esc, which clears only the window's own column selection: 25765;
    - a11y.js:166 (Esc and dialog focus).
  - q1c #5 quotes a `chipBoxKey` that does not exist; line 15164 is the "large alignment" dialog's key handler. The verdict (no edit) still holds.

## Q2. Does a click on the alignment move focus out of a side window?

- **GLM (q2 #0, #2): in Full mode a plain, Ctrl or Shift click on a residue keeps focus in the window. REAL.**
  - Cause: `handleNucleotideSelectMouseDown` calls `e.preventDefault()` (script.js:16586), reached through the capture chain at script.js:29851.
  - Probe p6: with focus on a Statistics button, a click on a residue span in Full (plain, Ctrl, Shift) left activeElement = BUTTON and `_alignmentKeysAway()` = 'window', although a residue was selected. The user then gets "click the alignment first".
- **GLM (q2 #1): in Canvas / Canvas Block, clicks on the name column, fold markers, annotation and trim borders also keep focus. REAL for the name column (other branches not probed).**
  - Probe p6, first run: a plain click in the name area of the canvas kept the Statistics BUTTON focused.
- **GLM (q2 #3): a residue click in Canvas and Canvas Block moves focus to body. Confirmed** (probe p6c: activeElement BODY, `_alignmentKeysAway()` = '').
- **GLM (q2 #5): the Group explorer is `clusteringModal` and is in EXCLUSIVE_MODAL_IDS (script.js:2541). Confirmed.**
- Note: at the default size the Tree and Dot plot windows cover the alignment in a 1600x1000 viewport, and the Dot plot has a full-page backdrop. There is nothing to click until the window is moved.

## Q3. Callers of `_mafftAlignWithUi`

- **GLM (q3a #0, #1): realignAll and realignSelected leave their undo step when a non-null result parses to 0 rows (script.js:26492, 26610). UNSURE.**
  - The code is as described, but these lines are older than these commits, and I found no trigger: the worker would have to return a non-empty, unparsable string.
- **GLM (q3a #2-8): null handling in realignAll / realignSelected is right; neither changes state.seqs before the result. Confirmed** (the push comes before the snapshot, and the writes come after the check).
- **GLM (q3b #4-5): when the rows changed during a region or block realign, the user sees "Region realign cancelled." / "Block realign cancelled." instead of the real reason. REAL, low.**
  - realign-region.js:478-490 turns null into `cancelled:true`, and the callers then show their own message (script.js:26289, 26361) over the one from `_mafftAlignWithUi`.
  - Probe p4: rows swapped during a region realign; the final status was "Region realign cancelled.".
- **GLM (q3b other items): no undo step left, nothing popped, state.seqs untouched until the result. Confirmed** (realign-region clones rows: realign-region.js:313, 336).
- **GLM (q3c #0): addSequencesAndAlign leaves its 'add-and-align' undo step when the result is null (script.js:27031 `if (!result) return;`). The `.catch` path does the same. REAL, low.**
  - The redo history is also lost.
  - Probe p4: after a stale Add & Align, the undo history held one extra entry, type 'add-and-align'.
- **GLM (q3c #4): the codon aligner's yes/no question is up before the busy overlay, and keys edit behind it. REAL.**
  - `_mafftAskYesNo` puts a plain overlay with focus on its No button, which is in none of the listed windows, so `_alignmentKeysAway()` returns ''.
  - Probe p7: with the question up, Ctrl+U duplicated a row.
  - For the codon question, the stale check then drops the result. The region realign's Adjust-direction and Reorder questions (script.js:26250-26266) use the same dialog: an edit made there is simply realigned afterwards.

## Q4. Codon path through the wrapper

- **Confirmed (q3c #2, q8b #1, #7).** `_mafftAlignWithUi` takes its snapshot (script.js:26144) before `_mafftAlignWithUiRun` sends codon mode to `_codonAlignWithUi` (script.js:26188). The stale check therefore covers codon runs, including the yes/no question.

## Q5. Mouse paths during a run

- **GLM (q5 #0): the pane header's Swap might be clickable during a run. REFUTED.**
  - `#busyOverlay` is position:fixed, inset 0, z-index 10060 (styles.css:717-720).
  - `.pane-dock` has z-index 900 (styles.css:4501), and `.context-menu` 1000 (styles.css:3128 block). Both the docked panes and a context menu opened earlier sit under the overlay.
  - GLM could not see this because the frozen copy had no styles.css.
- **GLM (q5 #1, #2, #5): edits inside a pane stay in the pane (`_paneChildEdited` only changes the pane's mode), and a mirror's Swap only exchanges view anchors. Confirmed.**
- q5 #3 quotes a line that does not exist (18230); ignored.

## Q6. Ctrl+L in the Input box

- **GLM (q6 #0, #1): with focus in the Input box, Ctrl+L reloads its text without asking and clears the undo history. REAL.**
  - Path: script.js:16849-16850, then the Load button's handler `parseAndRender(false)` (script.js:28538), which clears the history at script.js:15497-15498.
  - Probe p10: after an edit (5 rows, 1 undo step), focus in the Input box and Ctrl+L gave 4 rows, 0 undo steps and no dialog.
  - This is the old behaviour of the Load button itself, which also never asks. It was not introduced by batch 1, but it is the loss the question asks about. q1b #2 is the same item.
  - q6 #2's quote does not exist.

## Q7. Jobs without the busy overlay

- **realignSequenceAgainstConsensus (q7a #4-6): correct.** It snapshots before the await, checks before any write, and pushes undo only after the check (script.js:33876-33885). Confirmed.
- **GLM (q7a #2, #3): Add Sequences with "align to consensus" (`addSequencesJustAdd`; GLM calls it addSequencesAndAlign) pops the top undo step blindly on a stale result (script.js:26782) and on an error (script.js:26795). REAL for the stale path (probe); the error path is the same code, by code.**
  - Probe p9: the user closed the dialog during the run and pressed Ctrl+U. The add was refused, and the user's 'duplicate' step was popped while the empty 'add-sequences' step stayed.
  - This code is older than these commits.
- **Clustering, Repeat Finder, dot plot (q7b: incomplete, mostly "uncertain").** I found no write to state.seqs after an await:
  - clustering runs under `runWithProgress`, which puts up the busy overlay;
  - the Repeat Finder's collect step re-finds rows by object (script.js:38756);
  - the functions that write rows after these tools (applyTsdMarking, _geReorderSeqsFromGroups, _geGatherGroups) are synchronous user actions with no await.
  - Verdict: no defect found.

## Q8. Batch 2: `_alignerRestoreResidues`

- **GLM (q8a #0): "no caller sends gapped rows, so the skip never fires". REFUTED.**
  - addSequencesAndAlign sends the pasted text as it is (`adjustedNewText`, script.js:27025), gaps included. Those rows skip the restore (script.js:26175), so their `*` stays the placeholder.
  - Probe p8: pasting `>n1 new / MK-VLA*GHH` gave the row `MKvLAXgHH` with "Aligned 4 sequences successfully!". **REAL, low.** The case garbling there is the older `_remapCaseOntoAligned` behaviour.
- **Found by the same probe (older code, cosmetic): with repeated names, Add & Align takes the case from the wrong row.**
  - `originalCaseByHeader` is keyed by name (script.js:27028-27029), so the first "p1 first protein" got the case pattern of the last one.
  - Result: `MKVLA*GHHEe` for `MKVLA*GHHEE`. The restore itself matched the right rows.
- **GLM (q8a #1-3, #6): realignAll, realignSelected, the region path and the profile path send unique ids (r<i>, _rk keys, consensus/query) and ungapped rows, and a count mismatch throws before any change. Confirmed.** q8a #4, #5 and #7 (unverified parts) are settled by reading:
  - the region path is keyed by `_rk`;
  - Add & Align realigns everything ungapped and uses no `--add` or `--keeplength`.
- **Q8 part 2, codon path (q8b #2-5): `*` is not lost. Confirmed by probe p11.**
  - The fast engine keeps every input letter, `*` and case included.
  - MACSE refuses `*` ("Codon alignment: nucleotide character not handled: *") and leaves the alignment unchanged.
- **GLM (q8b #0): MACSE rewrites U and IUPAC letters to N. REFUTED.** Probe p12: MACSE kept `W` and an all-U row letter for letter.

## Q9. Batch 2: `isRna` in the consensus options

- **Options built by hand (q9a #2-6): none.** Every consensus letter comes through `_getConsensusOptions()`: computeConsensusForSequences (script.js:4665, 4680) and the explicit loops at 17693, 30223 and 30462. `consensusDisplayBase` and `_canvasConsensusUpper` only decide letter case. Confirmed.
- **GLM (q9a #1): the consensus tooltip still says T for an RNA column. REAL, cosmetic.** It folds U into T (script.js:14600) and labels the bar T (14607), while the consensus letter is now U.
- **GLM (q9a #0): block-mask.js treats U as a gap. REAL, but older code and not a consensus-option issue.** Its alphabet has no U (block-mask.js:21 `CODE`, used at 104), so the block mask of an RNA alignment sees every U as a gap; `applyBlockMaskLive` passes the rows as they are (script.js:13322).
- **Consumers that compare a consensus letter with a row letter (q9b #0-2): none found that breaks.**
  - Conservation shading builds its own column majority from row letters (script.js:9711-9737, 14217).
  - Colour classes put U with T (script.js:14190).
  - A U consensus row does not make the alignment look like protein (script.js:14096).
- **GLM (q9b #3): a mixed U/T column shades the inserted consensus row as a mismatch. REFUTED.** isRna needs U and no T anywhere in the alignment (`alignmentIsRna`, script.js:4405-4413), so a mixed U/T alignment gets its consensus in T.

## Q10. Batch 2: the `_alignmentIsRnaCached` key

- **GLM (q10 #0): when the undo history is full (200 steps), an in-place row edit leaves every part of the key unchanged. REAL.**
  - The Type tool's path is `handleGeneDocResidueKey`, script.js:31449-31452. `pushUndoRowPatch` plus `_trimUndoHistory` keep the length at 200 (script.js:17294-17310), and the rows array and row count stay the same.
  - Probe p3: an RNA alignment with 205 filler undo steps. The T edits made through `pushUndoRowPatch` left the alignment as DNA (`alignmentIsRna()` false), but the consensus stayed `ACGUACGUAA`. With a short history it correctly became `ACGTACGTAA`.
- **GLM (q10 #1): the same through find/replace on a row (script.js:31286). REAL by code** (same mechanism, not probed).
- **GLM (q10 #2): region realign rewriting T to U (realign-region.js:106) defeats the cache. REFUTED.**
  - That line keeps an RNA row RNA and cannot change the alignment's answer.
  - realignSelectedBlock also replaces `state.seqs` with a new array (script.js:26301), which changes the key.
- **GLM (q10 #3-5): undo/redo round trips, loads and case-only edits are covered. Confirmed.**

## REAL findings: proposed minimal fix and the check that would fail first

1. **Drop-down in a window passes every shortcut** (Q1).
   - Fix: let `isFormField` (script.js:16846) include SELECT and return for it, or drop SELECT from the guard's `inText` exemption.
   - Failing check: extend "Audit H3" with focus on `#statsIdMode` and `#treeDistanceModel`, then Ctrl+U, Ctrl+R, Ctrl+Z and Ctrl+A. Today the rows change and every row gets selected.
2. **Ctrl+K finder runs commands during a job** (Q1).
   - Fix: in finder.js, do nothing on Ctrl+K and in `run()` while `#busyOverlay` is shown (or `_alignmentKeysAway() === 'busy'`).
   - Failing check: "Audit H1"-style. During Realign Selected, Ctrl+K, type "Duplicate", Enter; the row count must not change mid-run. Today it goes 40 -> 80.
3. **Keys edit behind the aligner's yes/no question** (Q3/Q4).
   - Fix: give the `_mafftAskYesNo` overlay an id or class and make `_alignmentKeysAway()` return 'window' while it is in the DOM.
   - Failing check: open `_mafftAskYesNo(...)` and press Ctrl+U; the rows must stay 4. Today they become 5.
4. **Full-mode clicks keep focus in a side window** (Q2).
   - Fix: in the DOM mousedown chain (script.js:29844), and in the canvas handler's preventDefault branches (script.js:7825 onward), blur `document.activeElement` when it is inside a window, before calling preventDefault.
   - Failing check: Statistics open, focus on its button, click a residue span in Full, then `_alignmentKeysAway()` must be '' and Ctrl+U must add a row. Today it stays 'window'.
5. **Escape during a job clears the selection** (Q1, low).
   - Fix: check `_alignmentKeysAway() === 'busy'` before the Escape branch (it could press Stop, or do nothing).
   - Failing check: Escape during Realign Selected; selectedRows must still be [5, 6]. Today it is [].
6. **The stale region/block realign says "cancelled"** (Q3, low).
   - Fix: let `_mafftAlignWithUi` mark the null as stale (for example a flag read by the callers), and skip the "cancelled" message in realignSelectedBlock and `_realignRectangle` when it is set.
   - Failing check: swap rows during a region realign; the final message must match /changed while/. Today it is "Region realign cancelled.".
7. **Add & Align leaves an undo step on a null result or an error** (Q3, low).
   - Fix: take `const redoBefore = state.redoHistory` before `pushUndo('add-and-align')`, and call `_dropNoOpUndo(redoBefore)` in `if (!result)` and in `.catch`.
   - Failing check: swap rows during Add & Align; the undo history length must be unchanged. Today it is +1.
8. **Add Sequences "align to consensus" pops someone else's undo step** (Q7; older code).
   - Fix: keep the entry pushed at script.js:26748 and pop only when it is still the last one, else leave the history alone. Same at 26795.
   - Failing check (probe p9): Ctrl+U during the run; 'duplicate' must still be in the history. Today it is gone and 'add-sequences' is left.
9. **Ctrl+L in the Input box discards edits without asking** (Q6).
   - Fix: the same question as the other Ctrl+L branch when `state.deletedHistory.length` is non-zero, at script.js:16849.
   - Owner decision: the Load button itself never asks.
   - Failing check: the "Audit U1" variant with focus in an opened Input box. Today 0 dialogs, 4 rows, undo 0.
10. **The RNA cache is stale when the undo history is full** (Q10).
    - Fix: replace the history-length parts of the key with an edit counter that every `pushUndo`, `pushUndoRowPatch`, undo and redo increments. Alternative: key on `_seqsFingerprint()`, about 1 ms per 360k residues.
    - Failing check (probe p3): 205 filler steps, T typed over every U; the consensus must become ACGT... Today it stays ACGU....
11. **Add & Align: a pasted row with gaps loses `*` (to X/N)** (Q8, low).
    - Fix: strip gaps from the pasted rows before sending, as is done for the existing rows (script.js:26985).
    - Failing check (probe p8): paste `>n1 / MK-VLA*GHH`; the row must still contain `*`. Today it is `MKvLAXgHH`.

Small items, not in the fix list unless the owner wants them:
- the consensus tooltip says T for an RNA column (script.js:14600);
- block-mask.js reads U as a gap (block-mask.js:21; older code);
- Add & Align takes the case from the wrong row when names repeat (script.js:27028; older code);
- realignAll / realignSelected keep their undo step when a result parses to 0 rows (script.js:26492, 26610; no trigger found).
