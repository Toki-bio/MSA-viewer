/* ── Doter scoring worker ──────────────────────────────────────
   Diagonal prefix-sum scoring.  O(N·M) total, no inner window loop.
   Returns raw Int16 scores for rendering on main thread.
   Based on https://github.com/Toki-bio/doter                    */

self.addEventListener('message', (event) => {
  try {
    const { seqA, seqB, windowSize, mode } = event.data;
    const N = seqA.length;
    const M = seqB.length;
    const half = (windowSize - 1) >> 1;
    const mismatch = mode === 'dna-simple' ? -1 : 0;

    const aEnc = new Uint8Array(N);
    const bEnc = new Uint8Array(M);
    for (let i = 0; i < N; i++) aEnc[i] = seqA.charCodeAt(i);
    for (let j = 0; j < M; j++) bEnc[j] = seqB.charCodeAt(j);

    const scores = new Int16Array(N * M);
    const maxDiagLen = Math.max(N, M);
    const prefix = new Int32Array(maxDiagLen + 1);

    let globalMin = 0x7FFF;
    let globalMax = -0x8000;

    const diagCount = N + M - 1;
    for (let dd = 0; dd < diagCount; dd++) {
      const d = dd - (N - 1);
      const iStart = d < 0 ? -d : 0;
      const jStart = d < 0 ? 0 : d;
      const len = Math.min(N - iStart, M - jStart);

      prefix[0] = 0;
      for (let k = 0; k < len; k++) {
        prefix[k + 1] = prefix[k] + (aEnc[iStart + k] === bEnc[jStart + k] ? 1 : mismatch);
      }

      for (let k = 0; k < len; k++) {
        const lo = k - half;
        const hi = k + half + 1;
        const s = prefix[hi < len ? hi : len] - prefix[lo > 0 ? lo : 0];
        scores[(iStart + k) * M + (jStart + k)] = s;
        if (s < globalMin) globalMin = s;
        if (s > globalMax) globalMax = s;
      }
    }

    self.postMessage(
      { scores, rows: N, cols: M, min: globalMin, max: globalMax },
      [scores.buffer]
    );
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
});
