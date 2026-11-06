/**
 * bam-parser.js — Zero-dependency BAM file parser for the browser.
 *
 * Uses the browser's built-in DecompressionStream to handle BGZF (concatenated
 * gzip), then parses the BAM binary format per the SAM/BAM specification
 * (https://samtools.github.io/hts-specs/SAMv1.pdf, §4.2).
 *
 * No npm dependencies. No build step. No server required.
 *
 * Reference:
 *   Li H, Handsaker B, Wysoker A, et al. (2009) The Sequence Alignment/Map
 *   format and SAMtools. Bioinformatics 25(16):2078-2079.
 */

// ── Constants ────────────────────────────────────────────────────────────────

const BAM_MAGIC = 0x014D4142; // "BAM\1" as read by getUint32(0, /*littleEndian=*/true)
// Records kept in memory at most (about 0.5 KB each); a file with more is cut there and the message says so.
// There used to be a 1000-read limit that refused the whole file, taken before the gene's reference was chosen.
const MAX_READS = 2000000;
// Reads that are not evidence of the sample (as the sample row's caller): unmapped, secondary, QC-failed, duplicate,
// supplementary. igv.js hides QC-failed and duplicates by default and shows secondary and supplementary; here all four
// start hidden. With keepFlagged only unmapped reads are dropped: the Reads view keeps the others to show on request.
const SKIP_FLAGS = [[0x4, 'unmapped'], [0x100, 'secondary'], [0x200, 'QC-failed'], [0x400, 'duplicate'], [0x800, 'supplementary']];
function skipReason(flag, keepFlagged) {
    if (keepFlagged) return flag & 0x4 ? 'unmapped' : null;
    for (const [bit, why] of SKIP_FLAGS) if (flag & bit) return why;
    return null;
}
const SEQ_DECODE = '=ACMGRSVTWYHKDBN'; // 4-bit → IUPAC base (0==, 1=A, 2=C, 4=G, 8=T...)
const SEQ_CODES = Uint8Array.from({ length: 16 }, (_, i) => (SEQ_DECODE[i] || 'N').charCodeAt(0));
const CIGAR_OPS = 'MIDNSHP=X';

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Decompress a BAM file (BGZF = concatenated gzip) into a Uint8Array.
 * Uses the browser's built-in DecompressionStream — no external libraries.
 *
 * Chrome's DecompressionStream stops after the first gzip member and errors
 * on the rest ("Failed to fetch"), so a whole BGZF file cannot be piped
 * through one stream. Each BGZF block is decompressed on its own instead,
 * using the block size stored in its "BC" extra field.
 */
async function decompressBAM(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const split = splitBgzfBlocks(bytes);
    if (!split) {
        // Not BGZF (plain single-member gzip): one stream is fine
        return gunzipBytes(bytes);
    }
    const { blocks, truncated } = split;
    const parts = await Promise.all(blocks.map(gunzipBytes));
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    // A cut-off file keeps its complete blocks; the caller warns about the rest
    if (truncated) out.truncated = true;
    return out;
}

