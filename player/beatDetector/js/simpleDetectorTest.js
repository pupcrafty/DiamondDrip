// -----------------------------
// Simple Detector Test - Display Logic
// -----------------------------
// This file handles displaying data from BPM_ESTIMATOR and RHYTHM_PREDICTOR

const PHRASE_BEATS = 4; // 4 beats per phrase

let isRunning = false;
let lastPulseTime = -999;
const PULSE_GATE_TIME = 0.1; // Minimum time between pulses (100ms)

// Helper function to render a pattern as a grid
function renderPattern(pattern, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (!pattern || pattern.length === 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding: 10px;">No pattern available</div>';
        return;
    }
    
    let html = '';
    for (let beat = 0; beat < PHRASE_BEATS; beat++) {
        for (let thirtySecond = 0; thirtySecond < 8; thirtySecond++) {
            const index = beat * 8 + thirtySecond;
            const isActive = pattern[index];
            const isBeatStart = thirtySecond === 0;
            
            const classes = ['pattern-slot'];
            if (isActive) classes.push('active');
            if (isBeatStart) classes.push('beat-start');
            
            html += `<div class="${classes.join(' ')}">${isBeatStart ? (beat + 1) : ''}</div>`;
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
    
    // Get current phrase pattern
    const currentPattern = RHYTHM_PREDICTOR.getCurrentPhrasePattern();
    renderPattern(currentPattern, 'currentPattern');
    
    // Get hyper predicted pattern
    const hyperPredicted = RHYTHM_PREDICTOR.getHyperPredictedPhrasePattern();
    renderPattern(hyperPredicted, 'hyperPredictedPattern');
    
    // Get predicted from history
    const predictedFromHistory = RHYTHM_PREDICTOR.getPredictedPhrasePattern();
    renderPattern(predictedFromHistory, 'predictedFromHistoryPattern');
    
    // Get predicted from correct patterns
    const predictedFromCorrect = RHYTHM_PREDICTOR.getPredictedFromCorrectPatterns();
    renderPattern(predictedFromCorrect, 'predictedFromCorrectPattern');
    
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
                
                // Detect pulses based on pulse threshold
                const pulseThreshold = ENERGY_CLASSIFIER.getPulseThreshold();
                if (pulseThreshold !== null && pulseThreshold > 0 && 
                    data.rms > pulseThreshold && 
                    data.time - lastPulseTime >= PULSE_GATE_TIME) {
                    lastPulseTime = data.time;
                    
                    // Process pulse for rhythm prediction
                    const hyperBpm = BPM_ESTIMATOR.getHyperSmoothedBPM();
                    RHYTHM_PREDICTOR.processPulse(data.time, hyperBpm);
                }
                
                // Update BPM estimator periodically
                BPM_ESTIMATOR.update();
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
    lastPulseTime = -999;
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

