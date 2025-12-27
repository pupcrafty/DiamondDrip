# DiamondDrip - Beat Target Rhythm Game

A rhythm-based game built with HTML5 Canvas and JavaScript. Play directly in your browser!

## How to Play

Simply open `index.html` in a web browser. No installation required!

### Running Locally

You can run it in several ways:

1. **Double-click** `index.html` to open it in your default browser
2. **Right-click** `index.html` → "Open with" → Choose your browser
3. **From terminal**:
   - Windows: `start index.html`
   - Mac: `open index.html`
   - Linux: `xdg-open index.html`

Or use a local server (recommended for development):
- Python: `python -m http.server 8000` then open `http://localhost:8000`
- Node.js: `npx http-server` then open the provided URL

## Controls

- **SPACE** - Hit the beat
- **ESC** - (Future: Quit functionality)

## Gameplay

- Targets appear on screen at random positions (non-overlapping)
- Each target lasts for 4 beats
- Targets build up: Beat 1 (1 target), Beat 2 (2 targets), Beat 3 (3 targets), Beat 4 (4 targets)
- From Beat 5 onwards, maintain 4 targets on screen
- Press SPACE on the beat when a target should be hit (4 beats after it appears)
- Timing windows:
  - **PERFECT** - Within 45ms of the beat
  - **GOOD** - Within 90ms of the beat
  - **MISS** - Outside the timing window or no input

## Configuration

You can adjust the following settings in `game.js`:
- `BPM` - Beats per minute (default: 60)
- `TARGET_LIFETIME_BEATS` - How many beats each target lasts (default: 4)
- `START_DELAY` - Delay before first beat (default: 1.0 seconds)
- `PERFECT_W` - Perfect timing window (default: 0.045 seconds)
- `GOOD_W` - Good timing window (default: 0.090 seconds)
- `TARGET_RADIUS` - Size of targets (default: 28 pixels)

## Browser Compatibility

Works in all modern browsers that support:
- HTML5 Canvas
- Web Audio API
- ES6 JavaScript features

Tested on:
- Chrome/Edge (recommended)
- Firefox
- Safari

## Development

This game was originally built in Python/Pygame and converted to HTML5/JavaScript for browser compatibility.
