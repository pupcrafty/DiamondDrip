// -----------------------------
// Input Handlers
// -----------------------------

// Canvas reference (will be set by game.js)
let inputCanvas = null;

function setCanvasForInput(canvasElement) {
    inputCanvas = canvasElement;
}

// Function to handle hitting a target by index (0-7) or by mouse position
// inputTypeHint: 'keyboard' | 'mouse' | 'touch' (optional, for sustained beats)
function hitTarget(targetIndex = null, mouseX = null, mouseY = null, inputTypeHint = null) {
    const yellowRadius = getYellowRadius();
    const targets = getTargets();
    const markers = getMarkers();
    let clickedTarget = null;
    
    if (targetIndex !== null && targetIndex >= 0 && targetIndex < targets.length) {
        // Hit target by index (keyboard input)
        const target = targets[targetIndex];
        clickedTarget = target;
    } else if (mouseX !== null && mouseY !== null) {
        // Find target by mouse position (mouse click)
        for (const target of targets) {
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
            // Check if this is a sustained beat marker
            if (nextMarker.isSustainedBeatMarker() && nextMarker.pairedMarker) {
                // This is a sustained beat - determine if it's the start or end marker
                const startMarker = nextMarker.tArrival < nextMarker.pairedMarker.tArrival ? nextMarker : nextMarker.pairedMarker;
                const endMarker = nextMarker.tArrival < nextMarker.pairedMarker.tArrival ? nextMarker.pairedMarker : nextMarker;
                
                // Check if we're hitting the start marker (on the side)
                if (nextMarker === startMarker) {
                    // Start of sustained beat - begin tracking the input
                    const pairId = `${startMarker.tArrival}_${endMarker.tArrival}`;
                    const currentTime = now();
                    
                    // Determine input type based on how we got here
                    let inputType = inputTypeHint || 'mouse';
                    let inputData = {};
                    
                    if (targetIndex !== null) {
                        // Keyboard input
                        inputType = 'keyboard';
                        inputData = { key: targetIndex === 0 ? 'a' : 'd' };
                    } else if (mouseX !== null && mouseY !== null) {
                        if (inputType === 'touch') {
                            // Touch input - find which touch is at this position
                            inputData = { touchId1: undefined, touchId2: undefined, touch1Data: { x: mouseX, y: mouseY }, touch2Data: null };
                            // Find the touch at this position
                            for (const [touchId, touchData] of touchPositions.entries()) {
                                const dx = touchData.x - mouseX;
                                const dy = touchData.y - mouseY;
                                const distance = Math.sqrt(dx * dx + dy * dy);
                                if (distance < 10) { // Within 10 pixels
                                    inputData.touchId1 = touchId;
                                    break;
                                }
                            }
                        } else {
                            // Mouse input
                            inputType = 'mouse';
                            inputData = { startX: mouseX, startY: mouseY, currentX: mouseX, currentY: mouseY };
                        }
                    }
                    
                    // Start tracking this sustained input
                    const activeSustainedInputs = getActiveSustainedInputs();
                    activeSustainedInputs.set(pairId, {
                        startMarker: startMarker,
                        endMarker: endMarker,
                        startTime: currentTime,
                        inputType: inputType,
                        inputData: inputData
                    });
                    
                    // Mark start marker as hit (but don't remove it yet - we need it for the line)
                    startMarker.hit = true;
                    
                    // Set target.hit for visual feedback
                    clickedTarget.hit = true;
                    setTimeout(() => {
                        clickedTarget.hit = false;
                    }, 200);
                    
                    // Score the initial hit
                    const result = clickedTarget.getHitResult(startMarker.x, startMarker.y);
                    if (result === "MISS") {
                        updateCombo(-getCombo()); // Reset combo
                        log('GAME', '🎮 [GAME] ❌ Sustained beat start MISS (Combo reset)');
                    } else {
                        updateCombo(1);
                        log('GAME', '🎮 [GAME] ✅ Sustained beat started:', result, '(Combo:', getCombo(), ')');
                        
                        const scoreIncrement = result === "OKAY" ? 1 : 
                                              result === "GOOD" ? 2 : 
                                              result === "GREAT" ? 3 : 
                                              result === "PERFECT" ? 5 : 0;
                        updateScore(scoreIncrement);
                    }
                    
                    setLastResult(result);
                    
                    // Update tracking for keyboard (access state variables directly)
                    if (inputType === 'keyboard') {
                        if (inputData.key === 'a') {
                            leftKeyHeld = true;
                            leftKeyActiveSustain = pairId;
                        } else if (inputData.key === 'd') {
                            rightKeyHeld = true;
                            rightKeyActiveSustain = pairId;
                        }
                    }
                    
                    // Update tracking for mouse
                    if (inputType === 'mouse') {
                        mouseDragActive = true;
                        mouseDragSustain = pairId;
                        mouseDragStartX = mouseX;
                        mouseDragStartY = mouseY;
                    }
                    
                    // Update tracking for touch
                    if (inputType === 'touch' && inputData.touchId1 !== undefined) {
                        touchActiveSustains.set(inputData.touchId1, pairId);
                    }
                    
                    // Block same-side pulses during this sustain
                    const startSideIndex = startMarker.target === targets[0] ? 0 : 2;
                    setCurrentlySustainingSide(startSideIndex);
                    sustainedBeatStartTime = currentTime;
                    
                    // Calculate expected duration
                    const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
                    if (hyperBPM && hyperBPM > 0) {
                        const beatDuration = 60.0 / hyperBPM;
                        sustainedBeatDuration = endMarker.tArrival - startMarker.tArrival;
                        sustainedBeatDuration32nd = sustainedBeatDuration / (beatDuration / 8);
                    }
                    
                    // Track in outline
                    if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
                        GAME_LOOP_OUTLINE.onTargetHit(result, startSideIndex, startMarker.tArrival);
                    }
                } else {
                    // This is the end marker - check if we've been holding the sustain
                    const pairId = `${startMarker.tArrival}_${endMarker.tArrival}`;
                    const activeSustainedInputs = getActiveSustainedInputs();
                    const sustainInput = activeSustainedInputs.get(pairId);
                    
                    if (sustainInput) {
                        // We've been holding the sustain - complete it
                        const holdDuration = now() - sustainInput.startTime;
                        const expectedDuration = endMarker.tArrival - startMarker.tArrival;
                        
                        // Score the end marker hit
                        const result = clickedTarget.getHitResult(endMarker.x, endMarker.y);
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
                        clickedTarget.hit = true;
                        setTimeout(() => {
                            clickedTarget.hit = false;
                        }, 200);
                        
                        // Clean up tracking
                        activeSustainedInputs.delete(pairId);
                        
                        if (sustainInput.inputType === 'keyboard') {
                            if (sustainInput.inputData.key === 'a') {
                                leftKeyHeld = false;
                                leftKeyActiveSustain = null;
                            } else if (sustainInput.inputData.key === 'd') {
                                rightKeyHeld = false;
                                rightKeyActiveSustain = null;
                            }
                        }
                        
                        if (sustainInput.inputType === 'mouse') {
                            mouseDragActive = false;
                            mouseDragSustain = null;
                        }
                        
                        setCurrentlySustainingSide(null);
                        sustainedBeatStartTime = null;
                        sustainedBeatDuration = 0;
                        sustainedBeatDuration32nd = 0;
                        
                        // Track in outline
                        if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
                            GAME_LOOP_OUTLINE.onTargetHit(result, 1, endMarker.tArrival);
                        }
                    } else {
                        // We didn't hold the sustain - treat as a miss
                        updateCombo(-getCombo()); // Reset combo
                        setLastResult("MISS");
                        log('GAME', '🎮 [GAME] ❌ Sustained beat end hit without holding (MISS)');
                        
                        // Track in outline
                        if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
                            GAME_LOOP_OUTLINE.onTargetHit("MISS", 1, endMarker.tArrival);
                        }
                    }
                }
            } else {
                // Normal single beat marker
                const result = clickedTarget.getHitResult(nextMarker.x, nextMarker.y);
                
                // Mark this specific marker as hit
                nextMarker.hit = true;
                
                // Set target.hit for visual feedback
                clickedTarget.hit = true;
                setTimeout(() => {
                    clickedTarget.hit = false;
                }, 200);
                
                if (result === "MISS") {
                    updateCombo(-getCombo()); // Reset combo
                    log('GAME', '🎮 [GAME] ❌ Target hit but scored MISS (Combo reset)');
                } else {
                    updateCombo(1);
                    log('GAME', '🎮 [GAME] ✅ Target hit:', result, '(Combo:', getCombo(), ')');
                    
                    const scoreIncrement = result === "OKAY" ? 1 : 
                                          result === "GOOD" ? 2 : 
                                          result === "GREAT" ? 3 : 
                                          result === "PERFECT" ? 5 : 0;
                    updateScore(scoreIncrement);
                }
                
                setLastResult(result);
                lastErrMs = 0;
                
                // Track in outline
                const targetIndex = targets.indexOf(clickedTarget);
                if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
                    GAME_LOOP_OUTLINE.onTargetHit(result, targetIndex, nextMarker.tArrival);
                }
                
                // Update prediction accuracy
                updatePredictionAccuracy(currentTime);
            }
        } else {
            // Miss - target clicked but no marker available
            updateCombo(-getCombo()); // Reset combo
            setLastResult("MISS");
            lastErrMs = 0;
            log('GAME', '🎮 [GAME] ❌ Miss - target clicked but no marker available');
        }
    } else {
        // Miss - no valid target clicked
        updateCombo(-getCombo()); // Reset combo
        setLastResult("MISS");
        lastErrMs = 0;
        log('GAME', '🎮 [GAME] ❌ Miss - no valid target clicked');
    }
}

