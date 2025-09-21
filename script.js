// STATE OBJECT
const state = {
  seqs: [],
  selectedRows: new Set(),
  selectedColumns: new Set(),
  selectedNucs: new Map(),
  pendingNucStart: null,
  lastSelectedIndex: null,
  consensusSeq: '',
  deletedHistory: [],
  currentFilename: '',
  searchHistory: [],
  isDragging: false,
  dragStartRow: null,
  dragStartCol: null,
  dragMode: null,
  ctrlPressed: false,
  altPressed: false,
  lastAction: null,
  draggingGroup: null,
  slideDragStartX: null,
  slideDragStartPos: null,
  slideSeqIndex: null
};
// DOM ELEMENTS
const el = id => document.getElementById(id);
const dropZone = el('dropZone');
const fastaInput = el('fastaInput');
const alignmentContainer = el('alignmentContainer');
const tooltip = el('tooltip');
const statusMessage = el('statusMessage');
const minimizeBar = el('minimizeBar');
const infoModal = el('infoModal');
// UTILITY FUNCTIONS
function showMessage(msg, duration = 2000) {
    statusMessage.textContent = msg;
    statusMessage.style.display = 'block';
    setTimeout(() => { statusMessage.style.display = 'none'; }, duration);
}

function updateSliderBackground(slider) {
    const value = (slider.value - slider.min) / (slider.max - slider.min) * 100;
    slider.style.setProperty('--slider-value', value + '%');
}

function updateNameLengthSliderRange() {
    if (state.seqs.length === 0) return;
    
    // Find the maximum name length in the current alignment
    // Check both header (display name) and fullHeader (complete name) to get the true maximum
    const maxNameLength = Math.max(...state.seqs.map(s => Math.max(s.header.length, s.fullHeader ? s.fullHeader.length : s.header.length)));
    
    const slider = el('nameLengthSlider');
    const input = el('nameLengthInput');
    
    if (slider && input) {
        // Set range from 3 to maximum name length + 2 buffer (with minimum of 12 for reasonable display)
        // The +2 buffer ensures that when slider is set to max name length, the full name is visible
        const newMax = Math.max(maxNameLength + 2, 12);
        
        // Update slider attributes
        slider.min = 3;
        slider.max = newMax;
        
        // Update input attributes
        input.min = 3;
        input.max = newMax;
        
        // If current value exceeds new max, adjust it
        if (parseInt(slider.value) > newMax) {
            slider.value = newMax;
            input.value = newMax;
        }
        
        // If current value is below new min, adjust it
        if (parseInt(slider.value) < 3) {
            slider.value = 3;
            input.value = 3;
        }
        
        // Update slider background
        updateSliderBackground(slider);
        
        // Update title to reflect new range
        slider.title = `Adjust sequence name display length (3-${newMax} characters)`;
        
        console.log(`Updated name length slider range: 3-${newMax} (max name length: ${maxNameLength})`);
        console.log('Sample names:', state.seqs.slice(0, 3).map(s => `"${s.header}" (${s.header.length}) / "${s.fullHeader}" (${s.fullHeader ? s.fullHeader.length : 'N/A'})`));
    }
}

// Helper function to set up slider/input pairs
function setupSliderInputPair(sliderId, inputId, callback = null) {
    const slider = el(sliderId);
    const input = el(inputId);
    
    if (!slider || !input) {
        return; // Skip if elements don't exist
    }
    
    slider.addEventListener('input', () => {
        input.value = slider.value;
        if (callback) callback();
        updateSliderBackground(slider);
        if (sliderId.includes('Slider') && (sliderId.includes('black') || sliderId.includes('dark') || sliderId.includes('light'))) {
            validateThresholds();
        }
    });
    
    input.addEventListener('input', () => {
        slider.value = input.value;
        if (callback) callback();
        updateSliderBackground(slider);
        if (inputId.includes('Input') && (inputId.includes('black') || inputId.includes('dark') || inputId.includes('light'))) {
            validateThresholds();
        }
    });
}

