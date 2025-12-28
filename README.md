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

### Accessing from Another Device on Local Network

To play the game on another device (phone, tablet, another computer) on the same network:

1. **Start the server** (choose one method):
   - **Easy way**: Double-click `start-server.bat` (Windows)
   - **Python**: `python -m http.server 8000 --bind 0.0.0.0`
   - **Node.js**: `npx http-server -p 8000 -a 0.0.0.0`

2. **Find your computer's local IP address**:
   - **Windows**: Open PowerShell and run `ipconfig`, look for "IPv4 Address" under your active network adapter (usually starts with 192.168.x.x or 10.x.x.x)
   - **Mac/Linux**: Run `ifconfig` or `ip addr` and look for your local IP

3. **On the other device**:
   - Make sure it's connected to the same Wi-Fi/network
   - Open a web browser and go to: `http://YOUR_IP_ADDRESS:8000`
   - Example: If your IP is `192.168.1.100`, go to `http://192.168.1.100:8000`

**Note**: Make sure your firewall allows incoming connections on port 8000 if you have issues connecting.

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
