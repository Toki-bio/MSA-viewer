// STATE OBJECT
const DEFAULTS = {
    consensusThreshold: 50,
    groupConsensusThreshold: 70,
    nameLength: 25
};

const state = {
  seqs: [],
  selectedRows: new Set(),
  selectedColumns: new Set(),
    selectedNucs: new Map(),
    pendingNucStart: null,
    spanCache: new Map(),
    domSelectedNucs: new Map(),
        domSelectedColumns: new Map(),
    domPendingNuc: null,
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
        slideSeqIndex: null,
    panning: {
        active: false,
        startX: 0,
        startY: 0,
        scrollLeft: 0,
        scrollTop: 0,
        started: false
    }
};
// Ensure drag handlers are globally available before any usage
window.handleDragStart = function(e) {
    try {

// ============================================================================
// End of Full-window drag-and-drop
// ============================================================================
        if (e && e.dataTransfer) {
            e.dataTransfer.setData('text/plain', e.target ? e.target.textContent : '');
            e.dataTransfer.effectAllowed = 'move';
        }
    } catch (err) {
        console.warn('dragstart error', err);
    }
};
window.handleDragEnd = function(e) {
    // optional cleanup
};

// Minimal drop handler to avoid undefined reference; can be expanded later
window.handleDrop = function(e) {
    e.preventDefault();
    e.stopPropagation();
    // If files are dropped on a specific sequence line, we could implement
    // sequence-specific behavior here. For now, do nothing to avoid errors.
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
// Quick sanity check: ensure essential elements exist to avoid silent failures
if (!fastaInput || !alignmentContainer || !statusMessage) {
    console.error('Essential DOM elements missing:', {
        fastaInput: !!fastaInput,
        alignmentContainer: !!alignmentContainer,
        statusMessage: !!statusMessage
    });
    if (statusMessage) {
        statusMessage.textContent = 'Error: missing essential UI elements. Check console for details.';
        statusMessage.style.display = 'block';
    }
}
// UTILITY FUNCTIONS
function showMessage(msg, duration = 2000) {
    statusMessage.textContent = msg;
    statusMessage.style.display = 'block';
    setTimeout(() => { statusMessage.style.display = 'none'; }, duration);
}

// Tooltip helper functions with viewport-aware positioning
function showTooltipAt(content, target, options = {}) {
    if (!tooltip || !target) return;
    
    tooltip.textContent = content;
    tooltip.style.display = 'block';
    
    // Force a reflow to get accurate dimensions after content is set
    const tooltipWidth = tooltip.offsetWidth || 150;
    const tooltipHeight = tooltip.offsetHeight || 30;
    const gapSize = 8;
    
    // Get target position
    const rect = target.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    
    // Try to center horizontally above the target
    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    let top = rect.top - tooltipHeight - gapSize;
    let useTransform = false;
    
    // Clamp horizontal position to keep tooltip on screen
    const padding = 5;
    if (left < padding) {
        left = padding;
    } else if (left + tooltipWidth > window.innerWidth - padding) {
        left = window.innerWidth - tooltipWidth - padding;
    }
    
    // If tooltip goes above viewport, position it below instead
    if (top < padding) {
        top = rect.bottom + gapSize;
    }
    
    // Add scroll offset for absolute positioning
    tooltip.style.position = 'fixed';
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
    tooltip.style.transform = 'none';
}

function hideTooltip() {
    if (!tooltip) return;
    tooltip.style.display = 'none';
}

// Menu stability: delay closing menus when mouse leaves to prevent flickering
const menuCloseDelays = new Map();
const MENU_CLOSE_DELAY = 300; // milliseconds

function setupMenuStability() {
    const menuSections = document.querySelectorAll('.menu-section');
    menuSections.forEach(section => {
        const controlGroup = section.querySelector('.control-group');
        
        section.addEventListener('mouseenter', () => {
            // Clear any pending close timeout for this menu
            if (menuCloseDelays.has(section)) {
                clearTimeout(menuCloseDelays.get(section));
                menuCloseDelays.delete(section);
            }
            section.classList.add('menu-open');
        });
        
        section.addEventListener('mouseleave', () => {
            // Check if any input in this menu is focused (autocomplete might be open)
            const hasFocusedInput = controlGroup?.querySelector('input:focus') !== null;
            
            if (hasFocusedInput) {
                // Don't close if input is focused - let blur event handle it
                return;
            }
            
            // Delay closing the menu to avoid flickering on brief mouse movements
            const timeoutId = setTimeout(() => {
                section.classList.remove('menu-open');
                menuCloseDelays.delete(section);
            }, MENU_CLOSE_DELAY);
            menuCloseDelays.set(section, timeoutId);
        });
        
        // Keep menu open when hovering over control-group
        if (controlGroup) {
            controlGroup.addEventListener('mouseenter', () => {
                if (menuCloseDelays.has(section)) {
                    clearTimeout(menuCloseDelays.get(section));
                    menuCloseDelays.delete(section);
                }
                section.classList.add('menu-open');
            });
            
            // Close menu when blur happens and mouse is not hovering
            controlGroup.querySelectorAll('input').forEach(input => {
                input.addEventListener('blur', () => {
                    // Check if mouse is still over the section
                    if (!section.matches(':hover')) {
                        section.classList.remove('menu-open');
                        if (menuCloseDelays.has(section)) {
                            clearTimeout(menuCloseDelays.get(section));
                            menuCloseDelays.delete(section);
                        }
                    }
                });
            });
        }
    });
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
        
        // Set slider to maximum when loading new file
        slider.value = newMax;
        input.value = newMax;
        
        // Update the state to reflect the new value
        state.nameLength = newMax;
        
        // If current value is below new min, adjust it
        if (parseInt(slider.value) < 3) {
            slider.value = 3;
            input.value = 3;
        }
        
        // Update slider background
        updateSliderBackground(slider);
        
        // Update title to reflect new range
        slider.title = `Adjust sequence name display length (3-${newMax} characters)`;
        
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

function clampConsensusPercent(value) {
    const num = parseInt(value, 10);
    if (Number.isNaN(num)) return DEFAULTS.consensusThreshold;
    return Math.max(30, Math.min(100, num));
}

function clampGroupConsensusPercent(value) {
    const num = parseInt(value, 10);
    if (Number.isNaN(num)) return DEFAULTS.groupConsensusThreshold;
    return Math.max(50, Math.min(100, num));
}

function clampNameLength(value) {
    const num = parseInt(value, 10);
    if (Number.isNaN(num)) return DEFAULTS.nameLength;
    return Math.max(3, Math.min(50, num));
}

function setNameLengthUI(value, triggerRender = false) {
    const slider = el('nameLengthSlider');
    const input = el('nameLengthInput');
    const clamped = clampNameLength(value);
    if (slider) {
        slider.value = clamped;
        updateSliderBackground(slider);
    }
    if (input) {
        input.value = clamped;
    }
    document.documentElement.style.setProperty('--nameLen', clamped);
    if (triggerRender) {
        debounceRender();
    }
}

function setConsensusThresholdUI(value, triggerRender = false) {
    const slider = el('consensusThreshold');
    const input = el('consensusThresholdInput');
    const clamped = clampConsensusPercent(value);
    if (slider) {
        slider.min = 30;
        slider.max = 100;
        slider.value = clamped;
        updateSliderBackground(slider);
    }
    if (input) {
        input.min = 30;
        input.max = 100;
        input.value = clamped;
    }
    if (triggerRender) {
        debounceRender();
    }
}

function setGroupConsensusThresholdUI(value, triggerRender = false) {
    const slider = el('groupConsensusThreshold');
    const input = el('groupConsensusThresholdInput');
    const clamped = clampGroupConsensusPercent(value);
    if (slider) {
        slider.min = 50;
        slider.max = 100;
        slider.value = clamped;
        updateSliderBackground(slider);
    }
    if (input) {
        input.min = 50;
        input.max = 100;
        input.value = clamped;
    }
    if (triggerRender) {
        debounceRender();
    }
}

function setConsensusThresholdDefault(value, options = {}) {
    const clamped = clampConsensusPercent(value);
    DEFAULTS.consensusThreshold = clamped;
    const applyNow = options.applyNow !== false;
    if (applyNow) {
        setConsensusThresholdUI(clamped, Boolean(options.triggerRender));
    }
}

window.setConsensusThresholdDefault = setConsensusThresholdDefault;

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
function initializeCollapsibleSections() {
    // Remove all collapsed classes to let CSS hover handle menu display
    document.querySelectorAll('.control-group').forEach(group => {
        group.classList.remove('collapsed');
        group.style.maxHeight = ''; // Clear inline styles
        group.style.display = ''; // Clear inline display - let CSS handle it
    });
    
    // Remove click handlers - menus now work on hover via CSS
    document.querySelectorAll('.section-header[data-section]').forEach(header => {
        header.classList.remove('collapsed');
        const toggleIcon = header.querySelector('.toggle-icon');
        if (toggleIcon) {
            toggleIcon.remove(); // Remove toggle icons since we're using hover
        }
    });
}

function toggleSection(e) {
    // No longer needed - hover handles display
}

function restoreCollapsedState() {
    // No longer needed - hover handles display via CSS
}

function toggleAllSections() {
    // No longer needed - hover handles display via CSS
    showMessage("Menus now work on hover", 2000);
}

function recalculateCollapsibleHeights() {
    // No longer needed - hover handles display via CSS
    // Do nothing - let CSS handle everything
}

function generateScale(maxLength, interval = 10, startPos = 0) {
    const scaleArray = new Array(maxLength).fill(' ');
    
    // Find the first multiple of interval in this block's range
    const startAbs = startPos + 1;
    const endAbs = startPos + maxLength;
    const firstMultiple = Math.ceil(startAbs / interval) * interval;
    
    // Show position markers at multiples of interval within this block
    for (let absPos = firstMultiple; absPos < endAbs; absPos += interval) {
        let label;
        // Alternate: 10 number, 20 *, 30 number, 40 *, etc.
        if ((absPos / interval) % 2 === 1) {
            label = absPos.toString();
        } else {
            label = '*';
        }
        
        const relIdx = absPos - startPos - 1; // 0-based index for the target position
        const startIdx = relIdx - (label.length - 1); // Right-align: last digit at relIdx
        
        // Only place the label if it fits completely within the block
        if (startIdx >= 0 && startIdx + label.length <= maxLength) {
            for (let i = 0; i < label.length; i++) {
                scaleArray[startIdx + i] = label[i];
            }
        }
    }
    
    return scaleArray.join('');
}

function renderAlignment() {
    if (!state.seqs || state.seqs.length === 0) {
        alignmentContainer.innerHTML = '<div style="padding:20px; color:#666; font-style:italic;">No sequences loaded. Paste FASTA/MSF and click Load.</div>';
        return;
    }
    alignmentContainer.innerHTML = '';
    state.spanCache = new Map();
    state.domSelectedNucs = new Map();
    state.domSelectedColumns = new Map();
    state.domPendingNuc = null;
    
    const nameLengthSlider = el('nameLengthSlider');
    const blackThresh = parseInt(el('blackSlider').value) / 100;
    const darkThresh = parseInt(el('darkSlider').value) / 100;
    const lightThresh = parseInt(el('lightSlider').value) / 100;
    const enableBlack = el('enableBlack').checked;
    const enableDark = el('enableDark').checked;
    const enableLight = el('enableLight').checked;
    const stickyNames = el('stickyNames').checked;
    const useBlocks = el('modeBlocks').checked;
    const blockWidth = parseInt(el('blockSizeSlider').value);
    const nameLen = parseInt(nameLengthSlider.value);
    // Update CSS variable for scale ruler padding
    document.documentElement.style.setProperty('--nameLen', nameLen);
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
    const threshold = clampConsensusPercent(el('consensusThreshold').value) / 100;
    
    // Calculate sequence length for consensus and scale
    const len = Math.max(...state.seqs.map(s => s.seq.length));
    
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
            const blockLen = end - start;
            const blockDiv = document.createElement('div');
            blockDiv.className = 'block-block';
            
            // Add scale/ruler above each block (replaces separator)
            const scaleDiv = document.createElement('div');
            scaleDiv.className = 'seq-line scale-ruler-line';
            const scaleNameDiv = document.createElement('div');
            scaleNameDiv.className = 'seq-name';
            scaleNameDiv.textContent = '';
            const scaleDataDiv = document.createElement('div');
            scaleDataDiv.className = 'seq-data';
            const scaleText = generateScale(blockLen, 10, start);
            scaleDataDiv.textContent = scaleText;
            scaleDiv.appendChild(scaleNameDiv);
            scaleDiv.appendChild(scaleDataDiv);
            blockDiv.appendChild(scaleDiv);
            const isLastBlock = (start + blockWidth >= len);
            
            if (showConsensus && consensusPosition === 'top') {
                addConsensusLine(blockDiv, consensus, start, end, nameLen, stickyNames, blackThresh, darkThresh, lightThresh, enableBlack, enableDark, enableLight, isLastBlock, 'top');
            }
            for (let i = 0; i < state.seqs.length; i++) {
                const lineDiv = createSequenceLine(i, start, end, nameLen, stickyNames, standard, ambiguous, blackThresh, darkThresh, lightThresh, enableBlack, enableDark, enableLight, isLastBlock);
                blockDiv.appendChild(lineDiv);
            }
            if (showConsensus && consensusPosition === 'bottom') {
                addConsensusLine(blockDiv, consensus, start, end, nameLen, stickyNames, blackThresh, darkThresh, lightThresh, enableBlack, enableDark, enableLight, isLastBlock, 'bottom');
            }
            alignmentContainer.appendChild(blockDiv);
        }
    } else {
        // Add scale/ruler at the top for full mode
        const scaleDiv = document.createElement('div');
        scaleDiv.className = 'seq-line scale-ruler-line';
        const scaleNameDiv = document.createElement('div');
        scaleNameDiv.className = 'seq-name';
        scaleNameDiv.textContent = '';
        const scaleDataDiv = document.createElement('div');
        scaleDataDiv.className = 'seq-data';
        const scaleText = generateScale(len);
        scaleDataDiv.textContent = scaleText;
        scaleDiv.appendChild(scaleNameDiv);
        scaleDiv.appendChild(scaleDataDiv);
        alignmentContainer.appendChild(scaleDiv);
        
        if (showConsensus && consensusPosition === 'top') {
            addConsensusLine(alignmentContainer, consensus, 0, len, nameLen, stickyNames, blackThresh, darkThresh, lightThresh, enableBlack, enableDark, enableLight, true, 'top');
        }
        for (let i = 0; i < state.seqs.length; i++) {
            const lineDiv = createSequenceLine(i, 0, len, nameLen, stickyNames, standard, ambiguous, blackThresh, darkThresh, lightThresh, enableBlack, enableDark, enableLight, true);
            alignmentContainer.appendChild(lineDiv);
        }
        if (showConsensus && consensusPosition === 'bottom') {
            addConsensusLine(alignmentContainer, consensus, 0, len, nameLen, stickyNames, blackThresh, darkThresh, lightThresh, enableBlack, enableDark, enableLight, true, 'bottom');
        }
    }
    setTimeout(() => toggleStickyNames(), 0);
    ['blackSlider', 'darkSlider', 'lightSlider', 'nameLengthSlider', 'zoomSlider', 'blockSizeSlider', 'consensusThreshold', 'groupConsensusThreshold'].forEach(id => {
        updateSliderBackground(el(id));
    });
    updateRowSelections();
    updateColumnSelections();
    scheduleNucSelectionRefresh();
    recalculateCollapsibleHeights();
    // DISABLED: Sequence shifting removed
    // document.querySelectorAll('.seq-data').forEach(dataSpan => {
    //     dataSpan.addEventListener('mousedown', handleSlideStart);
    // });
}

