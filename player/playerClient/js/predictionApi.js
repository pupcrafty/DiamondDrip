// -----------------------------
// Prediction Server Integration
// -----------------------------
// Updated to use new /predict_phrase endpoint
const PREDICTION_SERVER_URL = 'https://localhost:8444/predict_phrase'; // Local server
// const PREDICTION_SERVER_URL = 'https://le71czez6a.execute-api.us-east-1.amazonaws.com/production/predict_phrase'; // AWS
let lastPredictionSent = null; // Track last prediction sent to avoid duplicates
let serverIP = null; // Cache the server IP
let currentServerURL = PREDICTION_SERVER_URL; // Track current URL (may switch from localhost to IP)

// Server prediction state
let serverPrediction = null; // Server prediction object
let serverPredictionReady = false; // Boolean flag
let serverOffsetEstimate = 0; // Server time offset in ms
let lastApiCallTime = 0; // Timestamp of last API call
let lastBeatTime = 0; // Track last beat time for "once per beat" cadence

// API failure limiting/circuit breaker state
let consecutiveFailures = 0; // Count of consecutive API call failures
let circuitBreakerOpen = false; // Whether circuit breaker is in "open" state (blocking calls)
let circuitBreakerOpenTime = 0; // When circuit breaker was opened
let lastSuccessTime = 0; // Timestamp of last successful API call
const MAX_CONSECUTIVE_FAILURES = 3; // Open circuit after this many failures
const CIRCUIT_BREAKER_RESET_MS = 10000; // Wait 10 seconds before attempting recovery
const BACKOFF_MULTIPLIER = 2; // Multiply interval by this on failures
const MAX_BACKOFF_INTERVAL_MS = 10000; // Maximum backoff interval (10 seconds)

// Pulse buffer for batching
let pulseBuffer = []; // Array of {t_device_ms, dur_ms, meta}
const MAX_PULSE_BUFFER_SIZE = 100; // Limit buffer size

// Get server IP from current page hostname (if not localhost)
function getServerIP() {
    if (serverIP) {
        return serverIP;
    }
    
    const hostname = window.location.hostname;
    
    // If page was loaded from an IP address (not localhost), use that
    if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
        // Check if it's a valid IP address
        const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (ipPattern.test(hostname)) {
            serverIP = hostname;
            return serverIP;
        }
        // If it's a hostname, use it as-is
        serverIP = hostname;
        return serverIP;
    }
    
    return null;
}

// Replace localhost with server IP in a URL
function replaceLocalhostWithIP(url) {
    const serverIP = getServerIP();
    if (serverIP && url.includes('localhost')) {
        return url.replace(/localhost/g, serverIP);
    }
    return url;
}

// Get the best URL to use (IP if available, otherwise original)
function getBestServerURL(originalUrl) {
    const serverIP = getServerIP();
    if (serverIP && originalUrl.includes('localhost')) {
        return replaceLocalhostWithIP(originalUrl);
    }
    return originalUrl;
}

// Convert server time to local time
function convertServerTimeToLocal(serverTimeMs) {
    return serverTimeMs - serverOffsetEstimate;
}

// Convert local time to server time
function convertLocalTimeToServer(localTimeMs) {
    return localTimeMs + serverOffsetEstimate;
}

