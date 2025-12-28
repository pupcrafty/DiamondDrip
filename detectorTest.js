// -----------------------------
// Detector Test - Display Logic
// -----------------------------
// This file handles displaying data from BPM_ESTIMATOR, ENERGY_CLASSIFIER, and RHYTHM_PREDICTOR

const PHRASE_BEATS = 4; // 4 beats per phrase
const PULSE_GATE_TIME = 0.1; // Minimum time between pulses (100ms)
const ENERGY_RANGE_OVERLAP = 0.25; // 25% overlap in ranges

let isRunning = false;
let lastPulseTime = -999;
let beatCount = 0;
let maxRmsForScale = 0.1; // Initial scale reference
let diagnosticData = {
    rms: 0,
    avg: 0,
    threshold: 0,
    gate: 0,
    lastBeatTime: -999,
    time: 0,
    isAboveThreshold: false
};

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');
const beatIndicator = document.getElementById('beatIndicator');
const beatLog = document.getElementById('beatLog');
const pulseLog = document.getElementById('pulseLog');
const pulseIndicator = document.getElementById('pulseIndicator');

function updateStatus(message, isError = false, isReady = false) {
    statusDiv.textContent = message;
    statusDiv.className = 'status';
    if (isError) statusDiv.className += ' error';
    if (isReady) statusDiv.className += ' ready';
}

