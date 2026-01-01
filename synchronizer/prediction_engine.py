#!/usr/bin/env python3
"""
Multi-Source Pulse Prediction Engine
Implements the baseline prediction system from BackEndPredictor.md

Components:
1. Device clock sync (offset + drift estimation)
2. Event fusion (temporal clustering)
3. Tempo/phase tracking (PLL)
4. Grid encoding (32nd slots)
5. Prediction (deterministic baseline + ML models)
"""

import time
import json
import threading
import queue
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
from collections import deque
from datetime import datetime, timedelta
import numpy as np
from enum import Enum


class PredictionMode(Enum):
    """Prediction model types"""
    BOOTSTRAP = "bootstrap"  # Uses slot priors from DB
    REALTIME = "realtime"  # Uses event fusion + tempo tracking
    DETERMINISTIC = "deterministic"  # Legacy
    TCN = "tcn"
    GRU = "gru"


@dataclass
class PulseEvent:
    """Raw pulse event from device"""
    device_id: str
    source_id: Optional[str]
    t_device_ms: float
    dur_ms: float
    meta: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ServerEvent:
    """Event normalized to server time"""
    t_server_ms: float
    dur_ms: float
    device_id: str
    source_id: Optional[str]
    quality: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CanonicalEvent:
    """Fused canonical event after clustering"""
    t_server_ms: float
    dur_ms: float
    conf: int  # number of sources
    spread_ms: float  # std or MAD of timestamps
    contributors: List[str]  # device/source ids


@dataclass
class PhraseOutput:
    """Predicted phrase output"""
    phrase_start_server_ms: float
    bpm: float
    slot_ms: float
    slots_per_beat: int = 32
    phrase_beats: int = 4
    onset: List[float] = field(default_factory=lambda: [0.0] * 128)
    dur_slots: List[int] = field(default_factory=lambda: [0] * 128)
    confidence: List[float] = field(default_factory=lambda: [0.0] * 128)
    residual_ms: Optional[List[float]] = None


class DeviceClockSync:
    """Device clock synchronization (offset + drift estimation)"""
    
    def __init__(self, alpha: float = 0.1):
        """
        Args:
            alpha: EMA smoothing factor for offset (0.05-0.2 recommended)
        """
        self.alpha = alpha
        self.offsets: Dict[str, float] = {}  # device_id -> offset_ms
        self.drifts: Dict[str, float] = {}  # device_id -> drift (a in t_server = a*t_device + b)
        self.offset_history: Dict[str, deque] = {}  # for drift estimation
        self.max_history = 50
    
    def update_from_ping(self, device_id: str, t0_device: float, t1_server: float, t2_device: float):
        """
        Update clock sync from NTP-like ping exchange
        
        Args:
            device_id: Device identifier
            t0_device: Device timestamp when ping sent
            t1_server: Server timestamp when ping received
            t2_device: Device timestamp when response received
        """
        rtt = t2_device - t0_device
        one_way = rtt / 2.0
        new_offset = t1_server - (t0_device + one_way)
        
        # Update offset with EMA
        if device_id not in self.offsets:
            self.offsets[device_id] = new_offset
            self.drifts[device_id] = 1.0  # no drift initially
            self.offset_history[device_id] = deque(maxlen=self.max_history)
        else:
            self.offsets[device_id] = (1 - self.alpha) * self.offsets[device_id] + self.alpha * new_offset
        
        # Store for drift estimation
        self.offset_history[device_id].append((t0_device, new_offset))
        
        # Estimate drift if we have enough history
        if len(self.offset_history[device_id]) >= 10:
            self._estimate_drift(device_id)
    
    def _estimate_drift(self, device_id: str):
        """Estimate clock drift using linear regression"""
        history = list(self.offset_history[device_id])
        if len(history) < 10:
            return
        
        # Simple linear regression: t_server = a * t_device + b
        t_devices = np.array([h[0] for h in history])
        offsets = np.array([h[1] for h in history])
        
        # Fit line: offset = drift * t_device + base_offset
        # But we want: t_server = t_device + offset
        # So: t_server = t_device + (drift * t_device + base_offset)
        #     t_server = (1 + drift) * t_device + base_offset
        
        # For simplicity, estimate drift from offset changes over time
        if len(t_devices) > 1:
            dt = t_devices[-1] - t_devices[0]
            if dt > 0:
                doffset = offsets[-1] - offsets[0]
                # Drift is the rate of offset change
                self.drifts[device_id] = 1.0 + (doffset / dt) * 1e-3  # convert to per-ms
    
    def convert_to_server_time(self, device_id: str, t_device_ms: float) -> float:
        """Convert device time to server time"""
        if device_id not in self.offsets:
            # No sync data, assume no offset (will be inaccurate)
            return t_device_ms
        
        offset = self.offsets[device_id]
        drift = self.drifts.get(device_id, 1.0)
        
        # Apply drift and offset
        return drift * t_device_ms + offset


