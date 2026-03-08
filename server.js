const express = require('express');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
app.use(express.static('.')); // Serve static files from current directory

const PORT = 3000;

// Database configuration
const DATABASES = {
    'SINEBase.nr95': path.join(__dirname, 'SINEBase.nr95.fa'),
    'RepBase.bnk': path.join(__dirname, 'RepBase.bnk'),
    'RepBase_filtered': path.join(__dirname, 'RepBase_filtered.bnk'),
    'snake_gekko_SINEs': path.join(__dirname, 'snake_gekko_SINEs_cons.fas')
};

// Format a FASTA database for BLAST
function formatDatabase(dbPath, dbName) {
    if (!fs.existsSync(dbPath)) {
        console.warn(`Database file not found: ${dbPath}`);
        return false;
    }

    try {
        const dbDir = path.dirname(dbPath);
        // Check if already formatted
        if (fs.existsSync(path.join(dbDir, `${dbName}.nhr`))) {
            return true;
        }

        // Try makeblastdb
        console.log(`Formatting database: ${dbName}`);
        execSync(`makeblastdb -in "${dbPath}" -dbtype nucl -title "${dbName}" -out "${path.join(dbDir, dbName)}"`, {
            stdio: 'ignore'
        });
        return true;
    } catch (err) {
        console.error(`Failed to format database ${dbName}:`, err.message);
        return false;
    }
}

// Initialize and format databases on startup
function initializeDatabases() {
    console.log('Initializing BLAST databases...');
    const results = {};
    for (const [name, dbPath] of Object.entries(DATABASES)) {
        results[name] = {
            exists: fs.existsSync(dbPath),
            formatted: formatDatabase(dbPath, name)
        };
    }
    return results;
}

// ============ IN-MEMORY DATABASE CACHE ============
const DB_CACHE = {};
const DB_INDEX = {};

function parseFasta(content) {
    const seqs = [];
    const blocks = content.split('>');
    for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split('\n');
        const header = lines[0].trim();
        const seq = lines.slice(1).join('').replace(/\s/g, '').toUpperCase().replace(/[^ACGTUN]/g, 'N');
        if (!seq || seq.length < 20) continue;
        const spaceIdx = header.indexOf(' ');
        const id = spaceIdx > 0 ? header.substring(0, spaceIdx) : header;
        seqs.push({ id, def: header, seq, length: seq.length });
    }
    return seqs;
}

function loadDbCache() {
    for (const [name, dbPath] of Object.entries(DATABASES)) {
        if (fs.existsSync(dbPath)) {
            console.log(`Loading ${name} into memory...`);
            const t0 = Date.now();
            DB_CACHE[name] = parseFasta(fs.readFileSync(dbPath, 'utf8'));
            // Pre-encode and build inverted kmer index
            for (const e of DB_CACHE[name]) e._enc = encodeSeq(e.seq, 600);
            DB_INDEX[name] = buildInvertedIndex(DB_CACHE[name]);
            console.log(`  ${DB_CACHE[name].length} sequences loaded + indexed in ${Date.now() - t0} ms`);
        } else {
            console.warn(`  Not found: ${dbPath}`);
            DB_CACHE[name] = [];
        }
    }
}

