# Handoff: scroll/view glitches in the windowed alignment renderer

**Written for**: Cursor AI (Composer, with Grok/Opus/ChatGPT models available),
taking over from a Claude Code session. **Status as of this handoff**: several
real bugs in this area were found and fixed (see below, all on `main`), but
the user reports the view/scroll still feels "glitchy" after those fixes.
**Your job**: don't assume the previous fixes were wrong — verify them first,
then find what's *still* broken with fresh eyes and real browser testing.

## 0. Orientation — read this first

- App: **ViewAlign / MSA-viewer**, a browser-based multiple-sequence-alignment
  viewer/editor. Single-page app: `index.html` + `script.js` (~17,000 lines,
  the vast majority of the app logic) + `styles.css` + `tree-draw.js` +
  `blast-worker.js` + `server.js` (optional local Express server — not
  required for the app itself, which also runs as a static site on GitHub
  Pages, but required for the `/api/local-cat` local-file-read feature and
  for serving test fixtures locally).
- Repo root: wherever you have this checked out. Public remote:
  `https://github.com/Toki-bio/MSA-viewer`. Live deploy:
  `https://toki-bio.github.io/MSA-viewer/`.
- Run locally: `node server.js` from the repo root, then
  `http://localhost:3000`. Load a specific file via query param:
  `http://localhost:3000/?url=<url-or-local-static-path>` (auto-fetches and
  loads it on page load — very useful for scripted testing, see below).
- **Cache-busting**: `index.html` has `<script src="script.js?v=NNN">` and
  `script.js` has `const BUILD_TAG = 'vNNN';` near the top — these must be
  bumped together on every real `script.js` change (this repo's own git
  history confirms a strict one-bump-per-release convention; it was missed
  for an entire session once, which meant a stale cached copy of the OLD
  script.js kept being served long after real fixes had shipped and looked
  un-fixed). **Bump it before you finish**, or your fixes may not visibly
  take effect for the user even after a hard refresh, and you'll waste time
  chasing "why doesn't my fix work" when the real answer is cache. There's
  also a `version.json` (commit hash + date) surfaced in the UI's version
  indicator — run `bash update-version-json.sh` **as the literal last step**
  before pushing (it commits `version.json` pointing at current `HEAD`, so
  it must run after every other commit, per the comment at the top of that
  script).
- **A broken-test trap that already cost real time this session**: `state`
  (the app's central data object — `state.seqs`, `state.selectedColumns`,
  etc.) is declared with a top-level `const` in `script.js`. Top-level
  `const`/`let` in a classic (non-module) script does **NOT** become a
  `window` property. `page.evaluate(() => window.state...)` in a Playwright
  script will ALWAYS see `undefined`, even when the app is working perfectly
  — this produced an apparent "30-second load time" bug report that was
  entirely a broken test, not a real bug. Always check the bare identifier
  (`typeof state !== 'undefined' && state.seqs...`) inside `page.evaluate`,
  never `window.state`.

## 1. What was already done (chronological, all on `main`)

Read each commit's own message for full detail (`git show <hash>` or
`git log -p <hash> -1`) — they're written to be self-contained postmortems,
not just summaries. Ordered oldest → newest:

