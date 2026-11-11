# Third-party components and data

ViewAlign's own code is MIT-licensed (`LICENSE`). The components and data below
come from elsewhere; each keeps its own licence.

## Code shipped with the viewer

| Component | Files | Licence | Notice |
|---|---|---|---|
| MAFFT v7.525 core (Katoh & Standley), compiled to WebAssembly | `disttbfast.js`, `disttbfast.wasm` | BSD | `LICENSE-MAFFT` |
| Emscripten runtime (generated glue code inside `disttbfast.js`) | `disttbfast.js` | MIT (Emscripten authors) | https://github.com/emscripten-core/emscripten/blob/main/LICENSE |
| MACSE v2.07 `alignSequences`, ported to JavaScript (Ranwez et al. 2011, 2018) | `macse-align.js`, `macse-worker.js`, `macse-dp-wasm.js`, `tests/macse-port/*` | CeCILL 2.1 | `LICENSE-MACSE` |
| @gmod/cram v14.1.1 (JBrowse CRAM reader; Copyright (c) 2017 Robert Buels), unmodified browser bundle | `vendor/gmod-cram/cram-bundle.js` and its lazily loaded chunk `vendor/gmod-cram/643.cram-bundle.js` | MIT | `vendor/gmod-cram/LICENSE`, `vendor/gmod-cram/README.md` |
| is-buffer (Feross Aboukhadijeh), inside the CRAM bundle | `vendor/gmod-cram/cram-bundle.js`, `643.cram-bundle.js` | MIT | `vendor/gmod-cram/cram-bundle.js.LICENSE.txt` |

The bundler collected a notice only for is-buffer. The two CRAM bundle files also contain code of
other packages that @gmod/cram depends on (CRAM codec and checksum code: the words bzip2, crc32, md5,
rans and xz appear in them). Their licence notices are not part of the bundle, and this repository
does not record them. See https://github.com/GMOD/cram-js for the dependency list.

### How the CeCILL 2.1 part sits next to the MIT code

The MACSE port runs in its own Web Worker (`macse-worker.js`), which loads only
CeCILL-licensed files. The MIT-licensed viewer starts that worker and exchanges
messages with it (`postMessage`); it does not include or link MACSE code. In
CeCILL 2.1 terms the viewer is an *External Module* (Article 1: not derived from
the Software, running in a separate address space and calling it), which
Article 5.3.3 allows to be distributed under its own licence. The MACSE port
itself, including any change to it, stays under CeCILL 2.1.

## Colour specifications

| What | Where | Licence |
|---|---|---|
| ColorBrewer palettes YlOrRd, RdBu, Greens and the distinct group colours (Cynthia A. Brewer, Pennsylvania State University, colorbrewer2.org) | colour values in `script.js` (Statistics heat map, group colours) | Apache License 2.0 |
| Viridis colour map (Stéfan van der Walt and Nathaniel Smith, matplotlib) | colour values in `script.js` | CC0 |

This product includes color specifications and designs developed by Cynthia Brewer (http://colorbrewer.org/).

## Example and test data

| Files | Source | Licence |
|---|---|---|
| `examples/real/bp_*` | Biopython test suite | Biopython License / BSD 3-Clause (`examples/real/LICENSES/Biopython-LICENSE.rst`) |
| `examples/real/htslib_*` | htslib test data | MIT/Expat (`examples/real/LICENSES/htslib-LICENSE`) |
| `examples/real/pysam_*` | pysam test data | MIT (`examples/real/LICENSES/pysam-COPYING`) |
| `examples/real/ncbi_*` | NCBI RefSeq | public, no NCBI restrictions |
| `examples/real/pfam_*`, `examples/real/rfam_*` | Pfam (InterPro), Rfam | CC0 |
| `examples/synthetic/*`, `examples/compat/*` | generated for ViewAlign | MIT, as ViewAlign |
| `examples/demo/alu_subfamilies.fa`, `examples/demo/alu_copy.fa` | Alu copies from human chromosome 1 (hg38, UCSC RepeatMasker track), aligned with ViewAlign's MAFFT | UCSC Genome Browser data; terms not recorded in this repository |
| `examples/demo/cmah_primates.fa` | CMAH coding sequences of chimpanzee (NM_001009041), bonobo (AF494221), gorilla (AF494223), orangutan (AF494225), rhesus macaque (NM_001032856) and human (D86324) | GenBank/RefSeq records; terms not recorded in this repository |
| `examples/demo/andricus_cytb.fa` | 15 cytochrome b sequences of Andricus grossulariae and A. quercusramuli, GenBank JQ416366 to JQ416415 | GenBank records; terms not recorded in this repository |

`examples/real/README.md` lists each file with the exact upstream commit.

## Sequence databases for the optional server

The optional server (`server.js`) can offer local FASTA files as search
databases; none are bundled. RepBase is licensed by the Genetic Information
Research Institute (GIRI) and may not be redistributed: obtain it from GIRI
under its licence and register it with the server yourself (Search panel, or
`blast_dbs.json`). The database files earlier versions of this repository
carried (RepBase_filtered.bnk, SINEBase.nr95.fa, snake_gekko_SINEs_cons.fas,
tua_DL_ASuh_JGrau_repeat.fa) have been removed.