// ============ SMITH-WATERMAN WITH TRACEBACK ============
function smithWaterman(query, subject) {
    // Cap sequences to keep it fast
    const q = query.substring(0, 600);
    const s = subject.substring(0, 600);
    const m = q.length, n = s.length;

    const MATCH = 2, MISMATCH = -3, GAP_EXT = -2;
    // Use flat typed arrays for speed
    const H  = new Int32Array((m + 1) * (n + 1));
    const TB = new Uint8Array((m + 1) * (n + 1)); // 1=diag 2=up 3=left

    let maxScore = 0, maxI = 0, maxJ = 0;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const base = i * (n + 1) + j;
            const d = q[i - 1] === s[j - 1] ? MATCH : MISMATCH;
            const diag = H[(i - 1) * (n + 1) + (j - 1)] + d;
            const up   = H[(i - 1) * (n + 1) + j] + GAP_EXT;
            const left = H[i * (n + 1) + (j - 1)] + GAP_EXT;
            const best = Math.max(0, diag, up, left);
            H[base] = best;
            TB[base] = best === 0 ? 0 : best === diag ? 1 : best === up ? 2 : 3;
            if (best > maxScore) { maxScore = best; maxI = i; maxJ = j; }
        }
    }

    if (maxScore === 0) return null;

    // Traceback
    let alignQ = '', alignS = '';
    let i = maxI, j = maxJ;
    while (i > 0 && j > 0 && H[i * (n + 1) + j] > 0) {
        const dir = TB[i * (n + 1) + j];
        if (dir === 1) { alignQ = q[i - 1] + alignQ; alignS = s[j - 1] + alignS; i--; j--; }
        else if (dir === 2) { alignQ = q[i - 1] + alignQ; alignS = '-' + alignS; i--; }
        else { alignQ = '-' + alignQ; alignS = s[j - 1] + alignS; j--; }
    }
    const qStart = i + 1, sStart = j + 1;

    let identity = 0;
    let midline = '';
    for (let k = 0; k < alignQ.length; k++) {
        if (alignQ[k] !== '-' && alignQ[k] === alignS[k]) { identity++; midline += '|'; }
        else if (alignQ[k] === '-' || alignS[k] === '-') midline += ' ';
        else midline += '.';
    }

    const alignLen = alignQ.length;
    const percent  = alignLen > 0 ? ((identity / alignLen) * 100).toFixed(1) : '0.0';
    const bitScore = parseFloat(Math.max(0, (maxScore * 0.625 - Math.log(0.41)) / Math.log(2)).toFixed(1));

    return { score: maxScore, bitScore, identity, alignLen, percent,
             queryStart: qStart, queryEnd: maxI,
             hitStart: sStart,   hitEnd: maxJ,
             querySeq: alignQ, hitSeq: alignS, midline };
}

// ============ KMER ENCODING & INVERTED INDEX SEARCH ============
const BASE_MAP = new Uint8Array(128);
BASE_MAP['A'.charCodeAt(0)] = 0; BASE_MAP['C'.charCodeAt(0)] = 1;
BASE_MAP['G'.charCodeAt(0)] = 2; BASE_MAP['T'.charCodeAt(0)] = 3;
BASE_MAP['a'.charCodeAt(0)] = 0; BASE_MAP['c'.charCodeAt(0)] = 1;
BASE_MAP['g'.charCodeAt(0)] = 2; BASE_MAP['t'.charCodeAt(0)] = 3;

function encodeSeq(s, maxLen) {
    const len = Math.min(s.length, maxLen);
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = BASE_MAP[s.charCodeAt(i)] || 0;
    return arr;
}

const KMER     = 9;
const KMER_MASK = (1 << (KMER * 2)) - 1; // 0x3FFFF  (18 bits)
const BS_SIZE   = ((1 << (KMER * 2)) >>> 5); // 8192 uint32 words for dedup bitset

// Build inverted index: kmer_hash -> Int32Array of sequence indices
// Paid once at load time; each search then does O(query_kmers) lookups instead of O(N * db_seq_len)
function buildInvertedIndex(dbSeqs) {
    const SCAN_CAP = 600;
    // Accumulate posting lists as plain arrays first
    const posting = new Map();
    const seqBs = new Uint32Array(BS_SIZE); // reuse per seq for dedup

    for (let i = 0; i < dbSeqs.length; i++) {
        const enc = dbSeqs[i]._enc;
        if (!enc || enc.length < KMER) continue;
        // reset dedup bitset
        seqBs.fill(0);
        let h = 0;
        for (let j = 0; j < KMER - 1; j++) h = ((h << 2) | enc[j]) & KMER_MASK;
        for (let j = KMER - 1; j < enc.length; j++) {
            h = ((h << 2) | enc[j]) & KMER_MASK;
            // deduplicate: only add each kmer once per sequence
            if (seqBs[h >>> 5] & (1 << (h & 31))) continue;
            seqBs[h >>> 5] |= (1 << (h & 31));
            let list = posting.get(h);
            if (!list) { list = []; posting.set(h, list); }
            list.push(i);
        }
    }
    // Convert to typed arrays for cache-friendly iteration
    const index = new Map();
    for (const [k, v] of posting) index.set(k, new Int32Array(v));
    return index;
}