| Commit | What |
|---|---|
| `ad1ac08` | Column-range selection was O(cols×rows) DOM mutation; replaced with one CSS rule → ~220x faster. |
| `98eac2c` | GeneDoc edit-mode: moved entry from single-click to double-click (was breaking plain click-drag nucleotide selection). |
| `33c6d4f`, `113ae05` | Unrooted tree: label rotation to branch angle, font size/family, orientation toggle, overlap-grouping. |
| `9b1e935` | Ctrl+C was hijacking native text selection (e.g. copying BLAST result text) even when a real browser text selection existed. |
| `4bd318e`, `caf3b24` | Tree toolbar wrap bug; tree-pan drag was triggering native text-selection highlight (blue) on labels. |
| `8f9f744` | Tree: click-for-info readout + "view subtree" overlay. |
| `a7008b6` | Added one-click "RevComp All" (whole-alignment reverse complement) to the Actions menu. |
| **`da45005`** | **Root cause #1, fixed**: scrolling a large windowed alignment to the bottom showed a blank page / broken scrollbar. Cause: `renderUnifiedWindowedDom`'s `rowHeightPx` fell back to a hardcoded `16px` guess until a real row was measured (actual was `13px` on the test file); that wrong value got baked into the first block's height, and `blockHeightPx` was then *measured from that same wrongly-sized block* — the ~23% error compounded across every subsequent block's `blockTop = blockIndex * blockHeightPx`, drifting into thousands of pixels of misalignment by the last block. Fix: after the first render, compare the *actually measured* row height against what was used; if they disagree, reset the cached block height and rebuild once with the corrected value (a one-shot self-correcting retry, guarded against recursion). |
| **`bd820f8`, `ba82ee3`, `0b4e4d8`** | **Root cause #2, fixed (partially — see §3 below)**: `_refreshUnifiedWindowOnScroll` (runs on every scroll event) used to remove and rebuild every visible row from scratch on every scroll, even though ~85% of rows stay on-screen after a small scroll delta. Profiled directly: ~250–450ms per scroll step, ~85% native layout/style-recalc cost from needlessly destroying/recreating thousands of DOM nodes. Rewrote it to diff: only remove rows that scrolled out of view, only create rows that scrolled in, leave everything else untouched (the standard react-window-style virtualization technique). Result measured: ~85–220ms/step (~2.5–3x improvement) — **real, but not eliminated**, and nowhere near Canvas mode's ~8ms/step (a fundamentally different GPU/canvas rendering path, not a bug — see §4). |
| **`3da54ab`, `0b65684`** | **Root cause #3, fixed both directions**: switching between Canvas mode and Full/Block (DOM) mode reset the scroll position to the top, because `renderAlignment()` does `alignmentContainer.innerHTML = ''` (which resets native `scrollTop` to `0` in every browser) and nothing converted Canvas mode's own pan-offset scroll mechanism (`_canvasState.offsetY/offsetX`, NOT the container's native `scrollTop/scrollLeft`) to/from the DOM modes' native scroll. Added `_captureDomScrollAnchor`/`_applyDomScrollAnchorToCanvas` and the reverse `_captureCanvasScrollAnchor`/`_applyCanvasScrollAnchorToDom`, converting the current view into a mode-independent "row index / column index" anchor and re-applying it after the mode switch completes. Verified landing within 1 row of the exact prior position (a small, acceptable rounding difference between the two modes' slightly different row-pitch measurements), both directions. |
| **`0c732e5`** | **Attempted fix, NOT confirmed — read this one carefully, this is probably your starting point.** Reported: at the bottom of a large alignment, dragging the horizontal scrollbar right snaps back to the leftmost position on the first attempt, works on the second. Found by *code inspection*, not reproduction: the full-block-rebuild path (used whenever a horizontal scroll changes a block's column window) removed the existing block **before** building its replacement — in Full mode (a single block spanning the whole alignment width) this briefly leaves the container with zero real content, and this exact codebase already has a **proven, documented** case of a browser clamping a scroll offset when content momentarily collapses like that (for the *vertical* axis, in the `da45005` fix above). Reordered to build-then-remove. **Three different Playwright reproduction attempts (direct `scrollLeft` assignment, synthetic `scroll` event dispatch, and a real `pointerdown`/`pointermove`/`pointerup` drag simulation) all failed to reproduce the exact snap-back-then-recover symptom in headless Chrome** — so this fix is a real, safe, well-motivated code improvement, but was never confirmed to actually be the cause, or to have fixed it. |
| `50ae301`, `7ea1007`, `c26f759` | Cache-busting version bump to `v180` + `version.json` update (see §0 above — this had been silently stale since 2026-08-21 across many real commits before this session). |

**The user's most recent message, verbatim, after all of the above shipped**:
*"still glitchy view and scroll"* — no further specifics given. This is why
you're reading this document: the previous session's fixes are real
(verified via direct measurement/screenshots for everything except the last
one), but something in this area is still visibly wrong to the user, and it
either (a) wasn't covered by the fixes above, (b) is a genuinely different
bug in the same neighborhood, or (c) — check this first — **the user may
still be looking at a stale cached page** (see §0's cache-busting note; ask
them to hard-refresh, Ctrl+Shift+R, before assuming anything is still
broken code-side).

## 2. Where the relevant code lives (current line numbers, `script.js`)

- `_removeNodesBetweenSpacers` — `~1912`. Mostly vestigial now (see below).
- `_buildUnifiedBlock` — `~2102`. Builds one block's DOM: ruler, optional
  consensus line(s), row-windowed sequence rows, row spacers. Computes its
  own `colStart`/`colEnd` (visible+overscan column range) and
  `rowStart`/`rowEnd` (visible+overscan row range) fresh every call.
- `_incrementalUpdateBlockRows` — `~2231`. The new (this-session) helper:
  patches an *existing* block's rows in place (remove out-of-range, add
  newly-in-range, leave the rest alone) instead of rebuilding everything.