async function gunzipBytes(bytes) {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('Reading compressed files (.gz, BAM) needs a newer browser: Chrome/Edge 80+, Firefox 113+ or Safari 16.4+.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Size of the BGZF block starting at `off`, from its "BC" extra subfield, or
 * -1 when the bytes there are not a BGZF block header.
 */
function bgzfBlockSize(bytes, off) {
    // gzip magic + FEXTRA flag; BGZF always sets FEXTRA
    if (bytes[off] !== 0x1f || bytes[off + 1] !== 0x8b || !(bytes[off + 3] & 4)) return -1;
    const xlen = bytes[off + 10] | (bytes[off + 11] << 8);
    for (let p = off + 12; p < off + 12 + xlen; ) {
        const slen = bytes[p + 2] | (bytes[p + 3] << 8);
        if (bytes[p] === 66 && bytes[p + 1] === 67 && slen === 2) {
            return (bytes[p + 4] | (bytes[p + 5] << 8)) + 1;
        }
        p += 4 + slen;
    }
    return -1;
}

/**
 * True when `bytes` (the start of a file) is a BAM: a BGZF block whose
 * content begins with the "BAM\1" magic. Lets a BAM be recognised by content
 * whatever its file name.
 */
async function sniffBam(bytes) {
    const bsize = bgzfBlockSize(bytes, 0);
    if (bsize <= 0 || bsize > bytes.length) return false;
    try {
        const head = await gunzipBytes(bytes.subarray(0, bsize));
        return head.length >= 4 && head[0] === 0x42 && head[1] === 0x41 && head[2] === 0x4d && head[3] === 0x01;
    } catch (e) {
        return false;
    }
}

/**
 * Split a BGZF file into its gzip members: { blocks, truncated }. Returns null
 * if the data is not BGZF (the first block has no "BC" extra subfield).
 * `truncated` is true when the file stops inside a block or does not end with
 * the empty BGZF end-of-file block; the complete blocks before that are kept.
 */
function splitBgzfBlocks(bytes) {
    const blocks = [];
    let off = 0;
    let sawEof = false;
    while (off < bytes.length) {
        const bsize = bgzfBlockSize(bytes, off);
        if (bsize <= 0 || off + bsize > bytes.length) {
            if (off === 0) return null;
            return { blocks, truncated: true };
        }
        // ISIZE (last 4 bytes) of 0 marks an empty block, e.g. the BGZF EOF marker
        const isize = new DataView(bytes.buffer, bytes.byteOffset + off + bsize - 4, 4).getUint32(0, true);
        if (isize > 0) blocks.push(bytes.subarray(off, off + bsize));
        sawEof = isize === 0;
        off += bsize;
    }
    return { blocks, truncated: !sawEof };
}

/**
 * Parse a BAM header from a decompressed buffer.
 * Returns { headerText, refNames[], refLengths[], headerEndOffset }.
 */
function parseBAMHeader(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    if (dv.getUint32(0, true) !== BAM_MAGIC) {
        throw new Error('Not a valid BAM file (bad magic number)');
    }

    const l_text = dv.getUint32(4, true);
    const headerText = new TextDecoder().decode(buf.subarray(8, 8 + l_text));

    let off = 8 + l_text;
    const n_ref = dv.getUint32(off, true);
    off += 4;

    const refNames = [];
    const refLengths = [];

    for (let i = 0; i < n_ref; i++) {
        const nameLen = dv.getUint32(off, true);
        off += 4;
        const name = new TextDecoder().decode(buf.subarray(off, off + nameLen - 1)); // -1 for null terminator
        off += nameLen;
        const refLen = dv.getUint32(off, true);
        off += 4;
        refNames.push(name);
        refLengths.push(refLen);
    }

    return { headerText, refNames, refLengths, headerEndOffset: off };
}

/**
 * Parse a single BAM alignment record from a decompressed buffer at a given offset.
 * Returns { record, nextOffset } or null if at end.
 *
 * Each record (BAM spec §4.2):
 *   block_size (int32) — total size of this record's data (excluding this field)
 *   refID, pos, l_read_name, mapq, bin, n_cigar_op, flag, l_seq (core fields)
 *   next_refID, next_pos, tlen
 *   read_name, cigar, seq, qual, tags
 */
// A read that stays in the decompressed BAM: seq, qual and tags are decoded when asked for, once. Decoding every read on
// opening took 2.3 s for 200,000 short reads and 5.8 s for 30 Mb of long reads; a view shows a few dozen. The caller
// (sample-call.js) counts straight from the packed bases: _b, _so (offset of the bases), _n (length), _hq (has qualities).
const NAME_DECODER = new TextDecoder(), LATIN1 = new TextDecoder('latin1');
const SINGLE_CIGAR = new Map();   // most reads have one CIGAR operation: one shared array per length. Never changed.
class BamRecord {
    constructor(name, refID, pos, mapq, flag, cigar, tlen, nextRef, nextPos, buf, seqOff, lSeq, hasQual, tagOff, tagEnd) {
        this.name = name; this.refID = refID; this.pos = pos; this.mapq = mapq; this.flag = flag; this.cigar = cigar;
        this.tlen = tlen; this.next_refID = nextRef; this.next_pos = nextPos;
        this._b = buf; this._so = seqOff; this._n = lSeq; this._hq = hasQual; this._to = tagOff; this._te = tagEnd;
        this._seq = null; this._qual = null; this._tags = null;
    }
    get seq() {
        if (this._seq === null) {
            const n = this._n, b = this._b, so = this._so, out = new Uint8Array(n);
            for (let i = 0; i < n; i++) out[i] = SEQ_CODES[(b[so + (i >> 1)] >> ((~i & 1) << 2)) & 15];
            this._seq = LATIN1.decode(out);
        }
        return this._seq;
    }
    get qual() {
        if (this._qual === null) {
            if (!this._hq) this._qual = '';
            else {
                const n = this._n, b = this._b, qo = this._so + ((n + 1) >> 1);
                let s = '';
                for (let i = 0; i < n; i++) s += String.fromCharCode(b[qo + i] + 33);
                this._qual = s;
            }
        }
        return this._qual;
    }
    get tags() {
        if (this._tags === null) this._tags = parseBAMTags(this._b, this._to, this._te);
        return this._tags;
    }
}
function parseBAMTags(buf, start, tagEnd) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let pos = start;
    const tags = {};
    while (pos + 2 < tagEnd) {
        const tag = String.fromCharCode(buf[pos], buf[pos + 1]);
        pos += 2;
        const type = String.fromCharCode(buf[pos]); pos += 1;

        switch (type) {
            case 'A': tags[tag] = String.fromCharCode(buf[pos]); pos += 1; break;
            // the 1- and 2-byte integer types (samtools writes NM, AS, ... in the smallest that fits):
            // unhandled, they ended the tag loop and every later tag of the record was lost
            case 'c': tags[tag] = dv.getInt8(pos); pos += 1; break;
            case 'C': tags[tag] = dv.getUint8(pos); pos += 1; break;
            case 's': tags[tag] = dv.getInt16(pos, true); pos += 2; break;
            case 'S': tags[tag] = dv.getUint16(pos, true); pos += 2; break;
            case 'i': case 'I': {
                let val = 0;
                if (type === 'i') {
                    val = dv.getInt32(pos, true); pos += 4;
                } else {
                    val = dv.getUint32(pos, true); pos += 4;
                }
                tags[tag] = val;
                break;
            }
            case 'f': tags[tag] = dv.getFloat32(pos, true); pos += 4; break;
            case 'Z': case 'H': {
                let end = pos;
                while (end < tagEnd && buf[end] !== 0) end++;
                tags[tag] = new TextDecoder().decode(buf.subarray(pos, end));
                pos = end + 1;
                break;
            }
            case 'B': {
                const btype = String.fromCharCode(buf[pos]); pos += 1;
                const count = dv.getUint32(pos, true); pos += 4;
                const arr = [];
                for (let j = 0; j < count; j++) {
                    switch (btype) {
                        case 'c': arr.push(dv.getInt8(pos)); pos += 1; break;
                        case 'C': arr.push(dv.getUint8(pos)); pos += 1; break;
                        case 's': arr.push(dv.getInt16(pos, true)); pos += 2; break;
                        case 'S': arr.push(dv.getUint16(pos, true)); pos += 2; break;
                        case 'i': arr.push(dv.getInt32(pos, true)); pos += 4; break;
                        case 'I': arr.push(dv.getUint32(pos, true)); pos += 4; break;
                        case 'f': arr.push(dv.getFloat32(pos, true)); pos += 4; break;
                        default: pos = tagEnd; j = count; break;   // unknown element type: stop at the record end
                    }
                }
                tags[tag] = arr;
                break;
            }
            default:
                // Unknown tag type — skip the rest of the block to be safe
                pos = tagEnd;
                break;
        }
    }

    return tags;
}
function parseBAMRecord(buf, offset, dvIn) {
    if (offset + 4 > buf.length) return null;

    const dv = dvIn || new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const blockSize = dv.getUint32(offset, true);
    if (blockSize === 0 || offset + 4 + blockSize > buf.length) return null;

    let pos = offset + 4;
    const refID   = dv.getInt32(pos, true);  pos += 4;
    const rpos    = dv.getInt32(pos, true);  pos += 4;
    const lName   = dv.getUint8(pos);        pos += 1;
    const mapq    = dv.getUint8(pos);        pos += 1;
    pos += 2;                                            // bin
    const nCigar  = dv.getUint16(pos, true); pos += 2;
    const flag    = dv.getUint16(pos, true); pos += 2;
    const lSeq    = dv.getUint32(pos, true); pos += 4;
    const nextRef = dv.getInt32(pos, true);  pos += 4;
    const nextPos = dv.getInt32(pos, true);  pos += 4;
    const tlen    = dv.getInt32(pos, true);  pos += 4;

    // Read name
    const name = NAME_DECODER.decode(buf.subarray(pos, pos + lName - 1)); // -1 for null
    pos += lName;

    // CIGAR
    let cigarOps;
    if (nCigar === 1) {
        const raw = dv.getUint32(pos, true);
        cigarOps = SINGLE_CIGAR.get(raw);
        if (!cigarOps) { cigarOps = [{ len: raw >>> 4, op: CIGAR_OPS[raw & 0xF] }]; if (SINGLE_CIGAR.size < 100000) SINGLE_CIGAR.set(raw, cigarOps); }
        pos += 4;
    } else {
        cigarOps = [];
        for (let i = 0; i < nCigar; i++) {
            const cigRaw = dv.getUint32(pos, true); pos += 4;
            cigarOps.push({ len: cigRaw >>> 4, op: CIGAR_OPS[cigRaw & 0xF] });
        }
    }

    // Bases (4-bit, 2 per byte, high nibble first), then qualities: 0xFF first means none ('*' in SAM)
    const seqOff = pos, seqBytes = (lSeq + 1) >> 1;
    pos += seqBytes;
    const hasQual = lSeq > 0 && buf[pos] !== 0xFF;
    pos += lSeq;
    const tagEnd = offset + 4 + blockSize;

    return {
        record: new BamRecord(name, refID, rpos, mapq, flag, cigarOps, tlen, nextRef, nextPos, buf, seqOff, lSeq, hasQual, pos, tagEnd),
        nextOffset: tagEnd,
    };
}

/**
 * Parse all alignment records from a decompressed BAM buffer. Reads that are not evidence (skipReason) are
 * dropped and counted; at most MAX_READS are kept.
 *
 * Returns { records[], exceededLimit: bool, totalReads: number (all records), skipped: { reason: count } }
 */
function parseBAMRecords(buf, headerEndOffset, keepFlagged) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const records = [];
    let offset = headerEndOffset;
    let totalReads = 0;
    let exceededLimit = false;
    const skipped = {};

    while (offset < buf.length) {
        const result = parseBAMRecord(buf, offset, dv);
        if (!result) break;
        offset = result.nextOffset;
        totalReads++;
        const why = skipReason(result.record.flag, keepFlagged);
        if (why || !result.record.cigar.length) { skipped[why || 'no CIGAR'] = (skipped[why || 'no CIGAR'] || 0) + 1; continue; }
        if (records.length >= MAX_READS) { exceededLimit = true; continue; }
        records.push(result.record);
    }

    return { records, exceededLimit, totalReads, skipped };
}

