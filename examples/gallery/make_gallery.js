// Writes the synthetic alignments of the Examples page (examples.html) and truth.json, the answer each must give.
// Invented sequences, not biological data. Seeded: the same files every run.
// Run: node examples/gallery/make_gallery.js
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
let seed = 20261112;
function rnd() {   // mulberry32
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (a) => a[Math.floor(rnd() * a.length)];
const B = 'ACGT';
const randSeq = (n) => Array.from({ length: n }, () => pick(B)).join('');
const other = (b) => pick(B.replace(b, ''));
const fasta = (rows) => rows.map(r => `>${r.name}\n${r.seq}\n`).join('');
const truth = {};

// ── 1. Subfamilies: 3 x 10 copies; each subfamily has 12 columns with its own base; private changes 3 % ──
{
    const L = 180, anc = randSeq(L).split('');
    const cols = [];
    while (cols.length < 36) { const c = 5 + Math.floor(rnd() * (L - 10)); if (!cols.includes(c)) cols.push(c); }
    const fams = { A: cols.slice(0, 12), B: cols.slice(12, 24), C: cols.slice(24, 36) };
    const famSeq = {};
    for (const [f, cs] of Object.entries(fams)) {
        const s = anc.slice();
        for (const c of cs) s[c] = other(anc[c]);
        famSeq[f] = s;
    }
    // subfamily C also lacks 6 bases (0-based columns 120-125, 1-based 121-126): a shared deletion
    if (fams.C.some(c => c >= 120 && c < 126)) throw new Error('a column planted in sfC falls in its own deletion');
    for (let c = 120; c < 126; c++) famSeq.C[c] = '-';
    let rows = [];
    for (const f of ['A', 'B', 'C']) for (let i = 1; i <= 10; i++) {
        const s = famSeq[f].slice();
        for (let c = 0; c < L; c++) if (s[c] !== '-' && rnd() < 0.03) s[c] = other(s[c]);
        rows.push({ name: `sf${f}_${String(i).padStart(2, '0')}`, seq: s.join(''), fam: f });
    }
    // shuffled, so the grouping has something to find
    for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
    fs.writeFileSync(path.join(OUT, 'subfamilies.fa'), fasta(rows));
    truth.subfamilies = {
        groups: { A: rows.filter(r => r.fam === 'A').map(r => r.name), B: rows.filter(r => r.fam === 'B').map(r => r.name), C: rows.filter(r => r.fam === 'C').map(r => r.name) },
        diagnosticColumns1: Object.fromEntries(Object.entries(fams).map(([f, cs]) => [f, cs.map(c => c + 1).sort((a, b) => a - b)])),
        deletionColumns1: [121, 126],
    };
}

// ── 2. Tree: 600 bases evolved down a known tree (Jukes-Cantor), no indels ──
{
    const L = 600;
    const tree = ['', 0, [
        ['', 0.08, [['', 0.05, [['X1', 0.03], ['X2', 0.03]]], ['', 0.05, [['X3', 0.03], ['X4', 0.03]]]]],
        ['', 0.08, [['', 0.05, [['Y1', 0.03], ['Y2', 0.03]]], ['', 0.05, [['Y3', 0.03], ['Y4', 0.03]]]]],
        ['Out', 0.30],
    ]];
    const evolve = (s, t) => {
        const p = 0.75 * (1 - Math.exp(-4 * t / 3));   // chance a site ends up changed (JC69)
        return s.map(b => (rnd() < p ? other(b) : b));
    };
    const rows = [];
    const walk = (node, s) => {
        const [name, len, kids] = node;
        const here = evolve(s, len);
        if (!kids) { rows.push({ name, seq: here.join('') }); return; }
        for (const k of kids) walk(k, here);
    };
    walk(tree, randSeq(L).split(''));
    fs.writeFileSync(path.join(OUT, 'tree.fa'), fasta(rows));
    const nwk = (node) => { const [name, len, kids] = node; const body = kids ? '(' + kids.map(nwk).join(',') + ')' : name; return len ? `${body}:${len}` : body; };
    const newick = nwk(tree) + ';';
    fs.writeFileSync(path.join(OUT, 'tree_true.nwk'), newick + '\n');
    truth.tree = { newick, clades: [['X1', 'X2'], ['X3', 'X4'], ['Y1', 'Y2'], ['Y3', 'Y4'], ['X1', 'X2', 'X3', 'X4'], ['Y1', 'Y2', 'Y3', 'Y4']] };
}

// ── 3. Codons: a 40-codon reading frame and six copies, each with one kind of change ──
{
    const STOP = ['TAA', 'TAG', 'TGA'];
    const codons = ['ATG'];
    while (codons.length < 39) { const c = randSeq(3); if (!STOP.includes(c)) codons.push(c); }
    codons.push('TAA');
    // fixed codons where the planted changes go (1-based codon numbers)
    codons[4] = 'GCA';    // 5  Ala: GCA -> GCC in syn (same amino acid)
    codons[7] = 'GCA';    // 8  Ala: GCA -> GAA in missense (Ala -> Glu)
    codons[14] = 'TAC';   // 15 Tyr: TAC -> TAA in stop
    codons[19] = 'GGC';   // 20 Gly: its 2nd base is lost in frameshift
    codons[24] = 'AAG';   // 25 Lys: the whole codon is lost in codon_deleted
    codons[29] = 'CTG';   // 30 Leu: CTG -> CTA in syn
    const ref = codons.join('');
    const mut = (s, col0, b) => s.slice(0, col0) + b + s.slice(col0 + 1);
    const rows = [
        { name: 'reference', seq: ref },
        { name: 'synonymous', seq: mut(mut(ref, 4 * 3 + 2, 'C'), 29 * 3 + 2, 'A') },
        { name: 'missense', seq: mut(ref, 7 * 3 + 1, 'A') },
        { name: 'early_stop', seq: mut(ref, 14 * 3 + 2, 'A') },
        { name: 'frameshift', seq: mut(ref, 19 * 3 + 1, '-') },
        { name: 'codon_deleted', seq: ref.slice(0, 24 * 3) + '---' + ref.slice(25 * 3) },
    ];
    fs.writeFileSync(path.join(OUT, 'codons.fa'), fasta(rows));
    truth.codons = {
        // columns are 1-based
        synonymous: { row: 'synonymous', columns1: [15, 90] },
        missense: { row: 'missense', columns1: [23], from: 'GCA (Ala)', to: 'GAA (Glu)' },
        stop: { row: 'early_stop', codon: 15, columns1: [43, 44, 45] },
        frameshift: { row: 'frameshift', column1: 59 },
        codonDeleted: { row: 'codon_deleted', columns1: [73, 75] },
        protein: { reference: null },
    };
    const tr = (s) => { const T = { TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L', CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L', ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M', GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V', TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S', CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P', ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T', GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A', TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*', CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q', AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K', GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E', TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W', CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R', AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R', GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G' }; let o = ''; for (let i = 0; i + 3 <= s.length; i += 3) o += T[s.slice(i, i + 3)]; return o; };
    truth.codons.protein.reference = tr(ref);
}

// ── 4. Consensus and shading: 20 rows, zones of set agreement (share of rows with the column's main base) ──
{
    const N = 20;
    // [first column, last column (1-based), rows with the main base, what the others carry]
    const zones = [
        [1, 20, 20, 'none'],       // all agree: black (>= 90 %)
        [21, 40, 16, 'base'],      // 80 %: dark (70-89 %)
        [41, 60, 12, 'base'],      // 60 %: light (50-69 %)
        [61, 76, 7, 'base'],       // 35 %: no shading; consensus "-" (below 50 %)
        [77, 80, 10, 'half'],      // 10 A + 10 G: consensus R (Ambiguous), light shading (50 %)
        [81, 96, 4, 'gap'],        // 4 rows have a base, 16 a gap: coverage 20 % < 30 %, consensus "-"
        [97, 120, 20, 'none'],     // all agree again
    ];
    const L = 120, rows = Array.from({ length: N }, () => new Array(L));
    const expectCons = [], expectShade = [];
    for (const [a, b, k, rest] of zones) {
        for (let c = a - 1; c < b; c++) {
            const main = rest === 'half' ? 'A' : pick(B);
            // which rows carry the main base: a fresh draw per column, so no row is always the odd one
            const order = Array.from({ length: N }, (_, i) => i).sort(() => rnd() - 0.5);
            const used = new Set();
            for (let j = 0; j < N; j++) {
                const r = order[j];
                if (j < k) { rows[r][c] = main; continue; }
                if (rest === 'gap') { rows[r][c] = '-'; continue; }
                if (rest === 'half') { rows[r][c] = 'G'; continue; }
                // the others: other bases, none of them as common as the main one
                const ok = B.split('').filter(x => x !== main && (used[x] || 0) + 1 < k);
                const o = pick(ok);
                used[o] = (used[o] || 0) + 1;
                rows[r][c] = o;
            }
            const counts = {}; let nonGap = 0;
            for (let r = 0; r < N; r++) { const x = rows[r][c]; if (x === '-') continue; nonGap++; counts[x] = (counts[x] || 0) + 1; }
            const max = Math.max(...Object.values(counts));
            const tops = Object.keys(counts).filter(x => counts[x] === max).sort();
            let cons;
            if (nonGap / N < 0.30) cons = '-';
            else if (max / N >= 0.5) cons = tops.length === 1 ? tops[0] : (tops.join('') === 'AG' ? 'R' : '?');
            else cons = '-';
            expectCons.push(cons);
            const pct = 100 * max / N;
            expectShade.push(pct >= 90 ? 'black' : pct >= 70 ? 'dark' : pct >= 50 ? 'light' : 'none');
        }
    }
    const out = rows.map((r, i) => ({ name: `copy_${String(i + 1).padStart(2, '0')}`, seq: r.join('') }));
    fs.writeFileSync(path.join(OUT, 'consensus.fa'), fasta(out));
    truth.consensus = { zones: zones.map(([a, b, k, rest]) => ({ from: a, to: b, mainRows: k, of: N, rest })), consensusAmbiguous: expectCons.join(''), shading: expectShade };
}

fs.writeFileSync(path.join(OUT, 'truth.json'), JSON.stringify(truth, null, 1) + '\n');
console.log('wrote', fs.readdirSync(OUT).join(' '));