function ensureSpanCacheRow(row) {
    let rowCache = state.spanCache.get(row);
    if (!rowCache) {
        rowCache = new Map();
        state.spanCache.set(row, rowCache);
    }
    return rowCache;
}

function registerSpanInCache(row, pos, span) {
    ensureSpanCacheRow(row).set(pos, span);
}

function getCachedSpan(row, pos) {
    return state.spanCache.get(row)?.get(pos) || null;
}

function createSequenceLine(index, start, end, nameLen, stickyNames, standard, ambiguous, blackThresh, darkThresh, lightThresh, enableBlack, enableDark, enableLight, showLength = false) {
    const lineDiv = document.createElement('div');
    lineDiv.className = 'seq-line';
    lineDiv.dataset.seqIndex = index;
    const nameSpan = document.createElement('div');
    nameSpan.className = `seq-name ${stickyNames ? '' : 'static'}`;
    nameSpan.dataset.seqIndex = index;
    nameSpan.title = `${state.seqs[index].fullHeader} (length: ${state.seqs[index].seq.length})`;
    let displayName = state.seqs[index].header;
    let nameLenInt = parseInt(nameLen, 10);
    if (displayName.length > nameLenInt) {
        nameSpan.textContent = displayName.slice(0, nameLenInt) + 'вЂ¦';
        nameSpan.title = `${displayName} (length: ${state.seqs[index].seq.length})`;
    } else {
        nameSpan.textContent = displayName;
        nameSpan.title = `${displayName} (length: ${state.seqs[index].seq.length})`;
    }
    nameSpan.draggable = true;
    nameSpan.addEventListener('dragstart', handleDragStart);
    nameSpan.addEventListener('dragend', handleDragEnd);
    // Single click no longer copies the name. Use double-click to edit.
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
    // рџ‘‡ NO ACTION on plain click вЂ” only Ctrl+Click for selection
    dataSpan.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) return; // handled by mousedown
        // рџ‘‰ Do nothing on single click вЂ” no copy, no selection
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
        registerSpanInCache(index, pos, span);
        if (base !== '-' && base !== '.') {
            const currentGaplessPos = gaplessPos;
            span.addEventListener('mouseover', (e) => {
                showTooltipAt(`${state.seqs[index].header}: ${currentGaplessPos}`, span);
            });
            span.addEventListener('mouseout', () => {
                hideTooltip();
            });
        } else {
            span.title = 'Gap';
        }
        if (state.selectedColumns.has(pos)) {
            span.classList.add('column-selected');
        }
        dataSpan.appendChild(span);
    }
    // Add sequence length at the end (only for last block and using gapless length)
    if (showLength) {
        const lengthSpan = document.createElement('span');
        lengthSpan.className = 'seq-length';
        const gaplessLength = state.seqs[index].gaplessPositions[state.seqs[index].gaplessPositions.length - 1] || 0;
        lengthSpan.textContent = gaplessLength;
        lengthSpan.title = `Sequence length: ${gaplessLength} (gapless)`;
        dataSpan.appendChild(lengthSpan);
    }
    lineDiv.appendChild(dataSpan);
    if (state.selectedRows.has(index)) {
        lineDiv.classList.add('selected');
    }
    return lineDiv;
}
function addConsensusLine(parent, consensus, start, end, nameLen, stickyNames, blackThresh, darkThresh, lightThresh, enableBlack, enableDark, enableLight, showLength = false, position = 'bottom') {
    const consLine = document.createElement('div');
    consLine.className = `seq-line consensus-line consensus-${position}`;
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
        
        // Calculate conservation for case sensitivity
        const col = state.seqs.map(s => s.seq[pos] || '-');
        const nonGapCol = col.filter(b => b !== '-' && b !== '.');
        let displayBase = base;
        if (nonGapCol.length > 0) {
            const counts = {};
            nonGapCol.forEach(b => counts[b] = (counts[b] || 0) + 1);
            const maxCount = Math.max(...Object.values(counts), 0);
            const consensusBases = new Set(Object.keys(counts).filter(b => counts[b] === maxCount));
            const denominator = document.querySelector('input[name="shadeMode"]:checked').value === 'all' ? state.seqs.length : nonGapCol.length;
            const conservation = maxCount / denominator;
            
            // Apply case based on shading: uppercase for black (highly conserved), lowercase for light (less conserved)
            if (base !== '-' && base !== '.' && consensusBases.has(base.toUpperCase())) {
                if (enableBlack && conservation >= blackThresh) {
                    displayBase = base.toUpperCase(); // Black shading = uppercase
                } else if (enableLight && conservation >= lightThresh) {
                    displayBase = base.toLowerCase(); // Light shading = lowercase
                } else {
                    displayBase = base.toUpperCase(); // Default to uppercase
                }
            }
        }
        
        const span = document.createElement('span');
        span.className = baseClass;
        span.textContent = displayBase;
        dataSpan.appendChild(span);
    }
    // Add consensus length at the end (only for last block and using gapless length)
    if (showLength) {
        const lengthSpan = document.createElement('span');
        lengthSpan.className = 'seq-length';
        // For consensus, count non-gap characters
        const consensusStr = String(consensus || '');
        const gaplessLength = (consensusStr.match(/[^-.\s]/g) || []).length;
        lengthSpan.textContent = gaplessLength;
        lengthSpan.title = `Consensus length: ${gaplessLength} (gapless)`;
        dataSpan.appendChild(lengthSpan);
    }
    consLine.appendChild(dataSpan);
    parent.appendChild(consLine);
}
function setupHoverMenuReveal() {
    const controls = el('controls');
    const alignmentContainer = el('alignmentContainer');
    if (!controls || !alignmentContainer) return;
    
    // Menu stays visible via CSS sticky positioning
    // This JavaScript just handles closing overlapping menu sections
    
    controls.addEventListener('click', (e) => {
        const header = e.target.closest('.section-header');
        if (header) {
            // When clicking a menu section header, close others
            document.querySelectorAll('.control-group').forEach(group => {
                const isRelated = header.nextElementSibling === group;
                if (!isRelated && group.style.display === 'block') {
                    group.style.display = 'none';
                }
            });
        }
    });
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
    if (!inputText) {
        alignmentContainer.innerHTML = '<div>Paste MSF or FASTA into the box and click Load, or drop a file.</div>';
        statusMessage.style.display = 'none';
        return;
    }
    try {
        let parsed;
        // рџ‘‡ PRIORITIZE CONTENT-BASED DETECTION. Ignore filename for pasted data.
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
        // рџ‘‡ MOVE THIS LINE UP: Set filename BEFORE any parsing that might fail.
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
        // This will set the slider to maximum actual name length
        updateNameLengthSliderRange();
        
        // Update source info with comprehensive statistics
        const seqCount = state.seqs.length;
        const aliLength = state.seqs[0]?.seq.length || 0;
        const gaplessLengths = state.seqs.map(seq => seq.gaplessPositions[seq.gaplessPositions.length - 1] || 0);
        const minLength = Math.min(...gaplessLengths);
        const maxLength = Math.max(...gaplessLengths);
        const lengthRange = minLength === maxLength ? `${minLength}` : `${minLength}-${maxLength}`;
        
        const filename = state.currentFilename ? `<strong>${state.currentFilename}</strong>: ` : '';
        el('sourceInfo').innerHTML = `${filename}${seqCount} sequences, ${aliLength} columns, ${lengthRange} bp/seq`;
        renderAlignment();
        setupHoverMenuReveal();
        showMessage("File loaded successfully!", 2000);

        // Ensure menus don't have inline styles that interfere with hover
        setTimeout(() => {
            try {
                document.querySelectorAll('.control-group').forEach(group => {
                    group.style.maxHeight = '';
                    group.style.display = '';
                });
            } catch (err) {
                console.warn('Failed to clear menu inline styles after load', err);
            }
        }, 100);
    } catch (e) {
        console.error("Error in parseAndRender:", e);
        alignmentContainer.innerHTML = `<div class="error-message">вќЊ ${e.message}</div>`;
        showMessage(`Error: ${e.message}`, 5000);
        // рџ‘‡ Reset filename on error to avoid poisoning future loads
        state.currentFilename = '';
        el('sourceInfo').innerHTML = 'No file loaded';
    }
}
function onModeChange() {
    const container = el('blockSizeContainer');
    if (container) {
        container.style.display = el('modeBlocks').checked ? 'flex' : 'none';
    }
    renderAlignment();
    setupHoverMenuReveal();
}
function onShadeModeChange() {
    validateThresholds();
    debounceRender();
}
// Color picker logic for Black, Dark, Light
['black', 'dark', 'light'].forEach(function(shade) {
    const label = document.getElementById(shade + 'Label');
    const picker = document.getElementById(shade + 'ColorPicker');
    const slider = document.getElementById(shade + 'Slider');
    if (label && picker) {
        // Show picker on hover instead of click
        label.addEventListener('mouseenter', function() {
            picker.style.display = 'inline-block';
        });
        label.addEventListener('mouseleave', function() {
            // Hide picker when mouse leaves both label and picker
            setTimeout(() => {
                if (!label.matches(':hover') && !picker.matches(':hover')) {
                    picker.style.display = 'none';
                }
            }, 100);
        });
        picker.addEventListener('mouseleave', function() {
            // Hide picker when mouse leaves picker
            setTimeout(() => {
                if (!label.matches(':hover') && !picker.matches(':hover')) {
                    picker.style.display = 'none';
                }
            }, 100);
        });
        picker.addEventListener('input', function() {
            // Update CSS variable for slider fill
            slider.style.setProperty('--slider-fill', picker.value);
            // Also update the corresponding CSS variable for alignment shading if needed
            document.documentElement.style.setProperty('--' + shade + 'Shading', picker.value);
            // Compute readable text color (black or white) based on chosen color brightness
            try {
                const hex = (picker.value || '#000').replace('#', '');
                const r = parseInt(hex.substring(0,2), 16) || 0;
                const g = parseInt(hex.substring(2,4), 16) || 0;
                const b = parseInt(hex.substring(4,6), 16) || 0;
                const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                const textColor = brightness > 128 ? '#000' : '#fff';
                document.documentElement.style.setProperty('--' + shade + 'Text', textColor);
            } catch (err) {
                // ignore
            }
            // Update slider background
            updateSliderBackground(slider);
            // Optionally re-render alignment if color affects display
            if (typeof renderAlignment === 'function') {
                renderAlignment();
            }
        });
    }
});

