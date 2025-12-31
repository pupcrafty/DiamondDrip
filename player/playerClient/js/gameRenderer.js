// -----------------------------
// Game Renderer (Drawing Code)
// -----------------------------

// Canvas and context (will be set by game.js)
let renderCanvas = null;
let renderCtx = null;

function setCanvas(canvasElement, context) {
    renderCanvas = canvasElement;
    renderCtx = context;
}

function renderGame(t) {
    if (!renderCtx || !renderCanvas) {
        console.warn('[RENDERER] Canvas context or canvas element not available, skipping render');
        return;
    }
    
    // Ensure canvas has valid dimensions
    if (!WIDTH || !HEIGHT || WIDTH <= 0 || HEIGHT <= 0 || !isFinite(WIDTH) || !isFinite(HEIGHT)) {
        console.warn('[RENDERER] Invalid canvas dimensions:', WIDTH, 'x', HEIGHT, '- skipping render');
        return;
    }
    
    // Ensure render canvas has matching dimensions
    if (renderCanvas.width !== WIDTH || renderCanvas.height !== HEIGHT) {
        console.log('[RENDERER] Updating canvas dimensions from', renderCanvas.width, 'x', renderCanvas.height, 'to', WIDTH, 'x', HEIGHT);
        renderCanvas.width = WIDTH;
        renderCanvas.height = HEIGHT;
    }
    
    const targets = getTargets();
    const markers = getMarkers();
    const hasEnoughData = hasEnoughDataState();
    const celebrationText = getCelebrationText();
    const celebrationTextTime = getCelebrationTextTime();
    const gameVersion = getGameVersion();
    
    // Draw background
    renderCtx.fillStyle = 'rgb(18, 18, 24)';
    renderCtx.fillRect(0, 0, WIDTH, HEIGHT);
    
    // Draw targets (draw first so markers appear on top)
    for (const target of targets) {
        // Reset hit state if no markers are left
        if (target.hit && target.markers.length === 0) {
            target.hit = false;
        }
        
        if (target.hit) {
            // Show green flash when hit
            renderCtx.fillStyle = 'rgb(70, 220, 140)';  // Green for hit
            renderCtx.beginPath();
            renderCtx.arc(target.x, target.y, TARGET_RADIUS, 0, Math.PI * 2);
            renderCtx.fill();
        } else {
            // Pulse effect based on how close we are to the beat when it should disappear
            const targetScale = (WIDTH + HEIGHT) / 2000;
            let pulseR = TARGET_RADIUS;
            if (target.markers.length > 0 && target.beatDisappear) {
                const dtToBeat = target.beatDisappear - t;
                const pulse = Math.exp(-Math.abs(dtToBeat) * 8.0);
                pulseR = TARGET_RADIUS + Math.round(8 * pulse * targetScale);
            }
            
            // Outer pulse ring (use target color with some transparency)
            renderCtx.strokeStyle = target.color;
            renderCtx.lineWidth = Math.max(1, Math.round(3 * targetScale));
            renderCtx.beginPath();
            renderCtx.arc(target.x, target.y, pulseR, 0, Math.PI * 2);
            renderCtx.stroke();
            
            // Main target circle (use target color)
            renderCtx.fillStyle = target.color;
            renderCtx.beginPath();
            renderCtx.arc(target.x, target.y, TARGET_RADIUS, 0, Math.PI * 2);
            renderCtx.fill();
            
            // Timing window rings (visualize Perfect/Good buffer)
            renderCtx.strokeStyle = 'rgb(60, 220, 120)';
            renderCtx.lineWidth = Math.max(1, Math.round(1 * targetScale));
            renderCtx.beginPath();
            renderCtx.arc(target.x, target.y, TARGET_RADIUS + Math.round((PERFECT_W / GOOD_W) * 30 * targetScale), 0, Math.PI * 2);
            renderCtx.stroke();
            
            renderCtx.strokeStyle = 'rgb(220, 200, 60)';
            renderCtx.beginPath();
            renderCtx.arc(target.x, target.y, TARGET_RADIUS + Math.round(30 * targetScale), 0, Math.PI * 2);
            renderCtx.stroke();
            
            // Show key label if target has markers
            if (target.markers.length > 0 && hasEnoughData) {
                const targetIndex = targets.indexOf(target);
                // Map target indices to keys: Left (A/←), Middle (S/Space), Right (D/→)
                const keyLabels = ['A', 'S', 'D'];
                const keyLabel = keyLabels[targetIndex];
                
                const keyScale = (WIDTH + HEIGHT) / 2000;
                const keyRadius = Math.round(14 * keyScale);
                const keyOffset = Math.round(15 * keyScale);
                const keyFontSize = Math.round(18 * keyScale);
                
                // Draw key label with background for better visibility
                renderCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                renderCtx.beginPath();
                renderCtx.arc(target.x, target.y - TARGET_RADIUS - keyOffset, keyRadius, 0, Math.PI * 2);
                renderCtx.fill();
                
                renderCtx.fillStyle = 'rgb(255, 255, 255)';
                renderCtx.font = `bold ${keyFontSize}px Arial`;
                renderCtx.textAlign = 'center';
                renderCtx.textBaseline = 'middle';
                renderCtx.fillText(keyLabel, target.x, target.y - TARGET_RADIUS - keyOffset);
                renderCtx.textAlign = 'left';
                renderCtx.textBaseline = 'alphabetic';
            }
        }
    }
    
    // Draw markers - draw after targets so they appear on top
    for (const marker of markers) {
        // Only draw if marker hasn't been hit and is on screen or near screen (within reasonable bounds)
        if (!marker.hit && marker.x > -100 && marker.x < WIDTH + 100 && marker.y > -100 && marker.y < HEIGHT + 100) {
            renderCtx.fillStyle = marker.target.color;  // Match target color
            
            // Check if this is a sustained beat marker (has a paired marker)
            if (marker.isSustainedBeatMarker() && marker.pairedMarker) {
                // Draw sustained beat: two markers connected by a line
                const startMarker = marker.tArrival < marker.pairedMarker.tArrival ? marker : marker.pairedMarker;
                const endMarker = marker.tArrival < marker.pairedMarker.tArrival ? marker.pairedMarker : marker;
                
                // Only draw the line if we're processing the start marker (to avoid drawing twice)
                if (marker === startMarker) {
                    // Draw connecting line between the two markers
                    // Always use current positions (whether falling or arrived) so line is visible during entire fall
                    const startX = startMarker.x;
                    const startY = startMarker.y;
                    const endX = endMarker.x;
                    const endY = endMarker.y;
                    
                    // Draw line connecting the two markers with gradient color
                    renderCtx.lineWidth = MARKER_RADIUS * 1.5;
                    renderCtx.lineCap = 'round';
                    
                    // Get colors
                    const startColor = startMarker.target.color; // Red or Blue
                    const endColor = endMarker.target.color; // Green
                    
                    // Parse RGB colors
                    const parseColor = (colorStr) => {
                        const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                        if (match) {
                            return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
                        }
                        return [128, 128, 128];
                    };
                    
                    const [r1, g1, b1] = parseColor(startColor);
                    const [r2, g2, b2] = parseColor(endColor);
                    
                    // Draw line with gradient (multiple segments for smooth color transition)
                    const numSegments = 30;
                    for (let i = 0; i < numSegments; i++) {
                        const segT = i / numSegments;
                        const segT2 = (i + 1) / numSegments;
                        
                        const x1 = startX + (endX - startX) * segT;
                        const y1 = startY + (endY - startY) * segT;
                        const x2 = startX + (endX - startX) * segT2;
                        const y2 = startY + (endY - startY) * segT2;
                        
                        // Interpolate color
                        const r = Math.round(r1 + (r2 - r1) * segT);
                        const g = Math.round(g1 + (g2 - g1) * segT);
                        const b = Math.round(b1 + (b2 - b1) * segT);
                        
                        renderCtx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
                        renderCtx.beginPath();
                        renderCtx.moveTo(x1, y1);
                        renderCtx.lineTo(x2, y2);
                        renderCtx.stroke();
                    }
                }
                
                // Draw the marker itself (circular)
                renderCtx.fillStyle = marker.target.color;
                renderCtx.beginPath();
                renderCtx.arc(marker.x, marker.y, MARKER_RADIUS, 0, Math.PI * 2);
                renderCtx.fill();
            } else {
                // Draw normal circular marker (falling down to target)
                renderCtx.beginPath();
                renderCtx.arc(marker.x, marker.y, MARKER_RADIUS, 0, Math.PI * 2);
                renderCtx.fill();
            }
        }
    }
    
    // UI text - scale font sizes with canvas
    const scale = (WIDTH + HEIGHT) / 2000;  // Scale factor based on average dimension
    const fontSize1 = Math.round(28 * scale);
    const fontSize2 = Math.round(44 * scale);
    const fontSize3 = Math.round(72 * scale);
    const padding = Math.round(20 * scale);
    
    renderCtx.fillStyle = 'rgb(230, 230, 240)';
    renderCtx.font = `${fontSize1}px Arial`;
    
    // Display hypersmoothed BPM
    const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
    const bpmText = hyperBPM !== null && hyperBPM > 0 ? hyperBPM.toFixed(1) : '---';
    const info = `BPM: ${bpmText} | Score: ${getTotalScore()} | Sustain: ${getSustainScore()} | Combo: ${getCombo()}`;
    renderCtx.fillText(info, padding, padding + fontSize1);
    
    const lastResult = getLastResult();
    if (lastResult) {
        renderCtx.font = `${fontSize2}px Arial`;
        const resultText = lastResult;
        renderCtx.fillText(resultText, padding, padding + fontSize1 + fontSize2);
    }
    
    // Display celebration text if active
    if (celebrationText && t < celebrationTextTime) {
        renderCtx.font = `bold ${fontSize3}px Arial`;
        renderCtx.fillStyle = 'rgb(255, 215, 0)';  // Gold color
        renderCtx.textAlign = 'center';
        renderCtx.textBaseline = 'middle';
        
        // Add glow effect with multiple strokes
        renderCtx.strokeStyle = 'rgba(255, 215, 0, 0.8)';
        renderCtx.lineWidth = Math.round(8 * scale);
        renderCtx.strokeText(celebrationText, WIDTH / 2, HEIGHT / 2);
        
        renderCtx.fillText(celebrationText, WIDTH / 2, HEIGHT / 2);
        
        renderCtx.textAlign = 'left';
        renderCtx.textBaseline = 'alphabetic';
    } else if (celebrationText && t >= celebrationTextTime) {
        // Clear celebration text after timeout (handled in gameState)
    }
    
    // Display "listening" text if we don't have enough data (styled like celebration text)
    if (!hasEnoughData) {
        renderCtx.font = `bold ${fontSize3}px Arial`;
        renderCtx.fillStyle = 'rgb(255, 215, 0)';  // Gold color (same as celebration)
        renderCtx.textAlign = 'center';
        renderCtx.textBaseline = 'middle';
        
        // Add glow effect with multiple strokes
        renderCtx.strokeStyle = 'rgba(255, 215, 0, 0.8)';
        renderCtx.lineWidth = Math.round(8 * scale);
        renderCtx.strokeText('listening', WIDTH / 2, HEIGHT / 2);
        
        renderCtx.fillText('listening', WIDTH / 2, HEIGHT / 2);
        
        renderCtx.textAlign = 'left';
        renderCtx.textBaseline = 'alphabetic';
    }
    
    // Display version number in bottom-left corner
    renderCtx.fillStyle = 'rgba(170, 170, 190, 0.8)';
    renderCtx.font = `${Math.round(fontSize1 * 0.7)}px Arial`;
    renderCtx.textAlign = 'left';
    renderCtx.textBaseline = 'bottom';
    renderCtx.fillText(`v${gameVersion}`, padding, HEIGHT - padding);
    renderCtx.textBaseline = 'alphabetic';
}

