# Pre-submission audit prompt (ViewAlign / Bioinformatics Application Note)

Use this prompt with a fresh AI session that has read access to the repository at `https://github.com/Toki-bio/MSA-viewer` (branch `main`, tag **v132** or later).

---

## Your role

You are a **pre-submission auditor** for a *Bioinformatics* **Application Note** manuscript. Your job is **not** to rewrite the paper, but to produce a **defect-first, evidence-based audit** that a human author can act on before submission.

Be skeptical. Treat every factual claim in the manuscript as guilty until verified against the **live codebase** (`script.js`, `server.js`, `index.html`, `manual.html`, `cluster.js`, `blast-worker.js`) and, where relevant, the **GitHub Pages deployment** vs **localhost server** behaviour.

---

## Primary documents to audit

| Document | Path | Purpose |
|----------|------|---------|
| Manuscript | `manuscript.md` | Main submission draft |
| Cover letter | `cover-letter.md` | Editor-facing summary |
| Manual | `manual.html` | User-facing feature reference |
| README | `README.md` | Setup / server features |

**Cross-check rule:** Any feature claimed in the manuscript must be consistent with `manual.html`. Any inconsistency between manuscript and manual is a **finding**.

---

## Audit procedure (follow in order)

### 1. Scope and journal fit

- Confirm target is *Bioinformatics* Application Note (~3,000 words + 1 table + references).
- Estimate word count of `manuscript.md` (exclude references, tables, metadata blocks).
- Flag if Summary/Introduction/Discussion are disproportionately long or short.
- Check whether novelty claims in `cover-letter.md` are supported and not overstated relative to Jalview, AliView, MSAViewer, IGV, UGENE.

### 2. Feature inventory vs code (critical)

For **each** major claim in Summary and Section 2, locate the implementing code or UI control. Report:

- **Verified** — claim matches implementation
- **Partial** — works only in some modes (e.g. Full/Block vs Canvas/Reads)
- **Unverified** — cannot find in code
- **Wrong** — contradicts code

**Must-verify items (v132 baseline):**

| Claim area | Where to look |
|------------|----------------|
| View modes (Full, Block, Canvas, Reads) | `index.html` mode radios; `renderAlignment()` in `script.js` |
| Auto-Canvas threshold (150k residues) | `CANVAS_AUTO_THRESHOLD` in `script.js` |
| Input formats (9 incl. GenBank flatfile) | `parseAndRender()`, parsers; **no** NCBI accession API |
| Conservation shading (Black/Dark/Light) | `index.html` sliders; `preCalculateConservation()` |
| Residue colour schemes | `colorSchemeSelect`, `ALIGNMENT_COLOR_SCHEMES` |
| Codon analysis + 17 genetic codes | `codonCode` dropdown, `_CODE_VARIANTS` |
| Clustering (SINEClusterer) | `cluster.js`, clustering UI in `index.html` |
| Motif search (regex, mismatches, rev comp) | `searchMotif()`; **not** in Canvas/Reads |
| BLAST | `blast-worker.js`, `/api/blast-db` in `server.js`, `fetchDatabases()` |
| Snapshots | `_buildSnapshotPayload()`, `?snapshotFile=` handling |
| MAFFT WASM | `mafft-wasm.js`, alignment menu |
| BAM/CRAM | `POST /api/bam2sam`, Reads mode |
| Dot plot top-30 regions | `_dotPlotState.regions.slice(0, 30)` |
| Ctrl+Shift+R block realign | `handleKeyDown` — only when ≥2 columns selected |
| Export (FASTA, MSF, RTF, SVG) | export functions in `script.js` |

### 3. Mode-specific limitations (common reviewer trap)

Explicitly test whether these tools work in **Canvas** and **Reads** modes:

- Motif search
- Codon overlay
- Clustering name colours / diagnostic highlights
- Sequence name colouring re-apply after render
- Residue editing / GeneDoc tools

