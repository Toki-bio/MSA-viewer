# Independent audit: ViewAlign viewer changes, commits b1559ae..981ea71 (v133-v140)

## Why you're being asked to do this

A different AI assistant made a series of bug-fix commits to this repository
over one extended session. Several of those "fixes" were themselves buggy —
in at least one case (v135), a fix for a reported bug introduced a
*different*, worse bug in the same code path, which the assistant reported
as verified/clean. The human user caught it by eye, not through the
assistant's own testing (v139 fixed that specific regression).

**A first round of this audit already happened** (v139 → v140). That auditor
found three real, confirmed issues, and the assistant fixed two of them in
v140 — but investigating the auditor's own top finding turned up that it was
narrower than the true bug: the auditor found "ruler desyncs when Breakpoints
is off"; the actual root cause also silently broke Highlight-diffs mode
entirely, in every configuration, which the first auditor's checklist never
named. **The assistant's own v139 test suite had the identical blind spot as
the bug it was supposed to catch** — it only compared ruler cells that
existed, and said nothing when there were none. That is the single most
important thing to keep in mind doing this round: a fix that makes a named
symptom disappear is not evidence the underlying mechanism is now correct,
and a test that passes may simply not be looking at the right thing.

**Your job is to independently verify whether the current state of the code
is actually correct — not to re-run the previous assistant's test scripts
and trust their output, and not to take any commit message's claims at face
value, including the v140 message that claims to have fixed the previous
round's findings.** Assume every claim in every commit message is unverified
until you personally confirm it against the code and, where possible,
against a real browser. Where you can't verify something, say so explicitly.

## Mandatory methodology: prove your test would have caught the bug

If you write a test for something you believe is now fixed, do not stop
once it passes against the current code. **Revert to the commit before the
fix** (`git stash`, or check out the parent commit in a worktree — do not
leave the working tree in a bad state, ask before doing anything destructive
to the repo) **and confirm your test actually fails there.** If it doesn't
fail against known-broken code, your test isn't testing the thing that
matters — it will pass by construction on both sides of any future
regression, exactly like the assistant's own v139 suite did. This is not
optional rigor; it is the specific gap that let a real bug survive one full
audit-and-fix cycle already.

## Environment

- Repo: `c:\work\MSA-viewer` (also mirrored at
  `https://github.com/Toki-bio/MSA-viewer`, branch `main`)
- Live deployment: `https://toki-bio.github.io/MSA-viewer/` (GitHub Pages,
  serves whatever is on `origin/main`)
- Commit range to audit: `9672739` (state before any of this work started)
  through `981ea71` (current HEAD, tagged internally as v140 via
  `BUILD_TAG` in `script.js`)
- Run `git log --oneline 9672739..981ea71` and `git show <hash>` on each to
  read the full commit messages and diffs yourself — don't rely on the
  summary below being complete or accurate.
- No test framework or CI exists in this repo. If you have browser
  automation available (Playwright, Puppeteer, or similar), use it — write
  your own scripts; the assistant's own scripts live in a scratch directory
  you will not have access to.
- If you have no browser automation available, say so explicitly in your
  report and rely on careful static code reading instead — do not claim
  something "works" if you only read the code and didn't execute it.

## What changed, per the commit messages (UNVERIFIED — confirm each yourself)

1. **b1559ae (v133)**: Display-panel layout wrap when the "Variable sites
   only" threshold controls appear; made "Highlight diffs" and "Variable
   sites only" checkboxes mutually exclusive; made the consensus row respect
   the same `.diff-highlight` visibility class as sequence rows in var-sites
   mode; rounded `setZoom()` to whole pixels; fixed a threshold-label width
   that shifted layout as its value gained digits.
2. **54ecc56 (v134)**: Claimed to fix the scale ruler being stripped to
   breakpoint markers in var-sites mode; exposed the difference-threshold
   slider for "Highlight diffs" mode too, not just "Variable sites only".
