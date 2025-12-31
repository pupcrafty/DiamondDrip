# Frontend-Backend Integration Deployment Guide

This guide covers deploying the frontend-backend integration changes that enable server-side prediction via the `/predict_phrase` endpoint.

## Summary of Changes

1. **Frontend (`player/playerClient/js/game.js`)**:
   - Added server prediction state management
   - Implemented `/predict_phrase` API calls with batched pulse data
   - Added prediction accuracy tracking and comparison
   - Implemented prediction selection logic (server vs client)
   - Added comprehensive logging for integration verification
   - Updated target generation to use active prediction (server or client)

2. **Backend (Local - `synchronizer/prediction_server.py`)**:
   - Already supports `/predict_phrase` endpoint ✅

3. **Backend (AWS Lambda - `aws/lambda_function.py`)**:
   - ⚠️ **NOTE**: Currently does NOT support `/predict_phrase` endpoint
   - Only supports `/prediction` endpoint (data storage only)
   - **Action Required**: Lambda function needs to be updated to support `/predict_phrase` (see Future Work section)

## Deployment Steps

### 1. Deploy Frontend Client (Required)

The frontend changes are ready to deploy. This will enable the integration with the local prediction server.

**Steps:**

```bash
cd aws

# Upload player client files (includes updated game.js with integration)
python upload-player-client.py --stack-name diamonddrip-production-frontend --invalidate
```

**What this does:**
- Uploads all player client files to S3
- Updates `js/game.js` with integration code and logging
- Invalidates CloudFront cache (so users get the new version)
- Auto-increments version number

**Note**: The frontend will work with the local prediction server immediately. For AWS deployment, the Lambda function needs to be updated first (see Future Work).

### 2. Local Development (Synchronizer Server)

If you're running the local synchronizer server for development, it already supports `/predict_phrase`:

```bash
cd synchronizer
python prediction_server.py
```

The server will automatically:
- Accept `/predict_phrase` POST requests
- Process batched pulse data
- Return phrase predictions
- Store data in local SQLite database

### 3. AWS Lambda Function (Future Work)

**⚠️ IMPORTANT**: The AWS Lambda function currently does NOT support the `/predict_phrase` endpoint. The frontend will fall back to client-side prediction when the server endpoint is unavailable.

To enable full AWS integration, the Lambda function needs to be updated to:
1. Import and initialize the prediction engine (`prediction_api.py`, `prediction_engine.py`)
2. Add `/predict_phrase` endpoint handler
3. Handle batched pulse data and return predictions

This is a separate task that requires:
- Adding prediction engine dependencies to Lambda package
- Updating `lambda_function.py` to handle `/predict_phrase` requests
- Testing the integration

## Verification Steps

### Verify Frontend Integration (Browser Console)

1. **Open the game in your browser**
2. **Open Developer Tools** (F12)
3. **Go to Console tab**
4. **Start the game** (allow microphone access, start playing music)

5. **Look for integration logs** - You should see:

```
[INTEGRATION] 📡 Sending prediction request: {url: "...", bpm: "...", ...}
[INTEGRATION] ✅ API response received: {status: "success", ...}
[INTEGRATION] ✅ Server prediction stored: {bpm: "...", ...}
[INTEGRATION] 🎯 Prediction selection: server/client {...}
[INTEGRATION] 📊 Using prediction source: server/client {...}
```

### Verify API Calls (Network Tab)

1. **Open Developer Tools** (F12)
2. **Go to Network tab**
3. **Filter for "predict_phrase"**
4. **Start the game**

5. **Check requests:**
   - Should see POST requests to `/predict_phrase`
   - Request payload should include:
     - `recentPulseTimestamps`
     - `recentPulseDurations`
     - `recentPulsePatterns`
     - `recentPulseDurationsSlots`
     - `currentBPM`
     - `bpmHistory`
   - Response should include:
     - `status: "success"`
     - `phrase_start_server_ms`
     - `bpm`
     - `slot_ms`
     - `onset` (128 elements)
     - `dur_slots` (128 elements)
     - `confidence` (128 elements)

### Verify Prediction Selection

1. **Check console logs** for prediction selection:
   ```
   [INTEGRATION] 🎯 Prediction selection: server
   ```
   or
   ```
   [INTEGRATION] 🎯 Prediction selection: client
   ```

2. **Check accuracy tracking** (logged periodically):
   ```
   [INTEGRATION] 🎯 Prediction selection: server {
     serverAcc: "65.0%",
     clientAcc: "60.0%",
     difference: "5.0%"
   }
   ```

### Verify Target Generation

1. **Watch the game** - targets should spawn based on predictions
2. **Check console logs** for prediction source:
   ```
   [INTEGRATION] 📊 Using prediction source: server {
     bpm: "120.0",
     slotMs: "0.015",
     onsetCount: 16
   }
   ```

### Verify Server Response (Local Server)

If using local server, check server console:

