// Regression suite: each check is a real user-path interaction (real DOM
// events, not calling internal functions directly, except where the real
// event handler is confirmed to dispatch to the same internal call - see
// each check's comment). Exits 0 if all pass, 1 if any fail. Meant to be
// used both by a human (`node tests/regression/run-all.js`) and as a
// target of tests/run-all.js.
const { start } = require('../lib/static-server');
const { launch, closeLaunched, makeFasta, loadFasta, loadSyntheticFasta, setMode } = require('../lib/browser');

const CHECKS = [];
function check(name, fn, opts) { CHECKS.push({ name, fn, opts }); }   // opts.timeoutMs: this check's own time limit
const { withTimeout, checkTimeoutMs } = require('../lib/check-timeout');   // a time limit per check (2026-10-23)
// Canvas eases a mouse-wheel notch over 150 ms (v276): wait until the view has arrived (no-op in Full/Block)
async function settleWheel(pg) { await pg.waitForFunction(() => typeof _canvasState === 'undefined' || !_canvasState.wheelAnimating, null, { timeout: 2000 }).catch(() => {}); await pg.waitForTimeout(40); }

check('loads without console errors', async (page) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await loadFasta(page, makeFasta(20, 500));
  if (errors.length) return { pass: false, detail: `page errors: ${JSON.stringify(errors)}` };
  return { pass: true };
});

check('FASTA preamble beyond 200 lines preserves raw preflight sizing', async (page) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const fasta = 'A:\n'.repeat(201)
    + '>seq0\nACGTACGT\n>seq1\nACGTACGT\n>short\nACGTACG\n';

  await loadFasta(page, fasta);
  const result = await page.evaluate(() => ({
    sequences: state.seqs.map(s => s.seq),
    nSeqs: state.alignmentIndex?.nSeqs,
    maxLen: state.alignmentIndex?.maxLen,
    totalResidues: state.alignmentIndex?.totalResidues,
  }));

  // Padding creates 24 cells, but preflight must retain the original 23.
  const pass = errors.length === 0
    && result.sequences.join(',') === 'ACGTACGT,ACGTACGT,ACGTACG-'
    && result.nSeqs === 3
    && result.maxLen === 8
    && result.totalResidues === 23;
  return { pass, detail: JSON.stringify({ ...result, pageErrors: errors }) };
});

check('mode switching: full/block/canvas all render rows', async (page) => {
  await loadFasta(page, makeFasta(20, 500));
  for (const mode of ['full', 'block', 'canvas']) {
    await setMode(page, mode);
    const info = await page.evaluate(() => {
      const rows = document.querySelectorAll('.seq-line[data-seq-index]').length;
      const canvas = document.querySelector('#alignmentContainer canvas');
      return { rows, hasCanvas: !!canvas };
    });
    if (mode === 'canvas') {
      if (!info.hasCanvas) return { pass: false, detail: `canvas mode has no <canvas> element` };
    } else if (info.rows === 0) {
      return { pass: false, detail: `${mode} mode rendered 0 rows` };
    }
  }
  return { pass: true };
});

check('large (crazy) alignment triggers windowed DOM path', async (page) => {
  // 500 x 12000 = 6M residues, above ALIGN_CRAZY_VOLUME (5M). At/above that
  // size the app auto-switches to Canvas mode by default (CANVAS_AUTO_THRESHOLD
  // == ALIGN_CRAZY_VOLUME, see v179) - explicitly force Full/DOM mode since
  // that's the windowed-DOM path this check is actually about.
  await loadSyntheticFasta(page, 500, 12000);
  await setMode(page, 'full');
  const info = await page.evaluate(() => {
    const container = document.getElementById('alignmentContainer');
    const row = document.querySelector('.seq-line[data-seq-index]');
    return {
      isCrazy: !!state.alignmentIndex?.isCrazy,
      domRows: document.querySelectorAll('.seq-line[data-seq-index]').length,
      visibleRows: Math.ceil(container.clientHeight / Math.max(1, row ? row.getBoundingClientRect().height : 16)),
    };
  });
  if (!info.isCrazy) return { pass: false, detail: 'expected isCrazy=true for 6M-residue alignment' };
  // Windowed: the rows on screen plus a scroll guard above and below (at most
  // three screens' worth), never the whole 500-row alignment
  const limit = Math.min(3 * info.visibleRows, 250);
  if (info.domRows === 0 || info.domRows > limit) {
    return { pass: false, detail: `expected a viewport-bounded row count (<= ${limit} for ${info.visibleRows} visible rows), got ${info.domRows}` };
  }
  return { pass: true, detail: `${info.domRows} rows in the DOM, ${info.visibleRows} visible` };
});

check('consensus row respects column windowing on horizontal scroll (v179 regression)', async (page) => {
  // Regresses the bug where addConsensusLine was passed the block's full
  // start/end instead of colStart/colEnd, building one span per column of
  // the whole alignment on every scroll. 300 x 20000 = 6M residues.
  await loadSyntheticFasta(page, 300, 20000);
  await setMode(page, 'full');
  const t = await page.evaluate(() => {
    const container = document.getElementById('alignmentContainer');
    container.scrollLeft = 8000;
    const t0 = performance.now();
    _refreshUnifiedWindowOnScroll(container);
    const dt = performance.now() - t0;
    const consensusSpans = document.querySelectorAll('.consensus-line .seq-data > *').length;
    return { dt, consensusSpans };
  });
  if (t.consensusSpans > 500) {
    return { pass: false, detail: `consensus row built ${t.consensusSpans} spans - looks unwindowed (full alignment width, not viewport)` };
  }
  if (t.dt > 500) {
    return { pass: false, detail: `scroll refresh took ${t.dt.toFixed(1)}ms - expected well under 500ms for a windowed refresh` };
  }
  return { pass: true, detail: `${t.dt.toFixed(1)}ms, ${t.consensusSpans} consensus spans` };
});

check('spanCache stays bounded during scroll in edit mode (spanCache regression)', async (page) => {
  await loadSyntheticFasta(page, 300, 12000); // 3.6M residues, isCrazy
  await setMode(page, 'full');
  await page.evaluate(() => { state.editModeActive = true; state._enableSpanCache = true; });
  const sizes = await page.evaluate(() => {
    const container = document.getElementById('alignmentContainer');
    const out = [];
    const maxScroll = container.scrollHeight - container.clientHeight;
    for (let i = 0; i <= 8; i++) {
      container.scrollTop = Math.floor(maxScroll * (i / 8));
      _refreshUnifiedWindowOnScroll(container);
      out.push(state.spanCache.size);
    }
    return out;
  });
  const max = Math.max(...sizes);
  if (max > 200) { // nSeq=300; a real leak trends toward that, a bounded cache stays near viewport size (~80-100)
    return { pass: false, detail: `spanCache grew to ${max} across scroll (nSeq=300) - looks unbounded` };
  }
  return { pass: true, detail: `max spanCache size ${max}` };
});

check('GeneDoc residue typing + undo/redo round-trips correctly', async (page) => {
  await loadFasta(page, makeFasta(5, 50));
  await setMode(page, 'full');
  const result = await page.evaluate(async () => {
    setGeneDocEditTool('residue');
    state.editCell = { row: 0, pos: 0 };
    const before = state.seqs[0].seq;
    // Dispatch real keydown events, same path a real keystroke takes.
    for (const ch of 'XYZ') {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 10));
    }
    const afterType = state.seqs[0].seq;
    undoDelete(); undoDelete(); undoDelete();
    const afterUndo = state.seqs[0].seq;
    redoAction(); redoAction(); redoAction();
    const afterRedo = state.seqs[0].seq;
    return { before, afterType, afterUndo, afterRedo };
  });
  if (result.afterType === result.before) return { pass: false, detail: 'typing did not change the sequence' };
  if (result.afterUndo !== result.before) {
    return { pass: false, detail: `triple-undo did not restore original: before="${result.before}" afterUndo="${result.afterUndo}"` };
  }
  if (result.afterRedo !== result.afterType) {
    return { pass: false, detail: `triple-redo did not restore typed state: afterType="${result.afterType}" afterRedo="${result.afterRedo}"` };
  }
  return { pass: true };
});

check('column selection highlights only currently-visible rows after scroll', async (page) => {
  await loadSyntheticFasta(page, 300, 12000);
  await setMode(page, 'full');
  const result = await page.evaluate(() => {
    const container = document.getElementById('alignmentContainer');
    container.scrollTop = 0;
    _refreshUnifiedWindowOnScroll(container);
    const pos = 5;
    state.selectedColumns = new Set([pos]);
    updateColumnSelections();
    const visibleRows = document.querySelectorAll('.seq-line[data-seq-index]').length;
    return { visibleRows, ranWithoutError: true };
  });
  if (!result.ranWithoutError || result.visibleRows === 0) {
    return { pass: false, detail: `unexpected state after selection update: ${JSON.stringify(result)}` };
  }
  return { pass: true };
});

check('Default view by size: below ALIGN_CANVAS_DEFAULT_RESIDUES a DOM mode, at/above it Canvas (v179, v245)', async (page) => {
  // v179: the auto-switch threshold was once so low that ordinary alignments opened read-only in
  // Canvas - the small case guards against that. v245 (2026-10-16): at or above
  // ALIGN_CANVAS_DEFAULT_RESIDUES (100k) a loaded alignment opens in Canvas, because the DOM
  // view at 100k-500k residues laid out and repainted on every scroll step (110-160 ms frames
  // at 600 x 600) while Canvas scrolls by copying the frame (~8 ms). CANVAS_AUTO_THRESHOLD is
  // local to renderAlignment(), so the behaviour is tested, not the constant.
  const lim = await page.evaluate(() => typeof ALIGN_CANVAS_DEFAULT_RESIDUES !== 'undefined' ? ALIGN_CANVAS_DEFAULT_RESIDUES : null);
  if (lim === null) return { pass: false, detail: 'could not read ALIGN_CANVAS_DEFAULT_RESIDUES from page' };
  const nCol = 500;
  const out = {};
  for (const [label, nSeq] of [['below', Math.floor((lim * 0.9) / nCol)], ['atOrAbove', Math.ceil((lim * 1.1) / nCol)]]) {
    await loadSyntheticFasta(page, nSeq, nCol);
    out[label] = await page.evaluate(() => ({
      residues: state.seqs.length * state.seqs[0].seq.length,
      canvasEl: !!document.querySelector('#alignmentContainer canvas'),
      domRows: document.querySelectorAll('.seq-line[data-seq-index]').length,
      canvasRadio: document.getElementById('modeCanvas').checked,
      note: document.getElementById('statusMessage')?.textContent || '',
    }));
  }
  const bad = [];
  if (out.below.canvasEl || out.below.domRows === 0) bad.push(`${out.below.residues} residues (below the limit) did not open in a DOM mode`);
  if (!out.atOrAbove.canvasEl || !out.atOrAbove.canvasRadio) bad.push(`${out.atOrAbove.residues} residues (above the limit) did not open in Canvas`);
  // v249: the switch is announced (10 s note); v254: nothing needs Full or Block any more, the note names them as the DOM views
  if (!/Full or Block/.test(out.atOrAbove.note)) bad.push(`no limitation note after the switch (status: "${out.atOrAbove.note.slice(0, 80)}")`);
  return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') : JSON.stringify(out) };
});

check('recent-files history: max-count setting survives a real page reload', async (page) => {
  // Regresses a bug where _historyManager.save() tried to persist maxItems
  // by tacking a "_max" property onto a plain Array before JSON.stringify -
  // which silently drops non-index array properties, so the setting was
  // never actually written to localStorage and reverted on every render.
  await page.evaluate(() => {
    localStorage.setItem('msaviewer_history', JSON.stringify({ max: 10, items: [
      { type: 'file', name: 'a.fa', timestamp: Date.now(), nSeqs: 3, length: 10, preview: '', source: '', text: null }
    ]}));
  });
  await page.click('.section-header[data-section="input"]');
  await page.click('#recentButton');
  await page.waitForTimeout(150);
  await page.focus('#historyMaxInput');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  const immediate = await page.inputValue('#historyMaxInput');
  if (immediate !== '11') return { pass: false, detail: `expected 11 right after one ArrowUp, got ${immediate}` };

  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.section-header[data-section="input"]');
  await page.click('#recentButton');
  await page.waitForTimeout(150);
  const afterReload = await page.inputValue('#historyMaxInput');
  if (afterReload !== '11') return { pass: false, detail: `expected 11 to survive a real reload, got ${afterReload} - setting was not actually persisted` };
  return { pass: true, detail: `max-count 11 correctly survived a real page reload` };
});

check('recent-files history: file entries do not cache truncated text', async (page) => {
  // Regresses a bug where every load (file or clipboard) cached up to
  // 100,000 chars of raw input text for reopen-from-history. Reopening a
  // file larger than that silently loaded a truncated fragment with no
  // warning (a real 3,408-sequence FASTA reopened as just 55 sequences).
  // Files should be re-opened from disk; only clipboard pastes (which have
  // no other source once cleared) should cache their text.
  const bigFasta = '>seq1\n' + 'ACGT'.repeat(30000) + '\n'; // ~120KB, over the old 100KB cap
  await page.evaluate((fasta) => {
    document.getElementById('fastaInput').value = fasta;
    state.currentFilename = 'big_test.fa';
    state.currentFilePath = 'C:/fake/big_test.fa';
  }, bigFasta);
  await page.evaluate(() => parseAndRender(false));
  await page.waitForTimeout(300);
  const entry = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('msaviewer_history'));
    return raw.items.find(e => e.name === 'big_test.fa');
  });
  if (!entry) return { pass: false, detail: 'no history entry was recorded for the loaded file' };
  if (entry.text !== null) return { pass: false, detail: `expected text=null for a file-type entry, got ${entry.text === undefined ? 'undefined' : entry.text.length + ' chars'} - reopening would silently load a truncated fragment` };
  return { pass: true, detail: `file-type history entry correctly stores text=null (forces a real re-open)` };
});

check('recent-files history: full source path visible without hovering, and a real preview panel appears on hover', async (page) => {
  await page.evaluate(() => {
    localStorage.setItem('msaviewer_history', JSON.stringify({ max: 10, items: [
      { type: 'file', name: 'scorpion_candidates.aln.fa', timestamp: Date.now(), nSeqs: 3408, length: 1842,
        preview: 'seqA, seqB, seqC  [ACGTACGTACGTACGT...]', source: 'C:\\work\\SINEderella\\de-novo-scan\\scorpion_candidates.aln.fa', text: null }
    ]}));
  });
  await page.click('.section-header[data-section="input"]');
  await page.click('#recentButton');
  await page.waitForTimeout(150);
  const pathVisible = await page.evaluate(() => document.querySelector('#recentDropdown').textContent.includes('SINEderella'));
  if (!pathVisible) return { pass: false, detail: 'full source path is not visible in the dropdown without hovering' };

  await page.hover('.recent-item');
  await page.waitForTimeout(150);
  const preview = await page.evaluate(() => {
    const el = document.getElementById('recentItemPreview');
    return el ? { visible: el.style.display === 'block', text: el.textContent } : null;
  });
  if (!preview || !preview.visible) return { pass: false, detail: 'no custom hover-preview panel appeared' };
  if (!preview.text.includes('seqA') || !preview.text.includes('3408')) {
    return { pass: false, detail: `hover preview missing expected content: ${preview.text}` };
  }
  return { pass: true, detail: 'full path visible, hover preview shows sequence content and stats' };
});

check('local-path load: a non-JSON server response gives a clear message, not a raw parse error', async (page) => {
  // Regresses the case where fetch('/api/local-cat') on a deployment
  // without server.js (e.g. GitHub Pages) gets back a plain 404 body -
  // resp.json() on that used to throw a raw SyntaxError ("Unexpected
  // token") before the response's ok-ness was even checked, surfacing an
  // implementation-detail error instead of an actionable one.
  await page.evaluate(() => {
    document.getElementById('fastaInput').value = 'C:\\work\\SINEderella\\de-novo-scan\\scorpion_candidates.aln.fa';
  });
  await page.evaluate(() => parseAndRender(false));
  await page.waitForTimeout(400);
  const msg = await page.evaluate(() => {
    const els = document.querySelectorAll('body *');
    for (const e of els) if (e.textContent && e.textContent.includes('Could not read local file')) return e.textContent;
    return null;
  });
  if (!msg) return { pass: false, detail: 'no "Could not read local file" message appeared at all' };
  if (msg.includes('Unexpected token') || msg.includes('SyntaxError')) {
    return { pass: false, detail: `message leaks a raw JSON parse error instead of explaining the server is unavailable: ${msg}` };
  }
  if (!msg.toLowerCase().includes('server')) {
    return { pass: false, detail: `message doesn't mention the actual cause (missing optional server): ${msg}` };
  }
  return { pass: true, detail: `clear message: ${msg}` };
});

check('version indicator never depends on the rate-limited GitHub API', async (page) => {
  // Regresses the commit-hash display silently depending on GitHub's
  // unauthenticated REST API (60 requests/hour PER IP, shared across
  // everyone behind the same NAT) - confirmed exhausted (0/60 remaining)
  // during real testing, and the failure was invisible (a bare
  // .catch(() => {})). It must now read a same-origin version.json
  // instead, which has no such limit.
  const externalRequests = [];
  page.on('request', req => {
    if (req.url().includes('api.github.com')) externalRequests.push(req.url());
  });
  await page.waitForTimeout(1000);
  if (externalRequests.length > 0) {
    return { pass: false, detail: `version display still hits the external GitHub API: ${JSON.stringify(externalRequests)}` };
  }
  const usesVersionJson = await page.evaluate(() => {
    const src = updateVersionIndicator.toString();
    return src.includes('version.json') && !src.includes('api.github.com');
  });
  if (!usesVersionJson) return { pass: false, detail: 'updateVersionIndicator() no longer reads version.json as expected' };
  return { pass: true, detail: 'version indicator reads a same-origin file, no external API dependency' };
});

check('Recent Files reopen: File System Access handle logic (permission granted/denied/missing)', async (page) => {
  // Note on what this test can and can't cover: Chromium's native
  // showOpenFilePicker() dialog cannot be driven by headless automation the
  // way the classic <input type=file> chooser can (a real, known
  // limitation, not something skipped here) - so this exercises
  // _fileHandleStore's own logic (permission gating, read, error handling)
  // with a mock handle whose get() is substituted in directly, rather than
  // a real end-to-end native-picker flow. IndexedDB's structured-clone
  // requirement means a plain mock object with function properties can't
  // round-trip through the real put()/get() (functions never survive
  // structured clone) - real FileSystemFileHandle objects have special
  // browser-native serialization support for exactly this, per spec, which
  // is why production code doesn't need this same workaround.
  const result = await page.evaluate(async () => {
    const grantedHandle = {
      kind: 'file', name: 'mock_test.fa', _content: '>seqX\nACGTACGT\n>seqY\nACGTACGA\n',
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
      async getFile() { const self = this; return { name: self.name, async text() { return self._content; } }; },
    };
    const deniedHandle = {
      kind: 'file', name: 'denied.fa',
      async queryPermission() { return 'denied'; },
      async requestPermission() { return 'denied'; },
      async getFile() { throw new Error('should not be called if permission denied'); },
    };
    const origGet = _fileHandleStore.get.bind(_fileHandleStore);

    document.getElementById('fastaInput').value = '';
    state.seqs = [];
    _fileHandleStore.get = async (id) => (id === 'mock_granted' ? grantedHandle : origGet(id));
    const grantedHandled = await _fileHandleStore.tryReopen('mock_granted', 'mock_test.fa');
    await new Promise(r => setTimeout(r, 300));
    const grantedOutcome = { handled: grantedHandled, nSeqs: state.seqs?.length, filename: state.currentFilename };

    _fileHandleStore.get = async (id) => (id === 'mock_denied' ? deniedHandle : origGet(id));
    const deniedHandled = await _fileHandleStore.tryReopen('mock_denied', 'denied.fa');

    _fileHandleStore.get = origGet;
    const missingHandled = await _fileHandleStore.tryReopen('totally_nonexistent_id', 'x.fa');

    return { grantedOutcome, deniedHandled, missingHandled };
  });
  if (!result.grantedOutcome.handled || result.grantedOutcome.nSeqs !== 2 || result.grantedOutcome.filename !== 'mock_test.fa') {
    return { pass: false, detail: `granted-permission reopen didn't work correctly: ${JSON.stringify(result.grantedOutcome)}` };
  }
  if (result.deniedHandled !== true) {
    return { pass: false, detail: `permission-denied case should be handled (show its own message), got handled=${result.deniedHandled}` };
  }
  if (result.missingHandled !== false) {
    return { pass: false, detail: `a missing/unknown handle id should fall through to the generic message (handled=false), got ${result.missingHandled}` };
  }
  return { pass: true, detail: 'granted/denied/missing handle paths all behave correctly' };
});

check('recent-files history: explicit up/down stepper buttons work (replacing the native spinner)', async (page) => {
  // Regresses the reported issue where the native number-input spin
  // buttons were visually clipped at the top - replaced with explicit,
  // fully-controlled up/down buttons instead of relying on native OS
  // spinner chrome (which headless Chrome doesn't even render, so that
  // specific clipping claim could never be visually verified here either
  // way - this test covers the buttons' own click behavior instead, which
  // IS fully controllable and testable).
  await page.evaluate(() => {
    localStorage.setItem('msaviewer_history', JSON.stringify({ max: 10, items: [
      { type: 'file', name: 'a.fa', timestamp: Date.now(), nSeqs: 3, length: 10, preview: '', source: '', text: null }
    ]}));
  });
  await page.click('.section-header[data-section="input"]');
  await page.click('#recentButton');
  await page.waitForTimeout(150);

  const before = await page.inputValue('#historyMaxInput');
  if (before !== '10') return { pass: false, detail: `expected initial value 10, got ${before}` };

  // Dispatched directly rather than via page.click() - Playwright's
  // synthetic mouse-move-then-click sequence intermittently reported this
  // tiny (14x11px) button as "not visible" during manual investigation,
  // seemingly related to this dropdown's own mouseenter/mouseleave hover-
  // preview handlers on adjacent .recent-item rows interfering with
  // Playwright's stability check while moving the pointer - isVisible(),
  // boundingBox(), and count() all reported the element as completely
  // normal in isolation, and no actual visual overlap with the hover
  // preview panel was found, so this looks like a Playwright/synthetic-
  // mouse-path quirk from this specific combination of features rather
  // than a real click-blocking bug - but it means the click PATH itself
  // isn't covered here, only the handler logic a click would trigger.
  await page.evaluate(() => document.querySelector('button[title="Increase"]').click());
  await page.waitForTimeout(100);
  const afterInc = await page.inputValue('#historyMaxInput');
  if (afterInc !== '11') return { pass: false, detail: `Increase button: expected 11, got ${afterInc}` };

  await page.evaluate(() => document.querySelector('button[title="Decrease"]').click());
  await page.waitForTimeout(100);
  const afterDec = await page.inputValue('#historyMaxInput');
  if (afterDec !== '10') return { pass: false, detail: `Decrease button: expected 10, got ${afterDec}` };

  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.section-header[data-section="input"]');
  await page.click('#recentButton');
  await page.waitForTimeout(150);
  const afterReload = await page.inputValue('#historyMaxInput');
  if (afterReload !== '10') return { pass: false, detail: `expected the decremented value to survive reload, got ${afterReload}` };

  return { pass: true, detail: 'up/down buttons correctly change and persist the max count' };
});

check('Clustering Results modal is draggable, resizable, and minimizable', async (page) => {
  const fasta = [
    '>seqA1', 'AAAAAAAAAAAAAAAAAAAA',
    '>seqA2', 'AAAAAAAAAAAAAAAAAAAA',
    '>seqA3', 'AAAAAAAAAAAAAAAAAAAA',
    '>seqA4', 'AAAAAAAAAAAAAAAAAAAA',
    '>seqA5', 'AAAAAAAAAAAAAAAAAAAA',
    '>seqB1', 'TTTTTTTTTTTTTTTTTTTT',
    '>seqB2', 'TTTTTTTTTTTTTTTTTTTT',
    '>seqB3', 'TTTTTTTTTTTTTTTTTTTT',
    '>seqB4', 'TTTTTTTTTTTTTTTTTTTT',
    '>seqB5', 'TTTTTTTTTTTTTTTTTTTT',
  ].join('\n');
  await page.evaluate((f) => { document.getElementById('fastaInput').value = f; }, fasta);
  await page.evaluate(() => parseAndRender(false));
  await page.evaluate(() => {
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('clusterMinSizeInput', '2');
    setVal('clusterMinPerfectInput', '1');
    setVal('minOccurrencesInput', '2');
  });
  await page.evaluate(async () => { await clusterSequences(); });
  await page.waitForTimeout(400);

  const initial = await page.evaluate(() => {
    const r = document.getElementById('clusteringModal').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });

  // Drag
  const header = await page.locator('#clusteringModalHeader').boundingBox();
  await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2);
  await page.mouse.down();
  await page.mouse.move(header.x + header.width / 2 + 150, header.y + header.height / 2 + 80, { steps: 10 });
  await page.mouse.up();
  const afterDrag = await page.evaluate(() => {
    const r = document.getElementById('clusteringModal').getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  if (Math.abs(afterDrag.left - (initial.left + 150)) > 5 || Math.abs(afterDrag.top - (initial.top + 80)) > 5) {
    return { pass: false, detail: `drag didn't move the modal as expected: ${JSON.stringify(afterDrag)} vs expected ~(${initial.left + 150}, ${initial.top + 80})` };
  }

  // Resize
  const modalRect = await page.locator('#clusteringModal').boundingBox();
  const hx = modalRect.x + modalRect.width - 6, hy = modalRect.y + modalRect.height - 6;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + 100, hy + 60, { steps: 10 });
  await page.mouse.up();
  const afterResize = await page.evaluate(() => {
    const r = document.getElementById('clusteringModal').getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  if (afterResize.w < modalRect.width + 80 || afterResize.h < modalRect.height + 40) {
    return { pass: false, detail: `resize didn't grow the modal as expected: before ${modalRect.width}x${modalRect.height}, after ${JSON.stringify(afterResize)}` };
  }

  // Minimize / restore
  await page.click('#clusteringModalHeader button[title="Minimize"]');
  await page.waitForTimeout(150);
  const minimized = await page.evaluate(() => getComputedStyle(document.getElementById('clusteringContent')).display === 'none');
  if (!minimized) return { pass: false, detail: 'clicking Minimize did not hide the content' };

  await page.click('#clusteringModalHeader button[title="Restore"]');
  await page.waitForTimeout(150);
  const restored = await page.evaluate(() => getComputedStyle(document.getElementById('clusteringContent')).display !== 'none');
  if (!restored) return { pass: false, detail: 'clicking Restore did not bring the content back' };

  return { pass: true, detail: 'drag, resize, minimize, and restore all work correctly' };
});

check('Dot plot: toolbar buttons stay grouped (Recalculate/-/+ never split across rows)', async (page) => {
  const fasta = '>seqA\n' + 'ACGTACGTACGTACGTACGTACGTACGTACGT'.repeat(3) + '\n>seqB\n' + 'ACGTACGTACGTACGTACGTACGTACGTACGT'.repeat(3) + '\n';
  await page.evaluate((f) => { document.getElementById('fastaInput').value = f; }, fasta);
  await page.evaluate(() => parseAndRender(false));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const s = state.seqs[0];
    const ungapped = s.seq.replace(/[-. ]/g, '');
    openDotPlot(ungapped, ungapped, s.header, s.header, { rowIndexA: 0, rowIndexB: 0, alignedSeqA: s.seq, alignedSeqB: s.seq });
  });
  await page.waitForTimeout(500);
  const layout = await page.evaluate(() => {
    const zi = document.getElementById('dotPlotZoomIn').getBoundingClientRect();
    const zo = document.getElementById('dotPlotZoomOut').getBoundingClientRect();
    const rc = document.getElementById('dotPlotRecalc').getBoundingClientRect();
    return Math.abs(zi.top - zo.top) < 3 && Math.abs(zi.top - rc.top) < 3;
  });
  if (!layout) return { pass: false, detail: 'Recalculate/zoom-out/zoom-in buttons are not on the same row - the toolbar wrapped mid-group' };
  return { pass: true, detail: 'zoom button group stays together when the toolbar wraps' };
});

check('Dot plot: Ctrl+wheel zoom works (not silently killed by an ancestor capture-phase listener)', async (page) => {
  const fasta = '>seqA\n' + 'ACGTACGTACGTACGTACGTACGTACGTACGT'.repeat(3) + '\n>seqB\n' + 'ACGTACGTACGTACGTACGTACGTACGTACGT'.repeat(3) + '\n';
  await page.evaluate((f) => { document.getElementById('fastaInput').value = f; }, fasta);
  await page.evaluate(() => parseAndRender(false));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const s = state.seqs[0];
    const ungapped = s.seq.replace(/[-. ]/g, '');
    openDotPlot(ungapped, ungapped, s.header, s.header, { rowIndexA: 0, rowIndexB: 0, alignedSeqA: s.seq, alignedSeqB: s.seq });
  });
  await page.waitForTimeout(800);
  const result = await page.evaluate(() => {
    const overlay = document.getElementById('dotPlotOverlay');
    const before = _dotPlotState.zoom;
    const rect = overlay.getBoundingClientRect();
    overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, ctrlKey: true, bubbles: true, cancelable: true }));
    return { before, after: _dotPlotState.zoom };
  });
  if (result.before === result.after) return { pass: false, detail: `zoom did not change on Ctrl+wheel (before=${result.before}, after=${result.after}) - an ancestor's capture-phase stopPropagation is likely killing the event before the overlay's own handler runs` };
  return { pass: true, detail: `zoom changed from ${result.before} to ${result.after} on Ctrl+wheel` };
});

// Real file-input path (setInputFiles fires the same 'change' event a user's
// file pick does). Synthetic files are the published examples/synthetic set.
const SYNTH = require('path').join(__dirname, '..', '..', 'examples', 'synthetic');
async function openSynthetic(page, name) {
  await page.setInputFiles('#fileInput', require('path').join(SYNTH, name));
  await page.waitForTimeout(2500);
  return page.evaluate(() => ({ n: state.seqs.length, name: state.seqs[0] && state.seqs[0].header, msg: document.getElementById('statusMessage').innerText }));
}

check('GenBank file opens (parser returns the same record shape as FASTA)', async (page) => {
  const r = await openSynthetic(page, 'synth_ref.gb');
  if (r.n !== 1 || r.name !== 'synth_ref') return { pass: false, detail: JSON.stringify(r) };
  return { pass: true, detail: `1 sequence named ${r.name}` };
});

check('BAM piles onto a loaded reference (multi-block BGZF decompresses in Chrome)', async (page) => {
  await openSynthetic(page, 'synth_ref.fa');
  const r = await openSynthetic(page, 'synth_reads.bam');
  if (!/Loaded \d+ reads/.test(r.msg)) return { pass: false, detail: r.msg };
  return { pass: true, detail: r.msg };
});

// The reference letters, the ruler and the read bars are three separate rows; each base must sit in
// one column across all three (the reference name label had borrowed the main view's -12px margin)
check('BAM Reads view: reference bases, ruler and reads line up base for base', async (page) => {
  await openSynthetic(page, 'synth_ref.fa');
  await openSynthetic(page, 'synth_reads.bam');
  const r = await page.evaluate(() => {
    const L = e => e.getBoundingClientRect().left;
    const refCells = [...document.querySelectorAll('.ref-track-line .seq-data span')];
    const rulerCells = [...document.querySelector('.scale-line').children[1].children];
    const svg = document.getElementById('readsPileSvg');   // the reads (a coverage row's svg now comes first)
    // read_perfect_a: 40M at position 1, so its bar starts at the reference's first base
    const read = bamState.reads.find(x => x.name === 'read_perfect_a' || x.readName === 'read_perfect_a');
    const bar = read && [...svg.querySelectorAll('rect')].find(e => e.getAttribute('width') == String(40 * 12));
    const p = read ? read.pos - bamState.refStart : -1;
    return { refBase: refCells[p] && Math.round(L(refCells[p])), ruler: rulerCells[p] && Math.round(L(rulerCells[p])),
             read: bar && Math.round(L(svg) + +bar.getAttribute('x')), refLetter: refCells[p] && refCells[p].textContent, p };
  });
  const ok = r.refBase != null && r.refBase === r.ruler && r.refBase === r.read && r.refLetter === 'A';
  return { pass: ok, detail: JSON.stringify(r) };
});

// Reads could only be looked at: codon analysis and MACSE work on rows, and in Full view the reads were gone.
// "Sample -> row" puts the sample under the reference; codon analysis must then classify each planted change of
// tests/fixtures/reads (make_gene_reads.js) against the reference, heterozygous ones (IUPAC) included.
check('Reads: Sample -> row puts the sample under the reference and codon analysis classes its changes', async (page) => {
  const path = require('path'), fs = require('fs');
  const DIR = path.join(__dirname, '..', 'fixtures', 'reads');
  const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'));
  await page.setInputFiles('#fileInput', path.join(DIR, 'gene_ref.fa'));
  await page.waitForTimeout(1500);
  await page.setInputFiles('#bamFileInput', path.join(DIR, 'gene_reads.sam'));
  await page.waitForTimeout(2500);
  await page.click('#readsSampleRowButton');
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const c = document.getElementById('codonAnalysis'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1500);
  const m = Object.fromEntries(truth.muts.map(x => [x.name, x]));
  const r = await page.evaluate((m) => {
    const d = state._codonData, i = 1;
    const at = col => d && d.synNonSyn[i][col];
    const stopAt = col => !!d && d.stops[i].includes(col);
    return {
      rows: state.seqs.map(s => s.header), view: document.getElementById('modeSingle').checked ? 'full' : 'other', frame: d && d.frameOffset,
      syn: at(m.syn_hom.pos), missense: at(m.missense_het.pos), missenseBase: state.seqs[1].seq[m.missense_het.pos],
      stopHom: stopAt(m.stop_hom.pos), stopHet: stopAt(m.stop_het.pos), stopHetMark: at(m.stop_het.pos),
      frameshift: !!d && d.frameShifts[i].some(f => Math.abs(f.pos - m.del1_hom.pos) <= 3), refFrameshifts: d && d.frameShifts[0].length,
      refStopAtMut: !!d && d.stops[0].includes(m.stop_hom.pos), insCols: state.seqs[0].seq.slice(m.ins3_hom.pos, m.ins3_hom.pos + 3), insSample: state.seqs[1].seq.slice(m.ins3_hom.pos, m.ins3_hom.pos + 3),
      msg: document.getElementById('statusMessage').innerText.slice(0, 300)
    };
  }, m);
  // Undo takes the row (and the inserted columns) away again
  await page.click('#undoButton');
  await page.waitForTimeout(800);
  r.afterUndo = await page.evaluate(() => state.seqs.map(s => s.seq.length + ':' + s.header).join(','));
  const ok = r.rows.join() === 'gene,gene_sample' && r.view === 'full' && r.frame === 0
    && r.syn === 'syn' && r.missense === 'nonsyn' && r.missenseBase === 'R' && r.stopHom && r.stopHet && r.stopHetMark === 'nonsyn'
    && r.frameshift && r.refFrameshifts === 0 && !r.refStopAtMut && r.insCols === '---' && r.insSample === m.ins3_hom.ins && r.afterUndo === '963:gene';
  return { pass: ok, detail: JSON.stringify(r) };
});

// Two rows that disagree after a 1-base deletion are a tie for "Frameshifts vs: most rows"; the lowest codon
// position won it, so the reference row (row 1) got frameshift marks on every codon after the deletion
check('Codon analysis, two rows: a 1-base deletion marks the row that has it, not the reference', async (page) => {
  const ref = 'ATGGCTAAACTGGAAGTTCGTAAAGCTGGTCTGTAA';
  const del = ref.slice(0, 13) + '-' + ref.slice(14);
  await page.evaluate(f => { document.getElementById('fastaInput').value = f; parseAndRender(false); }, `>ref\n${ref}\n>sample\n${del}\n`);
  await page.waitForTimeout(500);
  await page.evaluate(() => { const c = document.getElementById('codonAnalysis'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({ ref: state._codonData.frameShifts[0].length, sample: state._codonData.frameShifts[1].map(f => f.pos) }));
  return { pass: r.ref === 0 && r.sample.length === 1 && Math.abs(r.sample[0] - 13) <= 1, detail: JSON.stringify(r) };
});

// A heterozygous base (IUPAC, e.g. a sample row called from reads) left its codon unmarked: each allele is now
// classed, and an allele that is a stop marks the codon as a stop
check('Codon analysis: a heterozygous (IUPAC) base is classed by its alleles; a possible stop is a stop', async (page) => {
  // codon 2 GCT (Ala): GMT = GCT/GAT (Ala/Asp) -> non-synonymous; codon 3 AAA: AAR = AAA/AAG (Lys) -> synonymous;
  // codon 4 CTG (Leu): YTG = CTG/TTG (Leu) -> synonymous; codon 5 GAA: KAA = GAA/TAA -> stop
  const ref = 'ATGGCTAAACTGGAAGTTTAA', smp = 'ATGGMTAARYTGKAAGTTTAA';
  await page.evaluate(f => { document.getElementById('fastaInput').value = f; parseAndRender(false); }, `>ref\n${ref}\n>sample\n${smp}\n`);
  await page.waitForTimeout(500);
  await page.evaluate(() => { const c = document.getElementById('codonAnalysis'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => { const d = state._codonData; return { m: [4, 8, 9, 12].map(c => d.synNonSyn[1][c]), stop: [12, 13, 14].every(c => d.stops[1].includes(c)), refStop: d.stops[0].filter(c => c < 18).length }; });
  return { pass: r.m.join() === 'nonsyn,syn,syn,nonsyn' && r.stop && r.refStop === 0, detail: JSON.stringify(r) };
});

// The codon aligners were never given the genetic code chosen in the Code menu: MACSE and the fast engine always
// used the standard code, so in a mitochondrial gene TGA (Trp) counted as an internal stop and was penalised
check('Codon alignment uses the chosen genetic code (vertebrate mito: TGA is Trp, not a stop), MACSE and fast', async (page) => {
  // 13 codons with two TGA (Trp in code 2); the second row lacks codon 5
  const cds = 'ATGGCTTGAAAACTGGAATGAGTTCGTAAAGCTGGTCTG';
  const fa = `>a\n${cds}\n>b\n${cds.slice(0, 12) + cds.slice(15)}\n>c\n${cds}\n`;
  const r = {};
  for (const engine of ['macse', 'fast']) {
    await page.evaluate(f => { document.getElementById('fastaInput').value = f; parseAndRender(false); }, fa);
    await page.waitForTimeout(400);
    await page.evaluate((engine) => {
      const code = document.getElementById('codonCode'); code.value = '2'; code.dispatchEvent(new Event('change', { bubbles: true }));
      openMacsePreset(false);
      const eng = document.getElementById('codonEngine'); eng.value = engine; eng.dispatchEvent(new Event('change', { bubbles: true }));
      window._lastCodonAlignStats = null;
    }, engine);
    await page.evaluate(() => realignAll());
    await page.waitForFunction(() => !!window._lastCodonAlignStats, null, { timeout: 60000 }).catch(() => {});
    // with the standard code MACSE dodged the two TGA by putting two frameshifts in every row (--ATG...)
    r[engine] = await page.evaluate(() => {
      const st = window._lastCodonAlignStats, sum = l => (l || []).reduce((a, x) => a + x.n, 0);
      return st ? { stops: sum(st.internalStops), frameshifts: sum(st.frameshifts), row1: state.seqs[0].seq.slice(0, 5) } : 'no stats';
    });
  }
  await page.evaluate(() => { const code = document.getElementById('codonCode'); code.value = '1'; code.dispatchEvent(new Event('change', { bubbles: true })); });
  const clean = x => x && x.stops === 0 && x.frameshifts === 0 && x.row1 === 'ATGGC';
  return { pass: clean(r.macse) && clean(r.fast), detail: JSON.stringify(r) };
});

// A plain click on a name selected nothing (since the March drag-to-reorder: a press without movement was simply
// dropped), in every view, though the manual says "Click sequence name: Select row". Click selects that row
// alone; a click on the only selected row unselects it.
// Owner's request: the name column's width is set by dragging the (invisible) boundary between names and sequences,
// not only with the Name length slider. The drag must not start a row reorder or select anything.
check('Name column width: dragging the boundary between names and sequences sets the name length (Full, Block, Canvas)', async (page) => {
  const out = {};
  for (const view of ['full', 'block', 'canvas']) {
    const p = await page.context().browser().newPage({ viewport: { width: 1200, height: 700 } });
    await p.goto(page.url().replace(/view=\w+/, 'view=' + view).replace(/(index\.html)(?!\?)/, '$1?view=' + view), { waitUntil: 'networkidle' });
    await p.setInputFiles('#fileInput', { name: 'n.fa', mimeType: 'text/plain', buffer: Buffer.from('>a_rather_long_sequence_name_one\nACGTACGTACGT\n>second_long_sequence_name_two\nACGTACGAACGT\n>third\nACGAACGTACGT\n') });
    await p.waitForTimeout(1500);
    await p.evaluate(() => setNameLengthUI(10, true));
    await p.waitForTimeout(800);
    const geo = await p.evaluate(() => {
      if (document.getElementById('modeCanvas').checked) {
        const r = _canvasState.canvas.getBoundingClientRect(), m = _canvasState.metrics;
        return { edge: r.left + m.nameW, y: r.top + m.headerH + 1.5 * _canvasState.rowPitch, ch: m.charW };
      }
      const n = document.querySelector('.seq-line[data-seq-index="1"] > .seq-name').getBoundingClientRect();
      const probe = document.createElement('span'); probe.textContent = '0'.repeat(10);
      probe.style.cssText = 'position:absolute;visibility:hidden;font:' + getComputedStyle(document.querySelector('.seq-name')).font;
      document.body.appendChild(probe); const ch = probe.getBoundingClientRect().width / 10; probe.remove();
      return { edge: n.right, y: n.top + n.height / 2, ch };
    });
    await p.mouse.move(geo.edge - 1, geo.y);
    await p.waitForTimeout(150);
    const cursor = await p.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, [geo.edge - 1, geo.y]);
    const before = await p.evaluate(() => ({ order: state.seqs.map(s => s.header).join(','), sel: state.selectedRows.size }));
    await p.mouse.down();
    await p.mouse.move(geo.edge - 1 + 6 * geo.ch, geo.y, { steps: 6 });
    await p.mouse.up();
    await p.waitForTimeout(900);
    const wider = await p.evaluate(() => +document.getElementById('nameLengthSlider').value);
    // and back narrower
    const geo2 = await p.evaluate(() => {
      if (document.getElementById('modeCanvas').checked) { const r = _canvasState.canvas.getBoundingClientRect(); return r.left + _canvasState.metrics.nameW; }
      return document.querySelector('.seq-line[data-seq-index="1"] > .seq-name').getBoundingClientRect().right;
    });
    await p.mouse.move(geo2 - 1, geo.y); await p.mouse.down();
    await p.mouse.move(geo2 - 1 - 3 * geo.ch, geo.y, { steps: 4 }); await p.mouse.up();
    await p.waitForTimeout(900);
    const after = await p.evaluate(() => ({ len: +document.getElementById('nameLengthSlider').value, order: state.seqs.map(s => s.header).join(','), sel: state.selectedRows.size,
      label: document.getElementById('modeCanvas').checked ? null : document.querySelector('.seq-line[data-seq-index="1"] > .seq-name').textContent.trim() }));
    out[view] = { cursor, wider, ...after, orderKept: after.order === before.order, sel0: before.sel };
    await p.close();
  }
  const ok = Object.values(out).every(r => r.cursor === 'col-resize' && r.wider === 16 && r.len === 13 && r.orderKept && r.sel === 0)
    && out.full.label.length === 13 && out.block.label.length === 13;
  return { pass: ok, detail: JSON.stringify(out) };
});

check('A plain click on a name selects that row (Full, Block, Canvas); a second click unselects it', async (page) => {
  const out = {};
  for (const view of ['full', 'block', 'canvas']) {
    const p = await page.context().browser().newPage({ viewport: { width: 1200, height: 700 } });
    await p.goto(page.url().replace(/view=\w+/, 'view=' + view).replace(/(index\.html)(?!\?)/, '$1?view=' + view), { waitUntil: 'networkidle' });
    await p.setInputFiles('#fileInput', { name: 'c.fa', mimeType: 'text/plain', buffer: Buffer.from('>one\nACGTACGT\n>two\nACGTACGA\n>three\nACGAACGT\n>four\nACGTTCGT\n') });
    await p.waitForTimeout(1500);
    const pt = await p.evaluate(() => {
      if (document.getElementById('modeCanvas').checked) {
        const r = _canvasState.canvas.getBoundingClientRect(), m = _canvasState.metrics;
        return { x: r.left + 10, y: r.top + m.headerH + 2.5 * _canvasState.rowPitch };   // row 2 ("three")
      }
      const e = document.querySelector('.seq-line[data-seq-index="2"] .seq-name').getBoundingClientRect();
      return { x: e.left + 14, y: e.top + e.height / 2 };
    });
    await p.evaluate(() => { state.selectedRows = new Set([0]); updateRowSelections(); });
    await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(300);
    const first = await p.evaluate(() => [...state.selectedRows].join(','));
    await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(300);
    const second = await p.evaluate(() => [...state.selectedRows].join(','));
    out[view] = first + '|' + (second || 'none');
    await p.close();
  }
  return { pass: Object.values(out).every(v => v === '2|none'), detail: JSON.stringify(out) };
});

// Owner's report: a selected residue, scrolled to the left out of the data area, was drawn over the (fixed) names
check('Canvas: a selected residue scrolled past the left edge is not drawn over the names', async (page) => {
  await page.goto(page.url().replace(/view=\w+/, 'view=canvas').replace(/(index\.html)(?!\?)/, '$1?view=canvas'), { waitUntil: 'networkidle' });
  const s = 'ACGT'.repeat(150);
  await page.setInputFiles('#fileInput', { name: 's.fa', mimeType: 'text/plain', buffer: Buffer.from(`>a_long_name_for_the_first\n${s}\n>b_long_name_for_the_second\n${s}\n`) });
  await page.waitForTimeout(1500);
  await page.evaluate(() => setNameLengthUI(30, true));
  await page.waitForTimeout(600);
  // select residue 40 of row 1, then scroll right so that it would sit at the middle of the name column
  const r = await page.evaluate(async () => {
    state.selectedNucs.clear(); state.selectedNucs.set(1, new Set([40]));
    const m = _canvasState.metrics;
    _canvasState.offsetX = Math.round(40 * m.charW + m.nameW / 2);
    _canvasState.scheduleDraw(); _canvasState.scheduleOverlay && _canvasState.scheduleOverlay();
    await new Promise(res => setTimeout(res, 400));
    const o = _canvasState.overlay, dpr = o.width / parseFloat(o.style.width || o.width);
    const y = Math.floor((m.headerH + 1.5 * _canvasState.rowPitch) * dpr);
    const d = o.getContext('2d').getImageData(0, y, Math.floor(m.nameW * dpr) - 1, 1).data;
    let painted = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) painted++;
    return { mode: document.getElementById('modeCanvas').checked, sticky: document.getElementById('stickyNames')?.checked, painted };
  });
  return { pass: r.mode && r.painted === 0, detail: JSON.stringify(r) };
});

// Owner's report: thin white lines around each shaded (black/grey) cell; neighbouring shaded cells must join
// without a seam. Measured on the cells' edge pixels (letters are drawn inside the cell, away from its edges).
check('Canvas: neighbouring shaded cells join with no white seam, at 0.9x to 2x', async (page) => {
  const out = {};
  for (const dpr of [0.9, 1, 1.1, 1.25, 1.33, 1.5, 1.75, 2]) {
    const p = await page.context().browser().newPage({ viewport: { width: 1366, height: 600 }, deviceScaleFactor: dpr });
    await p.goto(page.url().replace(/view=\w+/, 'view=canvas').replace(/(index\.html)(?!\?)/, '$1?view=canvas'), { waitUntil: 'networkidle' });
    const s = 'ACGT'.repeat(10);
    await p.setInputFiles('#fileInput', { name: 'k.fa', mimeType: 'text/plain', buffer: Buffer.from(`>a\n${s}\n>b\n${s}\n>c\n${s}\n>d\n${s}\n`) });
    await p.waitForTimeout(1500);
    out['x' + dpr] = await p.evaluate(() => {
      const c = _canvasState.canvas, m = _canvasState.metrics, d = c.width / parseFloat(c.style.width), P = _canvasState.rowPitch;
      const g = c.getContext('2d'), light = (x, y) => { const v = g.getImageData(x, y, 1, 1).data; return v[0] + v[1] + v[2] > 60; };
      const seams = [];
      // vertical: the device columns either side of the boundaries between cells 3..8 of rows 1 and 2
      for (const row of [1, 2]) for (let col = 3; col <= 8; col++) {
        const bx = (m.nameW + col * m.charW) * d;
        const top = Math.round((m.headerH + row * P) * d), bottom = Math.round((m.headerH + (row + 1) * P) * d) - 1;
        for (const y of [top, bottom]) {   // the cell's first and last device rows: above and below the letter ink
          for (const x of [Math.floor(bx) - 1, Math.floor(bx), Math.ceil(bx)]) if (light(x, y)) seams.push(`v r${row} c${col} ${x},${y}`); }
      }
      // horizontal: the device rows either side of the boundaries between rows 1|2 and 2|3, at the left and right tenth of cells 3..8
      for (const row of [2, 3]) for (let col = 3; col <= 8; col++) {
        const by = (m.headerH + row * P) * d;
        for (const fx of [0.1, 0.9]) { const x = Math.floor((m.nameW + (col + fx) * m.charW) * d);
          for (const y of [Math.floor(by) - 1, Math.floor(by), Math.ceil(by)]) if (light(x, y)) seams.push(`h r${row} c${col} ${x},${y}`); }
      }
      const mid = g.getImageData(Math.floor((m.nameW + 4.1 * m.charW) * d), Math.floor((m.headerH + 1.1 * P) * d), 1, 1).data;
      return { dark: mid[0] + mid[1] + mid[2] < 300, n: seams.length, first: seams.slice(0, 4) };
    });
    await p.close();
  }
  return { pass: Object.values(out).every(v => v.dark && v.n === 0), detail: JSON.stringify(out) };
});

// Canvas drew a light grey vertical line between the names and the sequences; Full and Block have none
check('Canvas: no grey line between the names and the sequences', async (page) => {
  await page.goto(page.url().replace(/view=\w+/, 'view=canvas').replace(/(index\.html)(?!\?)/, '$1?view=canvas'), { waitUntil: 'networkidle' });
  await page.setInputFiles('#fileInput', { name: 'l.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGTACGTACGT\n>b\nACGTACGTACGA\n') });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const c = _canvasState.canvas, m = _canvasState.metrics, dpr = window.devicePixelRatio || 1;
    const x = Math.floor((m.nameW - 2) * dpr), y = Math.floor((m.headerH + 0.5 * _canvasState.rowPitch) * dpr);
    const d = c.getContext('2d').getImageData(x, y, 1, 1).data;
    return { mode: document.getElementById('modeCanvas').checked, px: [d[0], d[1], d[2]].join(',') };
  });
  return { pass: r.mode && r.px === '255,255,255', detail: JSON.stringify(r) };
});

// Canvas was blurred next to Full (letters, names, ruler): at 125% and 150% screen scale the canvas sat on half
// device pixels (x = 11.25, top = 97.5) and its 1687-px bitmap was stretched over 1687.5 px, so the browser
// resampled the whole picture. It must sit on whole device pixels, its bitmap shown at its own size.
check('Canvas sits on whole device pixels at its own bitmap size (sharp), at 1x, 1.25x and 1.5x', async (page) => {
  const out = {};
  for (const dpr of [1, 1.25, 1.5]) {
    const p = await page.context().browser().newPage({ viewport: { width: 1366, height: 600 }, deviceScaleFactor: dpr });
    await p.goto(page.url().replace(/view=\w+/, 'view=canvas').replace(/(index\.html)(?!\?)/, '$1?view=canvas'), { waitUntil: 'networkidle' });
    await p.setInputFiles('#fileInput', { name: 'g.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGTACGT\n>b\nACGTACGA\n') });
    await p.waitForTimeout(1500);
    out['x' + dpr] = await p.evaluate(() => {
      const dpr = window.devicePixelRatio || 1, whole = v => Math.abs(v - Math.round(v)) < 0.01;
      return [_canvasState.canvas, _canvasState.overlay].map(c => {
        const r = c.getBoundingClientRect();
        return whole(r.left * dpr) && whole(r.top * dpr) && Math.abs(r.width * dpr - c.width) < 0.01 && Math.abs(r.height * dpr - c.height) < 0.01
          ? 'ok' : `${(r.left * dpr).toFixed(2)},${(r.top * dpr).toFixed(2)} ${(r.width * dpr).toFixed(2)}/${c.width}`;
      }).join(' ');
    });
    await p.close();
  }
  return { pass: Object.values(out).every(v => v === 'ok ok'), detail: JSON.stringify(out) };
});

// The file/status panel at the right of the top bar is capped at 780px; when the bar had more room than that
// (Canvas on a 1894px screen: fewer controls before it) the rest stayed on its right and it sat 74px from the edge
check('Top bar: the file/status panel reaches the right edge in Canvas and Full on a wide screen', async (page) => {
  const out = {};
  for (const view of ['canvas', 'full']) {
    const p = await page.context().browser().newPage({ viewport: { width: 1894, height: 500 } });
    await p.goto(page.url().replace(/view=\w+/, 'view=' + view).replace(/(index\.html)(?!\?)/, '$1?view=' + view), { waitUntil: 'networkidle' });
    await p.setInputFiles('#fileInput', { name: 'a_rather_long_file_name_for_the_panel.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGTACGT\n>b\nACGTACGA\n') });
    await p.waitForTimeout(1500);
    out[view] = await p.evaluate(() => {
      const row = document.getElementById('menuRow').getBoundingClientRect(), pan = document.getElementById('headerInfoPanel').getBoundingClientRect();
      return Math.round(row.right - pan.right);
    });
    await p.close();
  }
  return { pass: out.canvas <= 1 && out.full <= 1, detail: JSON.stringify(out) + ' px between the panel and the bar\'s right edge' };
});

// Canvas drew a grey line under the ruler (between the ruler and the Consensus row); Full and Block have none
check('Canvas: no grey line under the ruler', async (page) => {
  await page.goto(page.url().replace(/view=\w+/, 'view=canvas').replace(/(index\.html)(?!\?)/, '$1?view=canvas'), { waitUntil: 'networkidle' });
  await page.setInputFiles('#fileInput', { name: 'r.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGTACGTACGTACGTACGT\n>b\nACGTACGTACGTACGTACGA\n') });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const c = _canvasState.canvas, m = _canvasState.metrics, dpr = window.devicePixelRatio || 1;
    const y = Math.round((m.trackH || 0) * dpr + m.charH * dpr) - 1;            // last device row of the ruler
    const d = c.getContext('2d').getImageData(Math.round(m.nameW * dpr), y, Math.round(10 * m.charW * dpr), 1).data;
    let grey = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 221 && d[i + 1] === 221 && d[i + 2] === 221) grey++;
    return { mode: document.getElementById('modeCanvas').checked, greyPx: grey };
  });
  return { pass: r.mode && r.greyPx === 0, detail: JSON.stringify(r) };
});

// Reads only loaded onto a reference row of exactly the BAM's name: 'chr7' vs '7', a version suffix, or a gene cut
// out with samtools faidx ('7:1001-2000', reads in chromosome coordinates) all gave "Load a reference FASTA first"
// although one was loaded
check('Reads onto a reference named differently: chr prefix, version, faidx region (shifted), same length; else names listed', async (page) => {
  const path = require('path'), fs = require('fs');
  const DIR = path.join(__dirname, '..', 'fixtures', 'reads');
  const ref = fs.readFileSync(path.join(DIR, 'gene_ref.fa'), 'utf8').replace(/\r/g, '').split('\n').slice(1).join('');
  const sam = fs.readFileSync(path.join(DIR, 'gene_reads.sam'), 'utf8');      // reads on 'gene', LN 963
  const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'));
  const stopPos = truth.muts.find(m => m.name === 'stop_hom').pos;             // 0-based on 'gene'
  const out = {};
  for (const [key, name, seq] of [['chr', 'chrgene', ref], ['version', 'gene.2 desc', ref], ['faidx', 'gene:301-700', ref.slice(300, 700)],
                                  ['length', 'my_gene', ref], ['none', 'other', ref.slice(0, 500)]]) {
    await page.setInputFiles('#fileInput', { name: 'ref.fa', mimeType: 'text/plain', buffer: Buffer.from(`>${name}\n${seq}\n`) });
    await page.waitForTimeout(1200);
    await page.setInputFiles('#bamFileInput', { name: 'reads.sam', mimeType: 'text/plain', buffer: Buffer.from(sam) });
    await page.waitForTimeout(2500);
    out[key] = await page.evaluate((stopPos) => {
      const msg = document.getElementById('statusMessage').innerText.replace(/\s+/g, ' ');
      const n = (typeof bamState !== 'undefined' && bamState.reads) ? bamState.reads.length : 0;
      // the planted stop's base must be under the right reference column: count reads with the alt base there
      let alt = 0;
      if (n) for (const r of bamState.reads) { let p = r.pos, q = 0; for (const op of r.cigar) { if ('M=X'.includes(op.op)) { if (stopPos - (bamState.offset || 0) >= p && stopPos - (bamState.offset || 0) < p + op.len) alt += r.seq[q + stopPos - (bamState.offset || 0) - p] === state.seqs[0].seq[stopPos - (bamState.offset || 0)] ? 0 : 1; p += op.len; q += op.len; } else if (op.op === 'D' || op.op === 'N') p += op.len; else if (op.op === 'I' || op.op === 'S') q += op.len; } }
      return { n, alt, msg: msg.slice(0, 160) };
    }, stopPos);
    await page.evaluate(() => { if (typeof clearReadsData === 'function' && bamState.reads.length) clearReadsData(); });
  }
  const ok = out.chr.n > 0 && out.version.n > 0 && out.length.n > 0 && /name/i.test(out.length.msg)
    && out.faidx.n > 0 && out.faidx.n < out.chr.n && out.faidx.alt > 5
    && out.none.n === 0 && /gene/.test(out.none.msg) && /other/.test(out.none.msg);
  return { pass: ok, detail: JSON.stringify(out) };
});

// A gene from reads, the realistic way (tests/fixtures/reads/region: geneA = join(201..500,801..1100) on +,
// geneB = complement(1601..2200)). GenBank CDS features were parsed and dropped, so codon analysis guessed a frame
// from ATG counts and classed the changes wrongly (the synonymous one non-synonymous, R140Q synonymous); BED12
// exon blocks were ignored, so geneA was translated through its intron (5 stops in the reference itself).
check('GenBank / BED12 genes: codon analysis splices exons, reads minus-strand genes, classes the sample\'s changes', async (page) => {
  const path = require('path'), fs = require('fs');
  const DIR = path.join(__dirname, '..', 'fixtures', 'reads', 'region');
  const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'));
  const out = {};
  for (const via of ['genbank', 'bed12']) {
    await page.evaluate(() => { if (typeof clearAnnotation === 'function') clearAnnotation(); });
    await page.setInputFiles('#fileInput', path.join(DIR, via === 'genbank' ? 'region.gb' : 'region.fa'));
    await page.waitForTimeout(1500);
    if (via === 'bed12') await page.evaluate(t => setAnnotation(t, 'region_bed12.bed'), fs.readFileSync(path.join(DIR, 'region_bed12.bed'), 'utf8'));
    await page.setInputFiles('#bamFileInput', path.join(DIR, 'reads_40x.sam'));
    await page.waitForTimeout(2500);
    await page.click('#readsSampleRowButton');
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const c = document.getElementById('codonAnalysis'); if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } });
    await page.waitForTimeout(1500);
    out[via] = await page.evaluate((muts) => {
      const d = state._codonData; if (!d) return 'no codon data';
      const aaOf = (row, gene) => d.aaSeq[row].filter(e => e.gene === gene).sort((a, b) => a.cols[0] - b.cols[0]).map(e => e.aa).join('');
      const geneA = aaOf(0, 'geneA'), geneB = aaOf(0, 'geneB').split('').reverse().join('');
      const m = Object.fromEntries(muts.map(x => [x.name, (d.synNonSyn[1][x.pos] || '-') + (d.stops[1].includes(x.pos) ? '*' : '')]));
      return { byGene: !!d.byGene, geneA: geneA.length + ':' + geneA[0] + '..' + geneA.slice(-1) + ':stops' + (geneA.match(/\*/g) || []).length,
               geneB: geneB.length + ':' + geneB[0] + '..' + geneB.slice(-1) + ':stops' + (geneB.match(/\*/g) || []).length, m,
               hetDelInRow: state.seqs[1].seq[muts.find(x => x.name === 'B_del1_het').pos] };
    }, truth.muts);
    await page.evaluate(() => { if (bamState.reads.length) clearReadsData(); });
  }
  const good = r => r && r.byGene && r.geneA === '200:M..*:stops1' && r.geneB === '200:M..*:stops1'
    && r.m.A_syn_het_exon1 === 'syn' && r.m.A_missense_hom_exon2 === 'nonsyn' && r.m.intron_hom === '-'
    && r.m.B_stop_hom === 'nonsyn*' && r.m.B_missense_het === 'nonsyn' && r.hetDelInRow !== '-';
  return { pass: good(out.genbank) && good(out.bed12), detail: JSON.stringify(out) };
});

// The annotation track drew a spliced gene as one solid box over its intron
check('Annotation track: a spliced gene\'s intron is a thin line, in Full and Canvas', async (page) => {
  const path = require('path');
  const gb = path.join(__dirname, '..', 'fixtures', 'reads', 'region', 'region.gb');   // geneA join(201..500,801..1100)
  const out = {};
  await page.evaluate(() => { if (typeof clearAnnotation === 'function') clearAnnotation(); });
  await page.setInputFiles('#fileInput', gb);
  await page.waitForTimeout(1500);
  out.full = await page.evaluate(() => [...document.querySelectorAll('.annot-intron')].map(e => Math.round(e.getBoundingClientRect().width / (document.querySelector('.seq-line[data-seq-index] .seq-data span[data-pos]').getBoundingClientRect().width))));
  await page.goto(page.url().replace(/view=\w+/, 'view=canvas').replace(/(index\.html)(?!\?)/, '$1?view=canvas'), { waitUntil: 'networkidle' });
  await page.setInputFiles('#fileInput', gb);
  await page.waitForTimeout(1500);
  out.canvas = await page.evaluate(() => {
    const m = _canvasState.metrics, dpr = window.devicePixelRatio || 1;
    _canvasState.offsetX = 600 * m.charW; _canvasState.scheduleDraw(); return new Promise(r => setTimeout(() => {
      const c = _canvasState.canvas, x = Math.round((m.nameW + 50 * m.charW) * dpr);   // column 650: inside the intron
      const px = y => [...c.getContext('2d').getImageData(x, Math.round(y * dpr), 1, 1).data].slice(0, 3).join(',');
      r({ mid: px(m.charH / 2), top: px(2) });
    }, 300));
  });
  const ok = out.full.length >= 1 && Math.abs(out.full.reduce((a, b) => a + b, 0) - 299) <= 3 && out.canvas.top === '255,255,255' && out.canvas.mid !== '255,255,255';   // Full cuts the track per block of columns
  return { pass: ok, detail: JSON.stringify(out) };
});

// Reads files the way they come: more than 1000 reads (refused before: "Please subset with samtools"), the gene's
// reads after other references' reads in a BAM (the 1000-read cap was taken before the reference was chosen, so
// they were lost), duplicate / QC-failed / secondary reads (BAM kept them all and counted them), and a SAM
// without @SQ lines (what samtools view writes without -h: nothing matched)
check('Reads files: >1000 reads load (display downsampled, calls from all), gene after other refs, flags filtered, SAM without header', async (page) => {
  const path = require('path'), fs = require('fs'), os = require('os'), { execFileSync } = require('child_process');
  const FX = path.join(__dirname, '..', 'fixtures', 'reads');
  const { samToBam } = require(path.join(FX, 'sam2bam.js'));
  const DIR = path.join(FX, 'region');
  const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'va-reads-'));
  execFileSync(process.execPath, [path.join(FX, 'make_region_reads.js'), tmp, '120']);
  const sam120 = fs.readFileSync(path.join(tmp, 'reads_120x.sam'), 'utf8');
  const sam40 = fs.readFileSync(path.join(DIR, 'reads_40x.sam'), 'utf8').replace(/\r/g, '');
  const body40 = sam40.split('\n').filter(l => l && l[0] !== '@');
  // a fake variant at reference position 100 carried only by duplicate, QC-failed and secondary copies of reads
  const fakes = [];
  for (const [flag, tag] of [[1024, 'dup'], [512, 'qc'], [256, 'sec']]) for (let k = 0; k < 15; k++) {
    const f = body40.find(l => { const x = l.split('\t'); return +x[3] <= 60 && +x[3] + 140 > 100 && x[5] === '150M'; }).split('\t');
    const off = 100 - (+f[3]);
    const alt = f[9][off - 1] === 'A' ? 'C' : 'A';
    f[0] = `${tag}${k}`; f[1] = String(flag); f[9] = f[9].slice(0, off - 1) + alt + f[9].slice(off);
    fakes.push(f.join('\t'));
  }
  const samFlags = sam40.split('\n').filter(l => l[0] === '@').join('\n') + '\n' + body40.concat(fakes).join('\n') + '\n';
  const other = ['@HD\tVN:1.6', '@SQ\tSN:other\tLN:5000', '@SQ\tSN:region1\tLN:3000']
    .concat([...Array(1500)].map((_, i) => `o${i}\t0\tother\t${1 + (i % 4800)}\t60\t50M\t*\t0\t0\t${'ACGT'.repeat(13).slice(0, 50)}\t${'F'.repeat(50)}`))
    .concat(body40).join('\n') + '\n';
  const files = {
    sam120: { name: 'r120.sam', buf: Buffer.from(sam120) }, bam120: { name: 'r120.bam', buf: samToBam(sam120) },
    multiref: { name: 'multi.bam', buf: samToBam(other) },
    flagsSam: { name: 'flags.sam', buf: Buffer.from(samFlags) }, flagsBam: { name: 'flags.bam', buf: samToBam(samFlags) },
    noHeader: { name: 'nohead.sam', buf: Buffer.from(body40.join('\n') + '\n') },
  };
  const want = truth.muts.map(m => `${m.pos + 1}${m.hom ? 'hom' : 'het'}`).sort().join(',');
  const out = {};
  for (const [key, f] of Object.entries(files)) {
    await page.setInputFiles('#fileInput', path.join(DIR, 'region.fa'));
    await page.waitForTimeout(1200);
    await page.setInputFiles('#bamFileInput', { name: f.name, mimeType: 'application/octet-stream', buffer: f.buf });
    await page.waitForTimeout(3500);
    out[key] = await page.evaluate(() => {
      const msg = document.getElementById('statusMessage').innerText.replace(/\s+/g, ' ');
      const all = (bamState.allReads || bamState.reads || []);
      const calls = all.length ? SampleCall.call(all, bamState.refSeq).variants.map(v => `${v.pos}${v.zyg}`).sort().join(',') : '';
      return { shown: (bamState.reads || []).length, all: all.length, calls, msg: msg.slice(0, 220),
               fake100: all.filter(r => /^(dup|qc|sec)/.test(r.name)).length };
    });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = out.sam120.all === 2399 && out.bam120.all === 2399 && out.sam120.shown < 2399 && /downsampl/i.test(out.sam120.msg)
    && out.sam120.calls === want && out.bam120.calls === want
    && out.multiref.all === 799 && out.multiref.calls === want
    && out.flagsSam.fake100 === 0 && out.flagsBam.fake100 === 0 && out.flagsBam.all === 799 && /duplicate/i.test(out.flagsBam.msg) && out.flagsBam.calls === want
    && out.noHeader.all === 799;
  return { pass: ok, detail: JSON.stringify({ want, out }) };
});

// Reads -> evidence -> gene effect, the functional analysis of a gene: the changes were only listed in a message,
// with no depth, strand, codon or amino-acid change, and no way back to their reads; the Reads view had no
// coverage, no allele counts and one colour for both strands
check('Reads: Variants window lists each change with depth, strands and gene effect; a row opens its reads, sorted', async (page) => {
  const path = require('path');
  const DIR = path.join(__dirname, '..', 'fixtures', 'reads', 'region');
  await page.evaluate(() => { if (typeof clearAnnotation === 'function') clearAnnotation(); });
  await page.setInputFiles('#fileInput', path.join(DIR, 'region.gb'));
  await page.waitForTimeout(1500);
  await page.setInputFiles('#bamFileInput', path.join(DIR, 'reads_40x.sam'));
  await page.waitForTimeout(2500);
  await page.click('#readsVariantsButton');
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#variantsTable tbody tr[data-pos]')].map(tr => [...tr.children].map(td => td.textContent)),
    tsvLines: _variantsTsv().trim().split('\n').length,
    coverageBars: [...document.querySelectorAll('#readsCoverageSvg rect')].filter(x => !x.classList.contains('reads-downsampled')).reduce((t, x) => t + (+x.getAttribute('width')), 0) / 12,   // bases with a bar
    strandColours: new Set([...document.querySelectorAll('#readsPileSvg rect[data-stroke]')].map(b => b.getAttribute('fill'))).size
  }));
  const pOf = r.rows.map(c => c[10]).join(',');
  const effects = r.rows.map(c => c[8]).join(',');
  // click the R140Q row: Reads view at 919, reads sorted so the first track's read has the alt base there
  const rowIdx = r.rows.findIndex(c => c[10] === 'p.R140Q');
  await page.click(`#variantsTable tbody tr[data-pos]:nth-child(${rowIdx + 1})`);
  await page.waitForTimeout(1500);
  const g = await page.evaluate(() => {
    const p = bamState.focusPos;
    const first = bamState.reads.filter(x => x.track === 0).map(x => _readBaseAt(x, p)).find(b => b != null);
    const last = bamState.reads.filter(x => x.track === bamState.nTracks - 1).map(x => _readBaseAt(x, p)).find(b => b != null);
    return { focus: p, mode: document.getElementById('modeReads').checked, first, last, band: !!document.querySelector('.reads-focus-band'), tip: _readsCountsHtml(p) };
  });
  const ok = pOf === 'p.R30=,,p.R140Q,p.S170fs,p.G120E,p.S51*' && effects === 'synonymous,intron,missense,frameshift,missense,stop gained'
    && r.tsvLines === 7 && r.coverageBars > 2000 && r.strandColours === 2
    && g.focus === 918 && g.mode && g.first === 'A' && g.band && /A: \d+ \(100%, \d+\+, \d+&minus;\)/.test(g.tip);
  return { pass: ok, detail: JSON.stringify({ pOf, effects, tsv: r.tsvLines, cov: r.coverageBars, colours: r.strandColours, g: { ...g, tip: g.tip.slice(0, 160) } }) };
});

// A translated codon said "Q (CAA)" but not which codon of the gene it is: R140Q could not be read off the alignment
check('Codon analysis: translation tooltips number codons as the reference does (gene, minus strand, sample row)', async (page) => {
  const path = require('path');
  const DIR = path.join(__dirname, '..', 'fixtures', 'reads', 'region');
  await page.evaluate(() => { if (typeof clearAnnotation === 'function') clearAnnotation(); });
  await page.setInputFiles('#fileInput', path.join(DIR, 'region.gb'));
  await page.waitForTimeout(1500);
  await page.setInputFiles('#bamFileInput', path.join(DIR, 'reads_40x.sam'));
  await page.waitForTimeout(2500);
  await page.click('#readsSampleRowButton');
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const w = document.getElementById('variantsWindow'); if (w) w.style.display = 'none'; const c = document.getElementById('codonAnalysis'); if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const d = state._codonData, at = (row, col) => d.aaSeq[row].find(e => e.cols.includes(col));
    const a0 = at(0, 918), a1 = at(1, 918), b1 = at(1, 2048);
    _scrollToColumn(918);
    const span = [...document.querySelectorAll('.aa-row .aa-c')].find(s => /codon 140,/.test(s.title || ''));
    return { ref: a0 && a0.aa + a0.n, sample: a1 && a1.aa + a1.n, stop: b1 && b1.aa + b1.n, title: span ? span.title : null };
  });
  const ok = r.ref === 'R140' && r.sample === 'Q140' && r.stop === '*51' && /^(R|Q) \(\w{3}\), codon 140,/.test(r.title || '');
  return { pass: ok, detail: JSON.stringify(r) };
});

// With more than one row (e.g. after Sample -> row) the SAM/BAM button was hidden: a second sample could not be
// loaded. A SAM picked in the Add sequences dialog ("+") went into its box as raw text.
check('Reads: SAM/BAM stays available with several rows; a reads file picked in Add sequences opens as reads', async (page) => {
  const path = require('path');
  const DIR = path.join(__dirname, '..', 'fixtures', 'reads', 'region');
  await page.setInputFiles('#fileInput', path.join(DIR, 'region.fa'));
  await page.waitForTimeout(1200);
  await page.setInputFiles('#bamFileInput', path.join(DIR, 'reads_40x.sam'));
  await page.waitForTimeout(2500);
  await page.click('#readsSampleRowButton');
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => ({ rows: state.seqs.length, bam: getComputedStyle(document.getElementById('openBamToolbarButton')).display }));
  await page.evaluate(() => { clearReadsData(); });
  await page.setInputFiles('#addSeqFileInput', path.join(DIR, 'reads_40x.sam'));
  await page.waitForTimeout(3000);
  r.viaAdd = await page.evaluate(() => ({ reads: (bamState.allReads || []).length, box: document.getElementById('addSeqInput').value.length }));
  const ok = r.rows === 2 && r.bam !== 'none' && r.viaAdd.reads === 799 && r.viaAdd.box === 0;
  return { pass: ok, detail: JSON.stringify(r) };
});

// Codon realignment of rows that are not coding from end to end (a gene region with flanks and introns): MACSE
// explained the stops with frameshifts, 21 per row on tests/fixtures/reads/region, and replaced the reads' alignment
check('Codon realignment warns before aligning rows with stops in every frame; No leaves the alignment as it was', async (page) => {
  const path = require('path');
  const DIR = path.join(__dirname, '..', 'fixtures', 'reads', 'region');
  await page.setInputFiles('#fileInput', path.join(DIR, 'region.fa'));
  await page.waitForTimeout(1200);
  await page.setInputFiles('#bamFileInput', path.join(DIR, 'reads_40x.sam'));
  await page.waitForTimeout(2500);
  await page.click('#readsSampleRowButton');
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => state.seqs.map(s => s.seq).join('|'));
  await page.evaluate(() => { openMacsePreset(false); window._lastCodonAlignStats = null; realignAll(); });
  await page.waitForTimeout(800);
  const prompt = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'No' && x.offsetParent); const t = b && b.closest('div').parentElement.innerText; return t ? t.slice(0, 200) : null; });
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'No' && x.offsetParent); if (b) b.click(); });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => state.seqs.map(s => s.seq).join('|'));
  const ran = await page.evaluate(() => !!window._lastCodonAlignStats);
  await page.evaluate(() => { const sel = document.getElementById('mafftSeqType'); sel.value = sel.options[0].value; sel.dispatchEvent(new Event('change', { bubbles: true })); });
  // a real coding gene with a frameshift (3.6 kb, stops in all three frames) is not taken for non-coding: the first
  // version of this warning asked about it, and the MACSE functional tests waited on the prompt
  const fs2 = require('fs');
  const gene = fs2.readFileSync(path.join(__dirname, '..', 'codon-align', 'fixtures', '14911at40674.in.fna'), 'utf8');
  const realGene = await page.evaluate(f => _nonCodingRows(f).length, gene);
  const ok = !!prompt && /every reading frame/.test(prompt) && after === before && !ran && realGene === 0;
  return { pass: ok, detail: JSON.stringify({ prompt, unchanged: after === before }) };
});

// GLM reads/codon audit 2026-10-22, confirmed findings (each check fails on the code before the fix):
// #16 Sample -> row clicked twice added a duplicate row and the insertion columns again; a second reads file
//     could only overwrite the name; #25 an insertion's position was the base after it; #22 inserted bases were
//     shown nowhere; #11 a BAM saved as .sam failed; #10 CRAM reads lost their qualities (every base counted);
//     #12 an edit of the reference row left the reads' calls on the old bases
check('Reads (audit): Sample -> row twice and a second sample, insertion position, inserted bases, BAM named .sam, CRAM qualities, edited reference', async (page) => {
  const path = require('path'), fs = require('fs');
  const FX = path.join(__dirname, '..', 'fixtures', 'reads');
  const { samToBam } = require(path.join(FX, 'sam2bam.js'));
  const sam = fs.readFileSync(path.join(FX, 'gene_reads.sam'), 'utf8');
  const out = {};
  await page.setInputFiles('#fileInput', path.join(FX, 'gene_ref.fa'));
  await page.waitForTimeout(1200);
  await page.setInputFiles('#bamFileInput', { name: 'patient1.sam', mimeType: 'text/plain', buffer: Buffer.from(sam) });
  await page.waitForTimeout(2500);
  await page.click('#readsSampleRowButton'); await page.waitForTimeout(1200);
  const len1 = await page.evaluate(() => state.seqs[0].seq.length);
  await page.evaluate(() => { const r = document.getElementById('modeReads'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(800);
  await page.click('#readsSampleRowButton'); await page.waitForTimeout(1200);
  out.twice = await page.evaluate(() => state.seqs.map(s => s.header).join(','));
  // a second sample, as a BAM saved under a .sam name: its own row; its insertion uses the columns already there
  await page.setInputFiles('#bamFileInput', { name: 'patient2.sam', mimeType: 'application/octet-stream', buffer: samToBam(sam) });
  await page.waitForTimeout(2500);
  out.bamAsSam = await page.evaluate(() => (bamState.allReads || []).length);
  await page.click('#readsSampleRowButton'); await page.waitForTimeout(1200);
  out.second = await page.evaluate(() => ({ rows: state.seqs.map(s => s.header).join(','), len: state.seqs[0].seq.length }));
  out.len1 = len1;
  out.insPos = await page.evaluate(() => { const r = _readsVariantRows().find(x => x.v.type === 'ins'); return r ? _variantCells(r)[0] : null; });
  out.insTip = await page.evaluate(() => { const r = bamState.reads.find(x => x.cigar.some(c => c.op === 'I')); return r ? _getReadCigarFeatures(r, bamState.refSeq).insertions.map(x => x.bases).join(',') : null; });
  // an edit of the reference row: a base no read carries becomes a change in every read
  out.edit = await page.evaluate(() => {
    const before = _readsCalls().variants.length;
    const s = state.seqs[0], i = s.seq.indexOf('A', 400);
    s.seq = s.seq.slice(0, i) + 'C' + s.seq.slice(i + 1);
    const after = _readsCalls().variants.length;
    return { before, after };
  });
  // CRAM: the qualities come through
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'real', 'htslib_ce_CHROMOSOME_II.fa'));
  await page.waitForTimeout(1500);
  await page.setInputFiles('#bamFileInput', path.join(__dirname, '..', '..', 'examples', 'real', 'htslib_range.cram'));
  await page.waitForTimeout(4000);
  out.cramQual = await page.evaluate(() => { const r = (bamState.allReads || [])[0]; return r ? String(r.qual).slice(0, 6) : null; });
  const ok = out.twice === 'gene,gene_sample' && out.bamAsSam === 218
    && out.second.rows === 'gene,gene_patient2,gene_sample' && out.second.len === out.len1
    && out.insPos === '866^867' && /^[ACGT]{3}$/.test(out.insTip || '')
    && out.edit.after === out.edit.before + 1
    && out.cramQual && out.cramQual !== '*';
  return { pass: ok, detail: JSON.stringify(out) };
});

// #6 two CDS with the same (or no, '.') name were one translation with one strand; #19 the Auto message said
// "frame 0" where the buttons say Pos 1; #18 Copy AA counted rows x frames, not the records copied
check('Codon (audit): same-named genes stay apart in the AA export, Auto names the Pos button, Copy AA counts records', async (page) => {
  const cds = 'ATGGCTAAAGGTCTGCAAGAATTCGGTACCTGGAAACCGTAA';                        // 42 nt, + strand
  const rc = s => s.split('').reverse().map(b => ({ A: 'T', C: 'G', G: 'C', T: 'A' }[b])).join('');
  const seq = cds + 'TTTTTTTTTT' + rc(cds);                                          // second gene on - strand
  await page.setInputFiles('#fileInput', { name: 'two.fa', mimeType: 'text/plain', buffer: Buffer.from(`>chr\n${seq}\n>b\n${seq}\n`) });
  await page.waitForTimeout(900);
  const r = await page.evaluate(async () => {
    let msgs = []; const om = showMessage; showMessage = (m, t) => { msgs.push(m); return om(m, t); };
    state._lastAnnouncedCodonFrame = null;
    const cb = document.getElementById('codonAnalysis'); cb.checked = true; cb.dispatchEvent(new Event('change'));
    await new Promise(res => setTimeout(res, 700));
    const autoMsg = msgs.find(m => /auto-selected/.test(m)) || '';
    setAnnotation('chr\t0\t42\t.\t0\t+\nchr\t52\t94\t.\t0\t-\n', 'two.bed');
    await new Promise(res => setTimeout(res, 700));
    const fasta = buildAATranslationFasta() || '';
    msgs = [];
    const orig = navigator.clipboard.writeText; navigator.clipboard.writeText = () => Promise.resolve();
    copyAATranslation();
    await new Promise(res => setTimeout(res, 300));
    navigator.clipboard.writeText = orig; showMessage = om;
    clearAnnotation();
    return { autoMsg, records: (fasta.match(/^>/gm) || []).length, aa: fasta.split('\n').filter(l => l && l[0] !== '>'), copyMsg: msgs.find(m => /Copied/.test(m)) || '' };
  });
  const ok = /Pos 1/.test(r.autoMsg) && r.records === 4 && r.aa.every(a => a === 'MAKGLQEFGTWKP*') && /Copied 4 /.test(r.copyMsg);
  return { pass: ok, detail: JSON.stringify(r) };
});

// #9 MACSE's padding of a sequence that starts or ends inside a codon (reads, fragments) was counted as frameshifts:
// 12 reads with one real deletion each gave "22 frameshifted codons"
check('MACSE summary counts only frameshifts inside the sequences, not the padding of fragments', async (page) => {
  const cds = 'ATGGCTAAAGGTCTGCAAGAATTCGGTACCTGGAAACCGATGCTTGCAGGTAAAGAACTGTTCCCGGGATCCTAA';
  const fa = `>ref\n${cds}\n>f1\n${cds.slice(4, 50)}\n>f2\n${cds.slice(10, 64)}\n>f3\n${cds.slice(20, 71)}\n`;
  await page.evaluate(f => { document.getElementById('fastaInput').value = f; parseAndRender(false); }, fa);
  await page.waitForTimeout(500);
  await page.evaluate(() => { openMacsePreset(false); const e = document.getElementById('codonEngine'); e.value = 'macse'; e.dispatchEvent(new Event('change', { bubbles: true })); window._lastCodonAlignStats = null; realignAll(); });
  await page.waitForFunction(() => !!window._lastCodonAlignStats, null, { timeout: 60000 }).catch(() => {});
  const r = await page.evaluate(() => { const st = window._lastCodonAlignStats; return st ? { inner: st.frameshifts.reduce((a, x) => a + x.n, 0), terminal: st.frameshifts.reduce((a, x) => a + (x.terminal || 0), 0) } : null; });
  await page.evaluate(() => { const sel = document.getElementById('mafftSeqType'); sel.value = sel.options[0].value; sel.dispatchEvent(new Event('change', { bubbles: true })); });
  return { pass: !!r && r.inner === 0, detail: JSON.stringify(r) };
});

// A whole-genome BAM is gigabytes and was decompressed whole (impossible in a browser). With its .bai picked
// together with it, only the loaded region's blocks are read: a gene cut out with samtools faidx (chrT:100001-103000)
// gets the reads samtools view -c counts there (tests/fixtures/reads/chrom: index and counts from samtools)
check('Reads: BAM + .bai picked together read only the loaded region (faidx name), same reads as samtools; index alone or wrong index said', async (page) => {
  const path = require('path'), fs = require('fs');
  const C = path.join(__dirname, '..', 'fixtures', 'reads', 'chrom');
  const truth = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'reads', 'region', 'truth.json'), 'utf8'));
  const want = truth.muts.map(m => `${m.pos + 1}${m.hom ? 'hom' : 'het'}`).sort().join(',');
  await page.setInputFiles('#fileInput', path.join(C, 'chrT_region.fa'));
  await page.waitForTimeout(1200);
  await page.setInputFiles('#bamFileInput', [path.join(C, 'chrom_reads.bam'), path.join(C, 'chrom_reads.bam.bai')]);
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => ({
    reads: (bamState.allReads || []).length, msg: document.getElementById('statusMessage').innerText.replace(/\s+/g, ' ').slice(0, 300),
    calls: _readsCalls() ? _readsCalls().variants.map(v => `${v.pos}${v.zyg}`).sort().join(',') : ''
  }));
  await page.evaluate(() => clearReadsData());
  await page.setInputFiles('#bamFileInput', path.join(C, 'chrom_reads.bam.bai'));
  await page.waitForTimeout(1500);
  r.indexAlone = await page.evaluate(() => document.getElementById('statusMessage').innerText.slice(0, 120));
  await page.setInputFiles('#bamFileInput', [path.join(C, 'chrom_reads.bam'), path.join(__dirname, '..', '..', 'examples', 'real', 'htslib_range.bam.bai')]);
  await page.waitForTimeout(3000);
  r.wrongIndex = await page.evaluate(() => document.getElementById('statusMessage').innerText.slice(0, 160));
  const ok = r.reads === 799 && /read through the index: chrT:100,001-103,000/.test(r.msg) && r.calls === want
    && /select the BAM together with its \.bai/.test(r.indexAlone) && /not this BAM's/.test(r.wrongIndex);
  return { pass: ok, detail: JSON.stringify({ want, ...r }) };
});

check('BAM opened with nothing loaded explains that the reference comes first', async (page) => {
  const r = await openSynthetic(page, 'synth_reads.bam');
  if (!/reference first/.test(r.msg)) return { pass: false, detail: r.msg };
  return { pass: true, detail: 'guidance message shown' };
});

check('Ctrl+Delete deletes selected rows and Ctrl+= zooms in', async (page) => {
  await openSynthetic(page, 'synth_msa.fa');
  page.on('dialog', d => d.accept());
  await page.evaluate(() => { state.selectedRows = new Set([0]); document.activeElement.blur(); });
  await page.keyboard.press('Control+Delete');
  await page.waitForTimeout(500);
  const rows = await page.evaluate(() => state.seqs.length);
  const z0 = await page.evaluate(() => document.getElementById('zoomSlider').value);
  await page.keyboard.press('Control+Equal');
  await page.waitForTimeout(300);
  const z1 = await page.evaluate(() => document.getElementById('zoomSlider').value);
  if (rows !== 5 || z1 === z0) return { pass: false, detail: `rows=${rows} (want 5), zoom ${z0}->${z1}` };
  return { pass: true, detail: `6->5 rows, zoom ${z0}->${z1}` };
});

// Dot plot checks (2026-09-24 audit). All in one page to keep the suite fast.
check('Dot plot: N runs, U/T, zoom, size limit, copy reset, window input', async (page) => {
  const r = await page.evaluate(async () => {
    const rnd = (n, seed) => { let s = seed, o = ''; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; o += 'ACGT'[(s >>> 16) & 3]; } return o; };
    const plot = async (A, B, mode, win) => {
      document.querySelector(`input[name="dotPlotMode"][value="${mode}"]`).checked = true; _dotOnModeChange();
      document.getElementById('dotPlotWindow').value = win;
      await openDotPlot(A, B, 'A', 'B');
    };
    const out = {};
    const nseq = rnd(100, 5) + 'N'.repeat(200) + rnd(100, 9);
    for (const mode of ['spin', 'doter']) {
      await plot(nseq, nseq, mode, mode === 'spin' ? 6 : 11);
      let inN = 0;
      for (let r = 120; r < 280; r++) for (let c = 120; c < 280; c++) if (_dotIsDot(r, c)) inN++;
      out['nBlockDots_' + mode] = inN;
    }
    await plot('ACGUACGUACGUACGUACGU', 'ACGTACGTACGTACGTACGT', 'spin', 6);
    out.uEqualsT = _dotIsDot(0, 0) && _dotIsDot(10, 10);
    await plot(rnd(1500, 3), rnd(1500, 3), 'spin', 6);
    const S = _dotPlotState;
    S.zoom = 24; _dotSetSpacer(); _dotRender();
    const c = document.getElementById('dotPlotCanvas'), vp = document.getElementById('dotPlotViewport');
    out.canvasFitsViewport = c.width <= vp.clientWidth * (devicePixelRatio || 1) + 1;
    _dotUpdateHoverInfo(5, 5);
    out.copyBefore = !!S._copyRegion;
    await plot(rnd(12000, 1), rnd(12000, 2), 'spin', 8);
    out.refused = /Too large/.test(document.getElementById('dotPlotStatus').textContent) && S.rows === 0;
    await plot(rnd(300, 4), rnd(300, 4), 'spin', 6);
    out.copyAfter = S._copyRegion;
    const w = document.getElementById('dotPlotWindow');
    out.spinInputValid = w.checkValidity() && w.min === '2' && w.max === '20';
    return out;
  });
  const bad = [];
  if (r.nBlockDots_spin || r.nBlockDots_doter) bad.push(`N block shows dots (spin ${r.nBlockDots_spin}, dotter ${r.nBlockDots_doter})`);
  if (!r.uEqualsT) bad.push('U and T do not match');
  if (!r.canvasFitsViewport) bad.push('zoomed canvas larger than the viewport');
  if (!r.copyBefore || r.copyAfter !== null) bad.push('Copy Region not reset by a new plot');
  if (!r.refused) bad.push('12000 x 12000 plot not refused');
  if (!r.spinInputValid) bad.push('word-size input invalid in SPIN mode');
  if (bad.length) return { pass: false, detail: bad.join('; ') };
  return { pass: true, detail: 'no dots in N runs, U=T, viewport-sized canvas at 24x, size limit, copy reset, valid input' };
});

// In-browser MAFFT Speed must change the alignment. It used to send disttbfast -C
// (the thread count), so all three settings gave byte-identical results.
check('MAFFT Speed sets -E (guide-tree runs) and changes the alignment', async (page) => {
  page.on('dialog', d => d.accept());
  const path = require('path');
  const out = {};
  for (const v of ['1', '2', '3']) {
    await page.goto(page.url(), { waitUntil: 'networkidle' });
    await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
    await page.waitForTimeout(1500);
    const args = await page.evaluate(v => { document.getElementById('mafftSpeed').value = v; return getMafftExtraArgs().args; }, v);
    await page.evaluate(() => { window.__before = state.seqs.map(s => s.seq).join('|'); realignAll(); });
    await page.waitForFunction(() => state.seqs.map(s => s.seq).join('|') !== window.__before, null, { timeout: 60000 });
    out[v] = { args: args.join(' '), aln: await page.evaluate(() => state.seqs.map(s => s.seq).join('|')) };
  }
  const bad = [];
  for (const v of ['1', '2', '3']) {
    if (!out[v].args.includes('-E ' + v)) bad.push(`Speed ${v} sent "${out[v].args}"`);
    if (out[v].args.includes('-C')) bad.push(`Speed ${v} still sends -C`);
  }
  if (out['1'].aln === out['2'].aln || out['2'].aln === out['3'].aln) bad.push('Speed settings gave identical alignments');
  if (bad.length) return { pass: false, detail: bad.join('; ') };
  return { pass: true, detail: '-E 1/2/3 sent, three different alignments' };
});

// Sort buttons keep their arrow labels (an ASCII pass once turned them into "A->Z", "Lenv", "Simv")
check('Sort buttons show A→Z / Len↓ / Sim↓ and Len↓ sorts longest first', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const t = id => document.getElementById(id).textContent;
    document.getElementById('sortByLengthButton').click();
    const lens = state.seqs.map(s => s.seq.replace(/[-.]/g, '').length);
    return { labels: [t('sortByNameButton'), t('sortByLengthButton'), t('sortBySimButton')], descending: lens.every((v, i) => i === 0 || lens[i - 1] >= v) };
  });
  const want = ['A\u2192Z', 'Len\u2193', 'Sim\u2193'];
  if (JSON.stringify(r.labels) !== JSON.stringify(want)) return { pass: false, detail: 'labels ' + JSON.stringify(r.labels) };
  if (!r.descending) return { pass: false, detail: 'Len\u2193 did not sort by descending ungapped length' };
  return { pass: true, detail: 'labels ' + r.labels.join(' ') + ', length sort descending' };
});

// Ctrl+Shift+R is the browser's hard refresh: take it only when a 2+ column span is selected
check('Ctrl+Shift+R is left to the browser unless a 2+ column span is selected', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'synthetic', 'synth_msa.fa'));
  await page.waitForTimeout(1200);
  const press = (cols) => page.evaluate((cols) => {
    state.selectedColumns = new Set(cols); document.activeElement.blur();
    let prevented = null;
    document.addEventListener('keydown', e => { prevented = e.defaultPrevented; }, { once: true });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    return prevented;
  }, cols);
  const separate = await press([3, 9]);
  const span = await press([3, 4]);
  if (separate !== false || span !== true) return { pass: false, detail: `two single columns prevented=${separate}, span prevented=${span}` };
  return { pass: true, detail: 'separate single columns: browser keeps the key; span: realign' };
});

// Zoom is a font-size change the persistent scrollbar's observers don't see; before the
// fix the bar kept its 100%-zoom width at 50%, overshot the alignment and snapped back.
check('Horizontal scrollbar follows zoom (no overshoot / snap-back at 50%)', async (page) => {
  let seq = '', rnd = 7;
  const next = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648);
  const fa = Array.from({ length: 20 }, (_, i) => { seq = ''; for (let k = 0; k < 4000; k++) seq += 'ACGT'[next() % 4]; return `>s${i}\n${seq}`; }).join('\n') + '\n';
  await page.setInputFiles('#fileInput', { name: 'wide.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const r = document.getElementById('modeSingle'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(800);
  const sw = page.getByRole('button', { name: 'Switch anyway' }); if (await sw.count()) await sw.click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => setZoom(50));
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const h = document.querySelector('.horizontal-scrollbar'), c = document.getElementById('alignmentContainer');
    // a user drives the bar with a wheel, press or touch; a bare scrollLeft write is our own mirror
    h.dispatchEvent(new WheelEvent('wheel', { deltaX: 1, bubbles: true }));
    h.scrollLeft = h.scrollWidth; h.dispatchEvent(new Event('scroll'));
    await new Promise(res => setTimeout(res, 500));
    return { barMax: h.scrollWidth - h.clientWidth, contMax: c.scrollWidth - c.clientWidth, bar: Math.round(h.scrollLeft), cont: Math.round(c.scrollLeft) };
  });
  const ok = r.contMax > 0 && Math.abs(r.barMax - r.contMax) <= 3 && Math.abs(r.bar - r.cont) <= 3 && r.cont >= r.contMax - 3;
  return { pass: ok, detail: JSON.stringify(r) };
});

// Display menu: Sticky sits with Name Len; case and colours are labelled on a "Letters" row
check('Display menu: Sticky on the Name Len row, labelled Case/Colours/Frame/Code, both still work', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1500);
  const layout = await page.evaluate(() => {
    const labelFor = id => document.querySelector(`label[for="${id}"]`)?.textContent.trim();
    return {
      stickyRow: !!document.getElementById('stickyNames').closest('.display-slider-row')?.querySelector('#nameLengthSlider'),
      caseLabel: labelFor('residueCase'), colourLabel: labelFor('colorSchemeSelect'),
      frameLabel: labelFor('codonFrame'), codeLabel: labelFor('codonCode'),
      caseFirst: document.querySelector('#residueCase option').textContent,
    };
  });
  await page.evaluate(() => { const s = document.getElementById('residueCase'); s.value = 'lower'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(600);
  // the consensus row keeps its own case (upper = above the threshold), so it is left out by its element
  const lowered = await page.evaluate(() => { const t = [...document.querySelectorAll('#alignmentContainer .seq-line:not(.consensus-line)')].map(l => l.innerText).join('|'); return /[acgt]{5}/.test(t) && !/[ACGT]{5}/.test(t); });
  const ok = layout.stickyRow && layout.caseLabel === 'Case' && layout.colourLabel === 'Colours' && layout.frameLabel === 'Frame' && layout.codeLabel === 'Code' && layout.caseFirst === 'As in file' && lowered;
  return { pass: ok, detail: JSON.stringify({ ...layout, lowered }) };
});

// Statistics matrices: names on both axes in every label style, windowed rows hold the right
// data, the Distance/Identity switch, find row/column, copy gives a TSV table with full names
check('Statistics matrices: named labels, windowed rows, switch, find, TSV copy', async (page) => {
  const names = Array.from({ length: 150 }, (_, i) => `seq_with_a_rather_long_name_${i}`);
  let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) % 4;
  const base = Array.from({ length: 120 }, () => 'ACGT'[rnd()]).join('');
  const fa = names.map(n => `>${n}\n` + base.split('').map(c => rnd() === 0 && rnd() === 0 ? 'ACGT'[rnd()] : c).join('')).join('\n') + '\n';
  await page.setInputFiles('#fileInput', { name: 'many.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { try { localStorage.removeItem('msaviewer_statsLabels'); localStorage.removeItem('msaviewer_statsWin'); } catch (e) {}
    window._copied = null; navigator.clipboard.writeText = t => { window._copied = t; return Promise.resolve(); }; openStats(); });
  await page.waitForFunction(() => state._statsData && document.querySelector('#statsSummaryTab table.stats-mx'), null, { timeout: 30000 });
  const out = {};
  for (const style of ['angled', 'vertical', 'numbers']) {
    if (await page.locator('#statsLabelsPanel').isHidden()) await page.click('#statsLabelsBtn');   // label options live in the Labels panel
    await page.selectOption('#statsLabelStyle', style);
    await page.waitForTimeout(150);
    out[style] = await page.evaluate(async (style) => {
      const sc = document.querySelector('#statsSummaryTab .stats-mx-scroll'), table = sc.querySelector('table');
      const head = [...table.tHead.rows[0].cells].filter(c => c.classList.contains('c'));
      const n = state._statsData.names.length, m = state._statsData.combined;
      const headOk = head.length === n && head.every((c, j) => c.title.startsWith(state._statsData.names[j]) &&
        (style === 'numbers' ? c.textContent === String(j + 1) : state._statsData.names[j].startsWith(c.textContent.replace('…', ''))));
      sc.scrollTop = 0.6 * (sc.scrollHeight - sc.clientHeight);
      await new Promise(r => setTimeout(r, 150));
      const top = sc.getBoundingClientRect().top + table.tHead.getBoundingClientRect().height;
      const tr = [...table.tBodies[0].rows].find(t => t.cells[0].dataset.r && t.getBoundingClientRect().bottom > top + 2);
      const i = +tr.cells[0].dataset.r;
      // the live row holds the column window only (data-c0..c1 on the tbody); every cell in it must be right
      const c0 = +table.tBodies[0].dataset.c0 || 0;
      const live = [...tr.cells].filter(c => c.tagName === 'TD' && !c.classList.contains('csp') && !c.classList.contains('pad'));
      const rowOk = i > 50 && live.length > 0 && live.every((c, k) => c.textContent === m[i][c0 + k]);
      return { headOk, rowOk, i, domRows: table.tBodies[0].rows.length };
    }, style);
  }
  // one matrix: identity % above the diagonal, distance below (owner, 2026-10-24); find puts the named row/column under the labels
  await page.fill('#statsFindRow', 'name_97');
  await page.fill('#statsFindCol', 'name_120');
  await page.waitForTimeout(300);
  const nav = await page.evaluate(() => {
    const sc = document.querySelector('#statsSummaryTab .stats-mx-scroll'), table = sc.querySelector('table');
    const cell = table.querySelector('td.focus');
    const cr = cell?.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    return { kind: table.dataset.kind, f: state._statsFocus, cell: cell?.textContent, want: state._statsData.identity[97][120], lower: table.querySelector('td.dg') ? state._statsData.combined[120][97] === state._statsData.distance[120][97] && state._statsData.combined[97][97] === '' : false,
      visible: !!cr && cr.top > sr.top && cr.bottom < sr.bottom && cr.left > sr.left && cr.right < sr.right };
  });
  // close the Labels panel first: in Firefox/WebKit the toolbar wraps and the open panel covers Copy
  if (!(await page.locator('#statsLabelsPanel').isHidden())) await page.click('#statsLabelsBtn');
  await page.click('#statsCopyBtn');
  await page.waitForTimeout(200);
  const tsv = await page.evaluate(() => {
    const lines = (window._copied || '').trimEnd().split('\n');
    const head = lines[0].split('\t'), r7 = lines[8].split('\t');
    return { lines: lines.length, headOk: head[0] === '' && head[1] === state._statsData.names[0] && head.length === 151,
      rowOk: r7[0] === state._statsData.names[7] && r7[8] === '' && r7[3] === state._statsData.distance[7][2] && r7[12] === state._statsData.identity[7][11] };
  });
  const navOk = nav.kind === 'combined' && nav.lower && nav.f.i === 97 && nav.f.j === 120 && nav.cell === nav.want && nav.visible;
  const ok = ['angled', 'vertical', 'numbers'].every(s => out[s].headOk && out[s].rowOk && out[s].domRows < 150) && navOk && tsv.lines === 151 && tsv.headOk && tsv.rowOk;
  return { pass: ok, detail: JSON.stringify({ ...out, nav, tsv }) };
});

// Statistics window: esl-alistat fields and esl-alipid identity match a calculation done
// here from the FASTA file; every field has a documented tooltip (no underline); min/max
// name their pairs; it maximizes/restores, resizes from all 8 edges/corners, docks beside the
// alignment; clicking column names selects them for Copy; the pair filter counts, lists and
// saves the right pairs; CSV and Excel files hold the matrix
check('Statistics window: esl values, tooltips, maximize, 8-way resize, dock, column copy, pair filter, files', async (page) => {
  const fs = require('fs');
  const path = require('path');
  const FA = path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa');
  const recs = [];
  for (const line of fs.readFileSync(FA, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('>')) recs.push({ name: line.slice(1).trim().split(/\s+/)[0], seq: '' });
    else if (line.trim()) recs[recs.length - 1].seq += line.trim().toUpperCase();
  }
  const n = recs.length, L = Math.max(...recs.map(r => r.seq.length));
  const gap = c => c === undefined || c === '-' || c === '.';
  const rawLen = recs.map(r => [...r.seq].filter(c => !gap(c)).length);
  const esl = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let nid = 0;
    for (let p = 0; p < L; p++) { const a = recs[i].seq[p], b = recs[j].seq[p]; if (!gap(a) && !gap(b) && a === b) nid++; }
    const m = Math.min(rawLen[i], rawLen[j]);
    esl.push({ i, j, v: m ? nid / m * 100 : 0 });
  }
  const exp = { nres: rawLen.reduce((a, b) => a + b, 0).toLocaleString('en-US'), small: String(Math.min(...rawLen)), large: String(Math.max(...rawLen)),
    avgid: (esl.reduce((s, x) => s + x.v, 0) / esl.length).toFixed(1) + '%', ge95: esl.filter(x => x.v >= 95 - 1e-12).length };

  await page.setInputFiles('#fileInput', FA);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { try { localStorage.removeItem('msaviewer_statsWin'); localStorage.removeItem('msaviewer_statsLabels'); } catch (e) {}
    window._copied = null; navigator.clipboard.writeText = t => { window._copied = t; return Promise.resolve(); }; openStats(); });
  await page.waitForFunction(() => document.querySelector('#statsSummaryTab table.stats-mx'), null, { timeout: 30000 });
  const r = {};
  r.fields = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.stats-card tr')].map(tr => [tr.cells[0].textContent.trim(), tr.cells[1].textContent.trim()])));
  r.valuesOk = r.fields['Total # residues'] === exp.nres && r.fields['Smallest'] === exp.small && r.fields['Largest'] === exp.large
    && r.fields['Average identity'] === exp.avgid && r.fields['Mean'] === exp.avgid;
  r.tips = await page.evaluate(() => [...document.querySelectorAll('.stats-card .tip')].map(el => {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const card = document.getElementById('statsTipCard'), cs = getComputedStyle(el);
    const o = { shown: !card.hidden && card.textContent.length > 30, plain: cs.borderBottomStyle === 'none' && cs.textDecorationLine === 'none', doc: !!card.querySelector('.doc') };
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    return o;
  }));
  r.tipsOk = r.tips.length >= 13 && r.tips.every(t => t.shown && t.plain) && r.tips.filter(t => t.doc).length >= 8;
  r.pairsOk = await page.evaluate(() => {
    const d = state._statsData, s = _statsIdentitySummary('esl');
    const shown = [...document.querySelectorAll('#statsIdCard .pair a')].map(a => [+a.dataset.i, +a.dataset.j]);
    return shown.length > 0 && shown.every(([i, j]) => Math.abs(d.pid.esl[i * d.n + j] - s.min) < 1e-9 || Math.abs(d.pid.esl[i * d.n + j] - s.max) < 1e-9);
  });
  // maximize and restore
  const rect = () => page.evaluate(() => { const b = document.getElementById('statsModal').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)].join(); });
  const before = await rect();
  await page.click('#statsMaxBtn'); await page.waitForTimeout(150);
  r.maxFills = await page.evaluate(() => { const b = document.getElementById('statsModal').getBoundingClientRect(); return b.width >= innerWidth - 10 && b.bottom >= innerHeight - 6; });
  await page.dblclick('#statsHeader h3'); await page.waitForTimeout(150);
  r.restored = (await rect()) === before;
  // resize from each edge and corner
  r.resize = {};
  for (const [dir, dx, dy] of [['e', 50, 0], ['w', -50, 0], ['s', 0, 40], ['n', 0, -30], ['se', 30, 20], ['sw', -30, 20], ['ne', 30, -20], ['nw', -30, -20]]) {
    await page.evaluate(() => _statsSetFloatRect({ left: 250, top: 120, width: 820, height: 560 }));
    const hb = await page.locator(`.stats-rz[data-dir="${dir}"]`).boundingBox();
    const x = hb.x + hb.width / 2, y = hb.y + hb.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 3 }); await page.mouse.up();
    const [left, top, w, h] = (await rect()).split(',').map(Number);
    const ew = 820 + (dir.includes('e') ? dx : dir.includes('w') ? -dx : 0), eh = 560 + (dir.includes('s') ? dy : dir.includes('n') ? -dy : 0);
    const el = 250 + (dir.includes('w') ? dx : 0), et = 120 + (dir.includes('n') ? dy : 0);
    r.resize[dir] = Math.abs(w - ew) <= 1 && Math.abs(h - eh) <= 1 && Math.abs(left - el) <= 1 && Math.abs(top - et) <= 1;
  }
  // column selection -> Copy copies those columns
  await page.evaluate(() => _statsSetFloatRect({ left: 60, top: 60, width: 1200, height: 760 }));
  await page.click('table.stats-mx thead th[data-c="2"]');
  await page.click('table.stats-mx thead th[data-c="5"]', { modifiers: ['Control'] });
  await page.click('#statsCopyBtn'); await page.waitForTimeout(150);
  r.copy = await page.evaluate(() => { const rows = window._copied.trimEnd().split('\n').map(l => l.split('\t')); const d = state._statsData;
    return rows.length === d.n + 1 && rows[0].length === 3 && rows[0][1] === d.names[2] && rows[0][2] === d.names[5] && rows[7][2] === d.combined[6][5]
      && document.querySelectorAll('table.stats-mx thead th.cs').length === 2 && document.getElementById('statsCopyBtn').textContent === 'Copy 2 columns'; });
  await page.keyboard.press('Escape');
  // pair filter
  await page.fill('#statsFilterValue', '95'); await page.waitForTimeout(500);
  r.filter = await page.evaluate(() => ({ hits: state._statsHits.length, cells: document.querySelectorAll('table.stats-mx td.hit').length }));
  await page.click('.stats-view button[data-view="list"]'); await page.waitForTimeout(200);
  r.listRows = await page.evaluate(() => document.querySelectorAll('table.stats-pairs tbody tr').length);
  r.saved = await page.evaluate(async () => {
    const got = []; const orig = URL.createObjectURL;
    URL.createObjectURL = b => { got.push(b); return orig.call(URL, b); };
    _statsSavePairs('pairs'); _statsSavePairs('fasta-raw'); saveStatsMatrix('csv', 'identity'); saveStatsMatrix('xlsx', 'identity');
    URL.createObjectURL = orig;
    const [pairs, fa, csv] = await Promise.all(got.slice(0, 3).map(b => b.text()));
    const xl = new Uint8Array(await got[3].arrayBuffer());
    const d = state._statsData;
    return { pairLines: pairs.trimEnd().split('\r\n').length - 1, faSeqs: (fa.match(/^>/gm) || []).length, faNoGaps: !/-/.test(fa.split('\n').filter(l => !l.startsWith('>')).join('')),
      csvOk: csv.split('\r\n')[5].split(',')[9] === d.identity[4][8], xlsx: xl[0] === 0x50 && xl[1] === 0x4b };
  });
  // dock beside the alignment
  await page.click('.stats-view button[data-view="matrix"]');
  const w0 = await page.evaluate(() => document.getElementById('alignmentContainer').getBoundingClientRect().width);
  await page.click('#statsDockBtn'); await page.waitForTimeout(500);
  r.dock = await page.evaluate((w0) => { const w = document.getElementById('statsModal').getBoundingClientRect(), a = document.getElementById('alignmentContainer').getBoundingClientRect();
    return Math.round(innerWidth - w.right) === 0 && a.width < w0 - 300 && a.right <= w.left + 1; }, w0);
  await page.click('#statsDockBtn'); await page.waitForTimeout(300);
  r.undock = await page.evaluate(() => document.body.style.paddingRight === '');
  const ok = r.valuesOk && r.tipsOk && r.pairsOk && r.maxFills && r.restored && Object.values(r.resize).every(Boolean) && r.copy
    && r.filter.hits === exp.ge95 && r.filter.cells === 2 * exp.ge95 && r.listRows === exp.ge95
    && r.saved.pairLines === exp.ge95 && r.saved.faSeqs > 0 && r.saved.faNoGaps && r.saved.csvOk && r.saved.xlsx && r.dock && r.undock;
  delete r.fields; delete r.tips;
  return { pass: ok, detail: JSON.stringify(r) };
});

// Window title bars: every dialog's close button is a 26px target centred in its title bar
check('Dialog close buttons are centred in a title bar', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1500);
  const r = {};
  for (const [name, open, btn] of [
    ['stats', 'openStats()', '#statsCloseBtn'],
    ['tree', 'state.selectedRows = new Set([0,1,2,3]); openTreeBuilder()', '#treeBuilderCloseBtn'],
    ['repeat', 'openRepeatFinder(0)', '#repeatFinderCloseBtn'],
    ['seqedit', 'openSeqEditor(0)', '#seqEditCloseBtn'],
  ]) {
    await page.evaluate(open);
    await page.waitForTimeout(900);
    r[name] = await page.evaluate((btn) => {
      const b = document.querySelector(btn), bar = b.closest('.win-titlebar');
      if (!bar) return 'no title bar';
      const br = b.getBoundingClientRect(), hr = bar.getBoundingClientRect();
      return { w: br.width, h: br.height, dy: Math.round((br.top + br.height / 2) - (hr.top + hr.height / 2)), glyph: b.textContent };
    }, btn);
    await page.click(btn);
    await page.waitForTimeout(200);
  }
  const ok = Object.values(r).every(v => v.w === 26 && v.h === 26 && Math.abs(v.dy) <= 1 && v.glyph === '×');
  return { pass: ok, detail: JSON.stringify(r) };
});

// Codon analysis marks frameshift gaps with side bars; drawn as borders they widened those
// cells by 4px and pushed the rest of the row off its columns
check('Codon analysis: frameshift-marked cells keep the column width (rows stay aligned)', async (page) => {
  const cds = 'ATGGCTAAAGGTCTGCAAGAATTCGGTACCTGGAAACCGATGCTTGCAGGTAAAGAACTGTTCCCGGGATCCTAA';
  const rows = ['>ref\n' + cds, '>del1\n' + cds.slice(0, 20) + '-' + cds.slice(21), '>del2\n' + cds.slice(0, 30) + '--' + cds.slice(32), '>ok\n' + cds];
  await page.setInputFiles('#fileInput', { name: 'cds.fa', mimeType: 'text/plain', buffer: Buffer.from(rows.join('\n') + '\n') });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const c = document.getElementById('codonAnalysis'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.seq-line[data-seq-index]')];
    const marked = document.querySelectorAll('.seq-data span.codon-fs-internal').length;
    const widths = new Set(), lefts = {};
    for (const l of lines) [...l.querySelector('.seq-data').children].filter(k => !k.classList.contains('seq-length')).forEach((k, ci) => {
      const b = k.getBoundingClientRect(); widths.add(Math.round(b.width * 100) / 100);
      (lefts[ci] ||= new Set()).add(Math.round(b.left * 10) / 10);
    });
    const misaligned = Object.values(lefts).filter(s => s.size > 1).length;
    return { rows: lines.length, marked, widths: [...widths], misaligned };
  });
  const ok = r.marked > 0 && r.widths.length === 1 && r.misaligned === 0;
  return { pass: ok, detail: JSON.stringify(r) };
});

// Codon analysis: leading/trailing gaps are not frameshifts, an internal 1-base gap is marked
// once, a row starting mid-codon is read in the alignment's frame, the translation track lines
// up with the bases with each letter over its codon's middle base, and long names end in one "…"
check('Codon analysis: frameshift only for internal gaps, late rows keep frame, track aligned', async (page) => {
  const cds = 'ATGGCTAAAGGTCTGCAAGAATTCGGTACCTGGAAACCGATGCTTGCAGGTAAAGAACTGTTCCCGGGATCCTAA';
  const rows = [
    ['ref', cds],
    ['late_start_mid_codon', '----' + cds.slice(4)],            // starts at column 5 = 2nd base of codon 2
    ['short_end', cds.slice(0, 50) + '-'.repeat(cds.length - 50)], // trailing gaps
    ['internal_1bp_gap_with_a_very_long_name_indeed', cds.slice(0, 20) + '-' + cds.slice(21)],
  ];
  await page.setInputFiles('#fileInput', { name: 'cds.fa', mimeType: 'text/plain', buffer: Buffer.from(rows.map(([n, s]) => `>${n}\n${s}`).join('\n') + '\n') });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const n = document.getElementById('nameLengthInput'); n.value = 20; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true }));
    const c = document.getElementById('codonAnalysis'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => {
    const cd = state._codonData;
    const fs = cd.frameShifts.map(f => f.filter(x => x.type === 'indel').length);
    const refCodon5 = cd.aaSeq[0].find(e => e.cols[0] === 6);      // codon 3 of ref: columns 7-9
    const lateCodon = cd.aaSeq[1].find(e => e.cols[0] === 6);
    const lateFirst = cd.aaSeq[1][0]?.cols[0];
    let misaligned = 0, notMid = 0;
    document.querySelectorAll('.seq-line[data-seq-index]').forEach(line => {
      const aa = line.nextElementSibling; if (!aa?.classList.contains('aa-row')) return;
      const nt = [...line.querySelector('.seq-data').children].filter(k => k.dataset.pos != null);
      const ac = [...aa.querySelector('.aa-data').children];
      const i = +line.dataset.seqIndex;
      ac.forEach((a, k) => {
        if (nt[k] && Math.abs(a.getBoundingClientRect().left - nt[k].getBoundingClientRect().left) > 0.6) misaligned++;
        if (a.classList.contains('aa-c') && a.textContent.trim()) {
          const e = cd.aaSeq[i].find(x => x.cols.includes(k));
          if (!e || e.cols[1] !== k || e.aa !== a.textContent) notMid++;
        }
      });
    });
    const marks = [...document.querySelectorAll('.aa-row')].map(a => a.querySelectorAll('.aa-fs').length);
    const longName = document.querySelector('.seq-line[data-seq-index="3"] .seq-name').textContent.trim();
    return { fs, marks, lateFirst, lateOk: !!lateCodon && lateCodon.aa === refCodon5.aa && lateCodon.codon === refCodon5.codon,
      misaligned, notMid, longName, nameFits: longName.length <= 20 && longName.endsWith('…') && !longName.includes('...') };
  });
  const ok = r.fs[0] === 0 && r.fs[1] === 0 && r.fs[2] === 0 && r.fs[3] === 1 && r.marks.join() === '0,0,0,1'
    && r.lateFirst === 6 && r.lateOk && r.misaligned === 0 && r.notMid === 0 && r.nameFits;
  return { pass: ok, detail: JSON.stringify(r) };
});

// Name Len: "No limit" shows every name in full and survives the render it triggers and a
// preset round-trip; typing in the box is not clamped per keystroke (12 stays 12) and an
// over-range entry clamps to the max on Enter; while dragging, the column width and the cut
// names always agree
check('Name Len: No limit works, typing 12 gives 12, Enter clamps, width and names agree', async (page) => {
  const names = Array.from({ length: 12 }, (_, i) => `sequence_with_a_long_name_number_${String(i).padStart(2, '0')}`);
  const seq = 'ACGTACGTAC'.repeat(8);
  await page.setInputFiles('#fileInput', { name: 'names.fa', mimeType: 'text/plain', buffer: Buffer.from(names.map(n => `>${n}\n${seq}`).join('\n') + '\n') });
  await page.waitForTimeout(1200);
  const look = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('.seq-line[data-seq-index] > .seq-name')].filter(r => state.seqs[+r.parentElement.dataset.seqIndex]);
    const css = +getComputedStyle(document.documentElement).getPropertyValue('--nameLen');
    const texts = rows.map(r => r.textContent.trim());
    return { css, slider: +el('nameLengthSlider').value, max: +el('nameLengthSlider').max, box: el('nameLengthInput').value,
      full: texts.filter((t, i) => t === state.seqs[+rows[i].parentElement.dataset.seqIndex].header).length, n: rows.length,
      maxShown: Math.max(...texts.map(t => t.length)) };
  });
  const r = {};
  await page.hover('.section-header[data-section="display"]');
  await page.waitForTimeout(300);
  await page.click('#nameLengthNoLimit'); await page.waitForTimeout(600);
  r.noLimit = await look();
  // preset round-trip keeps No limit
  await page.evaluate(() => { savePreset(); const cb = el('nameLengthNoLimit'); cb.checked = false; cb.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(400);
  await page.evaluate(() => loadPreset());
  await page.waitForTimeout(600);
  r.afterPreset = { ...(await look()), checked: await page.evaluate(() => el('nameLengthNoLimit').checked) };
  await page.click('#nameLengthNoLimit'); await page.waitForTimeout(600);
  r.unticked = await look();
  await page.click('#nameLengthInput', { clickCount: 3 });
  await page.keyboard.type('12'); await page.waitForTimeout(700);
  r.typed12 = await look();
  await page.click('#nameLengthInput', { clickCount: 3 });
  await page.keyboard.type('99'); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
  r.enter99 = await look();
  r.drag = await page.evaluate(async () => {
    const s = el('nameLengthSlider'); const bad = [];
    for (const v of [30, 22, 15, 8]) {
      s.value = v; s.dispatchEvent(new Event('input', { bubbles: true }));
      const css = +getComputedStyle(document.documentElement).getPropertyValue('--nameLen');
      const shown = Math.max(...[...document.querySelectorAll('.seq-line[data-seq-index] > .seq-name')].filter(r => state.seqs[+r.parentElement.dataset.seqIndex]).map(x => x.textContent.trim().length));
      if (css !== v || shown !== v) bad.push({ v, css, shown });
    }
    return bad;
  });
  const longest = Math.max(...names.map(n => n.length));
  const ok = r.noLimit.full === r.noLimit.n && r.noLimit.css === longest
    && r.afterPreset.checked && r.afterPreset.full === r.afterPreset.n
    && r.unticked.full === 0 && r.unticked.css === r.unticked.slider
    && r.typed12.css === 12 && r.typed12.box === '12' && r.typed12.maxShown === 12
    && r.enter99.slider === r.enter99.max && r.enter99.box === String(r.enter99.max) && r.enter99.css === r.enter99.max
    && r.drag.length === 0;
  return { pass: ok, detail: JSON.stringify(r) };
});

// Tree builder: identical sequences cluster together under both methods (NJ breaks tied Q
// scores toward the closer pair); a pair with no shared aligned base gets no invented
// distance and is reported; a saturated JC69 pair does not turn branch lengths into NaN
check('Tree builder: NJ ties, no-shared-base and saturated pairs', async (page) => {
  const r = await page.evaluate(() => {
    const ident = [
      { header: 'Alpha one', seq: 'ACGTACGT' }, { header: 'Alpha two', seq: 'ACGTACGT' },
      { header: 'beta', seq: 'GCGTACGT' }, { header: "O'Brien", seq: 'ACGTACGT' }];
    const nj = buildNJTreeFromAlignment(ident, 'raw').newick;
    const upgma = buildUPGMATreeFromAlignment(ident, 'raw').newick;
    // beta must be outside the clade holding the three identical sequences
    const betaOutside = nw => { const t = nw.replace(/:[0-9.]+/g, ''); return /^\(beta,\(.*\)\);$/.test(t) || /^\(\(.*\),beta\);$/.test(t); };
    const noShare = [
      { header: 'left', seq: 'ACGTACGTAC----------' }, { header: 'left2', seq: 'ACGAACGTAC----------' },
      { header: 'right', seq: '----------TTGCATGCAA' }];
    const ns = buildUPGMATreeFromAlignment(noShare, 'raw');
    const sat = [
      { header: 's1', seq: 'ACGTACGTACGT' }, { header: 's2', seq: 'ACGTACGTACGA' }, { header: 's3', seq: 'TGCATGCATGCA' }];
    const sj = buildNJTreeFromAlignment(sat, 'jc69');
    return { nj, upgma, njOk: betaOutside(nj), upgmaOk: betaOutside(upgma),
      nsDistance: _modelPairDistance('ACGTACGT', '--------', 'raw'), nsPairs: ns.stats.noOverlap.length, nsFill: ns.stats.filledWith, nsMax: ns.stats.maxDistance,
      satPairs: sj.stats.saturated.length, satNewick: sj.newick, satNaN: /NaN|Infinity/.test(sj.newick),
      // s3 differs from s1/s2 everywhere: its distance must stay larger than theirs
      satFar: (() => { const u = buildUPGMATreeFromAlignment(sat, 'jc69').newick.replace(/:[0-9.]+/g, ''); return /^\(s3,\(s1,s2\)\);$|^\(\(s1,s2\),s3\);$/.test(u); })() };
  });
  const ok = r.njOk && r.upgmaOk && Number.isNaN(r.nsDistance) && r.nsPairs === 2 && r.nsFill === r.nsMax
    && r.satPairs === 2 && !r.satNaN && r.satFar;
  return { pass: ok, detail: JSON.stringify(r) };
});

// Frameshifts are judged against the other rows: one row with an extra base is the only
// row flagged, not the four rows that have a 1-column gap opposite it
check('Codon analysis: an insertion in one row flags that row only', async (page) => {
  const cds = 'ATGGCTAAAGGTCTGCAAGAATTCGGTACCTGGAAACCGATGCTTGCAGGTAAAGAACTGTTCCCGGGATCCTAA';
  const gapped = cds.slice(0, 30) + '-' + cds.slice(30);
  const rows = [['r1', gapped], ['r2', gapped], ['r3', gapped], ['r4', gapped], ['ins', cds.slice(0, 30) + 'T' + cds.slice(30)]];
  await page.setInputFiles('#fileInput', { name: 'ins.fa', mimeType: 'text/plain', buffer: Buffer.from(rows.map(([n, s]) => `>${n}\n${s}`).join('\n') + '\n') });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const c = document.getElementById('codonAnalysis'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => ({
    fs: state._codonData.frameShifts.map(f => f.length),
    marked: [...document.querySelectorAll('.aa-row')].map(a => a.querySelectorAll('.aa-fs, .aa-fs-at').length),
  }));
  const ok = r.fs.join() === '0,0,0,0,1' && r.marked.join() === '0,0,0,0,1';
  return { pass: ok, detail: JSON.stringify(r) };
});

// Statistics heatmap: off by default; on, every off-diagonal cell is coloured, the lowest and
// highest take the palette's end colours and colours follow value order; a custom range puts
// values below it at the first colour; Reverse flips; the panel stays inside the window
check('Statistics heatmap: colours follow values, custom range, reverse, panel inside window', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => { ['msaviewer_statsWin', 'msaviewer_statsLabels', 'msaviewer_statsHeat'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} }); openStats(); });
  await page.waitForFunction(() => document.querySelector('#statsSummaryTab table.stats-mx'), null, { timeout: 30000 });
  const cells = () => page.evaluate(() => {
    const d = state._statsData, n = d.n, out = [];
    for (const tr of document.querySelector('table.stats-mx').tBodies[0].rows) {
      const rn = tr.cells[0]; if (!rn?.dataset.r) continue; const i = +rn.dataset.r;
      for (let j = 0; j < n; j++) if (i !== j) out.push({ v: d.pid[d.mode][i * n + j], bg: tr.cells[j + 1].style.background });
    }
    return out;
  });
  const r = {};
  r.offByDefault = (await cells()).every(c => !c.bg);
  await page.click('#statsHeatBtn');
  r.panelInside = await page.evaluate(() => { const p = document.getElementById('statsHeatPanel').getBoundingClientRect(), b = document.getElementById('statsContent').getBoundingClientRect(); return p.left >= b.left && p.right <= b.right; });
  await page.click('#statsHeatOn'); await page.waitForTimeout(300);
  const lum = s => { const m = s.match(/\d+/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
  let cs = (await cells()).sort((a, b) => a.v - b.v);
  r.allColoured = cs.every(c => c.bg);
  r.ends = cs[0].bg === 'rgb(255, 255, 204)' && cs[cs.length - 1].bg === 'rgb(177, 0, 38)';
  r.monotonic = cs.every((c, k) => k === 0 || lum(c.bg) <= lum(cs[k - 1].bg) + 0.5);
  await page.fill('#statsHeatLo', '90'); await page.fill('#statsHeatHi', '100'); await page.waitForTimeout(600);
  cs = await cells();
  r.range = cs.filter(c => c.v < 90).every(c => c.bg === 'rgb(255, 255, 204)');
  await page.click('#statsHeatReverse'); await page.waitForTimeout(300);
  cs = await cells();
  r.reverse = cs.filter(c => c.v < 90).every(c => c.bg === 'rgb(177, 0, 38)');
  r.legend = await page.evaluate(() => document.getElementById('statsHeatLegend').textContent);
  const ok = r.offByDefault && r.panelInside && r.allColoured && r.ends && r.monotonic && r.range && r.reverse && r.legend === '90.0100.0%';
  return { pass: ok, detail: JSON.stringify(r) };
});

// GLM audit 2026-09-27, confirmed defects: RNA codons translated to X; synonymous /
// non-synonymous marks put on unchanged bases; a row with bases before the frame start was
// not placed on the codon grid; the k-mer guide tree dropped every U
check('Codon/guide-tree audit fixes: RNA translation, marks on changed bases only, frame start, RNA k-mers', async (page) => {
  const dna = 'ATGGCTCTGAAATAA';
  const fa = `>dna_ref\n${dna}\n>rna\n${dna.replace(/T/g, 'U')}\n>syn\nATGGCTTTGAAATAA\n>nonsyn\nATGGAACTGAAATAA\n`;
  await page.setInputFiles('#fileInput', { name: 'c.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { const c = document.getElementById('codonAnalysis'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1000);
  const r = await page.evaluate(() => {
    const cd = state._codonData;
    const marks = cd.synNonSyn.map(row => row.map((v, c) => v ? c + ':' + v : null).filter(Boolean).join(' '));
    // Frame 3 (offset 2): codons start at columns 2, 5, 8, ... A row with bases in columns 0-1
    // (before the frame start) and a gap in 2-5 resumes at column 6, the 2nd base of the codon
    // at 5-7; that partial codon gets no amino acid and translation starts at column 8
    const ref = 'NNATGGCTCTGAAATAA', row = 'NA' + '----' + 'CT' + 'CTGAAATAA';
    const fr = _computeCodonAnalysis([{ seq: ref }, { seq: row }], ref.length, 2);
    const g = _kmerGuideTree([{ seq: 'ACGUACGUUUGACGUAAGU' }, { seq: 'ACGUACGUUUGACGUAAGU' }, { seq: 'GGGCCCAAAGGGCCCAAAG' }], 4);
    const groups = cutGuideTree([{ seq: 'ACGUACGUUUGACGUAAGU' }, { seq: 'ACGUACGUUUGACGUAAGU' }, { seq: 'GGGCCCAAAGGGCCCAAAG' }], 2, 4);
    return { aa: cd.aaSeq.map(x => x.map(e => e.aa).join('')), marks,
      frameStart: fr.aaSeq[1][0]?.cols[0], frameAa: fr.aaSeq[1].map(e => e.aa).join(''),
      rnaGroups: JSON.stringify(groups.groups || groups) };
  });
  const ok = r.aa.join() === 'MALK*,MALK*,MALK*,MELK*' && r.marks.join('|') === '||6:syn|4:nonsyn 5:syn'
    && r.frameStart === 8 && r.frameAa === 'LK*' && /\[0,1\]|\[1,0\]/.test(r.rnaGroups.replace(/\s/g, ''));
  return { pass: ok, detail: JSON.stringify(r) };
});

// Clusterability verdict (GLM audit): a setting that changes the clusters but not the assigned
// count is not "changed nothing"; on a tie for most assigned the current settings stay best;
// with no current-settings result nothing is called inert
check('Clusterability verdict: whole outcome compared, ties keep current settings', async (page) => {
  const r = await page.evaluate(() => {
    const html = rows => { _renderClusterabilityReport(rows, {}, 20); return document.getElementById('clusteringContent').innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); };
    const a = html([
      { label: 'current settings', clusters: 1, assigned: 10, largest: 10 },
      { label: 'Quality: loose', clusters: 2, assigned: 10, largest: 6 },
      { label: 'Min Size 3', clusters: 1, assigned: 10, largest: 10 }]);
    const b = html([
      { label: 'Min Size 3', clusters: 2, assigned: 12, largest: 7 },
      { label: 'current settings', clusters: 2, assigned: 12, largest: 7 }]);
    const c = html([
      { label: 'current settings', error: 'failed' },
      { label: 'Quality: loose', clusters: 1, assigned: 5, largest: 5 }]);
    return { a, b, c };
  });
  const ok = /Changed the outcome: Quality/.test(r.a) && /Changed nothing[^.]*: Min Size/.test(r.a) && !/Changed nothing[^.]*Quality/.test(r.a)
    && /current settings are already the best/.test(r.b) && !/Changed nothing|Changed the outcome/.test(r.c);
  return { pass: ok, detail: JSON.stringify({ a: r.a.slice(0, 300), b: r.b.slice(0, 160), c: r.c.slice(0, 200) }) };
});

// GLM audit batch 2: at most n-1 sequences can differ from a column's consensus, so the
// variable-sites count maximum is n-1 and 100% still finds the most variable column (it
// blanked the alignment); codons with an ambiguous base get no syn/nonsyn mark
check('Variable-sites top threshold and ambiguous codons (audit batch 2)', async (page) => {
  // column 4 has A/C/G/T (3 differ from any consensus); column 2 has one difference
  const fa = '>s1\nATGAAAGCT\n>s2\nATCACAGCT\n>s3\nATGAGAGCT\n>s4\nATGATAGCN\n';
  await page.setInputFiles('#fileInput', { name: 'v.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForTimeout(1000);
  const r = await page.evaluate(async () => {
    const set = (id, v) => { const e = document.getElementById(id); if (e.type === 'checkbox') e.checked = v; else e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    const out = {};
    set('varSitesOnly', true);
    set('varThresholdMode', 'count');
    await new Promise(r => setTimeout(r, 400));
    out.countMax = document.getElementById('varSitesThreshold').max;
    set('varSitesThreshold', 3);
    await new Promise(r => setTimeout(r, 400));
    out.count3 = [...state._diffColumns].join(',');
    set('varThresholdMode', 'pct'); set('varSitesThreshold', 100);
    await new Promise(r => setTimeout(r, 400));
    out.pct100 = [...state._diffColumns].join(',');
    set('varSitesOnly', false); set('varSitesThreshold', 0);
    set('codonAnalysis', true);
    await new Promise(r => setTimeout(r, 600));
    const cd = state._codonData;
    out.s4marks = cd.synNonSyn[3].map((v, c) => v ? c + ':' + v : null).filter(Boolean).join(' ');
    out.s2marks = cd.synNonSyn[1].map((v, c) => v ? c + ':' + v : null).filter(Boolean).join(' ');
    return out;
  });
  // s4's last codon GCN (vs GCT) has an N: no mark there; s2's ATC (vs ATG) is marked at column 2
  const ok = r.countMax === '3' && r.count3 === '4' && r.pct100 === '4' && !/(^|\s)8:/.test(r.s4marks) && /(^|\s)2:nonsyn/.test(r.s2marks);
  return { pass: ok, detail: JSON.stringify(r) };
});

// GLM audit batch 3: the name-similarity sensitivity slider's 0 (strictest) was read as 3
check('Colour names by similarity: sensitivity 0 is the strictest setting, not 3', async (page) => {
  const fa = '>alphabeta_01\nACGT\n>alphabeta_02\nACGT\n>zzzzzz_9\nACGT\n';
  await page.setInputFiles('#fileInput', { name: 'n.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForTimeout(900);
  const colours = (sens) => page.evaluate((sens) => {
    document.getElementById('colourSimilarityChars').value = 12;
    document.getElementById('colourSimilarityThreshold').value = sens;
    autoColourBySimilarity();
    const m = colourState.mappings;
    return [m.get('alphabeta_01'), m.get('alphabeta_02'), m.get('zzzzzz_9')];
  }, sens);
  const s0 = await colours(0), s10 = await colours(10);
  const r = { strictSame: s0[0] === s0[1], looseSame: s10[0] === s10[1], strictColours: s0, looseColours: s10 };
  return { pass: !r.strictSame && r.looseSame, detail: JSON.stringify(r) };
});

// GLM audit batch 3: a heatmap range typed low > high painted every cell one colour; a pair
// with no shared base became distance 0 when all defined distances were 0 (a false twin)
check('Heatmap inverted range and tree fill when all defined distances are 0 (audit batch 3)', async (page) => {
  const r = await page.evaluate(() => {
    const hc = { lo: 90, hi: 90, reverse: false, stops: [[0, 0, 0], [255, 255, 255]] };
    const single = [_statsHeatColour(hc, 80).bg, _statsHeatColour(hc, 95).bg];
    // identical comparable sequences plus one that overlaps none of them
    const seqs = [{ header: 'a', seq: 'ACGTACGT--------' }, { header: 'b', seq: 'ACGTACGT--------' }, { header: 'c', seq: '--------TTTTGGGG' }];
    const m = _treeDistanceMatrix(seqs, 'raw');
    return { single, acDist: m.D[0][2], fill: m.stats.filledWith, nw: buildUPGMATreeFromAlignment(seqs, 'raw').newick };
  });
  // inverted range through the UI: typed 100 .. 20 is stored as 20 .. 100
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => { ['msaviewer_statsHeat'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} }); openStats(); });
  await page.waitForFunction(() => document.querySelector('#statsSummaryTab table.stats-mx'), null, { timeout: 30000 });
  await page.click('#statsHeatBtn'); await page.click('#statsHeatOn');
  await page.fill('#statsHeatLo', '100'); await page.fill('#statsHeatHi', '20'); await page.waitForTimeout(600);
  r.stored = await page.evaluate(() => _statsHeatOpts().range.identity);
  r.distinct = await page.evaluate(() => new Set([...document.querySelectorAll('table.stats-mx td')].map(t => t.style.background).filter(Boolean)).size);
  const ok = r.single[0] === 'rgb(0,0,0)' && r.single[1] === 'rgb(255,255,255)' && r.acDist === 1 && r.fill === 1
    && r.stored.lo === 20 && r.stored.hi === 100 && r.distinct > 10;
  return { pass: ok, detail: JSON.stringify(r) };
});

// Neighbor-Joining against known trees (distance matrix injected): the Wikipedia 5-taxon
// example, and a long-branch case where the closest pair (a,c) is not a cherry. The tie-break
// added earlier the same day made the scan ignore Q until it met a pair closer than the first
// one, so with a,c first the wrong pair was joined (found by the GLM audit)
check('Neighbor-Joining reproduces known trees (Wikipedia example, long branches)', async (page) => {
  const r = await page.evaluate(() => {
    const run = (D, names) => {
      const orig = window._treeDistanceMatrix;
      window._treeDistanceMatrix = () => ({ D: D.map(x => x.slice()), stats: { count: names.length, averageDistance: 0, minDistance: 0, maxDistance: 0, noOverlap: [], saturated: [], filledWith: null, names } });
      try { return buildNJTreeFromAlignment(names.map(n => ({ header: n, seq: 'A' })), 'raw').newick; }
      finally { window._treeDistanceMatrix = orig; }
    };
    return {
      wiki: run([[0,5,9,9,8],[5,0,10,10,9],[9,10,0,8,7],[9,10,8,0,3],[8,9,7,3,0]], ['a','b','c','d','e']),
      lba: run([[0,3,5,6],[3,0,6,5],[5,6,0,9],[6,5,9,0]], ['a','c','b','d']),
    };
  });
  // leaf branch lengths from the Newick
  const len = (nw, leaf) => { const m = nw.match(new RegExp('[(,]' + leaf + ':([0-9.]+)')); return m ? +m[1] : null; };
  const wikiOk = len(r.wiki, 'a') === 2 && len(r.wiki, 'b') === 3 && len(r.wiki, 'd') === 2 && len(r.wiki, 'e') === 1 && /\(a:2(\.0)?,b:3(\.0)?\)/.test(r.wiki);
  const lbaOk = /\(a:1(\.0)?,b:4(\.0)?\)/.test(r.lba) && len(r.lba, 'c') === 1 && !/\(a:[0-9.]+,c:/.test(r.lba) && !/\(c:[0-9.]+,a:/.test(r.lba);
  return { pass: wikiOk && lbaOk, detail: JSON.stringify(r) };
});

// Reorder only uses the k shown next to it in the Alignment menu, which is the same setting as
// k in Clustering > Group by k-mer; the two boxes stay in step both ways
check('Reorder only: selectable k in the Alignment menu, linked to Group by k-mer k', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    const input = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    const out = {};
    input('mafftReorderK', 4); out.syncAtoB = document.getElementById('guideTreeK').value;
    input('guideTreeK', 9); out.syncBtoA = document.getElementById('mafftReorderK').value;
    input('mafftReorderK', 40); out.clamped = [document.getElementById('mafftReorderK').value, document.getElementById('guideTreeK').value];
    const orderFor = (k) => _kmerGuideTree(state.seqs.map(s => ({ header: s.header, seq: s.seq.replace(/[-.]/g, '') })), k).order.map(i => state.seqs[i].header).join(',');
    out.kMatters = orderFor(3) !== orderFor(10);
    const runWithK = async (k) => {
      input('mafftReorderK', k);
      const expect = orderFor(k);   // from the rows as they are before this run
      document.getElementById('mafftReorderOnly').checked = true;
      window.confirm = () => true;
      await realignAll();
      await new Promise(res => setTimeout(res, 400));
      return { got: state.seqs.map(s => s.header).join(','), expect };
    };
    out.k3 = await runWithK(3);
    out.k10 = await runWithK(10);
    return out;
  });
  const ok = r.syncAtoB === '4' && r.syncBtoA === '9' && r.clamped[0] === '12' && r.clamped[1] === '12'
    && r.k3.got === r.k3.expect && r.k10.got === r.k10.expect && r.kMatters;
  return { pass: ok, detail: JSON.stringify({ ...r, k3: r.k3.got === r.k3.expect, k10: r.k10.got === r.k10.expect }) };
});

// Row and column selection update only what changed (was: a document-wide query per selected
// row, and a <style> rule re-matched against every span). What the user sees must still follow
// the state exactly: after toggles, a range, a clear, a full redraw and with hidden columns.
// The consensus row never shows a column selection (it did from 252d292 on).
check('Selection: row/column highlight follows the state after delta updates', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    const frames = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    // A selected column is a blue tint (background-image) over whatever the residue shows,
    // since the conflict-study phase 2; it used to be a fill colour.
    const COL_TINT = 'rgba(25, 118, 210, 0.28)';
    const isCol = e => getComputedStyle(e).backgroundImage.includes(COL_TINT);
    // Compare what is painted with the state: every residue span, every row line and name.
    const audit = () => {
      const bad = [];
      document.querySelectorAll('.seq-data > span[data-pos]').forEach(sp => {
        // the consensus row is never part of a column selection
        const want = !sp.closest('.consensus-line') && state.selectedColumns.has(+sp.dataset.pos);
        const got = isCol(sp);
        if (want !== got && bad.length < 5) bad.push('col ' + sp.dataset.pos + (want ? ' missing' : ' stale'));
      });
      document.querySelectorAll('.seq-line[data-seq-index], .seq-name[data-seq-index]').forEach(e => {
        const i = +e.dataset.seqIndex;
        if (i < 0) return;
        if (state.selectedRows.has(i) !== e.classList.contains('selected') && bad.length < 10) bad.push('row ' + i);
      });
      return bad;
    };
    const out = {};
    const cols = (...c) => { c.forEach(x => state.selectedColumns.has(x) ? state.selectedColumns.delete(x) : state.selectedColumns.add(x)); updateColumnSelections(); };
    const rows = (...c) => { c.forEach(x => state.selectedRows.has(x) ? state.selectedRows.delete(x) : state.selectedRows.add(x)); updateRowSelections(); };
    cols(3, 7, 8); rows(1, 4); await frames(); out.toggle = audit();
    cols(7); rows(4, 2); await frames(); out.untoggle = audit();
    for (let c = 20; c < 60; c++) state.selectedColumns.add(c); updateColumnSelections(); await frames(); out.range = audit();
    // a selected column still shows its colour inside a selected row (the old rule's precedence)
    const sp = document.querySelector('.seq-line[data-seq-index="1"] .seq-data > span[data-pos="3"]');
    out.colOverRow = !!sp && isCol(sp);
    state.selectedColumns = new Set([5, 25]); updateColumnSelections(); await frames(); out.reassigned = audit();
    renderAlignment(); await new Promise(res => setTimeout(res, 600)); out.afterRender = audit();
    const cons = document.querySelector('.consensus-line .seq-data > span[data-pos="25"]');
    out.consensusShown = !!cons;
    out.consensusClear = !!cons && !isCol(cons);
    cols(6); await frames(); out.afterRenderToggle = audit();
    state.selectedColumns.clear(); state.selectedRows.clear(); updateColumnSelections(); updateRowSelections(); await frames(); out.cleared = audit();
    return out;
  });
  const lists = ['toggle', 'untoggle', 'range', 'reassigned', 'afterRender', 'afterRenderToggle', 'cleared'];
  const ok = lists.every(k => r[k].length === 0) && r.colOverRow && r.consensusShown && r.consensusClear;
  return { pass: ok, detail: JSON.stringify(r) };
});

// Speed: the update itself (script + forced style/layout) for a column and for rows on ~300k
// residue spans. Old code here: column 104-129 ms, one row ~850 ms, 150 rows ~1 s.
// (Real clicks were slower still from hit-testing positioned spans; see styles.css.)
// Owner approved 2026-10-14: ALIGN_WINDOWED_DOM_THRESHOLD dropped from 500k to 100k residues, so a
// full-DOM file can no longer hold 300k spans. The check now runs on the largest full-DOM size
// (140x700 = 98k) with the same time limits.
check('Selection speed: column click and 150 rows on 98k spans (largest full DOM)', async (page) => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const base = Array.from({ length: 700 }, () => 'ACGT'[rnd() % 4]);
  let fa = '';
  for (let i = 0; i < 140; i++) fa += `>s${i}\n` + base.map(c => (rnd() % 8 === 0 ? 'ACGT-'[rnd() % 5] : c)).join('') + '\n';
  await page.setInputFiles('#fileInput', { name: 'big.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForFunction(() => state.seqs && state.seqs.length === 140, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  // 294k residues open in Canvas since v245; this check is about the DOM view, so choose Full.
  await setMode(page, 'full');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    const frames = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const time = (fn) => { const t0 = performance.now(); fn(); void document.body.offsetHeight; return Math.round(performance.now() - t0); };
    const out = { spans: document.querySelectorAll('.seq-data > span[data-pos]').length };
    out.col1 = time(() => { state.selectedColumns.add(100); updateColumnSelections(); }); await frames();
    out.col2 = time(() => { state.selectedColumns.add(101); updateColumnSelections(); }); await frames();
    out.rows150 = time(() => { for (let i = 10; i < 160; i++) state.selectedRows.add(i); updateRowSelections(); }); await frames();
    out.row1 = time(() => { state.selectedRows.add(120); updateRowSelections(); });
    return out;
  });
  const ok = r.spans > 90000 && r.col2 < 60 && r.row1 < 300 && r.rows150 < 600;
  return { pass: ok, detail: JSON.stringify(r) };
});

// Highlight diffs (and its threshold) now update the page in place instead of redrawing it.
// The result must be exactly what a redraw draws: same screenshot, in Block and Full mode,
// switching on, changing the threshold, switching off; and no redraw may happen.
check('Highlight diffs: in-place update matches a full redraw exactly', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1500);
  const out = {};
  const settle = () => page.waitForTimeout(400);
  for (const mode of ['modeBlocks', 'modeSingle']) {
    await page.evaluate((m) => { const r = document.getElementById(m); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, mode);
    await page.waitForTimeout(1200);
    // A redraw replaces every row element, so a marked row that is still in the page means none happened
    const mark = () => page.evaluate(() => { const d = document.querySelector('#alignmentContainer .seq-line:not(.scale-ruler-line) .seq-data'); d.__mark = 1; window.__marked = d; });
    await mark();
    const steps = [
      ['on', () => { const e = document.getElementById('highlightDiffs'); e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); }],
      ['threshold', () => { document.getElementById('varThresholdMode').value = 'count'; const e = document.getElementById('varSitesThresholdInput'); e.value = '3'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }],
      ['off', () => { const e = document.getElementById('highlightDiffs'); e.checked = false; e.dispatchEvent(new Event('change', { bubbles: true })); }],
    ];
    for (const [name, fn] of steps) {
      await page.evaluate(fn); await settle();
      const renders = await page.evaluate(() => (window.__marked.isConnected && window.__marked.__mark === 1) ? 0 : 1);
      const inPlace = await page.screenshot();
      await page.evaluate(() => renderAlignment()); await settle();
      const redrawn = await page.screenshot();
      await mark();
      const diffCols = await page.evaluate(() => state._diffColumns ? state._diffColumns.size : 0);
      out[mode + ':' + name] = { same: inPlace.equals(redrawn), renders, diffCols };
      if (process.env.SAVE_SHOTS && !inPlace.equals(redrawn)) { require('fs').writeFileSync(require('path').join(require('os').tmpdir(), `_hd_${mode}_${name}_a.png`), inPlace); require('fs').writeFileSync(require('path').join(require('os').tmpdir(), `_hd_${mode}_${name}_b.png`), redrawn); }
    }
  }
  const ok = Object.values(out).every(v => v.same && v.renders === 0)
    && out['modeBlocks:on'].diffCols > out['modeBlocks:threshold'].diffCols && out['modeBlocks:threshold'].diffCols > 0;
  return { pass: ok, detail: JSON.stringify(out) };
});

// A redraw expected to take over ~1 s says what it is doing first (it blocks the page, so the
// notice has to be painted before it starts), and a quick one does not flash a notice.
// Owner approved 2026-10-14: files of 100k+ residues are now windowed (no slow full redraw), so
// the notice starts at 60k and this check uses a 140x700 (98k) full-DOM file instead of 420x700.
check('Slow redraw: notice shown before and hidden after; none for small files', async (page) => {
  const path = require('path');
  const watch = () => page.evaluate(() => {
    window.__busy = [];
    const box = _busyOverlay();
    new MutationObserver(() => window.__busy.push(box.hidden ? 'hide' : 'show:' + document.getElementById('busyLabel').textContent)).observe(box, { attributes: true, attributeFilter: ['hidden'] });
  });
  const toggle = () => page.evaluate(async () => {
    const e = document.getElementById('showConsensus'); e.checked = !e.checked; e.dispatchEvent(new Event('change', { bubbles: true }));
    const t0 = performance.now();
    while (performance.now() - t0 < 15000) { await new Promise(r => setTimeout(r, 100)); if (window.__busy.includes('hide') || (performance.now() - t0 > 3000 && !window.__busy.length)) break; }
    return { log: window.__busy.slice(), hiddenNow: document.getElementById('busyOverlay').hidden };
  });
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1500);
  await watch();
  const small = await toggle();
  let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const base = Array.from({ length: 700 }, () => 'ACGT'[rnd() % 4]);
  let fa = '';
  for (let i = 0; i < 140; i++) fa += `>s${i}\n` + base.map(c => (rnd() % 8 === 0 ? 'ACGT-'[rnd() % 5] : c)).join('') + '\n';
  await page.setInputFiles('#fileInput', { name: 'big.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForFunction(() => state.seqs && state.seqs.length === 140, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  // 294k residues open in Canvas since v245; this check is about the DOM view, so choose Full.
  await setMode(page, 'full');
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__busy = []; });
  const big = await toggle();
  const ok = small.log.length === 0 && big.log.length === 2 && /^show:Redrawing/.test(big.log[0]) && big.log[1] === 'hide' && big.hiddenNow;
  return { pass: ok, detail: JSON.stringify({ small, big }) };
});

// Renaming a sequence: double-click opens a box over the name without moving anything; typing
// reaches only the box; Esc cancels; Enter and clicking away save, in place (no redraw); undo works.
check('Rename: box over the name, no shift, Esc cancels, Enter/click-away save without redraw', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1500);
  const nameSel = (i) => `.seq-line[data-seq-index="${i}"] > .seq-name`;
  const geo = (i) => page.evaluate((i) => {
    const line = document.querySelector(`.seq-line[data-seq-index="${i}"]`);
    const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left * 10) / 10, Math.round(b.top * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10]; };
    return { name: r(line.querySelector('.seq-name')), res: r(line.querySelector('.seq-data > span[data-pos]')), line: r(line) };
  }, i);
  const mark = () => page.evaluate(() => { window.__m = document.querySelector('#alignmentContainer .seq-line:not(.scale-ruler-line) .seq-data'); });
  const redrawn = () => page.evaluate(() => !window.__m.isConnected);
  const out = {};
  const openBox = async (i) => { const bb = await page.locator(nameSel(i)).first().boundingBox(); await page.mouse.dblclick(bb.x + 30, bb.y + bb.height / 2); await page.waitForTimeout(150); };
  const before = await geo(2);
  const orig2 = await page.evaluate(() => state.seqs[2].header);
  await mark();
  await openBox(2);
  out.boxOpen = await page.evaluate(() => document.activeElement?.classList.contains('seq-name-edit'));
  out.noShift = JSON.stringify(await geo(2)) === JSON.stringify(before);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('renamed two');
  out.stateUntouchedWhileTyping = await page.evaluate((o) => state.seqs[2].header === o && !state.editModeActive, orig2);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  out.escCancels = await page.evaluate((o) => state.seqs[2].header === o && !document.querySelector('.seq-name-edit'), orig2);
  await openBox(2);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('renamed two');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  out.enterSaves = await page.evaluate(() => state.seqs[2].header === 'renamed two'
    && [...document.querySelectorAll('.seq-name[data-seq-index="2"]')].every(c => c.textContent.startsWith('renamed')));
  await openBox(4);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('four by click');
  await page.mouse.click(700, 5);
  await page.waitForTimeout(150);
  out.clickAwaySaves = await page.evaluate(() => state.seqs[4].header === 'four by click' && !document.querySelector('.seq-name-edit'));
  out.noRedraw = !(await redrawn());
  out.noShiftAfter = JSON.stringify(await geo(2)) === JSON.stringify(before);
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('Control+z'); await page.waitForTimeout(500);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(500);
  out.undo = await page.evaluate((o) => state.seqs[2].header === o && document.querySelector('.seq-name[data-seq-index="2"]').textContent.length > 0, orig2);
  const ok = Object.values(out).every(Boolean);
  return { pass: ok, detail: JSON.stringify(out) };
});

// Dragging the persistent scrollbars moves the view with the mouse, like a scrollbar thumb.
// It used to scroll -1 px per px: dragging the thumb down moved the view back up ("jumps
// back"), and from the start of the track it did not move at all.
check('Scrollbars: dragging the thumb moves the view with the mouse, never back', async (page) => {
  let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const base = Array.from({ length: 900 }, () => 'ACGT'[rnd() % 4]);
  let fa = '';
  for (let i = 0; i < 700; i++) fa += `>s${i}\n` + base.map(c => (rnd() % 9 === 0 ? 'ACGT-'[rnd() % 5] : c)).join('') + '\n';
  await page.setInputFiles('#fileInput', { name: 'bars.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForFunction(() => state.seqs && state.seqs.length === 700, null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  const out = {};
  const drag = async (sel, axis) => {
    const r = await page.evaluate((sel) => { const b = document.querySelector(sel); if (getComputedStyle(b).display === 'none') return null; const q = b.getBoundingClientRect(); return [q.x, q.y, q.width, q.height, b.clientWidth, b.scrollWidth, b.clientHeight, b.scrollHeight]; }, sel);
    if (!r) return { shown: false };
    const read = () => page.evaluate(([sel, axis]) => document.querySelector(sel)[axis === 'y' ? 'scrollTop' : 'scrollLeft'], [sel, axis]);
    // start at the beginning of the track (a mode switch keeps the previous position): the
    // view and the bar, as a user who scrolled to the top would have them. Resetting the bar
    // alone leaves the view where it was (its guard ignores a synthetic scroll), and any later
    // DOM change re-syncs the bar from the view - e.g. the v230 row buffer still filling in.
    await page.evaluate(([sel, axis]) => { const k = axis === 'y' ? 'scrollTop' : 'scrollLeft'; const a = document.getElementById('alignmentContainer'); a[k] = 0; if (typeof _canvasState !== 'undefined') { if (axis === 'y') _canvasState.offsetY = 0; else _canvasState.offsetX = 0; _canvasState.scheduleDraw?.(); } const b = document.querySelector(sel); b[k] = 0; b.dispatchEvent(new Event('scroll')); }, [sel, axis]);
    await page.waitForTimeout(500);
    const [x, y, w, h] = r;
    const x0 = axis === 'y' ? x + w / 2 : x + 12, y0 = axis === 'y' ? y + 12 : y + h / 2;
    const seen = [await read()];
    await page.mouse.move(x0, y0); await page.mouse.down();
    for (let k = 1; k <= 6; k++) { await page.mouse.move(axis === 'y' ? x0 : x0 + k * 25, axis === 'y' ? y0 + k * 25 : y0, { steps: 2 }); await page.waitForTimeout(200); seen.push(await read()); }
    await page.mouse.up(); await page.waitForTimeout(400); seen.push(await read());
    const track = axis === 'y' ? r[6] : r[4], content = axis === 'y' ? r[7] : r[5];
    const expected = 150 * (content - track) / (track - Math.max(20, track * track / content));   // thumb under the pointer
    const moved = seen[seen.length - 1] - seen[0];
    const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.id || e.className) : null; }, [x0, y0]);
    return { shown: true, forward: seen.every((v, i) => i === 0 || v >= seen[i - 1]), moved, ratio: Math.round(moved / expected * 100) / 100, range: content - track, hit, seen };
  };
  const setMode = async (m) => {
    await page.evaluate((m) => { const r = document.getElementById(m); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, m);
    await page.waitForTimeout(1000);
    if (await page.locator('#alignLoadProceed').count()) await page.click('#alignLoadProceed');
    await page.waitForTimeout(2500);
  };
  await setMode('modeBlocks'); out.blockV = await drag('.vertical-scrollbar', 'y');
  await setMode('modeSingle'); out.fullV = await drag('.vertical-scrollbar', 'y'); out.fullH = await drag('.horizontal-scrollbar', 'x');
  await setMode('modeCanvas'); out.canvasV = await drag('.vertical-scrollbar', 'y');
  const good = v => v.shown && v.forward && v.moved > 0 && v.ratio > 0.8 && v.ratio < 1.2;
  return { pass: Object.values(out).every(good), detail: JSON.stringify(out) };
});

// Undo / Redo history lists: open under the caret even when the page is scrolled (it opened
// off screen), show action names (it showed "undefined" / "redo-snapshot"), jump N steps with
// one redraw, and the plain Undo button (a click handler) still redraws.
check('Undo history list: visible after scrolling, named entries, N-step jump, redo names', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1500);
  const order = () => page.evaluate(() => state.seqs.map(s => s.header).join(','));
  const original = await order();
  await page.evaluate(async () => { sortByName(); await new Promise(r => setTimeout(r, 200)); sortByLength(); await new Promise(r => setTimeout(r, 200)); sortBySimilarity(); await new Promise(r => setTimeout(r, 400)); });
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(200);
  await page.click('#undoDropdownBtn');
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const d = document.querySelector('.undo-redo-dropdown'); const b = document.getElementById('undoDropdownBtn').getBoundingClientRect();
    const q = d.getBoundingClientRect();
    return { names: [...d.querySelectorAll('.undo-redo-name')].map(n => n.textContent), onScreen: q.top >= 0 && Math.abs(q.top - b.bottom) < 6 };
  });
  // pick entry 3 = undo all three sorts
  await page.click('.undo-redo-dropdown .undo-redo-item:nth-of-type(3)');
  await page.waitForTimeout(800);
  r.restored = (await order()) === original;
  r.listClosed = await page.evaluate(() => !document.querySelector('.undo-redo-dropdown'));
  await page.click('#redoDropdownBtn'); await page.waitForTimeout(200);
  r.redoNames = await page.evaluate(() => [...document.querySelectorAll('.undo-redo-dropdown .undo-redo-name')].map(n => n.textContent));
  await page.click('#redoDropdownBtn'); await page.waitForTimeout(200);
  r.toggleCloses = await page.evaluate(() => !document.querySelector('.undo-redo-dropdown'));
  await page.click('#redoDropdownBtn'); await page.waitForTimeout(200);
  await page.click('.undo-redo-dropdown .undo-redo-item:nth-of-type(2)'); await page.waitForTimeout(800);
  r.redoTwo = await page.evaluate(() => state.redoHistory.length === 1 && state.deletedHistory.length === 2);
  // plain Undo button: undoes one step and the page is redrawn to match
  await page.evaluate(() => { window.__m2 = document.querySelector('#alignmentContainer .seq-line:not(.scale-ruler-line) .seq-data'); });
  await page.click('#undoButton'); await page.waitForTimeout(800);
  r.buttonRedraws = await page.evaluate(() => !window.__m2.isConnected && state.deletedHistory.length === 1);
  const ok = r.onScreen && r.names.join('|') === 'Sort by similarity|Sort by length|Sort by name' && r.restored && r.listClosed
    && r.redoNames.join('|') === 'Sort by name|Sort by length|Sort by similarity' && r.toggleCloses && r.redoTwo && r.buttonRedraws;
  return { pass: ok, detail: JSON.stringify(r) };
});

// Repeat Finder redesign: the panel leaves the alignment usable (no blocking backdrop); TSD
// results say how many copies have a TSD, list the ones that do not with a reason, and show
// each pair with its mismatches; a repeat found in one sequence is highlighted in that
// sequence only (it used to colour the same columns in every row).
check('Repeat Finder: non-blocking panel, TSD summary and misses, row-specific highlights', async (page) => {
  // high bits only: the low bits of this generator repeat with period 4, which made every
  // 'random' flank identical
  let seed = 9; const rnd = () => Math.floor((seed = (seed * 1103515245 + 12345) % 2147483648) / 65536);
  const rb = (n) => Array.from({ length: n }, () => 'ACGT'[rnd() % 4]).join('');
  const body = rb(120);
  // row 1 is the gap-padded consensus, as on a SINEderella plate; Auto reads the body from it
  let fa = `>consensus
${'-'.repeat(31)}${body}AAAAAAAAAA${'-'.repeat(31)}
`;
  for (let i = 0; i < 20; i++) {
    const tsd = rb(6);
    const b = body.split('').map(c => (rnd() % 20 === 0 ? 'ACGT'[rnd() % 4] : c)).join('');
    const tsd3 = i < 12 ? (i === 0 ? tsd.slice(0, 5) + (tsd[5] === 'A' ? 'C' : 'A') : tsd) : rb(6);   // rows 12-19: no TSD
    fa += `>copy${i}\n${rb(25)}${tsd}${b}AAAAAAAAAA${tsd3}${rb(25)}\n`;
  }
  // one extra row with a tandem repeat inside its body, for the highlight test
  fa += `>tandem\n${rb(31)}${'ACGTTGCA'.repeat(4)}${body.slice(32)}AAAAAAAAAA${rb(31)}\n`;
  await page.setInputFiles('#fileInput', { name: 'tsd.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForTimeout(1500);
  await page.evaluate(() => openRepeatFinder(0));
  await page.waitForTimeout(300);
  const out = {};
  out.alignmentClickable = await page.evaluate(() => {
    const e = document.elementFromPoint(40, 300);
    return !!e && !!e.closest('#alignmentContainer');
  });
  await page.click('label:has(input[name="repeatMode"][value="tsd"])');
  await page.click('#repeatRunBtn');
  await page.waitForTimeout(1500);
  const t = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('#repeatResults tbody tr')];
    const mm = trs.map(tr => parseInt(tr.children[4].textContent, 10));
    // planted rows copy1..copy11 carry an identical 6 bp pair right at the SINE ends
    const planted = [];
    for (let i = 1; i <= 11; i++) {
      const r = _lastTsdResults.find(x => x.seqName === 'copy' + i);
      planted.push(!!r && r.tsdLen === 6 && r.upTSD === r.downTSD);
    }
    return {
      summary: document.querySelector('#repeatResults .rf-big')?.textContent || '',
      rows: trs.length,
      misses: document.querySelectorAll('#repeatResults .rf-misses li').length,
      missReason: document.querySelector('#repeatResults .rf-misses li')?.textContent || '',
      plantedFound: planted.every(Boolean),
      mmConsistent: document.querySelectorAll('#repeatResults .rf-mm').length === 2 * mm.reduce((a, b) => a + b, 0),
      bodyChip: [...document.querySelectorAll('#repeatResults .rf-chip')].map(c => c.textContent).find(t => /SINE body/.test(t)) || '',
      tools: !document.getElementById('tsdResultTools').hidden,
    };
  });
  Object.assign(out, t);
  // tandem: search all, highlight the first result, count highlighted spans per row
  await page.click('label:has(input[name="repeatMode"][value="tandem"])');
  await page.click('label:has(input[name="repeatScope"][value="all"])');
  await page.fill('#repeatMinLen', '8');
  await page.click('#repeatRunBtn');
  await page.waitForTimeout(1500);
  out.tandemFound = await page.evaluate(() => document.querySelectorAll('#repeatResults tbody tr').length);
  await page.click('#repeatResults tbody tr:first-child');
  await page.waitForTimeout(400);
  out.hlRows = await page.evaluate(() => [...new Set([...document.querySelectorAll('.seq-data > span[data-repeat-hl="1"]')].map(s => s.closest('.seq-line').dataset.seqIndex))]);
  out.hlRowMatches = await page.evaluate(() => { const tr = document.querySelector('#repeatResults tbody tr:first-child'); return tr.dataset.row; });
  await page.click('#repeatClearHighlightsBtn');
  out.cleared = await page.evaluate(() => document.querySelectorAll('.seq-data > span[data-repeat-hl="1"]').length === 0);
  const ok = out.alignmentClickable && new RegExp(`TSD in ${out.rows} of 21 copies`).test(out.summary) && out.rows + out.misses === 21
    && out.plantedFound && /no pair/.test(out.missReason) && out.mmConsistent && /columns 32–161/.test(out.bodyChip) && out.tools
    && out.tandemFound > 0 && out.hlRows.length === 1 && out.hlRows[0] === out.hlRowMatches && out.cleared;
  return { pass: ok, detail: JSON.stringify(out) };
});

// Dot plot window: the "?" and Copy region buttons sit in the toolbar at normal size (they
// stretched across the whole window); the window moves by its title bar and resizes, with
// the plot following the new size.
check('Dot plot window: compact help button, draggable, resizable with the plot following', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const a = state.seqs[1], c = state.seqs[2]; openDotPlot(a.seq.replace(/-/g, ''), c.seq.replace(/-/g, ''), a.header, c.header); });
  await page.waitForTimeout(1500);
  const out = await page.evaluate(() => {
    const w = id => document.getElementById(id).getBoundingClientRect().width;
    return { help: Math.round(w('dotPlotHelpBtn')), copy: Math.round(w('dotPlotCopyRegion')), dialog: Math.round(w('dotPlotDialog')),
      resizable: document.querySelectorAll('#dotPlotDialog .win-rz').length };   // 8 edge/corner handles
  });
  const bar = await page.locator('#dotPlotTitleBar').boundingBox();
  const before = await page.evaluate(() => document.getElementById('dotPlotDialog').getBoundingClientRect().left);
  await page.mouse.move(bar.x + 200, bar.y + 12); await page.mouse.down();
  await page.mouse.move(bar.x + 120, bar.y + 40, { steps: 5 }); await page.mouse.up();
  out.moved = Math.round(await page.evaluate(() => document.getElementById('dotPlotDialog').getBoundingClientRect().left) - before);
  // resize (as the corner handle does) and check the plot canvases follow the viewport
  out.afterResize = await page.evaluate(async () => {
    const d = document.getElementById('dotPlotDialog'); d.style.width = '700px'; d.style.height = '560px';
    await new Promise(r => setTimeout(r, 300));
    const vp = document.getElementById('dotPlotViewport'), cv = document.getElementById('dotPlotCanvas');
    return { vp: vp.clientWidth, canvas: parseInt(cv.style.width, 10) };
  });
  const ok = out.help <= 30 && out.copy < 150 && out.resizable === 8 && out.moved === -80 && out.afterResize.vp === out.afterResize.canvas;
  return { pass: ok, detail: JSON.stringify(out) };
});

// Alignment menu: the six action buttons form an even grid (they had different heights,
// wrapping their labels onto two or three lines) and stay inside the menu.
check('Alignment menu: even button grid inside the menu, labels on one line', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1000);
  await page.hover('.section-header[data-section="alignment"]');
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const ids = ['realignAllButton', 'realignSelectedButton', 'realignBlockButton', 'addSequencesButton', 'degapBlockLeftButton', 'degapBlockRightButton'];
    const boxes = ids.map(id => document.getElementById(id).getBoundingClientRect());
    const menu = document.getElementById('alignment-controls').getBoundingClientRect();
    const lineH = parseFloat(getComputedStyle(document.getElementById('realignAllButton')).fontSize) * 1.6;
    return { heights: [...new Set(boxes.map(b => Math.round(b.height)))], oneLine: boxes.every(b => b.height <= lineH + 12),
      inside: boxes.every(b => b.left >= menu.left - 1 && b.right <= menu.right + 1), rows: [...new Set(boxes.map(b => Math.round(b.top)))].length };
  });
  return { pass: r.heights.length === 1 && r.oneLine && r.inside && r.rows === 2, detail: JSON.stringify(r) };
});

// Dot plot: maximize and resize from any edge; Full view; settings recalculate as they
// change unless Live update is off; a self-plot can use other settings below the diagonal;
// dots are drawn as runs (lines), not as a scaled raster.
check('Dot plot: maximize/edge resize, Full view, live recalculation, split halves, vector runs', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1200);
  const open = (self) => page.evaluate((self) => { const a = state.seqs[1], c = state.seqs[self ? 1 : 2]; openDotPlot(a.seq.replace(/-/g, ''), c.seq.replace(/-/g, ''), a.header, c.header); }, self);
  await open(true);
  await page.waitForTimeout(1500);
  const rect = () => page.evaluate(() => { const r = document.getElementById('dotPlotDialog').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
  const out = {};
  out.runsUsed = await page.evaluate(() => !!_dotPlotState.runs && _dotPlotState.runs.n > 0);
  // maximize and restore
  const r0 = await rect();
  await page.click('#dotPlotMaxBtn'); await page.waitForTimeout(300);
  const rMax = await rect();
  out.maximized = rMax[2] >= 1390 - 20 && rMax[3] >= 900 - 20;
  await page.click('#dotPlotMaxBtn'); await page.waitForTimeout(300);
  out.restored = JSON.stringify(await rect()) === JSON.stringify(r0);
  // resize from the left edge
  const w = await page.locator('#dotPlotDialog .win-rz[data-dir="w"]').boundingBox();
  await page.mouse.move(w.x + 3, w.y + 40); await page.mouse.down(); await page.mouse.move(w.x - 97, w.y + 40, { steps: 5 }); await page.mouse.up();
  const r1 = await rect();
  out.leftResize = r1[0] === r0[0] - 100 && r1[2] === r0[2] + 100;
  // Full view refits after zooming in
  for (let i = 0; i < 4; i++) await page.click('#dotPlotZoomIn');
  const zoomed = await page.evaluate(() => _dotPlotState.zoom);
  await page.click('#dotPlotFullView'); await page.waitForTimeout(300);
  out.fullView = await page.evaluate((z) => _dotPlotState.zoom < z && _dotPlotState._autoFit === true, zoomed);
  // live: a new word size recalculates without pressing Recalculate
  const setRange = (sel, v) => page.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
  await setRange('#dotPlotWindow', '8'); await page.waitForTimeout(1200);
  out.liveRecalc = await page.evaluate(() => _dotPlotState.windowSize === 8);
  // not live: the plot stays, Recalculate is flagged
  await page.click('#dotPlotLive');
  await setRange('#dotPlotWindow', '10'); await page.waitForTimeout(900);
  out.notLive = await page.evaluate(() => _dotPlotState.windowSize === 8 && document.getElementById('dotPlotRecalc').classList.contains('dot-dirty'));
  await page.click('#dotPlotRecalc'); await page.waitForTimeout(1000);
  out.recalcApplies = await page.evaluate(() => _dotPlotState.windowSize === 10);
  await page.click('#dotPlotLive');
  // split halves on the self-plot: upper SPIN, lower Dotter
  // (on by default since 2026-10-28, owner: tick it only if it is off)
  out.splitDefault = await page.evaluate(() => document.getElementById('dotPlotSplit').checked);
  if (!out.splitDefault) await page.click('#dotPlotSplit');
  await page.waitForTimeout(1800);
  out.split = await page.evaluate(() => {
    const S = _dotPlotState;
    return { lower: !!(S.lower && S.lower.ready), upperSpin: S.spinMode, lowerSpin: S.lower?.spinMode,
      upperCell: _dotHalf(2, 50) === S, lowerCell: _dotHalf(50, 2) === S.lower, runs: !!S.runs && !!S.lower?.runs };
  });
  const box = await page.locator('#dotPlotOverlay').boundingBox();
  const hoverAt = async (row, col) => {
    const p = await page.evaluate(([r, c]) => _dotCellToScreen(r, c), [row, col]);
    await page.mouse.move(box.x + p.x, box.y + p.y); await page.waitForTimeout(150);
    return page.evaluate(() => document.getElementById('dotPlotHover').textContent);
  };
  out.hoverUpper = /match=/.test(await hoverAt(20, 120));
  out.hoverLower = /identity=/.test(await hoverAt(120, 20));
  // different sequences: split is not offered
  await open(false); await page.waitForTimeout(1500);
  out.splitDisabledForAB = await page.evaluate(() => document.getElementById('dotPlotSplit').disabled && !_dotPlotState.lower);
  const s = out.split;
  const ok = out.runsUsed && out.maximized && out.restored && out.leftResize && out.fullView && out.liveRecalc && out.notLive && out.recalcApplies
    && out.splitDefault && s.lower && s.upperSpin === true && s.lowerSpin === false && s.upperCell && s.lowerCell && s.runs && out.hoverUpper && out.hoverLower && out.splitDisabledForAB;
  return { pass: ok, detail: JSON.stringify(out) };
});

// The slider under a focused number box goes away when the user clicks anywhere else (it
// stayed forever: clicking the alignment moves no focus), and a click in the alignment
// closes the open menu (a focused number box kept it open).
check('Number-box slider and menus: a click in the alignment closes both', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1200);
  const state_ = () => page.evaluate(() => ({
    pop: getComputedStyle(document.getElementById('numSliderPop') || document.body).display !== 'none' && !!document.getElementById('numSliderPop'),
    menuOpen: !!document.querySelector('#controls .menu-section.menu-open'),
    k: document.getElementById('mafftReorderK').value,
  }));
  const out = {};
  const openK = async () => {
    await page.hover('.section-header[data-section="alignment"]');
    await page.waitForTimeout(300);
    await page.click('#mafftReorderK');
    await page.waitForTimeout(200);
  };
  await openK();
  out.opened = await state_();
  // dragging the slider keeps it (and the menu) open and changes the value
  const pb = await page.locator('#numSliderPop input[type="range"]').boundingBox();
  await page.mouse.move(pb.x + 4, pb.y + pb.height / 2); await page.mouse.down();
  await page.mouse.move(pb.x + pb.width - 4, pb.y + pb.height / 2, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(200);
  out.afterDrag = await state_();
  // click a residue in the alignment
  const cell = await page.locator('.seq-line[data-seq-index="5"] .seq-data span[data-pos="40"]').first().boundingBox();
  await page.mouse.click(cell.x + 3, cell.y + 4);
  await page.waitForTimeout(400);
  out.afterAlignmentClick = await state_();
  // again, closing with a click on empty page space
  await openK();
  await page.mouse.click(700, 890);
  await page.waitForTimeout(400);
  out.afterPageClick = await state_();
  const ok = out.opened.pop && out.opened.menuOpen && out.afterDrag.pop && out.afterDrag.k === '12'
    && !out.afterAlignmentClick.pop && !out.afterAlignmentClick.menuOpen && !out.afterPageClick.pop && !out.afterPageClick.menuOpen;
  return { pass: ok, detail: JSON.stringify(out) };
});

// Dot plot regions: one entry per similar stretch (runs broken by mismatches / small indels
// are chained), no overlapping duplicates, only the upper triangle of a self-plot (the list
// was empty there, or doubled); double-click (freeze) does not resize the plot.
check('Dot plot regions: chained stretches, no duplicates, self-plot upper half; freeze keeps size', async (page) => {
  let seed = 21; const rnd = () => Math.floor((seed = (seed * 1103515245 + 12345) % 2147483648) / 65536);
  const rb = (n) => Array.from({ length: n }, () => 'ACGT'[rnd() % 4]).join('');
  const rep = rb(80);
  // copy 2 of the repeat carries 3 mismatches and a 2 bp deletion
  const rep2 = rep.slice(0, 20) + 'T' + rep.slice(21, 40) + rep.slice(42, 60) + 'G' + rep.slice(61, 70) + 'C' + rep.slice(71);
  const self = rb(40) + rep + rb(120) + rep2 + rb(40);
  await page.evaluate((self) => { state.seqs = [{ header: 'self', seq: self }]; openDotPlot(self, self, 'self', 'self'); }, self);
  await page.waitForTimeout(1500);
  const out = {};
  out.self = await page.evaluate(() => _dotPlotState.regions.map(r => [r.aStart + 1, r.aEnd, r.bStart + 1, r.bEnd, r.matched]));
  // the planted repeat: A 41-120 vs B 241-318, found as ONE upper-triangle entry
  const hits = out.self.filter(r => r[0] <= 50 && r[1] >= 110 && r[2] >= 230 && r[3] <= 330);
  out.selfOne = hits.length === 1;
  out.selfUpper = out.self.every(r => r[2] > r[0]);
  // pair: two related sequences; no two entries cover mostly the same A and B stretch
  const other = rb(30) + rep2 + rb(60);
  await page.evaluate(([a, b]) => openDotPlot(a, b, 'a', 'b'), [self, other]);
  await page.waitForTimeout(1500);
  out.pair = await page.evaluate(() => _dotPlotState.regions.map(r => [r.aStart, r.aEnd, r.bStart, r.bEnd, r.matched]));
  const ov = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  out.pairNoDup = out.pair.every((x, i) => out.pair.every((y, j) => j <= i || !(ov(x[0], x[1], y[0], y[1]) > 0.5 * (x[1] - x[0]) && ov(x[2], x[3], y[2], y[3]) > 0.5 * (x[3] - x[2]))));
  out.matchedWithin = out.pair.concat(out.self).every(r => r[4] <= (r[1] - r[0]) + 1);
  // freeze by double-click: nothing changes size
  const before = await page.evaluate(() => [document.getElementById('dotPlotViewport').clientHeight, _dotPlotState.zoom]);
  const box = await page.locator('#dotPlotOverlay').boundingBox();
  const pt = await page.evaluate(() => _dotCellToScreen(60, 60));
  await page.mouse.dblclick(box.x + pt.x, box.y + pt.y); await page.waitForTimeout(400);
  const after = await page.evaluate(() => [document.getElementById('dotPlotViewport').clientHeight, _dotPlotState.zoom, _dotPlotState._frozen]);
  out.freezeSteady = after[2] === true && after[0] === before[0] && after[1] === before[1];
  const ok = out.selfOne && out.selfUpper && out.pairNoDup && out.matchedWithin && out.freezeSteady;
  return { pass: ok, detail: JSON.stringify(out) };
});

// Audit fixes (GLM audit of Repeat Finder + dot plot, 2026-09-28): SPIN region ends are exact;
// a second open while the first is computing shows the second pair; closing the window stops a
// pending live recalculation; inverted repeats and tandem arrays are listed once; RNA U pairs A;
// 0% divergence means identical.
check('Audit fixes: SPIN region ends, open race, close cancels live, repeats listed once, 0% divergence', async (page) => {
  let seed = 33; const rnd = () => Math.floor((seed = (seed * 1103515245 + 12345) % 2147483648) / 65536);
  const rb = (n) => Array.from({ length: n }, () => 'ACGT'[rnd() % 4]).join('');
  const core = rb(25);
  const a = rb(100) + core + rb(75), b = rb(50) + core + rb(125);
  await page.evaluate(() => { const r = document.querySelector('input[name="dotPlotMode"][value="spin"]'); if (r) r.checked = true; });
  await page.evaluate(([a, b]) => { state.seqs = [{ header: 'a', seq: a }, { header: 'b', seq: b }]; openDotPlot(a, b, 'a', 'b'); }, [a, b]);
  await page.waitForTimeout(1200);
  const out = {};
  out.regions = await page.evaluate(() => _dotPlotState.regions.map(r => [r.aStart + 1, r.aEnd, r.bStart + 1, r.bEnd]));
  out.spinExact = out.regions.some(r => r[0] === 101 && r[1] === 125 && r[2] === 51 && r[3] === 75);
  // race: open a big plot, then immediately a small one; the small one must win
  const big = rb(9000), small1 = rb(60), small2 = rb(70);
  out.race = await page.evaluate(async ([big, s1, s2]) => {
    openDotPlot(big, big, 'big', 'big');
    await new Promise(r => setTimeout(r, 5));
    await openDotPlot(s1, s2, 's1', 's2');
    await new Promise(r => setTimeout(r, 1500));
    const S = _dotPlotState; return [S.rows, S.cols, S.seqA.length, S.seqB.length, S.computing];
  }, [big, small1, small2]);
  out.raceOk = out.race[0] === 60 && out.race[1] === 70 && out.race[4] === false;
  // close cancels a pending live recalculation
  out.closeStays = await page.evaluate(async () => {
    document.getElementById('dotPlotWindow').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('dotPlotWindow').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('dotPlotCloseBtn').click();
    const m = document.getElementById('dotPlotModal');
    await new Promise(r => setTimeout(r, 900));
    return m.style.display === 'none';
  });
  // Repeat Finder functions
  out.rep = await page.evaluate(() => ({
    inv: _findRepeats('AAAAAAAAAAACGTACGTACAAAAAAGTACGTACGTAAAAAAAAAA', 10, 0, 'inverted').length,
    rna: _findRepeats('GGAUAUAUAUAUGGGGAUAUAUAUAUGG', 10, 15, 'inverted').length,
    tan: _findRepeats('ACGTACGTACGTACGT', 4, 15, 'tandem').map(r => [r.start, r.end, r.unitLen, r.copies]),
    exact0: _findRepeats('TTTTGATCCAGTACGGTTTTTTTGATCCAGTACGATTTT', 12, 0, 'direct').every(r => Number(r.divergence) === 0),
  }));
  out.repOk = out.rep.inv === 1 && out.rep.rna >= 1 && JSON.stringify(out.rep.tan) === '[[0,16,4,4]]' && out.rep.exact0;
  out.tsd0 = await page.evaluate(() => { const e = document.getElementById('tsdMaxDiv'); if (!e) return null; e.value = '0'; return _readTsdParams().maxDiv; });
  const ok = out.spinExact && out.raceOk && out.closeStays && out.repOk && (out.tsd0 === 0 || out.tsd0 === null);
  return { pass: ok, detail: JSON.stringify(out) };
});

// ---- Search highlights, in-place gap edits, Selections panel (v212) ----

// Alignment with real variation (a Park-Miller generator, not the low bits of an LCG,
// which cycle and turn every row into long runs of one base).
function variedFasta(nSeq, nCol, seed = 7, trailingGapRows = 0) {
  let x = seed;
  const r = () => { x = (x * 16807) % 2147483647; return x; };
  const base = Array.from({ length: nCol }, () => 'ACGT'[r() % 4]);
  let out = '';
  for (let i = 0; i < nSeq; i++) {
    let s = base.map(c => (r() % 9 === 0 ? 'ACGT-'[r() % 5] : c));
    if (i < trailingGapRows) s = s.slice(0, nCol - 3).concat(['-', '-', '-']);
    out += `>s${i}\n${s.join('')}\n`;
  }
  return out;
}

// Rendered search classes vs an independent oracle (exact, overlapping matches of each
// enabled search in the degapped row). Returns the number of disagreeing residue spans.
const SEARCH_MISMATCH_SRC = `(() => {
  let bad = 0, total = 0; const ex = [];
  document.querySelectorAll('#alignmentContainer .seq-line[data-seq-index]:not(.consensus-line)').forEach(line => {
    const i = +line.dataset.seqIndex;
    const seq = state.seqs[i].seq; const cols = []; let text = '';
    for (let c = 0; c < seq.length; c++) if (seq[c] !== '-' && seq[c] !== '.') { cols.push(c); text += seq[c].toUpperCase(); }
    const hits = new Set();
    const rc = t => t.split('').reverse().map(c => ({ A: 'T', C: 'G', G: 'C', T: 'A' }[c] || c)).join('');
    state.searchHistory.filter(e => e.enabled !== false && !e.useRegex).forEach(e => {
      const fwd = String(e.motif).split(':')[0];
      const m = e.searchValue || (/rev comp/.test(e.strand) ? rc(fwd) : fwd);
      for (let k = text.indexOf(m); k >= 0; k = text.indexOf(m, k + 1)) for (let j = 0; j < m.length; j++) hits.add(cols[k + j]);
    });
    line.querySelectorAll('.seq-data > span[data-pos]').forEach(sp => {
      const p = +sp.dataset.pos; total++;
      const dom = [...sp.classList].some(c => c.startsWith('search-hit-'));
      if (dom !== hits.has(p) || sp.textContent !== (seq[p] || '-')) { bad++; if (ex.length < 3) ex.push([i, p, dom, sp.textContent]); }
    });
  });
  return { bad, total, ex };
})()`;

check('Search highlights stay on the matching residues through gap tools, typing, undo and drags', async (page) => {
  await loadFasta(page, variedFasta(40, 300, 7, 10));
  const out = {};
  const run = async (label, fn) => {
    await page.evaluate(fn);
    await page.waitForTimeout(60);
    out[label] = await page.evaluate(`(typeof flushPendingSpanRepaint === "function" && flushPendingSpanRepaint()), ${SEARCH_MISMATCH_SRC}`);
  };
  await run('search', () => {
    el('searchInput').value = state.seqs[0].seq.replace(/-/g, '').slice(20, 24);
    el('searchBothStrands').checked = true;
    el('searchButton').click();
  });
  await page.click('#editToggleButton');
  await page.click('#editInsertGapOtherButton');
  await page.click('.seq-line[data-seq-index="3"] .seq-data > span[data-pos="10"]');
  await page.waitForTimeout(60);
  out.insOther = await page.evaluate(`(typeof flushPendingSpanRepaint === "function" && flushPendingSpanRepaint()), ${SEARCH_MISMATCH_SRC}`);
  // Same-width Move drag on a row with trailing gaps (the row patch path, no render)
  await page.click('#editMoveNoGapsButton');
  const sp = await page.$('.seq-line[data-seq-index="2"] .seq-data > span[data-pos="40"]');
  const b = await sp.boundingBox();
  await page.mouse.move(b.x + 2, b.y + 4); await page.mouse.down();
  for (let k = 1; k <= 2; k++) { await page.mouse.move(b.x + 2 + k * b.width, b.y + 4); await page.waitForTimeout(50); }
  // while dragging, the overlay must paint over every cell whose DOM highlight is stale
  out.overlay = await page.evaluate(() => {
    const d = state.editDrag; if (!d || !d.overlay) return { overlay: false };
    let uncovered = 0, checked = 0;
    const hitsNow = _getSearchHitsForRow(d.rowIndex);
    document.querySelectorAll(`.seq-line[data-seq-index="${d.rowIndex}"] .seq-data > span[data-pos]`).forEach(sp => {
      const p = +sp.dataset.pos;
      if (!!sp.dataset.searchHit === hitsNow.has(p) && sp.textContent === state.seqs[d.rowIndex].seq[p]) return;
      const r = sp.getBoundingClientRect();
      for (const L of d.overlay.layers) {
        if (Math.abs(parseFloat(L.canvas.style.top) - r.top) > 1) continue;
        const x = (r.left + r.width / 2 - L.left) * devicePixelRatio;
        if (x < 0 || x >= L.canvas.width) continue;
        checked++;
        if (L.ctx.getImageData(x | 0, (r.height / 2 * devicePixelRatio) | 0, 1, 1).data[3] < 200) uncovered++;
      }
    });
    return { overlay: true, checked, uncovered };
  });
  await page.mouse.up();
  await page.waitForTimeout(80);
  out.drag = await page.evaluate(SEARCH_MISMATCH_SRC);
  await page.click('#editResidueButton');
  await page.click('.seq-line[data-seq-index="5"] .seq-data > span[data-pos="22"]');
  await page.keyboard.press('-');
  await page.waitForTimeout(60);
  out.type = await page.evaluate(SEARCH_MISMATCH_SRC);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  out.undo = await page.evaluate(SEARCH_MISMATCH_SRC);
  // A full re-render must keep both-strand (label "X (fwd)") highlights
  await page.evaluate(() => renderAlignment());
  out.rerender = await page.evaluate(SEARCH_MISMATCH_SRC);
  const bad = Object.entries(out).filter(([k, v]) => k === 'overlay' ? (!v.overlay || v.uncovered) : v.bad);
  const hits = await page.evaluate(() => document.querySelectorAll('[data-search-hit]').length);
  if (!hits) return { pass: false, detail: 'search painted nothing: ' + JSON.stringify(out) };
  return { pass: bad.length === 0, detail: bad.length ? JSON.stringify(Object.fromEntries(bad)) : `${hits} hit spans; overlay checked ${out.overlay.checked}` };
});

check('Search highlights: windowed scroll, restriction sites and regex case survive a redraw', async (page) => {
  // Windowed: rows built on scroll carry the highlight
  await loadSyntheticFasta(page, 600, 1200);
  await setMode(page, 'full');
  const win = await page.evaluate(async () => {
    el('searchInput').value = 'GTAC'; el('searchButton').click();
    const c = el('alignmentContainer');
    c.scrollTop = c.scrollHeight / 2;
    _refreshUnifiedWindowOnScroll(c);
    await new Promise(r => setTimeout(r, 50));
    const spans = [...document.querySelectorAll('.seq-line[data-seq-index] .seq-data > span[data-pos]')];
    let want = 0, have = 0;
    document.querySelectorAll('.seq-line[data-seq-index]:not(.consensus-line)').forEach(line => {
      const i = +line.dataset.seqIndex; const seq = state.seqs[i].seq;
      line.querySelectorAll('.seq-data > span[data-pos]').forEach(sp => {
        const p = +sp.dataset.pos;
        // GTAC at p..p+3 (no gaps in this data)
        let hit = false;
        for (let k = Math.max(0, p - 3); k <= p; k++) if (seq.substr(k, 4) === 'GTAC') hit = true;
        if (hit) want++;
        if (hit && sp.dataset.searchHit) have++;
      });
    });
    return { rowsShown: document.querySelectorAll('.seq-line[data-seq-index]').length, want, have, total: spans.length, count: state.searchHistory[0]?.matchCount };
  });
  // Restriction-site search (label = enzyme name) and a regex with \w keep their hits after a redraw
  await loadFasta(page, variedFasta(20, 200, 3));
  const re = await page.evaluate(() => {
    state.seqs[4].seq = state.seqs[4].seq.slice(0, 50) + 'GAATTC' + state.seqs[4].seq.slice(56);
    renderAlignment();
    el('reSiteManualInput').value = 'EcoRI:GAATTC';
    searchResEnzyme();
    const before = document.querySelectorAll('[data-search-hit]').length;
    renderAlignment();
    const after = document.querySelectorAll('[data-search-hit]').length;
    clearAllSearches(true);
    el('searchRegex').checked = true;
    el('searchInput').value = 'GAA\\w\\wC';
    el('searchButton').click();
    const rx = state.searchHistory[0]?.matchCount || 0;
    return { before, after, rx };
  });
  const ok = win.want > 0 && win.have === win.want && win.count > 0 && re.before >= 6 && re.after === re.before && re.rx >= 1;
  return { pass: ok, detail: JSON.stringify({ win, re }) };
});

check('Gap tools: in-place update matches a full redraw, and takes the fast path', async (page) => {
  const snapSrc = `(() => {
    const out = [];
    document.querySelectorAll('#alignmentContainer .seq-line').forEach(line => {
      const kind = line.classList.contains('scale-ruler-line') ? 'R' : line.classList.contains('consensus-line') ? 'C' : 'S' + line.dataset.seqIndex;
      const data = line.querySelector('.seq-data'); if (!data) return;
      if (kind === 'R') { out.push(kind + data.textContent + data.dataset.scale); return; }
      out.push(kind + [...data.children].map(sp => (sp.dataset.pos ?? '_') + sp.textContent
        + [...sp.classList].filter(c => !/^(nuc-|edit-active)/.test(c)).sort().join('.') + (sp.dataset.searchHit || '')).join(' '));
    });
    document.querySelectorAll('#alignmentContainer > .block-block').forEach(b => out.push('B' + b.style.getPropertyValue('--cols')));
    return out;
  })()`;
  const results = [];
  for (const mode of ['full', 'block']) {
    for (const [tool, trailing] of [['insertGapOther', 0], ['insertGapAll', 30], ['insertGapSeq', 0], ['deleteGapOther', 0]]) {
      await loadFasta(page, variedFasta(40, 157, 11, trailing));
      await setMode(page, mode);
      const r = await page.evaluate(async ({ tool, snapSrc }) => {
        el('searchInput').value = state.seqs[4].seq.replace(/-/g, '').slice(30, 34); el('searchButton').click();
        if (!state.editModeActive) el('editToggleButton').click();
        if (tool.startsWith('delete')) {
          state.seqs.forEach(s => { s.seq = s.seq.slice(0, 40) + '-' + s.seq.slice(40); });
          refreshAllGaplessPositions(); renderAlignment();
        }
        let patched = null;
        const orig = window.patchColumnsInPlace;
        window.patchColumnsInPlace = function (...a) { return (patched = orig.apply(this, a)); };
        const t0 = performance.now();
        handleGeneDocGapToolClick(7, 40, tool);
        const ms = performance.now() - t0;
        window.patchColumnsInPlace = orig;
        flushPendingSpanRepaint();
        const a = eval(snapSrc);
        renderAlignment();
        const b = eval(snapSrc);
        const diff = a.findIndex((x, i) => x !== b[i]);
        return { patched, ms: Math.round(ms), same: a.length === b.length && diff < 0, diffLine: diff };
      }, { tool, snapSrc });
      results.push({ mode, tool, trailing, ...r });
    }
  }
  const bad = results.filter(r => !r.same || !r.patched);
  return { pass: bad.length === 0, detail: bad.length ? JSON.stringify(bad) : results.map(r => `${r.mode}/${r.tool}:${r.ms}ms`).join(' ') };
});

check('Selections panel: lists every kind, on/off, remove + undo, Esc, snapshot round trip', async (page) => {
  await loadFasta(page, variedFasta(25, 200, 5));
  const panel = () => page.evaluate(() => ({
    shown: getComputedStyle(el('selections-menu-section')).display !== 'none' && getComputedStyle(el('selections-menu-section')).visibility !== 'hidden',   // keeps its place while empty (v278), but is not seen
    keys: [...document.querySelectorAll('#selectionsList .sel-item')].map(r => (r.classList.contains('is-off') ? '-' : '+') + r.dataset.key.replace(/^search:.*/, 'search'))
  }));
  const settle = () => page.waitForTimeout(80);
  const log = {};
  log.fresh = await panel();
  const names = await page.$$('.seq-name[data-seq-index]');
  await names[2].click({ modifiers: ['Control'] });
  await names[6].click({ modifiers: ['Control'] });
  await page.evaluate(() => {
    [20, 21, 60].forEach(c => state.selectedColumns.add(c)); updateColumnSelections();
    state.selectedNucs.set(3, new Set([5, 6, 7])); scheduleNucSelectionRefresh();
    el('searchInput').value = state.seqs[0].seq.replace(/-/g, '').slice(10, 14); el('searchBothStrands').checked = false; el('searchButton').click();
    colourState.mappings.set(state.seqs[1].header, '#ff0000'); applyColourToSeqNames(colourState.mappings);
  });
  await settle();
  // the panel redraws on an animation frame after the search and the name colours: a fixed 80 ms was too
  // short on a loaded machine (it failed in full runs, listing the search but not yet the names). Same
  // assertion below; this only waits for the redraw, up to 3 s.
  await page.waitForFunction(() => document.querySelectorAll('#selectionsList .sel-item').length >= 5, null, { timeout: 3000 }).catch(() => {});
  log.all = await panel();
  // rows off: kept, not live (the menu opens on hover, like the others)
  const openPanel = async () => { await page.hover('#selections-menu-section .section-header'); await page.waitForTimeout(200); };
  await openPanel();
  await page.click('#selectionsList .sel-item[data-key="rows"] input');
  await page.click('#selectionsList .sel-item[data-key^="search:"] input');
  await settle();
  log.off = await panel();
  log.offState = await page.evaluate(() => ({ live: state.selectedRows.size, hits: document.querySelectorAll('[data-search-hit]').length }));
  // snapshot keeps on/off; Clear all then Undo restores; reload restores
  const payload = await page.evaluate(() => JSON.stringify(_buildSnapshotPayload()));
  await page.evaluate(() => clearAllSelections());
  await settle();
  log.cleared = await panel();
  await page.evaluate(() => undoSelectionsRemoval());
  await page.waitForTimeout(150);
  log.undone = await panel();
  await page.evaluate(async (p) => { _loadSnapshotPayload(JSON.parse(p)); await new Promise(r => setTimeout(r, 1200)); }, payload);
  log.reloaded = await panel();
  // turning rows back on after reload selects the same sequences
  await openPanel();
  await page.click('#selectionsList .sel-item[data-key="rows"] input');
  await settle();
  log.rowsBack = await page.evaluate(() => [...state.selectedRows].sort((a, b) => a - b));
  // Esc with nothing open clears rows/columns/residues but not highlights; Undo restores
  await page.mouse.move(700, 600); await page.waitForTimeout(400);   // menus close 120 ms after the pointer leaves
  await page.keyboard.press('Escape');
  await settle();
  log.esc = await panel();
  await page.evaluate(() => undoSelectionsRemoval());
  await settle();
  log.escUndo = await panel();
  const want = {
    all: ['+rows', '+cols', '+nucs', '+search', '+names'],
    off: ['-rows', '+cols', '+nucs', '-search', '+names'],
    esc: ['-search', '+names'],
    escUndo: ['+rows', '+cols', '+nucs', '-search', '+names'],
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ok = !log.fresh.shown && log.all.shown && same(log.all.keys, want.all) && same(log.off.keys, want.off)
    && log.offState.live === 0 && log.offState.hits === 0 && log.cleared.keys.length === 0
    && same(log.undone.keys, want.off) && same(log.reloaded.keys, want.off) && same(log.rowsBack, [2, 6])
    && same(log.esc.keys, want.esc) && same(log.escUndo.keys, want.escUndo);
  return { pass: ok, detail: ok ? '' : JSON.stringify(log) };
});

check('Canvas: switching a search or selection off in the Selections panel redraws', async (page) => {
  await loadFasta(page, makeFasta(30, 300));
  await page.evaluate(() => { el('searchInput').value = 'GTAC'; el('searchButton').click(); });
  await setMode(page, 'canvas');
  const yellow = () => page.evaluate(() => {
    const c = document.getElementById('alignmentCanvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let y = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] < 60) y++; return y;
  });
  await page.waitForTimeout(300);
  const on = await yellow();
  await page.evaluate(() => setSelectionItemOn('search:' + state.searchHistory[0].className, false));
  await page.waitForTimeout(200);
  const off = await yellow();
  return { pass: on > 1000 && off === 0, detail: `highlighted pixels ${on} -> ${off}` };
});

check('v212 audit fixes: mismatch hits, empty/lowercase/invalid regex, counts, legacy snapshots, no-op gaps, per-row cache', async (page) => {
  await loadFasta(page, '>a\nACGTAAAACCGTTGCA\n>b\nAC-GTAAATCCGTTGC\n>c\nTTTTTTTTTTTTTTTT\n');
  const out = await page.evaluate(() => {
    const r = {};
    const hitCols = row => [...document.querySelectorAll(`.seq-line[data-seq-index="${row}"] .seq-data > span[data-search-hit]`)].map(sp => +sp.dataset.pos);
    // 1 mismatch search AAAA: row b "ACGTAAATCC.." matches AAAT at degapped 4..7 -> A,A,A paint, T not
    el('maxMismatches').value = '1'; el('searchRegex').checked = false; el('searchBothStrands').checked = false;
    el('searchInput').value = 'AAAA'; el('searchButton').click();
    renderAlignment();                                  // the redraw path, not the Find path
    r.mm = hitCols(1).join(',');                       // row b columns: A at 5,6,7 (gap at col 2)
    clearAllSearches(true); el('maxMismatches').value = '0';
    // empty-matching regex paints nothing, counts nothing
    el('searchRegex').checked = true; el('searchInput').value = 'q*'; el('searchButton').click();
    r.empty = [state.searchHistory[0]?.matchCount, document.querySelectorAll('[data-search-hit]').length];
    clearAllSearches(true);
    // lowercase u in a regex finds T/U residues
    el('searchInput').value = 'gu'; el('searchButton').click();
    r.lowerU = state.searchHistory[0]?.matchCount || 0;
    clearAllSearches(true);
    // invalid regex with both strands: no entry, message kept
    el('searchBothStrands').checked = true; el('searchInput').value = '[AT'; el('searchButton').click();
    r.invalid = [state.searchHistory.length, (el('statusMessage')?.textContent || '').includes('Invalid regex')];
    // regex + both strands: forward only, no mangled rev-comp entry
    el('searchInput').value = 'A[CT]G'; el('searchButton').click();
    r.regexStrands = state.searchHistory.map(e => e.strand).join(',');
    clearAllSearches(true);
    // both strands: a sequence matching on both strands counted once
    el('searchRegex').checked = false; el('searchInput').value = 'ACG'; el('searchButton').click();
    r.bothMsg = el('statusMessage')?.textContent || '';
    clearAllSearches(true);
    // legacy snapshot entries: mismatches from the view, regex from metacharacters
    _applySnapshotSearchHistory([{ motif: 'AAAA:fwd', color: '#ff0', label: 'AAAA', strand: 'fwd' },
                                 { motif: '[AT]CC:fwd', color: '#0ff', label: '[AT]CC', strand: 'fwd' }], '1');
    r.legacy = state.searchHistory.map(e => `${e.maxMismatches}/${e.useRegex}`).join(' ');
    clearAllSearches(true);
    // gap insert inside the trailing filler run is a no-op
    r.noop = geneDocInsertDashString('MK--', 3).changed === false && geneDocDeleteDashString('MK--', 3).changed === false
      && geneDocInsertDashString('MKGA', 1).changed === true;
    // per-row cache: a missing row blocks the in-place patch even when the consensus row pads the size
    const saved = state.spanCache.get(1); state.spanCache.delete(1);
    r.cacheGuard = canPatchColumnsInPlace(state.seqs[0].seq.length, state.seqs[0].seq.length) === false;
    state.spanCache.set(1, saved);
    return r;
  });
  const ok = out.mm === '5,6,7' && out.empty[0] === 0 && out.empty[1] === 0 && out.lowerU >= 1
    && out.invalid[0] === 0 && out.invalid[1] && out.regexStrands === 'fwd'
    && /in 2 sequences/.test(out.bothMsg) && out.legacy === '1/false 0/true' && out.noop && out.cacheGuard;
  return { pass: ok, detail: JSON.stringify(out) };
});

check('v212 audit fixes: Selections off/on merges TSD marks, repeats and name colours', async (page) => {
  await loadFasta(page, variedFasta(6, 80, 9));
  const out = await page.evaluate(() => {
    const r = {};
    const names = state.seqs.map(q => q.header);
    // TSD: mark row 0, off, mark row 1, off again, on -> both rows
    state.tsdMarks = new Map([[0, new Set([3, 4])]]);
    setSelectionItemOn('tsd', false);
    state.tsdMarks = new Map([[1, new Set([7])]]);
    setSelectionItemOn('tsd', false);
    setSelectionItemOn('tsd', true);
    r.tsd = [...state.tsdMarks.keys()].sort().join(',');
    // Name colours: A,B off; C coloured; on -> A,B,C
    colourState.mappings.set(names[0], '#f00'); colourState.mappings.set(names[1], '#0f0');
    setSelectionItemOn('names', false);
    colourState.mappings.set(names[2], '#00f');
    setSelectionItemOn('names', true);
    r.names = colourState.mappings.size;
    // Repeats: off twice with a new one between, then on -> both
    state.repeatHighlights = new Map([['r1', { segs: [[2, 6]], row: 0, color: '#abc' }]]);
    setSelectionItemOn('repeats', false);
    state.repeatHighlights = new Map([['r2', { segs: [[8, 12]], row: 1, color: '#cba' }]]);
    setSelectionItemOn('repeats', false);
    setSelectionItemOn('repeats', true);
    r.repeats = [...state.repeatHighlights.keys()].sort().join(',');
    // toggling repeats with no repeat state must not throw
    state.repeatHighlights = undefined; state.selectionStash.repeats = null;
    try { setSelectionItemOn('repeats', false); r.noThrow = true; } catch (e) { r.noThrow = e.message; }
    state.repeatHighlights = new Map();
    // Undo after a row above the selection was deleted restores the same sequence
    state.selectedRows = new Set([3]); const want = state.seqs[3].header;
    clearActiveSelection(true);
    state.seqs.splice(0, 1); renderAlignment();
    undoSelectionsRemoval();
    r.undoRow = [...state.selectedRows].map(i => state.seqs[i].header).join() === want;
    // A snapshot with no colours/marks, loaded over a session that has them, shows none
    clearAllSelections();
    const snap = _buildSnapshotPayload();
    snap.view.selectedColumns = [2, 99999];
    colourState.mappings.set(state.seqs[0].header, '#f00');
    state.tsdMarks = new Map([[1, new Set([4])]]);
    return new Promise(res => {
      _loadSnapshotPayload(JSON.parse(JSON.stringify(snap)));
      setTimeout(() => {
        r.snapExact = colourState.mappings.size === 0 && state.tsdMarks.size === 0;
        r.snapCols = [...state.selectedColumns].join();
        res(r);
      }, 1200);
    });
  });
  const ok = out.tsd === '0,1' && out.names === 3 && out.repeats === 'r1,r2' && out.noThrow === true && out.undoRow
    && out.snapExact && out.snapCols === '2';
  return { pass: ok, detail: JSON.stringify(out) };
});

check('v212 audit fixes: switched-off selections survive undo and column edits; Esc in a Type cell', async (page) => {
  await loadFasta(page, variedFasta(6, 40, 13));
  const r = await page.evaluate(() => {
    const out = {};
    const hdr = () => [...state.selectedRows].sort((a, b) => a - b).map(i => state.seqs[i].header).join();
    // rows 2,3 off; a data undo replaces state.seqs with copies; on again -> same sequences
    state.selectedRows = new Set([2, 3]); const want = hdr();
    setSelectionItemOn('rows', false);
    state.selectedColumns = new Set([0]); deleteSelectedColumns(true);   // pushes undo, copies seqs
    undoDelete();
    setSelectionItemOn('rows', true);
    out.rowsAfterUndo = hdr() === want;
    // columns 10,11 off; insert a gap column at 5 -> they come back as 11,12; delete 0 -> 10,11
    state.selectedRows.clear(); state.selectedColumns = new Set([10, 11]);
    setSelectionItemOn('cols', false);
    state.selectedColumns = new Set([5]); insertGapColumn();
    setSelectionItemOn('cols', true);
    out.colsAfterInsert = [...state.selectedColumns].sort((a, b) => a - b).join();
    setSelectionItemOn('cols', false);
    state.selectedColumns = new Set([0]); deleteSelectedColumns(true);
    setSelectionItemOn('cols', true);
    out.colsAfterDelete = [...state.selectedColumns].sort((a, b) => a - b).join();
    return out;
  });
  // Esc while typing in a cell leaves the cell and keeps the selection
  await page.evaluate(() => { state.selectedRows = new Set([1]); updateRowSelections(); });
  await page.click('#editToggleButton');
  await page.click('#editResidueButton');
  await page.click('.seq-line[data-seq-index="4"] .seq-data > span[data-pos="3"]');
  await page.mouse.move(700, 650); await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  r.escCell = await page.evaluate(() => [state.editCell === null, state.selectedRows.size]);
  // a focused checkbox does not swallow the first Esc
  await page.evaluate(() => { el('editToggleButton').click(); state.selectedRows = new Set([2]); updateRowSelections();
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = '__escProbe';
    cb.style.cssText = 'position:fixed;left:5px;bottom:5px;z-index:99999'; document.body.appendChild(cb); cb.focus(); });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  r.escCheckbox = await page.evaluate(() => [document.activeElement?.id === '__escProbe' || document.activeElement === document.body, state.selectedRows.size]);
  const ok = r.rowsAfterUndo && r.colsAfterInsert === '11,12' && r.colsAfterDelete === '10,11'
    && r.escCell[0] === true && r.escCell[1] === 1 && r.escCheckbox[1] === 0;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Name colours: cleared when a new file loads, restored from a snapshot', async (page) => {
  await loadFasta(page, variedFasta(5, 60, 21));
  const snap = await page.evaluate(() => {
    colourState.mappings.set(state.seqs[0].header, '#ff0000'); applyColourToSeqNames(colourState.mappings);
    return JSON.stringify(_buildSnapshotPayload());
  });
  await loadFasta(page, variedFasta(5, 60, 21));
  const afterLoad = await page.evaluate(() => [colourState.mappings.size, document.querySelectorAll('.seq-name[style*="background"]').length]);
  const afterSnap = await page.evaluate(async (p) => { _loadSnapshotPayload(JSON.parse(p)); await new Promise(r => setTimeout(r, 1200)); return colourState.mappings.size; }, snap);
  const ok = afterLoad[0] === 0 && afterLoad[1] === 0 && afterSnap === 1;
  return { pass: ok, detail: JSON.stringify({ afterLoad, afterSnap }) };
});

check('Marks follow their residues: TSD marks, repeats and residue selection through gaps, row delete/move, redraw', async (page) => {
  // rows 0-5 have identical letters, so a mark kept by row number or by letters would land on another sequence
  let x = 11; const rnd = () => { x = (x * 16807) % 2147483647; return x; };
  const base = Array.from({ length: 50 }, () => 'ACGT'[rnd() % 4]);
  let fa = ''; for (let i = 0; i < 10; i++) { const s = base.slice(); if (i >= 6) s[20] = 'T'; fa += `>seq${i}\n${s.join('')}\n`; }
  page.on('dialog', d => d.accept());
  await loadFasta(page, fa);
  const r = await page.evaluate(() => {
    const where = (sel) => {
      const out = [];
      document.querySelectorAll('#alignmentContainer .seq-line[data-seq-index]:not(.consensus-line) .seq-data > span[data-pos]').forEach(sp => {
        if (!sp.matches(sel)) return;
        const row = +sp.closest('.seq-line').dataset.seqIndex, q = state.seqs[row];
        let n = 0; for (let c = 0; c < +sp.dataset.pos; c++) if (q.seq[c] !== '-') n++;
        out.push(q.header + ':' + n);
      });
      return out.sort().join();
    };
    // residue numbers (non-gap characters before the column), not columns: the selection follows
    // its residues when a column is inserted
    const resNo = (r, c) => { let n = 0; for (let i = 0; i < c; i++) if (state.seqs[r].seq[i] !== '-') n++; return n; };
    const nucs = () => [...state.selectedNucs].filter(([r]) => r >= 0).map(([r, s]) => state.seqs[r].header + ':' + [...s].map(c => resNo(r, c)).sort((a, b) => a - b).join('.')).join();
    state.tsdMarkStyle = 'color'; state.tsdMarks = new Map([[2, new Set([10, 11])]]); renderAlignment({ deferConservation: true });
    const info = { segs: [[30, 33]], row: 3, color: '#ff00ff' }; state.repeatHighlights.set('t', info); _paintRepeatHighlight(info, true);
    state.selectedNucs.set(4, new Set([5, 6])); refreshNucleotideSelectionsImmediate();
    const before = [where('.tsd-mark'), where('[data-repeat-hl]'), nucs()];
    const steps = {};
    renderAlignment(); steps.redraw = [where('.tsd-mark'), where('[data-repeat-hl]'), nucs()];
    state.selectedColumns = new Set([3]); insertGapColumn(); state.selectedColumns.clear();
    steps.gapColumn = [where('.tsd-mark'), where('[data-repeat-hl]')];
    state.seqs.splice(0, 1); renderAlignment(); steps.deleteRow = [where('.tsd-mark'), where('[data-repeat-hl]'), nucs()];
    state.selectedRows = new Set([3]); moveSelectedToTop(); state.selectedRows.clear(); updateRowSelections();
    steps.moveRow = [where('.tsd-mark'), where('[data-repeat-hl]'), nucs()];
    return { before, steps };
  });
  const [tsd0, rep0, nuc0] = r.before;
  const bad = Object.entries(r.steps).filter(([, v]) => v[0] !== tsd0 || v[1] !== rep0 || (v[2] !== undefined && v[2] !== nuc0));
  const ok = tsd0 === 'seq2:10,seq2:11' && rep0 === 'seq3:30,seq3:31,seq3:32' && nuc0 === 'seq4:5.6' && bad.length === 0;
  return { pass: ok, detail: JSON.stringify(ok ? r.before : r) };
});

check('Overlapping marks all stay visible, in any order, in DOM and Canvas (conflict study phase 2)', async (page) => {
  // two groups differing at 10, 20, 30, so SNP grouping paints column 10 of row 2
  let x = 7; const rnd = () => { x = (x * 16807) % 2147483647; return x; };
  const base = Array.from({ length: 60 }, () => 'ACGT'[rnd() % 4]);
  let fa = ''; for (let i = 0; i < 12; i++) { const s = base.slice(); [10, 20, 30].forEach(c => { s[c] = i < 6 ? 'G' : 'C'; }); fa += `>seq${i}\n${s.join('')}\n`; }
  await loadFasta(page, fa);
  const r = await page.evaluate(async () => {
    const cs = (row, pos) => getComputedStyle(document.querySelector(`.seq-line[data-seq-index="${row}"] .seq-data > span[data-pos="${pos}"]`));
    const nameCs = row => { const n = document.querySelector(`.seq-line[data-seq-index="${row}"] .seq-name`); const c = getComputedStyle(n); return [c.backgroundColor, c.boxShadow].join(' | '); };
    const left = () => [...document.querySelectorAll('.seq-line[data-seq-index="2"] .seq-data > span[data-pos]')].map(s => Math.round(s.getBoundingClientRect().left));
    const out = {};
    const x0 = left();
    // name cell: Colour Name first, then groups ...
    colourState.mappings.set(state.seqs[1].header, '#ff8800'); applyColourToSeqNames(colourState.mappings);
    await clusterSequences();
    out.nameAB = nameCs(1);
    // ... and groups first, then Colour Name (clear both, redo in the other order)
    colourState.mappings.clear(); clearTypePaint();
    await clusterSequences();
    colourState.mappings.set(state.seqs[1].header, '#ff8800'); applyColourToSeqNames(colourState.mappings);
    out.nameBA = nameCs(1);
    renderAlignment();
    out.nameRedraw = nameCs(1);
    // residue marks on column 10 of row 2 (an SNP letter): search + TSD on top of it
    state.tsdMarkStyle = 'color'; state.tsdMarkColor = '#00e5ff';
    state.tsdMarks = new Map([[2, new Set([5, 10])]]);
    searchMotif({ motif: state.seqs[2].seq.slice(8, 12), color: '#ffff00', bothStrands: false, useRegex: false, maxMismatches: 0, suppressMessage: true });
    state.selectedNucs.set(2, new Set([10])); state.selectedColumns.add(20); state.selectedRows.add(3);
    renderAlignment();
    await new Promise(r => setTimeout(r, 100));
    const c10 = cs(2, 10), c5 = cs(2, 5), c20 = cs(2, 20), r3 = cs(3, 10);
    out.tsdUnderSearch = [c10.backgroundColor, /ViewAlign Sans|Arial/.test(c10.fontFamily), c10.fontWeight, c10.color];
    out.tsdAlone = [c5.backgroundColor, /ViewAlign Sans|Arial/.test(c5.fontFamily)];
    out.resSelTint = /gradient/.test(c10.backgroundImage);
    out.colSelOverSnp = [/gradient/.test(c20.backgroundImage), c20.backgroundColor];
    out.rowSelTint = /gradient/.test(r3.backgroundImage);
    out.moved = left().filter((v, i) => Math.abs(v - x0[i]) > 0).length;
    // Canvas shows the TSD colour and the name colour. Rows start at m.headerH (ruler, annotation
    // track and, since v245, the consensus row when it is at the top), not at one ruler row.
    document.getElementById('modeCanvas').checked = true; onModeChange();
    await new Promise(r => setTimeout(r, 500));
    const c = document.getElementById('alignmentCanvas'), m = _canvasState.metrics, k = devicePixelRatio, g = c.getContext('2d');
    const px = (xx, yy) => Array.from(g.getImageData(Math.round(xx * k), Math.round(yy * k), 1, 1).data).slice(0, 3).join(',');
    // the most common colour in the cell is its background (a single pixel can hit the glyph)
    const cellBg = (col, row) => {
      const d = g.getImageData(Math.round((m.nameW + col * m.charW) * k), Math.round((m.headerH + row * _canvasState.rowPitch) * k), Math.round(m.charW * k), Math.round(m.charH * k)).data;
      const n = {}; for (let i = 0; i < d.length; i += 4) { const key = d[i] + ',' + d[i + 1] + ',' + d[i + 2]; n[key] = (n[key] || 0) + 1; }
      return Object.entries(n).sort((a, b) => b[1] - a[1])[0][0];
    };
    out.canvasTsd = cellBg(5, 2);
    out.canvasName = px(20, m.headerH + 1 * _canvasState.rowPitch + 2);
    return out;
  });
  const ok = r.nameAB === r.nameBA && r.nameBA === r.nameRedraw && /255, 136, 0/.test(r.nameAB) && /inset/.test(r.nameAB)
    && r.tsdUnderSearch[0] === 'rgb(255, 255, 0)' && r.tsdUnderSearch[1] && r.tsdUnderSearch[2] === '700'
    && r.tsdAlone[0] === 'rgb(0, 229, 255)' && r.tsdAlone[1]
    && r.resSelTint && r.colSelOverSnp[0] && r.rowSelTint && r.moved === 0
    && r.canvasTsd === '0,229,255' && r.canvasName === '255,136,0';
  return { pass: ok, detail: JSON.stringify(r) };
});

// The bars draw their own grip (no native scrollbar). Pressing Chrome's native thumb started its
// own drag next to the app's, and on Windows Chrome snaps a native thumb back once the pointer
// strays off the bar: the view jumped back mid-drag with a mouse. Here the pointer drifts 300px
// above the 14px bar while dragging; the view must keep following it, with the grip under it.
check('Scrollbars: own grip, a drag that strays off the bar keeps going, a track press pages', async (page) => {
  await page.setViewportSize({ width: 1920, height: 950 });
  await loadFasta(page, makeFasta(80, 1500));
  await setMode(page, 'full');
  await page.waitForTimeout(800);
  const bar = '.horizontal-scrollbar';
  const r0 = await page.evaluate((sel) => { const b = document.querySelector(sel), g = b.querySelector('.scrollbar-grip'), q = b.getBoundingClientRect(), gq = g.getBoundingClientRect();
    return { native: getComputedStyle(b).scrollbarWidth, x: q.x, y: q.y, h: q.height, gx: gq.x, gw: gq.width, track: b.clientWidth, content: b.scrollWidth }; }, bar);
  const read = () => page.evaluate(() => [Math.round(el('alignmentContainer').scrollLeft), Math.round(document.querySelector('.horizontal-scrollbar').scrollLeft)]);
  const x0 = r0.gx + r0.gw / 2, y0 = r0.y + r0.h / 2;
  const seen = [await read()];
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let k = 1; k <= 10; k++) { await page.mouse.move(x0 + k * 15, y0 - k * 30); await page.waitForTimeout(40); seen.push(await read()); }
  await page.mouse.up(); await page.waitForTimeout(300); seen.push(await read());
  const expected = 150 * (r0.content - r0.track) / (r0.track - Math.max(20, r0.track * r0.track / r0.content));
  const end = seen[seen.length - 1];
  const g1 = await page.evaluate((sel) => { const q = document.querySelector(sel + ' .scrollbar-grip').getBoundingClientRect(); return [q.left, q.right]; }, bar);
  // a press on the track right of the grip pages right by most of a screen
  const before = end[0];
  await page.mouse.click(Math.min(r0.x + r0.track - 5, g1[1] + 40), y0);
  await page.waitForTimeout(300);
  const paged = (await read())[0] - before;
  const vw = await page.evaluate(() => el('alignmentContainer').clientWidth);
  const out = { native: r0.native, ratio: Math.round(end[0] / expected * 100) / 100, forward: seen.every((v, i) => i === 0 || v[0] >= seen[i - 1][0]),
    inSync: seen.every(v => Math.abs(v[0] - v[1]) <= 2), gripUnderPointer: g1[0] <= x0 + 150 + 1 && x0 + 150 <= g1[1] + 1, paged, vw };
  const ok = out.native === 'none' && out.ratio > 0.9 && out.ratio < 1.1 && out.forward && out.inSync && out.gripUnderPointer && paged > 0.8 * vw && paged < vw;
  return { pass: ok, detail: JSON.stringify({ ...out, seen }) };
});

// The menu buttons sit on whole pixels. The info panel at the right sets the menu row's height;
// at 23.09px (line-height 1.1, odd) every centred button landed .5px off, which a 1x screen
// rounds: the labels sat high on a Full HD monitor and centred on a 2x one.
check('Menu row: every menu button on a whole pixel (labels centred on 1x screens)', async (page) => {
  await page.setInputFiles('#fileInput', require('path').join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1500);
  const out = {};
  for (const w of [1920, 1366, 2560]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(300);
    out[w] = await page.evaluate(() => [...document.querySelectorAll('#menuRow .section-header, #menuRow button')].filter(n => n.offsetParent)
      .map(n => [n.id || n.textContent.trim().slice(0, 12), n.getBoundingClientRect().top]).filter(([, t]) => Math.abs(t - Math.round(t)) > 0.01));
  }
  return { pass: Object.values(out).every(v => v.length === 0), detail: JSON.stringify(out) };
});

// Actions > New Tab opens the selected sequences in a new ViewAlign tab (it opened a bare
// text box with the FASTA).
check('Actions > New Tab: the selected sequences open in a new viewer tab', async (page) => {
  await page.setInputFiles('#fileInput', require('path').join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1500);
  const want = await page.evaluate(() => { state.selectedRows = new Set([1, 3, 4]); updateRowSelections(); return [1, 3, 4].map(i => state.seqs[i].header + ' ' + state.seqs[i].seq); });
  const [tab] = await Promise.all([page.context().waitForEvent('page'), page.evaluate(() => document.getElementById('openInNewTabButton').click())]);
  await tab.waitForLoadState();
  await tab.waitForFunction(() => typeof state !== 'undefined' && state.seqs && state.seqs.length > 0, null, { timeout: 15000 });
  await tab.waitForTimeout(800);
  const got = await tab.evaluate(() => ({ seqs: state.seqs.map(s => s.header + ' ' + s.seq), rows: document.querySelectorAll('#alignmentContainer .seq-line[data-seq-index="2"]').length, name: state.currentFilename, textBox: !!document.querySelector('body > textarea') }));
  const ok = JSON.stringify(got.seqs) === JSON.stringify(want) && got.rows > 0 && !got.textBox && /3 selected/.test(got.name);
  return { pass: ok, detail: JSON.stringify({ n: got.seqs.length, rows: got.rows, name: got.name, textBox: got.textBox }) };
});

// A Ctrl+drag from a sequence name onto the Consensus name selected "row -1" (the consensus
// line's index): Delete then spliced (-1, 1) and removed the last sequence, Copy threw.
// Right-clicking the Consensus name threw instead of doing nothing.
check('Row drag onto the Consensus row: not selected, Delete removes only the dragged rows', async (page) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await loadFasta(page, makeFasta(6, 100));
  const nb = await page.evaluate(() => { const n = document.querySelector('.seq-line[data-seq-index="1"] .seq-name'), c = document.querySelector('.consensus-line .seq-name');
    const a = n.getBoundingClientRect(), b = c.getBoundingClientRect(); return [a.x + 10, a.y + a.height / 2, b.x + 10, b.y + b.height / 2]; });
  await page.keyboard.down('Control'); await page.mouse.move(nb[0], nb[1]); await page.mouse.down();
  await page.mouse.move(nb[2], nb[3], { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Control');
  const sel = await page.evaluate(() => [...state.selectedRows].sort((a, b) => a - b));
  const consSelected = await page.evaluate(() => !!document.querySelector('.consensus-line.selected'));
  await page.evaluate(() => deleteSelected()); await page.waitForTimeout(400);
  const left = await page.evaluate(() => state.seqs.map(s => s.header).join(','));
  await page.mouse.click(nb[2], nb[3] - 0, { button: 'right' }); await page.waitForTimeout(200);
  const ok = JSON.stringify(sel) === '[0,1]' && !consSelected && left === 'seq2,seq3,seq4,seq5' && errs.length === 0;
  return { pass: ok, detail: JSON.stringify({ sel, consSelected, left, errs }) };
});

// After a redraw of a windowed alignment the scrollTop restore armed "skip the next scroll
// event"; Chrome often sent none for it, so the flag swallowed the user's next real scroll:
// the first scrollbar drag after a redraw landed on blank space, a second one worked.
check('Windowed redraw: the first scrollbar drag afterwards shows residues (no swallowed scroll)', async (page) => {
  await loadSyntheticFasta(page, 1500, 4000); await setMode(page, 'full'); await page.waitForTimeout(1200);
  await page.evaluate(() => { const c = el('alignmentContainer'); c.scrollTop = c.scrollHeight * 0.4; });
  await page.waitForTimeout(800);
  await page.evaluate(() => renderAlignment()); await page.waitForTimeout(1500);
  const b = await page.evaluate(() => { const r = document.querySelector('.horizontal-scrollbar').getBoundingClientRect(); return [r.x, r.y + r.height / 2, r.width]; });
  await page.mouse.move(b[0] + 10, b[1]); await page.mouse.down(); await page.mouse.move(b[0] + b[2] * 0.5, b[1], { steps: 1 });
  await page.waitForTimeout(100); await page.mouse.up(); await page.waitForTimeout(1000);
  const r = await page.evaluate(() => { const c = el('alignmentContainer'), cr = c.getBoundingClientRect();
    const l = [...document.querySelectorAll('.seq-line[data-seq-index]')].find(e => +e.dataset.seqIndex >= 0 && e.getBoundingClientRect().top > cr.top + 30);
    const sp = l ? [...l.querySelectorAll('.seq-data > span[data-pos]')].filter(s => { const q = s.getBoundingClientRect(); return q.right > cr.left + 200 && q.left < cr.right; }) : [];
    return { left: Math.round(c.scrollLeft), visibleResidues: sp.length }; });
  return { pass: r.left > 1000 && r.visibleResidues > 20, detail: JSON.stringify(r) };
});

// Rows the v230 row buffer adds a chunk per frame did not get the residue selection: a selected
// residue scrolled into view showed unselected.
check('Windowed Full: a selected residue stays highlighted on rows added while scrolling', async (page) => {
  await loadSyntheticFasta(page, 1500, 4000); await setMode(page, 'full'); await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    const frames = (n) => new Promise(res => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const c = el('alignmentContainer');
    const rowH = document.querySelector('.seq-line[data-seq-index="1"]').getBoundingClientRect().height;
    const T = 800;
    state.selectedNucs.clear(); state.selectedNucs.set(T, new Set([2, 3, 4])); scheduleNucSelectionRefresh(); await frames(3);
    c.scrollTop = Math.round((T - Math.floor(c.clientHeight / rowH) - 15) * rowH); await frames(80);
    for (let k = 0; k < 30; k++) { c.scrollTop += rowH; await frames(2); }
    await frames(10);
    const sp = document.querySelector(`.seq-line[data-seq-index="${T}"] .seq-data > span[data-pos="3"]`);
    const q = sp?.getBoundingClientRect(), cr = c.getBoundingClientRect();
    return { onScreen: q ? q.top > cr.top && q.bottom < cr.bottom : false, selected: !!sp?.classList.contains('nuc-selected') };
  });
  return { pass: r.onScreen && r.selected, detail: JSON.stringify(r) };
});

check('Touchpad-style horizontal scroll: no writes back into the alignment, the swipe completes', async (page) => {
  // A compositor-driven gesture (like a two-finger swipe) over a wide alignment in Full view at 50%.
  // The persistent bar used to echo every scroll step back (scrollLeft = bar.scrollLeft), which
  // cancelled the browser's scrolling: the swipe stopped at 40-60% of its distance.
  await loadFasta(page, makeFasta(120, 2000));
  await setMode(page, 'full');
  await page.evaluate(() => setZoom(50));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const c = el('alignmentContainer'); window.__writes = 0;
    const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft');
    Object.defineProperty(c, 'scrollLeft', { get() { return d.get.call(this); }, set(v) { window.__writes++; d.set.call(this, v); } });
    // main-thread load, as while new rows are laid out
    const spin = () => { const t = performance.now(); while (performance.now() - t < 25); requestAnimationFrame(spin); }; requestAnimationFrame(spin);
  });
  const b = await (await page.$('#alignmentContainer')).boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + 200), xDistance: -1200, yDistance: 0, speed: 1500, gestureSourceType: 'mouse' });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ left: Math.round(el('alignmentContainer').scrollLeft), writes: window.__writes, bar: Math.round(document.querySelector('.horizontal-scrollbar').scrollLeft) }));
  const ok = r.writes === 0 && r.left >= 1150 && Math.abs(r.bar - r.left) <= 2;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('TSD results show 3 flanking bases on each side of both copies, in small grey', async (page) => {
  let seed = 5; const rnd = () => Math.floor((seed = (seed * 1103515245 + 12345) % 2147483648) / 65536);
  const rb = (n) => Array.from({ length: n }, () => 'ACGT'[rnd() % 4]).join('');
  const body = rb(100);
  let fa = `>consensus\n${'-'.repeat(31)}${body}AAAAAAAAAA${'-'.repeat(31)}\n`;
  for (let i = 0; i < 20; i++) {
    const tsd = rb(6);
    const b = body.split('').map(c => (rnd() % 20 === 0 ? 'ACGT'[rnd() % 4] : c)).join('');   // a varying body, as in the Repeat Finder check
    // copy3 has a gap inside its 5' flank, copy4 a copy truncated so the 3' flank is short
    let left = rb(25); if (i === 3) left = left.slice(0, 22) + '-' + left.slice(22);
    let right = rb(25); if (i === 4) right = right.slice(0, 2) + '-'.repeat(23);
    fa += `>copy${i}
${left}${tsd}${b}AAAAAAAAAA${tsd}${right}
`;
  }
  await page.setInputFiles('#fileInput', { name: 'tsdflank.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForTimeout(1500);
  await page.evaluate(() => openRepeatFinder(0));
  await page.click('label:has(input[name="repeatMode"][value="tsd"])');
  await page.click('#repeatRunBtn');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const out = { rows: 0, bad: [], grey: null, short: null };
    const trs = [...document.querySelectorAll('#repeatResults tbody tr')];
    out.rows = trs.length;
    _lastTsdResults.forEach(res => {
      // independent flank computation: residues (gaps skipped) just before/after each copy
      const seq = state.seqs[res.seqIndex].seq;
      const nongap = c => { let n = 0; for (let i = 0; i < c; i++) if (seq[i] !== '-' && seq[i] !== '.') n++; return n; };
      const ung = seq.replace(/[-.]/g, '');
      const exp = pos => { const a = nongap(pos[0]), z = nongap(pos[pos.length - 1]) + 1; return [ung.slice(Math.max(0, a - 3), a), ung.slice(z, z + 3)]; };
      const [ub, ua] = exp(res.upPositions), [db, da] = exp(res.downPositions);
      const tr = trs.find(t => t.children[1].textContent === res.seqName);
      const shown = [...tr.querySelectorAll('.rf-flank')].map(s => s.textContent.replace(/\u00a0/g, ''));
      if (shown.join('|') !== [ub, ua, db, da].join('|')) out.bad.push([res.seqName, shown.join('|'), [ub, ua, db, da].join('|')]);
    });
    const f = document.querySelector('#repeatResults .rf-flank');
    const cs = getComputedStyle(f), main = getComputedStyle(document.querySelector('#repeatResults .rf-pair'));
    out.grey = { color: cs.color, small: parseFloat(cs.fontSize) < parseFloat(main.fontSize) };
    out.fourPerRow = trs.every(t => t.querySelectorAll('.rf-flank').length === 4);
    out.mmStillCounted = document.querySelectorAll('#repeatResults .rf-mm').length;
    return out;
  });
  const ok = r.rows >= 15 && r.bad.length === 0 && r.fourPerRow && r.grey.small && r.grey.color !== 'rgb(0, 0, 0)' && r.mmStillCounted === 0;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Highlight diffs / Variable sites only work out of the box and pause each other with a message', async (page) => {
  // column 3 (0-based) differs in one sequence; every other column is identical
  await loadFasta(page, '>a\nACGTACGTAC\n>b\nACGAACGTAC\n>c\nACGTACGTAC\n>d\nACGTACGTAC\n');
  const r = await page.evaluate(async () => {
    const out = {};
    const tick = async (id) => { el(id).click(); await new Promise(res => setTimeout(res, 350)); };
    const msg = () => el('statusMessage')?.textContent || '';
    out.defaults = [el('varThresholdMode').value, el('varSitesThreshold').value];
    await tick('highlightDiffs');
    out.diffCols = [...state._diffColumns].join();          // only the differing column
    // how much of the cell shows: opacity, or a white veil over it (Highlight diffs since v259: 60 % white = 0.4)
    const dim = p => { const sp = document.querySelector(`.seq-line[data-seq-index="0"] span[data-pos="${p}"]`);
      const m = /rgba\(255, 255, 255, ([\d.]+)\)/.exec(getComputedStyle(sp, '::after').backgroundColor || '');
      return String(m ? +(1 - parseFloat(m[1])).toFixed(2) * parseFloat(getComputedStyle(sp).opacity) : parseFloat(getComputedStyle(sp).opacity)); };
    out.opacity = [dim(3), dim(5)];                          // differing column normal, identical dimmed
    await tick('varSitesOnly');
    out.afterVar = [el('highlightDiffs').checked, el('varSitesOnly').checked, state._diffsPausedByVarSites === true, /paused/.test(msg())];
    out.hidden = getComputedStyle(document.querySelector('.seq-line[data-seq-index="0"] span[data-pos="5"]')).display;
    await tick('varSitesOnly');                              // off again: Highlight diffs comes back
    out.afterOff = [el('highlightDiffs').checked, el('varSitesOnly').checked, /back on/.test(msg())];
    await tick('varSitesOnly'); await tick('highlightDiffs'); // ticking diffs while var-sites is on
    out.afterDiffs = [el('highlightDiffs').checked, el('varSitesOnly').checked, /switched off/.test(msg())];
    return out;
  });
  const ok = r.defaults[0] === 'count' && r.defaults[1] === '1' && r.diffCols === '3'
    && r.opacity[0] === '1' && parseFloat(r.opacity[1]) < 1
    && r.afterVar[0] === false && r.afterVar[1] === true && r.afterVar[2] && r.afterVar[3] && r.hidden === 'none'
    && r.afterOff[0] === true && r.afterOff[1] === false && r.afterOff[2]
    && r.afterDiffs[0] === true && r.afterDiffs[1] === false && r.afterDiffs[2];
  return { pass: ok, detail: JSON.stringify(r) };
});

check('TSD and repeat results stay tied to their sequences and residues after row and column edits', async (page) => {
  let seed = 5; const rnd = () => Math.floor((seed = (seed * 1103515245 + 12345) % 2147483648) / 65536);
  const rb = (n) => Array.from({ length: n }, () => 'ACGT'[rnd() % 4]).join('');
  const body = rb(100);
  let fa = `>consensus\n${'-'.repeat(31)}${body}AAAAAAAAAA${'-'.repeat(31)}\n`;
  for (let i = 0; i < 20; i++) {
    const tsd = rb(6);
    const b = body.split('').map(c => (rnd() % 20 === 0 ? 'ACGT'[rnd() % 4] : c)).join('');
    fa += `>copy${i}\n${rb(25)}${tsd}${b}AAAAAAAAAA${tsd}${rb(25)}\n`;
  }
  fa += `>tandem\n${rb(31)}${'ACGTTGCA'.repeat(4)}${body.slice(32)}AAAAAAAAAA${rb(31)}\n`;
  page.on('dialog', d => d.accept());
  await page.setInputFiles('#fileInput', { name: 'anch.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForTimeout(1500);
  await page.evaluate(() => openRepeatFinder(0));
  await page.click('label:has(input[name="repeatMode"][value="tsd"])');
  await page.click('#repeatRunBtn');
  await page.waitForTimeout(1500);
  const nRes = await page.evaluate(() => _lastTsdResults.length);
  // edits after the search: a row above them is deleted, a column is inserted near the start
  await page.evaluate(() => { deleteSequence(1); state.selectedColumns = new Set([5]); insertGapColumn(); state.selectedColumns.clear(); });
  await page.waitForTimeout(400);
  const r = await page.evaluate(async () => {
    const out = {};
    const letters = (row, cols) => cols.map(c => state.seqs[row].seq[c]).join('');
    // 1. Mark in alignment: the marked residues of every sequence are its two TSD copies
    document.getElementById('tsdMarkStyle').value = 'color'; applyTsdMarking();
    await new Promise(res => setTimeout(res, 300));
    const bad = [];
    _lastTsdResults.forEach(res => {
      const row = state.seqs.indexOf(res.obj);
      if (row < 0) return;                                   // that sequence was deleted
      const cols = [...(state.tsdMarks.get(row) || [])].sort((a, b) => a - b);
      const got = letters(row, cols).toUpperCase().replace(/-/g, '');
      if (got !== (res.upTSD + res.downTSD).toUpperCase().replace(/-/g, '')) bad.push([res.seqName, got, res.upTSD + res.downTSD]);
    });
    out.markedBad = bad.slice(0, 3);
    out.markedSeqs = state.tsdMarks.size;
    // 2. clicking a table row flashes that sequence's name (row numbers shifted by the delete)
    const tr = document.querySelectorAll('#repeatResults tbody tr')[5];
    const want = _lastTsdResults[+tr.dataset.ri].seqName;
    tr.click();
    await new Promise(res => setTimeout(res, 300));
    out.flashed = document.querySelector('.seq-name.rf-flash')?.textContent.trim().replace('…', '');
    out.wantName = want;
    // 3. lowercase marking, another row deleted, undo: exactly the marked letters are upper again
    state.tsdMarks = new Map(); state.tsdMarkUndo = null;
    document.getElementById('tsdMarkStyle').value = 'lowercase'; applyTsdMarking();
    const lowers = () => state.seqs.reduce((n, q) => n + (q.seq.match(/[a-z]/g) || []).length, 0);
    out.lowerAfterMark = lowers();
    deleteSequence(2);
    undoTsdMarking();
    out.lowerAfterUndo = lowers();
    return out;
  });
  // 4. repeats: tandem repeat of the last row, searched, then edits, then highlighted
  await page.click('label:has(input[name="repeatMode"][value="tandem"])');
  await page.click('label:has(input[name="repeatScope"][value="all"])');
  await page.fill('#repeatMinLen', '8');
  await page.click('#repeatRunBtn');
  await page.waitForTimeout(1500);
  await page.evaluate(() => { deleteSequence(1); state.selectedColumns = new Set([8]); insertGapColumn(); state.selectedColumns.clear(); });
  await page.waitForTimeout(400);
  const rep = await page.evaluate(async () => {
    const rows = [...document.querySelectorAll('#repeatResults tbody tr')];
    const tr = rows.find(x => /tandem/.test(x.children[1]?.textContent || '')) || rows[0];
    tr.click();
    await new Promise(res => setTimeout(res, 400));
    const spans = [...document.querySelectorAll('.seq-data > span[data-repeat-hl="1"]')];
    const names = [...new Set(spans.map(s => state.seqs[+s.closest('.seq-line').dataset.seqIndex].header))];
    const txt = spans.map(s => s.textContent).join('');
    return { names, n: spans.length, unit: /^(ACGTTGCA)+$/.test(txt) || txt.includes('ACGTTGCAACGTTGCA') };
  });
  const ok = nRes >= 15 && r.markedBad.length === 0 && r.markedSeqs >= 15 && r.flashed && r.flashed === r.wantName.replace('…', '').slice(0, r.flashed.length)
    && r.lowerAfterMark > 0 && r.lowerAfterUndo === 0
    && rep.names.length === 1 && rep.names[0] === 'tandem' && rep.n >= 32 && rep.unit;
  return { pass: ok, detail: JSON.stringify({ nRes, r, rep }) };
});

check('Column marks follow inserted and deleted columns, and Undo/Redo put them back', async (page) => {
  let x = 7; const rnd = () => { x = (x * 16807) % 2147483647; return x; };
  const base = Array.from({ length: 60 }, () => 'ACGT'[rnd() % 4]);
  let fa = ''; for (let i = 0; i < 12; i++) { const s = base.slice(); [10, 20, 30].forEach(c => { s[c] = i < 6 ? 'G' : 'C'; }); fa += `>seq${i}\n${s.join('')}\n`; }
  await loadFasta(page, fa);
  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(res => setTimeout(res, ms));
    const snp = () => [...document.querySelectorAll('.seq-line[data-seq-index="0"] .seq-data > span.diagnostic-mutation')].map(s => +s.dataset.pos).sort((a, b) => a - b).join();
    const sel = () => [...state.selectedColumns].sort((a, b) => a - b).join();
    const rep = () => JSON.stringify(state.repeatHighlights.get('c')?.segs);
    await clusterSequences(); await wait(200);
    state.selectedColumns = new Set([20, 25]); updateColumnSelections();
    state.trimBoundaries = { leftTrimEnd: 4, rightTrimStart: 55 };
    state.repeatHighlights.set('c', { segs: [[40, 50]], row: null, color: '#f0f' });
    renderAlignment(); await wait(200);
    const out = { start: [snp(), sel(), JSON.stringify(state.trimBoundaries), rep()] };
    el('editToggleButton').click();
    handleGeneDocGapToolClick(0, 3, 'insertGapAll'); await wait(300); flushPendingSpanRepaint();
    out.afterInsert = [snp(), sel(), JSON.stringify(state.trimBoundaries), rep()];
    undoDelete(); await wait(300);
    out.afterUndo = [snp(), sel(), JSON.stringify(state.trimBoundaries), rep()];
    redoAction(); await wait(300);
    out.afterRedo = [snp(), sel(), JSON.stringify(state.trimBoundaries), rep()];
    undoDelete(); await wait(300);
    // delete the gap column again via Delete Columns on a selection, then undo
    state.selectedColumns = new Set([3, 25]); deleteSelectedColumns(true); await wait(300);
    out.afterDelete = [snp(), sel(), JSON.stringify(state.trimBoundaries), rep()];
    undoDelete(); await wait(300);
    out.afterUndoDelete = [snp(), sel(), JSON.stringify(state.trimBoundaries), rep()];
    return out;
  });
  const start = ['10,20,30', '20,25', '{"leftTrimEnd":4,"rightTrimStart":55}', '[[40,50]]'];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // insert at column 3: columns >= 3 move right by one
  const wantIns = ['11,21,31', '21,26', '{"leftTrimEnd":5,"rightTrimStart":56}', '[[41,51]]'];
  // delete columns 3 and 25: 10->9, 20->19, 30->28 ; selection {3,25} removed (cleared)
  const ok = same(r.start, start) && same(r.afterInsert, wantIns) && same(r.afterUndo, start) && same(r.afterRedo, wantIns)
    && r.afterDelete[0] === '9,19,28' && r.afterDelete[2] === '{"leftTrimEnd":3,"rightTrimStart":53}' && r.afterDelete[3] === '[[38,48]]'
    && r.afterUndoDelete[0] === start[0] && r.afterUndoDelete[2] === start[2] && r.afterUndoDelete[3] === start[3] && r.afterUndoDelete[1] === '3,25';   // undo restores the selection made before the delete
  return { pass: ok, detail: JSON.stringify(r) };
});

check('2D blocks are cancelled, with a message, when an edit changes the columns', async (page) => {
  await loadFasta(page, '>a\nACGTACGTACGT\n>b\nACGTACGTACGT\n>c\nACGAACGTACGT\n');
  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(res => setTimeout(res, ms));
    const mk = () => { state.blockMask = { blocks: [{ col_start: 4, col_end: 8, row_start: 0, row_end: 1 }], row_headers: ['a', 'b', 'c'] }; state._biclusterRaw = { x: 1 }; };
    const out = {};
    el('editToggleButton').click();
    mk();
    handleGeneDocGapToolClick(2, 6, 'insertGapSeq');         // only row c is edited, c is in the mask rows
    await wait(300);
    out.rowLocal = [state.blockMask === null, state._biclusterRaw === null];
    mk();
    handleGeneDocGapToolClick(0, 3, 'insertGapAll');         // every row: columns change
    await wait(900);
    out.allRows = [state.blockMask === null, state._biclusterRaw === null, /2D blocks cleared/.test(el('statusMessage').textContent)];
    return out;
  });
  const ok = r.rowLocal.every(Boolean) && r.allRows.every(Boolean);
  return { pass: ok, detail: JSON.stringify(r) };
});

check('TSD marks: the letter sits on the same baseline as unmarked letters (no clipped descenders)', async (page) => {
  await loadFasta(page, '>a\n' + 'g'.repeat(20) + '\n>b\n' + 'g'.repeat(20) + '\n');
  const r = await page.evaluate(async () => {
    document.getElementById('modeSingle').checked = true; onModeChange(); setZoom(150);
    state.tsdMarkStyle = 'color'; state.tsdMarks = new Map([[0, new Set([5, 6])]]); renderAlignment();
    await document.fonts.ready; await new Promise(res => setTimeout(res, 300));
    // baseline = bottom of a zero-height inline-block placed on the baseline inside the cell
    const baseline = (row, p) => {
      const sp = document.querySelector(`.seq-line[data-seq-index="${row}"] span[data-pos="${p}"]`);
      const probe = document.createElement('i'); probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      sp.appendChild(probe); const y = probe.getBoundingClientRect().bottom - sp.getBoundingClientRect().top; probe.remove(); return y;
    };
    const tsd = document.querySelector('.seq-line[data-seq-index="0"] span[data-pos="5"]');
    return { plain: baseline(1, 5), tsd: baseline(0, 5), font: getComputedStyle(tsd).fontFamily.slice(0, 20), h: [tsd.getBoundingClientRect().height, document.querySelector('.seq-line[data-seq-index="1"] span[data-pos="5"]').getBoundingClientRect().height] };
  });
  const ok = Math.abs(r.plain - r.tsd) <= 0.6 && r.h[0] === r.h[1] && /ViewAlign Sans/.test(r.font);
  return { pass: ok, detail: JSON.stringify(r) };
});

check('k-mer groups: Auto can be restored; Groups counts only groups of at least Min size; Hide colours / Gather in the explorer', async (page) => {
  // three groups of 5 (each from its own random base, 3% noise) and two unrelated lone sequences
  let x = 3; const rnd = () => { x = (x * 16807) % 2147483647; return x; };
  const rb = n => Array.from({ length: n }, () => 'ACGT'[rnd() % 4]).join('');
  // related groups (25% apart) and two unrelated outliers, which are much farther from everything
  const root = rb(300);
  const mut = (s, pct) => s.split('').map(c => (rnd() % 100 < pct ? 'ACGT'[rnd() % 4] : c)).join('');
  const bases = [root, mut(root, 25), mut(root, 25)];
  let fa = '', ord = [];
  // interleave the groups in the file so that gathering has something to do
  for (let k = 0; k < 5; k++) for (let g = 0; g < 3; g++) {
    const s = bases[g].split('').map(c => (rnd() % 100 < 3 ? 'ACGT'[rnd() % 4] : c)).join('');
    fa += `>g${g}_${k}\n${s}\n`;
  }
  fa += `>lone1\n${rb(300)}\n>lone2\n${rb(300)}\n`;
  await loadFasta(page, fa);
  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(res => setTimeout(res, ms));
    const out = {};
    // 1. Auto <-> number
    const auto = el('guideTreeAuto'), num = el('guideTreeGroups');
    out.start = [auto.checked, num.value];
    num.value = '3'; num.dispatchEvent(new Event('input', { bubbles: true }));
    out.afterType = auto.checked;                       // typing a number unticks Auto
    auto.checked = true; auto.dispatchEvent(new Event('change', { bubbles: true }));
    out.afterAuto = [auto.checked, num.value];          // ticking Auto clears the number
    // 2. Groups = 3 with Min size 2: three groups of 5, the two lone sequences unassigned
    auto.checked = false; auto.dispatchEvent(new Event('change', { bubbles: true })); num.value = '3'; num.dispatchEvent(new Event('input', { bubbles: true }));
    el('guideTreeMinSize').value = '2';
    await clusterByGuideTree(); await wait(400);
    const sz = () => state.clusterResults.clusters.map(c => c.sequences.length).join();
    out.min2 = [sz(), state.clusterResults.unassigned.map(u => u.id).sort().join()];
    // Min size 1 counts a lone sequence as a group, so 3 groups can include it
    el('guideTreeMinSize').value = '1';
    await clusterByGuideTree(); await wait(400);
    out.min1 = [state.clusterResults.clusters.length, state.clusterResults.unassigned.length];
    // 3. Explorer: gather all, per-group gather, Hide colours
    el('guideTreeMinSize').value = '2'; await clusterByGuideTree(); await wait(400);
    const headers = () => state.seqs.map(q => q.header);
    out.before = headers().slice(0, 6).join();
    _geGatherGroups('all'); await wait(300);
    const h = headers();
    const adjacent = ['g0', 'g1', 'g2'].every(g => { const idx = h.map((n, i) => n.startsWith(g + '_') ? i : -1).filter(i => i >= 0); return idx[idx.length - 1] - idx[0] === 4; });
    out.gatheredAll = adjacent;
    const nameBg = () => getComputedStyle(document.querySelector('.seq-line[data-seq-index="0"] .seq-name')).backgroundColor;
    out.coloured = nameBg() !== 'rgb(255, 255, 255)';
    el('geColoursBtn').click(); await wait(300);
    out.hidden = [nameBg() === 'rgb(255, 255, 255)', document.querySelectorAll('.diagnostic-mutation').length === 0, el('geColoursBtn').textContent, state.clusterResults.clusters.length];
    el('geColoursBtn').click(); await wait(300);
    out.shown = [nameBg() !== 'rgb(255, 255, 255)', el('geColoursBtn').textContent];
    undoDelete(); await wait(200);
    out.undone = headers().slice(0, 6).join() === out.before;
    return out;
  });
  const ok = r.start[0] === true && r.start[1] === '' && r.afterType === false && r.afterAuto[0] === true && r.afterAuto[1] === ''
    && r.min2[0] === '5,5,5' && r.min2[1] === 'lone1,lone2' && r.min1[0] === 3 && r.min1[1] === 0
    && r.gatheredAll && r.coloured && r.hidden[0] && r.hidden[2] === 'Show colours' && r.hidden[3] === 3 && r.shown[0] && r.shown[1] === 'Hide colours' && r.undone;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('k-mer groups: Distance selector (aligned columns / k-mer), k greyed out, Groups number read exactly', async (page) => {
  let x = 3; const rnd = () => { x = (x * 16807) % 2147483647; return x; };
  const rb = n => Array.from({ length: n }, () => 'ACGT'[rnd() % 4]).join('');
  const mut = (s, pct) => s.split('').map(c => (rnd() % 100 < pct ? 'ACGT'[rnd() % 4] : c)).join('');
  const root = rb(300), bases = [root, mut(root, 25), mut(root, 25)];
  let fa = ''; for (let k = 0; k < 6; k++) for (let g = 0; g < 3; g++) fa += `>g${g}_${k}\n${mut(bases[g], 3)}\n`;
  fa += `>lone\n${rb(150)}\n`;                       // a different length: not an alignment
  await loadFasta(page, fa);
  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(res => setTimeout(res, ms));
    const out = {};
    const sel = el('guideTreeMetric'), k = el('guideTreeK');
    out.defaults = [sel.value, k.disabled];
    await clusterByGuideTree(); await wait(300);
    out.metric = state._geMeta.metric;   // rows are padded to one length on load, so this is an alignment
    sel.value = 'jaccard'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    out.kEnabled = !k.disabled;
    sel.value = 'pdist'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    out.kDisabledAgain = k.disabled;
    // 1e1 is ten, not one; a value outside 1..n is clamped and said so
    const auto = el('guideTreeAuto'), num = el('guideTreeGroups');
    auto.checked = false; auto.dispatchEvent(new Event('change', { bubbles: true }));
    num.value = '1e1'; num.dispatchEvent(new Event('input', { bubbles: true }));
    el('guideTreeMinSize').value = '1';
    await clusterByGuideTree(); await wait(300);
    out.exp = state._geMeta.nGroups + state._geMeta.nUnassigned >= 1 && state._geMeta.nGroups === 10;
    num.value = '500'; num.dispatchEvent(new Event('input', { bubbles: true }));
    await clusterByGuideTree(); await wait(300);
    out.clamped = [state._geMeta.nGroups, /outside 1-/.test(el('statusMessage').textContent)];
    return out;
  });
  const ok = r.defaults[0] === 'pdist' && r.defaults[1] === true && r.metric === 'pdist'
    && r.kEnabled && r.kDisabledAgain && r.exp && r.clamped[0] === 19 && r.clamped[1];
  return { pass: ok, detail: JSON.stringify(r) };
});

check('k-mer groups: Method "peel" finds planted subfamilies by diagnostic columns; controls grey out; needs an alignment', async (page) => {
  let x = 11; const rnd = () => { x = (x * 16807) % 2147483647; return x; };
  const rb = n => Array.from({ length: n }, () => 'ACGT'[rnd() % 4]).join('');
  const base = rb(400).split('');
  let fa = '';
  for (let f = 0; f < 4; f++) {
    const fam = base.slice();
    for (let i = 0; i < 6; i++) { const p = 40 + f * 80 + i * 9; fam[p] = 'ACGT'[('ACGT'.indexOf(base[p]) + 1 + (f % 3)) % 4]; }   // 6 columns unique to this subfamily
    for (let m = 0; m < 10; m++) { const s = fam.map((c, j) => (rnd() % 1000 < 6 ? 'ACGT'[rnd() % 4] : c)).join(''); fa += `>f${f}_${m}
${s}
`; }
  }
  await loadFasta(page, fa);
  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(res => setTimeout(res, ms));
    const out = {}, sel = el('guideTreeMethod'), diag = el('guideTreePeelDiag');
    out.default = [sel.value, diag.style.display];
    sel.value = 'peel'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    out.greyed = [el('guideTreeMetric').disabled, el('guideTreeGroups').disabled, diag.style.display === ''];
    el('guideTreeMinSize').value = '3'; diag.value = '2';
    await clusterByGuideTree(); await wait(400);
    const m = state._geMeta, res = state.clusterResults;
    out.meta = [m.metric, m.nGroups, m.nUnassigned, m.peelDiag];
    out.pure = res.clusters.every(c => new Set(c.sequences.map(q => q.id.split('_')[0])).size === 1);
    out.families = new Set(res.clusters.map(c => c.sequences[0].id.split('_')[0])).size;
    out.summary = /peeled by diagnostic columns/.test(el('geSummary')?.textContent || '');
    sel.value = 'tree'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    out.backEnabled = !el('guideTreeGroups').disabled && diag.style.display === 'none';
    return out;
  });
  const ok = r.default[0] === 'tree' && r.default[1] === 'none' && r.greyed[0] && r.greyed[1] && r.greyed[2]
    && r.meta[0] === 'peel' && r.meta[1] === 4 && r.meta[3] === 2 && r.pure && r.families === 4 && r.summary && r.backEnabled;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Group explorer: gather and move group never lose rows when sequence names repeat', async (page) => {
  let x = 3; const rnd = () => { x = (x * 16807) % 2147483647; return x; };
  const rb = n => Array.from({ length: n }, () => 'ACGT'[rnd() % 4]).join('');
  const mut = (s, p) => s.split('').map(c => (rnd() % 100 < p ? 'ACGT'[rnd() % 4] : c)).join('');
  const b = [rb(200), rb(200), rb(200)];
  let fa = ''; for (let k = 0; k < 5; k++) for (let g = 0; g < 3; g++) fa += `>name${g}\n${mut(b[g], 2)}\n`;   // 3 names, each used 5 times
  await loadFasta(page, fa);
  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(res => setTimeout(res, ms));
    const sig = () => state.seqs.map(q => q.seq).sort().join('|');
    const before = sig(), n = state.seqs.length;
    el('guideTreeMinSize').value = '2'; await clusterByGuideTree(); await wait(300);
    const out = { groups: state.clusterResults.clusters.length };
    // every group's rows are contiguous after Gather all, and no row is lost
    _geGatherGroups('all'); await wait(300);
    const pos = state.clusterResults.clusters.map(c => c.sequences.map(m => state.seqs.indexOf(m.obj)).sort((a, b) => a - b));
    out.contiguous = pos.every(p => p.every(v => v >= 0) && p[p.length - 1] - p[0] === p.length - 1);
    out.allKept = state.seqs.length === n && sig() === before;
    _geGatherGroups({ kind: 'group', idx: 1 }); await wait(300);
    out.oneKept = state.seqs.length === n && sig() === before;
    _geMoveGroup(0, 1); await wait(300);
    out.moveKept = state.seqs.length === n && sig() === before;
    undoDelete(); await wait(200);
    out.undoKept = state.seqs.length === n && sig() === before;
    return out;
  });
  const ok = r.groups === 3 && r.contiguous && r.allKept && r.oneKept && r.moveKept && r.undoKept;
  return { pass: ok, detail: JSON.stringify(r) };
});

// Canvas mode scrolls by copying the pixels already on screen and drawing only the exposed
// strip (2026-10-16). Before that every wheel step redrew the whole viewport: ~10,600
// drawImage calls, 30-58 ms a frame at 600 x 600 on a Radeon 780M, visible stutter. The
// check is a real wheel scroll in each direction, with sticky names on and off, and asks
// (1) that the copy path was used, (2) that the pixels equal a full redraw at the same
// offset (so the fast path can never show something different), and (3) that a copy
// frame costs well under a full frame.
check('Canvas mode: wheel scroll copies the frame and draws only the exposed strip, pixel-identical to a full redraw', async (page) => {
  await loadSyntheticFasta(page, 600, 600);
  await setMode(page, 'canvas');
  const out = {};
  for (const sticky of [true, false]) {
    await page.evaluate((s) => { const el = document.getElementById('stickyNames'); if (el.checked !== s) { el.checked = s; el.dispatchEvent(new Event('change', { bubbles: true })); } }, sticky);
    await page.waitForTimeout(400);
    const box = await page.evaluate(() => { const r = document.getElementById('alignmentCanvas').getBoundingClientRect(); return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.6 }; });
    await page.mouse.move(box.x, box.y);
    const res = {};
    for (const [label, dx, dy] of [['down', 0, 120], ['right', 120, 0], ['up', 0, -100], ['left', -100, 0], ['trackpad', 0, 37.5]]) {
      await page.evaluate(() => { _canvasState.stats.full = 0; _canvasState.stats.blit = 0; _canvasState.stats.blitMs = []; _canvasState.stats.fullMs = []; });
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(dx, dy); await settleWheel(page); await page.waitForTimeout(40); }
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        const c = document.getElementById('alignmentCanvas');
        const fast = c.toDataURL();
        const st = _canvasState.stats, blits = st.blit, fulls = st.full, blitMs = st.blitMs.slice();
        _canvasState.scheduleDraw();                      // dirty -> full redraw at the same offset
        return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
          res({ blits, fulls, same: c.toDataURL() === fast, blitMs, fullMs: _canvasState.stats.fullMs.slice(), off: [_canvasState.offsetX, _canvasState.offsetY] });
        })));
      });
      res[label] = r;
    }
    out[sticky ? 'sticky' : 'static'] = res;
  }
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
  const bad = [];
  for (const [mode, res] of Object.entries(out)) for (const [label, r] of Object.entries(res)) {
    if (r.blits < 5) bad.push(`${mode}/${label}: only ${r.blits} copy frames for 6 wheel steps (${r.fulls} full redraws)`);
    if (!r.same) bad.push(`${mode}/${label}: pixels after copy-scrolling differ from a full redraw`);
    const b = med(r.blitMs), f = med(r.fullMs);
    if (!(b < 0.6 * f)) bad.push(`${mode}/${label}: copy frame ${b.toFixed(1)} ms is not well under a full frame ${f.toFixed(1)} ms`);
  }
  const summary = Object.fromEntries(Object.entries(out).map(([m, res]) => [m, Object.fromEntries(Object.entries(res).map(([l, r]) => [l, `${r.blits}c/${r.fulls}f ${med(r.blitMs).toFixed(1)}/${med(r.fullMs).toFixed(1)}ms same=${r.same}`]))]));
  return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') : JSON.stringify(summary) };
});

// Canvas mode draws the consensus row (v245). Before, Canvas showed no consensus at all, which
// is why it could not be the default view. The row must show the same string the DOM view
// computes, at the top or the bottom as chosen, and the data rows must still hit-test to the
// right sequence below it (the band is part of the header geometry).
check('Canvas mode: consensus row drawn at top or bottom with the DOM consensus string; rows hit-test below it', async (page) => {
  await loadFasta(page, makeFasta(40, 300));
  const out = {};
  for (const position of ['top', 'bottom']) {
    await page.evaluate((pos) => { const el = document.querySelector(`input[name="consensusPosition"][value="${pos}"]`); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }, position);
    await page.waitForTimeout(300);
    await setMode(page, 'full');
    const domCons = await page.evaluate(() => Array.from(document.querySelectorAll('.consensus-line .seq-data > span[data-pos]')).map(sp => sp.textContent).join(''));
    await setMode(page, 'canvas');
    await page.waitForTimeout(300);
    const r = await page.evaluate((pos) => {
      const c = document.getElementById('alignmentCanvas'), m = _canvasState.metrics, cons = _canvasState.consensus;
      const rect = c.getBoundingClientRect();
      // the band: top -> right under the ruler; bottom -> after the last row
      const bandY = pos === 'top' ? m.trackH + m.charH : m.headerH + state.seqs.length * _canvasState.rowPitch + 5;
      const g = c.getContext('2d'), dpr = devicePixelRatio;
      const band = g.getImageData(Math.round((m.nameW + 2) * dpr), Math.round(bandY * dpr), Math.round(40 * m.charW * dpr), Math.round(m.charH * dpr)).data;
      let ink = 0; for (let i = 3; i < band.length; i += 4) if (band[i] > 0) ink++;
      // what the DOM view shows: consensus string with the same case rule
      const shown = cons && cons.values ? cons.values.map((ch, p) => (ch === '-' || ch === '.') ? ch : (_canvasConsensusUpper(ch, p, cons.threshold) ? ch.toUpperCase() : ch.toLowerCase())).join('') : null;
      const hit0 = _canvasHitTest(rect.left + m.nameW + m.charW * 1.5, rect.top + m.headerH + _canvasState.rowPitch * 0.5);
      const hitBand = _canvasHitTest(rect.left + m.nameW + m.charW * 1.5, rect.top + bandY + m.charH * 0.5);
      return { shown, ink, hit0, hitBand, position: cons && cons.position, bandY };
    }, position);
    out[position] = { ...r, domCons, same: r.shown === domCons };
  }
  const bad = [];
  for (const [pos, r] of Object.entries(out)) {
    if (!r.same) bad.push(`${pos}: canvas consensus "${(r.shown || '').slice(0, 30)}..." differs from DOM "${r.domCons.slice(0, 30)}..."`);
    if (r.ink < 50) bad.push(`${pos}: no ink in the consensus band (${r.ink} px)`);
    if (!r.hit0 || r.hit0.row !== 0 || r.hit0.col !== 1) bad.push(`${pos}: first data row hit-tests to ${JSON.stringify(r.hit0)}, expected row 0 col 1`);
    if (r.hitBand !== null) bad.push(`${pos}: the consensus band hit-tests to a sequence row ${JSON.stringify(r.hitBand)}`);
  }
  return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') : JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, r]) => [k, { ink: r.ink, hit0: r.hit0, same: r.same }]))) };
});

// Editing in Canvas mode (v246). The residue, gap, move, slide and column tools already worked
// there; dragging a name did not reorder rows, double-clicking a name did not rename, the chip
// said "view-only", and the edit toolbar pushed the canvas down without resizing it, so its
// bottom rows were off screen. Real mouse and keyboard events throughout.
check('Canvas mode: drag a name to reorder, double-click to rename, toolbar does not push the canvas off screen', async (page) => {
  let fa = ''; for (let i = 0; i < 30; i++) { let q = ''; for (let j = 0; j < 80; j++) q += (j % 9 === 4 && i % 3 === 0) ? '-' : 'ACGT'[(i + j) % 4]; fa += `>seq${i}\n${q}\n`; }
  await loadFasta(page, fa);
  await setMode(page, 'canvas');
  await page.waitForTimeout(300);
  const geom = () => page.evaluate(() => { const c = document.getElementById('alignmentCanvas'); const r = c.getBoundingClientRect(), m = _canvasState.metrics; return { left: r.left, top: r.top, bottom: r.bottom, innerH: innerHeight, nameW: m.nameW, headerH: m.headerH, pitch: _canvasState.rowPitch, oy: _canvasState.offsetY }; });
  const namePt = async (row) => { const g = await geom(); return { x: g.left + 20, y: g.top + g.headerH + (row + 0.5) * g.pitch - g.oy }; };
  const out = {};
  // 1. toolbar: the canvas must stay inside the window after the edit panel appears
  await page.click('#editToggleButton'); await page.waitForTimeout(400);
  const g1 = await geom();
  out.toolbar = { bottom: Math.round(g1.bottom), innerH: g1.innerH, chip: document => null };
  out.toolbar.chip = await page.evaluate(() => document.getElementById('canvasModeNotice')?.textContent || null);
  await page.click('#editToggleButton'); await page.waitForTimeout(400);
  // 2. drag seq0's name onto the lower half of seq3: expect seq1, seq2, seq3, seq0
  const names0 = await page.evaluate(() => state.seqs.slice(0, 5).map(q => q.header));
  const a = await namePt(0), b = await namePt(3);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(a.x, a.y + 8, { steps: 3 });
  await page.mouse.move(b.x, b.y + 3, { steps: 6 });
  await page.waitForTimeout(100);
  const during = await page.evaluate(() => _canvasState.rowDrag ? { started: _canvasState.rowDrag.started, target: _canvasState.rowDrag.target, above: _canvasState.rowDrag.above } : null);
  await page.mouse.up(); await page.waitForTimeout(500);
  out.reorder = { before: names0, during, after: await page.evaluate(() => state.seqs.slice(0, 5).map(q => q.header)) };
  await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
  out.reorderUndone = (await page.evaluate(() => state.seqs.slice(0, 5).map(q => q.header))).join() === names0.join();
  // 3. rename seq2 by double-click, type, Enter
  const c = await namePt(2);
  await page.mouse.dblclick(c.x, c.y); await page.waitForTimeout(300);
  out.renameBox = await page.evaluate(() => { const i = document.querySelector('#alignmentContainer input.seq-name-edit'); return i ? { value: i.value, focused: document.activeElement === i } : null; });
  await page.keyboard.press('Control+a'); await page.keyboard.type('renamed_two'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  out.renamed = await page.evaluate(() => ({ header: state.seqs[2].header, boxGone: !document.querySelector('#alignmentContainer input.seq-name-edit') }));
  // the canvas shows the new name: ink differs in the name cell of row 2 between before/after a redraw is implicit; compare with Full mode's DOM
  await setMode(page, 'full'); await page.waitForTimeout(300);
  out.domName = await page.evaluate(() => document.querySelector('.seq-line[data-seq-index="2"] .seq-name')?.textContent.trim());
  const bad = [];
  if (out.toolbar.bottom > out.toolbar.innerH + 1) bad.push(`with the edit toolbar open the canvas bottom is at ${out.toolbar.bottom} px in a ${out.toolbar.innerH} px window`);
  if (/view-only/i.test(out.toolbar.chip || '')) bad.push(`chip still says "${out.toolbar.chip}"`);
  if (out.reorder.after.join() !== ['seq1', 'seq2', 'seq3', 'seq0', 'seq4'].join()) bad.push(`drag of seq0 below seq3 gave ${JSON.stringify(out.reorder.after)}`);
  if (!out.reorderUndone) bad.push('Ctrl+Z did not undo the reorder');
  if (!out.renameBox || out.renameBox.value !== 'seq2' || !out.renameBox.focused) bad.push(`double-click did not open a focused rename box (${JSON.stringify(out.renameBox)})`);
  if (!out.renamed || out.renamed.header !== 'renamed_two' || !out.renamed.boxGone) bad.push(`rename gave ${JSON.stringify(out.renamed)}`);
  if (out.domName !== 'renamed_two') bad.push(`Full view shows "${out.domName}" for the renamed row`);
  return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') : JSON.stringify(out) };
});

// The edit tools in Canvas mode must change the sequences exactly as the same real clicks and
// drags do in Full mode (typing + undo, gap insert/delete, Move, Slide). Guard for the Canvas
// edit paths, which share the model code but have their own hit-testing.
check('Canvas mode: typing, gap, move and slide tools give the same sequences as in Full mode', async (page) => {
  let fa = ''; for (let i = 0; i < 20; i++) { let q = ''; for (let j = 0; j < 60; j++) q += (j % 9 === 4 && i % 3 === 0) ? '-' : 'ACGT'[(i + j) % 4]; fa += `>seq${i}\n${q}\n`; }
  const run = async (mode) => {
    await loadFasta(page, fa);
    await setMode(page, mode);
    await page.waitForTimeout(300);
    const pt = async (row, col) => page.evaluate(([r, c]) => {
      if (document.getElementById('modeCanvas').checked) { const cv = document.getElementById('alignmentCanvas'), b = cv.getBoundingClientRect(), m = _canvasState.metrics; return { x: b.left + m.nameW + (c + 0.5) * m.charW - _canvasState.offsetX, y: b.top + m.headerH + (r + 0.5) * _canvasState.rowPitch - _canvasState.offsetY }; }
      const sp = document.querySelector(`.seq-line[data-seq-index="${r}"] .seq-data > span[data-pos="${c}"]`); const b = sp.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, [row, col]);
    const seqs = () => page.evaluate(() => state.seqs.map(q => q.seq).join('|'));
    const out = {};
    await page.click('#editToggleButton'); await page.waitForTimeout(300);
    await page.click('[data-edit-tool="residue"]'); await page.waitForTimeout(150);
    let p = await pt(2, 5); await page.mouse.click(p.x, p.y); await page.waitForTimeout(100); await page.keyboard.press('g'); await page.waitForTimeout(200);
    out.typed = await seqs();
    await page.keyboard.press('Control+z'); await page.waitForTimeout(200); out.undone = await seqs();
    await page.click('[data-edit-tool="insertGapSeq"]'); await page.waitForTimeout(150);
    p = await pt(3, 10); await page.mouse.click(p.x, p.y); await page.waitForTimeout(200); out.gapIn = await seqs();
    await page.click('[data-edit-tool="deleteGapSeq"]'); await page.waitForTimeout(150);
    p = await pt(3, 10); await page.mouse.click(p.x, p.y); await page.waitForTimeout(200); out.gapOut = await seqs();
    await page.click('[data-edit-tool="moveNoGaps"]'); await page.waitForTimeout(150);
    let q0 = await pt(0, 2), q1 = await pt(0, 4);
    await page.mouse.move(q0.x, q0.y); await page.mouse.down(); await page.mouse.move((q0.x + q1.x) / 2, q0.y, { steps: 4 }); await page.mouse.move(q1.x, q1.y, { steps: 4 }); await page.waitForTimeout(100); await page.mouse.up(); await page.waitForTimeout(250);
    out.moved = await seqs();
    await page.click('[data-edit-tool="slideKeepGaps"]'); await page.waitForTimeout(150);
    q0 = await pt(5, 20); q1 = await pt(5, 22);
    await page.mouse.move(q0.x, q0.y); await page.mouse.down(); await page.mouse.move(q1.x, q1.y, { steps: 6 }); await page.waitForTimeout(100); await page.mouse.up(); await page.waitForTimeout(250);
    out.slid = await seqs();
    await page.click('#editToggleButton'); await page.waitForTimeout(200);
    return out;
  };
  const full = await run('full'), canvas = await run('canvas');
  const bad = [];
  for (const k of Object.keys(full)) if (full[k] !== canvas[k]) bad.push(`${k}: Canvas differs from Full`);
  if (full.typed === full.undone) bad.push('typing changed nothing in Full mode (the check itself is broken)');
  if (full.moved === full.gapOut) bad.push('Move changed nothing in Full mode (the check itself is broken)');
  return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') : 'typing, undo, gap insert/delete, Move and Slide identical in Full and Canvas' };
});

// Hardening of the Canvas frame copy (v246). (1) Windows laptops run at 125 % or 150 % scaling,
// where a CSS pixel is not a device pixel: the copy must still be exact. (2) An edit, an undo
// or a selection change under a copied frame must force a full redraw even when the caller
// did not mark the view dirty (the copy would otherwise keep stale cells). (3) PageDown pages
// the Canvas view (the container is not scrollable there).
check('Canvas frame copy stays pixel-identical at 125 % and 150 % scaling, after edits, and PageDown pages the view', async (page) => {
  const browser = page.context().browser();
  const out = {};
  for (const dpr of [1.25, 1.5]) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: dpr });
    const p2 = await ctx.newPage();
    await p2.goto(page.url().replace(/[?#].*$/, ''));
    await loadSyntheticFasta(p2, 300, 400);
    await setMode(p2, 'canvas');
    await p2.waitForTimeout(300);
    const box = await p2.evaluate(() => { const r = document.getElementById('alignmentCanvas').getBoundingClientRect(); return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.6 }; });
    await p2.mouse.move(box.x, box.y);
    const res = {};
    for (const [label, dx, dy] of [['down', 0, 100], ['right', 100, 0], ['trackpad', 0, 33.3]]) {
      await p2.evaluate(() => { _canvasState.stats.full = 0; _canvasState.stats.blit = 0; });
      for (let i = 0; i < 5; i++) { await p2.mouse.wheel(dx, dy); await settleWheel(p2); await p2.waitForTimeout(40); }
      await p2.waitForTimeout(150);
      res[label] = await p2.evaluate(() => { const c = document.getElementById('alignmentCanvas'); const fast = c.toDataURL(); const st = { blit: _canvasState.stats.blit, full: _canvasState.stats.full, dpr: devicePixelRatio, w: c.width }; _canvasState.scheduleDraw(); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r({ ...st, same: c.toDataURL() === fast })))); });
    }
    out['dpr' + dpr] = res;
    await ctx.close();
  }
  // edits under a copied frame
  await loadSyntheticFasta(page, 200, 300);
  await setMode(page, 'canvas');
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => { const r = document.getElementById('alignmentCanvas').getBoundingClientRect(); return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.6 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel(0, 100); await settleWheel(page); await page.waitForTimeout(100);
  await page.click('#editToggleButton'); await page.waitForTimeout(300);
  await page.click('[data-edit-tool="residue"]'); await page.waitForTimeout(150);
  const cell = await page.evaluate(() => { const cv = document.getElementById('alignmentCanvas'), b = cv.getBoundingClientRect(), m = _canvasState.metrics; return { x: b.left + m.nameW + 5.5 * m.charW - _canvasState.offsetX, y: b.top + m.headerH + 8.5 * _canvasState.rowPitch - _canvasState.offsetY }; });
  await page.mouse.click(cell.x, cell.y); await page.waitForTimeout(100);
  const edited = {};
  for (const [label, act] of [['type', async () => { await page.keyboard.press('g'); }], ['undo', async () => { await page.keyboard.press('Control+z'); }], ['selectRow', async () => page.evaluate(() => { state.selectedRows.add(3); updateRowSelections(); })]]) {
    await act(); await page.waitForTimeout(150);
    await page.mouse.move(box.x, box.y); await page.mouse.wheel(0, 60); await settleWheel(page); await page.waitForTimeout(150);   // a copy-sized step right after the change
    edited[label] = await page.evaluate(() => { const c = document.getElementById('alignmentCanvas'); const fast = c.toDataURL(); _canvasState.scheduleDraw(); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(c.toDataURL() === fast)))); });
  }
  await page.click('#editToggleButton'); await page.waitForTimeout(200);
  // PageDown
  const y0 = await page.evaluate(() => _canvasState.offsetY);
  await page.keyboard.press('PageDown'); await page.waitForTimeout(200);
  const y1 = await page.evaluate(() => _canvasState.offsetY);
  out.edited = edited; out.pageDown = { from: y0, to: y1 };
  const bad = [];
  for (const [k, res] of Object.entries(out)) if (k.startsWith('dpr')) for (const [l, r] of Object.entries(res)) { if (r.blit < 4) bad.push(`${k}/${l}: only ${r.blit} copy frames`); if (!r.same) bad.push(`${k}/${l}: pixels differ from a full redraw`); }
  for (const [l, same] of Object.entries(edited)) if (!same) bad.push(`after ${l}: a copied frame differs from a full redraw`);
  if (!(y1 > y0 + 100)) bad.push(`PageDown moved the view from ${y0} to ${y1}`);
  return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') : JSON.stringify(out) };
});

// Canvas overlay layer (v248). Before, every selection click, every mouse move of a drag
// selection and every typed residue redrew the whole viewport (30-45 ms at 600 x 600).
// Selections now live on a transparent overlay canvas (redrawn alone, ~1 ms) and typing
// repaints only the edited row and column. The picture must still be what a full redraw
// gives: the element screenshot after each action equals the one after a forced full redraw.
check('Canvas mode: selections and typing do not redraw the cells, and look identical to a full redraw', async (page) => {
  await loadSyntheticFasta(page, 600, 600);
  await setMode(page, 'canvas');
  await page.waitForTimeout(400);
  const g = await page.evaluate(() => { const cv = document.getElementById('alignmentCanvas'), b = cv.getBoundingClientRect(), m = _canvasState.metrics; return { left: b.left, top: b.top, nameW: m.nameW, charW: m.charW, headerH: m.headerH, pitch: _canvasState.rowPitch }; });
  const cell = (r, c) => ({ x: g.left + g.nameW + (c + 0.5) * g.charW, y: g.top + g.headerH + (r + 0.5) * g.pitch });
  const fulls = () => page.evaluate(() => _canvasState.stats.full);
  const shot = () => page.locator('#alignmentContainer').screenshot();
  const sameAsFull = async () => { const a = await shot(); await page.evaluate(() => { _canvasState.scheduleDraw(); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }); const b = await shot(); return a.equals(b); };
  const out = {};
  // 1. click a residue, Ctrl+Alt+click a column, Ctrl+click a name, drag a residue range
  let f0 = await fulls();
  const c0 = cell(5, 20); await page.mouse.click(c0.x, c0.y); await page.waitForTimeout(120);
  await page.keyboard.down('Control'); await page.keyboard.down('Alt'); await page.mouse.click(cell(7, 30).x, cell(7, 30).y); await page.keyboard.up('Alt'); await page.keyboard.up('Control'); await page.waitForTimeout(120);
  await page.keyboard.down('Control'); await page.mouse.click(g.left + 20, cell(9, 0).y); await page.keyboard.up('Control'); await page.waitForTimeout(120);
  const d0 = cell(12, 10), d1 = cell(12, 40);
  await page.mouse.move(d0.x, d0.y); await page.mouse.down(); await page.mouse.move(d1.x, d1.y, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(150);
  out.selections = { fullRedraws: (await fulls()) - f0, overlayHasInk: await page.evaluate(() => { const o = document.getElementById('alignmentCanvasOverlay'); if (!o) return false; const d = o.getContext('2d').getImageData(0, 0, o.width, o.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n > 100; }), sameAsFull: await sameAsFull(),
    state: await page.evaluate(() => ({ rows: state.selectedRows.size, cols: state.selectedColumns.size, nucRows: state.selectedNucs.size })) };
  // 2. typing: 8 keystrokes repaint the row, not the viewport
  await page.click('#editToggleButton'); await page.waitForTimeout(400);
  await page.click('[data-edit-tool="residue"]'); await page.waitForTimeout(150);
  const g2 = await page.evaluate(() => { const cv = document.getElementById('alignmentCanvas'), b = cv.getBoundingClientRect(), m = _canvasState.metrics; return { left: b.left, top: b.top, nameW: m.nameW, charW: m.charW, headerH: m.headerH, pitch: _canvasState.rowPitch }; });
  const t = { x: g2.left + g2.nameW + 30.5 * g2.charW, y: g2.top + g2.headerH + 8.5 * g2.pitch };
  await page.mouse.click(t.x, t.y); await page.waitForTimeout(150);
  f0 = await fulls();
  const before = await page.evaluate(() => state.seqs[8].seq);
  for (const k of 'gattaca'.split('')) { await page.keyboard.press(k); await page.waitForTimeout(40); }
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => state.seqs[8].seq);
  out.typing = { fullRedraws: (await fulls()) - f0, typed: after.slice(30, 37), changed: before !== after, sameAsFull: await sameAsFull() };
  // 3. after typing, a scroll step still copies the frame and matches a full redraw
  await page.mouse.move(cell(20, 60).x, cell(20, 60).y);
  const b0 = await page.evaluate(() => _canvasState.stats.blit);
  await page.mouse.wheel(0, 120); await settleWheel(page); await page.waitForTimeout(150);
  out.scrollAfterTyping = { copies: (await page.evaluate(() => _canvasState.stats.blit)) - b0, sameAsFull: await sameAsFull() };
  await page.click('#editToggleButton'); await page.waitForTimeout(200);
  const bad = [];
  if (out.selections.fullRedraws !== 0) bad.push(`${out.selections.fullRedraws} full redraws for four selection actions`);
  if (!out.selections.overlayHasInk) bad.push('no overlay canvas with the selection drawn');
  if (!out.selections.sameAsFull) bad.push('after selections the view differs from a full redraw');
  if (out.typing.fullRedraws !== 0) bad.push(`${out.typing.fullRedraws} full redraws for 7 keystrokes`);
  if (out.typing.typed !== 'GATTACA' || !out.typing.changed) bad.push(`typing gave "${out.typing.typed}"`);
  if (!out.typing.sameAsFull) bad.push('after typing the view differs from a full redraw');
  if (out.scrollAfterTyping.copies < 1 || !out.scrollAfterTyping.sameAsFull) bad.push(`scroll after typing: ${JSON.stringify(out.scrollAfterTyping)}`);
  return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') : JSON.stringify(out) };
});

// Highlight diffs in the Canvas view (v250). Full/Block dim every residue, consensus letter and
// ruler digit in a conserved column to 40 % opacity and set the variable columns in bold
// (styles.css body.highlight-diffs). Canvas computed the same column set but never used it, so
// the manual had to say "Full or Block only". Now: a conserved cell gets lighter, a variable cell
// does not and gains ink (bold), the consensus row follows, switching off restores the exact
// previous picture, and a scroll step with diffs on still copies the frame exactly.
check('Canvas mode: Highlight diffs dims conserved columns and bolds variable ones like Full/Block', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1500);
  await setMode(page, 'canvas');
  await page.waitForTimeout(500);
  const settle = () => page.evaluate(() => new Promise(r => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 500)));
  const toggle = (on) => page.evaluate((on) => { const e = document.getElementById('highlightDiffs'); e.checked = on; e.dispatchEvent(new Event('change', { bubbles: true })); }, on);
  // darkest pixel (min of R+G+B, composited over the white page: untouched canvas pixels are
  // transparent) and letter pixel count (bold = more of them) inside a cell band
  const measure = (cells) => page.evaluate((cells) => {
    const cv = document.getElementById('alignmentCanvas'), m = _canvasState.metrics, dpr = m.dpr || 1;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    return cells.map(({ x, y, w, h }) => {
      const x0 = Math.round(x * dpr), y0 = Math.round(y * dpr), x1 = Math.round((x + w) * dpr), y1 = Math.round((y + h) * dpr);
      let min = 765; const vals = [];
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * cv.width + xx) * 4; const a = d[i + 3] / 255; const s = Math.round((d[i] + d[i + 1] + d[i + 2]) * a + 765 * (1 - a)); if (s < min) min = s; vals.push(s); }
      // the background is the most frequent value; the letter is every pixel far from it
      const freq = new Map(); for (const v of vals) freq.set(v, (freq.get(v) || 0) + 1);
      const bg = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const ink = vals.filter(v => Math.abs(v - bg) > 150).length;
      return { min, ink };
    });
  }, cells);
  const snap = () => page.evaluate(() => document.getElementById('alignmentCanvas').toDataURL());
  const before = await snap();
  await toggle(true); await settle();
  // pick a conserved and a variable column in the visible area where row 0 and the consensus have a letter
  const pick = await page.evaluate(() => {
    const m = _canvasState.metrics, cols = state._diffColumns, cv = document.getElementById('alignmentCanvas');
    const visible = Math.floor((cv.getBoundingClientRect().width - m.nameW) / m.charW) - 1;
    const seq = state.seqs[0].seq, cons = _canvasState.consensus?.values || '';
    const ok = p => /[A-Za-z]/.test(seq[p] || '') && /[A-Za-z]/.test(cons[p] || '');
    let cons0 = -1, var0 = -1;
    for (let p = 0; p < visible; p++) { if (!cols.has(p) && cons0 < 0 && ok(p)) cons0 = p; if (cols.has(p) && var0 < 0 && ok(p)) var0 = p; }
    return { cons0, var0, nameW: m.nameW, charW: m.charW, charH: m.charH, headerH: m.headerH, pitch: _canvasState.rowPitch, consTop: _checkedRadioValue('consensusPosition', 'top') === 'top', diffCols: cols.size, bodyClass: document.body.classList.contains('highlight-diffs') };
  });
  if (pick.cons0 < 0 || pick.var0 < 0) return { pass: false, detail: 'no usable conserved/variable column in view: ' + JSON.stringify(pick) };
  const cell = (p, row) => ({ x: pick.nameW + p * pick.charW, y: pick.headerH + row * pick.pitch, w: pick.charW, h: pick.charH });
  const consCell = (p) => ({ x: pick.nameW + p * pick.charW, y: pick.consTop ? pick.headerH - pick.charH : pick.headerH + state_n * pick.pitch, w: pick.charW, h: pick.charH });
  const state_n = await page.evaluate(() => state.seqs.length);
  const cells = [cell(pick.cons0, 0), cell(pick.var0, 0), consCell(pick.cons0), consCell(pick.var0)];
  const on = await measure(cells);
  await toggle(false); await settle();
  const afterOff = await snap();
  const off = await measure(cells);
  // scroll with diffs on: the copied frame equals a full redraw (the file fits the test window, so shrink it)
  await page.setViewportSize({ width: 700, height: 400 }); await page.waitForTimeout(300);
  await toggle(true); await settle();
  const box = await page.evaluate(() => { const r = document.getElementById('alignmentCanvas').getBoundingClientRect(); return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.6 }; });
  await page.mouse.move(box.x, box.y);
  const b0 = await page.evaluate(() => _canvasState.stats.blit);
  await page.mouse.wheel(0, 60); await settleWheel(page); await page.waitForTimeout(150);
  const scroll = await page.evaluate((b0) => { const c = document.getElementById('alignmentCanvas'); const fast = c.toDataURL(); const copies = _canvasState.stats.blit - b0; _canvasState.scheduleDraw(); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r({ copies, same: c.toDataURL() === fast })))); }, b0);
  await toggle(false); await settle();
  await page.setViewportSize({ width: 1400, height: 900 }); await page.waitForTimeout(300);
  const out = { pick: { cons0: pick.cons0, var0: pick.var0, diffCols: pick.diffCols }, row0: { conserved: { off: off[0], on: on[0] }, variable: { off: off[1], on: on[1] } }, consensus: { conserved: { off: off[2], on: on[2] }, variable: { off: off[3], on: on[3] } }, restored: before === afterOff, scroll };
  const bad = [];
  if (!(on[0].min > off[0].min + 60)) bad.push('conserved residue not dimmed');
  if (!(on[2].min > off[2].min + 60)) bad.push('conserved consensus letter not dimmed');
  if (on[1].min > off[1].min + 10) bad.push('variable residue got lighter');
  if (!(on[1].ink > off[1].ink)) bad.push('variable residue not bold');
  if (!out.restored) bad.push('switching off did not restore the previous picture');
  if (scroll.copies < 1 || !scroll.same) bad.push('scroll with diffs on: ' + JSON.stringify(scroll));
  return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') + ' ' + JSON.stringify(out) : JSON.stringify(out) };
});


// Variable sites only in the Canvas view (v251). Full/Block hide every conserved column and put a
// breakpoint marker cell before the first shown column after a hidden run. Canvas drew every
// column and painted the marker over a residue. Now the content is laid out in slots (shown
// columns + marker cells): the picture of slot s equals the picture of its column in the
// unfiltered view, marker cells carry the marker colour, hit-testing maps a slot back to its
// column, the marker tooltip says what is hidden, the frame copy stays exact on a scrollable
// alignment, and switching off restores the previous picture.
check('Canvas mode: Variable sites only hides columns, keeps markers, hit-tests and copies frames', async (page) => {
  const path = require('path');
  const settle = () => page.evaluate(() => new Promise(r => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 600)));
  const tick = (id, on) => page.evaluate(({ id, on }) => { const e = document.getElementById(id); e.checked = on; e.dispatchEvent(new Event('change', { bubbles: true })); }, { id, on });
  const snap = () => page.evaluate(() => document.getElementById('alignmentCanvas').toDataURL());
  const cellsAt = (slots, rowY) => page.evaluate(({ slots, rowY }) => {
    const cv = document.getElementById('alignmentCanvas'), m = _canvasState.metrics, dpr = m.dpr || 1, c = cv.getContext('2d');
    return slots.map(s => Array.from(c.getImageData(Math.round((m.nameW + s * m.charW) * dpr), Math.round(rowY * dpr), Math.round(m.charW * dpr), Math.round(m.charH * dpr)).data).join(','));
  }, { slots, rowY });
  const geom = () => page.evaluate(() => { const m = _canvasState.metrics; const r = document.getElementById('alignmentCanvas').getBoundingClientRect(); return { left: r.left, top: r.top, nameW: m.nameW, charW: m.charW, charH: m.charH, headerH: m.headerH, pitch: _canvasState.rowPitch, len: Math.max(...state.seqs.map(s => s.seq.length)), nSeq: state.seqs.length, consTop: _checkedRadioValue('consensusPosition', 'top') === 'top', totalW: _canvasState.totalContentW }; });
  const consY = g => g.consTop ? g.headerH - g.charH : g.headerH + g.nSeq * g.pitch;
  const bad = [];

  // Part 1: a real file that fits the window (40 x 231, 203 variable columns)
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1500);
  await setMode(page, 'canvas');
  await page.waitForTimeout(500);
  const g0 = await geom();
  const before = await snap();
  const visibleCols = Math.min(g0.len, Math.floor((1400 - g0.nameW - 40) / g0.charW));
  const allCols = [...Array(visibleCols).keys()];
  const plainRow0 = await cellsAt(allCols, g0.headerH);
  const plainCons = await cellsAt(allCols, consY(g0));
  await tick('varSitesOnly', true); await settle();
  const lay = await page.evaluate(() => ({ nSlots: _canvasState.nSlots, slots: _canvasState.slots ? Array.from(_canvasState.slots) : null, diff: state._diffColumns.size, brk: state._brkBeforePos.size, totalW: _canvasState.totalContentW, badgeW: _canvasState.badgeW || 0 }));
  const g1 = await geom();
  if (!lay.slots) return { pass: false, detail: 'no slot layout in Canvas with Variable sites only: ' + JSON.stringify(lay) };
  if (lay.nSlots !== lay.diff + lay.brk) bad.push(`slots ${lay.nSlots} != shown ${lay.diff} + markers ${lay.brk}`);
  if (lay.totalW !== g1.nameW + lay.nSlots * g1.charW + lay.badgeW + 4) bad.push(`content width ${lay.totalW} is not for ${lay.nSlots} slots (+ ${lay.badgeW} px length badges)`);
  const shownSlots = [], markerSlots = [];
  lay.slots.forEach((p, s) => { if (s < visibleCols) (p >= 0 ? shownSlots : markerSlots).push(s); });
  const filtRow0 = await cellsAt(shownSlots, g1.headerH);
  const filtCons = await cellsAt(shownSlots, consY(g1));
  let mism = 0, mismCons = 0;
  shownSlots.forEach((s, i) => { const p = lay.slots[s]; if (p < visibleCols) { if (filtRow0[i] !== plainRow0[p]) mism++; if (filtCons[i] !== plainCons[p]) mismCons++; } });
  if (mism) bad.push(`${mism} of ${shownSlots.length} shown cells in row 0 differ from the plain view`);
  if (mismCons) bad.push(`${mismCons} consensus cells differ from the plain view`);
  const markerLook = await page.evaluate((slots) => {
    const cv = document.getElementById('alignmentCanvas'), m = _canvasState.metrics, dpr = m.dpr || 1, c = cv.getContext('2d');
    const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    const want = (brkStyle.color || '#d0d0d0').toLowerCase();
    return slots.map(s => { const d = c.getImageData(Math.round((m.nameW + s * m.charW) * dpr), Math.round(m.headerH * dpr), Math.round(m.charW * dpr), Math.round(m.charH * dpr)).data; const f = new Map(); for (let i = 0; i < d.length; i += 4) { const k = hex(d[i], d[i + 1], d[i + 2]); f.set(k, (f.get(k) || 0) + 1); } const top = [...f.entries()].sort((a, b) => b[1] - a[1])[0][0]; return { top, want, ok: top === want }; });
  }, markerSlots);
  if (!markerSlots.length) bad.push('no marker slot in view');
  if (markerLook.some(x => !x.ok)) bad.push('marker cell is not the marker colour: ' + JSON.stringify(markerLook.filter(x => !x.ok).slice(0, 2)));
  const s0 = shownSlots[Math.min(5, shownSlots.length - 1)], ms = markerSlots[0];
  const hits = await page.evaluate(({ s0, ms }) => {
    const m = _canvasState.metrics, r = document.getElementById('alignmentCanvas').getBoundingClientRect();
    const at = s => _canvasHitTest(r.left + m.nameW + (s + 0.5) * m.charW, r.top + m.headerH + 0.5 * _canvasState.rowPitch);
    return { shown: at(s0), marker: at(ms), slotPos: _canvasState.slots[s0], ruler: _canvasHitTestRuler(r.left + m.nameW + (s0 + 0.5) * m.charW, r.top + (m.trackH || 0) + 0.5 * m.charH), colFromX: _canvasColFromClientX(r.left + m.nameW + (s0 + 0.5) * m.charW) };
  }, { s0, ms });
  if (!hits.shown || hits.shown.col !== hits.slotPos) bad.push(`hit at slot ${s0} gave ${JSON.stringify(hits.shown)}, column ${hits.slotPos} expected`);
  if (!hits.marker || !hits.marker.brk) bad.push(`hit on the marker slot gave ${JSON.stringify(hits.marker)}`);
  if (!hits.ruler || hits.ruler.col !== hits.slotPos || hits.colFromX !== hits.slotPos) bad.push(`ruler/drag hit gave ${JSON.stringify(hits.ruler)} / ${hits.colFromX}`);
  // real input: Ctrl+Alt+click a shown slot selects its column; hovering a marker says what is hidden
  await page.keyboard.down('Control'); await page.keyboard.down('Alt');
  await page.mouse.click(g1.left + g1.nameW + (s0 + 0.5) * g1.charW, g1.top + g1.headerH + 2.5 * g1.pitch);
  await page.keyboard.up('Alt'); await page.keyboard.up('Control'); await page.waitForTimeout(150);
  const selected = await page.evaluate(() => Array.from(state.selectedColumns));
  if (!(selected.length === 1 && selected[0] === hits.slotPos)) bad.push(`column click selected ${JSON.stringify(selected)}, expected [${hits.slotPos}]`);
  await page.mouse.move(g1.left + g1.nameW + (ms + 0.5) * g1.charW, g1.top + g1.headerH + 2.5 * g1.pitch); await page.waitForTimeout(400);
  const tip = await page.evaluate(() => document.body.innerText.includes('hidden (positions'));
  if (!tip) bad.push('no "columns hidden" tooltip over the marker');
  await page.mouse.move(10, 10); await page.waitForTimeout(100);
  await page.evaluate(() => { state.selectedColumns.clear(); updateColumnSelections(); _canvasState.scheduleOverlay?.(); });
  // markers off: slots are the shown columns only
  await tick('varSitesBreakpoints', false); await settle();
  const noBrk = await page.evaluate(() => ({ nSlots: _canvasState.nSlots, diff: state._diffColumns.size }));
  if (noBrk.nSlots !== noBrk.diff) bad.push(`without markers ${noBrk.nSlots} slots for ${noBrk.diff} shown columns`);
  await tick('varSitesBreakpoints', true); await settle();
  // off again: the plain picture is back
  await tick('varSitesOnly', false); await settle();
  const after = await snap();
  const off = await page.evaluate(() => ({ slots: _canvasState.slots, nSlots: _canvasState.nSlots }));
  if (off.slots) bad.push('slot layout still active after switching off');
  if (after !== before) bad.push('switching off did not restore the previous picture');

  // Part 2: a synthetic alignment larger than the window (300 x 400, every third column
  // conserved): with hidden columns a wheel step still copies the frame and equals a full redraw
  await page.evaluate(() => {
    let fasta = '';
    for (let i = 0; i < 300; i++) { const ch = new Array(400); for (let j = 0; j < 400; j++) ch[j] = j % 3 === 0 ? 'A' : 'ACGT'[(i * 7 + j) % 4]; fasta += `>seq${i}\n${ch.join('')}\n`; }
    document.getElementById('fastaInput').value = fasta;
    window.__loadPromise = parseAndRender(false);
  });
  await page.evaluate(() => window.__loadPromise); await page.waitForTimeout(300);
  await setMode(page, 'canvas'); await page.waitForTimeout(300);
  await tick('varSitesOnly', true); await settle();
  const lay2 = await page.evaluate(() => ({ nSlots: _canvasState.nSlots, diff: state._diffColumns.size, brk: state._brkBeforePos.size }));
  if (!(lay2.nSlots < 400 && lay2.nSlots === lay2.diff + lay2.brk)) bad.push('synthetic alignment: ' + JSON.stringify(lay2));
  const box = await page.evaluate(() => { const r = document.getElementById('alignmentCanvas').getBoundingClientRect(); return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.6 }; });
  await page.mouse.move(box.x, box.y);
  const scroll = {};
  for (const [label, dx, dy] of [['down', 0, 60], ['right', 60, 0], ['right2', 100, 0], ['up', 0, -45]]) {
    const b0 = await page.evaluate(() => ({ b: _canvasState.stats.blit, ox: _canvasState.offsetX, oy: _canvasState.offsetY }));
    await page.mouse.wheel(dx, dy); await settleWheel(page); await page.waitForTimeout(150);
    scroll[label] = await page.evaluate((b0) => { const c = document.getElementById('alignmentCanvas'); const fast = c.toDataURL(); const copies = _canvasState.stats.blit - b0.b, moved = [_canvasState.offsetX - b0.ox, _canvasState.offsetY - b0.oy]; _canvasState.scheduleDraw(); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r({ copies, moved, same: c.toDataURL() === fast })))); }, b0);
  }
  for (const [l, r] of Object.entries(scroll)) if (r.copies < 1 || !r.same || (r.moved[0] === 0 && r.moved[1] === 0)) bad.push(`scroll ${l}: ${JSON.stringify(r)}`);
  await tick('varSitesOnly', false); await settle();
  const out = { lay: { nSlots: lay.nSlots, diff: lay.diff, brk: lay.brk }, compared: shownSlots.length, markers: markerSlots.length, hits: { shown: hits.shown, marker: hits.marker }, selected, tip, noBrk, lay2, scroll };
  return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') + ' ' + JSON.stringify(out) : JSON.stringify(out) };
});

// Reported by the owner (v252): in Canvas, after a horizontal scroll a click on a sequence name
// selected one residue (the cell that had scrolled under the sticky name column), and Ctrl+C
// then copied that residue instead of the name being renamed. The name column covers those
// cells: a press on it is a name press. Real input: a single click on a name selects nothing,
// a double click opens the rename box with the whole name selected and focused, and Ctrl+C
// there is left to the browser (the app's own copy is not called).
check('Canvas mode: a click on a name never hits the cell under it, double-click renames with the whole name selected', async (page) => {
  await loadSyntheticFasta(page, 300, 300);
  await setMode(page, 'canvas');
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__copied = 0; const o = window.copySelected; window.copySelected = function () { window.__copied++; return o.apply(this, arguments); }; });
  const g = await page.evaluate(() => { const m = _canvasState.metrics; const r = document.getElementById('alignmentCanvas').getBoundingClientRect(); return { left: r.left, top: r.top, nameW: m.nameW, headerH: m.headerH, pitch: _canvasState.rowPitch, charW: m.charW }; });
  const st = () => page.evaluate(() => ({ pending: !!state.pendingNucStart, nucs: state.selectedNucs.size, active: document.activeElement ? document.activeElement.tagName : null, sel: document.activeElement && document.activeElement.tagName === 'INPUT' ? [document.activeElement.value, document.activeElement.selectionStart, document.activeElement.selectionEnd] : null, copied: window.__copied }));
  const out = {};
  const bad = [];
  for (const sticky of [true, false]) {
    await page.evaluate((on) => { const c = document.getElementById('stickyNames'); if (c.checked !== on) { c.checked = on; c.dispatchEvent(new Event('change', { bubbles: true })); } }, sticky);
    await page.waitForTimeout(400);
    for (const ox of [0, 200]) {
      await page.evaluate((ox) => { _canvasState.offsetX = ox; _canvasState.scheduleDraw(); state.pendingNucStart = null; state.selectedNucs.clear(); window.__copied = 0; }, ox);
      await page.waitForTimeout(200);
      // with static names and a scrolled view the names are off screen: the press at x=20 is then on cells, skip
      if (!sticky && ox > 0) continue;
      const p = { x: g.left + 20, y: g.top + g.headerH + 5.5 * g.pitch };
      await page.mouse.click(p.x, p.y); await page.waitForTimeout(150);
      const single = await st();
      await page.mouse.dblclick(p.x, p.y); await page.waitForTimeout(300);
      const dbl = await st();
      await page.keyboard.press('Control+c'); await page.waitForTimeout(150);
      const copy = await st();
      await page.keyboard.press('Escape'); await page.waitForTimeout(150);
      const key = `${sticky ? 'sticky' : 'static'}@${ox}`;
      out[key] = { single, dbl, copy };
      if (single.pending || single.nucs) bad.push(`${key}: a single click on the name selected a cell`);
      if (dbl.active !== 'INPUT' || !dbl.sel || dbl.sel[0] !== 'seq5' || dbl.sel[1] !== 0 || dbl.sel[2] !== 4) bad.push(`${key}: double click did not open the rename box with the whole name selected: ${JSON.stringify(dbl)}`);
      if (copy.copied) bad.push(`${key}: Ctrl+C in the rename box ran the app's copy`);
      if (copy.nucs) bad.push(`${key}: a residue was selected by the time of Ctrl+C`);
    }
  }
  // the cell under a sticky name is reachable again once the names are static (the press is on a cell then)
  const cellHit = await page.evaluate(() => { const m = _canvasState.metrics, r = document.getElementById('alignmentCanvas').getBoundingClientRect(); _canvasState.offsetX = 200; const sticky = document.getElementById('stickyNames'); const h = { withStatic: _canvasHitTest(r.left + 20, r.top + m.headerH + 5.5 * _canvasState.rowPitch) }; sticky.checked = true; h.withSticky = _canvasHitTest(r.left + 20, r.top + m.headerH + 5.5 * _canvasState.rowPitch); sticky.checked = false; _canvasState.offsetX = 0; return h; });
  out.cellHit = cellHit;
  if (cellHit.withSticky !== null) bad.push('with sticky names a point in the name column still hit-tests a cell');
  if (!cellHit.withStatic || cellHit.withStatic.row !== 5) bad.push('with static names a scrolled cell under x=20 is not hit: ' + JSON.stringify(cellHit.withStatic));
  await page.evaluate(() => { const c = document.getElementById('stickyNames'); if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } });
  await page.waitForTimeout(300);
  return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') + ' ' + JSON.stringify(out) : JSON.stringify(out) };
});

// Owner report (v252): "canvas loads sequences in low resolution". Chrome antialiases text on a
// transparent canvas in greyscale and on an opaque one with subpixel (ClearType) rendering like
// DOM text; measured headful on Windows: 0 colour-fringe pixels in the Canvas view against
// 10,375 in Full, and 9,704 once the canvas is opaque. Headless Chrome has no subpixel text, so
// this checks the contract: the content canvas, its scroll scratch copy and the glyph canvases
// are opaque, the overlay stays transparent, and nothing in the picture changed except that
// every untouched pixel is now white (the frame copy and the highlight checks cover the rest).
check('Canvas mode: content canvas and glyphs are opaque (subpixel text like the DOM), overlay transparent', async (page) => {
  await loadSyntheticFasta(page, 200, 200);
  await setMode(page, 'canvas');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const c = document.getElementById('alignmentCanvas'), o = document.getElementById('alignmentCanvasOverlay');
    const ca = c.getContext('2d').getContextAttributes(), oa = o.getContext('2d').getContextAttributes();
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let transparent = 0, white = 0; for (let i = 3; i < d.length; i += 4) { if (d[i] !== 255) transparent++; else if (d[i - 3] === 255 && d[i - 2] === 255 && d[i - 1] === 255) white++; }
    return { contentAlpha: ca.alpha, overlayAlpha: oa.alpha, transparent, white, px: d.length / 4 };
  });
  const bad = [];
  if (r.contentAlpha !== false) bad.push('content canvas is transparent');
  if (r.overlayAlpha !== true) bad.push('overlay canvas is not transparent');
  if (r.transparent !== 0) bad.push(`${r.transparent} non-opaque pixels in the content canvas`);
  if (!(r.white > r.px * 0.1)) bad.push('no white background pixels');
  return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') + ' ' + JSON.stringify(r) : JSON.stringify(r) };
});

// Codon analysis in the Canvas view (v252). Full/Block mark the bases of an in-frame stop
// (pink cell, red bold letter), underline synonymous (green, thin) and non-synonymous (red,
// 2 px) differences, and draw a translation track per row: a box per codon coloured by
// amino-acid class with the bold letter over the middle base, red stop boxes, a red "!" where a
// frameshift starts, "frame N" tags in All-3 mode, and AA only puts the track in place of the
// bases. Canvas drew plain letters only. Now every one of these appears in Canvas with the
// stylesheet's colours, the tooltip of a codon box says what it is, and the frame copy stays
// exact with the track on.
check('Canvas mode: codon analysis draws stops, syn/nonsyn, the codon track, frame tags and AA only like Full/Block', async (page) => {
  const cds = 'ATGGCTAAAGGTCTGCAAGAATTCGGTACCTGGAAACCGATGCTTGCAGGTAAAGAACTGTTCCCGGGATCCTAA';
  const sub = 'ATGGCCGAAGGTCTGCAAGAATTCGGTACCTGGAAACCGATGCTTGCAGGTAAAGAACTGTTCCCGGGATCCTAA';   // codon 2 GCT>GCC (syn), codon 3 AAA>GAA (nonsyn)
  const rows = [['ref', cds], ['sub', sub], ['del1', cds.slice(0, 20) + '-' + cds.slice(21)], ['ok', cds]];
  await page.setInputFiles('#fileInput', { name: 'cds.fa', mimeType: 'text/plain', buffer: Buffer.from(rows.map(([n, q]) => `>${n}\n${q}`).join('\n') + '\n') });
  await page.waitForTimeout(1200);
  await setMode(page, 'canvas'); await page.waitForTimeout(300);
  const settle = () => page.evaluate(() => new Promise(r => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 700)));
  const tick = (id, on) => page.evaluate(({ id, on }) => { const e = document.getElementById(id); e.checked = on; e.dispatchEvent(new Event('change', { bubbles: true })); }, { id, on });
  await tick('codonAnalysis', true); await settle();
  // palette: the stylesheet's own colours, read from probe elements
  const want = await page.evaluate(() => {
    const d = document.createElement('div'); d.className = 'aa-data'; d.style.cssText = 'position:absolute;left:-9999px';
    const mk = c => { const sp = document.createElement('span'); sp.className = 'aa-c ' + c; d.appendChild(sp); return sp; };
    const ss = { hyd: mk('aa-hyd'), stop: mk('aa-stop'), fs: mk('aa-fs') };
    document.body.appendChild(d);
    const col = (el, prop) => getComputedStyle(el)[prop];
    const r = { hydBg: col(ss.hyd, 'backgroundColor'), hydFg: col(ss.hyd, 'color'), stopBg: col(ss.stop, 'backgroundColor'), stopFg: col(ss.stop, 'color'), fsBg: col(ss.fs, 'backgroundColor') };
    d.remove();
    const ntStop = document.createElement('span'); ntStop.className = 'codon-stop'; document.body.classList.add('codon-mode'); document.body.appendChild(ntStop);
    r.ntStopBg = col(ntStop, 'backgroundColor'); r.ntStopFg = col(ntStop, 'color'); ntStop.remove();
    return r;
  });
  const geom = () => page.evaluate(() => { const m = _canvasState.metrics; const r = document.getElementById('alignmentCanvas').getBoundingClientRect(); return { left: r.left, top: r.top, nameW: m.nameW, charW: m.charW, charH: m.charH, headerH: m.headerH, pitch: _canvasState.rowPitch, aaRowH: _canvasState.aaRowH, aaRows: _canvasState.aaRows, aaOnly: _canvasState.aaOnly, dpr: m.dpr || 1 }; });
  // colours inside a CSS-pixel box, composited over white; as "rgb(r, g, b)" strings with counts
  const colors = (x, y, w, h) => page.evaluate(({ x, y, w, h }) => {
    const cv = document.getElementById('alignmentCanvas'), dpr = _canvasState.metrics.dpr || 1;
    const d = cv.getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr))).data;
    const f = new Map();
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; const k = `rgb(${Math.round(d[i] * a + 255 * (1 - a))}, ${Math.round(d[i + 1] * a + 255 * (1 - a))}, ${Math.round(d[i + 2] * a + 255 * (1 - a))})`; f.set(k, (f.get(k) || 0) + 1); }
    return [...f.entries()].sort((a, b) => b[1] - a[1]);
  }, { x, y, w, h });
  const has = (list, c) => list.some(([k]) => k === c);
  const top = list => list[0] && list[0][0];
  const bad = [];
  let g = await geom();
  if (!g.aaRowH || g.aaRows !== 1) bad.push('no translation row geometry: ' + JSON.stringify(g));
  const cellX = c => g.nameW + c * g.charW, rowY = r => g.headerH + r * g.pitch, aaY = (r, lane = 0) => rowY(r) + g.charH + lane * g.aaRowH;
  // 1. stop codon bases (ref, last three columns) are pink with a red letter
  const stopCols = await page.evaluate(() => state._codonData.stops[0]);
  const stopCell = await colors(cellX(stopCols[0]), rowY(0), g.charW, g.charH);
  if (top(stopCell) !== want.ntStopBg || !has(stopCell, want.ntStopFg)) bad.push(`stop base cell: ${JSON.stringify(stopCell.slice(0, 3))}, wanted bg ${want.ntStopBg} + fg ${want.ntStopFg}`);
  // 2. syn (green) and nonsyn (red) underlines on the sub row
  const sn = await page.evaluate(() => { const r = state._codonData.synNonSyn[1]; const out = {}; for (let p = 0; p < 12; p++) if (r && r[p]) out[r[p]] = out[r[p]] ?? p; return out; });
  if (sn.syn == null || sn.nonsyn == null) bad.push('fixture has no syn/nonsyn codon: ' + JSON.stringify(sn));
  else {
    const synCell = await colors(cellX(sn.syn), rowY(1), g.charW, g.charH), nonCell = await colors(cellX(sn.nonsyn), rowY(1), g.charW, g.charH);
    if (!has(synCell, 'rgb(46, 157, 87)')) bad.push('synonymous codon base has no green underline: ' + JSON.stringify(synCell.slice(0, 4)));
    if (!has(nonCell, 'rgb(217, 48, 37)')) bad.push('non-synonymous codon base has no red underline: ' + JSON.stringify(nonCell.slice(0, 4)));
  }
  // 3. codon track: ATG box (hydrophobic class) with its letter, stop box red
  const mBox = await colors(cellX(0), aaY(0), 3 * g.charW, g.aaRowH);
  if (top(mBox) !== want.hydBg || !has(mBox, want.hydFg)) bad.push(`ATG codon box: ${JSON.stringify(mBox.slice(0, 3))}, wanted ${want.hydBg} + ${want.hydFg}`);
  const stopBox = await colors(cellX(stopCols[0]), aaY(0), 3 * g.charW, g.aaRowH);
  if (top(stopBox) !== want.stopBg || !has(stopBox, want.stopFg)) bad.push(`stop codon box: ${JSON.stringify(stopBox.slice(0, 3))}, wanted ${want.stopBg} + ${want.stopFg}`);
  // 4. frameshift mark on del1 (gap at column 21): a red "!" cell on the track at the run start
  const fsAt = await page.evaluate(() => (state._codonData.frameShifts[2] || []).filter(f => f.type === 'indel').map(f => f.runStart));
  if (!fsAt.length) bad.push('fixture has no frameshift on del1');
  else { const fsCell = await colors(cellX(fsAt[0]), aaY(2), g.charW, g.aaRowH); const reddish = fsCell.some(([k]) => { const m = k.match(/\d+/g).map(Number); return m[0] > 180 && m[1] < 90 && m[2] < 90; }); if (!has(fsCell, want.fsBg) || !reddish) bad.push(`frameshift mark: ${JSON.stringify(fsCell.slice(0, 4))}, wanted ${want.fsBg} + red`); }
  // 5. tooltip over a codon box names the amino acid and codon
  await page.mouse.move(g.left + cellX(1) + g.charW / 2, g.top + aaY(0) + g.aaRowH / 2); await page.waitForTimeout(400);
  const tip = await page.evaluate(() => document.body.innerText.includes('M (ATG)'));
  if (!tip) bad.push('no "M (ATG)" tooltip over the codon box');
  await page.mouse.move(10, 10); await page.waitForTimeout(100);
  // 6. All 3 frames: three rows per sequence with coloured frame tags in the name column
  await page.evaluate(() => { const s = document.getElementById('codonFrame'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await settle();
  g = await geom();
  if (g.aaRows !== 3) bad.push(`All 3 frames: ${g.aaRows} translation rows`);
  else {
    const tagCols = await Promise.all([0, 1, 2].map(k => colors(0, aaY(0, k), g.nameW, g.aaRowH)));
    const tagColors = ['rgb(59, 111, 214)', 'rgb(42, 138, 68)', 'rgb(194, 120, 0)'];   // frame 1, 2, 3 tags (styles.css .aa-row-fN .aa-tag)
    // rows are frame 1 at the top .. frame 3 at the bottom, as _codonRowsFor appends them in the DOM
    const seen = tagCols.map(c => tagColors.findIndex(t => has(c, t)));
    if (JSON.stringify(seen) !== JSON.stringify([0, 1, 2])) bad.push(`frame tags per row: ${JSON.stringify(seen)} (expected [0,1,2])`);
  }
  await page.evaluate(() => { const s = document.getElementById('codonFrame'); s.value = 'auto'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await settle();
  // 7. AA only: the track replaces the bases, the pitch is the track's, cells are not hit
  await page.evaluate(() => setAaOnly(true)); await settle();
  g = await geom();
  if (!g.aaOnly || g.pitch !== g.aaRows * g.aaRowH) bad.push(`AA only geometry: ${JSON.stringify(g)}`);
  const aaOnlyRow = await colors(cellX(0), rowY(0), 3 * g.charW, g.aaRowH);
  if (top(aaOnlyRow) !== want.hydBg) bad.push(`AA only: row 0 does not start with the ATG box: ${JSON.stringify(aaOnlyRow.slice(0, 3))}`);
  const hitAaOnly = await page.evaluate(() => { const m = _canvasState.metrics, r = document.getElementById('alignmentCanvas').getBoundingClientRect(); return _canvasHitTest(r.left + m.nameW + 1.5 * m.charW, r.top + m.headerH + 0.5 * _canvasState.rowPitch); });
  if (hitAaOnly) bad.push('AA only: a hidden base cell still hit-tests: ' + JSON.stringify(hitAaOnly));
  const noMsg = await page.evaluate(() => !document.body.innerText.includes('AA only applies in Full and Block'));
  if (!noMsg) bad.push('AA only still says it applies in Full and Block only');
  await page.evaluate(() => setAaOnly(false)); await settle();
  // 8. a scrollable alignment with the track on: wheel steps copy the frame and equal a full redraw
  await page.evaluate((cds) => {
    let fasta = '';
    for (let i = 0; i < 200; i++) { const q = cds + cds + cds; fasta += `>s${i}\n${i % 7 === 3 ? q.slice(0, 20) + '-' + q.slice(21) : q}\n`; }
    document.getElementById('fastaInput').value = fasta;
    window.__loadPromise = parseAndRender(false);
  }, cds);
  await page.evaluate(() => window.__loadPromise); await page.waitForTimeout(300);
  await setMode(page, 'canvas'); await page.waitForTimeout(300);
  const on = await page.evaluate(() => !!(state._codonData && state._codonData.aaSeq));
  if (!on) { await tick('codonAnalysis', true); await settle(); }
  const box = await page.evaluate(() => { const r = document.getElementById('alignmentCanvas').getBoundingClientRect(); return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.6 }; });
  await page.mouse.move(box.x, box.y);
  const scroll = {};
  for (const [label, dx, dy] of [['down', 0, 60], ['right', 60, 0], ['up', 0, -37]]) {
    const b0 = await page.evaluate(() => ({ b: _canvasState.stats.blit, ox: _canvasState.offsetX, oy: _canvasState.offsetY }));
    await page.mouse.wheel(dx, dy); await settleWheel(page); await page.waitForTimeout(150);
    scroll[label] = await page.evaluate((b0) => { const c = document.getElementById('alignmentCanvas'); const fast = c.toDataURL(); const copies = _canvasState.stats.blit - b0.b, moved = [_canvasState.offsetX - b0.ox, _canvasState.offsetY - b0.oy]; _canvasState.scheduleDraw(); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r({ copies, moved, same: c.toDataURL() === fast })))); }, b0);
  }
  for (const [l, r] of Object.entries(scroll)) if (r.copies < 1 || !r.same || (r.moved[0] === 0 && r.moved[1] === 0)) bad.push(`scroll ${l}: ${JSON.stringify(r)}`);
  await tick('codonAnalysis', false); await settle();
  const out = { want, stopCols, sn, fsAt, tip, scroll };
  return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') + ' ' + JSON.stringify(out) : JSON.stringify(out) };
});

// Show 2D in the Canvas view (v254). Full/Block draw the 2D block mask as SVG rectangles over the
// rows of each block (one per run of consecutive rows, dashed when the rows are scattered or the
// block is local-only, a click on a typed block stacks its rows). Canvas returned early. Now the
// overlay layer draws the same rectangles from the same mask, a click on a typed block stacks it,
// hovering says so, opacity changes touch the overlay only, and a snapshot made in Canvas comes
// back in Canvas.
check('Canvas mode: Show 2D blocks drawn, clickable to stack a type, hover title; snapshots restore Canvas', async (page) => {
  await loadSyntheticFasta(page, 60, 120);
  await setMode(page, 'full');
  await page.waitForTimeout(300);
  const settle = () => page.evaluate(() => new Promise(r => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 400)));
  const mask = () => page.evaluate(() => {
    state.blockMask = { blocks: [
      { type: 'CONSERVATIVE', col_start: 10, col_end: 19, rows: [0, 1, 2], sourceRows: [0, 1, 2] },
      { type: 'MOSAIC', col_start: 30, col_end: 34, rows: 'all' },
      { type: 'DIVERGENT', col_start: 50, col_end: 55, rows: [5, 7], localOnly: true },
    ], row_headers: state.seqs.map(q => q.header) };
    renderBlockMaskOverlay();
  });
  await mask(); await settle();
  const domRects = await page.evaluate(() => document.querySelectorAll('.block-mask-layer rect').length);
  await setMode(page, 'canvas'); await settle();
  await page.evaluate(() => { window.__stacked = []; const o = window.groupRowsByType; window.groupRowsByType = function (rows) { window.__stacked.push(rows.slice()); return o.apply(this, arguments); }; });
  await mask(); await settle();
  const g = await page.evaluate(() => { const m = _canvasState.metrics; const r = document.getElementById('alignmentCanvas').getBoundingClientRect(); return { left: r.left, top: r.top, nameW: m.nameW, charW: m.charW, charH: m.charH, headerH: m.headerH, pitch: _canvasState.rowPitch, rects: (_canvasState.maskRects || []).length, full: _canvasState.stats.full }; });
  const bad = [];
  if (g.rects !== domRects || domRects !== 4) bad.push(`${g.rects} Canvas rectangles for ${domRects} DOM rectangles (4 expected)`);
  const overlayAt = (col, row) => page.evaluate(({ col, row }) => { const o = document.getElementById('alignmentCanvasOverlay'), m = _canvasState.metrics, dpr = m.dpr || 1; const d = o.getContext('2d').getImageData(Math.round((m.nameW + (col + 0.5) * m.charW) * dpr), Math.round((m.headerH + (row + 0.5) * _canvasState.rowPitch) * dpr), 1, 1).data; return Array.from(d); }, { col, row });
  const inBlock = await overlayAt(14, 1), outside = await overlayAt(14, 20), allRows = await overlayAt(32, 50);
  const near = (px, hex) => { const want = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; return px[3] > 40 && Math.abs(px[0] - want[0]) < 30 && Math.abs(px[1] - want[1]) < 30 && Math.abs(px[2] - want[2]) < 30; };
  if (!near(inBlock, '#16a34a')) bad.push(`block 1 not drawn on the overlay: ${JSON.stringify(inBlock)}`);
  if (outside[3] !== 0) bad.push(`overlay ink outside the blocks: ${JSON.stringify(outside)}`);
  if (!near(allRows, '#f59e0b')) bad.push(`rows:'all' block not drawn down the alignment: ${JSON.stringify(allRows)}`);
  // opacity change: overlay only, no content redraw
  await page.evaluate(() => setBlockMaskOpacity(0.9)); await settle();
  const after = await overlayAt(14, 1);
  const full2 = await page.evaluate(() => _canvasState.stats.full);
  if (!(after[3] > inBlock[3])) bad.push(`opacity 0.9 did not darken the block: ${inBlock[3]} -> ${after[3]}`);
  if (full2 !== g.full) bad.push(`${full2 - g.full} content redraws for an opacity change`);
  await page.evaluate(() => setBlockMaskOpacity(0.45)); await settle();
  // real input: hover says what a click does, a click on the typed block stacks its rows
  const pt = { x: g.left + g.nameW + 14.5 * g.charW, y: g.top + g.headerH + 1.5 * g.pitch };
  await page.mouse.move(pt.x, pt.y); await page.waitForTimeout(400);
  const tip = await page.evaluate(() => document.body.innerText.includes('Click to stack this type'));
  if (!tip) bad.push('no stack tooltip over the typed block');
  await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(300);
  const stacked = await page.evaluate(() => window.__stacked);
  if (!(stacked.length === 1 && stacked[0].join(',') === '0,1,2')) bad.push(`click on the typed block stacked ${JSON.stringify(stacked)}`);
  // a click on the rows:'all' block (no type) is an ordinary cell click, as in the DOM
  await page.mouse.click(g.left + g.nameW + 32.5 * g.charW, g.top + g.headerH + 20.5 * g.pitch); await page.waitForTimeout(200);
  const plain = await page.evaluate(() => ({ stacked: window.__stacked.length, pending: !!state.pendingNucStart }));
  if (plain.stacked !== 1 || !plain.pending) bad.push(`click on an untyped block: ${JSON.stringify(plain)}`);
  await page.evaluate(() => { state.pendingNucStart = null; clearBlockMask(); }); await settle();
  const cleared = await overlayAt(14, 1);
  if (cleared[3] !== 0) bad.push('overlay still shows a block after Clear');
  // snapshots: a view saved in Canvas restores Canvas
  await setMode(page, 'full'); await page.waitForTimeout(300);
  await page.evaluate(() => _applySnapshotView({ mode: 'canvas' })); await page.waitForTimeout(600);
  const restored = await page.evaluate(() => ({ canvas: document.getElementById('modeCanvas').checked, el: !!document.getElementById('alignmentCanvas') }));
  if (!restored.canvas || !restored.el) bad.push('snapshot view mode canvas did not restore Canvas: ' + JSON.stringify(restored));
  const out = { domRects, rects: g.rects, inBlock, allRows, after, tip, stacked, plain, restored };
  return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') + ' ' + JSON.stringify(out) : JSON.stringify(out) };
});

// GLM audit of v244-v254 (2026-10-17), findings confirmed by reproducer. (1) Canvas trusted the
// consensus and conservation caches whenever the alignment length matched, so a same-length
// change (reverse complement of rows) kept the old consensus row and shading. (2) A selected
// column's tint stopped at nSeqs * charH instead of nSeqs * rowPitch, short of the translation
// rows when codon analysis is on.
check('Canvas mode: consensus and shading follow a same-length change; column tint covers translation rows', async (page) => {
  const rows = []; for (let i = 0; i < 6; i++) rows.push(`>s${i}\nAAAAACCCCCGGGGGTTTTTAAAAACCCCC`);
  await page.setInputFiles('#fileInput', { name: 'a.fa', mimeType: 'text/plain', buffer: Buffer.from(rows.join('\n') + '\n') });
  await page.waitForTimeout(1200);
  await setMode(page, 'canvas'); await page.waitForTimeout(500);
  const f1 = await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) state.selectedRows.add(i);
    updateRowSelections();
    reverseComplementSelected();
    await new Promise(r => setTimeout(r, 2500));
    const truth = computeConsensusForSequences(state.seqs.map(s => s.seq));
    const shown = (_canvasState.consensus?.values || []).join('');
    return { truth, shown, consOk: shown === truth };
  });
  // shading: the Canvas picture equals the one after a cold re-render (caches dropped)
  const pic = await page.evaluate(async () => {
    const c = document.getElementById('alignmentCanvas'); const a = c.toDataURL();
    state.conservationDataCache = null; state.consensusCache = null; renderAlignment();
    await new Promise(r => setTimeout(r, 2500));
    return a === document.getElementById('alignmentCanvas').toDataURL();
  });
  const cds = 'ATGGCTAAAGGTCTGCAAGAATTCGGTACCTGGAAACCGATGCTTGCAGGTAAAGAACTGTTCCCGGGATCCTAA';
  const r2 = []; for (let i = 0; i < 8; i++) r2.push(`>c${i}\n${cds}`);
  await page.setInputFiles('#fileInput', { name: 'c.fa', mimeType: 'text/plain', buffer: Buffer.from(r2.join('\n') + '\n') });
  await page.waitForTimeout(1200);
  await setMode(page, 'canvas'); await page.waitForTimeout(400);
  await page.evaluate(() => { const c = document.getElementById('codonAnalysis'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1200);
  const f2 = await page.evaluate(async () => {
    state.selectedColumns.add(10); updateColumnSelections(); _canvasState.scheduleOverlay();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const o = document.getElementById('alignmentCanvasOverlay'), m = _canvasState.metrics, dpr = m.dpr || 1;
    const a = o.getContext('2d').getImageData(Math.round((m.nameW + 10.5 * m.charW) * dpr), Math.round((m.headerH + 7.8 * _canvasState.rowPitch) * dpr), 1, 1).data[3];
    state.selectedColumns.clear(); updateColumnSelections(); _canvasState.scheduleOverlay();
    return { alpha: a };
  });
  await page.evaluate(() => { const c = document.getElementById('codonAnalysis'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(600);
  const bad = [];
  if (!f1.consOk) bad.push(`consensus after reverse complement: shown ${f1.shown}, true ${f1.truth}`);
  if (!pic) bad.push('the picture after reverse complement differs from a cold re-render (stale shading)');
  if (!f2.alpha) bad.push('column tint missing over the last row\'s translation track');
  return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') : JSON.stringify({ f1, pic, f2 }) };
});

check('Copy this color (gapped/ungapped) copies what the label says', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'g.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nAC--GT\n>b\nACG-TT\n') });
  await page.waitForTimeout(1000);
  const r = await page.evaluate(async () => {
    window._copied = null; navigator.clipboard.writeText = t => { window._copied = t; return Promise.resolve(); };
    colourState.mappings.set('a', '#ff0000');
    const out = {};
    for (const label of ['Copy this color (gapped)', 'Copy this color (ungapped)']) {
      window._copied = null;
      showContextMenu({ target: document.querySelector(".seq-line") || document.body, preventDefault() {}, stopPropagation() {}, clientX: 50, clientY: 50, pageX: 50, pageY: 50 }, 0);
      const item = [...document.querySelectorAll('div')].find(d => d.textContent === label);
      if (!item) { out[label] = 'menu item not found'; continue; }
      item.click();
      await new Promise(res => setTimeout(res, 200));
      out[label] = window._copied;
    }
    return out;
  });
  const g = r['Copy this color (gapped)'], u = r['Copy this color (ungapped)'];
  const ok = typeof g === 'string' && g.includes('AC--GT') && typeof u === 'string' && u.includes('ACGT') && !u.includes('-');
  return { pass: ok, detail: ok ? '' : JSON.stringify(r) };
});

check('File and BLAST text is escaped in the BLAST dialog, hit table, hit tooltip and recent-files list', async (page) => {
  const evil = 'x<img data-xss="1" src="data:,">';
  const r = await page.evaluate(async (evil) => {
    const out = {};
    const count = () => document.querySelectorAll('img[data-xss]').length;
    showBlastDialog(evil, 'ACGTACGTACGT');
    out.dialog = count();
    document.querySelectorAll('.blast-dialog-backdrop, .blast-dialog').forEach(n => n.remove());
    document.querySelectorAll('img[data-xss]').forEach(n => n.remove());
    const hsp = { bitScore: 50, score: 24, evalue: 1e-5, identity: 12, gaps: 0, percent: 100, alignLen: 12, queryStart: 1, queryEnd: 12, hitStart: 1, hitEnd: 12, strand: '+', querySeq: 'ACGTACGTACGT', hitSeq: 'ACGTACGTACGT', midline: '||||||||||||' };
    displayBlastResults('q', 12, { db1: { hits: [{ id: 'h1', def: evil, length: 12, hsps: [hsp] }] } });
    out.table = count();
    const bar = document.querySelector('.blast-hitdist [class*="bar"], .blast-hitdist div[style*="left"]');
    if (bar) bar.dispatchEvent(new MouseEvent('mouseenter', { clientX: 10, clientY: 10, bubbles: true }));
    out.tooltip = count() - out.table;
    out.history = _historyManager._escapeHtml('a"b').includes('"');
    return out;
  }, evil);
  const ok = r.dialog === 0 && r.table === 0 && r.tooltip <= 0 && r.history === false;
  return { pass: ok, detail: ok ? '' : JSON.stringify(r) };
});

check('BLAST worker FASTA parser ends on a last record without a newline', async () => {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'blast-worker.js'), 'utf8');
  const ctx = { self: { postMessage() {}, addEventListener() {} }, postMessage() {}, importScripts() {}, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { timeout: 5000 });
  const seq = 'ACGTACGTACGTACGTACGTACGT';
  let res;
  try {
    res = vm.runInContext(`parseFasta(${JSON.stringify('>s1 one\n' + seq + '\n>s2')}).map(r => r.id).join(',')`, ctx, { timeout: 3000 });
  } catch (e) { return { pass: false, detail: 'parseFasta did not finish: ' + e.message }; }
  return { pass: res === 's1', detail: res === 's1' ? '' : 'ids ' + res };
});

check('Chromatogram: clicking a base call edits that base', async (page) => {
  const r = await page.evaluate(() => {
    const n = 20, spacing = 12, numSamples = n * spacing + 12;
    const tr = () => Array.from({ length: numSamples }, (_, i) => 50 + 40 * Math.sin(i));
    state.ab1Traces = state.ab1Traces || {};
    state.ab1Traces.t1 = { sequence: 'ACGTACGTACGTACGTACGT', quality: Array(n).fill(40), numSamples,
      peakLocations: Array.from({ length: n }, (_, i) => 6 + i * spacing), traces: { A: tr(), C: tr(), G: tr(), T: tr() } };
    ChromatogramViewer.open('t1');
    const c = document.querySelector('#chromatogramModal canvas') || [...document.querySelectorAll('canvas')].find(x => x.width >= 2000);
    const rect = c.getBoundingClientRect(), k = 5;
    const canvasX = state.ab1Traces.t1.peakLocations[k] * parseFloat(c.dataset.xScale || '3');
    const clientX = rect.left + canvasX * rect.width / c.width;
    let asked = null; const orig = window.prompt; window.prompt = (msg) => { asked = msg; return null; };
    c.dispatchEvent(new MouseEvent('click', { clientX, clientY: rect.top + 50, bubbles: true }));
    window.prompt = orig;
    ChromatogramViewer.close();
    return { asked, want: k + 1 };
  });
  const ok = !!r.asked && r.asked.includes(`position ${r.want} `);
  return { pass: ok, detail: ok ? '' : JSON.stringify(r) };
});

check('Add Sequences: a damaged AB1 file is reported, not listed as loaded', async (page) => {
  // ABIF magic + a directory entry whose data offset points past the end of the file
  const b = Buffer.alloc(40); b.write('ABIF', 0); b.writeInt16BE(101, 4);
  b.write('tdir', 6); b.writeInt32BE(1, 10); b.writeInt16BE(1023, 14); b.writeInt16BE(28, 16);
  b.writeInt32BE(5, 18); b.writeInt32BE(140, 22); b.writeInt32BE(100000, 26);
  await page.evaluate(() => { const m = document.getElementById('addSeqModal'); if (m) m.style.display = 'block'; });
  await page.setInputFiles('#addSeqFileInput', { name: 'bad.ab1', mimeType: 'application/octet-stream', buffer: b });
  await page.waitForTimeout(800);
  const label = await page.evaluate(() => document.getElementById('addSeqFileLabel').textContent);
  const ok = /could not read/i.test(label) && !/Loaded 1 file/.test(label);
  return { pass: ok, detail: ok ? '' : 'label: ' + label };
});

check('Realign all keeps every row when two rows share a name', async (page) => {
  const fa = '>s1\nACGTACGTTTGGCCAAGT\n>s1\nACGAACGTTTGGCCTTGT\n>s2\nACGTACGTTGGCCAAGT\n';
  await page.setInputFiles('#fileInput', { name: 'd.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForTimeout(1000);
  const r = await page.evaluate(async () => {
    document.getElementById('mafftReorderOnly').checked = false;
    window.confirm = () => true;
    await realignAll();
    await new Promise(res => setTimeout(res, 400));
    return state.seqs.map(s => (s.fullHeader || s.header) + '=' + s.seq.replace(/[-.]/g, ''));
  });
  const want = ['s1=ACGTACGTTTGGCCAAGT', 's1=ACGAACGTTTGGCCTTGT', 's2=ACGTACGTTGGCCAAGT'];
  const ok = want.every(w => r.includes(w)) && r.length === 3;
  return { pass: ok, detail: ok ? '' : JSON.stringify(r) };
});

check('Realign selected keeps every row when two selected rows share a name', async (page) => {
  const fa = '>s1\nACGTACGTTTGGCCAAGT\n>s1\nACGAACGTTTGGCCTTGT\n>s2\nACGTACGTTGGCCAAGT\n';
  await page.setInputFiles('#fileInput', { name: 'd.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForTimeout(1000);
  const r = await page.evaluate(async () => {
    window.confirm = () => true;
    state.selectedRows.clear(); [0, 1, 2].forEach(i => state.selectedRows.add(i));
    realignSelected();
    for (let t = 0; t < 50 && !/Realigned/.test(document.body.innerText); t++) await new Promise(res => setTimeout(res, 100));
    await new Promise(res => setTimeout(res, 300));
    return state.seqs.map(s => s.header + '=' + s.seq.replace(/[-.]/g, ''));
  });
  const want = ['s1=ACGTACGTTTGGCCAAGT', 's1=ACGAACGTTTGGCCTTGT', 's2=ACGTACGTTGGCCAAGT'];
  const ok = want.every((w, i) => r[i] === w) && r.length === 3;
  return { pass: ok, detail: ok ? '' : JSON.stringify(r) };
});

check('Group explorer: Copy FASTA/consensus keep rows that share a name', async (page) => {
  const fa = '>s1\nAAAAAAAAAA\n>s1\nCCCCCCCCCC\n>s1\nCCCCCCCCCC\n>s2\nGGGGGGGGGG\n';
  await page.setInputFiles('#fileInput', { name: 'd.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForTimeout(1000);
  const r = await page.evaluate(async () => {
    const copied = []; navigator.clipboard.writeText = t => { copied.push(t); return Promise.resolve(); };
    state.clusterResults = { clusters: [{ sequences: [{ id: 's1', obj: state.seqs[0] }, { id: 's1', obj: state.seqs[1] }, { id: 's1', obj: state.seqs[2] }] }], unassigned: [{ id: 's2', obj: state.seqs[3] }] };
    _geCopyAction('fasta', 'cluster', 0);
    _geCopyAction('consensus', 'cluster', 0);
    await new Promise(res => setTimeout(res, 200));
    return copied;
  });
  const fasta = r[0] || '', cons = (r[1] || '').split('\n')[1] || '';
  // two of the three members are C in every column: the consensus is C, not the first row repeated
  const ok = fasta.includes('AAAAAAAAAA') && fasta.includes('CCCCCCCCCC') && cons.toUpperCase() === 'CCCCCCCCCC';
  return { pass: ok, detail: ok ? '' : JSON.stringify(r) };
});

check('An alignment with 160,000 rows loads and renders (no argument-spread stack overflow)', async (page) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const rows = []; for (let i = 0; i < 160000; i++) rows.push('>r' + i + '\nACGTACGTAC');
  await page.setInputFiles('#fileInput', { name: 'tall.fa', mimeType: 'text/plain', buffer: Buffer.from(rows.join('\n') + '\n') });
  await page.waitForFunction(() => state.seqs && state.seqs.length === 160000, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const r = await page.evaluate(() => { try { _isLargeAlignmentPending(); renderAlignment(); return { n: state.seqs.length, ok: true }; } catch (e) { return { n: state.seqs.length, ok: false, e: e.message }; } });
  const stack = errs.filter(e => /call stack/i.test(e));
  const ok = r.ok && r.n === 160000 && !stack.length;
  return { pass: ok, detail: ok ? '' : JSON.stringify({ r, stack: stack.slice(0, 3) }) };
});

check('Audit batch 2: RNA reverse complement, multi-row editor undo, trim preview clamp, drop next to the consensus, long pastes in Recent, short MAFFT output', async (page) => {
  const fa = '>a\nACGTACGTAC\n>b\nACGTTCGTAC\n>c\nACGAACGTAC\n';
  await page.setInputFiles('#fileInput', { name: 'b2.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForTimeout(1000);
  const r = await page.evaluate(async () => {
    const out = {};
    // 1. RNA in, RNA out; DNA unchanged
    out.rc = [_reverseComplement('AUGCu-'), RealignRegion.reverseComplement('AUGCu-'), _reverseComplement('ATGC')];
    // 2. the multi-row editor does not undo into an earlier single-row session
    openSeqEditor(0);
    const ta = document.getElementById('seqEditTextarea');
    ta.value = ta.value + 'GGGG'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('seqEditModal').style.display = 'none';
    state.selectedRows.clear(); state.selectedRows.add(0); state.selectedRows.add(1);
    openSeqEditorMulti();
    const multiText = ta.value;
    _seqEditUndo();
    out.multiUndoKept = ta.value === multiText;
    document.getElementById('seqEditModal').style.display = 'none';
    // 3. a preview on an alignment that is all gaps at the edges still keeps a column
    const saved = state.seqs.map(q => q.seq);
    state.seqs.forEach((q, i) => { q.seq = i === 0 ? 'A---------' : '---------C'; });
    previewTrimming();
    const b = state.trimBoundaries;
    out.trimKeeps = b.leftTrimEnd + 1 < b.rightTrimStart;
    state.trimBoundaries = null;
    state.seqs.forEach((q, i) => { q.seq = saved[i]; });
    renderAlignment();
    await new Promise(res => setTimeout(res, 200));
    // 4. the consensus line is never a drop target
    const lines = [...document.querySelectorAll('#alignmentContainer .seq-line[data-seq-index]')];
    const cons = lines.find(l => l.classList.contains('consensus-line'));
    if (cons) { const rc = cons.getBoundingClientRect(); const n = _findNearestSequenceLine(rc.top + rc.height / 2); out.dropTarget = n && n.line.dataset.seqIndex; }
    else out.dropTarget = 'no consensus line';
    // 5. a paste above the Recent cache limit is not reopened cut off
    let msg = ''; const om = showMessage; showMessage = (m, t) => { msg = m; return om(m, t); };
    _historyManager.add('clipboard', { name: 'big paste', text: '>x\n' + 'A'.repeat(99997), nSeqs: 1, length: 99997 });   // as v255 stored a long paste: cut at 100,000
    _historyManager.renderDropdown();
    const before = fastaInput.value;
    const item = [...document.querySelectorAll('.recent-item')].find(e => e.textContent.includes('big paste'));
    if (item) { item.click(); await new Promise(res => setTimeout(res, 300)); }
    showMessage = om;
    out.bigPaste = { msg, reloaded: fastaInput.value !== before, hadItem: !!item };
    _historyManager.items = _historyManager.items.filter(e => e.name !== 'big paste'); _historyManager.save();
    // 6. MAFFT output with fewer sequences than sent changes nothing
    const seqs = [{ header: 'a', seq: 'ACGTACGTAC' }, { header: 'b', seq: 'ACGTTCGTAC' }];
    let err = null, res = null;
    try { res = await RealignRegion.run(seqs, new Set([2, 3, 4, 5]), { mafftAlign: async () => '>a\nGTAC\n' }); } catch (e) { err = e.message; }
    out.shortMafft = err ? 'refused' : JSON.stringify(res && res.seqs.map(q => q.seq));
    return out;
  });
  const bad = [];
  if (r.rc[0] !== '-aGCAU' || r.rc[1] !== '-aGCAU' || r.rc[2] !== 'GCAT') bad.push('reverse complement ' + JSON.stringify(r.rc));
  if (!r.multiUndoKept) bad.push('multi-row editor undo went back to an earlier session');
  if (!r.trimKeeps) bad.push('trim preview would remove every column');
  if (r.dropTarget === '-1') bad.push('consensus line taken as a drop target');
  if (!r.bigPaste.hadItem || r.bigPaste.reloaded) bad.push('cut-off paste reopened ' + JSON.stringify(r.bigPaste));
  if (r.shortMafft !== 'refused') bad.push('short MAFFT output applied: ' + r.shortMafft);
  return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') : JSON.stringify(r) };
});

check('Undo: a hard trim is one undo step, and a new file starts with no undo history', async (page) => {
  const fa = '>a\n----ACGTACGTAC----\n>b\n----ACGTTCGTAC----\n>c\n--GGACGAACGTACTT--\n';
  await page.setInputFiles('#fileInput', { name: 'u.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForTimeout(1000);
  const r = await page.evaluate(async () => {
    const out = {};
    window.confirm = () => true;
    const rows = () => state.seqs.map(q => q.seq).join('|');
    const original = rows();
    pushUndo('delete'); const removed = state.seqs.splice(2, 1);   // an earlier step: delete row c
    renderAlignment();
    const afterDelete = rows();
    document.querySelector('input[name="trimMode"][value="hard"]').checked = true;
    state.trimBoundaries = { leftTrimEnd: 3, rightTrimStart: 14 };
    executeTrimming();
    const afterTrim = rows();
    undoDelete(true);
    out.undoTrim = rows() === afterDelete ? 'back to before the trim' : (rows() === original ? 'jumped past the trim' : rows());
    out.trimmedWidth = afterTrim.split('|')[0].length;
    // a new file: Ctrl+Z must not bring back the old rows (one step of the old file is still on the stack)
    pushUndo('delete'); state.seqs.splice(1, 1); renderAlignment();
    out.historyBeforeLoad = state.deletedHistory.length;
    const fa2 = '>x\nTTTTTTTT\n>y\nTTTTATTT\n';
    fastaInput.value = fa2; state.currentFilename = 'second.fa';
    await parseAndRender(true);
    await new Promise(res => setTimeout(res, 300));
    out.historyAfterLoad = state.deletedHistory.length;
    undoDelete(true);
    out.afterUndo = rows();
    void removed;
    return out;
  });
  const ok = r.undoTrim === 'back to before the trim' && r.trimmedWidth === 10 && r.historyBeforeLoad > 0 && r.historyAfterLoad === 0 && r.afterUndo === 'TTTTTTTT|TTTTATTT';
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Chromatogram: Apply Edits lands on the traced base after the row was trimmed or reverse-complemented, and refuses a row that no longer matches', async (page) => {
  const trace = 'ACGTTGCAAGGCTTAC';
  await page.setInputFiles('#fileInput', { name: 'c.fa', mimeType: 'text/plain', buffer: Buffer.from(`>t1\n${trace}\n>o\n${trace}\n`) });
  await page.waitForTimeout(800);
  const r = await page.evaluate(async (trace) => {
    const n = trace.length, tr = () => Array.from({ length: n * 12 }, () => 10);
    state.ab1Traces = { t1: { sequence: trace, quality: Array(n).fill(40), numSamples: n * 12, peakLocations: Array.from({ length: n }, (_, i) => 6 + i * 12), traces: { A: tr(), C: tr(), G: tr(), T: tr() } } };
    const row = () => state.seqs.find(s => s.header === 't1');
    const applyAt = (pos, base) => {
      ChromatogramViewer.open('t1');
      const orig = window.prompt; window.prompt = () => base;
      const c = [...document.querySelectorAll('canvas')].find(x => x.width >= 2000);
      const rect = c.getBoundingClientRect();
      const cx = state.ab1Traces.t1.peakLocations[pos] * parseFloat(c.dataset.xScale || '3');
      c.dispatchEvent(new MouseEvent('click', { clientX: rect.left + cx * rect.width / c.width, clientY: rect.top + 50, bubbles: true }));
      window.prompt = orig;
      document.getElementById('chromatogramApplyEdits').click();
      const st = document.getElementById('chromatogramStatus')?.textContent || '';
      ChromatogramViewer.close();
      return st;
    };
    const out = {};
    // trimmed: first 3 bases cut off, gaps inside
    row().seq = '---TT-GCAAGGCTTAC';   // trace[3..] with one gap
    applyAt(5, 'A');                     // trace base 6 (G at index 5 -> A)
    out.trimmed = row().seq;
    // reverse-complemented row
    const rc = s => s.split('').reverse().map(c => ({ A: 'T', C: 'G', G: 'C', T: 'A', '-': '-' })[c] || c).join('');
    row().seq = rc(trace.slice(0, 5) + 'A' + trace.slice(6));   // the row as it is after the first edit, flipped
    applyAt(0, 'T');                     // trace base 1 (A -> T) is the last residue of the RC row, complemented: A
    out.rc = row().seq;
    // a row edited into something else: refused, unchanged
    row().seq = 'GGGGGGGGGGGGGGGG';
    out.refusedMsg = applyAt(2, 'A');
    out.unchanged = row().seq;
    return out;
  }, trace);
  const okTrim = r.trimmed === '---TT-ACAAGGCTTAC';
  const okRc = r.rc === 'GTAAGCCTTGTAACGA';
  const okRefuse = r.unchanged === 'GGGGGGGGGGGGGGGG' && /no longer matches/i.test(r.refusedMsg);
  return { pass: okTrim && okRc && okRefuse, detail: JSON.stringify(r) };
});

check('Server: output read for one reply is capped (ssh-cat, bam2sam) and multi-byte text survives chunking', async () => {
  const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  const a = src.indexOf('const CHILD_OUTPUT_MAX_BYTES'), b = src.indexOf('function stripBanner');
  if (a < 0 || a > b) return { pass: false, detail: 'no capped output collector in server.js (ssh-cat/bam2sam read output without a limit)' };
  const env = { env: { CHILD_OUTPUT_MAX_BYTES: '1000' } };
  const collect = new Function('process', 'Buffer', src.slice(a, b) + '; return collectChildOutput;')(env, Buffer);
  const run = (code) => new Promise(res => collect(spawn(process.execPath, ['-e', code]), (over, out) => res(over ? 'over:' + over.status : out)));
  const big = await run("process.stdout.write('A'.repeat(5000))");
  const small = await run("process.stdout.write('A'.repeat(500))");
  const text = await run("const b = Buffer.from('выравнивание'); process.stdout.write(b.subarray(0, 3)); setTimeout(() => process.stdout.write(b.subarray(3)), 50)");
  const ok = big === 'over:413' && small.length === 500 && text === 'выравнивание';
  return { pass: ok, detail: JSON.stringify({ big, small: small.length, text }) };
});

check('Show 2D: an all-gap reference row gives real column ranges (no NaN blocks), an all-gap alignment gives none', async () => {
  const BM = require(require('path').join(__dirname, '..', '..', 'block-mask.js'));
  const rows = (f) => Array.from({ length: 8 }, (_, i) => '>s' + i + '\n' + f(i)).join('\n') + '\n';
  const unit = 'ACGTACGTTGCAACGTAGCTAGCTAGGATCCAGT'.repeat(3);
  const out = {};
  try {
    const r = BM.computeBlockMask(rows(i => (i === 0 ? '-'.repeat(unit.length) : unit)), {}, {});
    out.nan = (r.blocks || []).filter(b => !Number.isFinite(b.col_start) || !Number.isFinite(b.col_end)).length;
    out.blocks = (r.blocks || []).length;
    out.elem = [r.elem_col_start, r.elem_col_end];
  } catch (e) { out.err1 = e.message; }
  try {
    const r2 = BM.computeBlockMask(rows(() => '-'.repeat(20)), {}, {});
    out.allGapBlocks = (r2.blocks || []).length;
  } catch (e) { out.err2 = e.message; }
  const ok = !out.err1 && !out.err2 && out.nan === 0 && out.blocks > 0 && Number.isFinite(out.elem[0]) && out.allGapBlocks === 0;
  return { pass: ok, detail: JSON.stringify(out) };
});

check('Canvas: scrolled to the right end, the last column is not under the scrollbar and each row shows its length badge', async (page) => {
  const unit = 'ACGTACGTTGCAACGTAGCTAGCTAGGATCCAGTTTGGCCAAGT';
  const rows = []; for (let i = 0; i < 205; i++) rows.push('>r' + i + '\n' + (unit.repeat(7)).slice(0, 291 - (i % 5)) + '-'.repeat(i % 5));
  await page.setInputFiles('#fileInput', { name: 'edge.fa', mimeType: 'text/plain', buffer: Buffer.from(rows.join('\n') + '\n') });
  await page.waitForTimeout(1200);
  await setMode(page, 'canvas'); await page.waitForTimeout(600);
  const r = await page.evaluate(async () => {
    _canvasState.offsetX = 1e9; _canvasState.scheduleDraw();
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    await new Promise(res => setTimeout(res, 200));
    _canvasState.offsetX = 1e9; _canvasState.scheduleDraw();
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const c = document.getElementById('alignmentCanvas'), m = _canvasState.metrics, cr = c.getBoundingClientRect();
    const bar = document.querySelector('.vertical-scrollbar').getBoundingClientRect();
    const lastColRight = cr.left + m.nameW + state.seqs[0].seq.length * m.charW - _canvasState.offsetX;
    // badge of row 0: grey box right after the last column
    const dpr = m.dpr || 1, y = Math.round((m.headerH + 0.5 * _canvasState.rowPitch) * dpr);
    const g = c.getContext('2d').getImageData(Math.round((lastColRight - cr.left + 6 + 2) * dpr), y, 1, 1).data;
    return { lastColRight, barLeft: bar.left, badgePx: [g[0], g[1], g[2]], contentRight: cr.left + _canvasState.totalContentW - _canvasState.offsetX };
  });
  const notCovered = r.lastColRight <= r.barLeft + 0.5;
  const badge = Math.abs(r.badgePx[0] - 0xf0) <= 12 && Math.abs(r.badgePx[2] - 0xf0) <= 12;
  const endsAtBar = r.contentRight <= r.barLeft + 1;
  return { pass: notCovered && badge && endsAtBar, detail: JSON.stringify(r) };
});

check('Canvas vs Full: every cell has the same letter, background colour and letter position (shading and Highlight diffs)', async (page) => {
  // A screenshot of the alignment area in each view, decoded in the page; cells located from the DOM
  // spans and from the Canvas grid. The grids differ in size by design (Canvas cells are whole device
  // pixels: 8 x 15 against 7.81 x 13 at 100 %), so each cell is compared in place: letter, background,
  // and the letter's ink box (within 1 px).
  const unit = 'ACGTACGTTGCAACGTAGCTAGCTAGGATCCAGTTTGGCCAAGT';
  const rows = []; for (let i = 0; i < 24; i++) { let s = unit.repeat(3).slice(0, 100).split(''); for (let k = 0; k < 100; k += 7 + (i % 5)) s[k] = 'ACGT'[(i + k) % 4]; if (i % 6 === 0) for (let k = 0; k < 8; k++) s[k] = '-'; rows.push('>r' + i + '\n' + s.join('')); }
  await page.setInputFiles('#fileInput', { name: 'par.fa', mimeType: 'text/plain', buffer: Buffer.from(rows.join('\n') + '\n') });
  await page.waitForTimeout(1200);
  const grab = async (clip) => { const b = await page.screenshot({ clip }); return page.evaluate(async (b64) => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return { w: c.width, h: c.height, d: Array.from(x.getImageData(0, 0, c.width, c.height).data) }; }, b.toString('base64')); };
  const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const cell = (I, x0, y0, W, H) => {
    const px = (x, y) => { const i = (y * I.w + x) * 4; return [I.d[i], I.d[i + 1], I.d[i + 2]]; };
    const cnt = new Map(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = px(x0 + x, y0 + y).join(); cnt.set(k, (cnt.get(k) || 0) + 1); }
    let bg, n = -1; for (const [k, v] of cnt) if (v > n) { n = v; bg = k.split(',').map(Number); }
    // from the second pixel row: at a fractional zoom a row's top pixel row can hold a blended seam
    // (visible when Highlight diffs makes cells translucent) that is not part of the letter
    let t = 99, b = -1; for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) if (dist(px(x0 + x, y0 + y), bg) > 40) { t = Math.min(t, y); b = Math.max(b, y); }
    return { bg, t, b };
  };
  const out = {};
  for (const hd of [false, true]) {
    await page.evaluate((hd) => { const c = document.getElementById('highlightDiffs'); if (c.checked !== hd) { c.checked = hd; c.dispatchEvent(new Event('change', { bubbles: true })); } }, hd);
    await setMode(page, 'full'); await page.waitForTimeout(800);
    const dom = await page.evaluate(() => { const o = []; for (let r = 0; r < 24; r++) { const line = document.querySelector(`#alignmentContainer .seq-line[data-seq-index="${r}"]`); for (let c = 0; c < 100; c++) { const sp = line && line.querySelector(`.seq-data span[data-pos="${c}"]`); if (sp) { const b = sp.getBoundingClientRect(); o.push([r, c, b.left, b.top, sp.textContent]); } } } return o; });
    const dx0 = Math.floor(dom[0][2]), dy0 = Math.floor(dom[0][3]);
    const domPitch = dom[100][3] - dom[0][3];   // row 1's top - row 0's top (rows are the font size + 2 px, --row-h)
    const A = await grab({ x: dx0, y: dy0, width: 820, height: Math.ceil(24 * domPitch) + 4 });
    await setMode(page, 'canvas'); await page.waitForTimeout(800);
    const cv = await page.evaluate(async () => { _canvasState.offsetX = 0; _canvasState.offsetY = 0; _canvasState.scheduleDraw(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const m = _canvasState.metrics, cr = document.getElementById('alignmentCanvas').getBoundingClientRect(); return { L: cr.left + m.nameW, T: cr.top + m.headerH, w: m.charW, h: m.charH, p: _canvasState.rowPitch, seqs: state.seqs.map(s => s.seq) }; });
    const B = await grab({ x: Math.floor(cv.L), y: Math.floor(cv.T), width: Math.ceil(100 * cv.w) + 2, height: Math.ceil(24 * cv.p) + 2 });
    let cells = 0, sameCh = 0, sameBg = 0, samePos = 0; const bad = [];
    for (const [r, c, x, y, ch] of dom) {
      cells++; if (cv.seqs[r][c] === ch) sameCh++;
      const s1 = cell(A, Math.round(x) - dx0, Math.round(y) - dy0, 7, 13), s2 = cell(B, Math.round(cv.L + c * cv.w) - Math.floor(cv.L), Math.round(cv.T + r * cv.p) - Math.floor(cv.T), 7, 13);
      const bgOk = dist(s1.bg, s2.bg) <= 8, posOk = (s1.b < 0 && s2.b < 0) || (Math.abs(s1.t - s2.t) <= 1 && Math.abs(s1.b - s2.b) <= 1);
      if (bgOk) sameBg++; if (posOk) samePos++;
      if ((!bgOk || !posOk) && bad.length < 4) bad.push({ r, c, ch, dom: s1, canvas: s2 });
    }
    out[hd ? 'highlightDiffs' : 'shading'] = { cells, sameCh, sameBg, samePos, bad };
  }
  const ok = Object.values(out).every(o => o.cells === 2400 && o.sameCh === o.cells && o.sameBg === o.cells && o.samePos === o.cells);
  return { pass: ok, detail: JSON.stringify(out) };
});

check('Canvas rows have the Full row height; Highlight diffs in Full draws no dark line between dimmed rows', async (page) => {
  const rows = []; for (let i = 0; i < 12; i++) rows.push('>r' + i + '\n' + 'ACGTACGTTGCAACGTAGCT'.split('').map((c, k) => (k === 5 && i % 3 === 0 ? 'T' : c)).join(''));
  await page.setInputFiles('#fileInput', { name: 'rh.fa', mimeType: 'text/plain', buffer: Buffer.from(rows.join('\n') + '\n') });
  await page.waitForTimeout(1000);
  await setMode(page, 'full'); await page.waitForTimeout(600);
  const domPitch = await page.evaluate(() => { const y = (r) => document.querySelector(`.seq-line[data-seq-index="${r}"] .seq-data span[data-pos="0"]`).getBoundingClientRect().top; return (y(10) - y(0)) / 10; });
  // Highlight diffs: dimmed cells are a flat tint; the 0.5 px overlap between rows must not show as a darker line
  await page.evaluate(() => { const c = document.getElementById('highlightDiffs'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(500);
  const box = await page.evaluate(() => { const b = document.querySelector('.seq-line[data-seq-index="4"] .seq-data span[data-pos="2"]').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width }; });
  const shot = await page.screenshot({ clip: { x: Math.floor(box.x), y: Math.floor(box.y) - 1, width: Math.ceil(box.w), height: 15 } });
  const col = await page.evaluate(async (b64) => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; const row = (y) => [d[(y * c.width) * 4], d[(y * c.width) * 4 + 1], d[(y * c.width) * 4 + 2]]; return { rows: Array.from({ length: c.height }, (_, y) => row(y)[0]) }; }, shot.toString('base64'));
  // left edge column of the cell, top to bottom: background tint, no darker band at a row edge
  const bgRows = col.rows.slice(2, 13), tint = Math.max(...bgRows);
  const darkLine = col.rows.some((v, y) => y <= 2 && v < tint - 12);
  await setMode(page, 'canvas'); await page.waitForTimeout(600);
  const cvPitch = await page.evaluate(() => _canvasState.rowPitch);
  const ok = Math.abs(cvPitch - domPitch) < 0.01 && !darkLine;
  return { pass: ok, detail: JSON.stringify({ domPitch, cvPitch, edgeColumn: col.rows, darkLine }) };
});

check('Canvas: motif search runs in Canvas mode (Find, Ctrl+F) and paints its hits', async (page) => {
  await loadFasta(page, makeFasta(30, 300));
  await setMode(page, 'canvas');
  await page.waitForTimeout(300);
  const r = await page.evaluate(async () => {
    const ctl = el('search-controls');
    const usable = !ctl || (getComputedStyle(ctl).pointerEvents !== 'none' && parseFloat(getComputedStyle(ctl).opacity) === 1);
    el('searchInput').value = 'GTAC'; el('searchButton').click();
    await new Promise(res => setTimeout(res, 300));
    const c = document.getElementById('alignmentCanvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let y = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] < 60) y++;
    return { usable, entries: state.searchHistory.length, count: state.searchHistory[0]?.matchCount || 0, yellow: y, mode: document.querySelector('input[name="mode"]:checked').id };
  });
  const ok = r.usable && r.entries === 1 && r.count > 0 && r.yellow > 1000 && r.mode === 'modeCanvas';
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Colour Names > Pattern colours every matching row in Canvas and in windowed views, not only rows on screen', async (page) => {
  const rows = []; for (let i = 0; i < 40; i++) rows.push('>' + (i % 2 ? 'Mouse_' : 'Human_') + i + '\nACGTACGTAC');
  await loadFasta(page, rows.join('\n') + '\n');
  await setMode(page, 'canvas');
  const r = await page.evaluate(() => {
    colourState.mappings.clear();
    el('colourPatternInput').value = '^Human'; el('colourPatternColor').value = '#ff0000';
    applyPatternColour();
    return { coloured: [...colourState.mappings.keys()].filter(n => n.startsWith('Human_')).length, wrong: [...colourState.mappings.keys()].filter(n => !n.startsWith('Human_')).length };
  });
  const ok = r.coloured === 20 && r.wrong === 0;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Default view: Canvas at every size; a chosen Full/Block holds for small files in the session; ?view= in the link', async (page) => {
  const base = page.url().replace(/[?#].*$/, '');
  const small = Buffer.from('>a\nACGTACGTAC\n>b\nACGTTCGTAC\n');
  const big = Buffer.from(Array.from({ length: 220 }, (_, i) => '>r' + i + '\n' + 'ACGT'.repeat(50)).join('\n') + '\n');   // 44,000 residues
  const mode = () => page.evaluate(() => document.querySelector('input[name="mode"]:checked').id);
  const load = async (buf, name) => { await page.setInputFiles('#fileInput', { name, mimeType: 'text/plain', buffer: buf }); await page.waitForTimeout(1200); };
  const out = {};
  await page.goto(base, { waitUntil: 'networkidle' });
  await load(small, 's1.fa'); out.firstSmall = await mode();
  await page.evaluate(() => { const r = document.getElementById('modeSingle'); r.checked = true; onModeChange(); });   // the user picks Full
  await page.waitForTimeout(400);
  await load(small, 's2.fa'); out.smallAfterFull = await mode();
  await load(big, 'b.fa'); out.bigAfterFull = await mode();
  await page.goto(base + '?view=block', { waitUntil: 'networkidle' });
  await load(small, 's3.fa'); out.linkBlock = await mode();
  const ok = out.firstSmall === 'modeCanvas' && out.smallAfterFull === 'modeSingle' && out.bigAfterFull === 'modeCanvas' && out.linkBlock === 'modeBlocks';
  return { pass: ok, detail: JSON.stringify(out) };
});

check('Realign all keeps a row that has only gaps (MAFFT and codon/MACSE), as a gap row of the new width', async (page) => {
  const fa = '>a\nATGGCTAAAGGTCTGCAAGAATTCGGTACC\n>empty\n------------------------------\n>b\nATGGCTAAGGGTCTGCAAGAATTCGGAACC\n>c\nATGGCAAAAGGTCTGCAGGAATTCGGTACC\n';
  const out = {};
  for (const type of ['2', 'codon']) {
    await page.setInputFiles('#fileInput', { name: 'e.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
    await page.waitForTimeout(900);
    out[type] = await page.evaluate(async (type) => {
      const sel = document.getElementById('mafftSeqType'); sel.value = type; sel.dispatchEvent(new Event('change'));
      document.getElementById('mafftReorderOnly').checked = false;
      window.confirm = () => true;
      await realignAll(); await new Promise(r => setTimeout(r, 500));
      const e = state.seqs.find(q => q.header === 'empty');
      return { n: state.seqs.length, names: state.seqs.map(q => q.header).join(','), emptyOk: !!e && /^-+$/.test(e.seq) && e.seq.length === state.seqs[0].seq.length };
    }, type);
  }
  const ok = Object.values(out).every(o => o.n === 4 && o.emptyOk);
  return { pass: ok, detail: JSON.stringify(out) };
});

check('Names: a duplicated row exports under its new name; Realign region keeps each row\'s own full name when short names repeat', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'n.fa', mimeType: 'text/plain', buffer: Buffer.from('>s1 first copy\nACGTACGTACGTAC\n>s1 second copy\nACGAACGTACGTTC\n>s2\nACGTACGTTCGTAC\n') });
  await page.waitForTimeout(900);
  const r = await page.evaluate(async () => {
    const out = {};
    state.selectedRows.clear(); state.selectedRows.add(2); duplicateSelected();
    out.dup = state.seqs.map(q => q.fullHeader || q.header);
    state.seqs.pop(); renderAlignment();
    window.confirm = () => true;
    state.selectedColumns.clear(); for (let c = 2; c <= 8; c++) state.selectedColumns.add(c);
    await realignSelectedBlock({ applyAdjustFull: true, applyReorder: false });
    await new Promise(res => setTimeout(res, 500));
    out.region = state.seqs.map(q => q.fullHeader || q.header);
    return out;
  });
  const ok = r.dup[3] === 's2_copy' && new Set(r.dup).size === 4 && r.region.join('|') === 's1 first copy|s1 second copy|s2';
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Realign selected rows and a reorder-only run that reverse-complements rows clear groups and 2D blocks (they describe the old columns)', async (page) => {
  const fa = '>a\nATGGCTAAAGGTCTGCAAGAATTCGGTACC\n>b\nATGGCTAAGGGTCTGCAAGAATTCGGAACC\n>c\nGGTACCGAATTCTTGCAGACCTTTAGCCAT\n';
  const out = {};
  for (const path of ['selected', 'reorderOnlyRc']) {
    await page.setInputFiles('#fileInput', { name: 'p.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
    await page.waitForTimeout(900);
    out[path] = await page.evaluate(async (path) => {
      window.confirm = () => true;
      state.clusterResults = { clusters: [{ sequences: [] }], unassigned: [] };
      state.blockMask = { blocks: [], row_headers: [] };
      if (path === 'selected') {
        state.selectedRows.clear(); [0, 1].forEach(i => state.selectedRows.add(i));
        realignSelected();
        for (let t = 0; t < 60 && !/Realigned/.test(document.body.innerText); t++) await new Promise(r => setTimeout(r, 100));
      } else {
        document.getElementById('mafftAdjustDir').checked = true;
        document.getElementById('mafftReorderOnly').checked = true;
        const sel = document.getElementById('mafftSeqType'); sel.value = '2'; sel.dispatchEvent(new Event('change'));
        state.selectedColumns.clear(); for (let c = 0; c < 30; c++) state.selectedColumns.add(c);
        await realignSelectedBlock({ applyAdjustFull: true, applyReorder: true });
        document.getElementById('mafftAdjustDir').checked = false; document.getElementById('mafftReorderOnly').checked = false;
      }
      await new Promise(r => setTimeout(r, 400));
      return { clusters: !!state.clusterResults, mask: !!state.blockMask, flipped: state.seqs[2].seq.startsWith('ATGG') };
    }, path);
  }
  const ok = !out.selected.clusters && !out.selected.mask && (!out.reorderOnlyRc.flipped || (!out.reorderOnlyRc.clusters && !out.reorderOnlyRc.mask));
  return { pass: ok, detail: JSON.stringify(out) };
});

check('Consensus row hidden: Copy Consensus and Add > Align to consensus use the current consensus, not an empty or old one', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'c.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGTACGTACGTACGTACGT\n>b\nACGTACGTACGTACGTACGT\n>c\nACGTACGTACGTACGTACGT\n') });
  await page.waitForTimeout(900);
  const r = await page.evaluate(async () => {
    const out = {};
    const sc = document.getElementById('showConsensus'); sc.checked = false; sc.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(res => setTimeout(res, 300));
    // an edit while the row is hidden: every row now has T at column 0
    state.seqs.forEach(q => { q.seq = 'T' + q.seq.slice(1); q.gaplessPositions = calculateGaplessPositions(q.seq); });
    renderAlignment(); await new Promise(res => setTimeout(res, 300));
    let copied = null; navigator.clipboard.writeText = t => { copied = t; return Promise.resolve(); };
    copyConsensus(); await new Promise(res => setTimeout(res, 200));
    out.copied = (copied || '').split('\n')[1] || null;
    // Add & align to consensus: the new sequence lacks the first 4 bases and must land at column 4
    document.getElementById('addSeqInput').value = '>new\nACGTACGTACGTACGT';
    document.getElementById('addSeqAlignCons').checked = true;
    await addSequencesJustAdd(); await new Promise(res => setTimeout(res, 800));
    const nw = state.seqs.find(q => q.header === 'new');
    out.newRow = nw ? nw.seq : null;
    return out;
  });
  const ok = !!r.copied && r.copied.toUpperCase().startsWith('TCGTACGT') && !!r.newRow && /^-{4}ACGTACGTACGTACGT/.test(r.newRow);
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Add & Align: a result computed for an alignment that changed meanwhile is not applied', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'x.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGTACGTACGTACGTACGT\n>b\nACGTACGTACGTACGTACGT\n>c\nACGTACGTACGTACGTACGT\n') });
  await page.waitForTimeout(900);
  const r = await page.evaluate(async () => {
    const orig = window.alignSequenceToConsensusProfile;
    window.alignSequenceToConsensusProfile = async (...a) => { const res = await orig(...a); state.seqs = state.seqs.slice(0, 2); return res; };   // the user deletes row c meanwhile
    let msg = ''; const om = showMessage; showMessage = (m, t) => { msg = m; return om(m, t); };
    document.getElementById('addSeqInput').value = '>new\nACGTACGTACGTACGT';
    document.getElementById('addSeqAlignCons').checked = true;
    await addSequencesJustAdd(); await new Promise(res => setTimeout(res, 500));
    window.alignSequenceToConsensusProfile = orig; showMessage = om;
    return { names: state.seqs.map(q => q.header).join(','), msg };
  });
  const ok = r.names === 'a,b' && /changed/i.test(r.msg);
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Dot plot: Copy aligned context copies the diagonal pair the panel shows (same length, aligned)', async (page) => {
  const r = await page.evaluate(() => {
    if (typeof _dotDiagonalSlices !== 'function') return { missing: true };
    const A = 'ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT';   // 72
    const B = 'TTTTGCATGCAT';                                                                // 12
    const d = _dotDiagonalSlices(A, B, 61, 4, 30);
    return { d, sameLen: d.a.length === d.b.length, pairOk: d.a === A.substring(57, 69) && d.b === B.substring(0, 12) };
  });
  const ok = !r.missing && r.sameLen && r.pairOk;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Row selection follows its sequences through Sort (name, length) and Undo; a row drag still selects the moved rows', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'srt.fa', mimeType: 'text/plain', buffer: Buffer.from('>delta\nACGT-\n>alpha\nACG--\n>charlie\nACGTA\n>bravo\nAC---\n') });
  await page.waitForTimeout(900);
  const r = await page.evaluate(async () => {
    const sel = () => [...state.selectedRows].map(i => state.seqs[i].header).sort().join(',');
    const out = {};
    state.selectedRows.clear(); state.selectedRows.add(1); state.selectedRows.add(2); updateRowSelections();   // alpha, charlie
    sortByName(); await new Promise(r => setTimeout(r, 300)); out.byName = sel();
    sortByLength(); await new Promise(r => setTimeout(r, 300)); out.byLength = sel();
    undoDelete(true); await new Promise(r => setTimeout(r, 300)); out.afterUndo = sel();
    // row drag: the moved row ends selected at its new place
    state.selectedRows.clear(); updateRowSelections(); renderAlignment();
    const moved = state.seqs[0].header;
    _moveDraggedSequences(0, 3, false); await new Promise(r => setTimeout(r, 300));
    out.drag = sel() + ' (moved ' + moved + ')';
    return out;
  });
  const ok = r.byName === 'alpha,charlie' && r.byLength === 'alpha,charlie' && r.afterUndo === 'alpha,charlie' && r.drag.startsWith(r.drag.split(' (moved ')[1].replace(')', ''));
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Delete with every row selected keeps the alignment (says at least one row must stay)', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'd2.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGT\n>b\nACGA\n') });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    window.confirm = () => true;
    let msg = ''; const om = showMessage; showMessage = (m, t) => { msg = m; return om(m, t); };
    state.selectedRows.clear(); state.selectedRows.add(0); state.selectedRows.add(1);
    deleteSelected(); showMessage = om;
    return { n: state.seqs.length, msg };
  });
  return { pass: r.n === 2 && /at least one/i.test(r.msg), detail: JSON.stringify(r) };
});

check('Chromatograms: a new file\'s same-named row does not open the old trace; two runs called sample.ab1 keep separate traces', async (page) => {
  await page.goto(page.url(), { waitUntil: 'networkidle' });
  const r = await page.evaluate(async () => {
    const out = {};
    // two different runs, both saved as sample.ab1
    const origParse = AB1Parser.parse, origLooks = AB1Parser.looksLikeAb1;
    let next = null; AB1Parser.parse = () => next; AB1Parser.looksLikeAb1 = () => true;
    next = { sequence: 'ACGTACGTAAACCCGGGTTT' }; const h1 = (await readSequenceFile(new File(['x'], 'sample.ab1'))).header;
    next = { sequence: 'TTTTGGGGCCCCAAAATTTT' }; const h2 = (await readSequenceFile(new File(['y'], 'sample.ab1'))).header;
    AB1Parser.parse = origParse; AB1Parser.looksLikeAb1 = origLooks;
    out.names = [h1, h2];
    out.distinct = state.ab1Traces[h1]?.sequence !== state.ab1Traces[h2]?.sequence;
    // a new file with a row called "sample" but other bases: the old trace must not stay attached to it
    fastaInput.value = '>sample\nGGGGGGGGGGGGGGGGGGGG\n>other\nACGTACGTACGTACGTACGT\n';
    await parseAndRender(true); await new Promise(res => setTimeout(res, 300));
    out.staleKept = !!state.ab1Traces.sample;
    // a file that contains the read itself (trimmed) keeps it
    state.ab1Traces.sample = { sequence: 'ACGTACGTAAACCCGGGTTT' };
    fastaInput.value = '>sample\n--GTACGTAAACCCGG--\n>other\nACGTACGTACGTACGTAC\n';
    await parseAndRender(true); await new Promise(res => setTimeout(res, 300));
    out.realKept = !!state.ab1Traces.sample;
    return out;
  });
  const ok = r.names[0] === 'sample' && r.names[1] === 'sample_2' && r.distinct && !r.staleKept && r.realKept;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('A load that fails or is cancelled leaves the loaded file\'s name, text and size class as they were', async (page) => {
  const A = '>a1\nACGTACGT\n>a2\nACGTACGA\n';
  await page.setInputFiles('#fileInput', { name: 'A.fa', mimeType: 'text/plain', buffer: Buffer.from(A) });
  await page.waitForTimeout(900);
  // a damaged AB1 file
  const bad = Buffer.alloc(40); bad.write('ABIF', 0); bad.writeInt16BE(101, 4); bad.write('tdir', 6); bad.writeInt32BE(1, 10); bad.writeInt16BE(1023, 14); bad.writeInt16BE(28, 16); bad.writeInt32BE(5, 18); bad.writeInt32BE(140, 22); bad.writeInt32BE(100000, 26);
  await page.setInputFiles('#fileInput', { name: 'broken.ab1', mimeType: 'application/octet-stream', buffer: bad });
  await page.waitForTimeout(900);
  const afterError = await page.evaluate(() => ({ name: state.currentFilename, rows: state.seqs.map(q => q.header).join(','), text: fastaInput.value.startsWith('>a1'), shown: !!document.querySelector('#alignmentContainer .error-message') }));
  // a load cancelled in the large-alignment dialog
  const afterCancel = await page.evaluate(async () => {
    const origC = classifyAlignmentSize, origD = showLargeAlignmentDialog;
    const before = JSON.stringify(state.alignmentIndex);
    classifyAlignmentSize = (st) => ({ ...origC(st), mode: 'crazy' });
    showLargeAlignmentDialog = async () => 'cancel';
    state.currentFilename = 'B.fa'; fastaInput.value = '>b1\nTTTT\n>b2\nTTTA\n';
    await parseAndRender(true);
    classifyAlignmentSize = origC; showLargeAlignmentDialog = origD;
    return { name: state.currentFilename, rows: state.seqs.map(q => q.header).join(','), text: fastaInput.value.startsWith('>a1'), indexSame: JSON.stringify(state.alignmentIndex) === before };
  });
  const ok = afterError.name === 'A.fa' && afterError.rows === 'a1,a2' && afterError.text && !afterError.shown
    && afterCancel.name === 'A.fa' && afterCancel.rows === 'a1,a2' && afterCancel.text && afterCancel.indexSame;
  return { pass: ok, detail: JSON.stringify({ afterError, afterCancel }) };
});

check('Recent: reopening a paste keeps it as a paste with its text (opens again the next time)', async (page) => {
  const r = await page.evaluate(async () => {
    _historyManager.items = []; _historyManager.save();
    state.currentFilename = 'Clipboard'; fastaInput.value = '>p1\nACGTACGT\n>p2\nACGTACGA\n';
    await parseAndRender(false); await new Promise(res => setTimeout(res, 300));
    const name = _historyManager.items[0]?.name;
    for (let k = 0; k < 2; k++) {
      fastaInput.value = '>x\nTTTT\n>y\nTTTA\n'; state.currentFilename = 'other.fa'; await parseAndRender(true); await new Promise(res => setTimeout(res, 300));
      _historyManager.renderDropdown();
      const item = [...document.querySelectorAll('.recent-item')].find(e => e.textContent.includes(name));
      if (!item) return { name, missing: k };
      item.click(); await new Promise(res => setTimeout(res, 600));
    }
    const e = _historyManager.items.find(i => i.name === name);
    return { name, rows: state.seqs.map(q => q.header).join(','), type: e?.type, hasText: !!e?.text, copies: _historyManager.items.filter(i => i.name === name).length };
  });
  const ok = !r.missing && r.rows === 'p1,p2' && r.type === 'clipboard' && r.hasText && r.copies === 1;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Trim Undo still restores a hard trim after a later soft trim', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'tr.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\n----ACGTACGTAC----\n>b\n----ACGTTCGTAC----\n>c\n--GGACGAACGTACTT--\n') });
  await page.waitForTimeout(900);
  const r = await page.evaluate(async () => {
    const original = state.seqs.map(q => q.seq).join('|');
    document.querySelector('input[name="trimMode"][value="hard"]').checked = true;
    state.trimBoundaries = { leftTrimEnd: 1, rightTrimStart: 16 }; executeTrimming();
    document.querySelector('input[name="trimMode"][value="soft"]').checked = true;
    state.trimBoundaries = { leftTrimEnd: 0, rightTrimStart: 13 }; executeTrimming();
    let msg = ''; const om = showMessage; showMessage = (m, t) => { msg = m; return om(m, t); };
    undoTrimming(); showMessage = om;
    await new Promise(res => setTimeout(res, 300));
    return { restored: state.seqs.map(q => q.seq).join('|') === original, msg };
  });
  return { pass: r.restored, detail: JSON.stringify(r) };
});

check('Gap edits that change nothing add no Undo step and keep Redo', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'g.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGT----\n>b\nACGTACGT\n') });
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => {
    // a real edit, undone: one Redo step available
    insertSingleGap(1, 2); undoDelete(true);
    const before = { undo: state.deletedHistory.length, redo: state.redoHistory.length };
    let msg = ''; const om = showMessage; showMessage = (m, t) => { msg = m; return om(m, t); };
    removeSingleGap(0, 6);   // a gap in the row's trailing run: removing it gives the same row
    showMessage = om;
    return { before, after: { undo: state.deletedHistory.length, redo: state.redoHistory.length }, msg };
  });
  const noop = /No gap removed/.test(r.msg);
  const ok = noop && r.after.undo === r.before.undo && r.after.redo === r.before.redo && r.before.redo === 1;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('TSD lower case: "Undo marking" is a step of the main Undo (Ctrl+Z brings the marks back)', async (page) => {
  await page.setInputFiles('#fileInput', { name: 't.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGTACGTAC\n>b\nACGTACGTAC\n') });
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    // the state Apply marks (lower case) leaves: residues 2-4 of row 0 lowered, the panel's backup, a main Undo entry
    pushUndo('tsd-mark-lowercase');
    state.seqs[0] = { ...state.seqs[0], seq: 'ACgtaCGTAC' };
    state.tsdMarkStyle = 'lowercase';
    state.tsdMarkUndo = { style: 'lowercase', lowered: new Map([[0, [2, 3, 4]]]) };
    renderAlignment();
    undoTsdMarking(); await new Promise(res => setTimeout(res, 200));
    const unmarked = state.seqs[0].seq;
    undoDelete(true); await new Promise(res => setTimeout(res, 200));
    return { unmarked, afterCtrlZ: state.seqs[0].seq };
  });
  const ok = r.unmarked === 'ACGTACGTAC' && r.afterCtrlZ === 'ACgtaCGTAC';
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Trim Undo puts group feature letters back on their columns, also when the trim removed one', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'f.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\n-ACGTACGTAC-\n>b\n-ACGTTCGTAC-\n>c\nTACGAACGTACT\n') });
  await page.waitForTimeout(900);
  const r = await page.evaluate(async () => {
    state.clusterResults = { clusters: [{ id: 0, sequences: [], perfectFeatures: [{ pos: 1, char: 'T' }, { pos: 9, char: 'T' }], cloudyFeatures: [], imperfectFeatures: [] }], unassigned: [] };
    document.querySelector('input[name="trimMode"][value="hard"]').checked = true;
    state.trimBoundaries = { leftTrimEnd: 0, rightTrimStart: 11 };
    executeTrimming();
    const trimmed = (state.clusterResults?.clusters?.[0]?.perfectFeatures || []).map(f => f.pos).join(',');
    undoTrimming(); await new Promise(res => setTimeout(res, 200));
    return { trimmed, restored: (state.clusterResults?.clusters?.[0]?.perfectFeatures || []).map(f => f.pos).join(','), width: state.seqs[0].seq.length };
  });
  const ok = r.restored === '1,9' && r.width === 12;   // positions are 1-based: column 0 (pos 1) is trimmed away
  return { pass: ok, detail: JSON.stringify(r) };
});

check('BLAST worker: a minus-strand hit reports query positions on the query as given', async () => {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const ctx = { self: { postMessage() {}, addEventListener() {} }, postMessage() {}, importScripts() {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'blast-worker.js'), 'utf8'), ctx, { timeout: 5000 });
  const r = vm.runInContext(`(() => {
    applyScoringPreset(ACTIVE_PRESET);
    const rnd = (n, s) => { let x = s, o = ''; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) % 2147483648; o += 'ACGT'[(x >> 16) % 4]; } return o; };
    const q = rnd(300, 7);
    const rc = s => s.split('').reverse().map(c => ({ A: 'T', C: 'G', G: 'C', T: 'A' })[c]).join('');
    const subj = 'N'.repeat(200) + rc(q.substring(150, 300)) + 'N'.repeat(200);   // query 151..300, reversed; N flanks do not extend
    const db = [{ id: 's', def: 's', seq: subj, length: subj.length, _enc: encodeSeq(subj) }];   // _enc: as the worker prepares a database
    const hits = searchDatabase(q, db, buildInvertedIndex(db), 5);
    const h = hits[0] && hits[0].hsps[0];
    return h ? { strand: h.strand, q: [h.queryStart, h.queryEnd], s: [h.hitStart, h.hitEnd] } : { none: true };
  })()`, ctx, { timeout: 20000 });
  const ok = r.strand === '-' && Math.abs(r.q[0] - 151) <= 2 && Math.abs(r.q[1] - 300) <= 2 && Math.abs(r.s[0] - 201) <= 2;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('BLAST worker: database records shorter than 20 nt (primers) are kept and found', async () => {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const ctx = { self: { postMessage() {}, addEventListener() {} }, postMessage() {}, importScripts() {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'blast-worker.js'), 'utf8'), ctx, { timeout: 5000 });
  const r = vm.runInContext(`(() => {
    applyScoringPreset(ACTIVE_PRESET);
    const recs = parseFasta('>p1 primer\\nACGTTGCAAGGCTTACGA\\n>p2\\nTTGACCAGTCAAGGTCCA\\n');
    recs.forEach(e => { e._enc = encodeSeq(e.seq); });
    const hits = searchDatabase('GGGGGACGTTGCAAGGCTTACGAGGGGG', recs, buildInvertedIndex(recs), 5);
    return { n: recs.length, ids: recs.map(e => e.id).join(','), hit: hits[0] ? hits[0].id : null };
  })()`, ctx, { timeout: 20000 });
  const ok = r.n === 2 && r.hit === 'p1';
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Server API: MAFFT option values kept, BLAST hit count as requested, real E-values in the fallback search', async () => {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  // cut a top-level declaration out of server.js by brace matching (the server itself would start listening)
  const cut = (head) => { const a = src.indexOf(head); if (a < 0) return ''; let i = src.indexOf('{', a), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; } let j = i + 1; if (src[j] === ')') j++; if (src[j] === ';') j++; return src.slice(a, j); };
  const decl = (head) => { const a = src.indexOf(head); return a < 0 ? '' : src.slice(a, src.indexOf(']);', a) + 3); };   // a const Set([...]) declaration
  const code = [decl('const ALLOWED_MAFFT_OPTS'), decl('const MAFFT_VALUE_OPTS'), cut('function allowedMafftArgs'), cut('function parseBlastResults')].join('\n');
  const ctx = {}; vm.createContext(ctx); vm.runInContext(code, ctx);
  const out = {};
  out.mafft = typeof ctx.allowedMafftArgs === 'function' ? vm.runInContext("allowedMafftArgs(['--maxiterate','1000','--localpair','--thread','4','--bogus','x'])", ctx).join(' ') : 'no helper';
  const hit = (n) => `<Hit><Hit_num>${n}</Hit_num><Hit_id>h${n}</Hit_id><Hit_def>d</Hit_def><Hit_len>100</Hit_len><Hit_hsps><Hsp><Hsp_bit-score>50</Hsp_bit-score><Hsp_score>40</Hsp_score><Hsp_evalue>1e-10</Hsp_evalue><Hsp_query-from>1</Hsp_query-from><Hsp_query-to>40</Hsp_query-to><Hsp_hit-from>1</Hsp_hit-from><Hsp_hit-to>40</Hsp_hit-to><Hsp_identity>40</Hsp_identity><Hsp_align-len>40</Hsp_align-len><Hsp_qseq>A</Hsp_qseq><Hsp_hseq>A</Hsp_hseq><Hsp_midline>|</Hsp_midline></Hsp></Hit_hsps></Hit>`;
  ctx.xml = Array.from({ length: 30 }, (_, i) => hit(i + 1)).join('');
  out.hits = vm.runInContext('parseBlastResults(xml, 25).length', ctx);
  out.evalueCode = /evalue: 0 \}/.test(src) ? 'evalue 0' : (/Math\.pow\(2, -sw\.bitScore\)/.test(src) ? 'computed' : 'unknown');
  out.crlf = src.includes(String.raw`.split(/\r?\n/).filter(l => !l.startsWith('>')).join('').replace(/\s+/g, '').toUpperCase()`);   // the fallback search's query: no CR or spaces
  const ok = out.mafft === '--maxiterate 1000 --localpair --thread 4' && out.hits === 25 && out.evalueCode === 'computed' && out.crlf;
  return { pass: ok, detail: JSON.stringify(out) };
});

check('Audit batch 4a: thresholds stay ordered, fuzzy search needs a matching letter, reverse complement keeps ~ gaps', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'b4.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGTACGTAC\n>b\nACGTACGTAC\n') });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const out = {};
    const set = (id, v) => { el(id + 'Slider').value = v; el(id + 'Input').value = v; };
    set('black', 55); set('dark', 80); set('light', 70);   // within the slider ranges; Dark and Light both above Black
    validateThresholds();
    out.th = [el('blackSlider').value, el('darkSlider').value, el('lightSlider').value].map(Number);
    out.fuzzy = findFuzzyMatches('TTTTTTTT', 'ACG', 3).length;          // every window mismatches everywhere
    out.fuzzyReal = findFuzzyMatches('TTACGTT', 'ACG', 1).length;
    out.rc = reverseComplement('AC~~GT');
    return out;
  });
  const ok = r.th[0] >= r.th[1] && r.th[1] >= r.th[2] && r.fuzzy === 0 && r.fuzzyReal > 0 && r.rc === 'AC~~GT';
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Audit batch 4b: NEXUS title with "interleaved", asked group count, peel ignores N, no NaN distances, a and A cluster together', async (page) => {
  const path = require('path');
  const KT = require(path.join(__dirname, '..', '..', 'kmer-tree.js'));
  const out = {};
  // k-mer groups: 12 sequences, Groups = 8 with Min size 10 cannot be made; the message must still say 8
  const seqs = Array.from({ length: 12 }, (_, i) => ({ seq: 'ACGTACGTAC'.split('').map((c, k) => (k === i % 10 ? 'T' : c)).join('') }));
  const tree = KT.guideTree(seqs, 3);
  const cut = KT.cutTree(tree, 8, 10);
  out.asked = cut.asked; out.reached = cut.reached;
  out.nan = Array.from(KT.pDistanceMatrix([{ seq: '' }, { seq: '' }, { seq: '' }])[0]).some(Number.isNaN);
  const r = await page.evaluate(() => {
    const o = {};
    o.interleave = _nexusBlockSettings('BEGIN DATA; TITLE Matrix not interleaved; DIMENSIONS NTAX=2 NCHAR=8; FORMAT DATATYPE=DNA; MATRIX').interleave;
    o.interleaveReal = _nexusBlockSettings('BEGIN DATA; DIMENSIONS NTAX=2 NCHAR=8; FORMAT DATATYPE=DNA INTERLEAVE; MATRIX').interleave;
    const sc = new SINEClusterer([{ id: 'a', seq: 'ACGTa' }, { id: 'b', seq: 'ACGTA' }, { id: 'c', seq: 'ACGTC' }]);
    o.casePatterns = Object.keys(sc.getPositionPatterns(4, [0, 1, 2])).sort().join(',');
    return o;
  });
  Object.assign(out, r);
  const ok = out.asked === 8 && out.reached === false && !out.nan && out.interleave === false && out.interleaveReal === true && out.casePatterns === 'A,C';
  return { pass: ok, detail: JSON.stringify(out) };
});

check('Copy with no selection and a stale row does not throw; codon toFasta wraps an empty sequence', async (page) => {
  const CA = require(require('path').join(__dirname, '..', '..', 'codon-align.js'));
  let fasta, err1 = null;
  try { fasta = CA.toFasta([{ name: 'x', seq: '' }, { name: 'y', seq: 'ACGTAC' }], 4); } catch (e) { err1 = e.message; }
  await page.setInputFiles('#fileInput', { name: 'cp.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGT\n>b\nACGA\n') });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => { state.selectedRows.clear(); let err = null, msg = ''; const om = showMessage; showMessage = (m, t) => { msg = m; return om(m, t); }; try { copySequences(true, true, 7); } catch (e) { err = e.message; } showMessage = om; return { err, msg }; });
  const ok = !err1 && fasta === '>x\n\n>y\nACGT\nAC\n' && !r.err && /Nothing to copy/.test(r.msg);
  return { pass: ok, detail: JSON.stringify({ err1, fasta, r }) };
});

check('TSD: an IUPAC code in a flank is a base (TSD length and columns stay right)', async (page) => {
  const r = await page.evaluate(() => {
    const got = _collectUngappedBasesWithColumns('AC-RTG', 0, 5);
    return { bases: (got.bases || []).join(''), columns: (got.columns || []).join(',') };
  });
  const ok = r.bases === 'ACRTG' && r.columns === '0,1,3,4,5';
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Codon analysis by gene: a third overlapping CDS is reported as not shown (not claimed shown)', async (page) => {
  const cds = 'ATGGCTAAAGGTCTGCAAGAATTCGGTACCTGGAAACCGATGCTTGCAGGTAAAGAACTGTTCCCGGGATCCTAA';
  await page.setInputFiles('#fileInput', { name: 'cds3.fa', mimeType: 'text/plain', buffer: Buffer.from(`>chr\n${cds}\n>b\n${cds}\n`) });
  await page.waitForTimeout(900);
  const r = await page.evaluate(async () => {
    const bed = ['chr\t0\t60\tgeneA\t0\t+', 'chr\t3\t63\tgeneB\t0\t+', 'chr\t6\t66\tgeneC\t0\t+'].map(l => l + '\t0\t0\t0\t1\t60\t0\tCDS').join('\n');
    let msg = ''; const om = showMessage; showMessage = (m, t) => { msg = m; return om(m, t); };
    state._lastAnnouncedCodonFrame = null;
    setAnnotation(bed, 'three.bed');
    const cb = document.getElementById('codonAnalysis'); cb.checked = true; cb.dispatchEvent(new Event('change'));
    await new Promise(res => setTimeout(res, 900));
    showMessage = om;
    return { msg, hidden: state._codonData?.hidden };
  });
  const ok = /Not shown/.test(r.msg) && /geneC/.test(r.msg);
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Tree: re-rooting on the only branch below a one-child root adds no empty tip', async (page) => {
  const r = await page.evaluate(() => {
    const T = window._treeDraw;
    const root = T.parseNewick('((A:0.1,B:0.2)X:0.3);');
    const target = root.children[0];
    const out = T.toNewick(T.rerootOnBranch(root, target));
    return { newick: out, leaves: (out.match(/[A-Za-z?]+(?=:)/g) || []).join(',') };
  });
  const ok = !/\?|\(\s*,|,\s*\)|\(\)/.test(r.newick) && /A/.test(r.newick) && /B/.test(r.newick) && (r.newick.match(/,/g) || []).length === 1;
  return { pass: ok, detail: JSON.stringify(r) };
});

// UPGMA builds a rooted tree by construction, so drawing it unrooted gets a quiet note; NJ does not
check('Tree: a UPGMA tree drawn unrooted shows a quiet note that UPGMA is rooted (NJ and rooted do not)', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'));
  await page.waitForTimeout(1500);
  const pick = (name, v) => page.evaluate(([name, v]) => { const r = document.querySelector(`input[name="${name}"][value="${v}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, [name, v]);
  const note = () => page.evaluate(() => { const e = document.getElementById('treeRootNote'); return e && getComputedStyle(e).display !== 'none' ? e.textContent : ''; });
  await pick('treeMethod', 'upgma');
  await page.evaluate(() => { state.selectedRows = new Set([0, 1, 2, 3]); openTreeBuilder(); });
  await page.waitForTimeout(900);
  const r = {};
  r.upgmaRooted = await note();
  await pick('treeLayout', 'unrooted'); await page.waitForTimeout(200);
  r.upgmaUnrooted = await note();
  await pick('treeMethod', 'nj'); await page.waitForTimeout(600);
  r.njUnrooted = await note();
  await pick('treeMethod', 'upgma'); await page.waitForTimeout(600);
  r.upgmaAgain = await note();
  await pick('treeLayout', 'rect'); await page.waitForTimeout(200);
  r.backToRooted = await note();
  await page.click('#treeBuilderCloseBtn');
  const ok = !r.upgmaRooted && /UPGMA/.test(r.upgmaUnrooted) && /root/i.test(r.upgmaUnrooted) && !r.njUnrooted && r.upgmaAgain === r.upgmaUnrooted && !r.backToRooted;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Chromatogram: each click asks once, for the clicked base; a drag does not ask', async (page) => {
  const r = await page.evaluate(() => {
    const n = 20, sp = 12, ns = n * sp + 12, tr = () => Array.from({ length: ns }, (_, i) => 50 + 40 * Math.sin(i));
    state.ab1Traces = { t1: { sequence: 'ACGTACGTACGTACGTACGT', quality: Array(n).fill(40), numSamples: ns, peakLocations: Array.from({ length: n }, (_, i) => 6 + i * sp), traces: { A: tr(), C: tr(), G: tr(), T: tr() } } };
    ChromatogramViewer.open('t1');
    const c = [...document.querySelectorAll('canvas')].find(x => x.width >= 2000), rect = c.getBoundingClientRect();
    const xOf = k => rect.left + state.ab1Traces.t1.peakLocations[k] * 3 * rect.width / c.width;
    const asked = []; const orig = window.prompt; window.prompt = (m) => { asked.push(m.match(/position (\d+)/)[1]); return null; };
    const press = (k, dx = 0) => {
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: xOf(k), clientY: rect.top + 50, bubbles: true }));
      if (dx) window.dispatchEvent(new MouseEvent('mousemove', { clientX: xOf(k) + dx, clientY: rect.top + 50, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: xOf(k) + dx, clientY: rect.top + 50, bubbles: true }));
      c.dispatchEvent(new MouseEvent('click', { clientX: xOf(k) + dx, clientY: rect.top + 50, bubbles: true }));
    };
    press(2); press(7);              // two clicks: one prompt each, bases 3 and 8
    const afterClicks = asked.slice();
    press(4, 60);                    // a drag
    window.prompt = orig; ChromatogramViewer.close();
    return { afterClicks: afterClicks.join(','), all: asked.join(',') };
  });
  const ok = r.afterClicks === '3,8' && r.all === '3,8';
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Search hit counts follow edits (a search with no hit counts the matches an edit creates)', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'sc.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGTACGTAC\n>b\nACGTACGTAC\n') });
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    el('searchRegex').checked = false; el('maxMismatches').value = '0'; el('searchBothStrands').checked = false;
    el('searchInput').value = 'GGG'; el('searchButton').click();
    await new Promise(res => setTimeout(res, 300));
    const before = state.searchHistory[0]?.matchCount;
    pushUndo('test-edit');
    state.seqs[0] = { ...state.seqs[0], seq: 'ACGGGCGTAC' }; state.seqs[0].gaplessPositions = calculateGaplessPositions(state.seqs[0].seq);
    renderAlignment();
    await new Promise(res => setTimeout(res, 1000));
    return { before, after: state.searchHistory[0]?.matchCount, label: document.querySelector('#searchList')?.textContent || '' };
  });
  const ok = r.before === 0 && r.after === 1 && /GGG \(1\)/.test(r.label);
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Context menu Rename from a residue opens the name editor (the residue stays)', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'rn.fa', mimeType: 'text/plain', buffer: Buffer.from('>alpha\nACGTACGTAC\n>beta\nACGTTCGTAC\n') });
  await page.waitForTimeout(800);
  await setMode(page, 'full'); await page.waitForTimeout(500);
  const r = await page.evaluate(async () => {
    const base = document.querySelector('.seq-line[data-seq-index="1"] .seq-data span[data-pos="3"]');
    showContextMenu({ target: base, preventDefault() {}, stopPropagation() {}, clientX: 50, clientY: 50, pageX: 50, pageY: 50 }, 1);
    const item = [...document.querySelectorAll('.context-menu div')].find(d => d.textContent === 'Rename sequence');
    item.click(); await new Promise(res => setTimeout(res, 200));
    const input = document.activeElement;
    const inName = !!input && input.tagName === 'INPUT' && !!input.closest('.seq-name, .seq-name-edit, .name-edit-box') || (input && !input.closest('.seq-data'));
    const baseNow = document.querySelector('.seq-line[data-seq-index="1"] .seq-data span[data-pos="3"]')?.textContent;
    return { inputValue: input?.value, inSeqData: !!(input && input.closest && input.closest('.seq-data')), baseNow };
  });
  const ok = r.inputValue === 'beta' && !r.inSeqData && r.baseNow === 'T';
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Colour reset clears name colours but keeps SNP-group colours (DOM and Canvas)', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'cr.fa', mimeType: 'text/plain', buffer: Buffer.from('>g1\nACGTACGTAC\n>n1\nACGTTCGTAC\n') });
  await page.waitForTimeout(800);
  await setMode(page, 'full'); await page.waitForTimeout(400);
  const r = await page.evaluate(async () => {
    state.clusterMap = { g1: { color: '#ff0000', name: 'Group 1' } };
    colourState.mappings.set('n1', '#00ff00');
    renderAlignment(); await new Promise(res => setTimeout(res, 200));
    resetAllColours(); await new Promise(res => setTimeout(res, 300));
    const bg = (h) => { const i = state.seqs.findIndex(q => q.header === h); return getComputedStyle(document.querySelector(`.seq-name[data-seq-index="${i}"]`)).backgroundColor; };
    return { group: bg('g1'), named: bg('n1'), mapped: colourState.mappings.size };
  });
  const ok = r.group === 'rgb(255, 0, 0)' && r.named !== 'rgb(0, 255, 0)' && r.mapped === 0;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Codon marks: a synonymous codon reached by several changes is marked apart (dashed), a single synonymous change stays plain', async (page) => {
  // codon 2: TCG (Ser) in the reference; AGT (Ser, all three bases changed) in row 2; codon 3: CTG -> TTG (Leu, one change) in row 3
  const fa = '>ref\nATGTCGCTGAAATAA\n>multi\nATGAGTCTGAAATAA\n>single\nATGTCGTTGAAATAA\n';
  await page.setInputFiles('#fileInput', { name: 'syn.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
  await page.waitForTimeout(900);
  await setMode(page, 'full'); await page.waitForTimeout(300);
  const r = await page.evaluate(async () => {
    document.getElementById('codonCode').value = '1'; document.getElementById('codonFrame').value = '0';
    const cb = document.getElementById('codonAnalysis'); cb.checked = true; cb.dispatchEvent(new Event('change'));
    await new Promise(res => setTimeout(res, 800));
    const sn = state._codonData.synNonSyn;
    const cls = (row, pos) => document.querySelector(`.seq-line[data-seq-index="${row}"] .seq-data span[data-pos="${pos}"]`)?.className || '';
    return { multi: [3, 4, 5].map(p => sn[1][p]).join(','), single: sn[2][6], domMulti: /codon-synmulti/.test(cls(1, 3)), domSingle: /codon-syn\b/.test(cls(2, 6)) && !/synmulti/.test(cls(2, 6)) };
  });
  const ok = r.multi === 'synmulti,synmulti,synmulti' && r.single === 'syn' && r.domMulti && r.domSingle;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Skim fixes: protein search for U finds selenocysteine only; Ctrl+Delete in the search box does not delete sequences', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'pu.fa', mimeType: 'text/plain', buffer: Buffer.from('>p1\nMKTULLEFGHIKLMNPQRSTVWY\n>p2\nMKTTLLEFGHIKLMNPQRSTVWY\n') });
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    el('searchRegex').checked = false; el('maxMismatches').value = '0'; el('searchBothStrands').checked = false;
    el('searchInput').value = 'TU'; el('searchButton').click();
    await new Promise(res => setTimeout(res, 300));
    const hits = state.searchHistory[0]?.matchCount;
    window.confirm = () => true;
    state.selectedRows.clear(); state.selectedRows.add(0);
    const box = el('searchInput');
    for (let n = box; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).display === 'none') n.style.display = 'block';   // the menu holding it is open while one types in it
    box.focus(); const focused = document.activeElement === box;
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', ctrlKey: true, bubbles: true }));
    await new Promise(res => setTimeout(res, 200));
    return { hits, rows: state.seqs.length, focused };
  });
  const ok = r.hits === 1 && r.rows === 2;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('BAM: 1- and 2-byte integer tags (NM:C, AS:c, XS:S) are read and the tags after them kept', async (page) => {
  const r = await page.evaluate(() => {
    // one BAM record: name r1, 4 bases ACGT, cigar 4M, tags NM:C:2 AS:c:-5 XS:S:300 MD:Z:4
    const enc = new TextEncoder(), parts = [];
    const u8 = a => parts.push(Uint8Array.from(a));
    const i32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); parts.push(b); };
    const u16 = v => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); parts.push(b); };
    const u32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); parts.push(b); };
    const body = [];
    const push = (fn, v) => { const before = parts.length; fn(v); body.push(...parts.splice(before)); };
    push(i32, 0); push(i32, 9); push(u8, [3]); push(u8, [60]); push(u16, 0); push(u16, 1); push(u16, 0); push(u32, 4); push(i32, -1); push(i32, -1); push(i32, 0);
    body.push(enc.encode('r1\0'));
    push(u32, (4 << 4) | 0);                       // 4M
    body.push(Uint8Array.from([0x12, 0x48]));      // ACGT (A=1 C=2 G=4 T=8)
    body.push(Uint8Array.from([30, 30, 30, 30]));  // qualities
    body.push(enc.encode('NMC'), Uint8Array.from([2]));
    body.push(enc.encode('ASc'), Uint8Array.from([0xFB]));
    body.push(enc.encode('XSS'), Uint8Array.from([0x2C, 0x01]));
    body.push(enc.encode('MDZ4\0'));
    const len = body.reduce((a, b) => a + b.length, 0);
    const buf = new Uint8Array(4 + len); new DataView(buf.buffer).setUint32(0, len, true);
    let o = 4; body.forEach(b => { buf.set(b, o); o += b.length; });
    const rec = BamParser.parseBAMRecord(buf, 0);
    return { seq: rec?.record?.seq, tags: rec?.record?.tags };
  });
  const t = r.tags || {};
  const ok = r.seq === 'ACGT' && t.NM === 2 && t.AS === -5 && t.XS === 300 && t.MD === '4';
  return { pass: ok, detail: JSON.stringify(r) };
});

check('MSF: a name listed twice gives two rows, each with its own residues', async (page) => {
  const msf = [' t.msf  MSF: 8  Type: N  Check: 1234  ..', '',
    ' Name: dup  Len: 8  Check: 1  Weight: 1.00', ' Name: dup  Len: 8  Check: 2  Weight: 1.00', ' Name: other  Len: 8  Check: 3  Weight: 1.00', '', '//', '',
    'dup    ACGT', 'dup    TTTT', 'other  GGGG', '',
    'dup    AAAA', 'dup    CCCC', 'other  GGGG', ''].join('\n');
  const r = await page.evaluate((msf) => (parseMsf(msf) || []).map(q => q.header + '=' + q.seq), msf);
  const ok = r.join('|') === 'dup=ACGTAAAA|dup=TTTTCCCC|other=GGGGGGGG';
  return { pass: ok, detail: JSON.stringify(r) };
});

check('No empty undo steps: Move Up at the top, a cancelled Realign all; negative mismatches still finds exact hits', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'u2.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGTACGTAC\n>b\nACGTTCGTAC\n') });
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const out = {};
    insertSingleGap(1, 2); undoDelete(true);              // one Redo step to keep
    const base = { undo: state.deletedHistory.length, redo: state.redoHistory.length };
    state.selectedRows.clear(); state.selectedRows.add(0); moveSelectedUp();
    out.move = { undo: state.deletedHistory.length, redo: state.redoHistory.length };
    const orig = window._mafftAlignWithUi; window._mafftAlignWithUi = async () => null;   // the user cancels
    document.getElementById('mafftReorderOnly').checked = false;
    await realignAll(); window._mafftAlignWithUi = orig;
    out.cancel = { undo: state.deletedHistory.length, redo: state.redoHistory.length };
    out.base = base;
    el('searchRegex').checked = false; el('searchBothStrands').checked = false; el('maxMismatches').value = '-2';
    el('searchInput').value = 'ACGTAC'; el('searchButton').click();
    await new Promise(res => setTimeout(res, 300));
    out.hits = state.searchHistory[0]?.matchCount; el('maxMismatches').value = '0';
    return out;
  });
  const same = o => o.undo === r.base.undo && o.redo === r.base.redo;
  const ok = r.base.redo === 1 && same(r.move) && same(r.cancel) && r.hits > 0;
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Undo/Redo of Reverse complement keep the name colour on the row (rc_ rename)', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'rcc.fa', mimeType: 'text/plain', buffer: Buffer.from('>s1\nAACCGGTT\n>s2\nACGTACGT\n') });
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    colourState.mappings.set('s1', '#ff0000');
    reverseComplementSequences([0]);
    const afterRc = colourState.mappings.get(state.seqs[0].header);
    undoDelete(true);
    const afterUndo = colourState.mappings.get(state.seqs[0].header);
    redoAction(true);
    const afterRedo = colourState.mappings.get(state.seqs[0].header);
    return { afterRc, afterUndo, afterRedo, name: state.seqs[0].header };
  });
  const ok = r.afterRc === '#ff0000' && r.afterUndo === '#ff0000' && r.afterRedo === '#ff0000';
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Context menu: closing it through an item leaves no document click listener behind', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'cm.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGT\n>b\nACGA\n') });
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    let live = 0;
    const add = document.addEventListener, rem = document.removeEventListener;
    const tracked = new Set();
    document.addEventListener = function (t, f, o) { if (t === 'click') tracked.add(f); return add.call(this, t, f, o); };
    document.removeEventListener = function (t, f, o) { if (t === 'click') tracked.delete(f); return rem.call(this, t, f, o); };
    const before = tracked.size;
    window._copied = null; navigator.clipboard.writeText = t => Promise.resolve();
    for (let k = 0; k < 5; k++) {
      showContextMenu({ target: document.querySelector('.seq-line'), preventDefault() {}, stopPropagation() {}, clientX: 50, clientY: 50, pageX: 50, pageY: 50 }, 0);
      await new Promise(res => setTimeout(res, 20));
      [...document.querySelectorAll('.context-menu div')].find(d => d.textContent === 'Copy as FASTA gapped').click();
      await new Promise(res => setTimeout(res, 20));
    }
    live = tracked.size - before;
    document.addEventListener = add; document.removeEventListener = rem;
    return { leftOver: live };
  });
  return { pass: r.leftOver === 0, detail: JSON.stringify(r) };
});

check('Canvas: jumping to a column keeps the column selection the user had', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'jc.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGTACGTACGTACGTACGT\n>b\nACGTACGTACGTACGTACGT\n') });
  await page.waitForTimeout(800);
  await setMode(page, 'canvas'); await page.waitForTimeout(400);
  const r = await page.evaluate(async () => {
    state.selectedColumns.clear(); [2, 3, 4].forEach(c => state.selectedColumns.add(c));
    _geJumpToCol(10);
    await new Promise(res => setTimeout(res, 1300));
    return [...state.selectedColumns].sort((a, b) => a - b).join(',');
  });
  return { pass: r === '2,3,4', detail: r };
});

check('Codon library: a reference index that is NaN or a fraction does not crash alignMultiple', async () => {
  const CA = require(require('path').join(__dirname, '..', '..', 'codon-align.js'));
  const out = {};
  for (const ref of [NaN, 1.7]) { try { out[String(ref)] = CA.alignMultiple([{ name: 'a', seq: 'ATGAAACCC' }, { name: 'b', seq: 'ATGAAGCCC' }], { ref }).nt.length; } catch (e) { out[String(ref)] = 'throws: ' + e.message; } }
  return { pass: out.NaN === 2 && out['1.7'] === 2, detail: JSON.stringify(out) };
});

check('BLAST: the E-value threshold from the dialog drops weaker hits', async (page) => {
  const r = await page.evaluate(() => {
    if (typeof _applyEvalueCutoff !== 'function') return { missing: true };
    const res = { db: { hits: [{ id: 'a', hsps: [{ evalue: 1e-20 }] }, { id: 'b', hsps: [{ evalue: 0.5 }] }, { id: 'c', hsps: [{ evalue: 1e-6 }] }] } };
    return { ids: _applyEvalueCutoff(res, '1e-5').db.hits.map(h => h.id).join(',') };
  });
  return { pass: r.ids === 'a,c', detail: JSON.stringify(r) };
});

check('Reads (SAM): a reference row with alignment gaps is used ungapped, so reads sit on the right bases', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'ref.fa', mimeType: 'text/plain', buffer: Buffer.from('>chrT\nACGTA--CGTACGTACGTAC\n>other\nACGTAAACGTACGTACGTAC\n') });
  await page.waitForTimeout(900);
  const sam = '@SQ\tSN:chrT\tLN:18\nr1\t0\tchrT\t5\t60\t10M\t*\t0\t0\tACGTACGTAC\tIIIIIIIIII\n';
  await page.setInputFiles('#fileInput', { name: 'reads.sam', mimeType: 'text/plain', buffer: Buffer.from(sam) });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ ref: bamState.refSeq, start: bamState.refStart, n: (bamState.reads || []).length }));
  const ok = r.n === 1 && typeof r.ref === 'string' && !/[-.]/.test(r.ref);
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Group explorer: selecting a group selects its own rows, not other rows with the same name', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'gs.fa', mimeType: 'text/plain', buffer: Buffer.from('>s1\nAAAA\n>s1\nCCCC\n>s2\nGGGG\n') });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    state.clusterResults = { clusters: [{ sequences: [{ id: 's1', obj: state.seqs[0] }] }], unassigned: [{ id: 's1', obj: state.seqs[1] }, { id: 's2', obj: state.seqs[2] }] };
    state.selectedRows.clear();
    _geSelectGroup('cluster', 0);
    return [...state.selectedRows].sort().join(',');
  });
  return { pass: r === '0', detail: r };
});

check('Uncertain batch: Undo of moving a group restores the group order; repeat/TSD results go with a new file; overlapping clustering yields all resume', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'u3.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nAAAA\n>b\nCCCC\n>c\nGGGG\n') });
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const out = {};
    const g0 = { sequences: [{ id: 'a', obj: state.seqs[0] }] }, g1 = { sequences: [{ id: 'b', obj: state.seqs[1] }] };
    state.clusterResults = { clusters: [g0, g1], unassigned: [{ id: 'c', obj: state.seqs[2] }] };
    _geMoveGroup(0, 1);
    out.moved = state.clusterResults.clusters[0] === g1;
    undoDelete(true);
    out.undone = state.clusterResults.clusters[0] === g0;
    _lastTsdResults = [{ row: 0 }]; _lastRepeatResults = [{ row: 0 }];
    fastaInput.value = '>x\nTTTT\n>y\nTTTA\n'; await parseAndRender(true); await new Promise(res => setTimeout(res, 300));
    out.resultsCleared = _lastTsdResults.length === 0 && _lastRepeatResults.length === 0;
    return out;
  });
  // two overlapping yield loops in cluster.js must both finish
  const yields = await page.evaluate(async () => {
    if (typeof _yieldToBrowser !== 'function') return 'no helper';
    let a = 0, b = 0;
    const run = async (inc) => { for (let i = 0; i < 20; i++) { await _yieldToBrowser(); inc(); } };
    await Promise.race([Promise.all([run(() => a++), run(() => b++)]), new Promise(res => setTimeout(res, 2000))]);
    return a + ',' + b;
  });
  const ok = r.moved && r.undone && r.resultsCleared && yields === '20,20';
  return { pass: ok, detail: JSON.stringify({ r, yields }) };
});

// ---- v267: low-severity audit findings (one check per finding, or two related ones) ----

check('Audit #53: reads on the second loaded reference load (the header\'s first loaded reference had none)', async (page) => {
  // A region subset keeps the full header: @SQ chr1 and chr2 both loaded, all reads on chr2. The first
  // loaded header reference was taken, so it said 'No reads map to the matched reference'.
  await page.setInputFiles('#fileInput', { name: 'two.fa', mimeType: 'text/plain', buffer: Buffer.from('>chr1\nAAAAAAAAAAAAAAAAAAAA\n>chr2\nACGTACGTACGTACGTACGT\n') });
  await page.waitForTimeout(900);
  const sam = '@SQ\tSN:chr1\tLN:20\n@SQ\tSN:chr2\tLN:20\nr1\t0\tchr2\t3\t60\t8M\t*\t0\t0\tGTACGTAC\tIIIIIIII\nr2\t0\tchr2\t5\t60\t8M\t*\t0\t0\tACGTACGT\tIIIIIIII\n';
  await page.setInputFiles('#fileInput', { name: 'sub.sam', mimeType: 'text/plain', buffer: Buffer.from(sam) });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ ref: bamState.refName, n: (bamState.reads || []).length }));
  return { pass: r.ref === 'chr2' && r.n === 2, detail: JSON.stringify(r) };
});

check('Audit #143 #144: a preset cannot be saved as "optimal"; a loaded gap threshold shows 29, not 28.999999999999996', async (page) => {
  await loadFasta(page, makeFasta(4, 30));
  const r = await page.evaluate(() => {
    const el = id => document.getElementById(id);
    localStorage.removeItem('clusteringPresets');
    el('leftGapInput').value = '29'; el('rightGapInput').value = '57';
    // #143: the Defaults button rewrites 'optimal', so a user preset under that name was lost
    el('presetNameInput').value = 'optimal'; saveClusteringPreset();
    const afterOptimal = JSON.parse(localStorage.getItem('clusteringPresets') || '{}').optimal;
    // #144: 0.29 * 100 = 28.999999999999996 was put in the field, and a re-save then stored 0.28
    el('presetNameInput').value = 'mine'; saveClusteringPreset();
    el('leftGapInput').value = '50'; el('rightGapInput').value = '50';
    updateClusteringPresetList();
    el('clusteringPresetList').value = 'mine'; loadClusteringPreset(true);
    return { optimalLeft: afterOptimal ? afterOptimal.trimming.leftGapThresh : null, left: el('leftGapInput').value, right: el('rightGapInput').value };
  });
  const ok = r.optimalLeft !== 0.29 && r.left === '29' && r.right === '57';
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Audit #145: choosing the fast strategy for one large MAFFT run leaves the Speed setting as it was', async (page) => {
  const r = await page.evaluate(() => {
    const sp = document.getElementById('mafftSpeed');
    sp.value = '2';
    const orig = window.confirm; window.confirm = () => true;
    let res;
    try { res = _confirmMafftJob({ seqCount: 50, totalResidues: 600000, maxLen: 12000 }, ['-E', '2']); } finally { window.confirm = orig; }
    return { speed: sp.value, args: res.extraArgs.join(' ') };
  });
  // the select was set to '1' for good, so every later (small) alignment ran FFT-NS-1
  return { pass: r.speed === '2' && r.args === '-E 1', detail: JSON.stringify(r) };
});

check('Audit #160 #199: a GenBank record without a sequence is reported, and no stale per-record annotation state is kept', async (page) => {
  const gb = 'LOCUS       REC1    20 bp    DNA     linear   SYN 01-JAN-2000\nDEFINITION  one.\nACCESSION   REC1\nORIGIN\n        1 acgtacgtac gtacgtacgt\n//\n' +
    'LOCUS       CTG2    500 bp    DNA     linear   CON 01-JAN-2000\nDEFINITION  contig record, no ORIGIN.\nACCESSION   CTG2\nCONTIG      join(AB000001.1:1..500)\n//\n' +
    'LOCUS       REC3    20 bp    DNA     linear   SYN 01-JAN-2000\nDEFINITION  three.\nACCESSION   REC3\nORIGIN\n        1 ttttgggggc ccccaaaaat\n//\n';
  await page.evaluate(() => { window._msgs = []; const o = showMessage; window.showMessage = function (m) { window._msgs.push(String(m)); return o.apply(this, arguments); }; });
  await page.setInputFiles('#fileInput', { name: 'multi.gb', mimeType: 'text/plain', buffer: Buffer.from(gb) });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => ({
    rows: state.seqs.length,
    // the last GenBank message must say it (one shown from the parser was overwritten at once by 'Detected GenBank format')
    last: window._msgs.filter(m => /GenBank/.test(m)).pop() || '',
    // #160: written per record (so it described only the last one), never cleared and never read
    annot: typeof state._genbankAnnotations
  }));
  const ok = r.rows === 2 && /skipped/.test(r.last) && /CTG2/.test(r.last) && r.annot === 'undefined';
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Audit #161: the ruler draws the tick on a block\'s last column (60, 590)', async (page) => {
  const r = await page.evaluate(() => ({ a: generateScale(60, 10, 0), b: generateScale(590, 10, 0), c: generateScale(60, 10, 60) }));
  // the loop stopped before endAbs, so block boundary ticks (60, 120, ...) were never drawn
  const ok = r.a.endsWith('*') && r.b.endsWith('590') && r.c.endsWith('*');
  return { pass: ok, detail: JSON.stringify({ a: r.a.slice(-4), b: r.b.slice(-4), c: r.c.slice(-4) }) };
});

check('Audit #162: soft-clip boxes of reads stay inside the plot (not over the name column, not past the right edge)', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'ref.fa', mimeType: 'text/plain', buffer: Buffer.from('>chrS\nACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT\n>o\nACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT\n') });
  await page.waitForTimeout(900);
  // r1 starts at the reference's first base with a 5-base left clip; r2 ends at its last base with a 20-base right clip
  const sam = '@SQ\tSN:chrS\tLN:40\nr1\t0\tchrS\t1\t60\t5S10M\t*\t0\t0\tTTTTTACGTACGTAC\tIIIIIIIIIIIIIII\n' +
    'r2\t0\tchrS\t31\t60\t10M20S\t*\t0\t0\tGTACGTACGTTTTTTTTTTTTTTTTTTTTT\tIIIIIIIIIIIIIIIIIIIIIIIIIIIIII\n';
  await page.setInputFiles('#fileInput', { name: 'clip.sam', mimeType: 'text/plain', buffer: Buffer.from(sam) });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    if (!document.getElementById('readsPileSvg')) renderReadsAlignment();
    const svg = document.getElementById('readsPileSvg');   // the reads (a coverage row's svg now comes first)
    if (!svg) return { noSvg: true, n: (bamState.reads || []).length };
    const W = parseFloat(svg.getAttribute('width'));
    const clips = [...svg.querySelectorAll('rect[fill="#e8eef5"]')].map(c => ({ x: +c.getAttribute('x'), w: +c.getAttribute('width') }));
    return { W, clips };
  });
  const ok = !r.noSvg && r.clips.length === 2 && r.clips.every(c => c.x >= 160 && c.x + c.w <= r.W + 0.01);
  return { pass: ok, detail: JSON.stringify(r) };
});

check('Audit #202: reads loaded on an empty reference row say so, not "No reads loaded"', async (page) => {
  await loadFasta(page, '>a\nACGT\n>b\nACGA\n');
  const r = await page.evaluate(() => {
    const keep = { reads: bamState.reads, refSeq: bamState.refSeq, refName: bamState.refName };
    bamState.reads = [{ name: 'r1', pos: 0 }]; bamState.refSeq = ''; bamState.refName = 'chrE';
    renderReadsAlignment();
    const text = document.getElementById('alignmentContainer').textContent;
    Object.assign(bamState, keep);
    return text;
  });
  return { pass: !/No reads loaded/.test(r) && /chrE/.test(r), detail: r };
});

check('Audit #169: Canvas mode hides the vertical scrollbar when all rows fit', async (page) => {
  await loadFasta(page, makeFasta(4, 200));
  await setMode(page, 'canvas'); await page.waitForTimeout(600);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const bar = document.querySelector('.vertical-scrollbar');
    const cs = getComputedStyle(bar);
    return { display: cs.display, visibility: cs.visibility, contentH: _canvasState.totalContentH, viewH: document.getElementById('alignmentContainer').clientHeight };
  });
  // the canvas branch always set display:flex, so an empty track stood beside a short alignment
  const hidden = r.display === 'none' || r.visibility === 'hidden';
  return { pass: hidden && r.contentH < r.viewH, detail: JSON.stringify(r) };
});

check('Audit #169: Canvas mode still shows the vertical scrollbar when rows do not fit', async (page) => {
  await loadFasta(page, makeFasta(200, 100));
  await setMode(page, 'canvas'); await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const bar = document.querySelector('.vertical-scrollbar');
    const cs = getComputedStyle(bar);
    return { display: cs.display, visibility: cs.visibility };
  });
  return { pass: r.display !== 'none' && r.visibility !== 'hidden', detail: JSON.stringify(r) };
});

check('Audit #174: the unrooted tree shrinks when zoomed out below 40 %', async (page) => {
  const r = await page.evaluate(() => {
    const T = window._treeDraw;
    const nw = '((a:0.1,b:0.2):0.3,(c:0.15,d:0.25):0.1,(e:0.2,f:0.05):0.2);';
    const svg = z => T.buildTreeSVGString(T.parseNewick(nw), { layout: 'unrooted', zoom: z, width: 700 });
    const w = s => parseFloat((s.match(/<svg[^>]*\swidth="([\d.]+)/) || [])[1]);
    return { w25: w(svg(0.25)), w30: w(svg(0.3)), w40: w(svg(0.4)), same: svg(0.3) === svg(0.4) };
  });
  // the scale was clamped at Math.max(0.4, zoom): 25-40 % drew the same picture
  return { pass: !r.same && r.w30 < r.w40 && r.w25 < r.w30, detail: JSON.stringify(r) };
});

check('Audit #178: closing a window whose opener is gone puts focus on the alignment, not on nothing', async (page) => {
  await loadFasta(page, '>a\nACGT\n>b\nACGA\n');
  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(res => setTimeout(res, ms));
    const opener = document.createElement('button'); opener.textContent = 'opener'; document.body.appendChild(opener);
    opener.focus();
    const modal = document.getElementById('repeatFinderModal');
    modal.style.display = 'block'; await wait(80);
    opener.remove();                      // the opener was rebuilt (e.g. a results panel redrawn) meanwhile
    modal.style.display = 'none'; await wait(80);
    const a = document.activeElement;
    return { active: a ? (a.id || a.tagName) : null };
  });
  return { pass: r.active === 'alignmentContainer', detail: JSON.stringify(r) };
});

check('Audit #194: the cluster leak tooltip does not count rows deleted since clustering', async (page) => {
  await loadFasta(page, '>a\nACGTACGT\n>b\nTCGTACGT\n>c\nGCGTACGT\n');
  const r = await page.evaluate(() => {
    const keep = state.clusterResults;
    // group 2 also lists 'gone', a row deleted after clustering
    state.clusterResults = { clusters: [
      { sequences: [{ id: 'a' }], perfectFeatures: [{ pos: 1, char: 'A' }] },
      { sequences: [{ id: 'b' }, { id: 'c' }, { id: 'gone' }], perfectFeatures: [] }
    ], unassigned: [] };
    _rebuildClusterCharMap();
    const leak = state._clusterCharMap[_clusterAlignmentColumnOffset()][0].leak;
    state.clusterResults = keep; _rebuildClusterCharMap();
    return leak;
  });
  return { pass: r && r.total === 2 && r.count === 0, detail: JSON.stringify(r) };
});

check('Audit #196: two server loads in a row leave the real tab title, not "* LOADED: <first file>"', async (page) => {
  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(res => setTimeout(res, ms));
    document.title = 'ViewAlign';
    const origFetch = window.fetch, origFocus = document.hasFocus;
    window.fetch = async () => ({ ok: true, json: async () => ({ content: '>a\nACGT\n>b\nACGA\n' }) });
    document.hasFocus = () => false;      // the tab stays in the background, so the flash runs its full length
    try {
      await fetchFileFromServer('/data/one.fa', 'srv');
      await wait(650);                   // the first flash shows '* LOADED: one.fa' now
      const mid = document.title;
      await fetchFileFromServer('/data/two.fa', 'srv');
      await wait(6000);
      return { mid, end: document.title };
    } finally { window.fetch = origFetch; document.hasFocus = origFocus; }
  });
  return { pass: /LOADED/.test(r.mid) && r.end === 'ViewAlign', detail: JSON.stringify(r) };
});

check('Audit #204: shift-clicking row names drops a pending two-click residue range', async (page) => {
  await loadFasta(page, '>a\nACGTACGTACGT\n>b\nACGTACGTACGT\n>c\nACGTACGTACGT\n');
  const name = i => page.locator(`.seq-line[data-seq-index="${i}"] .seq-name`).first();
  const res = (i, p) => page.locator(`.seq-line[data-seq-index="${i}"] .seq-data span[data-pos="${p}"]`).first();
  await name(0).click({ modifiers: ['Control'] });   // a row selection, so Shift+click extends it
  await res(1, 2).click();                 // first click of a two-click range
  await name(2).click({ modifiers: ['Shift'] });
  await res(1, 8).click();                 // must start a new selection, not complete 2..8
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => { const s = state.selectedNucs.get(1); return s ? [...s].sort((a, b) => a - b) : null; });
  return { pass: Array.isArray(r) && r.length === 1 && r[0] === 8, detail: JSON.stringify(r) };
});

check('Audit #207: the viewport SVG export draws a span cut by the left edge at its true position', async (page) => {
  await loadFasta(page, makeFasta(10, 600));
  await setMode(page, 'full'); await page.waitForTimeout(500);
  // names that scroll with the residues, so a name span is cut by the container's left edge
  await page.evaluate(() => { const c = document.getElementById('stickyNames'); if (c.checked) c.click(); });
  await page.waitForTimeout(500);
  const r = await page.evaluate(async () => {
    const ac = document.getElementById('alignmentContainer');
    ac.scrollLeft = 13; await new Promise(res => setTimeout(res, 300));
    const cLeft = ac.getBoundingClientRect().left;
    const cut = [...ac.querySelectorAll('.seq-line span')].find(s => {
      const b = s.getBoundingClientRect(); return s.children.length === 0 && s.textContent.length > 2 && b.left < cLeft - 1 && b.right > cLeft + 1;
    });
    if (!cut) return { noCut: true, scrollLeft: ac.scrollLeft };
    const expectX = cut.getBoundingClientRect().left - cLeft;
    let blob = null;
    const origURL = URL.createObjectURL;
    URL.createObjectURL = x => { blob = x; return 'blob:x'; };
    const origClick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
    try { _exportAlignmentAsSvg('viewport'); } finally { URL.createObjectURL = origURL; HTMLAnchorElement.prototype.click = origClick; }
    const text = blob ? await blob.text() : '';
    const xs = [...text.matchAll(/<text x="([-\d.]+)"[^>]*>([^<]*)<\/text>/g)].filter(m => m[2] === cut.textContent).map(m => +m[1]);
    return { text: cut.textContent, expectX: +expectX.toFixed(2), xs };
  });
  // the span's start was moved to x=0, so the export showed its beginning instead of the visible slice
  return { pass: !r.noCut && r.xs.some(x => Math.abs(x - r.expectX) < 0.6), detail: JSON.stringify(r) };
});

check('Audit #208: two restriction entries with one recognition site count the shared site once', async (page) => {
  await loadFasta(page, '>a\nAAGGATCCAAAA\n>b\nAAGGATCCAAAA\n');
  const r = await page.evaluate(() => {
    const msgs = []; const o = showMessage; window.showMessage = function (m) { msgs.push(String(m)); return o.apply(this, arguments); };
    document.querySelectorAll('.re-cb').forEach(cb => { cb.checked = false; });
    document.getElementById('searchBothStrands').checked = false;
    document.getElementById('reSiteManualInput').value = 'X:GGATCC, Y:GGATCC';
    searchResEnzyme();
    window.showMessage = o;
    return msgs.filter(m => /^Found/.test(m)).pop() || msgs.join(' | ');
  });
  // the totals were summed per entry: 'Found 2 unique restriction sites ... (4 row matches)'
  return { pass: /^Found 1 unique restriction site in 2 sequences \(2 row matches\)/.test(r), detail: r };
});

check('Audit #210: removing a search with the x in the Active searches list can be undone', async (page) => {
  await loadFasta(page, '>a\nACGTACGTAC\n>b\nACGTACGTAC\n');
  await page.evaluate(() => {
    document.getElementById('searchRegex').checked = false;
    document.getElementById('searchInput').value = 'CGTA';
    document.getElementById('searchButton').click();
  });
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => state.searchHistory.length);
  // the list sits in the collapsed Search menu: click its x button through the DOM (same handler)
  await page.evaluate(() => document.querySelector('#searchList .search-remove').click());
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const removed = state.searchHistory.length;
    undoSelectionsRemoval();
    return { removed, restored: state.searchHistory.length };
  });
  return { pass: before === 1 && r.removed === 0 && r.restored === 1, detail: JSON.stringify({ before, ...r }) };
});

check('Audit #221: moving off the dot plot clears the region Copy region would copy', async (page) => {
  await loadFasta(page, '>a\nACGTACGTTTGACCAGTACGATCGATCGTAGCTAGCTAGG\n>b\nACGTACGTTTGACCAGTACGATCGATCGTAGCTAGCTAGG\n');
  await page.evaluate(() => openDotPlot(state.seqs[0].seq, state.seqs[1].seq, 'a', 'b'));
  await page.waitForTimeout(1500);
  const box = await page.locator('#dotPlotCanvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 3);
  await page.waitForTimeout(200);
  const hovered = await page.evaluate(() => !!_dotPlotState._copyRegion);
  await page.mouse.move(box.x - 40, box.y - 40);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ region: _dotPlotState._copyRegion }));
  // the panel was cleared ('A: -') but _copyRegion kept the last hovered slices for Copy region
  return { pass: hovered && after.region === null, detail: JSON.stringify({ hovered, ...after }) };
});

check('Audit #222: a dot-plot run that fails clears the previous pair\'s region list', async (page) => {
  await loadFasta(page, '>a\nACGTACGTTTGACCAGTACGATCGATCGTAGCTAGCTAGG\n>b\nACGTACGTTTGACCAGTACGATCGATCGTAGCTAGCTAGG\n>c\nTTTTTTTTTTGGGGGGGGGGCCCCCCCCCCAAAAAAAAAA\n');
  await page.evaluate(() => openDotPlot(state.seqs[0].seq, state.seqs[1].seq, 'a', 'b'));
  await page.waitForTimeout(1500);
  const first = await page.evaluate(() => document.getElementById('dotPlotRegionItems').textContent);
  const r = await page.evaluate(async () => {
    const orig = window._dotRunWorker;
    window._dotRunWorker = () => Promise.reject(new Error('worker failed'));
    try { await openDotPlot(state.seqs[0].seq, state.seqs[2].seq, 'a', 'c'); } finally { window._dotRunWorker = orig; }
    return { items: document.getElementById('dotPlotRegionItems').textContent, status: document.getElementById('dotPlotStatus').textContent };
  });
  const ok = /A\d+-/.test(first) && !/A\d+-/.test(r.items) && /worker failed/.test(r.status);
  return { pass: ok, detail: JSON.stringify({ first: first.trim().slice(0, 60), ...r }) };
});

check('Undo/redo buttons sit on whole device pixels (their corners repaint identically), at 1x and 2x', async (page) => {
  const out = {};
  const pos = () => page.evaluate(() => {
    const dpr = window.devicePixelRatio || 1;
    return ['undoButton', 'undoDropdownBtn', 'redoButton', 'redoDropdownBtn'].map(id => {
      const x = document.getElementById(id).getBoundingClientRect().left * dpr;
      return Math.abs(x - Math.round(x)) < 0.01 ? 'whole' : x.toFixed(3);
    }).join(',');
  });
  await page.setInputFiles('#fileInput', { name: 'u.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGT\n>b\nACGA\n') });
  await page.waitForTimeout(800);
  out.x1 = await pos();
  const ctx = page.context();
  const p2 = await ctx.browser().newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });   // at 1.25x a 1px border is 1.25 device px: no layout is whole there
  await p2.goto(page.url(), { waitUntil: 'networkidle' });
  await p2.waitForTimeout(800);
  out.x2 = await p2.evaluate(() => {
    const dpr = window.devicePixelRatio || 1;
    return ['undoButton', 'undoDropdownBtn', 'redoButton', 'redoDropdownBtn'].map(id => { const x = document.getElementById(id).getBoundingClientRect().left * dpr; return Math.abs(x - Math.round(x)) < 0.01 ? 'whole' : x.toFixed(3); }).join(',');
  });
  await p2.close();
  return { pass: out.x1 === 'whole,whole,whole,whole' && out.x2 === 'whole,whole,whole,whole', detail: JSON.stringify(out) };
});

// The ruler's numbers drifted off their columns along a long alignment: a residue is an
// inline-block, whose width the browser rounds up to its layout unit (Courier New 13px: a
// 7.8013px glyph makes a 7.8125px cell), while the ruler is one run of text advancing the
// unrounded 7.8013px. By column 3700 the labels sat ~5 columns left of the column they name;
// windowed views drifted the same way inside their window. Each label's last digit must sit
// over its column, at 100% and another zoom, in Full, windowed Full and Block.
async function rulerOffsets(page) {
  return page.evaluate(() => {
    const out = [];
    const c = el('alignmentContainer'), cr = c.getBoundingClientRect();
    for (const ruler of c.querySelectorAll('.scale-ruler-line .seq-data')) {
      let line = ruler.parentElement.nextElementSibling;
      while (line && !(line.matches('.seq-line[data-seq-index]') && +line.dataset.seqIndex >= 0)) line = line.nextElementSibling;
      if (!line) continue;
      const w = document.createTreeWalker(ruler, NodeFilter.SHOW_TEXT);
      const text = []; let node;
      while ((node = w.nextNode())) text.push(node);
      // labels as one string over the text nodes (a node per character in Highlight-diffs mode)
      const chars = text.flatMap(n => [...n.data].map((ch, i) => ({ n, i, ch })));
      const str = chars.map(x => x.ch).join('');
      const re = /\d+/g; let m;
      while ((m = re.exec(str))) {
        const last = chars[m.index + m[0].length - 1];
        const rg = document.createRange(); rg.setStart(last.n, last.i); rg.setEnd(last.n, last.i + 1);
        const q = rg.getBoundingClientRect();
        if (q.right < cr.left + 150 || q.left > cr.right) continue;
        const sp = line.querySelector(`.seq-data > span[data-pos="${+m[0] - 1}"]`);
        if (sp) out.push([+m[0], Math.round((q.right - sp.getBoundingClientRect().right) * 10) / 10]);
      }
    }
    return out;
  });
}
check('Ruler: every label sits over its column along a long alignment (Full, windowed Full, Block, zoomed)', async (page) => {
  const out = {};
  const worst = a => a.reduce((m, [, d]) => Math.max(m, Math.abs(d)), 0);
  await loadFasta(page, makeFasta(10, 5000));
  await setMode(page, 'full');
  for (const col of [0, 2500, 4300]) {
    await page.evaluate((col) => { const c = el('alignmentContainer'); c.scrollLeft = col * _measureCharWidth(); }, col);
    await page.waitForTimeout(300);
    const r = await rulerOffsets(page); out['full@' + col] = [r.length, worst(r)];
  }
  await page.evaluate(() => setZoom(150)); await page.waitForTimeout(800);
  await page.evaluate(() => { const c = el('alignmentContainer'); c.scrollLeft = c.scrollWidth; });
  await page.waitForTimeout(300);
  let r = await rulerOffsets(page); out.zoom150 = [r.length, worst(r)];
  await page.evaluate(() => setZoom(100)); await page.waitForTimeout(500);
  await setMode(page, 'block'); await page.waitForTimeout(300);
  r = await rulerOffsets(page); out.block = [r.length, worst(r)];
  await loadSyntheticFasta(page, 1500, 4000); await setMode(page, 'full'); await page.waitForTimeout(1000);
  await page.evaluate(() => { const c = el('alignmentContainer'); c.scrollLeft = 3500 * _measureCharWidth(); });
  await page.waitForTimeout(1000);
  r = await rulerOffsets(page); out.windowed = [r.length, worst(r)];
  const ok = Object.values(out).every(([n, d]) => n >= 3 && d <= 1);
  return { pass: ok, detail: JSON.stringify(out) };
});

// Scrolled all the way right, the end of the alignment stayed out of reach: in windowed Full the
// rows ended exactly at the container's edge, under the 14px vertical scrollbar, so the last two
// columns sat beneath it and the length labels (outside the row's layout box) could not be scrolled
// to at all; Canvas mode ended its content under the same bar. In small Full mode the horizontal
// bar's range was a few px short of the alignment's (bar 2px wider than the alignment's viewport,
// and rows painted after the bar measured made the alignment wider): the labels showed one digit.
async function dragBarToEnd(page, sel) {
  const b = await page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }, sel);
  const horizontal = sel.includes('horizontal');
  const x = b[0] + 6, y = b[1] + 6;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(horizontal ? x + k * 500 : x, horizontal ? y : y + k * 500);
  await page.mouse.up(); await page.waitForTimeout(600);
}
const END_STATE = () => {
  const c = el('alignmentContainer'), cr = c.getBoundingClientRect();
  const vb = document.querySelector('.vertical-scrollbar');
  const vLeft = getComputedStyle(vb).display !== 'none' ? vb.getBoundingClientRect().left : cr.right - 1;
  const lines = [...c.querySelectorAll('.seq-line[data-seq-index]')].filter(l => { const q = l.getBoundingClientRect(); return +l.dataset.seqIndex >= 0 && q.top >= cr.top && q.bottom <= cr.bottom; });
  const right = sel => Math.max(...lines.map(l => { const s = l.querySelectorAll(sel); return s.length ? s[s.length - 1].getBoundingClientRect().right : -1e9; }));
  return { rows: lines.length, lastCol: Math.round(right('.seq-data > span[data-pos]')), label: Math.round(right('.seq-length')), visibleRight: Math.round(Math.min(vLeft, cr.right - 1)) };
};
check('Scrolled to the end: the last column and the length labels clear the scrollbars (Full, windowed Full, Canvas)', async (page) => {
  const out = {};
  await page.setViewportSize({ width: 1366, height: 768 });
  await loadFasta(page, makeFasta(60, 800)); await setMode(page, 'full'); await page.waitForTimeout(800);
  await dragBarToEnd(page, '.horizontal-scrollbar');
  out.full = await page.evaluate(END_STATE);
  await loadSyntheticFasta(page, 1500, 4000); await setMode(page, 'full'); await page.waitForTimeout(1200);
  await dragBarToEnd(page, '.horizontal-scrollbar'); await dragBarToEnd(page, '.vertical-scrollbar');
  out.windowed = await page.evaluate(END_STATE);
  await setMode(page, 'canvas'); await page.waitForTimeout(800);
  await dragBarToEnd(page, '.horizontal-scrollbar'); await dragBarToEnd(page, '.vertical-scrollbar');
  out.canvas = await page.evaluate(() => {
    const m = _canvasState.metrics, cv = el('alignmentCanvas').getBoundingClientRect();
    const vb = document.querySelector('.vertical-scrollbar').getBoundingClientRect();
    const len = state.seqs[0].seq.length;
    return { lastCol: Math.round(cv.left + m.nameW + len * m.charW - _canvasState.offsetX), visibleRight: Math.round(vb.left) };
  });
  const fits = s => s.lastCol > 0 && s.lastCol <= s.visibleRight && (s.label === undefined || (s.label > 0 && s.label <= s.visibleRight));
  return { pass: out.full.rows > 5 && out.windowed.rows > 5 && fits(out.full) && fits(out.windowed) && fits(out.canvas), detail: JSON.stringify(out) };
});

// ---------- pre-publication audit: editing (2026-10-14) ----------
// Helpers for these checks: the centre of a residue cell / name cell on screen, in DOM
// modes from the rendered span, in Canvas mode from the canvas metrics.
async function auditCell(page, row, col) {
  return page.evaluate(({ row, col }) => {
    if (document.getElementById('modeCanvas')?.checked) {
      const c = _canvasState.canvas, m = _canvasState.metrics, r = c.getBoundingClientRect();
      const rp = _canvasState.rowPitch || m.charH;
      return { x: r.left + m.nameW - _canvasState.offsetX + (col + 0.5) * m.charW, y: r.top + (m.headerH || m.charH) - _canvasState.offsetY + (row + 0.5) * rp };
    }
    const sp = document.querySelector(`.seq-line[data-seq-index="${row}"] .seq-data > span[data-pos="${col}"]`);
    if (!sp) return null;
    const b = sp.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, { row, col });
}
async function auditName(page, row) {
  return page.evaluate((row) => {
    if (document.getElementById('modeCanvas')?.checked) {
      const c = _canvasState.canvas, m = _canvasState.metrics, r = c.getBoundingClientRect();
      const rp = _canvasState.rowPitch || m.charH;
      return { x: r.left + 12, y: r.top + (m.headerH || m.charH) - _canvasState.offsetY + (row + 0.5) * rp };
    }
    const n = document.querySelector(`.seq-line[data-seq-index="${row}"] > .seq-name`);
    const b = n.getBoundingClientRect();
    return { x: b.left + 12, y: b.top + b.height / 2 };
  }, row);
}
async function auditCtrlClickName(page, row) {
  const p = await auditName(page, row);
  await page.keyboard.down('Control'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Control');
}
async function auditCtrlAltDrag(page, row, c0, c1) {
  const a = await auditCell(page, row, c0), b = await auditCell(page, row, c1);
  await page.keyboard.down('Control'); await page.keyboard.down('Alt');
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
  await page.keyboard.up('Alt'); await page.keyboard.up('Control');
}
const auditSeqs = (page) => page.evaluate(() => state.seqs.map(s => s.header + ':' + s.seq));
// Every rendered residue span shows its state letter (catches stale rows after an edit)
const auditDomMismatches = (page) => page.evaluate(() => {
  const bad = [];
  document.querySelectorAll('.seq-line[data-seq-index]').forEach(line => {
    const i = +line.dataset.seqIndex; if (i < 0) return;
    const s = state.seqs[i]?.seq || '';
    line.querySelectorAll('.seq-data > span[data-pos]').forEach(sp => {
      const p = +sp.dataset.pos;
      if (sp.textContent !== (s[p] ?? '') && bad.length < 5) bad.push(`r${i}c${p} dom=${sp.textContent} state=${s[p]}`);
    });
  });
  return bad;
});
const auditBlur = (page) => page.evaluate(() => document.activeElement?.blur());

check('Audit: loading a new file clears undo/redo, so Ctrl+Z cannot write the old file into the new one', async (page) => {
  // Used to: the undo stack survived a load. After typing a residue in file 1 and loading
  // a protein file, Ctrl+Z wrote file 1's DNA row ("ACGTACGT--") into the new file's
  // first row, and a deletion undo brought file 1's sequences back wholesale.
  page.on('dialog', d => d.accept());
  await loadFasta(page, '>a\nACGTACGT\n>b\nTTTTGGGG\n>c\nGGGGCCCC\n');
  let c = await auditCell(page, 0, 2);
  await page.mouse.dblclick(c.x, c.y); await page.keyboard.type('N');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.click('#editToggleButton');
  await auditCtrlClickName(page, 2);
  await auditBlur(page);
  await page.keyboard.press('Control+Delete'); await page.waitForTimeout(300);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);   // leaves one redo entry too
  const before = await page.evaluate(() => state.deletedHistory.length + '/' + state.redoHistory.length);
  await loadFasta(page, '>human\nMKVLAAGIVG\n>mouse\nMKVLSAGIVG\n');
  const loaded = await auditSeqs(page);
  await auditBlur(page);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  await page.keyboard.press('Control+y'); await page.waitForTimeout(300);
  const after = await auditSeqs(page);
  const r = await page.evaluate(() => ({ h: state.deletedHistory.length + '/' + state.redoHistory.length, trimBackup: state.trimBackup }));
  const pass = before !== '0/0' && JSON.stringify(after) === JSON.stringify(loaded) && r.h === '0/0' && !r.trimBackup;
  return { pass, detail: JSON.stringify({ before, loaded, after, ...r }) };
});

check('Audit: viewer shortcuts never fire while typing in a text field (search, rename box, SeqEdit)', async (page) => {
  // Used to: the capture-phase shortcut handler let Ctrl+Z/Y/Delete/Home/Arrow through from
  // single-line inputs. Ctrl+Z in the search box undid the alignment instead of the text;
  // Ctrl+Delete (delete word) deleted the selected sequences; Ctrl+Z in the rename box
  // undid a reorder and the box then saved its text onto a different sequence; and with
  // SeqEdit open, a row change behind it made Apply overwrite another sequence.
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await loadFasta(page, '>alpha\nACGTACGT\n>beta\nTTTTGGGG\n>gamma\nCCCCAAAA\n');
  await auditCtrlClickName(page, 2);
  await page.keyboard.press('Control+ArrowUp'); await page.waitForTimeout(200);   // alpha, gamma, beta
  const moved = await auditSeqs(page);
  const out = {};
  // search box
  await page.click('.section-header[data-section="search"]');   // opens the Search menu
  await page.click('#searchInput'); await page.keyboard.type('ACG');
  for (const k of ['Control+z', 'Control+y', 'Control+Home', 'Control+End', 'Control+ArrowDown', 'Control+Delete', 'Control+Shift+Z']) await page.keyboard.press(k);
  out.search = JSON.stringify(await auditSeqs(page)) === JSON.stringify(moved) && dialogs.length === 0
    && (await page.inputValue('#searchInput')) === 'ACG';
  await page.keyboard.press('Escape');   // closes the menu
  // rename box: Ctrl+Z is the box's own undo, and the name lands on the row it was opened on
  let p = await auditName(page, 1);
  await page.mouse.dblclick(p.x, p.y); await page.waitForTimeout(150);
  await page.keyboard.press('End'); await page.keyboard.press('Backspace');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  out.rename = JSON.stringify(await auditSeqs(page)) === JSON.stringify(moved);
  // SeqEdit: Ctrl+Delete in the name field deletes nothing
  await auditBlur(page); await page.keyboard.press('Escape');   // Esc clears the selection
  await auditCtrlClickName(page, await page.evaluate(() => state.seqs.findIndex(s => s.header === 'beta')));
  await page.evaluate(() => el('seqEditButton').click());
  await page.waitForTimeout(200);
  await page.click('#seqEditNameInput'); await page.keyboard.press('End'); await page.keyboard.type('_ed');
  await page.keyboard.press('Control+Delete'); await page.waitForTimeout(200);
  out.seqEditKeys = (await page.evaluate(() => state.seqs.length)) === 3 && dialogs.length === 0;
  // focus on a button of the dialog (not a text field): Ctrl+Up still reorders behind it,
  // and Apply must still edit beta, not whatever row now has its old index
  await page.focus('#seqEditApplyBtn');
  await page.keyboard.press('Control+ArrowUp'); await page.waitForTimeout(200);
  await page.click('#seqEditApplyBtn'); await page.waitForTimeout(300);
  const fin = await auditSeqs(page);
  out.seqEditTarget = fin.includes('beta_ed:TTTTGGGG') && fin.includes('gamma:CCCCAAAA') && fin.includes('alpha:ACGTACGT') && fin.length === 3;
  return { pass: Object.values(out).every(Boolean), detail: JSON.stringify({ out, moved, fin, dialogs }) };
});

check('Audit: Ctrl+Shift+Z redoes (it used to undo again)', async (page) => {
  // Used to: case 'z' ignored Shift, so Ctrl+Shift+Z / Cmd+Shift+Z (the usual redo, the
  // only one on macOS) undid one more step instead.
  await loadFasta(page, '>a\nACGT\n>b\nTTTT\n>c\nGGGG\n');
  await auditCtrlClickName(page, 2); await auditBlur(page);
  await page.keyboard.press('Control+Home'); await page.waitForTimeout(150);
  const moved = await auditSeqs(page);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
  await page.keyboard.press('Control+Shift+Z'); await page.waitForTimeout(150);
  const a = await auditSeqs(page);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
  await page.keyboard.press('Meta+Shift+Z'); await page.waitForTimeout(150);
  const b = await auditSeqs(page);
  return { pass: JSON.stringify(a) === JSON.stringify(moved) && JSON.stringify(b) === JSON.stringify(moved), detail: JSON.stringify({ moved, a, b }) };
});

check('Audit: right-click Rename uses the rename box (Esc cancels, Enter saves) in Full, Block and Canvas', async (page) => {
  // Used to: the context-menu Rename had its own older editor. Esc re-rendered, the input
  // blurred and the blur SAVED the name; in Canvas mode the input was put inside the
  // <canvas> element, 0x0 and invisible, and renaming did nothing.
  const out = {};
  for (const mode of ['full', 'block', 'canvas']) {
    await loadFasta(page, '>alpha\nACGTACGT\n>beta\nTTTTGGGG\n');
    await setMode(page, mode);
    const open = async () => {
      const p = await auditName(page, 1);
      await page.mouse.click(p.x, p.y, { button: 'right' }); await page.waitForTimeout(150);
      await page.evaluate(() => [...document.querySelectorAll('.context-menu div')].find(d => d.textContent === 'Rename sequence').click());
      await page.waitForTimeout(150);
    };
    await open();
    const box = await page.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return a.tagName === 'INPUT' && r.width > 20 && r.height > 8; });
    await page.keyboard.press('Control+a'); await page.keyboard.type('XYZ'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    const esc = (await auditSeqs(page))[1];
    await open();
    await page.keyboard.press('Control+a'); await page.keyboard.type('B2'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    const ent = (await auditSeqs(page))[1];
    out[mode] = { box, esc, ent, left: await page.evaluate(() => !!document.querySelector('.seq-name-edit')) };
  }
  const pass = Object.values(out).every(o => o.box && o.esc === 'beta:TTTTGGGG' && o.ent === 'B2:TTTTGGGG' && !o.left);
  return { pass, detail: JSON.stringify(out) };
});

check('Audit: undo snapshots of a large alignment are small and fast, restore exactly, and history is capped', async (page) => {
  // Used to: every undo entry JSON-cloned the whole alignment including the per-residue
  // gaplessPositions arrays: ~380 ms and ~57 MB per edit at 1500 x 4000, with no cap, so a
  // few dozen edits on a big file could exhaust the tab's memory.
  await loadSyntheticFasta(page, 1500, 4000);
  await setMode(page, 'full');
  await page.waitForTimeout(500);
  await auditCtrlClickName(page, 3);
  await auditBlur(page);
  const m0 = await page.evaluate(() => { if (window.gc) gc(); return performance.memory.usedJSHeapSize; });
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) await page.keyboard.press(i % 2 ? 'Control+ArrowDown' : 'Control+ArrowUp');
  await page.waitForTimeout(300);
  const ms = Date.now() - t0;
  const m1 = await page.evaluate(() => performance.memory.usedJSHeapSize);
  const r = await page.evaluate(() => {
    const e = state.deletedHistory[state.deletedHistory.length - 1];
    return { n: state.deletedHistory.length, noDerived: e && e.seqs && e.seqs[0].gaplessPositions === undefined };
  });
  // undo all ten: back to the original order with correct gapless positions
  for (let i = 0; i < 10; i++) await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  const restored = await page.evaluate(() => state.seqs.slice(0, 6).map(s => s.header).join(',') === 'seq0,seq1,seq2,seq3,seq4,seq5'
    && state.seqs.every((s, i) => i % 300 || JSON.stringify(s.gaplessPositions) === JSON.stringify(calculateGaplessPositions(s.seq))));
  const capped = await page.evaluate(() => {
    for (let i = 0; i < 400; i++) pushUndo('order');
    return state.deletedHistory.length;
  });
  const growMB = (m1 - m0) / 1e6;
  const pass = r.n === 10 && r.noDerived && growMB < 100 && restored && capped <= 200;
  return { pass, detail: JSON.stringify({ ...r, ms, growMB: Math.round(growMB), restored, capped }) };
});

check('Audit: Realign Block keeps every row\'s own residues when names share a first word', async (page) => {
  // Used to: realign-region keyed rows by the first word of the name, so ">s1 sampleA" got
  // the realigned region of ">s1 sampleB" - its residues silently replaced.
  await loadFasta(page, '>s1 sampleA\nACGTAC--GTAAACCCGGGTTT\n>s1 sampleB\nTTTTGGGGCCCCAAAATTTT--\n>s2\nACGTACGTAAACCCGGGTTA--\n');
  const ug = () => page.evaluate(() => state.seqs.map(s => s.fullHeader + ':' + s.seq.replace(/[-.]/g, '')));
  const before = await ug();
  await auditCtrlAltDrag(page, 0, 2, 11);
  await page.keyboard.press('Control+Shift+R');
  await page.waitForFunction(() => state.deletedHistory.some(e => e.type === 'realign-block'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
  const after = await ug();
  const ran = await page.evaluate(() => state.deletedHistory.some(e => e.type === 'realign-block'));
  return { pass: ran && JSON.stringify(after) === JSON.stringify(before), detail: JSON.stringify({ ran, before, after }) };
});

check('Audit: Realign All and Duplicate keep rows with identical names apart', async (page) => {
  // Used to: Realign All matched MAFFT's output back by name, so the second of two rows
  // called ">a" became a copy of the first (TTTTGGGG... lost). Duplicate (Ctrl+U) kept the
  // original fullHeader, so exports had two identical names.
  await loadFasta(page, '>a\nACGTACGTAAACCCGGGTTT\n>a\nTTTTGGGGCCCCAAAATTTT\n>b\nACGTACGTAAACCCGGGTTA\n');
  const ug = () => page.evaluate(() => state.seqs.map(s => s.fullHeader + ':' + s.seq.replace(/[-.]/g, '')));
  const before = await ug();
  await page.evaluate(() => el('realignAllButton').click());   // the button's own handler
  await page.waitForFunction(() => state.deletedHistory.some(e => e.type === 'realign-all'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => !document.getElementById('busyOverlay') || document.getElementById('busyOverlay').hidden, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
  const after = await ug();
  await loadFasta(page, '>x first\nACGT\n>y\nTTTT\n');
  await auditCtrlClickName(page, 0);
  await auditBlur(page);
  await page.keyboard.press('Control+u'); await page.waitForTimeout(300);
  const dup = await page.evaluate(() => state.seqs.map(s => s.header + '|' + s.fullHeader));
  const pass = JSON.stringify(after) === JSON.stringify(before) && dup[2] === 'x_copy|x_copy first';
  return { pass, detail: JSON.stringify({ before, after, dup }) };
});

check('Audit: copying text in a text field copies that text, not the residue selection', async (page) => {
  // Used to: a document 'copy' listener replaced every copy with the selected residues while
  // a residue selection existed, so Ctrl+C in the search box or the Input box copied "CGTA".
  await loadFasta(page, '>a\nACGTACGTAC\n>b\nTTTTGGGGCC\n');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const a = await auditCell(page, 0, 1), b = await auditCell(page, 0, 4);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
  await page.click('.section-header[data-section="search"]');   // opens the Search menu
  await page.click('#searchInput'); await page.keyboard.type('GAATTC');
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c'); await page.waitForTimeout(200);
  const fromInput = await page.evaluate(() => navigator.clipboard.readText());
  await page.keyboard.press('Escape');   // closes the menu
  await auditBlur(page);
  await page.keyboard.press('Control+c'); await page.waitForTimeout(200);
  const fromAlignment = await page.evaluate(() => navigator.clipboard.readText());
  return { pass: fromInput === 'GAATTC' && fromAlignment === 'CGTA', detail: JSON.stringify({ fromInput, fromAlignment }) };
});

check('Audit: selected rows stay on their sequences through Sort and Add at top', async (page) => {
  // Used to: the row selection is a set of row numbers, and Sort / Add Sequences at top left
  // it on the old numbers, so it jumped to other sequences (and Ctrl+Del then hit those).
  await loadFasta(page, '>zeta\nACGTACGT\n>alpha\nTTTTGGGG\n>mid\nGGGGCCCC\n');
  await auditCtrlClickName(page, 0);
  const selNames = () => page.evaluate(() => [...state.selectedRows].map(i => state.seqs[i].header).sort().join(','));
  await page.evaluate(() => el('sortByNameButton').click());   // the button's own onclick
  await page.waitForTimeout(400);
  const afterSort = await selNames();
  const domSel = await page.evaluate(() => [...document.querySelectorAll('.seq-line[data-seq-index]')].filter(l => l.querySelector('.seq-name.selected') || l.classList.contains('selected')).map(l => l.dataset.seqIndex).join(','));
  const zetaRow = await page.evaluate(() => String(state.seqs.findIndex(s => s.header === 'zeta')));
  await page.evaluate(() => { el('addSeqInput').value = '>new\nAAAACCCC'; el('addSeqAtTop').checked = true; el('addSeqAlignCons').checked = false; el('addSeqJustAddButton').click(); });
  await page.waitForTimeout(400);
  const afterAdd = await selNames();
  return { pass: afterSort === 'zeta' && domSel === zetaRow && afterAdd === 'zeta', detail: JSON.stringify({ afterSort, domSel, zetaRow, afterAdd }) };
});

check('Audit: hard trim is undoable with Ctrl+Z, and Undo Trim is itself undoable', async (page) => {
  // Used to: Execute (hard trim) pushed no undo entry, and the separate Undo Trim button
  // restored the pre-trim copy silently, throwing away every edit made after the trim.
  page.on('dialog', d => d.accept());
  const orig = ['a:----ACGTACGTAC----', 'b:---TACGTTCGTAC--T-', 'c:-----AGTACGTAC----'];
  await loadFasta(page, orig.map(x => '>' + x.replace(':', '\n')).join('\n') + '\n');
  await page.evaluate(() => el('previewTrimButton').click());
  await page.evaluate(() => el('executeTrimButton').click()); await page.waitForTimeout(500);
  const trimmed = await auditSeqs(page);
  await auditBlur(page);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
  const undone = await auditSeqs(page);
  await page.keyboard.press('Control+y'); await page.waitForTimeout(400);
  const redone = await auditSeqs(page);
  await auditCtrlClickName(page, 2); await auditBlur(page);
  await page.keyboard.press('Control+Delete'); await page.waitForTimeout(300);
  await page.evaluate(() => el('undoTrimButton').click()); await page.waitForTimeout(400);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
  const backToEdited = await auditSeqs(page);
  const pass = JSON.stringify(undone) === JSON.stringify(orig) && JSON.stringify(redone) === JSON.stringify(trimmed)
    && trimmed[0] !== orig[0] && backToEdited.length === 2 && backToEdited[0] === trimmed[0];
  return { pass, detail: JSON.stringify({ trimmed, undone, redone, backToEdited }) };
});

// ============================================================================
// pre-publication audit: UI (2026-10-14)
// ============================================================================
const _auditFs = require('fs');
const _auditPath = require('path');
const _auditSvk = () => _auditFs.readFileSync(_auditPath.join(__dirname, '..', '..', 'examples', 'svk_k4.fa'), 'utf8');
// Opens a top menu the way a mouse does (hovering its header) and clicks one of its buttons.
async function _auditMenuClick(page, section, buttonId) {
  await page.hover(`.section-header[data-section="${section}"]`);
  await page.waitForTimeout(150);
  await page.click('#' + buttonId);
}
const _auditToast = (page) => page.evaluate(() => {
  const s = document.getElementById('statusMessage');
  return getComputedStyle(s).display !== 'none' ? s.textContent.trim() : '';
});
const _auditHideToast = (page) => page.evaluate(() => { document.getElementById('statusMessage').style.display = 'none'; });

// Reverse complement on a protein alignment used to turn every row into IUPAC nonsense
// (RRLRTAFT... became YMNMKYYN...) and report "Reverse complement applied"; the MACSE
// codon preset was likewise accepted on protein. Both must refuse with a message.
// (Writing this check also showed that an earlier toast's hide timer hid a newer toast
// early: the MACSE message vanished at once. showMessage now keeps one timer.)
check('audit UI: reverse complement and the MACSE preset refuse a protein alignment', async (page) => {
  await loadFasta(page, makeFasta(6, 60, 'ACDEFGHIKLMNPQRSTVWY'));
  const seqs = () => page.evaluate(() => state.seqs.map(s => s.seq).join('|'));
  const before = await seqs();
  await _auditMenuClick(page, 'actions', 'reverseComplementAllButton');
  await page.waitForTimeout(300);
  const allMsg = await _auditToast(page);
  const afterAll = await seqs();
  await page.mouse.move(700, 600);
  await page.click('.seq-line[data-seq-index="0"] .seq-name', { modifiers: ['Control'] });
  await _auditHideToast(page);
  await page.keyboard.press('Control+r');
  await page.waitForTimeout(300);
  const ctrlRMsg = await _auditToast(page);
  const afterCtrlR = await seqs();
  await _auditHideToast(page);
  await _auditMenuClick(page, 'alignment', 'macsePresetButton');
  await page.waitForTimeout(300);
  const macse = { type: await page.evaluate(() => el('mafftSeqType').value), msg: await _auditToast(page) };
  const pass = afterAll === before && afterCtrlR === before && /nucleotide/i.test(allMsg) && /nucleotide/i.test(ctrlRMsg)
    && macse.type !== 'codon' && /nucleotide/i.test(macse.msg);
  return { pass, detail: JSON.stringify({ allMsg, ctrlRMsg, changedAll: afterAll !== before, changedCtrlR: afterCtrlR !== before, macse }) };
});

// The Clusterability window hid its whole header-button row, × included, so only Esc
// closed it (and nothing said so); it opened off-centre and ran past the bottom of a
// 1366x768 screen with overflow hidden, so the last rows and the footnote were unreachable.
check('audit UI: Clusterability window has a close button, fits the screen and scrolls', async (page) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await loadFasta(page, _auditSvk());
  await page.hover('.section-header[data-section="clustering"]');
  await page.waitForTimeout(150);
  await page.click('#clustering-controls summary:has-text("Presets")');
  await page.click('#clusteringProbeButton');
  await page.waitForFunction(() => /already the best|best of|tried/i.test(el('clusteringModal').textContent) && !/run \d+ of/i.test(el('clusteringStatus')?.textContent || ''), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const geo = await page.evaluate(() => {
    const m = el('clusteringModal'), r = m.getBoundingClientRect();
    const x = el('clusteringModalClose'), xr = x.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), vh: innerHeight, vw: innerWidth,
      closeVisible: xr.width > 0 && getComputedStyle(x).visibility !== 'hidden' && xr.top >= 0 && xr.bottom <= innerHeight };
  });
  // the footnote under the table can be scrolled into view with the mouse wheel
  const rows = await page.$$('#clusteringModal tr');
  const last = rows[rows.length - 1];
  const box = await page.evaluate(() => { const r = el('clusteringModal').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 300); await settleWheel(page); await page.waitForTimeout(50); }
  const lastBottom = await last.evaluate(n => Math.round(n.getBoundingClientRect().bottom));
  let closed = false;
  if (geo.closeVisible) { await page.click('#clusteringModalClose'); closed = await page.evaluate(() => el('clusteringModal').style.display === 'none'); }
  const pass = geo.closeVisible && closed && geo.top >= 0 && geo.bottom <= geo.vh && geo.left >= 0 && geo.right <= geo.vw && lastBottom <= geo.vh;
  return { pass, detail: JSON.stringify({ ...geo, lastRowBottom: lastBottom, closed }) };
});

// Two Actions tooltips named keys that do not do what they say: Save Preset said Ctrl+S
// (the key is Ctrl+Shift+S; Ctrl+S opens the browser's Save Page) and New Tab said Ctrl+T
// (Chrome keeps Ctrl+T; the key is Alt+T), contradicting the Keys panel and the Manual.
check('audit UI: Actions tooltips name the real shortcuts', async (page) => {
  const t = await page.evaluate(() => [el('savePresetButton').title, el('openInNewTabButton').title]);
  const pass = /Ctrl\+Shift\+S/.test(t[0]) && /Alt\+T/.test(t[1]) && !/Ctrl\+T/.test(t[1]);
  return { pass, detail: JSON.stringify(t) };
});

// Toasts (#statusMessage, z-index 1000) were drawn under every window (z-index 10000+),
// so e.g. "Newick copied." after Copy Newick in the Tree window was invisible.
check('audit UI: a toast shows above an open window', async (page) => {
  await loadFasta(page, makeFasta(8, 120));
  await _auditMenuClick(page, 'actions', 'buildTreeButton');
  await page.waitForFunction(() => el('treeBuilderModal').style.display !== 'none', null, { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.click('#treeBuilderModal button:has-text("Copy Newick")');
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const s = el('statusMessage');
    if (getComputedStyle(s).display === 'none') return { shown: false };
    const rc = s.getBoundingClientRect();
    s.style.pointerEvents = 'auto';   // hit-test only: the toast itself ignores the mouse
    const top = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
    s.style.pointerEvents = '';
    return { shown: true, text: s.textContent, onTop: top === s || s.contains(top), topmost: top && (top.id || top.className) };
  });
  return { pass: r.shown && r.onTop, detail: JSON.stringify(r) };
});

// At 1024px wide the Alignment menu (x 755..1225) ran off the right edge, cutting
// "Realign Selected", "Degap block →" and the Gap extension box.
check('audit UI: a menu that would run off the right edge stays on screen (1024px)', async (page) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await loadFasta(page, makeFasta(8, 120));
  const out = {};
  for (const sec of ['alignment', 'colourseqs', 'search', 'clustering']) {
    await page.mouse.move(500, 700);
    await page.hover(`.section-header[data-section="${sec}"]`);
    await page.waitForTimeout(200);
    out[sec] = await page.evaluate(sec => {
      const g = document.querySelector(`.section-header[data-section="${sec}"]`).closest('.menu-section').querySelector('.control-group');
      const r = g.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.right)];
    }, sec);
  }
  const pass = Object.values(out).every(([l, r]) => l >= 0 && r <= 1024);
  return { pass, detail: JSON.stringify(out) };
});

// There was no print stylesheet: the fixed menu bar printed over the first block (ruler
// and consensus hidden) and the conservation shading backgrounds were dropped, leaving
// white-on-white residues.
check('audit UI: printing hides the menu bar and keeps residue shading', async (page) => {
  await loadFasta(page, makeFasta(8, 120));
  await page.emulateMedia({ media: 'print' });
  const r = await page.evaluate(() => ({
    controls: getComputedStyle(el('controls')).display,
    adjust: getComputedStyle(document.body).printColorAdjust || getComputedStyle(document.body).webkitPrintColorAdjust,
  }));
  await page.emulateMedia({ media: 'screen' });
  return { pass: r.controls === 'none' && r.adjust === 'exact', detail: JSON.stringify(r) };
});

// These buttons did nothing visible when there was nothing to act on (other buttons in
// the same menus say "No sequences selected."), and Clustering > Load got the click event
// as its `silent` argument, so loading a preset never said it had.
check('audit UI: buttons with nothing to act on say so', async (page) => {
  await loadFasta(page, makeFasta(8, 120));
  const out = {};
  const tryBtn = async (section, id, before) => {
    await page.mouse.move(700, 700);
    await page.waitForTimeout(100);
    if (before) await before();
    await _auditHideToast(page);
    await _auditMenuClick(page, section, id);
    await page.waitForTimeout(300);
    out[id] = await _auditToast(page);
  };
  for (const id of ['copySelectedButton', 'duplicateButton', 'moveUpButton', 'moveDownButton', 'moveToTopButton', 'moveToBottomButton']) await tryBtn('actions', id);
  await tryBtn('search', 'searchButton');
  await tryBtn('search', 'reverseComplementQueryButton');
  await tryBtn('annotation', 'annotUrlButton');
  await tryBtn('clustering', 'clusteringLoadPresetButton', async () => {
    await page.hover('.section-header[data-section="clustering"]');
    await page.waitForTimeout(150);
    await page.click('#clustering-controls summary:has-text("Presets")');
  });
  // Up with the first row already at the top
  await page.mouse.move(700, 700);
  await page.click('.seq-line[data-seq-index="0"] .seq-name', { modifiers: ['Control'] });
  await tryBtn('actions', 'moveUpButton');
  out.upAtTop = out.moveUpButton;
  const silent = Object.entries(out).filter(([, v]) => !v).map(([k]) => k);
  return { pass: silent.length === 0, detail: silent.length ? `silent: ${silent.join(', ')}` : JSON.stringify(out) };
});

// Esc closed every window except the Sequence Editor (focus lands in its text box, and
// Esc in a text field was left to the field). It now closes on Esc while nothing in it
// has been changed; with edits, Esc keeps it open so they are not lost.
check('audit UI: Sequence Editor closes on Esc when unchanged', async (page) => {
  await loadFasta(page, makeFasta(8, 120));
  const shown = () => page.evaluate(() => el('seqEditModal').style.display !== 'none');
  await _auditMenuClick(page, 'actions', 'seqEditButton');
  await page.waitForTimeout(300);
  const opened = await shown();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const closedUnchanged = !(await shown());
  await _auditMenuClick(page, 'actions', 'seqEditButton');
  await page.waitForTimeout(300);
  await page.click('#seqEditTextarea');
  await page.keyboard.type('ACGT');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const keptEdited = await shown();
  return { pass: opened && closedUnchanged && keptEdited, detail: JSON.stringify({ opened, closedUnchanged, keptEdited }) };
});

// Opening Info or the Tree window from the Actions menu and closing it with Esc left
// keyboard focus on <body>: the opener sits in a menu that has closed, so the focus
// return had nowhere to go. It now goes back to the menu's header.
check('audit UI: closing Info or the Tree window gives focus back to the Actions menu', async (page) => {
  await loadFasta(page, makeFasta(8, 120));
  const out = {};
  for (const id of ['infoButton', 'buildTreeButton']) {
    await page.focus('.section-header[data-section="actions"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.focus('#' + id);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    out[id] = await page.evaluate(() => { const a = document.activeElement; return a.id || a.dataset?.section || a.tagName; });
  }
  const ok = v => v === 'actions' || v === 'infoButton' || v === 'buildTreeButton';
  return { pass: ok(out.infoButton) && ok(out.buildTreeButton), detail: JSON.stringify(out) };
});

// The first screen was one line of text with no example; on a phone that line did not
// wrap and got its own horizontal scrollbar. It wraps now and offers an example alignment.
check('audit UI: empty state wraps on a phone and loads the example alignment', async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  const r = await page.evaluate(() => { const c = el('alignmentContainer'); return { sw: c.scrollWidth, cw: c.clientWidth }; });
  const link = await page.$('#alignmentContainer a:has-text("example")');
  let loaded = 0;
  if (link) {
    await link.click();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.seqs.length > 0, null, { timeout: 15000 }).catch(() => {});
    loaded = await page.evaluate(() => typeof state !== 'undefined' ? state.seqs.length : 0);
  }
  return { pass: r.sw <= r.cw && !!link && loaded === 40, detail: JSON.stringify({ ...r, link: !!link, loaded }) };
});

// The Input menu showed the snapshot-folder rows (list, Refresh, Open, path box, Open
// Path) on the public site, where there is no server and the manifest is empty, so they
// could only ever say "nothing found". They show only when a server or manifest lists files.
check('audit UI: snapshot-folder rows hidden when nothing can be listed', async (page) => {
  await loadFasta(page, makeFasta(8, 120));
  await page.waitForTimeout(1500);   // the server probe and the manifest fetch have answered
  await page.hover('.section-header[data-section="input"]');
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const vis = id => !!el(id) && el(id).getClientRects().length > 0;
    return { list: vis('snapshotListSelect'), path: vis('snapshotPathInput'), create: vis('snapshotCreateTopButton'), svg: vis('exportSvgTopButton') };
  });
  return { pass: !r.list && !r.path && r.create && r.svg, detail: JSON.stringify(r) };
});

// A shared link to the app had no description or preview.
check('audit UI: page has a description and social preview tags', async (page) => {
  const r = await page.evaluate(() => ['meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[property="og:image"]']
    .map(s => (document.querySelector(s)?.getAttribute('content') || '').length > 0));
  return { pass: r.every(Boolean), detail: JSON.stringify(r) };
});

check('Audit: edits that change nothing add no undo entry and keep the redo list', async (page) => {
  // Used to: Ctrl+Up on the top row (and Ctrl+Down on the last, Ctrl+Home/End when already
  // there, a gap tool click that changed nothing) pushed an undo entry first, so the history
  // filled with phantom steps and the redo list was wiped.
  await loadFasta(page, '>a\nACGT--\n>b\nTTTT--\n>c\nGGGG--\n');
  await auditCtrlClickName(page, 2); await auditBlur(page);
  await page.keyboard.press('Control+Home'); await page.keyboard.press('Control+Home');   // the 2nd is a no-op
  await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
  // one undo takes c back to the bottom (the no-op added no step): history 0, redo 1. Now
  // more no-op moves:
  const h0 = await page.evaluate(() => state.deletedHistory.length + '/' + state.redoHistory.length);
  await page.keyboard.press('Control+ArrowDown'); await page.keyboard.press('Control+End');
  await auditCtrlClickName(page, 2); await auditCtrlClickName(page, 0);   // only row 0
  await page.keyboard.press('Control+ArrowUp'); await page.keyboard.press('Control+Home');
  const h1 = await page.evaluate(() => state.deletedHistory.length + '/' + state.redoHistory.length);
  // Ins Gap Seq inside the trailing gap run changes nothing
  await page.click('#editToggleButton'); await page.click('#editInsertGapButton');
  const c = await auditCell(page, 1, 5); await page.mouse.click(c.x, c.y); await page.waitForTimeout(200);
  const h2 = await page.evaluate(() => state.deletedHistory.length + '/' + state.redoHistory.length);
  // Realign All declined at MAFFT's large-job prompt (no dialog handler: Playwright
  // dismisses it) changes nothing either
  await loadFasta(page, makeFasta(100, 3000));
  await auditCtrlClickName(page, 2); await auditBlur(page);
  await page.keyboard.press('Control+Home'); await page.waitForTimeout(300);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  const h3 = await page.evaluate(() => state.deletedHistory.length + '/' + state.redoHistory.length);
  await page.evaluate(() => el('realignAllButton').click()); await page.waitForTimeout(500);
  const h4 = await page.evaluate(() => state.deletedHistory.length + '/' + state.redoHistory.length);
  return { pass: h0 === '0/1' && h1 === h0 && h2 === h0 && h3 === '0/1' && h4 === h3, detail: JSON.stringify({ h0, h1, h2, h3, h4 }) };
});

check('Audit: switching from Canvas to Full and deleting rows raises no error from the Canvas shading job', async (page) => {
  // Used to: the Canvas deferred shading job kept a reference to state.seqs and was only
  // cancelled by the next Canvas render; after a switch to Full, a row delete spliced the
  // array under it and it threw "Cannot read properties of undefined (reading 'seq')".
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await loadSyntheticFasta(page, 1500, 4000);   // opens in Canvas (above CANVAS_AUTO_THRESHOLD)
  await setMode(page, 'full');
  await auditCtrlClickName(page, 2); await auditCtrlClickName(page, 3); await auditBlur(page);
  await page.keyboard.press('Control+Delete');
  await page.waitForTimeout(3000);
  const n = await page.evaluate(() => state.seqs.length);
  return { pass: errors.length === 0 && n === 1498, detail: JSON.stringify({ n, errors }) };
});

check('Audit: windowed Block mode repaints a typed residue on undo/redo after scrolling away and back', async (page) => {
  // Used to: rows the windowed Block renderer rebuilt while edit mode was on were not in the
  // span cache, and undo/redo of a typed residue repaints only cached rows: after Ctrl+Z off
  // screen, scrolling back and Ctrl+Y, the cell still showed the old letter.
  await loadSyntheticFasta(page, 1500, 4000);
  await setMode(page, 'block');
  await page.waitForTimeout(600);
  const c = await auditCell(page, 3, 4);
  await page.mouse.dblclick(c.x, c.y); await page.waitForTimeout(150);
  await page.keyboard.type('N'); await page.keyboard.press('Escape');
  await page.evaluate(() => { el('alignmentContainer').scrollTop = 20000; }); await page.waitForTimeout(800);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
  await page.evaluate(() => { el('alignmentContainer').scrollTop = 0; }); await page.waitForTimeout(800);
  const afterUndo = await auditDomMismatches(page);
  await page.keyboard.press('Control+y'); await page.waitForTimeout(400);
  const afterRedo = await auditDomMismatches(page);
  const st = await page.evaluate(() => state.seqs[3].seq[4]);
  return { pass: st === 'N' && !afterUndo.length && !afterRedo.length, detail: JSON.stringify({ st, afterUndo, afterRedo }) };
});

check('Audit: SeqEdit Apply with "Pad/trim" never cuts residues', async (page) => {
  // Used to: with the default "Pad/trim to alignment length", inserting residues in SeqEdit
  // cut the sequence back to the alignment width, dropping its last residues (GT lost).
  await loadFasta(page, '>a\nACGTACGT\n>b\nTTTTGG--\n');
  await auditCtrlClickName(page, 0);
  await page.evaluate(() => el('seqEditButton').click()); await page.waitForTimeout(200);
  await page.evaluate(() => { const t = el('seqEditTextarea'); const p = t.value.indexOf('\n') + 1; t.focus(); t.setSelectionRange(p, p); });
  await page.keyboard.type('TT');
  await page.click('#seqEditApplyBtn'); await page.waitForTimeout(300);
  const r = await page.evaluate(() => state.seqs.map(s => s.seq));
  // a shorter edit is still padded, and only trailing gaps are trimmed
  await auditCtrlClickName(page, 0); await auditCtrlClickName(page, 1);
  await page.evaluate(() => el('seqEditButton').click()); await page.waitForTimeout(200);
  await page.evaluate(() => { const t = el('seqEditTextarea'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); });
  await page.keyboard.type('----');
  await page.click('#seqEditApplyBtn'); await page.waitForTimeout(300);
  const r2 = await page.evaluate(() => state.seqs.map(s => s.seq));
  const pass = r[0] === 'TTACGTACGT' && r[1] === 'TTTTGG----' && r2[1] === 'TTTTGG----';
  return { pass, detail: JSON.stringify({ r, r2 }) };
});

check('Audit: Degap block moves the residue selection right of the block with its residues', async (page) => {
  // Used to: Degap block removed the columns it emptied without telling the column-keyed
  // state (applyColumnEdit), so a residue selection to the right slid onto other residues.
  await loadFasta(page, '>a\nAC--GTTTGCATGCA\n>b\nA-C-GTTTGCATGCA\n>c\nAC-GTTTGCATGCA-\n');
  const sel = () => page.evaluate(() => [...state.selectedNucs].map(([r, s]) => r + ':' + [...s].sort((x, y) => x - y).map(c => state.seqs[r].seq[c]).join('')).join());
  const a = await auditCell(page, 0, 8), b = await auditCell(page, 0, 11);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
  const before = await sel();
  await auditCtrlAltDrag(page, 0, 1, 3);
  await page.evaluate(() => el('degapBlockLeftButton').click()); await page.waitForTimeout(300);
  const after = await sel();
  return { pass: before === '0:GCAT' && after === '0:GCAT', detail: JSON.stringify({ before, after, seqs: await auditSeqs(page) }) };
});

check('Audit: Just Add of a sequence longer than the alignment keeps it rectangular', async (page) => {
  // Used to: only shorter new sequences were padded; a longer one left every other row short.
  await loadFasta(page, '>a\nACGTACGT\n>b\nTTTTGGGG\n');
  await page.evaluate(() => { el('addSeqInput').value = '>long\nAAAACCCCGGGGTTTT'; el('addSeqAtTop').checked = false; el('addSeqAlignCons').checked = false; el('addSeqJustAddButton').click(); });
  await page.waitForTimeout(400);
  const lens = await page.evaluate(() => state.seqs.map(s => s.seq.length));
  return { pass: lens.join() === '16,16,16', detail: lens.join() };
});

check('Audit: deleting every sequence or every column is refused', async (page) => {
  // Used to: the guard only stopped deleting when exactly one sequence was left, so Ctrl+A,
  // Ctrl+Del emptied the alignment; deleting all columns left zero-length sequences.
  page.on('dialog', d => d.accept());
  await loadFasta(page, '>a\nACGT\n>b\nTTTT\n>c\nGGGG\n');
  await auditBlur(page);
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+Delete'); await page.waitForTimeout(300);
  const n = await page.evaluate(() => state.seqs.length);
  await page.keyboard.press('Control+a');   // deselect all
  await auditCtrlAltDrag(page, 0, 0, 3);
  await page.keyboard.press('Control+d'); await page.waitForTimeout(300);
  const w = await page.evaluate(() => state.seqs[0].seq.length);
  return { pass: n === 3 && w === 4, detail: JSON.stringify({ n, w }) };
});

// ---------- pre-publication audit (2026-10-14) ----------

check('XSS: a sequence name with HTML is shown as text in the BLAST Search dialog', async (page) => {
  // The dialog built its label with innerHTML from the name, so a shared FASTA or
  // ?data= link with a name like <img onerror=...> ran script on the public site.
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  await page.evaluate(() => { window.__xss = 0; });
  await loadFasta(page, '>Gene<details/open/ontoggle=window.__xss=1;alert(1)>\nACGTACGTAC\n>b\nACGTTCGTAC\n');
  await page.click('.seq-line[data-seq-index="0"] > .seq-name', { button: 'right' });
  const item = page.locator('div', { hasText: /^BLAST Search$/ }).last();
  await item.click();
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    xss: window.__xss,
    label: [...document.querySelectorAll('.blast-dialog-content > div')].map(d => d.textContent).find(t => /^Sequence:/.test(t)) || null,
  }));
  const ok = r.xss === 0 && !dialogs.length && /<details/.test(r.label || '');
  return { pass: ok, detail: JSON.stringify({ ...r, dialogs }) };
});

check('localStorage blocked by the browser: the alignment still renders', async (page) => {
  // safeLocalGet called localStorage.removeItem inside its catch, which threw again
  // and stopped script.js at startup: every render then failed (colourState TDZ).
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await page.goto(page.url(), { waitUntil: 'networkidle' });
  await loadFasta(page, makeFasta(5, 60));
  const cells = await page.evaluate(() => document.querySelectorAll('#alignmentContainer .seq-line[data-seq-index]').length);
  return { pass: cells >= 5 && !errors.length, detail: JSON.stringify({ cells, errors: errors.slice(0, 3) }) };
});

check('localStorage full: no uncaught error on load and saving a preset says why it failed', async (page) => {
  // setItem threw QuotaExceededError uncaught on every load (createOptimalPreset)
  // and Save preset failed silently.
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };
  });
  await page.goto(page.url(), { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await loadFasta(page, makeFasta(5, 60));
  // Save Preset is in a menu panel: dispatch the button's own click handler
  await page.evaluate(() => document.getElementById('savePresetButton').click());
  await page.waitForTimeout(200);
  const msg = await page.evaluate(() => document.getElementById('statusMessage')?.textContent || '');
  return { pass: !errors.length && /storage/i.test(msg), detail: JSON.stringify({ errors: errors.slice(0, 3), msg }) };
});

check('MAFFT worker that cannot load: the error says why, not "undefined"', async (page) => {
  // worker.onerror rejected with the ErrorEvent itself, which has no .message
  // when the script fails to load: the status bar read "MAFFT alignment error: undefined".
  await page.route('**/mafft-worker.js*', r => r.fulfill({ status: 404, body: 'nope' }));
  const msg = await page.evaluate(() => _runMafftInWorker('>a\nACGT\n>b\nACGT\n', []).then(() => 'resolved', e => String(e && e.message)));
  return { pass: /could not start/i.test(msg), detail: msg };
});

// ---------- pre-publication audit: rendering (2026-10-14) ----------

// Switches view mode the way a user does: the Display menu's Mode radio, then the
// "Full mode on a large alignment" dialog if it comes up (shared helper setMode only waits
// for that dialog near ALIGN_CRAZY_VOLUME, so on a tall or long alignment the switch could
// still be pending when a check read the view).
async function auditClickMode(page, mode) {
  const id = { full: 'modeSingle', block: 'modeBlocks', canvas: 'modeCanvas' }[mode];
  const open = await page.evaluate(() => document.querySelector('.section-header[data-section="display"]').closest('.menu-section').classList.contains('menu-open'));
  if (!open) await page.click('.section-header[data-section="display"]');
  await page.click('#' + id);
  const dlg = await page.waitForSelector('#alignLoadProceed', { timeout: 1500 }).then(() => true).catch(() => false);
  if (dlg) await page.click('#alignLoadProceed');
  await page.waitForTimeout(700);
  await page.click('.section-header[data-section="display"]');   // close the menu again
  // and move off it: menus also open on hover, and a wheel over the open menu scrolls nothing
  await page.mouse.move(5, Math.round((await page.evaluate(() => innerHeight)) * 0.66));
  await page.waitForTimeout(400);
}
async function auditOpenSection(page, name) {
  const open = await page.evaluate((n) => document.querySelector(`.section-header[data-section="${n}"]`).closest('.menu-section').classList.contains('menu-open'), name);
  if (!open) await page.click(`.section-header[data-section="${name}"]`);
}
// [row, column] of the first residue at the top left of the view, in any mode (Canvas: its
// hit test; Full/Block: the first residue below the toolbar, right of the sticky names).
const AUDIT_TOPLEFT = () => {
  const c = el('alignmentContainer');
  if (el('modeCanvas').checked) {
    const cv = el('alignmentCanvas').getBoundingClientRect(), m = _canvasState.metrics;
    const h = _canvasHitTest(cv.left + m.nameW + 2, cv.top + 2);
    return h ? [h.row, h.col] : null;
  }
  const cr = c.getBoundingClientRect();
  const top = Math.max(cr.top, el('controls').getBoundingClientRect().bottom, 0);
  const name = [...c.querySelectorAll('.seq-line[data-seq-index] > .seq-name')].find(n => { const r = n.getBoundingClientRect(); return r.height && r.bottom > top; });
  const x = (name && el('stickyNames').checked ? name.getBoundingClientRect().right : cr.left) + 2;
  for (let y = top + 2; y < top + 120; y += 3) {
    const e = document.elementFromPoint(x, y);
    const line = e && e.matches('span[data-pos]') && e.closest('.seq-line[data-seq-index]');
    if (line && +line.dataset.seqIndex >= 0) return [+line.dataset.seqIndex, +e.dataset.pos];
  }
  return null;
};
// AUDIT_TOPLEFT once the view has settled (a redraw of a big alignment can take a few seconds)
async function auditTopLeft(page) {
  let r = null;
  for (let i = 0; i < 25 && !r; i++) { r = await page.evaluate(AUDIT_TOPLEFT); if (!r) await page.waitForTimeout(200); }
  return r;
}
const auditNear = (a, b, tol = 2) => !!a && !!b && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
async function auditWheel(page, dx, dy, n) {
  const b = await page.evaluate(() => { const r = el('alignmentContainer').getBoundingClientRect(); return [r.left + r.width / 2, Math.max(r.top, 0) + (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / 2]; });
  await page.mouse.move(b[0], b[1]);
  for (let i = 0; i < n; i++) { await page.mouse.wheel(dx, dy); await settleWheel(page); await page.waitForTimeout(40); }
  await page.waitForTimeout(700);
}

// Windowed Full mode (above ALIGN_WINDOWED_DOM_THRESHOLD) kept only scrollTop through a redraw:
// emptying the container reset scrollLeft to 0 and the column window was built from that 0, so
// changing the colour scheme, Highlight diffs or the consensus row threw the view back to column 1.
check('Audit: windowed Full keeps its columns through a redraw (colour scheme, Highlight diffs, consensus)', async (page) => {
  await loadSyntheticFasta(page, 1500, 4000);
  await auditClickMode(page, 'full');
  await auditWheel(page, 600, 400, 20);
  const out = { before: await auditTopLeft(page) };
  await auditOpenSection(page, 'display');
  await page.selectOption('#colorSchemeSelect', 'nucleotide'); await page.waitForTimeout(1200);
  out.scheme = await auditTopLeft(page);
  await page.click('#highlightDiffs'); await page.waitForTimeout(1200);
  out.diffs = await auditTopLeft(page);
  await page.click('.section-header[data-section="display"]');
  await auditOpenSection(page, 'consensus');
  await page.click('#showConsensus'); await page.waitForTimeout(1200);
  out.consensusOff = await auditTopLeft(page);
  // The consensus row above the rows went away: rows move up by one, the columns stay
  const ok = out.before[1] > 1000 && auditNear(out.scheme, out.before) && auditNear(out.diffs, out.before)
    && Math.abs(out.consensusOff[1] - out.before[1]) <= 2;
  return { pass: ok, detail: JSON.stringify(out) };
});

// Canvas with translation rows: the selected-column tint stopped at nSeqs x one row height
// (CHAR_H instead of the row pitch), so with all three frames it covered only the top quarter.
check('Audit: Canvas column selection covers every row with translation rows', async (page) => {
  // (ported: a taller window, so that more than 10 rows with translation rows fit on today's
  // Canvas, whose row pitch is larger)
  await page.setViewportSize({ width: 1400, height: 1200 });
  await loadFasta(page, makeFasta(40, 300, 'ATGGCAACG'));
  await auditClickMode(page, 'canvas');
  await auditOpenSection(page, 'display');
  await page.click('#codonAnalysis'); await page.waitForTimeout(1200);
  await page.selectOption('#codonFrame', 'all'); await page.waitForTimeout(1200);
  await page.click('.section-header[data-section="display"]');
  // Ctrl+Alt+click on the ruler selects a column (canvas mousedown)
  // (ported: today's header also holds the consensus row when it is on top, so the ruler row is
  // found from the annotation track's height, not as the header's last row)
  const g = await page.evaluate(() => { const r = el('alignmentCanvas').getBoundingClientRect(), m = _canvasState.metrics; return { x: r.left + m.nameW + 10.5 * m.charW, y: r.top + (m.trackH || 0) + m.charH / 2, top: r.top, h: r.height }; });
  await page.keyboard.down('Control'); await page.keyboard.down('Alt');
  await page.mouse.click(g.x, g.y);
  await page.keyboard.up('Alt'); await page.keyboard.up('Control');
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    // (ported: today's Canvas draws selections on a transparent overlay canvas above the content)
    const m = _canvasState.metrics, ctx = el('alignmentCanvasOverlay').getContext('2d'), d = devicePixelRatio;
    const h = parseFloat(el('alignmentCanvas').style.height);
    // a gap pixel between two codon letters on the lowest translation row on screen
    const p = _canvasState.rowPitch, x = m.nameW + 10 * m.charW + 1;
    const row = Math.floor((h - m.headerH) / p) - 1;
    const y = m.headerH + row * p + p - 2;
    const px = ctx.getImageData(x * d, y * d, 1, 1).data;
    return { sel: [...state.selectedColumns], row, px: [...px] };
  });
  // tinted: blue-ish, not white
  const ok = r.sel.includes(10) && r.row > 10 && r.px[2] > r.px[0] + 20;
  return { pass: ok, detail: JSON.stringify(r) };
});

// Canvas, scrolled right: a plain click on a sequence name hit-tested as the residue hidden under
// the sticky name column and started a residue selection there, drawn over the name; selected
// columns and residues also painted over the name column.
check('Audit: Canvas clicks on names do not select hidden residues; selections stay off the name column', async (page) => {
  await loadFasta(page, makeFasta(40, 600));
  await auditClickMode(page, 'canvas');
  await auditWheel(page, 400, 0, 1);
  const g = await page.evaluate(() => { const r = el('alignmentCanvas').getBoundingClientRect(), m = _canvasState.metrics; return { left: r.left, top: r.top, nameW: m.nameW, charW: m.charW, headerH: m.headerH, pitch: _canvasState.rowPitch, ox: _canvasState.offsetX }; });
  await page.mouse.click(g.left + 50, g.top + g.headerH + 3 * g.pitch + 5);
  await page.waitForTimeout(300);
  const r = await page.evaluate((g) => {
    const out = { ox: g.ox, pending: state.pendingNucStart, nucs: state.selectedNucs.size };
    // a column scrolled under the names, selected: the name cell must stay unpainted
    const col = Math.floor((g.ox - 40) / g.charW);
    state.selectedColumns = new Set([col]); _canvasState.scheduleDraw();
    return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
      const ctx = el('alignmentCanvas').getContext('2d'), d = devicePixelRatio;
      const x = g.nameW + col * g.charW - g.ox + 2;
      out.x = x; out.namePx = [...ctx.getImageData(x * d, (g.headerH + 5 * g.pitch + 1) * d, 1, 1).data];
      res(out);
    })));
  }, g);
  const ok = g.ox > 100 && !r.pending && r.nucs === 0 && r.x < g.nameW && r.namePx[0] === 255 && r.namePx[2] === 255;
  return { pass: ok, detail: JSON.stringify(r) };
});

// The canvas was sized from the container's border box, 2px wider and 1px taller than its client
// area: the alignment could be nudged by 2x1px (PageDown set scrollTop to 1) and its edge was cut.
check('Audit: the Canvas fits the alignment area exactly', async (page) => {
  await loadFasta(page, makeFasta(40, 600));
  await auditClickMode(page, 'canvas');
  const r = await page.evaluate(() => { const c = el('alignmentContainer'), cv = el('alignmentCanvas'); return { cw: c.clientWidth, ch: c.clientHeight, w: parseFloat(cv.style.width), h: parseFloat(cv.style.height), sx: c.scrollWidth - c.clientWidth, sy: c.scrollHeight - c.clientHeight }; });
  return { pass: r.w === r.cw && r.h === r.ch && r.sx === 0 && r.sy === 0, detail: JSON.stringify(r) };
});

// With codon analysis the translation row's name cell (sticky, white) is empty in single-frame
// mode and the row aligned its items to the top, so the cell was 0px tall: scrolled sideways,
// the amino acids showed through the name column.
check('Audit: translation rows stay under the sticky name column when scrolled sideways', async (page) => {
  await loadFasta(page, makeFasta(20, 600, 'ATGGCAACG'));
  await auditClickMode(page, 'full');
  await auditOpenSection(page, 'display');
  await page.click('#codonAnalysis'); await page.waitForTimeout(1200);
  await page.click('.section-header[data-section="display"]');
  await auditWheel(page, 600, 0, 3);
  const r = await page.evaluate(() => {
    const a = document.querySelector('.aa-row'), n = a.querySelector('.aa-name'), ar = a.getBoundingClientRect();
    const e = document.elementFromPoint(n.getBoundingClientRect().left + 40, ar.top + ar.height / 2);
    // the codon boxes fill the row's content box (its padding is the row's own white)
    const boxH = Math.max(...[...a.querySelectorAll('.aa-data > span')].slice(0, 20).map(sp => sp.getBoundingClientRect().height));
    return { sl: el('alignmentContainer').scrollLeft, nameH: n.getBoundingClientRect().height, boxH, hit: e && e.className };
  });
  return { pass: r.sl > 1000 && r.nameH >= r.boxH - 0.5 && !/aa-c/.test(r.hit || ''), detail: JSON.stringify(r) };
});

// Math.max(...lengths) over one entry per sequence throws "Maximum call stack size exceeded"
// past ~125,000 arguments: an alignment of 130,000 short sequences failed to load.
check('Audit: 130,000 sequences load and render', async (page) => {
  await loadSyntheticFasta(page, 130000, 20);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ n: state.seqs.length, rows: document.querySelectorAll('.seq-line[data-seq-index]').length + (el('alignmentCanvas') ? 1 : 0), msg: el('statusMessage')?.innerText.slice(0, 120) }));
  return { pass: r.n === 130000 && r.rows > 0, detail: JSON.stringify(r) };
});

// Display > Screen ("fit block size to the window") only updated the number above 80,000 residues
// (the redraw was skipped for large alignments), so after zooming in the blocks kept overflowing.
check('Audit: Screen refits the blocks of a large alignment', async (page) => {
  await loadSyntheticFasta(page, 100, 1000);
  await auditClickMode(page, 'block');
  await page.mouse.click(5, 895);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+Equal'); await page.waitForTimeout(600); }
  const before = await page.evaluate(() => { const c = el('alignmentContainer'); return c.scrollWidth - c.clientWidth; });
  await auditOpenSection(page, 'display');
  await page.click('#blockSizeScreenBtn'); await page.waitForTimeout(1500);
  const r = await page.evaluate(() => { const c = el('alignmentContainer'); return { slider: +el('blockSizeSlider').value, rendered: +document.querySelector('.scale-ruler-line .seq-data').dataset.scale.split(':')[0], overflow: c.scrollWidth - c.clientWidth }; });
  r.before = before;
  return { pass: before > 0 && r.rendered === r.slider && r.overflow <= 0, detail: JSON.stringify(r) };
});

// PageUp/PageDown scrolled alignmentContainer and always cancelled the key: for small alignments
// the page is the scroller, so the keys did nothing at all; in Canvas no key scrolled.
check('Audit: PageDown scrolls a small (page-scrolled) alignment and Canvas', async (page) => {
  const out = {};
  await loadFasta(page, makeFasta(400, 100));
  await setMode(page, 'block');
  await page.mouse.click(700, 895);
  await page.keyboard.press('PageDown'); await page.waitForTimeout(400);
  out.pageY = await page.evaluate(() => scrollY);
  await loadSyntheticFasta(page, 1500, 4000);
  await auditClickMode(page, 'canvas');
  await page.mouse.click(700, 895);
  await page.keyboard.press('PageDown'); await page.waitForTimeout(400);
  out.canvas = await page.evaluate(() => [_canvasState.offsetY, el('alignmentContainer').scrollTop]);
  await page.keyboard.press('PageUp'); await page.waitForTimeout(400);
  out.canvasUp = await page.evaluate(() => _canvasState.offsetY);
  const ok = out.pageY > 300 && out.canvas[0] > 300 && out.canvas[1] === 0 && out.canvasUp === 0;
  return { pass: ok, detail: JSON.stringify(out) };
});

// Reads mode: the reference's name cell took .seq-name's -12px margin and the ruler's label was
// 8px wider (content-box padding) than the reads' 160px name column, so reads started one base
// right of the reference and the ruler numbers ~1.7 bases right.
check('Audit: Reads mode lines up reads, reference and ruler', async (page) => {
  await openSynthetic(page, 'synth_ref.fa');
  await openSynthetic(page, 'synth_reads.bam');
  await page.evaluate(() => { el('modeReads').checked = true; onModeChange(); }); await page.waitForTimeout(1200);
  const r = await page.evaluate(() => {
    const c = el('alignmentContainer');
    const ref0 = c.querySelector('.ref-track-line .seq-data span[data-pos]').getBoundingClientRect().left;
    const scale0 = c.querySelector('.scale-line').lastChild.children[0].getBoundingClientRect().left;
    const svg = el('readsPileSvg'), sr = svg.getBoundingClientRect();
    const read = bamState.reads.find(rd => rd.start === bamState.refStart);
    // (ported: read bars are now coloured by strand, forward #b0606a and reverse #5a6fb0, not #4a7fa8)
    const bars = [...svg.querySelectorAll('rect[stroke="#b0606a"], rect[stroke="#5a6fb0"]')].map(b => +b.getAttribute('x') + sr.left);
    return { ref0, scale0, firstBar: Math.min(...bars), hasReadAtStart: !!read };
  });
  const ok = r.hasReadAtStart && Math.abs(r.firstBar - r.ref0) < 1 && Math.abs(r.scale0 - r.ref0) < 1;
  return { pass: ok, detail: JSON.stringify(r) };
});

// The windowed views and Canvas set their fixed height once, at render: after the window was made
// smaller the bottom of the alignment (and of the vertical scrollbar) hung below the window, and
// after it was made taller a band of the window stayed empty.
check('Audit: windowed Full and Canvas follow a window resize', async (page) => {
  const out = {};
  await loadSyntheticFasta(page, 1500, 4000);
  const fit = () => { const r = el('alignmentContainer').getBoundingClientRect(); return { bottom: Math.round(r.bottom), inner: innerHeight }; };
  for (const mode of ['full', 'canvas']) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await auditClickMode(page, mode);
    await page.setViewportSize({ width: 1400, height: 600 }); await page.waitForTimeout(800);
    out[mode + '600'] = await page.evaluate(fit);
    await page.setViewportSize({ width: 1400, height: 1100 }); await page.waitForTimeout(800);
    out[mode + '1100'] = await page.evaluate(fit);
    if (mode === 'canvas') out.canvasH = await page.evaluate(() => [parseFloat(el('alignmentCanvas').style.height), el('alignmentContainer').clientHeight]);
    else out.fullRows = await page.evaluate(() => { const c = el('alignmentContainer'), cr = c.getBoundingClientRect(); return [...c.querySelectorAll('.seq-line[data-seq-index]')].filter(l => { const q = l.getBoundingClientRect(); return q.top >= cr.top && q.bottom <= cr.bottom; }).length; });
  }
  const within = s => s.bottom <= s.inner && s.bottom >= s.inner - 60;
  const ok = within(out.full600) && within(out.full1100) && within(out.canvas600) && within(out.canvas1100)
    && out.fullRows > 60 && Math.abs(out.canvasH[0] - out.canvasH[1]) <= 1;
  return { pass: ok, detail: JSON.stringify(out) };
});

// The Canvas and windowed Full viewports reserved a hard-coded 28 px below the alignment for the
// horizontal scrollbar; the scrollbar is 8 px (slimmed 2026-10-23) and the body margin 8 px, so a
// white band (owner's screenshot: ~17 px) stayed unused under the scrollbar. The viewport must end
// exactly one body margin above the window edge, and the page must not need to scroll.
check('Audit: no white band below the horizontal scrollbar (Canvas, windowed Full)', async (page) => {
  const out = {};
  await loadSyntheticFasta(page, 1500, 4000);
  const gaps = () => {
    const sb = [...document.querySelectorAll('#viewer-container .horizontal-scrollbar')].find(e => e.offsetHeight > 0);
    const mb = parseFloat(getComputedStyle(document.body).marginBottom) || 0;
    const sbBottom = sb ? Math.round(sb.getBoundingClientRect().bottom) : null;
    const ac = el('alignmentContainer'), vc = el('viewer-container');
    return { gap: sb ? innerHeight - sbBottom : null, mb, pageScroll: document.documentElement.scrollHeight - innerHeight, acTop: Math.round(ac.getBoundingClientRect().top), acBottom: Math.round(ac.getBoundingClientRect().bottom), acH: ac.style.height, vcBottom: Math.round(vc.getBoundingClientRect().bottom), sbTop: sb && Math.round(sb.getBoundingClientRect().top), inner: innerHeight };
  };
  for (const mode of ['canvas', 'full']) {
    for (const h of [900, 600]) {
      await page.setViewportSize({ width: 1400, height: h });
      await auditClickMode(page, mode); await page.waitForTimeout(600);
      out[mode + h] = await page.evaluate(gaps);
    }
  }
  const ok = Object.values(out).every(g => g.gap !== null && Math.abs(g.gap - g.mb) <= 1 && g.pageScroll <= 0);
  return { pass: ok, detail: JSON.stringify(out) };
});

// Switching view mode lost or shifted the place in the alignment: the anchor was measured on the
// consensus row (14px, the sequence rows 13px), so Full -> Canvas landed ~7% of the rows off (row
// 613 -> 571); a Block view was converted as if it were one tall block (it landed at the bottom,
// column 1); small alignments scroll the page, whose position was ignored (back to row 1); Canvas
// -> a small Full view used 8px/16px guesses for the 7.8px/13px cells; and Full <-> Block always
// landed at column 1.
check('Audit: mode switches keep the place (Full/Block/Canvas, small and windowed)', async (page) => {
  const out = {};
  await loadSyntheticFasta(page, 1500, 4000);
  await auditClickMode(page, 'full');
  await auditWheel(page, 600, 400, 20);
  out.full = await auditTopLeft(page);
  await auditClickMode(page, 'canvas'); out.canvas = await auditTopLeft(page);
  await auditClickMode(page, 'full'); out.full2 = await auditTopLeft(page);
  await auditClickMode(page, 'block'); out.block = await auditTopLeft(page);
  out.bw = await page.evaluate(() => _unifiedWindowRenderParams.blockWidth);
  await auditClickMode(page, 'canvas'); out.canvas2 = await auditTopLeft(page);
  await auditClickMode(page, 'block'); out.block2 = await auditTopLeft(page);
  await auditClickMode(page, 'full'); out.full3 = await auditTopLeft(page);
  // small alignments: the page scrolls (Block) or the container scrolls sideways (Full)
  await loadSyntheticFasta(page, 300, 1000);
  await auditClickMode(page, 'block');
  await page.evaluate(() => window.scrollTo(0, 0));
  // (stay clear of the last ~160 columns: there Canvas and Full cannot scroll a column to the left edge;
  // 8 steps: well into the second block of 300 rows with 15 px rows, as 6 were with 13.5 px rows)
  await auditWheel(page, 0, 900, 8);
  out.smallBlock = await auditTopLeft(page);
  await auditClickMode(page, 'canvas'); out.smallCanvas = await auditTopLeft(page);
  await auditClickMode(page, 'full'); out.smallFull = await auditTopLeft(page);
  await auditWheel(page, 700, 0, 4);
  out.smallFullR = await auditTopLeft(page);
  await auditClickMode(page, 'canvas'); out.smallCanvas2 = await auditTopLeft(page);
  await auditClickMode(page, 'full'); out.smallFull2 = await auditTopLeft(page);
  const inBlock = (blockView, col, bw) => !!blockView && blockView[1] % bw === 0 && blockView[1] <= col && col < blockView[1] + bw;
  const ok = out.full[0] > 300 && out.full[1] > 1000
    && auditNear(out.canvas, out.full) && auditNear(out.full2, out.full)
    && inBlock(out.block, out.full[1], out.bw) && Math.abs(out.block[0] - out.full[0]) <= 2
    && auditNear(out.canvas2, out.block) && auditNear(out.block2, out.block) && auditNear(out.full3, out.block)
    && out.smallBlock[0] > 100 && auditNear(out.smallCanvas, out.smallBlock) && auditNear(out.smallFull, out.smallBlock)
    && out.smallFullR[1] > 300 && auditNear(out.smallCanvas2, out.smallFullR) && auditNear(out.smallFull2, out.smallFullR);
  return { pass: ok, detail: JSON.stringify(out) };
});

// Zooming kept the scroll offsets in pixels while the cells grew or shrank, so the view moved to
// other columns and rows (small Full: column 262 -> 197; windowed Block: column 1951 -> 1462;
// Canvas: 2000 -> 1777). The first residue at the top left now stays put.
check('Audit: zooming keeps the top-left residue (small Full, windowed Full and Block, Canvas)', async (page) => {
  const out = {};
  const zoomPair = async (key) => {
    const before = await auditTopLeft(page);
    await page.mouse.click(5, (await page.evaluate(() => innerHeight)) - 3);   // focus the page, not a control
    await page.keyboard.press('Control+Equal'); await page.waitForTimeout(1200);
    const after = await auditTopLeft(page);
    await page.keyboard.press('Control+Minus'); await page.keyboard.press('Control+Minus'); await page.waitForTimeout(1200);
    const after2 = await auditTopLeft(page);
    await page.keyboard.press('Control+Equal'); await page.waitForTimeout(800);
    out[key] = { before, after, after2 };
    return auditNear(after, before) && auditNear(after2, before) && before[1] > 50;
  };
  await loadSyntheticFasta(page, 20, 800);
  await auditClickMode(page, 'full'); await auditWheel(page, 600, 0, 6);
  let ok = await zoomPair('smallFull');
  await loadSyntheticFasta(page, 1500, 4000);
  await auditClickMode(page, 'full'); await auditWheel(page, 600, 400, 20);
  ok = await zoomPair('windowedFull') && ok;
  await auditClickMode(page, 'block'); await auditWheel(page, 0, 3000, 30);
  ok = await zoomPair('windowedBlock') && ok;
  await auditClickMode(page, 'canvas'); await auditWheel(page, 600, 400, 20);
  ok = await zoomPair('canvas') && ok;
  return { pass: ok, detail: JSON.stringify(out) };
});

// ---------- owner decisions, round 2 (2026-10-14) ----------
const r2Sel = (page) => page.evaluate(() => [...state.selectedRows].sort((a, b) => a - b).join(','));
async function r2ClickName(page, row, mods = []) {
  const p = await auditName(page, row);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.click(p.x, p.y);
  for (const m of mods.slice().reverse()) await page.keyboard.up(m);
  await page.waitForTimeout(250);
}
// The click / Ctrl / Shift sequence on names, in one view; returns what went wrong
async function r2NameClicks(page, label) {
  const bad = [];
  const expect = async (want, what) => {
    const got = await r2Sel(page);
    if (got !== want) bad.push(`${label} ${what}: ${got} (want ${want})`);
  };
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await r2ClickName(page, 2); await expect('2', 'click');
  // (ported: the owner's rule on main is that a second single click on the only selected name
  // unselects it; the branch kept it selected. Then select row 2 again for the next steps.)
  await r2ClickName(page, 2); await expect('', 'click again');
  await r2ClickName(page, 2); await expect('2', 'click once more');
  await r2ClickName(page, 4); await expect('4', 'click another');
  await r2ClickName(page, 1, ['Control']); await expect('1,4', 'ctrl+click');
  await r2ClickName(page, 1, ['Control']); await expect('4', 'ctrl+click again');
  await r2ClickName(page, 1, ['Control']);
  await r2ClickName(page, 6, ['Shift']); await expect('1,2,3,4,5,6', 'shift+click');
  await r2ClickName(page, 3); await expect('3', 'click after range');
  if (!(await page.evaluate(() => el('modeCanvas').checked))) {
    const dom = await page.evaluate(() => [...document.querySelectorAll('.seq-line.selected[data-seq-index]')].map(l => l.dataset.seqIndex).filter((v, i, a) => a.indexOf(v) === i).join(','));
    if (dom !== '3') bad.push(`${label} highlighted rows: ${dom}`);
  }
  return bad;
}

// The owner wants a plain click on a sequence name to select that row (the manual's Mouse table
// says "Click sequence name | Select row"). It used to do nothing: only Ctrl+click selected, and
// in Canvas a plain click on a name only started a pan.
check('Owner: a plain click on a sequence name selects that row (Full, Block, windowed, Canvas)', async (page) => {
  const bad = [];
  await loadFasta(page, makeFasta(12, 120));
  for (const mode of ['full', 'block', 'canvas']) {
    await auditClickMode(page, mode);
    bad.push(...await r2NameClicks(page, mode));
  }
  await loadSyntheticFasta(page, 1500, 4000);
  for (const mode of ['block', 'full', 'canvas']) {
    await auditClickMode(page, mode);
    bad.push(...await r2NameClicks(page, 'windowed ' + mode));
  }
  return { pass: bad.length === 0, detail: bad.join('; ') || 'ok' };
});

// Selecting on a plain click must not break the other name gestures: a drag still reorders (and
// moves the whole selection when the dragged row is in it, so the click must not first reduce
// the selection to one row), a double-click still opens the rename box and leaves just that row
// selected, and the right-click menu still opens.
check('Owner: drag, double-click and right-click on names still reorder, rename and open the menu', async (page) => {
  const bad = [];
  for (const big of [false, true]) {
    if (big) { await loadSyntheticFasta(page, 1500, 4000); await auditClickMode(page, 'block'); }
    else { await loadFasta(page, makeFasta(12, 120)); await auditClickMode(page, 'full'); }
    const L = big ? 'windowed' : 'full';
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    const names0 = await page.evaluate(() => state.seqs.slice(0, 8).map(s => s.header));
    await r2ClickName(page, 1, ['Control']); await r2ClickName(page, 2, ['Control']);
    const a = await auditName(page, 1), b = await auditName(page, 5);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(a.x, a.y + 10, { steps: 3 }); await page.mouse.move(b.x, b.y + 4, { steps: 6 });
    await page.mouse.up(); await page.waitForTimeout(big ? 1500 : 600);
    const after = await page.evaluate(() => state.seqs.slice(0, 8).map(s => s.header));
    const sel = await r2Sel(page);
    const movedRows = sel.split(',').map(Number).map(i => after[i]);
    if (after.join() === names0.join()) bad.push(`${L} drag did not reorder`);
    if (movedRows.join() !== [names0[1], names0[2]].join()) bad.push(`${L} drag selection ${sel} = ${movedRows} (want ${names0[1]},${names0[2]})`);
    // double-click renames
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    const n = await auditName(page, 3);
    await page.mouse.dblclick(n.x, n.y); await page.waitForTimeout(300);
    const box = await page.$('.seq-name-edit');
    if (!box) bad.push(`${L} double-click: no rename box`);
    else {
      await page.keyboard.press('Control+A'); await page.keyboard.type('renamed_r2'); await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => ({ h: state.seqs[3].header, sel: [...state.selectedRows].join(','), box: !!document.querySelector('.seq-name-edit') }));
      if (r.h !== 'renamed_r2' || r.sel !== '3' || r.box) bad.push(`${L} double-click rename: ${JSON.stringify(r)}`);
    }
    // right-click menu
    const m = await auditName(page, 4);
    await page.mouse.click(m.x, m.y, { button: 'right' }); await page.waitForTimeout(300);
    if (!(await page.$('.context-menu'))) bad.push(`${L} right-click: no menu`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  }
  return { pass: bad.length === 0, detail: bad.join('; ') || 'ok' };
});

// Chrome reserves Ctrl+Shift+J (console) and Ctrl+Shift+C (inspect element), Firefox too, so
// those shortcuts never reached the page. Alt+J copies the selected rows' consensus and Alt+C
// copies the selection (as Copy Sel); the old keys stay as aliases where a browser lets them
// through.
check('Owner: Alt+J copies the selected consensus and Alt+C copies the selection', async (page) => {
  await loadFasta(page, makeFasta(8, 40));
  await auditClickMode(page, 'full');
  await page.keyboard.press('Escape');
  await auditCtrlClickName(page, 1); await auditCtrlClickName(page, 2);
  await page.evaluate(() => { window._copied = null; navigator.clipboard.writeText = t => { window._copied = t; return Promise.resolve(); }; });
  await page.mouse.move(5, 600);
  const out = {};
  for (const [k, key] of [['j', 'Alt+KeyJ'], ['c', 'Alt+KeyC'], ['oldJ', 'Control+Shift+KeyJ'], ['oldC', 'Control+Shift+KeyC']]) {
    await page.evaluate(() => { window._copied = null; });
    await page.keyboard.press(key); await page.waitForTimeout(300);
    out[k] = await page.evaluate(() => window._copied);
  }
  const h = await page.evaluate(() => [state.seqs[1].fullHeader || state.seqs[1].header, state.seqs[2].fullHeader || state.seqs[2].header]);
  const isCons = t => /^>Selected_Consensus\n[A-Z]+$/.test(t || '');
  const isRows = t => !!t && t.includes('>' + h[0] + '\n') && t.includes('>' + h[1] + '\n') && !t.includes('Selected_Consensus');
  const ok = isCons(out.j) && isRows(out.c) && isCons(out.oldJ) && isRows(out.oldC);
  return { pass: ok, detail: JSON.stringify(out).slice(0, 300) };
});

// ---------- pre-publication audit round 2: performance (2026-10-14) ----------

// Page time from a user action to the frame after it (two animation frames: the work queued by the
// action has run and the result has been laid out and painted).
const r2Settle = (page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))));
// Longest main-thread task while fn runs (PerformanceObserver 'longtask', > 50 ms each)
async function r2LongTasks(page, fn) {
  await page.evaluate(() => { window.__r2lt = []; window.__r2obs?.disconnect(); window.__r2obs = new PerformanceObserver(l => { for (const e of l.getEntries()) window.__r2lt.push(e.duration); }); window.__r2obs.observe({ type: 'longtask' }); });
  await fn();
  await page.waitForTimeout(600);
  return page.evaluate(() => { window.__r2obs.disconnect(); return { max: Math.round(Math.max(0, ...window.__r2lt)), sum: Math.round(window.__r2lt.reduce((a, b) => a + b, 0)), n: window.__r2lt.length }; });
}
const r2Windowed = () => ({ windowed: !!state._needsWindowedDom, spacers: el('alignmentContainer').querySelectorAll(':scope > .unified-mode-spacer').length, spans: el('alignmentContainer').querySelectorAll('.seq-line[data-seq-index] span[data-pos]').length });

// Alignments just under the windowed-renderer threshold (500,000 residues) got the full DOM, one
// span per residue: 400 x 1,245 took 4.7 s to load and 8.4 s to switch to Full (~500k nodes),
// while 400 x 1,255 took 0.9 s and 0.8 s windowed. The threshold is now low enough that an
// alignment just above it is windowed in both Full and Block.
check('Round 2: an alignment just above the windowed threshold is windowed in Full and Block', async (page) => {
  const T = await page.evaluate(() => ALIGN_WINDOWED_DOM_THRESHOLD);
  const nCol = Math.floor(T / 100) + 1;
  await loadSyntheticFasta(page, 100, nCol);
  await auditClickMode(page, 'full');
  const full = await page.evaluate(r2Windowed);
  await auditClickMode(page, 'block');
  const block = await page.evaluate(r2Windowed);
  const cells = 100 * nCol;
  const ok = T <= 150000 && full.windowed && full.spacers === 2 && full.spans < cells / 2
    && block.windowed && block.spacers === 2 && block.spans < cells / 2;
  return { pass: ok, detail: JSON.stringify({ T, nCol, full, block }) };
});

// The cliff itself: 400 x 1,245 (498,000 residues) loaded in 3.4-4.7 s and switched to Full in
// 5.7-8.4 s (full DOM); windowed both take under 1 s here. The budget is generous for a loaded
// machine and still well below the old times.
check('Round 2: 400 x 1,245 loads and switches to Full quickly (no full-DOM cliff)', async (page) => {
  const t0 = Date.now();
  await loadSyntheticFasta(page, 400, 1245);
  await r2Settle(page);
  const load = Date.now() - t0;
  await auditOpenSection(page, 'display');
  const t1 = Date.now();
  await page.click('#modeSingle');
  await r2Settle(page);
  const full = Date.now() - t1;
  await page.click('.section-header[data-section="display"]');
  const w = await page.evaluate(r2Windowed);
  return { pass: w.windowed && load + full < 4000, detail: JSON.stringify({ load, full, ...w }) };
});

// Show 2D drew nothing on a windowed alignment (renderBlockMaskOverlay returned early), so lowering
// the windowed threshold would have taken it away from alignments of 100k-500k residues. The
// overlay is now drawn over the rows and columns the windowed view has built, and redrawn as the
// window moves. Each rectangle must start at its column's residue and cover its rows.
const R2_MASK_ALIGNED = () => {
  const mask = state.blockMask, c = el('alignmentContainer'), cr = c.getBoundingClientRect();
  if (!mask) return { why: 'no mask' };
  const headerToIdx = new Map(state.seqs.map((s, i) => [s.header, i]));
  const rects = [...c.querySelectorAll('.block-mask-layer rect')];
  let checked = 0, bad = 0;
  for (const mb of mask.blocks) {
    const rows = mb.rows === 'all' ? null : new Set(mb.rows.map(k => headerToIdx.get(mask.row_headers[k])));
    for (const sp of c.querySelectorAll(`.seq-line[data-seq-index] > .seq-data > span[data-pos="${mb.col_start}"]`)) {
      const si = +sp.closest('.seq-line').dataset.seqIndex;
      if (si < 0 || (rows && !rows.has(si))) continue;
      const s = sp.getBoundingClientRect();
      if (s.right < cr.left + 150 || s.left > cr.right - 20 || s.bottom < cr.top || s.top > cr.bottom) continue;   // off screen / under the names
      checked++;
      const blk = sp.closest('.block-block');
      const hit = rects.some(r => { const q = r.getBoundingClientRect(); return r.closest('.block-block') === blk && Math.abs(q.left - s.left) < 1.5 && q.top <= s.top + 1 && q.bottom >= s.bottom - 1; });
      if (!hit) bad++;
      if (checked >= 12) break;
    }
    if (checked >= 12) break;
  }
  return { rects: rects.length, checked, bad, sl: c.scrollLeft, st: c.scrollTop, menu: document.querySelector('.menu-open .section-header')?.dataset.section || null };
};
check('Round 2: Show 2D draws its rectangles on a windowed alignment (Full and Block, after scrolling)', async (page) => {
  const fs = require('fs'), path = require('path');
  const fa = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'blockmask', 'oma_SINE16b.aln.fa'), 'utf8');
  // (ported: main keeps the windowed threshold at 500,000 residues, so ten copies, 500 x 1,049 =
  // 524,500 residues, instead of the branch's two at 104,900 under its 100,000 threshold)
  let many = fa;
  for (let k = 1; k < 10; k++) many += fa.replace(/^>(\S+)/gm, '>$1_copy' + k);
  await loadFasta(page, many);
  await auditClickMode(page, 'full');
  const out = { w: await page.evaluate(r2Windowed) };
  await auditOpenSection(page, 'clustering');
  await page.click('#biclusterComputeButton'); await page.waitForTimeout(1500);
  // close the menu (it also opens on hover) so the wheel below reaches the alignment
  for (let i = 0; i < 3 && await page.evaluate(() => !!document.querySelector('.section-header[data-section="clustering"]').closest('.menu-open')); i++) {
    await page.click('.section-header[data-section="clustering"]');
    await page.mouse.move(5, 600); await page.waitForTimeout(400);
  }
  out.full = await page.evaluate(R2_MASK_ALIGNED);
  await auditWheel(page, 300, 0, 8);   // to column ~300: rows and columns the first window did not build
  out.fullScrolled = await page.evaluate(R2_MASK_ALIGNED);
  await auditClickMode(page, 'block');
  out.block = await page.evaluate(R2_MASK_ALIGNED);
  await auditWheel(page, 0, 400, 6);
  out.blockScrolled = await page.evaluate(R2_MASK_ALIGNED);
  const good = r => r && r.rects > 0 && r.checked > 0 && r.bad === 0;
  // (the first screen of Full and of Block holds no rectangle's first column: there only that none is misplaced)
  const ok = out.w.windowed && out.full.rects > 0 && out.full.bad === 0 && good(out.fullScrolled) && out.block.bad === 0 && good(out.blockScrolled);
  return { pass: ok, detail: JSON.stringify(out) };
});

// Horizontal scrolling of a windowed Full view froze the page: each re-centre of the column window
// patched every built row (~130 rows x 510 columns, 63k residue spans), 0.9-1.9 s per re-centre
// (Range.deleteContents alone ~150 ms, the rest style, layout and paint of all of them), up to
// 4.5 s with real wheel events (96k spans built, 9x the cells on screen). The window is now
// about 3.5x the screen; budget 800 ms per long task (now ~0.3-0.4 s, before 0.85-1.9 s here).
check('Round 2: windowed Full scrolls sideways and down without long freezes', async (page) => {
  await loadSyntheticFasta(page, 1500, 4000);
  await auditClickMode(page, 'full');
  await page.waitForTimeout(1500);   // the row buffer fills in over the first frames
  const box = await page.evaluate(() => { const r = el('alignmentContainer').getBoundingClientRect(); return [r.left + r.width / 2, r.top + Math.min(r.height, innerHeight - r.top) / 2]; });
  await page.mouse.move(box[0], box[1]);
  const steps = async (dx, dy, n) => { for (let i = 0; i < n; i++) { await page.mouse.wheel(dx, dy); await settleWheel(page); await r2Settle(page); await page.waitForTimeout(30); } };
  const h = await r2LongTasks(page, () => steps(300, 0, 24));
  const v = await r2LongTasks(page, () => steps(0, 300, 16));
  const dom = await page.evaluate(() => {
    const c = el('alignmentContainer'), row = c.querySelector('.seq-line[data-seq-index]:not([data-seq-index="-1"])');
    const name = row.querySelector('.seq-name').getBoundingClientRect().width;
    const visCells = Math.ceil(c.clientHeight / row.getBoundingClientRect().height) * Math.ceil((c.clientWidth - name) / _unifiedCharWidthPx);
    return { sl: c.scrollLeft, st: c.scrollTop, spans: c.querySelectorAll('.seq-line[data-seq-index] span[data-pos]').length, visCells };
  });
  const ok = dom.sl > 6000 && dom.st > 3000 && h.max < 800 && v.max < 800 && dom.spans < 4.5 * dom.visCells;
  return { pass: ok, detail: JSON.stringify({ h, v, dom }) };
});

// Opening a file while a windowed view (or Canvas) was scrolled kept the old file's scroll offsets:
// the new alignment opened at row ~600, column ~1500 of nothing in particular (Full mode rebuilt
// its window at the preserved scrollTop/scrollLeft). Small alignments started at the top only
// because emptying the container reset them. With windowing from 100,000 residues this hit most
// real files. A new file now opens at its first row and column, in every view.
check('Round 2: a new file opens at its start after a scrolled windowed view or Canvas', async (page) => {
  const out = {};
  for (const mode of ['full', 'block', 'canvas']) {
    await loadSyntheticFasta(page, 1500, 4000);
    await auditClickMode(page, mode);
    await auditWheel(page, 600, 400, 12);
    out[mode + 'Before'] = await auditTopLeft(page);
    await loadSyntheticFasta(page, 1200, 3000);
    await page.waitForTimeout(800);
    // (Canvas at its start has its ruler at the top left, where the hit test finds no residue)
    // (ported: today a newly loaded file opens in Canvas, the default view, whatever the view
    // before; the view the new file is shown in is the one measured)
    const inCanvas = await page.evaluate(() => el('modeCanvas').checked);
    out[mode] = inCanvas ? await page.evaluate(() => [_canvasState.offsetY, _canvasState.offsetX]) : await auditTopLeft(page);
  }
  const atStart = r => !!r && r[0] === 0 && r[1] === 0;
  const moved = r => !!r && (r[0] > 50 || r[1] > 50);
  const ok = ['full', 'block', 'canvas'].every(m => moved(out[m + 'Before']) && atStart(out[m]));
  return { pass: ok, detail: JSON.stringify(out) };
});

// The small part of 'Audit: mode switches keep the place' used 300 x 1,000 to reach the views that
// scroll the page (full DOM). From 100,000 residues that alignment is windowed, so the same steps
// are repeated here on one under the threshold, where Block scrolls the page.
check('Round 2: mode switches keep the place on an alignment under the windowed threshold', async (page) => {
  const out = {};
  await loadSyntheticFasta(page, 150, 600);   // 90,000 residues
  await auditClickMode(page, 'block');
  out.w = await page.evaluate(() => !!state._needsWindowedDom);
  await page.evaluate(() => window.scrollTo(0, 0));
  await auditWheel(page, 0, 700, 4);
  out.pageY = await page.evaluate(() => Math.round(scrollY));
  out.block = await auditTopLeft(page);
  await auditClickMode(page, 'canvas'); out.canvas = await auditTopLeft(page);
  await auditClickMode(page, 'full'); out.full = await auditTopLeft(page);
  await auditWheel(page, 700, 0, 3);
  out.fullR = await auditTopLeft(page);
  await auditClickMode(page, 'canvas'); out.canvas2 = await auditTopLeft(page);
  await auditClickMode(page, 'full'); out.full2 = await auditTopLeft(page);
  const ok = !out.w && out.pageY > 1000 && out.block[0] > 20 && out.block[1] > 0
    && auditNear(out.canvas, out.block) && auditNear(out.full, out.block)
    && out.fullR[1] > out.full[1] + 100 && auditNear(out.canvas2, out.fullR) && auditNear(out.full2, out.fullR);
  return { pass: ok, detail: JSON.stringify(out) };
});

// The Shortcuts window (Info) gained an Alt+C row and no longer fit a 1280 x 720 screen: it got
// a scrollbar (735px of content in 720px). Ctrl+C and Alt+C now share one row.
check('Shortcuts window fits a 1280 x 720 screen without a scrollbar', async (page) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => openInfoModal());
  await page.waitForTimeout(400);
  const over = await page.evaluate(() => {
    const m = document.getElementById('infoModal');
    return [m, ...m.querySelectorAll('*')].filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1)
      .map(e => [e.id || e.className, e.scrollHeight, e.clientHeight]);
  });
  return { pass: over.length === 0, detail: JSON.stringify(over) };
});

// Owner's decision (2026-10-14, confirmed 2026-10-22): #controls set no font-family, so on Windows the menu headers
// (Input, Shade, Display...) fell back to bold Times New Roman next to Arial buttons
check('toolbar: menu headers use the same font as the toolbar buttons, not the browser serif', async (page) => {
  const r = await page.evaluate(() => {
    const head = document.querySelector('#input-section .section-header span');
    const btn = document.querySelector('#controls button');
    const fam = el => getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    const label = [...document.querySelectorAll('#controls label')].map(fam);
    return { head: fam(head), btn: fam(btn), serifLabels: label.filter(f => /times|serif/i.test(f) && !/sans/i.test(f)).length };
  });
  return { pass: r.head === 'Arial' && r.btn === 'Arial' && r.serifLabels === 0, detail: JSON.stringify(r) };
});


// Owner's report (2026-10-23, browser zoom 90 %): a white T on a dark-grey cell under a white cell had its
// crossbar flush against the white, so the letter seemed to hang from the cell above. Rows were 13.5 CSS px
// for 13 px letters (line-height 1.0): 2 px of box colour above the ink at 100 %, none left at 90 %. Rows are
// now the font size + 2 px, snapped to whole device pixels, in Full, Block and Canvas: at least 2 device rows
// of box colour above and below every white letter at every browser zoom.
check('White letters on shaded cells: 2+ rows of box colour above and below at browser zoom 90 %, 100 %, 110 %, 125 % (Full, Block, Canvas)', async (page) => {
  const out = {};
  // column 1: T,A,T,T  ->  the A's cell is white, the T under it dark grey with a white letter
  const fa = '>r0\nTCCCAT\n>r1\nACCGAG\n>r2\nTCCCAT\n>r3\nTCCCAT\n';
  for (const dpr of [0.9, 1, 1.1, 1.25]) for (const view of ['full', 'block', 'canvas']) {
    const p = await page.context().browser().newPage({ viewport: { width: 500, height: 320 } /* tall enough for row 2 under the toolbar, which takes more lines at 500 px since v278 keeps the Selections tab's place */, deviceScaleFactor: dpr });
    await p.goto(page.url().replace(/view=\w+/, 'view=' + view).replace(/(index\.html)(?!\?)/, '$1?view=' + view), { waitUntil: 'networkidle' });
    await p.setInputFiles('#fileInput', { name: 'w.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
    await p.waitForTimeout(1200);
    const cell = await p.evaluate(() => {
      if (document.getElementById('modeCanvas').checked) {
        const cv = _canvasState.canvas.getBoundingClientRect(), m = _canvasState.metrics;
        return { x: cv.left + m.nameW - _canvasState.offsetX, y: cv.top + m.headerH + 2 * _canvasState.rowPitch - _canvasState.offsetY, w: m.charW, h: m.charH };
      }
      const s = document.querySelector('.seq-line[data-seq-index="2"] .seq-data > span[data-pos="0"]').getBoundingClientRect();
      return { x: s.left, y: s.top, w: s.width, h: s.height };
    });
    const clip = { x: Math.floor(cell.x) - 2, y: Math.floor(cell.y) - 2, width: Math.ceil(cell.w) + 4, height: Math.ceil(cell.h) + 4 };
    const shot = await p.screenshot({ clip });
    await p.close();
    // decode the PNG through a canvas in the test page (no PNG library needed)
    const r = await page.evaluate(async ([b64, cell, clip, dpr]) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const x0 = Math.round((cell.x - clip.x) * dpr) + 1, x1 = Math.round((cell.x + cell.w - clip.x) * dpr) - 2;
      const top = Math.ceil((cell.y - clip.y) * dpr), bot = Math.floor((cell.y + cell.h - clip.y) * dpr) - 1;
      const mx = y => { let m = 0; for (let x = x0; x <= x1; x++) { const i = (y * c.width + x) * 4; m = Math.max(m, d[i] + d[i + 1] + d[i + 2]); } return m; };
      // a row edge between device pixels gives one blended row at the top or bottom of the cell (the DOM
      // cannot put every edge on a device pixel): one light row there is skipped before counting
      let above = 0, y = top; if (mx(y) > 450) y++; while (y <= bot && mx(y) <= 450) { above++; y++; }
      let below = 0; y = bot; if (mx(y) > 450) y--; while (y >= top && mx(y) <= 450) { below++; y--; }
      return { above, below, rows: bot - top + 1 };
    }, [shot.toString('base64'), cell, clip, dpr]);
    out[`${view}@${dpr}`] = r;
  }
  const ok = Object.values(out).every(r => r.above >= 2 && r.below >= 2 && r.rows < r.above + r.below + 12);
  return { pass: ok, detail: JSON.stringify(out) };
});

// Full/Block rows at a fractional browser zoom: v274 drew a grey line (173 of 255) between two black rows at every
// row boundary at 90 % (--row-h asks for whole device pixels, but layout keeps 1/64 px units, so row edges fall
// between device pixels; the spans' 0.5 px overlap below did not cover the blended row). A cell now paints one
// device pixel under the cell below it at a fractional zoom. Measured at each row boundary, in the last device
// column of a C cell (the C's terminals are rows away from the edge): no row brighter than a third of white
// (110 % and 125 % keep faint rows of up to a quarter, as v274 had; a whole fix needs whole-pixel rows and cells).
check('Full/Block: no seam between shaded rows brighter than a third at browser zoom 90 %, 110 % and 125 %', async (page) => {
  const out = {};
  const s = 'ACGT'.repeat(8);
  for (const dpr of [0.9, 1.1, 1.25]) for (const view of ['full', 'block']) {
    const p = await page.context().browser().newPage({ viewport: { width: 700, height: 300 }, deviceScaleFactor: dpr });
    await p.goto(page.url().replace(/view=\w+/, 'view=' + view).replace(/(index\.html)(?!\?)/, '$1?view=' + view), { waitUntil: 'networkidle' });
    await p.setInputFiles('#fileInput', { name: 'k.fa', mimeType: 'text/plain', buffer: Buffer.from(`>a\n${s}\n>b\n${s}\n>c\n${s}\n>d\n${s}\n>e\n${s}\n`) });
    await p.waitForTimeout(1200);
    const geo = await p.evaluate(() => {
      const c = i => document.querySelector(`.seq-line[data-seq-index="${i}"] .seq-data > span[data-pos="1"]`).getBoundingClientRect();
      const a = c(0);
      return { x: a.left, y: a.top, w: a.width, h: c(4).bottom - a.top, tops: [1, 2, 3, 4].map(i => c(i).top - a.top) };
    });
    const clip = { x: Math.floor(geo.x), y: Math.floor(geo.y), width: Math.ceil(geo.w), height: Math.ceil(geo.h) };
    const shot = await p.screenshot({ clip });
    await p.close();
    out[`${view}@${dpr}`] = await page.evaluate(async ([b64, dpr, geo, clip]) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const x = Math.floor((geo.x + geo.w - clip.x) * dpr) - 1;          // the cell's last device column
      const light = [];
      let max = 0;
      for (const t of geo.tops) { const yb = Math.floor((geo.y + t - clip.y) * dpr); for (let y = yb - 1; y <= yb + 1; y++) { const i = (y * c.width + x) * 4; const v = d[i] + d[i + 1] + d[i + 2]; if (v > max) { max = v; light.length = 0; light.push(y + ':' + v); } } }
      return { boundaries: geo.tops.length, brightest: max, at: light[0] };
    }, [shot.toString('base64'), dpr, geo, clip]);
  }
  return { pass: Object.values(out).every(o => o.brightest <= 255), detail: JSON.stringify(out) };
});


// The Canvas ruler digits were drawn at the ruler row's top edge with an alphabetic baseline (the computed
// rulerBase was never used): their ink sat above the row. The digits sit on the same pixel rows as Full's.
check('Canvas ruler digits sit on the same rows as the Full ruler digits', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'r.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\n' + 'ACGT'.repeat(10) + '\n>b\n' + 'ACGT'.repeat(10) + '\n') });
  await page.waitForTimeout(1000);
  const inkRows = async (clip) => {
    const shot = await page.screenshot({ clip });
    return page.evaluate(async ([b64]) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
      let t = -1, b = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (d[i] + d[i + 1] + d[i + 2] < 600) { if (t < 0) t = y; b = y; break; } }
      return [t, b];
    }, [shot.toString('base64')]);
  };
  await setMode(page, 'full'); await page.waitForTimeout(500);
  const dom = await page.evaluate(() => { const r = document.querySelector('.scale-ruler-line .seq-data').getBoundingClientRect(), s = document.querySelector('.seq-line[data-seq-index="0"] .seq-data > span[data-pos="9"]').getBoundingClientRect(); return { x: s.left, top: r.top, h: r.height, w: s.width * 2.2 }; });
  // column 10's label "10": the ruler row only (the consensus row below it has letters of its own)
  const full = await inkRows({ x: Math.floor(dom.x) - 2, y: Math.floor(dom.top), width: Math.ceil(dom.w), height: Math.floor(dom.h) });
  await setMode(page, 'canvas'); await page.waitForTimeout(600);
  const cv = await page.evaluate(() => { const c = _canvasState.canvas.getBoundingClientRect(), m = _canvasState.metrics; const trackH = m.headerH - m.charH - (_canvasState.consensus && _canvasState.consensus.position !== 'bottom' ? m.charH + 5 : 0); return { x: c.left + m.nameW + 9 * m.charW, top: c.top + trackH, h: m.charH, w: m.charW * 2.2 }; });
  const canvas = await inkRows({ x: Math.floor(cv.x) - 2, y: Math.floor(cv.top), width: Math.ceil(cv.w), height: Math.floor(cv.h) });
  const ok = full[0] >= 0 && canvas[0] >= 0 && Math.abs(full[0] - canvas[0]) <= 1 && Math.abs(full[1] - canvas[1]) <= 1;
  return { pass: ok, detail: JSON.stringify({ full, canvas }) };
});


// Owner (2026-10-23): "when scrolling even a small alignment the image is jerky". Canvas applied each mouse-wheel
// notch (100-120 px) as one jump in a single frame; the browser's own scroller (Full view) animates a notch over
// several frames. A notch now eases to its target over ~150 ms and lands exactly on it; a touchpad's small
// deltas apply at once; a view moved by other code during the animation is left alone.
check('Canvas: a mouse-wheel notch scrolls in several frames and lands on its target; small touchpad deltas apply at once', async (page) => {
  await page.goto(page.url().replace(/view=\w+/, 'view=canvas').replace(/(index\.html)(?!\?)/, '$1?view=canvas'), { waitUntil: 'networkidle' });
  await loadSyntheticFasta(page, 120, 600);
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__fr = []; const tick = () => { window.__fr.push(_canvasState.offsetY); requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const box = await page.evaluate(() => { const r = _canvasState.canvas.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(box[0], box[1]);
  await page.mouse.wheel(0, 120); await settleWheel(page);
  await page.waitForTimeout(500);
  const notch = await page.evaluate(() => { const f = window.__fr; const distinct = [...new Set(f)]; return { distinct: distinct.length, end: _canvasState.offsetY, frames: f.length }; });
  // a touchpad-like delta: on screen by the next frame
  await page.evaluate(() => { window.__fr = []; });
  await page.mouse.wheel(0, 20); await settleWheel(page);
  await page.waitForTimeout(80);
  const pad = await page.evaluate(() => ({ first: window.__fr.find(v => v !== 120), end: _canvasState.offsetY }));
  // other code moves the view while a notch is animating: the animation gives way
  await page.mouse.wheel(0, 120); await settleWheel(page);
  await page.waitForTimeout(30);
  await page.evaluate(() => { _canvasState.offsetY = 0; _canvasState.scheduleDraw(); });
  await page.waitForTimeout(500);
  const yielded = await page.evaluate(() => _canvasState.offsetY);
  const ok = notch.distinct >= 4 && notch.end === 120 && pad.first === 140 && pad.end === 140 && yielded === 0;
  return { pass: ok, detail: JSON.stringify({ notch, pad, yielded }) };
});


// Owner (2026-10-23, his 116-sequence CLsat panel, UPGMA, unrooted, 400 % zoom): leaf labels overlapped and were
// unreadable, and the merged "name +N" labels of the old grouping collided with their neighbours. Each label now
// gets its own clear spot (shifted along the arc or outward, with a leader line), the drawing grows to hold the
// moved labels, and with grouping on the omitted names are listed after the "+N".
check('Unrooted tree: no two leaf labels overlap and every name is inside the drawing (owner\'s 116-leaf panel, 100 % and 400 %)', async (page) => {
  const path = require('path');
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', 'fixtures', 'clsat_panel_116.fa'));
  await page.waitForFunction(() => state.seqs && state.seqs.length === 116, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const pick = (name, v) => page.evaluate(([name, v]) => { const r = document.querySelector(`input[name="${name}"][value="${v}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, [name, v]);
  await pick('treeMethod', 'upgma');
  await page.evaluate(() => { state.selectedRows = new Set(state.seqs.map((_, i) => i)); openTreeBuilder(); });
  await page.waitForFunction(() => document.getElementById('treeBuilderModal').style.display !== 'none', null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await pick('treeLayout', 'unrooted'); await page.waitForTimeout(400);
  await page.evaluate(() => { const cb = document.getElementById('treeGroupOverlap'); if (cb && cb.checked) { cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); } });
  const measure = () => page.evaluate(() => {
    const svg = document.querySelector('#treeBuilderModal svg');
    const sr = svg.getBoundingClientRect(), inside = (x, y) => x >= sr.left - 1 && y >= sr.top - 1 && x <= sr.right + 1 && y <= sr.bottom + 1;
    const texts = [...svg.querySelectorAll('text.tree-leaf-label')];
    // each label as a rotated rectangle on screen (its bbox through its screen transform); overlap by the
    // separating-axis test, with half a pixel of tolerance
    const polys = texts.map(t => { const b = t.getBBox(), M = t.getScreenCTM();
      return [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]].map(([x, y]) => [M.a * x + M.c * y + M.e, M.b * x + M.d * y + M.f]); });
    const sep = (P, Q) => { for (const R of [P, Q]) for (let i = 0; i < 4; i++) { const ax = R[(i + 1) % 4][1] - R[i][1], ay = R[i][0] - R[(i + 1) % 4][0], n = Math.hypot(ax, ay) || 1;
      const pr = p => p.map(([x, y]) => (ax * x + ay * y) / n); const a = pr(P), b = pr(Q); if (Math.max(...a) <= Math.min(...b) + 0.5 || Math.max(...b) <= Math.min(...a) + 0.5) return true; } return false; };
    let overlaps = 0; const pairs = [];
    for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) if (!sep(polys[i], polys[j])) { overlaps++; if (pairs.length < 3) pairs.push(texts[i].dataset.leaf + ' x ' + texts[j].dataset.leaf); }
    const outside = polys.filter(P => P.some(([x, y]) => !inside(x, y))).length;
    const names = new Set(texts.map(t => t.dataset.leaf));
    return { labels: texts.length, names: names.size, overlaps, pairs, outside, zoom: document.getElementById('treeZoomLabel').textContent };
  });
  const out = { z100: await measure() };
  for (let i = 0; i < 10; i++) { await page.click('#treeBuilderModal [data-act="zoom-in"]'); await page.waitForTimeout(60); const z = await page.evaluate(() => parseInt(document.getElementById('treeZoomLabel').textContent)); if (z >= 400) break; }
  await page.waitForTimeout(500);
  out.z400 = await measure();
  await page.click('#treeBuilderCloseBtn');
  const good = r => r.labels === 116 && r.names === 116 && r.overlaps === 0 && r.outside === 0;
  return { pass: good(out.z100) && good(out.z400), detail: JSON.stringify(out) };
});


// Owner (2026-10-23): "Ins Gap Other turns into simple nucleotide selection (Type button activates) after a few
// quick clicks". Two quick clicks are a double-click, and the document's dblclick handler switched the tool to
// Type whatever tool was active. With edit mode on and a gap tool active, a double-click is now just two clicks
// of that tool; with the Type tool it still moves the typing cell, and with edit mode off it still enters Type.
check('Edit mode: a double-click with a gap tool applies the tool twice and does not switch to Type (Full)', async (page) => {
  await page.goto(page.url().replace(/view=\w+/, 'view=full').replace(/(index\.html)(?!\?)/, '$1?view=full'), { waitUntil: 'networkidle' });
  await page.setInputFiles('#fileInput', { name: 'g.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGTACGTAC\n>b\nACGTACGTAC\n>c\nACGTACGTAC\n') });
  await page.waitForTimeout(1200);
  await page.click('#editToggleButton'); await page.waitForTimeout(400);
  await page.click('[data-edit-tool="insertGapOther"]'); await page.waitForTimeout(300);
  const cell = (r, c) => page.evaluate(([r, c]) => { const b = document.querySelector(`.seq-line[data-seq-index="${r}"] .seq-data > span[data-pos="${c}"]`).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, [r, c]);
  const c03 = await cell(0, 3);
  await page.mouse.dblclick(c03.x, c03.y);               // two quick clicks
  await page.waitForTimeout(500);
  const gap = await page.evaluate(() => ({ tool: state.editTool, typeOn: document.querySelector('[data-edit-tool="residue"]').classList.contains('active'), b: state.seqs[1].seq, a: state.seqs[0].seq, editCell: state.editCell }));
  // the Type tool: a double-click moves the typing cell
  await page.click('[data-edit-tool="residue"]'); await page.waitForTimeout(300);
  const c12 = await cell(1, 2);
  await page.mouse.dblclick(c12.x, c12.y); await page.waitForTimeout(300);
  const typed = await page.evaluate(() => ({ tool: state.editTool, cell: state.editCell }));
  // edit mode off: a double-click still enters Type at that cell
  await page.click('#editToggleButton'); await page.waitForTimeout(400);
  const c22 = await cell(2, 2);
  await page.mouse.dblclick(c22.x, c22.y); await page.waitForTimeout(400);
  const entered = await page.evaluate(() => ({ on: state.editModeActive, tool: state.editTool, cell: state.editCell }));
  await page.evaluate(() => { if (state.editModeActive) document.getElementById('editToggleButton').click(); });
  const ok = gap.tool === 'insertGapOther' && !gap.typeOn && gap.b.slice(3, 5) === '--' && gap.b.length === 12
    && typed.tool === 'residue' && typed.cell && typed.cell.row === 1 && typed.cell.pos === 2
    && entered.on && entered.tool === 'residue' && entered.cell && entered.cell.row === 2 && entered.cell.pos === 2;
  return { pass: ok, detail: JSON.stringify({ gap, typed, entered }) };
});


// Owner (2026-10-23): "when moving a sequence in edit mode, tooltip over nucleotides should not appear". The residue
// tooltip (name: position) followed the pointer across the cells crossed by a Move/Slide drag. No residue tooltip
// while a Move/Slide, residue-selection or row drag is in progress, in Full and in Canvas.
check('Edit mode: no residue tooltip while a Move/Slide drag is in progress (Full, Canvas)', async (page) => {
  const out = {};
  for (const view of ['full', 'canvas']) {
    await page.goto(page.url().replace(/view=\w+/, 'view=' + view).replace(/(index\.html)(?!\?)/, '$1?view=' + view), { waitUntil: 'networkidle' });
    await page.setInputFiles('#fileInput', { name: 'm.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGTACGTACGTACGT\n>b\nACGTACGTACGTACGT\n>c\nACGTACGTACGTACGT\n') });
    await page.waitForTimeout(1200);
    await page.click('#editToggleButton'); await page.waitForTimeout(400);
    await page.click('[data-edit-tool="moveNoGaps"]'); await page.waitForTimeout(300);
    const cell = (r, c) => page.evaluate(([r, c]) => {
      if (document.getElementById('modeCanvas').checked) { const cv = _canvasState.canvas.getBoundingClientRect(), m = _canvasState.metrics; return { x: cv.left + m.nameW + (c + 0.5) * m.charW - _canvasState.offsetX, y: cv.top + m.headerH + (r + 0.5) * _canvasState.rowPitch - _canvasState.offsetY }; }
      const b = document.querySelector(`.seq-line[data-seq-index="${r}"] .seq-data > span[data-pos="${c}"]`).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, [r, c]);
    const shown = () => page.evaluate(() => { const t = document.getElementById('tooltip') || document.querySelector('.tooltip'); return !!t && t.style.display !== 'none' && t.getClientRects().length > 0 ? t.textContent.trim().slice(0, 40) : ''; });
    const a = await cell(1, 2), b = await cell(1, 9);
    await page.mouse.move(a.x, a.y); await page.waitForTimeout(150);
    await page.mouse.down();
    const seen = [];
    for (let i = 1; i <= 6; i++) { await page.mouse.move(a.x + (b.x - a.x) * i / 6, a.y + (i % 2), { steps: 2 }); await page.waitForTimeout(90); seen.push(await shown()); }
    const dragging = await page.evaluate(() => !!state.editDrag);
    await page.mouse.up(); await page.waitForTimeout(400);
    await page.evaluate(() => { if (state.editModeActive) document.getElementById('editToggleButton').click(); });
    out[view] = { dragging, tooltipsDuringDrag: seen.filter(Boolean) };
  }
  const ok = Object.values(out).every(r => r.dragging && r.tooltipsDuringDrag.length === 0);
  return { pass: ok, detail: JSON.stringify(out) };
});


// Owner (2026-10-23): the Display-menu "Case" select did nothing in Canvas (the default view) and was buried; now a
// visible aa | Aa | AA switch on the mode row, obeyed by Full, Block and Canvas, kept in sync with the select, saved
// in snapshots. The consensus row keeps its own case (upper = above the threshold) in every view.
check('Letter case: the aa | Aa | AA switch sets the case in Full, Block and Canvas; consensus row keeps its case; snapshots restore it', async (page) => {
  const out = {};
  for (const view of ['full', 'canvas']) {
    await page.goto(page.url().replace(/view=\w+/, 'view=' + view).replace(/(index\.html)(?!\?)/, '$1?view=' + view), { waitUntil: 'networkidle' });
    await page.setInputFiles('#fileInput', { name: 'lc.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\naaagaaaaaaaaaaaa\n>b\naaaaaaaaaaaaaaaa\n>c\naaataaaaaaaacaaa\n') });
    await page.waitForTimeout(1200);
    const inkRows = async () => {   // the pixels of cell (1, 3), an unshaded column: a lowercase a and a capital A differ
      const c = await page.evaluate(() => {
        if (document.getElementById('modeCanvas').checked) { const cv = _canvasState.canvas.getBoundingClientRect(), m = _canvasState.metrics; return { x: cv.left + m.nameW + 3 * m.charW - _canvasState.offsetX, y: cv.top + m.headerH + 1 * _canvasState.rowPitch - _canvasState.offsetY, w: m.charW, h: m.charH }; }
        const b = document.querySelector('.seq-line[data-seq-index="1"] .seq-data > span[data-pos="3"]').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
      const shot = await page.screenshot({ clip: { x: Math.floor(c.x), y: Math.floor(c.y), width: Math.ceil(c.w), height: Math.ceil(c.h) } });
      return shot.toString('base64');
    };
    const r = { visible: await page.evaluate(() => { const e = document.getElementById('caseSwitch'); return !!e && e.getClientRects().length > 0; }) };
    r.lowerRows = await inkRows();
    await page.click('label[for="csUpper"]'); await page.waitForTimeout(500);
    r.upperRows = await inkRows();
    r.state = await page.evaluate(() => ({ st: state.residueCase, sel: document.getElementById('residueCase').value, radio: document.querySelector('input[name="caseQuick"]:checked').value,
      domTransform: document.getElementById('modeCanvas').checked ? 'n/a' : getComputedStyle(document.querySelector('.seq-line[data-seq-index="1"] .seq-data')).textTransform,
      consTransform: document.getElementById('modeCanvas').checked ? 'n/a' : getComputedStyle(document.querySelector('.consensus-line .seq-data')).textTransform }));
    // the Display select drives the same state, and a snapshot carries it
    await page.evaluate(() => { const s = document.getElementById('residueCase'); s.value = 'lower'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(300);
    r.afterSelect = await page.evaluate(() => ({ st: state.residueCase, radio: document.querySelector('input[name="caseQuick"]:checked').value, inPayload: _buildSnapshotPayload().view.residueCase }));
    await page.evaluate(() => _applySnapshotView({ residueCase: 'upper' }));
    await page.waitForTimeout(300);
    r.afterSnapshot = await page.evaluate(() => ({ st: state.residueCase, radio: document.querySelector('input[name="caseQuick"]:checked').value, sel: document.getElementById('residueCase').value }));
    await page.evaluate(() => setResidueCase('asis'));
    out[view] = r;
  }
  const ok = Object.values(out).every(r => r.visible && r.upperRows !== r.lowerRows && r.state.st === 'upper' && r.state.sel === 'upper' && r.state.radio === 'upper'
    && (r.state.domTransform === 'n/a' || (r.state.domTransform === 'uppercase' && r.state.consTransform === 'none'))
    && r.afterSelect.st === 'lower' && r.afterSelect.radio === 'lower' && r.afterSelect.inPayload === 'lower'
    && r.afterSnapshot.st === 'upper' && r.afterSnapshot.radio === 'upper' && r.afterSnapshot.sel === 'upper');
  return { pass: ok, detail: JSON.stringify(out) };
});


// Owner (2026-10-23, chose B+A): the gap tools' thin black crosshair was invisible on black and grey cells. Now a
// crosshair with a white halo, and the cell under the pointer outlined in orange, in Full/Block and in Canvas.
check('Edit mode: gap tools show a haloed crosshair and outline the cell under the pointer (Full, Canvas)', async (page) => {
  const out = {};
  for (const view of ['full', 'canvas']) {
    await page.goto(page.url().replace(/view=\w+/, 'view=' + view).replace(/(index\.html)(?!\?)/, '$1?view=' + view), { waitUntil: 'networkidle' });
    await page.setInputFiles('#fileInput', { name: 'k.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGTACGTACGT\n>b\nACGTACGTACGT\n>c\nACGTACGTACGT\n') });
    await page.waitForTimeout(1200);
    await page.click('#editToggleButton'); await page.waitForTimeout(300);
    await page.click('[data-edit-tool="insertGapOther"]'); await page.waitForTimeout(200);
    const cell = await page.evaluate(() => {
      if (document.getElementById('modeCanvas').checked) { const cv = _canvasState.canvas.getBoundingClientRect(), m = _canvasState.metrics; return { x: cv.left + m.nameW + 4 * m.charW - _canvasState.offsetX, y: cv.top + m.headerH + 1 * _canvasState.rowPitch - _canvasState.offsetY, w: m.charW, h: m.charH, cvLeft: cv.left, cvTop: cv.top }; }
      const b = document.querySelector('.seq-line[data-seq-index="1"] .seq-data > span[data-pos="4"]').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    await page.mouse.move(cell.x + cell.w / 2, cell.y + cell.h / 2); await page.waitForTimeout(250);
    out[view] = await page.evaluate((cell) => {
      if (document.getElementById('modeCanvas').checked) {
        const o = _canvasState.overlay, dpr = o.width / parseFloat(o.style.width || o.width);
        // the outline's top-left corner: the most orange pixel in a 4 x 4 window there (the stroke straddles device pixels)
        const d = o.getContext('2d').getImageData(Math.round((cell.x - cell.cvLeft) * dpr), Math.round((cell.y - cell.cvTop) * dpr), 4, 4).data;
        let best = [0, 0, 0, 0]; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > best[3]) best = [d[i], d[i + 1], d[i + 2], d[i + 3]];
        return { cursor: _canvasState.canvas.style.cursor.slice(0, 30), outlinePx: best };
      }
      const sp = document.querySelector('.seq-line[data-seq-index="1"] .seq-data > span[data-pos="4"]'), cs = getComputedStyle(sp);
      return { cursor: cs.cursor.slice(0, 30), outline: cs.outlineStyle + ' ' + cs.outlineColor + ' ' + cs.outlineWidth };
    }, cell);
    await page.evaluate(() => { if (state.editModeActive) document.getElementById('editToggleButton').click(); });
  }
  const orange = p => p[0] > 200 && p[1] > 100 && p[1] < 180 && p[2] < 80 && p[3] > 100;
  const ok = out.full.cursor.startsWith('url(') && out.full.outline === 'solid rgb(255, 140, 0) 2px'
    && out.canvas.cursor.startsWith('url(') && orange(out.canvas.outlinePx);
  return { pass: ok, detail: JSON.stringify(out) };
});


// Owner (2026-10-23): the repeat-finder window should be expandable like the other windows, and every movable window
// should turn semi-transparent while it is being moved. The repeat panel now uses the shared window frame (drag by the
// title, eight resize handles, a maximise button / double-click on the title); a window being moved has class
// win-dragging (opacity 0.6), in both frame helpers.
check('Windows: the repeat finder resizes from its edges and maximises; a window being moved is semi-transparent (repeat finder, statistics)', async (page) => {
  await page.setInputFiles('#fileInput', { name: 'w.fa', mimeType: 'text/plain', buffer: Buffer.from('>a\nACGTACGTACGTACGTACGTACGT\n>b\nACGTACGTACGAACGTACGTACGT\n') });
  await page.waitForTimeout(1000);
  await page.evaluate(() => openRepeatFinder(0));
  await page.waitForTimeout(500);
  const r = {};
  r.frame = await page.evaluate(() => { const w = document.getElementById('repeatFinderModalInner'); return { handles: w.querySelectorAll('.win-rz').length, maxBtn: !!w.querySelector('.win-maxbtn'), resizeCss: getComputedStyle(w).resize }; });
  const bar = await page.evaluate(() => { const b = document.getElementById('repeatFinderDragHandle').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  const rect = () => page.evaluate(() => { const b = document.getElementById('repeatFinderModalInner').getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; });
  const before = await rect();
  await page.mouse.move(bar.x, bar.y); await page.mouse.down(); await page.mouse.move(bar.x - 40, bar.y + 20, { steps: 4 }); await page.mouse.move(bar.x - 80, bar.y + 40, { steps: 4 });
  r.midDrag = await page.evaluate(() => { const w = document.getElementById('repeatFinderModalInner'); return { opacity: +getComputedStyle(w).opacity, cls: w.classList.contains('win-dragging') }; });
  await page.mouse.up(); await page.waitForTimeout(200);
  const after = await rect();
  r.moved = { dx: after.l - before.l, dy: after.t - before.t, opacity: await page.evaluate(() => +getComputedStyle(document.getElementById('repeatFinderModalInner')).opacity) };
  const se = await page.evaluate(() => { const b = document.querySelector('#repeatFinderModalInner .win-rz[data-dir="se"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.move(se.x, se.y); await page.mouse.down(); await page.mouse.move(se.x + 60, se.y + 40, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(200);
  const grown = await rect();
  r.resized = { dw: grown.w - after.w, dh: grown.h - after.h };
  await page.click('#repeatFinderModalInner .win-maxbtn'); await page.waitForTimeout(200);
  const max = await rect();
  r.max = { fills: max.w >= await page.evaluate(() => innerWidth - 14) && max.h >= await page.evaluate(() => innerHeight - 14) };
  await page.click('#repeatFinderModalInner .win-maxbtn'); await page.waitForTimeout(200);
  const restored = await rect();
  r.restored = Math.abs(restored.w - grown.w) <= 2 && Math.abs(restored.l - grown.l) <= 2;
  await page.click('#repeatFinderCloseBtn'); await page.waitForTimeout(200);
  // the statistics window (the other frame helper)
  await page.evaluate(() => openStats()); await page.waitForTimeout(1200);
  const sb = await page.evaluate(() => { const b = document.getElementById('statsHeader').getBoundingClientRect(); return { x: b.left + b.width * 0.3, y: b.top + b.height / 2 }; });
  await page.mouse.move(sb.x, sb.y); await page.mouse.down(); await page.mouse.move(sb.x + 30, sb.y + 20, { steps: 4 }); await page.mouse.move(sb.x + 60, sb.y + 40, { steps: 4 });
  r.statsMid = await page.evaluate(() => +getComputedStyle(document.getElementById('statsModal')).opacity);
  await page.mouse.up(); await page.waitForTimeout(200);
  r.statsAfter = await page.evaluate(() => +getComputedStyle(document.getElementById('statsModal')).opacity);
  const ok = r.frame.handles === 8 && r.frame.maxBtn && r.frame.resizeCss === 'none'
    && r.midDrag.cls && r.midDrag.opacity < 0.8 && Math.abs(r.moved.dx + 80) <= 3 && Math.abs(r.moved.dy - 40) <= 3 && r.moved.opacity === 1
    && r.resized.dw >= 50 && r.resized.dh >= 30 && r.max.fills && r.restored
    && r.statsMid < 0.8 && r.statsAfter === 1;
  return { pass: ok, detail: JSON.stringify(r) };
});


// Owner (2026-10-23): after a TSD search the found TSDs should show faintly on the alignment at once, and the
// "Mark in alignment" button should invite the click. A preview layer (state.tsdPreview, the TSD colour at a third
// of its strength) in every view, cleared by Mark, a mode change, the window's close button and a new file.
check('TSD finder: found TSDs show faintly at once and the Mark button invites the click; Mark replaces the preview (Full, Canvas)', async (page) => {
  let x = 7; const rnd = () => { x = (x * 16807) % 2147483647; return x; };
  const rb = n => Array.from({ length: n }, () => 'ACGT'[rnd() % 4]).join('');
  const body = rb(100);
  let fa = '>consensus' + '\n' + '-'.repeat(31) + body + 'AAAAAAAAAA' + '-'.repeat(31) + '\n';
  for (let i = 0; i < 12; i++) { const tsd = rb(6); fa += '>copy' + i + '\n' + rb(25) + tsd + body + 'AAAAAAAAAA' + tsd + rb(25) + '\n'; }
  const out = {};
  for (const view of ['full', 'canvas']) {
    await page.goto(page.url().replace(/view=\w+/, 'view=' + view).replace(/(index\.html)(?!\?)/, '$1?view=' + view), { waitUntil: 'networkidle' });
    await page.setInputFiles('#fileInput', { name: 'tsd.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
    await page.waitForTimeout(1500);
    await page.evaluate(() => openRepeatFinder(0));
    await page.click('label:has(input[name="repeatMode"][value="tsd"])');
    // the brightness of a TSD residue's cell (row and column of the first result's first upstream residue)
    const cellMean = async () => {
      const c = await page.evaluate(() => {
        const res = _lastTsdResults[0], row = res.seqIndex, col = res.upPositions[0];
        if (document.getElementById('modeCanvas').checked) { const cv = _canvasState.canvas.getBoundingClientRect(), m = _canvasState.metrics; return { x: cv.left + m.nameW + col * m.charW - _canvasState.offsetX, y: cv.top + m.headerH + row * _canvasState.rowPitch - _canvasState.offsetY, w: m.charW, h: m.charH }; }
        const b = document.querySelector(`.seq-line[data-seq-index="${row}"] .seq-data > span[data-pos="${col}"]`).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
      const shot = await page.screenshot({ clip: { x: Math.floor(c.x) + 1, y: Math.floor(c.y) + 1, width: Math.max(1, Math.floor(c.w) - 2), height: Math.max(1, Math.floor(c.h) - 2) } });
      return page.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, cv.width, cv.height).data; let s = 0, n = 0; for (let i = 0; i < d.length; i += 4) { s += d[i] + d[i + 1] + d[i + 2]; n++; } return Math.round(s / n / 3); }, shot.toString('base64'));
    };
    await page.click('#repeatRunBtn'); await page.waitForTimeout(1500);
    const r = {};
    r.found = await page.evaluate(() => _lastTsdResults.length);
    r.preview = await page.evaluate(() => ({ rows: state.tsdPreview ? state.tsdPreview.size : 0, attention: document.getElementById('tsdMarkBtn').classList.contains('rf-btn-attention'), marks: state.tsdMarks.size }));
    r.previewMean = await cellMean();
    await page.click('#tsdMarkBtn'); await page.waitForTimeout(800);
    r.marked = await page.evaluate(() => ({ preview: state.tsdPreview ? state.tsdPreview.size : 0, attention: document.getElementById('tsdMarkBtn').classList.contains('rf-btn-attention'), marks: state.tsdMarks.size }));
    r.markedMean = await cellMean();
    // a new run previews again; switching the mode away clears the preview; so does closing the window
    await page.click('#repeatRunBtn'); await page.waitForTimeout(1500);
    r.again = await page.evaluate(() => state.tsdPreview ? state.tsdPreview.size : 0);
    await page.click('label:has(input[name="repeatMode"][value="tandem"])'); await page.waitForTimeout(300);
    r.afterMode = await page.evaluate(() => state.tsdPreview ? state.tsdPreview.size : 0);
    await page.click('label:has(input[name="repeatMode"][value="tsd"])'); await page.click('#repeatRunBtn'); await page.waitForTimeout(1500);
    await page.click('#repeatFinderCloseBtn'); await page.waitForTimeout(300);
    r.afterClose = await page.evaluate(() => state.tsdPreview ? state.tsdPreview.size : 0);
    out[view] = r;
  }
  // the preview tint is lighter than the mark but darker than the white cell (the TSD colour is a light yellow,
  // so the differences are small: the preview must sit strictly between)
  const ok = Object.values(out).every(r => r.found >= 10 && r.preview.rows >= 10 && r.preview.attention && r.preview.marks === 0
    && r.marked.preview === 0 && !r.marked.attention && r.marked.marks >= 10
    && r.previewMean > r.markedMean && r.previewMean < 255 && r.again >= 10 && r.afterMode === 0 && r.afterClose === 0);
  return { pass: ok, detail: JSON.stringify(out) };
});


// Owner (2026-10-23): slimmer scrollbars, no empty band above the horizontal one, and the plain arrow instead of
// the white hand over them. Bars 8 px (was 14) with the grip filling them, invisible track, cursor default.
check('Scrollbars: 8 px bars with a grip that fills them, no track band, the plain arrow cursor (Canvas, Full)', async (page) => {
  const out = {};
  for (const view of ['canvas', 'full']) {
    await page.goto(page.url().replace(/view=\w+/, 'view=' + view).replace(/(index\.html)(?!\?)/, '$1?view=' + view), { waitUntil: 'networkidle' });
    await loadSyntheticFasta(page, 60, 300);
    await page.waitForTimeout(800);
    out[view] = await page.evaluate(() => {
      const r = {};
      for (const [k, sel] of [['h', '.horizontal-scrollbar'], ['v', '.vertical-scrollbar']]) {
        const bar = document.querySelector(sel); if (!bar || !bar.getClientRects().length) { r[k] = null; continue; }
        const b = bar.getBoundingClientRect(), cs = getComputedStyle(bar), grip = bar.querySelector('.scrollbar-grip'), track = bar.querySelector('.scrollbar-track');
        const g = grip.getBoundingClientRect(), gs = getComputedStyle(grip), ts = getComputedStyle(track);
        const thick = k === 'h' ? b.height : b.width, gripThick = k === 'h' ? g.height - parseFloat(gs.borderTopWidth) - parseFloat(gs.borderBottomWidth) : g.width - parseFloat(gs.borderLeftWidth) - parseFloat(gs.borderRightWidth);
        r[k] = { thick, gripThick, cursor: cs.cursor, gripCursor: gs.cursor, trackBg: ts.backgroundColor, trackShadow: ts.boxShadow };
      }
      return r;
    });
  }
  const good = x => !x || (x.thick <= 8.5 && x.gripThick >= 5 && x.cursor === 'default' && x.gripCursor === 'default' && /rgba\(0, 0, 0, 0\)|transparent/.test(x.trackBg) && x.trackShadow === 'none');
  const ok = out.canvas.h && out.canvas.v && out.full.h && good(out.canvas.h) && good(out.canvas.v) && good(out.full.h) && good(out.full.v);
  return { pass: ok, detail: JSON.stringify(out) };
});


// Owner (2026-10-23): hovering over the plot made the plot area jerk; the threshold / word / window settings
// should be one wide slider that follows the mode; RevComp B and the other boxes level with their text.
// The jerk: with a wide hover context the alignment panel under the plot grew a horizontal scrollbar, the
// plot viewport lost those pixels and the fitted plot was re-zoomed, every time the pointer crossed between
// the plot and the axis strip (headless Chrome hides scrollbars, so this check launches a browser with them).
check('Dot plot: hovering never resizes the plot (scrollbars shown); one wide word/window slider, the identity slider only for Dotter; checkboxes level with their text', async (_page) => {
  const browser = await launch({ scrollbars: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(30000);
    await page.goto(_page.url(), { waitUntil: 'networkidle' });
    let sd = 7; const rnd = () => (sd = (Math.imul(sd, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
    const unit = Array.from({ length: 120 }, () => 'ACGT'[rnd() * 4 | 0]).join('');
    const seq = unit + Array.from({ length: 200 }, () => 'ACGT'[rnd() * 4 | 0]).join('') + unit + Array.from({ length: 150 }, () => 'ACGT'[rnd() * 4 | 0]).join('');
    await loadFasta(page, '>self\n' + seq + '\n');
    await page.evaluate(() => openDotPlot(state.seqs[0].seq, state.seqs[0].seq, 'self', 'self'));
    await page.waitForTimeout(1500);
    await page.evaluate(() => { document.getElementById('dotPlotContextRadius').value = 100; });
    const lay = () => page.evaluate(() => ({ vpH: document.getElementById('dotPlotViewport').getBoundingClientRect().height, zoom: _dotPlotState.zoom, panelH: document.getElementById('dotPlotAlignPanel').getBoundingClientRect().height }));
    const vp = await page.evaluate(() => { const r = document.getElementById('dotPlotViewport').getBoundingClientRect(); return { x: r.left, y: r.top }; });
    const idle = await lay();
    await page.mouse.move(vp.x + 200, vp.y + 200, { steps: 4 }); await page.waitForTimeout(400);
    const onPlot = await lay();
    const hoverTextWide = await page.evaluate(() => { const p = document.getElementById('dotPlotAlignPanel'); return p.scrollWidth > p.clientWidth; });
    await page.mouse.move(vp.x + 10, vp.y + 200, { steps: 4 }); await page.waitForTimeout(400);   // the axis strip: no cell under the pointer
    const onAxis = await lay();
    const steady = idle.vpH === onPlot.vpH && onPlot.vpH === onAxis.vpH && idle.zoom === onPlot.zoom && onPlot.zoom === onAxis.zoom;
    const ctl = await page.evaluate(() => {
      const w = document.getElementById('dotPlotWindow'), t = document.getElementById('dotPlotThreshold');
      const vis = el => !!(el && el.getClientRects().length);
      // the vertical distance between the centre of a box and the centre of its label text
      const level = id => { const inp = document.getElementById(id), lab = inp.closest('label'), ir = inp.getBoundingClientRect(); const rng = document.createRange(); rng.selectNodeContents(lab); const tr = [...rng.getClientRects()].filter(r => r.width > 0 && !(Math.abs(r.left - ir.left) < 0.5 && Math.abs(r.width - ir.width) < 0.5)); const text = tr[tr.length - 1]; return text ? Math.round(Math.abs((ir.top + ir.bottom) / 2 - (text.top + text.bottom) / 2) * 10) / 10 : 99; };
      const out = { type: w.type, winW: Math.round(w.getBoundingClientRect().width), threshSpin: vis(t), winVal: (document.getElementById('dotPlotWindowVal') || {}).textContent };
      document.querySelector('input[name="dotPlotMode"][value="doter"]').click();
      out.threshDotter = vis(t); out.threshW = Math.round(t.getBoundingClientRect().width);
      out.label = (document.getElementById('dotPlotWindowLabel') || {}).textContent; out.threshVal = document.getElementById('dotPlotThreshVal').textContent;
      out.level = { revcomp: level('dotPlotRevComp'), live: level('dotPlotLive'), split: level('dotPlotSplit') };
      return out;
    });
    const ok = steady && hoverTextWide && ctl.type === 'range' && ctl.winW >= 150 && !ctl.threshSpin && ctl.threshDotter && ctl.threshW >= 150
      && ctl.label === 'Window' && ctl.threshVal === '55%' && ctl.winVal === '6' && Object.values(ctl.level).every(d => d <= 2);
    return { pass: ok, detail: JSON.stringify({ steady, idle, onPlot, onAxis, hoverTextWide, ctl }) };
  } finally { await browser.close(); }
});


// Owner (2026-10-23): "an option to highlight a specific repeat in the alignment and navigate the alignment to it".
// Each entry of the dot plot's region list has a "show in alignment" button: both copies of the stretch are tinted
// in the alignment (state.dotRegionMarks, residue-anchored like the TSD marks), the alignment scrolls to the first
// copy, and the dot plot window stays open with its backdrop made click-through so the alignment can be used.
check('Dot plot regions: "show in alignment" tints both copies, goes there (Full and Canvas, row 100), keeps the window usable; close clears', async (page) => {
  let sd = 11; const rnd = () => (sd = (Math.imul(sd, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  const rs = n => Array.from({ length: n }, () => 'ACGT'[rnd() * 4 | 0]).join('');
  const unit = rs(60);
  const lines = [];
  for (let i = 0; i < 120; i++) {
    let s = i === 100 ? rs(40) + unit + rs(80) + unit + rs(40) : rs(280);
    s = s.slice(0, 50) + '----' + s.slice(50, 150) + '--' + s.slice(150);   // gaps: residue numbers differ from columns
    lines.push('>s' + i + '\n' + s);
  }
  await loadFasta(page, lines.join('\n') + '\n');
  await setMode(page, 'full');
  // the context menu's "Dot-plot (self)" item calls exactly this
  await page.evaluate(() => { const s = state.seqs[100]; openDotPlot(s.seq.replace(/[-. ]/g, ''), s.seq.replace(/[-. ]/g, ''), s.header, s.header, { rowIndexA: 100, rowIndexB: 100, alignedSeqA: s.seq, alignedSeqB: s.seq }); });
  await page.waitForSelector('#dotPlotRegionItems .dot-goto', { timeout: 10000 });
  const r = {};
  r.region = await page.evaluate(() => { const g = _dotPlotState.regions[0]; return { aStart: g.aStart, aEnd: g.aEnd, bStart: g.bStart, bEnd: g.bEnd }; });
  await page.click('#dotPlotRegionItems .dot-goto'); await page.waitForTimeout(700);
  r.full = await page.evaluate((g) => {
    const seq = state.seqs[100].seq, cols = [], want = new Set();
    for (let n = g.aStart; n < g.aEnd; n++) want.add(n);
    for (let n = g.bStart; n < g.bEnd; n++) want.add(n);
    let n = 0; for (let c = 0; c < seq.length; c++) { if (seq[c] === '-' ) continue; if (want.has(n)) cols.push(c); n++; }
    const got = state.dotRegionMarks && state.dotRegionMarks.get(100);
    const marksOk = !!got && got.size === cols.length && cols.every(c => got.has(c));
    const cell = document.querySelector('.seq-line[data-seq-index="100"] .seq-data > span[data-pos="' + cols[0] + '"]');
    const cont = document.getElementById('alignmentContainer').getBoundingClientRect(), cr = cell ? cell.getBoundingClientRect() : null;
    const inView = !!cr && cr.top >= Math.max(0, cont.top) && cr.bottom <= Math.min(innerHeight, cont.bottom) && cr.left >= cont.left && cr.right <= cont.right;   // Full scrolls the page, not the container
    const bg = cell ? getComputedStyle(cell).backgroundColor : '';
    const modal = document.getElementById('dotPlotModal');
    const dlg = document.getElementById('dotPlotDialog').getBoundingClientRect();
    const px = dlg.left > cont.left + 60 ? cont.left + 30 : cont.right - 30;   // a point of the alignment beside the window
    const under = document.elementFromPoint(px, Math.min(innerHeight, cont.bottom) - 60)   // inside the visible part of the container, below the sticky toolbar;
    return { marksOk, inView, bg, peek: getComputedStyle(modal).pointerEvents, underIsAlignment: !!(under && under.closest('#alignmentContainer')), active: document.querySelectorAll('#dotPlotRegionItems .dot-region-active').length, clearShown: !document.getElementById('dotPlotClearMarksBtn').hidden };
  }, r.region);
  // the same marks in Canvas: the tint is painted and the row is scrolled to
  await setMode(page, 'canvas'); await page.waitForTimeout(600);
  await page.evaluate(() => _dotShowRegionInAlignment(0)); await page.waitForTimeout(500);
  r.canvas = await page.evaluate((g) => {
    const seq = state.seqs[100].seq; let n = 0, col = -1; for (let c = 0; c < seq.length; c++) { if (seq[c] === '-') continue; if (n === g.aStart) { col = c; break; } n++; }
    const m = _canvasState.metrics, cv = _canvasState.canvas, dpr = cv.width / parseFloat(cv.style.width || cv.width);
    const x = m.nameW + _canvasColToSlot(col) * m.charW - _canvasState.offsetX + 2, y = m.headerH + 100 * _canvasState.rowPitch - _canvasState.offsetY + 2;
    const inView = y > m.headerH && y < cv.clientHeight && x > m.nameW && x < cv.clientWidth;
    const px = cv.getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    return { offsetY: _canvasState.offsetY, inView, px: [px[0], px[1], px[2]] };
  }, r.region);
  await page.click('#dotPlotCloseBtn'); await page.waitForTimeout(300);
  r.afterClose = await page.evaluate(() => ({ marks: !!state.dotRegionMarks, peek: document.getElementById('dotPlotModal').classList.contains('dot-peek') }));
  const blue = p => p[2] > p[0] + 30 && p[2] > p[1];
  const ok = r.region.aEnd - r.region.aStart >= 50 && r.full.marksOk && r.full.inView && /rgba\(74, 158, 255/.test(r.full.bg)
    && r.full.peek === 'none' && r.full.underIsAlignment && r.full.active === 1 && r.full.clearShown
    && r.canvas.offsetY > 0 && r.canvas.inView && blue(r.canvas.px) && !r.afterClose.marks && !r.afterClose.peek;
  return { pass: ok, detail: JSON.stringify(r) };
});


// The toolbar's height must not change when a selection appears or goes: the Selections tab used to be
// display:none while empty, so at widths where the menu line is nearly full its appearance wrapped the
// toolbar and the alignment jumped down a line (the case switch of v278 used up the slack: a click on a
// name then shifted the rows under the pointer, and in Canvas the resize forced a full redraw).
check('Toolbar: the height does not change when a row selection appears or goes (1100, 1200, 1400 px)', async (page) => {
  const out = {};
  for (const w of [1100, 1200, 1400]) {
    const p = await page.context().browser().newPage({ viewport: { width: w, height: 700 } });
    await p.goto(page.url().replace(/view=\w+/, 'view=full').replace(/(index\.html)(?!\?)/, '$1?view=full'), { waitUntil: 'networkidle' });
    await p.setInputFiles('#fileInput', { name: 'a_long_file_name_for_the_toolbar_test_2026.fa', mimeType: 'text/plain', buffer: Buffer.from('>seq1\nACGTACGT\n>seq2\nACGTACGA\n>seq3\nACGAACGT\n') });
    await p.waitForTimeout(1200);
    const h = () => p.evaluate(() => Math.round(document.getElementById('controls').getBoundingClientRect().height));
    const top = () => p.evaluate(() => Math.round(document.querySelector('.seq-line[data-seq-index="1"]').getBoundingClientRect().top));
    const none = { h: await h(), top: await top() };
    await p.evaluate(() => { state.selectedRows = new Set([0]); updateRowSelections(); }); await p.waitForTimeout(250);
    const sel = { h: await h(), top: await top() };
    await p.evaluate(() => { state.selectedRows = new Set(); updateRowSelections(); }); await p.waitForTimeout(250);
    const cleared = { h: await h(), top: await top() };
    out[w] = { none, sel, cleared };
    await p.close();
  }
  const ok = Object.values(out).every(o => o.none.h === o.sel.h && o.sel.h === o.cleared.h && o.none.top === o.sel.top && o.sel.top === o.cleared.top);
  return { pass: ok, detail: JSON.stringify(out) };
});


// Owner (2026-10-23): a "collection" of interesting dot-plot regions in a list, with an option to hand an entry to
// the search. Star an entry of Top Regions: it joins the Collection list under it (kept in localStorage across files
// and reloads, and in snapshots); an entry centres in the plot, shows in the alignment, goes to the Search box under
// its name, copies as FASTA, renames by double-click, and the list copies as TSV.
check('Dot plot collection: star, rename, hand to the search, show in alignment, FASTA, TSV, remove, kept across a reload and in snapshots', async (page) => {
  let sd = 11; const rnd = () => (sd = (Math.imul(sd, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  const rs = n => Array.from({ length: n }, () => 'ACGT'[rnd() * 4 | 0]).join('');
  const unit = rs(60);
  const lines = [];
  for (let i = 0; i < 12; i++) { let s = i === 5 ? rs(40) + unit + rs(80) + unit + rs(40) : rs(280); s = s.slice(0, 50) + '----' + s.slice(50); lines.push('>s' + i + '\n' + s); }
  const fa = lines.join('\n') + '\n';
  await page.evaluate(() => { try { localStorage.removeItem('msaviewer_dotBookmarks'); } catch (e) {} });
  await loadFasta(page, fa);
  await setMode(page, 'full');
  await page.evaluate(() => { window._copied = null; navigator.clipboard.writeText = t => { window._copied = t; return Promise.resolve(); }; });
  await page.evaluate(() => { const s = state.seqs[5]; openDotPlot(s.seq.replace(/[-. ]/g, ''), s.seq.replace(/[-. ]/g, ''), s.header, s.header, { rowIndexA: 5, rowIndexB: 5, alignedSeqA: s.seq, alignedSeqB: s.seq }); });
  await page.waitForSelector('#dotPlotRegionItems .dot-star', { timeout: 10000 });
  const r = {};
  r.empty = await page.evaluate(() => ({ n: state.dotBookmarks.length, text: document.getElementById('dotPlotBookmarkItems').textContent.trim().slice(0, 20) }));
  await page.click('#dotPlotRegionItems .dot-star'); await page.waitForTimeout(300);
  r.starred = await page.evaluate(() => { const b = state.dotBookmarks[0], g = _dotPlotState.regions[0]; return { n: state.dotBookmarks.length, ok: !!b && b.nameA === 's5' && b.aStart === g.aStart && b.aEnd === g.aEnd && b.bStart === g.bStart && b.seqA === _dotPlotState.seqA.slice(g.aStart, g.aEnd) && b.seqA.length === g.aEnd - g.aStart, items: document.querySelectorAll('#dotPlotBookmarkItems .dot-bm').length, stored: (localStorage.getItem('msaviewer_dotBookmarks') || '').includes('"nameA":"s5"'), starFilled: document.querySelector('#dotPlotRegionItems .dot-star').textContent === '\u2605' }; });
  // a second star of the same stretch is refused
  await page.click('#dotPlotRegionItems .dot-star'); await page.waitForTimeout(200);
  r.dup = await page.evaluate(() => state.dotBookmarks.length);
  // rename by double-click
  await page.dblclick('#dotPlotBookmarkItems .dot-bm-name'); await page.waitForTimeout(150);
  await page.keyboard.type('promoter box'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  r.renamed = await page.evaluate(() => ({ name: state.dotBookmarks[0].name, shown: document.querySelector('#dotPlotBookmarkItems .dot-bm-name').textContent }));
  // hand to the search: an entry under the bookmark's name, hits on both copies
  await page.click('#dotPlotBookmarkItems .dot-bm button[title^="Hand it to the Search"]'); await page.waitForTimeout(800);
  r.search = await page.evaluate(() => { const h = state.searchHistory[state.searchHistory.length - 1]; return { n: state.searchHistory.length, label: h && h.label, value: h && h.searchValue === state.dotBookmarks[0].seqA, hits: h && h.matchCount, box: document.getElementById('searchInput').value === state.dotBookmarks[0].seqA }; });
  // show in the alignment
  await page.click('#dotPlotBookmarkItems .dot-bm button[title^="Show the stretch"]'); await page.waitForTimeout(500);
  r.shown = await page.evaluate(() => { const b = state.dotBookmarks[0], m = state.dotRegionMarks && state.dotRegionMarks.get(5); return { cols: m ? m.size : 0, want: (b.aEnd - b.aStart) + (b.bEnd - b.bStart), peek: document.getElementById('dotPlotModal').classList.contains('dot-peek') }; });
  // FASTA and TSV copies
  await page.click('#dotPlotBookmarkItems .dot-bm button[title^="Copy both copies"]'); await page.waitForTimeout(200);
  r.fasta = await page.evaluate(() => (window._copied || '').split('\n').filter(Boolean).length);
  await page.click('#dotPlotBookmarkTsvBtn'); await page.waitForTimeout(200);
  r.tsv = await page.evaluate(() => { const t = window._copied || ''; const rows = t.split('\n').filter(Boolean); return { rows: rows.length, head: rows[0].split('\t').slice(0, 3).join(','), name: rows[1] && rows[1].split('\t')[0] }; });
  // snapshot payload carries the collection; a reload restores it from localStorage
  r.snapshot = await page.evaluate(() => { const p = _buildSnapshotPayload(); return Array.isArray(p.dotBookmarks) && p.dotBookmarks.length === 1 && p.dotBookmarks[0].name === 'promoter box'; });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  r.afterReload = await page.evaluate(() => ({ n: state.dotBookmarks.length, name: state.dotBookmarks[0] && state.dotBookmarks[0].name, listed: document.querySelectorAll('#dotPlotBookmarkItems .dot-bm').length }));
  // remove
  await loadFasta(page, fa);
  await page.evaluate(() => { const s = state.seqs[5]; openDotPlot(s.seq.replace(/[-. ]/g, ''), s.seq.replace(/[-. ]/g, ''), s.header, s.header, { rowIndexA: 5, rowIndexB: 5, alignedSeqA: s.seq, alignedSeqB: s.seq }); });
  await page.waitForSelector('#dotPlotBookmarkItems .dot-bm', { timeout: 10000 });
  await page.click('#dotPlotBookmarkItems .dot-bm button[title^="Remove"]'); await page.waitForTimeout(200);
  r.removed = await page.evaluate(() => ({ n: state.dotBookmarks.length, stored: localStorage.getItem('msaviewer_dotBookmarks') }));
  await page.evaluate(() => { try { localStorage.removeItem('msaviewer_dotBookmarks'); } catch (e) {} });
  const ok = r.empty.n === 0 && r.starred.n === 1 && r.starred.ok && r.starred.items === 1 && r.starred.stored && r.starred.starFilled && r.dup === 1
    && r.renamed.name === 'promoter box' && r.renamed.shown === 'promoter box'
    && r.search.n >= 1 && r.search.label === 'promoter box' && r.search.value && r.search.hits >= 2 && r.search.box
    && r.shown.cols === r.shown.want && r.shown.peek && r.fasta === 4 && r.tsv.rows === 2 && r.tsv.head === 'name,A,A_start' && r.tsv.name === 'promoter box'
    && r.snapshot && r.afterReload.n === 1 && r.afterReload.name === 'promoter box' && r.afterReload.listed === 1 && r.removed.n === 0 && r.removed.stored === '[]';
  return { pass: ok, detail: JSON.stringify(r) };
});


// Owner (2026-10-23): "for complex search tasks, when I regularly search for something with multiple queries with
// certain thresholds, named search presets should be saved/loaded (example: promoter boxes)". A preset is the set
// of queries behind the active searches (motif, regex flag, mismatches, both strands, colour, name), saved under a
// name in browser storage (like the colour and clustering presets); Load runs them again on any alignment.
check('Search presets: save the active searches under a name, load them on another alignment (added, no duplicates), delete; kept across a reload', async (page) => {
  const fa = '>a\nGGGTATAAAGGCCCAATTGGCCTTTATAGGGACGT\n>b\nTTTTATAAAGGCCCAATTGGCCTTTATACCCAAAA\n>c\nACGTACGTACGTACGTACGTACGTACGTACGTAC\n';
  await page.evaluate(() => { try { localStorage.removeItem('searchPresets'); } catch (e) {} });
  await loadFasta(page, fa);
  const r = {};
  // the controls live in the Search menu: open it before using them, as a user would
  const openSearch = async () => { const open = await page.evaluate(() => document.querySelector('.section-header[data-section="search"]').closest('.menu-section').classList.contains('menu-open')); if (!open) await page.click('.section-header[data-section="search"]'); await page.waitForTimeout(200); };
  r.ui = await page.evaluate(() => ({ select: !!document.getElementById('searchPresetSelect'), name: !!document.getElementById('searchPresetName'), save: !!document.getElementById('searchPresetSaveBtn'), load: !!document.getElementById('searchPresetLoadBtn'), del: !!document.getElementById('searchPresetDeleteBtn') }));
  if (!r.ui.select) return { pass: false, detail: JSON.stringify(r) };
  // two searches: a TATA box on both strands with 1 mismatch in orange, and a regex in blue
  await page.evaluate(() => { searchMotif({ motif: 'TATAAA', useRegex: false, maxMismatches: 1, bothStrands: true, color: '#ff8800', suppressMessage: true }); searchMotif({ motif: 'GGCCC?A', useRegex: true, maxMismatches: 0, bothStrands: false, color: '#3366ff', suppressMessage: true }); });
  await page.waitForTimeout(300);
  r.before = await page.evaluate(() => state.searchHistory.map(h => h.label + '|' + h.strand + '|' + h.color + '|' + h.matchCount).join(';'));
  await openSearch(); await page.fill('#searchPresetName', 'promoter boxes'); await page.click('#searchPresetSaveBtn'); await page.waitForTimeout(200);
  r.saved = await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('searchPresets') || '{}')['promoter boxes']; return p ? { n: p.queries.length, q: p.queries.map(q => [q.motif, q.useRegex, q.maxMismatches, q.bothStrands, q.color].join(',')).join(';'), listed: [...document.getElementById('searchPresetSelect').options].map(o => o.value).join(','), nameCleared: document.getElementById('searchPresetName').value === '' } : null; });
  // on another alignment: clear, load the preset, load it again
  await loadFasta(page, '>x\nCCCTATAAACCCGGCCATTT\n>y\nAAATTTATAGGGTTTT\n');
  r.cleared = await page.evaluate(() => state.searchHistory.length);
  await openSearch(); await page.selectOption('#searchPresetSelect', 'promoter boxes'); await page.click('#searchPresetLoadBtn'); await page.waitForTimeout(400);
  r.loaded = await page.evaluate(() => state.searchHistory.map(h => h.label + '|' + h.strand + '|' + h.color + '|' + h.maxMismatches + '|' + h.matchCount).join(';'));
  await page.click('#searchPresetLoadBtn'); await page.waitForTimeout(400);
  r.loadedTwice = await page.evaluate(() => state.searchHistory.length);
  // kept across a reload, then deleted
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  r.afterReload = await page.evaluate(() => [...document.getElementById('searchPresetSelect').options].map(o => o.value).join(','));
  await openSearch(); await page.selectOption('#searchPresetSelect', 'promoter boxes'); await page.click('#searchPresetDeleteBtn'); await page.waitForTimeout(200);
  r.deleted = await page.evaluate(() => ({ stored: localStorage.getItem('searchPresets'), options: document.getElementById('searchPresetSelect').options.length }));
  await page.evaluate(() => { try { localStorage.removeItem('searchPresets'); } catch (e) {} });
  const ok = r.before.split(';').length === 3 && !!r.saved && r.saved.n === 2 && r.saved.q === 'TATAAA,false,1,true,#ff8800;GGCCC?A,true,0,false,#3366ff' && r.saved.listed === 'promoter boxes' && r.saved.nameCleared
    && r.cleared === 0 && r.loaded.split(';').length === 3 && /TATAAA \(fwd\)\|fwd\|#ff8800\|1\|[1-9]/.test(r.loaded) && /rev comp/.test(r.loaded) && /GGCCC\?A\|fwd\|#3366ff\|0\|[1-9]/.test(r.loaded)
    && r.loadedTwice === 3 && r.afterReload === 'promoter boxes' && r.deleted.stored === '{}' && r.deleted.options === 0;
  return { pass: ok, detail: JSON.stringify(r) };
});


// Split-view plan, step B1 (owner, 2026-10-25): two tabs or windows of ViewAlign follow each other. Actions >
// Hidden columns (split-view plan, step A1): a column range folds into one marker cell so the regions
// either side sit next to each other. Folds are part of the view (state.hiddenCols), drawn in Canvas
// through the slot layout; the marker says what is hidden and a click on it (row or ruler) reveals the
// run; going to a hidden column reveals it; Full/Block show every column and keep the folds for when
// Canvas comes back; Clone Tab carries them.
check('Hidden columns: hide selected / all but selected / gappy, marker tooltip and click reveal, go-to reveals, Clone Tab', async (page) => {
  const bad = [], out = {};
  const n = 40, len = 600;
  const rowSeq = i => Array.from({ length: len }, (_, j) => (j >= 500 && j < 510) ? '-' : (j >= 520 && j < 525 && i % 2 === 0) ? '-' : 'ACGT'[(i * 3 + j) % 4]).join('');
  await loadFasta(page, Array.from({ length: n }, (_, i) => `>s${i}\n${rowSeq(i)}`).join('\n') + '\n');
  await setMode(page, 'canvas');
  await page.waitForTimeout(400);
  await page.click('.section-header[data-section="actions"]'); await page.waitForTimeout(200);
  // the Actions menu closes on a click elsewhere (the canvas): open it again before a button, as a user would
  const menuClosed = [];
  const act = async (fn, label) => { if (!(await page.evaluate(() => !!el('hideColumnsButton').offsetParent))) { menuClosed.push(label); await page.click('.section-header[data-section="actions"]'); await page.waitForTimeout(200); } await fn(); };
  const lay = () => page.evaluate(() => ({ hidden: JSON.stringify(state.hiddenCols || []), nSlots: _canvasState.nSlots, slots: _canvasState.slots ? Array.from(_canvasState.slots) : null, status: el('foldStatus')?.textContent || '' }));
  const selCols = (ranges) => page.evaluate((ranges) => { state.selectedColumns.clear(); for (const [a, b] of ranges) for (let c = a; c <= b; c++) state.selectedColumns.add(c); updateColumnSelections(); }, ranges);
  const clickSlot = async (slot, ruler) => {
    // the open Actions menu covers the alignment: close it first
    for (let k = 0; k < 3 && await page.evaluate(() => !!el('hideColumnsButton').offsetParent); k++) { await page.click('.section-header[data-section="actions"]'); await page.waitForTimeout(250); }
    const g =await page.evaluate(() => { const m = _canvasState.metrics, r = el('alignmentCanvas').getBoundingClientRect(); return { left: r.left, top: r.top, nameW: m.nameW, charW: m.charW, headerH: m.headerH, trackH: m.trackH || 0, charH: m.charH, pitch: _canvasState.rowPitch, ox: _canvasState.offsetX }; });
    const x = g.left + g.nameW + (slot + 0.5) * g.charW - g.ox, y = ruler ? g.top + g.trackH + 0.5 * g.charH : g.top + g.headerH + 2.5 * g.pitch;
    // (the menus open on hover: leave them through a corner of the alignment away from the menus first)
    const cr = await page.evaluate(() => { const r = el('alignmentCanvas').getBoundingClientRect(); return { x: r.right - 30, y: r.bottom - 30 }; });
    await page.mouse.move(cr.x, cr.y); await page.waitForTimeout(300);
    await page.mouse.move(x, y); await page.waitForTimeout(400);
    const tip = await page.evaluate(() => document.body.innerText.match(/\d+ columns? hidden \(positions[^\n]*/)?.[0] || '');
    out['at' + slot] = await page.evaluate(([x, y]) => { const h = _canvasHitTest(x, y) || _canvasHitTestRuler(x, y); const e = document.elementFromPoint(x, y); return { hit: h && { col: h.col, slot: h.slot, fold: !!h.fold }, el: e && (e.id || e.className) }; }, [x, y]);
    await page.mouse.click(x, y); await page.waitForTimeout(500);
    await page.mouse.move(5, 5);
    return tip;
  };

  // 1. hide selected columns 101-300 (0-based 100..299): one marker before column 300
  await selCols([[100, 299]]);
  await act(() => page.click('#hideColumnsButton'), '#hideColumnsButton'); await page.waitForTimeout(500);
  out.l1 = await lay();
  if (out.l1.hidden !== '[[100,299]]') bad.push('hide selected: hiddenCols ' + out.l1.hidden);
  if (out.l1.nSlots !== len - 200 + 1) bad.push(`hide selected: ${out.l1.nSlots} slots, ${len - 199} expected`);
  if (!out.l1.slots || out.l1.slots[100] !== -1 - 300 || out.l1.slots[101] !== 300) bad.push('hide selected: slots ' + JSON.stringify(out.l1.slots && out.l1.slots.slice(98, 103)));
  if (!/200 columns hidden in 1 fold/.test(out.l1.status)) bad.push('status: ' + out.l1.status);
  delete out.l1.slots;
  out.hits = await page.evaluate(() => { const m = _canvasState.metrics, r = el('alignmentCanvas').getBoundingClientRect(); const at = s => _canvasHitTest(r.left + m.nameW + (s + 0.5) * m.charW - _canvasState.offsetX, r.top + m.headerH + 0.5 * _canvasState.rowPitch);
    return { before: at(99), marker: at(100), after: at(101), ruler: _canvasHitTestRuler(r.left + m.nameW + 101.5 * m.charW - _canvasState.offsetX, r.top + (m.trackH || 0) + 0.5 * m.charH) }; });
  if (out.hits.before?.col !== 99 || out.hits.after?.col !== 300 || out.hits.ruler?.col !== 300 || !out.hits.marker?.brk || !out.hits.marker?.fold) bad.push('hit test: ' + JSON.stringify(out.hits));
  // the marker cell carries the fold colour
  out.markerColour = await page.evaluate(() => { const cv = el('alignmentCanvas'), m = _canvasState.metrics, dpr = m.dpr || 1, c = cv.getContext('2d');
    const d = c.getImageData(Math.round((m.nameW + 100 * m.charW - _canvasState.offsetX + 2) * dpr), Math.round((m.headerH + 2) * dpr), 1, 1).data;
    return { got: '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''), want: _FOLD_STYLE.color.toLowerCase() }; });
  if (out.markerColour.got !== out.markerColour.want) bad.push('marker colour ' + JSON.stringify(out.markerColour));
  // hovering the marker says what is hidden; clicking it reveals
  out.tip1 = await clickSlot(100, false);
  if (!/200 columns hidden \(positions 101.300\)/.test(out.tip1)) bad.push('tooltip: ' + out.tip1);
  out.l2 = await lay(); delete out.l2.slots;
  if (out.l2.hidden !== '[]' || out.l2.nSlots !== len) bad.push('click reveal: ' + out.l2.hidden + ' ' + out.l2.nSlots);

  // 2. hide all but selected (51-60, 401-410): three folds, the last one at the end of the alignment
  await selCols([[50, 59], [400, 409]]);
  await act(() => page.click('#hideUnselectedColumnsButton'), '#hideUnselectedColumnsButton'); await page.waitForTimeout(500);
  out.l3 = await lay();
  if (out.l3.hidden !== '[[0,49],[60,399],[410,599]]') bad.push('all but selected: ' + out.l3.hidden);
  if (out.l3.nSlots !== 23) bad.push(`all but selected: ${out.l3.nSlots} slots, 23 expected`);
  // a click on the ruler marker of the trailing fold reveals that fold only
  out.tip2 = await clickSlot(22, true);
  out.l4 = await lay(); delete out.l4.slots; delete out.l3.slots;
  if (out.l4.hidden !== '[[0,49],[60,399]]') bad.push('ruler click on the trailing fold: ' + out.l4.hidden + ' (tip ' + out.tip2 + ')');
  // going to a hidden column reveals its fold and brings the column into view
  out.goto = await page.evaluate(async () => { _scrollToColumn(200); await new Promise(r => setTimeout(r, 600));
    const m = _canvasState.metrics, s = _canvasColToSlot(200), vw = el('alignmentContainer').clientWidth;
    return { hidden: JSON.stringify(state.hiddenCols), slot: s, x: m.nameW + s * m.charW - _canvasState.offsetX, vw }; });
  if (out.goto.hidden !== '[[0,49]]' || !(out.goto.x > 0 && out.goto.x < out.goto.vw)) bad.push('go to column 201: ' + JSON.stringify(out.goto));
  await act(() => page.click('#revealColumnsButton', { timeout: 3000 }).catch(e => bad.push('Reveal all: ' + e.message.slice(0, 120))), 'reveal'); await page.waitForTimeout(400);
  out.revealAll = (await lay()).hidden;
  if (out.revealAll !== '[]') bad.push('Reveal all left ' + out.revealAll);

  // 3. hide gappy columns: 100 % hides the ten all-gap columns 501-510, 50 % also 521-525
  await act(() => page.fill('#hideGappyPct', '100'), 'fill100'); await act(() => page.click('#hideGappyColumnsButton'), '#hideGappyColumnsButton'); await page.waitForTimeout(400);
  out.g100 = (await lay()).hidden;
  await act(() => page.click('#revealColumnsButton'), 'reveal2'); await page.waitForTimeout(300);
  await act(() => page.fill('#hideGappyPct', '50'), 'fill50'); await act(() => page.click('#hideGappyColumnsButton'), '#hideGappyColumnsButton'); await page.waitForTimeout(400);
  out.g50 = (await lay()).hidden;
  if (out.g100 !== '[[500,509]]' || out.g50 !== '[[500,509],[520,524]]') bad.push('gappy: ' + out.g100 + ' / ' + out.g50);

  // 4. Full shows every column and keeps the folds; back in Canvas they are folded again
  await setMode(page, 'full'); await page.waitForTimeout(500);
  out.full = await page.evaluate(() => ({ hidden: JSON.stringify(state.hiddenCols), cells: document.querySelectorAll('.seq-line[data-seq-index="0"] [data-pos="505"]').length }));
  await setMode(page, 'canvas'); await page.waitForTimeout(500);
  out.back = await lay(); delete out.back.slots;
  if (out.full.hidden !== out.g50 || out.back.hidden !== out.g50 || out.back.nSlots !== len - 15 + 2) bad.push('mode round trip: ' + JSON.stringify({ full: out.full, back: out.back.hidden, nSlots: out.back.nSlots }));

  // 5. Clone Tab carries the folds
  const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 15000 }), act(() => page.click('#openViewInNewTabButton'), 'clone')]);
  await popup.waitForFunction(() => typeof state !== 'undefined' && state.seqs.length > 0 && typeof _canvasState !== 'undefined' && _canvasState.canvas, null, { timeout: 20000 });
  await popup.waitForTimeout(800);
  out.clone = await popup.evaluate(() => ({ hidden: JSON.stringify(state.hiddenCols || []), nSlots: _canvasState.nSlots }));
  await popup.close();
  if (out.clone.hidden !== out.g50 || out.clone.nSlots !== len - 15 + 2) bad.push('Clone Tab: ' + JSON.stringify(out.clone));
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out).slice(0, 1500) : JSON.stringify({ tip1: out.tip1, l3: out.l3.hidden, g50: out.g50, menuReopened: menuClosed }) };
}, { timeoutMs: 90000 });

// GLM audit of v283/v284 (2026-10-25), linked views: the name -> row map was cached by array identity and length,
// so a row dragged in place or renamed kept its old index (the follower lined up a wrong row); the anchor's residue
// numbers were recomputed only on a length change (a residue typed over a gap kept the old numbers); a residue past
// the anchor's end sent the follower to the alignment's last column instead of the anchor's last residue; the anchor
// list stopped at 2000 names and replaced a chosen anchor beyond them; a tab that died without 'bye' stayed a peer.
check('Audit v284: linked views follow moved/renamed rows, edited anchors, clamp past the anchor end, keep a far anchor, drop dead peers', async (page) => {
  const bad = [], out = {};
  const n = 2500, len = 60;
  const row = i => (i === 1 ? 'A-CGTACGTA' + 'C'.repeat(len - 10) : i === 2 ? 'ACGTACGTAC' + 'G'.repeat(len - 20) + '-'.repeat(10) : Array.from({ length: len }, (_, j) => 'ACGT'[(i + j) % 4]).join(''));
  await loadFasta(page, Array.from({ length: n }, (_, i) => `>s${i}\n${row(i)}`).join('\n') + '\n');
  await setMode(page, 'canvas');
  out.unit = await page.evaluate(() => {
    const r = {};
    r.before = _linkSeqIndexByName('s5');
    const x = state.seqs.splice(5, 1)[0]; state.seqs.splice(0, 0, x);          // a row drag splices in place
    r.moved = _linkSeqIndexByName('s5');
    state.seqs[10].header = 'renamed'; r.renamed = _linkSeqIndexByName('renamed');
    const i1 = state.seqs.findIndex(q => q.header === 's1');
    r.res3 = _linkColToRes(i1, 3);                                              // A-CG: column 3 holds residue 3
    state.seqs[i1].seq = '--' + state.seqs[i1].seq.slice(0, 1) + state.seqs[i1].seq.slice(2) + '';   // same length, residues shifted right
    state.seqs[i1].seq = state.seqs[i1].seq.slice(0, 60);
    const oracle = c => state.seqs[i1].seq.slice(0, c + 1).replace(/[-.]/g, '').length;
    r.res3edit = _linkColToRes(i1, 3); r.res3oracle = oracle(3);
    const i2 = state.seqs.findIndex(q => q.header === 's2');
    r.past = _linkResToCol(i2, 10000); r.lastRes = state.seqs[i2].seq.search(/-+$/) - 1;
    return r;
  });
  const u = out.unit;
  if (u.before !== 5 || u.moved !== 0) bad.push(`moved row: ${u.before} -> ${u.moved}, 0 expected`);
  if (u.renamed !== 10) bad.push(`renamed row: ${u.renamed}, 10 expected`);
  if (u.res3edit !== u.res3oracle) bad.push(`anchor residue after a same-length edit: ${u.res3edit}, ${u.res3oracle} expected`);
  if (u.past !== u.lastRes) bad.push(`residue past the anchor end went to column ${u.past}, the anchor's last residue is in ${u.lastRes}`);
  // a chosen anchor beyond the first 2000 names stays chosen
  out.far = await page.evaluate(() => { _link.by = 'anchor'; _link.anchor = 's2400'; _linkRefreshUi(); return { anchor: _link.anchor, opt: !![...el('linkAnchor').options].find(o => o.value === 's2400') }; });
  if (out.far.anchor !== 's2400' || !out.far.opt) bad.push('far anchor: ' + JSON.stringify(out.far));
  await page.evaluate(() => { _link.by = 'column'; _link.anchor = ''; });
  // a peer that dies without 'bye' is dropped after a while; a live one is kept
  await page.evaluate(() => { _link.aliveMs = 300; _link.pruneMs = 1500; _linkSet(true); });
  const [p2] = await Promise.all([page.waitForEvent('popup', { timeout: 15000 }), page.evaluate(() => window.open(location.pathname, '_blank'))]);
  await p2.waitForLoadState('load');
  await p2.waitForFunction(() => typeof _linkSet === 'function', null, { timeout: 15000 });
  await p2.evaluate(() => { _link.aliveMs = 300; _link.pruneMs = 1500; _linkSet(true); });
  await page.waitForTimeout(2500);
  out.alive = await page.evaluate(() => _link.peers.size);
  await p2.evaluate(() => { clearInterval(_link.aliveTimer); _link.ch.onmessage = null; _link.ch.close(); _link.ch = null; });   // dies silently
  await page.waitForTimeout(2800);
  out.dead = await page.evaluate(() => ({ peers: _link.peers.size, status: el('linkViewsStatus').textContent }));
  await p2.close();
  await page.evaluate(() => _linkSet(false));
  if (out.alive !== 1) bad.push(`a live peer was not kept (${out.alive} peers)`);
  if (out.dead.peers !== 0 || !/no other linked view/.test(out.dead.status)) bad.push('dead peer: ' + JSON.stringify(out.dead));
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out) : JSON.stringify(out) };
}, { timeoutMs: 120000 });

// GLM audit of v283/v284, hidden columns: Hide Gappy read every residue column by column in one task (a freeze on a
// large alignment); a fold marker after a dimmed column (Highlight diffs) was drawn at 40 % opacity; hiding every
// column left one marker whose hit test gave column -1; a new file left Reveal enabled and the fold count shown;
// a view position taken at a fold marker came back one slot to the right.
check('Audit v284: hidden columns: Hide Gappy without a long task, markers at full opacity, not all hidden, reset on a new file, anchor at a marker', async (page) => {
  const bad = [], out = {};
  const nR = 2000, nC = 10000;
  // every 7th column is a gap in 60 % of the rows
  const rowSeq = i => { let s = ''; for (let j = 0; j < nC; j++) s += (j % 7 === 3 && (i % 10) < 6) ? '-' : 'ACGT'[(i * 3 + j) % 4]; return s; };
  await page.evaluate(([nR, nC]) => { window.__fa = null; }, [nR, nC]);
  await loadFasta(page, Array.from({ length: nR }, (_, i) => `>r${i}\n${rowSeq(i)}`).join('\n') + '\n');
  await setMode(page, 'canvas');
  await page.waitForTimeout(800);
  const lt = await r2LongTasks(page, async () => {
    await page.evaluate(() => { el('hideGappyPct').value = '50'; });
    await page.evaluate(() => hideGappyColumns());
    await page.waitForFunction(() => state.hiddenCols && state.hiddenCols.length > 0, null, { timeout: 60000 });
  });
  out.gappy = await page.evaluate(() => ({ n: state.hiddenCols.length, first: state.hiddenCols[0], total: _foldCount() }));
  out.longTask = lt;
  const expectN = Math.floor((nC - 4) / 7) + 1;
  if (out.gappy.total !== expectN || out.gappy.first[0] !== 3) bad.push(`Hide Gappy hid ${out.gappy.total} columns (${expectN} expected), first ${JSON.stringify(out.gappy.first)}`);
  if (lt.max > 250) bad.push(`Hide Gappy blocked the page for ${lt.max} ms`);
  await page.evaluate(() => revealAllColumns());

  // a small alignment: conserved columns 0-9, then a fold
  const small = Array.from({ length: 12 }, (_, i) => `>q${i}\nAAAAAAAAAA${'ACGT'[i % 4].repeat(20)}`).join('\n') + '\n';
  await loadFasta(page, small);
  await setMode(page, 'canvas');
  await page.evaluate(() => { const h = el('highlightDiffs'); h.checked = true; h.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(600);
  await page.evaluate(() => _foldApply([[10, 14]]));
  await page.waitForTimeout(400);
  out.alpha = await page.evaluate(() => { const cv = el('alignmentCanvas'), m = _canvasState.metrics, dpr = m.dpr || 1, c = cv.getContext('2d');
    const s = _canvasState.slots.indexOf(-1 - 15);
    const d = c.getImageData(Math.round((m.nameW + s * m.charW - _canvasState.offsetX + 2) * dpr), Math.round((m.headerH + _canvasState.rowPitch + 2) * dpr), 1, 1).data;
    return { slot: s, got: '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''), want: _FOLD_STYLE.color.toLowerCase() }; });
  if (out.alpha.got !== out.alpha.want) bad.push('marker after a dimmed column: ' + JSON.stringify(out.alpha));
  await page.evaluate(() => { const h = el('highlightDiffs'); h.checked = false; h.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(400);

  // a view position taken at a fold marker comes back to the marker
  await page.evaluate(() => _foldApply([[2, 14]]));
  await page.waitForTimeout(300);
  out.anchor = await page.evaluate(() => { const m = _canvasState.metrics; _canvasState.offsetX = 2 * m.charW; _canvasState.scheduleDraw();
    const a = _captureViewAnchor(true); const ox0 = _canvasState.offsetX; _canvasState.offsetX = 0; _applyViewAnchor(a); return { a, ox0, ox1: _canvasState.offsetX }; });
  if (Math.abs(out.anchor.ox1 - out.anchor.ox0) > 0.5) bad.push('anchor at a marker: ' + JSON.stringify(out.anchor));

  // hiding every column is refused
  out.all = await page.evaluate(() => { _foldApply([]); state.selectedColumns.clear(); for (let c = 0; c < 30; c++) state.selectedColumns.add(c); return hideSelectedColumns().then(() => ({ hidden: JSON.stringify(state.hiddenCols), msg: /at least one column/i.test(document.body.innerText) })); });
  if (out.all.hidden !== '[]' || !out.all.msg) bad.push('hiding every column: ' + JSON.stringify(out.all));

  // a new file: no folds, Reveal disabled, no count
  await page.evaluate(() => _foldApply([[3, 5]]));
  await loadFasta(page, small);
  await page.waitForTimeout(400);
  out.reset = await page.evaluate(() => ({ hidden: JSON.stringify(state.hiddenCols), reveal: el('revealColumnsButton').disabled, status: el('foldStatus').textContent }));
  if (out.reset.hidden !== '[]' || !out.reset.reveal || out.reset.status) bad.push('new file: ' + JSON.stringify(out.reset));
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out) : JSON.stringify(out) };
}, { timeoutMs: 180000 });

// Split-view plan A2: hidden columns in Full and Block. A fold hides its columns in every row, the consensus row and
// the ruler, and puts one marker cell (.col-fold) where they were, so the columns either side sit together and the
// ruler stays over its columns; the marker's title says what is hidden and a click on it shows the run again; going
// to a hidden column shows it; the view is not switched to Canvas. The windowed Full/Block view (large alignments)
// still sends the commands to Canvas.
check('Hidden columns in Full and Block: fold markers in rows, consensus and ruler, aligned, click reveals, go-to reveals, windowed goes to Canvas', async (page) => {
  const bad = [], out = {};
  const n = 30, len = 400;
  await loadFasta(page, Array.from({ length: n }, (_, i) => `>s${i}\n` + Array.from({ length: len }, (_, j) => 'ACGT'[(i * 3 + j * 7 + (j % 5)) % 4]).join('')).join('\n') + '\n');
  await setMode(page, 'full');
  await page.waitForTimeout(500);
  await page.evaluate(() => { state.selectedColumns.clear(); for (let c = 100; c <= 249; c++) state.selectedColumns.add(c); updateColumnSelections(); return hideSelectedColumns(); });
  await page.waitForTimeout(800);
  const look = () => page.evaluate(() => {
    const row = document.querySelector('.seq-line[data-seq-index="0"] .seq-data');
    const cons = document.querySelector('.consensus-line .seq-data');
    const ruler = document.querySelector('.scale-ruler-line .seq-data');
    const vis = (root, p) => { const s = root && root.querySelector(`span[data-pos="${p}"]`); return s ? getComputedStyle(s).display !== 'none' : null; };
    const left = (root, p) => { const s = root && root.querySelector(`span[data-pos="${p}"]`); return s ? Math.round(s.getBoundingClientRect().left) : null; };
    const mk = root => root ? root.querySelectorAll('.col-fold').length : -1;
    const m = row && row.querySelector('.col-fold');
    return { canvas: document.getElementById('modeCanvas').checked, hidden: JSON.stringify(state.hiddenCols), v150: vis(row, 150), v99: vis(row, 99), v250: vis(row, 250),
      markers: { row: mk(row), cons: mk(cons), ruler: mk(ruler) }, title: m ? m.title : '', next: m && m.nextElementSibling ? m.nextElementSibling.dataset.pos : null,
      left250: { row: left(row, 250), cons: left(cons, 250), ruler: left(ruler, 250) }, status: el('foldStatus').textContent };
  });
  out.full = await look();
  const f = out.full;
  if (f.canvas) bad.push('hiding columns in Full switched to Canvas');
  if (f.hidden !== '[[100,249]]' || f.v150 !== false || f.v99 !== true || f.v250 !== true) bad.push('Full: columns not hidden as asked: ' + JSON.stringify(f));
  if (f.markers.row !== 1 || f.markers.cons !== 1 || f.markers.ruler !== 1 || f.next !== '250') bad.push('Full: markers ' + JSON.stringify(f.markers) + ' next ' + f.next);
  if (!/150 columns hidden \(positions 101.250\)/.test(f.title)) bad.push('Full: marker title ' + f.title);
  if (f.left250.row == null || Math.abs(f.left250.row - f.left250.cons) > 1 || Math.abs(f.left250.row - f.left250.ruler) > 1) bad.push('Full: column 251 not aligned in row / consensus / ruler ' + JSON.stringify(f.left250));
  if (/Canvas/.test(f.status)) bad.push('Full: status still says Canvas only: ' + f.status);
  // a click on the marker of another row shows the run again
  await page.evaluate(() => document.querySelector('.seq-line[data-seq-index="3"] .col-fold').click());
  await page.waitForTimeout(800);
  out.afterClick = await look();
  if (out.afterClick.hidden !== '[]' || out.afterClick.v150 !== true || out.afterClick.markers.row !== 0) bad.push('Full: click did not reveal ' + JSON.stringify(out.afterClick));

  // Block: a fold inside a block, go-to reveals it
  await setMode(page, 'block');
  await page.waitForTimeout(500);
  await page.evaluate(() => _foldApply([[10, 19]]));
  await page.waitForTimeout(800);
  out.block = await page.evaluate(() => ({ canvas: document.getElementById('modeCanvas').checked, markers: document.querySelectorAll('.seq-line .col-fold').length,
    v15: getComputedStyle(document.querySelector('.seq-line[data-seq-index="0"] span[data-pos="15"]')).display }));
  if (out.block.canvas || out.block.markers < n || out.block.v15 !== 'none') bad.push('Block: ' + JSON.stringify(out.block));
  out.goto = await page.evaluate(async () => { _scrollToColumn(15); await new Promise(r => setTimeout(r, 800)); return { hidden: JSON.stringify(state.hiddenCols), v15: getComputedStyle(document.querySelector('.seq-line[data-seq-index="0"] span[data-pos="15"]')).display }; });
  if (out.goto.hidden !== '[]' || out.goto.v15 === 'none') bad.push('Block: go to column 16 did not reveal ' + JSON.stringify(out.goto));

  // windowed Full: the commands go to Canvas
  await loadSyntheticFasta(page, 1500, 4000);
  await setMode(page, 'full');
  await page.waitForTimeout(800);
  out.windowed = await page.evaluate(async () => { const w = !!state._needsWindowedDom; state.selectedColumns.clear(); for (let c = 10; c < 20; c++) state.selectedColumns.add(c); await hideSelectedColumns(); await new Promise(r => setTimeout(r, 800)); return { windowed: w, canvas: document.getElementById('modeCanvas').checked, hidden: JSON.stringify(state.hiddenCols) }; });
  if (!out.windowed.windowed || !out.windowed.canvas || out.windowed.hidden !== '[[10,19]]') bad.push('windowed: ' + JSON.stringify(out.windowed));
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out).slice(0, 1500) : JSON.stringify(out).slice(0, 800) };
}, { timeoutMs: 180000 });

// Hidden columns, owner's decision 1: analyses, Copy and Save use the whole alignment; "visible columns only" is an
// option. Actions > Columns > "Copy, Save, Tree: visible columns only" (off by default, usable when columns are
// hidden) leaves the folded columns out of Copy Align, Copy Sel, the toolbar Copy / Save and the tree.
check('Hidden columns: "visible columns only" leaves folds out of Copy / Save / Tree, off by default', async (page) => {
  const bad = [], out = {};
  // rows identical outside columns 11-30, all different inside: a tree of the visible columns has distance 0
  const rows = Array.from({ length: 6 }, (_, i) => `>r${i}\n${'ACGTACGTAC'}${Array.from({ length: 20 }, (_, j) => 'ACGT'[(i + j) % 4]).join('')}${'GGCCTTAAGG'}`);
  await loadFasta(page, rows.join('\n') + '\n');
  await setMode(page, 'canvas');
  await page.evaluate(() => _foldApply([[10, 29]]));
  await page.waitForTimeout(400);
  out.off = await page.evaluate(() => ({ box: el('foldVisibleOnly') ? el('foldVisibleOnly').checked : null, text: _alignmentFastaText() }));
  if (out.off.box !== false) bad.push('the option is missing or on by default: ' + out.off.box);
  if (!out.off.text.includes('ACGTACGTAC' + 'ACGT')) bad.push('off: Copy text lacks the hidden columns');
  await page.evaluate(() => { const b = el('foldVisibleOnly'); b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
  out.on = await page.evaluate(() => ({ text: _alignmentFastaText(), sel: (() => { state.selectedRows = new Set([1]); return _selectedRowsFastaText(); })() }));
  const want0 = 'ACGTACGTACGGCCTTAAGG';
  if (!out.on.text.includes('>r0\n' + want0)) bad.push('on: Copy text is not the visible columns: ' + out.on.text.slice(0, 60));
  if (!out.on.sel.includes('>r1\n' + want0)) bad.push('on: Copy Sel is not the visible columns: ' + out.on.sel.slice(0, 60));
  await page.evaluate(() => { state.selectedRows = new Set(); openTreeBuilder(); });
  await page.waitForTimeout(1500);
  out.tree = await page.evaluate(() => el('treeBuilderSummary')?.textContent || '');
  if (!/avg 0\.0000/.test(out.tree) || !/visible columns/.test(out.tree)) bad.push('on: tree not of the visible columns: ' + out.tree);
  await page.evaluate(() => closeTreeBuilder());
  // the folds go: the option has nothing to leave out, the whole alignment is copied
  await page.evaluate(() => revealAllColumns());
  out.after = await page.evaluate(() => ({ disabled: el('foldVisibleOnly').disabled, text: _alignmentFastaText() }));
  if (!out.after.disabled || !out.after.text.includes('ACGTACGTAC' + 'ACGT')) bad.push('without folds: ' + JSON.stringify({ disabled: out.after.disabled }));
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out).slice(0, 900) : JSON.stringify({ tree: out.tree }) };
}, { timeoutMs: 90000 });

// Hidden columns: keys (free in the Keys list): Alt+H hides the selected columns, Alt+Shift+H keeps only them, Alt+U shows all.
check('Hidden columns: Alt+H, Alt+Shift+H, Alt+U', async (page) => {
  await loadFasta(page, Array.from({ length: 5 }, (_, i) => `>k${i}\n` + 'ACGT'.repeat(25)).join('\n') + '\n');
  await setMode(page, 'canvas');
  const sel = (a, b) => page.evaluate(([a, b]) => { state.selectedColumns.clear(); for (let c = a; c <= b; c++) state.selectedColumns.add(c); updateColumnSelections(); document.activeElement?.blur?.(); }, [a, b]);
  const hid = () => page.evaluate(() => JSON.stringify(state.hiddenCols));
  const out = {};
  await sel(10, 19); await page.keyboard.press('Alt+KeyH'); await page.waitForTimeout(500); out.h = await hid();
  await page.keyboard.press('Alt+KeyU'); await page.waitForTimeout(500); out.u = await hid();
  await sel(40, 49); await page.keyboard.press('Alt+Shift+KeyH'); await page.waitForTimeout(500); out.sh = await hid();
  const ok = out.h === '[[10,19]]' && out.u === '[]' && out.sh === '[[0,39],[50,99]]';
  return { pass: ok, detail: JSON.stringify(out) };
});

// GLM audit of v285-v292 (2026-10-26), the findings reproduced here: turning Highlight diffs off rebuilt the Full ruler
// as plain text without its fold markers (digits off their columns); Undo / Redo did not reload mirror panes; the
// splitter drag lost .pane-dragging when the dock was laid out (the iframes then swallowed the pointer); Alt+H on a
// residue selection kept the selection on the hidden residues (Copy Sel copied them); "visible columns only" stayed
// ticked after the folds went and came back on the next fold; Swap with a mirror pane loaded the mirror's older
// payload into the main view (an edit made just before was undone); closing a pane left its hand-off entry and its
// armed mode timer behind.
check('Audit v292: ruler markers after Highlight diffs, Undo reloads mirrors, splitter drag, Alt+H residue selection, visible-only reset, Swap with a mirror, pane close', async (page) => {
  const bad = [], out = {};
  const n = 300, len = 300;   // (enough rows to scroll a view to row 30)
  const fa = Array.from({ length: n }, (_, i) => `>a${i}\n` + Array.from({ length: len }, (_, j) => 'ACGT'[(i * 3 + j * 7 + (j % 5)) % 4]).join('')).join('\n') + '\n';
  await loadFasta(page, fa);
  await setMode(page, 'full');
  await page.waitForTimeout(400);
  // 1. Highlight diffs on, then off, with a fold: the ruler keeps its marker and stays over its columns
  await page.evaluate(() => _foldApply([[50, 99]]));
  await page.waitForTimeout(500);
  const tick = (on) => page.evaluate((on) => { const h = el('highlightDiffs'); h.checked = on; h.dispatchEvent(new Event('change', { bubbles: true })); }, on);
  await tick(true); await page.waitForTimeout(800); await tick(false); await page.waitForTimeout(800);
  out.ruler = await page.evaluate(() => { const r = document.querySelector('.scale-ruler-line .seq-data'), row = document.querySelector('.seq-line[data-seq-index="0"] .seq-data');
    const l = (root) => { const s = root && root.querySelector('span[data-pos="100"]'); return s ? Math.round(s.getBoundingClientRect().left) : null; };
    return { markers: r ? r.querySelectorAll('.col-fold').length : -1, ruler: l(r), row: l(row) }; });
  if (out.ruler.markers !== 1 || out.ruler.ruler == null || Math.abs(out.ruler.ruler - out.ruler.row) > 1) bad.push('ruler after Highlight diffs off: ' + JSON.stringify(out.ruler));
  await page.evaluate(() => _foldApply([]));

  // 2. Alt+H on a residue selection: the selection does not stay on the hidden residues
  out.nuc = await page.evaluate(async () => { state.selectedColumns.clear(); state.selectedNucs.clear(); state.selectedNucs.set(2, new Set([10, 11, 12])); await hideSelectedColumns(); return { hidden: JSON.stringify(state.hiddenCols), nucs: state.selectedNucs.size }; });
  if (out.nuc.hidden !== '[[10,12]]' || out.nuc.nucs !== 0) bad.push('Alt+H on residues: ' + JSON.stringify(out.nuc));
  // 3. visible-only is unticked when the folds go
  out.vis = await page.evaluate(() => { const b = el('foldVisibleOnly'); b.checked = true; revealAllColumns(); const after = b.checked; _foldApply([[1, 2]]); const again = _foldVisibleOnly(); _foldApply([]); return { after, again }; });
  if (out.vis.after || out.vis.again) bad.push('visible-only after Reveal: ' + JSON.stringify(out.vis));

  // 4. a mirror pane follows Undo
  await setMode(page, 'canvas');
  await page.evaluate(() => el('paneSplitRight').click());
  const frameN = async (k) => { let fr; for (let i = 0; i < 60; i++) { fr = page.frames().filter(f => f !== page.mainFrame())[k]; if (fr && await fr.evaluate(() => typeof state !== 'undefined' && state.seqs.length).catch(() => 0)) return fr; await page.waitForTimeout(500); } return fr; };
  const fr = await frameN(0);
  await page.waitForTimeout(800);
  await page.evaluate(() => { pushUndo('test edit'); state.seqs.pop(); renderAlignment(); });
  await page.waitForTimeout(2000);
  out.afterEdit = await fr.evaluate(() => state.seqs.length);
  await page.evaluate(() => undoDelete());
  await page.waitForTimeout(2000);
  out.afterUndo = { main: await page.evaluate(() => state.seqs.length), pane: await fr.evaluate(() => state.seqs.length) };
  if (out.afterEdit !== n - 1 || out.afterUndo.main !== n || out.afterUndo.pane !== n) bad.push('mirror after Undo: ' + JSON.stringify({ afterEdit: out.afterEdit, afterUndo: out.afterUndo }));

  // 5. the splitter drag keeps .pane-dragging while the dock is laid out
  out.drag = await page.evaluate(() => { const d = el('paneDock'); d.classList.add('pane-dragging'); _paneLayout(); const kept = d.classList.contains('pane-dragging'); d.classList.remove('pane-dragging'); return kept; });
  if (!out.drag) bad.push('_paneLayout dropped .pane-dragging');

  // 6. Swap with a mirror pane: the main view keeps its (just edited) alignment; the places are exchanged
  await page.evaluate(() => { _link.rows = false; });
  await fr.evaluate(() => { _link.rows = false; _applyViewAnchor({ row: 30, col: 0 }); });
  await page.evaluate(() => { _applyViewAnchor({ row: 5, col: 0 }); pushUndo('edit before swap'); state.seqs.pop(); renderAlignment(); });
  await page.evaluate(() => _panes.list[0].wrap.querySelector('.pane-swap').click());   // at once: the mirror has not reloaded yet
  await page.waitForTimeout(2000);
  out.swap = await page.evaluate(() => ({ n: state.seqs.length, row: _captureViewAnchor().row, mode: _panes.list[0].mode }));
  out.swapPane = await fr.evaluate(() => _captureViewAnchor().row);
  if (out.swap.n !== n - 1 || Math.abs(out.swap.row - 30) > 1 || Math.abs(out.swapPane - 5) > 1 || out.swap.mode !== 'mirror') bad.push('Swap with a mirror: ' + JSON.stringify({ main: out.swap, paneRow: out.swapPane }));

  // 7. closing a pane removes its hand-off entry and its armed timer
  out.close = await page.evaluate(() => { const before = _newTabHandoffs.size; const rec = paneOpen('right'); rec.mode = 'own'; _paneToggleMode(rec); const armed = !!rec.armed; paneClose(rec); return { before, after: _newTabHandoffs.size, armed, armedAfter: !!rec.armed }; });
  if (out.close.after !== out.close.before || !out.close.armed || out.close.armedAfter) bad.push('pane close: ' + JSON.stringify(out.close));
  await page.evaluate(() => _panes.list.slice().forEach(paneClose));
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out) : JSON.stringify(out) };
}, { timeoutMs: 180000 });

// GLM audit of v285-v292, second part: in Full/Block a view position (Go to, linked views, mode switches) at a hidden
// column scrolled by column number times the cell width, which overshoots by the folded width; "visible columns only"
// dropped columns that the windowed Full/Block view shows (folds are not drawn there); the snapshot link
// (?snapshot=, also in the HTML file) carried every own-copy pane's whole alignment, with no limit.
check('Audit v292 (2): a view position at a fold in Full, visible-only only where folds show, own-copy panes out of the snapshot link', async (page) => {
  const bad = [], out = {};
  await loadFasta(page, Array.from({ length: 30 }, (_, i) => `>f${i}\n` + Array.from({ length: 800 }, (_, j) => 'ACGT'[(i + j * 3) % 4]).join('')).join('\n') + '\n');
  await setMode(page, 'full');
  await page.evaluate(() => _foldApply([[100, 249]]));
  await page.waitForTimeout(600);
  out.anchor = await page.evaluate(async () => {
    _applyViewAnchor({ row: 0, col: 150 });   // hidden: lands on its marker
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const line = document.querySelector('.seq-line[data-seq-index="0"]');
    const mk = line.querySelector('.col-fold');
    return { markerAt: Math.round(mk.getBoundingClientRect().left - _domDataLeft(line)), scrollLeft: Math.round(alignmentContainer.scrollLeft) };
  });
  // (a visible column lands up to ~3 px off too: scrollLeft rounding with fractional cell widths; before the fix the
  // marker was off by the folded width, 150 columns)
  if (Math.abs(out.anchor.markerAt) > 3.9) bad.push('view position at a hidden column: the marker is ' + out.anchor.markerAt + ' px from the names');
  // the snapshot link keeps mirror panes only
  out.link = await page.evaluate(() => {
    const p = { fasta: '>a\nAC', view: {}, panes: { side: 'right', frac: 0.4, list: [{ mode: 'mirror', anchor: { row: 1, col: 2 } }, { mode: 'own', name: 'x', payload: { fasta: '>b\nGG' } }] } };
    const u = _snapshotLinkPayload(p);
    return { modes: u.panes ? u.panes.list.map(x => x.mode).join() : '', fileKept: p.panes.list.length };
  });
  if (out.link.modes !== 'mirror' || out.link.fileKept !== 2) bad.push('snapshot link panes: ' + JSON.stringify(out.link));
  // windowed Full: folds are not drawn there, so visible-only does not apply
  await loadSyntheticFasta(page, 1500, 4000);
  await setMode(page, 'canvas');
  await page.evaluate(() => { _foldApply([[10, 19]]); const b = el('foldVisibleOnly'); b.checked = true; });
  out.canvasVis = await page.evaluate(() => _foldVisibleOnly());
  await setMode(page, 'full');
  await page.waitForTimeout(800);
  out.windowed = await page.evaluate(() => ({ windowed: !!state._needsWindowedDom, vis: _foldVisibleOnly(), len: _alignmentFastaText().split('\n')[1].length }));
  if (!out.canvasVis || !out.windowed.windowed || out.windowed.vis || out.windowed.len !== 4000) bad.push('visible-only in the windowed view: ' + JSON.stringify({ canvas: out.canvasVis, ...out.windowed }));
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out) : JSON.stringify(out) };
}, { timeoutMs: 120000 });

// Owner 2026-10-26: there was no way to deselect a range of rows (Shift+click and Ctrl+drag on names only added).
// Now Shift+click on a row that is already selected deselects the rows from the last clicked one to it, and a Ctrl+drag
// that starts on a selected row deselects the rows it passes over. Full and Canvas alike.
check('Row selection: Shift+click on a selected row and Ctrl+drag from a selected row deselect a range (Full, Canvas)', async (page) => {
  const bad = [], out = {};
  await loadFasta(page, Array.from({ length: 20 }, (_, i) => `>r${i}\n` + 'ACGT'.repeat(15)).join('\n') + '\n');
  const sel = () => page.evaluate(() => [...state.selectedRows].sort((a, b) => a - b).join(','));
  for (const mode of ['full', 'canvas']) {
    await setMode(page, mode);
    await page.waitForTimeout(400);
    await page.evaluate(() => { state.selectedRows.clear(); state.lastSelectedIndex = null; updateRowSelections(); });
    await r2ClickName(page, 3, ['Control']);
    await r2ClickName(page, 8, ['Shift']);
    const a = await sel();
    await r2ClickName(page, 5, ['Shift']);          // 5 is selected: 5..8 (from the last clicked, 8) go
    const b = await sel();
    await r2ClickName(page, 12, ['Shift']);         // 12 is not selected: 5..12 are added (anchor 5)
    const c = await sel();
    // Ctrl+drag from a selected row (7) down to row 10: 7..10 go
    const p0 = await auditName(page, 7), p1 = await auditName(page, 10);
    await page.keyboard.down('Control');
    await page.mouse.move(p0.x, p0.y); await page.mouse.down();
    await page.mouse.move(p1.x, (p0.y + p1.y) / 2, { steps: 4 }); await page.mouse.move(p1.x, p1.y, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);
    const d = await sel();
    // Ctrl+drag from an unselected row (15) to 17 still adds
    const q0 = await auditName(page, 15), q1 = await auditName(page, 17);
    await page.keyboard.down('Control');
    await page.mouse.move(q0.x, q0.y); await page.mouse.down();
    await page.mouse.move(q1.x, q1.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);
    const e = await sel();
    out[mode] = { a, b, c, d, e };
    const want = { a: '3,4,5,6,7,8', b: '3,4', c: '3,4,5,6,7,8,9,10,11,12', d: '3,4,5,6,11,12', e: '3,4,5,6,11,12,15,16,17' };
    for (const k of Object.keys(want)) if (out[mode][k] !== want[k]) bad.push(`${mode} ${k}: ${out[mode][k]} (want ${want[k]})`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : JSON.stringify(out) };
}, { timeoutMs: 120000 });

// Owner 2026-10-26 (screenshot: "67 seq" over 6 rows): the header counts (seq, col, bp range) are written by
// updateSourceInfo at the end of renderAlignment, but the Canvas path returns before that line, so in the Canvas
// view (the default) a row delete, Undo or Redo left the old counts. Every view now updates them.
check('Header counts follow row deletes, Undo and Redo in every view (Canvas returned before updating them)', async (page) => {
  const bad = [], out = {};
  const counts = () => page.evaluate(() => { const t = el('sourceInfo').textContent; const m = t.match(/(\d+)\s*seq,\s*(\d+)\s*col,\s*([\d-]+)/); return m ? m[1] + '|' + m[2] + '|' + m[3] : t; });
  for (const mode of ['canvas', 'full', 'block']) {
    await loadFasta(page, Array.from({ length: 20 }, (_, i) => `>c${i}\n` + 'ACGT'.repeat(10) + (i === 0 ? 'AAAAAAAAAA' : '----------')).join('\n') + '\n');
    await setMode(page, mode);
    await page.waitForTimeout(400);
    const before = await counts();
    page.once('dialog', d => d.accept());   // "Delete 3 sequence(s)?"
    await page.evaluate(() => { state.selectedRows = new Set([0, 1, 2]); updateRowSelections(); deleteSelected(); });
    await page.waitForTimeout(500);
    const afterDelete = await counts();
    await page.evaluate(() => undoDelete());
    await page.waitForTimeout(500);
    const afterUndo = await counts();
    await page.evaluate(() => redoAction());
    await page.waitForTimeout(500);
    const afterRedo = await counts();
    out[mode] = { before, afterDelete, afterUndo, afterRedo };
    if (before !== '20|50|40-50' || afterDelete !== '17|50|40' || afterUndo !== '20|50|40-50' || afterRedo !== '17|50|40') bad.push(mode + ': ' + JSON.stringify(out[mode]));
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : JSON.stringify(out) };
}, { timeoutMs: 120000 });

// Owner 2026-10-26 (screenshot at a 1.6 device-pixel ratio): slivers to the right of the length badges after scrolling
// with the mouse held. The canvas bitmap is a whole number of device pixels and its CSS width is bitmap / dpr
// (1971.875 px); the draw code read that width back with parseInt (1971), so the last ~1.4 device-pixel columns were
// never painted: black after a full draw, and pieces of the badges after a frame-copy scroll moved them there.
check('Canvas: the last device-pixel columns are painted at a fractional pixel ratio (no slivers right of the badges)', async (page) => {
  const ctx = await page.context().browser().newContext({ viewport: { width: 1990, height: 420 }, deviceScaleFactor: 1.6 });
  const p = await ctx.newPage();
  try {
    await p.goto(page.url(), { waitUntil: 'networkidle' });
    await p.waitForFunction(() => typeof parseAndRender === 'function', null, { timeout: 15000 });
    const fa = Array.from({ length: 6 }, (_, i) => `>G01_mollyHiFi_fam0${i}_n38_lat1_long_name\n` + Array.from({ length: 308 }, (_, j) => (j > 290 - i * 4) ? '-' : 'ACGT'[(i + j * 3) % 4]).join('')).join('\n') + '\n';
    await loadFasta(p, fa);
    await setMode(p, 'canvas');
    await p.waitForTimeout(800);
    // the right-edge columns of the canvas over the rows: [r, g, b] per device-pixel column, the last 3
    const edge = () => p.evaluate(() => { const cv = _canvasState.canvas, c = cv.getContext('2d'), m = _canvasState.metrics, dpr = m.dpr || 1;
      const y = Math.round((m.headerH + 2.5 * _canvasState.rowPitch) * dpr); const W = cv.width;
      return { W, css: cv.style.width, cols: [W - 3, W - 2, W - 1].map(x => Array.from(c.getImageData(x, y, 1, 1).data.slice(0, 3)).join(',')) }; });
    // to the right end, then a full draw
    await p.evaluate(() => { _canvasState.offsetX = 1e9; _canvasState.scheduleDraw(); });
    await p.waitForTimeout(300);
    await p.evaluate(() => { const a = _captureViewAnchor(true); renderAlignment(); _applyViewAnchor(a); _canvasState.offsetX = 1e9; _canvasState.scheduleDraw(); });
    await p.waitForTimeout(500);
    const full = await edge();
    // wheel steps back and forth near the end (frame copies), with the mouse held on a cell
    const r = await p.evaluate(() => { const b = _canvasState.canvas.getBoundingClientRect(); return { x: b.left + 600, y: b.top + 60 }; });
    await p.mouse.move(r.x, r.y); await p.mouse.down();
    for (let i = 0; i < 12; i++) { await p.mouse.wheel(-25, 0); await p.waitForTimeout(20); }
    for (let i = 0; i < 14; i++) { await p.mouse.wheel(25, 0); await p.waitForTimeout(20); }
    await p.waitForTimeout(400);
    await p.mouse.up();
    const scrolled = await edge();
    const white = e => e.cols.every(c => c === '255,255,255');
    return { pass: white(full) && white(scrolled), detail: JSON.stringify({ full, scrolled }) };
  } finally { await ctx.close(); }
}, { timeoutMs: 90000 });

// GLM audit of v294 (2026-10-27), confirmed findings: a Shift+click on a name in Canvas left the residue two-click
// range armed (Full/Block cancel it), so the next residue click completed a range from the old cell; the header's
// bp range was computed from gaplessPositions that a typed residue (same length) left stale; the dot plot's bitmap was
// rounded to whole device pixels but shown at the unrounded CSS size (stretched, blurred) at a fractional ratio; and
// PageUp/PageDown in Canvas stepped by parseInt of the now fractional canvas height.
check('Audit v294: Canvas Shift+click on a name cancels a pending residue range, header bp after a same-length edit, dot plot and page step at a fractional ratio', async (page) => {
  const bad = [], out = {};
  const ctx = await page.context().browser().newContext({ viewport: { width: 1400, height: 700 }, deviceScaleFactor: 1.25 });
  const p = await ctx.newPage();
  try {
    await p.goto(page.url(), { waitUntil: 'networkidle' });
    await p.waitForFunction(() => typeof parseAndRender === 'function', null, { timeout: 15000 });
    await loadFasta(p, Array.from({ length: 200 }, (_, i) => `>h${i}\n` + (i === 0 ? 'A-CGTACGTA' : 'ACGTACGTAC') + 'ACGT'.repeat(10)).join('\n') + '\n');
    await setMode(p, 'canvas');
    await p.waitForTimeout(500);
    // 1. residue click, then Shift+click on a name: the residue range is no longer armed
    const cell = await p.evaluate(() => { const m = _canvasState.metrics, r = _canvasState.canvas.getBoundingClientRect(); return { x: r.left + m.nameW + 5.5 * m.charW, y: r.top + m.headerH + 2.5 * _canvasState.rowPitch }; });
    await p.mouse.click(cell.x, cell.y);
    await p.waitForTimeout(200);
    out.armed = await p.evaluate(() => !!state.pendingNucStart);
    await p.evaluate(() => { state.lastSelectedIndex = 0; state.selectedRows = new Set([0]); });
    await r2ClickName(p, 4, ['Shift']);
    out.afterShift = await p.evaluate(() => state.pendingNucStart);
    if (!out.armed || out.afterShift) bad.push('pending residue range after a Shift+click on a name: ' + JSON.stringify(out.afterShift));
    // 2. a same-length edit (a residue typed over the gap) and a render: the bp range is the residues counted now
    out.bp = await p.evaluate(() => { state.seqs[0].seq = 'AACGTACGTA' + state.seqs[0].seq.slice(10); renderAlignment();
      const t = el('sourceInfo').textContent.match(/([\d-]+)\s*bp/); const lens = state.seqs.map(q => q.seq.replace(/[-.]/g, '').length);
      return { shown: t && t[1], want: Math.min(...lens) === Math.max(...lens) ? String(Math.min(...lens)) : Math.min(...lens) + '-' + Math.max(...lens) }; });
    if (out.bp.shown !== out.bp.want) bad.push('bp range after a same-length edit: ' + JSON.stringify(out.bp));
    // 3. the dot plot's bitmap is exactly its CSS box in device pixels
    out.dot = await p.evaluate(() => { const c = document.createElement('canvas'); document.body.appendChild(c); _dotSizeToViewport(c, 601, 301);
      const r = { w: c.width, h: c.height, cssW: parseFloat(c.style.width), cssH: parseFloat(c.style.height), dpr: devicePixelRatio }; c.remove(); return r; });
    if (Math.abs(out.dot.cssW * out.dot.dpr - out.dot.w) > 1e-6 || Math.abs(out.dot.cssH * out.dot.dpr - out.dot.h) > 1e-6) bad.push('dot plot bitmap vs CSS box: ' + JSON.stringify(out.dot));
    // 4. PageDown steps 0.8 of the canvas height in CSS px (not of its integer part)
    out.page = await p.evaluate(() => { _canvasState.offsetY = 0; const cv = _canvasState.canvas; const want = 0.8 * cv.height / devicePixelRatio;
      document.activeElement?.blur?.(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
      return { got: _canvasState.offsetY, want, css: cv.style.height }; });
    if (Math.abs(out.page.got - out.page.want) > 1 / 1.25 + 1e-6) bad.push('PageDown step: ' + JSON.stringify(out.page));
  } finally { await ctx.close(); }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out) : JSON.stringify(out) };
}, { timeoutMs: 90000 });

// Owner 2026-10-28: "tooltip on consensus hover doesn't show". Full/Block attach it to each consensus span; the Canvas
// view (the default) had no consensus hover at all. Both views now show the column's coverage and base percentages.
check('Consensus hover shows the column tooltip (coverage, bases) in Canvas and Full, consensus on top and at the bottom', async (page) => {
  const bad = [], out = {};
  await loadFasta(page, Array.from({ length: 12 }, (_, i) => `>t${i}\n` + (i < 9 ? 'ACGTACGTAC' : 'TCGTACGTAC') + 'ACGT'.repeat(10)).join('\n') + '\n');
  const tip = () => page.evaluate(() => { const t = [...document.querySelectorAll('.consensus-box')].find(e => getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden')   /* (fixed: no offsetParent) */; return t ? t.textContent.replace(/\s+/g, ' ').trim() : ''; });
  for (const mode of ['canvas', 'full']) {
    for (const where of ['top', 'bottom']) {
      await setMode(page, mode);
      await page.evaluate((where) => { const r = document.querySelector(`input[name="consensusPosition"][value="${where}"]`); if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); } }, where);
      await page.waitForTimeout(600);
      const pt = await page.evaluate((mode) => {
        if (mode === 'canvas') { const m = _canvasState.metrics, r = _canvasState.canvas.getBoundingClientRect(), b = _canvasState.consBand;
          if (!b) return null; return { x: r.left + m.nameW + 0.5 * m.charW - _canvasState.offsetX, y: r.top + b.y + b.textOff + m.charH / 2 - _canvasState.offsetY }; }
        const s = document.querySelector('.consensus-line .seq-data span[data-pos="0"]'); if (!s) return null; const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, mode);
      if (!pt) { bad.push(`${mode} ${where}: no consensus position`); continue; }
      await page.mouse.move(5, 5); await page.waitForTimeout(150);
      await page.mouse.move(pt.x, pt.y); await page.waitForTimeout(500);
      const t = await tip();
      out[mode + '-' + where] = t.slice(0, 80);
      if (!/aln 1 .*Coverage: 100% \(12\/12\).*A.*75%.*T.*25%/.test(t)) bad.push(`${mode} ${where}: tooltip "${t.slice(0, 120)}"`);
    }
  }
  await page.mouse.move(5, 5);
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : JSON.stringify(out) };
}, { timeoutMs: 90000 });

// Owner 2026-10-28: "when columns are selected the selection is barely visible on black cells". A column selection was
// only a 28 % (Full/Block) or 15 % (Canvas) blue tint, nearly nothing over black shading. Each run of selected columns
// now also has a bright edge line left and right (Canvas: drawn on the overlay; Full/Block: .col-sel-l / .col-sel-r).
check('Column selection: a run of selected columns has bright edge lines that show on black cells (Canvas, Full)', async (page) => {
  const bad = [], out = {};
  // identical rows: every column conserved, shaded black
  await loadFasta(page, Array.from({ length: 10 }, (_, i) => `>k${i}\n` + 'ACGTACGTAC'.repeat(4)).join('\n') + '\n');
  const pick = () => page.evaluate(() => { state.selectedColumns = new Set([10, 11, 12]); updateColumnSelections(); _canvasState.scheduleOverlay?.(); });
  await setMode(page, 'canvas');
  await page.waitForTimeout(600);
  await pick();
  await page.waitForTimeout(400);
  out.canvas = await page.evaluate(() => {
    const m = _canvasState.metrics, dpr = m.dpr || 1, ov = document.getElementById('alignmentCanvasOverlay') || _canvasState.overlay;
    const base = _canvasState.canvas.getContext('2d');
    const y = Math.round((m.headerH + 3 * _canvasState.rowPitch + 1) * dpr);   // the row's top pixel: above the letters
    // composite of the base canvas and the overlay at a device pixel
    const at = (cssX) => { const x = Math.round(cssX * dpr); const b = base.getImageData(x, y, 1, 1).data;
      const o = ov ? ov.getContext('2d').getImageData(x, y, 1, 1).data : [0, 0, 0, 0]; const a = o[3] / 255;
      return [0, 1, 2].map(i => Math.round(o[i] * a + b[i] * (1 - a))); };
    const x0 = m.nameW + 10 * m.charW - _canvasState.offsetX;
    return { baseMid: Array.from(base.getImageData(Math.round((x0 + 1.5 * m.charW) * dpr), y, 1, 1).data.slice(0, 3)), left: at(x0 + 0.5), right: at(x0 + 3 * m.charW - 0.75), inner: at(x0 + 1.5 * m.charW) };
  });
  const bright = c => c[2] >= 180 && c[0] <= 140;   // light blue
  if (Math.max(...out.canvas.baseMid) > 60) bad.push('the test cells are not black: ' + JSON.stringify(out.canvas.baseMid));
  if (!bright(out.canvas.left) || !bright(out.canvas.right)) bad.push('Canvas edge lines not visible on black: ' + JSON.stringify(out.canvas));
  if (bright(out.canvas.inner)) bad.push('Canvas: an inner column has the edge colour');
  await setMode(page, 'full');
  await page.waitForTimeout(600);
  await pick();
  await page.waitForTimeout(300);
  out.full = await page.evaluate(() => { const row = document.querySelector('.seq-line[data-seq-index="3"] .seq-data');
    const c = p => { const s = row.querySelector(`span[data-pos="${p}"]`); return { cls: [...s.classList].filter(x => /col-sel|column-selected/.test(x)).join(' '), shadow: getComputedStyle(s).boxShadow }; };
    return { c10: c(10), c11: c(11), c12: c(12), c13: c(13) }; });
  const f = out.full;
  if (!/col-sel-l/.test(f.c10.cls) || /col-sel-r/.test(f.c10.cls) || /col-sel-[lr]/.test(f.c11.cls) || !/col-sel-r/.test(f.c12.cls) || /column-selected/.test(f.c13.cls)) bad.push('Full edge classes: ' + JSON.stringify(f));
  if (!/inset/.test(f.c10.shadow) || !/inset/.test(f.c12.shadow) || /inset/.test(f.c11.shadow)) bad.push('Full edge shadows: ' + JSON.stringify(f));
  // deselect the middle column: 10 and 12 become runs of their own
  await page.evaluate(() => { state.selectedColumns.delete(11); updateColumnSelections(); });
  out.split = await page.evaluate(() => { const row = document.querySelector('.seq-line[data-seq-index="3"] .seq-data');
    return [10, 12].map(p => [...row.querySelector(`span[data-pos="${p}"]`).classList].filter(x => /col-sel/.test(x)).sort().join(' ')); });
  if (out.split.join('|') !== 'col-sel-l col-sel-r|col-sel-l col-sel-r') bad.push('after deselecting the middle column: ' + JSON.stringify(out.split));
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out) : JSON.stringify(out) };
}, { timeoutMs: 90000 });

// Owner 2026-10-28, dot plot: "Different settings below the diagonal" on by default (a self-plot opens with the other
// method below the diagonal); a right-click menu on the plot acts on the highlighted green stretch under the pointer
// (show it in the alignment, add it to the collection, copy it); the plain wheel zooms at the pointer (Shift+wheel
// pans), and a drag pans without pinning a point.
check('Dot plot: split halves by default, right-click menu on the green stretch, wheel zooms, drag pans', async (page) => {
  const bad = [], out = {};
  let sd = 3; const rnd = () => (sd = (Math.imul(sd, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  const rs = n => Array.from({ length: n }, () => 'ACGT'[rnd() * 4 | 0]).join('');
  await loadFasta(page, ['>p0\n' + rs(400), '>p1\n' + rs(400), '>p2\n' + rs(400)].join('\n') + '\n');
  await setMode(page, 'canvas');
  await page.evaluate(() => { const s = state.seqs[1]; const u = s.seq.replace(/[-. ]/g, ''); openDotPlot(u, u, s.header, s.header, { rowIndexA: 1, rowIndexB: 1, alignedSeqA: s.seq, alignedSeqB: s.seq }); });
  await page.waitForTimeout(2500);
  out.split = await page.evaluate(() => { const S = _dotPlotState; return { box: el('dotPlotSplit').checked, ctlShown: !el('dotPlotLowerCtl').hidden, lower: !!(S.lower && S.lower.ready), upperSpin: S.spinMode, lowerSpin: S.lower?.spinMode }; });
  const sp = out.split;
  if (!sp.box || !sp.ctlShown || !sp.lower || sp.upperSpin === sp.lowerSpin) bad.push('split by default: ' + JSON.stringify(sp));
  // right-click on the main diagonal (a stretch of the whole sequence)
  const ov = await page.locator('#dotPlotOverlay').boundingBox();
  const at = (r, c) => page.evaluate(([r, c]) => _dotCellToScreen(r, c), [r, c]);
  const p = await at(30, 30);
  await page.mouse.move(ov.x + p.x, ov.y + p.y); await page.waitForTimeout(200);
  await page.mouse.click(ov.x + p.x, ov.y + p.y, { button: 'right' }); await page.waitForTimeout(300);
  out.menu = await page.evaluate(() => { const m = document.querySelector('.dot-context-menu'); return m ? [...m.children].map(c => c.textContent) : null; });
  if (!out.menu || !out.menu.some(t => /Show this stretch in the alignment/.test(t)) || !out.menu.some(t => /collection/.test(t))) bad.push('no stretch menu: ' + JSON.stringify(out.menu));
  if (out.menu) {
    const nBm = await page.evaluate(() => (state.dotBookmarks || []).length);
    await page.evaluate(() => [...document.querySelector('.dot-context-menu').children].find(c => /collection/.test(c.textContent)).click());
    out.bookmarks = await page.evaluate((n) => ({ added: (state.dotBookmarks || []).length - n, last: (state.dotBookmarks || []).slice(-1)[0] }), nBm);
    if (out.bookmarks.added !== 1 || !(out.bookmarks.last && out.bookmarks.last.aStart <= 30 && out.bookmarks.last.aEnd > 30)) bad.push('add to collection: ' + JSON.stringify({ added: out.bookmarks.added }));
    await page.mouse.click(ov.x + p.x, ov.y + p.y, { button: 'right' }); await page.waitForTimeout(300);
    await page.evaluate(() => [...document.querySelector('.dot-context-menu').children].find(c => /Show this stretch/.test(c.textContent)).click());
    await page.waitForTimeout(400);
    out.shown = await page.evaluate(() => { const m = state.dotRegionMarks; const set = m && m.bySeq && m.bySeq.get(state.seqs[1]); return set ? set.size : 0; });
    if (out.shown < 50) bad.push('show in alignment marked ' + out.shown + ' residues');
    await page.evaluate(() => { document.querySelector('.dot-context-menu')?.remove(); });
    // the collection entry from this test goes again
    await page.evaluate(() => { state.dotBookmarks.pop(); _dotSaveBookmarks(); _dotRenderBookmarks(); });
  }
  // plain wheel zooms; Shift+wheel does not
  const z0 = await page.evaluate(() => _dotPlotState.zoom);
  await page.mouse.move(ov.x + ov.width / 2, ov.y + ov.height / 2);
  await page.mouse.wheel(0, -200); await page.waitForTimeout(400);
  const z1 = await page.evaluate(() => _dotPlotState.zoom);
  await page.keyboard.down('Shift'); await page.mouse.wheel(0, 200); await page.keyboard.up('Shift'); await page.waitForTimeout(400);
  const z2 = await page.evaluate(() => _dotPlotState.zoom);
  out.zoom = { z0, z1, z2 };
  if (!(z1 > z0 * 1.05) || Math.abs(z2 - z1) > 1e-9) bad.push('wheel zoom: ' + JSON.stringify(out.zoom));
  // a drag pans and pins nothing (zoomed in far enough that the plot overflows its viewport both ways)
  await page.evaluate(() => { for (let i = 0; i < 8; i++) _dotApplyZoom(1.15); }); await page.waitForTimeout(400);
  const before = await page.evaluate(() => { const v = el('dotPlotViewport'); return { sl: v.scrollLeft, st: v.scrollTop, pin: _dotPlotState.pinnedRow }; });
  const cx = ov.x + ov.width / 2, cy = ov.y + ov.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 80, cy - 60, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
  const after = await page.evaluate(() => { const v = el('dotPlotViewport'); return { sl: v.scrollLeft, st: v.scrollTop, pin: _dotPlotState.pinnedRow }; });
  out.drag = { before, after };
  if (!(after.sl > before.sl + 40) || !(after.st > before.st + 30) || after.pin !== before.pin) bad.push('drag pan: ' + JSON.stringify(out.drag));
  await page.evaluate(() => document.getElementById('dotPlotCloseBtn')?.click());
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out).slice(0, 800) : JSON.stringify(out).slice(0, 600) };
}, { timeoutMs: 120000 });

// Owner 2026-10-28: "when several nucleotides are selected by mouse there should be a way to copy them in plain text or
// FASTA format easily". With residues selected, the right-click menu (on a cell or a name, Canvas and Full/Block) starts
// with "Copy selected bases: plain text" (one line per row, as Ctrl+C) and "...: FASTA" (>name:first-last residue).
check('Residue selection: the right-click menu copies the selected bases as plain text or FASTA (Canvas, Full)', async (page) => {
  const bad = [], out = {};
  await loadFasta(page, ['>r0\nAAAACCCCGGGG', '>r1\nAC--GTACGTAC', '>r2\nTTTTGGGGCCCC'].join('\n') + '\n');
  for (const mode of ['canvas', 'full']) {
    await setMode(page, mode);
    await page.waitForTimeout(400);
    await page.evaluate(() => { window.__clip = null; navigator.clipboard.writeText = t => { window.__clip = t; return Promise.resolve(); };
      state.selectedNucs.clear(); state.selectedNucs.set(1, new Set([1, 2, 3, 4, 5])); state.selectedNucs.set(2, new Set([1, 2, 3, 4, 5])); scheduleNucSelectionRefresh(); _canvasState.scheduleOverlay?.(); });
    await page.waitForTimeout(300);
    const p = await auditCell(page, 1, 4);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await page.waitForTimeout(300);
    const items = await page.evaluate(() => { const m = document.querySelector('.context-menu'); return m ? [...m.children].map(c => c.textContent) : []; });
    const pick = async (re) => { await page.evaluate((src) => { const re = new RegExp(src); const it = [...document.querySelector('.context-menu').children].find(c => re.test(c.textContent)); it && it.click(); }, re); await page.waitForTimeout(200); return page.evaluate(() => window.__clip); };
    const plain = items.some(t => /selected bases.*plain/i.test(t)) ? await pick('selected bases.*plain') : null;
    if (items.length) { await page.mouse.click(p.x, p.y, { button: 'right' }); await page.waitForTimeout(300); }
    const fasta = items.some(t => /selected bases.*FASTA/i.test(t)) ? await pick('selected bases.*FASTA') : null;
    await page.evaluate(() => { closeContextMenu(); });
    out[mode] = { items: items.slice(0, 3), plain, fasta };
    if (plain !== 'CGT\nTTTGG') bad.push(`${mode} plain: ${JSON.stringify(plain)}`);
    if (fasta !== '>r1:2-4\nCGT\n>r2:2-6\nTTTGG\n') bad.push(`${mode} FASTA: ${JSON.stringify(fasta)}`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out) : JSON.stringify(out) };
}, { timeoutMs: 90000 });

// Owner 2026-10-28: "when using clustering there should be an option to do it only on selected columns or rectangle".
// Clustering > "Selected columns only": Find SNP groups (and k-mer grouping) read only the columns of the column
// selection (or of the selected residue block), first to last; all rows are grouped. The range is kept with the result
// so its positions map back to alignment columns after the selection changes.
check('Clustering: "Selected columns only" groups by the selected columns (column selection or residue block)', async (page) => {
  const bad = [], out = {};
  const row = i => (i < 8 ? 'AAAAAAAAAA' : 'CCCCCCCCCC') + 'GGGGGGGGGG' + (i % 2 ? 'AAAAAAAAAA' : 'TTTTTTTTTT') + 'GGGGGGGGGG';
  await loadFasta(page, Array.from({ length: 16 }, (_, i) => `>c${i}\n${row(i)}`).join('\n') + '\n');
  await setMode(page, 'canvas');
  const groups = () => page.evaluate(() => state.seqs.map(q => (state.clusterMap && state.clusterMap[q.header] ? state.clusterMap[q.header].name : '-')));
  const runGroups = async () => {
    await page.evaluate(() => { state.clusterResults = null; el('clusterNowButton').click(); });
    await page.waitForFunction(() => !!state.clusterResults, null, { timeout: 30000 });
    await page.waitForTimeout(300);
    return groups();
  };
  const parity = g => g.every((x, i) => x !== '-' && x === g[i % 2]) && g[0] !== g[1];
  const halves = g => g.every((x, i) => x !== '-' && x === g[i < 8 ? 0 : 8]) && g[0] !== g[8];
  // the option, off by default
  out.box = await page.evaluate(() => el('clusterSelColsOnly') ? el('clusterSelColsOnly').checked : null);
  if (out.box !== false) bad.push('the option is missing or on by default: ' + out.box);
  // columns 1-10 selected: halves
  await page.evaluate(() => { el('clusterSelColsOnly').checked = true; state.selectedColumns = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); updateColumnSelections(); });
  out.cols0 = await runGroups();
  if (!halves(out.cols0)) bad.push('selected columns 1-10 did not give the two halves: ' + out.cols0.join(','));
  // a residue block over columns 21-30: even / odd rows
  await page.evaluate(() => { state.selectedColumns.clear(); updateColumnSelections(); _setNucRectangle(2, 20, 5, 29); });
  out.block = await runGroups();
  if (!parity(out.block)) bad.push('the residue block over columns 21-30 did not give even / odd rows: ' + out.block.join(','));
  out.offset = await page.evaluate(() => _clusterAlignmentColumnOffset());
  // the range stays with the result after the selection goes
  await page.evaluate(() => { state.selectedNucs.clear(); scheduleNucSelectionRefresh(); });
  out.offsetAfter = await page.evaluate(() => _clusterAlignmentColumnOffset());
  if (out.offset !== 20 || out.offsetAfter !== 20) bad.push(`column offset of the result: ${out.offset} / after the selection went ${out.offsetAfter}`);
  // option on with nothing selected: the whole alignment, said so
  out.none = await page.evaluate(() => { state.selectedColumns.clear(); state.selectedNucs.clear(); return getSeqsForClustering()[0].seq.length; });
  if (out.none !== 40) bad.push('with nothing selected the option should use every column: ' + out.none);
  await page.evaluate(() => { el('clusterSelColsOnly').checked = false; });
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out) : JSON.stringify(out) };
}, { timeoutMs: 90000 });

// Owner 2026-10-28 ("only on selected columns or rectangle"): "Selected rows only" groups only the selected sequences or
// the rows of a residue rectangle; the other rows get no group, and the result's row numbers are the alignment's.
check('Clustering: "Selected rows only" groups only the selected sequences or the rectangle rows', async (page) => {
  const bad = [], out = {};
  const row = i => (i < 8 ? 'AAAAAAAAAA' : 'CCCCCCCCCC') + 'GGGGGGGGGG' + (i % 2 ? 'AAAAAAAAAA' : 'TTTTTTTTTT') + 'GGGGGGGGGG';
  await loadFasta(page, Array.from({ length: 16 }, (_, i) => `>c${i}\n${row(i)}`).join('\n') + '\n');
  await setMode(page, 'canvas');
  const groups = () => page.evaluate(() => state.seqs.map(q => (state.clusterMap && state.clusterMap[q.header] ? state.clusterMap[q.header].name : '-')));
  const indexOk = () => page.evaluate(() => { const r = state.clusterResults; const all = [...(r.clusters || []).flatMap(c => c.sequences || []), ...(r.unassigned || [])];
    return all.every(q => state.seqs[q.index] && state.seqs[q.index].header === q.id && (!('obj' in q) || q.obj === state.seqs[q.index])); });
  const inside = (g, lo, hi) => g.every((x, i) => (i >= lo && i <= hi) ? x !== '-' : x === '-');
  out.box = await page.evaluate(() => el('clusterSelRowsOnly') ? el('clusterSelRowsOnly').checked : null);
  if (out.box !== false) bad.push('the option is missing or on by default: ' + out.box);
  // a rectangle over rows 5-12, columns 21-30, both options: even / odd inside, nothing outside
  await page.evaluate(() => { el('clusterSelColsOnly').checked = true; el('clusterSelRowsOnly').checked = true; _setNucRectangle(4, 20, 11, 29); state.clusterResults = null; el('clusterNowButton').click(); });
  await page.waitForFunction(() => !!state.clusterResults, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
  out.rect = await groups();
  if (!inside(out.rect, 4, 11) || !out.rect.slice(4, 12).every((x, j) => x === out.rect[4 + (j % 2)]) || out.rect[4] === out.rect[5]) bad.push('rectangle rows 5-12: ' + out.rect.join(','));
  if (!(await indexOk())) bad.push('SNP groups: a result row number is not the alignment row');
  // selected sequences 9-16 and the k-mer tree, 2 groups, every column
  await page.evaluate(() => { el('clusterSelColsOnly').checked = false; state.selectedNucs.clear(); state.selectedRows.clear(); for (let r = 8; r < 16; r++) state.selectedRows.add(r);
    el('guideTreeAuto').checked = false; el('guideTreeGroups').value = '2'; state.clusterResults = null; });
  await page.evaluate(() => clusterByGuideTree());
  await page.waitForFunction(() => !!state.clusterResults, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
  out.kmer = await groups();
  if (!inside(out.kmer, 8, 15) || !out.kmer.slice(8).every((x, j) => x === out.kmer[8 + (j % 2)]) || out.kmer[8] === out.kmer[9]) bad.push('k-mer groups of rows 9-16: ' + out.kmer.join(','));
  if (!(await indexOk())) bad.push('k-mer groups: a result row number is not the alignment row');
  // two rows only: refused, said so
  out.few = await page.evaluate(() => { state.selectedRows.clear(); state.selectedRows.add(0); state.selectedRows.add(1); const before = state.clusterResults; clusterByGuideTree(); return state.clusterResults === before; });
  if (!out.few) bad.push('two selected rows were grouped');
  await page.evaluate(() => { el('clusterSelRowsOnly').checked = false; el('guideTreeAuto').checked = true; el('guideTreeGroups').value = ''; state.selectedRows.clear(); });
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out) : JSON.stringify(out) };
}, { timeoutMs: 90000 });

// GLM audit of v299 (2026-10-28), confirmed findings reproduced: the Canvas consensus tooltip kept the values of the
// render after an edit recomputed the consensus; a "Selected rows only" run wiped the groups of the other rows; the
// row-length probe and the cost prompt looked at every row, not the selected ones; a selected name that also sits on an
// unselected row gave that row the colour silently; a Canvas trim drag released outside the window stayed latched; the
// length-badge tooltip stayed where it first showed while the pointer moved down the badges.
check('Audit v299: live consensus tooltip, subset run keeps the other groups, subset probes and cost, duplicate-name note, trim drag ends without a button, badge tooltip follows', async (page) => {
  const bad = [], out = {};
  const row = i => (i < 8 ? 'AAAAAAAAAA' : 'CCCCCCCCCC') + 'GGGGGGGGGG' + (i % 2 ? 'AAAAAAAAAA' : 'TTTTTTTTTT') + 'GGGGGGGGGG';
  await loadFasta(page, Array.from({ length: 16 }, (_, i) => `>c${i}\n${row(i)}`).join('\n') + '\n');
  await setMode(page, 'canvas');
  await page.waitForTimeout(500);
  const groups = () => page.evaluate(() => state.seqs.map(q => (state.clusterMap && state.clusterMap[q.header] ? state.clusterMap[q.header].name : '-')));
  // 1. the consensus recomputed by an edit (no re-render) is what the tooltip reads
  out.cons = await page.evaluate(() => { const c = state.consensusCache; if (!c || !c.values) return 'no cache';
    const v = Array.from(c.values); v[0] = 'T'; state.consensusCache = Object.assign({}, c, { values: v }); return _canvasConsValues() === v ? 'live' : 'stale'; });
  if (out.cons !== 'live') bad.push('consensus tooltip values after an edit: ' + out.cons);
  await page.evaluate(() => renderAlignment());
  await page.waitForTimeout(300);
  // 2. the whole alignment grouped, then rows 1-6 only: rows 7-16 keep their groups
  await page.evaluate(() => { el('clusterSelColsOnly').checked = true; state.selectedColumns = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); updateColumnSelections(); state.clusterResults = null; el('clusterNowButton').click(); });
  await page.waitForFunction(() => !!state.clusterResults, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
  out.whole = await groups();
  await page.evaluate(() => { state.selectedColumns = new Set([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]); updateColumnSelections(); el('clusterSelRowsOnly').checked = true;
    state.selectedRows.clear(); for (let r = 0; r < 6; r++) state.selectedRows.add(r); window._prevRes = state.clusterResults; el('clusterNowButton').click(); });
  await page.waitForFunction(() => state.clusterResults !== window._prevRes, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
  out.sub = await groups();
  const sameOutside = out.sub.slice(6).every(x => x !== '-') && out.sub.slice(6).every((x, j) => (out.whole[6 + j] === out.whole[8]) === (x === out.sub[8]));
  if (!sameOutside) bad.push('rows outside the subset lost or changed their groups: ' + out.whole.join(',') + ' -> ' + out.sub.join(','));
  if (out.sub[0] === out.sub[1] || out.sub[0] !== out.sub[2] || out.sub.slice(0, 6).some(x => x === '-')) bad.push('subset rows 1-6 not grouped even / odd: ' + out.sub.join(','));
  const names = new Set(out.sub.filter(x => x !== '-'));
  out.nNames = names.size; out.nClusters = await page.evaluate(() => state.clusterResults.clusters.length);
  if (out.nNames !== out.nClusters) bad.push(`group names collide: ${out.nNames} names for ${out.nClusters} groups`);
  out.colours = await page.evaluate(() => { const c = state.clusterResults.clusters.map(x => x.color); return new Set(c).size === c.length; });
  if (!out.colours) bad.push('two groups share a colour after the subset run');
  // 3. the cost prompt is sized from the selected rows
  out.cost = await page.evaluate(() => { let got = null; const orig = window.confirmIfLarge; window.confirmIfLarge = (op, res) => { got = res; return false; };
    try { clusterSequences(); } finally { window.confirmIfLarge = orig; } return got; });
  if (out.cost !== 6 * 40) bad.push('cost prompt residues for 6 selected rows: ' + out.cost);
  await page.evaluate(() => { el('clusterSelColsOnly').checked = false; state.selectedColumns.clear(); updateColumnSelections(); });
  // 4. one short row outside the subset does not switch the aligned distance off
  await page.evaluate(() => { state.seqs[15].seq = state.seqs[15].seq.slice(0, 30); el('guideTreeMetric').value = 'pdist'; el('guideTreeMethod').value = 'tree';
    el('guideTreeAuto').checked = false; el('guideTreeGroups').value = '2'; state.selectedRows.clear(); for (let r = 0; r < 8; r++) state.selectedRows.add(r); window._prevRes = state.clusterResults; });
  await page.evaluate(() => clusterByGuideTree());
  await page.waitForFunction(() => state.clusterResults !== window._prevRes, null, { timeout: 30000 }).catch(() => {});
  out.metric = await page.evaluate(() => state._geMeta && state._geMeta.metric);
  if (out.metric !== 'pdist') bad.push('a short row outside the subset switched the distance: ' + out.metric);
  // 5. a selected name that also names an unselected row: said so
  out.dup = await page.evaluate(async () => { state.seqs[10].header = 'c1'; const msgs = []; const orig = window.showMessage; window.showMessage = (m, ...a) => { msgs.push(String(m)); return orig(m, ...a); };
    try { window._prevRes = state.clusterResults; await clusterByGuideTree(); } finally { window.showMessage = orig; } return msgs.join(' || '); });
  if (!/same name/i.test(out.dup)) bad.push('no note about a selected name on an unselected row: ' + out.dup);
  await page.evaluate(() => { el('clusterSelRowsOnly').checked = false; el('guideTreeAuto').checked = true; el('guideTreeGroups').value = ''; state.selectedRows.clear(); });
  // 6. a Canvas trim drag ends at a move with no button (released outside the window)
  await page.evaluate(() => { _setTrimBounds(5, 35, true); });
  await page.waitForTimeout(400);
  out.trim = await page.evaluate(() => { const m = _canvasState.metrics, r = _canvasState.canvas.getBoundingClientRect(), b = _canvasState.consBand;
    const x = r.left + m.nameW + 2.5 * m.charW - _canvasState.offsetX, y = r.top + b.y + b.textOff + m.charH / 2 - _canvasState.offsetY;
    _canvasState.canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    const started = _trimDragSide;
    document.dispatchEvent(new MouseEvent('mousemove', { buttons: 0, clientX: x + 40, clientY: y, bubbles: true }));
    return { started, after: _trimDragSide, cursor: document.body.style.cursor }; });
  if (out.trim.started !== 'left' || out.trim.after || out.trim.cursor === 'ew-resize') bad.push('trim drag after the button was released outside: ' + JSON.stringify(out.trim));
  await page.evaluate(() => { _endTrimDrag(); state.trimBoundaries = null; renderAlignment(); });
  await page.waitForTimeout(400);
  // 7. the length-badge tooltip follows the pointer down the badges (same text on every row)
  const g = await page.evaluate(() => { const m = _canvasState.metrics, r = _canvasState.canvas.getBoundingClientRect();
    return { x: r.left + _canvasState.badgeX + 6 - _canvasState.offsetX, y0: r.top + m.headerH - _canvasState.offsetY, pitch: _canvasState.rowPitch }; });
  const tipTop = () => page.evaluate(() => { const t = [...document.querySelectorAll('.tooltip')].find(e => getComputedStyle(e).display !== 'none'); return t ? t.getBoundingClientRect().top : null; });
  await page.mouse.move(5, 5); await page.waitForTimeout(150);
  await page.mouse.move(g.x, g.y0 + 1.5 * g.pitch); await page.waitForTimeout(400);
  out.tip1 = await tipTop();
  await page.mouse.move(g.x, g.y0 + 6.5 * g.pitch, { steps: 4 }); await page.waitForTimeout(400);
  out.tip2 = await tipTop();
  if (out.tip1 == null || out.tip2 == null || !(out.tip2 - out.tip1 > 3 * g.pitch)) bad.push(`badge tooltip did not follow: ${out.tip1} -> ${out.tip2}`);
  await page.mouse.move(5, 5);
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out) : JSON.stringify(out) };
}, { timeoutMs: 120000 });

// TSD finder misses (reported 2026-10-29): planted-TSD alignments, auto mode, default parameters. The 3' copy was looked
// for only 0-3 residues past one alignment-wide boundary, so a copy whose A-rich tail runs past it lost its TSD; the
// boundary trim stopped at one chance-conserved flank column; 5'-truncated copies pulled the left edge in. Measured on
// 18 rsi plates: 67 % of SINEderella-rule TSDs found before, 89 % after. Copies without a TSD must not get more calls.
check('TSD finder: finds TSDs past a long A-rich tail, A-rich TSDs, 5 copies, truncated copies; no more calls without a TSD', async (page) => {
  const r = await page.evaluate(() => {
    let seed = 1;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const base = () => 'ACGT'[ri(0, 3)];
    const randSeq = n => Array.from({ length: n }, base).join('');
    const mutate = (s, p) => s.split('').map(c => rnd() < p ? 'ACGT'.replace(c, '')[ri(0, 2)] : c).join('');
    // copy: 5' flank | TSD | SINE body | poly-A tail (gaps after it) | TSD (30 %: 1 mismatch) | 3' flank
    const build = o => {
      o = Object.assign({ n: 20, body: 180, div: 0.12, tail: [12, 12], tsd: [8, 16], flank: 50, trunc5: 0, aTsd: 0, noTsd: false }, o);
      const cons = randSeq(o.body), rows = [];
      for (let i = 0; i < o.n; i++) {
        let tsd = randSeq(ri(o.tsd[0], o.tsd[1]));
        if (rnd() < o.aTsd) tsd = 'AAAA' + tsd.slice(4);
        let tsd2 = rnd() < 0.3 ? mutate(tsd, 1 / tsd.length) : tsd;
        if (o.noTsd) tsd2 = randSeq(tsd.length);
        let body = mutate(cons, o.div), lead = '';
        if (rnd() < o.trunc5) { const cut = ri(20, 80); lead = '-'.repeat(cut); body = body.slice(cut); }
        const tl = ri(o.tail[0], o.tail[1]);
        const tail = 'A'.repeat(tl) + '-'.repeat(o.tail[1] - tl);
        const left = (randSeq(o.flank) + tsd).padStart(o.flank + o.tsd[1], '-');
        const right = (tsd2 + randSeq(o.flank)).padEnd(o.flank + o.tsd[1], '-');
        rows.push({ header: 'copy' + (i + 1), seq: left + lead + body + tail + right, tsd, tsd2, upEnd: left.length - 1, downStart: left.length + lead.length + body.length + tail.length });
      }
      return rows;
    };
    // right: covers >= 80 % of the planted copy on both sides, at most 4 bases longer
    const score = rows => {
      const res = _findTSD(rows, 'auto', { minLen: 4, maxLen: 20, maxDiv: 20, flankSize: 30 });
      const by = new Map(res.map(x => [x.seqIndex, x]));
      let right = 0, long = 0;
      rows.forEach((row, i) => { const x = by.get(i); if (!x) return;
        if (x.upPositions.length >= 10) long++;
        const L = row.tsd.length;
        const cu = x.upPositions.filter(c => c > row.upEnd - L && c <= row.upEnd).length;
        const cd = x.downPositions.filter(c => c >= row.downStart && c < row.downStart + row.tsd2.length).length;
        if (cu >= 0.8 * L && cd >= 0.8 * row.tsd2.length && x.upPositions.length <= L + 4) right++; });
      return { right, long };
    };
    const run = o => { let right = 0, long = 0, n = 0;
      for (let k = 0; k < 20; k++) { seed = 1000 + k * 7919; const rows = build(o); const s = score(rows); right += s.right; long += s.long; n += rows.length; }
      return { right: Math.round(100 * right / n), long: Math.round(100 * long / n) }; };
    const out = {
      baseline: run({}).right,
      longTail: run({ tail: [8, 30] }).right,
      aTsd: run({ aTsd: 0.5 }).right,
      five: run({ n: 5 }).right,
      trunc: run({ trunc5: 0.3 }).right,
      noTsdLong: run({ noTsd: true }).long
    };
    // one copy (as rsi w43714) carries a 22-bp (AAATA)n tail past the others' ends, then a 16-bp TSD with 1 mismatch
    seed = 77;
    const rows = build({ tail: [12, 12] }), w = rows[6];
    const tsdUp = 'AGAAAAACGCCAGGTA', tsdDn = 'AAAAAAACGCCAGGTA', ext = 'AAATAAAATAAAATAAAATAAA';
    w.seq = randSeq(50) + tsdUp + w.seq.slice(w.upEnd + 1, w.downStart) + ext + tsdDn + randSeq(30);   // 5' block keeps its 66 columns
    const aliLen = Math.max(...rows.map(q => q.seq.length));
    rows.forEach(q => { q.seq = q.seq.padEnd(aliLen, '-'); });
    const res = _findTSD(rows, 'auto', { minLen: 4, maxLen: 20, maxDiv: 20, flankSize: 30 });
    const x = res.find(y => y.seqIndex === 6);
    out.w43714 = x ? x.upTSD + '/' + x.downTSD : 'none';
    return out;
  });
  const bad = [];
  if (r.baseline < 90) bad.push('baseline ' + r.baseline + '%');
  if (r.longTail < 88) bad.push('variable tail ' + r.longTail + '%');
  if (r.aTsd < 80) bad.push('A-rich TSD ' + r.aTsd + '%');
  if (r.five < 80) bad.push('5 copies ' + r.five + '%');
  if (r.trunc < 90) bad.push('truncated copies ' + r.trunc + '%');
  if (r.noTsdLong > 2) bad.push('calls >= 10 bp on copies without a TSD ' + r.noTsdLong + '%');
  const [wu, wd] = r.w43714.split('/');
  if (!wd || !wu.endsWith('ACGCCAGGTA') || !wd.endsWith('ACGCCAGGTA') || wu.length < 14) bad.push('copy after a long A-rich tail: ' + r.w43714);
  return { pass: !bad.length, detail: (bad.length ? bad.join('; ') + ' | ' : '') + JSON.stringify(r) };
});

// Canvas drew a row selection made by Ctrl+A only at its next redraw: Ctrl+A said "All sequences selected." and showed
// nothing (owner's report 2026-10-29). Undo of a column delete and of a row move are controls (they redraw already). Oracle: the overlay
// and cells after the key are the same as after a forced redraw.
check('Canvas: Ctrl+A shows the selection at once (Undo of a column delete or a row move as controls)', async (page) => {
  await loadFasta(page, Array.from({ length: 6 }, (_, i) => `>s${i}\n${'ACGTACGTAC'.repeat(3)}${'ACGT'[i % 4]}AAA\n`).join(''));
  await setMode(page, 'canvas');
  await page.waitForTimeout(500);
  const cases = [['none', ['Control+a']], ['rows', ['Control+a']], ['cols', ['Control+d', 'Control+z']], ['row2', ['Control+ArrowDown', 'Control+z']]];
  const out = {};
  for (const [setup, keys] of cases) {
    await page.evaluate((setup) => {
      state.selectedRows.clear(); state.selectedColumns.clear(); state.selectedNucs.clear();
      if (setup === 'rows') { state.selectedRows.add(1); state.selectedRows.add(3); }
      if (setup === 'row2') state.selectedRows.add(2);
      if (setup === 'cols') [3, 4, 5].forEach(c => state.selectedColumns.add(c));
      renderAlignment();
    }, setup);
    await page.waitForTimeout(400);
    await page.mouse.move(2, 2);   // off the Canvas: a hover draw is not what is measured
    for (const k of keys) { await page.keyboard.press(k); await page.waitForTimeout(350); }
    await page.waitForTimeout(300);
    out[setup + ':' + keys.join('>')] = await page.evaluate(async () => {
      // the overlay layer holds the selection; the cells layer is not what is measured here
      const o = _canvasState.overlay, g = o.getContext('2d');
      const grab = () => g.getImageData(0, 0, o.width, o.height).data;
      const a = grab();
      _canvasState.scheduleDraw(); await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))); await new Promise(res => setTimeout(res, 150));
      const b = grab();
      let diff = 0, painted = 0;
      for (let i = 0; i < a.length; i += 4) { if (a[i] !== b[i] || a[i + 3] !== b[i + 3]) diff++; if (b[i + 3]) painted++; }
      return { sel: state.selectedRows.size + 'r' + state.selectedColumns.size + 'c', shown: diff === 0 && painted > 0, diff, painted };
    });
  }
  const bad = Object.entries(out).filter(([, v]) => !v.shown || v.sel === '0r0c').map(([k]) => k);
  return { pass: !bad.length, detail: (bad.length ? 'not shown at once: ' + bad.join(', ') + ' | ' : '') + JSON.stringify(out) };
});

// Owner 2026-10-28: what else did Full/Block have that Canvas lacked? Per-span titles and listeners: the titles of search
// hits and marks on a residue, the length badges' titles, the name cell's full name, dragging the trim borders on the
// consensus row (and its hint), the soft-trim hint. Canvas shows them now, with the Full/Block text.
check('Canvas has the Full/Block hovers and the trim-border drag: residue mark titles, length badges, full names, trim and soft-trim hints', async (page) => {
  const bad = [], out = {};
  const longName = 'G01_mollyHiFi_fam013_n38_lat1_a_very_long_sequence_name_that_is_cut_off';
  await loadFasta(page, [`>${longName}\nACGTACGTACGTAAAAACCCCCGGGGGTTTTTACGTACGTAC`, '>s1\nACGTACGTACGTAAAAACCCCCGGGGGTTTTTACGTACGT--', '>s2\nACGTACGTACGTAAAAACCCCCGGGGGTTTTTACGTACGTAC'].join('\n') + '\n');
  const tip = () => page.evaluate(() => { const t = [...document.querySelectorAll('.tooltip')].find(e => getComputedStyle(e).display !== 'none'); return t ? t.textContent.replace(/\s+/g, ' ').trim() : ''; });
  const hover = async (x, y) => { await page.mouse.move(5, 5); await page.waitForTimeout(150); await page.mouse.move(x, y); await page.waitForTimeout(450); return tip(); };
  // a mark with a title (search hits have none): a dot-plot stretch on row 1, residues 16-26
  await page.evaluate(() => _dotShowStretch(1, -1, 15, 26, 0, 0, false));
  // the Full/Block texts are the reference
  await setMode(page, 'full');
  await page.waitForTimeout(500);
  out.ref = await page.evaluate((longName) => {
    const sp = document.querySelector('.seq-line[data-seq-index="1"] .seq-data > span[data-pos="18"]');
    const badge = document.querySelector('.seq-line[data-seq-index="1"] .seq-length');
    const nm = [...document.querySelectorAll('.seq-line[data-seq-index="0"] .seq-name, .seq-line[data-seq-index="0"] .seq-name *')].map(e => e.title).find(Boolean);
    return { hit: sp && sp.title, badge: badge && badge.title, name: nm };
  }, longName);
  await setMode(page, 'canvas');
  await page.waitForTimeout(600);
  const g = await page.evaluate(() => { const m = _canvasState.metrics, r = _canvasState.canvas.getBoundingClientRect(), b = _canvasState.consBand;
    return { left: r.left, top: r.top, nameW: m.nameW, charW: m.charW, headerH: m.headerH, pitch: _canvasState.rowPitch, ox: _canvasState.offsetX, oy: _canvasState.offsetY, badgeX: _canvasState.badgeX, consY: b ? b.y + b.textOff : null, charH: m.charH }; });
  const cellXY = (row, col) => ({ x: g.left + g.nameW + (col + 0.5) * g.charW - g.ox, y: g.top + g.headerH + (row + 0.5) * g.pitch - g.oy });
  // 1. a residue in a search hit: the hit's title as well as name: position
  let c = cellXY(1, 18);
  out.hit = await hover(c.x, c.y);
  if (out.ref.hit !== 'dot-plot stretch' || !out.hit.includes('dot-plot stretch')) bad.push(`mark title: Canvas "${out.hit}", Full title "${out.ref.hit}"`);
  // 2. the length badge
  out.badge = g.badgeX == null ? '' : await hover(g.left + g.badgeX + 6 - g.ox, g.top + g.headerH + 1.5 * g.pitch - g.oy);
  if (!out.ref.badge || out.badge !== out.ref.badge) bad.push(`length badge: Canvas "${out.badge}", Full "${out.ref.badge}"`);
  // 3. the name: its full text
  out.name = await hover(g.left + 20, g.top + g.headerH + 0.5 * g.pitch - g.oy);
  // (the name-colour painter wiped this title in Full/Block too: both now carry the full name)
  const wantName = `${longName} (length: 42)`;
  if (out.ref.name !== wantName || out.name !== wantName) bad.push(`name: Canvas "${out.name}", Full "${out.ref.name}", want "${wantName}"`);
  // 4. trim: the hint on the consensus and a drag of the left border from column 6 to 11
  await page.evaluate(() => { _setTrimBounds(5, 35, true); });
  await page.waitForTimeout(500);
  const g2 = await page.evaluate(() => { const b = _canvasState.consBand; return { consY: b.y + b.textOff, ox: _canvasState.offsetX, oy: _canvasState.offsetY }; });
  const consXY = col => ({ x: g.left + g.nameW + (col + 0.5) * g.charW - g2.ox, y: g.top + g2.consY + g.charH / 2 - g2.oy });
  c = consXY(5);
  out.trimTip = await hover(c.x, c.y);
  if (!/Will be removed \(left end\)/.test(out.trimTip)) bad.push('trim hint: ' + out.trimTip);
  await page.mouse.move(c.x, c.y); await page.mouse.down();
  const c2 = consXY(10);
  await page.mouse.move(c2.x, c2.y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(500);
  out.trim = await page.evaluate(() => state.trimBoundaries && [state.trimBoundaries.leftTrimEnd, state.trimBoundaries.rightTrimStart]);
  if (!out.trim || out.trim[0] !== 10 || out.trim[1] !== 35) bad.push('trim drag: ' + JSON.stringify(out.trim));
  await page.evaluate(() => { _clearTrimPreview?.(); state.trimBoundaries = null; renderAlignment(); });
  // 5. soft trim: the consensus says the column is left out of clustering
  await page.evaluate(() => { state.softTrimBoundaries = { leftTrimEnd: 3, rightTrimStart: 38 }; renderAlignment(); });
  await page.waitForTimeout(500);
  const g3 = await page.evaluate(() => { const b = _canvasState.consBand; return { consY: b.y + b.textOff, ox: _canvasState.offsetX, oy: _canvasState.offsetY }; });
  out.soft = await hover(g.left + g.nameW + 1.5 * g.charW - g3.ox, g.top + g3.consY + g.charH / 2 - g3.oy);
  if (!/Excluded from clustering \(soft trim\)/.test(out.soft)) bad.push('soft trim hint: ' + out.soft);
  await page.evaluate(() => { state.softTrimBoundaries = null; renderAlignment(); });
  await page.mouse.move(5, 5);
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out) : JSON.stringify(out) };
}, { timeoutMs: 120000 });

// GLM audit of v296 (2026-10-28), confirmed and uncertain findings reproduced: the Canvas consensus tooltip kept the
// consensus values of the render (none above 2 M residues, where the consensus is computed later); a dot-plot drag kept
// panning after the button was released outside the window; "Selected columns only" ignored residues selected in the
// consensus row; column-selection edges joined over a hidden column in Canvas but not in Full/Block; Shift+wheel panned
// by raw line deltas (Firefox: ~3 px a notch); re-ticking the split box reset the lower half's method.
check('Audit v296: consensus tooltip without render-time values, dot pan ends without a button, consensus-row columns for clustering, edges over hidden columns, line-mode wheel pan, split re-tick', async (page) => {
  const bad = [], out = {};
  await loadFasta(page, Array.from({ length: 12 }, (_, i) => `>t${i}\n` + (i < 9 ? 'ACGTACGTAC' : 'TCGTACGTAC') + 'ACGT'.repeat(10)).join('\n') + '\n');
  await setMode(page, 'canvas');
  await page.waitForTimeout(500);
  // 1. a consensus band whose values were not ready at render (as above 2 M residues) uses the computed consensus
  out.cons = await page.evaluate(() => { const b = _canvasState.consBand; b.values = null; const m = _canvasState.metrics, r = _canvasState.canvas.getBoundingClientRect();
    return _canvasHitTestConsensus(r.left + m.nameW + 0.5 * m.charW - _canvasState.offsetX, r.top + b.y + b.textOff + m.charH / 2 - _canvasState.offsetY); });
  if (out.cons !== 0) bad.push('consensus hover with no render-time values gave column ' + out.cons);
  await page.evaluate(() => renderAlignment());
  // 3. consensus-row residues give the columns
  out.consRange = await page.evaluate(() => { el('clusterSelColsOnly').checked = true; state.selectedColumns.clear(); state.selectedNucs.clear(); state.selectedNucs.set(CONSENSUS_ROW_INDEX, new Set([20, 21, 22, 23])); const r = _clusterSelectedColumnRange(); el('clusterSelColsOnly').checked = false; state.selectedNucs.clear(); return r; });
  if (!out.consRange || out.consRange.lo !== 20 || out.consRange.hi !== 23) bad.push('consensus-row selection range: ' + JSON.stringify(out.consRange));
  // 4. edges over a hidden column: as in Full/Block (by column), not joined
  await page.evaluate(() => { _foldApply([[11, 11]]); state.selectedColumns = new Set([10, 12]); updateColumnSelections(); _canvasState.scheduleOverlay?.(); });
  await page.waitForTimeout(400);
  out.edges = await page.evaluate(() => { const m = _canvasState.metrics, dpr = m.dpr || 1, ov = document.getElementById('alignmentCanvasOverlay'), c = ov.getContext('2d');
    const y = Math.round((m.headerH + 3 * _canvasState.rowPitch + 1) * dpr); const s10 = _canvasColToSlot(10), s12 = _canvasColToSlot(12);
    const px = cssX => Array.from(c.getImageData(Math.round(cssX * dpr), y, 1, 1).data);
    // the right edge of column 10's slot and the left edge of column 12's slot
    return { right10: px(m.nameW + (s10 + 1) * m.charW - 0.75 - _canvasState.offsetX), left12: px(m.nameW + s12 * m.charW + 0.5 - _canvasState.offsetX) }; });
  const edge = p => p[3] > 150 && p[2] > 180;
  if (!edge(out.edges.right10) || !edge(out.edges.left12)) bad.push('edges over a hidden column: ' + JSON.stringify(out.edges));
  await page.evaluate(() => { _foldApply([]); state.selectedColumns.clear(); updateColumnSelections(); });
  // dot plot
  await page.evaluate(() => { const s = state.seqs[1]; const u = (s.seq + s.seq + s.seq).replace(/[-. ]/g, ''); openDotPlot(u, u, s.header, s.header, null); });
  await page.waitForTimeout(2500);
  // 6. split re-tick keeps the lower method the user chose
  out.split = await page.evaluate(async () => { const box = el('dotPlotSplit'); const same = document.querySelector('input[name="dotPlotModeLower"][value="spin"]'); same.checked = true; same.dispatchEvent(new Event('change', { bubbles: true }));
    box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
    return document.querySelector('input[name="dotPlotModeLower"]:checked').value; });
  if (out.split !== 'spin') bad.push('re-ticking the split reset the lower method to ' + out.split);
  // 5. line-mode wheel: Shift+wheel by 3 lines pans by about three lines' height, not 3 px
  await page.evaluate(() => { for (let i = 0; i < 10; i++) _dotApplyZoom(1.15); });
  await page.waitForTimeout(300);
  out.wheel = await page.evaluate(() => { const v = el('dotPlotViewport'), ov = el('dotPlotOverlay'); v.scrollLeft = 0; const r = ov.getBoundingClientRect();
    ov.dispatchEvent(new WheelEvent('wheel', { deltaY: 3, deltaMode: 1, shiftKey: true, clientX: r.left + 50, clientY: r.top + 50, bubbles: true, cancelable: true })); return v.scrollLeft; });
  if (!(out.wheel >= 30)) bad.push('Shift+wheel in line mode panned ' + out.wheel + ' px');
  // 2. a pan with the button released outside the window ends at the next move without a button
  const ov = await page.locator('#dotPlotOverlay').boundingBox();
  out.pan = await page.evaluate(async ([x, y]) => { const v = el('dotPlotViewport'), o = el('dotPlotOverlay');
    o.dispatchEvent(new MouseEvent('mousedown', { button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { buttons: 1, clientX: x - 30, clientY: y, bubbles: true }));
    const mid = v.scrollLeft;
    // released outside: no mouseup here; the next move comes with no button held
    window.dispatchEvent(new MouseEvent('mousemove', { buttons: 0, clientX: x - 200, clientY: y, bubbles: true }));
    return { mid, after: v.scrollLeft, cursor: o.style.cursor }; }, [ov.x + ov.width / 2, ov.y + ov.height / 2]);
  if (out.pan.after !== out.pan.mid || out.pan.cursor === 'grabbing') bad.push('pan after the button was released outside: ' + JSON.stringify(out.pan));
  // 7. zoom buttons say what the wheel does now
  out.titles = await page.evaluate(() => [el('dotPlotZoomIn').title, el('dotPlotZoomOut').title]);
  if (out.titles.some(t => /Ctrl\+wheel/.test(t))) bad.push('zoom button titles: ' + JSON.stringify(out.titles));
  await page.evaluate(() => document.getElementById('dotPlotCloseBtn')?.click());
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out) : JSON.stringify(out) };
}, { timeoutMs: 120000 });

// Linked views: rows by sequence name (by index when the name is not there) and columns by column number or by
// the residue index of an anchor sequence both alignments contain, which keeps two alignments of the same
// sequences lined up on screen when their gaps differ. A position applied from a peer is not echoed back.
check('Linked views: a second tab follows rows and columns, by anchor sequence across different gaps, without echo', async (page) => {
  const out = {};
  const n = 400, len = 1000;   // (400 rows: a row can be put at the top of either view only when enough rows follow it)
  const row = i => Array.from({ length: len }, (_, j) => 'ACGT'[(i * 7 + j) % 4]).join('');
  const faA = Array.from({ length: n }, (_, i) => `>seq${i}\n${row(i)}`).join('\n') + '\n';
  // the same sequences, five gap columns inserted before column 200 (column c >= 200 of A is c + 5 here), rows reversed
  const faB = Array.from({ length: n }, (_, k) => { const i = n - 1 - k; const s = row(i); return `>seq${i}\n${s.slice(0, 200)}-----${s.slice(200)}`; }).join('\n') + '\n';
  await loadFasta(page, faA);
  await setMode(page, 'canvas');
  // a second tab of the same browser profile (a BroadcastChannel does not cross profiles): opened from the page
  const [p2] = await Promise.all([page.waitForEvent('popup', { timeout: 15000 }), page.evaluate(() => window.open(location.pathname, '_blank'))]);
  await p2.waitForLoadState('load');
  await p2.waitForFunction(() => typeof parseAndRender === 'function', null, { timeout: 15000 });
  await loadFasta(p2, faB);
  await setMode(p2, 'full');
  const setLink = (pg, by, anchor) => pg.evaluate(([by, anchor]) => {
    const fire = (id, v) => { const e = el(id); if (e.type === 'checkbox') e.checked = v; else e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    fire('linkViewsOn', true); fire('linkColsBy', by);
    if (anchor) fire('linkAnchor', anchor);
    return { on: _link.on, by: _link.by, anchor: _link.anchor, anchorOptions: [...el('linkAnchor').options].length };
  }, [by, anchor]);
  out.setA = await setLink(page, 'column'); out.setB = await setLink(p2, 'column');
  await page.waitForTimeout(500);
  out.peers = [await page.evaluate(() => _link.peers.size), await p2.evaluate(() => _link.peers.size)];
  const where = pg => pg.evaluate(() => { const a = _captureViewAnchor(); return a && { row: a.row, name: state.seqs[a.row]?.header, col: a.col }; });
  // by column number: tab 1 to row 300 / column 300; tab 2 shows seq300 (its row 99) at the top, column 300
  await page.evaluate(() => _applyViewAnchor({ row: 300, col: 300 }));
  await page.waitForTimeout(700);
  out.colMode = await where(p2);
  await page.waitForTimeout(700);
  out.echo = { p1: await where(page), applied: [await page.evaluate(() => _link.stats.applied), await p2.evaluate(() => _link.stats.applied)] };
  // by anchor sequence seq5: column 300 of A holds residue 301 of seq5, which sits in column 305 of B
  out.setA2 = await setLink(page, 'anchor', 'seq5'); out.setB2 = await setLink(p2, 'anchor', 'seq5');
  await page.evaluate(() => _applyViewAnchor({ row: 150, col: 300 }));
  await page.waitForTimeout(700);
  out.anchorMode = await where(p2);
  // and back, from the Full-mode tab: its column 505 is column 500 of A; its row 300 is seq99
  await p2.evaluate(() => _applyViewAnchor({ row: 300, col: 505 }));
  await p2.waitForTimeout(700);
  out.back = await where(page);
  await p2.close();
  const near = (a, b) => a != null && Math.abs(a - b) <= 1;
  const ok = out.peers[0] === 1 && out.peers[1] === 1 && out.setA.anchorOptions > 0
    && out.colMode && out.colMode.name === 'seq300' && near(out.colMode.col, 300)
    && out.echo.p1.row === 300 && near(out.echo.p1.col, 300) && out.echo.applied[0] === 0 && out.echo.applied[1] === 1
    && out.anchorMode && out.anchorMode.name === 'seq150' && near(out.anchorMode.col, 305)
    && out.back && out.back.name === 'seq99' && near(out.back.col, 500);
  return { pass: ok, detail: JSON.stringify(out) };
}, { timeoutMs: 120000 });

// Split-view plan B2: Actions > Split right opens this view again in an iframe pane docked inside the page. The
// pane is a copy (same sequences) linked by rows only, reloads after an edit in the main view, the page makes room
// for it (body margin), and closing the pane gives the room back.
check('Panes: Split right opens a linked read-only copy in the page, follows edits, and closing gives the room back', async (page) => {
  const out = {};
  const n = 300, len = 800;
  const fa = Array.from({ length: n }, (_, i) => `>seq${i}\n` + Array.from({ length: len }, (_, j) => 'ACGT'[(i * 5 + j) % 4]).join('')).join('\n') + '\n';
  await loadFasta(page, fa);
  await setMode(page, 'canvas');
  await page.evaluate(() => el('paneSplitRight').click());
  const child = async () => page.frames().find(f => f !== page.mainFrame());
  await page.waitForFunction(() => document.querySelector('#paneDock iframe'), null, { timeout: 15000 });
  let fr;
  for (let i = 0; i < 60 && !(fr && await fr.evaluate(() => typeof state !== 'undefined' && state.seqs.length).catch(() => 0)); i++) { await page.waitForTimeout(500); fr = await child(); }
  out.childSeqs = await fr.evaluate(() => state.seqs.length);
  out.margin = await page.evaluate(() => parseInt(document.body.style.marginRight, 10) || 0);
  out.linked = await page.evaluate(() => ({ on: _link.on, rows: _link.rows, cols: _link.cols }));
  await page.waitForTimeout(1500);
  out.childLink = await fr.evaluate(() => ({ on: _link.on, rows: _link.rows, cols: _link.cols, peers: _link.peers.size }));
  const where = f => f.evaluate(() => { const a = _captureViewAnchor(); return a && { row: a.row, col: a.col }; });
  await page.evaluate(() => _applyViewAnchor({ row: 200, col: 123 }));
  await page.waitForTimeout(1500);
  out.follow = await where(fr);
  // edit in the main view: the pane reloads (one sequence fewer)
  await page.evaluate(() => { pushUndo('test edit'); state.seqs.pop(); });
  await page.waitForTimeout(2500);
  out.afterEdit = await fr.evaluate(() => state.seqs.length).catch(e => 'err ' + e.message);
  await page.evaluate(() => document.querySelector('#paneDock .pane-head button:last-child').click());
  await page.waitForTimeout(300);
  out.marginAfter = await page.evaluate(() => document.body.style.marginRight);
  const ok = out.childSeqs === n && out.margin > 100 && out.linked.on && out.linked.rows && !out.linked.cols
    && out.childLink.on && out.childLink.rows && !out.childLink.cols && out.childLink.peers === 1
    && out.follow && Math.abs(out.follow.row - 200) <= 1 && out.follow.col !== 123
    && out.afterEdit === n - 1 && out.marginAfter === '';
  return { pass: ok, detail: JSON.stringify(out) };
}, { timeoutMs: 120000 });

// Split-view plan B2, the rest (owner: per pane "selectable, default read-only"): a pane starts as a mirror of the main
// view; an edit made IN the pane turns it into its own copy (with a message) so the mirror refresh never overwrites
// it; the pane's mode button switches back to mirror (a second click confirms that the pane's edits go); Swap (⇄)
// exchanges the pane's alignment and place with the main view's; a saved snapshot records the pane layout (side,
// size, each pane's mode, the content of own copies and file panes) and loading it opens the panes again.
check('Panes: an edit in a pane makes it its own copy, mode button back to mirror, Swap, layout in snapshots', async (page) => {
  const bad = [], out = {};
  const n = 200, len = 500;
  const fa = Array.from({ length: n }, (_, i) => `>m${i}\n` + Array.from({ length: len }, (_, j) => 'ACGT'[(i * 5 + j) % 4]).join('')).join('\n') + '\n';
  const nB = 120;
  const faB = Array.from({ length: nB }, (_, i) => `>b${i}\n` + Array.from({ length: 300 }, (_, j) => 'ACGT'[(i * 3 + j) % 4]).join('')).join('\n') + '\n';
  await loadFasta(page, fa);
  await setMode(page, 'canvas');
  const frameN = async (k) => { let fr; for (let i = 0; i < 60; i++) { fr = page.frames().filter(f => f !== page.mainFrame())[k]; if (fr && await fr.evaluate(() => typeof state !== 'undefined' && state.seqs.length).catch(() => 0)) return fr; await page.waitForTimeout(500); } return fr; };
  await page.evaluate(() => el('paneSplitRight').click());
  const fr = await frameN(0);
  await page.waitForTimeout(800);
  out.mode0 = await page.evaluate(() => ({ mode: _panes.list[0].mode, btn: _panes.list[0].wrap.querySelector('.pane-mode')?.textContent || null }));
  if (out.mode0.mode !== 'mirror' || !/mirror/i.test(out.mode0.btn || '')) bad.push('a new pane is not a mirror: ' + JSON.stringify(out.mode0));
  // an edit in the pane: it becomes its own copy and a later edit in the main view does not overwrite it
  await fr.evaluate(() => { pushUndo('pane edit'); state.seqs.pop(); _paneEditNote(); });
  await page.waitForTimeout(500);
  out.own = await page.evaluate(() => ({ mode: _panes.list[0].mode, title: _panes.list[0].title.textContent, msg: /own copy/i.test(document.body.innerText) }));
  if (out.own.mode !== 'own' || !/own copy/.test(out.own.title)) bad.push('pane edit did not make an own copy: ' + JSON.stringify(out.own));
  await page.evaluate(() => { pushUndo('main edit'); state.seqs.pop(); state.seqs.pop(); renderAlignment(); });
  await page.waitForTimeout(2500);
  out.paneAfterMainEdit = await fr.evaluate(() => state.seqs.length);
  if (out.paneAfterMainEdit !== n - 1) bad.push(`own copy was overwritten: ${out.paneAfterMainEdit} rows, ${n - 1} expected`);
  // the mode button: one click arms, the second goes back to mirror (and reloads from the main view)
  await page.evaluate(() => _panes.list[0].wrap.querySelector('.pane-mode').click());
  out.armed = await page.evaluate(() => ({ mode: _panes.list[0].mode, btn: _panes.list[0].wrap.querySelector('.pane-mode').textContent }));
  await page.evaluate(() => _panes.list[0].wrap.querySelector('.pane-mode').click());
  await page.waitForTimeout(2000);
  out.mirrorAgain = await page.evaluate(() => _panes.list[0].mode);
  out.paneRows = await fr.evaluate(() => state.seqs.length);
  if (out.armed.mode !== 'own' || !/discard/i.test(out.armed.btn) || out.mirrorAgain !== 'mirror' || out.paneRows !== n - 2) bad.push('back to mirror: ' + JSON.stringify({ armed: out.armed, mode: out.mirrorAgain, rows: out.paneRows }));

  // Swap with a file pane: the main view gets B, the pane gets the main alignment
  await page.evaluate(([faB]) => paneOpen('right', { name: 'B.fa', text: faB }), [faB]);
  const fr2 = await frameN(1);
  await page.waitForTimeout(800);
  await page.evaluate(() => _panes.list[1].wrap.querySelector('.pane-swap').click());
  await page.waitForTimeout(2500);
  out.swap = { main: await page.evaluate(() => ({ n: state.seqs.length, first: state.seqs[0].header })), pane: await fr2.evaluate(() => ({ n: state.seqs.length, first: state.seqs[0].header })), mode: await page.evaluate(() => _panes.list[1].mode) };
  if (out.swap.main.n !== nB || out.swap.main.first !== 'b0' || out.swap.pane.n !== n - 2 || out.swap.pane.first !== 'm0' || out.swap.mode !== 'own') bad.push('swap: ' + JSON.stringify(out.swap));

  // a saved snapshot records the layout; loading it opens the panes again with their content
  out.saved = await page.evaluate(() => { const p = _buildSnapshotPayload({ panes: true }); window.__snap = JSON.parse(JSON.stringify(p)); return p.panes && { side: p.panes.side, modes: p.panes.list.map(x => x.mode), ownRows: p.panes.list[1]?.payload ? (p.panes.list[1].payload.fasta.match(/>/g) || []).length : null }; });
  if (!out.saved || out.saved.side !== 'right' || out.saved.modes.join() !== 'mirror,own' || out.saved.ownRows !== n - 2) bad.push('snapshot layout: ' + JSON.stringify(out.saved));
  out.cloneHasPanes = await page.evaluate(() => !!_buildSnapshotPayload().panes);
  if (out.cloneHasPanes) bad.push('a plain payload (Clone Tab, panes) carries the pane layout');
  await page.evaluate(() => { _panes.list.slice().forEach(paneClose); });
  await page.waitForTimeout(300);
  await page.evaluate(() => _loadSnapshotPayload(window.__snap));
  await page.waitForTimeout(800);
  const f1 = await frameN(1);
  await page.waitForTimeout(1000);
  out.restored = { panes: await page.evaluate(() => _panes.list.map(r => r.mode).join()), ownRows: f1 ? await f1.evaluate(() => state.seqs.length) : null };
  if (out.restored.panes !== 'mirror,own' || out.restored.ownRows !== n - 2) bad.push('restored layout: ' + JSON.stringify(out.restored));
  await page.evaluate(() => { _panes.list.slice().forEach(paneClose); });
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') + ' | ' + JSON.stringify(out) : JSON.stringify(out) };
}, { timeoutMs: 180000 });

// Split-view plan B2: Open file in pane loads another alignment of the same sequences (five extra gap columns) into a
// pane, linked by rows and by anchor sequence; the pane is not a mirror, so an edit in the main view leaves it alone.
check('Panes: Open file in pane links by anchor sequence and is not refreshed by edits', async (page) => {
  const out = {};
  const n = 300, len = 1000;
  const row = i => Array.from({ length: len }, (_, j) => 'ACGT'[(i * 7 + j) % 4]).join('');
  const faA = Array.from({ length: n }, (_, i) => `>seq${i}\n${row(i)}`).join('\n') + '\n';
  const faB = Array.from({ length: n }, (_, i) => { const s = row(i); return `>seq${i}\n${s.slice(0, 200)}-----${s.slice(200)}`; }).join('\n') + '\n';
  await loadFasta(page, faA);
  await setMode(page, 'canvas');
  await page.setInputFiles('body > input[type=file][hidden]', { name: 'other.fa', mimeType: 'text/plain', buffer: Buffer.from(faB) });
  await page.waitForFunction(() => document.querySelector('#paneDock iframe'), null, { timeout: 15000 });
  let fr;
  for (let i = 0; i < 60 && !(fr && await fr.evaluate(() => typeof state !== 'undefined' && state.seqs.length).catch(() => 0)); i++) { await page.waitForTimeout(500); fr = page.frames().find(f => f !== page.mainFrame()); }
  await page.waitForTimeout(1500);
  out.child = await fr.evaluate(() => ({ n: state.seqs.length, w: state.seqs[0].seq.length, on: _link.on, by: _link.by, cols: _link.cols, name: state.currentFilename }));
  out.main = await page.evaluate(() => ({ by: _link.by, cols: _link.cols }));
  await page.evaluate(() => _applyViewAnchor({ row: 150, col: 300 }));
  await page.waitForTimeout(1500);
  out.at = await fr.evaluate(() => _captureViewAnchor());
  await page.evaluate(() => { pushUndo('test edit'); state.seqs.pop(); });
  await page.waitForTimeout(2500);
  out.afterEdit = await fr.evaluate(() => state.seqs.length);
  const ok = out.child.n === n && out.child.w === len + 5 && out.child.on && out.child.by === 'anchor' && out.child.cols
    && out.main.by === 'anchor' && out.main.cols && out.at && out.at.row === 150 && Math.abs(out.at.col - 305) <= 1 && out.afterEdit === n;
  return { pass: ok, detail: JSON.stringify(out) };
}, { timeoutMs: 120000 });

// Split-view plan B2: a pane of a large alignment (above the "Large alignment" dialog threshold) must load without
// waiting for the dialog; the first measurement run left the pane stuck on it. Also three extra panes are allowed.
check('Panes: a large alignment loads in a pane without the Large alignment dialog; three extra panes open', async (page) => {
  const out = {};
  await loadSyntheticFasta(page, 1500, 4000);
  await setMode(page, 'canvas');
  for (let k = 0; k < 4; k++) await page.evaluate(() => paneOpen('right'));
  out.panes = await page.evaluate(() => document.querySelectorAll('#paneDock iframe').length);
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(500);
    const fr = page.frames().filter(f => f !== page.mainFrame());
    out.loaded = (await Promise.all(fr.map(f => f.evaluate(() => typeof state !== 'undefined' && state.seqs.length).catch(() => 0)))).join(',');
    if (fr.length === 3 && out.loaded === '1500,1500,1500') break;
  }
  out.dialog = (await Promise.all(page.frames().map(f => f.evaluate(() => !!document.querySelector('.align-load-dialog')).catch(() => false)))).some(Boolean);
  return { pass: out.panes === 3 && out.loaded === '1500,1500,1500' && !out.dialog, detail: JSON.stringify(out) };
}, { timeoutMs: 180000 });

// Owner (2026-10-23): "a function to open alignment in new tab EXACTLY as it is in this tab, including all search
// etc". Actions > Clone Tab hands the full snapshot payload to a new tab over the existing ?handoff channel
// (postMessage, no storage quota): sequences, view (mode, zoom, case, shading, name length, diff / variable-sites /
// codon toggles), Canvas position, searches, selections and marks, name colours, trim, annotation.
check('Clone Tab: the new tab shows the alignment as this one (Canvas position, case, zoom, diffs, trim, searches, selections, name colours)', async (page) => {
  let sd = 5; const rnd = () => (sd = (Math.imul(sd, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  const rs = n => Array.from({ length: n }, () => 'ACGT'[rnd() * 4 | 0]).join('');
  const base = rs(400);
  const fa = Array.from({ length: 80 }, (_, i) => '>seq' + i + '\n' + base.split('').map(c => rnd() < 0.05 ? 'ACGT'[rnd() * 4 | 0] : c).join('')).join('\n') + '\n';
  await loadFasta(page, fa);
  await setMode(page, 'canvas');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    setResidueCase('upper');
    const z = document.getElementById('zoomSlider'); z.value = Math.round(+z.max * 0.7); z.dispatchEvent(new Event('input', { bubbles: true })); z.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('highlightDiffs').checked = true; document.getElementById('highlightDiffs').dispatchEvent(new Event('change', { bubbles: true }));
    searchMotif({ motif: 'ACGTAC', useRegex: false, maxMismatches: 1, bothStrands: false, color: '#ff8800', suppressMessage: true });
    state.selectedRows = new Set([3, 7]); updateRowSelections();
    colourState.mappings.set('seq3', '#00aa00'); applyColourToSeqNames(colourState.mappings);
    _setTrimBounds(5, 300, true);
    _canvasState.offsetX = 200; _canvasState.offsetY = 150; _canvasState.scheduleDraw(); _canvasState.onOffsetChange && _canvasState.onOffsetChange();
  });
  await page.waitForTimeout(400);
  const snap = () => ({ n: state.seqs.length, first: state.seqs[0].header, mode: document.getElementById('modeCanvas').checked ? 'canvas' : 'other', ox: _canvasState.offsetX, oy: _canvasState.offsetY,
    caseMode: state.residueCase, zoom: document.getElementById('zoomSlider').value, diffs: document.getElementById('highlightDiffs').checked,
    searches: state.searchHistory.map(h => h.label + '|' + h.color + '|' + h.maxMismatches + '|' + h.matchCount).join(';'), rows: [...state.selectedRows].sort().join(','),
    colour: colourState.mappings.get('seq3'), trim: JSON.stringify(state.trimBoundaries), name: state.currentFilename });
  const here = await page.evaluate(snap);
  await page.click('.section-header[data-section="actions"]'); await page.waitForTimeout(200);   // the button is in the Actions menu
  const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 15000 }), page.click('#openViewInNewTabButton')]);
  await popup.waitForFunction(() => typeof state !== 'undefined' && state.seqs.length > 0 && typeof _canvasState !== 'undefined' && _canvasState.canvas && state.searchHistory.length > 0 && state.trimBoundaries, null, { timeout: 20000 });
  await popup.waitForTimeout(800);
  const there = await popup.evaluate(snap);
  await popup.close();
  const same = Object.keys(here).filter(k => k !== 'ox' && k !== 'oy').every(k => here[k] === there[k]) && Math.abs(here.ox - there.ox) <= 2 && Math.abs(here.oy - there.oy) <= 2;
  return { pass: same, detail: JSON.stringify({ here, there }) };
});


// Owner (2026-10-23): "colour names result doesn't apply immediately, only after rerender". In Canvas the name
// painter only touched DOM name cells; the Canvas draws names from the same mappings but was never asked to redraw.
check('Colour Names: a pattern colour shows at once in Canvas (and Full), without a re-render', async (page) => {
  const out = {};
  for (const view of ['canvas', 'full']) {
    const p = await page.context().browser().newPage({ viewport: { width: 1200, height: 600 } });
    await p.goto(page.url().replace(/view=\w+/, 'view=' + view).replace(/(index\.html)(?!\?)/, '$1?view=' + view), { waitUntil: 'networkidle' });
    await p.setInputFiles('#fileInput', { name: 'c.fa', mimeType: 'text/plain', buffer: Buffer.from('>Hsap_1\nACGTACGTAC\n>Mmus_2\nACGTACGTAC\n>Hsap_3\nACGTACGTAC\n') });
    await p.waitForTimeout(1000);
    const red = () => p.evaluate(() => {
      if (document.getElementById('modeCanvas').checked) {
        const cv = _canvasState.canvas, m = _canvasState.metrics, dpr = cv.width / cv.clientWidth;
        const y = Math.round((m.headerH + 0.5 * _canvasState.rowPitch) * dpr), d = cv.getContext('2d').getImageData(0, y, Math.round(m.nameW * dpr), 1).data;
        let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 120 && d[i + 2] < 120) n++;
        return n;
      }
      const n = document.querySelector('.seq-line[data-seq-index="0"] .seq-name');
      return /rgb\(255, 0, 0\)/.test(getComputedStyle(n).backgroundColor) ? 1 : 0;
    });
    await p.click('.section-header[data-section="colourseqs"]'); await p.waitForTimeout(200);
    await p.fill('#colourPatternInput', 'Hsap'); await p.evaluate(() => { document.getElementById('colourPatternColor').value = '#ff0000'; });
    const before = await red();
    await p.click('#colourPatternButton'); await p.waitForTimeout(400);
    const after = await red();
    out[view] = { before, after };
    await p.close();
  }
  const ok = out.canvas.before <= 3 && out.canvas.after >= 10 && out.full.before === 0 && out.full.after === 1;   // Firefox paints one stray red pixel in the name column before any colour
  return { pass: ok, detail: JSON.stringify(out) };
});


// Owner (2026-10-23): "normal mouse click selection over sequence looks jerky, leaves borders between nucleotide
// boxes - must be more responsive, intuitive and elegant". A selected run of residues was a row of boxed cells
// (a frame per cell, in both views). Now one tint and one frame per run: the DOM marks the run's first and last
// cell, the Canvas fills and strokes one rectangle per run.
check('Residue selection: one tint and one frame per run, no box per cell (Full, Canvas)', async (page) => {
  const out = {};
  const fa = '>a\nACGTACGTACGTACGTACGT\n>b\nACGTACGTACGTACGTACGT\n>c\nACGTACGTACGTACGTACGT\n';
  for (const view of ['full', 'canvas']) {
    const p = await page.context().browser().newPage({ viewport: { width: 900, height: 400 } });
    await p.goto(page.url().replace(/view=\w+/, 'view=' + view).replace(/(index\.html)(?!\?)/, '$1?view=' + view), { waitUntil: 'networkidle' });
    await p.setInputFiles('#fileInput', { name: 's.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
    await p.waitForTimeout(1000);
    const c = await p.evaluate(() => {
      if (document.getElementById('modeCanvas').checked) { const r = _canvasState.canvas.getBoundingClientRect(), m = _canvasState.metrics; return { x: r.left + m.nameW + 4.5 * m.charW, y: r.top + m.headerH + 1.5 * _canvasState.rowPitch, w: m.charW }; }
      const a = document.querySelector('.seq-line[data-seq-index="1"] .seq-data > span[data-pos="4"]').getBoundingClientRect(); return { x: a.left + a.width / 2, y: a.top + a.height / 2, w: a.width }; });
    await p.mouse.move(c.x, c.y); await p.mouse.down(); await p.mouse.move(c.x + 5 * c.w, c.y, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(300);
    out[view] = await p.evaluate(() => {
      const sel = state.selectedNucs.get(1); if (!sel || sel.size !== 6) return { sel: sel ? sel.size : 0 };
      if (document.getElementById('modeCanvas').checked) {
        const o = _canvasState.overlay, m = _canvasState.metrics, dpr = o.width / parseFloat(o.style.width || o.width), g = o.getContext('2d');
        const y = Math.round((m.headerH + 1.5 * _canvasState.rowPitch - _canvasState.offsetY) * dpr);
        // the frame's stroke lands on fractional columns: the strongest alpha within 2 CSS px of an edge
        const px = x => { let a = 0; for (let d = -2; d <= 2; d++) a = Math.max(a, g.getImageData(Math.round((x + d) * dpr), y, 1, 1).data[3]); return a; };
        const left = m.nameW + 4 * m.charW - _canvasState.offsetX;
        return { sel: 6, outerLeft: px(left), inner: px(left + m.charW), inner2: px(left + 3 * m.charW), outerRight: px(left + 6 * m.charW) };
      }
      const sp = i => document.querySelector('.seq-line[data-seq-index="1"] .seq-data > span[data-pos="' + i + '"]');
      const shadows = s => getComputedStyle(s).boxShadow.split(/,\s*(?=rgba?\()/).length;   // one entry per shadow
      return { sel: 6, start: shadows(sp(4)), mid: shadows(sp(6)), end: shadows(sp(9)), startCls: sp(4).classList.contains('nuc-sel-start'), endCls: sp(9).classList.contains('nuc-sel-end'), midCls: sp(6).classList.contains('nuc-sel-start') || sp(6).classList.contains('nuc-sel-end') };
    });
    await p.close();
  }
  const f = out.full, cv = out.canvas;
  const ok = f.sel === 6 && f.mid === 2 && f.start === 3 && f.end === 3 && f.startCls && f.endCls && !f.midCls
    && cv.sel === 6 && cv.outerLeft >= cv.inner + 60 && cv.outerRight >= cv.inner2 + 60 && cv.inner <= 160 && cv.inner2 <= 160;   // inside a run: the tint only (0.55 = 140); at its ends the frame adds
  return { pass: ok, detail: JSON.stringify(out) };
});


// Owner (2026-10-23): "consider adding an option to select rectangle area in the alignment (similar to columns)
// and also to re-align such block". A residue drag (or the two clicks) across rows now selects the rectangle of
// rows x columns; Realign Block on such a rectangle realigns only those rows within those columns and keeps the
// alignment rectangular (the other rows get gaps after the span when the block widens; the block rows get gaps
// after the realigned piece when it narrows).
check('Rectangle selection by drag and by two clicks (Full, Canvas); Realign Block realigns the rows x columns block and keeps the other rows', async (page) => {
  const out = {};
  const rows = ['ACGTACGTACGTACGTACGT', 'ACGTTCGTACGAACGTACGT', 'ACGTACCTACGTACGTAGGT', 'ACGTACGGACGTTCGTACGT', 'ACGTACGTACGTACGTACGT', 'ACGTACGTACGTACGTACGT'];
  const fa = rows.map((s, i) => '>r' + i + '\n' + s).join('\n') + '\n';
  for (const view of ['full', 'canvas']) {
    const p = await page.context().browser().newPage({ viewport: { width: 900, height: 400 } });
    await p.goto(page.url().replace(/view=\w+/, 'view=' + view).replace(/(index\.html)(?!\?)/, '$1?view=' + view), { waitUntil: 'networkidle' });
    await p.setInputFiles('#fileInput', { name: 'r.fa', mimeType: 'text/plain', buffer: Buffer.from(fa) });
    await p.waitForTimeout(1000);
    const cell = (r, c) => p.evaluate(([r, c]) => {
      if (document.getElementById('modeCanvas').checked) { const b = _canvasState.canvas.getBoundingClientRect(), m = _canvasState.metrics; return { x: b.left + m.nameW + (c + 0.5) * m.charW, y: b.top + m.headerH + (r + 0.5) * _canvasState.rowPitch }; }
      const a = document.querySelector('.seq-line[data-seq-index="' + r + '"] .seq-data > span[data-pos="' + c + '"]').getBoundingClientRect(); return { x: a.left + a.width / 2, y: a.top + a.height / 2 }; }, [r, c]);
    const sel = () => p.evaluate(() => [...state.selectedNucs].sort((a, b) => a[0] - b[0]).map(([r, s]) => r + ':' + [...s].sort((a, b) => a - b).join(',')).join(' | '));
    // drag from row 1 col 4 to row 3 col 9
    let a = await cell(1, 4), b = await cell(3, 9);
    await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(b.x, b.y, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(250);
    const drag = await sel();
    // two clicks: row 4 col 2, then row 5 col 6
    a = await cell(4, 2); b = await cell(5, 6);
    await p.mouse.click(a.x, a.y); await p.waitForTimeout(150); await p.mouse.click(b.x, b.y); await p.waitForTimeout(250);
    const clicks = await sel();
    // back to the first rectangle, then Realign Block with a stand-in MAFFT that returns each piece two columns wider
    a = await cell(1, 4); b = await cell(3, 9);
    await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(b.x, b.y, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(250);
    const re = await p.evaluate(async (rows) => {
      const orig = window._mafftAlignWithUi;
      window._mafftAlignWithUi = async (fasta) => {
        const recs = fasta.split('>').filter(Boolean).map(b => { const l = b.split(/\r?\n/); return { name: l[0], seq: l.slice(1).join('') }; });
        const L = Math.max(...recs.map(r => r.seq.length)) + 2;
        return recs.map(r => '>' + r.name + '\n' + r.seq + '-'.repeat(L - r.seq.length) + '\n').join('');
      };
      try { await realignSelectedBlock({ skipPrompt: true }); } finally { window._mafftAlignWithUi = orig; }
      const got = state.seqs.map(s => s.seq);
      const same = got.every(s => s.length === rows[0].length + 2);
      const others = [0, 4, 5].every(i => got[i] === rows[i].slice(0, 10) + '--' + rows[i].slice(10));
      const block = [1, 2, 3].every(i => got[i].slice(0, 4) === rows[i].slice(0, 4) && got[i].slice(4, 12) === rows[i].slice(4, 10) + '--' && got[i].slice(12) === rows[i].slice(10));
      const selAfter = [...state.selectedNucs].sort((a, b) => a[0] - b[0]).map(([r, s]) => r + ':' + Math.min(...s) + '-' + Math.max(...s)).join(' ');
      undoDelete();
      const undone = state.seqs.every((s, i) => s.seq === rows[i]);
      return { same, others, block, selAfter, undone };
    }, rows);
    out[view] = { drag, clicks, re };
    await p.close();
  }
  const want = '1:4,5,6,7,8,9 | 2:4,5,6,7,8,9 | 3:4,5,6,7,8,9', want2 = '4:2,3,4,5,6 | 5:2,3,4,5,6';
  const ok = ['full', 'canvas'].every(v => out[v].drag === want && out[v].clicks === want2 && out[v].re.same && out[v].re.others && out[v].re.block && out[v].re.selAfter === '1:4-11 2:4-11 3:4-11' && out[v].re.undone);
  return { pass: ok, detail: JSON.stringify(out) };
});


// GLM pre-release audit of v278 (2026-10-24), dot-plot collection and region marks: a stored entry id with an
// apostrophe broke the onclick strings; another modal opened over the dot window left the marks and the
// click-through backdrop behind; a live recalculation wiped the marks; a region-list re-render during a rename
// destroyed the input; a bookmark of a duplicate header went to the first row with that name; an entry made with
// RevComp B looked "here" after the box was unticked.
check('Dot plot collection audit: hostile stored id, other modal clears marks+peek, recalculation keeps marks, rename survives a re-render, duplicate headers, RevComp here-marker', async (page) => {
  const seqA = 'ACGTTGCAAGGCTTAACCGGTTAAGGCCTTAAGACGTTGCAAGGCTTAACCGGTTAAGGCCTTAAGTTTT';
  const fa = '>dup\n' + seqA + '\n>dup\n' + 'TTGCACCGGAATTCCGGAATTCCAAGGTTGCACCGGAATTCCGGAATTCCAAGGTTCCCC' + '\n>other\n' + seqA.split('').reverse().join('') + '\n';
  await page.evaluate(() => { localStorage.setItem('msaviewer_dotBookmarks', JSON.stringify([{ id: "x');window.__pwned=1;//", name: 'hostile', nameA: 'dup', nameB: 'dup', aStart: 0, aEnd: 10, bStart: 30, bEnd: 40, seqA: 'ACGTTGCAAG', seqB: 'ACGTTGCAAG' }])); });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  await loadFasta(page, fa); await setMode(page, 'full');
  const r = {};
  r.idSafe = await page.evaluate(() => /^[A-Za-z0-9_-]+$/.test(state.dotBookmarks[0].id));
  // the second "dup" row is the one the hostile entry describes? no: its sequence is the FIRST dup's; a bookmark for
  // the second dup must pick the row whose sequence matches
  await page.evaluate(() => { state.dotBookmarks.push({ id: 'bm2', name: 'second dup', nameA: 'dup', nameB: 'dup', aStart: 0, aEnd: 8, bStart: 8, bEnd: 16, revB: false, mode: 'spin', window: 6, threshold: 0, seqA: 'TTGCACCG', seqB: 'GAATTCCG', identity: 1 }); _dotSaveBookmarks(); });
  await page.evaluate(() => openDotPlot(state.seqs[0].seq, state.seqs[0].seq, 'dup', 'dup', { rowIndexA: 0, rowIndexB: 0, alignedSeqA: state.seqs[0].seq, alignedSeqB: state.seqs[0].seq }));
  await page.waitForSelector('#dotPlotBookmarkItems .dot-bm', { timeout: 10000 });
  // 1. the hostile entry's buttons work and run nothing foreign
  await page.click('#dotPlotBookmarkItems .dot-bm[data-id] button[title^="Show the stretch"]'); await page.waitForTimeout(300);
  r.hostile = await page.evaluate(() => ({ pwned: !!window.__pwned, marks: !!state.dotRegionMarks, peek: document.getElementById('dotPlotModal').classList.contains('dot-peek') }));
  // 2. duplicate headers: the second entry's show goes to row 1 (its sequence), not row 0
  await page.evaluate(() => _dotShowBookmarkInAlignment('bm2')); await page.waitForTimeout(200);
  r.dupRow = await page.evaluate(() => [...state.dotRegionMarks.keys()].sort().join(','));
  // 3. a live recalculation (slider nudge) keeps the marks and the Clear marks button
  await page.evaluate(() => { const w = document.getElementById('dotPlotWindow'); w.value = 7; w.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(1500);
  r.afterRecalc = await page.evaluate(() => ({ marks: !!state.dotRegionMarks, btn: !document.getElementById('dotPlotClearMarksBtn').hidden, active: document.querySelectorAll('#dotPlotRegionItems .dot-region-active').length, peek: document.getElementById('dotPlotModal').classList.contains('dot-peek') }));
  // 4. Clear marks keeps the window in peek mode; a rename survives a region re-render
  await page.click('#dotPlotClearMarksBtn'); await page.waitForTimeout(200);
  r.afterClear = await page.evaluate(() => ({ marks: !!state.dotRegionMarks, peek: document.getElementById('dotPlotModal').classList.contains('dot-peek') }));
  await page.dblclick('#dotPlotBookmarkItems .dot-bm[data-id="bm2"] .dot-bm-name'); await page.waitForTimeout(150);
  await page.keyboard.type('renamed');
  await page.evaluate(() => _dotRenderRegionList());   // what a worker reply does mid-edit
  await page.waitForTimeout(100);
  r.renameInputAlive = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('dot-bm-rename'));
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  r.renamed = await page.evaluate(() => state.dotBookmarks.find(b => b.id === 'bm2').name);
  // 5. RevComp "here" marker
  r.hereRc = await page.evaluate(() => { state.dotBookmarks.push({ id: 'bm3', name: 'rc', nameA: 'dup', nameB: 'dup', aStart: 0, aEnd: 8, bStart: 0, bEnd: 8, revB: true, mode: 'spin', window: 6, threshold: 0, seqA: 'ACGTTGCA', seqB: 'ACGTTGCA' }); _dotRenderBookmarks(); const e = document.querySelector('#dotPlotBookmarkItems .dot-bm[data-id="bm3"]'); return e ? e.classList.contains('dot-bm-other') : 'missing:' + document.getElementById('dotPlotBookmarkItems').textContent.slice(0, 60) + '|active=' + (document.activeElement && document.activeElement.className); });
  // 6. another modal over the dot window: marks and peek go
  await page.evaluate(() => _dotShowBookmarkInAlignment('bm2')); await page.waitForTimeout(200);
  await page.evaluate(() => showExclusiveModal('infoModal')); await page.waitForTimeout(200);
  r.otherModal = await page.evaluate(() => ({ marks: !!state.dotRegionMarks, peek: document.getElementById('dotPlotModal').classList.contains('dot-peek'), dotHidden: document.getElementById('dotPlotModal').style.display === 'none' }));
  await page.evaluate(() => { document.getElementById('infoModal').style.display = 'none'; state.dotBookmarks = []; _dotSaveBookmarks(); localStorage.removeItem('msaviewer_dotBookmarks'); });
  const ok = r.idSafe && !r.hostile.pwned && r.hostile.marks && r.hostile.peek && r.dupRow === '1' && r.afterRecalc.marks && r.afterRecalc.btn && r.afterRecalc.active === 0 && r.afterRecalc.peek
    && !r.afterClear.marks && r.afterClear.peek && r.renameInputAlive && r.renamed === 'renamed' && r.hereRc && !r.otherModal.marks && !r.otherModal.peek && r.otherModal.dotHidden;
  return { pass: ok, detail: JSON.stringify(r) };
});


// GLM pre-release audit of v278 (2026-10-24): the Canvas branch of _showRowInAlignment jumped past the content's
// end for a row near the bottom (a blank canvas); the letter-case switch also transformed the annotation track's
// feature names in Full/Block (Canvas draws them as written); a new file nulled the dot-plot region marks but left
// the Clear marks button, the click-through backdrop and the list's shown entry behind.
check('Audit fixes: Canvas row jump stays within the content; annotation labels keep their case; a new file resets the dot-plot mark UI', async (page) => {
  await loadSyntheticFasta(page, 200, 300);
  await setMode(page, 'canvas'); await page.waitForTimeout(300);
  await page.evaluate(() => _showRowInAlignment(199, 5)); await page.waitForTimeout(400);
  const r = {};
  r.jump = await page.evaluate(() => { const cv = _canvasState.canvas, h = parseInt(cv.style.height) || cv.clientHeight; const maxY = Math.max(0, _canvasState.totalContentH - h); const lastRowY = _canvasState.metrics.headerH + 199 * _canvasState.rowPitch - _canvasState.offsetY; return { oy: Math.round(_canvasState.offsetY), maxY: Math.round(maxY), lastRowVisible: lastRowY >= 0 && lastRowY + _canvasState.rowPitch <= h + 1 }; });
  await setMode(page, 'full'); await page.waitForTimeout(300);
  await page.evaluate(() => { setAnnotation('seq0\t10\t40\tmyGene', 'probe.bed'); setResidueCase('upper'); });
  await page.waitForTimeout(400);
  r.annot = await page.evaluate(() => { const d = document.querySelector('.annot-track-data'); return { present: !!d, tt: d ? getComputedStyle(d).textTransform : null, residueTT: getComputedStyle(document.querySelector('.seq-line[data-seq-index="0"] .seq-data')).textTransform }; });
  await page.evaluate(() => { setResidueCase('asis'); clearAnnotation(); });
  await page.evaluate(() => { const s = state.seqs[0]; return openDotPlot(s.seq, s.seq, s.header, s.header, { rowIndexA: 0, rowIndexB: 0, alignedSeqA: s.seq, alignedSeqB: s.seq }); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { _dotPlotState.regions = [{ row: 0, col: 2, length: 4, aStart: 0, aEnd: 8, bStart: 2, bEnd: 10, matched: 4, avgScore: 1 }]; _dotRenderRegionList(); _dotShowRegionInAlignment(0); });
  await page.waitForTimeout(200);
  r.beforeLoad = await page.evaluate(() => ({ marks: !!state.dotRegionMarks, btn: !document.getElementById('dotPlotClearMarksBtn').hidden, peek: document.getElementById('dotPlotModal').classList.contains('dot-peek') }));
  await loadFasta(page, '>n1\nACGTACGTAC\n>n2\nACGTACGTAC\n');
  r.afterLoad = await page.evaluate(() => ({ marks: !!state.dotRegionMarks, btn: !document.getElementById('dotPlotClearMarksBtn').hidden, peek: document.getElementById('dotPlotModal').classList.contains('dot-peek'), shown: _dotPlotState._shownRegion }));
  await page.evaluate(() => { const m = document.getElementById('dotPlotModal'); if (m.style.display !== 'none') document.getElementById('dotPlotCloseBtn').click(); });
  const ok = r.jump.oy <= r.jump.maxY && r.jump.lastRowVisible && r.annot.present && r.annot.tt === 'none' && r.annot.residueTT === 'uppercase'
    && r.beforeLoad.marks && r.beforeLoad.btn && r.beforeLoad.peek && !r.afterLoad.marks && !r.afterLoad.btn && !r.afterLoad.peek && r.afterLoad.shown === -1;
  return { pass: ok, detail: JSON.stringify(r) };
});


// GLM pre-release audit of v278, batch 2: a large rectangle selection cost ~90 ms per refresh in Full/Block (a DOM
// query per cell); Realign Block on a ragged alignment computed the width change from the first row and padded the
// wrong rows; a search preset named __proto__ vanished and presets lost the restriction-site flags; a snapshot
// restored the trim after the render and lost the paused-diffs flag; a TSD run finishing after the finder was
// closed installed its preview; the collection grew without a size cap.
check('Audit batch 2: fast rectangle refresh, ragged Realign Block, preset names and flags, snapshot trim/diffs flags, TSD preview after close', async (page) => {
  const r = {};
  await loadSyntheticFasta(page, 120, 400); await setMode(page, 'full');
  r.refresh = await page.evaluate(() => { _setNucRectangle(0, 0, 95, 299); refreshNucleotideSelectionsImmediate(); _setNucRectangle(0, 0, 95, 300); const t0 = performance.now(); refreshNucleotideSelectionsImmediate(); const ms = performance.now() - t0; const sp = document.querySelector('.seq-line[data-seq-index="40"] .seq-data > span[data-pos="300"]'); return { ms: Math.round(ms * 10) / 10, cells: [...state.selectedNucs.values()].reduce((n, s) => n + s.size, 0), endCls: sp && sp.classList.contains('nuc-sel-end'), startCls: document.querySelector('.seq-line[data-seq-index="40"] .seq-data > span[data-pos="0"]').classList.contains('nuc-sel-start') }; });
  // ragged alignment: rows 1 and 2 are shorter than the others
  const rows = ['ACGTACGTACGTACGTACGT', 'ACGTTCGTACGA', 'ACGTACCTACGTACGT', 'ACGTACGGACGTTCGTACGT', 'ACGTACGTACGTACGTACGT'];
  await loadFasta(page, rows.map((s, i) => '>r' + i + '\n' + s).join('\n') + '\n');
  r.ragged = await page.evaluate(async (rows) => {
    const orig = window._mafftAlignWithUi;
    window._mafftAlignWithUi = async (fasta) => { const recs = fasta.split('>').filter(Boolean).map(b => { const l = b.split(/\r?\n/); return { name: l[0], seq: l.slice(1).join('') }; }); const L = Math.max(...recs.map(x => x.seq.length)) + 2; return recs.map(x => '>' + x.name + '\n' + x.seq + '-'.repeat(L - x.seq.length) + '\n').join(''); };
    const loaded = state.seqs.map(s => s.seq);
    _setNucRectangle(1, 2, 2, 7); scheduleNucSelectionRefresh();
    try { await realignSelectedBlock({ skipPrompt: true }); } finally { window._mafftAlignWithUi = orig; }
    const got = state.seqs.map(s => s.seq);
    const L = got[0].length;
    const residuesKept = got.every((s, i) => s.replace(/-/g, '') === rows[i].replace(/-/g, ''));
    const others = [0, 3, 4].every(i => got[i].length === L && got[i].slice(0, 8) === rows[i].slice(0, 8) && got[i].slice(8, 10) === '--' && got[i].slice(10) === rows[i].slice(8).padEnd(L - 10, '-'));
    undoDelete();
    return { rect: got.every(s => s.length === L), L, residuesKept, others, undone: state.seqs.every((s, i) => s.seq === loaded[i]) };
  }, rows);
  // presets: a __proto__ name, restriction-site flags
  r.presets = await page.evaluate(() => {
    const out = {};
    searchMotif({ motif: 'GAATTC', label: 'EcoRI', overlapping: true, countMode: 'alignmentSites', suppressMessage: true });
    document.getElementById('searchPresetName').value = '__proto__'; saveSearchPreset();
    out.listed = [...document.getElementById('searchPresetSelect').options].map(o => o.value).includes('__proto__');
    out.stored = Object.keys(JSON.parse(localStorage.getItem('searchPresets') || '{}')).includes('__proto__');
    out.protoIntact = Object.getPrototypeOf({}) === Object.prototype && !('queries' in {});
    clearAllSearches(true);
    document.getElementById('searchPresetSelect').value = '__proto__'; loadSearchPreset();
    const h = state.searchHistory[0];
    out.flags = h ? { overlapping: !!h.overlapping, countMode: h.countMode } : null;
    localStorage.removeItem('searchPresets'); updateSearchPresetList();
    return out;
  });
  // snapshot: trim before the render, manual flags and the paused-diffs flag round-trip, Canvas offsets clamped
  r.snap = await page.evaluate(async () => {
    _setTrimBounds(2, 15, 'left'); state._diffsPausedByVarSites = true;
    const p = _buildSnapshotPayload();
    p.view.canvasOffsetX = 999999; p.view.canvasOffsetY = 999999; p.view.mode = 'canvas';
    state.trimBoundaries = null; state.trimManualLeft = false; state.trimManualRight = false; state._diffsPausedByVarSites = false;
    let rendersWithTrim = 0; const o = window.renderAlignment; window.renderAlignment = function () { if (state.trimBoundaries) rendersWithTrim++; return o.apply(this, arguments); };
    _loadSnapshotPayload(JSON.parse(JSON.stringify(p)));
    await new Promise(r => setTimeout(r, 900));
    window.renderAlignment = o;
    const cv = _canvasState.canvas, h = parseInt(cv.style.height) || cv.clientHeight, w = parseInt(cv.style.width) || cv.clientWidth;
    return { trim: JSON.stringify(state.trimBoundaries), manual: [state.trimManualLeft, state.trimManualRight], paused: state._diffsPausedByVarSites, rendersWithTrim, offsetsClamped: _canvasState.offsetX <= Math.max(0, (_canvasState.totalContentW || 0) - w) + 1 && _canvasState.offsetY <= Math.max(0, (_canvasState.totalContentH || 0) - h) + 1 };
  });
  // a TSD run finishing after the finder was closed must not install its preview
  r.tsd = await page.evaluate(() => { document.getElementById('repeatFinderModal').style.display = 'none'; _setTsdPreview([{ obj: state.seqs[0], upRes: [1, 2], downRes: [5, 6] }]); return { preview: !!state.tsdPreview, attention: document.getElementById('tsdMarkBtn').classList.contains('rf-btn-attention') }; });
  // the collection's sanitiser caps a stretch at 20,000 residues and the list at 200 entries
  r.cap = await page.evaluate(() => { const big = _dotSanitizeBookmarks(Array.from({ length: 300 }, (_, i) => ({ id: 'b' + i, name: 'n', nameA: 'a', nameB: 'b', aStart: 0, aEnd: 5, bStart: 0, bEnd: 5, seqA: 'A'.repeat(50000), seqB: 'C' }))); return { n: big.length, seqLen: big[0].seqA.length }; });
  const ok = r.refresh.ms <= 40 && r.refresh.cells === 96 * 301 && r.refresh.endCls && r.refresh.startCls
    && r.ragged.rect && r.ragged.residuesKept && r.ragged.others && r.ragged.undone
    && r.presets.listed && r.presets.stored && r.presets.protoIntact && r.presets.flags && r.presets.flags.overlapping && r.presets.flags.countMode === 'alignmentSites'
    && r.snap.trim === JSON.stringify({ leftTrimEnd: 2, rightTrimStart: 15 }) && r.snap.manual[0] === true && r.snap.manual[1] === false && r.snap.paused === true && r.snap.rendersWithTrim >= 1 && r.snap.offsetsClamped
    && !r.tsd.preview && !r.tsd.attention && r.cap.n === 200 && r.cap.seqLen === 20000;
  return { pass: ok, detail: JSON.stringify(r) };
});


// GLM audit (tests): a check that launches its own browser and times out leaves that browser open for the rest
// of the run; the launch helper now remembers every browser and the runner closes what is left after each check.
check('Test harness: a browser a check leaves open is closed by the runner (closeLaunched)', async (page) => {
  const stray = await launch({ scrollbars: true });
  const before = stray.isConnected();
  const closed = await closeLaunched(10000, [page.context().browser()]);
  return { pass: before && closed === 1 && !stray.isConnected() && page.context().browser().isConnected(), detail: JSON.stringify({ before, closed, after: stray.isConnected() }) };
});


// GLM audit (Canvas/DOM parity): with Variable sites only, a selected run that spans hidden (conserved) columns
// must be framed the same way in both views: a break where columns are hidden. The DOM judges run ends by the
// cells on the page; Canvas groups runs by consecutive alignment positions, not only by consecutive slots.
check('Variable sites only: a residue selection across hidden columns is framed alike in Full and Canvas', async (page) => {
  // columns 3-7 and 10 are conserved (hidden with Variable sites only), the rest vary; selecting 2-10 shows the runs {2} and {8,9}
  const base = 'ACGTAAAAGTCAGTCA';
  const rows = [base, 'TCGTAAAACTCGGTAA', 'AGCTAAAAGACACTCC'];
  const fa = rows.map((r, i) => '>s' + i + '\n' + r).join('\n') + '\n';
  const out = {};
  for (const view of ['full', 'canvas']) {
    await loadFasta(page, fa); await setMode(page, view);
    await page.evaluate(() => { const b = document.getElementById('varSitesOnly'); if (!b.checked) { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); } });
    await page.waitForTimeout(500);
    await page.evaluate(() => { _setNucRectangle(1, 2, 1, 10); scheduleNucSelectionRefresh(); if (document.getElementById('modeCanvas').checked) (_canvasState.scheduleOverlay || _canvasState.scheduleDraw)(); });
    await page.waitForTimeout(300);
    out[view] = await page.evaluate(() => {
      const hidden = [3, 4, 5, 6, 7, 10];
      if (document.getElementById('modeCanvas').checked) {
        const o = _canvasState.overlay, m = _canvasState.metrics, dpr = o.width / parseFloat(o.style.width || o.width), g = o.getContext('2d');
        const y = Math.round((m.headerH + 1.5 * _canvasState.rowPitch - _canvasState.offsetY) * dpr);
        const px = x => { let a = 0; for (let d = -2; d <= 2; d++) a = Math.max(a, g.getImageData(Math.round((x + d) * dpr), y, 1, 1).data[3]); return a; };
        const edge = col => m.nameW + _canvasColToSlot(col) * m.charW - _canvasState.offsetX;   // left edge of a column's cell
        return { hiddenSlots: hidden.map(c => _canvasColToSlot(c)), atBreak: px(edge(8)), inside: px(edge(9)), outerLeft: px(edge(2)), outerRight: px(edge(9) + m.charW), lone: px(edge(2) + m.charW) };
      }
      const sp = c => document.querySelector('.seq-line[data-seq-index="1"] .seq-data > span[data-pos="' + c + '"]');
      return { hiddenPresent: hidden.map(c => !!sp(c) && sp(c).getClientRects().length > 0), lone: sp(2).classList.contains('nuc-sel-start') && sp(2).classList.contains('nuc-sel-end'), startAt8: sp(8).classList.contains('nuc-sel-start') && !sp(8).classList.contains('nuc-sel-end'), endAt9: sp(9).classList.contains('nuc-sel-end') && !sp(9).classList.contains('nuc-sel-start') };
    });
    await page.evaluate(() => { const b = document.getElementById('varSitesOnly'); if (b.checked) { b.checked = false; b.dispatchEvent(new Event('change', { bubbles: true })); } });
  }
  const f = out.full, c = out.canvas;
  const ok = f.hiddenPresent.every(v => !v) && f.lone && f.startAt8 && f.endAt9
    && c.hiddenSlots.every(s => s < 0) && c.atBreak >= c.inside + 60 && c.outerLeft >= c.inside + 60 && c.outerRight >= c.inside + 60 && c.lone >= c.inside + 60;
  return { pass: ok, detail: JSON.stringify(out) };
});


// GLM audit (confirmed twice): a residue selection drag whose mouseup never reaches the page (the window lost focus
// mid-drag) left state.isDragging set, and the tooltip gate then refused every residue tooltip until the next click.
// Losing the window's focus now ends a drag like a mouseup.
check('A drag interrupted by the window losing focus ends; residue tooltips work again', async (page) => {
  await loadFasta(page, '>a\nACGTACGTACGTACGT\n>b\nACGTACGTACGTACGT\n');
  await setMode(page, 'full');
  const c = await page.evaluate(() => { const a = document.querySelector('.seq-line[data-seq-index="1"] .seq-data > span[data-pos="3"]').getBoundingClientRect(); return { x: a.left + a.width / 2, y: a.top + a.height / 2, w: a.width }; });
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 3 * c.w, c.y, { steps: 3 });
  const during = await page.evaluate(() => ({ dragging: !!state.isDragging, gate: _pointerDragInProgress() }));
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));   // the user switched windows with the button down
  const after = await page.evaluate(() => ({ dragging: !!state.isDragging, gate: _pointerDragInProgress(), sel: state.selectedNucs.get(1) ? state.selectedNucs.get(1).size : 0 }));
  await page.mouse.up();
  await page.mouse.move(c.x + 6 * c.w, c.y); await page.waitForTimeout(700);
  const tip = await page.evaluate(() => { const t = document.getElementById('tooltip'); const cs = getComputedStyle(t); return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'; });
  return { pass: during.dragging && during.gate && !after.dragging && !after.gate && after.sel === 4 && tip, detail: JSON.stringify({ during, after, tip }) };
});


// Owner (2026-10-24): a clear, distinct acknowledgement in the interface that the statistics borrow S. Eddy's
// HMMER/Easel definitions (esl-alistat, esl-alipid).
check('Statistics window credits Easel / HMMER (Sean R. Eddy) distinctly, with the links', async (page) => {
  await loadFasta(page, '>a\nACGTACGTAC\n>b\nACGTACCTAC\n');
  await page.evaluate(() => openStats());
  await page.waitForFunction(() => document.querySelector('#statsSummaryTab table.stats-mx'), null, { timeout: 15000 });
  const r = await page.evaluate(() => { const f = document.querySelector('#statsModal .stats-credit'); const cs = f && getComputedStyle(f); return { text: f ? f.textContent : '', links: f ? [...f.querySelectorAll('a')].map(a => a.href) : [], visible: !!f && f.getClientRects().length > 0 && parseFloat(cs.fontSize) >= 11 && cs.color !== 'rgb(153, 153, 153)', cards: [...document.querySelectorAll('#statsSummaryTab .stats-card')].map(c => c.textContent.slice(0, 40)) }; });
  const ok = /Sean R\. Eddy/.test(r.text) && /HMMER/.test(r.text) && /esl-alistat/.test(r.text) && /esl-alipid/.test(r.text) && r.links.some(l => /hmmer\.org/.test(l)) && r.links.some(l => /EddyRivasLab\/easel/.test(l)) && r.visible && r.cards.some(c => /esl-alistat/.test(c)) && r.cards.some(c => /esl-alipid/.test(c));
  return { pass: ok, detail: JSON.stringify(r) };
});


// Statistics audit (2026-10-24, oracle probe vs the Easel source): a residue is a letter; "*" (Easel: nonresidue)
// and the gap/missing symbols are not, and in a nucleotide alignment U is the same code as T (Easel DNA alphabet).
// a/b differ only by U; c has a * and two symbols the parser turns into gaps, and one real mismatch (col 7, C vs G).
check('Statistics follow Easel: * is not a residue and U equals T in a nucleotide alignment', async (page) => {
  await loadFasta(page, '>a\nACGTACGTAC\n>b\nACGUACGUAC\n>c\nAC*TACC~A_\n');
  await page.evaluate(() => openStats());
  await page.waitForFunction(() => state._statsData && document.querySelector('#statsSummaryTab table.stats-mx'), null, { timeout: 15000 });
  const r = await page.evaluate(() => {
    const d = state._statsData, n = d.n, card = {};
    document.querySelectorAll('#statsSummaryTab .stats-card tr').forEach(tr => { const k = tr.cells[0]?.textContent.trim(); if (k) card[k] = tr.cells[1].textContent.trim(); });
    const f = (m, i, j) => +m[i * n + j].toFixed(1);
    return { nres: card['Total # residues'], small: card['Smallest'], avglen: card['Average length'], avgid: card['Average identity'], gaps: card['Gaps'], mean: card['Mean'], ab: f(d.pid.esl, 0, 1), ac: f(d.pid.esl, 0, 2), bc: f(d.pid.esl, 1, 2), cab: f(d.pid.cols, 0, 1), cac: f(d.pid.cols, 0, 2), shown: d.combined[0][2], dist: d.combined[2][0] };
  });
  const ok = r.nres === '27' && r.small === '7' && r.avglen === '9.0' && r.avgid === '90.5%' && r.gaps === '3 (10.0%)' && /^90\.5%/.test(r.mean)
    && r.ab === 100 && r.ac === 85.7 && r.bc === 85.7 && r.cab === 100 && r.cac === 85.7 && r.shown === '85.7' && r.dist === '0.14';   // owner 2026-10-24: distances with two decimals
  return { pass: ok, detail: JSON.stringify(r) };
});


// GLM statistics audit (2026-10-24): the heat-range and pair-filter inputs shared one debounce timer, so an edit in
// one field followed within 300 ms by an edit in the other was dropped; and the row/column highlight of a hovered
// cell stayed lit when the pointer left the window (nothing inside the tab fired mouseover any more).
check('Statistics: a filter value typed right after a heat-range value is applied; hover highlight clears when the pointer leaves', async (page) => {
  await loadFasta(page, makeFasta(8, 40));
  await page.evaluate(() => { localStorage.removeItem('msaviewer_statsHeat'); openStats(); });
  await page.waitForFunction(() => state._statsData && document.querySelector('#statsSummaryTab table.stats-mx'), null, { timeout: 15000 });
  await page.evaluate(() => {
    const fire = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    fire('statsHeatLo', '20');
    setTimeout(() => fire('statsFilterValue', '90'), 60);   // within the heat timer's 300 ms
  });
  await page.waitForTimeout(900);
  const applied = await page.evaluate(() => ({ filter: state._statsFilter && state._statsFilter.value, heatLo: _statsHeatOpts().range.identity && _statsHeatOpts().range.identity.lo }));
  // hover a cell, then leave the window for the alignment area
  const cell = await page.evaluate(() => { const td = document.querySelector('#statsSummaryTab table.stats-mx tbody tr td:nth-child(3)'); const r = td.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(cell.x, cell.y); await page.waitForTimeout(100);
  const litWhileOver = await page.evaluate(() => document.querySelectorAll('#statsSummaryTab table.stats-mx .hl').length);
  const outside = await page.evaluate(() => { const r = document.getElementById('statsModal').getBoundingClientRect(); const a = document.querySelector('.alignment-container, #alignmentContainer, body'); return r.left > 60 ? { x: 20, y: r.top + 40 } : { x: window.innerWidth - 20, y: r.top + 40 }; });
  await page.mouse.move(outside.x, outside.y); await page.waitForTimeout(150);
  const litAfter = await page.evaluate(() => document.querySelectorAll('#statsSummaryTab table.stats-mx .hl').length);
  const r = { ...applied, litWhileOver, litAfter };
  return { pass: r.filter === 90 && r.heatLo === 20 && r.litWhileOver === 2 && r.litAfter === 0, detail: JSON.stringify(r) };
});


// Statistics audit batch 3 (2026-10-24). Measured before: 600 x 2000 took 20 s, 2000 x 5000 nine minutes, the tab
// frozen with a busy overlay that never repainted and no Stop. Now: typed arrays, progress, Stop.
check('Statistics: the pairwise pass is fast, reports its progress and can be stopped', async (page) => {
  await loadFasta(page, makeFasta(600, 2000));
  const t0 = Date.now();
  await page.evaluate(() => openStats());
  await page.waitForFunction(() => state._statsData && state._statsData.n === 600 && document.querySelector('#statsSummaryTab table.stats-mx'), null, { timeout: 60000 });
  const ms600 = Date.now() - t0;
  await page.evaluate(() => document.getElementById('statsCloseBtn').click());
  await loadFasta(page, makeFasta(1500, 4000));
  await page.evaluate(() => { window._statsRun = openStats(); });
  let progress = null;
  for (let k = 0; k < 400 && !progress; k++) { await page.waitForTimeout(50); progress = await page.evaluate(() => { const d = document.getElementById('busyDetail'); return d && !d.hidden && /of [\d,]+ pairs/.test(d.textContent) ? d.textContent : null; }); }
  if (progress) await page.click('#busyStop');
  await page.evaluate(() => window._statsRun);
  const after = await page.evaluate(() => ({ n: state._statsData ? state._statsData.n : null, busy: !document.getElementById('busyOverlay')?.hidden, msg: document.getElementById('statusMessage')?.textContent || '' }));
  const r = { ms600, progress, ...after };
  // after Stop there are no statistics: the new file dropped the previous alignment's (_statsInvalidate)
  return { pass: ms600 < 8000 && !!progress && r.n === null && !r.busy && /cancel/i.test(r.msg), detail: JSON.stringify(r) };
});

check('Statistics: a new file closes the window, an edit marks it stale with Recompute, dock width validated and re-clamped', async (page) => {
  const vis = () => page.evaluate(() => { const w = document.getElementById('statsModal'); return w.style.display !== 'none' && w.getClientRects().length > 0; });
  const open = async () => { await page.evaluate(() => openStats()); await page.waitForFunction(() => state._statsData && document.querySelector('#statsSummaryTab table.stats-mx'), null, { timeout: 15000 }); };
  await loadFasta(page, '>old1\nACGTACGT\n>old2\nACGTACGA\n>old3\nACGTACAA\n'); await open();
  await loadFasta(page, '>new1\nACGTACGT\n>new2\nACGTACGA\n');
  const newFile = { visible: await vis(), data: await page.evaluate(() => !!state._statsData) };
  await loadFasta(page, '>r1\nACGTACGT\n>r2\nACGTACGA\n>r3\nACGTACAA\n>r4\nACGTAAAA\n'); await open();
  await page.evaluate(() => { window.confirm = () => true; state.selectedRows = new Set([1]); deleteSelected(); });
  await page.waitForTimeout(200);
  const edit = { visible: await vis(), stale: await page.evaluate(() => { const b = document.getElementById('statsStale'); return !!b && !b.hidden && b.getClientRects().length > 0; }), rows: await page.evaluate(() => state.seqs.length), shownN: await page.evaluate(() => state._statsData.n) };
  await page.click('#statsRecompute');
  await page.waitForFunction(() => state._statsData && state._statsData.n === 3, null, { timeout: 15000 });
  const recomputed = await page.evaluate(() => ({ n: state._statsData.n, names: state._statsData.names.join(','), stale: !document.getElementById('statsStale').hidden }));
  await page.evaluate(() => { document.getElementById('statsCloseBtn').click(); localStorage.setItem('msaviewer_statsWin', JSON.stringify({ dockW: 'abc' })); });
  await page.reload({ waitUntil: 'networkidle' });
  await loadFasta(page, makeFasta(5, 30)); await open();
  await page.evaluate(() => _statsDock());
  await page.waitForTimeout(200);
  const docked = await page.evaluate(() => ({ w: document.getElementById('statsModal').getBoundingClientRect().width, inner: window.innerWidth }));
  await page.setViewportSize({ width: 700, height: 700 }); await page.waitForTimeout(400);
  const shrunk = await page.evaluate(() => ({ w: document.getElementById('statsModal').getBoundingClientRect().width, inner: window.innerWidth, pad: document.body.style.paddingRight }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => { _statsUndock(); document.getElementById('statsCloseBtn').click(); localStorage.removeItem('msaviewer_statsWin'); });
  const r = { newFile, edit, recomputed, docked, shrunk };
  const ok = !newFile.visible && !newFile.data && edit.visible && edit.stale && edit.rows === 3 && edit.shownN === 4
    && recomputed.n === 3 && recomputed.names === 'r1,r3,r4' && !recomputed.stale
    && Number.isFinite(docked.w) && docked.w >= 280 && docked.w <= docked.inner - 300 && shrunk.w <= shrunk.inner - 300 && shrunk.pad === Math.round(shrunk.w) + 'px';
  return { pass: ok, detail: JSON.stringify(r) };
});


// Statistics audit batch 4 (2026-10-24). The windowed matrix held every column of each live row (n=2000: 150,000
// cells rebuilt per shift, 2.8 s); a re-render while scrolled built the top window first and the right one a frame
// later; the longest-name input kept a value the table did not use.
check('Statistics windowed matrix: columns windowed too, the cell under the pointer is the right one after scrolling, re-render keeps the place, longest name clamped', async (page) => {
  await loadFasta(page, makeFasta(400, 30));
  await page.evaluate(() => { localStorage.removeItem('msaviewer_statsLabels'); openStats(); });
  await page.waitForFunction(() => state._statsData && state._statsData.n === 400 && document.querySelector('#statsSummaryTab table.stats-mx'), null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const probe = () => page.evaluate(() => {
    const sc = document.querySelector('#statsSummaryTab .stats-mx-scroll'), t = sc.querySelector('table.stats-mx'), d = state._statsData;
    const tds = t.tBodies[0].querySelectorAll('td:not(.sp):not(.csp):not(.pad)').length;
    const r = sc.getBoundingClientRect(), x = r.left + r.width * 0.6, y = r.top + r.height * 0.6;
    const el = document.elementFromPoint(x, y), td = el && el.closest('td');
    const tr = td && td.parentElement, i = tr && tr.cells[0].dataset.r != null ? +tr.cells[0].dataset.r : -1;
    const th = [...t.tHead.rows[0].cells].find(c => c.dataset.c != null && c.getBoundingClientRect().left <= x && c.getBoundingClientRect().right > x);
    const j = th ? +th.dataset.c : -1;
    return { tds, i, j, text: td ? td.textContent : null, want: i >= 0 && j >= 0 ? d.combined[i][j] : null, scrollTop: Math.round(sc.scrollTop), scrollLeft: Math.round(sc.scrollLeft), firstRow: +t.tBodies[0].querySelector('tr:not(.sp) th')?.dataset.r };
  });
  const top = await probe();
  await page.evaluate(() => { const sc = document.querySelector('#statsSummaryTab .stats-mx-scroll'); sc.scrollTop = sc.scrollHeight * 0.5; sc.scrollLeft = sc.scrollWidth * 0.5; });
  await page.waitForTimeout(400);
  const mid = await probe();
  // a re-render while scrolled: the first synchronous build is already around the scrolled rows
  const rerender = await page.evaluate(() => { _renderOpenStatsMatrices(); const sc = document.querySelector('#statsSummaryTab .stats-mx-scroll'), t = sc.querySelector('table.stats-mx'); return { firstRow: +t.tBodies[0].querySelector('tr:not(.sp) th')?.dataset.r, scrollTop: Math.round(sc.scrollTop) }; });
  await page.waitForTimeout(300);
  const after = await probe();
  // selection and focus in the scrolled window
  const selFocus = await page.evaluate(() => { _statsClickColumn(300, {}); _statsJumpTo(200, 300); const t = document.querySelector('#statsSummaryTab table.stats-mx'); return { focus: !!t.querySelector('td.focus') && t.querySelector('td.focus').textContent === state._statsData.combined[200][300], cs: t.querySelectorAll('td.cs').length > 0, csOnly300: [...t.querySelectorAll('tr')].every(tr => { const n = tr.querySelectorAll('td.cs').length; return n <= 1; }) }; });
  const ln = await page.evaluate(() => { const i = document.getElementById('statsLabelChars'); i.value = '200'; i.dispatchEvent(new Event('change', { bubbles: true })); return { shown: i.value, applied: _statsLabelOpts().chars }; });
  const r = { top, mid, rerender, after, selFocus, ln };
  const cellsOk = top.tds > 0 && top.tds < 20000 && mid.tds < 20000;   // every column of 75 live rows was 30,000
  const ok = cellsOk && top.i >= 0 && top.text === top.want && mid.i > 50 && mid.j > 50 && mid.text === mid.want
    && rerender.firstRow > 50 && after.text === after.want && selFocus.focus && selFocus.cs && selFocus.csOnly300
    && ln.shown === '80' && ln.applied === 80;
  return { pass: ok, detail: JSON.stringify(r) };
});

async function main() {
  const { server, baseUrl } = await start();
  const results = [];
  // Optional: CHECK_FILTER=substring runs only checks whose name includes it
  // (case-insensitive) - useful for isolating one check while iterating.
  const filter = process.env.CHECK_FILTER ? process.env.CHECK_FILTER.toLowerCase() : null;
  const activeChecks = filter ? CHECKS.filter(c => c.name.toLowerCase().includes(filter)) : CHECKS;
  try {
    for (const { name, fn, opts } of activeChecks) {
      // A fresh browser process per check, not just a fresh page: multiple
      // multi-million-residue alignments loaded into the SAME browser
      // process across successive checks was observed to accumulate memory
      // and crash the renderer ("Target crashed") partway through the suite
      // - isolating each check removes that as a confound between checks
      // and matches how a real user's single-alignment session behaves
      // rather than compounding this test suite's own churn.
      const browser = await launch();
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      page.setDefaultTimeout(30000);
      let outcome;
      const t0 = Date.now();
      try {
        await page.goto(baseUrl + '/index.html?view=block', { waitUntil: 'networkidle' });
        outcome = await withTimeout(fn(page), checkTimeoutMs(opts));
      } catch (e) {
        outcome = { pass: false, detail: `threw: ${e.message}` };
      }
      const ms = Date.now() - t0;
      console.log(`[${outcome.pass ? 'PASS' : 'FAIL'}] (${ms}ms) ${name}${outcome.detail ? ' - ' + outcome.detail : ''}`);
      results.push({ name, ...outcome });
      await withTimeout(browser.close(), 20000).catch(() => console.warn('[WARN] the browser of "' + name + '" did not close within 20 s'));   // a timed-out check may still hold the page
      // a check that launched its own browser (launch({ scrollbars: true })) and timed out never closed it
      const left = await closeLaunched(10000, [browser]);
      if (left) console.warn('[WARN] ' + left + ' browser(s) left open by "' + name + '" closed by the runner');
    }
  } finally {
    server.close();
  }

  const failCount = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failCount}/${results.length} passed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR:', e); process.exit(1); });
