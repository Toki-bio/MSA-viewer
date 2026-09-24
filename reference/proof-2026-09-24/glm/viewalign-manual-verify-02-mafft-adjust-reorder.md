# Task: check 2 claim(s) from the ViewAlign user manual against the source code

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

## Claim 11

Manual 3.2: "Adjust direction: Detect sequences whose orientation disagrees with the first (6-mer voting, nucleotide only) and reverse-complement them before aligning."

Where to look: script.js: grep "mafftAdjustDir" and the function that decides orientation.

## Claim 12

Manual 3.2: "Reorder by similarity: Order rows by a 6-mer UPGMA guide tree (the viewer's analogue of MAFFT --reorder, not a MAFFT flag during WASM alignment)."

Where to look: script.js: grep "mafftReorder" and follow it to the tree that orders rows.