/**
 * Expand a CIGAR array into a display string showing how the read aligns
 * to the reference. Returns an array of { type, base, refBase } triples.
 *
 * readPos is the index into the read sequence.
 * The returned array represents aligned columns ready for rendering.
 */
function expandCigar(read, refBaseFn) {
    const columns = [];
    let readPos = 0;
    let refPos = read.pos;

    for (const op of read.cigar) {
        switch (op.op) {
            case 'M':
            case '=':
            case 'X':
                // Match/mismatch: read base vs reference base
                for (let i = 0; i < op.len; i++) {
                    const base = read.seq[readPos + i] || 'N';
                    const refBase = refBaseFn(refPos + i);
                    columns.push({
                        type: (op.op === '=') ? 'match' : (op.op === 'X') ? 'mismatch' : (base === refBase ? 'match' : 'mismatch'),
                        base,
                        refBase,
                        readPos: readPos + i,
                    });
                }
                readPos += op.len;
                refPos += op.len;
                break;

            case 'I':
                // Insertion: bases in read, no reference counterpart
                for (let i = 0; i < op.len; i++) {
                    columns.push({
                        type: 'insertion',
                        base: read.seq[readPos + i] || 'N',
                        refBase: null,
                        readPos: readPos + i,
                    });
                }
                readPos += op.len;
                break;

            case 'D':
                // Deletion: bases in reference, gap in read
                for (let i = 0; i < op.len; i++) {
                    columns.push({
                        type: 'deletion',
                        base: '-',
                        refBase: refBaseFn(refPos + i),
                        readPos: -1,
                    });
                }
                refPos += op.len;
                break;

            case 'N':
                // Splice junction / intron: skip in both
                for (let i = 0; i < op.len; i++) {
                    columns.push({
                        type: 'intron',
                        base: '\u2026', // …
                        refBase: refBaseFn(refPos + i),
                        readPos: -1,
                    });
                }
                refPos += op.len;
                break;

            case 'S':
                // Soft clip: bases in read, before/after alignment
                for (let i = 0; i < op.len; i++) {
                    columns.push({
                        type: 'softclip',
                        base: read.seq[readPos + i] || 'N',
                        refBase: null,
                        readPos: readPos + i,
                    });
                }
                readPos += op.len;
                break;

            case 'H':
                // Hard clip: not present in SEQ
                break;

            case 'P':
                // Padding: silent deletion from padded SAM
                break;
        }
    }
    return columns;
}

