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
const PREDICTION_SERVER_URL = 'https://localhost:8444/prediction';
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
let lastResult = "";
let lastErrMs = 0;
let celebrationText = null;  // Celebration text to display when all targets reach 5+
let celebrationTextTime = 0;  // Time when celebration text should disappear

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

// Initialize 6 targets in 2 groups of 3 in L shapes at the bottom
function initializeTargets() {
    const yellowRadius = getYellowRadius();  // Outermost circle radius
    const spacing = TARGET_RADIUS * 2.5;  // Distance between target centers in L shape (closer together)
    
    // Position groups at the bottom of the screen (moved up so bottom targets are fully visible)
    const scale = (WIDTH + HEIGHT) / 2000;
    const bottomY = HEIGHT - Math.round(200 * scale);  // Distance from bottom (increased to show bottom targets fully)
    const leftGroupX = WIDTH / 2.8;   // Left group center X (moved closer to center)
    const rightGroupX = WIDTH / 1.75;  // Right group center X (moved closer to center)
    
    // 6 easily visible colors
    const colors = [
        'rgb(255, 70, 70)',    // Red
        'rgb(70, 150, 255)',   // Blue
        'rgb(70, 220, 140)',   // Green
        'rgb(255, 220, 70)',   // Yellow
        'rgb(255, 150, 70)',   // Orange
        'rgb(200, 70, 255)'    // Purple
    ];
    
    // Left group: L shape (Top, Bottom, Left - no Right)
    // Right group: L shape (Top, Bottom, Right - no Left)
    const positions = [
        // Left group (indices 0-2)
        [leftGroupX, bottomY - spacing],        // 0: Top
        [leftGroupX, bottomY + spacing],        // 1: Bottom
        [leftGroupX - spacing, bottomY],        // 2: Left
        
        // Right group (indices 3-5)
        [rightGroupX, bottomY - spacing],       // 3: Top
        [rightGroupX, bottomY + spacing],       // 4: Bottom
        [rightGroupX + spacing, bottomY]        // 5: Right
    ];
    
    targets = [];
    for (let i = 0; i < 6; i++) {
        const target = new Target(-1, positions[i][0], positions[i][1], colors[i]);
        targets.push(target);
    }
}

// Initialize canvas and targets
initializeCanvas();
log('GAME', '🎮 [GAME] Game initialized with', targets.length, 'targets');

