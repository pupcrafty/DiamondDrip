// Config is now in config.js

// -----------------------------
// Helper functions
// -----------------------------
function now() {
    return performance.now() / 1000.0;  // Convert to seconds
}

function clamp01(x) {
    return Math.max(0.0, Math.min(1.0, x));
}

function randomTargetPosition(existingTargets) {
    // Generate a random position that doesn't overlap with existing targets
    const maxAttempts = 50;
    for (let i = 0; i < maxAttempts; i++) {
        const x = Math.floor(Math.random() * (WIDTH - TARGET_RADIUS * 2)) + TARGET_RADIUS;
        const y = Math.floor(Math.random() * (HEIGHT - TARGET_RADIUS * 2)) + TARGET_RADIUS;
        
        // Check if this position overlaps with any existing target
        let overlaps = false;
        for (const target of existingTargets) {
            const dx = x - target.x;
            const dy = y - target.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < MIN_SPACING) {
                overlaps = true;
                break;
            }
        }
        
        if (!overlaps) {
            return [x, y];
        }
    }
    
    // If we couldn't find a non-overlapping position, return center as fallback
    return [WIDTH / 2, HEIGHT / 2];
}

function randomSpawnPosition(targetX, targetY) {
    // Generate a random spawn position on the edge of the screen
    // Prefer opposite side from target for better visual flow
    const side = Math.floor(Math.random() * 4);  // 0=left, 1=right, 2=top, 3=bottom
    
    let x, y;
    if (side === 0) {  // Left edge
        x = -MARKER_RADIUS * 2;
        y = Math.random() * HEIGHT;
    } else if (side === 1) {  // Right edge
        x = WIDTH + MARKER_RADIUS * 2;
        y = Math.random() * HEIGHT;
    } else if (side === 2) {  // Top edge
        x = Math.random() * WIDTH;
        y = -MARKER_RADIUS * 2;
    } else {  // Bottom edge
        x = Math.random() * WIDTH;
        y = HEIGHT + MARKER_RADIUS * 2;
    }
    
    return [x, y];
}

// -----------------------------
// TEMP: Beat sound indicator (will be removed)
// -----------------------------
let audioContext = null;

function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

function createBeepSound(frequency = 800, duration = 0.05) {
    let buffer = null;
    
    return function playBeep() {
        try {
            if (!audioContext) {
                initAudioContext();
            }
            if (!audioContext) return; // Still can't initialize, skip
            
            // Create buffer on first use (after audio context is ready)
            if (!buffer) {
                const sampleRate = audioContext.sampleRate;
                const frames = Math.floor(duration * sampleRate);
                buffer = audioContext.createBuffer(2, frames, sampleRate);
                
                for (let channel = 0; channel < 2; channel++) {
                    const channelData = buffer.getChannelData(channel);
                    for (let i = 0; i < frames; i++) {
                        channelData[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate);
                    }
                }
            }
            
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            source.start();
        } catch (e) {
            // Silently fail if audio can't play (user hasn't interacted yet)
            console.log('Audio not ready yet:', e);
        }
    };
}


// -----------------------------
// Game initialization
// -----------------------------
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// TEMP: Beat sound (will be removed)
const playBeep = createBeepSound(800, 0.05);

let t0 = now();
let beatNumber = -1;  // Track current beat number (-1 means before first beat)
const firstBeatTime = t0 + START_DELAY;

let targets = [];
let markers = [];
let combo = 0;
let lastResult = "";
let lastErrMs = 0;

// TEMP: Track last beat that played sound (will be removed)
let lastSoundedBeat = -2;