/**
 * CIGAR to compact string (e.g., "150M").
 */
function cigarToString(cigar) {
    return cigar.map(op => op.len + op.op).join('');
}

/**
 * Check if BAM references match loaded sequences.
 * Returns { matchedRef: string|null, warnings: string[] }
 */
function checkRefMatch(bamRefNames, bamRefLengths, loadedSeqs, readsPerRef) {
    const loadedNames = new Set(loadedSeqs.map(s => s.name));
    const warnings = [];
    let matchedRef = null;

    // Several header references can be loaded (a region subset keeps the full header): take the one with the
    // most reads (readsPerRef[refID]), not simply the first, which may have none
    let pick = -1, most = 0;
    if (readsPerRef) bamRefNames.forEach((name, i) => { if (loadedNames.has(name) && (readsPerRef[i] || 0) > most) { most = readsPerRef[i]; pick = i; } });
    for (let i = pick >= 0 ? pick : 0; i < bamRefNames.length; i++) {
        const name = bamRefNames[i];
        if (loadedNames.has(name)) {
            matchedRef = name;
            // Check length
            const loadedSeq = loadedSeqs.find(s => s.name === name);
            if (loadedSeq && bamRefLengths[i] !== loadedSeq.seq.length) {
                warnings.push(
                    `Reference length mismatch for "${name}": ` +
                    `BAM header says ${bamRefLengths[i].toLocaleString()} bp, ` +
                    `loaded FASTA is ${loadedSeq.seq.length.toLocaleString()} bp.`
                );
            }
            break;
        }
    }

    if (!matchedRef) {
        warnings.push(
            `No matching reference found. BAM references: [${bamRefNames.join(', ')}]. ` +
            `Loaded sequences: [${loadedSeqs.map(s => s.name).join(', ')}].`
        );
    }

    return { matchedRef, warnings };
}