// Reset button functionality for color pickers
['black', 'dark', 'light'].forEach(function(shade) {
    const resetButton = document.getElementById(shade + 'Reset');
    const picker = document.getElementById(shade + 'ColorPicker');
    const slider = document.getElementById(shade + 'Slider');
    
    if (resetButton && picker) {
        resetButton.addEventListener('click', function() {
            // Reset to default colors
            const defaultColors = {
                'black': '#000000',
                'dark': '#555555', 
                'light': '#cccccc'
            };
            
            const defaultColor = defaultColors[shade];
            picker.value = defaultColor;
            
            // Update CSS variable for slider fill
            slider.style.setProperty('--slider-fill', defaultColor);
            // Update the corresponding CSS variable for alignment shading
            document.documentElement.style.setProperty('--' + shade + 'Shading', defaultColor);
            
            // Compute readable text color
            try {
                const hex = (defaultColor || '#000').replace('#', '');
                const r = parseInt(hex.substring(0,2), 16) || 0;
                const g = parseInt(hex.substring(2,4), 16) || 0;
                const b = parseInt(hex.substring(4,6), 16) || 0;
                const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                const textColor = brightness > 128 ? '#000' : '#fff';
                document.documentElement.style.setProperty('--' + shade + 'Text', textColor);
            } catch (err) {
                // ignore
            }
            
            // Update slider background and re-render
            updateSliderBackground(slider);
            if (typeof renderAlignment === 'function') {
                renderAlignment();
            }
        });
    }
});

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
        // рџ‘‰ No else clause вЂ” click without Ctrl/Shift copies name (handled in nameSpan.click)
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
            
            scheduleNucSelectionRefresh();
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
            scheduleNucSelectionRefresh();
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
            
            scheduleNucSelectionRefresh();
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
    // рџ‘‰ No handler for plain click on span вЂ” do nothing
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
                scheduleNucSelectionRefresh();
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
    // If focus is in the sequence entry box, do not interfere with standard shortcuts
    if (document.activeElement === fastaInput) return;
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
            case '0':
                // Reset zoom to 100%
                el('zoomSlider').value = 100;
                setZoom(100);
                e.preventDefault();
                break;
            case 'm':
                // Toggle all menu sections
                toggleAllSections();
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
    
    // Navigation shortcuts (non-Ctrl)
    if (e.key === 'F3') {
        if (e.shiftKey) {
            // Previous search result (placeholder for future implementation)
            showMessage("Previous search result (not implemented)", 2000);
        } else {
            // Next search result (placeholder for future implementation) 
            showMessage("Next search result (not implemented)", 2000);
        }
        e.preventDefault();
    }
    
    // Page navigation for large alignments
    if (e.key === 'PageUp' || e.key === 'PageDown') {
        const container = alignmentContainer;
        const direction = e.key === 'PageUp' ? -1 : 1;
        const scrollAmount = container.clientHeight * 0.8;
        container.scrollTop += direction * scrollAmount;
        e.preventDefault();
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
    const trimmedNucText = nucText.trim();
    if (trimmedNucText) {
        const previewSource = trimmedNucText.replace(/\s+/g, ' ');
        const preview = previewSource.length > 50 ? previewSource.slice(0, 50) + 'вЂ¦' : previewSource;
        const baseCount = trimmedNucText.replace(/\s+/g, '').length;
        navigator.clipboard.writeText(trimmedNucText).then(() => {
            showMessage(`Copied ${baseCount} bp: ${preview}`, 4000);
        }).catch(err => {
            console.error('Copy failed:', err);
            showMessage("Failed to copy. Check console.", 5000);
        });
        return;
    }
    // рџ‘‡ Removed "No sequence selected" message вЂ” silent if nothing to copy
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
    const threshold = clampConsensusPercent(el('consensusThreshold').value) / 100;
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
    const threshold = clampGroupConsensusPercent(el('groupConsensusThreshold').value);  // % value from slider (e.g., 70)
    const groupSize = selectedSeqs.length;
    const plurality = Math.ceil(groupSize * threshold / 100);  // NEW: Absolute min support, like your $plur
    let cons = '';
    for (let pos = 0; pos < len; pos++) {
        const fullCol = selectedSeqs.map(s => s[pos] || '-');
        const nonGapCol = fullCol.filter(b => b !== '-' && b !== '.');
        if (nonGapCol.length === 0) {
            cons += '-';
            continue;
        }
        const counts = {};
        nonGapCol.forEach(b => counts[b] = (counts[b] || 0) + 1);
        const maxCount = Math.max(...Object.values(counts));
        const maxBases = Object.keys(counts).filter(b => counts[b] === maxCount).sort();  // Stable tie-break
        if (maxCount >= plurality) {  // CHANGED: Absolute check vs. plurality
            cons += maxBases[0];  // Pick first after sort
        } else {
            cons += '-';
        }
    }
    const consObj = { header: 'Group_Consensus', fullHeader: 'Consensus of selected group', seq: cons, gaplessPositions: calculateGaplessPositions(cons) };
    const insertPos = indices[indices.length - 1] + 1;
    state.seqs.splice(insertPos, 0, consObj);
    renderAlignment();
    showMessage("Group consensus inserted!", 2000);
}