// Track which group to spawn marker for next (alternates between left=0 and right=1)
let nextGroup = 0;  // 0 = left group (indices 0-2), 1 = right group (indices 3-5)

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
                
                // Process beat as pulse in rhythm predictor
                const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
                if (hyperBPM !== null && hyperBPM > 0) {
                    RHYTHM_PREDICTOR.processPulse(time, hyperBPM);
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
                        
                        // Process pulse in rhythm predictor
                        const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
                        if (hyperBPM !== null && hyperBPM > 0) {
                            RHYTHM_PREDICTOR.processPulse(data.time, hyperBPM);
                        }
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
    if (timeToNextPhrase < 0.5) {
        // Next phrase is very soon, use the one after
        targetPhraseStart = nextPhraseStart + phraseDuration;
    }
    
    // Generate timestamps ONLY from the predicted pattern
    // Filter to only include beats on the first and third beat of the phrase
    const timestamps = [];
    for (let slot = 0; slot < hyperPrediction.length; slot++) {
        if (hyperPrediction[slot]) {
            // Check if this slot falls on the first or third beat
            // Each beat has 8 slots (32nd notes), so:
            // First beat: slots 0-7 (beat number 0)
            // Second beat: slots 8-15 (beat number 1)
            // Third beat: slots 16-23 (beat number 2)
            // Fourth beat: slots 24-31 (beat number 3)
            const beatNumber = Math.floor(slot / 8);
            
            // Only include slots on first beat (0) or third beat (2)
            if (beatNumber === 0 || beatNumber === 2) {
                const timeInPhrase = slot * thirtySecondNoteDuration;
                const beatTime = targetPhraseStart + timeInPhrase;
                
                // Only include future beats (at least 0.1 seconds in the future)
                if (beatTime > currentTime + 0.1) {
                    timestamps.push({
                        time: beatTime,
                        slot: slot,
                        phraseStart: targetPhraseStart
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
                // Alternate between groups, randomly select target within that group
                // Only select targets with score < 5
                const currentGroup = nextGroup;  // Save current group for logging
                const groupStart = currentGroup * 3;  // 0 for left group, 3 for right group
                
                // Filter available targets (score < 5) in this group
                const availableTargets = [];
                for (let i = 0; i < 3; i++) {
                    const idx = groupStart + i;
                    if (targets[idx].score < 5) {
                        availableTargets.push(idx);
                    }
                }
                
                // If no available targets in this group, try the other group
                if (availableTargets.length === 0) {
                    const otherGroupStart = (currentGroup === 0) ? 3 : 0;
                    for (let i = 0; i < 3; i++) {
                        const idx = otherGroupStart + i;
                        if (targets[idx].score < 5) {
                            availableTargets.push(idx);
                        }
                    }
                }
                
                // If still no available targets, skip this marker (all targets are complete)
                if (availableTargets.length === 0) {
                    continue;
                }
                
                // Randomly select from available targets
                const randomIndex = Math.floor(Math.random() * availableTargets.length);
                const targetIndex = availableTargets[randomIndex];
                const target = targets[targetIndex];
                
                // Alternate to the other group for next spawn
                nextGroup = (nextGroup + 1) % 2;  // Toggle between 0 and 1
                
                // Calculate top spawn position (at top of screen, same X as target)
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
                let fallVx, fallVy;
                let actualSpeed = MARKER_FALL_SPEED;
                
                // If we don't have enough time for hold + fall at fixed speed,
                // allow marker to start falling immediately (holdDuration = 0)
                // and adjust speed to ensure it hits on time
                if (holdDuration < 0) {
                    // Not enough time for hold + fall at fixed speed
                    // Start falling immediately (holdDuration = 0) and adjust speed to hit on time
                    holdDuration = 0;
                    // Recalculate fall time to use all available time
                    const adjustedFallTime = totalTime;
                    if (adjustedFallTime > 0.01) {  // Need at least 10ms
                        // Use adjusted speed to hit target on time
                        actualSpeed = distance / adjustedFallTime;
                        fallVx = (dx / distance) * actualSpeed;
                        fallVy = (dy / distance) * actualSpeed;
                    } else {
                        // Not enough time even for immediate fall, skip this marker
                        continue;
                    }
                } else {
                    // Normal case: use fixed speed
                    fallVx = (dx / distance) * MARKER_FALL_SPEED;
                    fallVy = (dy / distance) * MARKER_FALL_SPEED;
                }
                
                // Only create marker if we have enough time (fall time must be positive)
                if (totalTime > 0.01) {
                    
                    // Create marker
                    const marker = new Marker(target, t, beatInfo.time, topX, topY, holdDuration, fallVx, fallVy);
                    
                    // Add marker to target's markers array (at the end)
                    target.markers.push(marker);
                    markers.push(marker);
                
                    // Mark this beat as spawned
                    spawnedPredictedBeats.add(beatKey);
                    
                    // Update target's beat info
                    target.beatSpawn = -1; // Not using beat numbers anymore
                    target.beatDisappear = beatInfo.time;
                    
                    const actualFallTime = holdDuration === 0 ? totalTime : fallTime;
                    log('GAME', '🎮 [GAME] 🎯 Marker spawned for predicted beat (Target:', targetIndex, 'Group:', currentGroup === 0 ? 'left' : 'right', 'Beat time:', beatInfo.time.toFixed(3), 's Total time:', totalTime.toFixed(2), 's Hold:', holdDuration.toFixed(2), 's Fall:', actualFallTime.toFixed(2), 's Speed:', actualSpeed.toFixed(1), 'px/s Distance:', distance.toFixed(1), 'px)');
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
    
    // Remove markers that have left the yellow circle or are individually marked as hit
    // Only remove markers that are individually hit, not all markers for a hit target
    const markersToRemove = markers.filter(marker => marker.hit || marker.hasLeftYellowCircle());
    for (const marker of markersToRemove) {
        if (!marker.hit && marker.hasLeftYellowCircle()) {
            log('GAME', '🎮 [GAME] ⏭️ Marker left target circle without being hit');
        }
        // Remove marker from target's markers array
        const targetMarkerIndex = marker.target.markers.indexOf(marker);
        if (targetMarkerIndex !== -1) {
            marker.target.markers.splice(targetMarkerIndex, 1);
        }
    }
    markers = markers.filter(marker => !marker.hit && !marker.hasLeftYellowCircle());
    
    // Draw
    ctx.fillStyle = 'rgb(18, 18, 24)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    
    // Draw center star (behind targets) - grows with total score of all targets
    const starScale = (WIDTH + HEIGHT) / 2000;
    const leftGroupX = WIDTH / 2.8;
    const rightGroupX = WIDTH / 1.75;
    const bottomY = HEIGHT - Math.round(200 * starScale);
    const centerX = (leftGroupX + rightGroupX) / 2;
    const centerY = bottomY;
    
    // Calculate total score of all targets
    let totalScore = 0;
    for (const target of targets) {
        totalScore += target.score;
    }
    
    // Maximum total score is 6 targets * 5 = 30
    // Maximum star radius should fill the space between groups
    const maxTotalScore = 6 * 5;  // 30
    const maxCenterStarRadius = (rightGroupX - leftGroupX) / 2;  // Half the distance between groups (fills the space)
    
    if (totalScore > 0) {
        const centerStarRadius = (totalScore / maxTotalScore) * maxCenterStarRadius;
        const centerInnerRadius = centerStarRadius * 0.4;  // Inner radius for star shape
        
        // Use a neutral/white color for the center star
        ctx.fillStyle = 'rgb(255, 255, 255)';
        drawStar(ctx, centerX, centerY, centerStarRadius, centerInnerRadius);
    }
    
    // Draw targets (draw first so markers appear on top)
    for (const target of targets) {
        // Reset hit state if no markers are left
        if (target.hit && target.markers.length === 0) {
            target.hit = false;
        }
        
        if (target.hit) {
            // Draw star behind target if score > 0
            if (target.score > 0) {
                const starScale = (WIDTH + HEIGHT) / 2000;
                const yellowRadius = TARGET_RADIUS + Math.round(30 * starScale);
                const maxStarRadius = yellowRadius * 1.1;  // Slightly beyond outermost circle (at score 5)
                const starRadius = (target.score / 5) * maxStarRadius;  // Grow proportionally with score
                const innerRadius = starRadius * 0.4;  // Inner radius for star shape
                
                ctx.fillStyle = target.color;
                drawStar(ctx, target.x, target.y, starRadius, innerRadius);
            }
            
            // Show green flash when hit
            ctx.fillStyle = 'rgb(70, 220, 140)';  // Green for hit
            ctx.beginPath();
            ctx.arc(target.x, target.y, TARGET_RADIUS, 0, Math.PI * 2);
            ctx.fill();
            
            // Show target score if enabled in config
            if (LOG_CONFIG.TARGET_SCORES) {
                const scoreScale = (WIDTH + HEIGHT) / 2000;
                const scoreFontSize = Math.round(16 * scoreScale);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.font = `bold ${scoreFontSize}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const scoreText = target.score.toString();
                const textMetrics = ctx.measureText(scoreText);
                const textWidth = textMetrics.width;
                const textHeight = scoreFontSize;
                const scorePadding = Math.round(6 * scoreScale);
                const bgX = target.x;
                const bgY = target.y + TARGET_RADIUS + Math.round(25 * scoreScale);
                
                // Draw background rectangle
                ctx.fillRect(bgX - textWidth / 2 - scorePadding, bgY - textHeight / 2 - scorePadding / 2, textWidth + scorePadding * 2, textHeight + scorePadding);
                
                // Draw score text
                ctx.fillStyle = target.color;
                ctx.fillText(scoreText, bgX, bgY);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
            }
        } else {
            // Draw star behind target if score > 0
            if (target.score > 0) {
                const starScale = (WIDTH + HEIGHT) / 2000;
                const yellowRadius = TARGET_RADIUS + Math.round(30 * starScale);
                const maxStarRadius = yellowRadius * 1.1;  // Slightly beyond outermost circle (at score 5)
                const starRadius = (target.score / 5) * maxStarRadius;  // Grow proportionally with score
                const innerRadius = starRadius * 0.4;  // Inner radius for star shape
                
                ctx.fillStyle = target.color;
                drawStar(ctx, target.x, target.y, starRadius, innerRadius);
            }
            
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
            
            // Show target score if enabled in config
            if (LOG_CONFIG.TARGET_SCORES) {
                const scoreScale = (WIDTH + HEIGHT) / 2000;
                const scoreFontSize = Math.round(16 * scoreScale);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.font = `bold ${scoreFontSize}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const scoreText = target.score.toString();
                const textMetrics = ctx.measureText(scoreText);
                const textWidth = textMetrics.width;
                const textHeight = scoreFontSize;
                const scorePadding = Math.round(6 * scoreScale);
                const bgX = target.x;
                const bgY = target.y + TARGET_RADIUS + Math.round(25 * scoreScale);
                
                // Draw background rectangle
                ctx.fillRect(bgX - textWidth / 2 - scorePadding, bgY - textHeight / 2 - scorePadding / 2, textWidth + scorePadding * 2, textHeight + scorePadding);
                
                // Draw score text
                ctx.fillStyle = target.color;
                ctx.fillText(scoreText, bgX, bgY);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
            }
            
            // Show key label if target has markers
            if (target.markers.length > 0 && hasEnoughData) {
                const targetIndex = targets.indexOf(target);
                // Map target indices to keys
                const keyLabels = ['W', 'S', 'A', '↑', '↓', '→'];
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
            ctx.beginPath();
            ctx.arc(marker.x, marker.y, MARKER_RADIUS, 0, Math.PI * 2);
            ctx.fill();
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
    const info = `BPM: ${bpmText} | Targets: ${targets.length} | Markers: ${markers.length} | Combo: ${combo}`;
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
    
    ctx.font = `${fontSize1}px Arial`;
    ctx.fillStyle = 'rgb(170, 170, 190)';
    ctx.fillText('Click on targets or press WASD / Arrow keys to hit them', padding, HEIGHT - padding);
    
    requestAnimationFrame(gameLoop);
}

// -----------------------------
// Event handlers
// -----------------------------

// Function to handle hitting a target by index (0-7) or by mouse position
function hitTarget(targetIndex = null, mouseX = null, mouseY = null) {
    const yellowRadius = getYellowRadius();
    let clickedTarget = null;
    
    if (targetIndex !== null && targetIndex >= 0 && targetIndex < targets.length) {
        // Hit target by index (keyboard input)
        const target = targets[targetIndex];
        if (!target.hit) {
            clickedTarget = target;
        }
    } else if (mouseX !== null && mouseY !== null) {
        // Find target by mouse position (mouse click)
        for (const target of targets) {
            if (target.hit) continue;
            
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
            // Score based on marker position
            const result = clickedTarget.getHitResult(nextMarker.x, nextMarker.y);
            
            // Mark this specific marker as hit (not the target, so other markers aren't affected)
            nextMarker.hit = true;
            
            // Set target.hit for visual feedback, but reset it after a short delay
            clickedTarget.hit = true;
            setTimeout(() => {
                clickedTarget.hit = false;
            }, 200);  // Reset after 200ms
            
            if (result === "MISS") {
                combo = 0;
                log('GAME', '🎮 [GAME] ❌ Target hit but scored MISS (Combo reset)');
            } else {
                combo += 1;
                log('GAME', '🎮 [GAME] ✅ Target hit:', result, '(Combo:', combo, ')');
                
                // Increment target score based on hit result
                const scoreIncrement = result === "OKAY" ? 1 : 
                                      result === "GOOD" ? 2 : 
                                      result === "GREAT" ? 3 : 
                                      result === "PERFECT" ? 5 : 0;
                clickedTarget.score += scoreIncrement;
                
                // Check if all targets are at 5 or higher
                const allTargetsComplete = targets.every(t => t.score >= 5);
                if (allTargetsComplete) {
                    // Reset all targets to 0
                    for (const target of targets) {
                        target.score = 0;
                    }
                    // Show celebration text
                    celebrationText = "ALL TARGETS COMPLETE!";
                    celebrationTextTime = now() + 0.75;  // Display for 0.75 seconds
                }
            }
            
            lastResult = result;
            lastErrMs = 0;  // No timing error for position-based scoring
            
            // Remove only the specific marker that was hit
            const markerIndex = markers.indexOf(nextMarker);
            if (markerIndex !== -1) {
                markers.splice(markerIndex, 1);
            }
            
            // Remove marker from target's markers array
            const targetMarkerIndex = clickedTarget.markers.indexOf(nextMarker);
            if (targetMarkerIndex !== -1) {
                clickedTarget.markers.splice(targetMarkerIndex, 1);
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

// Mouse click handler
canvas.addEventListener('click', (event) => {
    const [mouseX, mouseY] = getCanvasPosition(event);
    hitTarget(null, mouseX, mouseY);
});

// Touch event handlers for touchscreen support
canvas.addEventListener('touchstart', (event) => {
    event.preventDefault(); // Prevent default touch behavior (scrolling, etc.)
    const [touchX, touchY] = getCanvasPosition(event);
    hitTarget(null, touchX, touchY);
});

canvas.addEventListener('touchend', (event) => {
    event.preventDefault(); // Prevent default touch behavior
});

// Keyboard handler for WASD and Arrow keys
// Left group (0-2): W (top), S (bottom), A (left)
// Right group (3-5): Arrow Up (top), Arrow Down (bottom), Arrow Right (right)
window.addEventListener('keydown', (event) => {
    let targetIndex = null;
    
    // Handle WASD keys (case insensitive)
    const key = event.key.toLowerCase();
    if (key === 'w') {
        targetIndex = 0; // Left group, Top
    } else if (key === 's') {
        targetIndex = 1; // Left group, Bottom
    } else if (key === 'a') {
        targetIndex = 2; // Left group, Left
    }
    // Handle Arrow keys
    else if (event.code === 'ArrowUp') {
        targetIndex = 3; // Right group, Top
    } else if (event.code === 'ArrowDown') {
        targetIndex = 4; // Right group, Bottom
    } else if (event.code === 'ArrowRight') {
        targetIndex = 5; // Right group, Right
    }
    
    if (targetIndex !== null) {
        hitTarget(targetIndex);
    }
});

// Start listening on page load
window.addEventListener('load', () => {
    log('GAME', '🎮 [GAME] Page loaded, initializing game...');
    // Ensure canvas is initialized before starting
    initializeCanvas();
    startListening();
    // Start the game loop after initialization
    gameLoop();
});
