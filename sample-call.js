// One sample row from reads on a reference: "Reads -> sample row" in the Reads view.
// No DOM: runs in the browser (window.SampleCall) and in Node (module.exports). See tests/unit/sample-call.test.js.
//
//   SampleCall.call(reads, refSeq, opts) -> { bases, insAfter, variants, covered: [lo, hi) }
//     reads: BAM records { pos (0-based), flag, cigar: [{ op, len }], seq, qual }
//     bases[p]: the sample at reference position p: A/C/G/T, an IUPAC code for two alleles, '-' deleted,
//               'N' covered by fewer than minDepth reads, '' outside the reads
//     insAfter: Map p -> bases inserted between reference positions p-1 and p
//     variants: [{ pos (1-based), type: 'snv' | 'del' | 'ins', ref, alt, zyg: 'hom' | 'het', depth, frac }]
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

    function call(reads, refSeq, opts) {
        const o = Object.assign({}, DEFAULTS, opts || {});
        const L = refSeq.length;
        const counts = Array.from({ length: L }, () => ({ A: 0, C: 0, G: 0, T: 0 }));
        const depth = new Int32Array(L);          // reads with a base or a deletion here
        const span = new Int32Array(L + 1);       // reads covering both p-1 and p (they could show an insertion there)
        const delEv = new Map(), insEv = new Map();
        let lo = L, hi = 0;

        for (const r of reads) {
            if ((r.flag || 0) & SKIP_FLAGS) continue;
            if (!r.cigar || !r.cigar.length || !r.seq) continue;
            let rp = 0, p = r.pos, first = -1, last = -1;
            for (const { op, len } of r.cigar) {
                if (op === 'M' || op === '=' || op === 'X') {
                    for (let i = 0; i < len; i++) {
                        const q = p + i;
                        if (q < 0 || q >= L) continue;
                        if (first < 0) first = q;
                        last = q;
                        depth[q]++;
                        const b = (r.seq[rp + i] || 'N').toUpperCase();
                        const bq = baseQ(r.qual, rp + i);
                        if (b in counts[q] && (bq === 255 || bq >= o.minBaseQ)) counts[q][b]++;
                    }
                    rp += len; p += len;
                } else if (op === 'D') {
                    if (p >= 0 && p + len <= L) {
                        for (let i = 0; i < len; i++) depth[p + i]++;
                        const k = p + ':' + len;
                        delEv.set(k, (delEv.get(k) || 0) + 1);
                        last = p + len - 1;
                    }
                    p += len;
                } else if (op === 'I') {
                    // only between two aligned reference positions of this read (not at a read end)
                    if (first >= 0 && p > 0 && p < L) {
                        const k = p + ':' + r.seq.substr(rp, len).toUpperCase();
                        insEv.set(k, (insEv.get(k) || 0) + 1);
                    }
                    rp += len;
                } else if (op === 'S') {
                    rp += len;
                } else if (op === 'N') {
                    p += len;                       // an intron: no evidence either way
                }
            }
            if (first >= 0) {
                for (let q = first + 1; q <= last; q++) span[q]++;
                if (first < lo) lo = first;
                if (last + 1 > hi) hi = last + 1;
            }
        }

        const bases = new Array(L).fill('');
        const variants = [];
        const deleted = new Uint8Array(L);

        // deletions: reads with the event / reads covering all of it (its depth at the first base is a fair
        // proxy: every read with a base or a deletion there)
        for (const [k, n] of delEv) {
            const [p, len] = k.split(':').map(Number);
            let d = Infinity;
            for (let i = 0; i < len; i++) d = Math.min(d, depth[p + i]);
            const frac = n / d;
            if (n < o.minAlt || frac < o.hetFrac) continue;
            const hom = frac > 0.5;
            if (hom) for (let i = 0; i < len; i++) deleted[p + i] = 1;
            variants.push({ pos: p + 1, type: 'del', ref: refSeq.substr(p, len).toUpperCase(), alt: '-', zyg: hom ? 'hom' : 'het', depth: d, frac });
        }
        const insAfter = new Map();
        for (const [k, n] of insEv) {
            const i = k.indexOf(':'), p = +k.slice(0, i), seq = k.slice(i + 1);
            const d = span[p], frac = d ? n / d : 0;
            if (n < o.minAlt || frac < o.hetFrac) continue;
            const hom = frac > 0.5;
            if (hom && (!insAfter.has(p) || insAfter.get(p).n < n)) insAfter.set(p, { seq, n });
            variants.push({ pos: p + 1, type: 'ins', ref: '-', alt: seq, zyg: hom ? 'hom' : 'het', depth: d, frac });
        }

        for (let p = 0; p < L; p++) {
            if (p < lo || p >= hi) continue;                 // outside the reads: missing, not a gap
            if (deleted[p]) { bases[p] = '-'; continue; }
            const c = counts[p], n = c.A + c.C + c.G + c.T;
            if (n < o.minDepth) { bases[p] = 'N'; continue; }
            const ranked = ['A', 'C', 'G', 'T'].sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1));
            const [a1, a2] = ranked;
            const refB = (refSeq[p] || 'N').toUpperCase();
            if (c[a2] >= o.minAlt && c[a2] / n >= o.hetFrac) {
                bases[p] = iupac(a1, a2);
                const alt = a1 === refB ? a2 : a2 === refB ? a1 : a1 + '/' + a2;
                variants.push({ pos: p + 1, type: 'snv', ref: refB, alt, zyg: 'het', depth: n, frac: (a1 === refB ? c[a2] : c[a1]) / n });
            } else {
                bases[p] = a1;
                if (a1 !== refB) variants.push({ pos: p + 1, type: 'snv', ref: refB, alt: a1, zyg: 'hom', depth: n, frac: c[a1] / n });
            }
        }
        const ins = new Map([...insAfter].map(([p, v]) => [p, v.seq]));
        variants.sort((a, b) => a.pos - b.pos || (a.type < b.type ? -1 : 1));
        return { bases, insAfter: ins, variants, covered: [lo, hi] };
    }

    const api = { call, iupac, DEFAULTS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.SampleCall = api;
})(typeof window !== 'undefined' ? window : null);
