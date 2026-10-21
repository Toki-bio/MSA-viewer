// One sample row from reads on a reference: "Reads -> sample row" in the Reads view.
// No DOM: runs in the browser (window.SampleCall) and in Node (module.exports). See tests/unit/sample-call.test.js.
//
//   SampleCall.call(reads, refSeq, opts) -> { bases, insAfter, variants, covered: [lo, hi) }
//     reads: BAM records { pos (0-based), flag, cigar: [{ op, len }], seq, qual }
//     bases[p]: the sample at reference position p: A/C/G/T, an IUPAC code for two alleles, '-' deleted,
//               'N' covered by fewer than minDepth reads, '' outside the reads
//     insAfter: Map p -> bases inserted between reference positions p-1 and p
//     variants: [{ pos (1-based), type: 'snv' | 'del' | 'ins', ref, alt, zyg: 'hom' | 'het', depth, frac,
//                  altFwd, altRev, refFwd, refRev (reads on the forward / reverse strand) }]
//     counts: per-position base counts per strand over the covered range (countsAt reads one position)
//
// Indels are called as events (same start, same length, same bases), not position by position: a 3-base
// deletion carried by half the reads used to be able to come out as one or two deleted bases, a false frameshift.
(function (root) {
    'use strict';

    const DEFAULTS = { minDepth: 3, hetFrac: 0.2, minAlt: 2, minBaseQ: 13 };
    const IUPAC = { AG: 'R', CT: 'Y', GT: 'K', AC: 'M', CG: 'S', AT: 'W' };
    const SKIP_FLAGS = 0x4 | 0x100 | 0x200 | 0x400 | 0x800;   // unmapped, secondary, QC fail, duplicate, supplementary

    // BAM: numbers (255 = none); SAM text: a Phred+33 string ('*' = none). A string read as numbers failed every
    // base against minBaseQ, so a SAM gave a row of N.
    function baseQ(qual, i) {
        if (!qual || !qual.length) return 255;
        if (typeof qual === 'string') return qual === '*' ? 255 : qual.charCodeAt(i) - 33;
        return qual[i];
    }

    function iupac(a, b) { return IUPAC[[a, b].sort().join('')] || 'N'; }

    const BASES = ['A', 'C', 'G', 'T', 'N'];
    const BIDX = { A: 0, C: 1, G: 2, T: 3 };

    function usable(r) { return !((r.flag || 0) & SKIP_FLAGS) && r.cigar && r.cigar.length && r.seq; }

    function call(reads, refSeq, opts) {
        const o = Object.assign({}, DEFAULTS, opts || {});
        const L = refSeq.length;
        // the covered range first, so the counts are typed arrays over it, not one object per reference base
        let lo = L, hi = 0;
        for (const r of reads) {
            if (!usable(r)) continue;
            let p = r.pos, first = -1, last = -1;
            for (const { op, len } of r.cigar) {
                if (op === 'M' || op === '=' || op === 'X' || op === 'D') {
                    const a = Math.max(0, p), b = Math.min(L, p + len) - 1;
                    if (b >= a) { if (first < 0 && op !== 'D') first = a; if (first >= 0) last = b; }
                    p += len;
                } else if (op === 'N') p += len;
            }
            if (first >= 0) { if (first < lo) lo = first; if (last + 1 > hi) hi = last + 1; }
        }
        const W = Math.max(0, hi - lo);
        // per strand, per base (A C G T N): bases at least minBaseQ; del: reads deleting the base; ins: reads with an
        // insertion just before it; depth: reads with a base (any quality) or a deletion; span: reads covering p-1 and p
        const fwd = BASES.map(() => new Int32Array(W)), rev = BASES.map(() => new Int32Array(W));
        const del = new Int32Array(W), ins = new Int32Array(W), depth = new Int32Array(W), span = new Int32Array(W + 1);
        const delEv = new Map(), insEv = new Map();      // key -> [forward reads, reverse reads]

        for (const r of reads) {
            if (!usable(r)) continue;
            const strandRev = !!((r.flag || 0) & 0x10);
            const S = strandRev ? rev : fwd;
            let rp = 0, p = r.pos, first = -1, last = -1;
            for (const { op, len } of r.cigar) {
                if (op === 'M' || op === '=' || op === 'X') {
                    for (let i = 0; i < len; i++) {
                        const q = p + i;
                        if (q < lo || q >= hi) continue;
                        if (first < 0) first = q;
                        last = q;
                        depth[q - lo]++;
                        const b = (r.seq[rp + i] || 'N').toUpperCase();
                        const bq = baseQ(r.qual, rp + i);
                        if (bq === 255 || bq >= o.minBaseQ) S[b in BIDX ? BIDX[b] : 4][q - lo]++;
                    }
                    rp += len; p += len;
                } else if (op === 'D') {
                    if (p >= lo && p + len <= hi) {
                        for (let i = 0; i < len; i++) { depth[p + i - lo]++; del[p + i - lo]++; }
                        const k = p + ':' + len;
                        const e = delEv.get(k) || [0, 0]; e[strandRev ? 1 : 0]++; delEv.set(k, e);
                        last = p + len - 1;
                    }
                    p += len;
                } else if (op === 'I') {
                    // only between two aligned reference positions of this read (not at a read end)
                    if (first >= 0 && p > lo && p < hi) {
                        const k = p + ':' + r.seq.substr(rp, len).toUpperCase();
                        const e = insEv.get(k) || [0, 0]; e[strandRev ? 1 : 0]++; insEv.set(k, e);
                        ins[p - lo]++;
                    }
                    rp += len;
                } else if (op === 'S') {
                    rp += len;
                } else if (op === 'N') {
                    p += len;                       // an intron: no evidence either way
                }
            }
            if (first >= 0) for (let q = first + 1; q <= last; q++) span[q - lo]++;
        }

        const cnt = (q, k) => fwd[k][q - lo] + rev[k][q - lo];
        const bases = new Array(L).fill('');
        const variants = [];
        const deleted = new Uint8Array(L);

        // deletions: reads with the event / reads covering all of it (its depth at the first base is a fair
        // proxy: every read with a base or a deletion there)
        for (const [k, e] of delEv) {
            const [p, len] = k.split(':').map(Number);
            const n = e[0] + e[1];
            let d = Infinity;
            for (let i = 0; i < len; i++) d = Math.min(d, depth[p + i - lo]);
            const frac = n / d;
            if (n < o.minAlt || frac < o.hetFrac) continue;
            const hom = frac >= 1 - o.hetFrac;   // as for bases: homozygous when the rest is below the het fraction
            if (hom) for (let i = 0; i < len; i++) deleted[p + i] = 1;
            variants.push({ pos: p + 1, type: 'del', ref: refSeq.substr(p, len).toUpperCase(), alt: '-', zyg: hom ? 'hom' : 'het', depth: d, frac, altFwd: e[0], altRev: e[1] });
        }
        const insAfter = new Map();
        for (const [k, e] of insEv) {
            const i = k.indexOf(':'), p = +k.slice(0, i), seq = k.slice(i + 1);
            const n = e[0] + e[1];
            const d = span[p - lo], frac = d ? n / d : 0;
            if (n < o.minAlt || frac < o.hetFrac) continue;
            const hom = frac >= 1 - o.hetFrac;   // as for bases: homozygous when the rest is below the het fraction
            if (hom && (!insAfter.has(p) || insAfter.get(p).n < n)) insAfter.set(p, { seq, n });
            variants.push({ pos: p + 1, type: 'ins', ref: '-', alt: seq, zyg: hom ? 'hom' : 'het', depth: d, frac, altFwd: e[0], altRev: e[1] });
        }

        for (let p = lo; p < hi; p++) {
            if (deleted[p]) { bases[p] = '-'; continue; }
            const c = [0, 1, 2, 3].map(k => cnt(p, k)), n = c[0] + c[1] + c[2] + c[3];
            if (n < o.minDepth) { bases[p] = 'N'; continue; }
            const ranked = [0, 1, 2, 3].sort((a, b) => c[b] - c[a] || a - b);
            const [k1, k2] = ranked, a1 = BASES[k1], a2 = BASES[k2];
            const refB = (refSeq[p] || 'N').toUpperCase();
            const strands = k => ({ altFwd: fwd[k][p - lo], altRev: rev[k][p - lo] });
            if (c[k2] >= o.minAlt && c[k2] / n >= o.hetFrac) {
                bases[p] = iupac(a1, a2);
                const altK = a1 === refB ? k2 : k1;
                const alt = a1 === refB ? a2 : a2 === refB ? a1 : a1 + '/' + a2;
                variants.push({ pos: p + 1, type: 'snv', ref: refB, alt, zyg: 'het', depth: n, frac: c[altK] / n, ...strands(altK) });
            } else {
                bases[p] = a1;
                if (a1 !== refB) variants.push({ pos: p + 1, type: 'snv', ref: refB, alt: a1, zyg: 'hom', depth: n, frac: c[k1] / n, ...strands(k1) });
            }
        }
        // the reference allele's reads per strand, for the strand-balance column
        for (const v of variants) {
            const q = v.pos - 1, k = BIDX[(refSeq[q] || 'N').toUpperCase()];
            v.refFwd = k == null || q < lo || q >= hi ? 0 : fwd[k][q - lo];
            v.refRev = k == null || q < lo || q >= hi ? 0 : rev[k][q - lo];
        }
        const insMap = new Map([...insAfter].map(([p, v]) => [p, v.seq]));
        variants.sort((a, b) => a.pos - b.pos || (a.type < b.type ? -1 : 1));
        return { bases, insAfter: insMap, variants, covered: [lo, hi],
                 counts: { lo, hi, fwd, rev, del, ins, depth, bases: BASES } };
    }

    // Counts at one reference position (0-based) from call().counts: { depth, del, ins, A: [fwd, rev], ... }
    function countsAt(counts, p) {
        if (!counts || p < counts.lo || p >= counts.hi) return null;
        const i = p - counts.lo, out = { depth: counts.depth[i], del: counts.del[i], ins: counts.ins[i] };
        counts.bases.forEach((b, k) => { out[b] = [counts.fwd[k][i], counts.rev[k][i]]; });
        return out;
    }

    const api = { call, countsAt, iupac, DEFAULTS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.SampleCall = api;
})(typeof window !== 'undefined' ? window : null);
