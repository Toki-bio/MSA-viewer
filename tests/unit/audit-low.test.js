'use strict';
// Small module-level checks from the v255 global audit (low-severity findings). node tests/unit/audit-low.test.js
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let fail = 0, n = 0;
function check(name, fn) {
    n++;
    try { const r = fn(); if (r !== true) { fail++; console.log('FAIL', name, '-', r); } else console.log('ok  ', name); }
    catch (e) { fail++; console.log('FAIL', name, '- threw', e.message); }
}

const BB = require(path.join(ROOT, 'block-bicluster.js'));
check('#237 bicluster: text without FASTA headers gives no rectangles instead of throwing', () => {
    const r = BB.computeBiclusterMask('', {});
    const r2 = BB.computeBiclusterMask('ACGTACGT\nACGTACGT\n', {});
    return (r && r2) ? true : 'no result object';
});

const Peel = require(path.join(ROOT, 'peel.js'));
check('#158 peel: the result names the distance actually used (k-mer when the rows are not aligned)', () => {
    const seqs = ['ACGTACGTACGTAAAA', 'ACGTACGTACGTAAA', 'TTTTGGGGCCCCAAAA', 'TTTTGGGGCCCCAA'].map((s, i) => ({ name: 's' + i, seq: s }));
    const r = Peel.peel(seqs, Object.assign({}, Peel.defaults, { metric: 'pdist' }));
    return r.metric !== 'pdist' ? true : 'metric reported as ' + r.metric;
});

// Random planted-family alignments (seeds 224 and 92) on which the old code differed
const toFasta = rows => rows.map(([n, s]) => '>' + n + '\n' + s).join('\n') + '\n';
const ALN_224 = [
    ['f0_0', 'CCACTGA-CAACACGAG-ATTCGCACGA-GTA-TATCCCAAAC---GA'],
    ['f0_1', '-C-CTGT-CGACACGCGGAG-CACAGTAGGTAGTAGCCCAAGCCTAG-'],
    ['f0_2', 'CCGCTGTACGACACGAGGA-TC-CAGT--ATAGTACCCC-AACTTAGA'],
    ['f0_3', '------AACGACACGAGGATTCG-AGT-GGTAGCATCCCAAAGCTAGA'],
    ['f1_4', 'ACAATGTTCGACATGT-GGTTAGTCGTAGGTAGGCTACGAATCCTTGA'],
    ['f1_5', '-CAATGTTCGACATGTCGATTAGTCGTAGGTAGCATCCGAATCCT-GA'],
    ['f1_6', 'ACAATGTTCCACATGCGCATTAGTCGTAGGTAGCATCCGAATCCTCGA'],
    ['f1_7', '--------------GTGCATTAGTCCTAGGTAGCATCCGAATCCTGGA'],
    ['f2_8', 'ACACTGTACTACTTG-GCCATCGG-GT--GTAGTATC-CAACACTCCA'],
    ['f2_9', '-----------CATGCGCCTTC-GAGTCTGTAGT-TCCCAACACGCCA'],
    ['f2_10', '-CACT-TA-TACATGCGC-TTCGGAGAAGGTAGTATCCCAACACGCCA'],
    ['f2_11', 'CCACTGTTTTACGTGC-CCTCCGGAGTAGGTAGTAT-CCAACACGCCG'],
    ['f2_12', 'ACACTGTACTACATGCGCCTTCG-GGTAGGTAGTATCCCAACACGCCA'],
    ['f2_13', 'T-ACTGGACTACATGAGCCTTCGGAGTAGGTAGTAGCCCAACACGCCA']
];
check('#238 bicluster: a left-over group that yields no rectangle does not end the search for the others', () => {
    // rows f2_8..f2_13 form a block at columns 41-46; the first left-over group found no rectangle and the
    // loop broke, so the result was empty
    const r = BB.computeBiclusterMask(toFasta(ALN_224), {});
    const hit = r.blocks.some(b => Array.isArray(b.rows) && b.rows.join(',') === '8,9,10,11,12,13');
    return hit ? true : 'blocks ' + JSON.stringify(r.blocks.map(b => [b.rows, b.col_start, b.col_end]));
});

