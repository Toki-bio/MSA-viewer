# Robustness sweep progress

## Done
- Edge case 1 (Mixed line endings): confirmed already correct, no fix needed (pending commit)

## Current phase
in progress - edge case 1 complete, ready for edge case 2 next run

## Confirmed bugs found and fixed
(none yet)

## Cases checked and already correct (false positives)
- **Edge case 1: Mixed line endings** — `parseFasta()` splits on `/\r\n|\r|\n/` with `\r\n` first in the alternation, so Windows CRLF is consumed as one separator (not as `\r` + `\n` producing a phantom empty line). This handles `\r\n`, `\n`, `\r`, and any mixture correctly. Each line is then `trim()`-ed, removing any residual `\r` or whitespace. Traced input `>seq1\r\nACGT\r\n>seq2\nTGCA\n` through the split and loop: produces exactly `['>seq1','ACGT','>seq2','TGCA','']`, the trailing empty string is skipped by `if (!line) continue`, and both sequences are pushed correctly. No data loss, no crash.

## Needs human judgment
(none yet)

## Notes for the next run
- Edge cases are numbered 1-7 in the task spec. Work through them one per run.
- The FASTA parser is `parseFasta()` in script.js, called from `parseAndRender()`.
- `_pushParsedFastaSequence` and `_sanitizeFastaSequence` are the per-sequence helpers.
- `parseAndRender` also handles format detection and calls other parsers (GenBank, Clustal, etc).
- The browser check runs automatically after commit; its output is appended here if it fails.
