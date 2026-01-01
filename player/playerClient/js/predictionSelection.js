// -----------------------------
// Prediction Selection and Accuracy Tracking
// -----------------------------

// Server prediction state (currently not used, but kept for potential future use)
let serverPrediction = null;
let serverOffsetEstimate = 0; // Estimated offset between client and server time

// Server prediction management functions
function isServerPredictionReady() {
    // Currently returns false since we're using client-side predictions
    // Can be implemented in the future if server predictions are needed
    return serverPrediction !== null;
}

function getServerPrediction() {
    // Returns the current server prediction, or null if not available
    return serverPrediction;
}

function setServerPrediction(prediction) {
    // Store a server prediction (for future use)
    serverPrediction = prediction;
}

function convertServerTimeToLocal(serverTimeMs) {
    // Convert server time to local time using offset estimate
    // For now, just return the server time as-is (no offset correction)
    // Can be enhanced in the future to use serverOffsetEstimate
    return serverTimeMs;
}

// Prediction accuracy tracking
let predictionAccuracyTracker = {
    serverAccuracy: 0.5, // Initial: assume 50% accuracy
    clientAccuracy: 0.5, // Initial: assume 50% accuracy
    serverHits: 0,
    serverMisses: 0,
    clientHits: 0,
    clientMisses: 0,
    minSamplesForComparison: 10 // Need at least 10 samples before comparing
};

// Update prediction accuracy when beats are detected
function updatePredictionAccuracy(actualBeatTime) {
    const toleranceMs = 50; // ±50ms tolerance for "hit"
    const tolerance = toleranceMs / 1000.0; // Convert to seconds
    
    let serverMatched = false;
    let clientMatched = false;
    
    // Check server prediction accuracy
    if (isServerPredictionReady() && getServerPrediction()) {
        const serverPrediction = getServerPrediction();
        // Convert server phrase start to local time
        const serverPhraseStartLocal = convertServerTimeToLocal(serverPrediction.phrase_start_server_ms) / 1000.0;
        const slotMs = serverPrediction.slot_ms / 1000.0;
        
        // Check if actual beat matches any predicted onset
        for (let i = 0; i < serverPrediction.onset.length; i++) {
            if (serverPrediction.onset[i] > 0.5) {
                const predictedTime = serverPhraseStartLocal + (i * slotMs);
                if (Math.abs(actualBeatTime - predictedTime) <= tolerance) {
                    serverMatched = true;
                    break;
                }
            }
        }
        
        if (serverMatched) {
            predictionAccuracyTracker.serverHits++;
        } else {
            predictionAccuracyTracker.serverMisses++;
        }
        
        // Update accuracy (running average)
        const totalServer = predictionAccuracyTracker.serverHits + predictionAccuracyTracker.serverMisses;
        if (totalServer > 0) {
            predictionAccuracyTracker.serverAccuracy = predictionAccuracyTracker.serverHits / totalServer;
        }
    }
    
    // Check client prediction accuracy
    const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
    const hyperPrediction = RHYTHM_PREDICTOR.getHyperPredictedPhrasePattern();
    if (hyperBPM !== null && hyperBPM > 0 && hyperPrediction !== null) {
        const beatDuration = 60.0 / hyperBPM;
        const phraseDuration = beatDuration * 4;
        const slotDuration = beatDuration / 8; // 8 thirty-second notes per beat (not 32)
        
        // Find nearest phrase start
        let phraseStart = getLastPhraseStartTime();
        if (phraseStart === null) {
            phraseStart = actualBeatTime - (actualBeatTime % phraseDuration);
        }
        
        // Check if actual beat matches any predicted onset
        for (let i = 0; i < hyperPrediction.length; i++) {
            if (hyperPrediction[i]) {
                const predictedTime = phraseStart + (i * slotDuration);
                if (Math.abs(actualBeatTime - predictedTime) <= tolerance) {
                    clientMatched = true;
                    break;
                }
            }
        }
        
        if (clientMatched) {
            predictionAccuracyTracker.clientHits++;
        } else {
            predictionAccuracyTracker.clientMisses++;
        }
        
        // Update accuracy (running average)
        const totalClient = predictionAccuracyTracker.clientHits + predictionAccuracyTracker.clientMisses;
        if (totalClient > 0) {
            predictionAccuracyTracker.clientAccuracy = predictionAccuracyTracker.clientHits / totalClient;
        }
    }
    
    // Track in outline
    if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
        GAME_LOOP_OUTLINE.onPredictionAccuracyUpdated(actualBeatTime, serverMatched, clientMatched);
    }
}

