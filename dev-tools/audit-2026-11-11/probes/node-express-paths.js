// Node-only check (no browser, does not start server.js, does not touch ~/.viewalign): which path forms reach an
// Express 4 route '/api/local-cat', and what server.js's routePath() makes of each. GLM q21a #2.
//   node dev-tools/audit-2026-11-11/probes/node-express-paths.js [path to a node_modules that has express]
const path = require('path');
const nm = process.argv[2] || 'C:/work/MSA-viewer-new/node_modules';
const express = require(path.join(nm, 'express'));
const http = require('http');
const app = express();
const routePath = req => req.path.toLowerCase().replace(/\/+$/, '') || '/';
app.use((req, res, next) => { req._rp = routePath(req); next(); });
app.get('/api/local-cat', (req, res) => res.send('HANDLER rp=' + req._rp));
app.use((req, res) => res.status(404).send('404 rp=' + req._rp));
const srv = app.listen(0, '127.0.0.1', async () => {
    const port = srv.address().port;
    const forms = ['/api/local-cat', '/API/Local-Cat/', '/api/local%2Dcat', '/api/local%2dcat', '//api/local-cat',
        '/api/./local-cat', '/api/x/../local-cat', '/api/local-cat;x', '/api/local-cat%2F', '/api/local-cat?x=1'];
    for (const f of forms) {
        const body = await new Promise(r => http.get({ host: '127.0.0.1', port, path: f, method: 'GET' },
            res => { let b = ''; res.on('data', d => b += d); res.on('end', () => r(res.statusCode + ' ' + b)); }));
        console.log(f.padEnd(24), body, /HANDLER/.test(body) && !/rp=\/api\/local-cat$/.test(body) ? '  <-- handler reached, check missed' : '');
    }
    srv.close();
});
