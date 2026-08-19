# Round-trip fidelity progress

## Done
- Case 1 (Case preservation): confirmed already correct - `_sanitizeFastaSequence` uses `/gi` regexes that preserve case; export writes `s.seq` verbatim (commit pending)

## Current phase
Case 2 (Gap character round-trip) - in progress

## Confirmed bugs found and fixed
(none yet)

## Cases checked and already correct
- **Case 1: Case preservation** — Traced `AcGtacGT` and `acgtACGT` through `parseFasta` → `_sanitizeFastaSequence` → `downloadAlignment` → `parseFasta`. The sanitization regexes (`[^ACGTUNRYMKSWHBVD.-]/gi` for nucleotides, `[^ACDEFGHIKLMNPQRSTVWYBXZJUO*.-]/gi` for proteins) use the `i` flag, so lowercase valid bases/amino acids are NOT matched for replacement — they survive as-is. No code path forces uppercase/lowercase. Export writes `s.seq` verbatim. Reimport applies the same case-preserving sanitization. Lowercase ambiguity codes (`r`, `y`, etc.) also survive because `FASTA_NUCLEOTIDE_CHARS` and the sanitization regex both include them with `i` flag. The `.` → `-` conversion is idempotent (no `.` left on second pass). Digits/invalid chars are stripped on first parse only. Round trip is stable and idempotent.

## Notes for the next run
- Case 2: Check gap characters (`-`, `.`→`-`, `~`→`-`) for column alignment preservation after full round trip.
- Case 3: Check headers with special characters (literal `>` mid-string, embedded whitespace).
- Case 4: Multi-round-trip stability (idempotency over 2+ cycles).
- The `mafftSeqType` select can force protein classification (`'0'` or `'1'`), but this is a UI setting constant across both parses, so it doesn't affect round-trip stability.
- `fullHeader` is produced by `header.replace(/^>/, '').trim().replace(/\s+/g, ' ')` which collapses all whitespace (including newlines) to single spaces, so `fullHeader` can never contain a newline — relevant for Case 3.
