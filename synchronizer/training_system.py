#!/usr/bin/env python3
"""
Asynchronous Training System for Prediction Models

Trains models in background threads without blocking prediction requests.
"""

import time
import threading
import queue
import json
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from datetime import datetime, timedelta
import numpy as np
from pathlib import Path
import pickle
from prediction_engine import PulseEvent


@dataclass
class TrainingSample:
    """Training sample: history -> next phrase"""
    phrase_start_server_ms: float
    bpm: float
    slot_ms: float
    hist_onset: List[float]
    hist_hold: List[float]
    hist_conf: List[float]
    y_onset: List[float]  # Ground truth for next 128 slots
    y_hold: List[float]   # Ground truth for next 128 slots
    y_conf: List[float]    # Ground truth confidence


class TrainingDataCollector:
    """Collects training samples from prediction engine"""
    
    def __init__(self, min_samples: int = 100, max_samples: int = 10000):
        """
        Args:
            min_samples: Minimum samples before training
            max_samples: Maximum samples to keep in memory
        """
        self.min_samples = min_samples
        self.max_samples = max_samples
        self.samples: List[TrainingSample] = []
        self.lock = threading.Lock()
    
    def add_sample(self, sample: TrainingSample):
        """Add a training sample"""
        with self.lock:
            self.samples.append(sample)
            if len(self.samples) > self.max_samples:
                # Remove oldest samples
                self.samples = self.samples[-self.max_samples:]
    
    def get_samples(self, count: Optional[int] = None) -> List[TrainingSample]:
        """Get training samples"""
        with self.lock:
            if count is None:
                return self.samples.copy()
            return self.samples[-count:] if count <= len(self.samples) else self.samples.copy()
    
    def get_count(self) -> int:
        """Get number of samples"""
        with self.lock:
            return len(self.samples)
    
    def clear(self):
        """Clear all samples"""
        with self.lock:
            self.samples.clear()


class AsyncTrainer:
    """Asynchronous model trainer"""
    
    def __init__(self, data_collector: TrainingDataCollector, 
                 model_dir: Path = None,
                 train_interval_seconds: int = 300):  # Train every 5 minutes
        """
        Args:
            data_collector: Training data collector
            model_dir: Directory to save trained models
            train_interval_seconds: How often to retrain (in seconds)
        """
        self.data_collector = data_collector
        self.model_dir = model_dir or Path(__file__).parent / "models"
        self.model_dir.mkdir(exist_ok=True)
        self.train_interval = train_interval_seconds
        
        self.training = False
        self.last_train_time = None
        self.train_thread: Optional[threading.Thread] = None
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
    
    def start(self):
        """Start background training thread"""
        if self.train_thread is None or not self.train_thread.is_alive():
            self.stop_event.clear()
            self.train_thread = threading.Thread(target=self._training_loop, daemon=True)
            self.train_thread.start()
    
    def stop(self):
        """Stop training thread"""
        self.stop_event.set()
        if self.train_thread:
            self.train_thread.join(timeout=5.0)
    
    def _training_loop(self):
        """Background training loop"""
        while not self.stop_event.is_set():
            try:
                # Check if we have enough samples
                sample_count = self.data_collector.get_count()
                
                if sample_count >= self.data_collector.min_samples:
                    # Check if it's time to train
                    should_train = False
                    if self.last_train_time is None:
                        should_train = True
                    else:
                        elapsed = time.time() - self.last_train_time
                        if elapsed >= self.train_interval:
                            should_train = True
                    
                    if should_train:
                        self._train_model()
                
                # Sleep for a bit before checking again
                self.stop_event.wait(timeout=60.0)  # Check every minute
                
            except Exception as e:
                print(f"Error in training loop: {e}")
                import traceback
                traceback.print_exc()
                time.sleep(60.0)  # Wait before retrying
    
    def _train_model(self):
        """Train the model (placeholder - implement actual training)"""
        with self.lock:
            self.training = True
        
        try:
            print(f"[TRAINER] Starting model training...")
            samples = self.data_collector.get_samples()
            print(f"[TRAINER] Training on {len(samples)} samples")
            
            # TODO: Implement actual model training here
            # For now, just save the deterministic predictor state
            # In the future, this would train a TCN or GRU model
            
            # Save training metadata
            metadata = {
                'trained_at': datetime.now().isoformat(),
                'num_samples': len(samples),
                'model_type': 'deterministic',  # Will be 'tcn' or 'gru' later
            }
            
            metadata_path = self.model_dir / "training_metadata.json"
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)
            
            print(f"[TRAINER] Training complete (deterministic baseline)")
            self.last_train_time = time.time()
            
        except Exception as e:
            print(f"[TRAINER] Training error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            with self.lock:
                self.training = False
    
    def is_training(self) -> bool:
        """Check if training is in progress"""
        with self.lock:
            return self.training


class TrainingDataBuilder:
    """Builds training samples from database pulse data"""
    
    def __init__(self, database, prediction_engine):
        """
        Args:
            database: Database connection (from database.py)
            prediction_engine: PredictionEngine instance
        """
        self.database = database
        self.engine = prediction_engine
    
    def build_samples_from_database(self, time_range_hours: float = 24.0, 
                                    min_activity: int = 10) -> List[TrainingSample]:
        """
        Build training samples from database pulse data
        
        Args:
            time_range_hours: How far back to look for data
            min_activity: Minimum number of pulses required per sample
        
        Returns:
            List of TrainingSample objects
        """
        samples = []
        
        try:
            # Get pulse timestamps from database
            with self.database.get_connection() as conn:
                with conn.cursor() as cursor:
                    # Get pulses from last N hours
                    cutoff_time = datetime.now() - timedelta(hours=time_range_hours)
                    
                    cursor.execute('''
                        SELECT pt.source_id, pt.bpm, pt.pulse, pt.duration_ms,
                               s.hashed_ip as device_id
                        FROM pulse_timestamps pt
                        JOIN sources s ON pt.source_id = s.id
                        WHERE pt.pulse >= %s
                        ORDER BY pt.pulse ASC
                    ''', (cutoff_time,))
                    
                    rows = cursor.fetchall()
                    
                    if len(rows) < min_activity:
                        print(f"[TRAINING] Not enough pulse data: {len(rows)} pulses")
                        return samples
                    
                    # Process pulses through engine to build history
                    # Reset engine state
                    self.engine = type(self.engine)(initial_bpm=120.0)
                    
                    # Process all pulses
                    for row in rows:
                        device_id = row[3]  # hashed_ip
                        bpm = float(row[1])
                        pulse_time = row[2]  # datetime
                        duration_ms = int(row[4]) if row[4] else 100
                        
                        # Convert datetime to milliseconds
                        pulse_ms = pulse_time.timestamp() * 1000.0
                        
                        # Create pulse event
                        pulse = PulseEvent(
                            device_id=device_id,
                            source_id=None,
                            t_device_ms=pulse_ms,  # Assume already in server time for now
                            dur_ms=duration_ms
                        )
                        
                        # Process through engine
                        self.engine.process_pulse(pulse, server_time_ms=pulse_ms)
                    
                    # Now extract training samples from the engine's history
                    # This is a simplified version - in practice, you'd want to
                    # slide a window over the data
                    
                    print(f"[TRAINING] Processed {len(rows)} pulses")
                    
        except Exception as e:
            print(f"[TRAINING] Error building samples: {e}")
            import traceback
            traceback.print_exc()
        
        return samples

