# Round-trip fidelity progress

## Done
- Case 1 (Case preservation): confirmed already correct - `_sanitizeFastaSequence` uses `/gi` regexes that preserve case; export writes `s.seq` verbatim (commit pending)
- Case 2 (Gap character round-trip): confirmed already correct - all gap variants (`-`, `.`, `~`, `?`, `_`) normalize to `-` on first parse; export writes `-` verbatim; second parse is a no-op; column alignment preserved; fully idempotent (commit pending)

## Current phase
Case 3 (Header round-trip with special characters) - in progress

## Confirmed bugs found and fixed
(none yet)

## Cases checked and already correct
- **Case 1: Case preservation** — Traced `AcGtacGT` and `acgtACGT` through `parseFasta` → `_sanitizeFastaSequence` → `downloadAlignment` → `parseFasta`. The sanitization regexes (`[^ACGTUNRYMKSWHBVD.-]/gi` for nucleotides, `[^ACDEFGHIKLMNPQRSTVWYBXZJUO*.-]/gi` for proteins) use the `i` flag, so lowercase valid bases/amino acids are NOT matched for replacement — they survive as-is. No code path forces uppercase/lowercase. Export writes `s.seq` verbatim. Reimport applies the same case-preserving sanitization. Lowercase ambiguity codes (`r`, `y`, etc.) also survive because `FASTA_NUCLEOTIDE_CHARS` and the sanitization regex both include them with `i` flag. The `.` → `-` conversion is idempotent (no `.` left on second pass). Digits/invalid chars are stripped on first parse only. Round trip is stable and idempotent.
- **Case 2: Gap character round-trip** — Traced alignments with `-`, `.`, `~`, `?`, and `_` gap characters through `parseFasta` → `_sanitizeFastaSequence` → `downloadAlignment` → `parseFasta`. In `parseFasta`, `line.replace(/[_?~]/g, '-')` converts `_`/`?`/`~` to `-` before the strip regex runs. In `_sanitizeFastaSequence`, `replace(/\./g, '-')` converts `.` to `-`. All gap variants are normalized to `-` on first parse. Export writes `s.seq` verbatim (only `-` remains). On second parse, no `_?~` or `.` exist, so all transformations are no-ops. Every transformation is idempotent: `replace(/[_?~]/g, '-')` (nothing to replace), `replace(/[^A-Za-z*.\-]/g, '')` (no invalid chars), `replace(/\s+/g, '')` (no whitespace), `replace(/\./g, '-')` (no `.`), `replace(/[^...]/gi, 'N'/'X')` (all chars valid). No length-changing operations occur on the second pass. Column alignment is preserved: traced `ACGT.-~GTAC` (11 chars) → `ACGT---GTAC` (11 chars) on first parse, same on second parse. Traced all-gap sequence `.~.` → `---` → `---`. Protein/nucleotide classification is consistent across both passes (based on sequence content, which is identical). The `mafftSeqType` UI setting is constant across both parses, so forced classification doesn't affect stability.

## Notes for the next run
- Case 3: Check headers with special characters (literal `>` mid-string, embedded whitespace). `fullHeader` is produced by `header.replace(/^>/, '').trim().replace(/\s+/g, ' ')` which collapses all whitespace (including newlines) to single spaces, so `fullHeader` can never contain a newline. Export writes `>${s.fullHeader || s.header}\n${s.seq}` — need to verify a header containing `>` doesn't break record boundaries on reimport (parseFasta splits on lines starting with `>`).
- Case 4: Multi-round-trip stability (idempotency over 2+ cycles). Cases 1 and 2 both confirmed idempotent, so Case 4 should follow naturally, but verify explicitly.
- The `mafftSeqType` select can force protein classification (`'0'` or `'1'`), but this is a UI setting constant across both parses, so it doesn't affect round-trip stability.
- `fullHeader` is produced by `header.replace(/^>/, '').trim().replace(/\s+/g, ' ')` which collapses all whitespace (including newlines) to single spaces, so `fullHeader` can never contain a newline — relevant for Case 3.
