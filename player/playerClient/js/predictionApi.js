// -----------------------------
// Prediction API Module
// -----------------------------
// Handles API calls to the prediction server

const PREDICTION_API = (function() {
    // Configuration - can be overridden
    let predictionServerUrl = 'https://localhost:8444/prediction';
    
    // Set the prediction server URL
    function setPredictionServerUrl(url) {
        predictionServerUrl = url;
    }
    
    // Get the prediction server URL
    function getPredictionServerUrl() {
        return predictionServerUrl;
    }
    
    /**
     * Send prediction data to the /prediction endpoint
     * This stores the prediction data in the prediction engine database
     * 
     * @param {Object} data - Prediction data object containing:
     *   - currentBPM: number - Current BPM estimate
     *   - bpmHistory: Array<number> - History of BPM values
     *   - recentPulsePatterns: Array<Array<number>> - Recent pulse patterns
     *   - recentCorrectPredictionParts: Array<Array<number>> - Recent correct prediction parts
     *   - currentPrediction: Array<number> - Current prediction pattern
     *   - timestamp: string - ISO timestamp
     */
    async function sendPredictionData(data) {
        try {
            // Validate required fields
            if (!data || typeof data.currentBPM !== 'number' || !Array.isArray(data.bpmHistory)) {
                console.warn('[PREDICTION_API] Invalid prediction data, skipping API call');
                return;
            }
            
            const url = getPredictionServerUrl();
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                console.warn(`[PREDICTION_API] Failed to send prediction data: ${response.status} ${response.statusText}`);
                return;
            }
            
            const result = await response.json();
            // Optionally log success (but don't spam console)
            if (Math.random() < 0.01) { // Log ~1% of calls to avoid spam
                console.log('[PREDICTION_API] Prediction data sent successfully', {
                    status: result.status,
                    avgBPM: result.avg_bpm_last_20s
                });
            }
            
            return result;
        } catch (error) {
            // Silently handle errors (network issues, server down, etc.)
            // This should not break the game if the API is unavailable
            if (Math.random() < 0.01) { // Log ~1% of errors to avoid spam
                console.warn('[PREDICTION_API] Error sending prediction data:', error.message);
            }
        }
    }
    
    // Public API
    return {
        setPredictionServerUrl: setPredictionServerUrl,
        getPredictionServerUrl: getPredictionServerUrl,
        sendPredictionData: sendPredictionData
    };
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PREDICTION_API;
} else {
    window.PREDICTION_API = PREDICTION_API;
}
