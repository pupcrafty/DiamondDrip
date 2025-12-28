// -----------------------------
// Config - Game constants
// -----------------------------
const BPM = 60;
const BEAT_INTERVAL = 60.0 / BPM;
const TARGET_LIFETIME_BEATS = 4;  // Targets last for 4 beats
const START_DELAY = 1.0;  // seconds before first beat
const WIDTH = 1000;
const HEIGHT = 1000;

// Timing windows (seconds)
const PERFECT_W = 0.045;
const GOOD_W = 0.090;

// Visual
const TARGET_RADIUS = 28;
const MARKER_RADIUS = 14;
const MIN_SPACING = TARGET_RADIUS * 3;  // Minimum distance between targets to avoid overlap

// Marker fall speed (pixels per second)
const MARKER_FALL_SPEED = 300;  // Fixed fall speed for markers

// BPM Processing
const MAX_BPM_BEFORE_HALVING = 200;  // If BPM exceeds this value, assume double counting and halve it

// -----------------------------
// Logging Configuration
// -----------------------------
// Logger is now in logger.js - LOG_CONFIG is available globally after logger.js is loaded

