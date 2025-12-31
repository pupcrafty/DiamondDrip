// Config is now in config.js

// -----------------------------
// Helper functions
// -----------------------------
function now() {
    return performance.now() / 1000.0;  // Convert to seconds
}

function clamp01(x) {
    return Math.max(0.0, Math.min(1.0, x));
}

function randomTargetPosition(existingTargets) {
    // Generate a random position that doesn't overlap with existing targets
    const maxAttempts = 50;
    for (let i = 0; i < maxAttempts; i++) {
        const x = Math.floor(Math.random() * (WIDTH - TARGET_RADIUS * 2)) + TARGET_RADIUS;
        const y = Math.floor(Math.random() * (HEIGHT - TARGET_RADIUS * 2)) + TARGET_RADIUS;
        
        // Check if this position overlaps with any existing target
        let overlaps = false;
        for (const target of existingTargets) {
            const dx = x - target.x;
            const dy = y - target.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < MIN_SPACING) {
                overlaps = true;
                break;
            }
        }
        
        if (!overlaps) {
            return [x, y];
        }
    }
    
    // If we couldn't find a non-overlapping position, return center as fallback
    return [WIDTH / 2, HEIGHT / 2];
}

function getTopSpawnPosition(targetX) {
    // Spawn at the top of the screen, same X as target
    const x = targetX;
    const scale = (WIDTH + HEIGHT) / 2000;
    const y = Math.round(50 * scale);  // Fixed position near top of screen, scaled
    
    return [x, y];
}

// Draw a star shape (5-pointed star)
function drawStar(ctx, x, y, outerRadius, innerRadius) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5 - Math.PI / 2;  // Start at top
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        const px = x + radius * Math.cos(angle);
        const py = y + radius * Math.sin(angle);
        if (i === 0) {
            ctx.moveTo(px, py);
        } else {
            ctx.lineTo(px, py);
        }
    }
    ctx.closePath();
    ctx.fill();
}

// -----------------------------
// Prediction Server Integration
// -----------------------------
const PREDICTION_SERVER_URL = 'https://le71czez6a.execute-api.us-east-1.amazonaws.com/production/prediction';
let lastPredictionSent = null; // Track last prediction sent to avoid duplicates
let serverIP = null; // Cache the server IP
let currentServerURL = PREDICTION_SERVER_URL; // Track current URL (may switch from localhost to IP)

// Get server IP from current page hostname (if not localhost)
function getServerIP() {
    if (serverIP) {
        return serverIP;
    }
    
    const hostname = window.location.hostname;
    
    // If page was loaded from an IP address (not localhost), use that
    if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
        // Check if it's a valid IP address
        const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (ipPattern.test(hostname)) {
            serverIP = hostname;
            return serverIP;
        }
        // If it's a hostname, use it as-is
        serverIP = hostname;
        return serverIP;
    }
    
    return null;
}

// Replace localhost with server IP in a URL
function replaceLocalhostWithIP(url) {
    const serverIP = getServerIP();
    if (serverIP && url.includes('localhost')) {
        return url.replace(/localhost/g, serverIP);
    }
    return url;
}

// Get the best URL to use (IP if available, otherwise original)
function getBestServerURL(originalUrl) {
    const serverIP = getServerIP();
    if (serverIP && originalUrl.includes('localhost')) {
        return replaceLocalhostWithIP(originalUrl);
    }
    return originalUrl;
}

// Send prediction data to server asynchronously
async function sendPredictionData() {
    try {
        const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
        const hyperPrediction = RHYTHM_PREDICTOR.getHyperPredictedPhrasePattern();
        
        // Only send if we have valid data
        if (hyperBPM === null || hyperBPM <= 0 || hyperPrediction === null) {
            return;
        }
        
        // Create a unique key for this prediction to avoid duplicate sends
        const predictionKey = JSON.stringify(hyperPrediction);
        if (lastPredictionSent === predictionKey) {
            return; // Already sent this prediction
        }
        lastPredictionSent = predictionKey;
        
        // Get BPM history (last 10 values)
        const bpmHistory = BPM_ESTIMATOR.getHyperSmoothedBPMHistory();
        const recentBpmHistory = bpmHistory.slice(-10);
        
        // Get recent pulse patterns (last 5 phrases)
        const allPhrasePatterns = RHYTHM_PREDICTOR.getPhrasePatterns();
        const recentPulsePatterns = allPhrasePatterns.slice(-5);
        
        // Get recent correct prediction parts (last 5)
        const allCorrectParts = RHYTHM_PREDICTOR.getCorrectPredictionPatterns();
        const recentCorrectPredictionParts = allCorrectParts.slice(-5);
        
        // Prepare payload
        const payload = {
            currentBPM: hyperBPM,
            bpmHistory: recentBpmHistory,
            recentPulsePatterns: recentPulsePatterns,
            recentCorrectPredictionParts: recentCorrectPredictionParts,
            currentPrediction: hyperPrediction,
            timestamp: new Date().toISOString()
        };
        
        // Send asynchronously and process response for BPM hint
        // Use currentServerURL which may have been updated to use IP instead of localhost
        const urlToUse = currentServerURL;
        
        fetch(urlToUse, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        })
        .then(response => {
            if (!response.ok) {
                return null;
            }
            return response.json();
        })
        .then(data => {
            // Extract average BPM from server response and feed it to the BPM estimator
            if (data && data.avg_bpm_last_20s !== null && data.avg_bpm_last_20s !== undefined) {
                const serverBPM = data.avg_bpm_last_20s;
                if (serverBPM > 0 && serverBPM < 300) {
                    BPM_ESTIMATOR.setServerBPMHint(serverBPM);
                }
            }
        })
        .catch(error => {
            // If localhost failed and we haven't switched to IP yet, try IP
            if (urlToUse.includes('localhost') && getServerIP()) {
                const ipUrl = replaceLocalhostWithIP(urlToUse);
                if (ipUrl !== urlToUse) {
                    // Update the current URL to use IP for future requests
                    currentServerURL = ipUrl;
                    console.log(`Prediction request to localhost failed, switching to IP: ${ipUrl}`);
                    
                    // Retry immediately with IP
                    fetch(ipUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(payload)
                    })
                    .then(response => {
                        if (!response.ok) {
                            return null;
                        }
                        return response.json();
                    })
                    .then(data => {
                        // Extract average BPM from server response and feed it to the BPM estimator
                        if (data && data.avg_bpm_last_20s !== null && data.avg_bpm_last_20s !== undefined) {
                            const serverBPM = data.avg_bpm_last_20s;
                            if (serverBPM > 0 && serverBPM < 300) {
                                BPM_ESTIMATOR.setServerBPMHint(serverBPM);
                            }
                        }
                    })
                    .catch(retryError => {
                        // Silently ignore retry errors - don't block game execution
                        // Uncomment for debugging:
                        // console.warn('Failed to send prediction data (retry with IP also failed):', retryError);
                    });
                } else {
                    // Silently ignore errors - don't block game execution
                    // Uncomment for debugging:
                    // console.warn('Failed to send prediction data:', error);
                }
            } else {
                // Silently ignore errors - don't block game execution
                // Uncomment for debugging:
                // console.warn('Failed to send prediction data:', error);
            }
        });
        
    } catch (error) {
        // Silently ignore errors - don't block game execution
        // Uncomment for debugging:
        // console.warn('Error preparing prediction data:', error);
    }
}

// -----------------------------
// Game initialization
// -----------------------------
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let targets = [];
let markers = [];
let combo = 0;
let totalScore = 0;  // Global running score total
let sustainScore = 0;  // Separate score for sustained beats (bonus points)
let lastResult = "";
let lastErrMs = 0;
let celebrationText = null;  // Celebration text to display
let celebrationTextTime = 0;  // Time when celebration text should disappear
let gameVersion = 1;  // Version number (loaded from version.json)