function searchDatabase(querySeq, dbSeqs, index, maxHits = 10) {
    const MIN_HITS = 3;   // require 3 shared unique 9-mers before running SW
    const MAX_SW   = 400; // cap SW candidates to keep latency bounded

    const qEnc = encodeSeq(querySeq, 600);
    if (qEnc.length < KMER) return [];

    // Tally kmer hits per DB sequence using the inverted index
    // O(unique_query_kmers * avg_posting_size) — far cheaper than scanning all seqs
    const counts = new Uint16Array(dbSeqs.length); // max 65535 hits/seq
    const qBs    = new Uint32Array(BS_SIZE);         // dedup query kmers
    let h = 0;
    for (let i = 0; i < KMER - 1; i++) h = ((h << 2) | qEnc[i]) & KMER_MASK;
    for (let i = KMER - 1; i < qEnc.length; i++) {
        h = ((h << 2) | qEnc[i]) & KMER_MASK;
        if (qBs[h >>> 5] & (1 << (h & 31))) continue; // skip duplicate query kmer
        qBs[h >>> 5] |= (1 << (h & 31));
        const list = index ? index.get(h) : null;
        if (list) for (let j = 0; j < list.length; j++) counts[list[j]]++;
    }

    // Collect candidates with enough shared kmers
    const candidates = [];
    for (let i = 0; i < dbSeqs.length; i++) {
        if (counts[i] >= MIN_HITS) candidates.push({ entry: dbSeqs[i], hits: counts[i] });
    }
    candidates.sort((a, b) => b.hits - a.hits);
    const top = candidates.slice(0, MAX_SW);

    // Smith-Waterman on top candidates only
    const scored = [];
    for (const { entry } of top) {
        const sw = smithWaterman(querySeq, entry.seq);
        if (sw && sw.score > 0 && sw.identity > 0) {
            scored.push({ id: entry.id, def: entry.def, length: entry.length,
                          hsps: [{ ...sw, evalue: 0 }] });
        }
    }
    scored.sort((a, b) => b.hsps[0].bitScore - a.hsps[0].bitScore);
    return scored.slice(0, maxHits);
}

// ============ BLAST XML PARSER (for when real BLAST is available) ============
function parseBlastResults(xmlOutput) {
    const results = [];
    
    // Simple XML parsing - extract Hit elements
    const hitMatches = xmlOutput.match(/<Hit>[\s\S]*?<\/Hit>/g) || [];
    
    let hitNum = 0;
    for (const hitXml of hitMatches) {
        hitNum++;
        
        // Extract Hit_id, Hit_def, Hit_len
        const idMatch = hitXml.match(/<Hit_id>([^<]+)<\/Hit_id>/);
        const defMatch = hitXml.match(/<Hit_def>([^<]+)<\/Hit_def>/);
        const lenMatch = hitXml.match(/<Hit_len>(\d+)<\/Hit_len>/);
        
        if (!idMatch) continue;

        const hit = {
            hitNum,
            id: idMatch[1],
            def: defMatch ? defMatch[1] : 'Unknown',
            length: lenMatch ? parseInt(lenMatch[1]) : 0,
            hsps: []
        };

        // Extract HSPs (High Scoring Pairs)
        const hspMatches = hitXml.match(/<Hsp>[\s\S]*?<\/Hsp>/g) || [];
        
        for (const hspXml of hspMatches) {
            // Extract HSP data
            const eMatch = hspXml.match(/<Hsp_evalue>([^<]+)<\/Hsp_evalue>/);
            const scoreMatch = hspXml.match(/<Hsp_bit_score>([^<]+)<\/Hsp_bit_score>/);
            const identityMatch = hspXml.match(/<Hsp_identity>(\d+)<\/Hsp_identity>/);
            const alignMatch = hspXml.match(/<Hsp_align_len>(\d+)<\/Hsp_align_len>/);
            const queryFromMatch = hspXml.match(/<Hsp_query_from>(\d+)<\/Hsp_query_from>/);
            const queryToMatch = hspXml.match(/<Hsp_query_to>(\d+)<\/Hsp_query_to>/);
            const hitFromMatch = hspXml.match(/<Hsp_hit_from>(\d+)<\/Hsp_hit_from>/);
            const hitToMatch = hspXml.match(/<Hsp_hit_to>(\d+)<\/Hsp_hit_to>/);
            const querySeqMatch = hspXml.match(/<Hsp_qseq>([^<]+)<\/Hsp_qseq>/);
            const hitSeqMatch = hspXml.match(/<Hsp_hseq>([^<]+)<\/Hsp_hseq>/);
            const midlineMatch = hspXml.match(/<Hsp_midline>([^<]+)<\/Hsp_midline>/);

            if (eMatch) {
                const identity = identityMatch ? parseInt(identityMatch[1]) : 0;
                const alignLen = alignMatch ? parseInt(alignMatch[1]) : 0;
                const percent = alignLen > 0 ? ((identity / alignLen) * 100).toFixed(2) : 0;

                hit.hsps.push({
                    score: scoreMatch ? parseFloat(scoreMatch[1]) : 0,
                    evalue: parseFloat(eMatch[1]),
                    identity: identity,
                    alignLen: alignLen,
                    percent: percent,
                    queryStart: queryFromMatch ? parseInt(queryFromMatch[1]) : 0,
                    queryEnd: queryToMatch ? parseInt(queryToMatch[1]) : 0,
                    hitStart: hitFromMatch ? parseInt(hitFromMatch[1]) : 0,
                    hitEnd: hitToMatch ? parseInt(hitToMatch[1]) : 0,
                    querySeq: querySeqMatch ? querySeqMatch[1] : '',
                    hitSeq: hitSeqMatch ? hitSeqMatch[1] : '',
                    midline: midlineMatch ? midlineMatch[1] : ''
                });
            }
        }

        if (hit.hsps.length > 0) {
            results.push(hit);
        }
    }
    
    return results.slice(0, 10); // Return top 10 hits
}



