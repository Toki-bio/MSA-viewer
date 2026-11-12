# Examples page alignments

Invented sequences for the Examples page (`examples.html`, linked from the empty viewer). Each was made with a property planted in it, so the page can show a tool finding it. They are not biological data.

`make_gallery.js` writes every file here from a fixed seed (the same files each run) and writes `truth.json`, the answer each must give. `node tests/regression/demos.js` (checks named "examples page") opens each example as the page does and compares what the viewer shows with `truth.json`.

| File | Planted | Example |
|---|---|---|
| `subfamilies.fa` | 3 subfamilies x 10 copies, 12 own columns each, sfC lacks columns 121-126, about 3 % private changes per copy, rows shuffled | Cluster Now finds the three |
| `tree.fa`, `tree_true.nwk` | 600 bases evolved (Jukes-Cantor) down `tree_true.nwk` | NJ tree, rooted on Out, has every clade |
| `codons.fa` | 40-codon frame; one change per copy: synonymous (codons 5, 30), missense (codon 8, Ala to Glu), stop (codon 15), 1-base loss (column 59), whole codon lost (25) | Codon analysis; AA only |
| `consensus.fa` | 20 rows in zones of set agreement: 100 %, 80 %, 60 %, 35 %, A/G 50:50, 4 rows of 20 with bases | Consensus (Ambiguous) and shading |

Why 12 columns per subfamily: a group found last must have at least Min Features (5) columns that all its copies share and no other copy has. With 3 % private changes a planted column stays like that with probability about 0.6, so 6 columns gave the last subfamily 5 in only 24 % of draws, 8 in 60 %, 12 in 95 %.

If you change the generator, run it, then check that the notes in `script.js` (DEMOS, `g_` entries) and `examples.html` still match `truth.json` (the reference protein is quoted in the AA note).
