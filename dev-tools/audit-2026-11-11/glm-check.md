# GLM check of v334-v337 (audit batches 3 and 4, build v336, v337 H10), 2026-11-11

Commit checked: 9688515 ("v337 WIP", origin/main), frozen as a git worktree at `C:\work\MSA-viewer-glm-1111`.
Task list: `docs/sessions/2026-11-10-audit-HANDOFF.md`, items 11-12 ("What the GLM check should look at"),
"GLM tasks for batch 4" (13-14), "GLM tasks for v336" (15-20), "GLM task 21". Tasks 1-10 were done on 2026-11-10.

**Method.** Same as the 2026-11-10 check. 14 read-only glm.js tasks, one question each (Q11, Q15 and Q21 split in 2),
run one after another, each answer required to quote the code exactly.
- Generator `C:\work\glm-harness\make_va_audit_1111.py`, runner `C:\work\glm-harness\run_va_1111.sh` (resumable),
  committed in the harness repo as e7e246f. Tasks: `C:\work\glm-harness\tasks\va-1111\` (generated, gitignored).
- Raw GLM answers: `glm-raw/`. The Q13 task carried MAFFT's own type rule, quoted from MAFFT core/io.c
  (GSLBiotech/mafft mirror), since MAFFT is not in the repo.
- Every finding: quote grepped against the code, claim traced by hand. No browser probes were run (a browser test
  suite was running on this machine). Two node-only checks were run (no browser, no server.js start):
  `probes/node-parsers.js` (Clustal/Stockholm/FASTA parsers from script.js in a vm) and
  `probes/node-express-paths.js` (Express 4 route matching vs `routePath`). `probes/p1_seqedit_names_colours.js` is a
  browser probe, written, NOT run.

Line numbers are of 9688515. Verdicts: REAL (by node run, or "by code" = certain from reading), REFUTED, UNSURE.
Severity is mine, not GLM's.

## Q11a. Clustal blocks (`parseClustal`, `_interleavedRows`)
- All 6 GLM items "ok". Agreed. The viewer has no Clustal writer in script.js; GLM's "writer" is `toClustal` in
  benchmark.js:39-46 (a dev page), which writes a blank line after each block.
- Quote of #2 (`/\s/.test(line)`) is wrong; the code is `/^\s/` at script.js:8392. Verdict unchanged.
- Node run: blocks with no separator at all do give one row per block line (`[a,ACGT],[b,AC-T],[a,GGGG],[b,GG-G]`).
  No writer known to me produces that for Clustal; not a defect.

## Q11b. Stockholm lines
- **#0 Blocks not separated by a blank line (and no `#=GC`) split every sequence into one row per block. REAL (node
  run), low.** script.js:8696/8697 are the only block ends. Before v334 (keyed by name) such a file joined correctly,
  so this is a change of behaviour. Whether real writers emit it: UNSURE (HMMER/Easel write blank lines).
- **#1 A `#=GC` line between two same-named sequence lines of one block joins them wrongly. REAL (node run), low.**
  `x ACGT / #=GC RF / x AC-T` gave `x = ACGTAC-TGGGG` and `x = GG-G`. Needs truncated duplicate names AND a mid-block
  `#=GC`; rare.
- #2-#5 ok, agreed (node run: `#=GR` lines between sequence lines are skipped and do not end the block).

## Q12. `_fastaStateRow`
- **#0 An all-gap record with line-end position numbers becomes a state row; the numbers become residues. REAL (node
  run), low.** `>s2 / ------ 6 / ------ 12` gave `------6------12` (row 15 long beside 12). script.js:8732 + 8737.
  Before v334 the digits were dropped. Needs a writer that numbers FASTA lines; uncommon.
- **#1 Same in the Sequence editor (`_seqEditCleanSeq`, script.js:27598). REAL (node run), low.** `"------ 6"` gives
  `"------6"`.
- #2, #6 .qual files: digits now kept (`40403820`). Was garbage before too (empty row). Not a new defect.
- #3-#5, #7 ok, agreed (PIR passes raw undefined: 8859/8874; letters + numbers still strip digits).

