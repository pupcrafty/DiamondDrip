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
    let currentPhraseDurations = null; // Current phrase durations in slots (parallel array to pattern)
    let predictedPhrasePattern = null; // Predicted next phrase pattern (from history phrases)
    let predictedFromCorrectPatterns = null; // Predicted next phrase pattern (from correct patterns)
    let hyperPredictedPhrasePattern = null; // Hyper prediction combining both predictions
    let predictedPhraseDurations = null; // Predicted durations for next phrase (from history phrases)
    let predictedFromCorrectPatternsDurations = null; // Predicted durations from correct patterns
    let hyperPredictedPhraseDurations = null; // Hyper predicted durations combining both predictions
    let phrasePatterns = []; // Array of phrase patterns (last N phrases)
    let phraseDurations = []; // Array of phrase durations (last N phrases, parallel to phrasePatterns)
    let phraseCount = 0; // Total phrase count for pattern adjustment
    let predictionAccuracy = []; // Array of accuracy records for past phrases {correct: number, total: number, accuracy: number}
    let correctPredictionPatterns = []; // Store patterns that were correctly predicted for future use
    let correctPredictionDurations = []; // Store durations for correctly predicted patterns (parallel to correctPredictionPatterns)
    let hasLoggedFirstPhrase = false; // Track if we've logged first phrase completion
    let hasLoggedEnoughPhrases = false; // Track if we've logged when we have enough phrases for prediction
    let hasLoggedInitialPrediction = false; // Track if we've logged first prediction from history phrases
    let hasLoggedCorrectPatternPrediction = false; // Track if we've logged first prediction from correct patterns
    let hasLoggedHyperPrediction = false; // Track if we've logged first hyper prediction

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

    function predictDurationsFromHistoryPhrases(historyPhrases, historyDurations) {
        if (historyPhrases.length === 0 || historyDurations.length === 0) {
            return null;
        }
        
        // Create duration prediction array
        const prediction = new Array(PHRASE_BEATS * 8).fill(0);
        
        // Use last 4 phrases for duration prediction
        const recentPhrases = historyPhrases.slice(-4);
        const recentDurations = historyDurations.slice(-4);
        
        // For each slot, calculate average duration from recent phrases
        for (let slot = 0; slot < prediction.length; slot++) {
            let totalDuration = 0;
            let count = 0;
            
            for (let i = 0; i < recentPhrases.length; i++) {
                if (recentPhrases[i][slot] && recentDurations[i] && recentDurations[i][slot] > 0) {
                    totalDuration += recentDurations[i][slot];
                    count++;
                }
            }
            
            // If we have data, predict the average duration (rounded)
            if (count > 0) {
                prediction[slot] = Math.round(totalDuration / count);
            }
        }
        
        return prediction;
    }

    function predictDurationsFromCorrectPatterns() {
        if (correctPredictionPatterns.length === 0 || correctPredictionDurations.length === 0) {
            return null;
        }
        
        // Create duration prediction array
        const prediction = new Array(PHRASE_BEATS * 8).fill(0);
        
        // Use last 4-8 correct patterns for prediction
        const recentPatterns = correctPredictionPatterns.slice(-Math.min(8, correctPredictionPatterns.length));
        const recentDurations = correctPredictionDurations.slice(-Math.min(8, correctPredictionDurations.length));
        
        // For each slot, calculate average duration from correct patterns
        for (let slot = 0; slot < prediction.length; slot++) {
            let totalDuration = 0;
            let count = 0;
            
            for (let i = 0; i < recentPatterns.length; i++) {
                if (recentPatterns[i][slot] && recentDurations[i] && recentDurations[i][slot] > 0) {
                    totalDuration += recentDurations[i][slot];
                    count++;
                }
            }
            
            // If we have data, predict the average duration (rounded)
            if (count > 0) {
                prediction[slot] = Math.round(totalDuration / count);
            }
        }
        
        return prediction;
    }

    function createHyperPredictionDurations(dur1, dur2, pattern1, pattern2) {
        // Hyper prediction durations: use average when both agree, otherwise use the one that matches the pattern
        const hyperDur = new Array(PHRASE_BEATS * 8).fill(0);
        
        if (dur1 === null && dur2 === null) {
            return hyperDur;
        }
        
        for (let slot = 0; slot < hyperDur.length; slot++) {
            const hasDur1 = dur1 && dur1[slot] > 0;
            const hasDur2 = dur2 && dur2[slot] > 0;
            
            if (hasDur1 && hasDur2) {
                // Both have duration - use average
                hyperDur[slot] = Math.round((dur1[slot] + dur2[slot]) / 2);
            } else if (hasDur1) {
                hyperDur[slot] = dur1[slot];
            } else if (hasDur2) {
                hyperDur[slot] = dur2[slot];
            }
            // Otherwise remains 0
        }
        
        return hyperDur;
    }

    function createHyperPrediction(pred1, pred2) {
        // Hyper prediction: only include agreed-upon beats and any predictions ON the beat (8th beats)
        const hyperPred = new Array(PHRASE_BEATS * 8).fill(false);
        
        // Step 1: Include all beats that both predictions agree on (high confidence)
        for (let slot = 0; slot < hyperPred.length; slot++) {
            if (pred1[slot] && pred2[slot]) {
                hyperPred[slot] = true;
            }
        }
        
        // Step 2: Add any predictions that are ON the beat (8th beat positions) from either predictor
        for (let slot = 0; slot < hyperPred.length; slot++) {
            if (!hyperPred[slot]) { // Only consider slots not already included
                const isEighthBeat = (slot % 4) === 0;
                
                // Only include if it's on an 8th beat AND at least one prediction has it
                if (isEighthBeat && (pred1[slot] || pred2[slot])) {
                    hyperPred[slot] = true;
                }
            }
        }
        
        return hyperPred;
    }

    function predictNextPhrase() {
        if (phrasePatterns.length < 4 && correctPredictionPatterns.length === 0) {
            // Need at least 4 phrases or some correct patterns to make a prediction
            predictedPhrasePattern = null;
            predictedFromCorrectPatterns = null;
            hyperPredictedPhrasePattern = null;
            predictedPhraseDurations = null;
            predictedFromCorrectPatternsDurations = null;
            hyperPredictedPhraseDurations = null;
            return;
        }
        
        // Use last 16 phrases (or all available if less than 16)
        const historyPhrases = phrasePatterns.slice(-Math.min(16, phrasePatterns.length));
        const historyDurations = phraseDurations.slice(-Math.min(16, phraseDurations.length));
        
        // PREDICTION 1: From history phrases (patterns)
        const prevPredictedFromHistory = predictedPhrasePattern;
        predictedPhrasePattern = predictFromHistoryPhrases(historyPhrases);
        
        // PREDICTION 1: From history phrases (durations)
        predictedPhraseDurations = predictDurationsFromHistoryPhrases(historyPhrases, historyDurations);
        
        // Log first prediction from history phrases
        if (!hasLoggedInitialPrediction && predictedPhrasePattern !== null && prevPredictedFromHistory === null) {
            log('PREDICTION_INIT', '🔮 [INITIAL PREDICTION] First prediction from history phrases generated');
            hasLoggedInitialPrediction = true;
        }
        
        // PREDICTION 2: From correct prediction patterns
        const prevPredictedFromCorrect = predictedFromCorrectPatterns;
        predictedFromCorrectPatterns = predictFromCorrectPatterns();
        
        // PREDICTION 2: From correct patterns (durations)
        predictedFromCorrectPatternsDurations = predictDurationsFromCorrectPatterns();
        
        // Log first prediction from correct patterns
        if (!hasLoggedCorrectPatternPrediction && predictedFromCorrectPatterns !== null && prevPredictedFromCorrect === null) {
            log('PREDICTION_INIT', '🔮 [INITIAL PREDICTION] First prediction from correct patterns generated');
            hasLoggedCorrectPatternPrediction = true;
        }
        
        // HYPER PREDICTION: Combine both predictions (patterns)
        const prevHyperPrediction = hyperPredictedPhrasePattern;
        if (predictedPhrasePattern !== null && predictedFromCorrectPatterns !== null) {
            hyperPredictedPhrasePattern = createHyperPrediction(predictedPhrasePattern, predictedFromCorrectPatterns);
        } else if (predictedPhrasePattern !== null) {
            hyperPredictedPhrasePattern = [...predictedPhrasePattern];
        } else if (predictedFromCorrectPatterns !== null) {
            hyperPredictedPhrasePattern = [...predictedFromCorrectPatterns];
        } else {
            hyperPredictedPhrasePattern = null;
        }
        
        // HYPER PREDICTION: Combine both predictions (durations)
        hyperPredictedPhraseDurations = createHyperPredictionDurations(
            predictedPhraseDurations,
            predictedFromCorrectPatternsDurations,
            predictedPhrasePattern,
            predictedFromCorrectPatterns
        );
        
        // Log first hyper prediction
        if (!hasLoggedHyperPrediction && hyperPredictedPhrasePattern !== null && prevHyperPrediction === null) {
            log('PREDICTION_HYPER', '🌟 [HYPER PREDICTION] First hyper prediction generated (combined from both sources)');
            hasLoggedHyperPrediction = true;
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
                currentPhraseDurations = new Array(PHRASE_BEATS * 8).fill(0); // Durations in slots (0 = no duration/single beat)
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
                            // Store corresponding durations for correct patterns
                            const correctDurations = new Array(correctParts.length).fill(0);
                            for (let i = 0; i < correctParts.length; i++) {
                                if (correctParts[i] && currentPhraseDurations && currentPhraseDurations[i] > 0) {
                                    correctDurations[i] = currentPhraseDurations[i];
                                }
                            }
                            correctPredictionDurations.push(correctDurations);
                            if (correctPredictionDurations.length > MAX_CORRECT_PATTERNS) {
                                correctPredictionDurations.shift();
                            }
                        }
                    }
                    
                    phrasePatterns.push([...currentPhrasePattern]);
                    // Save durations array (create copy or empty array if null)
                    phraseDurations.push(currentPhraseDurations ? [...currentPhraseDurations] : new Array(PHRASE_BEATS * 8).fill(0));
                    if (phraseDurations.length > MAX_PHRASES) {
                        phraseDurations.shift();
                    }
                    phraseCount++;
                    
                    // Log first phrase completion
                    if (!hasLoggedFirstPhrase) {
                        log('PULSE_PATTERN', '🎵 [PULSE PATTERN LISTENING] First phrase completed');
                        hasLoggedFirstPhrase = true;
                    }
                    
                    // Log when we have enough phrases for prediction
                    if (!hasLoggedEnoughPhrases && phrasePatterns.length >= 4) {
                        log('PULSE_PATTERN', '🎵 [PULSE PATTERN LISTENING] Enough phrases collected for prediction (4 phrases)');
                        hasLoggedEnoughPhrases = true;
                    }
                    
                    if (phrasePatterns.length > MAX_PHRASES) {
                        phrasePatterns.shift();
                    }
                }
                
                // Start new phrase
                currentPhraseStart = pulseTime;
                currentPhrasePattern = new Array(PHRASE_BEATS * 8).fill(false);
                currentPhraseDurations = new Array(PHRASE_BEATS * 8).fill(0);
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

        // Process sustained beat information
        processSustainedBeat: function(pulseTime, duration32nd, hyperBPM) {
            if (hyperBPM === null || hyperBPM <= 0 || duration32nd === null || duration32nd <= 0) {
                return; // Need valid BPM and duration
            }
            
            // Initialize current phrase if needed
            if (currentPhraseStart === null || currentPhraseDurations === null) {
                return; // Can't record duration without active phrase
            }
            
            const beatDuration = 60 / hyperBPM;
            const thirtySecondNoteDuration = beatDuration / 8;
            
            // Calculate which slot this pulse corresponds to
            const timeInCurrentPhrase = pulseTime - currentPhraseStart;
            const slotIndex = Math.round(timeInCurrentPhrase / thirtySecondNoteDuration);
            
            // Clamp to phrase bounds and store duration
            if (slotIndex >= 0 && slotIndex < currentPhraseDurations.length) {
                // Store duration in slots (duration32nd is already in 32nd note units, which matches our slot units)
                currentPhraseDurations[slotIndex] = Math.max(currentPhraseDurations[slotIndex], Math.round(duration32nd));
            }
        },

        // Get phrase durations (history)
        getPhraseDurations: function() {
            return phraseDurations.map(durations => durations ? [...durations] : new Array(PHRASE_BEATS * 8).fill(0));
        },

        // Get hyper predicted durations
        getHyperPredictedDurations: function() {
            return hyperPredictedPhraseDurations ? [...hyperPredictedPhraseDurations] : null;
        },

        // Reset all state
        reset: function() {
            currentPhraseStart = null;
            currentPhrasePattern = null;
            currentPhraseDurations = null;
            predictedPhrasePattern = null;
            predictedFromCorrectPatterns = null;
            hyperPredictedPhrasePattern = null;
            predictedPhraseDurations = null;
            predictedFromCorrectPatternsDurations = null;
            hyperPredictedPhraseDurations = null;
            phrasePatterns = [];
            phraseDurations = [];
            phraseCount = 0;
            predictionAccuracy = [];
            hasLoggedFirstPhrase = false;
            hasLoggedEnoughPhrases = false;
            hasLoggedInitialPrediction = false;
            hasLoggedCorrectPatternPrediction = false;
            hasLoggedHyperPrediction = false;
            correctPredictionPatterns = [];
            correctPredictionDurations = [];
        }
    };
})();

// Export functions if using modules, otherwise attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RHYTHM_PREDICTOR;
} else {
    window.RHYTHM_PREDICTOR = RHYTHM_PREDICTOR;
}

