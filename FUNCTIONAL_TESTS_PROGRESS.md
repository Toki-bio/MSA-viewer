# Functional tests progress

## Done
- Reads mode: SAM loading, track packing, and SVG rendering (commit pending)
- Clustering: 10 sequences in 2 clear groups (5x A-only, 5x T-only) cluster correctly (commit pending)
- Colouring: clusterByName groups identically-prefixed names, applyPatternColour colours by regex (commit pending)

## Current phase
in progress

## Bugs found
(none yet)

## Notes for the next run
- Search is next: searchMotif() uses findFuzzyMatches() for mismatch matching; results land in state.searchHistory
- Dot plot: openDotPlot() computes dot plot via web worker
- Clustering test uses 5 seqs per group to work with default minOccurrences=5; also sets minOccurrences=2 via UI if inputs exist
- Colouring test creates #colourPatternInput and #colourPatternColor elements if missing, then calls applyPatternColour() directly