// Select best prediction source
function selectBestPrediction() {
    const serverReady = isServerPredictionReady() && getServerPrediction() !== null;
    const clientReady = (BPM_ESTIMATOR.getHyperSmoothedBPM() !== null && 
                        RHYTHM_PREDICTOR.getHyperPredictedPhrasePattern() !== null);
    
    if (!serverReady && !clientReady) {
        return null;
    }
    
    if (!serverReady) {
        return 'client';
    }
    
    if (!clientReady) {
        return 'server';
    }
    
    // Both available - compare accuracy
    const serverAcc = predictionAccuracyTracker.serverAccuracy;
    const clientAcc = predictionAccuracyTracker.clientAccuracy;
    
    // If accuracies are within 5%, prefer server
    if (Math.abs(serverAcc - clientAcc) < 0.05) {
        // Log selection periodically (every 10 calls to avoid spam)
        if (Math.random() < 0.1) {
            log('INTEGRATION', '[INTEGRATION] 🎯 Prediction selection: server (tie-breaker)', {
                serverAcc: (serverAcc * 100).toFixed(1) + '%',
                clientAcc: (clientAcc * 100).toFixed(1) + '%',
                serverHits: predictionAccuracyTracker.serverHits,
                serverMisses: predictionAccuracyTracker.serverMisses,
                clientHits: predictionAccuracyTracker.clientHits,
                clientMisses: predictionAccuracyTracker.clientMisses
            });
        }
        
        // Track in outline
        if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
            GAME_LOOP_OUTLINE.onPredictionSourceSelected('server', serverAcc, clientAcc);
        }
        
        return 'server';
    }
    
    // Otherwise, prefer the more accurate one
    const selected = serverAcc > clientAcc ? 'server' : 'client';
    
    // Log selection periodically
    if (Math.random() < 0.1) {
        log('INTEGRATION', '[INTEGRATION] 🎯 Prediction selection:', selected, {
            serverAcc: (serverAcc * 100).toFixed(1) + '%',
            clientAcc: (clientAcc * 100).toFixed(1) + '%',
            difference: (Math.abs(serverAcc - clientAcc) * 100).toFixed(1) + '%'
        });
    }
    
    // Track in outline
    if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
        GAME_LOOP_OUTLINE.onPredictionSourceSelected(selected, serverAcc, clientAcc);
    }
    
    return selected;
}

// Get active prediction in unified format
function getActivePrediction() {
    const source = selectBestPrediction();
    if (source === null) {
        return null;
    }
    
    if (source === 'server' && getServerPrediction()) {
        const serverPrediction = getServerPrediction();
        // Convert server prediction to local time
        const phraseStartServerMs = serverPrediction.phrase_start_server_ms;
        const phraseStartLocalMs = convertServerTimeToLocal(phraseStartServerMs);
        const phraseStartLocal = phraseStartLocalMs / 1000.0; // Convert to seconds
        
        return {
            bpm: serverPrediction.bpm,
            phrase_start_time: phraseStartLocal,
            slot_ms: serverPrediction.slot_ms / 1000.0, // Convert to seconds
            onset: serverPrediction.onset,
            dur_slots: serverPrediction.dur_slots,
            confidence: serverPrediction.confidence,
            source: 'server'
        };
    }
    
    // Client prediction
    const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
    const hyperPrediction = RHYTHM_PREDICTOR.getHyperPredictedPhrasePattern();
    const hyperPredictedDurations = RHYTHM_PREDICTOR.getHyperPredictedDurations();
    
    if (hyperBPM === null || hyperBPM <= 0 || hyperPrediction === null) {
        return null;
    }
    
    const beatDuration = 60.0 / hyperBPM;
    const slotMs = beatDuration / 8; // 8 thirty-second notes per beat (not 32)
    
    // Convert durations array to match server format (128 slots)
    const durSlots = [];
    for (let i = 0; i < 128; i++) {
        if (i < hyperPrediction.length && hyperPrediction[i] && hyperPredictedDurations && hyperPredictedDurations[i] !== null && hyperPredictedDurations[i] > 0) {
            durSlots[i] = hyperPredictedDurations[i];
        } else {
            durSlots[i] = 0; // No duration (single beat)
        }
    }
    
    // Convert onset array to match server format (128 slots, 0 or 1)
    const onset = [];
    for (let i = 0; i < 128; i++) {
        onset[i] = (i < hyperPrediction.length && hyperPrediction[i]) ? 1.0 : 0.0;
    }
    
    return {
        bpm: hyperBPM,
        phrase_start_time: null, // Will be calculated in getPredictedBeatTimestamps
        slot_ms: slotMs,
        onset: onset,
        dur_slots: durSlots,
        confidence: onset.map(() => 0.5), // Default confidence
        source: 'client'
    };
}

