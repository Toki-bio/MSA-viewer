# BLOCKMASK progress

## Phase 1: block-mask.js port + parity test   [DONE]

- [x] parseAln / consensusIndex / nonGapIndices / stripGaps
- [x] windowedTracks (1D pair_id + bg = median of far-quarter finite pair_id)
- [x] buildSeqsFull / buildMajFull (majority track, >=8 non-gap gate)
- [x] windowMosaic (population std of per-row match-rate, >=4 rows gate)
- [x] clusterByValue (gap clustering: abs >= ROW_MIN_GAP_ABS AND >= ratio*medgap;
      groups < ROW_MIN_GROUP fold into previous)
- [x] rowPartitionForWindow / groupMeanPairId
- [x] repeatCols (tandem-repeat scan on consensus element, period 1-6, >=4 units, >=8bp)
- [x] classifyBlocks (1D: SIMPLE_REPEAT/MOSAIC/CONSERVATIVE/DIVERGENT + DECAY_SLOPE
      promotion of declining DIVERGENT runs touching elevated blocks)
- [x] classifyBlocks2d (three independent regimes; elevated-window zones with
      ZONE_BRIDGE gap bridging; MIN_ZONE_W filter; one rowPartition per zone;
      split into rank-0 + MOSAIC groups + DIVERGENT residual; clip pass-through
      1D blocks out of split zones; squint absorb of full-height blocks < MIN_BLOCK_W)
- [x] computeBlockMask + stitched-x -> real-column mapping (x<0: nzc[0]+x;
      0<=x<L: nzc[x]; x>=L: nzc[-1]+(x-L+1)) + mask-JSON schema
- [x] tests/blockmask/parity.js

### Parity status

`node tests/blockmask/parity.js` -> 3/3 PASS (oma_SINE16b, synth_unbalanced,
synth_gradient), all at V3_medium (the preset named in each fixture).

Additional cross-checks (Python emit_fixture vs JS computeBlockMask on
oma_SINE16b): V1_coarsest 3/3 blocks match, V5_finest 48/48 blocks match.
Integer output (column indices, group memberships, block counts, types,
group_rank) is bit-identical to reference/block_schematic.py.

### Notes / caveats

- The port was written by the supervisor (Claude), not aider — the first
  aider loop (10 runs) produced zero commits: glm-5.2 spent each one-shot
  turn in an unbounded reasoning block and never emitted an edit. Phase 2 is
  a better fit for aider (larger surface, mechanical, not numerically exact).
- `row_partition_for_window` keys on match-rate to the column MAJORITY, so a
  BALANCED two-type mosaic (e.g. 15/15) does not cleanly split. Unbalanced
  subset deviation (the real oma_SINE16b case, 6-of-30 in synth_unbalanced)
  splits correctly. Revisit if balanced multi-type matters.
- Fixtures assume real, fixed-width, column-aligned flanks ("filled"
  alignments) so the linear stitched-x -> column map holds. A MAFFT-gapped
  flank would need a different mapping (each row's flank is its own
  coordinate) — out of scope for these fixtures.
- No `"test:blockmask"` npm script added (package.json is an existing file,
  out of phase-1 scope). Supervisor should add:
  `"test:blockmask": "node tests/blockmask/parity.js"`.

## Phase 2: viewer integration   [NOT STARTED]

See BLOCKMASK_TASK.md. Overlay layer (#blockMaskLayer SVG, scroll/zoom/column-
window synced like the reads-pile rect layer), `&mask=<url>` loader + schema
validation + header->row mapping, Clustering-panel "2D block mask" mode with
the six squint sliders + V1..V5 preset dropdown, row reorder on entering mask
mode (reuse the header-keyed "Order loaded" path ~script.js:8246), precomputed
`&mask=` wins over live compute. Renderer shared between stage 1 (precomputed
JSON) and stage 2 (block-mask.js computeBlockMask output — same schema).

## Run log

- aider run 1-10 (2026-09-10 ~20:31-20:57): 0 commits, glm-5.2 over-reasoned,
  no edits emitted. Loop abandoned.
- supervisor (2026-09-10): wrote block-mask.js + tests/blockmask/parity.js
  directly; 3/3 parity + V1/V5 cross-check pass; committed.
