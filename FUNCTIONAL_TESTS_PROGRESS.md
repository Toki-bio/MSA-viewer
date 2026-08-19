# Functional tests progress

## Done
- Reads mode: SAM loading, track packing, and SVG rendering (commit pending)
- Clustering: 10 sequences in 2 clear groups (5x A-only, 5x T-only) cluster correctly (commit pending)
- Colouring: clusterByName groups identically-prefixed names, applyPatternColour colours by regex (commit pending)
- Search: exact (0 mismatch) and fuzzy (1 mismatch) motif matching with correct match counts; 2-mismatch sequence correctly excluded (commit pending)

## Current phase
in progress

## Bugs found
(none yet)

## Notes for the next run
- Dot plot is next: openDotPlot(seqA, seqB, nameA, nameB, meta) computes dot plot via web worker (doter-worker.js / doter-word-worker.js)
- Dot plot self-comparison should produce points along the main diagonal
- Search test uses 10bp sequences with a 10bp motif so there is exactly one starting position (i=0), making match counts deterministic
- searchMotif() reads #searchInput and #maxMismatches; results land in state.searchHistory with matchCount and sequencesWithMatches
- Clustering test uses 5 seqs per group to work with default minOccurrences=5; also sets minOccurrences=2 via UI if inputs exist
- Colouring test creates #colourPatternInput and #colourPatternColor elements if missing, then calls applyPatternColour() directly
