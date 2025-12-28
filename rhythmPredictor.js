// -----------------------------
// Rhythm Pattern Predictor Module
// -----------------------------
// Handles rhythm pattern processing and prediction

const RHYTHM_PREDICTOR = (function() {
    // Constants
    const PHRASE_BEATS = 4; // 4 beats per phrase (typical)
    const MAX_PHRASES = 16; // Track last 16 phrases for pattern detection
    const PHRASE_ADJUSTMENT_INTERVAL = 8; // Adjust BPM and energy every 8 phrases
    const MAX_ACCURACY_HISTORY = 32; // Keep accuracy for last 32 phrases
    const MAX_CORRECT_PATTERNS = 20; // Keep last 20 correct patterns

    // State
    let currentPhraseStart = null; // Start time of current phrase
    let currentPhrasePattern = null; // Current phrase pattern (32nd note slots)
    let predictedPhrasePattern = null; // Predicted next phrase pattern (from history phrases)
    let predictedFromCorrectPatterns = null; // Predicted next phrase pattern (from correct patterns)
    let hyperPredictedPhrasePattern = null; // Hyper prediction combining both predictions
    let phrasePatterns = []; // Array of phrase patterns (last N phrases)
    let phraseCount = 0; // Total phrase count for pattern adjustment
    let predictionAccuracy = []; // Array of accuracy records for past phrases {correct: number, total: number, accuracy: number}
    let correctPredictionPatterns = []; // Store patterns that were correctly predicted for future use

    function applyEighthBeatPreference(pattern) {
        // For non-8th beat slots, check if nearby 8th beats are active
        // If a nearby 8th beat is active, remove this non-8th beat slot
        for (let slot = 0; slot < pattern.length; slot++) {
            const isEighthBeat = (slot % 4) === 0;
            
            if (!isEighthBeat && pattern[slot]) {
                // Check if a nearby 8th beat is also active
                const nearestEighthBefore = slot - (slot % 4);
                const nearestEighthAfter = nearestEighthBefore + 4;
                
                // If either nearby 8th beat is active, prefer it over this non-8th slot
                if ((nearestEighthBefore >= 0 && pattern[nearestEighthBefore]) ||
                    (nearestEighthAfter < pattern.length && pattern[nearestEighthAfter])) {
                    // Remove this non-8th beat slot in favor of the 8th beat
                    pattern[slot] = false;
                }
            }
        }
    }

    function calculatePredictionAccuracy(predicted, actual) {
        if (predicted.length !== actual.length) {
            return { correct: 0, total: 0, accuracy: 0, falsePositives: 0 };
        }
        
        // Find all active slots in the actual pattern
        const actualActiveSlots = [];
        for (let i = 0; i < actual.length; i++) {
            if (actual[i]) {
                actualActiveSlots.push(i);
            }
        }
        
        if (actualActiveSlots.length === 0) {
            // If no actual pulses, check if prediction also had none
            const predictedActive = predicted.filter(slot => slot).length;
            return {
                correct: predictedActive === 0 ? 1 : 0,
                total: 1,
                accuracy: predictedActive === 0 ? 1.0 : 0.0,
                falsePositives: predictedActive
            };
        }
        
        // For each actual pulse, check if there's a predicted pulse within 1 slot (32nd beat)
        let correctGuesses = 0;
        const matchedPredicted = new Set(); // Track which predicted slots we've matched
        
        for (const actualSlot of actualActiveSlots) {
            // Check if predicted pattern has a pulse at actualSlot or adjacent slots (±1)
            let foundMatch = false;
            for (let offset = -1; offset <= 1; offset++) {
                const checkSlot = actualSlot + offset;
                if (checkSlot >= 0 && checkSlot < predicted.length && predicted[checkSlot]) {
                    if (!matchedPredicted.has(checkSlot)) {
                        matchedPredicted.add(checkSlot);
                        foundMatch = true;
                        correctGuesses++;
                        break;
                    }
                }
            }
        }
        
        // Count unmatched predicted pulses (false positives)
        const predictedActiveSlots = [];
        for (let i = 0; i < predicted.length; i++) {
            if (predicted[i] && !matchedPredicted.has(i)) {
                predictedActiveSlots.push(i);
            }
        }
        
        const totalPulses = actualActiveSlots.length;
        const accuracy = totalPulses > 0 ? correctGuesses / totalPulses : 0;
        
        return {
            correct: correctGuesses,
            total: totalPulses,
            accuracy: accuracy,
            falsePositives: predictedActiveSlots.length
        };
    }

    function extractCorrectPredictionParts(predicted, actual) {
        if (predicted.length !== actual.length) {
            return null;
        }
        
        // Create a pattern that only contains the parts that were correctly predicted
        const correctParts = new Array(predicted.length).fill(false);
        
        // Find all active slots in the actual pattern
        const actualActiveSlots = [];
        for (let i = 0; i < actual.length; i++) {
            if (actual[i]) {
                actualActiveSlots.push(i);
            }
        }
        
        // For each actual pulse, check if there's a predicted pulse within 1 slot
        const matchedPredicted = new Set();
        
        for (const actualSlot of actualActiveSlots) {
            const isActualOnEighth = (actualSlot % 4) === 0; // 8th beat positions (every 4 slots)
            
            // Check if predicted pattern has a pulse at actualSlot or adjacent slots (±1)
            let bestMatchSlot = null;
            let bestMatchIsEighth = false;
            
            for (let offset = -1; offset <= 1; offset++) {
                const checkSlot = actualSlot + offset;
                if (checkSlot >= 0 && checkSlot < predicted.length && predicted[checkSlot]) {
                    if (!matchedPredicted.has(checkSlot)) {
                        const isCheckSlotOnEighth = (checkSlot % 4) === 0;
                        
                        // Favor 8th beat positions
                        if (bestMatchSlot === null) {
                            bestMatchSlot = checkSlot;
                            bestMatchIsEighth = isCheckSlotOnEighth;
                        } else {
                            // Prefer 8th beat positions
                            if (isCheckSlotOnEighth && !bestMatchIsEighth) {
                                bestMatchSlot = checkSlot;
                                bestMatchIsEighth = true;
                            } else if (!isCheckSlotOnEighth && bestMatchIsEighth) {
                                // Keep the 8th beat match
                            } else {
                                // Both are same type, prefer the one closer to actual
                                if (Math.abs(checkSlot - actualSlot) < Math.abs(bestMatchSlot - actualSlot)) {
                                    bestMatchSlot = checkSlot;
                                    bestMatchIsEighth = isCheckSlotOnEighth;
                                }
                            }
                        }
                    }
                }
            }
            
            if (bestMatchSlot !== null) {
                matchedPredicted.add(bestMatchSlot);
                
                // Choose actual beat if it's on an 8th, or predicted if it was on an 8th
                if (isActualOnEighth) {
                    correctParts[actualSlot] = true;
                } else if (bestMatchIsEighth) {
                    correctParts[bestMatchSlot] = true;
                } else {
                    // Neither is on 8th, use the predicted slot (the match)
                    correctParts[bestMatchSlot] = true;
                }
            }
        }
        
        return correctParts;
    }

    function arePatternsSimilar(pattern1, pattern2, threshold) {
        if (pattern1.length !== pattern2.length) return false;
        
        let matches = 0;
        for (let i = 0; i < pattern1.length; i++) {
            if (pattern1[i] === pattern2[i]) {
                matches++;
            }
        }
        
        const similarity = matches / pattern1.length;
        return similarity >= threshold;
    }

    function findRepeatingPattern(phrases) {
        // Look for repeating sequences of 2, 3, or 4 phrases
        for (let patternLength = 2; patternLength <= 4; patternLength++) {
            if (phrases.length < patternLength * 2) continue; // Need at least 2 repetitions
            
            // Check if the last patternLength phrases repeat
            const lastPattern = phrases.slice(-patternLength);
            const previousPattern = phrases.slice(-patternLength * 2, -patternLength);
            
            // Compare patterns
            let matches = true;
            for (let i = 0; i < patternLength; i++) {
                if (!arePatternsSimilar(lastPattern[i], previousPattern[i], 0.8)) {
                    matches = false;
                    break;
                }
            }
            
            if (matches) {
                // Found a repeating pattern, return the next phrase in the sequence
                // If we're at position 0 in the cycle, predict position 1, etc.
                const cyclePosition = (phrases.length % patternLength);
                const nextPosition = (cyclePosition + 1) % patternLength;
                return [...lastPattern[nextPosition]];
            }
        }
        
        return null;
    }

    function predictFromHistoryPhrases(historyPhrases) {
        // Try to find repeating patterns first
        const repeatingPattern = findRepeatingPattern(historyPhrases);
        
        if (repeatingPattern !== null) {
            // Found a repeating pattern, use it to predict
            const prediction = [...repeatingPattern];
            // Apply 8th beat preference to repeating patterns
            applyEighthBeatPreference(prediction);
            return prediction;
        }
        
        // If no clear repeating pattern, use statistical prediction
        // For each 32nd note slot, predict based on how often it's been active in similar positions
        const prediction = new Array(PHRASE_BEATS * 8).fill(false);
        
        // Use only history phrases for this prediction
        const recentPhrases = historyPhrases.slice(-4); // Use last 4 phrases
        
        // First pass: favor 8th beats (every 4 slots: 0, 4, 8, 12, 16, 20, 24, 28)
        for (let slot = 0; slot < prediction.length; slot++) {
            const isEighthBeat = (slot % 4) === 0;
            
            // Count how many times this slot was active in recent phrases
            let activeCount = 0;
            for (const phrase of recentPhrases) {
                if (phrase[slot]) {
                    activeCount++;
                }
            }
            
            // If slot was active in majority of recent phrases, predict it will be active
            // Use threshold of 50% (at least 2 out of 4)
            // But favor 8th beats with lower threshold
            const threshold = isEighthBeat ? Math.ceil(recentPhrases.length * 0.4) : Math.ceil(recentPhrases.length / 2);
            
            if (activeCount >= threshold) {
                prediction[slot] = true;
            }
        }
        
        // Apply 8th beat preference (second pass)
        applyEighthBeatPreference(prediction);
        
        // Also check for patterns based on phrase position in a cycle
        // Look for 4-phrase cycles (only use historyPhrases for cycle detection)
        if (historyPhrases.length >= 8) {
            const cycleLength = 4;
            const currentCyclePosition = (historyPhrases.length) % cycleLength;
            
            // Find phrases at the same position in previous cycles
            const similarPhrases = [];
            for (let i = currentCyclePosition; i < historyPhrases.length; i += cycleLength) {
                similarPhrases.push(historyPhrases[i]);
            }
            
            // If we have at least 2 phrases at this position, use them for prediction
            if (similarPhrases.length >= 2) {
                for (let slot = 0; slot < prediction.length; slot++) {
                    const isEighthBeat = (slot % 4) === 0;
                    let activeCount = 0;
                    for (const phrase of similarPhrases) {
                        if (phrase[slot]) {
                            activeCount++;
                        }
                    }
                    // Favor 8th beats with lower threshold
                    const threshold = isEighthBeat ? Math.ceil(similarPhrases.length * 0.4) : Math.ceil(similarPhrases.length / 2);
                    // If majority of similar-position phrases have this slot active, predict it
                    if (activeCount >= threshold) {
                        prediction[slot] = true;
                    }
                }
                
                // Apply 8th beat preference
                applyEighthBeatPreference(prediction);
            }
        }
        
        return prediction;
    }

    function predictFromCorrectPatterns() {
        if (correctPredictionPatterns.length === 0) {
            return null;
        }
        
        // Create prediction based on correct prediction patterns
        const prediction = new Array(PHRASE_BEATS * 8).fill(false);
        
        // Use last 4-8 correct patterns for prediction
        const recentCorrectPatterns = correctPredictionPatterns.slice(-Math.min(8, correctPredictionPatterns.length));
        
        // Statistical prediction from correct patterns
        for (let slot = 0; slot < prediction.length; slot++) {
            const isEighthBeat = (slot % 4) === 0;
            
            // Count how many times this slot was active in recent correct patterns
            let activeCount = 0;
            for (const pattern of recentCorrectPatterns) {
                if (pattern[slot]) {
                    activeCount++;
                }
            }
            
            // If slot was active in majority of recent correct patterns, predict it will be active
            // Favor 8th beats with lower threshold
            const threshold = isEighthBeat ? Math.ceil(recentCorrectPatterns.length * 0.4) : Math.ceil(recentCorrectPatterns.length / 2);
            
            if (activeCount >= threshold) {
                prediction[slot] = true;
            }
        }
        
        // Apply 8th beat preference
        applyEighthBeatPreference(prediction);
        
        return prediction;
    }

    function createHyperPrediction(pred1, pred2) {
        // Hyper prediction: favor agreed-upon beats, then add additional beats from either prediction
        const hyperPred = new Array(PHRASE_BEATS * 8).fill(false);
        
        // Step 1: Include all beats that both predictions agree on (high confidence)
        for (let slot = 0; slot < hyperPred.length; slot++) {
            if (pred1[slot] && pred2[slot]) {
                hyperPred[slot] = true;
            }
        }
        
        // Step 2: Add additional beats from either prediction (but favor 8th beats)
        for (let slot = 0; slot < hyperPred.length; slot++) {
            if (!hyperPred[slot]) { // Only consider slots not already included
                const isEighthBeat = (slot % 4) === 0;
                const pred1HasIt = pred1[slot];
                const pred2HasIt = pred2[slot];
                
                // If either prediction has it, consider adding it
                if (pred1HasIt || pred2HasIt) {
                    // Favor 8th beats - always include if either prediction has it
                    if (isEighthBeat && (pred1HasIt || pred2HasIt)) {
                        hyperPred[slot] = true;
                    }
                    // For non-8th beats, only include if at least one prediction has it
                    // (This is less strict to avoid too many false positives)
                    else if (!isEighthBeat) {
                        // Include if either prediction suggests it (but we're already favoring agreed beats)
                        hyperPred[slot] = pred1HasIt || pred2HasIt;
                    }
                }
            }
        }
        
        // Apply 8th beat preference one more time to clean up
        applyEighthBeatPreference(hyperPred);
        
        return hyperPred;
    }

    function predictNextPhrase() {
        if (phrasePatterns.length < 4 && correctPredictionPatterns.length === 0) {
            // Need at least 4 phrases or some correct patterns to make a prediction
            predictedPhrasePattern = null;
            predictedFromCorrectPatterns = null;
            hyperPredictedPhrasePattern = null;
            return;
        }
        
        // Use last 16 phrases (or all available if less than 16)
        const historyPhrases = phrasePatterns.slice(-Math.min(16, phrasePatterns.length));
        
        // PREDICTION 1: From history phrases
        predictedPhrasePattern = predictFromHistoryPhrases(historyPhrases);
        
        // PREDICTION 2: From correct prediction patterns
        predictedFromCorrectPatterns = predictFromCorrectPatterns();
        
        // HYPER PREDICTION: Combine both predictions
        if (predictedPhrasePattern !== null && predictedFromCorrectPatterns !== null) {
            hyperPredictedPhrasePattern = createHyperPrediction(predictedPhrasePattern, predictedFromCorrectPatterns);
        } else if (predictedPhrasePattern !== null) {
            hyperPredictedPhrasePattern = [...predictedPhrasePattern];
        } else if (predictedFromCorrectPatterns !== null) {
            hyperPredictedPhrasePattern = [...predictedFromCorrectPatterns];
        } else {
            hyperPredictedPhrasePattern = null;
        }
    }

    // Public API
    return {
        // Process a pulse at the given time
        processPulse: function(pulseTime, hyperSmoothedBPM) {
            if (hyperSmoothedBPM === null || hyperSmoothedBPM <= 0) {
                return; // Need BPM to calculate phrase length
            }
            
            const beatDuration = 60 / hyperSmoothedBPM; // Duration of one beat in seconds
            const phraseDuration = beatDuration * PHRASE_BEATS; // 4 beats per phrase
            const thirtySecondNoteDuration = beatDuration / 8; // 32nd note duration
            
            // Initialize current phrase start if needed
            if (currentPhraseStart === null) {
                currentPhraseStart = pulseTime;
                currentPhrasePattern = new Array(PHRASE_BEATS * 8).fill(false); // 32 thirty-second notes per phrase
            }
            
            // Check if we've moved to a new phrase
            const timeInPhrase = pulseTime - currentPhraseStart;
            if (timeInPhrase >= phraseDuration) {
                // Save current phrase pattern
                if (currentPhrasePattern.some(slot => slot)) { // Only save if phrase has pulses
                    // Check prediction accuracy before saving (use hyper prediction if available, otherwise regular prediction)
                    const predictionToCheck = hyperPredictedPhrasePattern !== null ? hyperPredictedPhrasePattern : predictedPhrasePattern;
                    if (predictionToCheck !== null) {
                        const accuracy = calculatePredictionAccuracy(predictionToCheck, currentPhrasePattern);
                        predictionAccuracy.push(accuracy);
                        if (predictionAccuracy.length > MAX_ACCURACY_HISTORY) {
                            predictionAccuracy.shift();
                        }
                        
                        // Store the parts of the prediction that were correct (not just perfect matches)
                        const correctParts = extractCorrectPredictionParts(predictionToCheck, currentPhrasePattern);
                        if (correctParts !== null && correctParts.some(slot => slot)) {
                            // Only store if there are some correct parts
                            correctPredictionPatterns.push(correctParts);
                            if (correctPredictionPatterns.length > MAX_CORRECT_PATTERNS) {
                                correctPredictionPatterns.shift();
                            }
                        }
                    }
                    
                    phrasePatterns.push([...currentPhrasePattern]);
                    phraseCount++;
                    if (phrasePatterns.length > MAX_PHRASES) {
                        phrasePatterns.shift();
                    }
                }
                
                // Start new phrase
                currentPhraseStart = pulseTime;
                currentPhrasePattern = new Array(PHRASE_BEATS * 8).fill(false);
            }
            
            // Quantize pulse to nearest 32nd note slot
            const timeInCurrentPhrase = pulseTime - currentPhraseStart;
            const thirtySecondNoteIndex = Math.round(timeInCurrentPhrase / thirtySecondNoteDuration);
            
            // Clamp to phrase bounds (0 to 31 for 4 beats * 8 thirty-second notes)
            if (thirtySecondNoteIndex >= 0 && thirtySecondNoteIndex < currentPhrasePattern.length) {
                currentPhrasePattern[thirtySecondNoteIndex] = true;
            }
            
            // Predict next phrase based on past patterns
            predictNextPhrase();
        },

        // Get current phrase pattern
        getCurrentPhrasePattern: function() {
            return currentPhrasePattern ? [...currentPhrasePattern] : null;
        },

        // Get predicted patterns
        getPredictedPhrasePattern: function() {
            return predictedPhrasePattern ? [...predictedPhrasePattern] : null;
        },

        getPredictedFromCorrectPatterns: function() {
            return predictedFromCorrectPatterns ? [...predictedFromCorrectPatterns] : null;
        },

        getHyperPredictedPhrasePattern: function() {
            return hyperPredictedPhrasePattern ? [...hyperPredictedPhrasePattern] : null;
        },

        // Get all phrase patterns
        getPhrasePatterns: function() {
            return phrasePatterns.map(pattern => [...pattern]);
        },

        // Get correct prediction patterns
        getCorrectPredictionPatterns: function() {
            return correctPredictionPatterns.map(pattern => [...pattern]);
        },

        // Get prediction accuracy
        getPredictionAccuracy: function() {
            return [...predictionAccuracy];
        },

        // Reset all state
        reset: function() {
            currentPhraseStart = null;
            currentPhrasePattern = null;
            predictedPhrasePattern = null;
            predictedFromCorrectPatterns = null;
            hyperPredictedPhrasePattern = null;
            phrasePatterns = [];
            phraseCount = 0;
            predictionAccuracy = [];
            correctPredictionPatterns = [];
        }
    };
})();

// Export functions if using modules, otherwise attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RHYTHM_PREDICTOR;
} else {
    window.RHYTHM_PREDICTOR = RHYTHM_PREDICTOR;
}

