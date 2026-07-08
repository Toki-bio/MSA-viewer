// Consensus length investigation — extract and run
const fs = require('fs');
const js = fs.readFileSync('script.js','utf8');

// Extract computeConsensusForSequences
const csStart = js.indexOf('function computeConsensusForSequences');
const csEnd = js.indexOf('// PARSING FUNCTIONS', csStart);
const csFn = js.substring(csStart, csEnd);

// Mock DOM
const el = id => {
    const mocks = {
        'consensusThreshold': { value: '50' },
        'consensusMinCoverage': { value: '0' },
        'consensusFallback': { value: 'gap' },
    };
    return mocks[id] || null;
};
global.document = {
    querySelector: () => ({ value: 'simple' }),
    getElementById: el,
};

// Dependencies
eval(js.substring(js.indexOf('function clampConsensusPercent'), js.indexOf('function clampGroupConsensusPercent')));
eval(js.substring(js.indexOf('function clampMinCoverage'), js.indexOf('\r\n\r\nfunction', js.indexOf('function clampMinCoverage') + 10)));

function iupacFromBases(bases) {
    const set = new Set(bases.map(b => b.toUpperCase()));
    if (set.size === 1) return bases[0].toUpperCase();
    const pair = [...set].sort().join('');
    const map = { 'AG': 'R', 'GA': 'R', 'CT': 'Y', 'TC': 'Y', 'AC': 'M', 'CA': 'M', 'GT': 'K', 'TG': 'K', 'CG': 'S', 'GC': 'S', 'AT': 'W', 'TA': 'W' };
    return map[pair] || 'N';
}

eval(csFn);

// ===== TEST CASES =====
let pass = 0, fail = 0;

function test(name, seqs, expectedLen) {
    const seqArray = seqs.map(s => s.seq);
    const result = computeConsensusForSequences(seqArray);
    const ok = result.length === expectedLen;
    if (ok) pass++; else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: expected ${expectedLen} cols, got ${result.length}`);
    if (!ok) {
        console.log(`  Input lengths: ${seqArray.map(s => s.length).join(', ')}`);
        console.log(`  Consensus: ${result.substring(0,80)}`);
    }
}

test('All same length',           [{seq:'ACGT--TGCA'},{seq:'AC-TATTGCA'},{seq:'AC-TA-TG-A'}], 10);
test('Different lengths',         [{seq:'ACGT'},{seq:'ACGTACGT'},{seq:'AC'}], 8);
test('Alignment with gaps',       [{seq:'ATG---CGA'},{seq:'ATGTTTCGA'},{seq:'ATG---C-A'},{seq:'ATG---CGA'}], 9);
test('All-gap columns',           [{seq:'A-G'},{seq:'A-G'},{seq:'A-G'}], 3);
test('Single sequence',           [{seq:'ACGTACGT'}], 8);
test('Unaligned varying lengths', [{seq:'AAAAAAAAAA'},{seq:'TTTTT'},{seq:'GGG'}], 10);

const empty = computeConsensusForSequences([]);
console.log(`${empty === '' ? 'PASS' : 'FAIL'} Empty input: expected '', got '${empty}'`);

console.log(`\n=== ${pass}/${pass+fail} passed ===`);
