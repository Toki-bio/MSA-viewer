const { start } = require('../lib/static-server');
const { launch } = require('../lib/browser');

async function ping(page) {
    let timer;
    try {
        return await Promise.race([
            page.evaluate(() => ({
                done: window.__heavyDone,
                error: window.__heavyError,
                busy: document.getElementById('busyOverlay')?.hidden === false,
                spinner: getComputedStyle(document.getElementById('busySpinner')).animationName,
                spinnerTransform: getComputedStyle(document.getElementById('busySpinner')).transform,
            })),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('page did not respond within 3 seconds')), 3000);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function startClustering(page) {
    await page.evaluate(() => {
        window.__heavyDone = false;
        window.__heavyError = null;
        clusterSequences().then(
            () => { window.__heavyDone = true; },
            error => { window.__heavyError = error.message; window.__heavyDone = true; }
        );
    });
}

async function main() {
    const planted = process.argv.includes('--planted');
    const { server, baseUrl } = await start();
    const browser = await launch();
    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('dialog', dialog => dialog.accept());
        await page.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
        await page.evaluate(async (planted) => {
            let seed = 1;
            let fasta = '';
            for (let row = 0; row < 300; row++) {
                const chars = [];
                for (let col = 0; col < 3000; col++) {
                    seed = (seed * 16807) % 2147483647;
                    const value = seed / 2147483647;
                    chars.push(planted && col < 40
                        ? 'ACG'[Math.floor(row / 100)]
                        : value < 0.05 ? '-' : 'ACGT'[Math.floor((value - 0.05) / 0.2375)]);
                }
                fasta += `>seq${row}\n${chars.join('')}\n`;
            }
            document.getElementById('fastaInput').value = fasta;
            await parseAndRender(false);
            document.getElementById('clusterMaxIterationsInput').value = '20';
        }, planted);

        const started = Date.now();
        await startClustering(page);
        let checks = 0;
        let sawBusy = false;
        let sawSpinner = false;
        const spinnerFrames = new Set();
        let completed = false;
        while (Date.now() - started < 90000) {
            const status = await ping(page);
            if (status.error) throw new Error(status.error);
            checks++;
            sawBusy ||= status.busy;
            sawSpinner ||= status.spinner !== 'none';
            if (status.busy) spinnerFrames.add(status.spinnerTransform);
            if (status.done) { completed = true; break; }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (!completed || !sawBusy || !sawSpinner || spinnerFrames.size < 2 || checks < 3) {
            throw new Error(`completion: done=${completed}, busy=${sawBusy}, spinner=${sawSpinner}, frames=${spinnerFrames.size}, pings=${checks}`);
        }
        const completedIn = Date.now() - started;
        const beforeCancel = await page.evaluate(() => {
            window.__beforeCancelResults = state.clusterResults;
            return {
                rows: state.seqs.length,
                result: !!state.clusterResults,
                summary: state.clusterResults?.summary,
                busy: document.getElementById('busyOverlay')?.hidden === false,
            };
        });
        if (beforeCancel.rows !== 300 || !beforeCancel.result || beforeCancel.busy) {
            throw new Error(`completed state: ${JSON.stringify(beforeCancel)}`);
        }
        if (planted && (beforeCancel.summary.nClusters !== 3 || beforeCancel.summary.nAssigned !== 300)) {
            throw new Error(`planted groups: ${JSON.stringify(beforeCancel.summary)}`);
        }

        await startClustering(page);
        await page.waitForSelector('#busyStop:visible', { timeout: 5000 });
        await page.waitForTimeout(600);
        const stopStarted = Date.now();
        await page.click('#busyStop');
        await page.waitForFunction(() => window.__heavyDone, null, { timeout: 5000 });
        const stopped = await page.evaluate(() => ({
            cancelled: state.clusterCancelled,
            preserved: state.clusterResults === window.__beforeCancelResults,
            busy: document.getElementById('busyOverlay')?.hidden === false,
            error: window.__heavyError,
        }));
        if (!stopped.cancelled || !stopped.preserved || stopped.busy || stopped.error || pageErrors.length) {
            throw new Error(`stopped state: ${JSON.stringify({ ...stopped, pageErrors })}`);
        }
        console.log(`PASS: ${planted ? 'planted' : 'unstructured'} heavy clustering completed in ${completedIn}ms with ${checks} responsive pings; Stop finished in ${Date.now() - stopStarted}ms`);
    } finally {
        await browser.close();
        server.close();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
