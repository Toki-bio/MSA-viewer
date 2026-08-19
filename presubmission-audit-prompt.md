# Pre-submission audit prompt (ViewAlign / Bioinformatics Application Note)

Use this prompt with a fresh AI session that has read access to the repository:

- **GitHub:** https://github.com/Toki-bio/MSA-viewer (branch `main`, commit **f32b852** or later, `BUILD_TAG` **v132**+)
- **Local clone (example):** `c:\work\MSA-viewer\` or `./MSA-viewer/`
- **Live app (static):** https://toki-bio.github.io/MSA-viewer/
- **Live manual:** https://toki-bio.github.io/MSA-viewer/manual.html
- **Local server:** `node server.js` → http://localhost:3000

---

## Repository file locations (read these first)

### Submission documents (audit targets)

| File | Repo path | Notes |
|------|-----------|-------|
| Manuscript draft | `manuscript.md` | Main Application Note; remove `> Revision note` block before submission |
| Cover letter | `cover-letter.md` | Editor summary; must match manuscript claims |
| This audit prompt | `presubmission-audit-prompt.md` | Procedure only — not submitted |
| Journal research notes | `msa-viewer-journal-research-report.md` | Background only |

### Application entry points

| File | Repo path | Notes |
|------|-----------|-------|
| Main HTML shell | `index.html` | UI controls, mode radios, script cache-bust `script.js?v=132` |
| Client logic | `script.js` | ~16,300 lines; `BUILD_TAG` at line 3 |
| Styles | `styles.css` | Layout, `contain: layout style` |
| User manual | `manual.html` | 13 sections (lines ~311–1242); sidebar TOC at top |
| Package metadata | `package.json` | `npm start` → `node server.js` |

### Server (optional backend)

| File | Repo path | Notes |
|------|-----------|-------|
| Express server | `server.js` | BLAST registry, SSH, samtools, MAFFT server route |
| SSH config template | `ssh-servers.example.json` | Copy to `ssh-servers.json` (gitignored) |
| SSH setup guide | `REMOTE_PUSH_TO_LOAD_GUIDE.md` | Remote MC / queue workflow |
| Deployment guide | `deployment.md` | Public server setup (lowercase filename) |
| Start/stop scripts | `start-server.bat`, `stop-server.bat` | Windows |

### Analysis modules & workers

| File | Repo path | Notes |
|------|-----------|-------|
| Clustering algorithm | `cluster.js` | `SINEClusterer` class (~450 lines) |
| BLAST Web Worker | `blast-worker.js` | Smith–Waterman + IndexedDB cache |
| MAFFT WASM | `mafft-wasm.js` | Browser alignment engine |
| Dot plot workers | `doter-worker.js`, `doter-word-worker.js` | Dotter / SPIN modes |
| BAM parsing | `bam-parser.js` | Client-side BAM helpers |
| Tree drawing | `tree-draw.js` | UPGMA visualization |

### User data & private config (gitignored — not in public repo)

| Path | Listed in | Notes |
|------|-----------|-------|
| `blast_dbs.json` | `.gitignore` | Local BLAST database registry |
| `blast_dbs/` | `.gitignore` | User-uploaded FASTA databases |
| `ssh-servers.json` | `.gitignore` | SSH server credentials |
| `snapshots/*.json` | `.gitignore` | User snapshot files (`snapshots/README.md` is tracked) |
| `*.nhr`, `*.nin`, `*.nsq` | `.gitignore` | BLAST index files |

### Example / bundled data (may be in repo)

| File | Repo path | Notes |
|------|-----------|-------|
| SINEBase sample | `SINEBase.nr95.fa` | Default BLAST DB entry in `server.js` |
| Snake/Gekko SINEs | `snake_gekko_SINEs_cons.fas` | Default BLAST DB |
| Test alignment | `test_alignment.fa` | Small test file |

### Tests & misc (low priority for manuscript audit)

| File | Repo path |
|------|-----------|
| `consensus-realign-test.js`, `test-realign-real.js` | Node test scripts |
| `layout-test.html` | UI experiments |
| `MSA-errors.md` | Internal bug report (untracked locally) |
| `todo.md` | Dev notes |

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

**Must-verify items (v132 baseline)** — use these exact paths and symbols:

| Claim area | File(s) | Symbol / location |
|------------|---------|-------------------|
| Version tag | `script.js:3` | `BUILD_TAG = 'v132'` |
| Cache bust | `index.html` | `<script src="script.js?v=132">` |
| View modes UI | `index.html` | `#modeSingle`, `#modeBlocks`, `#modeCanvas`, `#modeReads` |
| View routing | `script.js:3582` | `renderAlignment()` |
| Reads renderer | `script.js:3055` | `renderReadsAlignment()` |
| Canvas renderer | `script.js:2169` | `_renderCanvasAlignment()` |
| Auto-Canvas (150k) | `script.js:3657` | `CANVAS_AUTO_THRESHOLD = 150000` |
| Load pipeline | `script.js:5092` | `parseAndRender()` |
| FASTA parser | `script.js:2563` | `parseFasta()` |
| MSF parser | `script.js:2590` | `parseMsf()` |
| Clustal parser | `script.js:2425` | `parseClustal()` |
| PHYLIP parser | `script.js:2449` | `parsePhylip()` |
| NEXUS parser | `script.js:2486` | `parseNexus()` |
| Stockholm parser | `script.js:2513` | `parseStockholm()` |
| GenBank parser | `script.js:1651` | `parseGenBank()` — flatfile only |
| SAM parser | `script.js:1782` | `parseSamToAlignment()` |
| Conservation shading | `index.html` | `#blackSlider`, `#darkSlider`, `#lightSlider`; `script.js` `preCalculateConservation()` |
| Shade denominator | `index.html` | `input[name="shadeMode"]` (nongap / all) |
| Residue colour schemes | `index.html` | `#colorSchemeSelect`; `script.js:4290` `ALIGNMENT_COLOR_SCHEMES` |
| Codon toggle + codes | `index.html` | `#codonAnalysis`, `#codonCode`, `#codonFrame` |
| Genetic code tables | `script.js:1863` | `_GENETIC_CODE`, `_CODE_VARIANTS` |
| Name-similarity colour | `script.js:13087` | `ngramJaccardSimilarity()` |
| Clustering run | `script.js:8166` | `clusterSequences()` |
| Clustering algorithm | `cluster.js` | `class SINEClusterer` |
| Clustering UI | `index.html` | `#clustering-controls`, `#clusteringStatus` |
| Cluster visuals re-apply | `script.js:151` | `applyClusterVisualsFromState()` |
| Motif search | `script.js:7765` | `searchMotif()`; guard `isMotifSearchSupported()` ~7746 |
| Search re-apply | `script.js:136` | `reapplySearchHighlights()` |
| BLAST dialog | `script.js` | `showBlastSearchModal()`, `fetchDatabases()` ~13843 |
| BLAST worker | `blast-worker.js` | `ensureDb()`, `searchDatabase()` |
| BLAST server API | `server.js:582` | `GET /api/blast-db` → `blastDbStatus()`, `dbPublicUrl()` |
| BLAST DB registry | `server.js:43` | `DB_REGISTRY_FILE` = `blast_dbs.json` |
| Snapshots save | `script.js:6709` | `_buildSnapshotPayload()` |
| Snapshots load | `script.js` | `_applySnapshotView()`, `_applySnapshotColourState()` |
| Snapshot URL | `index.html` / `script.js` | `?snapshotFile=snapshots/...` |
| MAFFT WASM | `mafft-wasm.js` | loaded from `index.html` |
| MAFFT server | `server.js:688` | `POST /api/mafft` |
| BAM/CRAM | `server.js:1010` | `POST /api/bam2sam` |
| Reads mode | `bam-parser.js`, `script.js:3055` | BAM state + `renderReadsAlignment()` |
| Dot plot regions (top 30) | `script.js` | `_dotPlotState.regions.slice(0, 30)` ~14771 |
| Dot plot UI | `index.html` | `#dotPlotModal`, `#dotPlotRegionList` |
| UPGMA tree | `script.js:9095` | `buildUPGMATreeFromAlignment()` |
| Block realign shortcut | `script.js:5696` | `handleKeyDown()` → `realignSelectedBlock()` ~9579 |
| Repeat/TSD finder | `index.html` | `#repeatFinderModal` |
| Export RTF/SVG/FASTA | `script.js` | search `export`, `download`, `RTF` |
| Manual §1–13 | `manual.html:311–1242` | `<h2>1. Getting Started</h2>` … `<h2>13. Credits` |
| Manual BLAST | `manual.html` | `#al-blast`, `#al-blast-db` |
| Manual BAM | `manual.html` | `#in-sam`, `#sv-bam` |
| Credits / attribution | `manual.html:1242` | Section 13 |

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

1. **GitHub Pages** — serves repo root statically; **no** `server.js`; **no** `/api/*`
2. **localhost:3000** — run `node server.js` from repo root (`package.json` → `"start": "node server.js"`)
3. **User's private databases** — `blast_dbs.json` and `blast_dbs/` (gitignored, local only)

**Server API routes** (all in `server.js`):

| Route | Line (approx.) | Purpose |
|-------|----------------|---------|
| `GET /api/viewer-info` | 24 | Build tag, script version |
| `GET /api/blast-db` | 582 | List BLAST databases + FASTA URLs |
| `POST /api/blast-db` | 592 | Upload new database |
| `DELETE /api/blast-db/:name` | 630 | Remove database |
| `POST /api/blast` | 425 | Single-query BLAST / SW fallback |
| `POST /api/blast-all` | 510 | Batch BLAST |
| `POST /api/bam2sam` | 1010 | BAM/CRAM → SAM via samtools |
| `POST /api/mafft` | 688 | Server-side MAFFT |
| `GET /api/snapshots` | 770 | List `snapshots/*.json` |
| `GET /api/ssh-cat` | 948 | SSH remote file fetch |
| `GET /api/ssh-servers` | 851 | List configured SSH servers |

Verify manuscript and cover letter do **not** imply BLAST or BAM/CRAM work on GitHub Pages without a server.

### 5. Internal consistency

Check alignment across:

| Document A | Document B | What to compare |
|------------|------------|-----------------|
| `manuscript.md` Summary | `manuscript.md` §2–3 | Format count, view modes, BLAST, limitations |
| `manuscript.md` | `cover-letter.md` | Same claims in editor letter |
| `manuscript.md` | `manual.html` | Every user-facing feature in manual appears correctly in paper |
| `manuscript.md` Availability table | `README.md`, `deployment.md` | URLs, dependencies |
| `script.js:3` `BUILD_TAG` | `index.html` `script.js?v=` | Version sync |
| `manual.html` §13 | `script.js` header comments | Third-party attribution |

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
| C1 | `script.js:3` vs `manuscript.md` | Manuscript revision note says "v132"; audit prompt expects `BUILD_TAG = 'v132'` | `script.js` line 3: `const BUILD_TAG = 'v179';`. Codebase has advanced 47 build tags past the manuscript's last revision. All feature claims must be re-verified against v179 code, not v132. | Re-audit all manuscript claims against current code (this audit does so). Update manuscript revision note to reflect the actual build being submitted. |
| C2 | `manuscript.md` §2.3 vs `script.js` | "Canvas...activates itself above 150,000 residues" | `script.js`: `const ALIGN_CRAZY_VOLUME = 5_000_000;` and `const CANVAS_AUTO_THRESHOLD = ALIGN_CRAZY_VOLUME;` — auto-Canvas threshold is 5,000,000, not 150,000. Code comment confirms: "Was 150,000...a holdover from before DOM mode had windowing at all." | Update manuscript §2.3 to state 5,000,000 (or describe it as "multi-million residue" if exact number is undesirable). |
| C3 | `manuscript.md` §3 (Limitations) vs `script.js` | "DOM-based Full and Block modes stay responsive to roughly 200 sequences × 5,000 columns, beyond which Canvas is required" | `script.js`: `ALIGN_WINDOWED_DOM_THRESHOLD = 500_000` triggers windowed DOM rendering (not Canvas) between 500K and 5M residues. Canvas auto-switch is at 5M. The manuscript's "beyond which Canvas is required" is wrong for the 500K–5M range, where windowed DOM keeps Full/Block responsive. | Correct Limitations to state that windowed DOM extends Full/Block responsiveness to ~500K residues, with Canvas recommended above ~5M. |

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

From repository root (`MSA-viewer/`):

```bash
node --check script.js
node --check server.js
node server.js                    # listens on http://localhost:3000
```

```bash
curl http://localhost:3000/api/viewer-info
curl http://localhost:3000/api/blast-db
```

Confirm `/api/blast-db` returns `url` and `available` per database. Open http://localhost:3000, hard-refresh (**Ctrl+Shift+R**), verify footer/version shows **v132+**.

Static-only check (no server): open `index.html` or https://toki-bio.github.io/MSA-viewer/ — BLAST dialog should show "Server not available".

---

## Context the auditor should know

- Product name: **ViewAlign** (repo folder still `MSA-viewer`).
- Recent fixes (v131–v132): clustering/search/colour re-apply after render; BLAST database URLs; Ctrl+Shift+R hard-refresh pass-through; snapshot colour state uses module `colourState`.
- User's local BLAST databases are **private** (`blast_dbs.json` gitignored) — not part of the public repo.

---

*End of audit prompt.*
