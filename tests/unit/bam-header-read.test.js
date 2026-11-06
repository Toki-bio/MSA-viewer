// With a .bai the header is read alone, and that read gunzipped every block of the first 1 MB, one after the other, to get
// a few hundred bytes: 0.12-0.2 s, and 0.5-0.75 s just after a FASTA load, when each await waits for the page. It must
// stop at the block that completes the header. Stopping early must never give a short header, so it is cut at every byte.
// Run: node tests/unit/bam-header-read.test.js
const assert = require('assert'), zlib = require('zlib');
const BP = require('../../bam-parser.js');

function block(data) {   // one BGZF block
  const gz = zlib.gzipSync(data), body = gz.subarray(10, gz.length - 8), tail = gz.subarray(gz.length - 8);
  const size = 18 + body.length + 8, head = Buffer.from([0x1f, 0x8b, 8, 4, 0, 0, 0, 0, 0, 0xff, 6, 0, 66, 67, 2, 0, (size - 1) & 255, (size - 1) >> 8]);
  return Buffer.concat([head, body, tail]);
}
function header(text, refs) {
  const parts = [Buffer.from('BAM\x01', 'latin1')], u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  parts.push(u32(text.length), Buffer.from(text), u32(refs.length));
  for (const [name, len] of refs) parts.push(u32(name.length + 1), Buffer.from(name + '\0'), u32(len));
  return Buffer.concat(parts);
}
// how many blocks were inflated
let inflated = 0; const Real = globalThis.DecompressionStream;
globalThis.DecompressionStream = class extends Real { constructor(k) { super(k); inflated++; } };
const read = async blocks => { inflated = 0; return BP.readBamHeaderFromFile(new Blob([Buffer.concat(blocks)])); };
let seed = 7; const noise = n => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) >> 16; return b; };

(async () => {
  const refs = [['chr1', 1000], ['chrT', 2000000]], small = header('@HD\tVN:1.6\n@SQ\tSN:chr1\tLN:1000\n', refs);
  const reads = []; for (let i = 0; i < 40; i++) reads.push(block(noise(20000)));
  let h = await read([block(small), ...reads]);
  assert.deepStrictEqual(h.refNames, ['chr1', 'chrT']);
  assert.deepStrictEqual(h.refLengths, [1000, 2000000]);
  assert.strictEqual(h.headerEndOffset, small.length);
  assert.strictEqual(inflated, 1, `a header in one block costs one block, took ${inflated}`);

  // cut at every byte, one block either side: never a short header
  for (let cut = 1; cut < small.length; cut++) {
    h = await read([block(small.subarray(0, cut)), block(small.subarray(cut)), ...reads.slice(0, 2)]);
    assert.deepStrictEqual(h.refNames, ['chr1', 'chrT'], `cut at ${cut}`);
    assert.strictEqual(h.headerEndOffset, small.length, `cut at ${cut}`);
    assert.ok(inflated <= 2, `cut at ${cut}: ${inflated} blocks`);
  }
  // many contigs over many blocks: all of them, and not far past the end of the header
  const many = []; for (let i = 0; i < 30000; i++) many.push(['contig_' + i, 1000 + i]);
  const big = header('@HD\tVN:1.6\n', many), blocks = [];
  for (let p = 0; p < big.length; p += 30000) blocks.push(block(big.subarray(p, p + 30000)));
  h = await read([...blocks, ...reads]);
  assert.strictEqual(h.refNames.length, 30000);
  assert.strictEqual(h.refNames[29999], 'contig_29999');
  assert.strictEqual(h.refLengths[29999], 30999);
  assert.ok(inflated <= blocks.length * 2, `${blocks.length} header blocks, ${inflated} inflated`);

  // a long header that needs a second read of the file: blocks past the first read
  const huge = []; for (let i = 0; i < 400000; i++) huge.push(['c' + i, i + 1]);
  const hb = header('', huge), hbl = [];
  for (let p = 0; p < hb.length; p += 60000) hbl.push(block(hb.subarray(p, p + 60000)));
  h = await read(hbl);
  assert.strictEqual(h.refNames.length, 400000);

  // a file that ends inside the header, and one that is no BAM, still say so
  await assert.rejects(read([block(small.subarray(0, 20))]), RangeError);
  await assert.rejects(read([block(Buffer.from('not a bam at all'))]), /bad magic/);
  await assert.rejects(BP.readBamHeaderFromFile(new Blob([Buffer.from('plain text, not compressed')])), /not a BGZF/);
  console.log('all passed');
})().catch(e => { console.error(e); process.exit(1); });