## Q13. MAFFT's type rule vs `_alignerGuardInput`
- #1-#4 ok. **Agreed, checked against MAFFT source:** `countATGC` counts `isalpha` after `tolower`, counts a,t,g,c,u,n,
  sums all rows, `atgcfreq > 0.75` -> 'd'. The viewer (script.js:26414-26421) counts the same letters, same strict `>`,
  same sum; 0 letters gives protein on both sides. The placeholder swap only raises MAFFT's ratio on the nucleotide
  side (N) and only lowers it on the protein side (X), so MAFFT cannot decide the other type. No type flag is passed
  (mafft-worker.js:24-27; getMafftExtraArgs 23959-23987).
- **#0 "Protein matrix flag -b 62 / -j 200 is sent for a run judged nucleotide". REFUTED.** In MAFFT core/constants.c
  a positive `nblosum` does not set `dorp`; the DNA branch (`if( dorp == 'd' )`) ignores it. Side note, older and out
  of scope: the "Sequence type" menu does not force MAFFT's type.

## Q14. `safeLocalGet` callers and fallbacks
- All ok. **Agreed.** Ten callers: script.js:98 (object default), 20997 and 35211 (`{}`), 22896/22939/22967/23013/23042/
  29029 (`clusteringPresets`, no fallback, stored as object), 32270 (`seqColourPresets`, stored as object, 32565).
  None stores a list, number or string. `msaviewer_history` reads localStorage directly (1571).
- GLM's #0, #3, #5, #6 quotes do not exist (#6 calls `msaviewer_preset_v44` a safeLocalGet caller; it is only a
  safeLocalSet at 18760). Verdicts unaffected.

## Q15a. `_fastaDefline`
- **#1 Rename accepts a name with spaces; Save writes `>my seq`, which reads back as `my`. REAL (by code), low,
  older than v336.** `_commitSeqRename` sets header and fullHeader to the trimmed text (script.js:14494-14495; inputs
  6290, 14529 only trim). `_fastaDefline` returns the full name (12454), parse takes the first word (8735).
- #3 a name starting with `>` writes `>>name`; reads back right in ViewAlign. Cosmetic, not counted.
- #0, #2, #4, #5 ok, agreed. The prefix trap (name `seq1`, long name `seq10 ...`) is not reachable: Rename sets both
  fields; the parsers that make them differ (NEXUS `_` for space at 8626, GenBank, rc_) never make the name a
  non-word prefix.

## Q15b. Sequence editor names
- **#0 Apply in the one-row editor renames a row whose name is not the first word of its long name. REAL (by code),
  medium.** NEXUS `Homo_sapiens` / `Homo sapiens`: the editor shows `Homo sapiens` (27522-27525), Apply sets
  `header = newFullHeader.split(/\s+/)[0]` = `Homo` (27844, 27868). The name colour stays under `Homo_sapiens`. This
  is the M5 problem again, in the editor. Browser probe written (p1, part 1).
- **#1 Same in the multi-row editor. REAL (by code), medium.** script.js:27779 (`fullH.split(/\s+/)[0]`); text built
  from `fullHeader || header` at 27555.
- **#2 Multi-row editor: a record line `>` with no name gives the row an empty name. REAL (by code), low.**
  27779 / 27792 have no `'unnamed'` fallback (the single-row path falls back to `'sequence'`, 27843). Probe p1 part 2.
- #3 duplicate names with a record removed: the first row gets the remaining record. That is the documented rule
  (comment 27739-27741); the text cannot say which one was removed. Not counted.
- #4 ok, agreed.

## Q16. Add & Align row ids
- #0-#2, #4, #5 ok. **Agreed:** every row, old and new, goes out as `r<i>` (27289), comes back by id (27312, 27321);
  pasted names never reach the aligner, so no id/name collision. #2's quote (26433) is wrong; verdict holds.
- **#3 During Add & Align, `_alignIdName('r12')` for a NEW row finds no row (state.seqs[12] does not exist), so an
  error message names the pasted row `r12`. REAL (by code), low, cosmetic.** script.js:26185-26187 used by the
  residue-count error at 26441.

## Q17. `_restoreNameColours`
- **#0 Rename A -> B while another row is named B, then Undo: the other B keeps A's colour, its own is lost. REAL
  (by code), low.** Rename moves A's colour onto B (`_migrateColourMapping`, 294-299). On Undo, B is in both name sets,
  so it is left as is (17449-17450). Part of the known open item "M15 part" (colours keyed by name). Probe p1 part 3.