// ── Indexed reading (.bai): only the compressed blocks a region needs ──────────
// A whole-genome BAM is gigabytes: decompressing it all in the browser is not possible. With its .bai index
// (samtools index) only the BGZF blocks holding reads of the loaded region are read, as IGV does.
// SAMv1 spec section 5: bins, chunks of virtual offsets (compressed offset << 16 | offset in the block), and a
// 16 kb linear index of the smallest virtual offset per window.

function _vo(dv, o) {
    const lo = dv.getUint32(o, true), hi = dv.getUint32(o + 4, true);
    return { c: hi * 65536 + (lo >>> 16), u: lo & 0xffff };
}
const _voCmp = (a, b) => (a.c - b.c) || (a.u - b.u);

/** Parse a .bai file: { refs: [{ bins: Map(bin -> [{ beg, end }]), lin: [vo] }] }. */
function parseBAI(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 8 || bytes[0] !== 0x42 || bytes[1] !== 0x41 || bytes[2] !== 0x49 || bytes[3] !== 0x01) {
        throw new Error('not a BAM index (.bai): the file does not start with BAI\\1');
    }
    const nRef = dv.getInt32(4, true);
    let o = 8;
    const refs = [];
    for (let r = 0; r < nRef; r++) {
        const bins = new Map();
        const nBin = dv.getInt32(o, true); o += 4;
        for (let b = 0; b < nBin; b++) {
            const bin = dv.getUint32(o, true), nChunk = dv.getInt32(o + 4, true); o += 8;
            const chunks = [];
            for (let k = 0; k < nChunk; k++) { chunks.push({ beg: _vo(dv, o), end: _vo(dv, o + 8) }); o += 16; }
            if (bin !== 37450) bins.set(bin, chunks);        // 37450: the metadata pseudo-bin
        }
        const nIntv = dv.getInt32(o, true); o += 4;
        const lin = [];
        for (let k = 0; k < nIntv; k++) { lin.push(_vo(dv, o)); o += 8; }
        refs.push({ bins, lin });
    }
    return { refs };
}

