// -----------------------------
// Simple Detector Test - Display Logic
// -----------------------------
// This file handles displaying data from BPM_ESTIMATOR and RHYTHM_PREDICTOR

const PHRASE_BEATS = 4; // 4 beats per phrase

let isRunning = false;
let lastPulseTime = -999;
const PULSE_GATE_TIME = 0.1; // Minimum time between pulses (100ms)
let sustainedBeatSlots = new Map(); // Track which pattern slots correspond to sustained beats: Map<slot, duration32nd>
let currentPhraseStart = null; // Track current phrase start time for slot calculation

// Helper function to calculate slot index from pulse time
function calculateSlotFromPulseTime(pulseTime, bpm, phraseStart) {
    if (bpm === null || bpm <= 0 || phraseStart === null) return null;
    
    const beatDuration = 60 / bpm;
    const phraseDuration = beatDuration * PHRASE_BEATS;
    const thirtySecondNoteDuration = beatDuration / 8;
    
    const timeInPhrase = pulseTime - phraseStart;
    const slot = Math.round(timeInPhrase / thirtySecondNoteDuration);
    
    if (slot >= 0 && slot < PHRASE_BEATS * 8) {
        return slot;
    }
    return null;
}

// Helper function to get all slots covered by a sustained beat
function getSustainedBeatCoveredSlots(sustainedBeatSlots) {
    const coveredSlots = new Set();
    
    // For each sustained beat, calculate which slots it covers
    sustainedBeatSlots.forEach((duration32nd, startSlot) => {
        // Calculate how many slots are covered (round up to include partial slots)
        const slotsToCover = Math.ceil(duration32nd);
        
        // Mark all covered slots
        for (let i = 0; i < slotsToCover; i++) {
            const slot = startSlot + i;
            if (slot >= 0 && slot < PHRASE_BEATS * 8) {
                coveredSlots.add(slot);
            }
        }
    });
    
    return coveredSlots;
}

// Helper function to render a pattern as a grid
function renderPattern(pattern, containerId, showSustained = true, durations = null, predictionType = null) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (!pattern || pattern.length === 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding: 10px;">No pattern available</div>';
        return;
    }
    
    // For actual patterns, use sustainedBeatSlots; for predictions, use provided durations
    const predictionDurations = predictionType ? new Map() : null;
    if (durations && predictionType) {
        // Convert durations array to Map for prediction patterns
        for (let i = 0; i < durations.length && i < pattern.length; i++) {
            if (durations[i] !== null && durations[i] !== undefined && pattern[i]) {
                predictionDurations.set(i, durations[i]);
            }
        }
    }
    
    // Calculate which slots are covered by sustained beats
    const useDurations = predictionType ? predictionDurations : (showSustained ? sustainedBeatSlots : null);
    const sustainedCoveredSlots = useDurations ? getSustainedBeatCoveredSlots(useDurations) : new Set();
    
    let html = '';
    for (let beat = 0; beat < PHRASE_BEATS; beat++) {
        for (let thirtySecond = 0; thirtySecond < 8; thirtySecond++) {
            const index = beat * 8 + thirtySecond;
            const isActive = pattern[index];
            const isBeatStart = thirtySecond === 0;
            const duration32nd = useDurations ? useDurations.get(index) : undefined;
            const isSustained = duration32nd !== undefined;
            const isCoveredBySustained = sustainedCoveredSlots.has(index);
            
            const classes = ['pattern-slot'];
            if (isActive) classes.push('active');
            if (isBeatStart) classes.push('beat-start');
            if (isCoveredBySustained) {
                if (predictionType) {
                    classes.push('sustained');
                    classes.push(`sustained-${predictionType}`);
                } else {
                    classes.push('sustained');
                }
            }
            
            // Display duration for sustained beats, otherwise show beat number
            let displayText = isBeatStart ? (beat + 1) : '';
            if (isSustained && isActive && duration32nd !== undefined) {
                displayText = duration32nd.toFixed(1);
            }
            
            const titleText = isSustained && isActive ? `Sustained: ${duration32nd.toFixed(2)} 32nd beats` : 
                            isCoveredBySustained ? 'Covered by sustained beat' : '';
            html += `<div class="${classes.join(' ')}" title="${titleText}">${displayText}</div>`;
        }
    }
    
    container.innerHTML = html;
}