// Initialize canvas size
function initializeCanvas() {
    // Calculate dimensions based on window size
    calculateCanvasDimensions();
    
    // Set canvas dimensions
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    
    // Reinitialize targets with new dimensions
    initializeTargets();
    
    log('GAME', '🎮 [GAME] Canvas initialized:', WIDTH, 'x', HEIGHT);
}

// Handle window resize
function handleResize() {
    initializeCanvas();
    log('GAME', '🎮 [GAME] Canvas resized:', WIDTH, 'x', HEIGHT);
}

// Add resize event listener
window.addEventListener('resize', handleResize);

// Beat detection state
let isListening = false;
let hasEnoughData = false;
let spawnedPredictedBeats = new Set(); // Track which predicted beats we've already spawned markers for
let lastPhraseStartTime = null; // Track when the current phrase started (for prediction-based timing)
let lastPulseTime = -999; // Track last pulse time for gating
const PULSE_GATE_TIME = 0.1; // Minimum time between pulses (100ms)

// Initialize 3 targets (left, middle, right) at the bottom
function initializeTargets() {
    const scale = (WIDTH + HEIGHT) / 2000;
    const bottomY = HEIGHT - Math.round(200 * scale);  // Distance from bottom
    
    // Position 3 targets horizontally across the bottom
    const leftX = WIDTH / 4;      // Left target
    const middleX = WIDTH / 2;    // Middle target
    const rightX = WIDTH * 3 / 4; // Right target
    
    // 3 easily visible colors
    const colors = [
        'rgb(255, 70, 70)',    // Red - Left
        'rgb(70, 220, 140)',   // Green - Middle (sustained)
        'rgb(70, 150, 255)'    // Blue - Right
    ];
    
    const positions = [
        [leftX, bottomY],      // 0: Left
        [middleX, bottomY],    // 1: Middle
        [rightX, bottomY]      // 2: Right
    ];
    
    targets = [];
    for (let i = 0; i < 3; i++) {
        const target = new Target(-1, positions[i][0], positions[i][1], colors[i]);
        targets.push(target);
    }
}

// Initialize canvas and targets
initializeCanvas();
log('GAME', '🎮 [GAME] Game initialized with', targets.length, 'targets');

// Track sustained beats - no alternating logic needed
// Middle target (index 1) is used for sustained beats
// Left (0) and Right (2) targets are used for single beats

// -----------------------------
// Beat Detection Integration
// -----------------------------
async function startListening() {
    try {
        isListening = true;
        hasEnoughData = false;
        
        // Initialize beat detection
        await window.beatDetection.initBeatDetection(
            // onBeat callback - called when a beat is detected
            (time, rms, threshold, avg) => {
                log('BEAT', '🎵 [BEAT] Beat detected:', time, 'RMS:', rms);
                // Add beat to BPM estimator
                BPM_ESTIMATOR.addBeat(time);
                BPM_ESTIMATOR.update();
                
                // Add RMS sample to energy classifier
                ENERGY_CLASSIFIER.addRmsSample(rms);
                ENERGY_CLASSIFIER.update();
                
                // Process beat as pulse in rhythm predictor and sustained beat detector
                const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
                if (hyperBPM !== null && hyperBPM > 0) {
                    RHYTHM_PREDICTOR.processPulse(time, hyperBPM);
                    SUSTAINED_BEAT_DETECTOR.processPulse(time, avg);
                    lastPulseTime = time;
                }
            },
            // onDiagnostic callback - process continuous RMS data for pulse detection
            (data) => {
                // Update energy classifier with RMS data
                if (data.rms !== undefined) {
                    ENERGY_CLASSIFIER.addRmsSample(data.rms);
                    ENERGY_CLASSIFIER.update();
                    
                    // Detect pulses: RMS exceeds pulse threshold and enough time has passed since last pulse
                    const pulseThreshold = ENERGY_CLASSIFIER.getPulseThreshold();
                    if (pulseThreshold !== null && pulseThreshold > 0 && 
                        data.rms > pulseThreshold && 
                        data.time - lastPulseTime >= PULSE_GATE_TIME) {
                        lastPulseTime = data.time;
                        
                        // Process pulse in rhythm predictor and sustained beat detector
                        const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
                        if (hyperBPM !== null && hyperBPM > 0) {
                            RHYTHM_PREDICTOR.processPulse(data.time, hyperBPM);
                            SUSTAINED_BEAT_DETECTOR.processPulse(data.time, data.avg);
                        }
                    }
                }
                
                // Process diagnostic data for sustained beat detection (every diagnostic sample)
                const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
                if (hyperBPM !== null && hyperBPM > 0 && data.avg !== undefined) {
                    const sustainedBeat = SUSTAINED_BEAT_DETECTOR.processDiagnostic(data.time, data.avg, hyperBPM);
                    if (sustainedBeat !== null && sustainedBeat.duration32nd !== null) {
                        // Update rhythm predictor with sustained beat information
                        RHYTHM_PREDICTOR.processSustainedBeat(sustainedBeat.pulseTime, sustainedBeat.duration32nd, hyperBPM);
                    }
                }
            }
        );
        
        log('BEAT', '🎵 [BEAT] Beat detection started - entering listening stage');
    } catch (error) {
        console.error('🎮 [GAME] Error starting beat detection:', error);
        isListening = false;
    }
}

// Check if we have enough data to make predictions
let lastHasEnoughDataState = false;
function checkIfHasEnoughData() {
    const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
    const hyperPrediction = RHYTHM_PREDICTOR.getHyperPredictedPhrasePattern();
    const energyLevel = ENERGY_CLASSIFIER.getCurrentEnergyLevel();
    
    // Need BPM, prediction, and energy level
    const newHasEnoughData = (hyperBPM !== null && hyperBPM > 0 && 
                              hyperPrediction !== null && 
                              energyLevel > 0);
    
    // Log state transition
    if (!lastHasEnoughDataState && newHasEnoughData) {
        log('GAME', '🎮 [GAME] ✅ Enough data collected! Starting gameplay (BPM:', hyperBPM?.toFixed(1), 'Energy Level:', energyLevel, 'Has Prediction:', hyperPrediction !== null, ')');
    } else if (lastHasEnoughDataState && !newHasEnoughData) {
        log('GAME', '🎮 [GAME] ⚠️ Not enough data (waiting for more...)');
    }
    
    lastHasEnoughDataState = newHasEnoughData;
    hasEnoughData = newHasEnoughData;
    
    return hasEnoughData;
}

