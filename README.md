# ViewAlign

A browser-based platform for multiple sequence alignment visualization, editing, and analysis.
No installation, no build step, no framework dependencies.

**Live app:** https://toki-bio.github.io/MSA-viewer/ · **Manual:** https://toki-bio.github.io/MSA-viewer/manual.html

## Features

- **Ten input formats with auto-detection**: FASTA, MSF, Clustal, PHYLIP, NEXUS, Stockholm,
  GenBank flatfile, ABI (AB1) chromatograms, SAM, and BAM/CRAM (read in the browser onto an open reference);
  GenBank/RefSeq records can also be fetched by accession
- **Four view modes**: Canvas (the default view at every size, viewport-culled), Block (wrapped
  bands drawn by the Canvas renderer; the B button in the view switch), Reads (a read viewer for mapped
  SAM/BAM/CRAM data: zoom, sort, colour, group, pairs, gene and VCF rows) and Full (the alignment as
  page text; hidden from the view switch, open it with `?view=full`; from about 100,000 residues Full
  draws only a window of the alignment). Opening an
  alignment with more than 500 sequences *and* more than 3,000 columns, or more than
  5 million residues, first asks before loading
- **GeneDoc-style editing**: residue-level edits, Move NoGaps / Slide KeepGaps, gap column
  insert/delete, random-access undo/redo history
- **In-browser MAFFT**: WebAssembly build of MAFFT v7.525 — realign blocks or append and
  align new sequences with no server
- **Codon-aware analysis**: 15 NCBI genetic codes, synonymous/non-synonymous classification,
  frameshift detection, translation track
- **Codon-aware alignment**: a JavaScript port of MACSE v2.07 `alignSequences` (same alignments as MACSE),
  plus a fast reference-based approximation
- **Subfamily clustering**: position-pattern clustering with fuzzy merging and configurable
  quality thresholds, plus diagnostic-feature tables and cluster colouring