// Helper function to render a list of patterns
function renderPatternList(patterns, containerId, labelPrefix = 'Pattern') {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (!patterns || patterns.length === 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding: 10px;">No patterns available</div>';
        return;
    }
    
    let html = '';
    for (let i = patterns.length - 1; i >= 0; i--) {
        const pattern = patterns[i];
        html += '<div class="pattern-item">';
        html += `<div class="pattern-item-label">${labelPrefix} ${i + 1}</div>`;
        html += '<div class="pattern-grid">';
        
        for (let j = 0; j < pattern.length; j++) {
            const isActive = pattern[j];
            const isBeatStart = (j % 8) === 0;
            
            const classes = ['pattern-slot'];
            if (isActive) classes.push('active');
            if (isBeatStart) classes.push('beat-start');
            
            html += `<div class="${classes.join(' ')}"></div>`;
        }
        
        html += '</div>';
        html += '</div>';
    }
    
    container.innerHTML = html;
}

// Update the display with current data
function updateDisplay() {
    // Get Hyper-Smoothed BPM
    const hyperBpm = BPM_ESTIMATOR.getHyperSmoothedBPM();
    const hyperBpmElement = document.getElementById('hyperBpmValue');
    if (hyperBpmElement) {
        if (hyperBpm !== null) {
            hyperBpmElement.textContent = hyperBpm.toFixed(1);
        } else {
            hyperBpmElement.textContent = '-';
        }
    }
    
    // Get current phrase pattern (show sustained beats only in current pattern)
    const currentPattern = RHYTHM_PREDICTOR.getCurrentPhrasePattern();
    renderPattern(currentPattern, 'currentPattern', true);
    
    // Get hyper predicted pattern (show sustained beats in predictions)
    const hyperPredicted = RHYTHM_PREDICTOR.getHyperPredictedPhrasePattern();
    const hyperPredictedDurations = RHYTHM_PREDICTOR.getHyperPredictedDurations();
    renderPattern(hyperPredicted, 'hyperPredictedPattern', false, hyperPredictedDurations, 'hyper');
    
    // Get predicted from history (show sustained beats in predictions)
    const predictedFromHistory = RHYTHM_PREDICTOR.getPredictedPhrasePattern();
    const predictedFromHistoryDurations = RHYTHM_PREDICTOR.getPredictedPhraseDurations();
    renderPattern(predictedFromHistory, 'predictedFromHistoryPattern', false, predictedFromHistoryDurations, 'history');
    
    // Get predicted from correct patterns (show sustained beats in predictions)
    const predictedFromCorrect = RHYTHM_PREDICTOR.getPredictedFromCorrectPatterns();
    const predictedFromCorrectDurations = RHYTHM_PREDICTOR.getPredictedFromCorrectDurations();
    renderPattern(predictedFromCorrect, 'predictedFromCorrectPattern', false, predictedFromCorrectDurations, 'correct');
    
    // Get recent phrase patterns
    const recentPatterns = RHYTHM_PREDICTOR.getPhrasePatterns();
    renderPatternList(recentPatterns, 'recentPatterns', 'Phrase');
    
    // Get correct prediction patterns
    const correctPatterns = RHYTHM_PREDICTOR.getCorrectPredictionPatterns();
    renderPatternList(correctPatterns, 'correctPatterns', 'Correct Pattern');
}

// Initialize: Update display periodically
function init() {
    // Update display immediately
    updateDisplay();
    
    // Update display every 100ms
    setInterval(updateDisplay, 100);
    
    // Set up button handlers
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    
    startBtn.addEventListener('click', startDetection);
    stopBtn.addEventListener('click', stopDetection);
}