// Generate timestamps from hyper-prediction ONLY
// Uses only the predicted pattern from the rhythm predictor, not current detected beats
function getPredictedBeatTimestamps(currentTime) {
    const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
    const hyperPrediction = RHYTHM_PREDICTOR.getHyperPredictedPhrasePattern();
    const hyperPredictedDurations = RHYTHM_PREDICTOR.getHyperPredictedDurations();
    
    // Only use predictions - if no prediction available, return empty
    if (hyperBPM === null || hyperBPM <= 0 || hyperPrediction === null) {
        return [];
    }
    
    const beatDuration = 60.0 / hyperBPM; // Duration of one beat in seconds
    const phraseDuration = beatDuration * 4; // 4 beats per phrase
    const thirtySecondNoteDuration = beatDuration / 8; // 32nd note duration
    
    // Calculate phrase timing based on BPM only (not current pattern)
    // Align to phrase boundaries starting from a reference time
    // Use lastPhraseStartTime if available, otherwise estimate from current time
    let referencePhraseStart = lastPhraseStartTime;
    
    if (referencePhraseStart === null) {
        // No previous phrase start tracked, align current time to nearest phrase boundary
        // Round down to the nearest phrase boundary
        referencePhraseStart = currentTime - (currentTime % phraseDuration);
    }
    
    // Calculate next phrase start time based on reference
    const timeSinceReference = currentTime - referencePhraseStart;
    const phrasesElapsed = Math.floor(timeSinceReference / phraseDuration);
    const nextPhraseStart = referencePhraseStart + (phrasesElapsed + 1) * phraseDuration;
    
    // Also check if we should use the phrase after next (if next phrase is too soon)
    const timeToNextPhrase = nextPhraseStart - currentTime;
    let targetPhraseStart = nextPhraseStart;
    if (timeToNextPhrase < 0.2) {
        // Next phrase is very soon, use the one after (reduced threshold from 0.5s to 0.2s for faster startup)
        targetPhraseStart = nextPhraseStart + phraseDuration;
    }
    
    // Generate timestamps from the predicted pattern using predicted durations
    const timestamps = [];
    
    for (let slot = 0; slot < hyperPrediction.length; slot++) {
        if (hyperPrediction[slot]) {
            const beatNumber = Math.floor(slot / 8);
            
            // Include beats on first (0), second (1), third (2), or fourth (3) beat
            if (beatNumber >= 0 && beatNumber <= 3) {
                const timeInPhrase = slot * thirtySecondNoteDuration;
                const beatTime = targetPhraseStart + timeInPhrase;
                
                // Check if this slot has a predicted duration (sustained beat)
                const duration32nd = (hyperPredictedDurations && hyperPredictedDurations[slot] !== null && hyperPredictedDurations[slot] !== undefined) 
                    ? hyperPredictedDurations[slot] 
                    : 0;
                const isSustained = duration32nd > 0;
                const duration = duration32nd * thirtySecondNoteDuration; // Convert to seconds
                
                // Only include future beats (at least 0.1 seconds in the future)
                // Only add if we haven't already added this slot (check for previous slots in same sustained run)
                const alreadyAdded = timestamps.some(ts => ts.slot === slot || (ts.isSustained && ts.slot < slot && slot <= ts.endSlot));
                if (!alreadyAdded && beatTime > currentTime + 0.1) {
                    // Calculate end slot for sustained beats
                    const endSlot = isSustained ? Math.min(slot + Math.ceil(duration32nd) - 1, hyperPrediction.length - 1) : slot;
                    
                    timestamps.push({
                        time: beatTime,
                        slot: slot,
                        phraseStart: targetPhraseStart,
                        isSustained: isSustained,
                        duration: duration,
                        duration32nd: duration32nd,
                        endSlot: endSlot
                    });
                }
            }
        }
    }
    
    // Update last phrase start time for next calculation
    if (targetPhraseStart !== lastPhraseStartTime) {
        lastPhraseStartTime = targetPhraseStart;
    }
    
    return timestamps;
}

