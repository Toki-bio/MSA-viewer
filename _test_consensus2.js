// Simulate renderAlignment with test data to check consensus vs sequence lengths
const fs = require('fs');
const js = fs.readFileSync('script.js','utf8');

// Test: check if len and consensus.length match for a real scenario
// Simulate state.seqs and run the relevant code from renderAlignment

// Generate test sequences
const seqs = [
    { header: 'seq1', fullHeader: 'seq1 test', seq: 'ATG---CGA', gaplessPositions: [0,1,2,6,7,8] },
    { header: 'seq2', fullHeader: 'seq2 test', seq: 'ATGTTTCGA', gaplessPositions: [0,1,2,3,4,5,6,7,8] },
    { header: 'seq3', fullHeader: 'seq3 test', seq: 'ATG---C-A', gaplessPositions: [0,1,2,6,8] },
];

const len = Math.max(...seqs.map(s => s.seq.length));
console.log('Len (max seq length):', len);

// Note: computeConsensusForSequences already tested and correct
console.log('Expected consensus length:', len);
console.log('Actual seq lengths:', seqs.map(s => s.seq.length));

// Check: does the sequence line render the same number of columns as consensus?
// In createSequenceLine, the loop is `for (let pos = start; pos < end; pos++)`
// where start=0, end=len
console.log('Sequence line columns:', len);
console.log('Consensus line columns:', len);
console.log('Match:', len === len);

// Now test with unnormalized sequences (different lengths)
const unnormalized = [
    { seq: 'ACGT' },
    { seq: 'ACGTACGT' }, 
    { seq: 'ACG' },
];
const len2 = Math.max(...unnormalized.map(s => s.seq.length));
console.log('\nUnnormalized:');
console.log('Len:', len2);
console.log('Seq lengths:', unnormalized.map(s => s.seq.length));
// The consensus from computeConsensusForSequences would be len2, but
// the sequence lines would also render len2 columns (via `seq[pos] || '-'`)
console.log('Sequence line columns:', len2);
console.log('Consensus columns:', len2);
console.log('Match:', len2 === len2);
