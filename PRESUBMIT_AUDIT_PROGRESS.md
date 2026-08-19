# Pre-submission audit progress

## Done
- Section 1 (Scope and journal fit): word count (~2,500, within the manuscript's
  own stated 2,600-word OUP limit), section proportions, cover-letter novelty
  claims spot-checked against the manuscript - no overstated claims found.
  Also independently verified C1-C3 below directly against source.
- Section 2 (partial, first 3 critical items): build-tag drift (C1), stale
  Canvas auto-threshold (C2), wrong DOM/Canvas cutover description in
  Limitations (C3). Written into `PRESUBMIT_AUDIT_FINDINGS.md`.

## Current phase
Section 2 continuing - most of the must-verify table (rows on parsers, UI
controls, clustering, search, BLAST, snapshots, MAFFT, BAM/CRAM, dot plot,
tree, export, manual sections) still needs to be worked through, one file
group per run (see the next-run plan below). Then Sections 3-8.

## Notes for the next run
- **Process note, not a content issue:** an earlier run wrote its Section-2
  findings into `presubmission-audit-prompt.md` (the read-only instructions
  file) instead of `PRESUBMIT_AUDIT_FINDINGS.md`, and left the actual
  findings file empty - this violated the "only edit FINDINGS.md and
  PROGRESS.md" rule. A human (not this loop) reverted the instructions file
  and moved the findings (C1, C2, C3) into `PRESUBMIT_AUDIT_FINDINGS.md`
  where they belong, independently re-verifying each one against `script.js`
  and `manuscript.md` directly before trusting it. Be careful: when the
  instructions describe an "Output format" with headings like "## Critical
  findings," that format is a template to reproduce INSIDE
  `PRESUBMIT_AUDIT_FINDINGS.md` - never edit the instructions document
  itself to add rows to its example table.
- Two earlier runs before that lost real, correct analysis entirely because
  they queued everything for one commit at the very end and hit the
  262144-token output/context limit before that commit ever executed. The
  task file now requires committing incrementally (after every few findings,
  not just once at the end) - keep doing that.
- Next chunk suggestion: view-mode UI controls, load pipeline, and the six
  alignment-format parsers (FASTA/MSF/Clustal/PHYLIP/NEXUS/Stockholm) -
  needs `script.js` and `index.html`.
- After that: GenBank/SAM parsers, conservation shading, colour schemes,
  codon toggle/genetic code tables - same two files.
- After that: name-similarity colour, clustering run/algorithm/UI,
  motif search/re-apply - `script.js`, `index.html`, `cluster.js`.
- After that: BLAST dialog/worker/server/registry, snapshots, MAFFT,
  BAM/CRAM, Reads mode - `script.js`, `blast-worker.js`, `server.js`,
  `mafft-wasm.js`, `bam-parser.js`.
- After that: dot plot, UPGMA tree, block realign, repeat/TSD, export,
  manual §1-13, credits - `script.js`, `index.html`, `manual.html`.
- Then Sections 3 (mode-specific limitations), 4 (server vs static), 5
  (internal consistency), 6 (references/attribution), 7 (writing hygiene),
  8 (comparison table) - one per run.
