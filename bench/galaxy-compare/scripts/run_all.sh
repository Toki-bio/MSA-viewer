#!/bin/bash
# Full matrix: 9 datasets x 3 viewers x 3 reps, sequential (2 CPUs), one fresh browser per run.
cd /home/claude/bench
for rep in 1 2 3; do
 for id in nt_1k_x300 nt_10k_x300 nt_50k_x300 nt_2k_x6000 nt_500_x50k aa_1k_x400 aa_10k_x400 aa_50k_x400 aa_100k_x400; do
  for v in va av2 ajs; do
   timeout 330 node scripts/bench.js $id $v $rep || echo "{\"id\":\"$id\",\"viewer\":\"$v\",\"rep\":$rep,\"status\":\"fail\",\"reason\":\"harness timeout/kill\"}"
  done
 done
done
