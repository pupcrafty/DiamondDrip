// -----------------------------
// Beat Detection Integration
// -----------------------------

// Pulse buffer for batching (currently not used, but kept for potential future use)
// This function was intended for batching pulses to send to the /predict_phrase endpoint
// Since we're now using the /prediction endpoint when client makes predictions,
// this is a no-op stub
function addPulseToBuffer(t_device_ms, dur_ms, meta) {
    // No-op: pulse buffering not currently used
    // If needed in the future for /predict_phrase endpoint, implement buffering logic here
}

async function startListening() {
    try {
        setListeningState(true);
        setHasEnoughDataState(false);
        
        // Track in outline
        if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
            GAME_LOOP_OUTLINE.startListening();
        }
        
        // Initialize beat detection
        await window.beatDetection.initBeatDetection(
            // onBeat callback - called when a beat is detected
            (time, rms, threshold, avg) => {
                log('BEAT', '🎵 [BEAT] Beat detected:', time, 'RMS:', rms);
                
                // Track in outline
                if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
                    GAME_LOOP_OUTLINE.onBeatDetected(time, rms, threshold, avg);
                }
                
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
                    setLastPulseTime(time);
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
                        data.time - getLastPulseTime() >= getPulseGateTime()) {
                        setLastPulseTime(data.time);
                        
                        // Track in outline
                        if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
                            GAME_LOOP_OUTLINE.onPulseDetected(data.time, data.rms);
                        }
                        
                        // Process pulse in rhythm predictor and sustained beat detector
                        const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
                        if (hyperBPM !== null && hyperBPM > 0) {
                            RHYTHM_PREDICTOR.processPulse(data.time, hyperBPM);
                            SUSTAINED_BEAT_DETECTOR.processPulse(data.time, data.avg);
                            setLastPulseTime(data.time);
                            
                            // Add to pulse buffer for batching (convert to ms)
                            const t_device_ms = data.time * 1000.0;
                            const dur_ms = 100.0; // Default duration for pulse
                            addPulseToBuffer(t_device_ms, dur_ms, { type: 'pulse', rms: data.rms });
                        }
                    }
                }
                
                // Process diagnostic data for sustained beat detection (every diagnostic sample)
                const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
                if (hyperBPM !== null && hyperBPM > 0 && data.avg !== undefined) {
                    const sustainedBeat = SUSTAINED_BEAT_DETECTOR.processDiagnostic(data.time, data.avg, hyperBPM);
                    if (sustainedBeat !== null && sustainedBeat.duration32nd !== null) {
                        // Track in outline
                        if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
                            GAME_LOOP_OUTLINE.onSustainedBeatDetected(sustainedBeat);
                        }
                        
                        // Update rhythm predictor with sustained beat information
                        RHYTHM_PREDICTOR.processSustainedBeat(sustainedBeat.pulseTime, sustainedBeat.duration32nd, hyperBPM);
                    }
                }
            }
        );
        
        log('BEAT', '🎵 [BEAT] Beat detection started - entering listening stage');
    } catch (error) {
        console.error('🎮 [GAME] Error starting beat detection:', error);
        setListeningState(false);
    }
}

// Check if we have enough data to make predictions
let lastHasEnoughDataState = false;
function checkIfHasEnoughData() {
    const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
    const hyperPrediction = RHYTHM_PREDICTOR.getHyperPredictedPhrasePattern();
    const energyLevel = ENERGY_CLASSIFIER.getCurrentEnergyLevel();
    
    // Check client prediction
    const clientPredictionReady = hyperBPM !== null && 
                                  hyperBPM > 0 && 
                                  hyperPrediction !== null && 
                                  hyperPrediction.length > 0;
    
    // Check server prediction
    const serverReady = isServerPredictionReady() && getServerPrediction() !== null;
    
    // We have enough data if EITHER prediction is ready (and energy level > 0)
    const newHasEnoughData = (clientPredictionReady || serverReady) && energyLevel > 0;
    
    // Log state transition
    if (!lastHasEnoughDataState && newHasEnoughData) {
        const source = serverReady ? 'server' : (clientPredictionReady ? 'client' : 'none');
        log('GAME', `🎮 [GAME] ✅ Enough data collected! Starting gameplay (Source: ${source}, BPM: ${hyperBPM?.toFixed(1) || getServerPrediction()?.bpm?.toFixed(1) || 'N/A'}, Energy Level: ${energyLevel}, Has Server: ${serverReady}, Has Client: ${clientPredictionReady})`);
        
        // Track in outline
        if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
            GAME_LOOP_OUTLINE.checkEnoughData(newHasEnoughData, `Source: ${source}`);
        }
    } else if (lastHasEnoughDataState && !newHasEnoughData) {
        log('GAME', '🎮 [GAME] ⚠️ Not enough data (waiting for more...)');
        
        // Track in outline
        if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
            GAME_LOOP_OUTLINE.checkEnoughData(newHasEnoughData, 'Data lost');
        }
    }
    
    lastHasEnoughDataState = newHasEnoughData;
    setHasEnoughDataState(newHasEnoughData);
    
    return newHasEnoughData;
}



