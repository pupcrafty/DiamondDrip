// -----------------------------
// Legacy Beat Detector - For older iOS and browsers
// -----------------------------
// Uses simple frequency analysis without AudioWorklet for maximum compatibility

class LegacyBeatDetector {
    constructor() {
        this.audioCtx = null;
        this.analyser = null;
        this.source = null;
        this.stream = null;
        this.isRunning = false;
        this.animationFrameId = null;
        
        // Beat detection parameters
        this.history = [];
        this.historySize = 43; // ~1 second at 60fps
        this.sensitivity = 1.3;
        this.freqData = null;
        
        // Statistics
        this.stats = {
            currentEnergy: 0,
            averageEnergy: 0,
            beatCount: 0,
            lastBeatTime: 0,
            previousBeatTime: 0,
            beatsPerMinute: 0
        };
        
        // Callbacks
        this.onBeatCallback = null;
        this.onUpdateCallback = null;
    }
    
    // Initialize AudioContext with fallback for older browsers
    initAudioContext() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            throw new Error('Web Audio API not supported in this browser');
        }
        
        this.audioCtx = new AudioContextClass();
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.8;
        
        this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    }
    
    // Get user media with fallback for older browsers
    async getUserMedia(constraints) {
        console.log('Attempting to get user media with constraints:', constraints);
        console.log('Available APIs:', {
            'navigator.mediaDevices': !!navigator.mediaDevices,
            'navigator.mediaDevices.getUserMedia': !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
            'navigator.getUserMedia': !!navigator.getUserMedia,
            'navigator.webkitGetUserMedia': !!navigator.webkitGetUserMedia,
            'navigator.mozGetUserMedia': !!navigator.mozGetUserMedia,
            'navigator.msGetUserMedia': !!navigator.msGetUserMedia
        });
        
        // Check for modern API first
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            console.log('Using navigator.mediaDevices.getUserMedia');
            try {
                return await navigator.mediaDevices.getUserMedia(constraints);
            } catch (error) {
                console.error('navigator.mediaDevices.getUserMedia failed:', error);
                throw error;
            }
        }
        
        // Fallback for older browsers (Safari, older Chrome, etc.)
        const getUserMedia = navigator.getUserMedia || 
                            navigator.webkitGetUserMedia || 
                            navigator.mozGetUserMedia || 
                            navigator.msGetUserMedia;
        
        if (getUserMedia) {
            console.log('Using legacy getUserMedia API');
            return new Promise((resolve, reject) => {
                try {
                    getUserMedia.call(navigator, constraints, 
                        (stream) => {
                            console.log('Legacy getUserMedia succeeded');
                            resolve(stream);
                        },
                        (error) => {
                            console.error('Legacy getUserMedia failed:', error);
                            reject(error);
                        }
                    );
                } catch (error) {
                    console.error('Error calling legacy getUserMedia:', error);
                    reject(error);
                }
            });
        }
        
        // Last resort: try to polyfill mediaDevices for Safari
        if (navigator.mediaDevices === undefined) {
            console.log('navigator.mediaDevices is undefined, attempting polyfill');
            navigator.mediaDevices = {};
        }
        
        if (!navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia = function(constraints) {
                const getUserMedia = navigator.getUserMedia || 
                                    navigator.webkitGetUserMedia || 
                                    navigator.mozGetUserMedia || 
                                    navigator.msGetUserMedia;
                
                if (!getUserMedia) {
                    return Promise.reject(new Error('getUserMedia is not supported in this browser'));
                }
                
                return new Promise((resolve, reject) => {
                    getUserMedia.call(navigator, constraints, resolve, reject);
                });
            };
            console.log('Polyfilled navigator.mediaDevices.getUserMedia');
        }
        
        // Try again with polyfilled API
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            console.log('Trying polyfilled navigator.mediaDevices.getUserMedia');
            try {
                return await navigator.mediaDevices.getUserMedia(constraints);
            } catch (error) {
                console.error('Polyfilled getUserMedia failed:', error);
                throw error;
            }
        }
        
        throw new Error('getUserMedia is not supported in this browser. Please use a modern browser or enable microphone access in your browser settings.');
    }
    
    // Start detection from microphone
    async startDetection(onBeat, onUpdate) {
        if (this.isRunning) {
            console.warn('Detection already running');
            return;
        }
        
        this.onBeatCallback = onBeat;
        this.onUpdateCallback = onUpdate;
        
        try {
            // Check for getUserMedia support
            if (!navigator.mediaDevices && !navigator.getUserMedia && 
                !navigator.webkitGetUserMedia && !navigator.mozGetUserMedia) {
                throw new Error('Microphone access is not supported in this browser. Please use a modern browser.');
            }
            
            console.log('Initializing audio context...');
            // Initialize audio context if needed
            if (!this.audioCtx) {
                this.initAudioContext();
            }
            
            console.log('AudioContext state:', this.audioCtx.state);
            
            // Resume audio context (required for some browsers)
            if (this.audioCtx.state === 'suspended') {
                console.log('Resuming AudioContext...');
                await this.audioCtx.resume();
                console.log('AudioContext resumed, state:', this.audioCtx.state);
            }
            
            console.log('Requesting microphone access...');
            // Get microphone input with fallback support
            // Use simple constraints for maximum compatibility
            const constraints = { audio: true };
            
            // Try with advanced constraints first (for modern browsers)
            try {
                this.stream = await this.getUserMedia({ 
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    } 
                });
            } catch (constraintError) {
                // Fallback to simple constraints if advanced ones fail
                console.warn('Advanced audio constraints failed, trying simple constraints:', constraintError);
                this.stream = await this.getUserMedia(constraints);
            }
            
            console.log('Microphone access granted!');
            
            // Connect microphone to analyser
            console.log('Connecting audio stream to analyser...');
            this.source = this.audioCtx.createMediaStreamSource(this.stream);
            this.source.connect(this.analyser);
            
            console.log('Audio stream connected. Starting beat detection...');
            
            // Reset statistics
            this.stats = {
                currentEnergy: 0,
                averageEnergy: 0,
                beatCount: 0,
                lastBeatTime: 0,
                previousBeatTime: 0,
                beatsPerMinute: 0
            };
            this.history = [];
            
            this.isRunning = true;
            this.detectBeat();
            
            console.log('Beat detection started successfully!');
            
        } catch (error) {
            console.error('Error starting detection:', error);
            console.error('Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            
            // Provide more helpful error messages
            let errorMessage = error.message;
            console.error('Error details:', {
                name: error.name,
                message: error.message,
                code: error.code,
                constraint: error.constraint
            });
            
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError' || error.code === 1) {
                errorMessage = 'Microphone permission denied. Please:\n1. Click "Allow" when prompted\n2. Check Safari Settings > Websites > Microphone\n3. Make sure this site has microphone access';
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError' || error.code === 0) {
                errorMessage = 'No microphone found. Please connect a microphone and try again.';
            } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError' || error.code === 2) {
                errorMessage = 'Microphone is already in use by another application.';
            } else if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError' || error.code === 3) {
                errorMessage = 'Microphone constraints could not be satisfied. Trying with simpler settings...';
                // Don't throw, let it try with simple constraints
            } else if (error.message && error.message.includes('not supported')) {
                errorMessage = error.message;
            } else if (error.message && error.message.includes('getUserMedia')) {
                errorMessage = 'Microphone access is not available. Please check your browser settings and try again.';
            }
            
            // If it's a constraint error, don't throw - the fallback will handle it
            if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
                // This should have been caught by the try-catch in the constraints section
                // But if it gets here, re-throw with a helpful message
                throw new Error(errorMessage);
            }
            
            throw new Error(errorMessage);
        }
    }
    
    // Main beat detection loop
    detectBeat() {
        if (!this.isRunning) return;
        
        this.analyser.getByteFrequencyData(this.freqData);
        
        // Sum low frequencies (first ~20 bins) for bass detection
        let bass = 0;
        for (let i = 0; i < 20; i++) {
            bass += this.freqData[i];
        }
        
        // Calculate total energy (all frequencies)
        let totalEnergy = 0;
        for (let i = 0; i < this.freqData.length; i++) {
            totalEnergy += this.freqData[i];
        }
        
        // Update history (rolling average)
        this.history.push(bass);
        if (this.history.length > this.historySize) {
            this.history.shift();
        }
        
        // Calculate average
        const avg = this.history.length > 0 
            ? this.history.reduce((a, b) => a + b, 0) / this.history.length 
            : bass;
        
        // Detect beat
        const isBeat = bass > avg * this.sensitivity;
        const currentTime = this.audioCtx.currentTime;
        
        // Update statistics
        this.stats.currentEnergy = bass;
        this.stats.averageEnergy = avg;
        
        if (isBeat) {
            this.stats.beatCount++;
            this.stats.previousBeatTime = this.stats.lastBeatTime;
            this.stats.lastBeatTime = currentTime;
            
            // Calculate BPM (rough estimate based on time between beats)
            if (this.stats.beatCount > 1 && this.stats.previousBeatTime > 0) {
                const timeSinceLastBeat = currentTime - this.stats.previousBeatTime;
                if (timeSinceLastBeat > 0 && timeSinceLastBeat < 5) {
                    this.stats.beatsPerMinute = 60 / timeSinceLastBeat;
                }
            }
            
            // Call beat callback
            if (this.onBeatCallback) {
                this.onBeatCallback({
                    time: currentTime,
                    energy: bass,
                    average: avg,
                    threshold: avg * this.sensitivity
                });
            }
        }
        
        // Call update callback with current stats
        if (this.onUpdateCallback) {
            this.onUpdateCallback({
                time: currentTime,
                energy: bass,
                average: avg,
                totalEnergy: totalEnergy,
                isBeat: isBeat,
                threshold: avg * this.sensitivity
            });
        }
        
        // Continue loop
        this.animationFrameId = requestAnimationFrame(() => this.detectBeat());
    }
    
    // Stop detection
    stopDetection() {
        this.isRunning = false;
        
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }
        
        // Stop all tracks in the stream
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        this.history = [];
    }
    
    // Get current statistics
    getStats() {
        return { ...this.stats };
    }
    
    // Set sensitivity
    setSensitivity(value) {
        this.sensitivity = Math.max(0.5, Math.min(3.0, value));
    }
    
    // Get sensitivity
    getSensitivity() {
        return this.sensitivity;
    }
}

// Create global instance
const legacyBeatDetector = new LegacyBeatDetector();

