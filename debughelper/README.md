# Microphone Info Collection Server

A Python Flask server that receives and stores microphone API detection data from browsers.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

## Usage

Start the server:
```bash
python microphone_info_server.py
```

Or specify a custom port:
```bash
PORT=9002 python microphone_info_server.py
```

**Default Port:** 9001 (checks if available, suggests alternatives if not)

## API Endpoints

### POST `/api/microphone-info`
Submit microphone info JSON data.

**Request:**
- Content-Type: `application/json`
- Body: JSON object matching the microphone info format from `microphoneInfo.html`

**Response:**
```json
{
  "success": true,
  "message": "Data saved successfully",
  "path": "ios/Safari/microphone_info_20240101_120000_123.json"
}
```

### GET `/health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "service": "microphone-info-collector",
  "data_dir": "path/to/data"
}
```

## Data Storage

Data is stored in the following structure:
```
data/
  ├── ios/
  │   ├── Safari/
  │   │   ├── microphone_info_20240101_120000_123.json
  │   │   └── ...
  │   └── Chrome/
  │       └── ...
  ├── android/
  │   └── Chrome/
  │       └── ...
  └── windows/
      └── Chrome/
          └── ...
```

Files are organized by:
1. Device type (ios, android, windows, macos, linux, mobile, desktop, unknown)
2. Browser name (Safari, Chrome, Firefox, etc.)

## Security Features

- JSON structure validation
- Input sanitization to prevent injection attacks
- Filename sanitization to prevent directory traversal
- Size limits to prevent DoS attacks
- Content validation before saving

## Integration with microphoneInfo.html

To send data from the microphone info page, add this JavaScript after copying:

```javascript
// After copying, you can also send to server
async function sendToServer() {
    const allInfo = collectAllInfo();
    try {
        const response = await fetch('http://localhost:8080/api/microphone-info', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(allInfo)
        });
        const result = await response.json();
        console.log('Server response:', result);
    } catch (error) {
        console.error('Error sending to server:', error);
    }
}
```

