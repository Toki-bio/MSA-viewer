#!/usr/bin/env python3
"""Seeded synthetic MSA families with biological-like structure.

Ancestor -> K subfamily consensuses (15% divergence) -> member copies
(per-copy divergence 3-15%), gap runs (indels), and for nucleotide
TE-like 5' truncation (ragged left ends). Output: aligned FASTA.
usage: gen.py nt|aa NSEQ NCOL OUT [seed]
"""
import random, sys

def main():
    kind, nseq, ncol, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    seed = int(sys.argv[5]) if len(sys.argv) > 5 else 1
    rng = random.Random(seed)
    alpha = "ACGT" if kind == "nt" else "ACDEFGHIKLMNPQRSTVWY"
    anc = [rng.choice(alpha) for _ in range(ncol)]
    k = max(2, min(12, nseq // 200 + 2))
    subs = []
    for _ in range(k):
        s = anc[:]
        for j in range(ncol):
            if rng.random() < 0.15:
                s[j] = rng.choice(alpha)
        subs.append(s)
    with open(out, "w") as fh:
        for i in range(nseq):
            sf = rng.randrange(k)
            s = subs[sf][:]
            div = rng.uniform(0.03, 0.15)
            for j in range(ncol):
                if rng.random() < div:
                    s[j] = rng.choice(alpha)
            # indels as gap runs
            for _ in range(rng.randint(0, max(1, ncol // 150))):
                st = rng.randrange(ncol)
                ln = min(ncol - st, int(rng.expovariate(1 / 6)) + 1)
                s[st:st + ln] = ["-"] * ln
            # 5' truncation (nt) / N-terminal fragment (aa)
            if rng.random() < 0.4:
                cut = int(ncol * rng.uniform(0, 0.5))
                s[:cut] = ["-"] * cut
            fh.write(f">sf{sf}_copy{i}\n")
            seq = "".join(s)
            for p in range(0, ncol, 80):
                fh.write(seq[p:p + 80] + "\n")

if __name__ == "__main__":
    main()
