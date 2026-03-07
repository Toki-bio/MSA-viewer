/**
 * mafft-wasm.js — Browser-side MAFFT alignment via WebAssembly
 * 
 * Compiled from MAFFT v7.525 core binaries using Emscripten.
 * Runs entirely in the browser — no server needed.
 *
 * Usage:
 *   const mafft = new MafftWasm();
 *   await mafft.init();                              // loads WASM
 *   const aligned = await mafft.align(fastaString);   // returns aligned FASTA
 */

class MafftWasm {
  constructor(opts = {}) {
    // Path prefix for .js/.wasm files (default: same directory)
    this.wasmPath = opts.wasmPath || '';
    this._loaded = false;
  }

  /**
   * Pre-load the WASM modules. Call once before first alignment.
   * Can be called again safely (no-op if already loaded).
   */
  async init() {
    if (this._loaded) return;
    // We dynamically import the glue JS and let Emscripten locate the .wasm
    // For browser use, the .js and .wasm files must be in the same directory
    // (or wasmPath must point to them)
    this._loaded = true;
  }

  /**
   * Load and return a fresh WASM module instance of the given binary.
   * Each call gets a fresh module (fresh filesystem, fresh memory).
   */
  async _createModule(moduleName) {
    // The glue JS is loaded as a script tag (see _ensureScript).
    // createDisttbfast / createTbfast / createDvtditr are global factory fns.
    const factories = {
      disttbfast: 'createDisttbfast',
      tbfast: 'createTbfast',
      dvtditr: 'createDvtditr',
    };
    const factoryName = factories[moduleName];
    if (!factoryName || typeof window[factoryName] !== 'function') {
      throw new Error(
        `MAFFT WASM: ${factoryName} not found. ` +
        `Make sure <script src="${this.wasmPath}${moduleName}.js"></script> is loaded.`
      );
    }

    const stdoutBuf = [];
    const stderrBuf = [];

    const Module = await window[factoryName]({
      // Override locateFile so Emscripten finds the .wasm next to the .js
      locateFile: (path) => {
        if (path.endsWith('.wasm')) {
          return this.wasmPath + path;
        }
        return this.wasmPath + path;
      },
      print: (text) => { stdoutBuf.push(text); },
      printErr: (text) => { stderrBuf.push(text); },
      noInitialRun: true,
    });

    Module._stdoutBuf = stdoutBuf;
    Module._stderrBuf = stderrBuf;
    return Module;
  }

  /**
   * Run disttbfast with the given FASTA input and optional extra args.
   * Returns aligned FASTA string.
   */
  async _runDisttbfast(fastaInput, extraArgs = []) {
    const mod = await this._createModule('disttbfast');
    mod.FS.writeFile('/input.fa', fastaInput);

    // Check if extraArgs override -E (sequence type)
    const hasE = extraArgs.includes('-E');
    const baseArgs = hasE
      ? ['-i', '/input.fa']
      : ['-i', '/input.fa', '-E', '2'];
    const args = [...baseArgs, ...extraArgs];
    
    try {
      mod.callMain(args);
    } catch (e) {
      // Emscripten may throw on exit(0)
      if (e && e.status !== undefined && e.status === 0) {
        // Normal exit
      } else if (e && e.message && e.message.includes('exit(0)')) {
        // Normal
      } else {
        const stderr = mod._stderrBuf.join('\n');
        throw new Error(`disttbfast failed: ${e.message}\n${stderr}`);
      }
    }

    return mod._stdoutBuf.join('\n');
  }

  /**
   * Full re-alignment of sequences.
   * @param {string} fastaStr — FASTA-formatted sequences (gaps will be stripped)
   * @returns {string} Aligned FASTA
   */
  async align(fastaStr, extraArgs = []) {
    // Strip gaps from input
    const ungapped = this._stripGaps(fastaStr);
    const result = await this._runDisttbfast(ungapped, extraArgs);
    if (!result || !result.trim()) {
      throw new Error('MAFFT produced no output');
    }
    return result;
  }

  /**
   * Realign a block of columns (subsequences).
   * @param {string} fastaStr — FASTA with just the block residues (ungapped)
   * @returns {string} Realigned FASTA for the block
   */
  async realignBlock(fastaStr, extraArgs = []) {
    const result = await this._runDisttbfast(fastaStr, extraArgs);
    if (!result || !result.trim()) {
      throw new Error('MAFFT produced no output for block');
    }
    return result;
  }

  /**
   * Add new sequences to existing alignment.
   * Since the full MAFFT --add pipeline requires multiple binaries
   * and shell orchestration, we use a simpler approach:
   * combine existing and new sequences, strip all gaps, and re-align.
   * @param {string} existingFasta — current aligned FASTA
   * @param {string} newFasta — new sequences in FASTA format
   * @returns {string} Aligned FASTA with all sequences
   */
  async addAndAlign(existingFasta, newFasta, extraArgs = []) {
    const combined = this._stripGaps(existingFasta) + '\n' + this._stripGaps(newFasta);
    const result = await this._runDisttbfast(combined, extraArgs);
    if (!result || !result.trim()) {
      throw new Error('MAFFT produced no output');
    }
    return result;
  }

  /**
   * Strip gap characters from FASTA sequences (preserve headers)
   */
  _stripGaps(fasta) {
    return fasta.split('\n').map(line => {
      if (line.startsWith('>')) return line;
      return line.replace(/[-\.]/g, '');
    }).join('\n');
  }
}

// Export for module systems, also available as global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MafftWasm;
}
