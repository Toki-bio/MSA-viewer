// Cut a ViewAlign commit into pieces small enough for a web reader (Qwen's reader stops near 40 KB).
//   node make_audit_chunks.js <repo> <commit> <outDir>
// Every app file (not vendor/, tests/, docs/, dev-tools/, reference/, generated wasm glue) under LIMIT bytes is
// copied whole; a bigger one is cut between top-level statements into pieces of about TARGET bytes. INDEX.md lists
// every piece with its original line range, and every named function with its piece and original line.
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const [repo, commit, out] = process.argv.slice(2);
if (!repo || !commit || !out) { console.error('usage: node make_audit_chunks.js <repo> <commit> <outDir>'); process.exit(2); }
const TARGET = 20000, LIMIT = 30000, HARD = 30000;
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
const sha = git('rev-parse', commit).trim();
const SKIP = /^(vendor|tests|docs|dev-tools|reference|node_modules|\.github)\/|^(macse-dp-wasm|disttbfast)\.js$/;
const files = git('ls-tree', '-r', '--name-only', sha).split('\n').filter(f => /\.(js|html|css)$/.test(f) && !SKIP.test(f));
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const top = /^(async\s+function|function|class|const|let|var|window\.|\(function|\}\)\(|<!--|<script|<\/script|<section|<div|\/\*|\/\/|[.#@a-zA-Z][^{]*\{\s*$)/;
const pieces = [], funcs = [];
for (const f of files) {
  const text = git('show', `${sha}:${f}`);
  const safe = f.replace(/\//g, '__');
  if (Buffer.byteLength(text) <= LIMIT) { fs.writeFileSync(path.join(out, safe), text); pieces.push({ f, file: safe, a: 1, b: text.split('\n').length }); }
  else {
    const lines = text.split('\n'); let start = 0, size = 0, n = 0;   // a final '' (file ends with a newline) stays in the last piece's join
    const flush = end => {
      n++; const name = `${safe.replace(/\.(\w+)$/, '')}_${String(n).padStart(3, '0')}.${f.split('.').pop()}.txt`;
      fs.writeFileSync(path.join(out, name), `[${f} lines ${start + 1}-${end} of ViewAlign ${sha.slice(0, 7)}]\n` + lines.slice(start, end).join('\n') + (end < lines.length ? '\n' : ''));
      pieces.push({ f, file: name, a: start + 1, b: end }); start = end; size = 0;
    };
    for (let i = 0; i < lines.length; i++) {
      if (i > start && ((size >= TARGET && top.test(lines[i]) && (lines[i - 1].trim() === '' || !/^\s/.test(lines[i]))) || size >= HARD)) flush(i);
      size += Buffer.byteLength(lines[i]) + 1;
    }
    flush(lines.length);
  }
  if (/\.js$/.test(f) || /\.html$/.test(f)) text.split('\n').forEach((l, i) => {
    const m = l.match(/^\s*(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/) || l.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/)
      || l.match(/^\s{2,8}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/);
    if (m && !/^(if|for|while|switch|catch|function|return)$/.test(m[1])) { const p = pieces.filter(x => x.f === f).find(x => i + 1 >= x.a && i + 1 <= x.b); funcs.push([m[1], p.file, f, i + 1]); }
  });
}
const raw = name => `https://raw.githubusercontent.com/Toki-bio/MSA-viewer/audit-chunks/${name}`;
let idx = `# ViewAlign source in small pieces\n\nSource commit: ${sha} (the app's own line numbers are given below; each cut piece starts with a line\nnaming its file and line range). Built by make_audit_chunks.js. Read only these files; do not rebuild code from commit pages.\nIf a function is not listed here, say so instead of guessing.\n\n## Pieces\n\n| piece | file | lines |\n|---|---|---|\n`;
pieces.forEach(p => idx += `| [${p.file}](${raw(p.file)}) | ${p.f} | ${p.a}-${p.b} |\n`);
funcs.sort((x, y) => x[0].localeCompare(y[0], 'en', { sensitivity: 'base' }) || x[3] - y[3]);
// the function list is far bigger than one reader page: cut it into files under TARGET bytes, named by first and last name
const fparts = []; let cur = [], curSize = 0;
for (const r of funcs) { const line = `${r[0]}  ${r[1]}  ${r[2]}:${r[3]}\n`; if (curSize + line.length > TARGET && cur.length) { fparts.push(cur); cur = []; curSize = 0; } cur.push(line); curSize += line.length; }
if (cur.length) fparts.push(cur);
idx += `\n## Function lists (name, piece, file:line), alphabetical\n\n`;
fparts.forEach((c, k) => {
  const a = c[0].split(' ')[0], b = c[c.length - 1].split(' ')[0], name = `FUNCTIONS_${String(k + 1).padStart(2, '0')}.md`;
  fs.writeFileSync(path.join(out, name), `# Functions ${a} to ${b} (name, piece, file:line), ViewAlign ${sha.slice(0, 7)}\n\n` + c.join(''));
  idx += `- [${name}](${raw(name)}): ${a} to ${b}\n`;
});
fs.writeFileSync(path.join(out, 'INDEX.md'), idx);
const big = fs.readdirSync(out).map(n => [n, fs.statSync(path.join(out, n)).size]).sort((a, b) => b[1] - a[1]);
console.log(`${pieces.length} pieces, ${funcs.length} functions indexed; largest: ${big.slice(0, 3).map(x => x.join(' ')).join(', ')}`);
