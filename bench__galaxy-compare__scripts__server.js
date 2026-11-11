// Static server for the benchmark.
//   /va/...                      ViewAlign repo (as deployed on GitHub Pages)
//   /av2/index.html              Galaxy alignmentviewer plugin (AV 2.0), Galaxy host page emulated
//   /ajs/index.html              Galaxy alignment plugin (alignment.js), Galaxy host page emulated
//   /api/datasets/<id>/display   Galaxy dataset API emulated: serves data/<id>.fa
const http = require('http');
const fs = require('fs');
const path = require('path');

const B = path.resolve(__dirname, '..');
const ROOTS = { va: path.join(B, 'src/va'), va_fix: path.join(B, 'src/va_fix'), av2: path.join(B, 'src/gx_av2'), ajs: path.join(B, 'src/gx_ajs') };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function galaxyHost(plugin, id) {
  const incoming = JSON.stringify({ root: '/', visualization_config: { dataset_id: id } });
  const mod = plugin === 'ajs' ? ' type="module"' : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/${plugin}/index.css"></head>
<body style="margin:0;height:100vh"><div id="app" style="height:100vh" data-incoming='${incoming}'></div>
<script${mod} src="/${plugin}/index.js"></script></body></html>`;
}

function send(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let m = u.pathname.match(/^\/api\/datasets\/([\w.-]+)\/display$/);
  if (m) return send(res, path.join(B, 'data', m[1] + '.fa'));
  m = u.pathname.match(/^\/(av2|ajs)\/index\.html$/);
  if (m) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(galaxyHost(m[1], u.searchParams.get('id'))); }
  m = u.pathname.match(/^\/(va_fix|va|av2|ajs)(\/.*)?$/);
  if (m) {
    const rel = decodeURIComponent(m[2] && m[2] !== '/' ? m[2] : '/index.html');
    const file = path.normalize(path.join(ROOTS[m[1]], rel));
    if (!file.startsWith(ROOTS[m[1]])) { res.writeHead(403); return res.end(); }
    return send(res, file);
  }
  // alignment.js bundle requests assets at site root (/index.js, /index.css)
  if (u.pathname === '/index.js' || u.pathname === '/index.css') return send(res, path.join(ROOTS.ajs, u.pathname));
  res.writeHead(404); res.end();
}).listen(Number(process.env.PORT || 8765), '127.0.0.1', () => console.log('listening'));