async function startDetection() {
    try {
        const startBtn = document.getElementById('startBtn');
        const stopBtn = document.getElementById('stopBtn');
        
        // Reset modules
        BPM_ESTIMATOR.reset();
        ENERGY_CLASSIFIER.reset();
        RHYTHM_PREDICTOR.reset();
        SUSTAINED_BEAT_DETECTOR.reset();
        sustainedBeatSlots = new Map();
        currentPhraseStart = null;
        
        // Initialize beat detection
        await beatDetection.initBeatDetection(
            // onBeat callback
            (time, rms, threshold, avg) => {
                // Add beat to BPM estimator
                BPM_ESTIMATOR.addBeat(time);
                BPM_ESTIMATOR.update();
            },
            // onDiagnostic callback
            (data) => {
                // Add RMS sample to energy classifier
                ENERGY_CLASSIFIER.addRmsSample(data.rms);
                ENERGY_CLASSIFIER.update();
                
                // Update BPM estimator periodically
                BPM_ESTIMATOR.update();
                
                const hyperBpm = BPM_ESTIMATOR.getHyperSmoothedBPM();
                
                // Detect pulses based on pulse threshold
                const pulseThreshold = ENERGY_CLASSIFIER.getPulseThreshold();
                if (pulseThreshold !== null && pulseThreshold > 0 && 
                    data.rms > pulseThreshold && 
                    data.time - lastPulseTime >= PULSE_GATE_TIME) {
                    lastPulseTime = data.time;
                    
                    // Process pulse for rhythm prediction first (to get phrase timing)
                    RHYTHM_PREDICTOR.processPulse(data.time, hyperBpm);
                    
                    // Process pulse for sustained beat detection
                    SUSTAINED_BEAT_DETECTOR.processPulse(data.time, data.avg);
                    
                    // Track phrase start - estimate by checking if this pulse would start a new phrase
                    if (currentPhraseStart === null) {
                        currentPhraseStart = data.time;
                    } else if (hyperBpm !== null && hyperBpm > 0) {
                        const beatDuration = 60 / hyperBpm;
                        const phraseDuration = beatDuration * PHRASE_BEATS;
                        const timeSincePhraseStart = data.time - currentPhraseStart;
                        // If pulse is past phrase duration, it started a new phrase
                        if (timeSincePhraseStart >= phraseDuration) {
                            currentPhraseStart = data.time;
                            // Clear sustained beat slots when phrase resets
                            sustainedBeatSlots.clear();
                        }
                    }
                }
                
                // Process diagnostic data for sustained beat detection
                if (currentPhraseStart !== null) {
                    const sustainedBeat = SUSTAINED_BEAT_DETECTOR.processDiagnostic(data.time, data.avg, hyperBpm);
                    if (sustainedBeat !== null && sustainedBeat.duration32nd !== null) {
                        // Calculate which slot this sustained beat corresponds to
                        const slot = calculateSlotFromPulseTime(sustainedBeat.pulseTime, hyperBpm, currentPhraseStart);
                        if (slot !== null && slot >= 0 && slot < PHRASE_BEATS * 8) {
                            // Update duration (may be updated multiple times as tracking continues)
                            sustainedBeatSlots.set(slot, sustainedBeat.duration32nd);
                            
                            // Also update rhythm predictor with sustained beat information
                            RHYTHM_PREDICTOR.processSustainedBeat(sustainedBeat.pulseTime, sustainedBeat.duration32nd, hyperBpm);
                        }
                    }
                }
            }
        );
        
        isRunning = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
    } catch (error) {
        console.error('Error starting beat detection:', error);
        alert('Error starting beat detection: ' + error.message);
    }
}

function stopDetection() {
    beatDetection.stopBeatDetection();
    
    isRunning = false;
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    
    // Reset modules
    BPM_ESTIMATOR.reset();
    ENERGY_CLASSIFIER.reset();
    RHYTHM_PREDICTOR.reset();
    SUSTAINED_BEAT_DETECTOR.reset();
    sustainedBeatSlots.clear();
    currentPhraseStart = null;
    lastPulseTime = -999;
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