class EventFusion:
    """Temporal clustering to fuse duplicate pulses from multiple sources"""
    
    def __init__(self, window_ms: float = 30.0):
        """
        Args:
            window_ms: Clustering half-window in milliseconds
        """
        self.window_ms = window_ms
        self.clusters: List[List[ServerEvent]] = []
        self.canonical_events: deque = deque(maxlen=1000)  # Keep recent canonical events
    
    def add_event(self, event: ServerEvent) -> Optional[CanonicalEvent]:
        """
        Add event and return canonical event if cluster is finalized
        
        Returns:
            CanonicalEvent if cluster is ready, None otherwise
        """
        # Find existing cluster within window
        matched_cluster = None
        for cluster in self.clusters:
            if cluster:
                canonical_time = np.median([e.t_server_ms for e in cluster])
                if abs(event.t_server_ms - canonical_time) <= self.window_ms:
                    matched_cluster = cluster
                    break
        
        if matched_cluster:
            matched_cluster.append(event)
        else:
            # Create new cluster
            self.clusters.append([event])
        
        # Finalize clusters older than 2*window behind current time
        current_time = event.t_server_ms
        finalized = []
        
        for cluster in list(self.clusters):
            if cluster:
                canonical_time = np.median([e.t_server_ms for e in cluster])
                if current_time - canonical_time > 2 * self.window_ms:
                    # Finalize this cluster
                    canonical = self._create_canonical(cluster)
                    if canonical:
                        finalized.append(canonical)
                        self.canonical_events.append(canonical)
                    self.clusters.remove(cluster)
        
        return finalized[0] if finalized else None
    
    def _create_canonical(self, cluster: List[ServerEvent]) -> Optional[CanonicalEvent]:
        """Create canonical event from cluster"""
        if not cluster:
            return None
        
        timestamps = [e.t_server_ms for e in cluster]
        durations = [e.dur_ms for e in cluster]
        
        t_canonical = float(np.median(timestamps))
        dur_canonical = float(np.median(durations))
        spread_ms = float(np.std(timestamps)) if len(timestamps) > 1 else 0.0
        contributors = [f"{e.device_id}:{e.source_id}" if e.source_id else e.device_id 
                       for e in cluster]
        
        return CanonicalEvent(
            t_server_ms=t_canonical,
            dur_ms=dur_canonical,
            conf=len(cluster),
            spread_ms=spread_ms,
            contributors=contributors
        )
    
    def get_recent_events(self, since_ms: float) -> List[CanonicalEvent]:
        """Get canonical events since given time"""
        return [e for e in self.canonical_events if e.t_server_ms >= since_ms]