// Generate timestamps from active prediction (server or client)
function getPredictedBeatTimestamps(currentTime) {
    const activePrediction = getActivePrediction();
    
    if (activePrediction === null) {
        return [];
    }
    
    // Log prediction source periodically (every 50 calls to avoid spam)
    if (Math.random() < 0.02) {
        log('INTEGRATION', '[INTEGRATION] 📊 Using prediction source:', activePrediction.source, {
            bpm: activePrediction.bpm?.toFixed(1),
            slotMs: activePrediction.slot_ms?.toFixed(3),
            onsetCount: activePrediction.onset?.filter(v => v > 0.5).length || 0
        });
    }
    
    const bpm = activePrediction.bpm;
    const beatDuration = 60.0 / bpm;
    const phraseDuration = beatDuration * 4;
    const slotDuration = activePrediction.slot_ms;
    
    // Calculate phrase start
    let phraseStart = activePrediction.phrase_start_time;
    
    if (phraseStart === null) {
        // Client prediction - calculate phrase start
        phraseStart = getLastPhraseStartTime();
        if (phraseStart === null) {
            phraseStart = currentTime - (currentTime % phraseDuration);
        }
    } else {
        // Server prediction - already in local time
        // Align to nearest phrase boundary if needed
        const lastPhraseStart = getLastPhraseStartTime();
        if (lastPhraseStart !== null) {
            const timeSinceLast = phraseStart - lastPhraseStart;
            const phrasesElapsed = Math.round(timeSinceLast / phraseDuration);
            phraseStart = lastPhraseStart + (phrasesElapsed * phraseDuration);
        }
    }
    
    // Calculate next phrase start time
    const timeSincePhraseStart = currentTime - phraseStart;
    const phrasesElapsed = Math.floor(timeSincePhraseStart / phraseDuration);
    let nextPhraseStart = phraseStart + (phrasesElapsed + 1) * phraseDuration;
    
    // Check if we should use the phrase after next (if next phrase is too soon)
    const timeToNextPhrase = nextPhraseStart - currentTime;
    let targetPhraseStart = nextPhraseStart;
    if (timeToNextPhrase < 0.2) {
        targetPhraseStart = nextPhraseStart + phraseDuration;
    }
    
    // Generate timestamps from the prediction
    const timestamps = [];
    const onset = activePrediction.onset;
    const durSlots = activePrediction.dur_slots;
    
    for (let slot = 0; slot < onset.length && slot < 128; slot++) {
        if (onset[slot] > 0.5) {
            const beatNumber = Math.floor(slot / 8);
            
            // Include beats on first (0), second (1), third (2), or fourth (3) beat
            if (beatNumber >= 0 && beatNumber <= 3) {
                const timeInPhrase = slot * slotDuration;
                const beatTime = targetPhraseStart + timeInPhrase;
                
                // Check if this slot has a duration (sustained beat)
                const durationSlots = durSlots[slot] || 0;
                const isSustained = durationSlots > 0;
                const duration = durationSlots * slotDuration;
                
                // Only include future beats (at least 0.05 seconds in the future to allow for spawn time)
                const alreadyAdded = timestamps.some(ts => ts.slot === slot || (ts.isSustained && ts.slot < slot && slot <= ts.endSlot));
                if (!alreadyAdded && beatTime > currentTime + 0.05) {
                    const endSlot = isSustained ? Math.min(slot + Math.ceil(durationSlots) - 1, onset.length - 1) : slot;
                    
                    timestamps.push({
                        time: beatTime,
                        slot: slot,
                        endSlot: endSlot,
                        isSustained: isSustained,
                        duration: duration,
                        phraseStart: targetPhraseStart,
                        source: activePrediction.source
                    });
                }
            }
        }
    }
    
    // Update last phrase start time for next calculation
    if (targetPhraseStart !== getLastPhraseStartTime()) {
        setLastPhraseStartTime(targetPhraseStart);
    }
    
    return timestamps;
}

