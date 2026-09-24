#!/usr/bin/env bash
# Run the viewalign-manual-verify glm.js tasks one at a time, from inside the read root.
cd /c/work/MSA-viewer
for t in /c/work/glm-harness/tasks/viewalign-manual-verify-*.md; do
  n=$(basename "$t" .md)
  echo "START $n $(date +%H:%M:%S)"
  GLM_READ_ROOTS="C:/work/MSA-viewer" timeout 1500 node /c/work/glm-harness/glm.js "$t" > "/c/work/glm-harness/out/$n.stdout.txt" 2>&1
  echo "END $n exit=$? $(date +%H:%M:%S)"
done
echo ALLDONE