Document any mode restrictions missing from the Limitations paragraph.

### 4. Server vs static deployment

Distinguish three deployment contexts:

1. **GitHub Pages** (`index.html` only) — no `/api/*`
2. **localhost:3000** (`node server.js`) — BLAST DB registry, SSH, samtools
3. **User's private databases** — `blast_dbs.json` and `blast_dbs/` are gitignored

Verify manuscript and cover letter do **not** imply BLAST or BAM/CRAM work on GitHub Pages without a server.

### 5. Internal consistency

Check alignment across:

- `manuscript.md` Summary ↔ Section 2 ↔ Section 3 ↔ Limitations
- `cover-letter.md` ↔ manuscript (format count, view modes, BLAST description)
- `manual.html` section list (13 sections) ↔ manuscript Availability
- Version string: `BUILD_TAG` in `script.js` vs cache-bust `?v=` in `index.html`

### 6. References and attribution

- All 14 references cited in text?
- MAFFT, GeneDoc, MACSE, samtools, IGV attributions match `manual.html` Credits section?
- No missing licenses for bundled WASM/workers?

### 7. Writing and submission hygiene

- Remove or fill `[email]`, `[Author names]`, `[Institution]` placeholders.
- Remove the internal `> Revision note` block from `manuscript.md` before submission (or flag it).
- Check "GPU-composited", "complete viewer state", "accession lookup" and similar **overclaims** do not remain.
- Verify URLs are live: app, manual, GitHub repo.

### 8. Comparison table (if required by journal)

Manuscript mentions "1 comparison table" in Target but none is present. Flag as **missing deliverable** or recommend removal from Target line.

---

## Output format (use exactly this structure)

```markdown
# ViewAlign pre-submission audit

**Audited commit/tag:** [hash or v132]
**Date:**

## Executive summary
[2–4 sentences: submit-ready Y/N, top risks]

## Critical findings (must fix before submission)
| ID | Location | Claim | Evidence | Recommended fix |
|----|----------|-------|----------|-----------------|

## Major findings (should fix)
| ID | Location | Claim | Evidence | Recommended fix |
|----|----------|-------|----------|-----------------|

## Minor / style findings
- ...

## Verified claims (spot-check sample)
- [bullet list of 8–12 claims confirmed correct, with file:line refs]

## Cross-document inconsistencies
- manuscript vs cover-letter: ...
- manuscript vs manual: ...

## Limitations paragraph review
[Is it complete and honest? What's missing?]

## Word count
- Body words (excl. refs): ~N
- Within Application Note limit: Y/N

## Suggested author actions (prioritized checklist)
1. ...
2. ...
```

---

## Rules for the auditor

1. **Cite evidence** — every finding needs a file path, function name, or UI element ID.
2. **Do not invent features** — if unsure, mark Unverified and say what you searched.
3. **Prefer false positives over false negatives** — flag overstated claims even if "mostly true".
4. **Do not rewrite the manuscript** — only recommend specific edits.
5. **Do not commit or push** anything unless explicitly asked by the human author.
6. Run `node --check script.js` and `node --check server.js` if auditing code health; report syntax errors as Critical.

---

## Optional live checks (if environment allows)

```bash
node server.js   # port 3000
curl http://localhost:3000/api/blast-db
curl http://localhost:3000/api/viewer-info
```

Confirm `/api/blast-db` returns `url` and `available` per database. Open `http://localhost:3000`, hard-refresh, verify version shows **v132+**.

---

## Context the auditor should know

- Product name: **ViewAlign** (repo folder still `MSA-viewer`).
- Recent fixes (v131–v132): clustering/search/colour re-apply after render; BLAST database URLs; Ctrl+Shift+R hard-refresh pass-through; snapshot colour state uses module `colourState`.
- User's local BLAST databases are **private** (`blast_dbs.json` gitignored) — not part of the public repo.

---

*End of audit prompt.*
