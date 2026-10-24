# Probes

Oracle probes: independent reimplementations of a definition, compared number by number with what the viewer
shows. They are not part of `node tests/run-all.js`; run one by hand when the code it covers changes.

- `stats_oracle.js` — the Statistics window against Easel's definitions (esl-alistat, esl-alipid): every summary
  value, both identity definitions, the combined matrix layout and the TSV copy, on the example alignments and on
  crafted cases (lower case, U, IUPAC codes, `*`, `~`, `_`, short rows, an all-gap row, identical rows, duplicate
  names, protein with X and *). `node tests/probes/stats_oracle.js`
- `stats_oracle2.js` — the Statistics exports (CSV/TSV/XLSX of the combined, identity-only and distance-only
  matrices, parsed back), the pair filter for both metrics and operators, the pair list and Save pairs files, with
  awkward and duplicate names and the two-sequence case. `node tests/probes/stats_oracle2.js`
