/* Doter Word-Match worker (SPIN/dottup style)
   Exact k-mer (word) matching. Returns boolean matchMap (1=match, 0=no).
   Marks the full word extent along the diagonal — not just the start —
   so diagonals are continuous with no gaps at word boundaries.          */
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

    // For each word in seqA, mark matching positions — full word extent along diagonal
    const matchMap = new Uint8Array(N * M);
    for (let i = 0; i <= N - W; i++) {
      const w = seqA.slice(i, i + W);
      const hits = bMap.get(w);
      if (!hits) continue;
      for (const j of hits) {
        // Mark all W positions of the matching word along the diagonal
        for (let k = 0; k < W; k++) {
          if (i + k < N && j + k < M) matchMap[(i + k) * M + (j + k)] = 1;
        }
      }
    }

    self.postMessage(
      { matchMap, rows: N, cols: M, wordSize: W },
      [matchMap.buffer]
    );
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
});
