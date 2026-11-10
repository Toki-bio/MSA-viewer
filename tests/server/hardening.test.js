// Hardening checks for the optional server (server.js), from the 2026-11 audit:
// what the static handler serves, where BLAST database deletes may reach, adding a
// database without BLAST+, error replies, the routes a remote client may use, and the
// line endings of the Windows .bat files. Starts server.js from a scratch folder that
// mirrors the checkout (top-level files copied, folders linked), so the real
// blast_dbs.json, blast_dbs/ and ssh-servers.json are never touched.
//
//   node tests/server/hardening.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const WIN = process.platform === 'win32';
let failures = 0;
function check(name, ok, detail) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ' - ' + detail : ''}`);
    if (!ok) failures++;
}

function freePort() {
    return new Promise(resolve => {
        const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    });
}

function request(port, urlPath, headers = {}, method = 'GET', body = null, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
        const req = http.request({ host, port, path: urlPath, method, headers }, res => {
            let data = '';
            res.on('data', d => { data += d; });
            res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}
const postJson = (port, p, obj, headers = {}) => request(port, p, { 'Content-Type': 'application/json', ...headers }, 'POST', JSON.stringify(obj));

// A scratch copy of the checkout: top-level files copied (server.js must be a real file so its
// __dirname is the scratch folder), folders linked (a junction needs no admin rights on Windows).
function mirrorCheckout(app) {
    const skip = new Set(['.git', 'node_modules', 'server.js', 'blast_dbs', 'blast_dbs.json', 'ssh-servers.json']);
    for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
        if (skip.has(e.name)) continue;
        const src = path.join(ROOT, e.name);
        if (e.isDirectory()) fs.symlinkSync(src, path.join(app, e.name), 'junction');
        else if (e.isFile()) fs.copyFileSync(src, path.join(app, e.name));
    }
    fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(app, 'server.js'));
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(app, 'node_modules'), 'junction');
    fs.writeFileSync(path.join(app, 'ssh-servers.json'), JSON.stringify({ direct: { label: 'D', user: 'u', host: 'target.example' } }));
    fs.writeFileSync(path.join(app, 'blast_dbs.json'), '{}');
}

async function startServer(app, envExtra) {
    const port = await freePort();
    const env = { ...process.env, PORT: String(port), ...envExtra };
    for (const k of ['HOST', 'ALLOW_REMOTE_FILE_ACCESS', 'LOCAL_FILE_ROOTS', 'ALLOWED_HOSTS', 'NODE_ENV', 'STATIC_SERVE_ALL']) if (!(k in envExtra)) delete env[k];
    const proc = spawn(process.execPath, ['server.js'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    proc.stdout.on('data', d => { log += d; });
    proc.stderr.on('data', d => { log += d; });
    for (let i = 0; i < 200 && !/Initializing BLAST databases/.test(log); i++) await new Promise(r => setTimeout(r, 100));
    return { port, proc, log: () => log };
}
async function stopServer(s) {
    const exited = new Promise(r => s.proc.once('exit', r));
    s.proc.kill();
    await exited;
}

// Every file index.html, script.js's Workers, the workers' importScripts and the manual load
function pageResources() {
    const out = new Set();
    const local = u => u && !/^(https?:|data:|mailto:|#|\/\/)/i.test(u);
    const strip = u => u.replace(/^\.\//, '').replace(/[?#].*$/, '');
    for (const html of ['index.html', 'manual.html']) {
        const src = fs.readFileSync(path.join(ROOT, html), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
        for (const m of src.matchAll(/\b(?:src|href)="([^"]+)"/g)) if (local(m[1])) out.add(strip(m[1]));
    }
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    for (const m of script.matchAll(/new Worker\(\s*['`"]([^'`"$?]+)/g)) out.add(strip(m[1]));
    for (const m of script.matchAll(/['`"]((?:\.\/)?(?:examples|vendor|snapshots)\/[\w./-]+\.\w+)['`"]/g)) {
        if (!/my_snapshot/.test(m[1])) out.add(strip(m[1]));
    }
    out.add('version.json');
    for (const f of fs.readdirSync(ROOT).filter(f => /worker\.js$|^mafft-wasm\.js$|^disttbfast\.js$/.test(f))) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        for (const m of src.matchAll(/importScripts\(([^)]*)\)/g)) for (const s of m[1].matchAll(/['"]([\w.-]+\.js)['"]/g)) out.add(s[1]);
        for (const s of src.matchAll(/['"]([\w.-]+\.wasm)['"]/g)) out.add(s[1]);
    }
    return [...out].filter(f => !f.startsWith('/api/') && f !== 'snapshots/my_snapshot.json');
}

// The public site's file list in tools/build-site.sh (APP_FILES and the copied folders)
function buildSiteList() {
    const sh = fs.readFileSync(path.join(ROOT, 'tools', 'build-site.sh'), 'utf8');
    const arr = sh.match(/APP_FILES=\(([\s\S]*?)\)/);
    const files = arr ? arr[1].split(/\s+/).filter(Boolean) : [];
    const dirs = ((sh.match(/for d in ([^;]+); do cp -r/) || [])[1] || '').split(/\s+/).filter(Boolean);
    return { files, dirs };
}

async function main() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viewalign-hard-'));
    const app = path.join(tmp, 'app');
    fs.mkdirSync(app);
    mirrorCheckout(app);
    const bin = path.join(tmp, 'bin');   // nothing from BLAST+ here: makeblastdb/blastn missing unless a check adds them
    fs.mkdirSync(bin);
    const pathNoBlast = bin + path.delimiter + (process.env.PATH || '').split(path.delimiter)
        .filter(d => !['makeblastdb', 'makeblastdb.exe'].some(x => fs.existsSync(path.join(d, x)))).join(path.delimiter);
    let s = await startServer(app, { PATH: pathNoBlast });
    const port = () => s.port;
    const dbDir = path.join(app, 'blast_dbs');
    const registry = () => { try { return JSON.parse(fs.readFileSync(path.join(app, 'blast_dbs.json'), 'utf8')); } catch (_) { return null; } };
    const setRegistry = obj => fs.writeFileSync(path.join(app, 'blast_dbs.json'), JSON.stringify(obj));
    const FASTA = '>s1 one\n' + 'ACGTTGCAAGGCTTACCGGATTACAGGCATGAGCCACCGCG\n';

    try {
        // ---- M30: the static handler served the whole checkout (tests, notes, package.json,
        // everything dropped in the folder). Only what the viewer loads is served now. ----
        const res = pageResources();
        check('page resource list was found (index.html, workers, importScripts)', res.length > 30 && res.includes('script.js') && res.includes('blast-worker.js') && res.includes('disttbfast.wasm') && res.includes('codon-align.js'), res.join(','));
        const missing = [];
        for (const f of res) {
            if (!fs.existsSync(path.join(ROOT, f))) continue;   // a file the page names but the checkout lacks is not the server's fault
            const r = await request(port(), '/' + f.split('/').map(encodeURIComponent).join('/'));
            if (r.status !== 200) missing.push(f + ':' + r.status);
        }
        check('every file the page and its workers load is served', missing.length === 0, missing.join(', '));
        const site = buildSiteList();
        const siteMissing = [];
        for (const f of site.files.filter(f => !f.startsWith('.'))) {
            const r = await request(port(), '/' + f);
            if (r.status !== 200) siteMissing.push(f + ':' + r.status);
        }
        for (const d of site.dirs) {
            const first = fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).find(e => e.isFile() && !e.name.startsWith('.'));
            if (!first) continue;
            const r = await request(port(), `/${d}/${encodeURIComponent(first.name)}`);
            if (r.status !== 200) siteMissing.push(`${d}/${first.name}:${r.status}`);
        }
        check('every file of the public site (tools/build-site.sh) is served', site.files.length > 20 && site.dirs.length >= 3 && siteMissing.length === 0, JSON.stringify({ n: site.files.length, dirs: site.dirs, siteMissing }));
        fs.writeFileSync(path.join(app, 'notes.txt'), 'private notes');
        fs.writeFileSync(path.join(app, 'my-local.fa'), '>x\nACGT\n');
        const privateFiles = ['/package.json', '/package-lock.json', '/server.js', '/ssh-servers.json', '/blast_dbs.json', '/CLAUDE.md',
            '/KNOWN_BUGS.md', '/notes.txt', '/my-local.fa', '/tests/run-all.js', '/tests/server/hardening.test.js', '/dev-tools/', '/tools/build-site.sh',
            '/reference/make_synth.py', '/node_modules/express/package.json', '/.gitignore', '/tests/', '/install-blast.ps1', '/start-server.bat',
            '/%74ests/run-all.js', '/TESTS/run-all.js', '/Package.json', '/vendor/../package.json', '/img/..%2fpackage.json', '/server.js.', '/benchmark.html'];
        const leaked = [];
        for (const f of privateFiles) {
            const r = await request(port(), f);
            if (r.status === 200) leaked.push(f);
        }
        check('files the viewer does not load are not served (package.json, tests/, server.js, ssh-servers.json, notes)', leaked.length === 0, leaked.join(', '));

        // ---- M32: adding a database needed makeblastdb (the search in the page never uses it: the
        // worker fetches the FASTA), and a failed add left blast_dbs/<name>.fa behind ----
        let r = await postJson(port(), '/api/blast-db', { name: 'noblast', description: 'd', fasta: FASTA });
        check('a database can be added without BLAST+ installed', r.status === 200 && /"success":true/.test(r.body), r.status + ' ' + r.body);
        r = await request(port(), '/api/blast-db');
        let info = (JSON.parse(r.body).databases || {}).noblast;
        check('the added database is listed with a url and available', !!(info && info.url && info.available), r.body);
        r = info && info.url ? await request(port(), info.url) : { status: 0, body: '' };
        check('the added database FASTA is served at its url (what the search worker fetches)', r.status === 200 && r.body.includes('ACGTTGCAAGG'), r.status + ' ' + String(r.body).slice(0, 80));
        // where blastn is installed but makeblastdb's indices are missing, the server's own search route
        // ran blastn on the unindexed database and failed; it now uses its built-in search
        if (!WIN) {
            fs.writeFileSync(path.join(bin, 'blastn'), '#!/bin/sh\n[ "$1" = "-version" ] && { echo "blastn: 2.0"; exit 0; }\necho "BLAST Database error: No alias or index file found" >&2; exit 2\n');
            fs.chmodSync(path.join(bin, 'blastn'), 0o755);
            r = await postJson(port(), '/api/blast', { query: '>q\nACGTTGCAAGGCTTACCGGATTACAGGCATGAGCC\n', dbName: 'noblast' });
            check('the server search route works on a database without BLAST+ indices', r.status === 200 && /"s1"/.test(r.body), r.status + ' ' + r.body.slice(0, 200));
            fs.unlinkSync(path.join(bin, 'blastn'));
        }
        // a failed add: the registry cannot be written (a folder in its place)
        fs.rmSync(path.join(app, 'blast_dbs.json'), { force: true });
        fs.mkdirSync(path.join(app, 'blast_dbs.json'));
        r = await postJson(port(), '/api/blast-db', { name: 'orphan', description: '', fasta: FASTA });
        const orphan = fs.existsSync(path.join(dbDir, 'orphan.fa'));
        check('a failed database add reports an error and leaves no file behind', r.status >= 400 && !orphan, r.status + ' orphan=' + orphan + ' ' + r.body);
        fs.rmSync(path.join(app, 'blast_dbs.json'), { recursive: true, force: true });
        setRegistry({ noblast: { path: path.join(dbDir, 'noblast.fa'), desc: 'd' } });

        // ---- H11: DELETE /api/blast-db unlinked the registered FASTA wherever it was, also a
        // user's file registered from outside blast_dbs/ ----
        const userFa = path.join(tmp, 'user-db.fa');
        fs.writeFileSync(userFa, FASTA);
        const inAppFa = path.join(app, 'my-local.fa');
        const target = path.join(tmp, 'link-target.fa');
        fs.writeFileSync(target, FASTA);
        fs.mkdirSync(dbDir, { recursive: true });
        const linkFa = path.join(dbDir, 'linked.fa');
        let linkMade = true;
        try { fs.symlinkSync(target, linkFa); } catch (_) { linkMade = false; }
        fs.writeFileSync(path.join(tmp, 'ext.nhr'), 'index');   // an index next to the user's FASTA, named like the database
        setRegistry({ ...registry(), ext: { path: userFa, desc: '' }, inapp: { path: inAppFa, desc: '' },
            trav: { path: path.join(dbDir, '..', 'my-local.fa'), desc: '' }, ...(linkMade ? { linked: { path: linkFa, desc: '' } } : {}) });
        r = await request(port(), '/api/blast-db/ext', {}, 'DELETE');
        check('deleting a database registered from outside blast_dbs/ keeps the user\'s FASTA', r.status === 200 && fs.existsSync(userFa) && fs.existsSync(path.join(tmp, 'ext.nhr')), r.status + ' exists=' + fs.existsSync(userFa));
        check('... and unregisters it', !(registry() || {}).ext, JSON.stringify(registry()));
        r = await request(port(), '/api/blast-db/inapp', {}, 'DELETE');
        check('deleting a database registered from the app folder (not blast_dbs/) keeps the file', r.status === 200 && fs.existsSync(inAppFa), r.status + ' ' + r.body);
        fs.writeFileSync(inAppFa, '>x\nACGT\n');
        r = await request(port(), '/api/blast-db/trav', {}, 'DELETE');
        check('a blast_dbs/../ path in the registry does not delete the file it points at', r.status === 200 && fs.existsSync(inAppFa), r.status + ' ' + r.body);
        if (linkMade) {
            r = await request(port(), '/api/blast-db/linked', {}, 'DELETE');
            check('a link in blast_dbs/ to a file elsewhere does not delete that file', r.status === 200 && fs.existsSync(target) && fs.readFileSync(target, 'utf8') === FASTA, r.status + ' ' + r.body);
        }
        r = await request(port(), '/api/blast-db/noblast', {}, 'DELETE');
        check('deleting a database added in the page still removes its file in blast_dbs/', r.status === 200 && !fs.existsSync(path.join(dbDir, 'noblast.fa')), r.status + ' ' + r.body);

        // ---- L38: an error reply carried the stack trace (Express's default error page shows it
        // outside production): file paths of the server and node_modules ----
        r = await request(port(), '/api/blast-db', { 'Content-Type': 'application/json' }, 'POST', '{"name": "x", bad json');
        check('a malformed request gets an error without a stack trace', r.status === 400 && !/\bat \S+ \(|node_modules|[\\/]server\.js/.test(r.body), r.status + ' ' + r.body.slice(0, 300));

        // ---- H10: routes that change things or run programs answered any network client when the
        // server listened beyond loopback (HOST=0.0.0.0): delete or add databases, run MAFFT/BLAST.
        // A relaying proxy (X-Forwarded-For) stands in for a client on another machine here. ----
        const remote = { 'X-Forwarded-For': '203.0.113.9' };
        setRegistry({ keep: { path: path.join(dbDir, 'keep.fa'), desc: '' } });
        fs.writeFileSync(path.join(dbDir, 'keep.fa'), FASTA);
        r = await request(port(), '/api/blast-db/keep', remote, 'DELETE');
        check('a remote client cannot delete a database', r.status === 403 && fs.existsSync(path.join(dbDir, 'keep.fa')), r.status + ' ' + r.body);
        r = await postJson(port(), '/api/blast-db', { name: 'remoteadd', fasta: FASTA }, remote);
        check('a remote client cannot add a database (writes a file)', r.status === 403 && !fs.existsSync(path.join(dbDir, 'remoteadd.fa')), r.status + ' ' + r.body);
        r = await postJson(port(), '/api/mafft', { sequences: '>a\nACGT\n>b\nACGT\n' }, remote);
        check('a remote client cannot run MAFFT', r.status === 403, r.status + ' ' + r.body);
        r = await postJson(port(), '/api/blast', { query: 'ACGT', dbName: 'keep' }, remote);
        check('a remote client cannot run a BLAST search on the server', r.status === 403, r.status + ' ' + r.body);
        r = await request(port(), '/api/blast-db', remote);
        check('a remote client can still list the databases', r.status === 200, r.status + ' ' + r.body);
        // Express matches routes case-insensitively and with a trailing slash, while the access checks
        // compared the exact path: /API/local-cat skipped the loopback check and the cross-site check.
        const homeFile = path.join(app, 'readable.fa');
        fs.writeFileSync(homeFile, '>r\nACGT\n');
        for (const p of ['/API/local-cat', '/api/local-cat/', '/Api/Local-Cat']) {
            r = await request(port(), p + '?file=' + encodeURIComponent(homeFile), remote);
            check(`a remote client cannot read files through ${p}`, r.status === 403, r.status + ' ' + r.body.slice(0, 100));
            r = await request(port(), p + '?file=' + encodeURIComponent(homeFile), { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' });
            check(`a cross-site page cannot read files through ${p}`, r.status === 403, r.status + ' ' + r.body.slice(0, 100));
        }
        r = await request(port(), '/API/blast-db/keep', remote, 'DELETE');
        check('a remote client cannot delete a database through /API/...', r.status === 403 && fs.existsSync(path.join(dbDir, 'keep.fa')), r.status + ' ' + r.body);
        // the user's own page on this machine keeps working
        r = await request(port(), '/api/blast-db/keep', { Origin: `http://localhost:${port()}`, 'Sec-Fetch-Site': 'same-origin', Host: `localhost:${port()}` }, 'DELETE');
        check('the viewer page on this machine can still delete a database', r.status === 200, r.status + ' ' + r.body);
        await stopServer(s);
        // a real client over the network: HOST=0.0.0.0 and this machine's own non-loopback address
        const lan = Object.values(os.networkInterfaces()).flat().find(a => a && !a.internal && a.family === 'IPv4');
        if (lan) {
            s = await startServer(app, { PATH: pathNoBlast, HOST: '0.0.0.0' });
            fs.writeFileSync(path.join(dbDir, 'keep.fa'), FASTA);
            setRegistry({ keep: { path: path.join(dbDir, 'keep.fa'), desc: '' } });
            r = await request(port(), '/api/blast-db/keep', {}, 'DELETE', null, lan.address);
            check(`with HOST=0.0.0.0 a client at ${lan.address} cannot delete a database`, r.status === 403 && fs.existsSync(path.join(dbDir, 'keep.fa')), r.status + ' ' + r.body);
            r = await request(port(), '/api/blast-db', {}, 'GET', null, lan.address);
            check(`with HOST=0.0.0.0 a client at ${lan.address} can still list the databases`, r.status === 200, r.status + ' ' + r.body);
            await stopServer(s);
        } else {
            console.log('skip network-client check (no non-loopback IPv4 address here)');
        }
        // the opt-in for trusted networks still lets remote clients in
        s = await startServer(app, { PATH: pathNoBlast, ALLOW_REMOTE_FILE_ACCESS: '1' });
        r = await postJson(port(), '/api/blast-db', { name: 'optin', fasta: FASTA }, remote);
        check('ALLOW_REMOTE_FILE_ACCESS=1 still lets a remote client add a database', r.status === 200, r.status + ' ' + r.body);

        // ---- L38: the .bat files were stored with LF line endings; cmd.exe misreads labels and
        // long lines in LF batch files. Git now writes them with CRLF on checkout and in archives. ----
        const ca = spawnSync('git', ['check-attr', 'eol', '--', 'start-server.bat', 'stop-server.bat', 'install-autostart.bat', 'uninstall-autostart.bat'], { cwd: ROOT, encoding: 'utf8' });
        if (ca.status === 0) {
            const lines = ca.stdout.trim().split('\n');
            check('.bat files are checked out with CRLF (.gitattributes eol=crlf)', lines.length === 4 && lines.every(l => /: eol: crlf$/.test(l)), ca.stdout);
        } else {
            console.log('skip .bat line-ending check (git not available here)');
        }
    } finally {
        await stopServer(s);
        fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    console.log(failures ? `${failures} check(s) failed` : 'all server hardening checks passed');
    process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
