// -----------------------------
// Sustained Beat Detector Module
// -----------------------------
// Detects sustained beats by tracking consistently increasing smoothed average
// for at least a quarter beat after a pulse

const SUSTAINED_BEAT_DETECTOR = (function() {
    // State
    let lastPulseTime = null; // Time of the last pulse
    let lastPulseAvg = null; // Smoothed average at the last pulse
    let avgHistory = []; // History of (time, avg) pairs after a pulse
    let currentSustainedBeat = null; // Current sustained beat info: {startTime, pulseTime, pulseAvg, endTime, endAvg, duration32nd, isTracking}
    let hasLoggedSustainedBeat = false; // Track if we've logged first sustained beat

    // Constants
    const MIN_SAMPLES_FOR_SUSTAINED = 3; // Minimum number of increasing samples needed
    const AVG_HISTORY_MAX_AGE = 1.0; // Maximum age for avg history entries (1 second)
    const MIN_INCREASE_THRESHOLD = 0.001; // Minimum increase per sample to count as "increasing"
    const MAX_SUSTAINED_DECREASE = 0.002; // Maximum decrease before considering sustained beat ended
    
    // Configurable threshold
    let minVelocityThreshold = 0.0001; // Minimum velocity (avg change per second) to constitute a sustained increase (configurable)

    /**
     * Calculate the velocity (rate of change) of the smoothed average
     * @param {Array<{time: number, avg: number}>} history - Array of (time, avg) pairs
     * @returns {number} Velocity in avg units per second, or 0 if cannot calculate
     */
    function calculateVelocity(history) {
        if (history.length < 2) {
            return 0;
        }
        
        const first = history[0];
        const last = history[history.length - 1];
        const timeDelta = last.time - first.time;
        
        if (timeDelta <= 0) {
            return 0;
        }
        
        const avgDelta = last.avg - first.avg;
        return avgDelta / timeDelta; // Units: avg change per second
    }

    /**
     * Check if values in the array are consistently increasing
     * @param {Array<number>} values - Array of numbers to check
     * @param {Array<{time: number, avg: number}>} history - Array of (time, avg) pairs for velocity calculation
     * @returns {boolean} True if values are consistently increasing and velocity meets threshold
     */
    function isConsistentlyIncreasing(values, history) {
        if (values.length < MIN_SAMPLES_FOR_SUSTAINED) {
            return false;
        }

        // Check if values are consistently increasing (allowing small decreases for noise)
        // We want to see overall increasing trend, but allow small fluctuations
        let totalIncrease = 0;
        let decreases = 0;
        
        for (let i = 1; i < values.length; i++) {
            const change = values[i] - values[i - 1];
            totalIncrease += change;
            
            // Count significant decreases
            if (change < -MIN_INCREASE_THRESHOLD) {
                decreases++;
            }
        }
        
        // Allow at most 1/3 of the transitions to be decreases (for noise tolerance)
        // and overall trend should be positive
        const maxAllowedDecreases = Math.floor(values.length / 3);
        const isIncreasing = decreases <= maxAllowedDecreases && totalIncrease > 0;
        
        if (!isIncreasing) {
            return false;
        }
        
        // Check velocity threshold - the rate of change must meet minimum velocity
        if (history && history.length >= 2) {
            const velocity = calculateVelocity(history);
            return velocity >= minVelocityThreshold;
        }
        
        // If no history provided, just return the increasing check
        return true;
    }

    /**
     * Process a pulse detection
     * @param {number} pulseTime - Time when pulse was detected
     * @param {number} pulseAvg - Smoothed average at pulse time
     */
    function processPulse(pulseTime, pulseAvg) {
        // If there was a previous pulse that didn't become sustained, clear it
        if (currentSustainedBeat !== null && currentSustainedBeat.endTime === null) {
            // Previous pulse didn't become sustained, clear it
            currentSustainedBeat = null;
        }

        // Start tracking a new pulse
        lastPulseTime = pulseTime;
        lastPulseAvg = pulseAvg;
        avgHistory = [{ time: pulseTime, avg: pulseAvg }];
        
        // Initialize new sustained beat tracking
        currentSustainedBeat = {
            startTime: pulseTime,
            pulseTime: pulseTime,
            pulseAvg: pulseAvg,
            endTime: null,
            endAvg: null,
            duration32nd: null, // Duration in 32nd note beats
            isTracking: false, // Whether we're actively tracking duration
            peakAvg: pulseAvg, // Track peak average during sustain
            lastReturnTime: null // Track when we last returned an update
        };

        // Log disabled: pulse detection logging turned off
        // log('SUSTAINED', `🎵 [SUSTAINED BEAT] Pulse detected at ${pulseTime.toFixed(3)}s, avg: ${pulseAvg.toFixed(6)}`);
    }

    /**
     * Process a diagnostic sample (smooth average update)
     * @param {number} time - Current time
     * @param {number} avg - Current smoothed average
     * @param {number} bpm - Current BPM (for calculating quarter beat duration)
     * @returns {Object|null} Sustained beat info if detected, null otherwise
     */
    function processDiagnostic(time, avg, bpm) {
        // Clean up old history entries
        const cutoffTime = time - AVG_HISTORY_MAX_AGE;
        avgHistory = avgHistory.filter(entry => entry.time >= cutoffTime);

        // If we're not tracking a pulse, return null
        if (lastPulseTime === null || currentSustainedBeat === null) {
            return null;
        }

        // Calculate quarter beat duration
        if (bpm === null || bpm <= 0) {
            // Can't calculate duration without BPM
            return null;
        }
        const beatDuration = 60 / bpm; // Duration of one beat in seconds
        const quarterBeatDuration = beatDuration / 4; // Quarter beat in seconds
        const thirtySecondNoteDuration = beatDuration / 8; // 32nd note duration
        const timeSincePulse = time - lastPulseTime;

        // Add current sample to history (will be filtered by window later)
        avgHistory.push({ time: time, avg: avg });

        // Filter history to only include samples within the quarter beat window
        const windowEndTime = lastPulseTime + quarterBeatDuration;
        const windowHistory = avgHistory.filter(entry => 
            entry.time >= lastPulseTime && entry.time <= windowEndTime
        );
        
        // Only check for sustained beat once we've reached or passed the quarter beat duration
        if (timeSincePulse >= quarterBeatDuration) {
            // Check if we already confirmed this pulse as sustained
            if (currentSustainedBeat.isTracking || currentSustainedBeat.endTime !== null) {
                // We're either tracking or already finalized - continue tracking duration
                if (currentSustainedBeat.isTracking && !currentSustainedBeat.endTime) {
                    // Continue tracking - check if average is still increasing or stable
                    const recentHistory = avgHistory.slice(-5); // Last 5 samples
                    if (recentHistory.length >= 2) {
                        const recentAvgs = recentHistory.map(entry => entry.avg);
                        const peakAvg = Math.max(...recentAvgs);
                        currentSustainedBeat.peakAvg = Math.max(currentSustainedBeat.peakAvg, peakAvg);
                        
                        // Check if average has dropped significantly from peak (sustain ended)
                        const currentDrop = currentSustainedBeat.peakAvg - avg;
                        if (currentDrop > MAX_SUSTAINED_DECREASE) {
                            // Sustained beat has ended - finalize duration
                            const totalDuration = time - currentSustainedBeat.pulseTime;
                            currentSustainedBeat.endTime = time;
                            currentSustainedBeat.endAvg = avg;
                            currentSustainedBeat.duration32nd = totalDuration / thirtySecondNoteDuration;
                            currentSustainedBeat.isTracking = false;
                            
                            // Log when sustained beat ends with final duration
                            log('SUSTAINED', `🎵 [SUSTAINED BEAT] Duration: ${currentSustainedBeat.duration32nd.toFixed(2)} 32nd beats (${totalDuration.toFixed(3)}s)`);
                            return { ...currentSustainedBeat };
                        } else {
                            // Still sustained - update tracking time
                            const currentDuration = time - currentSustainedBeat.pulseTime;
                            currentSustainedBeat.duration32nd = currentDuration / thirtySecondNoteDuration;
                            // Return updated duration so display can update (only return periodically to avoid spam)
                            // Return every ~0.1 seconds (roughly 10 times per second)
                            const timeSinceLastReturn = currentSustainedBeat.lastReturnTime ? time - currentSustainedBeat.lastReturnTime : Infinity;
                            if (timeSinceLastReturn >= 0.1) {
                                currentSustainedBeat.lastReturnTime = time;
                                return { ...currentSustainedBeat };
                            }
                        }
                    }
                }
                return null; // Already processed
            }

            // Check if we have enough samples within the window and if they're consistently increasing
            const avgValues = windowHistory.map(entry => entry.avg);
            
            if (avgValues.length >= MIN_SAMPLES_FOR_SUSTAINED && isConsistentlyIncreasing(avgValues, windowHistory)) {
                // Sustained beat detected! Start tracking duration
                currentSustainedBeat.isTracking = true;
                currentSustainedBeat.endTime = null; // Will be set when tracking ends
                currentSustainedBeat.endAvg = windowHistory[windowHistory.length - 1].avg;
                currentSustainedBeat.peakAvg = Math.max(...avgValues);
                currentSustainedBeat.duration32nd = quarterBeatDuration / thirtySecondNoteDuration; // Initial: quarter beat
                currentSustainedBeat.lastReturnTime = time;
                
                // Log when sustained beat is first detected
                if (!hasLoggedSustainedBeat) {
                    log('SUSTAINED', `🎵 [SUSTAINED BEAT] ✅ Sustained beat detected! Pulse at ${currentSustainedBeat.pulseTime.toFixed(3)}s, initial duration: ${currentSustainedBeat.duration32nd.toFixed(2)} 32nd beats`);
                    hasLoggedSustainedBeat = true;
                } else {
                    // Log each time a sustained beat is detected (not just first)
                    log('SUSTAINED', `🎵 [SUSTAINED BEAT] ✅ Sustained beat detected! Pulse at ${currentSustainedBeat.pulseTime.toFixed(3)}s, initial duration: ${currentSustainedBeat.duration32nd.toFixed(2)} 32nd beats`);
                }
                
                // Return initial detection so display can show it
                return { ...currentSustainedBeat };
            } else {
                // Not sustained - avg didn't consistently increase or not enough samples
                currentSustainedBeat = null;
                lastPulseTime = null;
                lastPulseAvg = null;
            }
        }

        return null;
    }

    // Public API
    return {
        /**
         * Process a pulse detection
         * @param {number} pulseTime - Time when pulse was detected
         * @param {number} pulseAvg - Smoothed average at pulse time
         */
        processPulse: function(pulseTime, pulseAvg) {
            processPulse(pulseTime, pulseAvg);
        },

        /**
         * Process a diagnostic sample (should be called on every diagnostic message)
         * @param {number} time - Current time
         * @param {number} avg - Current smoothed average
         * @param {number} bpm - Current BPM (for calculating quarter beat duration)
         * @returns {Object|null} Sustained beat info if detected, null otherwise
         */
        processDiagnostic: function(time, avg, bpm) {
            return processDiagnostic(time, avg, bpm);
        },

        /**
         * Check if there's currently a sustained beat being tracked
         * @returns {boolean} True if a sustained beat is currently active
         */
        hasActiveSustainedBeat: function() {
            return currentSustainedBeat !== null && currentSustainedBeat.endTime !== null;
        },

        /**
         * Get current sustained beat info (if any)
         * @returns {Object|null} Current sustained beat info or null
         */
        getCurrentSustainedBeat: function() {
            return currentSustainedBeat ? { ...currentSustainedBeat } : null;
        },

        /**
         * Get the current velocity threshold
         * @returns {number} Current minimum velocity threshold (avg change per second)
         */
        getVelocityThreshold: function() {
            return minVelocityThreshold;
        },

        /**
         * Set the velocity threshold
         * @param {number} threshold - Minimum velocity (avg change per second) to constitute a sustained increase
         */
        setVelocityThreshold: function(threshold) {
            if (typeof threshold === 'number' && threshold >= 0) {
                minVelocityThreshold = threshold;
                log('SUSTAINED', `🎵 [SUSTAINED BEAT] Velocity threshold set to: ${threshold}`);
            } else {
                console.warn('Invalid velocity threshold:', threshold);
            }
        },

        /**
         * Reset all state
         */
        reset: function() {
            lastPulseTime = null;
            lastPulseAvg = null;
            avgHistory = [];
            currentSustainedBeat = null;
            hasLoggedSustainedBeat = false;
        }
    };
})();

// Export functions if using modules, otherwise attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SUSTAINED_BEAT_DETECTOR;
} else {
    window.SUSTAINED_BEAT_DETECTOR = SUSTAINED_BEAT_DETECTOR;
}

