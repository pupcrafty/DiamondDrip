# Microphone Info Collection Server

A Python Flask server that receives and stores microphone API detection data from browsers. This server collects comprehensive information about browser microphone API support, device capabilities, and audio constraints.

## Features

- ✅ Receives and stores microphone API detection data
- ✅ Organizes data by device type and browser
- ✅ HTTPS support (required for mobile browser microphone access)
- ✅ Automatic SSL certificate generation
- ✅ CORS enabled for cross-origin requests
- ✅ JSON validation and sanitization
- ✅ Security features to prevent attacks
- ✅ Health check endpoint

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

Dependencies:
- Flask>=2.0.0
- flask-cors>=3.0.0

Optional (for SSL certificate generation):
- cryptography (Python package)
- OR OpenSSL (system command)

## Usage

### Starting the Server

**Windows:**
```bash
start-server.bat
```

**Linux/Mac:**
```bash
./start-server.sh
```

**Manual start:**
```bash
python microphone_info_server.py
```

### Configuration

**Custom Port:**
```bash
PORT=9002 python microphone_info_server.py
```

**HTTP Mode (disable HTTPS):**
```bash
HTTPS=false PORT=9001 python microphone_info_server.py
```

**Default Settings:**
- Port: 9001 (automatically finds available port if in use)
- HTTPS: Enabled by default (required for mobile browsers)
- Host: 0.0.0.0 (all interfaces)

### SSL Certificates

The server automatically generates self-signed SSL certificates if needed. For mobile devices (especially iOS), HTTPS is required to access the microphone API.

- Certificates are stored in `server.crt` and `server.key`
- The server attempts to reuse certificates from the game server (in `../player/`) for consistency
- First-time users will see a security warning; this is normal for self-signed certificates

## API Endpoints

### POST `/api/microphone-info`

Submit microphone info JSON data.

**Request:**
- Method: `POST`
- Content-Type: `application/json`
- Body: JSON object matching the microphone info format (see Data Structure section)

