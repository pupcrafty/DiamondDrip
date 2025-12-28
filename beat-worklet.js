// AudioWorklet Processor for Beat Detection
// This file runs in the audio processing thread

class BeatDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.avg = 0;
    this.alpha = 0.01;          // smoothing for moving average
    this.mult = 1.8;            // threshold multiplier (tune)
    this.minInterval = 0.18;    // seconds between triggers (tune)
    this.lastBeatTime = -999;
    this.gate = 0;              // simple decay gate to avoid double triggers
    this.frameCount = 0;
    this.sampleRate = sampleRate;
    
    // Send diagnostic updates every N frames (about 10 times per second at 128 samples/frame)
    this.diagnosticInterval = Math.floor(this.sampleRate / 128 / 10); // ~10 Hz updates
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];

    // RMS energy for this block
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    const rms = Math.sqrt(sum / ch.length);

    // Update moving average
    this.avg = (1 - this.alpha) * this.avg + this.alpha * rms;

    // Calculate current time from frame count
    const now = this.frameCount / this.sampleRate;

    // gate decays toward 0
    this.gate *= 0.95;

    const threshold = this.avg * this.mult;
    if (rms > threshold && this.gate < 0.2 && (now - this.lastBeatTime) > this.minInterval) {
      this.lastBeatTime = now;
      this.gate = 1.0;
      this.port.postMessage({ 
        type: 'beat', 
        time: now,
        rms: rms,
        threshold: threshold,
        avg: this.avg
      });
    }

    // Send diagnostic data periodically
    if (this.frameCount % this.diagnosticInterval === 0) {
      this.port.postMessage({
        type: 'diagnostic',
        rms: rms,
        avg: this.avg,
        threshold: threshold,
        gate: this.gate,
        lastBeatTime: this.lastBeatTime,
        time: now,
        isAboveThreshold: rms > threshold
      });
    }

    this.frameCount += ch.length;
    return true;
  }
}

registerProcessor('beat-detector', BeatDetectorProcessor);