- `renderUnifiedWindowedDom` — `~2282`. The *initial* full paint entry point
  for windowed (large) alignments. Has the self-correcting row-height retry
  from the `da45005` fix.
- `_refreshUnifiedWindowOnScroll` — `~2377`. Runs on every scroll event
  (bound via `_setupUnifiedScrollListener`/`_unifiedScrollController`). This
  is the hot path that was rewritten for incremental diffing. Per visible
  block: decides whether to patch in place (`_incrementalUpdateBlockRows`,
  requires the column window to be *unchanged* since last render) or do a
  full rebuild (build-then-remove ordering, per the `0c732e5` fix).
- `renderAlignment` — `~5826`. The single entry point that (re)builds the
  *entire* alignment view for whatever mode is active — dispatches to
  Canvas, windowed DOM, or classic (small/non-windowed) DOM rendering.
  Always does `alignmentContainer.innerHTML = ''` (source of the mode-switch
  scroll-reset bug, `3da54ab`/`0b65684`).
- Size classification constants — `~7127-7137`:
  `ALIGN_TALL_SEQ_THRESHOLD = 500` (sequences), `ALIGN_LONG_COL_THRESHOLD =
  3000` (columns), `ALIGN_CRAZY_VOLUME = 5_000_000` (residues — triggers the
  "large alignment, proceed anyway?" dialog and defaults to Canvas mode),
  `ALIGN_WINDOWED_DOM_THRESHOLD = 500_000` (residues — below `CRAZY` but
  above this, Full/Block mode still uses the windowed renderer, not the
  classic full-DOM-build path).
- `onModeChange` — `~7765`.
  Dispatches size-warning dialogs, then calls `renderAlignment()`, then
  applies the scroll anchor conversion (`_captureDomScrollAnchor` /
  `_applyDomScrollAnchorToCanvas` / `_captureCanvasScrollAnchor` /
  `_applyCanvasScrollAnchorToDom`, all defined just above it).
- `_canvasState` — search for it (top-level object, `offsetX`/`offsetY`/
  `rowPitch`/`metrics`/`scheduleDraw`/`onOffsetChange`/etc.). Canvas mode's
  entire scroll state — a synthetic pan offset, **not** related to
  `alignmentContainer.scrollTop/scrollLeft` at all. Driven by
  `setupPersistentScrollbar`/`setupPersistentVerticalScrollbar` (search for
  those — they implement the *visible custom scrollbar* that appears only
  in Canvas mode, syncing `_canvasState.offsetX/offsetY` to/from that bar's
  own native `scrollLeft/scrollTop`).

## 3. Test fixture and repro harness (already in this repo)

**`dev-tools/scroll-perf-tests/`** — Playwright-core scripts built during
the previous session, kept in the repo so you don't have to rebuild this
from scratch. **Read `dev-tools/scroll-perf-tests/README.md` first.** It
covers: how to get the test fixture (a real 621-seq/1928-col alignment,
fetched from a public GitHub raw URL, not committed to this repo — it's a
third-party file), which script checks which symptom, and the `window.state`
trap from §0.

**Use these to verify BEFORE and AFTER any change you make.**
`test_correctness_after_scroll.js` in particular is cheap insurance against
introducing a content-correctness regression while chasing a performance fix
— run it after every change to the windowed-DOM renderer, not just at the
end.

## 4. What "glitchy" might still mean — starting hypotheses, not conclusions

Investigate these, but do NOT assume any of them is *the* answer without
reproducing it first (real screenshots, real measured numbers — the standard
this whole codebase's commit history holds itself to; see how thoroughly
"suspicion → wrong" was documented in `0c732e5`'s honest failure-to-reproduce
above, and the "$1.2M residues took the browser 30 seconds to load" claim
in an earlier session that turned out to be a broken test, not a real bug —
both worth reading in full git history as a caution against reporting a
theory as a fix):

