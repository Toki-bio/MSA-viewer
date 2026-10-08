Fixtures for tests/kmer/subfam-order.test.js. The `.fa` files are synthetic SINE-like sets (seeded
generator `tools/vendor/tests/gen_kmer_cases.py` in github.com/Toki-bio/sinederella). The `.order` files
(one id per line, leaf order of the k-mer guide tree) come from `kmer_order` (C) and were verified
byte-identical to the SubFam 1.2 Python/numpy script on the same inputs; `kmer-tree.js` must give the
same order. `k6c0` = k 6, not canonical; `k8c1` = k 8, canonical.
