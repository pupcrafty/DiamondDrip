// -----------------------------
// Rhythm Beacon - Visualization Logic
// -----------------------------
// Displays a visual beacon that blinks according to detected rhythm patterns

const PHRASE_BEATS = 4; // 4 beats per phrase

let isRunning = false;
let lastPulseTime = -999;
const PULSE_GATE_TIME = 0.1; // Minimum time between pulses (100ms)
let currentPhase = 'waiting'; // waiting, initializing, detecting, ready

const canvas = document.getElementById('beaconCanvas');
const ctx = canvas.getContext('2d');
const statusText = document.getElementById('statusText');

// Beacon state
let beaconIntensity = 0; // 0-1, controls brightness
let lastUpdateTime = 0;
let currentPattern = null;
let patternStartTime = 0;
let nextFlashTime = -1; // Time for next flash event

// Constants for timing
const EIGHTH_NOTE_FLASH_DURATION = 0.15; // Duration of 8th note flash (slightly less than full 8th)
const THIRTY_SECOND_NOTE_FLASH_DURATION = 0.05; // Quick flash for 32nd notes

function updateStatus(message) {
    statusText.textContent = message;
}

function drawBeacon() {
    // Clear canvas
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Calculate center
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const maxRadius = Math.min(canvas.width, canvas.height) / 2 - 20;
    
    // Draw beacon circle with current intensity
    const radius = maxRadius * 0.8;
    const alpha = beaconIntensity;
    
    // Outer glow
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 1.5);
    gradient.addColorStop(0, `rgba(80, 176, 255, ${alpha})`);
    gradient.addColorStop(0.5, `rgba(80, 176, 255, ${alpha * 0.5})`);
    gradient.addColorStop(1, `rgba(80, 176, 255, 0)`);
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 1.5, 0, Math.PI * 2);
    ctx.fill();
    
    // Main beacon circle
    ctx.fillStyle = `rgba(80, 176, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Center dot
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(alpha * 1.5, 1)})`;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.2, 0, Math.PI * 2);
    ctx.fill();
}