function updateMetrics() {
    // Update basic diagnostic values
    document.getElementById('rmsValue').textContent = diagnosticData.rms.toFixed(4);
    document.getElementById('avgValue').textContent = diagnosticData.avg.toFixed(4);
    document.getElementById('thresholdValue').textContent = diagnosticData.threshold.toFixed(4);
    document.getElementById('gateValue').textContent = diagnosticData.gate.toFixed(3);
    document.getElementById('beatCount').textContent = beatCount;
    
    const timeSince = diagnosticData.time - diagnosticData.lastBeatTime;
    if (diagnosticData.lastBeatTime > 0 && timeSince >= 0) {
        document.getElementById('timeSinceBeat').textContent = timeSince.toFixed(3) + 's';
    } else {
        document.getElementById('timeSinceBeat').textContent = '-';
    }
    
    // Get BPM from BPM_ESTIMATOR
    const smoothedBPM = BPM_ESTIMATOR.getSmoothedBPM();
    const bpmElement = document.getElementById('bpmValue');
    if (smoothedBPM !== null) {
        bpmElement.textContent = smoothedBPM.toFixed(1);
    } else {
        bpmElement.textContent = '-';
    }
    
    // Display hyper-smoothed BPM
    const hyperBpm = BPM_ESTIMATOR.getHyperSmoothedBPM();
    const hyperBpmElement = document.getElementById('hyperBpmValue');
    if (hyperBpmElement) {
        if (hyperBpm !== null) {
            hyperBpmElement.textContent = hyperBpm.toFixed(1);
        } else {
            hyperBpmElement.textContent = '-';
        }
    }
    
    // Display BPM acceptance statistics
    const bpmStats = BPM_ESTIMATOR.getStats();
    const totalBpmSamples = bpmStats.acceptedBpmCount + bpmStats.droppedBpmCount;
    const dropRatio = totalBpmSamples > 0 ? (bpmStats.droppedBpmCount / totalBpmSamples * 100) : 0;
    
    const bpmStatsElement = document.getElementById('bpmStatsValue');
    if (bpmStatsElement) {
        if (totalBpmSamples > 0) {
            bpmStatsElement.textContent = `${bpmStats.acceptedBpmCount}/${bpmStats.droppedBpmCount} (${dropRatio.toFixed(1)}% dropped)`;
            // Color code based on drop ratio
            if (dropRatio > 40) {
                bpmStatsElement.style.color = '#ff4444'; // Red - high drop rate
            } else if (dropRatio > 20) {
                bpmStatsElement.style.color = '#ff8844'; // Orange - moderate drop rate
            } else {
                bpmStatsElement.style.color = '#44ff44'; // Green - low drop rate
            }
        } else {
            bpmStatsElement.textContent = '-';
        }
    }
    
    // Display tempo change detection
    const tempoChangeDetected = BPM_ESTIMATOR.isTempoChangeDetected();
    const tempoChangeElement = document.getElementById('tempoChangeValue');
    if (tempoChangeElement) {
        if (tempoChangeDetected) {
            tempoChangeElement.textContent = 'YES';
            tempoChangeElement.style.color = '#ff4444';
        } else {
            tempoChangeElement.textContent = 'NO';
            tempoChangeElement.style.color = '#44ff44';
        }
    }

    // Update bars (scale to maxRmsForScale)
    const rmsPercent = Math.min(100, (diagnosticData.rms / maxRmsForScale) * 100);
    const avgPercent = Math.min(100, (diagnosticData.avg / maxRmsForScale) * 100);
    const thresholdPercent = Math.min(100, (diagnosticData.threshold / maxRmsForScale) * 100);

    document.getElementById('rmsBar').style.width = rmsPercent + '%';
    document.getElementById('avgBar').style.width = avgPercent + '%';
    document.getElementById('thresholdBar').style.left = thresholdPercent + '%';

    // Get pulse threshold from ENERGY_CLASSIFIER
    const pulseThreshold = ENERGY_CLASSIFIER.getPulseThreshold();
    const pulseThresholdBar = document.getElementById('pulseThresholdBar');
    if (pulseThreshold !== null && pulseThreshold > 0 && pulseThresholdBar) {
        const pulsePercent = Math.min(100, (pulseThreshold / maxRmsForScale) * 100);
        pulseThresholdBar.style.left = pulsePercent + '%';
        pulseThresholdBar.style.display = 'block';
    } else if (pulseThresholdBar) {
        pulseThresholdBar.style.display = 'none';
    }

    // Update bar colors based on threshold
    if (diagnosticData.isAboveThreshold) {
        document.getElementById('rmsBar').style.background = 'linear-gradient(90deg, #ff4444, #ff6666)';
    } else {
        document.getElementById('rmsBar').style.background = 'linear-gradient(90deg, #4a90e2, #5aa0f2)';
    }

    // Auto-adjust scale
    if (diagnosticData.rms > maxRmsForScale * 0.9) {
        maxRmsForScale = Math.max(0.1, diagnosticData.rms * 1.2);
    }
    
    // Get current energy level from ENERGY_CLASSIFIER
    const currentEnergyLevel = ENERGY_CLASSIFIER.getCurrentEnergyLevel();
    const energyLevelElement = document.getElementById('energyLevelValue');
    if (energyLevelElement) {
        if (currentEnergyLevel > 0) {
            energyLevelElement.textContent = currentEnergyLevel;
            // Color code: green (low) to red (high)
            const colors = ['#44ff44', '#88ff44', '#ffff44', '#ff8844', '#ff4444'];
            energyLevelElement.style.color = colors[currentEnergyLevel - 1];
        } else {
            energyLevelElement.textContent = '-';
        }
    }
    
    // Update energy level marker on RMS Energy bar
    const energyLevelAverages = ENERGY_CLASSIFIER.getEnergyLevelAverages();
    const energyLevelBar = document.getElementById('energyLevelBar');
    if (currentEnergyLevel > 0 && energyLevelAverages.length >= currentEnergyLevel && energyLevelAverages[currentEnergyLevel - 1] > 0 && energyLevelBar) {
        const energyLevelAverage = energyLevelAverages[currentEnergyLevel - 1];
        const energyLevelPercent = Math.min(100, (energyLevelAverage / maxRmsForScale) * 100);
        energyLevelBar.style.left = energyLevelPercent + '%';
        // Color code: green (low) to red (high)
        const colors = ['#44ff44', '#88ff44', '#ffff44', '#ff8844', '#ff4444'];
        energyLevelBar.style.backgroundColor = colors[currentEnergyLevel - 1];
        energyLevelBar.style.display = 'block';
    } else if (energyLevelBar) {
        energyLevelBar.style.display = 'none';
    }
    
    // Update energy ranges display
    updateEnergyRangesDisplay();
    
    // Update rhythm pattern display
    const currentPhrasePattern = RHYTHM_PREDICTOR.getCurrentPhrasePattern();
    if (hyperBpm !== null && currentPhrasePattern !== null) {
        updateRhythmPatternDisplay();
    }
}