function replaceSelectedWithConsensus() {
    if (state.selectedRows.size < 2) {
        showMessage("Select at least 2 sequences to create consensus.", 3000);
        return;
    }
    
    const indices = Array.from(state.selectedRows).sort((a, b) => a - b);
    const selectedSeqs = indices.map(i => state.seqs[i].seq);
    const len = Math.max(...selectedSeqs.map(s => s.length));
    const threshold = clampGroupConsensusPercent(el('groupConsensusThreshold').value) / 100;
    
    // Generate consensus sequence
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
    
    // Create consensus name based on selected sequence indices
    const firstIdx = indices[0] + 1; // 1-based for display
    const lastIdx = indices[indices.length - 1] + 1;
    const consName = `cons_seq${firstIdx}-${lastIdx}`;
    
    // Save to history
    state.deletedHistory.push({
        type: 'replaceWithConsensus',
        seqs: JSON.parse(JSON.stringify(state.seqs)),
        selectedRows: new Set(state.selectedRows),
        selectedColumns: new Set(state.selectedColumns)
    });
    
    // Remove selected sequences (from end to start to preserve indices)
    for (let i = indices.length - 1; i >= 0; i--) {
        state.seqs.splice(indices[i], 1);
    }
    
    // Insert consensus at the position of the first selected sequence
    const consObj = { 
        header: consName, 
        fullHeader: `Consensus of sequences ${firstIdx}-${lastIdx}`, 
        seq: cons, 
        gaplessPositions: calculateGaplessPositions(cons) 
    };
    state.seqs.splice(indices[0], 0, consObj);
    
    // Clear selection
    state.selectedRows.clear();
    
    renderAlignment();
    showMessage(`Replaced ${indices.length} sequences with consensus: ${consName}`, 3000);
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
        let value = p[k];
        if (k === 'consensusThreshold') {
            value = clampConsensusPercent(value);
            setConsensusThresholdUI(value);
            return;
        }
        if (k === 'groupConsensusThreshold') {
            value = clampGroupConsensusPercent(value);
            setGroupConsensusThresholdUI(value);
            return;
        }
        const sliderEl = el(k + 'Slider');
        if (sliderEl) {
            sliderEl.value = value;
            updateSliderBackground(sliderEl);
        }
        const inputElement = el(k + 'Input');
        if (inputElement) inputElement.value = value;
        if (k === 'nameLen') {
            document.documentElement.style.setProperty('--nameLen', value);
        }
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
    controls.style.display = 'none';
    // Reset any overlay positioning
    controls.style.position = '';
    controls.style.top = '';
    controls.style.left = '';
    controls.style.right = '';
    controls.style.zIndex = '';
    controls.style.boxShadow = '';
    minimizeBar.style.display = 'block';
    // Move alignment up to fill the space
    alignmentContainer.style.top = '0';
}
function expandMenu() {
    minimizeBar.style.display = 'none';
    const controls = el('controls');
    controls.style.display = 'grid';
    // Reset any overlay positioning
    controls.style.position = '';
    controls.style.top = '';
    controls.style.left = '';
    controls.style.right = '';
    controls.style.zIndex = '';
    controls.style.boxShadow = '';
    // Move alignment back down
    const menuHeight = controls.offsetHeight;
    alignmentContainer.style.top = menuHeight + 'px';
}
function findFuzzyPositions(degapped, motif, maxMismatches) {
    const positions = [];
    for (let i = 0; i <= degapped.length - motif.length; i++) {
        let mismatches = 0;
        for (let j = 0; j < motif.length; j++) {
            if (degapped[i + j] !== motif[j]) {
                mismatches++;
                if (mismatches > maxMismatches) break;
            }
        }
        if (mismatches <= maxMismatches) {
            positions.push(i);
        }
    }
    return positions;
}

function updateActiveSearchesPanel() {
    const panel = el('activeSearches');
    const list = el('searchList');
    
    if (state.searchHistory.length === 0) {
        panel.style.display = 'none';
        return;
    }
    
    panel.style.display = 'block';
    list.innerHTML = '';
    
    state.searchHistory.forEach((search, index) => {
        const item = document.createElement('div');
        item.className = 'search-item';
        
        const swatch = document.createElement('div');
        swatch.className = 'search-swatch';
        swatch.style.backgroundColor = search.color;
        
        const text = document.createElement('span');
        text.textContent = `${search.motif} (${search.matchCount || 0})`;
        
        const remove = document.createElement('button');
        remove.className = 'search-remove';
        remove.innerHTML = 'Г—';
        remove.title = 'Remove this search';
        remove.addEventListener('click', () => {
            // Remove this specific search
            document.querySelectorAll(`.${search.className}`).forEach(span => span.classList.remove(search.className));
            document.querySelector(`style[data-motif="${search.motif}"]`)?.remove();
            state.searchHistory.splice(index, 1);
            updateActiveSearchesPanel();
        });
        
        item.appendChild(swatch);
        item.appendChild(text);
        item.appendChild(remove);
        list.appendChild(item);
    });
}

function searchMotif() {
    const raw = el('searchInput').value || '';
    const motif = raw.trim().replace(/\s+/g, '').toUpperCase();
    if (!motif) return;
    const color = el('searchColor').value;
    const maxMismatches = parseInt(el('maxMismatches').value) || 0;
    const className = 'search-hit-' + Math.random().toString(36).substring(2, 12) + btoa(motif).replace(/=/g, '').substring(0, 5);

    // Remove any existing identical motif highlights first
    state.searchHistory = state.searchHistory.filter(item => {
        if (item.motif === motif) {
            document.querySelectorAll(`.${item.className}`).forEach(span => span.classList.remove(item.className));
            document.querySelector(`style[data-motif="${item.motif}"]`)?.remove();
            return false;
        }
        return true;
    });

    const style = document.createElement('style');
    style.textContent = `.${className} { background-color: ${color} !important; color: black !important; font-weight: bold; }`;
    style.setAttribute('data-motif', motif);
    document.head.appendChild(style);

    // For each sequence row, map degapped indices back to span elements robustly
    let totalMatches = 0;
    let sequencesWithMatches = 0;
    document.querySelectorAll('.seq-line:not(.consensus-line)').forEach(row => {
        const index = parseInt(row.dataset.seqIndex);
        if (isNaN(index) || index < 0 || index >= state.seqs.length) return;
        const dataSpan = row.querySelector('.seq-data');
        if (!dataSpan) return;
        const spans = Array.from(dataSpan.children);

        // Build mapping and the displayed degapped string from the visible spans only
        const nonGapSpanIndices = [];
        const displayedChars = [];
        for (let si = 0; si < spans.length; si++) {
            const ch = (spans[si].textContent || '').toUpperCase();
            if (ch !== '-' && ch !== '.') {
                nonGapSpanIndices.push(si);
                displayedChars.push(ch);
            }
        }
        const displayedDegapped = displayedChars.join('');
        if (displayedDegapped.length < motif.length) return;

        // Find fuzzy matches in the displayed (visible) degapped sequence
        const fuzzyPositions = findFuzzyPositions(displayedDegapped, motif, maxMismatches);
        let matchesThisSeq = fuzzyPositions.length;
        totalMatches += matchesThisSeq;
        
        for (let seqPos of fuzzyPositions) {
            for (let k = 0; k < motif.length; k++) {
                const spanIdx = nonGapSpanIndices[seqPos + k];
                if (spanIdx !== undefined) spans[spanIdx].classList.add(className);
            }
        }
        
        if (matchesThisSeq > 0) sequencesWithMatches++;
    });

    // Add to search history with match count
    const searchEntry = { motif, color, className, matchCount: totalMatches, maxMismatches };
    state.searchHistory.push(searchEntry);
    
    // Update active searches panel
    updateActiveSearchesPanel();
    
    // Leave the search term in the input so users can refine it; show counts
    if (totalMatches === 0) {
        showMessage(`No matches for "${motif}"${maxMismatches > 0 ? ` (в‰¤${maxMismatches} mismatches)` : ''}`, 3000);
    } else {
        const mismatchText = maxMismatches > 0 ? ` (в‰¤${maxMismatches} mismatches)` : '';
        showMessage(`Found ${totalMatches} match${totalMatches>1? 'es':''} in ${sequencesWithMatches} sequence${sequencesWithMatches>1? 's':''}${mismatchText}`, 4000);
    }
}
function clearLastSearch() {
    if (state.searchHistory.length === 0) {
        showMessage("No searches to clear.", 3000);
        return;
    }
    const last = state.searchHistory.pop();
    document.querySelectorAll(`.${last.className}`).forEach(span => span.classList.remove(last.className));
    document.querySelector(`style[data-motif="${last.motif}"]`)?.remove();
    updateActiveSearchesPanel();
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
    updateActiveSearchesPanel();
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
let contextMenuHighlightedRow = null;

function closeContextMenu() {
    if (contextMenu) {
        contextMenu.remove();
        contextMenu = null;
    }
    // Remove highlight
    if (contextMenuHighlightedRow !== null) {
        document.querySelectorAll(`.seq-line[data-seq-index="${contextMenuHighlightedRow}"]`)
            .forEach(line => line.classList.remove('context-menu-highlight'));
        contextMenuHighlightedRow = null;
    }
}

function showContextMenu(e, index) {
    closeContextMenu();
    
    // Highlight the sequence this menu is for
    contextMenuHighlightedRow = index;
    document.querySelectorAll(`.seq-line[data-seq-index="${index}"]`)
        .forEach(line => line.classList.add('context-menu-highlight'));
    
    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    
    // Temporarily position off-screen to measure height
    contextMenu.style.visibility = 'hidden';
    contextMenu.style.left = `${e.pageX}px`;
    contextMenu.style.top = `${e.pageY}px`;
    const copyFastaGapped = document.createElement('div');
    copyFastaGapped.textContent = 'Copy as FASTA gapped';
    copyFastaGapped.addEventListener('click', () => {
        copySequences(true, true, index);
        closeContextMenu();
    });
    const copyFastaUngapped = document.createElement('div');
    copyFastaUngapped.textContent = 'Copy as FASTA ungapped';
    copyFastaUngapped.addEventListener('click', () => {
        copySequences(false, true, index);
        closeContextMenu();
    });
    const copyPlainGapped = document.createElement('div');
    copyPlainGapped.textContent = 'Copy as plain text gapped';
    copyPlainGapped.addEventListener('click', () => {
        copySequences(true, false, index);
        closeContextMenu();
    });
    const copyPlainUngapped = document.createElement('div');
    copyPlainUngapped.textContent = 'Copy as plain text ungapped';
    copyPlainUngapped.addEventListener('click', () => {
        copySequences(false, false, index);
        closeContextMenu();
    });
    contextMenu.appendChild(copyFastaGapped);
    contextMenu.appendChild(copyFastaUngapped);
    contextMenu.appendChild(copyPlainGapped);
    contextMenu.appendChild(copyPlainUngapped);
    
    // Add color-specific copy options if this sequence has a color
    const seqName = state.seqs[index].header;
    if (colourState.mappings.has(seqName)) {
        const separator1 = document.createElement('div');
        separator1.style.borderTop = '1px solid #ccc';
        separator1.style.margin = '4px 0';
        contextMenu.appendChild(separator1);
        
        const colour = colourState.mappings.get(seqName);
        const colorLabel = document.createElement('div');
        colorLabel.textContent = `Color: ${colour}`;
        colorLabel.style.fontSize = '11px';
        colorLabel.style.color = '#666';
        colorLabel.style.padding = '2px 0';
        contextMenu.appendChild(colorLabel);
        
        const copySameColorGapped = document.createElement('div');
        copySameColorGapped.textContent = 'Copy this color (gapped)';
        copySameColorGapped.addEventListener('click', () => {
            copySequencesByColor(colour, true, true);
            closeContextMenu();
        });
        
        const copySameColorUngapped = document.createElement('div');
        copySameColorUngapped.textContent = 'Copy this color (ungapped)';
        copySameColorUngapped.addEventListener('click', () => {
            copySequencesByColor(colour, false, true);
            closeContextMenu();
        });
        
        contextMenu.appendChild(copySameColorGapped);
        contextMenu.appendChild(copySameColorUngapped);
    }
    
    // Add "Replace with Consensus" option if multiple sequences selected
    if (state.selectedRows.size >= 2) {
        const replaceConsensusItem = document.createElement('div');
        replaceConsensusItem.textContent = `Replace ${state.selectedRows.size} selected with consensus`;
        replaceConsensusItem.addEventListener('click', () => {
            replaceSelectedWithConsensus();
            closeContextMenu();
        });
        contextMenu.appendChild(replaceConsensusItem);
        
        // Add separator
        const separator = document.createElement('div');
        separator.style.borderTop = '1px solid #ccc';
        separator.style.margin = '4px 0';
        contextMenu.appendChild(separator);
    }
    
    const deleteItem = document.createElement('div');
    deleteItem.textContent = state.selectedRows.size > 1 ? 'Delete selected' : 'Delete sequence';
    deleteItem.addEventListener('click', () => {
        if (state.selectedRows.size > 1) {
            deleteSelected();
        } else {
            deleteSequence(index);
        }
        closeContextMenu();
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
            closeContextMenu();
        });
        contextMenu.appendChild(renameItem);
    }
    const clearSelItem = document.createElement('div');
    clearSelItem.textContent = 'Clear selection';
    clearSelItem.addEventListener('click', () => {
        state.selectedRows.clear();
        state.selectedColumns.clear();
        state.selectedNucs.clear();
        state.pendingNucStart = null;
        updateRowSelections();
        updateColumnSelections();
        scheduleNucSelectionRefresh();
        closeContextMenu();
    });
    contextMenu.appendChild(clearSelItem);
    // Add insert/remove single gap if on span
    if (e.target.tagName === 'SPAN' && e.target.parentNode.className === 'seq-data') {
        const pos = parseInt(e.target.dataset.pos);
        const insertGapItem = document.createElement('div');
        insertGapItem.textContent = 'Insert Single Gap Here';
        insertGapItem.addEventListener('click', () => {
            insertSingleGap(index, pos);
            closeContextMenu();
        });
        contextMenu.appendChild(insertGapItem);
        const removeGapItem = document.createElement('div');
        removeGapItem.textContent = 'Remove Single Gap Here';
        removeGapItem.addEventListener('click', () => {
            removeSingleGap(index, pos);
            closeContextMenu();
        });
        contextMenu.appendChild(removeGapItem);
    }
    document.body.appendChild(contextMenu);
    
    // Adjust position if menu would overflow viewport
    const menuRect = contextMenu.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    // Check vertical overflow
    if (menuRect.bottom > viewportHeight) {
        // Position above the cursor instead
        const newTop = e.pageY - menuRect.height;
        contextMenu.style.top = `${Math.max(0, newTop)}px`;
    }
    
    // Check horizontal overflow
    if (menuRect.right > viewportWidth) {
        // Position to the left of the cursor instead
        const newLeft = e.pageX - menuRect.width;
        contextMenu.style.left = `${Math.max(0, newLeft)}px`;
    }
    
    // Make visible after positioning
    contextMenu.style.visibility = 'visible';
    
    // Close menu when clicking outside
    const closeOnClickOutside = (event) => {
        if (contextMenu && !contextMenu.contains(event.target)) {
            contextMenu.remove();
            // Remove highlight when menu closes
            if (contextMenuHighlightedRow !== null) {
                document.querySelectorAll(`.seq-line[data-seq-index="${contextMenuHighlightedRow}"]`)
                    .forEach(line => line.classList.remove('context-menu-highlight'));
                contextMenuHighlightedRow = null;
            }
            document.removeEventListener('click', closeOnClickOutside);
        }
    };
    // Use setTimeout to avoid immediate closure from the same click that opened the menu
    setTimeout(() => {
        document.addEventListener('click', closeOnClickOutside);
    }, 0);
}
function updateRowSelections() {
    document.querySelectorAll('.seq-line.selected').forEach(line => line.classList.remove('selected'));
    document.querySelectorAll('.seq-name.selected').forEach(name => name.classList.remove('selected'));
    state.selectedRows.forEach(index => {
        document.querySelectorAll(`.seq-line[data-seq-index="${index}"]`).forEach(line => line.classList.add('selected'));
        document.querySelectorAll(`.seq-name[data-seq-index="${index}"]`).forEach(name => name.classList.add('selected'));
    });
}
function updateColumnSelections() {
    state.domSelectedColumns.forEach(spanSet => {
        spanSet.forEach(span => span.classList.remove('column-selected'));
    });
    state.domSelectedColumns = new Map();
    if (!state.spanCache) return;
    state.selectedColumns.forEach(pos => {
        const spanSet = new Set();
        state.spanCache.forEach(rowMap => {
            const span = rowMap.get(pos);
            if (!span) return;
            span.classList.add('column-selected');
            spanSet.add(span);
        });
        if (spanSet.size > 0) {
            state.domSelectedColumns.set(pos, spanSet);
        }
    });
}

