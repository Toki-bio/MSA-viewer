# Task: check 1 claim(s) from the ViewAlign user manual against the source code

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

## Claim 41

Manual 8.3: edit tools "Move NoGaps", "Slide KeepGaps", "Type - click a cell and type a residue letter (A, C, G, T, N) or - for a gap", then Ins/Del Gap tools, Select Col, Clear Gap Cols, R Cons, SeqEdit.

Where to look: index.html: the editToolPanel block (around line 864); script.js: handleGeneDocResidueKey for which letters Type accepts.