- **#1 "Redo of a delete erases the deleted rows' colour keys". REFUTED as a defect.** It is the stated rule (comment
  17443-17445), the key belongs to no row then, and the next Undo restores it from the entry's colours (17689 is taken
  before `_restoreNameColours`).
- #2-#6 ok, agreed.

## Q18. Prototype-less objects from `safeLocalGet`
- All ok. **Agreed.** Consumers use own-key get/set/delete, `Object.keys`, `JSON.stringify` and `new Map(value)`.
  `applyBrkStyle` rebuilds a plain object (88-92). No `hasOwnProperty`, `instanceof`, or string conversion of the store.

## Q19. pages.yml
- **#0 An older commit's pages run cancels the newer commit's running deploy, then skips itself as superseded: the site
  stays on an even older version until the next push. REAL (by reading; cannot be probed locally), medium.**
  pages.yml:22-24 `concurrency: group: pages / cancel-in-progress: true`; the skip is at 46-58. Two pushes A (old),
  B (new); B's tests finish first and its deploy starts; A's tests finish; A's pages run enters the group and
  cancels B's deploy; A finds B passed and deploys nothing.
- #1 workflow_dispatch deploys `github.sha` of whatever branch it is started on, without tests (pages.yml:14, 40). By
  the file's own comment "on demand ... does not wait". Whether a non-main branch can deploy depends on the
  github-pages environment's branch rule (repo settings, not in code). UNSURE.
- #3 per_page=30: an older run is checked only against the last 30 passed pushes. Needs 30+ passed pushes while one
  test run is still going. Negligible; UNSURE.
- #2, #4, #5 ok, agreed (failed/cancelled runs and pull-request runs cannot deploy: line 31).

## Q20. `isOwnedDbFile`, loopback
- #1-#5, #8 ok. **Agreed.** `real.startsWith(dirReal + path.sep)` (265); lstat refuses a link itself (261-262);
  realpath on both sides.
- #0 the add route keeps `.` in names, so a database named `..` can be registered. Its delete computes
  `path.join(dbDir, '..') + '.nhr'` (outside blast_dbs), which `isOwnedDbFile` refuses. REFUTED as a hole; harmless.
- #6, #7 127.0.0.2 / `::ffff:127.0.0.2` / any X-Forwarded-For are refused. REFUTED as defects: errors lock out, never
  let in, and Node reports IPv4-mapped addresses in dotted form, so `::ffff:7f00:1` does not arise.

## Q21a. Reaching protected routes without the cookie
- All "ok". **Agreed, and checked by node run (probes/node-express-paths.js):** `/API/Local-Cat/` reaches the
  handler with `routePath` = `/api/local-cat` (checked); `%2D`, `//`, `/./`, `/x/../`, `;x`, `%2F` all give 404 in
  Express 4 (no handler). HEAD and other methods are caught (166 uses the path only for file routes). No
  method-override middleware.
- Not raised by GLM, my reading (no defect in the key code, an owner decision): the static handler serves
  `blast_dbs/` and `snapshots/` (server.js:196, 208-211), and `/api/snapshots`, `/api/blast-db`, `/api/databases`
  list them, all without the key. Another user of the machine can read the owner's databases and snapshots. GLM #0
  calls this "by design". UNSURE whether that is intended under H10.
- Also my reading: the cookie is not port-bound (server.js:44 comment). A server another local user runs on
  `localhost:<other port>` receives `viewalign_key_3000` whenever the owner's browser opens a page there, since
  cookies ignore ports and SameSite treats all localhost ports as one site. UNSURE (needs the owner to visit that
  port; a known limit of cookies).

## Q21b. Key leaks
- All ok. **Agreed.** Logs print `req.method` and `req.path` only (1396), never the query; the redirect goes to
  `req.path` without the query (160); error replies do not echo it; the page never sees the key (script.js:1816,
  1931 read only `authorized`). start-server.bat prints it to the console only (79).
- GLM did not answer Windows: `chmod` is ignored there, but the file is under `%USERPROFILE%`, private to the user by
  default ACLs. Not a finding.
- Several #2/#3/#6 quotes do not exist; verdicts hold by my reading.

## REAL findings: proposed minimal fix and the check that would fail first

