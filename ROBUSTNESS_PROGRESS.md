# Robustness sweep progress

## Done
- Edge case 1 (Mixed line endings): confirmed already correct, no fix needed (pending commit)
- Edge case 2 (Empty/whitespace-only sequence): fixed `_isProteinFastaSequence` misclassifying empty sequences as protein (commit pending)

## Current phase
in progress - edge case 3 complete, ready for edge case 4 next run

## Confirmed bugs found and fixed
- **Empty sequence misclassified as protein** (edge case 2): `_isProteinFastaSequence('')` returned `true` because `FASTA_NUCLEOTIDE_CHARS` regex uses `+` (doesn't match empty string), and `!false` = `true`. This caused `isProteinAlignment()` to return `true` for the entire alignment if any sequence was empty, misapplying protein color schemes and disabling codon analysis for nucleotide alignments. Fix: added `if (!letters) return false` guard so empty sequences don't influence the protein/nucleotide classification.

## Cases checked and already correct (false positives)
- **Edge case 1: Mixed line endings** — `parseFasta()` splits on `/\r\n|\r|\n/` with `\r\n` first in the alternation, so Windows CRLF is consumed as one separator (not as `\r` + `\n` producing a phantom empty line). This handles `\r\n`, `\n`, `\r`, and any mixture correctly. Each line is then `trim()`-ed, removing any residual `\r` or whitespace. Traced input `>seq1\r\nACGT\r\n>seq2\nTGCA\n` through the split and loop: produces exactly `['>seq1','ACGT','>seq2','TGCA','']`, the trailing empty string is skipped by `if (!line) continue`, and both sequences are pushed correctly. No data loss, no crash.
- **Empty sequence parsing** (edge case 2, parser itself): `parseFasta` correctly handles `>seq1\n>seq2\nACGT` — seq1 gets `seq: ''`, which is a valid object. The empty sequence renders as all gaps via `seq[pos] || '-'` in `createSequenceLine`. `gaplessPositions` is `[]`, handled safely by `|| 0` fallback patterns. Whitespace-only sequence lines are skipped by `if (!line) continue` after `trim()`, producing the same empty-sequence result. No crash, no data loss.
- **Edge case 3: Single-sequence file** — traced every code path that touches `state.seqs` after parsing. `parseFasta` correctly returns a 1-element array for `>seq1\nACGT`. `renderAlignment` renders 1 sequence line with ruler and optional consensus (consensus = the sequence itself, conservation = 100%, both correct for 1 sequence). All operations requiring 2+ sequences show appropriate messages: clustering ("Need at least 3 sequences"), tree building ("Need at least two sequences"), statistics ("Need at least two sequences"), realignment ("Need at least 2 sequences"), group consensus ("Select at least 2 sequences"). `deleteSelected` and `deleteSequence` both guard with `state.seqs.length === 1` → "Cannot delete the last sequence". `sortBySimilarity` returns early with `< 2` check. `_computeVarSites` skips diff computation with `state.seqs.length > 1` check. `updateBamButtonVisibility` intentionally shows the BAM button with exactly 1 sequence (reference for read mapping). Canvas mode (`_renderCanvasAlignment`) sets `nSeqs = 1`, draw loop runs for at most 1 row, hit testing checks `row >= nSeqs`. No division by `seqs.length - 1` or similar anywhere. No crash, no data loss, no confusing behavior.

## Needs human judgment
(none yet)

## Notes for the next run
- Edge case 4 is "Non-standard IUPAC ambiguity codes" — check characters beyond ACGTU/acgtu and RYSWKMBDHVN, e.g. stray digits, `*` (stop codon), `?` (gap placeholder), or other non-alphabetic characters in sequence lines. Focus on `parseFasta`'s regex `[^A-Za-z*.\-]` (strips non-alphabetic chars except `*`, `.`, `-`) and `_sanitizeFastaSequence`'s replacement regexes (replace invalid chars with `N` or `X`).
- The FASTA parser is `parseFasta()` in script.js, called from `parseAndRender()`.
- `_pushParsedFastaSequence` and `_sanitizeFastaSequence` are the per-sequence helpers.
- `parseAndRender` also handles format detection and calls other parsers (GenBank, Clustal, etc).
- The browser check runs automatically after commit; its output is appended here if it fails.
