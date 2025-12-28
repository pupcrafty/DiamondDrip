// -----------------------------
// Energy Level Classifier Module
// -----------------------------
// Handles energy level clustering and classification

const ENERGY_CLASSIFIER = (function() {
    // Constants
    const CLUSTER_UPDATE_INTERVAL = 60; // Update clusters every 60 seconds
    const MAX_RMS_SAMPLES = 6000; // Keep ~100 samples per second for 60 seconds
    const TEMPORAL_AVG_ALPHA = 0.05; // Smoothing factor for temporal average (lower = more smoothing, slower response)
    const ENERGY_RANGE_OVERLAP = 0.25; // 25% overlap in ranges (each range extends 25% beyond its center in both directions)
    const LEVEL_HYSTERESIS = 0.15; // 15% hysteresis - requires 15% change to switch levels (reduces bouncing)

    // State
    let rmsSamples = []; // Store RMS values over time
    let energyLevelAverages = [0, 0, 0, 0, 0]; // Average energy for each of 5 clusters
    let currentEnergyLevel = 0; // Current energy level (1-5)
    let lastEnergyLevel = 0; // Previous energy level for hysteresis
    let lastClusterUpdateTime = 0;
    let temporalRmsAverage = null; // Local temporal average of RMS for classification
    let pulseThreshold = null; // Threshold for detecting pulses (based on energy level averages)
    let hasLoggedEnergyClusters = false; // Track if we've logged first energy clusters
    let hasLoggedEnergyLevel = false; // Track if we've logged first energy level classification

    function updateEnergyClusters() {
        if (rmsSamples.length < 50) {
            // Not enough samples yet for clustering
            return;
        }
        
        // Simple k-means clustering into 5 groups
        // Initialize cluster centers using percentiles
        const sorted = [...rmsSamples].sort((a, b) => a - b);
        const n = sorted.length;
        let centers = [
            sorted[Math.floor(n * 0.1)],  // 10th percentile
            sorted[Math.floor(n * 0.3)],  // 30th percentile
            sorted[Math.floor(n * 0.5)],  // 50th percentile (median)
            sorted[Math.floor(n * 0.7)],  // 70th percentile
            sorted[Math.floor(n * 0.9)]   // 90th percentile
        ];
        
        // Simple k-means iteration (3-5 iterations should be enough)
        for (let iter = 0; iter < 5; iter++) {
            // Assign samples to nearest cluster
            const clusters = [[], [], [], [], []]; // 5 clusters
            
            for (const sample of rmsSamples) {
                let minDist = Infinity;
                let closestCluster = 0;
                for (let i = 0; i < 5; i++) {
                    const dist = Math.abs(sample - centers[i]);
                    if (dist < minDist) {
                        minDist = dist;
                        closestCluster = i;
                    }
                }
                clusters[closestCluster].push(sample);
            }
            
            // Update cluster centers (average of each cluster)
            let changed = false;
            for (let i = 0; i < 5; i++) {
                if (clusters[i].length > 0) {
                    const newCenter = clusters[i].reduce((a, b) => a + b, 0) / clusters[i].length;
                    if (Math.abs(newCenter - centers[i]) > 0.0001) {
                        changed = true;
                    }
                    centers[i] = newCenter;
                }
            }
            
            // If clusters didn't change much, we're done
            if (!changed) break;
        }
        
        // Sort cluster centers so energy levels are ordered from low to high
        centers.sort((a, b) => a - b);
        energyLevelAverages = centers;
        if (!hasLoggedEnergyClusters) {
            log('ENERGY', '⚡ [ENERGY LEVEL LISTENING] First energy level clusters calculated:', energyLevelAverages.map(v => v.toFixed(4)));
            hasLoggedEnergyClusters = true;
        }
    }

    function classifyEnergyLevel(temporalAvg) {
        if (rmsSamples.length < 50 || energyLevelAverages[4] === 0 || temporalAvg === null) {
            return 0; // Not enough data
        }
        
        // Calculate overlapping ranges for each energy level
        // Each range extends ENERGY_RANGE_OVERLAP beyond its center in both directions
        const ranges = [];
        for (let i = 0; i < 5; i++) {
            const center = energyLevelAverages[i];
            // Calculate range extent based on distance to neighbors (or use fixed percentage)
            let rangeExtent;
            if (i === 0) {
                // First level: extend towards next level
                rangeExtent = (energyLevelAverages[1] - center) * ENERGY_RANGE_OVERLAP;
            } else if (i === 4) {
                // Last level: extend towards previous level
                rangeExtent = (center - energyLevelAverages[3]) * ENERGY_RANGE_OVERLAP;
            } else {
                // Middle levels: extend based on distance to neighbors
                const distToPrev = center - energyLevelAverages[i - 1];
                const distToNext = energyLevelAverages[i + 1] - center;
                rangeExtent = Math.min(distToPrev, distToNext) * ENERGY_RANGE_OVERLAP;
            }
            
            ranges.push({
                min: center - rangeExtent,
                max: center + rangeExtent,
                center: center,
                level: i + 1
            });
        }
        
        // Find all ranges that contain the temporal average (overlapping ranges)
        const matchingRanges = ranges.filter(r => temporalAvg >= r.min && temporalAvg <= r.max);
        
        let newLevel;
        if (matchingRanges.length === 0) {
            // No range matches (shouldn't happen, but fallback to closest)
            let minDist = Infinity;
            for (let i = 0; i < 5; i++) {
                const dist = Math.abs(temporalAvg - energyLevelAverages[i]);
                if (dist < minDist) {
                    minDist = dist;
                    newLevel = i + 1;
                }
            }
        } else if (matchingRanges.length === 1) {
            // Only one range matches
            newLevel = matchingRanges[0].level;
        } else {
            // Multiple ranges match (overlap) - use closest center
            let minDist = Infinity;
            for (const range of matchingRanges) {
                const dist = Math.abs(temporalAvg - range.center);
                if (dist < minDist) {
                    minDist = dist;
                    newLevel = range.level;
                }
            }
        }
        
        // Apply hysteresis to prevent rapid bouncing
        if (lastEnergyLevel > 0 && newLevel !== lastEnergyLevel) {
            const currentCenter = energyLevelAverages[lastEnergyLevel - 1];
            const newCenter = energyLevelAverages[newLevel - 1];
            
            // Calculate threshold with hysteresis
            const midpoint = (currentCenter + newCenter) / 2;
            const direction = newLevel > lastEnergyLevel ? 1 : -1;
            const threshold = midpoint + (direction * (Math.abs(newCenter - currentCenter) * LEVEL_HYSTERESIS));
            
            // Only switch if we've crossed the threshold
            if ((direction > 0 && temporalAvg >= threshold) || (direction < 0 && temporalAvg <= threshold)) {
                lastEnergyLevel = newLevel;
                return newLevel;
            } else {
                // Stay at current level
                return lastEnergyLevel;
            }
        } else {
            lastEnergyLevel = newLevel;
            return newLevel;
        }
    }

    // Public API
    return {
        // Add an RMS sample and update temporal average
        addRmsSample: function(rms) {
            rmsSamples.push(rms);
            if (rmsSamples.length > MAX_RMS_SAMPLES) {
                rmsSamples.shift();
            }
            
            // Update temporal average of RMS (exponential moving average)
            if (temporalRmsAverage === null) {
                temporalRmsAverage = rms;
            } else {
                temporalRmsAverage = TEMPORAL_AVG_ALPHA * rms + (1 - TEMPORAL_AVG_ALPHA) * temporalRmsAverage;
            }
        },

        // Update energy clusters and classification (call this periodically)
        update: function() {
            // Update clusters every minute
            const currentTime = Date.now() / 1000; // Current time in seconds
            if (currentTime - lastClusterUpdateTime >= CLUSTER_UPDATE_INTERVAL) {
                updateEnergyClusters();
                lastClusterUpdateTime = currentTime;
            }
            
            // Classify current energy level using temporal average
            const prevEnergyLevel = currentEnergyLevel;
            currentEnergyLevel = classifyEnergyLevel(temporalRmsAverage);
            
            // Log first energy level classification
            if (!hasLoggedEnergyLevel && currentEnergyLevel > 0) {
                log('ENERGY', '⚡ [ENERGY LEVEL LISTENING] First energy level classified:', currentEnergyLevel);
                hasLoggedEnergyLevel = true;
            }
            
            // Update pulse threshold dynamically based on current energy level averages
            // Use level 3 (medium) as the pulse threshold, but update it continuously
            if (energyLevelAverages.length >= 3 && energyLevelAverages[2] > 0) {
                pulseThreshold = energyLevelAverages[2]; // Use level 3 (medium energy) as pulse threshold
            }
        },

        // Get current energy level (1-5, or 0 if not enough data)
        getCurrentEnergyLevel: function() {
            return currentEnergyLevel;
        },

        // Get pulse threshold
        getPulseThreshold: function() {
            return pulseThreshold;
        },

        // Get energy level averages
        getEnergyLevelAverages: function() {
            return [...energyLevelAverages];
        },

        // Get temporal RMS average
        getTemporalRmsAverage: function() {
            return temporalRmsAverage;
        },

        // Check if enough samples collected
        hasEnoughSamples: function() {
            return rmsSamples.length >= 50;
        },

        // Reset all state
        reset: function() {
            rmsSamples = [];
            energyLevelAverages = [0, 0, 0, 0, 0];
            currentEnergyLevel = 0;
            lastEnergyLevel = 0;
            lastClusterUpdateTime = 0;
            temporalRmsAverage = null;
            pulseThreshold = null;
            hasLoggedEnergyClusters = false;
            hasLoggedEnergyLevel = false;
        }
    };
})();

// Export functions if using modules, otherwise attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ENERGY_CLASSIFIER;
} else {
    window.ENERGY_CLASSIFIER = ENERGY_CLASSIFIER;
}

