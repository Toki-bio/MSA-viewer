# ViewAlign vs Galaxy MSA plugins: benchmark harness

Black-box comparison of three browser MSA viewers on identical files, same headless Chrome,
same load path a user (or Galaxy) uses. Run 2026-11-06 in a 2-CPU Linux container, no GPU
(WebGL = SwiftShader software). See `docs/sessions/2026-11-06-galaxy-msa-comparison.md`
for findings.

| Viewer | Source tested | Load path |
|---|---|---|
| ViewAlign (`va`) | this repo at `84acbc9` (main, 2026-11-05) | `index.html?url=<dataset>&title=` |
| ViewAlign patched (`va_fix`) | same + `viewalign-perf-fixes.patch` | same |
| AV 2.0 (`av2`) | npm `@galaxyproject/alignmentviewer@0.0.3` (`package/static`) | Galaxy host page emulated: `#app[data-incoming]` -> `api/datasets/<id>/display` |
| alignment.js (`ajs`) | npm `@galaxyproject/alignment@0.0.9` (`package/static`) | same |

## Layout the scripts expect

Paths are hard-coded to `/home/claude/bench` (`B`). Change `B` / `BASE` at the top of each
script, or recreate this layout:

```
B/
  scripts/            # this folder's scripts/
  src/va/             # git clone of this repo (main)
  src/va_fix/         # copy of src/va with the patch applied (patch_va.py does it)
  src/gx_av2/         # npm pack @galaxyproject/alignmentviewer; tar xzf; cp -r package/static
  src/gx_ajs/         # npm pack @galaxyproject/alignment;      same
  data/               # generated FASTA (not committed: 120 MB), see below
  out/shots/          # screenshots
  node_modules/       # npm i playwright-core@1.63.0 (drives system Chrome)
```

## Steps

```bash
# 1. test data (seeded, deterministic): subfamilies, 3-15% divergence, indels, 5' truncation
for spec in "nt 1000 300 nt_1k_x300" "nt 10000 300 nt_10k_x300" "nt 50000 300 nt_50k_x300" \
  "nt 2000 6000 nt_2k_x6000" "nt 500 50000 nt_500_x50k" "aa 1000 400 aa_1k_x400" \
  "aa 10000 400 aa_10k_x400" "aa 50000 400 aa_50k_x400" "aa 100000 400 aa_100k_x400" \
  "nt 250 50000 nt_250_x50k" "nt 1250 20000 nt_1250_x20k"; do
  set -- $spec; python3 scripts/gen.py $1 $2 $3 data/$4.fa; done
# 2. server (static + Galaxy dataset API emulation) on 127.0.0.1:8765
node scripts/server.js &
# 3. one run -> one JSON line
node scripts/bench.js nt_1k_x300 va 1
# 4. full matrix (9 datasets x 3 viewers x 3 reps) and summary
scripts/run_all.sh > out/results.jsonl; python3 scripts/summarise.py
# 5. patched ViewAlign: build copy, prove equality, A/B, completion times
python3 scripts/patch_va.py src/va/script.js src/va_fix/script.js
node scripts/equal_va.js; scripts/run_fix.sh > out/results_fix.jsonl
node scripts/compute_va.js va aa_100k_x400; node scripts/compute_va.js va_fix aa_100k_x400
```

## Metrics (bench.js)

- `readyMs`: navigation -> alignment on screen (per-viewer DOM check) + 2 rAF. ViewAlign's
  "Proceed?" dialog is clicked immediately (`proceedDialog: true` in the output).
- `interactiveMs`: main thread free of long tasks for 1 s.
- `heapMB`: CDP `JSHeapUsedSize`; `domNodes`: CDP `Nodes` (includes text nodes and detached).
- `scroll_v` / `scroll_h`: 40 real `mouse.wheel` events over the largest matching panel;
  rAF frame intervals (median, p95, max, frames > 50 ms); `moved` = screenshot hash changed.

## Known limits

- **AV 2.0 scroll numbers are invalid here**: it renders with WebGL (pixi.js); without a GPU,
  82% of its scroll time is in SwiftShader (`profile_av2.js`). Re-run on a real GPU.
- AV 2.0 crashed on 50,000-column inputs (500x50k and 250x50k, 5/5 runs) but not on
  1,250x20,000 (25M residues). Unverified on a real GPU.
- Viewers do different work at load (AV 2.0: logo + entropy; ViewAlign: consensus +
  conservation; alignment.js: nothing).
- Synthetic data; 2 CPUs. Use the ranking, not the absolute times.

## Files in results/

- `results.jsonl`, `summary.csv`: 81-run matrix (va, av2, ajs). `extra.jsonl`: AV 2.0 width test.
- `results_fix.jsonl`: original vs patched ViewAlign, 42 runs.
- `regression_fix.log`: `tests/regression/run-all.js` on the patched copy (275 pass, 2 fail;
  both 2 also fail on unpatched main in this environment).
- `profile_va_aa100k.txt`: CPU profile + DOM census of ViewAlign loading 100k x 400.
- `verify_grid.png`: final screenshots of the largest cases (all rendered and scrolled).