// -----------------------------
// Game loop
// -----------------------------
function gameLoop() {
    const t = now();
    
    // Update BPM and energy classifiers periodically
    BPM_ESTIMATOR.update();
    ENERGY_CLASSIFIER.update();
    
    // Check if we have enough data
    checkIfHasEnoughData();
    
    // Get predicted beat timestamps from hyper-prediction ONLY
    if (hasEnoughData) {
        const predictedBeats = getPredictedBeatTimestamps(t);
        const energyLevel = ENERGY_CLASSIFIER.getCurrentEnergyLevel();
        
        // Send prediction data to server if we have predictions
        if (predictedBeats.length > 0) {
            sendPredictionData();
        }
        
        // Spawn markers for predicted beats we haven't spawned yet
        for (const beatInfo of predictedBeats) {
            const beatKey = `${beatInfo.phraseStart}_${beatInfo.slot}`;
            
            if (!spawnedPredictedBeats.has(beatKey) && beatInfo.time > t) {
                // Spawn marker for this predicted beat
                if (beatInfo.isSustained) {
                    // For sustained beats, create TWO markers:
                    // 1. Start marker: falls to left (0) or right (2) side, arrives when sustain starts
                    // 2. End marker: falls to middle (1), arrives when sustain ends
                    const startSideIndex = Math.random() < 0.5 ? 0 : 2;
                    const startSide = targets[startSideIndex];
                    const endTarget = targets[1]; // Middle target
                    
                    // Calculate spawn positions
                    const [startTopX, startTopY] = getTopSpawnPosition(startSide.x);
                    const [endTopX, endTopY] = getTopSpawnPosition(endTarget.x);
                    
                    // Calculate distances and fall times
                    const startDx = startSide.x - startTopX;
                    const startDy = startSide.y - startTopY;
                    const startDistance = Math.sqrt(startDx * startDx + startDy * startDy);
                    const startFallTime = startDistance / MARKER_FALL_SPEED;
                    
                    const endDx = endTarget.x - endTopX;
                    const endDy = endTarget.y - endTopY;
                    const endDistance = Math.sqrt(endDx * endDx + endDy * endDy);
                    const endFallTime = endDistance / MARKER_FALL_SPEED;
                    
                    // Calculate arrival times
                    const startArrivalTime = beatInfo.time; // When sustain starts
                    const endArrivalTime = beatInfo.time + beatInfo.duration; // When sustain ends
                    
                    // Calculate total times and hold durations
                    const startTotalTime = startArrivalTime - t;
                    const startHoldDuration = startTotalTime - startFallTime;
                    
                    const endTotalTime = endArrivalTime - t;
                    const endHoldDuration = endTotalTime - endFallTime;
                    
                    // Only create markers if we have enough time
                    if (startHoldDuration >= 0 && startTotalTime > 0.01 && endHoldDuration >= 0 && endTotalTime > 0.01) {
                        // Create start marker (on side, arrives when sustain starts)
                        const startFallVx = (startDx / startDistance) * MARKER_FALL_SPEED;
                        const startFallVy = (startDy / startDistance) * MARKER_FALL_SPEED;
                        const startMarker = new Marker(startSide, t, startArrivalTime, startTopX, startTopY, startHoldDuration, startFallVx, startFallVy, 0, null, null, true); // isStartMarker = true
                        
                        // Create end marker (on middle, arrives when sustain ends)
                        const endFallVx = (endDx / endDistance) * MARKER_FALL_SPEED;
                        const endFallVy = (endDy / endDistance) * MARKER_FALL_SPEED;
                        const endMarker = new Marker(endTarget, t, endArrivalTime, endTopX, endTopY, endHoldDuration, endFallVx, endFallVy, 0, startSide, null, false); // isStartMarker = false
                        
                        // Link the markers together
                        startMarker.pairedMarker = endMarker;
                        endMarker.pairedMarker = startMarker;
                        
                        // Add markers to their targets
                        startSide.markers.push(startMarker);
                        endTarget.markers.push(endMarker);
                        markers.push(startMarker);
                        markers.push(endMarker);
                        
                        // Mark this beat as spawned
                        spawnedPredictedBeats.add(beatKey);
                        
                        log('GAME', `🎮 [GAME] 🎯 Sustained beat markers spawned: Start (${startSideIndex === 0 ? 'left' : 'right'}) at ${startArrivalTime.toFixed(3)}s, End (middle) at ${endArrivalTime.toFixed(3)}s, Duration: ${beatInfo.duration.toFixed(3)}s`);
                    }
                } else {
                    // For single beats, check if there's an active sustain and block same side
                    let targetIndex;
                    if (currentlySustainingSide === 0) {
                        targetIndex = 2; // Right only
                    } else if (currentlySustainingSide === 2) {
                        targetIndex = 0; // Left only
                    } else {
                        // Middle sustaining or no sustain - random choice
                        targetIndex = Math.random() < 0.5 ? 0 : 2;
                    }
                    const target = targets[targetIndex];
                    
                    // Calculate top spawn position
                    const [topX, topY] = getTopSpawnPosition(target.x);
                    
                    // Calculate distance from top to target
                    const dx = target.x - topX;
                    const dy = target.y - topY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    // Calculate fall time needed at fixed speed
                    const fallTime = distance / MARKER_FALL_SPEED;
                    
                    // Calculate total time available
                    const totalTime = beatInfo.time - t;
                    
                    // Calculate hold duration: hold for remaining time after fall
                    let holdDuration = totalTime - fallTime;
                    
                    // Only create marker if we have enough time for fall at fixed speed
                    if (holdDuration < 0 || totalTime < 0.01) {
                        continue;
                    }
                    
                    // Always use fixed speed for consistent fall speeds
                    const fallVx = (dx / distance) * MARKER_FALL_SPEED;
                    const fallVy = (dy / distance) * MARKER_FALL_SPEED;
                    
                    // Create marker
                    const marker = new Marker(target, t, beatInfo.time, topX, topY, holdDuration, fallVx, fallVy, 0);
                    
                    // Add marker to target's markers array
                    target.markers.push(marker);
                    markers.push(marker);
                    
                    // Mark this beat as spawned
                    spawnedPredictedBeats.add(beatKey);
                    
                    target.beatSpawn = -1;
                    target.beatDisappear = beatInfo.time;
                    
                    const sideName = targetIndex === 0 ? 'left' : 'right';
                    log('GAME', `🎮 [GAME] 🎯 Single beat marker spawned (${sideName}) at ${beatInfo.time.toFixed(3)}s`);
                }
            }
        }
        
        // Clean up old spawned beats (keep only recent ones)
        if (spawnedPredictedBeats.size > 100) {
            const keysToRemove = Array.from(spawnedPredictedBeats).slice(0, 50);
            for (const key of keysToRemove) {
                spawnedPredictedBeats.delete(key);
            }
        }
    }
    
    // Update markers
    for (const marker of markers) {
        marker.update(t);
    }
    
    // Check for sustained beat completion and timeouts
    const sustainedInputsToCleanup = [];
    const gracePeriod = 0.2; // Grace period in seconds
    
    for (const [pairId, sustainInput] of activeSustainedInputs.entries()) {
        const endMarker = sustainInput.endMarker;
        const timeSinceEndMarker = t - endMarker.tArrival;
        
        // Check if end marker has arrived (within grace period)
        if (timeSinceEndMarker >= 0 && timeSinceEndMarker <= gracePeriod && !endMarker.hit) {
            // Check if input is still active based on input type
            let inputStillActive = false;
            
            if (sustainInput.inputType === 'keyboard') {
                // For keyboard, check if the key is still held
                if (sustainInput.inputData.key === 'a') {
                    inputStillActive = leftKeyHeld && leftKeyActiveSustain === pairId;
                } else if (sustainInput.inputData.key === 'd') {
                    inputStillActive = rightKeyHeld && rightKeyActiveSustain === pairId;
                }
            } else if (sustainInput.inputType === 'mouse') {
                // For mouse, check if drag is still active
                inputStillActive = mouseDragActive && mouseDragSustain === pairId;
            } else if (sustainInput.inputType === 'touch') {
                // For touch, check if at least one touch is still active
                const touch1Active = sustainInput.inputData.touchId1 !== undefined && touchPositions.has(sustainInput.inputData.touchId1);
                const touch2Active = sustainInput.inputData.touchId2 !== undefined && touchPositions.has(sustainInput.inputData.touchId2);
                inputStillActive = touch1Active || touch2Active;
            }
            
            // If input is still active, complete the sustain
            if (inputStillActive) {
                const holdDuration = t - sustainInput.startTime;
                const expectedDuration = endMarker.tArrival - sustainInput.startMarker.tArrival;
                
                // Score the end marker hit
                const result = endMarker.target.getHitResult(endMarker.x, endMarker.y);
                if (result === "MISS") {
                    combo = 0;
                    log('GAME', '🎮 [GAME] ❌ Sustained beat end MISS (Combo reset)');
                } else {
                    combo += 1;
                    log('GAME', '🎮 [GAME] ✅ Sustained beat completed:', result, '(Combo:', combo, ')');
                    
                    const scoreIncrement = result === "OKAY" ? 1 : 
                                          result === "GOOD" ? 2 : 
                                          result === "GREAT" ? 3 : 
                                          result === "PERFECT" ? 5 : 0;
                    totalScore += scoreIncrement;
                }
                
                // Calculate bonus points for holding duration
                const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
                if (hyperBPM && hyperBPM > 0) {
                    const beatDuration = 60.0 / hyperBPM;
                    const thirtySecondNoteDuration = beatDuration / 8;
                    const holdDuration32nd = holdDuration / thirtySecondNoteDuration;
                    const expectedDuration32nd = expectedDuration / thirtySecondNoteDuration;
                    
                    // Bonus: 1 point per additional 32nd beat held (beyond the initial pulse)
                    const bonus32nd = Math.max(0, Math.floor(holdDuration32nd - 1));
                    if (bonus32nd > 0) {
                        sustainScore += bonus32nd;
                        log('GAME', `🎮 [GAME] 🎯 Sustained beat bonus: ${bonus32nd} points (held for ${holdDuration32nd.toFixed(2)} 32nd beats, Sustain Score: ${sustainScore})`);
                    }
                }
                
                // Mark end marker as hit
                endMarker.hit = true;
                
                // Set target.hit for visual feedback
                endMarker.target.hit = true;
                setTimeout(() => {
                    endMarker.target.hit = false;
                }, 200);
                
                // Mark for cleanup
                sustainedInputsToCleanup.push(pairId);
            }
        }
        
        // If end marker has passed by more than grace period, clean up
        if (timeSinceEndMarker > gracePeriod) {
            // Sustained beat timed out - mark as missed
            if (!endMarker.hit) {
                endMarker.hit = true;
                combo = 0;
                log('GAME', '🎮 [GAME] ❌ Sustained beat timed out (MISS)');
            }
            sustainedInputsToCleanup.push(pairId);
        }
    }
    
    // Clean up timed-out sustained inputs
    for (const pairId of sustainedInputsToCleanup) {
        const sustainInput = activeSustainedInputs.get(pairId);
        if (sustainInput) {
            // Clean up keyboard tracking
            if (sustainInput.inputType === 'keyboard') {
                if (sustainInput.inputData.key === 'a') {
                    leftKeyHeld = false;
                    leftKeyActiveSustain = null;
                } else if (sustainInput.inputData.key === 'd') {
                    rightKeyHeld = false;
                    rightKeyActiveSustain = null;
                }
            }
            
            // Clean up mouse tracking
            if (sustainInput.inputType === 'mouse') {
                mouseDragActive = false;
                mouseDragSustain = null;
            }
            
            // Clean up touch tracking
            if (sustainInput.inputType === 'touch') {
                if (sustainInput.inputData.touchId1 !== undefined) {
                    touchActiveSustains.delete(sustainInput.inputData.touchId1);
                }
                if (sustainInput.inputData.touchId2 !== undefined) {
                    touchActiveSustains.delete(sustainInput.inputData.touchId2);
                }
            }
        }
        activeSustainedInputs.delete(pairId);
    }
    
    // Update legacy tracking for backward compatibility
    if (currentlySustainingSide !== null) {
        // Check if any active sustained inputs are still valid
        let hasActiveSustain = false;
        for (const sustainInput of activeSustainedInputs.values()) {
            if (t < sustainInput.endMarker.tArrival + 0.2) {
                hasActiveSustain = true;
                break;
            }
        }
        if (!hasActiveSustain) {
            currentlySustainingSide = null;
            sustainedBeatStartTime = null;
            sustainedBeatDuration = 0;
            sustainedBeatDuration32nd = 0;
        }
    }
    
    // Remove markers that have left the yellow circle or are individually marked as hit
    // Only remove markers that are individually hit, not all markers for a hit target
    const markersToRemove = markers.filter(marker => marker.hit || marker.hasLeftYellowCircle(t));
    for (const marker of markersToRemove) {
        if (!marker.hit && marker.hasLeftYellowCircle(t)) {
            log('GAME', '🎮 [GAME] ⏭️ Marker left target circle without being hit');
        }
        // Remove marker from target's markers array
        const targetMarkerIndex = marker.target.markers.indexOf(marker);
        if (targetMarkerIndex !== -1) {
            marker.target.markers.splice(targetMarkerIndex, 1);
        }
    }
    markers = markers.filter(marker => !marker.hit && !marker.hasLeftYellowCircle(t));
    
    // Draw
    ctx.fillStyle = 'rgb(18, 18, 24)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    
    // Draw targets (draw first so markers appear on top)
    for (const target of targets) {
        // Reset hit state if no markers are left
        if (target.hit && target.markers.length === 0) {
            target.hit = false;
        }
        
        if (target.hit) {
            // Show green flash when hit
            ctx.fillStyle = 'rgb(70, 220, 140)';  // Green for hit
            ctx.beginPath();
            ctx.arc(target.x, target.y, TARGET_RADIUS, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Pulse effect based on how close we are to the beat when it should disappear
            const targetScale = (WIDTH + HEIGHT) / 2000;
            let pulseR = TARGET_RADIUS;
            if (target.markers.length > 0 && target.beatDisappear) {
                const dtToBeat = target.beatDisappear - t;
                const pulse = Math.exp(-Math.abs(dtToBeat) * 8.0);
                pulseR = TARGET_RADIUS + Math.round(8 * pulse * targetScale);
            }
            
            // Outer pulse ring (use target color with some transparency)
            ctx.strokeStyle = target.color;
            ctx.lineWidth = Math.max(1, Math.round(3 * targetScale));
            ctx.beginPath();
            ctx.arc(target.x, target.y, pulseR, 0, Math.PI * 2);
            ctx.stroke();
            
            // Main target circle (use target color)
            ctx.fillStyle = target.color;
            ctx.beginPath();
            ctx.arc(target.x, target.y, TARGET_RADIUS, 0, Math.PI * 2);
            ctx.fill();
            
            // Timing window rings (visualize Perfect/Good buffer)
            ctx.strokeStyle = 'rgb(60, 220, 120)';
            ctx.lineWidth = Math.max(1, Math.round(1 * targetScale));
            ctx.beginPath();
            ctx.arc(target.x, target.y, TARGET_RADIUS + Math.round((PERFECT_W / GOOD_W) * 30 * targetScale), 0, Math.PI * 2);
            ctx.stroke();
            
            ctx.strokeStyle = 'rgb(220, 200, 60)';
            ctx.beginPath();
            ctx.arc(target.x, target.y, TARGET_RADIUS + Math.round(30 * targetScale), 0, Math.PI * 2);
            ctx.stroke();
            
            // Show key label if target has markers
            if (target.markers.length > 0 && hasEnoughData) {
                const targetIndex = targets.indexOf(target);
                // Map target indices to keys: Left (A/←), Middle (S/Space), Right (D/→)
                const keyLabels = ['A', 'S', 'D'];
                const keyLabel = keyLabels[targetIndex];
                
                const keyScale = (WIDTH + HEIGHT) / 2000;
                const keyRadius = Math.round(14 * keyScale);
                const keyOffset = Math.round(15 * keyScale);
                const keyFontSize = Math.round(18 * keyScale);
                
                // Draw key label with background for better visibility
                ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                ctx.beginPath();
                ctx.arc(target.x, target.y - TARGET_RADIUS - keyOffset, keyRadius, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.fillStyle = 'rgb(255, 255, 255)';
                ctx.font = `bold ${keyFontSize}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(keyLabel, target.x, target.y - TARGET_RADIUS - keyOffset);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
            }
            
        }
    }
    
    // Draw markers - draw after targets so they appear on top
    for (const marker of markers) {
        // Only draw if marker hasn't been hit and is on screen or near screen (within reasonable bounds)
        if (!marker.hit && marker.x > -100 && marker.x < WIDTH + 100 && marker.y > -100 && marker.y < HEIGHT + 100) {
            ctx.fillStyle = marker.target.color;  // Match target color
            
            // Check if this is a sustained beat marker (has a paired marker)
            if (marker.isSustainedBeatMarker() && marker.pairedMarker) {
                // Draw sustained beat: two markers connected by a line
                const startMarker = marker.tArrival < marker.pairedMarker.tArrival ? marker : marker.pairedMarker;
                const endMarker = marker.tArrival < marker.pairedMarker.tArrival ? marker.pairedMarker : marker;
                
                // Only draw the line if we're processing the start marker (to avoid drawing twice)
                if (marker === startMarker) {
                    // Draw connecting line between the two markers
                    // Always use current positions (whether falling or arrived) so line is visible during entire fall
                    const startX = startMarker.x;
                    const startY = startMarker.y;
                    const endX = endMarker.x;
                    const endY = endMarker.y;
                    
                    // Draw line connecting the two markers with gradient color
                    ctx.lineWidth = MARKER_RADIUS * 1.5;
                    ctx.lineCap = 'round';
                    
                    // Get colors
                    const startColor = startMarker.target.color; // Red or Blue
                    const endColor = endMarker.target.color; // Green
                    
                    // Parse RGB colors
                    const parseColor = (colorStr) => {
                        const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                        if (match) {
                            return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
                        }
                        return [128, 128, 128];
                    };
                    
                    const [r1, g1, b1] = parseColor(startColor);
                    const [r2, g2, b2] = parseColor(endColor);
                    
                    // Draw line with gradient (multiple segments for smooth color transition)
                    const numSegments = 30;
                    for (let i = 0; i < numSegments; i++) {
                        const segT = i / numSegments;
                        const segT2 = (i + 1) / numSegments;
                        
                        const x1 = startX + (endX - startX) * segT;
                        const y1 = startY + (endY - startY) * segT;
                        const x2 = startX + (endX - startX) * segT2;
                        const y2 = startY + (endY - startY) * segT2;
                        
                        // Interpolate color
                        const r = Math.round(r1 + (r2 - r1) * segT);
                        const g = Math.round(g1 + (g2 - g1) * segT);
                        const b = Math.round(b1 + (b2 - b1) * segT);
                        
                        ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
                        ctx.beginPath();
                        ctx.moveTo(x1, y1);
                        ctx.lineTo(x2, y2);
                        ctx.stroke();
                    }
                }
                
                // Draw the marker itself (circular)
                ctx.fillStyle = marker.target.color;
                ctx.beginPath();
                ctx.arc(marker.x, marker.y, MARKER_RADIUS, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // Draw normal circular marker (falling down to target)
                ctx.beginPath();
                ctx.arc(marker.x, marker.y, MARKER_RADIUS, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    
    // UI text - scale font sizes with canvas
    const scale = (WIDTH + HEIGHT) / 2000;  // Scale factor based on average dimension
    const fontSize1 = Math.round(28 * scale);
    const fontSize2 = Math.round(44 * scale);
    const fontSize3 = Math.round(72 * scale);
    const padding = Math.round(20 * scale);
    
    ctx.fillStyle = 'rgb(230, 230, 240)';
    ctx.font = `${fontSize1}px Arial`;
    
    // Display hypersmoothed BPM
    const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
    const bpmText = hyperBPM !== null && hyperBPM > 0 ? hyperBPM.toFixed(1) : '---';
    const info = `BPM: ${bpmText} | Score: ${totalScore} | Sustain: ${sustainScore} | Combo: ${combo}`;
    ctx.fillText(info, padding, padding + fontSize1);
    
    if (lastResult) {
        ctx.font = `${fontSize2}px Arial`;
        const resultText = lastResult;
        ctx.fillText(resultText, padding, padding + fontSize1 + fontSize2);
    }
    
    // Display celebration text if active
    if (celebrationText && t < celebrationTextTime) {
        ctx.font = `bold ${fontSize3}px Arial`;
        ctx.fillStyle = 'rgb(255, 215, 0)';  // Gold color
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Add glow effect with multiple strokes
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.8)';
        ctx.lineWidth = Math.round(8 * scale);
        ctx.strokeText(celebrationText, WIDTH / 2, HEIGHT / 2);
        
        ctx.fillText(celebrationText, WIDTH / 2, HEIGHT / 2);
        
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    } else if (celebrationText && t >= celebrationTextTime) {
        // Clear celebration text after timeout
        celebrationText = null;
        celebrationTextTime = 0;
    }
    
    // Display "listening" text if we don't have enough data (styled like celebration text)
    if (!hasEnoughData) {
        ctx.font = `bold ${fontSize3}px Arial`;
        ctx.fillStyle = 'rgb(255, 215, 0)';  // Gold color (same as celebration)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Add glow effect with multiple strokes
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.8)';
        ctx.lineWidth = Math.round(8 * scale);
        ctx.strokeText('listening', WIDTH / 2, HEIGHT / 2);
        
        ctx.fillText('listening', WIDTH / 2, HEIGHT / 2);
        
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
    
    // Display version number in bottom-left corner
    ctx.fillStyle = 'rgba(170, 170, 190, 0.8)';
    ctx.font = `${Math.round(fontSize1 * 0.7)}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`v${gameVersion}`, padding, HEIGHT - padding);
    ctx.textBaseline = 'alphabetic';
    
    requestAnimationFrame(gameLoop);
}

// -----------------------------
// Event handlers
// -----------------------------

// Function to handle hitting a target by index (0-7) or by mouse position
// inputTypeHint: 'keyboard' | 'mouse' | 'touch' (optional, for sustained beats)
function hitTarget(targetIndex = null, mouseX = null, mouseY = null, inputTypeHint = null) {
    const yellowRadius = getYellowRadius();
    let clickedTarget = null;
    
    if (targetIndex !== null && targetIndex >= 0 && targetIndex < targets.length) {
        // Hit target by index (keyboard input)
        const target = targets[targetIndex];
        clickedTarget = target;
    } else if (mouseX !== null && mouseY !== null) {
        // Find target by mouse position (mouse click)
        for (const target of targets) {
            const dx = mouseX - target.x;
            const dy = mouseY - target.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Check if click is within the yellow circle (clickable area)
            if (distance <= yellowRadius) {
                clickedTarget = target;
                break;  // Click the first target found (in case of overlap)
            }
        }
    }
    
    if (clickedTarget) {
        // Find the next marker for this target (the one that will arrive first)
        // Use arrival time (tArrival) to find the actual next marker, not just spatial distance
        let nextMarker = null;
        let earliestArrival = Infinity;
        const currentTime = now();
        
        for (const marker of markers) {
            // Only consider markers for this target that haven't been hit
            if (marker.target === clickedTarget && !marker.hit) {
                // Find the marker with the earliest arrival time (the next one to hit)
                if (marker.tArrival < earliestArrival && marker.tArrival > currentTime - 0.5) {
                    earliestArrival = marker.tArrival;
                    nextMarker = marker;
                }
            }
        }
        
        if (nextMarker) {
            // Check if this is a sustained beat marker
            if (nextMarker.isSustainedBeatMarker() && nextMarker.pairedMarker) {
                // This is a sustained beat - determine if it's the start or end marker
                const startMarker = nextMarker.tArrival < nextMarker.pairedMarker.tArrival ? nextMarker : nextMarker.pairedMarker;
                const endMarker = nextMarker.tArrival < nextMarker.pairedMarker.tArrival ? nextMarker.pairedMarker : nextMarker;
                
                // Check if we're hitting the start marker (on the side)
                if (nextMarker === startMarker) {
                    // Start of sustained beat - begin tracking the input
                    const pairId = `${startMarker.tArrival}_${endMarker.tArrival}`;
                    const currentTime = now();
                    
                    // Determine input type based on how we got here
                    let inputType = inputTypeHint || 'mouse';
                    let inputData = {};
                    
                    if (targetIndex !== null) {
                        // Keyboard input
                        inputType = 'keyboard';
                        inputData = { key: targetIndex === 0 ? 'a' : 'd' };
                    } else if (mouseX !== null && mouseY !== null) {
                        if (inputType === 'touch') {
                            // Touch input - find which touch is at this position
                            inputData = { touchId1: undefined, touchId2: undefined, touch1Data: { x: mouseX, y: mouseY }, touch2Data: null };
                            // Find the touch at this position
                            for (const [touchId, touchData] of touchPositions.entries()) {
                                const dx = touchData.x - mouseX;
                                const dy = touchData.y - mouseY;
                                const distance = Math.sqrt(dx * dx + dy * dy);
                                if (distance < 10) { // Within 10 pixels
                                    inputData.touchId1 = touchId;
                                    break;
                                }
                            }
                        } else {
                            // Mouse input
                            inputType = 'mouse';
                            inputData = { startX: mouseX, startY: mouseY, currentX: mouseX, currentY: mouseY };
                        }
                    }
                    
                    // Start tracking this sustained input
                    activeSustainedInputs.set(pairId, {
                        startMarker: startMarker,
                        endMarker: endMarker,
                        startTime: currentTime,
                        inputType: inputType,
                        inputData: inputData
                    });
                    
                    // Mark start marker as hit (but don't remove it yet - we need it for the line)
                    startMarker.hit = true;
                    
                    // Set target.hit for visual feedback
                    clickedTarget.hit = true;
                    setTimeout(() => {
                        clickedTarget.hit = false;
                    }, 200);
                    
                    // Score the initial hit
                    const result = clickedTarget.getHitResult(startMarker.x, startMarker.y);
                    if (result === "MISS") {
                        combo = 0;
                        log('GAME', '🎮 [GAME] ❌ Sustained beat start MISS (Combo reset)');
                    } else {
                        combo += 1;
                        log('GAME', '🎮 [GAME] ✅ Sustained beat started:', result, '(Combo:', combo, ')');
                        
                        const scoreIncrement = result === "OKAY" ? 1 : 
                                              result === "GOOD" ? 2 : 
                                              result === "GREAT" ? 3 : 
                                              result === "PERFECT" ? 5 : 0;
                        totalScore += scoreIncrement;
                    }
                    
                    lastResult = result;
                    
                    // Update tracking for keyboard
                    if (inputType === 'keyboard') {
                        if (inputData.key === 'a') {
                            leftKeyHeld = true;
                            leftKeyActiveSustain = pairId;
                        } else if (inputData.key === 'd') {
                            rightKeyHeld = true;
                            rightKeyActiveSustain = pairId;
                        }
                    }
                    
                    // Update tracking for mouse
                    if (inputType === 'mouse') {
                        mouseDragActive = true;
                        mouseDragSustain = pairId;
                        mouseDragStartX = mouseX;
                        mouseDragStartY = mouseY;
                    }
                    
                    // Update tracking for touch
                    if (inputType === 'touch' && inputData.touchId1 !== undefined) {
                        touchActiveSustains.set(inputData.touchId1, pairId);
                    }
                    
                    // Block same-side pulses during this sustain
                    const startSideIndex = startMarker.target === targets[0] ? 0 : 2;
                    currentlySustainingSide = startSideIndex;
                    sustainedBeatStartTime = currentTime;
                    
                    // Calculate expected duration
                    const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
                    if (hyperBPM && hyperBPM > 0) {
                        const beatDuration = 60.0 / hyperBPM;
                        sustainedBeatDuration = endMarker.tArrival - startMarker.tArrival;
                        sustainedBeatDuration32nd = sustainedBeatDuration / (beatDuration / 8);
                    }
                } else {
                    // This is the end marker - check if we've been holding the sustain
                    const pairId = `${startMarker.tArrival}_${endMarker.tArrival}`;
                    const sustainInput = activeSustainedInputs.get(pairId);
                    
                    if (sustainInput) {
                        // We've been holding the sustain - complete it
                        const holdDuration = now() - sustainInput.startTime;
                        const expectedDuration = endMarker.tArrival - startMarker.tArrival;
                        
                        // Score the end marker hit
                        const result = clickedTarget.getHitResult(endMarker.x, endMarker.y);
                        if (result === "MISS") {
                            combo = 0;
                            log('GAME', '🎮 [GAME] ❌ Sustained beat end MISS (Combo reset)');
                        } else {
                            combo += 1;
                            log('GAME', '🎮 [GAME] ✅ Sustained beat completed:', result, '(Combo:', combo, ')');
                            
                            const scoreIncrement = result === "OKAY" ? 1 : 
                                                  result === "GOOD" ? 2 : 
                                                  result === "GREAT" ? 3 : 
                                                  result === "PERFECT" ? 5 : 0;
                            totalScore += scoreIncrement;
                        }
                        
                        // Calculate bonus points for holding duration
                        const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
                        if (hyperBPM && hyperBPM > 0) {
                            const beatDuration = 60.0 / hyperBPM;
                            const thirtySecondNoteDuration = beatDuration / 8;
                            const holdDuration32nd = holdDuration / thirtySecondNoteDuration;
                            const expectedDuration32nd = expectedDuration / thirtySecondNoteDuration;
                            
                            // Bonus: 1 point per additional 32nd beat held (beyond the initial pulse)
                            const bonus32nd = Math.max(0, Math.floor(holdDuration32nd - 1));
                            if (bonus32nd > 0) {
                                sustainScore += bonus32nd;
                                log('GAME', `🎮 [GAME] 🎯 Sustained beat bonus: ${bonus32nd} points (held for ${holdDuration32nd.toFixed(2)} 32nd beats, Sustain Score: ${sustainScore})`);
                            }
                        }
                        
                        // Mark end marker as hit
                        endMarker.hit = true;
                        
                        // Set target.hit for visual feedback
                        clickedTarget.hit = true;
                        setTimeout(() => {
                            clickedTarget.hit = false;
                        }, 200);
                        
                        // Clean up tracking
                        activeSustainedInputs.delete(pairId);
                        
                        if (sustainInput.inputType === 'keyboard') {
                            if (sustainInput.inputData.key === 'a') {
                                leftKeyHeld = false;
                                leftKeyActiveSustain = null;
                            } else if (sustainInput.inputData.key === 'd') {
                                rightKeyHeld = false;
                                rightKeyActiveSustain = null;
                            }
                        }
                        
                        if (sustainInput.inputType === 'mouse') {
                            mouseDragActive = false;
                            mouseDragSustain = null;
                        }
                        
                        currentlySustainingSide = null;
                        sustainedBeatStartTime = null;
                        sustainedBeatDuration = 0;
                        sustainedBeatDuration32nd = 0;
                    } else {
                        // We didn't hold the sustain - treat as a miss
                        combo = 0;
                        lastResult = "MISS";
                        log('GAME', '🎮 [GAME] ❌ Sustained beat end hit without holding (MISS)');
                    }
                }
            } else {
                // Normal single beat marker
                const result = clickedTarget.getHitResult(nextMarker.x, nextMarker.y);
                
                // Mark this specific marker as hit
                nextMarker.hit = true;
                
                // Set target.hit for visual feedback
                clickedTarget.hit = true;
                setTimeout(() => {
                    clickedTarget.hit = false;
                }, 200);
                
                if (result === "MISS") {
                    combo = 0;
                    log('GAME', '🎮 [GAME] ❌ Target hit but scored MISS (Combo reset)');
                } else {
                    combo += 1;
                    log('GAME', '🎮 [GAME] ✅ Target hit:', result, '(Combo:', combo, ')');
                    
                    const scoreIncrement = result === "OKAY" ? 1 : 
                                          result === "GOOD" ? 2 : 
                                          result === "GREAT" ? 3 : 
                                          result === "PERFECT" ? 5 : 0;
                    totalScore += scoreIncrement;
                }
                
                lastResult = result;
                lastErrMs = 0;
            }
        } else {
            // Miss - target clicked but no marker available
            combo = 0;
            lastResult = "MISS";
            lastErrMs = 0;
            log('GAME', '🎮 [GAME] ❌ Miss - target clicked but no marker available');
        }
    } else {
        // Miss - no valid target clicked
        combo = 0;
        lastResult = "MISS";
        lastErrMs = 0;
        log('GAME', '🎮 [GAME] ❌ Miss - no valid target clicked');
    }
}

// Helper function to get click/touch position relative to canvas
function getCanvasPosition(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX || event.touches?.[0]?.clientX || event.changedTouches?.[0]?.clientX) - rect.left;
    const y = (event.clientY || event.touches?.[0]?.clientY || event.changedTouches?.[0]?.clientY) - rect.top;
    return [x, y];
}

// Mouse handlers for sustained beats (click and drag)
canvas.addEventListener('mousedown', (event) => {
    const [mouseX, mouseY] = getCanvasPosition(event);
    hitTarget(null, mouseX, mouseY);
});

canvas.addEventListener('mousemove', (event) => {
    if (mouseDragActive && mouseDragSustain !== null) {
        const [mouseX, mouseY] = getCanvasPosition(event);
        const sustainInput = activeSustainedInputs.get(mouseDragSustain);
        if (sustainInput) {
            // Update current position for drag tracking
            sustainInput.inputData.currentX = mouseX;
            sustainInput.inputData.currentY = mouseY;
            
            // Check if we're dragging toward the middle target
            const middleTarget = targets[1];
            const dx = mouseX - middleTarget.x;
            const dy = mouseY - middleTarget.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const yellowRadius = getYellowRadius();
            
            // If we're near the middle target and the end marker has arrived, complete the sustain
            if (distance <= yellowRadius && now() >= sustainInput.endMarker.tArrival) {
                hitTarget(null, mouseX, mouseY);
            }
        }
    }
});

canvas.addEventListener('mouseup', (event) => {
    if (mouseDragActive && mouseDragSustain !== null) {
        const [mouseX, mouseY] = getCanvasPosition(event);
        const sustainInput = activeSustainedInputs.get(mouseDragSustain);
        if (sustainInput) {
            // Check if we're releasing on the middle target
            const middleTarget = targets[1];
            const dx = mouseX - middleTarget.x;
            const dy = mouseY - middleTarget.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const yellowRadius = getYellowRadius();
            
            if (distance <= yellowRadius && now() >= sustainInput.endMarker.tArrival) {
                // Complete the sustain
                hitTarget(null, mouseX, mouseY);
            }
        }
        mouseDragActive = false;
        mouseDragSustain = null;
    }
});

// Touch event handlers for sustained beats (2-finger support)
canvas.addEventListener('touchstart', (event) => {
    event.preventDefault();
    const currentTime = now();
    
    // Process all touches
    for (let i = 0; i < event.touches.length; i++) {
        const touch = event.touches[i];
        const [touchX, touchY] = getCanvasPosition(touch);
        
        // Find which target this touch is near
        const yellowRadius = getYellowRadius();
        let targetIndex = null;
        for (let j = 0; j < targets.length; j++) {
            const target = targets[j];
            const dx = touchX - target.x;
            const dy = touchY - target.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= yellowRadius) {
                targetIndex = j;
                break;
            }
        }
        
        // Store touch position
        touchPositions.set(touch.identifier, {
            x: touchX,
            y: touchY,
            targetIndex: targetIndex
        });
        
        // If this is a side target (0 or 2), try to hit it (might be start of sustained beat)
        if (targetIndex === 0 || targetIndex === 2) {
            hitTarget(null, touchX, touchY, 'touch');
        } else if (targetIndex === 1) {
            // Middle target - check if this is completing a sustained beat
            // Look for active sustained inputs that need a second touch
            for (const [pairId, sustainInput] of activeSustainedInputs.entries()) {
                if (sustainInput.inputType === 'touch' && 
                    sustainInput.inputData.touchId1 !== undefined &&
                    sustainInput.inputData.touchId2 === undefined &&
                    currentTime >= sustainInput.endMarker.tArrival) {
                    // This is the second touch for a two-finger sustain
                    sustainInput.inputData.touchId2 = touch.identifier;
                    sustainInput.inputData.touch2Data = { x: touchX, y: touchY };
                    touchActiveSustains.set(touch.identifier, pairId);
                    // Complete the sustain
                    hitTarget(null, touchX, touchY);
                    break;
                }
            }
        }
    }
});

canvas.addEventListener('touchmove', (event) => {
    event.preventDefault();
    
    // Update touch positions
    for (let i = 0; i < event.touches.length; i++) {
        const touch = event.touches[i];
        const [touchX, touchY] = getCanvasPosition(touch);
        
        const touchData = touchPositions.get(touch.identifier);
        if (touchData) {
            touchData.x = touchX;
            touchData.y = touchY;
            
            // Check if this touch is part of an active sustain
            const sustainId = touchActiveSustains.get(touch.identifier);
            if (sustainId) {
                const sustainInput = activeSustainedInputs.get(sustainId);
                if (sustainInput) {
                    // Update touch data in sustain input
                    if (sustainInput.inputData.touchId1 === touch.identifier) {
                        sustainInput.inputData.touch1Data = { x: touchX, y: touchY };
                    } else if (sustainInput.inputData.touchId2 === touch.identifier) {
                        sustainInput.inputData.touch2Data = { x: touchX, y: touchY };
                    }
                    
                    // Check if we're near the middle target and end marker has arrived
                    const middleTarget = targets[1];
                    const dx = touchX - middleTarget.x;
                    const dy = touchY - middleTarget.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const yellowRadius = getYellowRadius();
                    
                    if (distance <= yellowRadius && now() >= sustainInput.endMarker.tArrival) {
                        hitTarget(null, touchX, touchY);
                    }
                }
            }
        }
    }
});

canvas.addEventListener('touchend', (event) => {
    event.preventDefault();
    
    // Clean up ended touches
    for (let i = 0; i < event.changedTouches.length; i++) {
        const touch = event.changedTouches[i];
        const touchId = touch.identifier;
        
        // Check if this touch was part of a sustain
        const sustainId = touchActiveSustains.get(touchId);
        if (sustainId) {
            const sustainInput = activeSustainedInputs.get(sustainId);
            if (sustainInput) {
                const [touchX, touchY] = getCanvasPosition(touch);
                
                // Check if we're releasing on the middle target
                const middleTarget = targets[1];
                const dx = touchX - middleTarget.x;
                const dy = touchY - middleTarget.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const yellowRadius = getYellowRadius();
                
                if (distance <= yellowRadius && now() >= sustainInput.endMarker.tArrival) {
                    hitTarget(null, touchX, touchY);
                }
            }
            
            touchActiveSustains.delete(touchId);
        }
        
        touchPositions.delete(touchId);
    }
});

// Track sustained beat input state
let activeSustainedInputs = new Map(); // Map<markerPairId, {startMarker, endMarker, startTime, inputType, inputData}>
// inputType: 'keyboard' | 'mouse' | 'touch'
// inputData: {key: 'a'|'d'} | {startX, startY, currentX, currentY} | {touchId1, touchId2, touch1Data, touch2Data}

// Track keyboard state for sustained beats
let leftKeyHeld = false;
let rightKeyHeld = false;
let leftKeyActiveSustain = null; // markerPairId if left key is holding a sustain
let rightKeyActiveSustain = null; // markerPairId if right key is holding a sustain

// Track mouse drag state for sustained beats
let mouseDragActive = false;
let mouseDragSustain = null; // markerPairId if mouse is dragging a sustain
let mouseDragStartX = null;
let mouseDragStartY = null;

// Track touch state for sustained beats (2-finger support)
let touchActiveSustains = new Map(); // Map<touchId, markerPairId>
let touchPositions = new Map(); // Map<touchId, {x, y, targetIndex}>

// Legacy variables (for backward compatibility, may be removed later)
let currentlySustainingSide = null;
let sustainedBeatStartTime = null;
let sustainedBeatDuration = 0;
let sustainedBeatDuration32nd = 0;

// Keyboard handler for sustained beats
// Left (0): A or ArrowLeft - can be single beat or start of sustained beat
// Right (2): D or ArrowRight - can be single beat or start of sustained beat
window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    let targetIndex = null;
    
    if (key === 'a' || event.code === 'ArrowLeft') {
        targetIndex = 0; // Left
        if (!leftKeyHeld) {
            leftKeyHeld = true;
            hitTarget(targetIndex);
        }
    } else if (key === 'd' || event.code === 'ArrowRight') {
        targetIndex = 2; // Right
        if (!rightKeyHeld) {
            rightKeyHeld = true;
            hitTarget(targetIndex);
        }
    }
});

