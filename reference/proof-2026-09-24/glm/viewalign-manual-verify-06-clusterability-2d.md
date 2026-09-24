# Task: check 3 claim(s) from the ViewAlign user manual against the source code

The repository is at `C:/work/MSA-viewer`. Read only what you need, using `grep` first and
`read_file` with an offset and a limit (script.js has about 23,700 lines; never
read it whole). Do not edit anything.

For EACH claim below decide exactly one verdict:
- `MATCH` - the code does what the claim says, in every detail the claim states.
- `MISMATCH` - some stated detail differs from the code (a number, a name, a key,
  a behaviour, or the thing does not exist).
- `UNCLEAR` - you could not find the code that decides it.

A claim with several details is MATCH only if every detail matches. Quote the
code; do not paraphrase it.

Report with `append_items`, list name `verdicts`, one item per claim:
`{"claim_id": "...", "verdict": "MATCH|MISMATCH|UNCLEAR", "evidence": [{"file": "...", "line": 123, "code": "exact line text"}], "detail": "which stated detail differs, or why it matches"}`
Then call `finish`. Do not re-read code you have already read.

## Claim 31

Manual 4.3: Thresholds "apply to SNP grouping and Clusterability, and Show 2D also reads Min Size / Min Features when it decides which local patterns are worth boxing."

Where to look: script.js: grep "clusterMinSizeInput", "clusterMinPerfectInput", "Clusterability", "computeAndShowBicluster".

## Claim 34

Manual 4.4: "Show 2D draws translucent rectangles over stretches where a subset of rows share a local pattern ... It does not change row order. Full and Block view modes are supported; Canvas mode is not."

Where to look: script.js: grep "computeAndShowBicluster", "renderBlockMaskOverlay", "blockMaskOpacity".

## Claim 35

Manual 4.7: "V1-V5 sets squint coarseness - V1 a few big blocks, V5 many fine ones. Squint knobs expose the eight parameters behind the presets; releasing any slider recomputes the mask."

Where to look: index.html: grep "blockMaskPreset" and "bmKnob"; script.js/block-mask.js: the preset table.