/** The bins that can hold alignments overlapping [beg, end) (0-based, end exclusive): SAMv1 5.3 reg2bins. */
function reg2bins(beg, end) {
    const list = [0];
    end = Math.max(beg + 1, end) - 1;
    for (let k = 1 + (beg >> 26); k <= 1 + (end >> 26); k++) list.push(k);
    for (let k = 9 + (beg >> 23); k <= 9 + (end >> 23); k++) list.push(k);
    for (let k = 73 + (beg >> 20); k <= 73 + (end >> 20); k++) list.push(k);
    for (let k = 585 + (beg >> 17); k <= 585 + (end >> 17); k++) list.push(k);
    for (let k = 4681 + (beg >> 14); k <= 4681 + (end >> 14); k++) list.push(k);
    return list;
}

/** The chunks to read for [beg, end) on reference refId, merged, after the linear-index cut. */
function baiChunks(index, refId, beg, end) {
    const ref = index.refs[refId];
    if (!ref) return [];
    let minOff = { c: 0, u: 0 };
    if (ref.lin.length) {
        let w = Math.min(beg >> 14, ref.lin.length - 1);
        while (w > 0 && ref.lin[w].c === 0 && ref.lin[w].u === 0) w--;     // empty windows hold 0
        minOff = ref.lin[w];
    }
    // and a read known to start past the region: nothing after it can overlap. htslib's max_off: the first chunk of a bin to the
    // right, going up to the parent at a first child. It was the linear index of the next window, but that is the first read
    // OVERLAPPING the window, which can start inside the region: it and every read after it were lost at the region's end
    let maxOff = null;
    for (let bin = 4681 + ((Math.max(beg + 1, end) - 1) >> 14) + 1; ; bin++) {
        while (bin % 8 === 1) bin = (bin - 1) >> 3;
        if (bin === 0) break;
        const list = ref.bins.get(bin);
        if (list && list.length) { maxOff = list.reduce((m, ch) => (_voCmp(ch.beg, m) < 0 ? ch.beg : m), list[0].beg); break; }
    }
    const chunks = [];
    // as htslib's query: chunks cut to [minOff, maxOff]. samtools merges small bins into a parent bin, whose single chunk can
    // then span the whole reference with no bin to its right: readBamRegion stops at the first record past the region
    for (const bin of reg2bins(beg, end)) for (const ch of ref.bins.get(bin) || []) {
        if (_voCmp(ch.end, minOff) <= 0 || (maxOff && _voCmp(ch.beg, maxOff) >= 0)) continue;
        chunks.push({ beg: _voCmp(ch.beg, minOff) < 0 ? minOff : ch.beg, end: maxOff && _voCmp(ch.end, maxOff) > 0 ? maxOff : ch.end });
    }
    chunks.sort((a, b) => _voCmp(a.beg, b.beg));
    const merged = [];
    for (const ch of chunks) {
        const last = merged[merged.length - 1];
        // chunks up to one block apart are one read (reads outside the region are filtered after). Bins interleave, so a region
        // gave a chunk per block, read one after the other (2.3 s for a 3.6 MB BAM)
        if (last && ch.beg.c - last.end.c <= 65536) { if (_voCmp(ch.end, last.end) > 0) last.end = ch.end; }
        else merged.push({ beg: { ...ch.beg }, end: { ...ch.end } });
    }
    return merged;
}

/**
 * The next piece of a chunk: the whole BGZF blocks in `step` compressed bytes from file offset c, decompressed, the block
 * holding `end` cut at end.u: { data, next (offset after them), done (the chunk or the file ended) }.
 */
