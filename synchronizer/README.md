# DiamondDrip Prediction Synchronizer

This server receives prediction data from the DiamondDrip game and logs it for analysis or synchronization purposes.

## Overview

The prediction server receives POST requests from the game containing:
- Hyper smoothed BPM history (last 10 values)
- Recent detected pulse patterns (last 5 phrases)
- Recent correct prediction parts (last 5 patterns)
- Current prediction being made
- Client timestamp (ISO 8601 format)

All prediction data is automatically stored in a SQLite database (`predictions.db`) for analysis and processing.

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

The server automatically initializes a SQLite database (`predictions.db`) in the `synchronizer` directory to store all prediction data.

## API Endpoints

### POST /prediction

Receives prediction data from the game and stores it in the database.

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
  "timestamp": "2024-01-01T12:00:00.000Z"  // ISO 8601 timestamp
}
```

**Response:**
```json
{
  "status": "success",
  "server_timestamp": "2024-01-01T12:00:00.000000",
  "client_timestamp": "2024-01-01T12:00:00.000Z"
}
```

### GET /stats

Returns statistics about stored predictions.

**Response:**
```json
{
  "total_predictions": 150,
  "avg_bpm": 120.5,
  "min_bpm": 110.0,
  "max_bpm": 130.0
}
```

### GET /recent?limit=100

Returns recent predictions from the database.

**Query Parameters:**
- `limit` (optional): Number of recent predictions to return (default: 100)

**Response:**
```json
[
  {
    "id": 150,
    "client_timestamp": "2024-01-01T12:00:00.000Z",
    "server_timestamp": "2024-01-01T12:00:00.000000",
    "current_bpm": 120.5,
    "bpm_history": "[120.0, 120.2, 120.5]",
    "recent_pulse_patterns": "[[true, false, ...], ...]",
    "recent_correct_prediction_parts": "[[true, false, ...], ...]",
    "current_prediction": "[true, false, ...]",
    "created_at": "2024-01-01 12:00:00"
  },
  ...
]
```

## Database

The server uses SQLite to store all prediction data in `predictions.db`. The database schema includes:

- **id**: Primary key (auto-increment)
- **client_timestamp**: ISO timestamp from the game client
- **server_timestamp**: ISO timestamp when the server received the data
- **current_bpm**: Current BPM value
- **bpm_history**: JSON array of recent BPM values
- **recent_pulse_patterns**: JSON array of recent pulse patterns
- **recent_correct_prediction_parts**: JSON array of correct prediction parts
- **current_prediction**: JSON array of the current prediction pattern
- **created_at**: Database timestamp (auto-generated)

The database is automatically initialized when the server starts. If database initialization fails, the server will continue running but won't store data (warnings will be logged).

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
- All prediction data is stored in SQLite database for later analysis
- SQLite is included in Python's standard library, so no additional dependencies are needed