3. **7ae590a (v135)**: Claimed to fix ruler position labels ("10", "230")
   tearing apart when only some of their digit-columns were variable, by
   forcing every character in a label to show if ANY of its columns was
   variable. **This introduced a regression, confirmed and fixed in v139**:
   forcing ruler characters to show without also affecting the row/
   consensus rendering caused the ruler to disagree with the actual
   alignment data beneath it.
4. **0b2c7e6 (v136)**: Added `title` tooltips to 61 interactive elements.
5. **92b569d (v137)**: Fixed the threshold number input: empty-value slider
   snap, `step="5"` silently rounding typed values away from what was
   displayed, undersized input box.
6. **6d08e79 (v138)**: Fixed "Variable sites only" being blind to
   insertion/deletion variation — a column where most sequences are gapped
   (consensus = gap) could never register variation even with a large
   minority carrying a real insertion. Verified quantitatively against a
   real 101-sequence dataset (131 vs 601 columns flagged variable at a 1%
   threshold, before/after).
7. **2c77a6b (v139)**: (a) Fixed the v135 regression by reverting to
   per-column ruler-visibility decisions — no label grouping — so a
   multi-digit label may show only one digit rather than tearing or
   desyncing. (b) Changed the default conservation-shading mode from
   "Non-Gap" to "All" (gap-inclusive), because a column where only 30% of
   sequences carry a base, all agreeing, scored 100% "conserved" under the
   old default. (c) Corrected `manual.html` prose that pre-dated this
   session and was independently wrong.
8. **981ea71 (v140), written in response to a first audit round**: (a)
   Fixed the actual root cause behind the auditor's reported "ruler shows
   everything when Breakpoints is off" — the ruler's span-wrapped rendering
   was gated on `state._brkBeforePos.size > 0`, a condition that conflates
   "should hiding/dimming apply to the ruler at all" with "should breakpoint
   marker glyphs be drawn." Investigating this surfaced that Highlight-diffs
   mode never dimmed the ruler either, for the identical reason, in every
   configuration — not reported by the first auditor. Re-gated on
   `state._diffColumns` (non-null whenever either overlay mode is active)
   instead. (b) Fixed three stale `'nongap'` fallback defaults the first
   auditor found (`savePreset`, snapshot capture, RTF export) — confirmed
   unreachable in normal operation but wrong if ever hit. (c) Fixed the
   v139 test suite's own blind spot (see Methodology above), and proved the
   fix empirically: the corrected check run against the pre-v140 code fails
   60 of 100 randomized structural-sweep cases; run against v140, 0 fail.
   (d) **Explicitly left unfixed**: a 0% variable-sites threshold shows
   every column including fully-conserved ones. Confirmed accurate and
   confirmed byte-identical since before this entire body of work started
   (`9672739`). The assistant treated this as a product/UX judgment call —
   does "0%" mean "disable the filter" or "show only columns with ≥1
   difference" — and left it for the human to decide rather than changing
   it unilaterally. Form your own opinion on whether that reasoning is
   sound, and on whether "0% = show everything" is documented anywhere a
   user would actually find it before being confused by it.

## What you should specifically distrust and re-derive from first principles

Do not just check "does the thing the commit message describes now work."
Think about what ELSE reads or writes the same state.

### 1. Ruler / row / consensus column lockstep (v133-v135, v139, v140)

The shared state is `state._diffColumns` (a `Set` of 0-based column indices
considered "variable"), computed once per render near
`// Highlight-diffs + Var-sites: mark columns that differ from consensus` in
`script.js`. At least three code paths read it: `createSequenceLine()`,
`addConsensusLine()`, and `generateScaleHTML()` (the ruler) — and as of
v140, the ruler's decision to call `generateScaleHTML()` at all (versus a
plain-`textContent` fallback with no spans) is gated on `state._diffColumns`
directly rather than on breakpoint state.

- Build several test alignments with deliberately mixed variable/conserved
  column patterns.
- Test **all four combinations** of {Highlight-diffs, Variable-sites-only,
  neither} × {Breakpoints on, off} — the v139 auditor only found the
  Breakpoints-off gap because they thought to test that combination
  specifically; check whether there's a fifth combination nobody has tried
  yet (e.g. both checkboxes toggled in sequence within one session, without
  a full reload in between — `state._diffColumns` is reused/mutated across
  renders and a stale value from a previous mode could leak forward).
