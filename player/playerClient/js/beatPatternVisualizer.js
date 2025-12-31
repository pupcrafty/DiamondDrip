// -----------------------------
// Beat Pattern Visualizer
// -----------------------------
// Displays the current beat pattern, markers, and position indicator

let patternVisualizerEnabled = false;
let currentPhraseStart = null;
let currentPattern = null;
let currentBPM = null;
let currentSlotMs = null;

// Initialize the visualizer
function initBeatPatternVisualizer() {
    // Check config first - if disabled, don't initialize anything
    if (typeof ENABLE_PATTERN_VISUALIZER !== 'undefined' && !ENABLE_PATTERN_VISUALIZER) {
        // Hide the toggle button and panel if config says disabled
        const toggleButton = document.getElementById('panelToggle');
        const panel = document.getElementById('beatPatternPanel');
        if (toggleButton) toggleButton.style.display = 'none';
        if (panel) panel.style.display = 'none';
        return;
    }
    
    const toggleButton = document.getElementById('panelToggle');
    const panel = document.getElementById('beatPatternPanel');
    
    if (!toggleButton || !panel) {
        console.warn('[VISUALIZER] Panel elements not found');
        return;
    }
    
    // Load saved state from localStorage
    const savedState = localStorage.getItem('beatPatternVisualizerEnabled');
    if (savedState === 'true') {
        patternVisualizerEnabled = true;
        panel.classList.add('visible');
    }
    
    toggleButton.addEventListener('click', () => {
        patternVisualizerEnabled = !patternVisualizerEnabled;
        if (patternVisualizerEnabled) {
            panel.classList.add('visible');
        } else {
            panel.classList.remove('visible');
        }
        localStorage.setItem('beatPatternVisualizerEnabled', patternVisualizerEnabled.toString());
    });
}

// Update the visualization (call this from game loop)
function updateBeatPatternVisualization(currentTime) {
    // Early return if config disables it - no logic runs
    if (typeof ENABLE_PATTERN_VISUALIZER !== 'undefined' && !ENABLE_PATTERN_VISUALIZER) {
        return;
    }
    
    // Early return if user has toggled it off
    if (!patternVisualizerEnabled) {
        return;
    }
    
    // Check if required functions are available
    if (typeof getActivePrediction !== 'function' || typeof getMarkers !== 'function') {
        return;
    }
    
    const activePrediction = getActivePrediction();
    let markers = getMarkers();
    
    // Ensure markers is an array
    if (!Array.isArray(markers)) {
        markers = [];
    }
    
    // Debug: log marker count periodically
    if (Math.random() < 0.01) { // 1% of the time
        console.log('[VISUALIZER] Markers:', markers.length, 'Active:', markers.filter(m => m && !m.hit).length);
    }
    
    // Update pattern visualization (pass markers so it can highlight them)
    updatePatternDisplay(activePrediction, currentTime, markers);
    
    // Update markers list
    updateMarkersList(markers, currentTime);
}