function updateEnergyRangesDisplay() {
    const container = document.getElementById('energyRangesContainer');
    if (!container) return;
    
    const energyLevelAverages = ENERGY_CLASSIFIER.getEnergyLevelAverages();
    const hasEnoughSamples = ENERGY_CLASSIFIER.hasEnoughSamples();
    const currentEnergyLevel = ENERGY_CLASSIFIER.getCurrentEnergyLevel();
    
    if (!hasEnoughSamples || energyLevelAverages.length < 5 || energyLevelAverages[4] === 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding: 10px;">Collecting samples... (need at least 50)</div>';
        return;
    }
    
    const colors = ['#44ff44', '#88ff44', '#ffff44', '#ff8844', '#ff4444'];
    
    // Calculate ranges for display
    const ranges = [];
    for (let i = 0; i < 5; i++) {
        const center = energyLevelAverages[i];
        let rangeExtent;
        if (i === 0) {
            rangeExtent = (energyLevelAverages[1] - center) * ENERGY_RANGE_OVERLAP;
        } else if (i === 4) {
            rangeExtent = (center - energyLevelAverages[3]) * ENERGY_RANGE_OVERLAP;
        } else {
            const distToPrev = center - energyLevelAverages[i - 1];
            const distToNext = energyLevelAverages[i + 1] - center;
            rangeExtent = Math.min(distToPrev, distToNext) * ENERGY_RANGE_OVERLAP;
        }
        ranges.push({
            min: center - rangeExtent,
            max: center + rangeExtent,
            center: center
        });
    }
    
    let html = '<div style="display: grid; grid-template-columns: 60px 1fr; gap: 8px; align-items: center;">';
    
    // Display each level's average energy and range
    for (let i = 0; i < 5; i++) {
        const levelNum = i + 1;
        const color = colors[i];
        const range = ranges[i];
        
        const isCurrentLevel = currentEnergyLevel === levelNum;
        const highlightStyle = isCurrentLevel ? 'font-weight: bold; background-color: rgba(255,255,255,0.1); padding: 4px; border-radius: 4px;' : '';
        
        html += `
            <div style="display: flex; align-items: center; gap: 10px;">
                <div style="width: 20px; height: 20px; background-color: ${color}; border-radius: 4px; border: 2px solid ${isCurrentLevel ? '#fff' : 'transparent'};"></div>
                <div style="font-weight: bold; color: ${color}; min-width: 80px;">Level ${levelNum}</div>
            </div>
            <div style="${highlightStyle} color: #ccc;">
                Avg: ${range.center.toFixed(4)} | Range: ${range.min.toFixed(4)} - ${range.max.toFixed(4)}
                ${isCurrentLevel ? ' <span style="color: #fff;">← Current</span>' : ''}
            </div>
        `;
    }
    
    html += '</div>';
    const temporalRmsAverage = ENERGY_CLASSIFIER.getTemporalRmsAverage();
    if (temporalRmsAverage !== null) {
        html += `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #333; color: #888; font-size: 12px;">Temporal Avg: ${temporalRmsAverage.toFixed(4)}</div>`;
    }
    
    container.innerHTML = html;
}