function toggleStickyNames() {
    const sticky = el('stickyNames').checked;
    document.querySelectorAll('.seq-name').forEach(name => {
        name.classList.toggle('static', !sticky);
    });
    alignmentContainer.offsetHeight; // Force reflow
}
function calculateGaplessPositions(sequence) {
    const positions = [];
    let gaplessCount = 0;
    for (let i = 0; i < sequence.length; i++) {
        const char = sequence[i];
        if (char !== '-' && char !== '.') {
            gaplessCount++;
        }
        positions.push(gaplessCount);
    }
    return positions;
}
function reverseComplement(seq) {
    const complement = { 'A':'T','T':'A','C':'G','G':'C','N':'N','-':'-','.':'.', 'U':'A','R':'Y','Y':'R','M':'K','K':'M','S':'S','W':'W','H':'D','B':'V','V':'B','D':'H' };
    return seq.split('').reverse().map(b => complement[b] || 'N').join('');
}
// PARSING FUNCTIONS
function parseFasta(text) {
    const lines = text.trim().split(/\r?\n/);
    const seqs = [];
    let seq = '', header = '';
    try {
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            if (line.startsWith('>')) {
                if (seq) {
                    const cleanHeader = header.replace(/^>/, '').trim();
                    const displayHeader = cleanHeader.split(' ')[0] || 'unnamed';
                    let processedSeq = seq.toUpperCase().replace(/[^ACGTUNRYMKSWHBVD\.\-]/g, 'N');
                    processedSeq = processedSeq.replace(/\./g, '-');
                    const gaplessPositions = calculateGaplessPositions(processedSeq);
                    seqs.push({ header: displayHeader, fullHeader: cleanHeader, seq: processedSeq, gaplessPositions: gaplessPositions });
                    seq = '';
                }
                header = line;
            } else {
                seq += line.replace(/[^A-Za-z\.\-]/g, '');
            }
        }
        if (header && seq) {
            const cleanHeader = header.replace(/^>/, '').trim();
            const displayHeader = cleanHeader.split(' ')[0] || 'unnamed';
            let processedSeq = seq.toUpperCase().replace(/[^ACGTUNRYMKSWHBVD\.\-]/g, 'N');
            processedSeq = processedSeq.replace(/\./g, '-');
            const gaplessPositions = calculateGaplessPositions(processedSeq);
            seqs.push({ header: displayHeader, fullHeader: cleanHeader, seq: processedSeq, gaplessPositions: gaplessPositions });
        }
    } catch (err) {
        console.error('Error in parseFasta:', err);
        return null;
    }
    return seqs.length ? seqs : null;
}
function parseMsf(text) {
    const lines = text.trim().split(/\r?\n/);
    let i = 0;
    let isNucleic = true;
    let maxLen = 0;
    const seqMap = {};
    let names = [];
    // Find MSF header line
    const headerIndex = lines.findIndex(l => l.includes('MSF:') && l.includes('Check:'));
    if (headerIndex !== -1) {
        i = headerIndex;
        const headerLine = lines[headerIndex].trim();
        if (headerLine.includes('Type: P')) {
            isNucleic = false;
        } else if (headerLine.includes('Type: N')) {
            isNucleic = true;
        }
        i += 1; // Start after header
    } else {
        i = 0;
    }
    // Collect names from Name: lines before //
    while (i < lines.length) {
        let line = lines[i].trim();
        if (line === '//') {
            i += 1;
            break;
        }
        if (line.startsWith('Name:')) {
            const parts = line.split(/\s+/);
            let name = '';
            let j = 1; // after 'Name:'
            while (j < parts.length && !parts[j].startsWith('Len:')) {
                name += (name ? ' ' : '') + parts[j];
                j++;
            }
            if (name) {
                names.push(name);
            }
        }
        i += 1;
    }
    // Parse alignment blocks
    while (i < lines.length) {
        let line = lines[i].trim();
        if (!line) {
            i += 1;
            continue;
        }
        // Skip position lines like "1 50"
        if (/^\d+\s+\d+$/.test(line)) {
            i += 1;
            continue;
        }
        let foundName = null;
        for (let n of names) {
            if (line.startsWith(n)) {
                foundName = n;
                let seqPart = line.substring(n.length).trim();
                let blockSeq = seqPart.replace(/\s+/g, '').replace(/~/g, '-');
                if (!seqMap[foundName]) {
                    seqMap[foundName] = { header: foundName, fullHeader: foundName, seq: '' };
                }
                const seqObj = seqMap[foundName];
                seqObj.seq += blockSeq;
                if (seqObj.seq.length > maxLen) maxLen = seqObj.seq.length;
                break;
            }
        }
        i += 1;
    }
    const seqs = [];
    for (let name of names) {
        if (seqMap[name]) {
            let seqObj = seqMap[name];
            let processedSeq;
            if (isNucleic) {
                processedSeq = seqObj.seq.toUpperCase().replace(/[^ACGTUNRYMKSWHBVD\.\-]/g, 'N');
            } else {
                processedSeq = seqObj.seq.toUpperCase().replace(/[^A-Z\.\-]/g, 'X');
            }
            processedSeq = processedSeq.replace(/\./g, '-');
            while (processedSeq.length < maxLen) {
                processedSeq += '-';
            }
            const gaplessPositions = calculateGaplessPositions(processedSeq);
            const displayHeader = name.split(' ')[0] || 'unnamed';
            seqs.push({ header: displayHeader, fullHeader: name, seq: processedSeq, gaplessPositions: gaplessPositions });
        }
    }
    return seqs.length ? seqs : null;
}
// VALIDATION FUNCTIONS
function validateThresholds() {
    const b = parseInt(el('blackSlider').value);
    const d = parseInt(el('darkSlider').value);
    const l = parseInt(el('lightSlider').value);
    if (b < d) {
        el('darkSlider').value = el('darkInput').value = b;
        showMessage("Dark threshold adjusted to match Black threshold", 3000);
    }
    if (d < l) {
        el('lightSlider').value = el('lightInput').value = d;
        showMessage("Light threshold adjusted to match Dark threshold", 3000);
    }
    ['blackSlider', 'darkSlider', 'lightSlider'].forEach(id => updateSliderBackground(el(id)));
}
// RENDERING FUNCTIONS
function renderAlignment() {
    if (!state.seqs || state.seqs.length === 0) {
        alignmentContainer.innerHTML = '<div style="padding:20px; color:#666; font-style:italic;">No sequences loaded. Paste FASTA/MSF and click Load.</div>';
        return;
    }
    alignmentContainer.innerHTML = '';
    const nameLengthSlider = el('nameLengthSlider');
    const nameLengthInput = el('nameLengthInput');
    const maxNameLen = Math.max(...state.seqs.map(s => s.header.length), 5);
    nameLengthSlider.max = maxNameLen;
    nameLengthInput.max = maxNameLen;
    nameLengthSlider.value = Math.min(parseInt(nameLengthSlider.value), maxNameLen);
    nameLengthInput.value = nameLengthSlider.value;
    const nameLen = parseInt(nameLengthSlider.value);
    document.documentElement.style.setProperty('--nameLen', nameLen);
    const useBlocks = el('modeBlocks').checked;
    const blockWidth = parseInt(el('blockSizeSlider').value);
    const len = Math.max(...state.seqs.map(s => s.seq.length));
    const blackThresh = parseInt(el('blackSlider').value) / 100;
    const darkThresh = parseInt(el('darkSlider').value) / 100;
    const lightThresh = parseInt(el('lightSlider').value) / 100;
    const enableBlack = el('enableBlack').checked;
    const enableDark = el('enableDark').checked;
    const enableLight = el('enableLight').checked;
    const stickyNames = el('stickyNames').checked;
    const standard = new Set(['A', 'C', 'G', 'T', 'U', 'N', '-', '.']);
    const ambiguous = new Set(['R','Y','M','K','S','W','H','B','V','D']);
    const ambiguousMap = {
        'A,G': 'R', 'G,A': 'R', 'C,T': 'Y', 'T,C': 'Y', 'A,C': 'M', 'C,A': 'M',
        'G,T': 'K', 'T,G': 'K', 'C,G': 'S', 'G,C': 'S', 'A,T': 'W', 'T,A': 'W',
        'A,C,T': 'H', 'A,T,C': 'H', 'C,A,T': 'H', 'C,T,A': 'H', 'T,A,C': 'H', 'T,C,A': 'H',
        'G,C,T': 'B', 'G,T,C': 'B', 'C,G,T': 'B', 'C,T,G': 'B', 'T,G,C': 'B', 'T,C,G': 'B',
        'A,G,T': 'D', 'A,T,G': 'D', 'G,A,T': 'D', 'G,T,A': 'D', 'T,A,G': 'D', 'T,G,A': 'D',
        'A,C,G': 'V', 'A,G,C': 'V', 'C,A,G': 'V', 'C,G,A': 'V', 'G,A,C': 'V', 'G,C,A': 'V'
    };
    const showConsensus = el('showConsensus').checked;
    const consType = document.querySelector('input[name="consensusType"]:checked').value;
    const threshold = parseInt(el('consensusThreshold').value) / 100;
    let consensus = [];
    if (showConsensus) {
        for (let pos = 0; pos < len; pos++) {
            const col = state.seqs.map(s => s.seq[pos] || '-');
            const nonGapCol = col.filter(b => b !== '-' && b !== '.');
            if (nonGapCol.length === 0) {
                consensus.push('-');
                continue;
            }
            const counts = {};
            nonGapCol.forEach(b => counts[b] = (counts[b] || 0) + 1);
            const maxCount = Math.max(...Object.values(counts));
            const maxBases = Object.keys(counts).filter(b => counts[b] === maxCount);
            const freq = maxCount / col.length;
            if (freq < threshold) {
                consensus.push('-');
                continue;
            }
            if (consType === 'ambiguous') {
                if (maxBases.length > 1) {
                    const standardBases = maxBases.filter(b => ['A', 'C', 'G', 'T'].includes(b));
                    if (standardBases.length >= 2) {
                        const key = standardBases.sort().join(',');
                        consensus.push(ambiguousMap[key] || '-');
                    } else if (maxBases.length === 1) {
                        consensus.push(maxBases[0]);
                    } else {
                        consensus.push('-');
                    }
                } else {
                    consensus.push(maxBases[0]);
                }
            } else {
                if (maxBases.length === 1 && !ambiguous.has(maxBases[0])) {
                    consensus.push(maxBases[0]);
                } else {
                    const normalBases = ['A', 'C', 'G', 'T'].filter(b => counts[b]);
                    if (normalBases.length > 0) {
                        const maxNormalCount = Math.max(...normalBases.map(b => counts[b] || 0));
                        const maxNormalBases = normalBases.filter(b => (counts[b] || 0) === maxNormalCount);
                        consensus.push(maxNormalBases[0]);
                    } else {
                        consensus.push('-');
                    }
                }
            }
        }
    }
    state.consensusSeq = consensus.join('').replace(/-/g, '');
    const consensusPosition = document.querySelector('input[name="consensusPosition"]:checked')?.value || 'bottom';
    if (useBlocks) {
        for (let start = 0; start < len; start += blockWidth) {
            const end = Math.min(start + blockWidth, len);
            const blockDiv = document.createElement('div');
            blockDiv.className = 'block-block';
            const sep = document.createElement('div');
            sep.className = 'block-sep';
            sep.textContent = `--- ${start + 1}-${end} ---`;
            blockDiv.appendChild(sep);
            if (showConsensus && consensusPosition === 'top') {
                addConsensusLine(blockDiv, consensus, start, end, nameLen, stickyNames);
            }
            for (let i = 0; i < state.seqs.length; i++) {
                const lineDiv = createSequenceLine(i, start, end, nameLen, stickyNames, standard, ambiguous, blackThresh, darkThresh, lightThresh, enableBlack, enableDark, enableLight);
                blockDiv.appendChild(lineDiv);
            }
            if (showConsensus && consensusPosition === 'bottom') {
                addConsensusLine(blockDiv, consensus, start, end, nameLen, stickyNames);
            }
            alignmentContainer.appendChild(blockDiv);
        }
    } else {
        if (showConsensus && consensusPosition === 'top') {
            addConsensusLine(alignmentContainer, consensus, 0, len, nameLen, stickyNames);
        }
        for (let i = 0; i < state.seqs.length; i++) {
            const lineDiv = createSequenceLine(i, 0, len, nameLen, stickyNames, standard, ambiguous, blackThresh, darkThresh, lightThresh, enableBlack, enableDark, enableLight);
            alignmentContainer.appendChild(lineDiv);
        }
        if (showConsensus && consensusPosition === 'bottom') {
            addConsensusLine(alignmentContainer, consensus, 0, len, nameLen, stickyNames);
        }
    }
    setTimeout(() => toggleStickyNames(), 0);
    ['blackSlider', 'darkSlider', 'lightSlider', 'nameLengthSlider', 'zoomSlider', 'blockSizeSlider', 'consensusThreshold', 'groupConsensusThreshold'].forEach(id => {
        updateSliderBackground(el(id));
    });
    updateRowSelections();
    updateColumnSelections();
    // Re-attach drag listeners for sliding
    document.querySelectorAll('.seq-data').forEach(dataSpan => {
        dataSpan.addEventListener('mousedown', handleSlideStart);
    });
}
function createSequenceLine(index, start, end, nameLen, stickyNames, standard, ambiguous, blackThresh, darkThresh, lightThresh, enableBlack, enableDark, enableLight) {
    const lineDiv = document.createElement('div');
    lineDiv.className = 'seq-line';
    lineDiv.dataset.seqIndex = index;
    const nameSpan = document.createElement('div');
    nameSpan.className = `seq-name ${stickyNames ? '' : 'static'}`;
    nameSpan.title = state.seqs[index].fullHeader;
    let displayName = state.seqs[index].header.substring(0, nameLen);
    let isTruncated = state.seqs[index].header.length > nameLen;
    nameSpan.textContent = displayName;
    if (isTruncated) {
        nameSpan.textContent += '…';
        // Remove faded color, keep normal color
        nameSpan.style.color = '';
        nameSpan.title = state.seqs[index].header; // show full name on hover
    }
    nameSpan.draggable = true;
    nameSpan.addEventListener('dragstart', handleDragStart);
    nameSpan.addEventListener('dragend', handleDragEnd);
    // 👇 CLICK NAME → COPY NAME (no selection toggle)
    nameSpan.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) return; // let mousedown handle selection
        navigator.clipboard.writeText(state.seqs[index].header).then(() => {
            showMessage(`Copied: ${state.seqs[index].header}`, 1500);
        }).catch(err => {
            console.error('Copy failed:', err);
            showMessage("Failed to copy name.", 2000);
        });
        e.preventDefault();
    });
    nameSpan.addEventListener('dblclick', () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = state.seqs[index].header;
        input.style.width = `${nameSpan.offsetWidth}px`;
        input.style.fontSize = getComputedStyle(nameSpan).fontSize;
        input.style.fontFamily = getComputedStyle(nameSpan).fontFamily;
        input.style.padding = '0';
        input.style.border = '1px solid #ccc';
        nameSpan.innerHTML = '';
        nameSpan.appendChild(input);
        input.focus();
        input.select();
        const save = () => {
            const newName = input.value.trim();
            if (newName && newName !== state.seqs[index].header) {
                state.deletedHistory.push({ type: 'rename', seqs: JSON.parse(JSON.stringify(state.seqs)), selectedRows: new Set(state.selectedRows), selectedColumns: new Set(state.selectedColumns) });
                state.seqs[index].header = newName;
                state.seqs[index].fullHeader = newName;
                renderAlignment();
                showMessage("Sequence renamed!", 2000);
            } else {
                renderAlignment();
            }
        };
        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                save();
            } else if (e.key === 'Escape') {
                renderAlignment();
            }
        });
        // Add outside click handler for faster exit
        const handleOutsideClick = (ev) => {
            if (!nameSpan.contains(ev.target)) {
                save();
                document.removeEventListener('click', handleOutsideClick);
            }
        };
        setTimeout(() => document.addEventListener('click', handleOutsideClick), 0);
    });
    lineDiv.addEventListener('dragover', (e) => e.preventDefault());
    lineDiv.addEventListener('drop', handleDrop);
    lineDiv.appendChild(nameSpan);
    const dataSpan = document.createElement('div');
    dataSpan.className = 'seq-data';
    // 👇 NO ACTION on plain click — only Ctrl+Click for selection
    dataSpan.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) return; // handled by mousedown
        // 👉 Do nothing on single click — no copy, no selection
    });
    for (let pos = start; pos < end; pos++) {
        const base = state.seqs[index].seq[pos] || '-';
        const gaplessPos = state.seqs[index].gaplessPositions[pos];
        let cls = 'other';
        let baseClass = '';
        if (!standard.has(base) && !ambiguous.has(base)) {
            baseClass = 'artifact';
        } else if (ambiguous.has(base)) {
            baseClass = 'ambiguous';
        }
        const col = state.seqs.map(s => s.seq[pos] || '-');
        const nonGapCol = col.filter(b => b !== '-' && b !== '.');
        if (nonGapCol.length > 0) {
            const counts = {};
            nonGapCol.forEach(b => counts[b] = (counts[b] || 0) + 1);
            const maxCount = Math.max(...Object.values(counts), 0);
            const consensusBases = new Set(Object.keys(counts).filter(b => counts[b] === maxCount));
            const denominator = document.querySelector('input[name="shadeMode"]:checked').value === 'all' ? state.seqs.length : nonGapCol.length;
            const conservation = maxCount / denominator;
            if (base !== '-' && base !== '.' && consensusBases.has(base)) {
                if (enableBlack && conservation >= blackThresh) cls = 'black';
                else if (enableDark && conservation >= darkThresh) cls = 'dark';
                else if (enableLight && conservation >= lightThresh) cls = 'light';
            } else if (base === '-' || base === '.') {
                cls = 'gap';
            }
        } else {
            cls = 'gap';
        }
        const newClass = `${cls} ${baseClass}`.trim();
        const span = document.createElement('span');
        span.className = newClass;
        span.textContent = base;
        span.dataset.pos = pos;
        if (state.selectedNucs.get(index)?.has(pos)) {
            span.classList.add('nuc-selected');
            span.addEventListener('mouseover', (e) => {
                tooltip.style.display = 'block';
                tooltip.textContent = `Copy`;
                tooltip.style.left = (e.pageX + 10) + 'px';
                tooltip.style.top = (e.pageY - 20) + 'px';
            });
            span.addEventListener('mouseout', () => {
                tooltip.style.display = 'none';
            });
            span.addEventListener('click', (e) => {
                e.stopPropagation();
                copySelected();
            });
        } else if (state.pendingNucStart && state.pendingNucStart.row === index && state.pendingNucStart.pos === pos) {
            span.classList.add('nuc-pending');
            span.addEventListener('mouseover', (e) => {
                tooltip.style.display = 'block';
                tooltip.textContent = `Selection start - Ctrl+click another nucleotide to complete range`;
                tooltip.style.left = (e.pageX + 10) + 'px';
                tooltip.style.top = (e.pageY - 20) + 'px';
            });
            span.addEventListener('mouseout', () => {
                tooltip.style.display = 'none';
            });
        }
        if (base !== '-' && base !== '.') {
            const currentGaplessPos = gaplessPos;
            span.addEventListener('mouseover', (e) => {
                tooltip.style.display = 'block';
                tooltip.textContent = `${state.seqs[index].header}: ${currentGaplessPos}`;
                tooltip.style.left = (e.pageX + 10) + 'px';
                tooltip.style.top = (e.pageY - 20) + 'px';
            });
            span.addEventListener('mouseout', () => {
                tooltip.style.display = 'none';
            });
        } else {
            span.title = 'Gap';
        }
        if (state.selectedColumns.has(pos)) {
            span.classList.add('column-selected');
        }
        dataSpan.appendChild(span);
    }
    lineDiv.appendChild(dataSpan);
    if (state.selectedRows.has(index)) {
        lineDiv.classList.add('selected');
    }
    return lineDiv;
}
function addConsensusLine(parent, consensus, start, end, nameLen, stickyNames) {
    const consLine = document.createElement('div');
    consLine.className = 'seq-line consensus-line';
    const consName = document.createElement('div');
    consName.className = `seq-name ${stickyNames ? '' : 'static'}`;
    consName.textContent = 'Consensus';
    consLine.appendChild(consName);
    const dataSpan = document.createElement('div');
    dataSpan.className = 'seq-data';
    for (let pos = start; pos < end; pos++) {
        const base = pos < consensus.length ? consensus[pos] : '-';
        let baseClass = '';
        if (!['A','C','G','T','U','N','-','.'].includes(base)) baseClass = 'artifact';
        else if (['R','Y','M','K','S','W','H','B','V','D'].includes(base)) baseClass = 'ambiguous';
        const span = document.createElement('span');
        span.className = baseClass;
        span.textContent = base;
        dataSpan.appendChild(span);
    }
    consLine.appendChild(dataSpan);
    parent.appendChild(consLine);
}
function setZoom(percent) {
    const size = (percent / 100) * 13;
    alignmentContainer.style.fontSize = size + 'px';
    el('zoomVal').textContent = percent + '%';
    updateSliderBackground(el('zoomSlider'));
}
function adjustZoom(delta) {
    const slider = el('zoomSlider');
    let value = parseInt(slider.value) + delta;
    value = Math.max(parseInt(slider.min), Math.min(parseInt(slider.max), value));
    slider.value = value;
    setZoom(value);
}
function debounce(func, delay) {
    let timer;
    return () => {
        clearTimeout(timer);
        timer = setTimeout(func, delay);
    };
}
const debounceRender = debounce(renderAlignment, 50);
// CORE FUNCTIONS
function parseAndRender(isFromDrop = false) {
    showMessage("Parsing file...", 0);
    const inputText = fastaInput.value.trim();
    console.log("parseAndRender called. isFromDrop:", isFromDrop, "input length:", inputText.length);
    if (!inputText) {
        alignmentContainer.innerHTML = '<div>Paste MSF or FASTA into the box and click Load, or drop a file.</div>';
        statusMessage.style.display = 'none';
        console.log("No input text found.");
        return;
    }
    try {
        let parsed;
        // 👇 PRIORITIZE CONTENT-BASED DETECTION. Ignore filename for pasted data.
        const isMsfContent = (inputText.includes('MSF:') && inputText.includes('Check:')) ||
                             inputText.includes('!!AA_MULTIPLE_ALIGNMENT') ||
                             inputText.includes('!!NA_MULTIPLE_ALIGNMENT');
        if (isFromDrop || isMsfContent) {
            // If it's a file drop OR the content looks like MSF, try MSF first.
            parsed = parseMsf(inputText);
            if (!parsed) {
                showMessage("MSF parsing failed, trying FASTA...", 2000);
                parsed = parseFasta(inputText);
            }
        } else {
            // Otherwise, assume FASTA.
            parsed = parseFasta(inputText);
        }
        if (!parsed) throw new Error("No valid sequences found");
        // 👇 MOVE THIS LINE UP: Set filename BEFORE any parsing that might fail.
        if (!isFromDrop) {
            state.currentFilename = 'Clipboard';
        }
        state.seqs = parsed;
        state.selectedRows.clear();
        state.selectedColumns.clear();
        state.selectedNucs.clear();
        state.pendingNucStart = null;
        state.lastSelectedIndex = null;
        
        // Update name length slider range based on loaded sequences
        updateNameLengthSliderRange();
        
        el('filenameInfo').textContent = `Source: ${state.currentFilename}`;
        renderAlignment();
        showMessage("File loaded successfully!", 2000);
    } catch (e) {
        console.error("Error in parseAndRender:", e);
        alignmentContainer.innerHTML = `<div class="error-message">❌ ${e.message}</div>`;
        showMessage(`Error: ${e.message}`, 5000);
        // 👇 Reset filename on error to avoid poisoning future loads
        state.currentFilename = '';
    }
}
function onModeChange() {
    const container = el('blockSizeContainer');
    if (container) {
        container.style.display = el('modeBlocks').checked ? 'flex' : 'none';
    }
    renderAlignment();
}
function onShadeModeChange() {
    validateThresholds();
    debounceRender();
}
// DRAG AND DROP HANDLERS
function handleDragStart(e) {
    const row = e.target.closest('.seq-line');
    if (row.classList.contains('consensus-line')) return;
    const index = parseInt(row.dataset.seqIndex);
    if (state.selectedRows.has(index)) {
        state.draggingGroup = Array.from(state.selectedRows).sort((a, b) => a - b);
    } else {
        e.preventDefault();
        return;
    }
    e.dataTransfer.setData('text/plain', '');
    e.dataTransfer.effectAllowed = 'move';
}
function handleDragEnd(e) {
    state.draggingGroup = null;
}
function handleDrop(e) {
    e.preventDefault();
    if (!state.draggingGroup) return;
    const targetRow = e.target.closest('.seq-line');
    if (!targetRow || targetRow.classList.contains('consensus-line')) return;
    const targetIndex = parseInt(targetRow.dataset.seqIndex);
    const rect = targetRow.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const insertAfter = y > rect.height / 2;
    const groupIndices = state.draggingGroup;
    if (groupIndices.includes(targetIndex)) return;
    state.deletedHistory.push({ type: 'order', seqs: JSON.parse(JSON.stringify(state.seqs)), selectedRows: new Set(state.selectedRows), selectedColumns: new Set(state.selectedColumns) });
    const newSeqs = [...state.seqs];
    const group = groupIndices.map(i => newSeqs[i]);
    for (let j = groupIndices.length - 1; j >= 0; j--) {
        newSeqs.splice(groupIndices[j], 1);
    }
    let insertPos = targetIndex - groupIndices.filter(i => i < targetIndex).length;
    if (insertAfter) insertPos += 1;
    newSeqs.splice(insertPos, 0, ...group);
    state.seqs = newSeqs;
    state.selectedRows.clear();
    for (let k = 0; k < group.length; k++) {
        state.selectedRows.add(insertPos + k);
    }
    state.draggingGroup = null;
    renderAlignment();
    showMessage("Sequences reordered!", 2000);
}
// EVENT HANDLERS
function handleMouseDown(e) {
    if (e.button !== 0) return;
    const row = e.target.closest('.seq-line');
    if (!row || row.classList.contains('consensus-line')) return;
    const index = parseInt(row.dataset.seqIndex);
    const name = e.target.closest('.seq-name');
    const span = e.target.closest('.seq-data span');
    if (name) {
        if (e.ctrlKey || e.metaKey) {
            state.isDragging = true;
            state.dragStartRow = index;
            state.dragMode = 'row';
            if (state.selectedRows.has(index)) {
                state.selectedRows.delete(index);
            } else {
                state.selectedRows.add(index);
            }
            state.lastSelectedIndex = index;
            updateRowSelections();
            e.preventDefault();
        } else if (e.shiftKey && state.lastSelectedIndex !== null) {
            const start = Math.min(state.lastSelectedIndex, index);
            const end = Math.max(state.lastSelectedIndex, index);
            for (let i = start; i <= end; i++) {
                state.selectedRows.add(i);
            }
            updateRowSelections();
            e.preventDefault();
        }
        // 👉 No else clause — click without Ctrl/Shift copies name (handled in nameSpan.click)
    } else if (span && (e.ctrlKey || e.metaKey) && !e.altKey) {
        const pos = parseInt(span.dataset.pos);
        if (isNaN(pos)) return;
        
        // Check if this is a simple click (not a drag)
        // We'll determine this in mouseup - for now, prepare for both possibilities
        
        // Two-click system: Check if we have a pending start
        if (state.pendingNucStart === null) {
            // First click - set pending start and also prepare for potential drag
            state.selectedNucs.clear();
            state.pendingNucStart = {row: index, pos: pos};
            
            // Also set up drag state in case user drags
            state.isDragging = true;
            state.dragStartRow = index;
            state.dragStartCol = pos;
            state.dragMode = 'nuc';
            
            // Set initial selection to just this nucleotide
            let rowSet = new Set();
            rowSet.add(pos);
            state.selectedNucs.set(index, rowSet);
            
            debounceRender();
        } else if (state.pendingNucStart.row === index) {
            // Second click on same row - complete the two-click selection
            const startPos = Math.min(state.pendingNucStart.pos, pos);
            const endPos = Math.max(state.pendingNucStart.pos, pos);
            let rowSet = new Set();
            for (let p = startPos; p <= endPos; p++) {
                rowSet.add(p);
            }
            state.selectedNucs.set(index, rowSet);
            state.pendingNucStart = null;
            debounceRender();
        } else {
            // Click on different row - clear pending and start fresh
            state.selectedNucs.clear();
            state.pendingNucStart = {row: index, pos: pos};
            
            // Also set up drag state
            state.isDragging = true;
            state.dragStartRow = index;
            state.dragStartCol = pos;
            state.dragMode = 'nuc';
            
            let rowSet = new Set();
            rowSet.add(pos);
            state.selectedNucs.set(index, rowSet);
            
            debounceRender();
        }
        
        e.preventDefault();
    } else if (span && (e.ctrlKey || e.metaKey) && e.altKey) {
        const pos = parseInt(span.dataset.pos);
        if (isNaN(pos)) return;
        state.isDragging = true;
        state.dragStartCol = pos;
        state.dragMode = 'col';
        if (state.selectedColumns.has(pos)) {
            state.selectedColumns.delete(pos);
        } else {
            state.selectedColumns.add(pos);
        }
        updateColumnSelections();
        e.preventDefault();
    }
    // 👉 No handler for plain click on span — do nothing
}
function handleMouseMove(e) {
    if (!state.isDragging) return;
    if (state.dragMode === 'row') {
        const row = e.target.closest('.seq-line');
        if (row) {
            const index = parseInt(row.dataset.seqIndex);
            if (index !== undefined) {
                const start = Math.min(state.dragStartRow, index);
                const end = Math.max(state.dragStartRow, index);
                for (let i = start; i <= end; i++) {
                    state.selectedRows.add(i);
                }
                updateRowSelections();
            }
        }
    } else if (state.dragMode === 'col') {
        const span = e.target.closest('.seq-data span');
        if (span) {
            const pos = parseInt(span.dataset.pos);
            if (isNaN(pos)) return;
            const start = Math.min(state.dragStartCol, pos);
            const end = Math.max(state.dragStartCol, pos);
            for (let p = start; p <= end; p++) {
                state.selectedColumns.add(p);
            }
            updateColumnSelections();
        }
    } else if (state.dragMode === 'nuc') {
        const span = e.target.closest('.seq-data span');
        if (span) {
            const pos = parseInt(span.dataset.pos);
            if (isNaN(pos)) return;
            const currentIndex = parseInt(span.closest('.seq-line').dataset.seqIndex);
            // Only allow drag within the same row
            if (currentIndex === state.dragStartRow) {
                const startPos = Math.min(state.dragStartCol, pos);
                const endPos = Math.max(state.dragStartCol, pos);
                
                // Clear existing selection and create new range
                state.selectedNucs.clear();
                let rowSet = new Set();
                for (let p = startPos; p <= endPos; p++) {
                    rowSet.add(p);
                }
                state.selectedNucs.set(currentIndex, rowSet);
                debounceRender();
            }
        }
    }
    e.preventDefault();
}
function handleMouseUp() {
    if (state.dragMode === 'nuc') {
        // If we have a pending start, this was either a simple click or a drag
        // The drag selection is already handled in mousemove
        // For simple clicks, keep the pending start for the two-click system
    }
    state.isDragging = false;
    state.dragStartRow = null;
    state.dragStartCol = null;
    state.dragMode = null;
}
function handleKeyDown(e) {
    if (e.ctrlKey || e.metaKey) {
        state.ctrlPressed = true;
    }
    if (e.altKey) {
        state.altPressed = true;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        copySelected();
        e.preventDefault();
    }
    if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
            case 'r':
                reverseComplementSelected();
                e.preventDefault();
                break;
            case 'del':
                deleteSelected();
                e.preventDefault();
                break;
            case 'z':
                undoDelete();
                e.preventDefault();
                break;
            case 'b':
                insertGroupConsensus();
                e.preventDefault();
                break;
            case 'u':
                duplicateSelected();
                e.preventDefault();
                break;
            case 't':
                openSelectedInNewTab();
                e.preventDefault();
                break;
            case 'a':
                selectAllSequences();
                e.preventDefault();
                break;
            case 's':
                if (e.shiftKey) {
                    savePreset();
                    e.preventDefault();
                }
                break;
            case 'o':
                loadPreset();
                e.preventDefault();
                break;
            case 'i':
                openInfoModal();
                e.preventDefault();
                break;
            case 'h':
                minimizeMenu();
                e.preventDefault();
                break;
            case 'f':
                if (e.shiftKey) {
                    clearLastSearch();
                } else if (e.altKey) {
                    clearAllSearches();
                } else {
                    searchMotif();
                }
                e.preventDefault();
                break;
            case 'k':
                if (e.shiftKey) {
                    copyConsensus();
                }
                e.preventDefault();
                break;
            case 'j':
                if (e.shiftKey) {
                    copySelectedConsensus();
                }
                e.preventDefault();
                break;
            case 'v':
                if (e.shiftKey) {
                    copySelectedColumns();
                }
                e.preventDefault();
                break;
            case 'd':
                if (e.shiftKey) {
                    deleteSelectedColumns();
                }
                e.preventDefault();
                break;
            case '+':
                adjustZoom(10);
                e.preventDefault();
                break;
            case '-':
                adjustZoom(-10);
                e.preventDefault();
                break;
        }
    }
    if (e.ctrlKey || e.metaKey) {
        if (e.key === 'ArrowUp') {
            moveSelectedUp();
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            moveSelectedDown();
            e.preventDefault();
        } else if (e.key === 'Home') {
            moveSelectedToTop();
            e.preventDefault();
        } else if (e.key === 'End') {
            moveSelectedToBottom();
            e.preventDefault();
        }
    }
}
function handleKeyUp(e) {
    if (!e.ctrlKey && !e.metaKey) {
        state.ctrlPressed = false;
    }
    if (!e.altKey) {
        state.altPressed = false;
    }
}
// ACTION FUNCTIONS
function reverseComplementSelected() {
    if (state.selectedRows.size === 0) {
        showMessage("Select sequences (Ctrl+click) to RevComp.", 3000);
        return;
    }
    state.deletedHistory.push({
        type: 'revcomp',
        seqs: JSON.parse(JSON.stringify(state.seqs)),
        selectedRows: new Set(state.selectedRows),
        selectedColumns: new Set(state.selectedColumns)
    });
    for (const i of state.selectedRows) {
        if (i < state.seqs.length) {
            state.seqs[i] = {
                ...state.seqs[i],
                seq: reverseComplement(state.seqs[i].seq)
            };
            state.seqs[i].gaplessPositions = calculateGaplessPositions(state.seqs[i].seq);
        }
    }
    state.lastAction = 'revcomp';
    renderAlignment();
    showMessage("Reverse complement applied!", 2000);
}
function deleteSelected() {
    if (state.selectedRows.size === 0) {
        showMessage("No sequences selected for deletion.", 3000);
        return;
    }
    if (state.seqs.length === 1) {
        showMessage("Cannot delete the last sequence.", 3000);
        return;
    }
    if (confirm(`Delete ${state.selectedRows.size} sequence(s)?`)) {
        state.deletedHistory.push({
            type: 'delete',
            seqs: JSON.parse(JSON.stringify(state.seqs)),
            selectedRows: new Set(state.selectedRows),
            selectedColumns: new Set(state.selectedColumns)
        });
        const indicesToDelete = Array.from(state.selectedRows).sort((a,b)=>b-a);
        for (const index of indicesToDelete) {
            if (index < state.seqs.length) {
                state.seqs.splice(index, 1);
            }
        }
        state.selectedRows.clear();
        state.lastSelectedIndex = null;
        state.lastAction = 'delete';
        renderAlignment();
        showMessage("Sequences deleted!", 2000);
    }
}
function undoDelete() {
    if (state.deletedHistory.length === 0) {
        showMessage("Nothing to undo.", 3000);
        return;
    }
    const last = state.deletedHistory.pop();
    state.seqs = last.seqs;
    state.selectedRows = last.selectedRows;
    if (last.selectedColumns) {
        state.selectedColumns = last.selectedColumns;
    }
    state.lastAction = null;
    renderAlignment();
    showMessage("Undo completed!", 2000);
}
function copySelected() {
    let nucText = '';
    for (let [i, posSet] of state.selectedNucs.entries()) {
        if (posSet.size === 0) continue;
        const s = state.seqs[i];
        const poss = Array.from(posSet).sort((a, b) => a - b);
        let start = poss[0], end = poss[0];
        let ranges = [];
        for (let j = 1; j < poss.length; j++) {
            if (poss[j] === end + 1) {
                end = poss[j];
            } else {
                ranges.push([start, end]);
                start = end = poss[j];
            }
        }
        ranges.push([start, end]);
        for (let [st, en] of ranges) {
            const sub = s.seq.slice(st, en + 1);
            nucText += sub + '\n';
        }
    }
    if (nucText) {
        navigator.clipboard.writeText(nucText.trim()).then(() => {
            showMessage("Selected nucleotides copied!", 2000);
        }).catch(err => {
            console.error('Copy failed:', err);
            showMessage("Failed to copy. Check console.", 5000);
        });
        return;
    }
    // 👇 Removed "No sequence selected" message — silent if nothing to copy
    if (state.selectedRows.size === 0) {
        return;
    }
    const fasta = Array.from(state.selectedRows).sort((a,b) => a - b).map(i => {
        const s = state.seqs[i];
        return `>${s.fullHeader || s.header}\n${s.seq}`;
    }).join('\n');
    navigator.clipboard.writeText(fasta).then(() => {
        showMessage("Selected sequences copied as FASTA!", 2000);
    }).catch(err => {
        console.error('Copy failed:', err);
        showMessage("Failed to copy. Check console.", 5000);
    });
}
function copyPlainSingle(index) {
    const s = state.seqs[index];
    navigator.clipboard.writeText(s.seq).then(() => {
        showMessage("Sequence copied as plain text!", 2000);
    }).catch(err => {
        console.error('Copy failed:', err);
        showMessage("Failed to copy. Check console.", 5000);
    });
}
function copyConsensus() {
    if (!state.consensusSeq) {
        showMessage("No consensus available to copy.", 3000);
        return;
    }
    const fasta = `>Consensus\n${state.consensusSeq}`;
    navigator.clipboard.writeText(fasta).then(() => {
        showMessage("Consensus copied as FASTA!", 2000);
    }).catch(err => {
        console.error('Copy failed:', err);
        showMessage("Failed to copy. Check console.", 5000);
    });
}
function copySelectedConsensus() {
    if (state.selectedRows.size < 2) {
        showMessage("Select at least 2 sequences to compute consensus.", 3000);
        return;
    }
    const selectedSeqs = Array.from(state.selectedRows).map(i => state.seqs[i].seq);
    const len = Math.max(...selectedSeqs.map(s => s.length));
    const threshold = parseInt(el('consensusThreshold').value) / 100;
    let cons = '';
    for (let pos = 0; pos < len; pos++) {
        const col = selectedSeqs.map(s => s[pos] || '-').filter(b => b !== '-' && b !== '.');
        if (col.length === 0) continue;
        const counts = {};
        col.forEach(b => counts[b] = (counts[b] || 0) + 1);
        const maxBase = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b, '');
        const freq = counts[maxBase] / col.length;
        if (freq >= threshold) {
            cons += maxBase;
        }
    }
    const fasta = `>Selected_Consensus\n${cons}`;
    navigator.clipboard.writeText(fasta).then(() => {
        showMessage("Selected sequences consensus copied as FASTA!", 2000);
    }).catch(err => {
        console.error('Copy failed:', err);
        showMessage("Failed to copy. Check console.", 5000);
    });
}
function copySelectedColumns() {
    if (state.selectedColumns.size === 0) {
        showMessage("No columns selected to copy.", 3000);
        return;
    }
    const cols = Array.from(state.selectedColumns).sort((a,b) => a - b);
    const fasta = state.seqs.map(s => {
        let seq = '';
        for (const pos of cols) {
            seq += s.seq[pos] || '-';
        }
        return `>${s.fullHeader || s.header}\n${seq}`;
    }).join('\n');
    navigator.clipboard.writeText(fasta).then(() => {
        showMessage("Selected columns copied as FASTA!", 2000);
    }).catch(err => {
        console.error('Copy failed:', err);
        showMessage("Failed to copy.", 5000);
    });
}
function deleteSelectedColumns() {
    if (state.selectedColumns.size === 0) {
        showMessage("No columns selected for deletion.", 3000);
        return;
    }
    if (confirm(`Delete ${state.selectedColumns.size} column(s)?`)) {
        state.deletedHistory.push({
            type: 'deleteColumns',
            seqs: JSON.parse(JSON.stringify(state.seqs)),
            selectedRows: new Set(state.selectedRows),
            selectedColumns: new Set(state.selectedColumns)
        });
        const colsToDelete = Array.from(state.selectedColumns).sort((a,b) => b - a);
        state.seqs = state.seqs.map(s => {
            let seq = s.seq.split('');
            for (const pos of colsToDelete) {
                if (pos < seq.length) seq.splice(pos, 1);
            }
            s.gaplessPositions = calculateGaplessPositions(seq.join(''));
            return { ...s, seq: seq.join('') };
        });
        state.selectedColumns.clear();
        state.lastAction = 'deleteColumns';
        renderAlignment();
        showMessage("Columns deleted!", 2000);
    }
}
function selectAllSequences() {
    if (state.selectedRows.size === state.seqs.length) {
        state.selectedRows.clear();
        showMessage("All sequences deselected.", 2000);
    } else {
        state.selectedRows.clear();
        for (let i = 0; i < state.seqs.length; i++) {
            state.selectedRows.add(i);
        }
        showMessage("All sequences selected.", 2000);
    }
    updateRowSelections();
}
function moveSelectedUp() {
    if (state.selectedRows.size === 0) return;
    state.deletedHistory.push({
        type: 'order',
        seqs: JSON.parse(JSON.stringify(state.seqs)),
        selectedRows: new Set(state.selectedRows),
        selectedColumns: new Set(state.selectedColumns)
    });
    const indices = Array.from(state.selectedRows).sort((a, b) => a - b);
    if (indices[0] === 0) return;
    const newSeqs = [...state.seqs];
    const group = indices.map(i => newSeqs[i]);
    for (let j = indices.length - 1; j >= 0; j--) {
        newSeqs.splice(indices[j], 1);
    }
    const insertPos = indices[0] - 1;
    newSeqs.splice(insertPos, 0, ...group);
    state.seqs = newSeqs;
    state.selectedRows.clear();
    for (let k = 0; k < indices.length; k++) {
        state.selectedRows.add(insertPos + k);
    }
    renderAlignment();
    showMessage("Sequences moved up!", 2000);
}
function moveSelectedDown() {
    if (state.selectedRows.size === 0) return;
    state.deletedHistory.push({
        type: 'order',
        seqs: JSON.parse(JSON.stringify(state.seqs)),
        selectedRows: new Set(state.selectedRows),
        selectedColumns: new Set(state.selectedColumns)
    });
    const indices = Array.from(state.selectedRows).sort((a, b) => a - b);
    if (indices[indices.length - 1] === state.seqs.length - 1) return;
    const newSeqs = [...state.seqs];
    const group = indices.map(i => newSeqs[i]);
    for (let j = indices.length - 1; j >= 0; j--) {
        newSeqs.splice(indices[j], 1);
    }
    const insertPos = indices[indices.length - 1] - indices.length + 2;
    newSeqs.splice(insertPos, 0, ...group);
    state.seqs = newSeqs;
    state.selectedRows.clear();
    for (let k = 0; k < indices.length; k++) {
        state.selectedRows.add(insertPos + k);
    }
    renderAlignment();
    showMessage("Sequences moved down!", 2000);
}
function moveSelectedToTop() {
    if (state.selectedRows.size === 0) return;
    state.deletedHistory.push({
        type: 'order',
        seqs: JSON.parse(JSON.stringify(state.seqs)),
        selectedRows: new Set(state.selectedRows),
        selectedColumns: new Set(state.selectedColumns)
    });
    const indices = Array.from(state.selectedRows).sort((a, b) => a - b);
    const newSeqs = [...state.seqs];
    const group = indices.map(i => newSeqs[i]);
    for (let j = indices.length - 1; j >= 0; j--) {
        newSeqs.splice(indices[j], 1);
    }
    newSeqs.unshift(...group);
    state.seqs = newSeqs;
    state.selectedRows.clear();
    for (let k = 0; k < group.length; k++) {
        state.selectedRows.add(k);
    }
    renderAlignment();
    showMessage("Sequences moved to top!", 2000);
}
function moveSelectedToBottom() {
    if (state.selectedRows.size === 0) return;
    state.deletedHistory.push({
        type: 'order',
        seqs: JSON.parse(JSON.stringify(state.seqs)),
        selectedRows: new Set(state.selectedRows),
        selectedColumns: new Set(state.selectedColumns)
    });
    const indices = Array.from(state.selectedRows).sort((a, b) => a - b);
    const newSeqs = [...state.seqs];
    const group = indices.map(i => newSeqs[i]);
    for (let j = indices.length - 1; j >= 0; j--) {
        newSeqs.splice(indices[j], 1);
    }
    newSeqs.push(...group);
    state.seqs = newSeqs;
    state.selectedRows.clear();
    const newLen = state.seqs.length;
    for (let k = 0; k < group.length; k++) {
        state.selectedRows.add(newLen - group.length + k);
    }
    renderAlignment();
    showMessage("Sequences moved to bottom!", 2000);
}
function insertGroupConsensus() {
    if (state.selectedRows.size < 2) {
        showMessage("Select at least 2 sequences to compute group consensus.", 3000);
        return;
    }
    const indices = Array.from(state.selectedRows).sort((a, b) => a - b);
    const selectedSeqs = indices.map(i => state.seqs[i].seq);
    const len = Math.max(...selectedSeqs.map(s => s.length));
    const threshold = parseInt(el('groupConsensusThreshold').value) / 100;
    let cons = '';
    for (let pos = 0; pos < len; pos++) {
        const col = selectedSeqs.map(s => s[pos] || '-').filter(b => b !== '-' && b !== '.');
        if (col.length === 0) {
            cons += '-';
            continue;
        }
        const counts = {};
        col.forEach(b => counts[b] = (counts[b] || 0) + 1);
        const maxBase = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b, '');
        const freq = counts[maxBase] / col.length;
        cons += (freq >= threshold) ? maxBase : '-';
    }
    const consObj = { header: 'Group_Consensus', fullHeader: 'Consensus of selected group', seq: cons, gaplessPositions: calculateGaplessPositions(cons) };
    const insertPos = indices[indices.length - 1] + 1;
    state.seqs.splice(insertPos, 0, consObj);
    renderAlignment();
    showMessage("Group consensus inserted!", 2000);
}
function duplicateSelected() {
    if (state.selectedRows.size === 0) return;
    const indices = Array.from(state.selectedRows).sort((a, b) => a - b);
    const copies = indices.map(i => ({...state.seqs[i], header: state.seqs[i].header + '_copy'}));
    state.seqs.push(...copies);
    renderAlignment();
    showMessage("Selected sequences duplicated!", 2000);
}
function openSelectedInNewTab() {
    if (state.selectedRows.size === 0) {
        showMessage("No sequences selected.", 3000);
        return;
    }
    const fasta = Array.from(state.selectedRows).sort((a,b) => a - b).map(i => {
        const s = state.seqs[i];
        return `>${s.fullHeader || s.header}\n${s.seq}`;
    }).join('\n');
    const blob = new Blob([fasta], {type: 'text/plain'});
    const url = URL.createObjectURL(blob);
    const newWindow = window.open();
    newWindow.document.write('<textarea style="width:100%;height:100%;">' + fasta + '</textarea>');
    newWindow.document.title = 'Selected Sequences';
    newWindow.document.close();
    showMessage("Selected sequences opened in new tab!", 2000);
}
function savePreset() {
    const preset = {
        black: el('blackSlider').value,
        dark: el('darkSlider').value,
        light: el('lightSlider').value,
        zoom: el('zoomSlider').value,
        mode: el('modeBlocks').checked ? 'blocks' : 'single',
        blockSize: el('blockSizeSlider').value,
        nameLen: el('nameLengthSlider').value,
        consensusThreshold: el('consensusThreshold').value,
        groupConsensusThreshold: el('groupConsensusThreshold').value,
        consensusType: document.querySelector('input[name="consensusType"]:checked').value,
        showConsensus: el('showConsensus').checked,
        consensusPosition: document.querySelector('input[name="consensusPosition"]:checked').value,
        shadeMode: document.querySelector('input[name="shadeMode"]:checked').value,
        enableBlack: el('enableBlack').checked,
        enableDark: el('enableDark').checked,
        enableLight: el('enableLight').checked,
        stickyNames: el('stickyNames').checked
    };
    localStorage.setItem('qwen_msa_viewer_preset_v44', JSON.stringify(preset));
    showMessage("Preset saved!", 2000);
}
function loadPreset() {
    const saved = localStorage.getItem('qwen_msa_viewer_preset_v44');
    if (!saved) {
        showMessage("No saved preset found.", 3000);
        return;
    }
    const p = JSON.parse(saved);
    ['black','dark','light','zoom','blockSize','nameLen','consensusThreshold', 'groupConsensusThreshold'].forEach(k => {
        el(k + 'Slider').value = p[k];
        const inputElement = el(k + 'Input');
        if (inputElement) inputElement.value = p[k];
        updateSliderBackground(el(k + 'Slider'));
    });
    setZoom(p.zoom);
    el('modeBlocks').checked = p.mode === 'blocks';
    el('modeSingle').checked = p.mode !== 'blocks';
    el('stickyNames').checked = p.stickyNames !== undefined ? p.stickyNames : true;
    onModeChange();
    toggleStickyNames();
    document.querySelector(`input[name="consensusType"][value="${p.consensusType}"]`).checked = true;
    el('showConsensus').checked = p.showConsensus;
    document.querySelector(`input[name="consensusPosition"][value="${p.consensusPosition}"]`).checked = true;
    document.querySelector(`input[name="shadeMode"][value="${p.shadeMode}"]`).checked = true;
    el('enableBlack').checked = p.enableBlack;
    el('enableDark').checked = p.enableDark;
    el('enableLight').checked = p.enableLight;
    renderAlignment();
    showMessage("Preset loaded!", 2000);
}
function minimizeMenu() {
    const controls = el('controls');
    const filenameInfo = el('filenameInfo');
    minimizeBar.parentNode.insertBefore(filenameInfo, minimizeBar.nextSibling);
    filenameInfo.style.position = 'sticky';
    filenameInfo.style.top = '0px';
    filenameInfo.style.zIndex = '98';
    controls.style.display = 'none';
    minimizeBar.style.display = 'block';
}
function expandMenu() {
    minimizeBar.style.display = 'none';
    const controls = el('controls');
    const filenameInfo = el('filenameInfo');
    controls.appendChild(filenameInfo);
    filenameInfo.style.position = '';
    filenameInfo.style.top = '';
    filenameInfo.style.zIndex = '';
    controls.style.display = 'grid';
}
function searchMotif() {
    const motif = el('searchInput').value.trim().toUpperCase();
    if (!motif) return;
    const color = el('searchColor').value;
    const className = 'search-hit-' + Math.random().toString(36).substring(2, 12) + btoa(motif).replace(/=/g, '').substring(0, 5);
    state.searchHistory = state.searchHistory.filter(item => {
        if (item.motif === motif) {
            document.querySelectorAll(`.${item.className}`).forEach(span => {
                span.classList.remove(item.className);
            });
            document.querySelector(`style[data-motif="${item.motif}"]`)?.remove();
            return false;
        }
        return true;
    });
    const style = document.createElement('style');
    style.textContent = `.${className} { background-color: ${color} !important; color: black !important; font-weight: bold; }`;
    style.setAttribute('data-motif', motif);
    document.head.appendChild(style);
    state.searchHistory.push({ motif, color, className });
    document.querySelectorAll('.seq-line:not(.consensus-line)').forEach(row => {
        const index = parseInt(row.dataset.seqIndex);
        if (index >= state.seqs.length || index < 0) return;
        const seq = state.seqs[index].seq;
        const degapped = seq.replace(/[-.]/g, '');
        const dataSpan = row.querySelector('.seq-data');
        const spans = Array.from(dataSpan.children);
        const nonGapSpans = spans.filter(s => s.textContent !== '-' && s.textContent !== '.');
        for (let seqPos = 0; seqPos <= degapped.length - motif.length; seqPos++) {
            const sub = degapped.substring(seqPos, seqPos + motif.length);
            if (sub === motif) {
                for (let i = 0; i < motif.length; i++) {
                    const child = nonGapSpans[seqPos + i];
                    if (child) child.classList.add(className);
                }
            }
        }
    });
    el('searchInput').value = '';
    showMessage(`Found "${motif}"!`, 2000);
}
function clearLastSearch() {
    if (state.searchHistory.length === 0) {
        showMessage("No searches to clear.", 3000);
        return;
    }
    const last = state.searchHistory.pop();
    document.querySelectorAll(`.${last.className}`).forEach(span => span.classList.remove(last.className));
    document.querySelector(`style[data-motif="${last.motif}"]`)?.remove();
    showMessage("Last search cleared!", 2000);
}
function clearAllSearches() {
    state.searchHistory.forEach(item => {
        document.querySelectorAll(`.${item.className}`).forEach(span => {
            span.classList.remove(item.className);
        });
        document.querySelector(`style[data-motif="${item.motif}"]`)?.remove();
    });
    state.searchHistory = [];
    showMessage("All searches cleared!", 2000);
}
function openInfoModal() {
    infoModal.style.display = 'block';
}
function closeInfoModal() {
    infoModal.style.display = 'none';
}
function realignSelectedBlock() {
    showMessage("Realign Block not implemented yet.", 3000);
}
function copySequences(gapped, isFasta, index) {
    let indices = Array.from(state.selectedRows).sort((a,b)=>a-b);
    if (indices.length === 0) {
        indices = [index];
    }
    let text = '';
    if (isFasta) {
        text = indices.map(i => {
            let seq = state.seqs[i].seq;
            if (!gapped) seq = seq.replace(/[-.]/g, '');
            return `>${state.seqs[i].fullHeader || state.seqs[i].header}\n${seq}`;
        }).join('\n');
    } else {
        text = indices.map(i => {
            let seq = state.seqs[i].seq;
            if (!gapped) seq = seq.replace(/[-.]/g, '');
            return seq;
        }).join('\n');
    }
    navigator.clipboard.writeText(text).then(() => {
        const count = indices.length;
        const type = isFasta ? 'FASTA' : 'plain text';
        const gapType = gapped ? 'gapped' : 'ungapped';
        showMessage(`${count > 1 ? 'Selected sequences' : 'Sequence'} copied as ${type} (${gapType})!`, 2000);
    }).catch(err => {
        console.error('Copy failed:', err);
        showMessage("Failed to copy.", 5000);
    });
}
function deleteSequence(index) {
    if (state.seqs.length === 1) {
        showMessage("Cannot delete the last sequence.", 3000);
        return;
    }
    if (confirm('Delete this sequence?')) {
        state.deletedHistory.push({
            type: 'delete',
            seqs: JSON.parse(JSON.stringify(state.seqs)),
            selectedRows: new Set(),
            selectedColumns: new Set(state.selectedColumns)
        });
        state.seqs.splice(index, 1);
        state.selectedRows.clear();
        renderAlignment();
        showMessage("Sequence deleted!", 2000);
    }
}
let contextMenu = null;
function showContextMenu(e, index) {
    if (contextMenu) {
        contextMenu.remove();
    }
    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.style.left = `${e.pageX}px`;
    contextMenu.style.top = `${e.pageY}px`;
    const copyFastaGapped = document.createElement('div');
    copyFastaGapped.textContent = 'Copy as FASTA gapped';
    copyFastaGapped.addEventListener('click', () => {
        copySequences(true, true, index);
        contextMenu.remove();
    });
    const copyFastaUngapped = document.createElement('div');
    copyFastaUngapped.textContent = 'Copy as FASTA ungapped';
    copyFastaUngapped.addEventListener('click', () => {
        copySequences(false, true, index);
        contextMenu.remove();
    });
    const copyPlainGapped = document.createElement('div');
    copyPlainGapped.textContent = 'Copy as plain text gapped';
    copyPlainGapped.addEventListener('click', () => {
        copySequences(true, false, index);
        contextMenu.remove();
    });
    const copyPlainUngapped = document.createElement('div');
    copyPlainUngapped.textContent = 'Copy as plain text ungapped';
    copyPlainUngapped.addEventListener('click', () => {
        copySequences(false, false, index);
        contextMenu.remove();
    });
    contextMenu.appendChild(copyFastaGapped);
    contextMenu.appendChild(copyFastaUngapped);
    contextMenu.appendChild(copyPlainGapped);
    contextMenu.appendChild(copyPlainUngapped);
    const deleteItem = document.createElement('div');
    deleteItem.textContent = state.selectedRows.size > 1 ? 'Delete selected' : 'Delete sequence';
    deleteItem.addEventListener('click', () => {
        if (state.selectedRows.size > 1) {
            deleteSelected();
        } else {
            deleteSequence(index);
        }
        contextMenu.remove();
    });
    contextMenu.appendChild(deleteItem);
    if (state.selectedRows.size <= 1) {
        const renameItem = document.createElement('div');
        renameItem.textContent = 'Rename sequence';
        renameItem.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = state.seqs[index].header;
            input.style.width = `${e.target.offsetWidth}px`;
            input.style.fontSize = getComputedStyle(e.target).fontSize;
            input.style.fontFamily = getComputedStyle(e.target).fontFamily;
            input.style.padding = '0';
            input.style.border = '1px solid #ccc';
            e.target.innerHTML = '';
            e.target.appendChild(input);
            input.focus();
            input.select();
            const save = () => {
                const newName = input.value.trim();
                if (newName && newName !== state.seqs[index].header) {
                    state.deletedHistory.push({
                        type: 'rename',
                        seqs: JSON.parse(JSON.stringify(state.seqs)),
                        selectedRows: new Set(),
                        selectedColumns: new Set(state.selectedColumns)
                    });
                    state.seqs[index].header = newName;
                    state.seqs[index].fullHeader = newName;
                    renderAlignment();
                    showMessage("Sequence renamed!", 2000);
                } else {
                    renderAlignment();
                }
            };
            input.addEventListener('blur', save);
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    save();
                } else if (ev.key === 'Escape') {
                    renderAlignment();
                }
            });
            contextMenu.remove();
        });
        contextMenu.appendChild(renameItem);
    }
    const clearSelItem = document.createElement('div');
    clearSelItem.textContent = 'Clear selection';
    clearSelItem.addEventListener('click', () => {
        state.selectedRows.clear();
        state.selectedColumns.clear();
        state.selectedNucs.clear();
        updateRowSelections();
        updateColumnSelections();
        renderAlignment();
        contextMenu.remove();
    });
    contextMenu.appendChild(clearSelItem);
    // Add insert/remove single gap if on span
    if (e.target.tagName === 'SPAN' && e.target.parentNode.className === 'seq-data') {
        const pos = parseInt(e.target.dataset.pos);
        const insertGapItem = document.createElement('div');
        insertGapItem.textContent = 'Insert Single Gap Here';
        insertGapItem.addEventListener('click', () => {
            insertSingleGap(index, pos);
            contextMenu.remove();
        });
        contextMenu.appendChild(insertGapItem);
        const removeGapItem = document.createElement('div');
        removeGapItem.textContent = 'Remove Single Gap Here';
        removeGapItem.addEventListener('click', () => {
            removeSingleGap(index, pos);
            contextMenu.remove();
        });
        contextMenu.appendChild(removeGapItem);
    }
    document.body.appendChild(contextMenu);
}
function updateRowSelections() {
    document.querySelectorAll('.seq-line.selected').forEach(line => line.classList.remove('selected'));
    state.selectedRows.forEach(index => {
        document.querySelectorAll(`.seq-line[data-seq-index="${index}"]`).forEach(line => line.classList.add('selected'));
    });
}
function updateColumnSelections() {
    document.querySelectorAll('.seq-data span.column-selected').forEach(span => span.classList.remove('column-selected'));
    state.selectedColumns.forEach(pos => {
        document.querySelectorAll(`.seq-data span[data-pos="${pos}"]`).forEach(span => span.classList.add('column-selected'));
    });
}
// EVENT LISTENERS
document.addEventListener('DOMContentLoaded', () => {
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--dropzone-hover-border)';
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = 'var(--dropzone-border)';
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--dropzone-border)';
        const file = e.dataTransfer.files[0];
        if (!file) return;
        state.currentFilename = file.name;
        const reader = new FileReader();
        reader.onload = function(e) {
            fastaInput.value = e.target.result;
           
            parseAndRender(true);
        };
        reader.onerror = () => {
            alignmentContainer.innerHTML = '<div class="error-message">❌ Error reading file.</div>';
            showMessage("Error reading file.", 5000);
        };
        reader.readAsText(file);
    });
    
    // Add click handler for dropzone to open file dialog
    dropZone.addEventListener('click', (e) => {
        if (window.getSelection().toString()) return; // Don't open if user is selecting text
        const fileInput = el('fileInput');
        fileInput.value = '';
        fileInput.click();
    });
    
    // Add file input change handler
    el('fileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        state.currentFilename = file.name;
        const reader = new FileReader();
        reader.onload = function(evt) {
            fastaInput.value = evt.target.result;
            parseAndRender(true);
        };
        reader.onerror = () => {
            alignmentContainer.innerHTML = '<div class="error-message">❌ Error reading file.</div>';
            showMessage("Error reading file.", 5000);
        };
        reader.readAsText(file);
    });
    
    // Add auto-load on paste into textarea
    fastaInput.addEventListener('paste', () => {
        setTimeout(() => {
            parseAndRender(false);
        }, 100);
    });
    
    // Add clear button functionality
    el('clearButton').addEventListener('click', () => {
        fastaInput.value = '';
    });
    
    el('loadButton').addEventListener('click', () => parseAndRender(false));
    el('reverseComplementButton').addEventListener('click', reverseComplementSelected);
    el('copySelectedButton').addEventListener('click', copySelected);
    el('deleteSelectedButton').addEventListener('click', deleteSelected);
    el('undoButton').addEventListener('click', undoDelete);
    el('moveUpButton').addEventListener('click', moveSelectedUp);
    el('moveDownButton').addEventListener('click', moveSelectedDown);
    el('moveToTopButton').addEventListener('click', moveSelectedToTop);
    el('moveToBottomButton').addEventListener('click', moveSelectedToBottom);
    el('insertGroupConsensusButton').addEventListener('click', insertGroupConsensus);
    el('duplicateButton').addEventListener('click', duplicateSelected);
    el('openInNewTabButton').addEventListener('click', openSelectedInNewTab);
    el('selectAllButton').addEventListener('click', selectAllSequences);
    el('copyColumnsButton').addEventListener('click', copySelectedColumns);
    el('deleteColumnsButton').addEventListener('click', deleteSelectedColumns);
    el('realignBlockButton').addEventListener('click', realignSelectedBlock);
    el('savePresetButton').addEventListener('click', savePreset);
    el('loadPresetButton').addEventListener('click', loadPreset);
    el('infoButton').addEventListener('click', openInfoModal);
    el('minimizeBtn').addEventListener('click', minimizeMenu);
    el('zoomInButton').addEventListener('click', () => adjustZoom(10));
    el('zoomOutButton').addEventListener('click', () => adjustZoom(-10));
    el('searchButton').addEventListener('click', searchMotif);
    el('clearLastSearchButton').addEventListener('click', clearLastSearch);
    el('clearAllSearchesButton').addEventListener('click', clearAllSearches);
    el('copyConsensusButton').addEventListener('click', copyConsensus);
    el('copySelectedConsensusButton').addEventListener('click', copySelectedConsensus);
    el('removeGapColumnsButton').addEventListener('click', removeGapColumns);
    el('insertGapColumnAllButton').addEventListener('click', () => insertGapColumn(true));
    el('insertGapColumnExceptButton').addEventListener('click', () => insertGapColumn(false));
    
    minimizeBar.addEventListener('click', expandMenu);
    
    // Set up slider/input pairs manually to avoid function reference issues
    const sliderPairs = [
        ['blackSlider', 'blackInput'],
        ['darkSlider', 'darkInput'], 
        ['lightSlider', 'lightInput'],
        ['nameLengthSlider', 'nameLengthInput'],
        ['blockSizeSlider', 'blockSizeInput'],
        ['consensusThreshold', 'consensusThresholdInput'],
        ['groupConsensusThreshold', 'groupConsensusThresholdInput']
    ];
    
    sliderPairs.forEach(([sliderId, inputId]) => {
        const slider = el(sliderId);
        const input = el(inputId);
        if (slider && input) {
            slider.addEventListener('input', () => {
                input.value = slider.value;
                updateSliderBackground(slider);
                if (sliderId.includes('black') || sliderId.includes('dark') || sliderId.includes('light')) {
                    validateThresholds();
                }
                // Defer render call
                setTimeout(() => {
                    if (typeof renderAlignment === 'function') {
                        renderAlignment();
                    }
                }, 10);
            });
            
            input.addEventListener('input', () => {
                slider.value = input.value;
                updateSliderBackground(slider);
                if (inputId.includes('black') || inputId.includes('dark') || inputId.includes('light')) {
                    validateThresholds();
                }
                // Defer render call
                setTimeout(() => {
                    if (typeof renderAlignment === 'function') {
                        renderAlignment();
                    }
                }, 10);
            });
        }
    });
    
    // Set up zoom slider separately (no input pair)
    const zoomSlider = el('zoomSlider');
    if (zoomSlider) {
        zoomSlider.addEventListener('input', () => {
            if (typeof setZoom === 'function') {
                setZoom(zoomSlider.value);
            }
            updateSliderBackground(zoomSlider);
        });
    }
    
    // Set up radio button groups
    const radioGroups = ['shadeMode', 'mode', 'consensusType', 'consensusPosition'];
    radioGroups.forEach(group => {
        document.querySelectorAll(`input[name="${group}"]`).forEach(radio => {
            const handler = group === 'shadeMode' ? onShadeModeChange : 
                           group === 'mode' ? onModeChange : debounceRender;
            radio.addEventListener('change', handler);
        });
    });
    
    // Set up checkbox listeners
    const checkboxes = ['enableBlack', 'enableDark', 'enableLight', 'showConsensus'];
    checkboxes.forEach(id => {
        el(id).addEventListener('change', debounceRender);
    });
    
    el('stickyNames').addEventListener('change', toggleStickyNames);
    alignmentContainer.addEventListener('mousedown', handleMouseDown);
    alignmentContainer.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('click', (event) => {
        if (event.target === infoModal) {
            closeInfoModal();
        }
    });
    alignmentContainer.addEventListener('contextmenu', (e) => {
        const name = e.target.closest('.seq-name');
        if (name) {
            e.preventDefault();
            const row = e.target.closest('.seq-line');
            const index = parseInt(row.dataset.seqIndex);
            showContextMenu(e, index);
        } else if (e.target.tagName === 'SPAN' && e.target.parentNode.className === 'seq-data') {
            e.preventDefault();
            const row = e.target.closest('.seq-line');
            const index = parseInt(row.dataset.seqIndex);
            showContextMenu(e, index);
        }
    });
    document.addEventListener('click', () => {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
    });
    alignmentContainer.addEventListener('scroll', () => {
        document.querySelectorAll('.seq-name').forEach(name => {
            name.style.display = 'none';
            name.offsetHeight;
            name.style.display = '';
        });
    });
    el('modeBlocks').checked = true;
    el('modeSingle').checked = false;
    document.querySelector('input[name="consensusPosition"][value="bottom"]').checked = true;
    onModeChange();
    toggleStickyNames();
    
    // Initialize slider backgrounds
    ['blackSlider', 'darkSlider', 'lightSlider', 'nameLengthSlider', 'zoomSlider', 'blockSizeSlider', 'consensusThreshold', 'groupConsensusThreshold'].forEach(id => {
        const slider = el(id);
        if (slider) {
            updateSliderBackground(slider);
        }
    });
});
// NEW EDITING FUNCTIONS
function removeGapColumns() {
    if (state.seqs.length === 0) return;
    const len = state.seqs[0].seq.length;
    const colsToRemove = [];
    for (let pos = 0; pos < len; pos++) {
        if (state.seqs.every(s => s.seq[pos] === '-' || s.seq[pos] === '.')) {
            colsToRemove.push(pos);
        }
    }
    if (colsToRemove.length === 0) {
        showMessage("No gap-only columns to remove.", 2000);
        return;
    }
    state.deletedHistory.push({
        type: 'removeGaps',
        seqs: JSON.parse(JSON.stringify(state.seqs)),
        removedCols: colsToRemove
    });
    state.seqs.forEach(s => {
        let seqArr = s.seq.split('');
        colsToRemove.sort((a, b) => b - a).forEach(pos => seqArr.splice(pos, 1));
        s.seq = seqArr.join('');
        s.gaplessPositions = calculateGaplessPositions(s.seq);
    });
    renderAlignment();
    showMessage(`${colsToRemove.length} gap columns removed!`, 2000);
}
function insertGapColumn(all = true) {
    if (state.selectedColumns.size === 0) {
        showMessage("Select a column position by Ctrl+Alt+click on a nucleotide to insert gap there.", 5000);
        return;
    }
    const pos = Math.min(...state.selectedColumns);
    state.deletedHistory.push({
        type: 'insertGap',
        seqs: JSON.parse(JSON.stringify(state.seqs)),
        pos: pos,
        all: all
    });
    state.seqs.forEach((s, i) => {
        if (!all && state.selectedRows.has(i)) return; // Skip selected if not all
        s.seq = s.seq.slice(0, pos) + '-' + s.seq.slice(pos);
        s.gaplessPositions = calculateGaplessPositions(s.seq);
    });
    state.selectedColumns.clear();
    renderAlignment();
    showMessage("Gap column inserted!", 2000);
}
function insertSingleGap(rowIndex, pos) {
    const s = state.seqs[rowIndex];
    state.deletedHistory.push({
        type: 'insertSingleGap',
        seqs: JSON.parse(JSON.stringify(state.seqs)),
        rowIndex: rowIndex,
        pos: pos
    });
    s.seq = s.seq.slice(0, pos) + '-' + s.seq.slice(pos);
    s.gaplessPositions = calculateGaplessPositions(s.seq);
    renderAlignment();
    showMessage("Single gap inserted!", 2000);
}
function removeSingleGap(rowIndex, pos) {
    const s = state.seqs[rowIndex];
    if (s.seq[pos] !== '-' && s.seq[pos] !== '.') {
        showMessage("Not a gap.", 2000);
        return;
    }
    state.deletedHistory.push({
        type: 'removeSingleGap',
        seqs: JSON.parse(JSON.stringify(state.seqs)),
        rowIndex: rowIndex,
        pos: pos
    });
    s.seq = s.seq.slice(0, pos) + s.seq.slice(pos + 1);
    s.gaplessPositions = calculateGaplessPositions(s.seq);
    renderAlignment();
    showMessage("Single gap removed!", 2000);
}
// Slide by dragging seq-data
function handleSlideStart(e) {
    if (e.button !== 2) return; // Right click only
    e.preventDefault(); // Prevent context menu
    const dataSpan = e.target.closest('.seq-data');
    if (!dataSpan) return;
    const seqIndex = parseInt(dataSpan.parentNode.dataset.seqIndex);
    state.slideSeqIndex = seqIndex;
    state.slideDragStartX = e.clientX;
    document.addEventListener('mousemove', handleSlideMove);
    document.addEventListener('mouseup', handleSlideEnd);
}
function handleSlideMove(e) {
    const deltaX = e.clientX - state.slideDragStartX;
    const shift = Math.sign(deltaX) * Math.floor(Math.abs(deltaX) / 20); // Shift every 20px
    if (shift !== 0) {
        shiftSequence(state.slideSeqIndex, shift);
        state.slideDragStartX = e.clientX; // Reset start for next shift
    }
}
function handleSlideEnd() {
    document.removeEventListener('mousemove', handleSlideMove);
    document.removeEventListener('mouseup', handleSlideEnd);
    if (state.slideSeqIndex !== null) {
        renderAlignment(); // Re-render to update DOM and reapply sticky
    }
    state.slideSeqIndex = null;
}
function getLeadingGaps(seq) {
    let count = 0;
    for (let char of seq) {
        if (char === '-' || char === '.') count++;
        else break;
    }
    return count;
}
function getTrailingGaps(seq) {
    let count = 0;
    for (let i = seq.length - 1; i >= 0; i--) {
        if (seq[i] === '-' || seq[i] === '.') count++;
        else break;
    }
    return count;
}
function shiftSequence(index, amount) {
    const s = state.seqs[index];
    state.deletedHistory.push({
        type: 'shift',
        seqs: JSON.parse(JSON.stringify(state.seqs)),
        index: index,
        amount: amount
    });
    if (amount > 0) { // right shift
        const maxShift = getTrailingGaps(s.seq);
        if (maxShift === 0) {
            showMessage("Cannot shift right: no trailing gaps.", 2000);
            return;
        }
        amount = Math.min(amount, maxShift);
        s.seq = '-'.repeat(amount) + s.seq.slice(0, -amount);
    } else if (amount < 0) { // left shift
        amount = -amount;
        const maxShift = getLeadingGaps(s.seq);
        if (maxShift === 0) {
            showMessage("Cannot shift left: no leading gaps.", 2000);
            return;
        }
        amount = Math.min(amount, maxShift);
        s.seq = s.seq.slice(amount) + '-'.repeat(amount);
    }
    s.gaplessPositions = calculateGaplessPositions(s.seq);
    renderAlignment();
    showMessage(`Sequence shifted by ${amount}!`, 2000);
}

// Prevent Ctrl+A from selecting nucleotides in alignment when fastaInput is focused.
fastaInput.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 'a') {
        e.stopPropagation(); // Prevent alignment selection
    }
});