// -----------------------------
// BPM Estimator Module
// -----------------------------
// Handles BPM calculation, smoothing, and hyper-smoothing

const BPM_ESTIMATOR = (function() {
    // Constants
    const MAX_BEAT_TIMES = 20; // Track more beats for better statistics
    const MIN_BEATS_FOR_BPM = 3; // Minimum beats needed for BPM estimate (reduced from 4 for faster startup)
    const MAX_DROPPED_VALUES = 20; // Max length for dropped values array
    const TOLERANCE = 0.15; // 15% tolerance for matching patterns
    const MAX_BPM_BEFORE_HALVING = 200; // If BPM exceeds this value, assume double counting and halve it

    // State
    let beatTimes = []; // Array of beat timestamps
    let smoothedBPM = null; // Smoothed BPM estimate (more stable)
    let hyperSmoothedBPM = null;
    let bpmSamples = []; // Sampled values from smoothedBPM
    let droppedBpmValues = []; // Values that didn't match the pattern
    let acceptedBpmCount = 0; // Count of accepted BPM values
    let droppedBpmCount = 0; // Count of dropped BPM values
    let tempoChangeDetected = false; // Flag for tempo change detection
    let hasLoggedSmoothedBPM = false; // Track if we've logged first smoothed BPM
    let hasLoggedHyperSmoothedBPM = false; // Track if we've logged first hyper-smoothed BPM
    let hyperSmoothedBPMHistory = []; // History of hyper-smoothed BPM values
    const MAX_BPM_HISTORY = 20; // Keep last 20 BPM values
    let serverBPMHint = null; // Server-provided BPM hint (from prediction server)
    let serverBPMHintTime = null; // Timestamp when server hint was received
    const SERVER_BPM_HINT_MAX_AGE = 30.0; // Server hint is valid for 30 seconds
    const SERVER_BPM_WEIGHT = 0.25; // Weight for server BPM (25% server, 75% local)

    function calculateBPM() {
        if (beatTimes.length < MIN_BEATS_FOR_BPM) {
            return smoothedBPM; // Return last smoothed value if we don't have enough beats
        }
        
        // Use last MAX_BEAT_TIMES beats for calculation
        const recentBeats = beatTimes.slice(-Math.min(MAX_BEAT_TIMES, beatTimes.length));
        
        if (recentBeats.length < MIN_BEATS_FOR_BPM) {
            return smoothedBPM;
        }
        
        // Calculate intervals between consecutive beats
        let intervals = [];
        for (let i = 1; i < recentBeats.length; i++) {
            intervals.push(recentBeats[i] - recentBeats[i - 1]);
        }
        
        // Filter out outliers - remove intervals that are way too short or long
        // These are likely false detections (double beats or missed beats)
        const sortedIntervals = [...intervals].sort((a, b) => a - b);
        const medianInterval = sortedIntervals[Math.floor(sortedIntervals.length / 2)];
        
        // Filter intervals that are within 0.5x to 2x of the median
        // This removes outliers while allowing for some tempo variation
        const filteredIntervals = intervals.filter(interval => {
            return interval >= medianInterval * 0.5 && interval <= medianInterval * 2.0;
        });
        
        // Need at least 2 intervals after filtering (reduced from 3 for faster startup)
        if (filteredIntervals.length < 2) {
            return smoothedBPM;
        }
        
        // Use median of filtered intervals (more robust than mean)
        const filteredSorted = [...filteredIntervals].sort((a, b) => a - b);
        const medianFiltered = filteredSorted[Math.floor(filteredSorted.length / 2)];
        
        // Calculate BPM from median interval
        let rawBPM = 60.0 / medianFiltered;
        
        // If BPM exceeds MAX_BPM_BEFORE_HALVING, assume double counting and halve it
        if (rawBPM > MAX_BPM_BEFORE_HALVING) {
            rawBPM = rawBPM / 2;
        }
        
        // Smooth the BPM estimate using exponential moving average
        // This makes it less sensitive to sudden changes
        const smoothingFactor = 0.3; // Lower = more smoothing, less responsive
        if (smoothedBPM === null) {
            smoothedBPM = rawBPM;
            if (!hasLoggedSmoothedBPM) {
                log('BPM', '🎯 [BPM CALCULATION] First smoothed BPM calculated:', smoothedBPM.toFixed(1));
                hasLoggedSmoothedBPM = true;
            }
        } else {
            // Only update if the change is reasonable (within 20% of current estimate)
            // This prevents sudden jumps from outlier calculations
            const changeRatio = Math.abs(rawBPM - smoothedBPM) / smoothedBPM;
            if (changeRatio < 0.2) {
                smoothedBPM = smoothingFactor * rawBPM + (1 - smoothingFactor) * smoothedBPM;
            }
            // If change is too large, use a smaller smoothing factor to gradually adapt
            else {
                smoothedBPM = 0.1 * rawBPM + 0.9 * smoothedBPM;
            }
        }
        
        return smoothedBPM;
    }

    function updateHyperSmoothedBPM() {
        if (smoothedBPM === null) {
            return;
        }
        
        const newSample = smoothedBPM;
        
        // If we have fewer than 2 samples, just add it and use the average (reduced from 4 for faster startup)
        if (bpmSamples.length < 2) {
            bpmSamples.push(newSample);
            let localAvg = bpmSamples.reduce((a, b) => a + b, 0) / bpmSamples.length;
            
            // Apply server BPM hint if available and recent
            const currentTime = performance.now() / 1000.0;
            if (serverBPMHint !== null && serverBPMHintTime !== null) {
                const hintAge = currentTime - serverBPMHintTime;
                if (hintAge < SERVER_BPM_HINT_MAX_AGE && serverBPMHint > 0) {
                    // Use weighted average: favor local estimate but incorporate server hint
                    hyperSmoothedBPM = (1 - SERVER_BPM_WEIGHT) * localAvg + SERVER_BPM_WEIGHT * serverBPMHint;
                } else {
                    // Server hint is stale, use local estimate
                    hyperSmoothedBPM = localAvg;
                }
            } else {
                // No server hint available, use local estimate
                hyperSmoothedBPM = localAvg;
            }
            
            // If BPM exceeds MAX_BPM_BEFORE_HALVING, assume double counting and halve it
            if (hyperSmoothedBPM > MAX_BPM_BEFORE_HALVING) {
                hyperSmoothedBPM = hyperSmoothedBPM / 2;
            }
            // Add to history
            hyperSmoothedBPMHistory.push(hyperSmoothedBPM);
            if (hyperSmoothedBPMHistory.length > MAX_BPM_HISTORY) {
                hyperSmoothedBPMHistory.shift();
            }
            if (!hasLoggedHyperSmoothedBPM && bpmSamples.length >= 1) {
                log('BPM', '🎯 [BPM CALCULATION] First hyper-smoothed BPM calculated:', hyperSmoothedBPM.toFixed(1));
                hasLoggedHyperSmoothedBPM = true;
            }
            return;
        }
        
        // After 4 samples, start filtering
        // Calculate average of existing samples (before adding new one)
        const avg = bpmSamples.reduce((a, b) => a + b, 0) / bpmSamples.length;
        
        // Check if the new sample matches avg * 0.5, avg * 1, avg * 2, or avg * 4
        // (half tempo, fundamental tempo, double tempo, quadruple tempo)
        const patterns = [avg * 0.5, avg * 1, avg * 2, avg * 4];
        
        let matchesPattern = false;
        for (const pattern of patterns) {
            const ratio = Math.abs(newSample - pattern) / pattern;
            if (ratio <= TOLERANCE) {
                matchesPattern = true;
                break;
            }
        }
        
        if (matchesPattern) {
            // Keep the sample - add it to samples
            bpmSamples.push(newSample);
            acceptedBpmCount++;
            // Update hyperSmoothedBPM to average of kept samples
            let localBPM = bpmSamples.reduce((a, b) => a + b, 0) / bpmSamples.length;
            
            // Apply server BPM hint if available and recent
            const currentTime = performance.now() / 1000.0;
            if (serverBPMHint !== null && serverBPMHintTime !== null) {
                const hintAge = currentTime - serverBPMHintTime;
                if (hintAge < SERVER_BPM_HINT_MAX_AGE && serverBPMHint > 0) {
                    // Use weighted average: favor local estimate but incorporate server hint
                    hyperSmoothedBPM = (1 - SERVER_BPM_WEIGHT) * localBPM + SERVER_BPM_WEIGHT * serverBPMHint;
                } else {
                    // Server hint is stale, use local estimate
                    hyperSmoothedBPM = localBPM;
                }
            } else {
                // No server hint available, use local estimate
                hyperSmoothedBPM = localBPM;
            }
            
            // If BPM exceeds MAX_BPM_BEFORE_HALVING, assume double counting and halve it
            if (hyperSmoothedBPM > MAX_BPM_BEFORE_HALVING) {
                hyperSmoothedBPM = hyperSmoothedBPM / 2;
            }
            // Add to history
            hyperSmoothedBPMHistory.push(hyperSmoothedBPM);
            if (hyperSmoothedBPMHistory.length > MAX_BPM_HISTORY) {
                hyperSmoothedBPMHistory.shift();
            }
            if (!hasLoggedHyperSmoothedBPM) {
                log('BPM', '🎯 [BPM CALCULATION] First hyper-smoothed BPM calculated:', hyperSmoothedBPM.toFixed(1));
                hasLoggedHyperSmoothedBPM = true;
            }
        } else {
            // Drop the value - add to dropped array, don't add to samples
            droppedBpmValues.push(newSample);
            droppedBpmCount++;
            
            // Keep dropped values array at max length
            if (droppedBpmValues.length > MAX_DROPPED_VALUES) {
                droppedBpmValues.shift();
            }
            
            // Keep hyperSmoothedBPM as average of existing samples, but apply server hint if available
            let localAvg = avg;
            const currentTime = performance.now() / 1000.0;
            if (serverBPMHint !== null && serverBPMHintTime !== null) {
                const hintAge = currentTime - serverBPMHintTime;
                if (hintAge < SERVER_BPM_HINT_MAX_AGE && serverBPMHint > 0) {
                    // Use weighted average: favor local estimate but incorporate server hint
                    hyperSmoothedBPM = (1 - SERVER_BPM_WEIGHT) * localAvg + SERVER_BPM_WEIGHT * serverBPMHint;
                } else {
                    // Server hint is stale, use local estimate
                    hyperSmoothedBPM = localAvg;
                }
            } else {
                // No server hint available, use local estimate
                hyperSmoothedBPM = localAvg;
            }
        }
        
        // Analyze dropped values for tempo change
        analyzeTempoChange();
        
        // Keep samples array from growing too large (use last 20 samples max)
        if (bpmSamples.length > 20) {
            bpmSamples.shift();
        }
    }

    function analyzeTempoChange() {
        if (droppedBpmValues.length < 3 || bpmSamples.length < 3) {
            tempoChangeDetected = false;
            return;
        }
        
        // Calculate drop ratio (recent samples)
        const totalRecent = acceptedBpmCount + droppedBpmCount;
        const dropRatio = totalRecent > 0 ? droppedBpmCount / totalRecent : 0;
        
        // Analyze dropped values - check if they form a new pattern
        // If many dropped values cluster around a different BPM, tempo might be changing
        if (droppedBpmValues.length >= 5) {
            // Calculate average of recent dropped values
            const recentDropped = droppedBpmValues.slice(-5);
            const avgDropped = recentDropped.reduce((a, b) => a + b, 0) / recentDropped.length;
            
            // Check if dropped values are significantly different from current hyper-smoothed BPM
            if (hyperSmoothedBPM !== null && hyperSmoothedBPM > 0) {
                const changeRatio = Math.abs(avgDropped - hyperSmoothedBPM) / hyperSmoothedBPM;
                
                // If drop ratio is high (>40%) AND dropped values form a consistent pattern
                // that's significantly different (>20%), tempo change is likely
                const droppedStdDev = calculateStdDev(recentDropped);
                const droppedCoV = droppedStdDev / avgDropped; // Coefficient of variation
                
                // Tempo change detected if:
                // 1. High drop ratio (>40%)
                // 2. Dropped values are significantly different (>20%)
                // 3. Dropped values are relatively consistent (low coefficient of variation < 0.15)
                if (dropRatio > 0.4 && changeRatio > 0.2 && droppedCoV < 0.15) {
                    tempoChangeDetected = true;
                    
                    // Determine new BPM from dropped values and update samples
                    adaptToNewTempo(avgDropped);
                } else {
                    tempoChangeDetected = false;
                }
            } else {
                tempoChangeDetected = false;
            }
        } else {
            // Not enough dropped values yet
            tempoChangeDetected = false;
        }
    }

    function adaptToNewTempo(newBpmEstimate) {
        // Determine the fundamental tempo (could be newBpmEstimate or a multiple/divisor)
        // Try to find which multiple (0.5x, 1x, 2x, 4x) of newBpmEstimate makes sense
        let fundamentalBpm = newBpmEstimate;
        
        // If the new BPM is very high, it might be a multiple
        if (newBpmEstimate > 200) {
            fundamentalBpm = newBpmEstimate / 2;
        } else if (newBpmEstimate > 400) {
            fundamentalBpm = newBpmEstimate / 4;
        }
        // If the new BPM is very low, it might be half tempo
        else if (newBpmEstimate < 60) {
            fundamentalBpm = newBpmEstimate * 2;
        }
        
        // Filter dropped values that match the new tempo pattern (0.5x, 1x, 2x, 4x)
        const patterns = [fundamentalBpm * 0.5, fundamentalBpm * 1, fundamentalBpm * 2, fundamentalBpm * 4];
        const matchingDropped = [];
        
        for (const dropped of droppedBpmValues) {
            for (const pattern of patterns) {
                const ratio = Math.abs(dropped - pattern) / pattern;
                if (ratio <= TOLERANCE) {
                    matchingDropped.push(dropped);
                    break;
                }
            }
        }
        
        // If we have enough matching dropped values, use them to replace bpmSamples
        if (matchingDropped.length >= 4) {
            // Replace bpmSamples with the matching dropped values
            // Take the most recent matching values, up to 20
            const recentMatching = matchingDropped.slice(-Math.min(20, matchingDropped.length));
            bpmSamples = recentMatching;
            
            // Update hyperSmoothedBPM to the new tempo
            hyperSmoothedBPM = bpmSamples.reduce((a, b) => a + b, 0) / bpmSamples.length;
            
            // If BPM exceeds MAX_BPM_BEFORE_HALVING, assume double counting and halve it
            if (hyperSmoothedBPM > MAX_BPM_BEFORE_HALVING) {
                hyperSmoothedBPM = hyperSmoothedBPM / 2;
            }
            
            // Add to history
            hyperSmoothedBPMHistory.push(hyperSmoothedBPM);
            if (hyperSmoothedBPMHistory.length > MAX_BPM_HISTORY) {
                hyperSmoothedBPMHistory.shift();
            }
            
            // Reset counters since we've adapted to the new tempo
            acceptedBpmCount = bpmSamples.length;
            droppedBpmCount = 0;
            
            // Clear or reduce dropped values since we've used them
            droppedBpmValues = [];
            
            log('BPM', `Tempo change detected! New BPM: ${hyperSmoothedBPM.toFixed(1)}, using ${bpmSamples.length} samples from dropped values`);
        }
    }

    function calculateStdDev(values) {
        if (values.length === 0) return 0;
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    // Public API
    return {
        // Add a beat timestamp
        addBeat: function(time) {
            beatTimes.push(time);
            if (beatTimes.length > MAX_BEAT_TIMES) {
                beatTimes.shift();
            }
        },

        // Update BPM estimates (call this periodically)
        update: function() {
            const prevSmoothedBPM = smoothedBPM;
            calculateBPM();
            
            // Update hyper-smoothed BPM if smoothedBPM changed
            if (smoothedBPM !== null && smoothedBPM !== prevSmoothedBPM) {
                updateHyperSmoothedBPM();
            }
        },

        // Get current BPM values
        getSmoothedBPM: function() {
            if (smoothedBPM === null) return null;
            // If BPM exceeds MAX_BPM_BEFORE_HALVING, assume double counting and halve it
            return smoothedBPM > MAX_BPM_BEFORE_HALVING ? smoothedBPM / 2 : smoothedBPM;
        },

        getHyperSmoothedBPM: function() {
            if (hyperSmoothedBPM === null) return null;
            // If BPM exceeds MAX_BPM_BEFORE_HALVING, assume double counting and halve it
            return hyperSmoothedBPM > MAX_BPM_BEFORE_HALVING ? hyperSmoothedBPM / 2 : hyperSmoothedBPM;
        },

        isTempoChangeDetected: function() {
            return tempoChangeDetected;
        },

        getStats: function() {
            return {
                acceptedBpmCount: acceptedBpmCount,
                droppedBpmCount: droppedBpmCount,
                beatCount: beatTimes.length
            };
        },

        getHyperSmoothedBPMHistory: function() {
            return [...hyperSmoothedBPMHistory];
        },

        // Set server BPM hint (from prediction server)
        setServerBPMHint: function(bpm) {
            if (bpm !== null && bpm > 0 && bpm < 300) {
                serverBPMHint = bpm;
                serverBPMHintTime = performance.now() / 1000.0;
            }
        },

        // Get current server BPM hint
        getServerBPMHint: function() {
            const currentTime = performance.now() / 1000.0;
            if (serverBPMHint !== null && serverBPMHintTime !== null) {
                const hintAge = currentTime - serverBPMHintTime;
                if (hintAge < SERVER_BPM_HINT_MAX_AGE) {
                    return serverBPMHint;
                }
            }
            return null;
        },

        // Reset all state
        reset: function() {
            beatTimes = [];
            smoothedBPM = null;
            hyperSmoothedBPM = null;
            bpmSamples = [];
            droppedBpmValues = [];
            acceptedBpmCount = 0;
            droppedBpmCount = 0;
            tempoChangeDetected = false;
            hasLoggedSmoothedBPM = false;
            hasLoggedHyperSmoothedBPM = false;
            hyperSmoothedBPMHistory = [];
            serverBPMHint = null;
            serverBPMHintTime = null;
        }
    };
})();

// Export functions if using modules, otherwise attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BPM_ESTIMATOR;
} else {
    window.BPM_ESTIMATOR = BPM_ESTIMATOR;
}