// Handle server prediction response
// Returns true if successful, false if invalid response
function handleServerPredictionResponse(data, requestTime) {
    if (data.status === 'success' && data.phrase_start_server_ms !== undefined) {
        // Update server prediction
        serverPrediction = {
            phrase_start_server_ms: data.phrase_start_server_ms,
            bpm: data.bpm,
            slot_ms: data.slot_ms,
            slots_per_beat: data.slots_per_beat || 32,
            phrase_beats: data.phrase_beats || 4,
            onset: data.onset || [],
            dur_slots: data.dur_slots || [],
            confidence: data.confidence || [],
            received_at: requestTime
        };
        
        // Update server time offset estimate
        const serverTimeNow = data.phrase_start_server_ms;
        const localTimeNow = requestTime;
        const oldOffset = serverOffsetEstimate;
        serverOffsetEstimate = serverTimeNow - localTimeNow;
        
        // Mark server prediction as ready
        serverPredictionReady = true;
        
        // Clear pulse buffer after successful send
        pulseBuffer = [];
        
        // Update last API call time
        lastApiCallTime = requestTime;
        
        // Reset failure tracking on success
        consecutiveFailures = 0;
        circuitBreakerOpen = false;
        lastSuccessTime = requestTime;
        
        // Count onsets in prediction
        const onsetCount = data.onset?.filter(v => v > 0.5).length || 0;
        
        log('INTEGRATION', '[INTEGRATION] ✅ Server prediction stored:', {
            bpm: data.bpm?.toFixed(1),
            phraseStart: data.phrase_start_server_ms,
            slotMs: data.slot_ms?.toFixed(2),
            onsetCount: onsetCount,
            offsetEstimate: serverOffsetEstimate.toFixed(1) + 'ms',
            offsetChange: (serverOffsetEstimate - oldOffset).toFixed(1) + 'ms'
        });
        
        log('GAME', `🎮 [GAME] ✅ Server prediction received (BPM: ${data.bpm?.toFixed(1)}, Phrase start: ${data.phrase_start_server_ms})`);
        
        // Track in outline
        if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
            GAME_LOOP_OUTLINE.onServerPredictionReceived(serverPrediction);
        }
        
        return true; // Success
    } else {
        log('INTEGRATION', '[INTEGRATION] ⚠️ Invalid server prediction response:', {
            status: data.status,
            hasPhraseStart: data.phrase_start_server_ms !== undefined,
            error: data.message || 'Unknown error'
        });
        return false; // Failure
    }
}

