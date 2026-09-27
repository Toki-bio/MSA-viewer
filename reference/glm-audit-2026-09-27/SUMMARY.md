# GLM feature audit, 2026-09-27

20 read-only glm.js tasks (glm-5.3), one question each, on a frozen snapshot of commit
a73736c (worktree `MSA-viewer-glm-audit`), so edits to main during the run could not move
the lines under GLM. Task generator: `C:/work/glm-harness/make_viewalign_feature_audit_tasks.py`;
raw results: `C:/work/glm-harness/out/viewalign-audit-*.json`.
Cost about 117,500 UZS (5.26 M input tokens), about 65 minutes.

Every bug/risk was checked against the source, and each accepted one reproduced in the
browser before fixing. Each fix has a regression check that fails on the previous code.

## Accepted and fixed

| Area | Finding | Evidence | Fix |
|---|---|---|---|
| Tree (NJ) | Minimum-Q scan ignored Q until it met a pair closer than the first: minQ = Infinity made the tolerance Infinity and `Infinity - Infinity` NaN. Introduced the same morning by the tie-break fix | Long-branch case, order a,c,b,d: joined (a,c) instead of ((a,b),(c,d)) | First pair sets minQ; check reproduces the Wikipedia 5-taxon tree and the long-branch tree exactly |
| Codon | RNA translated to X (code table keyed by T) | `AUGGCUCUGAAAUAA` gave `XXXKX`, no stops | U read as T |
| Codon | Syn/nonsyn marks on unchanged bases | CTG->TTG marked 3 bases; GCT->GAA marked unchanged column 3 | Only differing bases marked |
| Codon | Codon with an ambiguous base classed | AAN vs AAA marked non-synonymous | Codons with non-ACGT bases left unmarked |
| Codon | Row with bases before the frame start not snapped to the codon grid after a gap | Row resuming at the 2nd base of a codon read out of frame | Bases before the frame start no longer count as "seen" |
| Codon | Frameshift tooltip column one too far right when the shift is between adjacent columns | runLen clamped to 1 | Tooltip uses the exact shift column |
| Guide tree | k-mer profile dropped every U | RNA sequences had little or no profile | U read as T |
| Clusterability | "Changed nothing" judged by assigned count only; failed current run became a 0 baseline; tie for best went to the first row tried | Rows 1x10 vs 6+4 reported as "changed nothing" | Whole outcome compared; no baseline, no verdict; tie keeps current settings |
| Variable sites | Top threshold (count n, or 100%) could never be met: at most n-1 sequences differ from a consensus | 100% selected no columns, "Variable sites only" blanked the view | Threshold capped at n-1; message when nothing qualifies |
| Name colours | Similarity slider 0 (strictest, 90%) read as 3 (`parseInt(v) \|\| 3`) | Strict setting grouped like the loose one | 0 accepted |
| Statistics heatmap | Range typed low > high (or equal) painted every cell the middle colour | 100..20 gave one colour | Range swapped; equal bounds colour below/above |
| Tree distances | Unknown (no shared base) pair filled with 0 when every defined distance was 0 | Unrelated sequence drawn as an identical twin | Fill 1 in that case |
| Dot plot | Alignment-column map kept spaces the plotted sequence drops | Hover column off by one per space | Map skips spaces too |
| Dot plot | Prefix buffer sized by the longer sequence | Memory on very skewed pairs | Sized by the shorter |
| Statistics | `Math.max(...lengths)` overflows on huge inputs; Copy threw on non-secure pages | Code reading | Loop; clipboard guard with a message |
| Clustering | Log said "Stopped - N left as noise" while the loop continued | Code reading | Log says the round found no group |

## Rejected, with the reason

| Area | Claim | Why rejected |
|---|---|---|
| Name colours | `threshold` is not a minimum group size | My task text was wrong: it is a sensitivity (0.90 to 0.40 similarity) by design |
| Name colours | Pattern is used as a regular expression | The box says "regex/text"; GLM's example (`a\|b\|c` "matches everything") is also wrong |
| Name colours | Gradient colours identical after ~51 prefixes | Lightness is not rounded; colours stay distinct |
| Name colours | Invalid regex shows a generic timeout message | It shows "Invalid regex: ..." |
| Tree | Summary claims the largest distance was used for saturated-only pairs | The caller prints the saturated fill (twice the largest) separately |
| Codon | Two changed bases with the same amino acid should each be classed by the single change | Design: marking a base non-synonymous in a codon whose amino acid did not change would mislead |
| Variable sites | Internal gaps count as variation | Design: an indel column is a difference; terminal gaps are excluded on purpose |
| Dot plot | Identical IUPAC codes (R/R) score as a match | Design, as Easel's identity counts identical codes |
| Codon | No syn/nonsyn marks after a frameshift | Design: the frameshift "!" covers it |
| Tree (NJ) | Negative branch lengths clamped at 0; merged-node heights approximate | Common practice; heights are not drawn |

## How GLM did

Of about 60 findings, 16 led to fixes (one of them, NJ, a real topology error), 10 were
rejected, the rest were correct "checked, no problem" notes. Factual errors inside otherwise
useful answers: a claimed "generic timeout" toast, a claimed "empty regex branch", a
claimed colour rounding. Every accepted finding quoted the right lines.