// Run BLASTN
app.post('/api/blast', (req, res) => {
    const { query, dbName, evalue = '1e-5', maxHits = 10 } = req.body;

    if (!query || !dbName) {
        return res.status(400).json({ error: 'Query sequence and database name required' });
    }

    if (!DATABASES[dbName]) {
        return res.status(400).json({ error: `Unknown database: ${dbName}` });
    }

    const dbPath = DATABASES[dbName];
    if (!fs.existsSync(dbPath)) {
        return res.status(400).json({ error: `Database file not found: ${dbPath}` });
    }

    try {
        // Create temporary FASTA file for query
        const tmpDir = os.tmpdir();
        const queryFile = path.join(tmpDir, `query_${Date.now()}.fasta`);
        const outputFile = path.join(tmpDir, `blast_${Date.now()}.xml`);

        // Write query to file
        fs.writeFileSync(queryFile, query);

        // Format database name for blastn
        const dbBaseName = path.join(path.dirname(dbPath), path.basename(dbPath, path.extname(dbPath)));

        // Check if running on ARM64 (no BLAST available) or if blastn not in PATH
        let blastAvailable = false;
        try { execSync('blastn -version', { stdio: 'ignore' }); blastAvailable = true; } catch (_) {}

        if (process.arch === 'arm64' || !blastAvailable) {
            console.log('Using local SW search for: ' + dbName);
            const querySeq = fs.readFileSync(queryFile, 'utf8').split('\n').filter(l => !l.startsWith('>')).join('').toUpperCase();
            fs.unlinkSync(queryFile);
            const cached = DB_CACHE[dbName];
            if (!cached || cached.length === 0) {
                return res.status(400).json({ error: `Database ${dbName} not loaded` });
            }
            const t0 = Date.now();
            const hits = searchDatabase(querySeq, cached, DB_INDEX[dbName], parseInt(maxHits) || 10);
            console.log(`  ${hits.length} hits in ${Date.now() - t0} ms`);
            return res.json({ success: true, database: dbName, numHits: hits.length, hits });
        }

        // Run BLAST with XML output (for x64 systems)
        const blastCmd = `blastn -query "${queryFile}" -db "${dbBaseName}" -evalue ${evalue} -outfmt 5 -max_target_seqs ${maxHits} -out "${outputFile}"`;
        
        console.log(`Running BLAST: ${blastCmd}`);
        execSync(blastCmd, { encoding: 'utf8', timeout: 60000 });

        // Read and parse results
        const xmlOutput = fs.readFileSync(outputFile, 'utf8');
        const results = parseBlastResults(xmlOutput);

        // Cleanup
        fs.unlinkSync(queryFile);
        fs.unlinkSync(outputFile);

        res.json({
            success: true,
            database: dbName,
            numHits: results.length,
            hits: results
        });

    } catch (err) {
        console.error('BLAST error:', err);
        res.status(500).json({ 
            error: 'BLAST search failed',
            details: err.message
        });
    }
});

