"""Write single-purpose glm.js tasks: each checks <=3 ViewAlign manual claims against code.

Every task quotes the manual word for word and names where to look, and asks for a
fixed verdict shape. Answers are then checked independently (oracle) before use.
Run from anywhere: python make_viewalign_manual_verify_tasks.py
"""
import os

ROOT = 'C:/work/MSA-viewer'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tasks')

HEADER = """# Task: check {n} claim(s) from the ViewAlign user manual against the source code

The repository is at `{root}`. Read only what you need, using `grep` first and
`read_file` with an offset and a limit (script.js has about 23,700 lines; never
read it whole). Do not edit anything.

For EACH claim below decide exactly one verdict:
- `MATCH` - the code does what the claim says, in every detail the claim states.
- `MISMATCH` - some stated detail differs from the code (a number, a name, a key,
  a behaviour, or the thing does not exist).
- `UNCLEAR` - you could not find the code that decides it.

A claim with several details is MATCH only if every detail matches. Quote the
code; do not paraphrase it.

Report with `append_items`, list name `verdicts`, one item per claim:
`{{"claim_id": "...", "verdict": "MATCH|MISMATCH|UNCLEAR", "evidence": [{{"file": "...", "line": 123, "code": "exact line text"}}], "detail": "which stated detail differs, or why it matches"}}`
Then call `finish`. Do not re-read code you have already read.

"""