**Response (Success):**
```json
{
  "success": true,
  "message": "Data saved successfully",
  "path": "desktop/Chrome/microphone_info_20251228_181529_744.json"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

**Error Codes:**
- `400`: Invalid JSON, missing required fields, or structure validation failed
- `500`: Server error during save operation

### GET `/health`

Health check endpoint to verify server status.

**Response:**
```json
{
  "status": "ok",
  "service": "microphone-info-collector",
  "data_dir": "path/to/data"
}
```

### GET `/`

Service information endpoint.

**Response:**
```json
{
  "service": "Microphone Info Collection Server",
  "version": "1.0.0",
  "endpoints": {
    "POST /api/microphone-info": "Submit microphone info JSON",
    "GET /health": "Health check"
  },
  "data_directory": "path/to/data"
}
```

## Data Structure

The server accepts JSON data with the following structure. All top-level keys are required:

### Complete JSON Schema

```json
{
  "timestamp": "2025-12-28T18:15:29.168Z",
  "browser": {
    "browser": "Chrome",
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
    "platform": "Win32",
    "vendor": "Google Inc.",
    "language": "en-US",
    "cookieEnabled": true,
    "onLine": true
  },
  "audioContext": {
    "AudioContext": true,
    "webkitAudioContext": false,
    "available": true,
    "sampleRate": 44100,
    "state": "running"
  },
  "mediaDevices": {
    "mediaDevices": true,
    "getUserMedia": true,
    "enumerateDevices": true,
    "getSupportedConstraints": true,
    "supportedConstraints": {
      "aspectRatio": true,
      "autoGainControl": true,
      "brightness": true,
      "channelCount": true,
      "colorTemperature": true,
      "contrast": true,
      "deviceId": true,
      "displaySurface": true,
      "echoCancellation": true,
      "exposureCompensation": true,
      "exposureMode": true,
      "exposureTime": true,
      "facingMode": true,
      "focusDistance": true,
      "focusMode": true,
      "frameRate": true,
      "groupId": true,
      "height": true,
      "iso": true,
      "latency": true,
      "noiseSuppression": true,
      "pan": true,
      "pointsOfInterest": true,
      "resizeMode": true,
      "restrictOwnAudio": true,
      "sampleRate": true,
      "sampleSize": true,
      "saturation": true,
      "sharpness": true,
      "suppressLocalAudioPlayback": true,
      "tilt": true,
      "torch": true,
      "voiceIsolation": true,
      "whiteBalanceMode": true,
      "width": true,
      "zoom": true
    },
    "available": true
  },
  "legacyGetUserMedia": {
    "navigator_getUserMedia": true,
    "navigator_webkitGetUserMedia": true,
    "navigator_mozGetUserMedia": false,
    "navigator_msGetUserMedia": false,
    "available": true
  },
  "mediaStream": {
    "MediaStream": true,
    "MediaStreamTrack": true,
    "MediaStreamConstraints": false,
    "available": true
  },
  "constraints": {
    "echoCancellation": true,
    "noiseSuppression": true,
    "autoGainControl": true,
    "sampleRate": true,
    "channelCount": true,
    "latency": true,
    "volume": false
  },
  "permissions": {
    "permissions": true,
    "query": true,
    "available": true
  },
  "testResult": {
    "success": true,
    "apiUsed": "navigator.mediaDevices.getUserMedia",
    "timestamp": "2025-12-28T18:15:28.186Z",
    "streamId": "3d39fe89-0188-42de-b3f8-84c53b1680a8",
    "active": true,
    "tracks": {
      "total": 1,
      "audio": 1,
      "video": 0
    },
    "audioTracks": [
      {
        "index": 0,
        "id": "e7f75380-ad52-4693-96bc-c800fad9b831",
        "kind": "audio",
        "label": "Default - Microphone (HyperX QuadCast) (03f0:0491)",
        "enabled": true,
        "muted": false,
        "readyState": "live",
        "settings": {
          "autoGainControl": true,
          "channelCount": 1,
          "deviceId": "default",
          "echoCancellation": true,
          "groupId": "395a647f1200e76cfcaf4e9afa98fb2dd8e78ee6c97d8304a22da3b51abdfa8a",
          "latency": 0.01,
          "noiseSuppression": true,
          "sampleRate": 48000,
          "sampleSize": 16,
          "voiceIsolation": false
        },
        "constraints": {},
        "capabilities": {
          "autoGainControl": [true, false],
          "channelCount": {
            "max": 2,
            "min": 1
          },
          "deviceId": "default",
          "echoCancellation": [true, false, "remote-only"],
          "groupId": "395a647f1200e76cfcaf4e9afa98fb2dd8e78ee6c97d8304a22da3b51abdfa8a",
          "latency": {
            "max": 0.01,
            "min": 0.01
          },
          "noiseSuppression": [true, false],
          "sampleRate": {
            "max": 48000,
            "min": 48000
          },
          "sampleSize": {
            "max": 16,
            "min": 16
          },
          "voiceIsolation": [true, false]
        }
      }
    ]
  },
  "rawAPIs": {
    "navigator": {
      "mediaDevices": [],
      "getUserMedia": "function",
      "webkitGetUserMedia": "function",
      "mozGetUserMedia": "undefined",
      "msGetUserMedia": "undefined",
      "permissions": "object"
    },
    "window": {
      "AudioContext": "function",
      "webkitAudioContext": "undefined",
      "MediaStream": "function",
      "MediaStreamTrack": "function"
    }
  }
}
```

### Field Descriptions

#### `timestamp`
ISO 8601 timestamp when the data was collected (UTC).

#### `browser`
Browser and environment information:
- `browser`: Browser name (Chrome, Safari, Firefox, etc.)
- `userAgent`: Full user agent string
- `platform`: Platform identifier (Win32, MacIntel, Linux x86_64, etc.)
- `vendor`: Browser vendor
- `language`: Browser language setting
- `cookieEnabled`: Whether cookies are enabled
- `onLine`: Whether the browser thinks it's online

#### `audioContext`
Web Audio API availability and configuration:
- `AudioContext`: Whether standard AudioContext is available
- `webkitAudioContext`: Whether webkit-prefixed version is available
- `available`: Whether any AudioContext is available
- `sampleRate`: Default sample rate (typically 44100 or 48000 Hz)
- `state`: AudioContext state (running, suspended, closed)

#### `mediaDevices`
MediaDevices API availability:
- `mediaDevices`: Whether navigator.mediaDevices exists
- `getUserMedia`: Whether getUserMedia is available
- `enumerateDevices`: Whether enumerateDevices is available
- `getSupportedConstraints`: Whether getSupportedConstraints is available
- `supportedConstraints`: Object listing all supported constraint names
- `available`: Whether mediaDevices API is available

#### `legacyGetUserMedia`
Legacy getUserMedia API support (pre-standard):
- `navigator_getUserMedia`: Standard legacy API
- `navigator_webkitGetUserMedia`: Webkit-prefixed version
- `navigator_mozGetUserMedia`: Mozilla-prefixed version
- `navigator_msGetUserMedia`: Microsoft-prefixed version
- `available`: Whether any legacy API is available

#### `mediaStream`
MediaStream API availability:
- `MediaStream`: Whether MediaStream constructor exists
- `MediaStreamTrack`: Whether MediaStreamTrack is available
- `MediaStreamConstraints`: Whether MediaStreamConstraints is available
- `available`: Whether MediaStream API is available

#### `constraints`
Supported audio constraints (boolean indicates support):
- `echoCancellation`: Echo cancellation support
- `noiseSuppression`: Noise suppression support
- `autoGainControl`: Automatic gain control support
- `sampleRate`: Sample rate constraint support
- `channelCount`: Channel count constraint support
- `latency`: Latency constraint support
- `volume`: Volume control support

#### `permissions`
Permissions API availability:
- `permissions`: Whether navigator.permissions exists
- `query`: Whether query() method is available
- `available`: Whether Permissions API is available

#### `testResult`
Results of actual microphone access attempt:
- `success`: Whether microphone access was successful
- `apiUsed`: Which API was used (navigator.mediaDevices.getUserMedia, etc.)
- `timestamp`: When the access attempt occurred
- `streamId`: Unique identifier for the media stream
- `active`: Whether the stream is currently active
- `tracks`: Summary of track counts (total, audio, video)
- `audioTracks`: Array of audio track objects with:
  - `index`: Track index in the stream
  - `id`: Unique track identifier
  - `kind`: Track kind ("audio" or "video")
  - `label`: Human-readable device label
  - `enabled`: Whether track is enabled
  - `muted`: Whether track is muted
  - `readyState`: Track state ("live", "ended")
  - `settings`: Current track settings (applied constraints)
  - `constraints`: Requested constraints
  - `capabilities`: Device capabilities (supported values/ranges)

#### `rawAPIs`
Raw API availability checks:
- `navigator`: Navigator object API checks
- `window`: Window object API checks

## Data Storage

Data is stored in the following structure:
```
data/
  ├── desktop/
  │   ├── Chrome/
  │   │   ├── microphone_info_20251228_181529_744.json
  │   │   └── microphone_info_20251228_185918_148.json
  │   ├── Firefox/
  │   │   └── ...
  │   └── Safari/
  │       └── ...
  ├── ios/
  │   ├── Safari/
  │   │   └── ...
  │   └── Chrome/
  │       └── ...
  ├── android/
  │   └── Chrome/
  │       └── ...
  ├── windows/
  │   └── Chrome/
  │       └── ...
  ├── macos/
  │   └── ...
  ├── linux/
  │   └── ...
  └── mobile/
      └── ...
