// -----------------------------
// Game State Management
// -----------------------------

let targets = [];
let markers = [];
let combo = 0;
let totalScore = 0;  // Global running score total
let sustainScore = 0;  // Separate score for sustained beats (bonus points)
let lastResult = "";
let lastErrMs = 0;
let celebrationText = null;  // Celebration text to display
let celebrationTextTime = 0;  // Time when celebration text should disappear
let gameVersion = 1;  // Version number (loaded from version.json)

// Beat detection state
let isListening = false;
let hasEnoughData = false;
let spawnedPredictedBeats = new Set(); // Track which predicted beats we've already spawned markers for
let lastPhraseStartTime = null; // Track when the current phrase started (for prediction-based timing)
let lastPulseTime = -999; // Track last pulse time for gating
const PULSE_GATE_TIME = 0.1; // Minimum time between pulses (100ms)

// Track sustained beat input state
let activeSustainedInputs = new Map(); // Map<markerPairId, {startMarker, endMarker, startTime, inputType, inputData}>
// inputType: 'keyboard' | 'mouse' | 'touch'
// inputData: {key: 'a'|'d'} | {startX, startY, currentX, currentY} | {touchId1, touchId2, touch1Data, touch2Data}

// Track keyboard state for sustained beats
let leftKeyHeld = false;
let rightKeyHeld = false;
let leftKeyActiveSustain = null; // markerPairId if left key is holding a sustain
let rightKeyActiveSustain = null; // markerPairId if right key is holding a sustain

// Track mouse drag state for sustained beats
let mouseDragActive = false;
let mouseDragSustain = null; // markerPairId if mouse is dragging a sustain
let mouseDragStartX = null;
let mouseDragStartY = null;

// Track touch state for sustained beats (2-finger support)
let touchActiveSustains = new Map(); // Map<touchId, markerPairId>
let touchPositions = new Map(); // Map<touchId, {x, y, targetIndex}>

// Legacy variables (for backward compatibility, may be removed later)
let currentlySustainingSide = null;
let sustainedBeatStartTime = null;
let sustainedBeatDuration = 0;
let sustainedBeatDuration32nd = 0;

// Initialize 3 targets (left, middle, right) at the bottom
function initializeTargets() {
    const scale = (WIDTH + HEIGHT) / 2000;
    const bottomY = HEIGHT - Math.round(200 * scale);  // Distance from bottom
    
    // Position 3 targets horizontally across the bottom
    const leftX = WIDTH / 4;      // Left target
    const middleX = WIDTH / 2;    // Middle target
    const rightX = WIDTH * 3 / 4; // Right target
    
    // 3 easily visible colors
    const colors = [
        'rgb(255, 70, 70)',    // Red - Left
        'rgb(70, 220, 140)',   // Green - Middle (sustained)
        'rgb(70, 150, 255)'    // Blue - Right
    ];
    
    const positions = [
        [leftX, bottomY],      // 0: Left
        [middleX, bottomY],    // 1: Middle
        [rightX, bottomY]      // 2: Right
    ];
    
    targets = [];
    for (let i = 0; i < 3; i++) {
        const target = new Target(-1, positions[i][0], positions[i][1], colors[i]);
        targets.push(target);
    }
}

// Getter functions for state
function getTargets() {
    return targets;
}

function getMarkers() {
    return markers;
}

function setMarkers(newMarkers) {
    markers = newMarkers;
}

function getCombo() {
    return combo;
}

function getTotalScore() {
    return totalScore;
}

function getSustainScore() {
    return sustainScore;
}

function getLastResult() {
    return lastResult;
}

function isListeningState() {
    return isListening;
}

function setListeningState(value) {
    isListening = value;
}

function hasEnoughDataState() {
    return hasEnoughData;
}

function setHasEnoughDataState(value) {
    hasEnoughData = value;
}

function getLastPulseTime() {
    return lastPulseTime;
}

function setLastPulseTime(value) {
    lastPulseTime = value;
}

function getPulseGateTime() {
    return PULSE_GATE_TIME;
}

function getLastPhraseStartTime() {
    return lastPhraseStartTime;
}

function setLastPhraseStartTime(value) {
    lastPhraseStartTime = value;
}

function getSpawnedPredictedBeats() {
    return spawnedPredictedBeats;
}

function getActiveSustainedInputs() {
    return activeSustainedInputs;
}

function getCurrentlySustainingSide() {
    return currentlySustainingSide;
}

function setCurrentlySustainingSide(value) {
    currentlySustainingSide = value;
}

// Score update functions
function updateScore(increment) {
    totalScore += increment;
}

function updateSustainScore(increment) {
    sustainScore += increment;
}

function updateCombo(increment) {
    combo = Math.max(0, combo + increment);
}

function setLastResult(result) {
    lastResult = result;
}

function setCelebrationText(text, duration) {
    celebrationText = text;
    celebrationTextTime = text ? (now() + duration) : 0;
}

function getCelebrationText() {
    return celebrationText;
}

function getCelebrationTextTime() {
    return celebrationTextTime;
}

function getGameVersion() {
    return gameVersion;
}

function setGameVersion(version) {
    gameVersion = version;
}