function addBeatLog(time, rms, threshold, avg) {
    // Remove placeholder if exists
    if (beatLog.children.length === 1 && beatLog.children[0].textContent.includes('No beats')) {
        beatLog.innerHTML = '';
    }
    
    // Flash indicator
    beatIndicator.classList.add('active');
    setTimeout(() => beatIndicator.classList.remove('active'), 100);
    
    const entry = document.createElement('div');
    entry.className = 'beat-entry';
    entry.innerHTML = `
        <div style="color: #44ff44; font-weight: bold;">🎵 Beat #${beatCount}</div>
        <div class="beat-entry-time">Time: ${time.toFixed(3)}s</div>
        <div class="beat-entry-details">
            RMS: ${rms.toFixed(4)} | Threshold: ${threshold.toFixed(4)} | Avg: ${avg.toFixed(4)}
        </div>
    `;
    
    beatLog.insertBefore(entry, beatLog.firstChild);
    
    // Keep only last 50 entries
    while (beatLog.children.length > 50) {
        beatLog.removeChild(beatLog.lastChild);
    }
}

function addPulseLog(time, rms, threshold, avg) {
    // Remove placeholder if exists
    if (pulseLog.children.length === 1 && pulseLog.children[0].textContent.includes('No pulses')) {
        pulseLog.innerHTML = '';
    }
    
    // Flash indicator
    pulseIndicator.classList.add('active');
    setTimeout(() => pulseIndicator.classList.remove('active'), 100);
    
    const entry = document.createElement('div');
    entry.className = 'beat-entry';
    entry.style.borderLeftColor = '#ffaa44';
    entry.innerHTML = `
        <div style="color: #ffaa44; font-weight: bold;">⚡ Pulse</div>
        <div class="beat-entry-time">Time: ${time.toFixed(3)}s</div>
        <div class="beat-entry-details">
            RMS: ${rms.toFixed(4)} | Pulse Threshold: ${threshold.toFixed(4)} | Avg: ${avg.toFixed(4)}
        </div>
    `;
    
    pulseLog.insertBefore(entry, pulseLog.firstChild);
    
    // Keep only last 50 entries
    while (pulseLog.children.length > 50) {
        pulseLog.removeChild(pulseLog.lastChild);
    }
}