```bash
# Server should log:
[API] Received /predict_phrase request
[API] Processing prediction...
[API] Returning prediction: BPM=120.0, phrase_start=...
```

### Verify Database Storage (Local)

If using local server with database:

```bash
# Check SQLite database
cd synchronizer
sqlite3 predictions.db

# View recent predictions
SELECT id, current_bpm, created_at 
FROM predictions 
ORDER BY created_at DESC 
LIMIT 5;
```

## Troubleshooting

### Frontend not sending requests

**Symptoms:**
- No `[INTEGRATION] 📡 Sending prediction request` logs
- Network tab shows no `/predict_phrase` requests

**Possible causes:**
1. **Not enough data collected** - Wait for BPM estimate to stabilize
2. **API call interval too long** - Check `API_CALL_INTERVAL_MS` (default: 500ms)
3. **JavaScript errors** - Check console for errors

**Solutions:**
- Wait for game to collect enough pulse data
- Check browser console for errors
- Verify `PREDICTION_SERVER_URL` is correct in `game.js`

### API requests failing

**Symptoms:**
- `[INTEGRATION] ⚠️ API request failed` logs
- Network tab shows 404 or 500 errors

**Possible causes:**
1. **Server not running** (local development)
2. **Wrong URL** - Check `PREDICTION_SERVER_URL` in `game.js`
3. **CORS issues** - Check server CORS headers
4. **SSL certificate issues** (local HTTPS server)

**Solutions:**
- Start local prediction server: `cd synchronizer && python prediction_server.py`
- Verify URL in `game.js` matches server address
- For local HTTPS, accept self-signed certificate in browser
- Check server logs for errors

### Server prediction not being used

**Symptoms:**
- Always seeing `[INTEGRATION] 🎯 Prediction selection: client`
- No `[INTEGRATION] ✅ Server prediction stored` logs

**Possible causes:**
1. **Server not responding** - Check network requests
2. **Server prediction not ready** - Wait for first successful response
3. **Accuracy tracking** - Client prediction may be more accurate

**Solutions:**
- Check network tab for successful `/predict_phrase` responses
- Wait for server prediction to arrive (may take 1-2 API calls)
- Check accuracy logs - server prediction will be used if more accurate

### Targets not spawning

**Symptoms:**
- No targets appear in game
- `[INTEGRATION] 📊 Using prediction source: null` logs

**Possible causes:**
1. **No prediction available** - Neither server nor client prediction ready
2. **BPM not estimated** - Wait for BPM estimate
3. **Not enough data** - Game waiting for more pulse data

**Solutions:**
- Wait for BPM estimate to stabilize
- Check `hasEnoughData` flag in console
- Verify pulse detection is working (check beat detection logs)

## Integration Logging Reference

All integration logs are prefixed with `[INTEGRATION]` for easy filtering:

- `📡 Sending prediction request` - API request being sent
- `✅ API response received` - Successful API response
- `✅ Server prediction stored` - Server prediction saved
- `⚠️ API request failed` - API request failed
- `⚠️ Invalid server prediction response` - Malformed response
- `🎯 Prediction selection` - Which prediction source was selected
- `📊 Using prediction source` - Active prediction being used for targets

## Deployment Order

**Recommended order:**

1. **Frontend first** - Deploy client changes
2. **Verify locally** - Test with local prediction server
3. **Update Lambda** (future) - Add `/predict_phrase` support to AWS Lambda
4. **Deploy Lambda** (future) - Update Lambda function code
5. **Verify AWS** (future) - Test with AWS API Gateway endpoint

## Files Changed

- ✅ `player/playerClient/js/game.js` - Integration code and logging
- ✅ `synchronizer/prediction_server.py` - Already supports `/predict_phrase`
- ⚠️ `aws/lambda_function.py` - Needs `/predict_phrase` support (future work)

## Quick Command Reference

```bash
# Deploy frontend
cd aws
python upload-player-client.py --stack-name diamonddrip-production-frontend --invalidate

# Start local server
cd synchronizer
python prediction_server.py

# Check endpoints (AWS)
cd aws
python get-endpoints.py
```

## Future Work

### AWS Lambda Integration

To complete the AWS integration, the Lambda function needs:

1. **Add prediction engine dependencies**:
   - `prediction_engine.py`
   - `prediction_api.py`
   - `slot_prior_model.py`
   - Additional dependencies (numpy, etc.)

2. **Update `lambda_function.py`**:
   - Add `/predict_phrase` route handler
   - Initialize `PredictionAPI` instance
   - Handle batched pulse data
   - Return phrase predictions

3. **Update Lambda package**:
   - Include prediction engine files
   - Update `requirements.txt` with new dependencies
   - Rebuild and upload Lambda package

4. **Testing**:
   - Test with AWS API Gateway
   - Verify prediction accuracy
   - Monitor Lambda execution time and memory

This is a significant change that should be done as a separate task.

