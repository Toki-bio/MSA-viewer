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

## Claim 37

Manual 7.2: search accepts regular expressions (the ".*" regex checkbox), e.g. "ATG...TAA", "GG[ACGT]{10,}CC", "TATA[AT]A".

Where to look: index.html: the Search menu block; script.js: grep "function searchMotif".

## Claim 38

Manual 7.3: "The Mismatches input (0-10) allows approximate matching. A mismatch budget of 2 means up to 2 character differences are allowed in each match. Works with both literal and regex search modes."

Where to look: index.html: grep "maxMismatches"; script.js: grep "maxMismatches" inside searchMotif.

## Claim 36

Manual 7.1: motif search runs against degapped sequences and treats U and T as equivalent for DNA/RNA searches; it is case-insensitive.

Where to look: script.js: function searchMotif (look for toUpperCase/toLowerCase and the U/T line).