function updateRhythmPatternDisplay() {
    const container = document.getElementById('rhythmPatternContainer');
    if (!container) return;
    
    const hyperBpm = BPM_ESTIMATOR.getHyperSmoothedBPM();
    const currentPhrasePattern = RHYTHM_PREDICTOR.getCurrentPhrasePattern();
    
    if (hyperBpm === null || currentPhrasePattern === null) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding: 10px;">Waiting for pulses and BPM...</div>';
        return;
    }
    
    const predictedPhrasePattern = RHYTHM_PREDICTOR.getPredictedPhrasePattern();
    const predictedFromCorrectPatterns = RHYTHM_PREDICTOR.getPredictedFromCorrectPatterns();
    const hyperPredictedPhrasePattern = RHYTHM_PREDICTOR.getHyperPredictedPhrasePattern();
    const phrasePatterns = RHYTHM_PREDICTOR.getPhrasePatterns();
    const correctPredictionPatterns = RHYTHM_PREDICTOR.getCorrectPredictionPatterns();
    const predictionAccuracy = RHYTHM_PREDICTOR.getPredictionAccuracy();
    
    let html = '<div style="margin-bottom: 15px;">';
    html += `<div style="color: #888; font-size: 14px; margin-bottom: 10px;">Current Phrase Pattern (${PHRASE_BEATS} beats, 32nd note resolution)</div>`;
    
    // Display current phrase as rhythm grid
    html += '<div style="display: flex; gap: 2px; align-items: center; flex-wrap: wrap; background-color: #0a0a12; padding: 10px; border-radius: 4px;">';
    
    // Beat markers
    for (let beat = 0; beat < PHRASE_BEATS; beat++) {
        for (let thirtySecond = 0; thirtySecond < 8; thirtySecond++) {
            const index = beat * 8 + thirtySecond;
            const isActive = currentPhrasePattern[index];
            const isBeatStart = thirtySecond === 0;
            
            // Different colors for beat starts
            let bgColor = isActive ? '#ffaa44' : '#222';
            if (isBeatStart) {
                bgColor = isActive ? '#ff8844' : '#333';
            }
            
            html += `<div style="
                width: 18px;
                height: 40px;
                background-color: ${bgColor};
                border: 1px solid ${isBeatStart ? '#555' : '#333'};
                border-radius: 2px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 9px;
                color: ${isActive ? '#fff' : '#666'};
                position: relative;
            ">${isBeatStart ? (beat + 1) : ''}</div>`;
        }
    }
    
    html += '</div>';
    
    // Show HYPER PREDICTION (if available), otherwise show regular prediction
    if (hyperPredictedPhrasePattern !== null) {
        html += '<div style="margin-top: 20px; padding-top: 15px; border-top: 2px solid #00ff00;">';
        html += `<div style="color: #00ff00; font-size: 16px; font-weight: bold; margin-bottom: 10px;">🌟 HYPER PREDICTION (Combined)</div>`;
        html += '<div style="display: flex; gap: 2px; align-items: center; flex-wrap: wrap; background-color: #0a0a12; padding: 10px; border-radius: 4px; border: 2px solid #00ff00;">';
        
        for (let beat = 0; beat < PHRASE_BEATS; beat++) {
            for (let thirtySecond = 0; thirtySecond < 8; thirtySecond++) {
                const index = beat * 8 + thirtySecond;
                const isActive = hyperPredictedPhrasePattern[index];
                const isBeatStart = thirtySecond === 0;
                
                // Check if this beat is agreed upon by both predictions
                const agreedUpon = (predictedPhrasePattern !== null && predictedPhrasePattern[index]) && 
                                 (predictedFromCorrectPatterns !== null && predictedFromCorrectPatterns[index]);
                
                // Different colors: green/yellow for hyper prediction, brighter for agreed beats
                let bgColor = isActive ? (agreedUpon ? '#00ff88' : '#00ff44') : '#222';
                if (isBeatStart) {
                    bgColor = isActive ? (agreedUpon ? '#00cc66' : '#00cc44') : '#333';
                }
                
                html += `<div style="
                    width: 18px;
                    height: 40px;
                    background-color: ${bgColor};
                    border: 1px solid ${isBeatStart ? (agreedUpon ? '#00ff88' : '#555') : '#333'};
                    border-radius: 2px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 9px;
                    color: ${isActive ? '#000' : '#666'};
                    position: relative;
                    ${agreedUpon ? 'box-shadow: 0 0 4px #00ff88;' : ''}
                ">${isBeatStart ? (beat + 1) : ''}</div>`;
            }
        }
        
        html += '</div>';
        const hyperActiveSlots = hyperPredictedPhrasePattern.filter(slot => slot).length;
        html += `<div style="margin-top: 10px; color: #00ff88; font-size: 12px;">Hyper predicted active slots: ${hyperActiveSlots}/32</div>`;
        html += '</div>';
        
        // Show individual predictions below hyper prediction for comparison
        if (predictedPhrasePattern !== null || predictedFromCorrectPatterns !== null) {
            html += '<div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #333;">';
            html += `<div style="color: #888; font-size: 12px; margin-bottom: 10px;">Individual Predictions (for comparison)</div>`;
            html += '<div style="display: flex; gap: 20px; flex-wrap: wrap;">';
            
            // Prediction 1: From history phrases
            if (predictedPhrasePattern !== null) {
                html += '<div style="flex: 1; min-width: 200px;">';
                html += `<div style="color: #aa44ff; font-size: 12px; margin-bottom: 5px;">From History Phrases</div>`;
                html += '<div style="display: flex; gap: 2px; align-items: center; flex-wrap: wrap; background-color: #0a0a12; padding: 8px; border-radius: 4px; opacity: 0.7;">';
                
                for (let beat = 0; beat < PHRASE_BEATS; beat++) {
                    for (let thirtySecond = 0; thirtySecond < 8; thirtySecond++) {
                        const index = beat * 8 + thirtySecond;
                        const isActive = predictedPhrasePattern[index];
                        const isBeatStart = thirtySecond === 0;
                        
                        let bgColor = isActive ? '#aa44ff' : '#222';
                        if (isBeatStart) {
                            bgColor = isActive ? '#8844ff' : '#333';
                        }
                        
                        html += `<div style="
                            width: 14px;
                            height: 30px;
                            background-color: ${bgColor};
                            border: 1px solid ${isBeatStart ? '#555' : '#333'};
                            border-radius: 2px;
                            font-size: 7px;
                            color: ${isActive ? '#fff' : '#666'};
                        ">${isBeatStart ? (beat + 1) : ''}</div>`;
                    }
                }
                
                html += '</div>';
                html += '</div>';
            }
            
            // Prediction 2: From correct patterns
            if (predictedFromCorrectPatterns !== null) {
                html += '<div style="flex: 1; min-width: 200px;">';
                html += `<div style="color: #44aaff; font-size: 12px; margin-bottom: 5px;">From Correct Patterns</div>`;
                html += '<div style="display: flex; gap: 2px; align-items: center; flex-wrap: wrap; background-color: #0a0a12; padding: 8px; border-radius: 4px; opacity: 0.7;">';
                
                for (let beat = 0; beat < PHRASE_BEATS; beat++) {
                    for (let thirtySecond = 0; thirtySecond < 8; thirtySecond++) {
                        const index = beat * 8 + thirtySecond;
                        const isActive = predictedFromCorrectPatterns[index];
                        const isBeatStart = thirtySecond === 0;
                        
                        let bgColor = isActive ? '#44aaff' : '#222';
                        if (isBeatStart) {
                            bgColor = isActive ? '#4488ff' : '#333';
                        }
                        
                        html += `<div style="
                            width: 14px;
                            height: 30px;
                            background-color: ${bgColor};
                            border: 1px solid ${isBeatStart ? '#555' : '#333'};
                            border-radius: 2px;
                            font-size: 7px;
                            color: ${isActive ? '#fff' : '#666'};
                        ">${isBeatStart ? (beat + 1) : ''}</div>`;
                    }
                }
                
                html += '</div>';
                html += '</div>';
            }
            
            html += '</div>';
            html += '</div>';
        }
    } else if (predictedPhrasePattern !== null) {
        // Fallback to regular prediction if hyper prediction not available
        html += '<div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #333;">';
        html += `<div style="color: #888; font-size: 14px; margin-bottom: 10px;">Predicted Next Phrase</div>`;
        html += '<div style="display: flex; gap: 2px; align-items: center; flex-wrap: wrap; background-color: #0a0a12; padding: 10px; border-radius: 4px; opacity: 0.7;">';
        
        for (let beat = 0; beat < PHRASE_BEATS; beat++) {
            for (let thirtySecond = 0; thirtySecond < 8; thirtySecond++) {
                const index = beat * 8 + thirtySecond;
                const isActive = predictedPhrasePattern[index];
                const isBeatStart = thirtySecond === 0;
                
                let bgColor = isActive ? '#aa44ff' : '#222';
                if (isBeatStart) {
                    bgColor = isActive ? '#8844ff' : '#333';
                }
                
                html += `<div style="
                    width: 18px;
                    height: 40px;
                    background-color: ${bgColor};
                    border: 1px solid ${isBeatStart ? '#555' : '#333'};
                    border-radius: 2px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 9px;
                    color: ${isActive ? '#fff' : '#666'};
                    position: relative;
                ">${isBeatStart ? (beat + 1) : ''}</div>`;
            }
        }
        
        html += '</div>';
        const predictedActiveSlots = predictedPhrasePattern.filter(slot => slot).length;
        html += `<div style="margin-top: 10px; color: #aaa; font-size: 12px;">Predicted active slots: ${predictedActiveSlots}/32</div>`;
        html += '</div>';
    }
    
    // Show pattern summary
    const activeSlots = currentPhrasePattern.filter(slot => slot).length;
    html += `<div style="margin-top: 10px; color: #aaa; font-size: 12px;">Current active slots: ${activeSlots}/32</div>`;
    
    // Show recent phrase patterns and correctly predicted patterns if available
    if (phrasePatterns.length > 0) {
        html += '<div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #333;">';
        html += '<div style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 20px; align-items: start;">';
        
        // Left column: Recent patterns
        html += '<div>';
        html += `<div style="color: #888; font-size: 14px; margin-bottom: 10px;">Recent Patterns (last ${phrasePatterns.length} phrase${phrasePatterns.length > 1 ? 's' : ''})</div>`;
        
        for (let i = phrasePatterns.length - 1; i >= 0; i--) {
            const pattern = phrasePatterns[i];
            html += '<div style="display: flex; gap: 2px; align-items: center; margin-bottom: 8px; flex-wrap: wrap;">';
            for (let j = 0; j < pattern.length; j++) {
                const isActive = pattern[j];
                const isBeatStart = (j % 8) === 0;
                const bgColor = isActive ? '#44ff44' : '#222';
                html += `<div style="
                    width: 12px;
                    height: 24px;
                    background-color: ${bgColor};
                    border: 1px solid ${isBeatStart ? '#555' : '#333'};
                    border-radius: 2px;
                "></div>`;
            }
            html += '</div>';
        }
        html += '</div>';
        
        // Middle column: Correctly predicted patterns
        html += '<div>';
        html += `<div style="color: #888; font-size: 14px; margin-bottom: 10px;">Correctly Predicted Patterns (${correctPredictionPatterns.length})</div>`;
        
        if (correctPredictionPatterns.length > 0) {
            for (let i = correctPredictionPatterns.length - 1; i >= 0; i--) {
                const pattern = correctPredictionPatterns[i];
                html += '<div style="display: flex; gap: 2px; align-items: center; margin-bottom: 8px; flex-wrap: wrap;">';
                for (let j = 0; j < pattern.length; j++) {
                    const isActive = pattern[j];
                    const isBeatStart = (j % 8) === 0;
                    const bgColor = isActive ? '#44aa44' : '#222'; // Slightly different green for correct patterns
                    html += `<div style="
                        width: 12px;
                        height: 24px;
                        background-color: ${bgColor};
                        border: 1px solid ${isBeatStart ? '#555' : '#333'};
                        border-radius: 2px;
                    "></div>`;
                }
                html += '</div>';
            }
        } else {
            html += '<div style="color: #666; font-size: 12px;">No correct patterns stored yet</div>';
        }
        html += '</div>';
        
        // Right column: Prediction accuracy (side panel)
        html += '<div style="min-width: 200px;">';
        html += `<div style="color: #888; font-size: 14px; margin-bottom: 10px;">Accuracy Stats</div>`;
        
        if (predictionAccuracy.length > 0) {
            // Calculate overall accuracy
            const totalCorrect = predictionAccuracy.reduce((sum, acc) => sum + acc.correct, 0);
            const totalActual = predictionAccuracy.reduce((sum, acc) => sum + acc.total, 0);
            const overallAccuracy = totalActual > 0 ? (totalCorrect / totalActual * 100) : 0;
            
            html += `<div style="margin-bottom: 10px; padding: 8px; background-color: #1a1a24; border-radius: 4px; border: 1px solid #333;">`;
            html += `<div style="color: #aaa; font-size: 12px; margin-bottom: 4px;">Overall:</div>`;
            html += `<div style="color: #fff; font-size: 16px; font-weight: bold;">${totalCorrect}/${totalActual} (${overallAccuracy.toFixed(1)}%)</div>`;
            html += '</div>';
            
            // Show accuracy for each phrase (most recent first)
            html += '<div style="max-height: 400px; overflow-y: auto;">';
            for (let i = predictionAccuracy.length - 1; i >= 0; i--) {
                const acc = predictionAccuracy[i];
                const accuracyPercent = acc.total > 0 ? (acc.accuracy * 100) : 0;
                const color = accuracyPercent >= 80 ? '#44ff44' : accuracyPercent >= 50 ? '#ffaa44' : '#ff4444';
                
                html += `<div style="
                    margin-bottom: 6px; 
                    padding: 6px; 
                    background-color: #0a0a12; 
                    border-radius: 3px; 
                    border-left: 3px solid ${color};
                    font-size: 11px;
                    color: #ccc;
                ">`;
                html += `<div>Phrase ${i + 1}: ${acc.correct}/${acc.total}</div>`;
                html += `<div style="color: ${color}; font-weight: bold;">${accuracyPercent.toFixed(0)}%</div>`;
                if (acc.falsePositives > 0) {
                    html += `<div style="color: #888; font-size: 10px;">+${acc.falsePositives} FP</div>`;
                }
                html += '</div>';
            }
            html += '</div>';
        } else {
            html += '<div style="color: #666; font-size: 12px;">No predictions evaluated yet</div>';
        }
        
        html += '</div>'; // End right column
        html += '</div>'; // End grid
        html += '</div>'; // End section
    }
    
    html += '</div>';
    container.innerHTML = html;
}

