# Multi-Source Pulse Prediction Engine

This prediction engine implements the baseline multi-source pulse prediction system as described in `workbook/BackEndPredictor.md` and updated per `workbook/PredictorUpdates.md`.

## Key Architecture Changes (Per PredictorUpdates.md)

- **Batched Transport**: `/predict_phrase` is the primary endpoint for both sending batched pulse data AND receiving predictions
- **Bootstrap Mode (Default)**: Uses slot priors computed from database prediction records (fast, no per-pulse calls)
- **Realtime Mode (Optional)**: Uses event fusion + tempo tracking (requires clock sync)
- **No Async Training by Default**: Training is done offline via scripts, not in background threads

## Architecture

The system consists of several components:

1. **Device Clock Sync** (`DeviceClockSync`) - Converts device timestamps to server time using offset and drift estimation
2. **Event Fusion** (`EventFusion`) - Clusters duplicate pulses from multiple sources into canonical events
3. **Tempo Tracker** (`TempoTracker`) - Maintains shared rhythmic clock (BPM + phase) using PLL
4. **Grid Encoder** (`GridEncoder`) - Encodes events onto 32nd-note grid (128 slots per 4-beat phrase)
5. **Predictor** (`DeterministicPredictor`) - Predicts next phrase using deterministic baseline algorithm

## API Endpoints

### POST /predict_phrase
**Primary endpoint** - Batched transport for both sending pulse data AND receiving predictions.

**Request:**
```json
{
  "client_now_ms": 1234567890.5,  // Optional
  "server_offset_estimate_ms": 0.0,  // Optional
  "recentPulseTimestamps": [1234567890.0, ...],  // Optional, batched pulses
  "recentPulseDurations": [150.0, ...],  // Optional
  "recentPulsePatterns": [[0,1,0,...], ...],  // Optional, 32-slot patterns
  "recentPulseDurationsSlots": [[0,4,0,...], ...],  // Optional
  "currentBPM": 128.25,  // Optional
  "bpmHistory": [128.0, 128.5, ...],  // Optional
  "device_id": "string",  // Optional
  "session_id": "string",  // Optional
  "sequence_id": 123  // Optional
}
```

**Note**: Client should buffer pulses and send them batched with this call (once per beat or every 500ms). Do NOT call per pulse.

**Response:**
```json
{
  "status": "success",
  "phrase_start_server_ms": 1234567890.5,
  "bpm": 128.25,
  "slot_ms": 14.62,
  "slots_per_beat": 32,
  "phrase_beats": 4,
  "onset": [0, 0, 1, 0, ...],  // 128 elements (0 or 1)
  "dur_slots": [0, 0, 4, 0, ...],  // 128 elements (duration in slots)
  "confidence": [0.1, 0.1, 0.8, ...]  // 128 elements (0.0 to 1.0)
}
```

### POST /pulse
Submit a pulse event from a device.

**Request:**
```json
{
  "device_id": "device_hash_string",
  "source_id": "optional_source_id",
  "t_device_ms": 1234567890.5,
  "dur_ms": 150.0,
  "meta": {
    "confidence": 0.8,
    "band": "low"
  }
}
```

**Response:**
```json
{
  "status": "success",
  "server_time_ms": 1234567890.5,
  "canonical_event": {
    "t_server_ms": 1234567890.5,
    "dur_ms": 150.0,
    "conf": 3,
    "spread_ms": 5.2
  }
}
```

### GET /status
Get prediction engine status.

**Response:**
```json
{
  "status": "success",
  "engine_state": {
    "bpm": 128.25,
    "beat_ms": 468.75,
    "t_last_beat": 1234567890.5,
    "num_canonical_events": 42,
    "num_devices": 3,
    "last_update_time": 1234567890.5
  },
  "training": {
    "active": false,
    "samples_collected": 150,
    "last_train_time": 1234567800.0
  }
}
```

## Usage

### Starting the Server

The prediction engine is automatically initialized when you start the prediction server:

```bash
python prediction_server.py
```

Or on Windows:
```bash
start-server.bat
```

### Submitting Pulses

Pulses can be submitted via the `/pulse` endpoint. The engine will:
1. Convert device time to server time
2. Cluster with other pulses from different sources
3. Update tempo/phase tracking
4. Update grid history
5. Store in database for training

### Getting Predictions

Call `/predict_phrase` to get the next predicted phrase. The response includes:
- Absolute server time anchor (`phrase_start_server_ms`) for cross-device synchronization
- BPM and slot timing
- 128-slot phrase with onsets, durations, and confidence

## Operating Modes

### Bootstrap Mode (Default)
- Uses slot priors computed from database prediction records
- Fast predictions (< 10ms)
- No per-pulse processing required
- Works with existing `/prediction` endpoint data
- **Recommended for initial deployment**

### Realtime Mode (Optional)
- Uses event fusion + tempo tracking
- Requires clock sync and server-time pulse data
- More accurate but requires more setup
- Use only when clock sync + pulse volume is healthy

## Training System

**Async training is disabled by default** (per PredictorUpdates.md). Training is done offline via scripts:

### Offline Training Scripts

1. **`scripts/recompute_slot_priors.py`** - Recompute 32-slot priors from database
   ```bash
   python scripts/recompute_slot_priors.py [--limit 10000] [--hours 24]
   ```

2. **`scripts/train_model_from_db.py`** - (Future) Train ML models from database

### How Slot Priors Work

- Computed from `recentPulsePatterns` in database prediction records
- Each of 32 slots has:
  - `p_onset[slot]`: Probability of onset (0.0 to 1.0)
  - `median_dur_slots[slot]`: Median duration in slots
  - `confidence[slot]`: Confidence score
- Prediction repeats 32-slot pattern 4 times (128 slots total)

## Configuration

### Engine Parameters

Default parameters (can be adjusted in `PredictionEngine.__init__`):
- `initial_bpm`: 120.0
- `window_ms`: 30.0 (event fusion clustering window)

### PLL Parameters

In `TempoTracker`:
- `phase_gain`: 0.2 (phase correction speed)
- `tempo_gain`: 0.001 (tempo correction speed, very small)
- BPM range: 60-200

### Predictor Parameters

In `DeterministicPredictor`:
- `threshold`: 0.5 (activation threshold)

## Database Schema

The engine uses two tables:

### `sources`
- `id`: Source ID
- `hashed_ip`: Hashed device identifier
- `emoji`: Assigned emoji for visualization

### `pulse_timestamps`
- `id`: Pulse ID
- `source_id`: Reference to sources table
- `bpm`: BPM at time of pulse
- `pulse`: Timestamp of pulse
- `duration_ms`: Duration of pulse

## Performance

- **Prediction Latency**: < 10ms (bootstrap mode)
- **Training**: Offline only (no background threads)
- **Memory**: Minimal (slot priors are small arrays)
- **Network**: Batched calls (once per beat or every 500ms), not per-pulse

## Future Enhancements

1. **ML Models**: Implement TCN or GRU models for better predictions
2. **Clock Sync**: Add NTP-like ping exchange for better device sync
3. **Adaptive Windows**: Scale clustering window with tempo
4. **Microtiming**: Add residual_ms for sub-slot timing adjustments

