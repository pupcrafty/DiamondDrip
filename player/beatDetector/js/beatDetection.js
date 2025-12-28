// -----------------------------
// Beat Detection Module
// -----------------------------
// This module provides functions to initialize and use beat detection
// The AudioWorklet processor code is in beat-worklet.js

let audioCtx = null;
let beatNode = null;
let stream = null;
let src = null;
let messageHandler = null; // Store handler reference for cleanup

/**
 * Initialize beat detection with microphone input
 * @param {Function} onBeat - Callback function called when a beat is detected: (time, rms, threshold, avg) => void
 * @param {Function} onDiagnostic - Optional callback for diagnostic data: (data) => void
 * @returns {Promise<void>}
 */
async function initBeatDetection(onBeat, onDiagnostic = null) {
    // Clean up any existing beat detection before initializing new one
    stopBeatDetection();
    
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    log('BEAT', '🎵 [BEAT] AudioContext created, initial state:', audioCtx.state);
    
    // Determine worklet path based on current document location
    // Paths are relative to the HTML document, not the script file
    const workletPath = window.location.pathname.includes('/beatDetector/') 
        ? 'js/beat-worklet.js' 
        : '../beatDetector/js/beat-worklet.js';
    await audioCtx.audioWorklet.addModule(workletPath);

    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    log('BEAT', '🎵 [BEAT] getUserMedia granted, AudioContext state:', audioCtx.state);
    
    // Resume AudioContext if suspended (after getUserMedia we have user interaction context)
    if (audioCtx.state === 'suspended') {
        log('BEAT', '🎵 [BEAT] AudioContext is suspended, attempting to resume...');
        try {
            await audioCtx.resume();
            log('BEAT', '🎵 [BEAT] AudioContext resumed, state:', audioCtx.state);
        } catch (error) {
            console.warn('🎵 [BEAT] Could not resume AudioContext:', error);
        }
    }
    
    src = audioCtx.createMediaStreamSource(stream);

    beatNode = new AudioWorkletNode(audioCtx, 'beat-detector', {
        numberOfInputs: 1,
        numberOfOutputs: 0
    });

    // Use addEventListener instead of onmessage property (recommended for AudioWorklet)
    // Execute callbacks asynchronously to avoid blocking the message handler
    messageHandler = (e) => {
        try {
            // Debug: log all messages to see what's coming through
            if (e.data && e.data.type) {
                if (e.data.type === 'beat') {
                    log('BEAT', '🎵 [BEAT] Beat detected:', e.data.time, 'RMS:', e.data.rms);
                    if (onBeat) {
                        // Execute callback asynchronously to prevent blocking
                        queueMicrotask(() => {
                            try {
                                onBeat(e.data.time, e.data.rms, e.data.threshold, e.data.avg);
                            } catch (error) {
                                console.error('Error in onBeat callback:', error);
                            }
                        });
                    }
                } else if (e.data.type === 'diagnostic') {
                    // Only log diagnostic messages occasionally to avoid spam (every 10th message)
                    if (!messageHandler._diagnosticCount) messageHandler._diagnosticCount = 0;
                    messageHandler._diagnosticCount++;
                    if (messageHandler._diagnosticCount % 10 === 0) {
                        log('BEAT_DIAGNOSTIC', '📊 [BEAT] Diagnostic:', 'RMS:', e.data.rms.toFixed(4), 'Time:', e.data.time.toFixed(2));
                    }
                    if (onDiagnostic) {
                        // Execute callback asynchronously to prevent blocking
                        queueMicrotask(() => {
                            try {
                                onDiagnostic(e.data);
                            } catch (error) {
                                console.error('Error in onDiagnostic callback:', error);
                            }
                        });
                    }
                } else {
                    console.warn('Unknown message type:', e.data.type);
                }
            } else {
                console.warn('Message without type:', e.data);
            }
        } catch (error) {
            // Handle errors in message handlers to prevent port closure issues
            console.error('Error in beat detection message handler:', error);
        }
    };
    
    beatNode.port.addEventListener('message', messageHandler);
    
    // Start the port to enable message passing
    beatNode.port.start();
    
    log('BEAT', '🎵 [BEAT] AudioWorklet node created, port started, waiting for messages...');

    // Monitor AudioContext state changes
    audioCtx.addEventListener('statechange', () => {
        log('BEAT', '🎵 [BEAT] AudioContext state changed to:', audioCtx.state);
        if (audioCtx.state === 'suspended') {
            console.warn('🎵 [BEAT] ⚠️ AudioContext was suspended - audio processing has stopped!');
        }
    });
    
    src.connect(beatNode);
    
    log('BEAT', '🎵 [BEAT] Media stream source connected to AudioWorklet node');
    log('BEAT', '🎵 [BEAT] AudioContext state:', audioCtx.state);
    log('BEAT', '🎵 [BEAT] Sample rate:', audioCtx.sampleRate);
    
    // Final check - ensure AudioContext is running
    if (audioCtx.state !== 'running') {
        console.warn('🎵 [BEAT] ⚠️ AudioContext is not running! State:', audioCtx.state);
        console.warn('🎵 [BEAT] ⚠️ Audio processing will not work until AudioContext is resumed (requires user interaction)');
    } else {
        log('BEAT', '🎵 [BEAT] ✅ AudioContext is running - audio processing should start soon');
    }
}

/**
 * Stop beat detection and clean up resources
 */
function stopBeatDetection() {
    // Close the port first to prevent message channel errors
    if (beatNode && beatNode.port && messageHandler) {
        beatNode.port.removeEventListener('message', messageHandler);
        messageHandler = null;
        beatNode.port.close(); // Close the port
    }
    if (beatNode) {
        beatNode.disconnect();
        beatNode = null;
    }
    if (src) {
        src.disconnect();
        src = null;
    }
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    if (audioCtx) {
        audioCtx.close().catch(err => {
            // Ignore errors when closing audio context
            console.warn('Error closing audio context:', err);
        });
        audioCtx = null;
    }
}

// Export functions if using modules, otherwise attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initBeatDetection, stopBeatDetection };
} else {
    window.beatDetection = { initBeatDetection, stopBeatDetection };
}