// Helper function to get click/touch position relative to canvas
function getCanvasPosition(event) {
    if (!inputCanvas) return [0, 0];
    const rect = inputCanvas.getBoundingClientRect();
    const x = (event.clientX || event.touches?.[0]?.clientX || event.changedTouches?.[0]?.clientX) - rect.left;
    const y = (event.clientY || event.touches?.[0]?.clientY || event.changedTouches?.[0]?.clientY) - rect.top;
    return [x, y];
}

// Initialize input handlers (called from game.js)
function initializeInputHandlers() {
    if (!inputCanvas) return;
    
    // Mouse handlers for sustained beats (click and drag)
    inputCanvas.addEventListener('mousedown', (event) => {
        const [mouseX, mouseY] = getCanvasPosition(event);
        hitTarget(null, mouseX, mouseY);
    });
    
    inputCanvas.addEventListener('mousemove', (event) => {
        if (mouseDragActive && mouseDragSustain !== null) {
            const [mouseX, mouseY] = getCanvasPosition(event);
            const activeSustainedInputs = getActiveSustainedInputs();
            const sustainInput = activeSustainedInputs.get(mouseDragSustain);
            if (sustainInput) {
                // Update current position for drag tracking
                sustainInput.inputData.currentX = mouseX;
                sustainInput.inputData.currentY = mouseY;
                
                // Check if we're dragging toward the middle target
                const targets = getTargets();
                const middleTarget = targets[1];
                const dx = mouseX - middleTarget.x;
                const dy = mouseY - middleTarget.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const yellowRadius = getYellowRadius();
                
                // If we're near the middle target and the end marker has arrived, complete the sustain
                if (distance <= yellowRadius && now() >= sustainInput.endMarker.tArrival) {
                    hitTarget(null, mouseX, mouseY);
                }
            }
        }
    });
    
    inputCanvas.addEventListener('mouseup', (event) => {
        if (mouseDragActive && mouseDragSustain !== null) {
            const [mouseX, mouseY] = getCanvasPosition(event);
            const activeSustainedInputs = getActiveSustainedInputs();
            const sustainInput = activeSustainedInputs.get(mouseDragSustain);
            if (sustainInput) {
                // Check if we're releasing on the middle target
                const targets = getTargets();
                const middleTarget = targets[1];
                const dx = mouseX - middleTarget.x;
                const dy = mouseY - middleTarget.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const yellowRadius = getYellowRadius();
                
                if (distance <= yellowRadius && now() >= sustainInput.endMarker.tArrival) {
                    // Complete the sustain
                    hitTarget(null, mouseX, mouseY);
                }
            }
            mouseDragActive = false;
            mouseDragSustain = null;
        }
    });
    
    // Touch event handlers for sustained beats (2-finger support)
    inputCanvas.addEventListener('touchstart', (event) => {
        event.preventDefault();
        const currentTime = now();
        const targets = getTargets();
        const activeSustainedInputs = getActiveSustainedInputs();
        
        // Process all touches
        for (let i = 0; i < event.touches.length; i++) {
            const touch = event.touches[i];
            const [touchX, touchY] = getCanvasPosition(touch);
            
            // Find which target this touch is near
            const yellowRadius = getYellowRadius();
            let targetIndex = null;
            for (let j = 0; j < targets.length; j++) {
                const target = targets[j];
                const dx = touchX - target.x;
                const dy = touchY - target.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance <= yellowRadius) {
                    targetIndex = j;
                    break;
                }
            }
            
            // Store touch position
            touchPositions.set(touch.identifier, {
                x: touchX,
                y: touchY,
                targetIndex: targetIndex
            });
            
            // If this is a side target (0 or 2), try to hit it (might be start of sustained beat)
            if (targetIndex === 0 || targetIndex === 2) {
                hitTarget(null, touchX, touchY, 'touch');
            } else if (targetIndex === 1) {
                // Middle target - check if this is completing a sustained beat
                // Look for active sustained inputs that need a second touch
                for (const [pairId, sustainInput] of activeSustainedInputs.entries()) {
                    if (sustainInput.inputType === 'touch' && 
                        sustainInput.inputData.touchId1 !== undefined &&
                        sustainInput.inputData.touchId2 === undefined &&
                        currentTime >= sustainInput.endMarker.tArrival) {
                        // This is the second touch for a two-finger sustain
                        sustainInput.inputData.touchId2 = touch.identifier;
                        sustainInput.inputData.touch2Data = { x: touchX, y: touchY };
                        touchActiveSustains.set(touch.identifier, pairId);
                        // Complete the sustain
                        hitTarget(null, touchX, touchY);
                        break;
                    }
                }
            }
        }
    });
    
    inputCanvas.addEventListener('touchmove', (event) => {
        event.preventDefault();
        const targets = getTargets();
        const activeSustainedInputs = getActiveSustainedInputs();
        
        // Update touch positions
        for (let i = 0; i < event.touches.length; i++) {
            const touch = event.touches[i];
            const [touchX, touchY] = getCanvasPosition(touch);
            
            const touchData = touchPositions.get(touch.identifier);
            if (touchData) {
                touchData.x = touchX;
                touchData.y = touchY;
                
                // Check if this touch is part of an active sustain
                const sustainId = touchActiveSustains.get(touch.identifier);
                if (sustainId) {
                    const sustainInput = activeSustainedInputs.get(sustainId);
                    if (sustainInput) {
                        // Update touch data in sustain input
                        if (sustainInput.inputData.touchId1 === touch.identifier) {
                            sustainInput.inputData.touch1Data = { x: touchX, y: touchY };
                        } else if (sustainInput.inputData.touchId2 === touch.identifier) {
                            sustainInput.inputData.touch2Data = { x: touchX, y: touchY };
                        }
                        
                        // Check if we're near the middle target and end marker has arrived
                        const middleTarget = targets[1];
                        const dx = touchX - middleTarget.x;
                        const dy = touchY - middleTarget.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const yellowRadius = getYellowRadius();
                        
                        if (distance <= yellowRadius && now() >= sustainInput.endMarker.tArrival) {
                            hitTarget(null, touchX, touchY);
                        }
                    }
                }
            }
        }
    });
    
    inputCanvas.addEventListener('touchend', (event) => {
        event.preventDefault();
        const targets = getTargets();
        const activeSustainedInputs = getActiveSustainedInputs();
        
        // Clean up ended touches
        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            const touchId = touch.identifier;
            
            // Check if this touch was part of a sustain
            const sustainId = touchActiveSustains.get(touchId);
            if (sustainId) {
                const sustainInput = activeSustainedInputs.get(sustainId);
                if (sustainInput) {
                    const [touchX, touchY] = getCanvasPosition(touch);
                    
                    // Check if we're releasing on the middle target
                    const middleTarget = targets[1];
                    const dx = touchX - middleTarget.x;
                    const dy = touchY - middleTarget.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const yellowRadius = getYellowRadius();
                    
                    if (distance <= yellowRadius && now() >= sustainInput.endMarker.tArrival) {
                        hitTarget(null, touchX, touchY);
                    }
                }
                
                touchActiveSustains.delete(touchId);
            }
            
            touchPositions.delete(touchId);
        }
    });
    
    // Keyboard handler for sustained beats
    // Left (0): A or ArrowLeft - can be single beat or start of sustained beat
    // Right (2): D or ArrowRight - can be single beat or start of sustained beat
    window.addEventListener('keydown', (event) => {
        const key = event.key.toLowerCase();
        let targetIndex = null;
        
        if (key === 'a' || event.code === 'ArrowLeft') {
            targetIndex = 0; // Left
            if (!leftKeyHeld) {
                leftKeyHeld = true;
                hitTarget(targetIndex);
            }
        } else if (key === 'd' || event.code === 'ArrowRight') {
            targetIndex = 2; // Right
            if (!rightKeyHeld) {
                rightKeyHeld = true;
                hitTarget(targetIndex);
            }
        }
    });
    
    // Handle keyup for sustained beats
    window.addEventListener('keyup', (event) => {
        const key = event.key.toLowerCase();
        const activeSustainedInputs = getActiveSustainedInputs();
        
        if (key === 'a' || event.code === 'ArrowLeft') {
            if (leftKeyHeld) {
                leftKeyHeld = false;
                // If we're holding a sustained beat, check if we should complete it
                if (leftKeyActiveSustain !== null) {
                    const sustainInput = activeSustainedInputs.get(leftKeyActiveSustain);
                    if (sustainInput) {
                        const currentTime = now();
                        // If we've passed the end marker arrival time, the sustain should already be completed
                        // Otherwise, we're releasing early (which is fine - the end marker will handle scoring)
                        // Just clean up the tracking
                        if (currentTime < sustainInput.endMarker.tArrival) {
                            // Released early - will be handled when end marker arrives or times out
                        }
                    }
                }
                leftKeyActiveSustain = null;
            }
        } else if (key === 'd' || event.code === 'ArrowRight') {
            if (rightKeyHeld) {
                rightKeyHeld = false;
                // Same logic as left key
                if (rightKeyActiveSustain !== null) {
                    const sustainInput = activeSustainedInputs.get(rightKeyActiveSustain);
                    if (sustainInput) {
                        const currentTime = now();
                        if (currentTime < sustainInput.endMarker.tArrival) {
                            // Released early
                        }
                    }
                }
                rightKeyActiveSustain = null;
            }
        }
    });
}