1. **The `0c732e5` fix might genuinely not be the cause.** Do real mouse-drag
   testing (a real OS-level drag via Playwright's `page.mouse`, or — better —
   manual testing in an actual browser window with DevTools open, watching
   `alignmentContainer.scrollLeft` / `.scrollWidth` live during the drag) at
   the exact bottom-of-alignment, drag-right scenario the user described.
2. **~85-220ms/scroll-step (post-`0b4e4d8`) may still feel "glitchy"** even
   though it's a real improvement over ~250-450ms — it's still far from
   60fps-smooth (16ms/frame). If the user's complaint is really "scrolling
   still isn't smooth," that's not a residual bug so much as an
   acknowledged, documented limitation of DOM-based rendering vs Canvas mode
   (see `0b4e4d8`'s commit message) — the honest options are (a) push the
   incremental-diff optimization further (there's real headroom — profile it
   again, see what's left; last profile showed remaining cost in repeated
   `querySelector`/`querySelectorAll` calls inside `_incrementalUpdateBlockRows`,
   which could likely be reduced by tracking row elements in a `Map` instead
   of re-querying the DOM on every add/remove), or (b) recommend Canvas mode
   for pure viewing (already fast, already shipped, not a fix but a
   workaround) and be upfront that DOM-mode parity with Canvas isn't
   realistic without abandoning per-residue DOM spans entirely (see the
   JBrowse2/UGene research already done — grep this repo's
   `features-inventory.md` and ask the user for
   `C:\work\glm-harness\out\jbrowse-rendering-tricks.json` if you need the
   full prior research on GPU-instanced rendering as an alternative
   architecture, out of scope for a quick fix).
3. **A genuinely new/different bug** in an adjacent area not covered above —
   e.g. interaction between the incremental row-diff and column selection
   drag, or resize-driven re-renders, or zoom-level changes mid-scroll.
   Nothing here rules this out; the fixes above were narrowly scoped to
   what was specifically reported and reproduced.
4. **Ask the user for more specifics if you get stuck** — "still glitchy" is
   not enough to act on blindly. A screen recording, or even just "does it
   still happen in Canvas mode too, or only Block/Full," would immediately
   narrow this down a lot. Don't burn a lot of budget guessing before asking.

## 5. Using glm/aider (the user's preferred cheap-execution path)

The user has a working `aider-chat` + `glm-5.2` setup and prefers it for
well-scoped implementation work, reserving expensive AI sessions (like the
one that produced this handoff) for diagnosis/design/verification. Use this
for anything you can specify precisely; don't use it to "figure out" an
ambiguous bug — that wastes its (real, metered) budget the same way it would
yours.

**Location**: `C:\work\glm-harness\` (playbooks: `AIDER-PLAYBOOK.md`,
`GLM_PLAYBOOK.md`). Read `AIDER-PLAYBOOK.md` in full before your first
invocation — the summary below omits some detail.

**Critical rules, from hard-won experience this session and before:**

1. **Never expose the API key.** It's at `C:\work\glm-harness\.key`
   (gitignored). Source it without printing it:
   ```bash
   export OPENAI_API_KEY="$(cat "C:/work/glm-harness/.key")"
   export OPENAI_API_BASE="https://api-llm.gpu.uz/v1"
   export BROWSER=/usr/bin/true   # prevents an aider bug from spamming Chrome tabs on API errors
   ```
2. **Always work in an isolated git worktree**, never directly against
   `main`:
   ```bash
   cd C:/work/MSAviewer_github
   git worktree add ../MSAviewer_github-<short-task-name> -b <branch-name>
   ```
   Review the diff yourself, merge with `git merge --ff-only <branch>` only
   after you're satisfied, then `git worktree remove` + `git branch -d` to
   clean up. `node_modules` isn't in a fresh worktree (gitignored) — either
   symlink it from the main checkout or run a temporary local server on a
   different port (`server.js`'s `PORT` constant is hardcoded to `3000`, not
   env-overridable — edit it locally for testing, never commit that edit).
3. **Always pass these flags** on a file this size (`script.js` is ~17K
   lines):
   ```bash
   python -m aider \
     --model openai/glm-5.2 \
     --no-git-commit-verify \
     --yes-always \
     --edit-format diff \
     --map-tokens 0 \
     --no-check-update \
     --no-show-model-warnings \
     --message-file "<path-to-task-file>.md" \
     --file script.js \
     --exit
   ```
   `--edit-format diff` is non-negotiable — without it, aider defaults to
   "whole file" mode for a model it doesn't recognize, meaning glm-5.2 has
   to reproduce the ENTIRE 17,000-line file in its response. This looked
   like a 10+ minute hang the first time it happened; it wasn't stuck, it
   was streaming a full-file dump one token at a time.
4. **Split into small, single-function tasks.** A task that tries to do too
   much in one shot (e.g. "rewrite this whole 60-line function") can burn
   its *entire* output-token budget narrating its own whitespace-matching
   process and never actually emit an edit — confirmed directly this
   session: a first attempt at the incremental-row-diff rewrite did exactly
   this (zero edits, budget exhausted mid-narration). The fix that worked:
   explicitly instruct it not to narrate, and split the work into small,
   independently-testable steps (e.g. "add this one small tracking variable"
   → "add this one new self-contained function" → integrate the two
   yourself if the integration itself is delicate/high-stakes). Concretely,
   put this at the top of every task file:
   > "IMPORTANT — output format: do not narrate your matching process, do
   > not quote existing code back to 'verify' it, don't think out loud
   > about whitespace. Read the file, then go straight to SEARCH/REPLACE."
5. **Verify what it actually did — never trust its own summary.** After
   every run: `node --check script.js` (syntax), `git diff` (read the real
   diff, not aider's prose description of it — it has previously described
   an edit accurately in prose while the diff itself needed spot-checking
   for a subtle parameter-ordering issue), and re-run the relevant test(s)
   from `dev-tools/scroll-perf-tests/`.
6. **Where to draw the line between "give this to aider" and "do it
   yourself"**: mechanical, well-specified, self-contained changes (add a
   tracking variable, add one new pure function with a fully-specified
   signature and body) are good aider tasks. Anything touching multiple
   interacting invariants at once — DOM ordering across elements, spacer/
   layout math, cross-subsystem state handoffs (like the Canvas↔DOM scroll
   anchor conversion) — is exactly the kind of thing that's cheap for you to
   verify but expensive to *specify precisely enough* for an autonomous
   patch to get right blind; those were done directly in the previous
   session rather than delegated, and that division of labor is
   deliberate, not a cost-cutting shortcut you should reverse.

## 6. A ready-to-use starting prompt (paste this into Cursor's Composer)

```
Read C:\work\MSAviewer_github\CURSOR_HANDOFF_SCROLL_PERF.md in full before
doing anything else - it has the context, prior fixes, exact code locations,
and the test harness you need.

The user reports the alignment viewer's scroll/view still feels "glitchy"
even after the fixes documented in that handoff. Your task:

1. Start the app (`node server.js` from the repo root) and get the test
   fixture per dev-tools/scroll-perf-tests/README.md.
2. Re-verify each of the fixes listed in the handoff's "what was already
   done" table ACTUALLY holds right now, using the scripts in
   dev-tools/scroll-perf-tests/ - don't trust the commit messages, run the
   checks yourself, this session's fixes were verified when written but
   things can regress.
3. Do fresh, hands-on investigation of what's still wrong - real
   screenshots, real profiling (Chrome DevTools Protocol Profiler via
   Playwright's CDPSession, see profile_scroll.js for the pattern), a real
   mouse-drag test on the horizontal scrollbar at the bottom of a large
   alignment specifically (the one prior fix, commit 0c732e5, that was
   never confirmed to actually work).
4. If you find a real, reproducible bug: fix it directly if it's a
   delicate/multi-invariant change (DOM ordering, layout math, cross-mode
   state handoffs), or delegate a well-scoped, precisely-specified piece of
   it to aider+glm-5.2 per the handoff's §5 if it's mechanical - your call,
   but justify the choice either way, matching the division of labor the
   handoff describes.
5. Before declaring anything fixed: bump the cache-busting version
   (index.html's `?v=NNN` + script.js's `BUILD_TAG`, together, +1 from
   current), run `bash update-version-json.sh` as the LAST commit before
   pushing, and report exactly what you verified and how (screenshots,
   measured numbers) - not just a description of what you changed. If you
   could NOT reproduce something, say so explicitly rather than presenting
   a plausible-sounding fix as confirmed, the same way commit 0c732e5's own
   message does - that honesty is more useful to the user than false
   confidence.

Ask the user for a screen recording or more specific repro steps if you get
stuck after real investigation - don't guess indefinitely on "still glitchy"
alone.
```
