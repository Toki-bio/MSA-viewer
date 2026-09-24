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

## Claim 23

Manual 1.6: "Clustering panel - three separate instruments: Group by k-mer (everyone assigned by overall resemblance), Find SNP groups (exclusive diagnostic columns; leftovers unassigned), and Show 2D (row x column rectangles)."

Where to look: index.html: the clustering-controls block; script.js: the handlers of those buttons.

## Claim 25

Manual 4.1: "Hard permanently deletes the trimmed columns (Undo reverses it). Soft only hides those columns from SNP grouping and Clusterability; the alignment itself is unchanged. Show 2D currently uses the full sequences, including soft-trimmed columns."

Where to look: script.js: grep "soft" near the trim code ("_clearClusterTrimState", "softTrim").

## Claim 27

Manual 4.3: "Split existing groups (off by default) ... When checked, Find SNP groups looks for exclusive SNPs inside each current group instead of scanning the whole alignment."

Where to look: index.html: grep "Split existing"; script.js: the checkbox id it uses.