// Batch BLAST search against all databases
app.post('/api/blast-all', (req, res) => {
    const { query, evalue = '1e-5' } = req.body;

    if (!query) {
        return res.status(400).json({ error: 'Query sequence required' });
    }

    try {
        const allResults = {};
        
        for (const [dbName, dbPath] of Object.entries(DATABASES)) {
            if (!fs.existsSync(dbPath)) {
                allResults[dbName] = { error: 'Database file not found' };
                continue;
            }

            try {
                // Create temporary files
                const tmpDir = os.tmpdir();
                const queryFile = path.join(tmpDir, `query_${Date.now()}_${dbName}.fasta`);
                const outputFile = path.join(tmpDir, `blast_${Date.now()}_${dbName}.xml`);

                fs.writeFileSync(queryFile, query);

                const dbBaseName = path.join(path.dirname(dbPath), path.basename(dbPath, path.extname(dbPath)));
                const blastCmd = `blastn -query "${queryFile}" -db "${dbBaseName}" -evalue ${evalue} -outfmt 5 -max_target_seqs 5 -out "${outputFile}"`;
                
                execSync(blastCmd, { encoding: 'utf8', timeout: 60000, stdio: 'ignore' });

                const xmlOutput = fs.readFileSync(outputFile, 'utf8');
                const results = parseBlastResults(xmlOutput);

                allResults[dbName] = {
                    success: true,
                    numHits: results.length,
                    hits: results
                };

                // Cleanup
                fs.unlinkSync(queryFile);
                fs.unlinkSync(outputFile);

            } catch (err) {
                console.error(`BLAST error for ${dbName}:`, err.message);
                allResults[dbName] = { error: err.message };
            }
        }

        res.json({
            success: true,
            results: allResults
        });

    } catch (err) {
        console.error('Batch BLAST error:', err);
        res.status(500).json({ 
            error: 'Batch BLAST search failed',
            details: err.message
        });
    }
});

// ============ MAFFT ALIGNMENT ============
// Path to MAFFT binary - update this if mafft is in a non-standard location
const MAFFT_BIN = process.env.MAFFT_BIN || '/staging/conda/envs/bioinfo/bin/mafft';