- **Sequence search**: BLAST-*like* search against loaded FASTA databases, runs entirely
  client-side in a Web Worker with selectable water/ssearch36/blastn-style scoring presets
  (not real NCBI BLAST or ssearch36, no install required). See `features-inventory.md` (in the [GitHub repository](https://github.com/Toki-bio/MSA-viewer/blob/main/features-inventory.md)) §
  "Sequence search" for exactly how this works, including a real incident where it silently
  broke and how it's guarded against recurring.
- **Annotation track**: BED features (genes, exons, repeats) drawn as a compact track above
  the alignment in every view mode; coordinates on a named sequence are mapped through its
  gaps, so the track follows the alignment. Load from a file, a URL, or `?bed=<url>`; with
  codon analysis on, each annotated CDS is translated in its own frame and strand
- **More analysis**: dot plots with region detection, repeat/TSD finder, UPGMA and neighbour-joining trees,
  regex motif search, 50 restriction enzyme sites
- **Publication export**: SVG (viewport or full), Word-compatible RTF with per-residue
  conservation shading, FASTA, Newick
- **Shareable snapshots**: save and reopen a viewer state as JSON, standalone HTML, or URL
- **Optional server**: local BLAST database hosting and SSH remote file loading

## Quick Start

**Try a starter alignment (40 SINE copies, 4 groups):**
https://toki-bio.github.io/MSA-viewer/?url=https://toki-bio.github.io/MSA-viewer/examples/svk_k4.fa&title=SVK%20SINE%20(K1–K4)

**Worked examples:** many feature panels have a small **Example** pill. It opens a ready-made
example in a new tab, using a link of the form `?url=<file>&title=<title>&demo=<id>`. The example
runs the feature on files from the `examples/` folder and shows a closable note about the result.

### Requirements
A current desktop browser: Chrome or Edge 80+, Firefox 100+, Safari 15.4+. Opening
compressed files (`.gz`, BAM) needs Firefox 113+ or Safari 16.4+. The automated tests run in
Chromium; the viewer is keyboard-operable (Tab to a menu, Enter to open, Esc to close) and has
a colour-blind-safe nucleotide scheme (Display menu > Colours).

### Browser only (no install)
Use the hosted app above, or serve this folder over HTTP and open it, for example
`python3 -m http.server 8000` then `http://localhost:8000/`. More examples: [examples/ on GitHub](https://github.com/Toki-bio/MSA-viewer/tree/main/examples).

Opening `index.html` directly from disk (`file://`) shows and edits alignments, but browsers
block Web Workers and file fetches there, so MAFFT, MACSE, sequence search, dot plots and
`?url=` loading need the page served over HTTP(S).

### Server Mode (optional)
```bash
npm install
node server.js
```
Visit `http://localhost:3000`

Adds:
- Hosted BLAST databases, searched with NCBI blastn when it is installed (the BLAST-like
  search described above runs in the browser without a server)
- Remote SSH file loading

## Remote File Loading Setup

See **[REMOTE_PUSH_TO_LOAD_GUIDE.md](https://github.com/Toki-bio/MSA-viewer/blob/main/REMOTE_PUSH_TO_LOAD_GUIDE.md)** for comprehensive setup instructions including:
- Configuring remote servers
- Installing MC menu entries
- Troubleshooting SSH connections

### Quick Example

**On remote server:**
```bash
# Add to ~/.config/mc/menu
v   View in MSA viewer
	echo "%d/%f" > /tmp/.msa_viewer_queue &
```

**In browser:**
1. Open `http://localhost:3000`
2. Navigate file in MC, press `F2 → v`
3. Click **Check Queue** button
4. Alignment loads with auto-focus

## Configuration

SSH servers are listed in `ssh-servers.json` (not committed; copy `ssh-servers.example.json`):
```json
{
    "myserver": { "label": "My Lab Server", "user": "username", "host": "server.example.com", "port": 22, "via": null },
    "inner":    { "label": "Behind gateway", "user": "username", "host": "10.0.0.5", "via": "myserver" }
}
```
`via` names another entry to use as a jump host. The SSH key is `~/.ssh/id_ed25519`
(`id_ed25519.ppk` on Windows) unless `SSH_KEY_PATH` is set. Other settings (`PORT`, `HOST`,
`ALLOWED_HOSTS`, `LOCAL_FILE_ROOTS`, `ALLOW_REMOTE_FILE_ACCESS`) are environment variables;
see Security Notes below.

## Sequence databases (optional server)

The optional server offers local FASTA files as search databases; none are bundled, so add
your own from the Search panel. RepBase is licensed by GIRI and may not be redistributed:
obtain it from GIRI and register it yourself (see `THIRD_PARTY_NOTICES.md`).

## Snapshot Storage (GitHub Pages)

The `Snapshot` button exports:
- a direct encoded snapshot URL (`?snapshot=...`)
- a JSON snapshot file (for short-link hosting)
- an HTML launcher file

A snapshot file opens with `?snapshotFile=<address of the JSON>`. The address is fetched by the
browser, so it can be any public address that allows cross-origin requests.

Putting the file in this repository's `snapshots/` folder does **not** publish it, for two reasons:
- `.gitignore` excludes `snapshots/*.json` (snapshots may hold personal alignment data).
- `tools/build-site.sh`, which builds the GitHub Pages site, copies only `snapshots/README.md` and
  `snapshots/index.json` from that folder.

To publish snapshots on your own copy (fork) of the site:
1. Export the snapshot JSON from the app.
2. Remove the `snapshots/*.json` line from `.gitignore` (or use `git add -f`), and commit the file into `snapshots/`.
3. In `tools/build-site.sh`, extend the `cp snapshots/README.md snapshots/index.json` line to copy your file too.
4. Optional: list the file in `snapshots/index.json` as `{"files": [{"path": "snapshots/<file>.json", "name": "<label>"}]}`; the Input menu's snapshot list then shows it.
5. Open it with `?snapshotFile=snapshots/<file>.json`.

Without changing those files, host the JSON anywhere else that is public and use its full address.
See also the [snapshots folder notes](https://github.com/Toki-bio/MSA-viewer/blob/main/snapshots/README.md).

## Security Notes

The optional server reads local files and runs SSH on your behalf, so by default it only
serves this machine:

- It listens on `127.0.0.1`. Set `HOST=0.0.0.0` to accept other machines (LAN, Tailscale);
  the port is `PORT` (default 3000).
- Requests must use `localhost`, an IP address, or a name listed in `ALLOWED_HOSTS`
  (comma-separated), which blocks DNS-rebinding pages.
- `/api` requests sent by another web site's page are refused.
- Loading local paths and SSH files works only for clients on the same machine unless
  `ALLOW_REMOTE_FILE_ACCESS=1`. Local paths must lie under `LOCAL_FILE_ROOTS`
  (default: the ViewAlign folder and your home folder) and never inside hidden folders
  such as `~/.ssh`.
- `ssh-servers.json`, `blast_dbs.json`, logs and `server.js` are never served.
- Remote paths may contain letters, digits, spaces and `_ @ % + = : , . / ~ -` only.
- SSH uses key-based auth (no passwords)
- Queue file at `/tmp/.msa_viewer_queue` must be world-writable (666)
- All file transfers encrypted over SSH
- Manual "Check Queue" button prevents continuous polling (safer for IDS-protected servers)

## Acknowledgements

The Statistics window reimplements the definitions of `esl-alistat` and `esl-alipid` from **Easel**, the sequence-analysis library of Sean R. Eddy's **HMMER** project (Eddy SR 2011, *PLoS Comput Biol* 7:e1002195; [hmmer.org](http://hmmer.org), [github.com/EddyRivasLab/easel](https://github.com/EddyRivasLab/easel)). No Easel code is included. Alignment is done with MAFFT (Katoh & Standley 2013) compiled to WebAssembly, codon alignment with a JavaScript port of MACSE v2.07 (Ranwez et al. 2018); the manual's Credits section lists every borrowed method.

## Licence

ViewAlign is released under the MIT License (`LICENSE`), except the MACSE port (`macse-align.js`, `macse-worker.js`,
`macse-dp-wasm.js`; Ranwez et al. 2011, 2018), which is under MACSE's CeCILL 2.1 licence (`LICENSE-MACSE`). The port
runs in its own worker and talks to the rest of ViewAlign only by messages. The in-browser MAFFT (`disttbfast.*`) is
under MAFFT's BSD licence (`LICENSE-MAFFT`). `THIRD_PARTY_NOTICES.md` lists every bundled component and data set with
its licence.

The GitHub Pages site publishes only the files listed in `tools/build-site.sh` (viewer, manual, examples, licences).

## Support

For issues or feature requests, see [GitHub Issues](https://github.com/Toki-bio/MSA-viewer/issues)

---

**Live Demo**: https://toki-bio.github.io/MSA-viewer
