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
// Reads that are not evidence of the sample (as the sample row's caller and IGV's defaults): unmapped,
// secondary, QC-failed, duplicate, supplementary. Dropped while parsing, counted for the message.
const SKIP_FLAGS = [[0x4, 'unmapped'], [0x100, 'secondary'], [0x200, 'QC-failed'], [0x400, 'duplicate'], [0x800, 'supplementary']];
function skipReason(flag) {
    for (const [bit, why] of SKIP_FLAGS) if (flag & bit) return why;
    return null;
}
const SEQ_DECODE = '=ACMGRSVTWYHKDBN'; // 4-bit → IUPAC base (0==, 1=A, 2=C, 4=G, 8=T...)
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
function parseBAMRecord(buf, offset) {
    if (offset + 4 > buf.length) return null;

    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const blockSize = dv.getUint32(offset, true);
    if (blockSize === 0 || offset + 4 + blockSize > buf.length) return null;

    let pos = offset + 4;
    const refID   = dv.getInt32(pos, true);  pos += 4;
    const rpos    = dv.getInt32(pos, true);  pos += 4;
    const lName   = dv.getUint8(pos);        pos += 1;
    const mapq    = dv.getUint8(pos);        pos += 1;
    const bin     = dv.getUint16(pos, true); pos += 2; // eslint-disable-line
    const nCigar  = dv.getUint16(pos, true); pos += 2;
    const flag    = dv.getUint16(pos, true); pos += 2;
    const lSeq    = dv.getUint32(pos, true); pos += 4;
    const nextRef = dv.getInt32(pos, true);  pos += 4;
    const nextPos = dv.getInt32(pos, true);  pos += 4;
    const tlen    = dv.getInt32(pos, true);  pos += 4;

    // Read name
    const name = new TextDecoder().decode(buf.subarray(pos, pos + lName - 1)); // -1 for null
    pos += lName;

    // CIGAR
    const cigarOps = [];
    for (let i = 0; i < nCigar; i++) {
        const cigRaw = dv.getUint32(pos, true); pos += 4;
        cigarOps.push({ len: cigRaw >> 4, op: CIGAR_OPS[cigRaw & 0xF] });
    }

    // Sequence (4-bit encoded: 2 bases per byte, high nibble first)
    let seq = '';
    const seqBytes = (lSeq + 1) >> 1;
    for (let i = 0; i < lSeq; i++) {
        const byte = buf[pos + (i >> 1)];
        const nibble = (i & 1) ? (byte & 0x0F) : (byte >> 4);
        seq += SEQ_DECODE[nibble] || 'N';
    }
    pos += seqBytes;

    // Quality scores (Phred + 33 offset)
    let qual = '';
    if (lSeq > 0 && buf[pos] !== 0xFF) {
        // '*' in SAM means missing quality; BAM encodes this as 0xFF
        // If the first byte is 0xFF, omit qual string
        for (let i = 0; i < lSeq; i++) {
            qual += String.fromCharCode(buf[pos + i] + 33);
        }
    }
    pos += lSeq;

    // Optional tags (remaining bytes in block)
    const tags = {};
    const tagEnd = offset + 4 + blockSize;
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

    return {
        record: {
            name,
            refID,
            pos: rpos,         // 0-based leftmost coordinate
            mapq,
            flag,
            seq,
            qual,
            cigar: cigarOps,
            tlen,
            next_refID: nextRef,
            next_pos: nextPos,
            tags,
        },
        nextOffset: tagEnd,
    };
}

/**
 * Parse all alignment records from a decompressed BAM buffer. Reads that are not evidence (skipReason) are
 * dropped and counted; at most MAX_READS are kept.
 *
 * Returns { records[], exceededLimit: bool, totalReads: number (all records), skipped: { reason: count } }
 */
function parseBAMRecords(buf, headerEndOffset) {
    const records = [];
    let offset = headerEndOffset;
    let totalReads = 0;
    let exceededLimit = false;
    const skipped = {};

    while (offset < buf.length) {
        const result = parseBAMRecord(buf, offset);
        if (!result) break;
        offset = result.nextOffset;
        totalReads++;
        const why = skipReason(result.record.flag);
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

window.BamParser = {
    decompressBAM,
    sniffBam,
    parseBAMHeader,
    parseBAMRecord,
    parseBAMRecords,
    expandCigar,
    cigarToString,
    checkRefMatch,
    matchReference,
    MAX_READS,
    skipReason,
};