// Handle keyup for sustained beats
window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    
    if (key === 'a' || event.code === 'ArrowLeft') {
        if (leftKeyHeld) {
            leftKeyHeld = false;
            // If we're holding a sustained beat, check if we should complete it
            if (leftKeyActiveSustain !== null) {
                const sustainInput = activeSustainedInputs.get(leftKeyActiveSustain);
                if (sustainInput) {
                    const currentTime = now();
                    // If we've passed the end marker arrival time, the sustain should already be completed
                    // Otherwise, we're releasing early (which is fine - the end marker will handle scoring)
                    // Just clean up the tracking
                    if (currentTime < sustainInput.endMarker.tArrival) {
                        // Released early - will be handled when end marker arrives or times out
                    }
                }
                leftKeyActiveSustain = null;
            }
        }
    } else if (key === 'd' || event.code === 'ArrowRight') {
        if (rightKeyHeld) {
            rightKeyHeld = false;
            // Same logic as left key
            if (rightKeyActiveSustain !== null) {
                const sustainInput = activeSustainedInputs.get(rightKeyActiveSustain);
                if (sustainInput) {
                    const currentTime = now();
                    if (currentTime < sustainInput.endMarker.tArrival) {
                        // Released early
                    }
                }
                rightKeyActiveSustain = null;
            }
        }
    }
});

// Start listening on page load
window.addEventListener('load', () => {
    log('GAME', '🎮 [GAME] Page loaded, initializing game...');
    // Load version if not already loaded
    if (typeof window.gameVersion !== 'undefined') {
        gameVersion = window.gameVersion;
    }
    // Ensure canvas is initialized before starting
    initializeCanvas();
    startListening();
    // Start the game loop after initialization
    gameLoop();
});
