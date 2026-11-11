// Node-only check (no browser) of the v334 parsers on the inputs named in GLM findings q11b and q12.
// Loads the named top-level functions from script.js into a vm context with small stubs.
//   node dev-tools/audit-2026-11-11/probes/node-parsers.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '../../../script.js'), 'utf8');
function grab(name) {
    const i = src.search(new RegExp('^(?:async\\s+)?function ' + name + '\\(', 'm'));
    if (i < 0) throw new Error('no ' + name);
    const eol = src.indexOf('\n', i);
    const line = src.slice(i, eol);
    if (/\}\s*$/.test(line) && line.split('{').length === line.split('}').length) return line + '\n';   // one-line function
    const re = /\r?\n\}\r?\n/g; re.lastIndex = i;
    const r = re.exec(src);
    return src.slice(i, r.index + r[0].length);
}
const names = ['_interleavedRows', 'parseClustal', 'parseStockholm', '_fastaStateRow', '_sanitizeFastaSequence',
    '_isProteinFastaSequence', '_pushParsedFastaSequence', 'parseFasta', '_looksLikeA3m', '_seqEditCleanSeq'];
const ctx = {
    calculateGaplessPositions: () => null, el: () => null, GAPLESS_TABLE_MAX_RESIDUES: 1e9, _parseNotice: null,
    console, _expandA3mInsertions: () => 0,
    FASTA_NUCLEOTIDE_CHARS: /^[ACGTUNRYMKSWHBVD.-]+$/i, FASTA_PROTEIN_ONLY_CHARS: /[EFILPQZXJO*]/i,
};
vm.createContext(ctx);
if (process.env.DBG) for (const n of names) { const g = grab(n); console.log(n, g.length, JSON.stringify(g.slice(0, 50)), JSON.stringify(g.slice(-30))); }
vm.runInContext(names.map(grab).join('\n') + '\nthis.F = {' + names.join(',') + '};', ctx);
const F = ctx.F;
const show = (label, rows) => console.log(label + ': ' + JSON.stringify((rows || []).map(r => [r.header, r.seq])));

show('Stockholm, blocks with blank line', F.parseStockholm('# STOCKHOLM 1.0\na ACGT\nb AC-T\n\na GGGG\nb GG-G\n//\n'));
show('Stockholm, blocks WITHOUT blank line', F.parseStockholm('# STOCKHOLM 1.0\na ACGT\nb AC-T\na GGGG\nb GG-G\n//\n'));
show('Stockholm, #=GR between lines', F.parseStockholm('# STOCKHOLM 1.0\na ACGT\n#=GR a PP 9999\nb AC-T\n#=GR b PP 99.9\n\na GGGG\nb GG-G\n//\n'));
show('Stockholm, #=GC mid-block, dup names', F.parseStockholm('# STOCKHOLM 1.0\nx ACGT\n#=GC RF xxxx\nx AC-T\n\nx GGGG\nx GG-G\n//\n'));
show('Clustal, blocks WITHOUT separator', F.parseClustal('CLUSTAL W\n\na ACGT\nb AC-T\na GGGG\nb GG-G\n'));
show('FASTA, all-gap record with position numbers', F.parseFasta('>s1\nACGTAC 6\nGTACGT 12\n>s2\n------ 6\n------ 12\n'));
show('FASTA, .qual', F.parseFasta('>r1\n40 40 38 20\n'));
show('FASTA, 0/1 matrix', F.parseFasta('>t1\n0110?\n>t2\n10-01\n'));
console.log('editor clean "------ 6": ' + JSON.stringify(F._seqEditCleanSeq('------ 6')));
