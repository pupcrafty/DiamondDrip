// -----------------------------
// Game Loop Outline
// -----------------------------
// This file tracks the game's execution flow for diagnostic purposes.
// It focuses on listening, API calls, and game logic - NOT drawing.

class GameLoopOutline {
    constructor() {
        this.steps = [];
        this.currentStep = null;
        this.isListening = false;
        this.hasEnoughData = false;
        this.lastApiCallTime = 0;
        this.lastBeatTime = 0;
        this.lastPulseTime = 0;
        this.apiCallCount = 0;
        this.beatCount = 0;
        this.pulseCount = 0;
        this.predictionUpdates = [];
        this.maxSteps = 1000; // Keep last 1000 steps for diagnostics
    }

    // Start listening phase
    startListening() {
        this.isListening = true;
        this.addStep('listening_started', {
            timestamp: performance.now(),
            message: 'Beat detection started'
        });
    }

    // Beat detected
    onBeatDetected(time, rms, threshold, avg) {
        this.beatCount++;
        this.lastBeatTime = time;
        this.addStep('beat_detected', {
            timestamp: performance.now(),
            beatTime: time,
            rms: rms,
            threshold: threshold,
            avg: avg,
            beatNumber: this.beatCount
        });
    }

    // Pulse detected (from diagnostic data)
    onPulseDetected(time, rms) {
        this.pulseCount++;
        this.lastPulseTime = time;
        this.addStep('pulse_detected', {
            timestamp: performance.now(),
            pulseTime: time,
            rms: rms,
            pulseNumber: this.pulseCount
        });
    }

    // Sustained beat detected
    onSustainedBeatDetected(sustainedBeat) {
        this.addStep('sustained_beat_detected', {
            timestamp: performance.now(),
            pulseTime: sustainedBeat.pulseTime,
            duration32nd: sustainedBeat.duration32nd
        });
    }

    // Check if enough data collected
    checkEnoughData(hasEnoughData, reason) {
        if (this.hasEnoughData !== hasEnoughData) {
            this.hasEnoughData = hasEnoughData;
            this.addStep('enough_data_check', {
                timestamp: performance.now(),
                hasEnoughData: hasEnoughData,
                reason: reason
            });
        }
    }

    // API call started
    onApiCallStart(payload) {
        this.apiCallCount++;
        this.lastApiCallTime = performance.now();
        this.addStep('api_call_start', {
            timestamp: this.lastApiCallTime,
            sequenceId: payload.sequence_id,
            bpm: payload.currentBPM,
            pulseCount: payload.recentPulseTimestamps?.length || 0,
            patternCount: payload.recentPulsePatterns?.length || 0,
            bufferSize: payload.recentPulseTimestamps?.length || 0
        });
    }

    // API call completed
    onApiCallComplete(response, duration) {
        this.addStep('api_call_complete', {
            timestamp: performance.now(),
            duration: duration,
            status: response.status,
            hasPrediction: response.phrase_start_server_ms !== undefined,
            bpm: response.bpm,
            phraseStart: response.phrase_start_server_ms
        });
    }

    // API call failed
    onApiCallError(error, duration) {
        this.addStep('api_call_error', {
            timestamp: performance.now(),
            duration: duration,
            error: error.message || String(error)
        });
    }

    // Server prediction received
    onServerPredictionReceived(prediction) {
        this.predictionUpdates.push({
            timestamp: performance.now(),
            prediction: prediction
        });
        // Keep only last 100 predictions
        if (this.predictionUpdates.length > 100) {
            this.predictionUpdates.shift();
        }
        
        this.addStep('server_prediction_received', {
            timestamp: performance.now(),
            bpm: prediction.bpm,
            phraseStart: prediction.phrase_start_server_ms,
            slotMs: prediction.slot_ms,
            onsetCount: prediction.onset?.filter(v => v > 0.5).length || 0,
            offsetEstimate: prediction.received_at ? (performance.now() - prediction.received_at) : null
        });
    }

    // Prediction source selected
    onPredictionSourceSelected(source, serverAcc, clientAcc) {
        this.addStep('prediction_source_selected', {
            timestamp: performance.now(),
            source: source,
            serverAccuracy: serverAcc,
            clientAccuracy: clientAcc
        });
    }

    // Prediction accuracy updated
    onPredictionAccuracyUpdated(actualBeatTime, serverMatched, clientMatched) {
        this.addStep('prediction_accuracy_updated', {
            timestamp: performance.now(),
            actualBeatTime: actualBeatTime,
            serverMatched: serverMatched,
            clientMatched: clientMatched
        });
    }

    // Markers spawned
    onMarkersSpawned(count, beatInfo) {
        this.addStep('markers_spawned', {
            timestamp: performance.now(),
            count: count,
            beatTime: beatInfo.time,
            isSustained: beatInfo.isSustained,
            slot: beatInfo.slot
        });
    }

    // Target hit
    onTargetHit(result, targetIndex, markerTime) {
        this.addStep('target_hit', {
            timestamp: performance.now(),
            result: result,
            targetIndex: targetIndex,
            markerTime: markerTime
        });
    }

    // Add a step to the outline
    addStep(type, data) {
        const step = {
            type: type,
            timestamp: data.timestamp || performance.now(),
            data: data
        };
        
        this.steps.push(step);
        
        // Keep only last maxSteps
        if (this.steps.length > this.maxSteps) {
            this.steps.shift();
        }
        
        this.currentStep = step;
    }

    // Get recent steps (for diagnostics)
    getRecentSteps(count = 50) {
        return this.steps.slice(-count);
    }

    // Get steps by type
    getStepsByType(type) {
        return this.steps.filter(step => step.type === type);
    }

    // Get summary statistics
    getSummary() {
        return {
            totalSteps: this.steps.length,
            isListening: this.isListening,
            hasEnoughData: this.hasEnoughData,
            apiCallCount: this.apiCallCount,
            beatCount: this.beatCount,
            pulseCount: this.pulseCount,
            lastApiCallTime: this.lastApiCallTime,
            lastBeatTime: this.lastBeatTime,
            lastPulseTime: this.lastPulseTime,
            predictionUpdateCount: this.predictionUpdates.length
        };
    }

    // Clear all steps (for reset)
    clear() {
        this.steps = [];
        this.currentStep = null;
        this.isListening = false;
        this.hasEnoughData = false;
        this.lastApiCallTime = 0;
        this.lastBeatTime = 0;
        this.lastPulseTime = 0;
        this.apiCallCount = 0;
        this.beatCount = 0;
        this.pulseCount = 0;
        this.predictionUpdates = [];
    }
}

// Create global instance
const GAME_LOOP_OUTLINE = new GameLoopOutline();

