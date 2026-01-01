// -----------------------------
// Logger Module
// -----------------------------
// Simple logging utility for the game with category-based filtering

function log(category, message, ...args) {
    // Get LOG_CONFIG from global scope (defined in config.js)
    // If config.js hasn't loaded yet, enable all logging by default
    const logConfig = typeof window !== 'undefined' && window.LOG_CONFIG ? window.LOG_CONFIG : { 'ENABLE_ALL_LOGGING': true };
    
    // Check if this category is enabled
    const categoryEnabled = logConfig.hasOwnProperty(category) 
        ? logConfig[category] 
        : logConfig.ENABLE_ALL_LOGGING !== false;  // Default to enabled unless explicitly disabled
    
    // Only log if the category is enabled
    if (categoryEnabled) {
        // Log to console with category prefix
        if (args.length > 0) {
            console.log(`[${category}]`, message, ...args);
        } else {
            console.log(`[${category}]`, message);
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = log;
} else {
    window.log = log;
}