// Request server prediction with batched pulse data
async function requestServerPrediction() {
    try {
        const now = performance.now();
        const client_now_ms = now;
        
        // Check circuit breaker state
        if (circuitBreakerOpen) {
            // Check if enough time has passed to attempt recovery
            const timeSinceOpen = now - circuitBreakerOpenTime;
            if (timeSinceOpen < CIRCUIT_BREAKER_RESET_MS) {
                // Still in backoff period, skip this call
                const remainingMs = CIRCUIT_BREAKER_RESET_MS - timeSinceOpen;
                log('INTEGRATION', `[INTEGRATION] 🔒 Circuit breaker open, skipping API call (retry in ${(remainingMs/1000).toFixed(1)}s)`);
                return Promise.resolve(); // Return resolved promise when skipped
            } else {
                // Try recovery - move to half-open state
                log('INTEGRATION', '[INTEGRATION] 🔄 Attempting circuit breaker recovery...');
                circuitBreakerOpen = false;
            }
        }
        
        // Note: Minimum interval check is handled by checkAndRequestPredictionIfNeeded()
        // This function is called only when a request is actually needed
        
        const hyperBPM = BPM_ESTIMATOR.getHyperSmoothedBPM();
        
        // Get BPM history (last 10 values)
        const bpmHistory = BPM_ESTIMATOR.getHyperSmoothedBPMHistory();
        const recentBpmHistory = bpmHistory.slice(-10);
        
        // Get recent pulse patterns (last 5 phrases) - 32-slot patterns
        const allPhrasePatterns = RHYTHM_PREDICTOR.getPhrasePatterns();
        const recentPulsePatterns = allPhrasePatterns.slice(-5);
        
        // Get recent pulse durations in slots (last 5 phrases)
        const allPhraseDurations = RHYTHM_PREDICTOR.getPhraseDurations();
        const recentPulseDurationsSlots = allPhraseDurations.slice(-5);
        
        // Extract timestamps and durations from pulse buffer
        const recentPulseTimestamps = pulseBuffer.map(p => p.t_device_ms);
        const recentPulseDurations = pulseBuffer.map(p => p.dur_ms);
        
        // Prepare payload for /predict_phrase endpoint
        const payload = {
            client_now_ms: client_now_ms,
            server_offset_estimate_ms: serverOffsetEstimate,
            recentPulseTimestamps: recentPulseTimestamps,
            recentPulseDurations: recentPulseDurations,
            recentPulsePatterns: recentPulsePatterns,
            recentPulseDurationsSlots: recentPulseDurationsSlots,
            currentBPM: hyperBPM,
            bpmHistory: recentBpmHistory,
            device_id: 'client', // TODO: Get actual device ID
            sequence_id: Date.now()
        };
        
        // Use currentServerURL which may have been updated to use IP instead of localhost
        const urlToUse = getBestServerURL(currentServerURL);
        
        // Log API request
        log('INTEGRATION', '[INTEGRATION] 📡 Sending prediction request:', {
            url: urlToUse,
            bpm: hyperBPM?.toFixed(1),
            pulseCount: recentPulseTimestamps.length,
            patternCount: recentPulsePatterns.length,
            bufferSize: pulseBuffer.length,
            sequenceId: payload.sequence_id
        });
        
        // Track in outline
        if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
            GAME_LOOP_OUTLINE.onApiCallStart(payload);
        }
        
        const requestStartTime = performance.now();
        
        // Send request
        const response = await fetch(urlToUse, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });
        
        const requestDuration = performance.now() - requestStartTime;
        
        if (!response.ok) {
            // Increment failure counter
            consecutiveFailures++;
            
            log('INTEGRATION', '[INTEGRATION] ⚠️ API request failed:', {
                status: response.status,
                statusText: response.statusText,
                url: urlToUse,
                duration: requestDuration.toFixed(1) + 'ms',
                consecutiveFailures: consecutiveFailures,
                maxFailures: MAX_CONSECUTIVE_FAILURES
            });
            
            // Track error in outline
            if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
                GAME_LOOP_OUTLINE.onApiCallError(new Error(`HTTP ${response.status}: ${response.statusText}`), requestDuration);
            }
            
            // Try IP if localhost failed
            let retrySucceeded = false;
            if (urlToUse.includes('localhost') && getServerIP()) {
                const ipUrl = replaceLocalhostWithIP(urlToUse);
                if (ipUrl !== urlToUse) {
                    log('INTEGRATION', '[INTEGRATION] 🔄 Retrying with IP address:', ipUrl);
                    currentServerURL = ipUrl;
                    try {
                        const retryResponse = await fetch(ipUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(payload)
                        });
                    if (retryResponse.ok) {
                        const data = await retryResponse.json();
                        retrySucceeded = handleServerPredictionResponse(data, now);
                        } else {
                            log('INTEGRATION', '[INTEGRATION] ⚠️ Retry also failed:', retryResponse.status);
                            if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
                                GAME_LOOP_OUTLINE.onApiCallError(new Error(`Retry failed: HTTP ${retryResponse.status}`), requestDuration);
                            }
                        }
                    } catch (retryError) {
                        log('INTEGRATION', '[INTEGRATION] ⚠️ Retry threw error:', retryError);
                    }
                }
            }
            
            // If retry didn't succeed, check if we should open circuit breaker
            if (!retrySucceeded) {
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    circuitBreakerOpen = true;
                    circuitBreakerOpenTime = now;
                    log('INTEGRATION', `[INTEGRATION] 🚨 Circuit breaker OPENED after ${consecutiveFailures} consecutive failures. API calls paused for ${CIRCUIT_BREAKER_RESET_MS/1000}s`);
                }
            } else {
                // Retry succeeded, reset failures
                consecutiveFailures = 0;
                circuitBreakerOpen = false;
                lastSuccessTime = now;
            }
            return;
        }
        
        const data = await response.json();
        log('INTEGRATION', '[INTEGRATION] ✅ API response received:', {
            status: data.status,
            duration: requestDuration.toFixed(1) + 'ms',
            hasPrediction: data.phrase_start_server_ms !== undefined,
            bpm: data.bpm?.toFixed(1)
        });
        
        // Track completion in outline
        if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
            GAME_LOOP_OUTLINE.onApiCallComplete(data, requestDuration);
        }
        
        const success = handleServerPredictionResponse(data, now);
        
        // If response was invalid, treat as failure
        if (!success) {
            consecutiveFailures++;
            log('INTEGRATION', '[INTEGRATION] ⚠️ Invalid API response treated as failure:', {
                consecutiveFailures: consecutiveFailures,
                maxFailures: MAX_CONSECUTIVE_FAILURES
            });
            
            // Check if we should open circuit breaker
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                circuitBreakerOpen = true;
                circuitBreakerOpenTime = now;
                console.error(`[INTEGRATION] 🚨 Circuit breaker OPENED after ${consecutiveFailures} consecutive failures. API calls paused for ${CIRCUIT_BREAKER_RESET_MS/1000}s`);
            }
        }
        
    } catch (error) {
        // Increment failure counter on exception
        consecutiveFailures++;
        
        log('INTEGRATION', '[INTEGRATION] ❌ Error requesting server prediction:', error, {
            consecutiveFailures: consecutiveFailures,
            maxFailures: MAX_CONSECUTIVE_FAILURES
        });
        
        if (typeof GAME_LOOP_OUTLINE !== 'undefined') {
            GAME_LOOP_OUTLINE.onApiCallError(error, 0);
        }
        
        // Check if we should open circuit breaker
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            circuitBreakerOpen = true;
            circuitBreakerOpenTime = performance.now();
            console.error(`[INTEGRATION] 🚨 Circuit breaker OPENED after ${consecutiveFailures} consecutive failures. API calls paused for ${CIRCUIT_BREAKER_RESET_MS/1000}s`);
        }
    }
}

