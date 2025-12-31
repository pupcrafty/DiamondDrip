// -----------------------------
// Config - Game constants
// -----------------------------
const BPM = 60;
const BEAT_INTERVAL = 60.0 / BPM;
const TARGET_LIFETIME_BEATS = 4;  // Targets last for 4 beats
const START_DELAY = 1.0;  // seconds before first beat

// Dynamic dimensions - will be set based on window size
// Portrait aspect ratio for phones (9:16)
const ASPECT_RATIO = 9 / 16;  // width/height ratio (portrait orientation)
let WIDTH = 1000;
let HEIGHT = 1000;

// Timing windows (seconds)
const PERFECT_W = 0.045;
const GOOD_W = 0.090;

// Visual - these will scale based on canvas size
// Base sizes for 1000x1000 canvas
const BASE_CANVAS_SIZE = 1000;
let TARGET_RADIUS = 28;
let MARKER_RADIUS = 14;
let MIN_SPACING = TARGET_RADIUS * 3;  // Minimum distance between targets to avoid overlap

// Marker fall speed (pixels per second) - will scale with canvas size
let MARKER_FALL_SPEED = 300;  // Fixed fall speed for markers

// Function to get scale factor
function getScaleFactor() {
    const avgDimension = (WIDTH + HEIGHT) / 2;
    return avgDimension / BASE_CANVAS_SIZE;
}

// Function to update all size constants based on current canvas dimensions
function updateSizeConstants() {
    // Calculate scale factor based on average dimension (for proportional scaling)
    const scale = getScaleFactor();
    
    // Update size constants
    TARGET_RADIUS = Math.round(28 * scale);
    MARKER_RADIUS = Math.round(14 * scale);
    MIN_SPACING = TARGET_RADIUS * 3;
    MARKER_FALL_SPEED = 300 * scale;
}

// Helper function to get scaled yellow radius (outermost clickable area)
function getYellowRadius() {
    const scale = getScaleFactor();
    return TARGET_RADIUS + Math.round(30 * scale);
}

// Function to calculate and set canvas dimensions based on window size
function calculateCanvasDimensions() {
    // Get available window size (account for padding/margins)
    const availableWidth = window.innerWidth - 20;  // Leave 10px margin on each side
    const availableHeight = window.innerHeight - 20;  // Leave 10px margin on each side
    
    // Calculate dimensions maintaining aspect ratio
    // For portrait orientation, fit to height first
    let newHeight = availableHeight;
    let newWidth = newHeight * ASPECT_RATIO;
    
    // If width is too wide, fit to width instead
    if (newWidth > availableWidth) {
        newWidth = availableWidth;
        newHeight = newWidth / ASPECT_RATIO;
    }
    
    // Set dimensions (round to integers)
    WIDTH = Math.round(newWidth);
    HEIGHT = Math.round(newHeight);
    
    // Ensure minimum dimensions (fallback if window is too small)
    if (WIDTH <= 0 || HEIGHT <= 0 || !isFinite(WIDTH) || !isFinite(HEIGHT)) {
        console.warn('[CONFIG] Invalid dimensions calculated, using fallback:', WIDTH, 'x', HEIGHT);
        WIDTH = 1000;
        HEIGHT = 1000;
    }
    
    // Update all size constants
    updateSizeConstants();
}

// BPM Processing
const MAX_BPM_BEFORE_HALVING = 200;  // If BPM exceeds this value, assume double counting and halve it

// -----------------------------
// Pattern Visualizer Configuration
// -----------------------------
const ENABLE_PATTERN_VISUALIZER = true;  // Set to true to enable the beat pattern side panel

// -----------------------------
// Logging Configuration
// -----------------------------
// Logger is now in logger.js - LOG_CONFIG is available globally after logger.js is loaded