1. **Q15b #0, #1 (medium): the editor renames a row whose name is not the first word of its long name.**
   - Fix: in `seqEditApply`, keep the row's `header` when the record's long name equals the long name the row was
     opened with (single-row: `newFullHeader === openedAs`; multi: `fullH === (q.fullHeader || q.header)`); only
     when the long name was changed take its first word.
   - Failing check first: regression "Audit Q15b: editor Apply keeps a NEXUS name": rows with header `Homo_sapiens`,
     fullHeader `Homo sapiens`; open the editor, change one residue, Apply; expect header `Homo_sapiens` and its colour
     kept. Same for the multi-row editor.
2. **Q19 #0 (medium): an old pages run cancels the new deploy.**
   - Fix: `cancel-in-progress: false` in pages.yml (runs queue; the superseded step already stops old-over-new).
   - Failing check first: `tests/meta/workflows.test.js`: fail when pages.yml has `cancel-in-progress: true`.
3. **Q12 #0, #1 (low): an all-gap record with line-end numbers becomes a state row.**
   - Fix: in `_fastaStateRow`, need at least one digit that is not a trailing position number of a line. Simplest:
     test the record per line, after removing a trailing ` <digits>` from lines that also hold gap symbols. Or require
     no gap-only line followed by spaced digits.
   - Failing check first: unit check `parseFasta('>a\nACGTAC 6\n>b\n------ 6\n')` gives `b = ------`; and
     `_seqEditCleanSeq('------ 6') === '------'`. The 0/1 matrix check (H6) must still pass.
4. **Q11b #0 (low): Stockholm blocks without blank lines are split.**
   - Fix: in `_interleavedRows.add`, when a name is seen again in the block AND every name of the block has been seen
     (the block's line count reached the first block's row count), start a new block. Or: in parseStockholm only,
     call `blockEnd()` when the first name of the alignment appears again.
   - Failing check first: `parseStockholm('# STOCKHOLM 1.0\na ACGT\nb AC-T\na GGGG\nb GG-G\n//')` gives two rows of 8.
     The H7 check (same name twice in one block) must still pass.
5. **Q11b #1 (low): mid-block `#=GC` with repeated names.** Fix: do not end the block on `#=GC` when a sequence line
   of the same block follows; or end it only when the next non-`#` line starts a new block. Failing check: the node
   input above (`x ACGT / #=GC RF xxxx / x AC-T ...`) gives two rows `x` of 8 each.
6. **Q15b #2 (low): `>` with no name gives an empty name.** Fix: `fullH || 'unnamed'` at 27778 and 27792. Failing
   check: multi editor, first record line emptied to `>`, Apply; expect a non-empty name.
7. **Q15a #1 (low, older): Rename allows spaces, Save loses everything after the first.** Fix: in
   `_commitSeqRename`, replace whitespace with `_` (as NEXUS names are shown), or refuse it with a message. Failing
   check: rename to `my seq`, Save FASTA text, reload: name stays the same.
8. **Q17 #0 (low, part of M15): Undo of a rename onto an existing name loses that row's colour.** Fix: store the
   overwritten colour in the rename's undo entry, or in `_restoreNameColours` restore `saved.get(n)` also for names
   present before and after when the step was a rename. Failing check: B red, s2 blue, rename s2 -> B, Undo; expect
   B red. Owner decision: M15 part is on the open list.
9. **Q16 #3 (low, cosmetic): a pasted row is named `r12` in an Add & Align error.** Fix: in addSequencesAndAlign keep
   `sourceById` reachable for `_alignIdName` (e.g. a module-level map set while `_alignRowIds` is on). Failing check:
   force the residue-count error for a pasted row; expect its pasted name in the message.

## Needs probe

- `probes/p1_seqedit_names_colours.js` (browser, not run): Q15b #0 and #2 and Q17 #0 through the user path. All three
  are already certain by code; the probe confirms them in the page.
- No finding needs a browser to be settled. Q19 #0 can only be seen on GitHub (two pushes whose test runs finish out
  of order).

Open as UNSURE (owner decision, not code defects): Q19 #1 (manual deploy of a non-main branch: depends on the
environment rule), Q21a static `blast_dbs/` + `snapshots/` without the key, Q21a cookie shared across localhost
ports, Q11b #0 whether such Stockholm files occur.