```

Files are organized by:
1. **Device type**: Detected from platform/user agent (ios, android, windows, macos, linux, mobile, desktop, unknown)
2. **Browser name**: Extracted from browser data (Safari, Chrome, Firefox, Edge, etc.)

Filename format: `microphone_info_YYYYMMDD_HHMMSS_mmm.json`
- Includes date, time, and milliseconds for unique identification

## Security Features

The server implements multiple security measures:

- **JSON Structure Validation**: Validates required fields and rejects unexpected top-level keys
- **Input Sanitization**: Removes control characters and limits string lengths to prevent injection attacks
- **Filename Sanitization**: Removes dangerous characters and prevents directory traversal (`../`)
- **Size Limits**: 
  - Maximum JSON size: 1MB
  - Maximum list size: 1000 items
  - Maximum string length: 10,000 characters (configurable per field)
- **Content Validation**: Validates data structure before saving
- **CORS Configuration**: Configurable CORS headers (default: allows all origins for development)

## Integration Example

To send data from a browser page to the server:

```javascript
// Collect microphone info (implementation depends on your collection page)
const allInfo = collectAllInfo(); // Your function to collect the data

// Send to server
async function sendToServer() {
    try {
        const response = await fetch('https://localhost:9001/api/microphone-info', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(allInfo)
        });
        const result = await response.json();
        
        if (result.success) {
            console.log('Data saved successfully:', result.path);
        } else {
            console.error('Error:', result.error);
        }
    } catch (error) {
        console.error('Error sending to server:', error);
    }
}

// Call the function
sendToServer();
```

**Note:** Use HTTPS for mobile browsers (especially iOS) as they require secure contexts for microphone access.

## Troubleshooting

### Port Already in Use
If the default port (9001) is in use, the server will automatically try to find an available port. You can also specify a custom port:
```bash
PORT=9002 python microphone_info_server.py
```

### SSL Certificate Warnings
When using HTTPS with self-signed certificates, browsers will show security warnings. This is expected behavior:
- **Chrome/Edge**: Click "Advanced" → "Proceed to localhost (unsafe)"
- **Firefox**: Click "Advanced" → "Accept the Risk and Continue"
- **Safari**: May require adding an exception in Keychain Access

### Mobile Browser Issues
- **iOS Safari**: Requires HTTPS (enabled by default)
- **Android Chrome**: Works with HTTP but HTTPS is recommended
- **Permissions**: Ensure microphone permissions are granted in browser settings

### CORS Errors
The server includes CORS headers by default. If you encounter CORS errors:
- Ensure the server is running
- Check that the request is going to the correct endpoint
- Verify the Content-Type header is set to `application/json`

## Requirements

- Python 3.6+
- Flask 2.0.0+
- flask-cors 3.0.0+ (optional, for better CORS handling)

For SSL certificate generation:
- `cryptography` Python package, OR
- OpenSSL installed system-wide

## License

This server is part of the DiamondDrip project.