class TempoTracker:
    """Tempo and phase tracking using PLL (Phase-Locked Loop)"""
    
    def __init__(self, initial_bpm: float = 120.0, phase_gain: float = 0.2, tempo_gain: float = 0.001):
        """
        Args:
            initial_bpm: Starting BPM estimate
            phase_gain: PLL phase correction gain (0.1-0.3)
            tempo_gain: PLL tempo correction gain (0.0001-0.01, very small)
        """
        self.bpm = initial_bpm
        self.beat_ms = 60_000.0 / initial_bpm
        self.t_last_beat = None  # Server time of last beat boundary
        self.phase_gain = phase_gain
        self.tempo_gain = tempo_gain
        self.min_bpm = 60.0
        self.max_bpm = 200.0
    
    def update(self, event: CanonicalEvent):
        """Update tempo/phase from canonical event"""
        t_e = event.t_server_ms
        
        if self.t_last_beat is None:
            # Initialize to first event
            self.t_last_beat = t_e
            return
        
        # Predict nearest beat boundary
        k = round((t_e - self.t_last_beat) / self.beat_ms)
        t_pred = self.t_last_beat + k * self.beat_ms
        
        # Compute timing error
        err = t_e - t_pred
        
        # Update phase (shift beat boundary)
        self.t_last_beat += self.phase_gain * err
        
        # Update tempo slowly
        if k != 0:
            # Adjust tempo based on inter-onset interval
            tempo_adjustment = self.tempo_gain * err * np.sign(k)
            self.beat_ms += tempo_adjustment
            
            # Update BPM and clamp
            self.bpm = 60_000.0 / self.beat_ms
            self.bpm = max(self.min_bpm, min(self.max_bpm, self.bpm))
            self.beat_ms = 60_000.0 / self.bpm
    
    def get_slot_ms(self) -> float:
        """Get slot duration in milliseconds (32nd note)"""
        return self.beat_ms / 32.0
    
    def get_next_phrase_start(self, t_now_ms: float) -> float:
        """Get next phrase start time aligned to grid"""
        if self.t_last_beat is None:
            return t_now_ms
        
        slot_ms = self.get_slot_ms()
        slot_idx_now = int(np.ceil((t_now_ms - self.t_last_beat) / slot_ms))
        
        # Snap to next multiple of 32 slots (beat boundary)
        next_beat_slot = ((slot_idx_now // 32) + 1) * 32
        
        phrase_start = self.t_last_beat + next_beat_slot * slot_ms
        return phrase_start


class GridEncoder:
    """Encode events onto 32nd-note grid"""
    
    def __init__(self, history_beats: int = 8):
        """
        Args:
            history_beats: Number of beats to keep in history
        """
        self.history_beats = history_beats
        self.history_slots = history_beats * 32  # 256 slots for 8 beats
        self.hist_onset: deque = deque([0.0] * self.history_slots, maxlen=self.history_slots)
        self.hist_hold: deque = deque([0.0] * self.history_slots, maxlen=self.history_slots)
        self.hist_conf: deque = deque([0.0] * self.history_slots, maxlen=self.history_slots)
        self.hist_start_time: Optional[float] = None
    
    def add_event(self, event: CanonicalEvent, slot_ms: float, hist_start_time: float):
        """Add canonical event to history grid"""
        if self.hist_start_time is None:
            self.hist_start_time = hist_start_time
        
        # Map event to slot
        s = int(round((event.t_server_ms - hist_start_time) / slot_ms))
        
        if 0 <= s < self.history_slots:
            # Set onset
            self.hist_onset[s] = 1.0
            
            # Set duration/hold
            dur_slots = max(1, int(round(event.dur_ms / slot_ms)))
            for j in range(s, min(s + dur_slots, self.history_slots)):
                self.hist_hold[j] = 1.0
            
            # Set confidence (based on cluster confidence)
            self.hist_conf[s] = min(1.0, event.conf / 5.0)  # Normalize to 0-1
    
    def get_history_arrays(self) -> Tuple[List[float], List[float], List[float]]:
        """Get history arrays as lists"""
        return (
            list(self.hist_onset),
            list(self.hist_hold),
            list(self.hist_conf)
        )


class DeterministicPredictor:
    """Deterministic baseline predictor (Option A from spec)"""
    
    def __init__(self, threshold: float = 0.5):
        """
        Args:
            threshold: Activation threshold for onset prediction
        """
        self.threshold = threshold
        self.pattern_ema: Optional[np.ndarray] = None
        self.dur_patterns: Dict[int, List[int]] = {}  # slot_pos -> list of durations
    
    def predict(self, hist_onset: List[float], hist_hold: List[float], 
                hist_conf: List[float]) -> Tuple[List[float], List[int]]:
        """
        Predict next 128 slots (4 beats)
        
        Returns:
            (onset[128], dur_slots[128])
        """
        hist_onset_arr = np.array(hist_onset)
        
        # Estimate density pattern from history (EMA over last H beats)
        if self.pattern_ema is None:
            self.pattern_ema = hist_onset_arr.copy()
        else:
            # EMA update
            alpha = 0.1
            self.pattern_ema = (1 - alpha) * self.pattern_ema + alpha * hist_onset_arr
        
        # Extract pattern for one beat (32 slots)
        pattern_32 = self.pattern_ema[-32:] if len(self.pattern_ema) >= 32 else self.pattern_ema
        
        # Predict next 128 slots (4 beats)
        pred_onset = [0.0] * 128
        pred_dur_slots = [0] * 128
        
        for i in range(128):
            slot_pos = i % 32
            if len(pattern_32) > slot_pos:
                p = pattern_32[slot_pos]
                if p > self.threshold:
                    pred_onset[i] = 1.0
                    
                    # Use median duration for this slot position
                    if slot_pos in self.dur_patterns and self.dur_patterns[slot_pos]:
                        pred_dur_slots[i] = int(np.median(self.dur_patterns[slot_pos]))
                    else:
                        pred_dur_slots[i] = 1  # Default to 1 slot
        
        return pred_onset, pred_dur_slots
    
    def update_from_history(self, hist_onset: List[float], hist_hold: List[float]):
        """Update internal patterns from history (for training)"""
        hist_onset_arr = np.array(hist_onset)
        hist_hold_arr = np.array(hist_hold)
        
        # Extract durations for each slot position
        for i in range(len(hist_onset_arr)):
            if hist_onset_arr[i] > 0.5:
                slot_pos = i % 32
                # Find duration (how many consecutive holds)
                dur = 1
                for j in range(i + 1, min(i + 32, len(hist_hold_arr))):
                    if hist_hold_arr[j] > 0.5:
                        dur += 1
                    else:
                        break
                
                if slot_pos not in self.dur_patterns:
                    self.dur_patterns[slot_pos] = []
                self.dur_patterns[slot_pos].append(dur)
                
                # Keep only recent durations (last 100)
                if len(self.dur_patterns[slot_pos]) > 100:
                    self.dur_patterns[slot_pos] = self.dur_patterns[slot_pos][-100:]


class PredictionEngine:
    """Main prediction engine coordinating all components"""
    
    def __init__(self, initial_bpm: float = 120.0, window_ms: float = 30.0, 
                 mode: PredictionMode = PredictionMode.BOOTSTRAP):
        """
        Args:
            initial_bpm: Starting BPM estimate
            window_ms: Event fusion clustering window
            mode: Prediction mode (BOOTSTRAP or REALTIME)
        """
        self.mode = mode
        self.clock_sync = DeviceClockSync()
        self.event_fusion = EventFusion(window_ms=window_ms)
        self.tempo_tracker = TempoTracker(initial_bpm=initial_bpm)
        self.grid_encoder = GridEncoder()
        self.predictor = DeterministicPredictor()
        
        # Bootstrap mode components (initialized separately)
        self.bootstrap_predictor = None
        
        self.last_update_time = None
        self.lock = threading.Lock()
        
        # Pipeline tracing (for debugging)
        self.pipeline_traces: deque = deque(maxlen=100)  # Keep last 100 traces
        self.trace_enabled = False
    
    def set_bootstrap_predictor(self, bootstrap_predictor):
        """Set bootstrap predictor for bootstrap mode"""
        self.bootstrap_predictor = bootstrap_predictor
    
    def enable_tracing(self, enabled: bool = True):
        """Enable or disable pipeline tracing"""
        self.trace_enabled = enabled
    
    def get_pipeline_traces(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent pipeline traces"""
        with self.lock:
            return list(self.pipeline_traces)[-limit:]
    
    def process_pulse(self, pulse: PulseEvent, server_time_ms: Optional[float] = None) -> Optional[CanonicalEvent]:
        """
        Process a raw pulse event through the pipeline
        
        Args:
            pulse: Raw pulse event from device
            server_time_ms: Current server time (if None, uses time.time() * 1000)
        
        Returns:
            CanonicalEvent if one was finalized, None otherwise
        """
        if server_time_ms is None:
            server_time_ms = time.time() * 1000.0
        
        with self.lock:
            # 1. Clock sync: convert to server time
            t_server_ms = self.clock_sync.convert_to_server_time(
                pulse.device_id, pulse.t_device_ms
            )
            
            # 2. Create server event
            server_event = ServerEvent(
                t_server_ms=t_server_ms,
                dur_ms=pulse.dur_ms,
                device_id=pulse.device_id,
                source_id=pulse.source_id,
                quality=pulse.meta
            )
            
            # 3. Event fusion
            canonical = self.event_fusion.add_event(server_event)
            
            if canonical:
                # 4. Update tempo tracker
                self.tempo_tracker.update(canonical)
                
                # 5. Update grid encoder
                slot_ms = self.tempo_tracker.get_slot_ms()
                hist_start = self._get_history_start(server_time_ms)
                self.grid_encoder.add_event(canonical, slot_ms, hist_start)
                
                # 6. Update predictor patterns
                hist_onset, hist_hold, _ = self.grid_encoder.get_history_arrays()
                self.predictor.update_from_history(hist_onset, hist_hold)
            
            self.last_update_time = server_time_ms
            return canonical
    
    def _get_history_start(self, t_now_ms: float) -> float:
        """Get history window start time"""
        if self.tempo_tracker.t_last_beat is None:
            return t_now_ms - (self.grid_encoder.history_beats * 60_000.0 / 120.0)
        
        beat_ms = self.tempo_tracker.beat_ms
        return self.tempo_tracker.t_last_beat - (self.grid_encoder.history_beats * beat_ms)
    
    def predict_phrase(self, server_time_ms: Optional[float] = None, 
                      bpm: Optional[float] = None) -> Optional[PhraseOutput]:
        """
        Predict next 4-beat phrase
        
        Args:
            server_time_ms: Current server time (if None, uses time.time() * 1000)
            bpm: Optional BPM override (for bootstrap mode)
        
        Returns:
            PhraseOutput with prediction, or None if not enough data
        """
        if server_time_ms is None:
            server_time_ms = time.time() * 1000.0
        
        print(f"[ENGINE] predict_phrase called, acquiring lock...")
        with self.lock:
            print(f"[ENGINE] Lock acquired, mode={self.mode}")
            # Bootstrap mode: use slot priors
            if self.mode == PredictionMode.BOOTSTRAP and self.bootstrap_predictor:
                print(f"[ENGINE] Using bootstrap prediction")
                result = self._predict_bootstrap(server_time_ms, bpm)
                print(f"[ENGINE] Bootstrap prediction complete: {result is not None}")
                return result
            
            # Realtime mode: use event fusion + tempo tracking
            if self.mode == PredictionMode.REALTIME:
                print(f"[ENGINE] Using realtime prediction")
                result = self._predict_realtime(server_time_ms)
                print(f"[ENGINE] Realtime prediction complete: {result is not None}")
                return result
            
            # Fallback to realtime if bootstrap not available
            print(f"[ENGINE] Using fallback realtime prediction")
            result = self._predict_realtime(server_time_ms)
            print(f"[ENGINE] Fallback prediction complete: {result is not None}")
            return result
    
    def _predict_bootstrap(self, server_time_ms: float, bpm: Optional[float]) -> Optional[PhraseOutput]:
        """Bootstrap mode prediction using slot priors"""
        if not self.bootstrap_predictor:
            return None
        
        # Use provided BPM or default
        if bpm is None:
            bpm = self.tempo_tracker.bpm if self.tempo_tracker.bpm else 120.0
        
        beat_ms = 60_000.0 / bpm
        slot_ms = beat_ms / 32.0
        
        # Predict using bootstrap predictor
        pred_onset, pred_dur_slots, confidence = self.bootstrap_predictor.predict_phrase()
        
        # Calculate phrase start (next beat boundary)
        # For bootstrap, we'll use a simple calculation
        phrase_start = server_time_ms + (beat_ms * 0.5)  # Start half a beat from now
        # Snap to next beat boundary
        beats_from_now = int(np.ceil((phrase_start - server_time_ms) / beat_ms))
        phrase_start = server_time_ms + (beats_from_now * beat_ms)
        
        return PhraseOutput(
            phrase_start_server_ms=phrase_start,
            bpm=bpm,
            slot_ms=slot_ms,
            slots_per_beat=32,
            phrase_beats=4,
            onset=pred_onset,
            dur_slots=pred_dur_slots,
            confidence=confidence
        )
    
    def _predict_realtime(self, server_time_ms: float) -> Optional[PhraseOutput]:
        """Realtime mode prediction using event fusion"""
        if self.tempo_tracker.t_last_beat is None:
            return None
        
        # Get phrase start time
        phrase_start = self.tempo_tracker.get_next_phrase_start(server_time_ms)
        
        # Get history
        hist_onset, hist_hold, hist_conf = self.grid_encoder.get_history_arrays()
        
        # Predict
        pred_onset, pred_dur_slots = self.predictor.predict(hist_onset, hist_hold, hist_conf)
        
        # Create confidence array (based on history confidence pattern)
        confidence = [0.5] * 128  # Default confidence
        if len(hist_conf) >= 32:
            pattern_conf = hist_conf[-32:]
            for i in range(128):
                slot_pos = i % 32
                if len(pattern_conf) > slot_pos:
                    confidence[i] = pattern_conf[slot_pos]
        
        # Apply constraints (prevent overlaps)
        pred_onset, pred_dur_slots = self._apply_constraints(pred_onset, pred_dur_slots)
        
        slot_ms = self.tempo_tracker.get_slot_ms()
        
        return PhraseOutput(
            phrase_start_server_ms=phrase_start,
            bpm=self.tempo_tracker.bpm,
            slot_ms=slot_ms,
            slots_per_beat=32,
            phrase_beats=4,
            onset=pred_onset,
            dur_slots=pred_dur_slots,
            confidence=confidence
        )
    
    def _apply_constraints(self, onset: List[float], dur_slots: List[int]) -> Tuple[List[float], List[int]]:
        """Apply musical constraints (prevent overlaps)"""
        hold = [0] * 128
        
        for i in range(128):
            if onset[i] > 0.5:
                # Check if we're already in a hold
                if hold[i] == 0:
                    # Start new hold
                    dur = max(1, dur_slots[i])
                    for j in range(i, min(i + dur, 128)):
                        hold[j] = 1
                else:
                    # Overlap detected - drop this onset (baseline rule)
                    onset[i] = 0.0
                    dur_slots[i] = 0
        
        return onset, dur_slots
    
    def get_state(self) -> Dict[str, Any]:
        """Get current engine state for debugging"""
        with self.lock:
            # Get clock sync state
            clock_sync_state = {}
            for device_id, offset in self.clock_sync.offsets.items():
                drift = self.clock_sync.drifts.get(device_id, 1.0)
                history = self.clock_sync.offset_history.get(device_id, deque())
                clock_sync_state[device_id] = {
                    'offset_ms': float(offset),
                    'drift': float(drift),
                    'history_count': len(history)
                }
            
            # Get recent canonical events (last 20)
            recent_canonical = list(self.event_fusion.canonical_events)[-20:]
            canonical_events_data = []
            for event in recent_canonical:
                canonical_events_data.append({
                    't_server_ms': float(event.t_server_ms),
                    'dur_ms': float(event.dur_ms),
                    'conf': int(event.conf),
                    'spread_ms': float(event.spread_ms),
                    'contributors': event.contributors
                })
            
            # Get grid encoder state
            hist_onset, hist_hold, hist_conf = self.grid_encoder.get_history_arrays()
            
            # Get predictor state
            predictor_state = {
                'type': 'deterministic',
                'threshold': float(self.predictor.threshold),
                'pattern_ema_length': len(self.predictor.pattern_ema) if self.predictor.pattern_ema is not None else 0,
                'duration_patterns_count': len(self.predictor.dur_patterns)
            }
            
            return {
                'mode': self.mode.value,
                'bpm': float(self.tempo_tracker.bpm) if self.tempo_tracker.bpm else None,
                'beat_ms': float(self.tempo_tracker.beat_ms),
                't_last_beat': float(self.tempo_tracker.t_last_beat) if self.tempo_tracker.t_last_beat else None,
                'slot_ms': float(self.tempo_tracker.get_slot_ms()),
                'num_canonical_events': len(self.event_fusion.canonical_events),
                'num_devices': len(self.clock_sync.offsets),
                'last_update_time': float(self.last_update_time) if self.last_update_time else None,
                'clock_sync': clock_sync_state,
                'event_fusion': {
                    'window_ms': float(self.event_fusion.window_ms),
                    'active_clusters': len(self.event_fusion.clusters),
                    'recent_canonical_events': canonical_events_data
                },
                'tempo_tracker': {
                    'bpm': float(self.tempo_tracker.bpm) if self.tempo_tracker.bpm else None,
                    'beat_ms': float(self.tempo_tracker.beat_ms),
                    't_last_beat': float(self.tempo_tracker.t_last_beat) if self.tempo_tracker.t_last_beat else None,
                    'slot_ms': float(self.tempo_tracker.get_slot_ms()),
                    'phase_gain': float(self.tempo_tracker.phase_gain),
                    'tempo_gain': float(self.tempo_tracker.tempo_gain)
                },
                'grid_encoder': {
                    'history_beats': self.grid_encoder.history_beats,
                    'history_slots': self.grid_encoder.history_slots,
                    'hist_start_time': float(self.grid_encoder.hist_start_time) if self.grid_encoder.hist_start_time else None,
                    'hist_onset': hist_onset,
                    'hist_hold': hist_hold,
                    'hist_conf': hist_conf
                },
                'predictor': predictor_state
            }

