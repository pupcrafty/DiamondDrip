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
    let currentPhrasePattern = null; // Current phrase pattern (32nd note slots) - boolean array
    let currentPhraseDurations = null; // Current phrase sustained beat durations (32nd note beats) - number array (null for non-sustained)
    let predictedPhrasePattern = null; // Predicted next phrase pattern (from history phrases)
    let predictedPhraseDurations = null; // Predicted durations for next phrase
    let predictedFromCorrectPatterns = null; // Predicted next phrase pattern (from correct patterns)
    let predictedFromCorrectDurations = null; // Predicted durations from correct patterns
    let hyperPredictedPhrasePattern = null; // Hyper prediction combining both predictions
    let hyperPredictedDurations = null; // Hyper predicted durations
    let phrasePatterns = []; // Array of phrase patterns (last N phrases) - boolean arrays
    let phraseDurations = []; // Array of phrase durations (last N phrases) - number arrays
    let phraseCount = 0; // Total phrase count for pattern adjustment
    let predictionAccuracy = []; // Array of accuracy records for past phrases {correct: number, total: number, accuracy: number}
    let correctPredictionPatterns = []; // Store patterns that were correctly predicted for future use
    let correctPredictionDurations = []; // Store durations that were correctly predicted
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

    function arePatternsSimilarForDurations(pattern1, pattern2, threshold) {
        // For durations, compare numeric values (treating null as 0)
        if (pattern1.length !== pattern2.length) return false;
        
        let matches = 0;
        for (let i = 0; i < pattern1.length; i++) {
            const val1 = pattern1[i] !== null && pattern1[i] !== undefined ? pattern1[i] : 0;
            const val2 = pattern2[i] !== null && pattern2[i] !== undefined ? pattern2[i] : 0;
            // Consider similar if both are null/0 or both have similar values (within 20% difference)
            if (val1 === val2 || (val1 > 0 && val2 > 0 && Math.abs(val1 - val2) / Math.max(val1, val2) < 0.2)) {
                matches++;
            }
        }
        
        const similarity = matches / pattern1.length;
        return similarity >= threshold;
    }

    function findRepeatingPattern(phrases, forDurations = false) {
        // Look for repeating sequences of 2, 3, or 4 phrases
        for (let patternLength = 2; patternLength <= 4; patternLength++) {
            if (phrases.length < patternLength * 2) continue; // Need at least 2 repetitions
            
            // Check if the last patternLength phrases repeat
            const lastPattern = phrases.slice(-patternLength);
            const previousPattern = phrases.slice(-patternLength * 2, -patternLength);
            
            // Compare patterns (use different similarity function for durations)
            let matches = true;
            for (let i = 0; i < patternLength; i++) {
                const areSimilar = forDurations 
                    ? arePatternsSimilarForDurations(lastPattern[i], previousPattern[i], 0.8)
                    : arePatternsSimilar(lastPattern[i], previousPattern[i], 0.8);
                if (!areSimilar) {
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

    function predictFromHistoryPhrases(historyPhrases, historyDurations) {
        // Try to find repeating patterns first
        const repeatingPattern = findRepeatingPattern(historyPhrases);
        const repeatingDurations = historyDurations && historyDurations.length > 0 ? 
            findRepeatingPattern(historyDurations, true) : null; // true = for durations
        
        if (repeatingPattern !== null) {
            // Found a repeating pattern, use it to predict
            const prediction = [...repeatingPattern];
            const predictionDurations = repeatingDurations ? [...repeatingDurations] : new Array(PHRASE_BEATS * 8).fill(null);
            // Apply 8th beat preference to repeating patterns
            applyEighthBeatPreference(prediction);
            return { pattern: prediction, durations: predictionDurations };
        }
        
        // If no clear repeating pattern, use statistical prediction
        // For each 32nd note slot, predict based on how often it's been active in similar positions
        const prediction = new Array(PHRASE_BEATS * 8).fill(false);
        const predictionDurations = new Array(PHRASE_BEATS * 8).fill(null);
        
        // Use only history phrases for this prediction
        const recentPhrases = historyPhrases.slice(-2); // Use last 2 phrases (reduced from 4 for faster startup)
        const recentDurations = historyDurations ? historyDurations.slice(-2) : [];
        
        // First pass: favor 8th beats (every 4 slots: 0, 4, 8, 12, 16, 20, 24, 28)
        for (let slot = 0; slot < prediction.length; slot++) {
            const isEighthBeat = (slot % 4) === 0;
            
            // Count how many times this slot was active in recent phrases
            let activeCount = 0;
            const durations = [];
            for (let i = 0; i < recentPhrases.length; i++) {
                if (recentPhrases[i][slot]) {
                    activeCount++;
                    // Collect durations for this slot
                    if (recentDurations[i] && recentDurations[i][slot] !== null && recentDurations[i][slot] !== undefined) {
                        durations.push(recentDurations[i][slot]);
                    }
                }
            }
            
            // If slot was active in majority of recent phrases, predict it will be active
            // Use threshold of 50% (at least 1 out of 2 for faster startup)
            // But favor 8th beats with lower threshold
            const threshold = isEighthBeat ? Math.max(1, Math.ceil(recentPhrases.length * 0.4)) : Math.max(1, Math.ceil(recentPhrases.length / 2));
            
            if (activeCount >= threshold) {
                prediction[slot] = true;
                // Predict duration as average of historical durations (if any)
                if (durations.length > 0) {
                    const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
                    predictionDurations[slot] = avgDuration;
                }
            }
        }
        
        // Apply 8th beat preference (second pass)
        applyEighthBeatPreference(prediction);
        
        // Also check for patterns based on phrase position in a cycle
        // Look for 4-phrase cycles (only use historyPhrases for cycle detection)
        // Reduced from 8 to 4 phrases needed for cycle detection (faster startup)
        if (historyPhrases.length >= 4) {
            const cycleLength = 4;
            const currentCyclePosition = (historyPhrases.length) % cycleLength;
            
            // Find phrases at the same position in previous cycles
            const similarPhrases = [];
            const similarDurations = [];
            for (let i = currentCyclePosition; i < historyPhrases.length; i += cycleLength) {
                similarPhrases.push(historyPhrases[i]);
                if (historyDurations && historyDurations[i]) {
                    similarDurations.push(historyDurations[i]);
                }
            }
            
            // If we have at least 2 phrases at this position, use them for prediction
            if (similarPhrases.length >= 2) {
                for (let slot = 0; slot < prediction.length; slot++) {
                    const isEighthBeat = (slot % 4) === 0;
                    let activeCount = 0;
                    const durations = [];
                    for (let i = 0; i < similarPhrases.length; i++) {
                        if (similarPhrases[i][slot]) {
                            activeCount++;
                            // Collect durations
                            if (similarDurations[i] && similarDurations[i][slot] !== null && similarDurations[i][slot] !== undefined) {
                                durations.push(similarDurations[i][slot]);
                            }
                        }
                    }
            // Favor 8th beats with lower threshold
            const threshold = isEighthBeat ? Math.max(1, Math.ceil(similarPhrases.length * 0.4)) : Math.max(1, Math.ceil(similarPhrases.length / 2));
                    // If majority of similar-position phrases have this slot active, predict it
                    if (activeCount >= threshold) {
                        prediction[slot] = true;
                        // Predict duration as average if we have duration data
                        if (durations.length > 0 && !predictionDurations[slot]) {
                            const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
                            predictionDurations[slot] = avgDuration;
                        }
                    }
                }
                
                // Apply 8th beat preference
                applyEighthBeatPreference(prediction);
            }
        }
        
        return { pattern: prediction, durations: predictionDurations };
    }

    function predictFromCorrectPatterns() {
        if (correctPredictionPatterns.length === 0) {
            return null;
        }
        
        // Create prediction based on correct prediction patterns
        const prediction = new Array(PHRASE_BEATS * 8).fill(false);
        const predictionDurations = new Array(PHRASE_BEATS * 8).fill(null);
        
        // Use last 2-4 correct patterns for prediction (reduced from 4-8 for faster startup)
        const recentCorrectPatterns = correctPredictionPatterns.slice(-Math.min(4, correctPredictionPatterns.length));
        const recentCorrectDurations = correctPredictionDurations.slice(-Math.min(4, correctPredictionDurations.length));
        
        // Statistical prediction from correct patterns
        for (let slot = 0; slot < prediction.length; slot++) {
            const isEighthBeat = (slot % 4) === 0;
            
            // Count how many times this slot was active in recent correct patterns
            let activeCount = 0;
            const durations = [];
            for (let i = 0; i < recentCorrectPatterns.length; i++) {
                if (recentCorrectPatterns[i][slot]) {
                    activeCount++;
                    // Collect durations
                    if (recentCorrectDurations[i] && recentCorrectDurations[i][slot] !== null && recentCorrectDurations[i][slot] !== undefined) {
                        durations.push(recentCorrectDurations[i][slot]);
                    }
                }
            }
            
            // If slot was active in majority of recent correct patterns, predict it will be active
            // Favor 8th beats with lower threshold
            const threshold = isEighthBeat ? Math.max(1, Math.ceil(recentCorrectPatterns.length * 0.4)) : Math.max(1, Math.ceil(recentCorrectPatterns.length / 2));
            
            if (activeCount >= threshold) {
                prediction[slot] = true;
                // Predict duration as average if we have duration data
                if (durations.length > 0) {
                    const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
                    predictionDurations[slot] = avgDuration;
                }
            }
        }
        
        // Apply 8th beat preference
        applyEighthBeatPreference(prediction);
        
        return { pattern: prediction, durations: predictionDurations };
    }

    function createHyperPrediction(pred1, pred2) {
        // Hyper prediction: only include agreed-upon beats and any predictions ON the beat (8th beats)
        const hyperPred = new Array(PHRASE_BEATS * 8).fill(false);
        const hyperDurations = new Array(PHRASE_BEATS * 8).fill(null);
        
        // Extract patterns and durations
        const pred1Pattern = pred1.pattern || pred1;
        const pred1Durations = pred1.durations || null;
        const pred2Pattern = pred2.pattern || pred2;
        const pred2Durations = pred2.durations || null;
        
        // Step 1: Include all beats that both predictions agree on (high confidence)
        for (let slot = 0; slot < hyperPred.length; slot++) {
            if (pred1Pattern[slot] && pred2Pattern[slot]) {
                hyperPred[slot] = true;
                // Use average duration if both have durations, or use whichever is available
                if (pred1Durations && pred1Durations[slot] !== null && pred2Durations && pred2Durations[slot] !== null) {
                    hyperDurations[slot] = (pred1Durations[slot] + pred2Durations[slot]) / 2;
                } else if (pred1Durations && pred1Durations[slot] !== null) {
                    hyperDurations[slot] = pred1Durations[slot];
                } else if (pred2Durations && pred2Durations[slot] !== null) {
                    hyperDurations[slot] = pred2Durations[slot];
                }
            }
        }
        
        // Step 2: Add any predictions that are ON the beat (8th beat positions) from either predictor
        for (let slot = 0; slot < hyperPred.length; slot++) {
            if (!hyperPred[slot]) { // Only consider slots not already included
                const isEighthBeat = (slot % 4) === 0;
                
                // Only include if it's on an 8th beat AND at least one prediction has it
                if (isEighthBeat && (pred1Pattern[slot] || pred2Pattern[slot])) {
                    hyperPred[slot] = true;
                    // Use duration from whichever prediction has it
                    if (pred1Pattern[slot] && pred1Durations && pred1Durations[slot] !== null) {
                        hyperDurations[slot] = pred1Durations[slot];
                    } else if (pred2Pattern[slot] && pred2Durations && pred2Durations[slot] !== null) {
                        hyperDurations[slot] = pred2Durations[slot];
                    }
                }
            }
        }
        
        return { pattern: hyperPred, durations: hyperDurations };
    }

    function predictNextPhrase() {
        if (phrasePatterns.length < 2 && correctPredictionPatterns.length === 0) {
            // Need at least 2 phrases or some correct patterns to make a prediction (reduced from 4 for faster startup)
            predictedPhrasePattern = null;
            predictedPhraseDurations = null;
            predictedFromCorrectPatterns = null;
            predictedFromCorrectDurations = null;
            hyperPredictedPhrasePattern = null;
            hyperPredictedDurations = null;
            return;
        }
        
        // Use last 16 phrases (or all available if less than 16)
        const historyPhrases = phrasePatterns.slice(-Math.min(16, phrasePatterns.length));
        const historyDurations = phraseDurations.slice(-Math.min(16, phraseDurations.length));
        
        // PREDICTION 1: From history phrases
        const prevPredictedFromHistory = predictedPhrasePattern;
        const result1 = predictFromHistoryPhrases(historyPhrases, historyDurations);
        if (result1) {
            predictedPhrasePattern = result1.pattern;
            predictedPhraseDurations = result1.durations;
        } else {
            predictedPhrasePattern = null;
            predictedPhraseDurations = null;
        }
        
        // Log first prediction from history phrases
        if (!hasLoggedInitialPrediction && predictedPhrasePattern !== null && prevPredictedFromHistory === null) {
            log('PREDICTION_INIT', '🔮 [INITIAL PREDICTION] First prediction from history phrases generated');
            hasLoggedInitialPrediction = true;
        }
        
        // PREDICTION 2: From correct prediction patterns
        const prevPredictedFromCorrect = predictedFromCorrectPatterns;
        const result2 = predictFromCorrectPatterns();
        if (result2) {
            predictedFromCorrectPatterns = result2.pattern;
            predictedFromCorrectDurations = result2.durations;
        } else {
            predictedFromCorrectPatterns = null;
            predictedFromCorrectDurations = null;
        }
        
        // Log first prediction from correct patterns
        if (!hasLoggedCorrectPatternPrediction && predictedFromCorrectPatterns !== null && prevPredictedFromCorrect === null) {
            log('PREDICTION_INIT', '🔮 [INITIAL PREDICTION] First prediction from correct patterns generated');
            hasLoggedCorrectPatternPrediction = true;
        }
        
        // HYPER PREDICTION: Combine both predictions
        const prevHyperPrediction = hyperPredictedPhrasePattern;
        if (predictedPhrasePattern !== null && predictedFromCorrectPatterns !== null) {
            const hyperResult = createHyperPrediction(
                { pattern: predictedPhrasePattern, durations: predictedPhraseDurations },
                { pattern: predictedFromCorrectPatterns, durations: predictedFromCorrectDurations }
            );
            hyperPredictedPhrasePattern = hyperResult.pattern;
            hyperPredictedDurations = hyperResult.durations;
        } else if (predictedPhrasePattern !== null) {
            hyperPredictedPhrasePattern = [...predictedPhrasePattern];
            hyperPredictedDurations = predictedPhraseDurations ? [...predictedPhraseDurations] : null;
        } else if (predictedFromCorrectPatterns !== null) {
            hyperPredictedPhrasePattern = [...predictedFromCorrectPatterns];
            hyperPredictedDurations = predictedFromCorrectDurations ? [...predictedFromCorrectDurations] : null;
        } else {
            hyperPredictedPhrasePattern = null;
            hyperPredictedDurations = null;
        }
        
        // Log first hyper prediction
        if (!hasLoggedHyperPrediction && hyperPredictedPhrasePattern !== null && prevHyperPrediction === null) {
            log('PREDICTION_HYPER', '🌟 [HYPER PREDICTION] First hyper prediction generated (combined from both sources)');
            hasLoggedHyperPrediction = true;
        }
        
        // Log predicted sustained beats
        if (hyperPredictedDurations !== null && hyperPredictedPhrasePattern !== null) {
            const sustainedSlots = [];
            for (let slot = 0; slot < hyperPredictedDurations.length; slot++) {
                if (hyperPredictedPhrasePattern[slot] && hyperPredictedDurations[slot] !== null && hyperPredictedDurations[slot] !== undefined) {
                    sustainedSlots.push(`slot ${slot}: ${hyperPredictedDurations[slot].toFixed(2)} 32nd`);
                }
            }
            if (sustainedSlots.length > 0) {
                log('SUSTAINED_PREDICTION', `🎯 [SUSTAINED BEAT PREDICTION] Predicted sustained beats: ${sustainedSlots.join(', ')}`);
            }
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
                currentPhraseDurations = new Array(PHRASE_BEATS * 8).fill(null); // Duration in 32nd beats, null for non-sustained
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
                            // Extract corresponding durations for correct parts
                            const correctDurations = new Array(currentPhraseDurations.length).fill(null);
                            for (let i = 0; i < correctParts.length; i++) {
                                if (correctParts[i] && currentPhraseDurations[i] !== null && currentPhraseDurations[i] !== undefined) {
                                    correctDurations[i] = currentPhraseDurations[i];
                                }
                            }
                            correctPredictionDurations.push(correctDurations);
                            if (correctPredictionPatterns.length > MAX_CORRECT_PATTERNS) {
                                correctPredictionPatterns.shift();
                                correctPredictionDurations.shift();
                            }
                        }
                    }
                    
                    phrasePatterns.push([...currentPhrasePattern]);
                    phraseDurations.push([...currentPhraseDurations]);
                    phraseCount++;
                    
                    // Log first phrase completion
                    if (!hasLoggedFirstPhrase) {
                        log('PULSE_PATTERN', '🎵 [PULSE PATTERN LISTENING] First phrase completed');
                        hasLoggedFirstPhrase = true;
                    }
                    
                    // Log when we have enough phrases for prediction
                    if (!hasLoggedEnoughPhrases && phrasePatterns.length >= 2) {
                        log('PULSE_PATTERN', '🎵 [PULSE PATTERN LISTENING] Enough phrases collected for prediction (2 phrases)');
                        hasLoggedEnoughPhrases = true;
                    }
                    
                    if (phrasePatterns.length > MAX_PHRASES) {
                        phrasePatterns.shift();
                        phraseDurations.shift();
                    }
                }
                
                // Start new phrase
                currentPhraseStart = pulseTime;
                currentPhrasePattern = new Array(PHRASE_BEATS * 8).fill(false);
                currentPhraseDurations = new Array(PHRASE_BEATS * 8).fill(null);
            }
            
            // Quantize pulse to nearest 32nd note slot
            const timeInCurrentPhrase = pulseTime - currentPhraseStart;
            const thirtySecondNoteIndex = Math.round(timeInCurrentPhrase / thirtySecondNoteDuration);
            
            // Clamp to phrase bounds (0 to 31 for 4 beats * 8 thirty-second notes)
            if (thirtySecondNoteIndex >= 0 && thirtySecondNoteIndex < currentPhrasePattern.length) {
                currentPhrasePattern[thirtySecondNoteIndex] = true;
                // Duration will be set by processSustainedBeat if this pulse becomes sustained
            }
            
            // Predict next phrase based on past patterns
            predictNextPhrase();
        },

        /**
         * Process a sustained beat detection
         * @param {number} pulseTime - Time when pulse was detected
         * @param {number} duration32nd - Duration of sustained beat in 32nd note beats
         * @param {number} hyperSmoothedBPM - Current BPM for phrase calculation
         */
        processSustainedBeat: function(pulseTime, duration32nd, hyperSmoothedBPM) {
            if (hyperSmoothedBPM === null || hyperSmoothedBPM <= 0 || currentPhraseStart === null) {
                return; // Need BPM and phrase start
            }
            
            const beatDuration = 60 / hyperSmoothedBPM;
            const phraseDuration = beatDuration * PHRASE_BEATS;
            const thirtySecondNoteDuration = beatDuration / 8;
            
            // Calculate which slot this sustained beat corresponds to
            const timeInCurrentPhrase = pulseTime - currentPhraseStart;
            
            // Handle phrase boundaries - if pulse is in previous phrase, ignore
            if (timeInCurrentPhrase < 0 || timeInCurrentPhrase >= phraseDuration) {
                return;
            }
            
            const thirtySecondNoteIndex = Math.round(timeInCurrentPhrase / thirtySecondNoteDuration);
            
            // Clamp to phrase bounds
            if (thirtySecondNoteIndex >= 0 && thirtySecondNoteIndex < currentPhrasePattern.length) {
                // Only set duration if there's a pulse at this slot
                if (currentPhrasePattern[thirtySecondNoteIndex]) {
                    currentPhraseDurations[thirtySecondNoteIndex] = duration32nd;
                }
            }
        },

        // Get current phrase pattern
        getCurrentPhrasePattern: function() {
            return currentPhrasePattern ? [...currentPhrasePattern] : null;
        },

        // Get current phrase durations
        getCurrentPhraseDurations: function() {
            return currentPhraseDurations ? [...currentPhraseDurations] : null;
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

        // Get predicted durations
        getPredictedPhraseDurations: function() {
            return predictedPhraseDurations ? [...predictedPhraseDurations] : null;
        },

        getPredictedFromCorrectDurations: function() {
            return predictedFromCorrectDurations ? [...predictedFromCorrectDurations] : null;
        },

        getHyperPredictedDurations: function() {
            return hyperPredictedDurations ? [...hyperPredictedDurations] : null;
        },

        // Get all phrase patterns
        getPhrasePatterns: function() {
            return phrasePatterns.map(pattern => [...pattern]);
        },

        // Get all phrase durations
        getPhraseDurations: function() {
            return phraseDurations.map(durations => [...durations]);
        },

        // Get correct prediction patterns
        getCorrectPredictionPatterns: function() {
            return correctPredictionPatterns.map(pattern => [...pattern]);
        },

        // Get correct prediction durations
        getCorrectPredictionDurations: function() {
            return correctPredictionDurations.map(durations => [...durations]);
        },

        // Get prediction accuracy
        getPredictionAccuracy: function() {
            return [...predictionAccuracy];
        },

        // Reset all state
        reset: function() {
            currentPhraseStart = null;
            currentPhrasePattern = null;
            currentPhraseDurations = null;
            predictedPhrasePattern = null;
            predictedPhraseDurations = null;
            predictedFromCorrectPatterns = null;
            predictedFromCorrectDurations = null;
            hyperPredictedPhrasePattern = null;
            hyperPredictedDurations = null;
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

