// Security checks for the optional server (server.js): access control, local
// file roots, and shell quoting of remote paths on direct and jump-host SSH
// routes. Starts server.js on a free port with a throwaway HOME, a fake
// `plink` that records its arguments, and a test ssh-servers.json.
//
//   node tests/server/security.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

// The fake remote is run by a POSIX sh. On Windows that is Git's sh.exe, which takes PATH as a Windows
// list (it converts it itself); 'sh' with PATH 'dir:/usr/bin:/bin' was not even found there.
const WIN = process.platform === 'win32';
function findSh() {
    if (!WIN) return 'sh';
    const tried = [];
    const w = spawnSync('where', ['sh'], { encoding: 'utf8' });
    if (w.status === 0) tried.push(...w.stdout.split(/\r?\n/).filter(Boolean));
    tried.push('C:\\Program Files\\Git\\usr\\bin\\sh.exe', 'C:\\Program Files\\Git\\bin\\sh.exe');
    const sh = tried.find(f => fs.existsSync(f));
    if (!sh) throw new Error('no POSIX sh found (install Git for Windows)');
    return sh;
}
const SH = findSh();
function buildFakePlinkExe(dir, script) {
    const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    if (!fs.existsSync(csc)) throw new Error('no C# compiler at ' + csc + ' (.NET Framework 4)');
    const q = v => '@"' + v.replace(/"/g, '""') + '"';
    fs.writeFileSync(path.join(dir, 'plink.cs'), `using System; using System.Diagnostics;
class P { static int Main() {
    string c = Environment.CommandLine, tail;
    if (c.StartsWith("\\"")) { int e = c.IndexOf('"', 1); tail = e < 0 ? "" : c.Substring(e + 1); }
    else { int e = c.IndexOf(' '); tail = e < 0 ? "" : c.Substring(e); }
    var si = new ProcessStartInfo(${q(process.execPath)}, "\\"" + ${q(script)} + "\\"" + tail);
    si.UseShellExecute = false;
    var p = Process.Start(si); p.WaitForExit(); return p.ExitCode;
} }
`);
    const r = spawnSync(csc, ['/nologo', '/out:' + path.join(dir, 'plink.exe'), path.join(dir, 'plink.cs')], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('building the fake plink.exe failed: ' + r.stdout + r.stderr);
}
const remotePath = dir => WIN ? [dir, path.dirname(SH), path.join(path.dirname(SH), '..', '..', 'usr', 'bin')].join(';') : dir + ':/usr/bin:/bin';
const runSh = (cmd, env) => {
    const r = spawnSync(SH, ['-c', cmd], { env, encoding: 'utf8' });
    if (r.error) throw r.error;
    return r.stdout;
};

const ROOT = path.join(__dirname, '..', '..');
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

function request(port, urlPath, headers = {}, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers }, res => {
            let data = '';
            res.on('data', d => { data += d; });
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function main() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viewalign-sec-'));
    const home = path.join(tmp, 'home');
    fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ssh', 'id_ed25519'), 'PRIVATE KEY');
    fs.writeFileSync(path.join(home, 'aln.fa'), '>a\nACGT\n');
    fs.writeFileSync(path.join(tmp, 'outside.fa'), '>o\nACGT\n');

    // Fake plink: records its argument list as JSON, prints a FASTA
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    const argLog = path.join(tmp, 'plink-args.json');
    fs.writeFileSync(path.join(bin, 'plink'),
        `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(argLog)}, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write('>x\\nACGT\\n');\n`);
    fs.chmodSync(path.join(bin, 'plink'), 0o755);
    // Windows: spawn('plink') looks only for plink.exe (a .cmd needs a shell), so it ran the real PuTTY
    // plink and every ssh check failed with "Host does not exist". Build a tiny plink.exe with the C#
    // compiler that ships with Windows: it hands its command line, unchanged after the program name, to the
    // fake plink above, so the quoting under test reaches it exactly as plink would get it.
    if (WIN) buildFakePlinkExe(bin, path.join(bin, 'plink'));

    // server.js reads ssh-servers.json from its own folder; run a copy of the
    // app files in a scratch folder so the real config is never touched.
    const app = path.join(tmp, 'app');
    fs.mkdirSync(app);
    fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(app, 'server.js'));
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(app, 'node_modules'), 'junction');   // a junction needs no admin rights on Windows
    fs.writeFileSync(path.join(app, 'index.html'), '<!doctype html><title>t</title>');
    fs.writeFileSync(path.join(app, 'ssh-servers.json'), JSON.stringify({
        direct: { label: 'Direct', user: 'u', host: 'target.example' },
        jump: { label: 'Jump', user: 'gw', host: 'gateway.example' },
        inner: { label: 'Inner', user: 'u', host: 'inner.example', via: 'jump' },
    }));
    fs.writeFileSync(path.join(app, 'blast_dbs.json'), '{}');

    const port = await freePort();
    const env = { ...process.env, HOME: home, USERPROFILE: home, PORT: String(port), PATH: bin + path.delimiter + process.env.PATH };
    delete env.HOST; delete env.ALLOW_REMOTE_FILE_ACCESS; delete env.LOCAL_FILE_ROOTS; delete env.ALLOWED_HOSTS;
    const server = spawn(process.execPath, ['server.js'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    server.stdout.on('data', d => { log += d; });
    server.stderr.on('data', d => { log += d; });
    // Wait for the whole startup banner: "running on" and the loopback notice
    // are separate writes, and a slow runner can read between them
    for (let i = 0; i < 200 && !/Initializing BLAST databases/.test(log); i++) await new Promise(r => setTimeout(r, 100));

    try {
        check('server listens on loopback only by default', /this machine only/.test(log), log);

        // ---- local files ----
        let r = await request(port, '/api/local-cat?file=' + encodeURIComponent(path.join(home, 'aln.fa')));
        check('local-cat reads a file in the home folder', r.status === 200 && r.body.includes('ACGT'), r.status + ' ' + r.body);
        r = await request(port, '/api/local-cat?file=' + encodeURIComponent(path.join(home, '.ssh', 'id_ed25519')));
        check('local-cat refuses a file inside a hidden folder (~/.ssh)', r.status === 403 && !r.body.includes('PRIVATE'), r.status + ' ' + r.body);
        // A file that exists on every OS: '/etc/passwd' is C:\etc\passwd on Windows, which is missing,
        // so the server answered 404 before it reached the roots check this is meant to test.
        const outsideFile = process.execPath;
        r = await request(port, '/api/local-cat?file=' + encodeURIComponent(outsideFile));
        check('local-cat refuses a file outside the allowed roots', r.status === 403, r.status + ' ' + r.body);
        r = await request(port, '/api/local-cat?file=' + encodeURIComponent(path.join(tmp, 'outside.fa')));
        check('local-cat refuses a sibling folder of the roots', r.status === 403, r.status + ' ' + r.body);
        // Windows: a file symlink needs Developer Mode or admin rights, a junction to the folder does not;
        // either way the server must resolve the link before it checks the allowed roots
        let linked;
        if (WIN) { fs.symlinkSync(path.join(home, '.ssh'), path.join(home, 'innocent'), 'junction'); linked = path.join(home, 'innocent', 'id_ed25519'); }
        else { fs.symlinkSync(path.join(home, '.ssh', 'id_ed25519'), path.join(home, 'innocent.fa')); linked = path.join(home, 'innocent.fa'); }
        r = await request(port, '/api/local-cat?file=' + encodeURIComponent(linked));
        check('local-cat resolves symlinks before checking', r.status === 403 && !r.body.includes('PRIVATE'), r.status + ' ' + r.body);
        r = await request(port, '/api/bam2sam', { 'Content-Type': 'application/json' }, 'POST', JSON.stringify({ bamPath: outsideFile }));
        check('bam2sam refuses paths outside the roots', r.status === 403, r.status + ' ' + r.body);
        r = await request(port, '/api/bam2sam', { 'Content-Type': 'application/json' }, 'POST', JSON.stringify({ bamPath: '--help' }));
        check('bam2sam refuses option-like paths', r.status === 400, r.status + ' ' + r.body);

        // samtools is not on PATH here: the route must answer once and the
        // server must keep running
        r = await request(port, '/api/bam2sam', { 'Content-Type': 'application/json' }, 'POST', JSON.stringify({ bamPath: path.join(home, 'aln.fa') }));
        check('bam2sam reports a missing samtools without crashing', r.status === 500, r.status + ' ' + r.body);
        await new Promise(res => setTimeout(res, 300));
        r = await request(port, '/index.html');
        check('server is still running after a missing binary', r.status === 200, String(r.status));

        // ---- static files ----
        for (const f of ['/ssh-servers.json', '/blast_dbs.json', '/server.js', '/%73erver.js', '/.git/config']) {
            r = await request(port, f);
            check(`static handler does not serve ${f}`, r.status === 404 || r.status === 403, String(r.status));
        }
        r = await request(port, '/index.html');
        check('static handler serves index.html', r.status === 200, String(r.status));

        // ---- host header / cross-site ----
        r = await request(port, '/index.html', { Host: 'evil.example:' + port });
        check('a DNS name that is not allowed is refused (DNS rebinding)', r.status === 403, String(r.status));
        r = await request(port, '/api/ssh-servers', { Host: '127.0.0.1:' + port });
        check('an IP-literal Host is accepted', r.status === 200, String(r.status));
        r = await request(port, '/api/ssh-cat?server=direct&file=/data/a.fa', { 'Sec-Fetch-Site': 'cross-site' });
        check('a cross-site page cannot call /api (Sec-Fetch-Site)', r.status === 403, String(r.status));
        r = await request(port, '/api/ssh-cat?server=direct&file=/data/a.fa', { Origin: 'https://attacker.example' });
        check('a foreign Origin cannot call /api', r.status === 403, String(r.status));
        r = await request(port, '/api/ssh-servers', { Origin: `http://localhost:${port}`, 'Sec-Fetch-Site': 'same-origin', Host: `localhost:${port}` });
        check('the viewer page itself can call /api', r.status === 200, String(r.status));
        r = await request(port, '/api/local-cat?file=' + encodeURIComponent(path.join(home, 'aln.fa')), { 'X-Forwarded-For': '203.0.113.9' });
        check('file routes refuse clients relayed by a proxy', r.status === 403, String(r.status));

        // ---- remote path validation ----
        const bad = ['/x"\nid>/tmp/pwned\n"', "/x'; id", '/x\nid', '/x$(id)', '/x`id`', '/x>out', '/x<in', '/a/../etc/passwd', '-n', '/x\\y', '/x"y'];
        for (const p of bad) {
            for (const srv of ['direct', 'inner']) {
                if (fs.existsSync(argLog)) fs.unlinkSync(argLog);
                r = await request(port, `/api/ssh-cat?server=${srv}&file=${encodeURIComponent(p)}`);
                check(`ssh-cat (${srv}) refuses ${JSON.stringify(p)}`, r.status === 400 && !fs.existsSync(argLog), String(r.status));
            }
            r = await request(port, `/api/ssh-ls?server=inner&dir=${encodeURIComponent(p)}`);
            check(`ssh-ls refuses ${JSON.stringify(p)}`, r.status === 400, String(r.status));
            r = await request(port, `/api/queue-file?server=inner&file=${encodeURIComponent(p)}`);
            check(`queue-file refuses ${JSON.stringify(p)}`, r.status === 400, String(r.status));
        }

        // ---- the commands that are sent reach the target as the exact path ----
        // Simulate the remote shells: run the command with sh, where `ssh`
        // (jump hop) runs its last argument in a nested sh, and `cat`/`ls`
        // print their arguments one per line.
        const fakeRemote = path.join(tmp, 'remote');
        fs.mkdirSync(fakeRemote);
        fs.writeFileSync(path.join(fakeRemote, 'cat'), '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n');
        fs.writeFileSync(path.join(fakeRemote, 'ls'), '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n');
        fs.writeFileSync(path.join(fakeRemote, 'ssh'), '#!/bin/sh\nfor last; do :; done\nexec sh -c "$last"\n');
        for (const f of ['cat', 'ls', 'ssh']) fs.chmodSync(path.join(fakeRemote, f), 0o755);
        const remoteEnv = { PATH: remotePath(fakeRemote), HOME: '/home/remote' };
        const good = ['/data/my file.fa', '/data/a,b=c+d@e%f:g.fa', '~/aln/set 1.fa', '/данные/выравнивание.fa', '/x-y_z.fa'];
        for (const p of good) {
            for (const srv of ['direct', 'inner']) {
                if (fs.existsSync(argLog)) fs.unlinkSync(argLog);
                r = await request(port, `/api/ssh-cat?server=${srv}&file=${encodeURIComponent(p)}`);
                const args = fs.existsSync(argLog) ? JSON.parse(fs.readFileSync(argLog, 'utf8')) : [];
                const cmd = args[args.length - 1] || '';
                const out = runSh(cmd, remoteEnv).trim().split('\n');
                const expected = p.startsWith('~/') ? '/home/remote/' + p.slice(2) : p;
                check(`ssh-cat (${srv}) passes ${JSON.stringify(p)} to the remote cat intact`,
                    r.status === 200 && out[0] === '--' && out[1] === expected && out.length === 2, JSON.stringify({ status: r.status, cmd, out, body: String(r.body).slice(0, 300) }));
            }
        }
        if (fs.existsSync(argLog)) fs.unlinkSync(argLog);
        r = await request(port, '/api/ssh-ls?server=inner');
        const lsArgs = fs.existsSync(argLog) ? JSON.parse(fs.readFileSync(argLog, 'utf8')) : [];
        const lsRaw = runSh(lsArgs[lsArgs.length - 1] || '', remoteEnv);
        const lsOut = lsRaw.slice(lsRaw.indexOf('=LS=') + 4).trim().split('\n');   // the listing follows the marker
        check('ssh-ls with no folder lists the remote home', lsOut.join('|') === '-1p|--|/home/remote', JSON.stringify(lsOut));

        // ---- push-to-load queue: the jump-host command prints the same markers as the direct one ----
        const sshOnly = path.join(tmp, 'sshonly');
        fs.mkdirSync(sshOnly);
        fs.copyFileSync(path.join(fakeRemote, 'ssh'), path.join(sshOnly, 'ssh'));
        fs.chmodSync(path.join(sshOnly, 'ssh'), 0o755);
        const qFile = path.join(tmp, 'queue').replace(/\\/g, '/');
        for (const srv of ['direct', 'inner']) {
            fs.writeFileSync(qFile, '/data/dir\naln.fa\n');
            if (fs.existsSync(argLog)) fs.unlinkSync(argLog);
            await request(port, `/api/ssh-poll-file?server=${srv}`);
            const qArgs = fs.existsSync(argLog) ? JSON.parse(fs.readFileSync(argLog, 'utf8')) : [];
            const qCmd = (qArgs[qArgs.length - 1] || '').split('/tmp/.msa_viewer_queue').join(qFile);
            const qOut = runSh(qCmd, { PATH: remotePath(sshOnly) });
            check(`queue poll (${srv}) prints the queued path between the markers`,
                /=START_QUEUE=\s*\/data\/dir\s+aln\.fa\s*=END_QUEUE=/.test(qOut), JSON.stringify({ qCmd, qOut }));
        }
    } finally {
        // Windows: the server holds its folder (cwd) open until it has exited, and rmSync died with
        // EPERM, which also hid any error thrown above and skipped the summary line and exit code
        const exited = new Promise(r => server.once('exit', r));
        server.kill();
        await exited;
        fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    console.log(failures ? `${failures} check(s) failed` : 'all server security checks passed');
    process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
