// What a called change does to a gene: the Variants panel of the Reads view (sample row from reads).
// No DOM: runs in the browser (window.VariantEffect) and in Node (module.exports). See tests/unit/variant-effect.test.js.
//
//   VariantEffect.annotate(variant, refSeq, genes, code) -> [{ gene, region, effect, c, p, codon, aaPos, refCodon, altCodon }]
//     variant: { pos (1-based on refSeq), type: 'snv' | 'del' | 'ins', ref, alt ('A', or 'A/G' for two non-reference alleles) }
//     refSeq:  the reference the reads are on (ungapped, 0-based index = pos - 1)
//     genes:   [{ name, strand '+'|'-', coding (bool), cdsBlocks: [[start, end), ...] 0-based on refSeq, codonStart 1-3 }]
//     code:    { codon: amino acid } (the genetic code in use; '*' = stop)
//   One result per gene the change touches (overlapping genes give several); none -> one 'intergenic' result.
//   region: 'CDS', 'UTR' (exon outside the CDS), 'intron', 'splice site' (intron, within 2 bases of an exon),
//           'non-coding gene', 'intergenic'.   genes may carry blocks (all exons) for the UTR test.
//   effect: 'synonymous', 'missense', 'stop gained', 'stop lost', 'start lost', 'frameshift', 'in-frame deletion',
//           'in-frame insertion', 'intron', 'splice site', 'non-coding', 'intergenic', 'unknown codon'.
//   c.: HGVS-like coding position (1 = the A of the start codon, after codon_start); p.: one-letter, e.g. p.R140Q,
//   p.R30=, p.S51*, p.G170fs.
(function (root) {
    'use strict';

    const COMP = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N', '-': '-' };
    const comp = s => s.split('').map(b => COMP[b] || 'N').join('');
    const rc = s => comp(s).split('').reverse().join('');

    // The gene's coding positions on refSeq in transcript order (minus strand: reversed), codon_start applied
    function transcriptPositions(g) {
        const pos = [];
        for (const [a, b] of g.cdsBlocks) for (let p = a; p < b; p++) pos.push(p);
        if (g.strand === '-') pos.reverse();
        return pos.slice(Math.max(0, (g.codonStart || 1) - 1));
    }

    function translate(seq, code) {
        let aa = '';
        for (let i = 0; i + 3 <= seq.length; i += 3) aa += code[seq.substr(i, 3)] || 'X';
        return aa;
    }

    function annotateOne(v, refSeq, g, code) {
        const p0 = v.pos - 1;
        const span = [g.cdsBlocks[0][0], g.cdsBlocks[g.cdsBlocks.length - 1][1]];
        const minus = g.strand === '-';
        const out = { gene: g.name, region: '', effect: '', c: '', p: '', codon: '', aaPos: null, refCodon: '', altCodon: '' };
        if (!g.coding) return Object.assign(out, { region: 'non-coding gene', effect: 'non-coding' });
        const tpos = transcriptPositions(g);
        const idxOf = new Map(tpos.map((p, i) => [p, i]));
        const tseq = tpos.map(p => (refSeq[p] || 'N').toUpperCase()).map(b => (minus ? COMP[b] || 'N' : b)).join('');
        // where it falls: an exon, an intron (near an exon edge: splice site), or past the gene
        const inExon = q => g.cdsBlocks.some(([a, b]) => q >= a && q < b);
        const lastPos = v.type === 'del' ? p0 + v.ref.length - 1 : p0;
        const touched = [];
        for (let q = p0; q <= lastPos; q++) if (inExon(q)) touched.push(q);
        if (v.type === 'ins' && inExon(p0) && inExon(p0 - 1)) touched.push(p0);   // between two coding bases
        if (!touched.length) {
            const dist = Math.min(...g.cdsBlocks.map(([a, b]) => Math.min(Math.abs(p0 - (a - 1)), Math.abs(p0 - b))));
            // an exon outside the CDS (BED12 blocks with a thick part): UTR
            if (g.blocks && g.blocks.some(([a, b]) => p0 >= a && p0 < b)) return Object.assign(out, { region: 'UTR', effect: 'UTR' });
            const intron = p0 > span[0] && p0 < span[1];
            if (!intron) return null;
            return Object.assign(out, dist <= 1 ? { region: 'splice site', effect: 'splice site' } : { region: 'intron', effect: 'intron' });
        }
        out.region = 'CDS';
        if (v.type === 'snv') {
            const i = idxOf.get(p0);
            if (i == null) return Object.assign(out, { effect: 'unknown codon' });
            const k = Math.floor(i / 3), off = i % 3;
            const refCodon = tseq.substr(3 * k, 3);
            const refAA = code[refCodon] || 'X';
            const alts = String(v.alt).split('/').filter(a => a && a !== v.ref);
            const effects = [], ps = [], alts3 = [];
            for (const a0 of alts) {
                const a = minus ? COMP[a0] || 'N' : a0;
                const altCodon = refCodon.slice(0, off) + a + refCodon.slice(off + 1);
                const altAA = code[altCodon] || 'X';
                alts3.push(altCodon);
                let e;
                if (refCodon.length < 3 || /[^ACGT]/.test(refCodon + altCodon)) e = 'unknown codon';
                else if (altAA === refAA) e = 'synonymous';
                else if (altAA === '*') e = 'stop gained';
                else if (refAA === '*') e = 'stop lost';
                else if (k === 0 && refAA === 'M') e = 'start lost';
                else e = 'missense';
                effects.push(e);
                ps.push(`p.${refAA}${k + 1}${altAA === refAA ? '=' : altAA}`);
            }
            const cRef = minus ? COMP[v.ref] || 'N' : v.ref;
            Object.assign(out, {
                effect: effects.join(' / '), p: ps.join(' / '), aaPos: k + 1, refCodon, altCodon: alts3.join('/'),
                codon: `${refCodon}>${alts3.join('/')}`,
                c: `c.${i + 1}${cRef}>${alts.map(a => (minus ? COMP[a] || 'N' : a)).join('/')}`
            });
            return out;
        }
        // indels: the transcript positions they cover, the length, frame
        const idx = touched.map(q => idxOf.get(q)).filter(x => x != null).sort((a, b) => a - b);
        if (!idx.length) return Object.assign(out, { effect: 'unknown codon' });
        const len = v.type === 'del' ? touched.length : v.alt.length;
        const k = Math.floor(idx[0] / 3);
        const refAA = code[tseq.substr(3 * k, 3)] || 'X';
        const frameshift = len % 3 !== 0;
        out.aaPos = k + 1;
        out.refCodon = tseq.substr(3 * k, 3);
        if (v.type === 'del') {
            out.c = idx.length > 1 ? `c.${idx[0] + 1}_${idx[idx.length - 1] + 1}del` : `c.${idx[0] + 1}del`;
            out.effect = frameshift ? 'frameshift' : 'in-frame deletion';
            if (frameshift) out.p = `p.${refAA}${k + 1}fs`;
            else {
                const k2 = Math.floor(idx[idx.length - 1] / 3);
                out.p = k2 > k ? `p.${refAA}${k + 1}_${code[tseq.substr(3 * k2, 3)] || 'X'}${k2 + 1}del` : `p.${refAA}${k + 1}del`;
            }
        } else {
            // inserted between transcript positions i-1 and i (minus strand: the other side, sequence complemented)
            const i = idxOf.get(p0), j = idxOf.get(p0 - 1);
            const a = Math.min(i, j), b = Math.max(i, j);
            const ins = minus ? rc(String(v.alt).toUpperCase()) : String(v.alt).toUpperCase();
            out.c = `c.${a + 1}_${b + 1}ins${ins}`;
            out.effect = frameshift ? 'frameshift' : 'in-frame insertion';
            const kk = Math.floor(b / 3);
            out.aaPos = kk + 1;
            out.p = frameshift ? `p.${code[tseq.substr(3 * kk, 3)] || 'X'}${kk + 1}fs` : `p.${code[tseq.substr(3 * Math.floor(a / 3), 3)] || 'X'}${Math.floor(a / 3) + 1}_${code[tseq.substr(3 * kk, 3)] || 'X'}${kk + 1}ins${translate(ins, code) || '?'}`;
        }
        return out;
    }

    function annotate(variant, refSeq, genes, code) {
        const res = [];
        for (const g of genes || []) {
            if (!g.cdsBlocks || !g.cdsBlocks.length) continue;
            const r = annotateOne(variant, refSeq, g, code);
            if (r) res.push(r);
        }
        return res.length ? res : [{ gene: '', region: 'intergenic', effect: 'intergenic', c: '', p: '', codon: '', aaPos: null, refCodon: '', altCodon: '' }];
    }

    const api = { annotate, transcriptPositions, translate };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.VariantEffect = api;
})(typeof window !== 'undefined' ? window : null);