function updatePatternDisplay(activePrediction, currentTime, markers = []) {
    const visualization = document.getElementById('patternVisualization');
    const infoText = document.getElementById('patternInfo');
    
    if (!visualization || !infoText) {
        return;
    }
    
    if (!activePrediction) {
        visualization.innerHTML = '<div style="color: #666; padding: 20px; text-align: center;">No prediction available</div>';
        infoText.textContent = 'Waiting for prediction...';
        return;
    }
    
    const bpm = activePrediction.bpm;
    const slotMs = activePrediction.slot_ms;
    const onset = activePrediction.onset || [];
    const durSlots = activePrediction.dur_slots || [];
    const phraseBeats = 4; // Standard 4-beat phrase
    const slotsPerBeat = 8; // 8 thirty-second notes per beat (corrected from 32)
    const slotsPerPhrase = phraseBeats * slotsPerBeat; // 32 slots per phrase
    const numPhrases = 4; // 4 phrases in the prediction
    const totalSlots = numPhrases * slotsPerPhrase; // 128 slots total (4 phrases)
    const beatDuration = 60.0 / bpm;
    const phraseDuration = beatDuration * phraseBeats; // Duration of one phrase (4 beats)
    
    // Calculate phrase start time
    let phraseStart = activePrediction.phrase_start_time;
    if (phraseStart === null) {
        if (typeof getLastPhraseStartTime === 'function') {
            phraseStart = getLastPhraseStartTime();
        }
        if (phraseStart === null) {
            phraseStart = currentTime - (currentTime % phraseDuration);
        }
    }
    
    // Calculate current position in pattern - wrap at phrase boundary (32 slots), not total slots
    const timeSincePhraseStart = currentTime - phraseStart;
    let currentSlot = Math.floor(timeSincePhraseStart / slotMs);
    // Handle negative values properly
    if (currentSlot < 0) {
        // If we're before phrase start, wrap to end of previous phrase
        currentSlot = slotsPerPhrase + (currentSlot % slotsPerPhrase);
    }
    // Wrap at phrase boundary (32 slots), not total slots (128)
    const currentSlotInPhrase = ((currentSlot % slotsPerPhrase) + slotsPerPhrase) % slotsPerPhrase; // 0-31
    
    // Store for marker visualization
    currentPhraseStart = phraseStart;
    currentPattern = { onset, durSlots, slotMs, bpm };
    currentBPM = bpm;
    currentSlotMs = slotMs;
    
    // Get predicted beats for marker matching
    const predictedBeats = typeof getPredictedBeatTimestamps === 'function' ? getPredictedBeatTimestamps(currentTime) : [];
    
    // Create a map of slot -> markers
    const slotToMarkers = new Map();
    
    // Map markers to slots - try multiple methods
    markers.forEach(marker => {
        if (!marker || marker.hit) return;
        
        // Method 1: Match using predicted beats
        if (predictedBeats.length > 0) {
            const matchingBeat = predictedBeats.find(beat => 
                Math.abs(beat.time - marker.tArrival) < 0.15 // 150ms tolerance
            );
            
            if (matchingBeat && matchingBeat.slot !== undefined) {
                const slot = ((matchingBeat.slot % totalSlots) + totalSlots) % totalSlots;
                if (!slotToMarkers.has(slot)) {
                    slotToMarkers.set(slot, []);
                }
                slotToMarkers.get(slot).push(marker);
                return;
            }
        }
        
        // Method 2: Calculate slot based on time difference from phrase start
        if (phraseStart !== null && marker.tArrival !== undefined) {
            const timeFromPhraseStart = marker.tArrival - phraseStart;
            if (timeFromPhraseStart >= 0 && timeFromPhraseStart < phraseDuration * 2) {
                const calculatedSlot = Math.floor(timeFromPhraseStart / slotMs);
                const slot = ((calculatedSlot % totalSlots) + totalSlots) % totalSlots;
                
                // Only add if it's a reasonable match (within current phrase or next)
                if (slot >= 0 && slot < totalSlots) {
                    if (!slotToMarkers.has(slot)) {
                        slotToMarkers.set(slot, []);
                    }
                    slotToMarkers.get(slot).push(marker);
                }
            }
        }
    });
    
    // Build visualization HTML with better design
    const slotElements = [];
    let html = '<div style="display: flex; flex-wrap: wrap; gap: 2px; align-items: flex-start;">';
    
    // Add phrase labels row (4 phrases)
    html += '<div style="width: 100%; display: flex; margin-bottom: 5px; font-size: 10px; color: #888;">';
    for (let phrase = 0; phrase < numPhrases; phrase++) {
        html += `<div style="flex: 1; text-align: center;">Phrase ${phrase + 1}</div>`;
    }
    html += '</div>';
    
    // Build pattern row
    html += '<div style="display: flex; flex-wrap: wrap; gap: 2px; width: 100%;">';
    
    for (let slot = 0; slot < totalSlots; slot++) {
        const isActive = slot < onset.length && onset[slot] > 0.5;
        const isSustained = isActive && durSlots && durSlots[slot] > 0;
        // Highlight current slot in all phrases (slot % 32 matches currentSlotInPhrase)
        const slotInPhrase = slot % slotsPerPhrase;
        const isCurrent = slotInPhrase === currentSlotInPhrase;
        const hasMarker = slotToMarkers.has(slot);
        
        let className = 'pattern-slot';
        if (isActive) {
            className += isSustained ? ' sustained' : ' active';
        }
        if (isCurrent) {
            className += ' current';
        }
        if (hasMarker) {
            className += ' marker';
        }
        
        // Calculate sustained beat width
        let sustainedWidth = 1;
        if (isSustained && durSlots[slot] > 0) {
            sustainedWidth = Math.min(Math.ceil(durSlots[slot]), 8); // Max 8 slots wide
        }
        
        // Add phrase divider every 32 slots (between phrases)
        if (slot > 0 && slot % slotsPerPhrase === 0) {
            html += '<div class="pattern-beat-divider" style="border-left: 2px solid #888; margin: 0 2px;"></div>';
        }
        // Add beat divider every 8 slots (within each phrase)
        else if (slot > 0 && slot % slotsPerBeat === 0) {
            html += '<div class="pattern-beat-divider"></div>';
        }
        
        const phraseNum = Math.floor(slot / slotsPerPhrase) + 1;
        const slotTitle = `Phrase ${phraseNum}, Slot ${slotInPhrase}${isActive ? ' (beat)' : ''}${isSustained ? ` (sustained ${durSlots[slot]} slots)` : ''}${hasMarker ? ' (marker)' : ''}`;
        html += `<div class="${className}" data-slot="${slot}" style="width: ${sustainedWidth * 8}px;" title="${slotTitle}"></div>`;
    }
    
    html += '</div></div>';
    visualization.innerHTML = html;
    
    // Store slot elements for later use
    const allSlotElements = visualization.querySelectorAll('.pattern-slot');
    allSlotElements.forEach((el) => {
        const slotNum = parseInt(el.getAttribute('data-slot'));
        if (!isNaN(slotNum)) {
            slotElements[slotNum] = el;
        }
    });
    
    // Update info text with proper slot number
    const source = activePrediction.source || 'unknown';
    const beatCount = onset.filter(v => v > 0.5).length;
    const currentBeat = Math.floor(currentSlotInPhrase / slotsPerBeat) + 1;
    const currentSlotInBeat = (currentSlotInPhrase % slotsPerBeat) + 1;
    const currentPhraseNum = Math.floor(currentSlot / slotsPerPhrase) % numPhrases + 1;
    infoText.innerHTML = `
        <div style="margin-bottom: 5px;"><strong>Source:</strong> ${source} | <strong>BPM:</strong> ${bpm.toFixed(1)}</div>
        <div style="margin-bottom: 5px;"><strong>Position:</strong> Phrase ${currentPhraseNum}, Beat ${currentBeat}, Slot ${currentSlotInBeat}/${slotsPerBeat} (Phrase slot: ${currentSlotInPhrase + 1}/${slotsPerPhrase})</div>
        <div><strong>Active Beats:</strong> ${beatCount} | <strong>Current Slot in Phrase:</strong> ${currentSlotInPhrase + 1}</div>
    `;
}

