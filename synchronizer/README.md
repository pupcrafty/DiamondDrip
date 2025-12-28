# DiamondDrip Prediction Synchronizer

This server receives prediction data from the DiamondDrip game and logs it for analysis or synchronization purposes.

## Overview

The prediction server receives POST requests from the game containing:
- Hyper smoothed BPM history (last 10 values)
- Recent detected pulse patterns (last 5 phrases)
- Recent correct prediction parts (last 5 patterns)
- Current prediction being made

## Running the Server

### Windows
Double-click `start-server.bat` or run:
```bash
python prediction_server.py
```

### Mac/Linux
```bash
chmod +x start-server.sh
./start-server.sh
```

Or directly:
```bash
python3 prediction_server.py
```

The server will start on port 8444 by default and listen for prediction data at:
```
https://localhost:8444/prediction
```

**Note:** The server uses HTTPS with a self-signed certificate. If a certificate exists in the `player` directory, it will use that same certificate. Otherwise, it will generate a new one in the `synchronizer` directory.

## API Endpoint

### POST /prediction

Receives prediction data from the game.

**Request Body (JSON):**
```json
{
  "currentBPM": 120.5,
  "bpmHistory": [120.0, 120.2, 120.5, 120.3, 120.5],
  "recentPulsePatterns": [
    [true, false, false, true, ...],  // 32-element boolean array
    ...
  ],
  "recentCorrectPredictionParts": [
    [true, false, false, true, ...],  // 32-element boolean array
    ...
  ],
  "currentPrediction": [true, false, false, true, ...],  // 32-element boolean array
  "timestamp": 1234.567
}
```

**Response:**
```json
{
  "status": "success",
  "timestamp": "2024-01-01T12:00:00.000000"
}
```

## Configuration

To change the server port, edit `prediction_server.py` and modify the `PORT` constant:
```python
PORT = 8444  # Change to your desired port
```

To change the server URL in the game, edit `player/playerClient/js/game.js` and modify:
```javascript
const PREDICTION_SERVER_URL = 'https://localhost:8444/prediction';
```

## Notes

- The server runs asynchronously - the game continues without waiting for the response
- The game only sends unique predictions (duplicates are filtered)
- Errors are silently ignored to prevent blocking game execution
- CORS headers are enabled to allow cross-origin requests