let lastBeaconPattern = null;
let lastBeaconHyperBpm = null;
let hasLoggedHyperPrediction = false;
function updateBeacon(currentTime) {
    if (!isRunning) {
        // Fade out when stopped
        beaconIntensity *= 0.95;
        drawBeacon();
        return;
    }
    
    const hyperBpm = BPM_ESTIMATOR.getHyperSmoothedBPM();
    const currentPattern = RHYTHM_PREDICTOR.getCurrentPhrasePattern();
    
    // Log when BPM becomes available
    if (lastBeaconHyperBpm === null && hyperBpm !== null) {
        console.log('🪩 [BEACON] 🎯 BPM detected:', hyperBpm.toFixed(1));
    }
    lastBeaconHyperBpm = hyperBpm;
    
    // Log when pattern becomes available
    if (lastBeaconPattern === null && currentPattern !== null) {
        const activeSlots = currentPattern.filter(slot => slot).length;
        console.log('🪩 [BEACON] 🎵 Pattern detected (Active slots:', activeSlots, '/32)');
    }
    
    // Check for new phrase (pattern reset)
    if (lastBeaconPattern !== null && currentPattern !== null) {
        const oldHasPulses = lastBeaconPattern.some(slot => slot);
        const newHasPulses = currentPattern.some(slot => slot);
        if (oldHasPulses && !newHasPulses && hyperBpm !== null) {
            // New phrase detected
            const beatDuration = 60 / hyperBpm;
            const phraseDuration = beatDuration * 4;
            console.log('🪩 [BEACON] 🎵 New phrase detected (BPM:', hyperBpm.toFixed(1), 'Phrase duration:', phraseDuration.toFixed(2), 's)');
        }
    }
    lastBeaconPattern = currentPattern ? [...currentPattern] : null;
    
    if (hyperBpm === null || currentPattern === null) {
        // Waiting for enough data
        updateStatus('Waiting for BPM and pattern data... Need more beats and pulses.');
        beaconIntensity *= 0.98; // Slow fade
        drawBeacon();
        return;
    }
    
    // Calculate timing
    const beatDuration = 60 / hyperBpm; // Duration of one beat in seconds
    const eighthNoteDuration = beatDuration / 2; // 8th note duration
    const thirtySecondNoteDuration = beatDuration / 8; // 32nd note duration
    
    // Get the predicted pattern (use hyper prediction if available, otherwise current)
    const hyperPredicted = RHYTHM_PREDICTOR.getHyperPredictedPhrasePattern();
    const patternToUse = hyperPredicted || currentPattern;
    
    // Log when hyper prediction becomes available
    if (hyperPredicted !== null && !hasLoggedHyperPrediction) {
        const activeSlots = hyperPredicted.filter(slot => slot).length;
        console.log('🪩 [BEACON] 🌟 Hyper prediction available (Active slots:', activeSlots, '/32)');
        hasLoggedHyperPrediction = true;
    }
    
    if (patternToUse && patternToUse.length > 0) {
        // Find current position in phrase (based on elapsed time since phrase start)
        // We'll use a cycling approach - calculate position based on elapsed time mod phrase duration
        const phraseDuration = beatDuration * PHRASE_BEATS;
        const timeInPhrase = (currentTime - patternStartTime) % phraseDuration;
        const currentSlot = Math.floor(timeInPhrase / thirtySecondNoteDuration);
        
        // Check if current slot is active in pattern
        if (currentSlot >= 0 && currentSlot < patternToUse.length) {
            const isActive = patternToUse[currentSlot];
            const isEighthBeat = (currentSlot % 4) === 0;
            
            if (isActive) {
                // Check if there's a 32nd note after this one in the pattern
                const nextSlot = currentSlot + 1;
                const hasNext32nd = nextSlot < patternToUse.length && patternToUse[nextSlot];
                
                if (isEighthBeat && hasNext32nd) {
                    // 8th beat with a 32nd note after it - use quick flash for 32nd note timing
                    const slotStartTime = (currentSlot * thirtySecondNoteDuration) % phraseDuration;
                    const timeInSlot = (timeInPhrase - slotStartTime) % phraseDuration;
                    if (timeInSlot < THIRTY_SECOND_NOTE_FLASH_DURATION) {
                        beaconIntensity = 1.0; // Full brightness for quick flash
                    } else {
                        beaconIntensity *= 0.85; // Fast decay
                    }
                } else if (isEighthBeat) {
                    // 8th beat without following 32nd - regular flash (slightly less than full 8th note duration)
                    const slotStartTime = (currentSlot * thirtySecondNoteDuration) % phraseDuration;
                    const timeInSlot = (timeInPhrase - slotStartTime) % phraseDuration;
                    if (timeInSlot < EIGHTH_NOTE_FLASH_DURATION) {
                        beaconIntensity = 1.0; // Full brightness
                    } else {
                        beaconIntensity *= 0.92; // Decay
                    }
                } else {
                    // 32nd note (not on 8th beat) - quick flash
                    const slotStartTime = (currentSlot * thirtySecondNoteDuration) % phraseDuration;
                    const timeInSlot = (timeInPhrase - slotStartTime) % phraseDuration;
                    if (timeInSlot < THIRTY_SECOND_NOTE_FLASH_DURATION) {
                        beaconIntensity = 0.8; // Slightly dimmer for non-8th 32nd notes
                    } else {
                        beaconIntensity *= 0.85; // Fast decay
                    }
                }
            } else {
                // Not active, fade out
                beaconIntensity *= 0.95;
            }
        } else {
            // Between slots, fade out
            beaconIntensity *= 0.98;
        }
    } else {
        // No pattern yet, slow fade
        beaconIntensity *= 0.98;
    }
    
    // Clamp intensity
    beaconIntensity = Math.max(0, Math.min(1, beaconIntensity));
    
    drawBeacon();
    
    // Update status
    if (hyperBpm !== null && patternToUse) {
        const activeSlots = patternToUse.filter(slot => slot).length;
        updateStatus(`BPM: ${hyperBpm.toFixed(1)} | Pattern active slots: ${activeSlots}/32 | Displaying rhythm beacon`);
    }
}

// Animation loop
function animate() {
    const currentTime = performance.now() / 1000; // Convert to seconds
    updateBeacon(currentTime);
    requestAnimationFrame(animate);
}

// Initialize animation loop
animate();

console.log('🪩 [BEACON] Beacon initialized');

