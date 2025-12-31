// -----------------------------
// Game Loop Logic (without drawing)
// -----------------------------

function updateGameLogic(t) {
    // Update BPM and energy classifiers periodically
    BPM_ESTIMATOR.update();
    ENERGY_CLASSIFIER.update();
    
    // Check if we have enough data
    checkIfHasEnoughData();
    
    // Check if we need a new prediction and request it on-demand
    if (typeof checkAndRequestPredictionIfNeeded === 'function') {
        checkAndRequestPredictionIfNeeded();
    } else {
        // Log warning if function is not available (only once)
        if (!window._predictionApiWarningLogged) {
            console.warn('[GAME] ⚠️ checkAndRequestPredictionIfNeeded() is not available! Make sure predictionApi.js is loaded.');
            window._predictionApiWarningLogged = true;
        }
    }
    
    // Debug: log state periodically
    if (Math.random() < 0.005) { // Less frequent
        const hasEnough = hasEnoughDataState();
        const activePred = typeof getActivePrediction === 'function' ? getActivePrediction() : null;
        const hyperBPM = typeof BPM_ESTIMATOR !== 'undefined' ? BPM_ESTIMATOR.getHyperSmoothedBPM() : null;
        const hyperPred = typeof RHYTHM_PREDICTOR !== 'undefined' ? RHYTHM_PREDICTOR.getHyperPredictedPhrasePattern() : null;
        const energyLevel = typeof ENERGY_CLASSIFIER !== 'undefined' ? ENERGY_CLASSIFIER.getCurrentEnergyLevel() : 0;
        console.log('[GAME DEBUG]', {
            hasEnoughData: hasEnough,
            hasActivePrediction: activePred !== null,
            hyperBPM: hyperBPM,
            hasHyperPred: hyperPred !== null,
            energyLevel: energyLevel,
            markers: typeof getMarkers === 'function' ? getMarkers().length : 0
        });
    }
    
    // Get predicted beat timestamps from active prediction (server or client)
    if (hasEnoughDataState()) {
        const predictedBeats = getPredictedBeatTimestamps(t);
        const energyLevel = ENERGY_CLASSIFIER.getCurrentEnergyLevel();
        
        // Debug: log prediction status periodically
        if (Math.random() < 0.02) {
            const activePred = typeof getActivePrediction === 'function' ? getActivePrediction() : null;
            console.log('[MARKER SPAWN DEBUG] Prediction check:', {
                hasEnoughData: true,
                predictedBeatsCount: predictedBeats.length,
                currentTime: t.toFixed(3),
                activePredSource: activePred?.source || 'none',
                activePredBPM: activePred?.bpm?.toFixed(1) || 'none'
            });
        }
        
        // Debug: log when we have beats but they're not spawning
        if (predictedBeats.length > 0 && Math.random() < 0.01) {
            const targets = getTargets();
            const markers = getMarkers();
            const spawnedPredictedBeats = getSpawnedPredictedBeats();
            const futureBeats = predictedBeats.filter(b => b.time > t);
            const unspawnedBeats = futureBeats.filter(b => {
                const beatKey = `${b.phraseStart}_${b.slot}`;
                return !spawnedPredictedBeats.has(beatKey);
            });
            console.log('[GAME] Beats status:', {
                total: predictedBeats.length,
                future: futureBeats.length,
                unspawned: unspawnedBeats.length,
                spawned: spawnedPredictedBeats.size,
                markers: markers.length,
                targets: targets.length
            });
        }
        
        // Spawn markers for predicted beats we haven't spawned yet
        const targets = getTargets();
        let markers = getMarkers();
        const spawnedPredictedBeats = getSpawnedPredictedBeats();
        let markersSpawned = 0;
        
        // Debug logging for marker spawning
        if (predictedBeats.length > 0 && Math.random() < 0.05) {
            const futureBeats = predictedBeats.filter(b => b.time > t);
            const unspawnedFutureBeats = futureBeats.filter(b => {
                const key = `${b.phraseStart}_${b.slot}`;
                return !spawnedPredictedBeats.has(key);
            });
            console.log('[MARKER SPAWN DEBUG]', {
                totalBeats: predictedBeats.length,
                futureBeats: futureBeats.length,
                unspawnedFutureBeats: unspawnedFutureBeats.length,
                currentTime: t.toFixed(3),
                firstFutureBeatTime: futureBeats.length > 0 ? futureBeats[0].time.toFixed(3) : 'none',
                spawnedSetSize: spawnedPredictedBeats.size
            });
        }
        
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
                        setMarkers(markers); // Update markers array
                        markersSpawned += 2;
                        
                        // Mark this beat as spawned
                        spawnedPredictedBeats.add(beatKey);
                        
                        log('GAME', `🎮 [GAME] 🎯 Sustained beat markers spawned: Start (${startSideIndex === 0 ? 'left' : 'right'}) at ${startArrivalTime.toFixed(3)}s, End (middle) at ${endArrivalTime.toFixed(3)}s, Duration: ${beatInfo.duration.toFixed(3)}s`);
                        
                        // Track in outline
                        if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
                            GAME_LOOP_OUTLINE.onMarkersSpawned(2, beatInfo);
                        }
                    }
                } else {
                    // For single beats, check if there's an active sustain and block same side
                    let targetIndex;
                    const currentlySustainingSide = getCurrentlySustainingSide();
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
                        if (Math.random() < 0.1) {
                            console.log('[MARKER SPAWN] Skipping beat - not enough time:', {
                                beatTime: beatInfo.time.toFixed(3),
                                currentTime: t.toFixed(3),
                                totalTime: totalTime.toFixed(3),
                                fallTime: fallTime.toFixed(3),
                                holdDuration: holdDuration.toFixed(3)
                            });
                        }
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
                    setMarkers(markers); // Update markers array
                    markersSpawned += 1;
                    
                    // Mark this beat as spawned
                    spawnedPredictedBeats.add(beatKey);
                    
                    target.beatSpawn = -1;
                    target.beatDisappear = beatInfo.time;
                    
                    const sideName = targetIndex === 0 ? 'left' : 'right';
                    log('GAME', `🎮 [GAME] 🎯 Single beat marker spawned (${sideName}) at ${beatInfo.time.toFixed(3)}s`);
                    console.log('[MARKER SPAWN] ✅ Marker created:', {
                        beatKey: beatKey,
                        beatTime: beatInfo.time.toFixed(3),
                        currentTime: t.toFixed(3),
                        totalTime: totalTime.toFixed(3),
                        holdDuration: holdDuration.toFixed(3),
                        side: sideName
                    });
                    
                    // Track in outline
                    if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
                        GAME_LOOP_OUTLINE.onMarkersSpawned(1, beatInfo);
                    }
                }
            } else {
                // Debug: log why beat was skipped
                if (Math.random() < 0.1 && beatInfo.time > t - 1.0) { // Only log beats in the recent past/future
                    const reason = spawnedPredictedBeats.has(beatKey) ? 'already spawned' : (beatInfo.time <= t ? 'in the past' : 'unknown');
                    console.log('[MARKER SPAWN] ⏭️ Beat skipped:', {
                        beatKey: beatKey,
                        beatTime: beatInfo.time.toFixed(3),
                        currentTime: t.toFixed(3),
                        reason: reason
                    });
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
    let markers = getMarkers();
    for (const marker of markers) {
        marker.update(t);
    }
    
    // Check for sustained beat completion and timeouts
    const sustainedInputsToCleanup = [];
    const gracePeriod = 0.2; // Grace period in seconds
    const activeSustainedInputs = getActiveSustainedInputs();
    
    for (const [pairId, sustainInput] of activeSustainedInputs.entries()) {
        const endMarker = sustainInput.endMarker;
        const timeSinceEndMarker = t - endMarker.tArrival;
        
        // Check if end marker has arrived (within grace period)
        if (timeSinceEndMarker >= 0 && timeSinceEndMarker <= gracePeriod && !endMarker.hit) {
            // Check if input is still active based on input type
            let inputStillActive = false;
            
            // Access state variables from gameState.js (these need to be exposed)
            // For now, we'll access them directly - they should be in the same scope
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
                    updateCombo(-getCombo()); // Reset combo
                    log('GAME', '🎮 [GAME] ❌ Sustained beat end MISS (Combo reset)');
                } else {
                    updateCombo(1);
                    log('GAME', '🎮 [GAME] ✅ Sustained beat completed:', result, '(Combo:', getCombo(), ')');
                    
                    const scoreIncrement = result === "OKAY" ? 1 : 
                                          result === "GOOD" ? 2 : 
                                          result === "GREAT" ? 3 : 
                                          result === "PERFECT" ? 5 : 0;
                    updateScore(scoreIncrement);
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
                        updateSustainScore(bonus32nd);
                        log('GAME', `🎮 [GAME] 🎯 Sustained beat bonus: ${bonus32nd} points (held for ${holdDuration32nd.toFixed(2)} 32nd beats, Sustain Score: ${getSustainScore()})`);
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
                updateCombo(-getCombo()); // Reset combo
                log('GAME', '🎮 [GAME] ❌ Sustained beat timed out (MISS)');
            }
            sustainedInputsToCleanup.push(pairId);
        }
    }
    
    // Clean up timed-out sustained inputs
    // Note: We need to access the state variables directly for cleanup
    // This is a bit of a hack, but necessary until we refactor state management further
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
    const currentlySustainingSide = getCurrentlySustainingSide();
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
            setCurrentlySustainingSide(null);
            sustainedBeatStartTime = null;
            sustainedBeatDuration = 0;
            sustainedBeatDuration32nd = 0;
        }
    }
    
    // Remove markers that have left the yellow circle or are individually marked as hit
    markers = getMarkers();
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
    // Update markers array by filtering out removed markers
    const remainingMarkers = markers.filter(marker => !marker.hit && !marker.hasLeftYellowCircle(t));
    setMarkers(remainingMarkers);
}