async function readBlocks(file, c, end, step) {
    // the block holding `end` starts at end.c: never past it plus one whole block (at most 64 KiB)
    const bytes = new Uint8Array(await file.slice(c, Math.min(file.size, c + step, end.c + 65536 + 1024)).arrayBuffer());
    // the blocks first, then all decompressed at once: one at a time made an index slower than reading the whole file
    const blocks = [];
    let off = 0, cut = -1, done = false;
    while (off < bytes.length) {
        const bsize = bgzfBlockSize(bytes, off);
        if (bsize <= 0 || off + bsize > bytes.length) break;
        const atEnd = c + off === end.c;
        blocks.push(bytes.subarray(off, off + bsize));
        if (atEnd) cut = blocks.length - 1;
        off += bsize;
        if (atEnd || c + off > end.c) { done = true; break; }
    }
    if (!blocks.length || c + off >= file.size) done = true;
    const parts = await Promise.all(blocks.map(gunzipBytes));
    if (cut >= 0) parts[cut] = parts[cut].subarray(0, end.u);
    let total = 0, p = 0;
    for (const d of parts) total += d.length;
    const data = new Uint8Array(total);
    for (const d of parts) { data.set(d, p); p += d.length; }
    return { data, next: c + off, done };
}

/** The BAM header read from the start of the file, block by block until it is complete. */
async function readBamHeaderFromFile(file) {
    // Stops at the block that completes the header: gunzipping all of the first MB took up to 0.75 s. A partial header
    // always ends in a RangeError from parseBAMHeader. Past 1 MB it tries at doubling sizes, so many contigs do not cost n squared.
    const parts = [];
    let total = 0, tryAt = 0, off = 0, step = 1 << 17;   // a BGZF block is at most 64 KB
    const parse = () => {
        const have = new Uint8Array(total);
        let q = 0; for (const d of parts) { have.set(d, q); q += d.length; }
        return parseBAMHeader(have);
    };
    for (;;) {
        const bytes = new Uint8Array(await file.slice(off, Math.min(file.size, off + step)).arrayBuffer());
        let p = 0;
        while (p < bytes.length) {
            const bsize = bgzfBlockSize(bytes, p);
            if (bsize <= 0 || p + bsize > bytes.length) break;
            const d = await gunzipBytes(bytes.subarray(p, p + bsize));
            parts.push(d); total += d.length; p += bsize;
            if (total >= tryAt) {
                try { return parse(); }
                catch (e) { if (!(e instanceof RangeError)) throw e; if (total > (1 << 20)) tryAt = total * 2; }
            }
        }
        if (p === 0) throw new Error('not a BGZF-compressed BAM');
        off += p;
        if (off >= file.size) return parse();
        step = Math.min(step * 2, 64 << 20);                // a long header (many contigs): read on
    }
}

/**
 * The reads of one reference overlapping [beg, end) from an indexed BAM, flags filtered as parseBAMRecords does:
 * { records, totalReads (in the chunks read), skipped, chunks, bytesRead }.
 */
async function readBamRegion(file, index, refId, beg, end, keepFlagged) {
    const records = [], skipped = {};
    let totalReads = 0, bytesRead = 0, fileBytesRead = 0;
    const chunks = baiChunks(index, refId, beg, end);
    // A chunk is read in growing steps and left at the first record past the region: the file is sorted, so nothing later can
    // overlap. A chunk merged into a parent bin can span the reference, and baiChunks cannot cut it. A record cut by the end of
    // a step is carried into the next one.
    let past = false;
    for (const ch of chunks) {
        let c = ch.beg.c, first = ch.beg.u, carry = null, step = 1 << 17, done = false;
        while (!done && !past) {
            const got = await readBlocks(file, c, ch.end, step);
            fileBytesRead += got.next - c;
            bytesRead += got.data.length;
            c = got.next; done = got.done;
            step = Math.min(step * 2, 8 << 20);
            let buf = got.data.subarray(Math.min(first, got.data.length));
            first = 0;
            if (carry) { const joined = new Uint8Array(carry.length + buf.length); joined.set(carry); joined.set(buf, carry.length); buf = joined; }
            let off = 0;
            const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
            while (off + 4 <= buf.length) {
                const res = parseBAMRecord(buf, off, dv);
                if (!res) break;
                off = res.nextOffset;
                const r = res.record;
                if (r.refID < 0 || r.refID > refId || (r.refID === refId && r.pos >= end)) { past = true; break; }
                if (r.refID !== refId) continue;
                let span = 0;
                for (const c of r.cigar) if ('MDN=X'.includes(c.op)) span += c.len;
                if (r.pos + Math.max(1, span) <= beg) continue;
                totalReads++;
                const why = skipReason(r.flag, keepFlagged);
                if (why || !r.cigar.length) { skipped[why || 'no CIGAR'] = (skipped[why || 'no CIGAR'] || 0) + 1; continue; }
                if (records.length < MAX_READS) records.push(r);
            }
            carry = off < buf.length ? buf.slice(off) : null;
        }
        if (past) break;
    }
    return { records, totalReads, skipped, chunks: chunks.length, bytesRead, fileBytesRead };
}