async function startDetection() {
    try {
        const startBtn = document.getElementById('startBtn');
        const stopBtn = document.getElementById('stopBtn');
        
        console.log('🪩 [BEACON] Starting detection - initializing audio context...');
        updateStatus('Initializing audio context...');
        currentPhase = 'initializing';
        
        // Reset modules
        BPM_ESTIMATOR.reset();
        ENERGY_CLASSIFIER.reset();
        RHYTHM_PREDICTOR.reset();
        SUSTAINED_BEAT_DETECTOR.reset();
        patternStartTime = performance.now() / 1000;
        lastPulseTime = -999;
        
        console.log('🪩 [BEACON] Requesting microphone access...');
        updateStatus('Requesting microphone access...');
        
        // Initialize beat detection
        await beatDetection.initBeatDetection(
            // onBeat callback
            (time, rms, threshold, avg) => {
                // Add beat to BPM estimator
                BPM_ESTIMATOR.addBeat(time);
                BPM_ESTIMATOR.update();
                
                if (currentPhase !== 'detecting') {
                    console.log('🪩 [BEACON] ⚡ Beat detected, entering detecting phase');
                }
                currentPhase = 'detecting';
                updateStatus(`Beat detected at ${time.toFixed(3)}s. Building BPM estimate...`);
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
                    
                    // Process pulse for sustained beat detection
                    SUSTAINED_BEAT_DETECTOR.processPulse(data.time, data.avg);
                    
                    if (currentPhase === 'detecting') {
                        console.log('🪩 [BEACON] 🎵 Pulse detected, building rhythm pattern...');
                        updateStatus(`Pulse detected. Building rhythm pattern...`);
                    }
                }
                
                // Update BPM estimator periodically
                BPM_ESTIMATOR.update();
                
                const hyperBpm = BPM_ESTIMATOR.getHyperSmoothedBPM();
                
                // Process diagnostic data for sustained beat detection
                const sustainedBeat = SUSTAINED_BEAT_DETECTOR.processDiagnostic(data.time, data.avg, hyperBpm);
                if (sustainedBeat !== null && sustainedBeat.duration32nd !== null) {
                    // Update rhythm predictor with sustained beat information
                    RHYTHM_PREDICTOR.processSustainedBeat(sustainedBeat.pulseTime, sustainedBeat.duration32nd, hyperBpm);
                }
                const hyperPrediction = RHYTHM_PREDICTOR.getHyperPredictedPhrasePattern();
                const energyLevel = ENERGY_CLASSIFIER.getCurrentEnergyLevel();
                if (hyperBpm !== null && currentPhase === 'detecting') {
                    currentPhase = 'ready';
                    const pattern = RHYTHM_PREDICTOR.getCurrentPhrasePattern();
                    if (pattern) {
                        console.log('🪩 [BEACON] ✅ Ready! BPM:', hyperBpm.toFixed(1), 'Pattern detected. Beacon is active.');
                        updateStatus(`Ready! BPM: ${hyperBpm.toFixed(1)}. Pattern detected. Beacon is active.`);
                    }
                }
                
                // Check if we have enough data (BPM, prediction, and energy level)
                const hasEnoughData = (hyperBpm !== null && hyperBpm > 0 && 
                                      hyperPrediction !== null && 
                                      energyLevel > 0);
                if (hasEnoughData && currentPhase === 'detecting') {
                    console.log('🪩 [BEACON] ✅ Enough data collected! (BPM:', hyperBpm.toFixed(1), 'Energy Level:', energyLevel, 'Has Prediction:', hyperPrediction !== null, ')');
                }
            }
        );
        
        isRunning = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        
        console.log('🪩 [BEACON] Detection started - entering listening stage');
        updateStatus('Listening... Waiting for beats and pulses...');
        currentPhase = 'waiting';
    } catch (error) {
        console.error('🪩 [BEACON] Error starting beat detection:', error);
        updateStatus('Error: ' + error.message);
        alert('Error starting beat detection: ' + error.message);
        currentPhase = 'waiting';
    }
}

function stopDetection() {
    console.log('🪩 [BEACON] Stopping detection');
    beatDetection.stopBeatDetection();
    
    isRunning = false;
    currentPhase = 'waiting';
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    
    // Reset modules
    BPM_ESTIMATOR.reset();
    ENERGY_CLASSIFIER.reset();
    RHYTHM_PREDICTOR.reset();
    SUSTAINED_BEAT_DETECTOR.reset();
    lastPulseTime = -999;
    patternStartTime = performance.now() / 1000;
    lastBeaconPattern = null;
    lastBeaconHyperBpm = null;
    hasLoggedHyperPrediction = false;
    
    console.log('🪩 [BEACON] Detection stopped, modules reset');
    updateStatus('Stopped. Click "Start Listening" to begin again.');
}

// Initialize button handlers
function init() {
    console.log('🪩 [BEACON] Initializing button handlers');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    
    startBtn.addEventListener('click', startDetection);
    stopBtn.addEventListener('click', stopDetection);
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('🪩 [BEACON] DOM loaded, initializing...');
        init();
    });
} else {
    console.log('🪩 [BEACON] DOM already ready, initializing...');
    init();
}