const ALN_92 = [
    ['f0_0', '--------------GGAACACAACCGCAACAGCTGTGCTAATCCTAGCATGCTGCACTCGTC'],
    ['f0_1', 'TCCTATTTATGGAACGAACACAACCACATCGGCTGTGCTAAACTTAGTAGGCTGCACTCGTC'],
    ['f0_2', 'TCATA-TT-TGGAACGAACAAAACCGCAACAGCTGTGCCAAACTTAGTATGCTGCACTCGTC'],
    ['f1_3', 'TCCTAT-TATG-GACGAACCCAACCCCAACCGCTGTTATAGACGTAGTATCCTGCCGTAGTC'],
    ['f1_4', '------TTATGCGACGAACCCA-CCGCAACCGCTGTTATAGACGTAGTATCCTGCCGTAGTC'],
    ['f1_5', '--CTATTTATGCGACGAACCCAACCGCAACCGCTG-TATAGACGTAGTATCCTGCCGTAGTC'],
    ['f1_6', 'TCCTATTTATGCGA-GAACCCGACC-C-ACCGCT-TGATAGACGTAGTATCCTGC-G-AGTC'],
    ['f2_7', '---------TGCAGCGAACACAACCGCGTCAGCTGTTCTAAACGGAGT-TGCTGTCC-CGTC'],
    ['f2_8', 'TCCTGTTAATGCTGCGAACACAACCGCCTCAGCTGTTCTAAACGGAGTATGCTGTACTC-TC'],
    ['f2_9', 'TCCTGTTAAAGCAGCACACAAAACCGCCTCAGCTATACTAAAAGGA-TATGCTGCCGTCGTC'],
    ['f2_10', 'TCCTGTTAA-GCAGCGAACA-AACCGCTTGAGCTGT-CTAA-CGGAGTATGCTGTCCTCGTC'],
    ['f3_11', '------------------CACAA--G-A-CAG-CGTTCTAAACG-AG-ATG---CC-TCGTC'],
    ['f3_12', 'TCCTATTTACGCAACGAAC-GAACC-CAACAGCCGTTCTAAACGTAGTATGCGGCCCTC-TC'],
    ['f3_13', 'TCCTATTTACGCA-CGAACACAACCGCAACAGCCGTTCTAA-CGT-GTGTGCG-CGCTCG-C'],
    ['f3_14', '-CCTATTTACGCAACGAACACAACCGCA-C-GCC-T-CTAAACGT-GTAT-CGGCCCTCGTC'],
    ['x0', 'GACCCAAACCCGTTGGCAAGGGCGGAATTTAATTGCCTTAATATATATCTAGATAAGCTCCT'],
    ['x1', 'ACATACCGAATATCAATAAATTAAGCCACTTCAACTGAGGTAGTGTATTGACAAGACCGTTA'],
    ['x2', 'TGTGCGGATTCTGAAGGTTCATAGTGATATCTCAGCAGGTACCGTCATAGATCCGACTAATG']
];
const vm = require('vm');
async function checkAsync(name, fn) {
    n++;
    try { const r = await fn(); if (r !== true) { fail++; console.log('FAIL', name, '-', r); } else console.log('ok  ', name); }
    catch (e) { fail++; console.log('FAIL', name, '- threw', e.message); }
}
const asyncChecks = [];
asyncChecks.push(() => checkAsync('#188 clustering: no group comes back with fewer occurrences than the Min occurrences it was searched with', async () => {
    const ctx = { console: { log() {}, warn() {}, error() {} }, performance, setTimeout, MessageChannel, Map, Set, Array, Math, Object };
    vm.createContext(ctx);
    vm.runInContext(require('fs').readFileSync(path.join(ROOT, 'cluster.js'), 'utf8') + '\nthis.SINEClusterer = SINEClusterer;', ctx);
    const c = new ctx.SINEClusterer(ALN_92.map(([id, seq]) => ({ id, seq })));
    // the prune step re-checked Min features but not Min occurrences: with Min occurrences 6 the retry
    // returned an 11-row group with 5 occurrences
    const bad = [];
    for (const fn of ['findBestGroup', 'findBestGroupAsync']) {
        const orig = c[fn].bind(c);
        c[fn] = async (avail, opts) => {
            const g = await orig(avail, opts);
            const minOcc = opts.datasetSize > 300 ? 1 : (opts.minOccurrences || 2);
            if (g && g.nOccurrences < minOcc) bad.push(g.nOccurrences + ' < ' + minOcc);
            return g;
        };
    }
    await c.clusterChunked({ minSize: 3, minPerfect: 5, maxIterations: 10, qualitySmall: 80, qualityMedium: 70, qualityLarge: 60,
        sizeSmallMedium: 11, sizeMediumLarge: 20, minOccurrences: 6 });
    return bad.length ? 'groups returned with ' + bad.join(', ') : true;
}));

(async () => {
    for (const run of asyncChecks) await run();
    console.log(`\naudit-low: ${n - fail}/${n} passed`);
    process.exit(fail ? 1 : 0);
})();