let pendingNucDomUpdate = false;

function detachNucSelectedHandlers(span) {
    if (span.dataset.nucSelectedBound !== '1') return;
    const handlers = span._nucSelectedHandlers;
    if (handlers) {
        span.removeEventListener('mouseover', handlers.mouseover);
        span.removeEventListener('mouseout', handlers.mouseout);
        span.removeEventListener('click', handlers.click);
    }
    delete span._nucSelectedHandlers;
    delete span.dataset.nucSelectedBound;
}

function detachNucPendingHandlers(span) {
    if (span.dataset.nucPendingBound !== '1') return;
    const handlers = span._nucPendingHandlers;
    if (handlers) {
        span.removeEventListener('mouseover', handlers.mouseover);
        span.removeEventListener('mouseout', handlers.mouseout);
    }
    delete span._nucPendingHandlers;
    delete span.dataset.nucPendingBound;
}

function attachNucSelectedHandlers(span) {
    if (span.dataset.nucSelectedBound === '1') return;
    const mouseover = () => {
        showTooltipAt('Copy', span);
    };
    const mouseout = () => {
        hideTooltip();
    };
    const click = (event) => {
        event.stopPropagation();
        event.preventDefault();
        copySelected();
    };
    span.addEventListener('mouseover', mouseover);
    span.addEventListener('mouseout', mouseout);
    span.addEventListener('click', click);
    span.dataset.nucSelectedBound = '1';
    span._nucSelectedHandlers = { mouseover, mouseout, click };
}

function attachNucPendingHandlers(span) {
    if (span.dataset.nucPendingBound === '1') return;
    const mouseover = () => {
        showTooltipAt('Selection start - Ctrl+click another nucleotide to complete range', span);
    };
    const mouseout = () => {
        hideTooltip();
    };
    span.addEventListener('mouseover', mouseover);
    span.addEventListener('mouseout', mouseout);
    span.dataset.nucPendingBound = '1';
    span._nucPendingHandlers = { mouseover, mouseout };
}

function refreshNucleotideSelectionsImmediate() {
    const container = alignmentContainer;
    if (!container) return;
    const desiredSelections = state.selectedNucs;

    // Remove selections that are no longer desired
    for (const [row, posMap] of Array.from(state.domSelectedNucs.entries())) {
        const desiredSet = desiredSelections.get(row);
        if (!desiredSet || desiredSet.size === 0) {
            for (const [pos, span] of Array.from(posMap.entries())) {
                span.classList.remove('nuc-selected');
                detachNucSelectedHandlers(span);
                posMap.delete(pos);
            }
            state.domSelectedNucs.delete(row);
            continue;
        }
        for (const [pos, span] of Array.from(posMap.entries())) {
            if (!desiredSet.has(pos)) {
                span.classList.remove('nuc-selected');
                detachNucSelectedHandlers(span);
                posMap.delete(pos);
            }
        }
        if (posMap.size === 0) {
            state.domSelectedNucs.delete(row);
        }
    }

    // Add new selections
    desiredSelections.forEach((posSet, row) => {
        posSet.forEach(pos => {
            if (!state.domSelectedNucs.get(row)?.has(pos)) {
                const span = getCachedSpan(row, pos);
                if (!span) return;
                span.classList.add('nuc-selected');
                attachNucSelectedHandlers(span);
                let rowMap = state.domSelectedNucs.get(row);
                if (!rowMap) {
                    rowMap = new Map();
                    state.domSelectedNucs.set(row, rowMap);
                }
                rowMap.set(pos, span);
            }
        });
    });

    // Update pending indicator
    if (state.domPendingNuc) {
        const { span } = state.domPendingNuc;
        span.classList.remove('nuc-pending');
        detachNucPendingHandlers(span);
        state.domPendingNuc = null;
    }
    if (state.pendingNucStart) {
        const { row, pos } = state.pendingNucStart;
        const span = getCachedSpan(row, pos);
        if (span && !span.classList.contains('nuc-selected')) {
            span.classList.add('nuc-pending');
            attachNucPendingHandlers(span);
            state.domPendingNuc = { row, pos, span };
        }
    }
}