// On-demand prediction request system
let predictionRequestInProgress = false; // Guard to prevent concurrent requests
const PREDICTION_BUFFER_TIME_MS = 3000; // Request new prediction 3 seconds before current one expires
const MIN_REQUEST_INTERVAL_MS = 1000; // Minimum time between requests (1 second)

// Check if we need a new prediction and request it if needed
// This should be called from the game loop periodically
function checkAndRequestPredictionIfNeeded() {
    // Don't make concurrent requests
    if (predictionRequestInProgress) {
        return;
    }
    
    const now = performance.now();
    
    // Check circuit breaker
    if (circuitBreakerOpen) {
        const timeSinceOpen = now - circuitBreakerOpenTime;
        if (timeSinceOpen < CIRCUIT_BREAKER_RESET_MS) {
            // Still in backoff period
            return;
        } else {
            // Try recovery
            log('INTEGRATION', '[INTEGRATION] 🔄 Attempting circuit breaker recovery...');
            circuitBreakerOpen = false;
        }
    }
    
    // Enforce minimum interval between requests
    if (lastApiCallTime > 0 && (now - lastApiCallTime) < MIN_REQUEST_INTERVAL_MS) {
        return; // Too soon since last request
    }
    
    // Check if we need a new prediction
    let needsNewPrediction = false;
    
    if (!serverPrediction || !serverPredictionReady) {
        // No prediction available - request one
        needsNewPrediction = true;
        log('INTEGRATION', '[INTEGRATION] 📡 No prediction available, requesting...');
    } else {
        // Calculate when current prediction expires
        const phraseStartLocalMs = convertServerTimeToLocal(serverPrediction.phrase_start_server_ms);
        const phraseDurationMs = (serverPrediction.phrase_beats || 4) * (60.0 / serverPrediction.bpm) * 1000.0;
        const phraseEndLocalMs = phraseStartLocalMs + phraseDurationMs;
        const timeUntilExpiry = phraseEndLocalMs - now;
        
        // Request new prediction if we're within buffer time of expiration
        if (timeUntilExpiry <= PREDICTION_BUFFER_TIME_MS) {
            needsNewPrediction = true;
            log('INTEGRATION', `[INTEGRATION] 📡 Prediction expiring soon (${(timeUntilExpiry/1000).toFixed(1)}s remaining), requesting new one...`);
        }
    }
    
    if (needsNewPrediction) {
        predictionRequestInProgress = true;
        requestServerPrediction()
            .then(() => {
                predictionRequestInProgress = false;
            })
            .catch(() => {
                predictionRequestInProgress = false;
            });
    }
}

// Send prediction data to server asynchronously
// Legacy function - now redirects to requestServerPrediction
async function sendPredictionData() {
    return requestServerPrediction();
}

// Add pulse to buffer
function addPulseToBuffer(t_device_ms, dur_ms, meta) {
    if (pulseBuffer.length < MAX_PULSE_BUFFER_SIZE) {
        pulseBuffer.push({
            t_device_ms: t_device_ms,
            dur_ms: dur_ms,
            meta: meta || {}
        });
    }
}

// Get server prediction state
function getServerPrediction() {
    return serverPrediction;
}

function isServerPredictionReady() {
    return serverPredictionReady;
}

function getServerOffsetEstimate() {
    return serverOffsetEstimate;
}