// -----------------------------
// Game loop
// -----------------------------
function gameLoop() {
    const t = now();
    
    // Check if we've crossed a beat threshold
    const currentBeat = Math.floor((t - firstBeatTime) / BEAT_INTERVAL);
    if (currentBeat >= 0 && currentBeat > beatNumber) {
        // We've crossed into a new beat
        beatNumber = currentBeat;
        
        // TEMP: Play sound on beat (will be removed)
        if (beatNumber > lastSoundedBeat) {
            playBeep();
            lastSoundedBeat = beatNumber;
        }
        
        // Spawn new target on every beat (builds up to 4, then maintains 4)
        const [x, y] = randomTargetPosition(targets);
        const newTarget = new Target(beatNumber, x, y);
        
        // Calculate spawn and arrival times for marker
        const tSpawn = t;  // Spawn marker at current time
        const tArrival = firstBeatTime + newTarget.beatDisappear * BEAT_INTERVAL;
        
        // Create marker for this target
        const marker = new Marker(newTarget, tSpawn, tArrival);
        newTarget.marker = marker;
        markers.push(marker);
        
        targets.push(newTarget);
    }
    
    // Update markers
    for (const marker of markers) {
        marker.update(t);
    }
    
     // Remove markers that have left the yellow circle or whose target is hit
    const markersToRemove = markers.filter(marker => marker.target.hit || marker.hasLeftYellowCircle());
    for (const marker of markersToRemove) {
        // Remove the associated target as well
        targets = targets.filter(t => t !== marker.target);
    }
    markers = markers.filter(marker => !marker.target.hit && !marker.hasLeftYellowCircle());
    
    // Draw
    ctx.fillStyle = 'rgb(18, 18, 24)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    
    // Draw targets (draw first so markers appear on top)
    for (const target of targets) {
        if (target.hit) {
            ctx.fillStyle = 'rgb(70, 220, 140)';  // Green for hit
            ctx.beginPath();
            ctx.arc(target.x, target.y, TARGET_RADIUS, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Pulse effect based on how close we are to the beat when it should disappear
            let pulseR = TARGET_RADIUS;
            if (beatNumber >= 0) {
                const targetBeatTime = target.getBeatTime(target.beatDisappear, firstBeatTime, BEAT_INTERVAL);
                const dtToBeat = targetBeatTime - t;
                const pulse = Math.exp(-Math.abs(dtToBeat) * 8.0);
                pulseR = TARGET_RADIUS + 8 * pulse;
            }
            
            // Outer pulse ring
            ctx.strokeStyle = 'rgb(80, 150, 255)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(target.x, target.y, pulseR, 0, Math.PI * 2);
            ctx.stroke();
            
            // Main target circle
            ctx.fillStyle = 'rgb(80, 150, 255)';
            ctx.beginPath();
            ctx.arc(target.x, target.y, TARGET_RADIUS, 0, Math.PI * 2);
            ctx.fill();
            
            // Timing window rings (visualize Perfect/Good buffer)
            ctx.strokeStyle = 'rgb(60, 220, 120)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(target.x, target.y, TARGET_RADIUS + (PERFECT_W / GOOD_W) * 30, 0, Math.PI * 2);
            ctx.stroke();
            
            ctx.strokeStyle = 'rgb(220, 200, 60)';
            ctx.beginPath();
            ctx.arc(target.x, target.y, TARGET_RADIUS + 30, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    
    // Draw markers (red circles) - draw after targets so they appear on top
    for (const marker of markers) {
        // Only draw if marker is on screen or near screen (within reasonable bounds)
        if (!marker.target.hit && marker.x > -100 && marker.x < WIDTH + 100 && marker.y > -100 && marker.y < HEIGHT + 100) {
            ctx.fillStyle = 'rgb(220, 70, 70)';  // Red
            ctx.beginPath();
            ctx.arc(marker.x, marker.y, MARKER_RADIUS, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    // UI text
    ctx.fillStyle = 'rgb(230, 230, 240)';
    ctx.font = '28px Arial';
    const info = `BPM: ${BPM} | Beat: ${beatNumber} | Targets: ${targets.length} | Markers: ${markers.length} | Combo: ${combo}`;
    ctx.fillText(info, 20, 30);
    
    if (lastResult) {
        ctx.font = '44px Arial';
        const resultText = lastResult;
        ctx.fillText(resultText, 20, 70);
    }
    
    ctx.font = '28px Arial';
    ctx.fillStyle = 'rgb(170, 170, 190)';
    ctx.fillText('Click on targets to hit them', 20, HEIGHT - 20);
    
    requestAnimationFrame(gameLoop);
}

// -----------------------------
// Event handlers
// -----------------------------
// Initialize audio context on first user interaction (required by browsers)
document.addEventListener('click', () => {
    if (!audioContext) {
        initAudioContext();
    }
});

canvas.addEventListener('click', (event) => {
    if (beatNumber < 0) return;  // Only check if we've started
    
    // Get mouse position relative to canvas
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    // Find the target that was clicked (check if click is within clickable area)
    // Clickable area is the yellow circle (largest ring)
    const yellowRadius = TARGET_RADIUS + 30;
    let clickedTarget = null;
    
    for (const target of targets) {
        if (target.hit || !target.marker) continue;
        
        const dx = mouseX - target.x;
        const dy = mouseY - target.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Check if click is within the yellow circle (clickable area)
        if (distance <= yellowRadius) {
            clickedTarget = target;
            break;  // Click the first target found (in case of overlap)
        }
    }
    
    if (clickedTarget) {
        // Score based on marker position
        const marker = clickedTarget.marker;
        const result = clickedTarget.score(marker.x, marker.y);
        
        clickedTarget.hit = true;
        
        if (result === "MISS") {
            combo = 0;
        } else {
            combo += 1;
        }
        
        lastResult = result;
        lastErrMs = 0;  // No timing error for position-based scoring
        
        // Remove hit target and its marker immediately
        markers = markers.filter(m => m.target !== clickedTarget);
        targets = targets.filter(t => t !== clickedTarget);
    } else {
        // Clicked but didn't hit any target - miss
        combo = 0;
        lastResult = "MISS";
        lastErrMs = 0;
    }
});

// Start the game loop
gameLoop();