function scheduleNucSelectionRefresh() {
    if (pendingNucDomUpdate) return;
    pendingNucDomUpdate = true;
    const raf = (typeof window !== 'undefined' && window.requestAnimationFrame)
        ? window.requestAnimationFrame.bind(window)
        : (cb) => setTimeout(cb, 16);
    raf(() => {
        pendingNucDomUpdate = false;
        refreshNucleotideSelectionsImmediate();
    });
}
// EVENT LISTENERS
function initializeAppUI() {
    // This function is called once the DOM is fully loaded.
    
    // Initialize source info
    el('sourceInfo').innerHTML = 'No file loaded';
    
    // Initialize collapsible sections
    try {
        initializeCollapsibleSections();
        restoreCollapsedState();
    } catch (err) {
        console.warn('Failed to initialize collapsible sections', err);
    }

    // No longer needed - hover handles all menu display
    setTimeout(() => {
        try {
            // Clear any inline styles that might interfere with hover
            document.querySelectorAll('.control-group').forEach(group => {
                group.style.maxHeight = '';
                group.style.display = '';
            });
        } catch (err) {
            console.warn('Failed to clear menu styles', err);
        }
    }, 50);
    
    // Use existing global DOM element references
    let contextMenu = null;

    if (dropZone) {
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
                alignmentContainer.innerHTML = '<div class="error-message">вќЊ Error reading file.</div>';
                showMessage("Error reading file.", 5000);
            };
            reader.readAsText(file);
        });
        dropZone.addEventListener('click', (e) => {
            if (window.getSelection().toString()) return;
            const fileInput = el('fileInput');
            fileInput.value = '';
            fileInput.click();
        });
    }
    
    el('fileInput')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        state.currentFilename = file.name;
        const reader = new FileReader();
        reader.onload = function(evt) {
            fastaInput.value = evt.target.result;
            parseAndRender(true);
        };
        reader.onerror = () => {
            alignmentContainer.innerHTML = '<div class="error-message">вќЊ Error reading file.</div>';
            showMessage("Error reading file.", 5000);
        };
        reader.readAsText(file);
    });
    
    fastaInput?.addEventListener('paste', () => {
        setTimeout(() => {
            parseAndRender(false);
        }, 100);
    });
    
    // Attach listeners to all buttons
    const buttonActions = {
        'clearButton': () => fastaInput.value = '',
        'loadButton': () => parseAndRender(false),
        'reverseComplementButton': reverseComplementSelected,
        'copySelectedButton': copySelected,
        'deleteSelectedButton': deleteSelected,
        'undoButton': undoDelete,
        'moveUpButton': moveSelectedUp,
        'moveDownButton': moveSelectedDown,
        'moveToTopButton': moveSelectedToTop,
        'moveToBottomButton': moveSelectedToBottom,
        'insertGroupConsensusButton': insertGroupConsensus,
        'duplicateButton': duplicateSelected,
        'openInNewTabButton': openSelectedInNewTab,
        'selectAllButton': selectAllSequences,
        'copyColumnsButton': copySelectedColumns,
        'deleteColumnsButton': deleteSelectedColumns,
        'realignBlockButton': realignSelectedBlock,
        'savePresetButton': savePreset,
        'loadPresetButton': loadPreset,
        'infoButton': openInfoModal,
        'minimizeBtn': minimizeMenu,
        'zoomInButton': () => adjustZoom(10),
        'zoomOutButton': () => adjustZoom(-10),
        'searchButton': searchMotif,
        'clearLastSearchButton': clearLastSearch,
        'clearAllSearchesButton': clearAllSearches,
        'copyConsensusButton': copyConsensus,
        'copySelectedConsensusButton': copySelectedConsensus,
        'removeGapColumnsButton': removeGapColumns,
        'insertGapColumnAllButton': () => insertGapColumn(true),
        'insertGapColumnExceptButton': () => insertGapColumn(false)
    };

    for (const id in buttonActions) {
        el(id)?.addEventListener('click', buttonActions[id]);
    }

    const searchInputEl = el('searchInput');
    if (searchInputEl) {
        searchInputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchMotif();
            }
        });
    }
    
    minimizeBar?.addEventListener('click', expandMenu);
    el('expandButton')?.addEventListener('click', expandMenu);
    
    // UI listener wiring
    attachUIListeners();

    // Apply default consensus thresholds
    setConsensusThresholdUI(DEFAULTS.consensusThreshold);
    setGroupConsensusThresholdUI(DEFAULTS.groupConsensusThreshold);
    setNameLengthUI(DEFAULTS.nameLength);

    // Set initial state for controls
    el('modeBlocks').checked = true;
    el('modeSingle').checked = false;
    document.querySelector('input[name="consensusPosition"][value="bottom"]').checked = true;
    
    // Trigger initial render/setup based on defaults
    onModeChange();
    toggleStickyNames();
    
    // Initialize menu height and positioning
    const controls = el('controls');
    let menuHeight = 0;
    setTimeout(() => {
        if (controls) {
            menuHeight = controls.offsetHeight;
            if (alignmentContainer) alignmentContainer.style.top = menuHeight + 'px';
        }
    }, 100);
    
    // Initialize slider backgrounds
    ['blackSlider', 'darkSlider', 'lightSlider', 'nameLengthSlider', 'zoomSlider', 'blockSizeSlider', 'consensusThreshold', 'groupConsensusThreshold'].forEach(id => {
        const slider = el(id);
        if (slider) {
            updateSliderBackground(slider);
        }
    });
    
    // Setup menu stability to prevent flickering on mouse movement
    setupMenuStability();
    
    // Initialize colour seqs feature
    initColourSeqs();
}

document.addEventListener('DOMContentLoaded', initializeAppUI);

// UI listener wiring is wrapped in a function so we can attach listeners after DOMContentLoaded
function attachUIListeners() {
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
            const renderCb = debounceRender;
            slider.addEventListener('input', () => {
                if (sliderId === 'consensusThreshold') {
                    const clamped = clampConsensusPercent(slider.value);
                    slider.value = clamped;
                    input.value = clamped;
                } else if (sliderId === 'groupConsensusThreshold') {
                    const clamped = clampGroupConsensusPercent(slider.value);
                    slider.value = clamped;
                    input.value = clamped;
                } else if (sliderId === 'nameLengthSlider') {
                    const clamped = clampNameLength(slider.value);
                    slider.value = clamped;
                    input.value = clamped;
                    document.documentElement.style.setProperty('--nameLen', clamped);
                } else {
                    input.value = slider.value;
                }
                updateSliderBackground(slider);
                if (sliderId.includes('black') || sliderId.includes('dark') || sliderId.includes('light')) {
                    validateThresholds();
                }
                renderCb();
            });

            input.addEventListener('input', () => {
                if (sliderId === 'consensusThreshold') {
                    const clamped = clampConsensusPercent(input.value);
                    slider.value = clamped;
                    input.value = clamped;
                } else if (sliderId === 'groupConsensusThreshold') {
                    const clamped = clampGroupConsensusPercent(input.value);
                    slider.value = clamped;
                    input.value = clamped;
                } else if (sliderId === 'nameLengthSlider') {
                    const clamped = clampNameLength(input.value);
                    slider.value = clamped;
                    input.value = clamped;
                    document.documentElement.style.setProperty('--nameLen', clamped);
                } else {
                    slider.value = input.value;
                }
                updateSliderBackground(slider);
                if (inputId.includes('black') || inputId.includes('dark') || inputId.includes('light')) {
                    validateThresholds();
                }
                renderCb();
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
        const elRef = el(id);
        if (elRef) elRef.addEventListener('change', debounceRender);
    });

    const sticky = el('stickyNames');
    if (sticky) sticky.addEventListener('change', toggleStickyNames);

    // Alignment container events
    const alignmentContainer = el('alignmentContainer');
    const controls = el('controls');
    if (alignmentContainer) {
        alignmentContainer.addEventListener('mousedown', handleMouseDown);
        alignmentContainer.addEventListener('mousemove', handleMouseMove);
        alignmentContainer.addEventListener('mousedown', handleAlignmentPanStart);
        alignmentContainer.addEventListener('click', () => {
            // If menu is shown as overlay, hide it when clicking on alignment
            if (controls && controls.style.position === 'fixed' && controls.style.transform !== 'translateY(-100%)') {
                controls.style.transform = 'translateY(-100%)';
                controls.style.position = '';
                controls.style.top = '';
                controls.style.left = '';
                controls.style.right = '';
                controls.style.zIndex = '';
                controls.style.boxShadow = '';
            }
        });
    }

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mouseup', handleAlignmentPanEnd);
    document.addEventListener('mousemove', handleAlignmentPanMove);
    document.addEventListener('contextmenu', handleAlignmentPanContextMenu, true);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    // Use existing global infoModal reference
    document.addEventListener('click', (event) => {
        if (event.target === infoModal) {
            closeInfoModal();
        }
    });

    if (alignmentContainer) {
        let contextMenu = null;
        alignmentContainer.addEventListener('contextmenu', (e) => {
            const name = e.target.closest('.seq-name');
            if (name) {
                e.preventDefault();
                const row = e.target.closest('.seq-line');
                const index = parseInt(row.dataset.seqIndex);
                contextMenu = showContextMenu(e, index, contextMenu);
            } else if (e.target.tagName === 'SPAN' && e.target.parentNode.className === 'seq-data') {
                e.preventDefault();
                const row = e.target.closest('.seq-line');
                const index = parseInt(row.dataset.seqIndex);
                contextMenu = showContextMenu(e, index, contextMenu);
            }
        });
        document.addEventListener('click', () => {
            if (contextMenu) {
                contextMenu.remove();
                contextMenu = null;
            }
        });
    }
}

// Auto-hide menu on scroll
let lastScrollTop = 0;

function setupMenuScrollBehavior() {
    const controls = el('controls');
    const alignmentContainer = el('alignmentContainer');
    if (!controls || !alignmentContainer) return;

    let menuHeight = controls.offsetHeight;

    function updateMenuVisibility() {
        const isHidden = controls.style.transform === 'translateY(-100%)';
        alignmentContainer.style.top = isHidden ? '0' : (menuHeight + 'px');
    }

    alignmentContainer.addEventListener('scroll', () => {
        document.querySelectorAll('.seq-name').forEach(name => {
            name.style.display = 'none';
            name.offsetHeight;
            name.style.display = '';
        });
        
        if (menuHeight === 0) menuHeight = controls.offsetHeight;
        
        const scrollTop = alignmentContainer.scrollTop;
        const wasHidden = controls.style.transform === 'translateY(-100%)';
        
        if (scrollTop > lastScrollTop && scrollTop > 100) {
            controls.style.transform = 'translateY(-100%)';
            Object.assign(controls.style, { position: '', top: '', left: '', right: '', zIndex: '', boxShadow: '' });
        } else if (scrollTop === 0) {
            controls.style.transform = 'translateY(0)';
            Object.assign(controls.style, { position: '', top: '', left: '', right: '', zIndex: '', boxShadow: '' });
        }
        
        const isHidden = controls.style.transform === 'translateY(-100%)';
        if (wasHidden !== isHidden) {
            updateMenuVisibility();
        }
        
        lastScrollTop = scrollTop;
    });

    document.addEventListener('mousemove', (e) => {
        if (e.clientY <= 50 && controls.style.transform === 'translateY(-100%)') {
            controls.style.transform = 'translateY(0)';
            Object.assign(controls.style, { position: 'fixed', top: '0', left: '0', right: '0', zIndex: '1000', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' });
        }
    });
}
//setupMenuScrollBehavior();  // Disabled - using setupHoverMenuReveal() instead
setupHoverMenuReveal();
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
    if (state.panning.active) return;
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

function handleAlignmentPanStart(e) {
    if (e.button !== 2) return;
    if (!alignmentContainer) return;
    // Only pan if NOT on a seq-data or seq-name element
    const dataTarget = e.target.closest('.seq-data');
    const nameTarget = e.target.closest('.seq-name');
    if (dataTarget || nameTarget) return;
    
    e.preventDefault();
    state.panning.active = true;
    state.panning.started = false;
    state.panning.startX = e.clientX;
    state.panning.startY = e.clientY;
    state.panning.scrollLeft = alignmentContainer.scrollLeft;
    state.panning.scrollTop = alignmentContainer.scrollTop;
}

function handleAlignmentPanMove(e) {
    if (!state.panning.active || !alignmentContainer) return;
    
    // Check if right button is still held
    if (e.buttons !== undefined && (e.buttons & 2) === 0) {
        handleAlignmentPanEnd();
        return;
    }
    
    const deltaX = state.panning.startX - e.clientX;
    const deltaY = state.panning.startY - e.clientY;
    
    // Small threshold before activating pan
    if (!state.panning.started) {
        if (Math.abs(deltaX) < 3 && Math.abs(deltaY) < 3) {
            return;
        }
        state.panning.started = true;
    }
    
    e.preventDefault();
    alignmentContainer.scrollLeft = state.panning.scrollLeft + deltaX;
    alignmentContainer.scrollTop = state.panning.scrollTop + deltaY;
}

function handleAlignmentPanEnd() {
    if (!state.panning.active) return;
    state.panning.active = false;
    state.panning.started = false;
}

function handleAlignmentPanContextMenu(e) {
    if (state.panning.started) {
        e.preventDefault();
    }
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
        e.stopPropagation();
    }
});

