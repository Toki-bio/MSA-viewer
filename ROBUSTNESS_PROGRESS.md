# Robustness sweep progress

## Done
- Edge case 1 (Mixed line endings): confirmed already correct, no fix needed (pending commit)
- Edge case 2 (Empty/whitespace-only sequence): fixed `_isProteinFastaSequence` misclassifying empty sequences as protein (commit pending)

## Current phase
in progress - edge case 2 complete, ready for edge case 3 next run

## Confirmed bugs found and fixed
- **Empty sequence misclassified as protein** (edge case 2): `_isProteinFastaSequence('')` returned `true` because `FASTA_NUCLEOTIDE_CHARS` regex uses `+` (doesn't match empty string), and `!false` = `true`. This caused `isProteinAlignment()` to return `true` for the entire alignment if any sequence was empty, misapplying protein color schemes and disabling codon analysis for nucleotide alignments. Fix: added `if (!letters) return false` guard so empty sequences don't influence the protein/nucleotide classification.

## Cases checked and already correct (false positives)
- **Edge case 1: Mixed line endings** — `parseFasta()` splits on `/\r\n|\r|\n/` with `\r\n` first in the alternation, so Windows CRLF is consumed as one separator (not as `\r` + `\n` producing a phantom empty line). This handles `\r\n`, `\n`, `\r`, and any mixture correctly. Each line is then `trim()`-ed, removing any residual `\r` or whitespace. Traced input `>seq1\r\nACGT\r\n>seq2\nTGCA\n` through the split and loop: produces exactly `['>seq1','ACGT','>seq2','TGCA','']`, the trailing empty string is skipped by `if (!line) continue`, and both sequences are pushed correctly. No data loss, no crash.
- **Empty sequence parsing** (edge case 2, parser itself): `parseFasta` correctly handles `>seq1\n>seq2\nACGT` — seq1 gets `seq: ''`, which is a valid object. The empty sequence renders as all gaps via `seq[pos] || '-'` in `createSequenceLine`. `gaplessPositions` is `[]`, handled safely by `|| 0` fallback patterns. Whitespace-only sequence lines are skipped by `if (!line) continue` after `trim()`, producing the same empty-sequence result. No crash, no data loss.

## Needs human judgment
(none yet)

## Notes for the next run
- Edge case 3 is "Single-sequence file" — check if the app handles a 1-sequence file gracefully (no crash, sensible message) rather than assuming 2+ sequences everywhere.
- The FASTA parser is `parseFasta()` in script.js, called from `parseAndRender()`.
- `_pushParsedFastaSequence` and `_sanitizeFastaSequence` are the per-sequence helpers.
- `parseAndRender` also handles format detection and calls other parsers (GenBank, Clustal, etc).
- The browser check runs automatically after commit; its output is appended here if it fails.