- For every column position in every combination, check that the ruler's
  visibility, the consensus row's visibility, and every sequence row's
  visibility agree. Explicitly check the **structural** case, not just
  value agreement: if an overlay is active, does the ruler actually contain
  `<span data-pos>` elements at all, or has it silently fallen back to
  unwrapped plain text again (the exact v140 bug, and the reason the v139
  test missed it)?
- Check Block mode specifically, across multiple blocks, not just Full mode.
- Check that breakpoint markers (`⋮`, class `col-breakpoint`) land at the
  same absolute positions in the ruler as in the rows below.

### 2. The "differs from consensus" logic itself (v138)

Read `_computeConsensusCharForColumn` and the diff-counting loop in
`renderAlignment()` (search `diffCount`) together.

- Verify the formula independently, from source, not from the commit
  message's description of it.
- The 0% threshold behavior (see item 8 above) — decide for yourself
  whether it's a defect, and if you think it is, say so plainly; don't
  just note it as "pre-existing therefore fine."
- A column where NO base reaches 50% plurality (highly polymorphic, no
  actual gaps) — what consensus character does the code assign, and is
  "every sequence differs" the right outcome or a blind spot?
- IUPAC ambiguity codes, lowercase input, sequences shorter than the
  alignment width (implicitly gapped at the end).
- The interaction between "Highlight diffs" and "Variable sites only" —
  mutually exclusive since v133, sharing the same `diffCols` computation;
  confirm the threshold slider gates both correctly in the current code,
  post-v140.

### 3. Conservation shading (v139, v140)

`_computeConservationForColumn` computes conservation differently by
`shadeMode` ('nongap' vs 'all'). v139 changed the primary default; v140
changed three fallback defaults the previous auditor found.

- Grep the whole of `script.js` and `index.html` for `shadeMode` and
  `nongap` one more time — confirm there is truly nothing left, in any
  code path (snapshot restore, preset load, URL-parameter handling, Canvas
  mode, Compact/Reads rendering) that can still resolve to `'nongap'` by
  a path nobody has enumerated yet.
- Verify the math independently with a constructed column of known
  gap/base composition; confirm the rendered CSS class matches prediction
  under both modes.
- Check the Canvas-mode rendering path (`_renderCanvasAlignment`)
  separately — it may resolve its default through a different mechanism
  than the Full/Block path that's been checked twice already.

### 4. The threshold number input (v137)

- Confirm empty-value handling doesn't regress the other sliders sharing
  the same generic code path (Black/Dark/Light shading, Block Size) —
  verify each independently, not by trusting that "it's the same code path
  so it must be fine for all of them."
- Confirm the slider and its paired number input can never disagree after
  a realistic simulated typing sequence (select-all, backspace, type
  digit-by-digit, blur) — not just after a single `.value = X` assignment.

### 5. General

- Run `node --check script.js` and `node --check server.js`.
- Diff `index.html` against `9672739` and check for HTML corruption from
  the v136 tooltip bulk edit: unbalanced tags, orphaned `onclick`
  attributes, duplicated content.
- Confirm `BUILD_TAG` in `script.js`, the cache-bust query string in
  `index.html` (`script.js?v=N`), and the static `#versionIndicator`
  fallback text all agree at v140.
- Check `manual.html` against the actual current code (not just internal
  consistency) — several sections were edited across this session to
  describe features whose behavior also changed in the same commits.

## Output format

Report, for each of the five areas above:
- **What you tested** (exact input data, exact steps, exact browser actions)
- **What you found** (pass/fail per check, not just an overall verdict)
- **For any test you wrote to confirm a fix**: did you verify it against
  the pre-fix commit and confirm it actually fails there? State this
  explicitly per test, not just for the suite as a whole.
- **Any NEW issue** you found that isn't listed above
- **Anything you could not verify** — state this explicitly

Do not soften findings to be diplomatic. Premature confidence is the
specific, named failure mode of this codebase's history so far; the most
useful thing you can do is refuse to repeat it.