// Drag handlers are defined at top of file (window.handleDragStart / window.handleDragEnd)

// ============================================================================
// FULL-WINDOW DRAG AND DROP - Add at the very end of script.js
// ============================================================================

(function() {
    // Create overlay element if it doesn't exist
    let dragOverlay = document.getElementById('drag-overlay');
    if (!dragOverlay) {
        dragOverlay = document.createElement('div');
        dragOverlay.id = 'drag-overlay';
        dragOverlay.className = 'drag-overlay hidden';
        // Empty overlay - just visual backdrop
        document.body.appendChild(dragOverlay);
    }

    let dragCounter = 0;

    // Prevent default drag behaviors on entire document
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, function(e) {
            // Only prevent if it's a file drag, not text/element drag
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true); // Use capture phase to catch events early
    });

    // Show overlay when file enters window
    document.body.addEventListener('dragenter', function(e) {
        if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
            dragCounter++;
            dragOverlay.classList.remove('hidden');
            dragOverlay.classList.add('active');
        }
    }, true);

    // Hide overlay when file leaves window
    document.body.addEventListener('dragleave', function(e) {
        if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
            dragCounter--;
            if (dragCounter === 0) {
                dragOverlay.classList.remove('active');
                dragOverlay.classList.add('hidden');
            }
        }
    }, true);

    // Handle file drop on entire window
    document.body.addEventListener('drop', function(e) {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            
            dragCounter = 0;
            dragOverlay.classList.remove('active');
            dragOverlay.classList.add('hidden');
            
            const file = e.dataTransfer.files[0];
            
            // Validate file type
            const validExtensions = ['.fasta', '.fa', '.msf', '.aln', '.clustal', '.txt'];
            const fileName = file.name.toLowerCase();
            const isValid = validExtensions.some(ext => fileName.endsWith(ext));
            
            if (!isValid) {
                showMessage('Please upload a valid alignment file (FASTA, MSF, Clustal, .txt)', 4000);
                return;
            }
            
            // Process the file
            state.currentFilename = file.name;
            const reader = new FileReader();
            reader.onload = function(event) {
                const fastaInputElement = el('fastaInput');
                if (fastaInputElement) {
                    fastaInputElement.value = event.target.result;
                    parseAndRender(true);
                }
            };
            reader.onerror = function() {
                showMessage('Error reading file. Please try again.', 5000);
            };
            reader.readAsText(file);
        }
    }, true);
})();

// Right-click horizontal scroll
window.addEventListener('load', () => {
    if (!alignmentContainer) return;
    let scrolling = false, sx = 0, sl = 0;
    
    alignmentContainer.addEventListener('mousedown', (e) => {
        if (e.button !== 2) return;
        if (e.target.closest('.seq-data, .seq-name')) return;
        scrolling = true;
        sx = e.clientX;
        sl = alignmentContainer.scrollLeft;
    });
    
    document.addEventListener('mousemove', (e) => {
        if (scrolling) alignmentContainer.scrollLeft = sl - (e.clientX - sx);
    });
    
    document.addEventListener('mouseup', () => { scrolling = false; });
    
    alignmentContainer.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('.seq-data, .seq-name')) e.preventDefault();
    });
});

// ============================================================================
// COLOUR SEQUENCE NAMES FEATURE
// ============================================================================

// Copy all sequences with a specific color
function copySequencesByColor(colour, ungapped = false, asFasta = true) {
    const matchingSeqs = [];
    
    state.seqs.forEach((seq, idx) => {
        if (colourState.mappings.get(seq.header) === colour) {
            const seqData = ungapped ? seq.seq.replace(/-/g, '') : seq.seq;
            if (asFasta) {
                matchingSeqs.push(`>${seq.header}\n${seqData}`);
            } else {
                matchingSeqs.push(seqData);
            }
        }
    });
    
    if (matchingSeqs.length === 0) {
        showMessage('No sequences with this color', 2000);
        return;
    }
    
    const text = matchingSeqs.join('\n');
    navigator.clipboard.writeText(text).then(() => {
        showMessage(`Copied ${matchingSeqs.length} sequence(s) with this color`, 2000);
    }).catch(err => {
        showMessage('Failed to copy', 2000);
    });
}

// Sort sequences by their assigned color
function sortSequencesByColor() {
    const colorOrder = new Map();
    let colorIndex = 0;
    
    // First pass: assign order to each color
    state.seqs.forEach((seq) => {
        const color = colourState.mappings.get(seq.header);
        if (color && !colorOrder.has(color)) {
            colorOrder.set(color, colorIndex++);
        }
    });
    
    // Sort: colored seqs first (by color), then uncolored
    const sortedSeqs = [...state.seqs].sort((a, b) => {
        const colorA = colourState.mappings.get(a.header);
        const colorB = colourState.mappings.get(b.header);
        
        const orderA = colorA ? colorOrder.get(colorA) : Infinity;
        const orderB = colorB ? colorOrder.get(colorB) : Infinity;
        
        return orderA - orderB;
    });
    
    // Update state and re-render
    state.seqs = sortedSeqs;
    state.selectedRows.clear();
    renderAlignment();
    showMessage('Sequences sorted by color', 2000);
}

// Group colored sequences at top
function groupColoredSequencesAtTop() {
    const coloredSeqs = [];
    const ungroupedSeqs = [];
    
    state.seqs.forEach((seq) => {
        if (colourState.mappings.has(seq.header)) {
            coloredSeqs.push(seq);
        } else {
            ungroupedSeqs.push(seq);
        }
    });
    
    // Combine: colored at top, then ungrouped
    state.seqs = [...coloredSeqs, ...ungroupedSeqs];
    state.selectedRows.clear();
    renderAlignment();
    showMessage(`Moved ${coloredSeqs.length} colored sequence(s) to top`, 2000);
}

// 10-color discrete palette
const colourPalette = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B88B', '#A9DFBF'
];

// Store current color mappings and presets
let colourState = {
    mappings: new Map(), // seqName -> color (current)
    history: new Map(), // seqName -> [{color, method, timestamp}, ...]
    presets: JSON.parse(localStorage.getItem('seqColourPresets') || '{}')
};

// Levenshtein distance - compare first N characters
function levenshteinDistance(str1, str2, maxChars = 10) {
    const s1 = str1.substring(0, maxChars).toLowerCase();
    const s2 = str2.substring(0, maxChars).toLowerCase();
    const m = s1.length, n = s2.length;
    const dp = Array(n + 1).fill(0).map((_, i) => i);
    
    for (let i = 1; i <= m; i++) {
        let prev = i;
        for (let j = 1; j <= n; j++) {
            const curr = s1[i - 1] === s2[j - 1] ? dp[j - 1] : 1 + Math.min(dp[j], dp[j - 1], prev);
            dp[j] = prev;
            prev = curr;
        }
        dp[0] = i;
    }
    return dp[n];
}

// Cluster sequences by similarity
function clusterByName(seqNames, maxChars = 10, threshold = 3) {
    const clusters = [];
    const assigned = new Set();
    
    for (const name of seqNames) {
        if (assigned.has(name)) continue;
        
        const cluster = [name];
        assigned.add(name);
        
        for (const other of seqNames) {
            if (!assigned.has(other)) {
                if (levenshteinDistance(name, other, maxChars) <= threshold) {
                    cluster.push(other);
                    assigned.add(other);
                }
            }
        }
        clusters.push(cluster);
    }
    return clusters;
}

// Apply color to sequence name elements
function applyColourToSeqNames(mappings) {
    const seqNameElements = document.querySelectorAll('.seq-name');
    seqNameElements.forEach(el => {
        const text = el.textContent.trim();
        if (mappings.has(text)) {
            const colour = mappings.get(text);
            el.setAttribute('style', `background-color: ${colour} !important; color: #000 !important; font-weight: bold !important;`);
            el.title = `Color: ${colour}`;
        } else {
            el.removeAttribute('style');
            el.title = '';
        }
    });
}

// Helper: Record color in history
function recordColorHistory(seqName, color, method) {
    if (!colourState.history.has(seqName)) {
        colourState.history.set(seqName, []);
    }
    colourState.history.get(seqName).push({
        color,
        method,
        timestamp: new Date().toLocaleTimeString()
    });
}

// Pattern matching function
function applyPatternColour() {
    const patternInput = el('colourPatternInput');
    const colourInput = el('colourPatternColor');
    
    if (!patternInput.value.trim()) {
        showMessage('Please enter a pattern', 2000);
        return;
    }
    
    const pattern = patternInput.value.trim();
    const colour = colourInput.value;
    let matchCount = 0;
    
    try {
        const regex = new RegExp(pattern, 'i');
        const seqNameElements = document.querySelectorAll('.seq-name');
        
        seqNameElements.forEach(el => {
            const text = el.textContent.trim();
            if (regex.test(text)) {
                colourState.mappings.set(text, colour);
                recordColorHistory(text, colour, 'Pattern');
                matchCount++;
            }
        });
        
        applyColourToSeqNames(colourState.mappings);
        showMessage(`Applied to ${matchCount} sequence(s)`, 2000);
        
    } catch (e) {
        showMessage(`Invalid regex: ${e.message}`, 3000);
    }
}

