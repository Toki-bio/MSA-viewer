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

## Claim 46

Manual 9.4: "Build UPGMA or Neighbor-Joining trees from selected sequences. Three distance correction models are available: p-distance (raw), Jukes-Cantor (JC69), and Kimura 2-parameter (K80). Switching UPGMA/NJ or model in the modal rebuilds the tree."

Where to look: script.js: function openTreeBuilder, buildNJTreeFromAlignment, buildUPGMATreeFromAlignment, and the treeMethod / treeDistanceModel change listeners.

## Claim 47

Manual 9.4 tree window: "Zoom − / + / Fit: Scale the drawing between 25% and 400% ... Fit returns to 100%". Also "PNG is rasterised at 2×".

Where to look: tree-draw.js: grep zoom limits, Fit handler and the PNG export scale.

## Claim 48

Manual 9.4: "Full pairwise p-distance and identity matrices have copy-to-clipboard buttons."

Where to look: index.html: the statsModal block; script.js: its copy handlers.