// Realign all sequences or add new sequences to existing alignment
app.post('/api/mafft', (req, res) => {
    const { mode = 'align', sequences, existingAlignment, newSequences, options = [] } = req.body;

    if (!sequences && !existingAlignment) {
        return res.status(400).json({ error: 'No sequences provided' });
    }

    const tmpDir = os.tmpdir();
    const timestamp = Date.now();
    const inputFile = path.join(tmpDir, `mafft_input_${timestamp}.fasta`);
    const addFile = path.join(tmpDir, `mafft_add_${timestamp}.fasta`);
    const outputFile = path.join(tmpDir, `mafft_output_${timestamp}.fasta`);

    try {
        let mafftCmd;

        if (mode === 'add' && existingAlignment && newSequences) {
            // --add mode: add new sequences to existing alignment
            fs.writeFileSync(inputFile, existingAlignment);
            fs.writeFileSync(addFile, newSequences);
            // Use --add to add new sequences to existing alignment without re-aligning existing
            const addMode = options.includes('--addfragments') ? '--addfragments' : '--add';
            mafftCmd = `${MAFFT_BIN} ${addMode} "${addFile}" --keeplength "${inputFile}"`;
            // Remove --addfragments from options if it was there (already used)
            const filteredOpts = options.filter(o => o !== '--addfragments' && o !== '--add');
            if (filteredOpts.length > 0) {
                mafftCmd = `${MAFFT_BIN} ${addMode} "${addFile}" ${filteredOpts.join(' ')} "${inputFile}"`;
            }
        } else if (mode === 'realign-block') {
            // Realign a block: sequences are the extracted block columns
            fs.writeFileSync(inputFile, sequences);
            mafftCmd = `${MAFFT_BIN} --auto "${inputFile}"`;
        } else {
            // Full alignment of all sequences
            fs.writeFileSync(inputFile, sequences);
            const mafftOpts = options.length > 0 ? options.join(' ') : '--auto';
            mafftCmd = `${MAFFT_BIN} ${mafftOpts} "${inputFile}"`;
        }

        console.log(`Running MAFFT: ${mafftCmd}`);
        const mafftEnv = { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin:/staging/conda/envs/bioinfo/bin:' + (process.env.PATH || '') };
        const stderrFile = path.join(tmpDir, `mafft_stderr_${timestamp}.log`);
        const fullCmd = `${mafftCmd} 2>${stderrFile}`;
        const result = execSync(fullCmd, {
            encoding: 'utf8',
            timeout: 300000, // 5 minute timeout for large alignments
            maxBuffer: 50 * 1024 * 1024, // 50MB buffer
            shell: '/bin/bash',
            env: mafftEnv
        });

        // Clean up temp files
        try { fs.unlinkSync(inputFile); } catch (_) {}
        try { fs.unlinkSync(addFile); } catch (_) {}
        try { fs.unlinkSync(stderrFile); } catch (_) {}

        if (!result || result.trim().length === 0) {
            return res.status(500).json({ error: 'MAFFT produced no output' });
        }

        res.json({
            success: true,
            alignment: result,
            mode: mode
        });

    } catch (err) {
        console.error('MAFFT error:', err);
        // Read stderr log for details
        let stderrContent = '';
        try { stderrContent = fs.readFileSync(path.join(tmpDir, `mafft_stderr_${timestamp}.log`), 'utf8'); } catch (_) {}
        // Clean up temp files on error
        try { fs.unlinkSync(inputFile); } catch (_) {}
        try { fs.unlinkSync(addFile); } catch (_) {}
        try { fs.unlinkSync(path.join(tmpDir, `mafft_stderr_${timestamp}.log`)); } catch (_) {}

        res.status(500).json({
            error: 'MAFFT alignment failed',
            details: stderrContent || err.stderr || err.message
        });
    }
});

// Check database status
app.get('/api/databases', (req, res) => {
    const status = {};
    for (const [name, dbPath] of Object.entries(DATABASES)) {
        status[name] = {
            path: dbPath,
            exists: fs.existsSync(dbPath),
            formatted: fs.existsSync(path.join(path.dirname(dbPath), `${path.basename(dbPath, path.extname(dbPath))}.nhr`))
        };
    }
    res.json(status);
});

// ============ SSH FILE FETCH ============
const SSH_CONFIG = {
    host: '100.104.25.22',
    user: 'copilot'
};

app.get('/api/ssh-cat', (req, res) => {
    const filePath = req.query.file;
    if (!filePath) {
        return res.status(400).json({ error: 'Missing "file" query parameter' });
    }
    // Basic path validation — block shell injection
    if (/[;|&`$(){}\\]/.test(filePath)) {
        return res.status(400).json({ error: 'Invalid characters in file path' });
    }

    const sshArgs = [
        '-T',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=5',
        '-o', 'BatchMode=yes',
        `${SSH_CONFIG.user}@${SSH_CONFIG.host}`,
        `cat "${filePath}"`
    ];

    const child = spawn('ssh', sshArgs, { timeout: 30000 });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
        if (code !== 0) {
            const msg = stderr.trim() || `SSH exited with code ${code}`;
            return res.status(500).json({ error: msg });
        }
        if (!stdout.trim()) {
            return res.status(404).json({ error: 'File is empty or not found' });
        }
        // Strip any MOTD/banner before the actual file content
        // For FASTA: starts with >.  For MSF: starts with !! or PileUp or spaces.
        let content = stdout;
        const fastaStart = content.indexOf('>');
        const msfStart = content.indexOf('!!');
        if (fastaStart > 0 && (msfStart < 0 || fastaStart < msfStart)) {
            content = content.substring(fastaStart);
        } else if (msfStart > 0) {
            content = content.substring(msfStart);
        }
        res.json({ content, file: filePath });
    });

    child.on('error', (err) => {
        res.status(500).json({ error: `SSH failed: ${err.message}` });
    });
});

// List remote directory
app.get('/api/ssh-ls', (req, res) => {
    const dirPath = req.query.dir || '~';
    if (/[;|&`$(){}\\]/.test(dirPath)) {
        return res.status(400).json({ error: 'Invalid characters in path' });
    }

    const sshArgs = [
        '-T',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=5',
        '-o', 'BatchMode=yes',
        `${SSH_CONFIG.user}@${SSH_CONFIG.host}`,
        `ls -1p "${dirPath}"`
    ];

    const child = spawn('ssh', sshArgs, { timeout: 10000 });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
        if (code !== 0) {
            return res.status(500).json({ error: stderr.trim() || `ls failed with code ${code}` });
        }
        const entries = stdout.trim().split('\n').filter(Boolean);
        res.json({ dir: dirPath, entries });
    });

    child.on('error', (err) => {
        res.status(500).json({ error: `SSH failed: ${err.message}` });
    });
});

app.listen(PORT, () => {
    console.log(`MSA Viewer BLAST Server running on http://localhost:${PORT}`);
    loadDbCache();
});
