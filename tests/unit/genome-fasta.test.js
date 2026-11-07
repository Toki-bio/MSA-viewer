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
  // A .fai that does not fit its FASTA. checkFai looked at the first record's header and nothing else, so the same FASTA re-wrapped to 60
  // columns under an 80-column .fai, or a record added in front of chr2 under the old .fai, gave wrong bases with no word said.
  // Now each chromosome is checked when it is opened (header, a line end, the end of the sequence) and every read counts its line ends.
  {
    const wrap = (recs, w, eol = '\n') => {
      let fa = '', fai = '';
      for (const [name, q] of recs) {
        fa += '>' + name + eol;
        fai += `${name}\t${q.length}\t${fa.length}\t${w}\t${w + eol.length}\n`;
        for (let i = 0; i < q.length; i += w) fa += q.slice(i, i + w) + eol;
      }
      return { fa, fai };
    };
    const pure = n => { let q = ''; for (let i = 0; i < n; i++) q += 'ACGT'[rnd(4)]; return q; };
    const chr1 = pure(1000), chr2 = pure(777), recs = [['chr1', chr1], ['chr2', chr2]], FIT = /does not fit the FASTA/;
    const w80 = wrap(recs, 80), w60 = wrap(recs, 60), e80 = GF.parseFai(w80.fai), e60 = GF.parseFai(w60.fai);
    const no = (fa, e, what) => assert.rejects(GF.checkEntry(new Blob([fa]), e), FIT, what);
    // re-wrapped, both ways
    await no(w60.fa, e80[0], 'chr1, 60 columns, 80-column .fai'); await no(w60.fa, e80[1], 'chr2, 60 columns, 80-column .fai');
    await no(w80.fa, e60[0], 'chr1, 80 columns, 60-column .fai');
    await assert.rejects(GF.checkFai(new Blob([w60.fa]), e80), FIT, 'checkFai refuses a re-wrapped FASTA');
    // a record in front of chr2: chr1 still fits, chr2 does not
    const extra = wrap([['chr1', chr1], ['chrX', pure(300)], ['chr2', chr2]], 80);
    await GF.checkEntry(new Blob([extra.fa]), e80[0]);
    await no(extra.fa, e80[1], 'a record in front of chr2');
    // the same width, the sequence longer or shorter: by a part of a line, by whole lines; and a FASTA cut short
    await no(wrap([['chr1', chr1 + 'ACGT'], ['chr2', chr2]], 80).fa, e80[0], 'chr1 4 bases longer');
    await no(wrap([['chr1', chr1.slice(0, 960)]], 80).fa, GF.parseFai(wrap([['chr1', chr1.slice(0, 880)]], 80).fai)[0], 'whole lines longer');
    await no(wrap([['chr1', chr1.slice(0, 880)], ['chr2', chr2]], 80).fa, GF.parseFai(wrap([['chr1', chr1.slice(0, 960)]], 80).fai)[0], 'whole lines shorter');
    // a FASTA that ends early cannot be told from a .fai longer than its file, which the 250 Mb scroll checks open on purpose: it is taken,
    // and what can be read is right, the rest is not there
    const short = new Blob([w80.fa.slice(0, w80.fa.length - 200)]);
    await GF.checkEntry(short, e80[1]);
    const part = await GF.readBases(short, e80[1], 0, 777);
    assert.ok(part.length < 777 && chr2.startsWith(part), 'a FASTA cut short gives the bases it has, none wrong');
    // LF under a CRLF .fai
    await no(w80.fa, GF.parseFai(wrap(recs, 80, '\r\n').fai)[0], 'LF FASTA, CRLF .fai');
    // first and last lines right, a line in the middle not: only a read can see it, and it must not hand out shifted bases
    const inner = '>c\n' + 'A'.repeat(10) + '\n' + 'C'.repeat(7) + '\n' + 'G'.repeat(13) + '\n' + 'T'.repeat(10) + '\n' + 'A'.repeat(5) + '\n', ie = GF.parseFai('c\t45\t3\t10\t11\n')[0];
    await GF.checkEntry(new Blob([inner]), ie);
    await assert.rejects(GF.readBases(new Blob([inner]), ie, 5, 40), FIT, 'a short line inside a read');
    // a read running into the next record
    await assert.rejects(GF.readBases(new Blob(['>a\nACGT\n>b\nACGT\n']), { name: 'a', length: 10, offset: 3, lineBases: 4, lineBytes: 5 }, 0, 10), FIT, 'a read into the next record');

    // what must keep working: LF and CRLF, a last line with and without a line end, one short line, one base, whole last lines, a line of 2 MB
    for (const eol of ['\n', '\r\n']) for (const [w, lens] of [[80, [800, 801, 79, 1]], [60, [60, 61]], [7, [7, 8, 14]], [1, [1, 3]]]) {
      const b = wrap(lens.map((n, k) => ['s' + k, pure(n)]), w, eol), es = GF.parseFai(b.fai);
      for (const text of [b.fa, b.fa.slice(0, b.fa.length - eol.length), b.fa + eol]) {
        for (const e of es) await GF.checkEntry(new Blob([text]), e);
        await GF.checkFai(new Blob([text]), es);
      }
    }
    const one = pure(2000000), big = wrap([['one', one], ['two', 'ACGT']], 2000000), f = spy(new Blob([big.fa])), be = GF.parseFai(big.fai);
    for (const e of be) await GF.checkEntry(f, e);
    assert.ok(f.log.every(n => n < 70000), `a one-line chromosome read whole: ${Math.max(...f.log)}`);
    assert.strictEqual(await GF.readBases(new Blob([big.fa]), be[0], 1999990, 2000000), one.slice(1999990));
    await GF.checkEntry(new Blob(['>e\n>f\nACGT\n']), { name: 'e', length: 0, offset: 3, lineBases: 0, lineBytes: 1 });   // no bases: samtools lists it with 0 bases
  }

  console.log('genome-fasta: all passed');
})().catch(e => { console.error(e); process.exit(1); });
