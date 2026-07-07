/* ── Doter Word-Match worker (SPIN/dottup style) ─────────────────
   Exact k-mer (word) matching. For windowSize=9, wordSize defaults to 3.
   Returns boolean matchMap (1=match, 0=no) plus diagonal info.
   Much faster than sliding-window scoring.                             */
self.addEventListener('message', (event) => {
  try {
    const { seqA, seqB, wordSize } = event.data;
    const N = seqA.length, M = seqB.length;
    const W = wordSize || 3;

    // Build word -> position map for seqB (horizontal axis)
    const bMap = new Map();
    for (let j = 0; j <= M - W; j++) {
      const w = seqB.slice(j, j + W);
      if (!bMap.has(w)) bMap.set(w, []);
      bMap.get(w).push(j);
    }

    // For each word in seqA, mark matching positions
    const matchMap = new Uint8Array(N * M); // 1 = exact word match at (i,j)
    for (let i = 0; i <= N - W; i++) {
      const w = seqA.slice(i, i + W);
      const hits = bMap.get(w);
      if (!hits) continue;
      for (const j of hits) {
        // Mark the START of the matching word
        matchMap[i * M + j] = 1;
      }
    }

    // Transfer to main thread
    self.postMessage(
      { matchMap, rows: N, cols: M, wordSize: W },
      [matchMap.buffer]
    );
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
});