function updateMarkersList(markers, currentTime) {
    const markersList = document.getElementById('markersList');
    const markerCount = document.getElementById('markerCount');
    
    if (!markersList || !markerCount) {
        return;
    }
    
    // Filter out hit markers and ensure we have valid markers
    const activeMarkers = markers.filter(m => {
        if (!m) return false;
        if (m.hit) return false;
        if (m.tArrival === undefined || m.tArrival === null) return false;
        return true;
    });
    
    markerCount.textContent = activeMarkers.length;
    
    // Debug logging
    if (activeMarkers.length > 0 && Math.random() < 0.01) {
        console.log('[VISUALIZER] Active markers:', activeMarkers.length, 'Total markers:', markers.length);
        activeMarkers.slice(0, 3).forEach((m, i) => {
            console.log(`  Marker ${i}:`, {
                tArrival: m.tArrival,
                timeUntil: m.tArrival - currentTime,
                hit: m.hit,
                target: m.target ? m.target.index : 'no target'
            });
        });
    }
    
    if (activeMarkers.length === 0) {
        markersList.innerHTML = '<div style="color: #666; padding: 10px; text-align: center; font-size: 12px;">No active markers</div>';
        return;
    }
    
    // Sort by arrival time
    activeMarkers.sort((a, b) => a.tArrival - b.tArrival);
    
    // Get predicted beats to match markers to slots
    const predictedBeats = typeof getPredictedBeatTimestamps === 'function' ? getPredictedBeatTimestamps(currentTime) : [];
    
    let html = '';
    activeMarkers.forEach((marker, index) => {
        const timeUntilArrival = marker.tArrival - currentTime;
        const isSustained = marker.isSustainedBeatMarker && marker.isSustainedBeatMarker();
        const targetIndex = marker.target && marker.target.index !== undefined ? marker.target.index : -1;
        const targetName = targetIndex === 0 ? 'Left' : targetIndex === 1 ? 'Middle' : targetIndex === 2 ? 'Right' : 'Unknown';
        
        // Find corresponding beat for slot info
        let slotInfo = '';
        const correspondingBeat = predictedBeats.find(beat => 
            Math.abs(beat.time - marker.tArrival) < 0.05
        );
        if (correspondingBeat && correspondingBeat.slot !== undefined) {
            slotInfo = ` | Slot: ${correspondingBeat.slot}`;
        }
        
        html += `<div class="marker-item ${isSustained ? 'sustained' : ''}">`;
        html += `<div class="marker-info">`;
        html += `<span class="marker-label">${isSustained ? '🔗 Sustained' : '● Single'} Beat</span>`;
        html += `<span class="marker-time">${timeUntilArrival > 0 ? timeUntilArrival.toFixed(2) + 's' : '<span style="color: #ff6a4a;">NOW</span>'}</span>`;
        html += `</div>`;
        html += `<div class="info-text">Target: <strong>${targetName}</strong> | Arrival: ${marker.tArrival.toFixed(2)}s${slotInfo}</div>`;
        if (isSustained && marker.pairedMarker) {
            const duration = marker.pairedMarker.tArrival - marker.tArrival;
            html += `<div class="info-text">Duration: ${duration.toFixed(2)}s | End: ${marker.pairedMarker.tArrival.toFixed(2)}s</div>`;
        }
        html += `</div>`;
    });
    
    markersList.innerHTML = html;
}

// Initialize on page load
if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
        // Early return if config disables it - no initialization
        if (typeof ENABLE_PATTERN_VISUALIZER !== 'undefined' && !ENABLE_PATTERN_VISUALIZER) {
            return;
        }
        
        // Wait a bit for other scripts to load
        setTimeout(() => {
            if (typeof getActivePrediction === 'function' && typeof getMarkers === 'function') {
                initBeatPatternVisualizer();
            } else {
                console.warn('[VISUALIZER] Required functions not available');
            }
        }, 100);
    });
}

