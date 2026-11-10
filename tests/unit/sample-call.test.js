// SampleCall (sample-call.js): the sample row called from reads must show exactly the planted changes of
// tests/fixtures/reads (made by make_gene_reads.js), each with the right zygosity, and nothing else
// (0.3% sequencing errors must not turn into calls). Run: node tests/unit/sample-call.test.js
const fs = require('fs'), path = require('path');
const SC = require('../../sample-call.js');
const DIR = path.join(__dirname, '..', 'fixtures', 'reads');
// a Windows checkout gives the fixtures CRLF line ends; a '\r' left in the reference shifts every position
const ref = fs.readFileSync(path.join(DIR, 'gene_ref.fa'), 'utf8').replace(/\r/g, '').split('\n').slice(1).join('');
const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'));
const reads = fs.readFileSync(path.join(DIR, 'gene_reads.sam'), 'utf8').replace(/\r/g, '').split('\n').filter(l => l && l[0] !== '@').map(l => {
    const f = l.split('\t');
    return { name: f[0], flag: +f[1], pos: +f[3] - 1, cigar: (f[5].match(/\d+[MIDNSHP=X]/g) || []).map(t => ({ op: t.slice(-1), len: parseInt(t) })), seq: f[9], qual: [] };
});

let fails = 0;
const check = (name, ok, detail) => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : ' - ' + detail}`); if (!ok) fails++; };

const r = SC.call(reads, ref);
const key = v => `${v.type}@${v.pos}:${v.zyg}`;
const want = truth.muts.map(m => key({ type: m.del ? 'del' : m.ins ? 'ins' : 'snv', pos: m.pos + 1, zyg: m.hom ? 'hom' : 'het' }));
const got = r.variants.map(key);
check('every planted change is called, with its zygosity', want.every(k => got.includes(k)), `want ${want.join(' ')} got ${got.join(' ')}`);
check('nothing else is called (sequencing errors stay out)', got.every(k => want.includes(k)), `extra ${got.filter(k => !want.includes(k)).join(' ')}`);

// the row itself: hom changes as bases, het SNVs as IUPAC, the hom 1-base deletion as one gap, the het
// 3-base deletion NOT as a gap (one haplotype keeps the bases), the hom insertion in insAfter
const m = Object.fromEntries(truth.muts.map(x => [x.name, x]));
check('homozygous synonymous change is the alt base', r.bases[m.syn_hom.pos] === m.syn_hom.alt, r.bases[m.syn_hom.pos]);
check('heterozygous missense is an IUPAC code of ref and alt', r.bases[m.missense_het.pos] === SC.iupac(m.missense_het.ref, m.missense_het.alt), r.bases[m.missense_het.pos]);
check('heterozygous stop is an IUPAC code of ref and alt', r.bases[m.stop_het.pos] === SC.iupac(m.stop_het.ref, m.stop_het.alt), r.bases[m.stop_het.pos]);
check('homozygous 1-base deletion is one gap', r.bases[m.del1_hom.pos] === '-' && r.bases[m.del1_hom.pos - 1] !== '-' && r.bases[m.del1_hom.pos + 1] !== '-', r.bases.slice(m.del1_hom.pos - 2, m.del1_hom.pos + 3).join(''));
const d3 = r.bases.slice(m.del3_het.pos, m.del3_het.pos + 3).join('');
check('heterozygous 3-base deletion leaves the bases (no partial, frame-breaking gap)', !d3.includes('-'), d3);
check('homozygous insertion is placed before its reference position', r.insAfter.get(m.ins3_hom.pos) === m.ins3_hom.ins, JSON.stringify([...r.insAfter]));
const lastEnd = Math.max(...reads.map(x => x.pos + x.cigar.reduce((a, c) => a + ('MD=XN'.includes(c.op) ? c.len : 0), 0)));
check('covered = from the first read start to the last read end', r.covered[0] === 0 && r.covered[1] === lastEnd, JSON.stringify(r.covered) + ' want [0,' + lastEnd + ']');

// toy cases
const rd = (pos, cig, seq, flag = 0) => ({ pos, flag, cigar: (cig.match(/\d+\D/g)).map(t => ({ op: t.slice(-1), len: parseInt(t) })), seq, qual: [] });
const toyRef = 'ACGTACGTAC';
const t1 = SC.call([rd(2, '4M', 'GTAC'), rd(2, '4M', 'GTAC'), rd(2, '4M', 'GTAC')], toyRef);
check('outside the reads is empty (missing), not a gap', t1.bases.join('|') === '||G|T|A|C||||', t1.bases.join('|'));
const t2 = SC.call([rd(0, '4M', 'ACGT'), rd(0, '4M', 'ACGT')], toyRef);
check('fewer than 3 reads gives N', t2.bases.slice(0, 4).join('') === 'NNNN', t2.bases.slice(0, 4).join(''));
const t3 = SC.call([rd(0, '4M', 'ACGT', 0x400), rd(0, '4M', 'ACGT', 0x4), rd(0, '4M', 'ACGT', 0x100), rd(0, '4M', 'ACGT', 0x800)], toyRef);
check('duplicates, unmapped, secondary and supplementary reads are not counted', t3.covered[1] === 0, JSON.stringify(t3.covered));
const t4 = SC.call([rd(0, '4M', 'ACGT'), rd(0, '4M', 'ACGT'), rd(0, '4M', 'ACGT'), rd(0, '4M', 'ACTT')], toyRef);
check('a second allele in one read (below 2 reads) is not a het call', t4.bases[2] === 'G' && !t4.variants.length, t4.bases.join(''));

// qualities as a SAM gives them (a Phred+33 string) and as a BAM does (numbers)
const withQ = q => SC.call([0, 1, 2].map(() => Object.assign(rd(0, '4M', 'ACGT'), { qual: q })), toyRef).bases.slice(0, 4).join('');
check('SAM quality string (Phred+33) is read: I = 40 passes, # = 2 fails', withQ('IIII') === 'ACGT' && withQ('####') === 'NNNN', withQ('IIII') + ' ' + withQ('####'));
check('BAM quality numbers are read: 40 passes, 2 fails, 255 = none passes', withQ([40, 40, 40, 40]) === 'ACGT' && withQ([2, 2, 2, 2]) === 'NNNN' && withQ([255, 255, 255, 255]) === 'ACGT', '');

// Indels: homozygous only when at least 80% of the reads carry them, as for bases (a second allele >= 20% is
// heterozygous). At "more than half" a 50/50 deletion became homozygous by chance and a false frameshift
const delReads = (nDel, nRef) => [...Array(nDel)].map(() => rd(0, '3M1D4M', 'ACGACGT')).concat([...Array(nRef)].map(() => rd(0, '8M', 'ACGTACGT')));
const d55 = SC.call(delReads(11, 9), toyRef), d85 = SC.call(delReads(17, 3), toyRef);
check('a deletion in 55% of reads is heterozygous and stays out of the row', d55.variants.some(v => v.type === 'del' && v.zyg === 'het') && d55.bases[3] !== '-', JSON.stringify(d55.variants) + ' ' + d55.bases.join(''));
check('a deletion in 85% of reads is homozygous and is a gap in the row', d85.variants.some(v => v.type === 'del' && v.zyg === 'hom') && d85.bases[3] === '-', JSON.stringify(d85.variants));
const insReads = (nIns, nRef) => [...Array(nIns)].map(() => rd(0, '4M2I4M', 'ACGTGGACGT')).concat([...Array(nRef)].map(() => rd(0, '8M', 'ACGTACGT')));
const i55 = SC.call(insReads(11, 9), toyRef);
check('an insertion in 55% of reads is heterozygous and adds no columns', i55.variants.some(v => v.type === 'ins' && v.zyg === 'het') && i55.insAfter.size === 0, JSON.stringify(i55.variants));

// The same deletion written at two offsets of a repeat (aligners place it either end) is one event: split by
// offset, neither half reached 20% of the reads... here each half is 50%, the whole 100% (homozygous)
{
  const rep = 'ACGTTTTTACGT';                        // TTTTT at 3..7 (0-based)
  const left = () => rd(0, '3M1D8M', 'ACGTTTTACGT'), right = () => rd(0, '7M1D4M', 'ACGTTTTACGT');
  const r = SC.call([...Array(5)].map(left).concat([...Array(5)].map(right)), rep);
  const dels = r.variants.filter(v => v.type === 'del');
  check('a deletion in a homopolymer written at two offsets is one homozygous call, left-aligned', dels.length === 1 && dels[0].zyg === 'hom' && dels[0].pos === 4, JSON.stringify(dels));
  const insL = () => rd(0, '3M1I8M', 'ACGTTTTTTACGT'), insR = () => rd(0, '8M1I4M', 'ACGTTTTTTACGT');
  const ri = SC.call([...Array(5)].map(insL).concat([...Array(5)].map(insR)), rep);
  const inss = ri.variants.filter(v => v.type === 'ins');
  check('an insertion in a homopolymer written at two offsets is one homozygous call', inss.length === 1 && inss[0].zyg === 'hom', JSON.stringify(inss));
}

// Strands: each variant says how many alt (and ref) reads are on each strand; countsAt gives one position's counts
{
  const RD = path.join(__dirname, '..', 'fixtures', 'reads', 'region');
  const rref = fs.readFileSync(path.join(RD, 'region.fa'), 'utf8').replace(/\r/g, '').split('\n').slice(1).join('');
  const rtruth = JSON.parse(fs.readFileSync(path.join(RD, 'truth.json'), 'utf8'));
  const rreads = fs.readFileSync(path.join(RD, 'reads_40x.sam'), 'utf8').replace(/\r/g, '').split('\n').filter(l => l && l[0] !== '@').map(l => {
    const f = l.split('\t');
    return { name: f[0], flag: +f[1], pos: +f[3] - 1, cigar: (f[5].match(/\d+[MIDNSHP=X]/g) || []).map(t => ({ op: t.slice(-1), len: parseInt(t) })), seq: f[9], qual: f[10] };
  });
  const rr = SC.call(rreads, rref);
  const mis = rtruth.muts.find(x => x.name === 'A_missense_hom_exon2');
  const v = rr.variants.find(x => x.pos === mis.pos + 1);
  const c = SC.countsAt(rr.counts, mis.pos);
  check('a homozygous change is on both strands, no reference reads', v && v.altFwd > 3 && v.altRev > 3 && v.refFwd + v.refRev === 0, JSON.stringify(v));
  check('countsAt agrees with the variant: alt reads on each strand and the depth', c && c[mis.alt][0] === v.altFwd && c[mis.alt][1] === v.altRev && c.depth >= v.depth, JSON.stringify(c));
  // reads on the reverse strand only (flag 16) carrying a change: the counts say so
  const rv = SC.call([...Array(4)].map(() => rd(0, '4M', 'ACTT', 16)).concat([...Array(4)].map(() => rd(0, '4M', 'ACGT'))), toyRef).variants.find(x => x.pos === 3);
  check('a change only on reverse reads: altFwd 0, altRev 4', rv && rv.altFwd === 0 && rv.altRev === 4 && rv.refFwd === 4, JSON.stringify(rv));
}

// '=' in SEQ means "the same base as the reference" (SAMv1 1.4, e.g. samtools calmd -e). It was counted as N, so a
// SAM written that way gave a row of N (fewer than 3 real bases) and no calls (audit M26). Same for BAM's 4-bit code 0.
{
  const eq = SC.call([0, 1, 2].map(() => rd(0, '4M', '==T=')), toyRef);
  check("'=' bases are the reference base: the row is ACTT, the T a homozygous change", eq.bases.slice(0, 4).join('') === 'ACTT' && eq.variants.length === 1 && eq.variants[0].pos === 3 && eq.variants[0].alt === 'T', eq.bases.join('') + ' ' + JSON.stringify(eq.variants));
  const BamParser = require('../../bam-parser.js');
  // a BAM record with bases '==T=' (codes 0 0 8 0), parsed by the real parser
  const name = Buffer.from('e\0'), b = Buffer.alloc(4 + 32 + name.length + 4 + 2 + 4);
  b.writeInt32LE(b.length - 4, 0); b.writeInt32LE(0, 4); b.writeInt32LE(0, 8); b[12] = name.length; b[13] = 60;
  b.writeUInt16LE(1, 16); b.writeUInt16LE(0, 18); b.writeInt32LE(4, 20); b.writeInt32LE(-1, 24); b.writeInt32LE(-1, 28);
  let o = 36; name.copy(b, o); o += name.length; b.writeUInt32LE(4 * 16 + 0, o); o += 4; b[o++] = 0x00; b[o++] = 0x80; b.fill(0xff, o, o + 4);
  const recs = [0, 1, 2].map(() => BamParser.parseBAMRecord(new Uint8Array(b), 0).record);
  const eqB = SC.call(recs, toyRef);
  check("BAM base code 0 ('=') is the reference base", eqB.bases.slice(0, 4).join('') === 'ACTT', eqB.bases.join(''));
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
