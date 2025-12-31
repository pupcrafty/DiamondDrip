#!/usr/bin/env python3
"""
Slot Prior Model - Bootstrap Mode Predictor

Computes 32-slot priors from database prediction records.
Used for fast bootstrap predictions without requiring real-time pulse fusion.
"""

import json
import numpy as np
from typing import Dict, List, Optional, Tuple
from collections import defaultdict
from datetime import datetime, timedelta


class SlotPriorModel:
    """32-slot priors computed from DB prediction records"""
    
    def __init__(self, threshold: float = 0.5):
        """
        Args:
            threshold: Activation threshold for onset prediction
        """
        self.threshold = threshold
        self.p_onset: Optional[np.ndarray] = None  # [32] probability of onset per slot
        self.median_dur_slots: Optional[np.ndarray] = None  # [32] median duration per slot
        self.confidence: Optional[np.ndarray] = None  # [32] confidence per slot
        self.sample_count = 0
    
    def update_from_patterns(self, patterns: List[List[int]], durations: Optional[List[List[int]]] = None):
        """
        Update priors from 32-slot patterns
        
        Args:
            patterns: List of 32-slot patterns (each is list of 0/1)
            durations: Optional list of 32-slot duration arrays
        """
        if not patterns:
            return
        
        # Aggregate onset probabilities
        slot_counts = np.zeros(32, dtype=np.float32)
        slot_durations = defaultdict(list)
        
        for pattern_idx, pattern in enumerate(patterns):
            if len(pattern) >= 32:
                pattern_32 = pattern[:32]  # Take first 32 slots
                for i, val in enumerate(pattern_32):
                    if val > 0:  # Onset present
                        slot_counts[i] += 1.0
                
                # Collect durations if provided (for this same pattern index)
                if durations and pattern_idx < len(durations):
                    dur_pattern = durations[pattern_idx]
                    if isinstance(dur_pattern, list) and len(dur_pattern) >= 32:
                        dur_32 = dur_pattern[:32]
                        for j, dur in enumerate(dur_32):
                            if dur is not None and dur > 0:
                                slot_durations[j].append(dur)
        
        # Compute probabilities
        self.sample_count = len(patterns)
        self.p_onset = slot_counts / max(1, len(patterns))
        
        # Compute median durations
        self.median_dur_slots = np.zeros(32, dtype=np.int32)
        for i in range(32):
            if i in slot_durations and slot_durations[i]:
                self.median_dur_slots[i] = int(np.median(slot_durations[i]))
            else:
                self.median_dur_slots[i] = 1  # Default to 1 slot
        
        # Confidence is same as probability for now
        self.confidence = self.p_onset.copy()
    
    def update_from_db_records(self, records: List[Dict], pattern_key: str = 'recent_pulse_patterns',
                              duration_key: str = 'recent_pulse_durations'):
        """
        Update priors from database prediction records
        
        Args:
            records: List of database records (dicts)
            pattern_key: Key for pattern data in records
            duration_key: Key for duration data in records
        """
        patterns = []
        durations = []
        
        for record in records:
            # Extract pattern
            pattern_data = record.get(pattern_key)
            if pattern_data:
                if isinstance(pattern_data, str):
                    pattern = json.loads(pattern_data)
                else:
                    pattern = pattern_data
                
                # Take first 32 slots if pattern is longer
                if isinstance(pattern, list) and len(pattern) >= 32:
                    patterns.append(pattern[:32])
                elif isinstance(pattern, list) and len(pattern) > 0:
                    # Pad or truncate to 32
                    pattern_32 = (pattern * ((32 // len(pattern)) + 1))[:32]
                    patterns.append(pattern_32)
            
            # Extract durations
            duration_data = record.get(duration_key)
            if duration_data:
                if isinstance(duration_data, str):
                    dur = json.loads(duration_data)
                else:
                    dur = duration_data
                
                if isinstance(dur, list) and len(dur) >= 32:
                    durations.append(dur[:32])
                elif isinstance(dur, list) and len(dur) > 0:
                    dur_32 = (dur * ((32 // len(dur)) + 1))[:32]
                    durations.append(dur_32)
        
        if patterns:
            self.update_from_patterns(patterns, durations if durations else None)
    
    def is_ready(self) -> bool:
        """Check if model has enough data"""
        return self.p_onset is not None and self.sample_count > 0
    
    def get_prior(self, slot_index: int) -> Tuple[float, int, float]:
        """
        Get prior for a specific slot position (0-31)
        
        Returns:
            (onset_probability, median_duration_slots, confidence)
        """
        if not self.is_ready():
            return (0.0, 1, 0.0)
        
        idx = slot_index % 32
        return (
            float(self.p_onset[idx]),
            int(self.median_dur_slots[idx]),
            float(self.confidence[idx])
        )


class BootstrapPhrasePredictor:
    """Fast 128-slot phrase predictor using slot priors"""
    
    def __init__(self, slot_prior_model: SlotPriorModel, threshold: float = 0.5):
        """
        Args:
            slot_prior_model: SlotPriorModel instance
            threshold: Activation threshold (overrides model threshold if provided)
        """
        self.model = slot_prior_model
        self.threshold = threshold if threshold is not None else slot_prior_model.threshold
    
    def predict_phrase(self) -> Tuple[List[float], List[int], List[float]]:
        """
        Predict next 4-beat phrase (128 slots)
        
        Returns:
            (onset[128], dur_slots[128], confidence[128])
        """
        if not self.model.is_ready():
            # Return empty prediction
            return ([0.0] * 128, [0] * 128, [0.0] * 128)
        
        onset = [0.0] * 128
        dur_slots = [0] * 128
        confidence = [0.0] * 128
        
        for i in range(128):
            slot_pos = i % 32
            p_onset, median_dur, conf = self.model.get_prior(slot_pos)
            
            # Predict onset if probability exceeds threshold
            if p_onset > self.threshold:
                onset[i] = 1.0
                dur_slots[i] = max(1, median_dur)
            
            confidence[i] = conf
        
        return onset, dur_slots, confidence



