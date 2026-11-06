// The caller was rewritten for speed (counting from packed BAM bases, no string per base). Its answers must not move:
// tests/fixtures/sample-call-reference.js is the version before that, and both must agree on random reads with every
// CIGAR operation, odd and lower-case bases, poor qualities and reads over the ends, as text and as BAM records.
// Run: node tests/unit/sample-call-fast.test.js
const assert = require('assert');
const NEW = require('../../sample-call.js'), OLD = require('../fixtures/sample-call-reference.js');
const BamParser = require('../../bam-parser.js');
let seed = 1234567; const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x80000000;
const pick = a => a[(rnd() * a.length) | 0];
const CODE = '=ACMGRSVTWYHKDBN', OPS = 'MIDNSHP=X';

function makeRead(ref, i) {
  const L = ref.length, ops = [];
  let pos = (rnd() * (L - 30)) | 0, left = 20 + ((rnd() * 80) | 0), seq = '', p = pos;
  if (rnd() < 0.3) { const n = 1 + ((rnd() * 8) | 0); ops.push({ op: 'S', len: n }); for (let k = 0; k < n; k++) seq += pick('ACGT'); }
  while (left > 0 && p < L) {
    const op = pick(['M', 'M', 'M', 'M', '=', 'X', 'D', 'I', 'N']), len = op === 'D' || op === 'I' ? 1 + ((rnd() * 4) | 0) : op === 'N' ? 5 + ((rnd() * 40) | 0) : Math.min(left, 3 + ((rnd() * 40) | 0));
    if (!ops.length && 'DIN'.includes(op)) continue;
    ops.push({ op, len });
    if ('M=X'.includes(op)) { for (let k = 0; k < len; k++) { const c = ref[p + k] || 'A'; seq += rnd() < 0.08 ? pick('ACGTNRY') : c; } p += len; left -= len; }
    else if (op === 'I') { for (let k = 0; k < len; k++) seq += pick('ACGT'); left -= len; }
    else p += len;
  }
  if (rnd() < 0.2) { const n = 1 + ((rnd() * 8) | 0); ops.push({ op: 'S', len: n }); for (let k = 0; k < n; k++) seq += pick('ACGT'); }
  const noQual = rnd() < 0.15;
  let qual = ''; if (!noQual) for (let k = 0; k < seq.length; k++) qual += String.fromCharCode(33 + (rnd() < 0.2 ? (rnd() * 13) | 0 : 13 + ((rnd() * 28) | 0)));
  const flag = pick([0, 16, 0, 16, 0x100, 0x400, 0x800, 0x200, 99, 147]);
  return { name: 'r' + i, flag, pos, mapq: 60, cigar: ops, seq, qual: noQual ? '*' : qual };
}
// the same read as a BAM record, through the real parser
function toBam(r) {
  const name = Buffer.from(r.name + '\0'), n = r.seq.length, sb = (n + 1) >> 1, hasQ = r.qual !== '*';
  const size = 32 + name.length + 4 * r.cigar.length + sb + n, b = Buffer.alloc(4 + size);
  b.writeInt32LE(size, 0); b.writeInt32LE(0, 4); b.writeInt32LE(r.pos, 8); b[12] = name.length; b[13] = r.mapq;
  b.writeUInt16LE(r.cigar.length, 16); b.writeUInt16LE(r.flag, 18); b.writeInt32LE(n, 20); b.writeInt32LE(-1, 24); b.writeInt32LE(-1, 28);
  let o = 36; name.copy(b, o); o += name.length;
  for (const c of r.cigar) { b.writeUInt32LE(((c.len << 4) | OPS.indexOf(c.op)) >>> 0, o); o += 4; }
  for (let i = 0; i < n; i++) { const k = CODE.indexOf(r.seq[i].toUpperCase()); if (i & 1) b[o + (i >> 1)] |= k; else b[o + (i >> 1)] = k << 4; }
  o += sb;
  for (let i = 0; i < n; i++) b[o + i] = hasQ ? r.qual.charCodeAt(i) - 33 : 0xFF;
  return BamParser.parseBAMRecord(new Uint8Array(b), 0).record;
}
const plain = x => JSON.parse(JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v instanceof Map ? [...v] : v instanceof Set ? [...v] : v)));
let runs = 0;
for (let t = 0; t < 60; t++) {
  const L = 300 + ((rnd() * 900) | 0);
  let ref = ''; for (let i = 0; i < L; i++) ref += pick('ACGT');
  const n = 5 + ((rnd() * 200) | 0), reads = []; for (let i = 0; i < n; i++) reads.push(makeRead(ref, i));
  const a = plain(OLD.call(reads, ref)), b = plain(NEW.call(reads, ref));
  assert.deepStrictEqual(b, a, `text reads, run ${t}`);
  // upper-case view of the same reads: the BAM's 4-bit code has no lower case and no 'N' difference
  const bam = reads.map(toBam);
  for (let i = 0; i < n; i++) assert.strictEqual(bam[i].seq, reads[i].seq, 'decoded bases');
  const c = plain(NEW.call(bam, ref));
  assert.deepStrictEqual(c, a, `BAM records, run ${t}`);
  // asked for nothing: the caller must not have decoded the reads
  assert.ok(bam.every(r => r._qual === null), 'qualities stayed packed');
  runs++;
}
// lower case in text reads (a SAM may carry it)
{
  const ref = 'ACGTACGTACGTACGTACGTACGTACGTAC';
  const r = { name: 'x', flag: 0, pos: 2, mapq: 60, cigar: [{ op: 'M', len: 10 }], seq: 'gtacgnacgt', qual: 'IIIIIIIIII' };
  const rs = [r, { ...r }, { ...r }, { ...r }];
  assert.deepStrictEqual(plain(NEW.call(rs, ref)), plain(OLD.call(rs, ref)), 'lower case');
}
console.log(`all passed (${runs} random sets, text and BAM)`);