/**
 * Which loaded sequence the reads go on, when the names are not identical. Only an exact name matched
 * (checkRefMatch), so 'chr7' vs '7', 'NC_000007.14' vs 'NC_000007', or a gene cut out with samtools faidx
 * ('7:1001-2000', reads still in chromosome coordinates) all failed with "Load a reference FASTA first".
 * Tried in this order, BAM references with the most reads first:
 *   exact name; faidx region 'name:start-end' (offset = start - 1, the reads are shifted onto it); the same
 *   name apart from case, a 'chr' prefix, a '.version' suffix or M/MT; a single loaded sequence whose length
 *   is the BAM reference's length (the names differ: said in the note).
 * Returns { refID, loadedIndex, offset, how, note } or null.
 */
function matchReference(bamRefNames, bamRefLengths, loadedSeqs, readsPerRef) {
    const order = bamRefNames.map((n, i) => i).sort((a, b) => ((readsPerRef && readsPerRef[b]) || 0) - ((readsPerRef && readsPerRef[a]) || 0));
    const norm = n => { let s = String(n).toLowerCase().replace(/^chr/, '').replace(/\.\d+$/, ''); return s === 'mt' ? 'm' : s; };
    const region = /^(.+):(\d[\d,]*)-(\d[\d,]*)$/;
    const hasReads = i => !readsPerRef || (readsPerRef[i] || 0) > 0;
    for (const i of order) {
        const j = loadedSeqs.findIndex(s => s.name === bamRefNames[i]);
        if (j >= 0) return { refID: i, loadedIndex: j, offset: 0, how: 'name', note: '' };
    }
    for (const i of order) {
        if (!hasReads(i)) continue;
        for (let j = 0; j < loadedSeqs.length; j++) {
            const m = region.exec(loadedSeqs[j].name);
            if (!m || (m[1] !== bamRefNames[i] && norm(m[1]) !== norm(bamRefNames[i]))) continue;
            const a = parseInt(m[2].replace(/,/g, ''), 10), b = parseInt(m[3].replace(/,/g, ''), 10);
            if (!(a >= 1 && b >= a)) continue;
            const len = loadedSeqs[j].seq.length;
            return { refID: i, loadedIndex: j, offset: a - 1, how: 'region',
                note: `reads on ${bamRefNames[i]} placed on ${loadedSeqs[j].name} (positions shifted by ${(a - 1).toLocaleString()})`
                    + (len !== b - a + 1 ? `; the region is ${(b - a + 1).toLocaleString()} bp but the sequence is ${len.toLocaleString()} bp` : '') };
        }
    }
    for (const i of order) {
        if (!hasReads(i)) continue;
        const j = loadedSeqs.findIndex(s => norm(s.name) === norm(bamRefNames[i]));
        if (j >= 0) return { refID: i, loadedIndex: j, offset: 0, how: 'alias', note: `reads on ${bamRefNames[i]} placed on ${loadedSeqs[j].name}` };
    }
    if (loadedSeqs.length === 1) {
        for (const i of order) {
            if (hasReads(i) && bamRefLengths[i] === loadedSeqs[0].seq.length) {
                return { refID: i, loadedIndex: 0, offset: 0, how: 'length',
                    note: `the names differ (reads on ${bamRefNames[i]}, sequence ${loadedSeqs[0].name}); used because the lengths are equal (${bamRefLengths[i].toLocaleString()} bp)` };
            }
        }
    }
    return null;
}

// ── Export for use in script.js (global scope) ───────────────────────────────

// window.BamParser in the page; module.exports in Node (tests/unit/bam-index.test.js)
const _bamParserApi = {
    decompressBAM,
    sniffBam,
    parseBAMHeader,
    parseBAMRecord,
    parseBAMRecords,
    expandCigar,
    cigarToString,
    checkRefMatch,
    matchReference,
    parseBAI,
    reg2bins,
    baiChunks,
    readBamHeaderFromFile,
    readBamRegion,
    MAX_READS,
    skipReason,
};
if (typeof window !== 'undefined') window.BamParser = _bamParserApi;
if (typeof module !== 'undefined' && module.exports) module.exports = _bamParserApi;
