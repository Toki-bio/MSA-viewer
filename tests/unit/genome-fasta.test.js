// FASTA read through .fai: oracle is the plain joined sequence; also proves one small slice per read, >4 GB offsets, errors.
// Run: node tests/unit/genome-fasta.test.js
const assert = require('assert');
const GF = require('../../genome-fasta.js');

let seed = 12345; const rnd = n => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) % n;
const rseq = n => { let s = ''; for (let i = 0; i < n; i++) s += 'ACGTacgtNn'[rnd(10)]; return s; };

function build(eol, width, lens) {
  let fa = '', fai = '', seqs = {};
  lens.forEach((len, k) => {
    const name = 'seq' + k, s = rseq(len);
    seqs[name] = s;
    fa += `>${name} some description${eol}`;
    const offset = fa.length;
    for (let i = 0; i < len; i += width) fa += s.slice(i, i + width) + eol;
    fai += `${name}\t${len}\t${offset}\t${width}\t${width + eol.length}\n`;
  });
  return { fa, fai, seqs };
}
// wrapper recording the size of every slice
function spy(blob) {
  const log = [];
  return { log, name: 'spy.fa', size: blob.size, slice(a, b) { log.push(b - a); return blob.slice(a, b); } };
}

(async () => {
  for (const eol of ['\n', '\r\n']) for (const w of [1, 7, 60, 70]) {
    // multiple of width, not a multiple, shorter than a line, one base
    const lens = [w * 5, w * 3 + 2, Math.max(1, w - 1), w * 4 + (w > 1 ? w - 1 : 0), 1];
    const { fa, fai, seqs } = build(eol, w, lens);
    const entries = GF.parseFai(fai);
    assert.strictEqual(entries.length, lens.length);
    const f = spy(new Blob([fa]));
    await GF.checkFai(f, entries);
    const check = async (e, s, t) => {
      f.log.length = 0;
      const got = await GF.readBases(f, e, s, t), want = seqs[e.name].slice(Math.max(0, s), Math.max(0, Math.min(e.length, t)));
      assert.strictEqual(got, want, `${e.name} w=${w} eol=${JSON.stringify(eol)} [${s},${t})`);
      assert.ok(f.log.length <= 1, 'one slice');
      if (f.log.length) {
        const lines = Math.ceil((t - s) / w) + 1;
        assert.ok(f.log[0] <= (t - s) + lines * eol.length + 4, `slice ${f.log[0]} too big for ${t - s} bases`);
      }
    };
    for (const e of entries) {
      const L = e.length;
      await check(e, 0, L); await check(e, 0, 0); await check(e, 3, 3); await check(e, -5, L + 9); await check(e, L, L + 4);
      for (let p = 0; p <= L; p += w) {
        await check(e, p, Math.min(L, p + w)); await check(e, p, L); await check(e, 0, p);
        await check(e, Math.max(0, p - 1), Math.min(L, p + 1));
      }
      for (let i = 0; i < 40; i++) { const s = rnd(L + 1), t = s + rnd(L - s + 1); await check(e, s, t); }
    }
  }

  // reads little: 100 bases from a 2 MB record
  {
    const { fa, fai } = build('\n', 60, [2000000]); const f = spy(new Blob([fa])); const e = GF.parseFai(fai)[0];
    await GF.readBases(f, e, 1234567, 1234667);
    assert.strictEqual(f.log.length, 1); assert.ok(f.log[0] <= 100 + 4, `slice ${f.log[0]}`);
  }

  // offset above 2^32 with a synthetic file: the byte at absolute position p is a function of p
  {
    const off = 5e9, w = 60, lb = 61, len = 3e9;
    const byteAt = p => {
      const rel = p - off, r = rel % lb;
      return r === w ? 10 : 'ACGT'.charCodeAt((Math.floor(rel / lb) * 7 + r) % 4);
    };
    const fake = {
      name: 'big.fa',
      slice(a, b) {
        assert.ok(b - a < 1000, 'small slice'); const u = new Uint8Array(b - a);
        for (let i = 0; i < u.length; i++) u[i] = byteAt(a + i);
        return { arrayBuffer: async () => u.buffer };
      }
    };
    const e = { name: 'big', length: len, offset: off, lineBases: w, lineBytes: lb };
    const baseAt = i => String.fromCharCode(byteAt(off + Math.floor(i / w) * lb + (i % w)));
    for (const s of [0, 59, 60, 2e9, 2.9e9 + 7, 2999999900]) {
      const t = Math.min(len, s + 130); let want = ''; for (let i = s; i < t; i++) want += baseAt(i);
      assert.strictEqual(await GF.readBases(fake, e, s, t), want, `big start ${s}`);
    }
  }

  // malformed .fai
  for (const bad of ['a\t10\t5\t60', 'a\tx\t5\t60\t61', 'a\t10\t5\t60\t59', 'a\t10\t5\t0\t0', 'a\t10\t-5\t60\t61', 'a\t1.5\t5\t60\t61'])
    assert.throws(() => GF.parseFai(bad + '\n'), /\.fai line 1 is malformed/, bad);
  assert.deepStrictEqual(GF.parseFai('a\t10\t5\t60\t61\r\nb\t3\t30\t3\t4\r\n\r\n').map(e => e.name), ['a', 'b']);

  // wrong FASTA
  {
    const a = build('\n', 60, [100, 50]);
    const other = new Blob(['>chrZ\n' + 'ACGT'.repeat(25) + '\n']);
    await assert.rejects(GF.checkFai(spy(other), GF.parseFai(a.fai)), /does not belong to spy\.fa/);
    await assert.rejects(GF.checkFai(new Blob(['x' + a.fa]), GF.parseFai(a.fai)), /does not belong/);
    await GF.checkFai(new Blob([a.fa]), GF.parseFai(a.fai));
    // the .fai is read as UTF-8, the header as bytes: a name with an accent was refused as another file's
    await GF.checkFai(new Blob([Buffer.from('>chr\u00e9-1 x\nACGT\n')]), GF.parseFai('chr\u00e9-1\t4\t' + Buffer.byteLength('>chr\u00e9-1 x\n') + '\t4\t5\n'));
  }
  console.log('genome-fasta: all passed');
})().catch(e => { console.error(e); process.exit(1); });
