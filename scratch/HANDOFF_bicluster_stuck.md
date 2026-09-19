# Handoff: block-bicluster.js visualization is not working, and I don't know why

I (the previous AI on this task) am stuck. I have made ~10 rounds of real,
individually-verified bug fixes to this algorithm over one long session, each
one checked against a regression oracle and a synthetic test sweep before being
called "done" — and the user still says the live result "doesn't work" after
the latest fix, with no further detail. I do not know what is still wrong. I am
handing this off rather than continuing to guess. Please read this whole
document before touching any code.

## Where everything is

- **Repo**: `C:\work\MSA-viewer` (git remote: `https://github.com/Toki-bio/MSA-viewer`, branch `main`)
- **Live deployed site**: `https://toki-bio.github.io/MSA-viewer/` (GitHub Pages, auto-deploys from `main`, typically live ~30-60s after a push — poll `curl -s https://toki-bio.github.io/MSA-viewer/index.html | grep 'script.js?v='` against the version you just bumped before telling the user something is live)
- **The algorithm under development**: `C:\work\MSA-viewer\block-bicluster.js` — a from-scratch row/column-symmetric "biclustering" algorithm for multiple sequence alignments (no privileged reference row, unlike the older `block-mask.js` in the same repo). Pure functions, no DOM, Node-testable directly.
- **Live UI wiring**: `C:\work\MSA-viewer\script.js`, functions `applyBiclusterLive()`, `_biclusterCoherenceToType()`, `computeAndShowBicluster()` (search for `bicluster` case-insensitively — everything bicluster-related is grouped together, right after the older `applyBlockMaskLive` function). The overlay is drawn by `renderBlockMaskOverlay()` (shared with the old algorithm) as SVG rectangles layered on top of the real ViewAlign DOM.
- **UI location for the user**: Clustering menu → scroll past "2D block mask (squint view)" (the OLD algorithm's UI) → **"Bicluster (experimental, no reference row)"** section → Show bicluster / Clear / Group rows buttons.
- **`?url=` query param**: ViewAlign supports loading any FASTA by URL, e.g.
  `https://toki-bio.github.io/MSA-viewer/?url=<raw-github-url>&title=<name>` —
  useful for handing the user a one-click link instead of a local file path.
- **Full validation history/design log**: `C:\work\MSA-viewer\tests\bicluster\VALIDATION_PLAN.md` — every bug found, every fix tried (including the ones that were tried and REVERTED because they regressed something), with real before/after numbers. **Read this in full before changing anything** — several plausible-looking "fixes" were already tried and measured to make things worse; the log says exactly which ones and why.
- **Regression oracle**: `C:\work\MSA-viewer\tests\bicluster\oracle.js` — run with `node tests/bicluster/oracle.js` from the repo root. Must print `PASS: all oracle checks passed` before and after any change.
- **Synthetic validation sweep**: `C:\work\MSA-viewer\tests\bicluster\run_validation.js` — run with `node tests/bicluster/run_validation.js` (takes a few minutes). Appends a fresh results section to `VALIDATION_PLAN.md` every time it's run — don't be confused by multiple appended "Results" sections, the latest one at the bottom is current. As of the last commit: Stage 0 = 44/45, Stage 1 = 26/108, Stage 1b = 11/12, Stage 2a = mixed (documented as intentional), Stage 2b = exact/exact/true.
- **Known-good ground-truth fixtures** (check these FIRST, always, before touching anything else):
  - `C:\work\MSA-viewer\tests\fixtures\blockmask\testsets\clean_core.aln.fa` — must show **zero** row-split blocks (`BC.computeBiclusterMask(fasta,{}).blocks.filter(b=>b.rows!=='all').length === 0`).
  - `C:\work\MSA-viewer\tests\fixtures\blockmask\testsets\mosaic_subset.aln.fa` — must show **exactly** two row-split blocks at cols 151-261: a 5-row group `[0,1,2,3,4]` with real evidence, and a 15-row background group (currently correctly shows `coherence: null`, meaning "no internal pattern," which is the CORRECT answer for that group, not a bug).
- **The real biological file this whole feature is ultimately for**: `C:\work\MSA-viewer\tests\fixtures\blockmask\testsets\oma_SINE16b_realigned.aln.fa` (50 rows, ~1663 columns) and its similarity-reordered twin `oma_SINE16b_realigned_reordered.fa` in the same folder.
- **The small test alignment the user has been insisting on working with** (their explicit, repeated instruction: "we must work on a small sample alignment not hundreds or thousands of columns"):
  `C:\work\MSA-viewer\scratch\small_singleton_test.fa` (50 rows × 53 columns, a column-narrowed crop of the real file preserving all 50 rows) and its similarity-reordered twin `small_singleton_test_reordered.fa` in the same folder. This is what most of the last several hours of debugging happened on. **Use this file, not the full real file, until it is fully sorted out.**
- **`C:\work\MSA-viewer\scratch\` in general**: scratch/debug files accumulated this session — cropped regions, an HTML comparison artifact, a couple of JSON dumps. Not all of it is still relevant; `small_singleton_test.fa`/`_reordered.fa` are the important ones.

## What the algorithm does (one paragraph)

`block-bicluster.js` recursively splits an alignment (rows × columns matrix)
into rectangular "blocks." At each step it tries either a column split
(`bestColumnSplit`, using variance reduction) or a row split (three competing
methods: `_gapRowSplit`, `_haplotypeRowSplit`, `_diagnosticRowSplit` — the
last one is a port of this app's own working "Cluster Now" feature in
`cluster.js`), and recurses on whichever helps more. The idea is a
"bicluster": a specific row subset that shares a specific column-range pattern,
with no single row treated as a privileged "reference" (which the older
`block-mask.js` algorithm does, and which this project was explicitly built to
avoid).

## What's been fixed this session (all verified, all in VALIDATION_PLAN.md)

In roughly chronological order, each of these was a REAL bug, confirmed with
before/after data, not a guess:

1. A "gain" formula for column splits that was mathematically unable to ever
   detect anything (averaging two partition means ≈ the whole's mean by
   definition) — fixed via variance-reduction instead.
2. A merge-pass that undid correct splits immediately after finding them.
3. Row-split methods being fooled by small-sample chance agreement (e.g. 5 rows
   over a 5-symbol alphabet trivially agreeing by pigeonhole, not real signal).
4. A "window scan" fix for one structural blind spot (couldn't find a real
   signal buried inside a wide, mostly-irrelevant column range) that
   ALSO introduced a NEW false-positive problem, which needed its own fix.
5. **Gap-as-conservation-signal bug**: a column where most rows simply share a
   GAP (haven't reached real sequence yet) was being scored as if that were
   real conservation, as strong as agreeing on an actual base. Fixed by
   requiring the "dominant" state to always be a real base, never a gap.
6. **The mirror-image bug (3a below) that #5 introduced**: a column where
   EVERY row is gap (zero real data) started scoring as "0% conserved"
   instead of "no data here," dragging scores down artificially. Fixed.
7. **Singleton leaves**: `MIN_BLOCK_ROWS=3` was not actually enforced by the
   recursion's own stopping condition, so a group of literally 1 row could
   surface as its own "cluster." Fixed at the algorithm level
   (`_mergeUndersizedLeaves`), but an EDGE CASE of this (an isolated leaf with
   no same-range sibling to merge into) still slipped through and needed a
   second, display-level backstop fix in `script.js`.
8. **Null-coherence phantom leaves**: same root cause as #7, different trigger
   (a group that is literally all-gap everywhere, zero measurable evidence,
   still rendering as a colored "find").
9. **Identical-rows-in-different-groups**: two rows that read byte-identical
   over a leaf's own column range were sometimes placed in DIFFERENT sibling
   groups by independent recursive branches. Took **three** iterations to
   actually fix (documented in full, including the two wrong attempts and
   why each one failed to move the needle, in VALIDATION_PLAN.md).
10. **Duplicate-locus double-counting**: two rows in a real fixture were the
    SAME genomic locus extracted with two different end coordinates (a known
    artifact of how this project's test fixtures were built), silently
    doubling that locus's apparent evidentiary weight. Took **two** more
    iterations (tried matching by raw sequence content instead of header
    coordinates, twice, and had to revert both times — full detail in the
    log — before landing on header-coordinate overlap as the correct signal).
11. **Merged leaves never re-validated**: a leaf can be the end product of
    several earlier merge passes without ever being re-checked as a whole
    against the real acceptance bar. Also took multiple iterations (naive
    fixes destroyed a real, known-good signal twice before landing on "only
    merge a failing group into another ALSO-failing group, never into one
    with real evidence").
12. Rendering-only fixes: isolated single-row visual "runs" of an otherwise
    multi-row scattered group were rendering as solid boxes instead of
    dashed/scattered warnings; fixed to always dash a lone-row run.
13. Added a "Group rows" button to the new Bicluster UI panel (reordering rows
    so a chosen zone's groups become visually contiguous), reusing an existing
    function (`groupRowsByBlockMask`) built for the old algorithm — confirmed
    via headless-browser test that it works unmodified on the new algorithm's
    output too, since both write to the same shared `state.blockMask`.

**Every single one of the above was independently confirmed** (not just
code-reviewed) via: `node tests/bicluster/oracle.js`, a fresh run of
`tests/bicluster/run_validation.js`, direct checks against the two ground-truth
fixtures, and — for anything UI-facing — a real headless-browser run using
`playwright-core` (already installed; see "How to test in a real browser"
below) rather than just reading the code and assuming it works.

## Where it's actually stuck right now

After fix #13 (the Group rows button), the user tried it live and said:

> "no it doesnt [work]."

**I do not know what specifically is still wrong.** I have no further detail
from the user beyond that one line, and I could not get a screenshot or a more
specific description before this handoff was requested. My own last
verification (headless browser, not the live UI) showed `groupRowsByBlockMask`
successfully reordering `state.seqs` so that a chosen block's ~22 member rows
appeared contiguously in the array — but I did not go on to verify that the
**rendered SVG overlay** actually then draws ONE solid rectangle for that
group instead of several small ones, which is the thing that actually matters
visually and which I never directly confirmed. That is the most likely next
thing to check.

There is also an open, deeper, and possibly more important complaint from the
user earlier in this session (verbatim, paraphrased slightly): even IGNORING
the rendering/contiguity problem, several of the "found" groups have very thin
evidentiary support — e.g. two rows that differ by a SINGLE nucleotide out of
only 6 real (non-gap) bases total ended up in two completely different
groups, one scoring a "strong" 0.93 and the other unsupported/null. This is a
sample-size problem (rows with very few real, non-gap positions probably
should not be clustered with high confidence at all) that has **not** been
investigated or fixed. It may be a more fundamental issue than the rendering
one.

**My honest assessment**: I do not know if the remaining problem is (a) purely
a rendering/contiguity issue that "Group rows" doesn't fully solve for some
reason I haven't found, (b) the small-sample-size clustering-confidence issue
above, (c) some other bug I have not found yet, or (d) some combination. I have
been fixing real, confirmed bugs one at a time for a very long session and each
fix has revealed another one; I no longer have confidence that this pattern
will converge, and I think a fresh perspective (or a fundamentally different
approach to the row-clustering methods, or possibly abandoning the "rectangle"
visual metaphor entirely in favor of something that doesn't imply contiguity)
is more likely to help than another round of "find one more bug and fix it."

## How to test in a real browser (do not skip this — code review is not enough)

This project already has a working headless-Chrome pipeline via
`playwright-core`. Chrome is installed at
`C:\Program Files\Google\Chrome\Application\chrome.exe`. From any scratch
directory:

```bash
npm install playwright-core --no-save
```

```js
const { chromium } = require('playwright-core');
const path = require('path');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const indexPath = path.resolve('C:/work/MSA-viewer/index.html');
  await page.goto('file:///' + indexPath.replace(/\\/g, '/'), { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('#fileInput').setInputFiles(
    path.resolve('C:/work/MSA-viewer/scratch/small_singleton_test.fa')
  );
  await page.waitForTimeout(2000);
  await page.evaluate(() => computeAndShowBicluster());
  await page.waitForTimeout(1000);
  await page.evaluate(() => groupRowsByBlockMask());
  await page.waitForTimeout(500);
  // NEXT STEP THAT WAS NOT DONE: inspect the actual <rect> elements in
  // .block-mask-layer SVGs after Group rows, to see whether a chosen
  // block's member rows now render as ONE contiguous rect or still several.
  await page.screenshot({ path: 'after_group_rows.png', fullPage: false });
  await browser.close();
})();
```

Note: `state`, `computeAndShowBicluster`, `groupRowsByBlockMask` etc. are
top-level `const`/function declarations in `script.js`, loaded as a plain
(non-module) `<script>` tag — they are visible as bare identifiers inside
`page.evaluate()`'s execution context, but **NOT** as `window.state` etc.
(a `const` at top level of a classic script does not attach to `window`).
This tripped up an earlier test in this session; don't repeat it.

Also note: `page.goto('file:///' + path.replace(/\\/g, '/'))` inside a Node
`-e` string via Bash has repeatedly hit shell-escaping issues with the
backslash-regex — write it to a `.js` file with the Write tool and run that,
don't try to inline it as a `bash -c "node -e ..."` one-liner.

## Cache-busting (do not forget this, it caused real confusion earlier)

`index.html` loads `script.js` and `block-bicluster.js` with a `?v=N` query
string for cache-busting:

```
<script src="script.js?v=193"></script>
<script src="block-bicluster.js?v=10"></script>
```

**Every time you change either file, bump its own `?v=` number and push
BOTH the code change and the version bump before telling the user something
is live.** Forgetting this was a real, repeated problem this session — the
user saw a stale cached version and (correctly) reported bugs that were
already fixed in the not-yet-loaded code. After pushing, poll:

```bash
curl -s https://toki-bio.github.io/MSA-viewer/index.html | grep -o 'script.js?v=[0-9]*'
```

until it shows the new number (GitHub Pages deploy typically takes
~30-90 seconds) before telling the user to reload.

## Standing rules the user has stated explicitly and repeatedly (do not violate these)

Quoting the user directly, since paraphrasing has apparently lost nuance
before:

1. **"this will be my universal message: have you checked? everything is ok?
   ok, describe first rectangle block: exact coordinates in alignment, exact
   features to combine it. single line cannot be a group. we must work on a
   small sample alignment not hundreds or thousands of columns. give me
   direct link to alignment"** — treat this as a real, standing checklist to
   run through every time, not a one-off request. It means: (a) actually run
   the oracle + sweep + ground-truth checks before claiming anything is fine,
   never just assert it; (b) be able to give the EXACT column range and a
   real per-column character table for whatever block you're discussing, not
   just a coherence number; (c) a group of 1 row (or, as this session later
   established, ANY group with `coherence: null`) is never a real finding;
   (d) work on `small_singleton_test.fa`, not the full ~1663-column real
   file, unless specifically asked to check the full file; (e) always give a
   working, clickable `?url=`-based link, not just a local path.
2. **"single line cannot be a group"** — repeated multiple times across
   different specific bugs (an actual 1-row leaf; later, a visually-isolated
   single-row-height rectangle from a scattered multi-row group rendering
   without the dashed "scattered" warning stroke). Both were real, distinct
   bugs, fixed separately. If you see anything that looks like a single row
   being presented as its own finding, in ANY form, it needs to be either
   fixed or the user needs to be shown it's already handled — never assumed
   fine.
3. **Always reorder sequences by similarity before handing the user any
   alignment file or link to look at.** This was violated multiple times
   early in the session and the user had to say so more than once. There is
   a memory file about this at
   `C:\Users\T\.claude\projects\c--work-alsu\memory\feedback_always_reorder_alignments_by_similarity.md`
   if the AI picking this up has access to that memory system; if not, just
   follow the rule directly. A simple greedy nearest-neighbor-by-pairwise-distance
   chain (example code is in `VALIDATION_PLAN.md`'s git history / this
   session's earlier work, or can be re-derived trivially) is enough — the
   point is: never hand over a raw-order FASTA.
4. When something is wrong, **fix the actual underlying cause** (the
   algorithm, or if it's truly display-only, the specific rendering logic),
   not a symptom. This session repeatedly made the mistake of patching
   `script.js`'s display/coloring logic first, only to have the user
   correctly point out the real bug was still in `block-bicluster.js`
   itself, producing bad data that any display layer would eventually
   mis-render one way or another. When genuinely unsure whether something is
   a display issue or a data issue, CHECK (e.g. call
   `BC.computeBiclusterMask(fasta,{})` directly in Node and inspect the raw
   block list) before assuming either way.
5. The user has become visibly frustrated with repeated back-and-forth where
   a claimed fix turns out to be incomplete. Do not report something as
   fixed/working without independent verification (oracle + sweep + ground
   truth fixtures + a real browser check for anything UI-facing, not just
   "the code looks right").

## Suggested concrete next steps (my best guess, not a confident plan)

1. First, actually verify or refute my last unconfirmed claim: does
   `groupRowsByBlockMask()` + the SVG overlay renderer actually produce ONE
   contiguous rectangle for a grouped block, or does it still fragment for
   some reason (e.g. it only reorders by the FIRST zone found, and the
   overlay is being viewed at a DIFFERENT zone/column range that wasn't the
   one grouped by)? Test this directly and look at the actual rendered
   pixels/rect elements, not just the reordered array.
2. Consider whether "reorder rows once per zone, view one zone at a time" is
   even a workable UX for an alignment with 60+ candidate blocks (the real
   file has that many) — it might not be, and a completely different
   visualization (e.g. a dendrogram, or per-block small-multiple crops
   instead of one big overlay) might be the actual right answer, not a further
   patch to the rectangle-overlay approach.
3. Separately and regardless of (1)/(2): investigate the small-sample-size
   clustering confidence issue (rows with very few real bases getting
   confidently sorted into wildly different-scoring groups off one SNP).
   This may need a hard minimum-real-positions floor before a row is allowed
   to strongly influence or be strongly assigned to any group at all —
   something like: if a row has fewer than N real (non-gap) positions in a
   given column range, always route it to the ambiguous/residual side of any
   split. Would need to be added consistently across `_gapRowSplit`,
   `_haplotypeRowSplit`, and `_diagnosticRowSplit`, and validated against
   `run_validation.js` + the ground-truth fixtures the same way as every
   other change in this file's history.

Good luck. I mean that sincerely and not as a formality — I was not able to
close this out and I think it deserves a genuinely fresh look rather than
another incremental patch from someone anchored to the same mental model I've
been stuck in for hours.