TASKS = {
    '01-genbank-paste-history': [
        ('3', 'Manual 2.1: "GenBank flatfiles can also be pasted directly. Records beginning with LOCUS are parsed for header metadata, FEATURES, and the ORIGIN sequence."',
         'script.js: grep "LOCUS" and "function parseGenBank". Pasted text goes through parseAndRender.'),
        ('8', 'Manual 1.5: "It tracks every alignment loaded - by paste, file, URL, SSH, or BLAST - and stores timestamps and sequence counts. Click any entry to reload it instantly. History persists across browser sessions via localStorage."',
         'script.js: grep "msaviewer_history" and the class that stores it (around line 586).'),
    ],
    '02-mafft-adjust-reorder': [
        ('11', 'Manual 3.2: "Adjust direction: Detect sequences whose orientation disagrees with the first (6-mer voting, nucleotide only) and reverse-complement them before aligning."',
         'script.js: grep "mafftAdjustDir" and the function that decides orientation.'),
        ('12', 'Manual 3.2: "Reorder by similarity: Order rows by a 6-mer UPGMA guide tree (the viewer\'s analogue of MAFFT --reorder, not a MAFFT flag during WASM alignment)."',
         'script.js: grep "mafftReorder" and follow it to the tree that orders rows.'),
    ],
    '03-realign-block-addseq': [
        ('13', 'Manual 3.2.1: "Realign Block (Ctrl+Shift+R) realigns only the selected columns and splices the result back ... Each contiguous run of two or more selected columns is extracted, degapped, sent to MAFFT independently ... A run of a single isolated column is ignored."',
         'script.js: grep "function realignSelectedBlock"; realign-region.js.'),
        ('14', 'Manual 3.3: "Just Add - append sequences padded with gaps at the end. Add & Align - realign the full alignment with MAFFT using add-keep-length mode. Align to consensus - align new sequences against the existing consensus before adding."',
         'script.js: grep "addSeqAtTop", "addSeqAlignCons", "function addSequencesJustAdd" and the Add & Align handler; mafft-worker.js shows which MAFFT program runs in the browser.'),
    ],
    '04-blast-sw': [
        ('15', 'Manual 3.4: "... a Web Worker downloads and caches in IndexedDB, so the first query against a database is slower than subsequent ones. Scoring uses Smith-Waterman local alignment."',
         'blast-worker.js (whole file is small enough to grep); script.js: grep "blast-worker".'),
    ],
    '05-clustering-panel': [
        ('23', 'Manual 1.6: "Clustering panel - three separate instruments: Group by k-mer (everyone assigned by overall resemblance), Find SNP groups (exclusive diagnostic columns; leftovers unassigned), and Show 2D (row x column rectangles)."',
         'index.html: the clustering-controls block; script.js: the handlers of those buttons.'),
        ('25', 'Manual 4.1: "Hard permanently deletes the trimmed columns (Undo reverses it). Soft only hides those columns from SNP grouping and Clusterability; the alignment itself is unchanged. Show 2D currently uses the full sequences, including soft-trimmed columns."',
         'script.js: grep "soft" near the trim code ("_clearClusterTrimState", "softTrim").'),
        ('27', 'Manual 4.3: "Split existing groups (off by default) ... When checked, Find SNP groups looks for exclusive SNPs inside each current group instead of scanning the whole alignment."',
         'index.html: grep "Split existing"; script.js: the checkbox id it uses.'),
    ],
    '06-clusterability-2d': [
        ('31', 'Manual 4.3: Thresholds "apply to SNP grouping and Clusterability, and Show 2D also reads Min Size / Min Features when it decides which local patterns are worth boxing."',
         'script.js: grep "clusterMinSizeInput", "clusterMinPerfectInput", "Clusterability", "computeAndShowBicluster".'),
        ('34', 'Manual 4.4: "Show 2D draws translucent rectangles over stretches where a subset of rows share a local pattern ... It does not change row order. Full and Block view modes are supported; Canvas mode is not."',
         'script.js: grep "computeAndShowBicluster", "renderBlockMaskOverlay", "blockMaskOpacity".'),
        ('35', 'Manual 4.7: "V1-V5 sets squint coarseness - V1 a few big blocks, V5 many fine ones. Squint knobs expose the eight parameters behind the presets; releasing any slider recomputes the mask."',
         'index.html: grep "blockMaskPreset" and "bmKnob"; script.js/block-mask.js: the preset table.'),
    ],
    '07-search': [
        ('37', 'Manual 7.2: search accepts regular expressions (the ".*" regex checkbox), e.g. "ATG...TAA", "GG[ACGT]{10,}CC", "TATA[AT]A".',
         'index.html: the Search menu block; script.js: grep "function searchMotif".'),
        ('38', 'Manual 7.3: "The Mismatches input (0-10) allows approximate matching. A mismatch budget of 2 means up to 2 character differences are allowed in each match. Works with both literal and regex search modes."',
         'index.html: grep "maxMismatches"; script.js: grep "maxMismatches" inside searchMotif.'),
        ('36', 'Manual 7.1: motif search runs against degapped sequences and treats U and T as equivalent for DNA/RNA searches; it is case-insensitive.',
         'script.js: function searchMotif (look for toUpperCase/toLowerCase and the U/T line).'),
    ],
    '08-edit-tools': [
        ('41', 'Manual 8.3: edit tools "Move NoGaps", "Slide KeepGaps", "Type - click a cell and type a residue letter (A, C, G, T, N) or - for a gap", then Ins/Del Gap tools, Select Col, Clear Gap Cols, R Cons, SeqEdit.',
         'index.html: the editToolPanel block (around line 864); script.js: handleGeneDocResidueKey for which letters Type accepts.'),
    ],
    '09-seqedit-undo': [
        ('43', 'Manual 8.5: SeqEdit transformations "Degap, Reverse, Complement (DNA), Rev Comp, Uppercase / Lowercase, Pad/trim to alignment length - auto-adjust length on apply".',
         'index.html: the sequence edit modal (grep "seqEditTextarea"); script.js: its button handlers.'),
        ('44', 'Manual 8.6: undo history "Drag entries name the tool, how far the move went and which sequence it was on - for example MoveText 4 col right \u00b7 NW_004567116.1\u2026".',
         'script.js: grep "MoveText" and "SlideText" near line 19390.'),
    ],
    '10-tree-stats': [
        ('46', 'Manual 9.4: "Build UPGMA or Neighbor-Joining trees from selected sequences. Three distance correction models are available: p-distance (raw), Jukes-Cantor (JC69), and Kimura 2-parameter (K80). Switching UPGMA/NJ or model in the modal rebuilds the tree."',
         'script.js: function openTreeBuilder, buildNJTreeFromAlignment, buildUPGMATreeFromAlignment, and the treeMethod / treeDistanceModel change listeners.'),
        ('47', 'Manual 9.4 tree window: "Zoom \u2212 / + / Fit: Scale the drawing between 25% and 400% ... Fit returns to 100%". Also "PNG is rasterised at 2\u00d7".',
         'tree-draw.js: grep zoom limits, Fit handler and the PNG export scale.'),
        ('48', 'Manual 9.4: "Full pairwise p-distance and identity matrices have copy-to-clipboard buttons."',
         'index.html: the statsModal block; script.js: its copy handlers.'),
    ],
    '11-export-server': [
        ('53', 'Manual 2.7: "Supported output formats: FASTA, RTF, SVG, Newick (.nwk), and standalone HTML snapshots. MSF is supported for input only."',
         'script.js: grep "a.download =" and "download" to list every file the viewer writes.'),
        ('56', 'Manual 11.1: "Requirements: Node.js >= 16".',
         'package.json ("engines"); server.js (syntax that needs a given Node version, e.g. ?. or ??).'),
    ],
    '12-shortcut-bits': [
        ('13k', 'Manual 10.2: "Realign block Ctrl+Shift+R ... Isolated single columns are skipped; need at least one span of 2+ columns, otherwise the browser\'s hard-refresh applies."',
         'script.js: function handleKeyDown, case \'r\' with shiftKey.'),
    ],
}

os.makedirs(OUT, exist_ok=True)
for name, claims in TASKS.items():
    body = HEADER.format(n=len(claims), root=ROOT)
    for cid, claim, where in claims:
        body += f'## Claim {cid}\n\n{claim}\n\nWhere to look: {where}\n\n'
    path = os.path.join(OUT, f'viewalign-manual-verify-{name}.md')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(body)
    print(path)
