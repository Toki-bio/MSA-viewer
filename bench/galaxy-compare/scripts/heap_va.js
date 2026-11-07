// Heap snapshot after load: count DOM-ish objects by class, and show retainer paths of detached nodes.
const { chromium } = require('playwright-core');
const id = process.argv[2] || 'nt_1k_x300';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto(`http://127.0.0.1:8765/va_fix/index.html?url=/api/datasets/${id}/display`);
  for (let i = 0; i < 300; i++) {
    if (await p.evaluate(() => typeof state !== 'undefined' && state.seqs?.length > 0 && !!state.conservationDataCache)) break;
    await p.waitForTimeout(100);
  }
  await p.waitForTimeout(1500);
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.collectGarbage');
  let chunks = []; cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  const snap = JSON.parse(chunks.join('')); chunks = null;
  const m = snap.snapshot.meta, NF = m.node_fields.length, EF = m.edge_fields.length;
  const nTypes = m.node_types[0], eTypes = m.edge_types[0];
  const iType = m.node_fields.indexOf('type'), iName = m.node_fields.indexOf('name'), iEc = m.node_fields.indexOf('edge_count');
  const eType = m.edge_fields.indexOf('type'), eName = m.edge_fields.indexOf('name_or_index'), eTo = m.edge_fields.indexOf('to_node');
  const N = snap.nodes, E = snap.edges, S = snap.strings, count = N.length / NF;
  const names = new Array(count); const firstEdge = new Uint32Array(count + 1);
  for (let i = 0, e = 0; i < count; i++) { firstEdge[i] = e; e += N[i * NF + iEc] * EF; names[i] = S[N[i * NF + iName]]; }
  firstEdge[count] = E.length;
  const retainers = Array.from({ length: count }, () => []);
  for (let i = 0; i < count; i++) for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += EF) {
    const to = E[e + eTo] / NF; const t = eTypes[E[e + eType]];
    if (t === 'weak') continue;
    const nm = (t === 'element' || t === 'hidden') ? `[${E[e + eName]}]` : S[E[e + eName]];
    retainers[to].push([i, t + ':' + nm]);
  }
  const byName = {};
  for (let i = 0; i < count; i++) { const n = names[i]; if (/^Detached |^HTML|^Text$/.test(n)) byName[n] = (byName[n] || 0) + 1; }
  console.log('DOM objects in heap:', JSON.stringify(Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 10)));
  // retainer path for a few detached nodes (walk up, skipping other DOM nodes, to a JS object with a name)
  const det = []; for (let i = 0; i < count && det.length < 4000; i++) if (names[i].startsWith('Detached ')) det.push(i);
  const paths = {};
  for (const start of det.filter((_, k) => k % 400 === 0)) {
    let cur = start, path = [], seen = new Set();
    for (let step = 0; step < 25; step++) {
      seen.add(cur);
      const r = retainers[cur].filter(([j]) => !seen.has(j));
      if (!r.length) break;
      const pick = r.find(([j]) => !/^Detached |^HTML|^Text|^system/.test(names[j])) || r[0];
      path.push(`${names[pick[0]].slice(0, 40)} --${pick[1]}-->`);
      cur = pick[0];
      if (/^(Window|global|system \/ Context)/.test(names[cur]) && step > 2) break;
    }
    const key = path.slice(0, 8).join(' '); paths[key] = (paths[key] || 0) + 1;
  }
  for (const [k, v] of Object.entries(paths)) console.log(v, 'x', k);
  await b.close();
})();
