# Functional tests progress

## Done
- Reads mode: SAM loading, track packing, and SVG rendering (commit pending)

## Current phase
in progress

## Bugs found
(none yet)

## Notes for the next run
- Clustering is next: need to set clustering parameters and call clusterSequences()
- Colouring: clusterByName() and applyPatternColour() write to colourState.mappings
- Search: searchMotif() uses findFuzzyMatches() for mismatch matching
- Dot plot: openDotPlot() computes dot plot via web worker
