// Does -C change anything in the WASM disttbfast? Same input, -C 0/1/2, compare.
const fs = require('fs'), crypto = require('crypto');
global.createDisttbfast = require('../disttbfast.js');
const fasta = fs.readFileSync('examples/svk_k4.fa', 'utf8').split('\n').map(l => l.startsWith('>') ? l : l.replace(/[-.]/g, '')).join('\n');
(async () => {
  const create = typeof global.createDisttbfast === 'function' ? global.createDisttbfast : global.createDisttbfast.default;
  for (const [E, C] of [['1','0'],['2','0'],['3','0'],['2','2']]) {
    const out = [], err = [];
    const mod = await create({ print: t => out.push(t), printErr: t => err.push(t), noInitialRun: true, locateFile: p => __dirname + '/../' + p });
    mod.FS.writeFile('/input.fa', fasta);
    const t0 = Date.now();
    try { mod.callMain(['-i', '/input.fa', '-E', E, '-C', C]); } catch (e) { if (!(e && e.status === 0)) err.push('EXC ' + (e.message || e)); }
    const res = out.join('\n');
    console.log(`-E ${E} -C ${C}: ${Date.now() - t0} ms, output sha1 ${crypto.createHash('sha1').update(res).digest('hex').slice(0, 12)}, ${res.length} chars; stderr lines about threads/cycles: ${JSON.stringify(err.filter(l => /thread|cycle|nguide|iterat/i.test(l)).slice(0, 4))}`);
  }
})();
