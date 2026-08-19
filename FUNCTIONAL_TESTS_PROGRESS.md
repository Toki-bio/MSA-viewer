# Functional tests progress

## Done
- Reads mode: SAM loading, track packing, and SVG rendering (commit pending)
- Clustering: 10 sequences in 2 clear groups (5x A-only, 5x T-only) cluster correctly (commit pending)
- Colouring: clusterByName groups identically-prefixed names, applyPatternColour colours by regex (commit pending)
- Search: exact (0 mismatch) and fuzzy (1 mismatch) motif matching with correct match counts; 2-mismatch sequence correctly excluded (commit pending)
- Dot plot: self-comparison produces points along the main diagonal (commit pending)

## Current phase
All phases complete

## Bugs found
(none yet)

## Notes for the next run
- All 5 feature areas now have functional tests in tests/functional/run-all.js
- Dot plot test uses a 20bp self-comparison; SPIN mode (default) with word size 6 (from #dotPlotWindow default in HTML) produces 20/20 diagonal matches
- openDotPlot is async and uses web workers; test waits for _dotPlotState.computing to become false
- matchMap is a Uint8Array of size rows*cols; diagonal element at (i,i) is matchMap[i*cols+i]
- Each word match marks W cells along the diagonal starting at (i,i), so the union of all self-matches covers the entire diagonal
- Search test uses 10bp sequences with a 10bp motif so there is exactly one starting position (i=0), making match counts deterministic
- searchMotif() reads #searchInput and #maxMismatches; results land in state.searchHistory with matchCount and sequencesWithMatches
- Clustering test uses 5 seqs per group to work with default minOccurrences=5; also sets minOccurrences=2 via UI if inputs exist
- Colouring test creates #colourPatternInput and #colourPatternColor elements if missing, then calls applyPatternColour() directly