// Auto-color by similarity
function autoColourBySimilarity() {
    const maxChars = parseInt(el('colourSimilarityChars').value) || 10;
    const threshold = parseInt(el('colourSimilarityThreshold').value) || 3;
    const mode = document.querySelector('input[name="colourMode"]:checked').value;
    
    const seqNameElements = document.querySelectorAll('.seq-name');
    // Get unique sequence names (each seq appears in multiple blocks)
    const uniqueSeqNames = new Set(Array.from(seqNameElements).map(el => el.textContent.trim()));
    const seqNames = Array.from(uniqueSeqNames);
    
    if (seqNames.length === 0) {
        showMessage('No sequences loaded', 2000);
        return;
    }
    
    // Cluster sequences
    const clusters = clusterByName(seqNames, maxChars, threshold);
    
    // Assign colors based on mode
    clusters.forEach((cluster, clusterIdx) => {
        if (mode === 'discrete') {
            const colour = colourPalette[clusterIdx % colourPalette.length];
            cluster.forEach(name => {
                colourState.mappings.set(name, colour);
                recordColorHistory(name, colour, 'Auto-Similarity');
            });
        } else {
            // Gradient mode - create shades
            const hue = (clusterIdx * 360 / clusters.length) % 360;
            cluster.forEach((name, nameIdx) => {
                const lightness = 50 + (nameIdx * 20 / cluster.length);
                const colour = `hsl(${hue}, 70%, ${Math.min(lightness, 85)}%)`;
                colourState.mappings.set(name, colour);
                recordColorHistory(name, colour, 'Auto-Similarity');
            });
        }
    });
    
    applyColourToSeqNames(colourState.mappings);
    showMessage(`Colored ${seqNames.length} sequences in ${clusters.length} cluster(s)`, 2000);
}

// Save preset
function saveColourPreset() {
    const presetName = el('colourPresetName').value.trim();
    
    if (!presetName) {
        showMessage('Please enter a preset name', 2000);
        return;
    }
    
    if (colourState.mappings.size === 0) {
        showMessage('No colors to save', 2000);
        return;
    }
    
    colourState.presets[presetName] = Array.from(colourState.mappings.entries());
    localStorage.setItem('seqColourPresets', JSON.stringify(colourState.presets));
    
    el('colourPresetName').value = '';
    updateColourPresetList();
    showMessage(`Preset '${presetName}' saved`, 2000);
}

// Load preset
function loadColourPreset() {
    if (Object.keys(colourState.presets).length === 0) {
        showMessage('No saved presets', 2000);
        return;
    }
    
    const presetNames = Object.keys(colourState.presets);
    const presetName = presetNames[0]; // TODO: could add dialog to select
    
    colourState.mappings = new Map(colourState.presets[presetName]);
    applyColourToSeqNames(colourState.mappings);
    showMessage(`Loaded preset '${presetName}'`, 2000);
}

// Reset all colours
function resetAllColours() {
    colourState.mappings.clear();
    colourState.history.clear();
    const seqNameElements = document.querySelectorAll('.seq-name');
    seqNameElements.forEach(el => {
        el.removeAttribute('style');
        el.title = '';
    });
    showMessage('All colors reset', 2000);
}

// Update preset list display
function updateColourPresetList() {
    const presetList = el('colourPresetList');
    const presetItems = el('presetItems');
    const presets = colourState.presets;
    
    if (Object.keys(presets).length === 0) {
        presetList.style.display = 'none';
        return;
    }
    
    presetList.style.display = 'block';
    presetItems.innerHTML = Object.keys(presets).map(name => 
        `<div style="cursor: pointer; padding: 2px; border-radius: 2px; margin: 2px 0; background: #f0f0f0;" 
              onclick="(function() { 
                colourState.mappings = new Map(colourState.presets['${name}']); 
                applyColourToSeqNames(colourState.mappings); 
                showMessage('Loaded ${name}', 2000);
              })()">
            ${name} <span style="float: right; cursor: pointer; color: #888;" onclick="(function(e) { e.stopPropagation(); delete colourState.presets['${name}']; localStorage.setItem('seqColourPresets', JSON.stringify(colourState.presets)); updateColourPresetList(); })(event)">✕</span>
        </div>`
    ).join('');
}

// Initialize colour seqs feature
// Show color history inspector
function showColorHistory() {
    const modal = el('colourInspectorModal');
    const content = el('colourHistoryContent');
    
    if (colourState.history.size === 0) {
        content.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No colors assigned yet</div>';
        modal.style.display = 'block';
        return;
    }
    
    // Group by sequence name
    let html = '';
    const sortedNames = Array.from(colourState.history.keys()).sort();
    
    sortedNames.forEach(seqName => {
        const history = colourState.history.get(seqName);
        const currentColor = colourState.mappings.get(seqName);
        
        html += `<div style="margin-bottom: 12px; padding: 8px; background: #f9f9f9; border-radius: 3px; border-left: 3px solid ${currentColor};">`;
        html += `<div style="font-weight: bold; margin-bottom: 4px; word-break: break-all;">${seqName}</div>`;
        html += `<div style="font-size: 10px; color: #666; margin-bottom: 6px;">Current: <span style="display: inline-block; width: 12px; height: 12px; background: ${currentColor}; border: 1px solid #ccc; vertical-align: middle;"></span> ${currentColor}</div>`;
        html += `<div style="font-size: 10px;">History:</div>`;
        html += `<div style="margin-left: 8px;">`;
        
        history.forEach((entry, idx) => {
            html += `<div style="margin: 2px 0; display: flex; align-items: center; gap: 6px;">`;
            html += `<span style="color: #999; min-width: 20px;">${idx + 1}.</span>`;
            html += `<span style="display: inline-block; width: 14px; height: 14px; background: ${entry.color}; border: 1px solid #ccc; border-radius: 2px;"></span>`;
            html += `<span>${entry.color}</span>`;
            html += `<span style="color: #0066cc; margin: 0 4px;">← ${entry.method}</span>`;
            html += `<span style="color: #999; font-size: 9px;">${entry.timestamp}</span>`;
            html += `</div>`;
        });
        
        html += `</div></div>`;
    });
    
    content.innerHTML = html;
    modal.style.display = 'block';
}

function initColourSeqs() {
    const patternBtn = el('colourPatternButton');
    const autoBtn = el('colourAutoButton');
    const saveBtn = el('colourSavePresetButton');
    const loadBtn = el('colourLoadPresetButton');
    const resetBtn = el('colourResetButton');
    const sortBtn = el('colourSortButton');
    const groupBtn = el('colourGroupButton');
    const inspectBtn = el('colourInspectButton');
    const thresholdSlider = el('colourSimilarityThreshold');
    const patternInput = el('colourPatternInput');
    
    if (patternBtn) patternBtn.addEventListener('click', applyPatternColour);
    if (autoBtn) autoBtn.addEventListener('click', autoColourBySimilarity);
    if (saveBtn) saveBtn.addEventListener('click', saveColourPreset);
    if (loadBtn) loadBtn.addEventListener('click', loadColourPreset);
    if (resetBtn) resetBtn.addEventListener('click', resetAllColours);
    if (sortBtn) sortBtn.addEventListener('click', sortSequencesByColor);
    if (groupBtn) groupBtn.addEventListener('click', groupColoredSequencesAtTop);
    if (inspectBtn) inspectBtn.addEventListener('click', showColorHistory);
    
    // Keep menu open when interacting with pattern input
    if (patternInput) {
        patternInput.addEventListener('focus', () => {
            const colourMenu = document.querySelector('[id="colourseqs-controls"]')?.parentElement;
            if (colourMenu) {
                colourMenu.classList.add('menu-open');
            }
        });
        patternInput.addEventListener('blur', () => {
            setTimeout(() => {
                if (!document.querySelector('[id="colourseqs-controls"]')?.parentElement?.matches(':hover')) {
                    document.querySelector('[id="colourseqs-controls"]')?.parentElement?.classList.remove('menu-open');
                }
            }, 100);
        });
    }
    
    // Update threshold display
    if (thresholdSlider) {
        thresholdSlider.addEventListener('input', (e) => {
            el('colourThresholdValue').textContent = e.target.value;
        });
    }
    
    // Load initial presets list
    updateColourPresetList();
}

// ============================================================================
// End of Full-window drag-and-drop
// ============================================================================

// ============================================================================
// Persistent horizontal scrollbar synced with alignment
// ============================================================================
(function setupPersistentScrollbar() {
    const alignment = document.getElementById('alignmentContainer');
    const bar = document.querySelector('.horizontal-scrollbar');
    const thumb = document.querySelector('.horizontal-scrollbar-thumb');
    if (!alignment || !bar || !thumb) return;

    let syncing = false;

    function syncSizes() {
        const w = alignment.scrollWidth || alignment.clientWidth;
        thumb.style.width = Math.max(w, alignment.clientWidth + 1) + 'px';
        syncing = true;
        bar.scrollLeft = alignment.scrollLeft;
        syncing = false;
    }

    function onBarScroll() {
        if (syncing) return;
        syncing = true;
        alignment.scrollLeft = bar.scrollLeft;
        syncing = false;
    }

    function onAlignmentScroll() {
        if (syncing) return;
        syncing = true;
        bar.scrollLeft = alignment.scrollLeft;
        syncing = false;
    }

    syncSizes();
    bar.addEventListener('scroll', onBarScroll, { passive: true });
    alignment.addEventListener('scroll', onAlignmentScroll, { passive: true });
    window.addEventListener('resize', () => window.requestAnimationFrame(syncSizes));
    const mo = new MutationObserver(() => window.requestAnimationFrame(syncSizes));
    mo.observe(alignment, { childList: true, subtree: true, characterData: true });
    
    // Drag-to-pan with Pointer Events and capture for robustness
    let isDown = false, startX = 0, startScroll = 0;
    let dragRaf = null, lastDx = 0;
    bar.addEventListener('pointerdown', (e) => {
        isDown = true;
        try { bar.setPointerCapture(e.pointerId); } catch {}
        bar.classList.add('grabbing');
        document.body.classList.add('no-select');
        startX = e.clientX;
        startScroll = bar.scrollLeft;
        e.preventDefault();
    });
    bar.addEventListener('pointermove', (e) => {
        if (!isDown) return;
        lastDx = e.clientX - startX;
        if (dragRaf) { e.preventDefault(); return; }
        dragRaf = window.requestAnimationFrame(() => {
            const newScroll = startScroll - lastDx;
            syncing = true;
            alignment.scrollLeft = newScroll;
            bar.scrollLeft = newScroll;
            syncing = false;
            dragRaf = null;
        });
        e.preventDefault();
    }, { passive: false });
    const endDrag = () => {
        if (!isDown) return;
        isDown = false;
        bar.classList.remove('grabbing');
        document.body.classList.remove('no-select');
        if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = null; }
    };
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);
    window.addEventListener('mouseup', endDrag);

    // Map vertical wheel to horizontal scroll when user hovers the bar
    bar.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            bar.scrollLeft += e.deltaY;
            e.preventDefault();
        }
    }, { passive: false });
})();
