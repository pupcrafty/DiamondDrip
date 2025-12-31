// -----------------------------
// Game Orchestrator
// -----------------------------
// This file orchestrates all the game modules

// Canvas and context (will be initialized when DOM is ready)
let canvas = null;
let ctx = null;

// Initialize canvas size
function initializeCanvas() {
    if (!canvas) {
        canvas = document.getElementById('gameCanvas');
        if (!canvas) {
            console.error('[GAME] Canvas element not found!');
            return;
        }
        ctx = canvas.getContext('2d');
    }
    
    // Calculate dimensions based on window size
    calculateCanvasDimensions();
    
    // Ensure dimensions are valid before setting
    if (!WIDTH || !HEIGHT || WIDTH <= 0 || HEIGHT <= 0 || !isFinite(WIDTH) || !isFinite(HEIGHT)) {
        console.error('[GAME] Invalid canvas dimensions calculated:', WIDTH, 'x', HEIGHT, '- using fallback');
        WIDTH = 1000;
        HEIGHT = 1000;
        updateSizeConstants(); // Update size constants with fallback dimensions
    }
    
    // Set canvas dimensions
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    
    console.log('[GAME] Canvas element dimensions set to:', canvas.width, 'x', canvas.height);
    console.log('[GAME] WIDTH and HEIGHT constants:', WIDTH, 'x', HEIGHT);
    
    // Reinitialize targets with new dimensions
    initializeTargets();
    
    log('GAME', '🎮 [GAME] Canvas initialized:', WIDTH, 'x', HEIGHT);
}

// Handle window resize
function handleResize() {
    initializeCanvas();
    log('GAME', '🎮 [GAME] Canvas resized:', WIDTH, 'x', HEIGHT);
}

// Add resize event listener
window.addEventListener('resize', handleResize);

// -----------------------------
// Game loop
// -----------------------------
function gameLoop() {
    const t = now();
    
    // Update game logic (without drawing)
    updateGameLogic(t);
    
    // Update beat pattern visualization (only if enabled in config)
    if (typeof ENABLE_PATTERN_VISUALIZER !== 'undefined' && ENABLE_PATTERN_VISUALIZER && 
        typeof updateBeatPatternVisualization === 'function') {
        updateBeatPatternVisualization(t);
    }
    
    // Render everything
    renderGame(t);
    
    requestAnimationFrame(gameLoop);
}

// Start listening on page load
window.addEventListener('load', () => {
    log('GAME', '🎮 [GAME] Page loaded, initializing game...');
    // Load version if not already loaded
    if (typeof window.gameVersion !== 'undefined') {
        setGameVersion(window.gameVersion);
    }
    // Initialize canvas and targets
    initializeCanvas();
    
    // Verify canvas was initialized
    if (!canvas || !ctx) {
        console.error('[GAME] Failed to initialize canvas!');
        return;
    }
    
    log('GAME', '🎮 [GAME] Game initialized with', getTargets().length, 'targets');
    
    // Set canvas references for renderer and input handlers
    setCanvas(canvas, ctx);
    setCanvasForInput(canvas);
    
    console.log('[GAME] Canvas initialized:', canvas !== null, 'Context:', ctx !== null);
    
    // Initialize input handlers
    initializeInputHandlers();
    // Start listening
    startListening();
    // Note: API calls are now on-demand via checkAndRequestPredictionIfNeeded() in game loop
    // Start the game loop after initialization
    gameLoop();
});

