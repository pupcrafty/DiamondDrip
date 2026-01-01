#!/usr/bin/env python3
"""
Prediction API Server
Integrates prediction engine with HTTP API for frontend requests

Endpoints:
- POST /predict_phrase - Get next predicted phrase (low latency)
- POST /pulse - Submit pulse event from device
- GET /status - Get engine status
"""

import json
import time
from typing import Dict, Any, Optional, List
from datetime import datetime
from prediction_engine import PredictionEngine, PulseEvent, PhraseOutput, PredictionMode
from slot_prior_model import SlotPriorModel, BootstrapPhrasePredictor


class PredictionAPI:
    """API wrapper for prediction engine"""
    
    def __init__(self, database=None, initial_bpm: float = 120.0, 
                 mode: PredictionMode = PredictionMode.BOOTSTRAP, enable_async_training: bool = False):
        """
        Args:
            database: Database connection (optional, for training data)
            initial_bpm: Starting BPM estimate
            mode: Prediction mode (BOOTSTRAP or REALTIME)
            enable_async_training: Enable async training (default: False, per PredictorUpdates.md)
        """
        self.engine = PredictionEngine(initial_bpm=initial_bpm, mode=mode)
        self.database = database
        self.mode = mode
        
        # Bootstrap mode: initialize slot prior model
        if mode == PredictionMode.BOOTSTRAP:
            self.slot_prior_model = SlotPriorModel(threshold=0.5)
            self.bootstrap_predictor = BootstrapPhrasePredictor(self.slot_prior_model)
            self.engine.set_bootstrap_predictor(self.bootstrap_predictor)
            
            # Load priors from database if available
            if database:
                self._load_priors_from_db()
        else:
            self.slot_prior_model = None
            self.bootstrap_predictor = None
        
        # Training system (optional, disabled by default)
        self.enable_async_training = enable_async_training
        if enable_async_training:
            from training_system import TrainingDataCollector, AsyncTrainer
            self.data_collector = TrainingDataCollector()
            self.trainer = AsyncTrainer(self.data_collector)
            if database:
                self.trainer.start()
                print("[API] Async training started")
        else:
            self.data_collector = None
            self.trainer = None
    
    def handle_pulse(self, request_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle incoming pulse event
        
        Request:
        {
            "device_id": "string",
            "source_id": "string" (optional),
            "t_device_ms": float,
            "dur_ms": float,
            "meta": {} (optional)
        }
        
        Returns:
        {
            "status": "success",
            "canonical_event": {...} (if one was created)
        }
        """
        try:
            # Extract pulse data
            device_id = request_data.get('device_id', 'unknown')
            source_id = request_data.get('source_id')
            t_device_ms = float(request_data.get('t_device_ms', time.time() * 1000.0))
            dur_ms = float(request_data.get('dur_ms', 100.0))
            meta = request_data.get('meta', {})
            
            # Create pulse event
            pulse = PulseEvent(
                device_id=device_id,
                source_id=source_id,
                t_device_ms=t_device_ms,
                dur_ms=dur_ms,
                meta=meta
            )
            
            # Process through engine
            server_time_ms = time.time() * 1000.0
            canonical = self.engine.process_pulse(pulse, server_time_ms=server_time_ms)
            
            # Store in database if available
            if self.database and canonical:
                self._store_pulse_in_db(pulse, canonical, server_time_ms)
            
            response = {
                "status": "success",
                "server_time_ms": server_time_ms
            }
            
            if canonical:
                response["canonical_event"] = {
                    "t_server_ms": canonical.t_server_ms,
                    "dur_ms": canonical.dur_ms,
                    "conf": canonical.conf,
                    "spread_ms": canonical.spread_ms
                }
            
            return response
            
        except Exception as e:
            return {
                "status": "error",
                "message": str(e)
            }
    
    def handle_predict_phrase(self, request_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Predict next 4-beat phrase (BOTH ingest + predict)
        
        Request:
        {
            "client_now_ms": float (optional),
            "server_offset_estimate_ms": float (optional),
            "recentPulseTimestamps": [float, ...] (optional),
            "recentPulseDurations": [float, ...] (optional),
            "recentPulsePatterns": [[int, ...], ...] (optional, 32-slot patterns),
            "recentPulseDurationsSlots": [[int, ...], ...] (optional),
            "currentBPM": float (optional),
            "bpmHistory": [float, ...] (optional),
            "device_id": string (optional),
            "session_id": string (optional),
            "sequence_id": int (optional)
        }
        
        Returns:
        {
            "status": "success",
            "phrase_start_server_ms": float,
            "bpm": float,
            "slot_ms": float,
            "slots_per_beat": 32,
            "phrase_beats": 4,
            "onset": [0,0,1,...] (128 elements),
            "dur_slots": [0,0,4,...] (128 elements),
            "confidence": [0.1,0.1,0.8,...] (128 elements)
        }
        """
        try:
            print(f"[API] Received /predict_phrase request at {time.time()}")
            server_time_ms = time.time() * 1000.0
            received_at_server_ms = server_time_ms
            
            if request_data is None:
                request_data = {}
            
            sequence_id = request_data.get('sequence_id', 'unknown')
            print(f"[API] Processing sequence_id: {sequence_id}")
            
            # 1. INGEST: Store batched data to database
            print(f"[API] Step 1: Ingesting data to database...")
            record_id = None
            if self.database:
                record_id = self._ingest_batched_data(request_data, received_at_server_ms)
            print(f"[API] Step 1: Complete (record_id={record_id})")
            
            # 2. UPDATE PREDICTOR STATE
            print(f"[API] Step 2: Updating predictor state...")
            current_bpm = request_data.get('currentBPM')
            if current_bpm:
                current_bpm = float(current_bpm)
            
            # Bootstrap mode: update slot priors from patterns
            if self.mode == PredictionMode.BOOTSTRAP and self.slot_prior_model:
                patterns = request_data.get('recentPulsePatterns', [])
                durations = request_data.get('recentPulseDurationsSlots', [])
                if patterns:
                    print(f"[API] Updating slot priors from {len(patterns)} patterns")
                    self.slot_prior_model.update_from_patterns(patterns, durations if durations else None)
            
            # Realtime mode: process pulses if provided
            if self.mode == PredictionMode.REALTIME:
                pulse_timestamps = request_data.get('recentPulseTimestamps', [])
                pulse_durations = request_data.get('recentPulseDurations', [])
                device_id = request_data.get('device_id', 'unknown')
                print(f"[API] Processing {len(pulse_timestamps)} pulses in realtime mode")
                
                for i, t_pulse in enumerate(pulse_timestamps):
                    dur = pulse_durations[i] if i < len(pulse_durations) else 100.0
                    pulse = PulseEvent(
                        device_id=device_id,
                        source_id=None,
                        t_device_ms=float(t_pulse),
                        dur_ms=float(dur)
                    )
                    self.engine.process_pulse(pulse, server_time_ms=server_time_ms)
            print(f"[API] Step 2: Complete")
            
            # 3. RETURN: Get prediction
            print(f"[API] Step 3: Getting prediction from engine...")
            phrase = self.engine.predict_phrase(server_time_ms=server_time_ms, bpm=current_bpm)
            print(f"[API] Step 3: Complete, phrase={phrase is not None}")
            
            if phrase is None:
                print(f"[API] No prediction available (not enough data)")
                return {
                    "status": "error",
                    "message": "Not enough data for prediction"
                }
            
            # 4. STORE: Update database record with prediction result
            if self.database and record_id is not None:
                try:
                    # Convert onset (128-element array) to boolean pattern for storage
                    # The onset array contains 0s and 1s, we need to convert to boolean
                    current_prediction = [bool(x) for x in phrase.onset] if phrase.onset else None
                    current_prediction_durations = phrase.dur_slots if phrase.dur_slots else None
                    
                    self.database.update_prediction(
                        prediction_id=record_id,
                        current_prediction=current_prediction,
                        current_prediction_durations=current_prediction_durations
                    )
                    print(f"[API] Step 4: Stored prediction result to database (record_id={record_id})")
                except Exception as e:
                    print(f"[API] Warning: Failed to store prediction result: {e}")
                    # Don't fail the request if DB update fails
            
            # Convert to JSON-serializable format
            print(f"[API] Returning success response for sequence_id: {sequence_id}")
            return {
                "status": "success",
                "phrase_start_server_ms": phrase.phrase_start_server_ms,
                "bpm": phrase.bpm,
                "slot_ms": phrase.slot_ms,
                "slots_per_beat": phrase.slots_per_beat,
                "phrase_beats": phrase.phrase_beats,
                "onset": phrase.onset,
                "dur_slots": phrase.dur_slots,
                "confidence": phrase.confidence
            }
            
        except Exception as e:
            print(f"[API] ERROR in handle_predict_phrase: {e}")
            import traceback
            traceback.print_exc()
            return {
                "status": "error",
                "message": str(e)
            }
    
    def handle_status(self) -> Dict[str, Any]:
        """Get engine status"""
        state = self.engine.get_state()
        response = {
            "status": "success",
            "engine_state": state,
            "mode": self.mode.value,
            "bootstrap_ready": self.slot_prior_model.is_ready() if self.slot_prior_model else False
        }
        
        if self.enable_async_training and self.trainer:
            response["training"] = {
                "active": self.trainer.is_training(),
                "samples_collected": self.data_collector.get_count() if self.data_collector else 0,
                "last_train_time": self.trainer.last_train_time
            }
        
        return response
    
    def handle_debug_state(self) -> Dict[str, Any]:
        """Get detailed engine state for debugging/visualization"""
        try:
            state = self.engine.get_state()
            
            # Add bootstrap predictor state if available
            if self.mode == PredictionMode.BOOTSTRAP and self.slot_prior_model:
                bootstrap_state = {
                    "ready": self.slot_prior_model.is_ready(),
                    "sample_count": self.slot_prior_model.sample_count
                }
                if self.slot_prior_model.is_ready():
                    bootstrap_state["p_onset"] = [float(x) for x in self.slot_prior_model.p_onset] if self.slot_prior_model.p_onset is not None else []
                    bootstrap_state["median_dur_slots"] = [int(x) for x in self.slot_prior_model.median_dur_slots] if self.slot_prior_model.median_dur_slots is not None else []
                    bootstrap_state["confidence"] = [float(x) for x in self.slot_prior_model.confidence] if self.slot_prior_model.confidence is not None else []
                state["bootstrap_predictor"] = bootstrap_state
            else:
                state["bootstrap_predictor"] = None
            
            return {
                "status": "success",
                "engine_state": state
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e)
            }
    
    def handle_pipeline_trace(self, limit: int = 10) -> Dict[str, Any]:
        """Get recent pipeline traces"""
        try:
            traces = self.engine.get_pipeline_traces(limit=limit)
            return {
                "status": "success",
                "traces": traces
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e)
            }
    
    def handle_prediction_history(self, limit: int = 10) -> Dict[str, Any]:
        """Get recent prediction history with context"""
        try:
            if not self.database:
                return {
                    "status": "error",
                    "message": "Database not available"
                }
            
            # Get recent predictions from database
            records = self.database.get_recent_predictions(limit=limit)
            
            predictions = []
            for record in records:
                # Parse JSON fields
                bpm_history = json.loads(record.get('bpm_history', '[]')) if isinstance(record.get('bpm_history'), str) else record.get('bpm_history', [])
                patterns = json.loads(record.get('recent_pulse_patterns', '[]')) if isinstance(record.get('recent_pulse_patterns'), str) else record.get('recent_pulse_patterns', [])
                
                predictions.append({
                    "id": record.get('id'),
                    "timestamp": record.get('created_at'),
                    "input": {
                        "bpm": record.get('current_bpm'),
                        "bpm_history_count": len(bpm_history) if bpm_history else 0,
                        "pattern_count": len(patterns) if patterns else 0
                    },
                    "output": {
                        "avg_bpm": record.get('current_bpm')
                    }
                })
            
            return {
                "status": "success",
                "predictions": predictions
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e)
            }
    
    def _ingest_batched_data(self, request_data: Dict[str, Any], received_at_server_ms: float):
        """Ingest batched data from /predict_phrase request into database
        
        Returns:
            int: The database record ID, or None if database not available or insert failed
        """
        try:
            if not self.database:
                return None
            
            # Extract device/session info
            device_id = request_data.get('device_id', 'unknown')
            session_id = request_data.get('session_id')
            sequence_id = request_data.get('sequence_id')
            
            # Get or create source
            hashed_ip = device_id  # Use device_id as hashed_ip for now
            source_id = self.database.get_or_create_source(hashed_ip)
            
            # Prepare data for storage (similar to old /prediction endpoint)
            data = {
                'currentBPM': request_data.get('currentBPM'),
                'bpmHistory': request_data.get('bpmHistory', []),
                'recentPulsePatterns': request_data.get('recentPulsePatterns', []),
                'recentPulseDurations': request_data.get('recentPulseDurationsSlots', []),
                'recentPulseTimestamps': request_data.get('recentPulseTimestamps', []),
                'recentPulseDurationsMs': request_data.get('recentPulseDurations', [])
            }
            
            # Store as prediction record (for bootstrap mode to use)
            client_timestamp = datetime.fromtimestamp(received_at_server_ms / 1000.0).isoformat()
            server_timestamp = datetime.fromtimestamp(received_at_server_ms / 1000.0).isoformat()
            
            record_id = self.database.insert_prediction(
                client_timestamp=client_timestamp,
                server_timestamp=server_timestamp,
                data=data,
                hashed_ip=hashed_ip
            )
            
            return record_id
            
        except Exception as e:
            print(f"[API] Error ingesting batched data: {e}")
            # Don't fail the request if DB write fails
            return None
    
    def _load_priors_from_db(self, limit: int = 10000, hours: int = 24):
        """Load slot priors from recent database records"""
        try:
            if not self.database:
                return
            
            # Get recent predictions
            records = self.database.get_recent_predictions(limit=limit)
            
            if records:
                self.slot_prior_model.update_from_db_records(records)
                print(f"[API] Loaded slot priors from {len(records)} database records")
            
        except Exception as e:
            print(f"[API] Error loading priors from DB: {e}")
    
    def _store_pulse_in_db(self, pulse: PulseEvent, canonical, server_time_ms: float):
        """Store pulse in database for training (used by /pulse endpoint)"""
        try:
            if not self.database:
                return
            
            # Get or create source
            source_id = self.database.get_or_create_source(pulse.device_id)
            if source_id is None:
                return
            
            # Estimate BPM from engine state
            bpm = self.engine.tempo_tracker.bpm if self.engine.tempo_tracker.bpm else 120.0
            
            # Convert server_time_ms to datetime
            # Handle both datetime objects and timestamps
            if isinstance(server_time_ms, (int, float)):
                pulse_time = datetime.fromtimestamp(server_time_ms / 1000.0)
            else:
                pulse_time = server_time_ms
            
            duration_ms = int(canonical.dur_ms)
            
            # Insert pulse timestamp
            pulses = [(source_id, bpm, pulse_time, duration_ms)]
            self.database.insert_pulse_timestamps(pulses)
            
        except Exception as e:
            print(f"[API] Error storing pulse in DB: {e}")
            # Don't fail the request if DB write fails

