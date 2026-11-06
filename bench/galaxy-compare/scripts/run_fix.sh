#!/bin/bash
cd /home/claude/bench
for rep in 1 2 3; do for id in nt_10k_x300 nt_50k_x300 nt_2k_x6000 nt_500_x50k aa_10k_x400 aa_50k_x400 aa_100k_x400; do for v in va va_fix; do
 timeout 330 node scripts/bench.js $id $v $rep || echo "{\"id\":\"$id\",\"viewer\":\"$v\",\"rep\":$rep,\"status\":\"fail\"}"
done; done; done
