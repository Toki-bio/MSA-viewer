#!/usr/bin/env bash
# Full suites x 3 engines at the current commit; one log line per run
cd "$(dirname "$0")/.."
echo "commit $(git rev-parse --short HEAD)"
for br in chrome firefox webkit; do
  if [ "$br" = chrome ]; then unset BROWSER; else export BROWSER=$br; fi
  node -e "require('./tests/lib/browser').launch().then(async b=>{const p=await b.newPage();console.log('$br UA:',await p.evaluate(()=>navigator.userAgent));await b.close()})"
  echo "$br compat:     $(node tests/compat/run.js 2>&1 | tail -1)"
  echo "$br regression: $(node tests/regression/run-all.js 2>&1 | tail -1)"
  echo "$br functional: $(node tests/functional/run-all.js 2>&1 | tail -1)"
done
