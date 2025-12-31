// -----------------------------
// Logger Class
// -----------------------------
class Logger {
    constructor() {
        // Logging Configuration
        // Set to true/false to enable/disable logging categories
        this.LOG_CONFIG = {
            GAME: false,                   // 🎮 Game events (spawning, hits, misses)
            BEAT_DETECTION: false,         // 🎵 Beat detection events
            BEAT_DIAGNOSTIC: false,       // 📊 Beat diagnostic data (verbose)
            BPM_CALCULATION: true,        // 🎯 BPM calculation events
            ENERGY_CLASSIFICATION: true,  // ⚡ Energy level classification
            PREDICTION_INIT: true,        // 🔮 Prediction initialization
            PREDICTION_HYPER: true,       // 🌟 Hyper prediction events
            PULSE_PATTERN: true,          // 🎵 Pulse pattern listening
            SUSTAINED: false,             // 🎵 Sustained beat detection events
            SUSTAINED_PREDICTION: false,  // 🎯 Sustained beat prediction events
            INTEGRATION: false,           // 🔗 Integration/API logging (prediction API calls)
            RENDER: true,                 // 🎨 Render logging (canvas rendering events)
            ERROR: true,                   // ❌ Errors (always recommended to keep on)
            TARGET_SCORES: true            // 📊 Show target scores next to each target
        };
        
        // Category mapping from short names to config keys
        this.categoryMap = {
            'GAME': 'GAME',
            'BEAT': 'BEAT_DETECTION',
            'BEAT_DIAGNOSTIC': 'BEAT_DIAGNOSTIC',
            'BPM': 'BPM_CALCULATION',
            'ENERGY': 'ENERGY_CLASSIFICATION',
            'PREDICTION_INIT': 'PREDICTION_INIT',
            'PREDICTION_HYPER': 'PREDICTION_HYPER',
            'PULSE_PATTERN': 'PULSE_PATTERN',
            'SUSTAINED': 'SUSTAINED',
            'SUSTAINED_PREDICTION': 'SUSTAINED_PREDICTION',
            'INTEGRATION': 'INTEGRATION',
            'RENDER': 'RENDER',
            'RENDERER': 'RENDER',
            'ERROR': 'ERROR'
        };
    }
    
    log(category, ...args) {
        const configKey = this.categoryMap[category] || category;
        
        // Check if this category is enabled
        if (this.LOG_CONFIG[configKey] !== false) {
            console.log(...args);
        }
    }
}

// Create a global logger instance
const logger = new Logger();

// Create a global log function for backward compatibility
function log(category, ...args) {
    logger.log(category, ...args);
}

// Export LOG_CONFIG as a global for backward compatibility
const LOG_CONFIG = logger.LOG_CONFIG;




