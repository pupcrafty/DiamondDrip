// -----------------------------
// Game Loop Logic
// -----------------------------
// Handles game state updates each frame

function updateGameLogic(t) {
    // Check if we have enough data to start gameplay
    if (typeof checkIfHasEnoughData === 'function') {
        checkIfHasEnoughData();
    }
    
    // Get current markers
    let markers = getMarkers();
    
    // Update marker positions
    for (const marker of markers) {
        if (typeof marker.update === 'function') {
            marker.update(t);
        }
    }
    
    // Remove expired markers (those that have left the yellow circle)
    markers = markers.filter(marker => {
        // Keep markers that haven't been hit and haven't left the yellow circle
        if (marker.hit) {
            return false;
        }
        
        // For sustained beat markers, keep them until the end marker arrives
        if (marker.isSustainedBeatMarker && marker.isSustainedBeatMarker()) {
            const endMarker = marker.pairedMarker && marker.pairedMarker.tArrival > marker.tArrival 
                ? marker.pairedMarker 
                : marker;
            if (t < endMarker.tArrival) {
                return true; // Keep until end marker arrives
            }
        }
        
        // Check if marker has left the yellow circle
        if (typeof marker.hasLeftYellowCircle === 'function') {
            return !marker.hasLeftYellowCircle(t);
        }
        
        // Fallback: keep marker if it's still in bounds
        return marker.x > -100 && marker.x < WIDTH + 100 && 
               marker.y > -100 && marker.y < HEIGHT + 100;
    });
    
    // Update markers array
    setMarkers(markers);
    
    // Update celebration text timer (expire if time has passed)
    const celebrationText = getCelebrationText();
    const celebrationTextTime = getCelebrationTextTime();
    if (celebrationText && celebrationTextTime > 0 && t > celebrationTextTime) {
        setCelebrationText(null, 0);
    }
    
    // Spawn new markers from predictions (if we have enough data)
    if (hasEnoughDataState() && typeof getPredictedBeatTimestamps === 'function') {
        const predictedBeats = getPredictedBeatTimestamps(t);
        const spawnedPredictedBeats = getSpawnedPredictedBeats();
        
        // Filter out beats we've already spawned
        const beatsToSpawn = predictedBeats.filter(beat => {
            const beatKey = `${beat.phraseStart}-${beat.slot}`;
            return !spawnedPredictedBeats.has(beatKey);
        });
        
        // Spawn markers for new predicted beats
        for (const beat of beatsToSpawn) {
            const beatKey = `${beat.phraseStart}-${beat.slot}`;
            spawnedPredictedBeats.add(beatKey);
            
            // Calculate spawn time (slightly before the beat time)
            const spawnTime = beat.time - 0.1; // Spawn 100ms before beat
            
            // Only spawn if spawn time is in the past or very near future
            if (spawnTime <= t + 0.05) {
                spawnMarkerFromPrediction(beat, t);
            }
        }
        
        // Clean up old spawned beat keys (keep only recent ones)
        if (spawnedPredictedBeats.size > 100) {
            const keysToKeep = new Set();
            const recentBeats = predictedBeats.slice(-20).map(beat => `${beat.phraseStart}-${beat.slot}`);
            for (const key of recentBeats) {
                keysToKeep.add(key);
            }
            // Keep only recent keys
            for (const key of spawnedPredictedBeats) {
                if (!keysToKeep.has(key)) {
                    spawnedPredictedBeats.delete(key);
                }
            }
        }
    }
    
    // Update target markers references (link markers to their targets)
    const targets = getTargets();
    for (const target of targets) {
        target.markers = markers.filter(m => m.target === target && !m.hit);
    }
}

// Helper function to spawn a marker from a prediction
function spawnMarkerFromPrediction(beat, currentTime) {
    const targets = getTargets();
    if (targets.length < 3) {
        return; // Need at least 3 targets
    }
    
    const spawnTime = Math.max(currentTime, beat.time - 0.1);
    const arrivalTime = beat.time;
    const holdDuration = 0.1; // Hold at top for 100ms
    
    // Determine target based on beat type
    let targetIndex;
    if (beat.isSustained) {
        // Sustained beats: start at left (0) or right (2), end at middle (1)
        // For now, alternate between left and right for start
        targetIndex = Math.random() < 0.5 ? 0 : 2; // Left or right
    } else {
        // Single beats: randomly choose left (0), middle (1), or right (2)
        targetIndex = Math.floor(Math.random() * 3);
    }
    
    const target = targets[targetIndex];
    const [topX, topY] = getTopSpawnPosition(target.x);
    
    // Calculate fall velocity to arrive at target at arrivalTime
    const fallTime = arrivalTime - (spawnTime + holdDuration);
    if (fallTime <= 0) {
        return; // Invalid timing
    }
    
    const dx = target.x - topX;
    const dy = target.y - topY;
    const fallVx = dx / fallTime;
    const fallVy = dy / fallTime;
    
    if (beat.isSustained && beat.duration > 0) {
        // Create sustained beat marker pair
        const startTarget = target;
        const endTarget = targets[1]; // Middle target for end
        
        const endArrivalTime = arrivalTime + beat.duration;
        const endTopX = topX;
        const endTopY = topY;
        
        // Calculate end marker fall velocity
        const endFallTime = endArrivalTime - (spawnTime + holdDuration);
        if (endFallTime <= 0) {
            return; // Invalid timing
        }
        
        const endDx = endTarget.x - endTopX;
        const endDy = endTarget.y - endTopY;
        const endFallVx = endDx / endFallTime;
        const endFallVy = endDy / endFallTime;
        
        // Create start marker
        const startMarker = new Marker(
            startTarget,
            spawnTime,
            arrivalTime,
            topX,
            topY,
            holdDuration,
            fallVx,
            fallVy,
            beat.duration,
            startTarget,
            null, // Will be set after end marker is created
            true // isStartMarker
        );
        
        // Create end marker
        const endMarker = new Marker(
            endTarget,
            spawnTime,
            endArrivalTime,
            endTopX,
            endTopY,
            holdDuration,
            endFallVx,
            endFallVy,
            beat.duration,
            startTarget,
            startMarker, // pairedMarker
            false // isStartMarker
        );
        
        // Link markers together
        startMarker.pairedMarker = endMarker;
        
        // Add both markers
        const markers = getMarkers();
        markers.push(startMarker, endMarker);
        setMarkers(markers);
    } else {
        // Create single beat marker
        const marker = new Marker(
            target,
            spawnTime,
            arrivalTime,
            topX,
            topY,
            holdDuration,
            fallVx,
            fallVy
        );
        
        // Add marker
        const markers = getMarkers();
        markers.push(marker);
        setMarkers(markers);
    }
}