async function startDetection() {
    try {
        updateStatus('Initializing audio context...', false, false);
        
        // Reset modules
        BPM_ESTIMATOR.reset();
        ENERGY_CLASSIFIER.reset();
        RHYTHM_PREDICTOR.reset();
        
        // Reset local state
        beatCount = 0;
        lastPulseTime = -999;
        maxRmsForScale = 0.1;
        diagnosticData = {
            rms: 0,
            avg: 0,
            threshold: 0,
            gate: 0,
            lastBeatTime: -999,
            time: 0,
            isAboveThreshold: false
        };
        
        // Initialize beat detection
        await beatDetection.initBeatDetection(
            // onBeat callback
            (time, rms, threshold, avg) => {
                beatCount++;
                log('BEAT', '🎵 [BEAT] Beat detected:', time, 'RMS:', rms);
                
                // Add beat to BPM estimator
                BPM_ESTIMATOR.addBeat(time);
                BPM_ESTIMATOR.update();
                
                addBeatLog(time, rms, threshold, avg);
                diagnosticData.lastBeatTime = time;
            },
            // onDiagnostic callback
            (data) => {
                diagnosticData = data;
                
                // Add RMS sample to energy classifier
                ENERGY_CLASSIFIER.addRmsSample(data.rms);
                ENERGY_CLASSIFIER.update();
                
                // Update BPM estimator
                BPM_ESTIMATOR.update();
                
                // Detect pulses based on pulse threshold
                const pulseThreshold = ENERGY_CLASSIFIER.getPulseThreshold();
                if (pulseThreshold !== null && pulseThreshold > 0 && 
                    data.rms > pulseThreshold && 
                    data.time - lastPulseTime >= PULSE_GATE_TIME) {
                    lastPulseTime = data.time;
                    
                    // Process pulse for rhythm prediction
                    const hyperBpm = BPM_ESTIMATOR.getHyperSmoothedBPM();
                    RHYTHM_PREDICTOR.processPulse(data.time, hyperBpm);
                    addPulseLog(data.time, data.rms, pulseThreshold, data.avg);
                }
            }
        );
        
        updateStatus('✓ Beat detection is running! Listen to music or tap to see beats detected.', false, true);
        
        isRunning = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        
        // Start update loop
        updateMetrics();
        setInterval(updateMetrics, 50); // Update UI 20 times per second

    } catch (error) {
        updateStatus('Error: ' + error.message, true, false);
        console.error('Error starting beat detection:', error);
    }
}

function stopDetection() {
    beatDetection.stopBeatDetection();
    
    isRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    updateStatus('Detection stopped.');
    
    // Reset modules
    BPM_ESTIMATOR.reset();
    ENERGY_CLASSIFIER.reset();
    RHYTHM_PREDICTOR.reset();
    
    // Reset local state
    beatCount = 0;
    lastPulseTime = -999;
    maxRmsForScale = 0.1;
    diagnosticData = {
        rms: 0,
        avg: 0,
        threshold: 0,
        gate: 0,
        lastBeatTime: -999,
        time: 0,
        isAboveThreshold: false
    };
    
    updateMetrics();
}

// Initialize: Set up button handlers
function init() {
    startBtn.addEventListener('click', startDetection);
    stopBtn.addEventListener('click', stopDetection);
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

