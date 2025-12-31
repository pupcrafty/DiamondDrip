# Duration Prediction Explanation

## Overview

The rhythm predictor now predicts not just **whether** a beat will occur (pattern), but also **how long** sustained beats will last (durations). This document explains how duration predictions are combined and how similarity is determined.

---

## How Durations Are Decided

### 1. Source of Duration Data

Durations come from the `SUSTAINED_BEAT_DETECTOR` module, which measures how long the smoothed average energy continues to increase after a pulse. The duration is stored in **32nd-note increments** (e.g., 4.0 = 4 thirty-second notes, 8.0 = 8 thirty-second notes = 1 quarter beat).

### 2. When a Duration Is Assigned

A duration is assigned to a slot **only when**:
- The slot is predicted to have a pulse (`prediction[slot] = true`)
- There is historical duration data available for that slot

If no historical duration data exists for a slot, the duration remains `null`.

### 3. How Duration Length Is Determined

#### Statistical Approach (Most Common)

When predicting from historical data, the algorithm uses a **simple average**:

```javascript
// From predictFromHistoryPhrases() and predictFromCorrectPatterns()
if (durations.length > 0) {
    const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    predictionDurations[slot] = avgDuration;
}
```

**Example:**
- Slot 0 had durations: [4.0, 6.0, 4.5, 5.5]
- Predicted duration = (4.0 + 6.0 + 4.5 + 5.5) / 4 = **5.0** (5 thirty-second notes)

#### Pattern-Based Approach

If a repeating pattern is detected, the duration is taken directly from the next phrase in the repeating sequence:

```javascript
const repeatingDurations = findRepeatingPattern(historyDurations, true);
const predictionDurations = repeatingDurations ? [...repeatingDurations] : new Array(PHRASE_BEATS * 8).fill(null);
```

**Example:**
- Pattern detected: [4.0, null, null, 8.0, null, null, ...] repeats every 2 phrases
- Next phrase in cycle would be: [8.0, null, null, 4.0, null, null, ...]
- Predicted durations = [8.0, null, null, 4.0, null, null, ...]

---

## How `createHyperPrediction()` Combines Duration Predictions

`createHyperPrediction()` takes two predictions (`pred1` and `pred2`) and creates a "hyper-prediction" that combines them with higher confidence. It combines durations using the following logic:

### Step 1: High-Confidence Slots (Both Predictors Agree)

For slots where **both** predictions agree there will be a pulse:

```javascript
if (pred1Pattern[slot] && pred2Pattern[slot]) {
    hyperPred[slot] = true;
    // Duration logic:
    if (pred1Durations[slot] !== null && pred2Durations[slot] !== null) {
        // BOTH have durations: use AVERAGE
        hyperDurations[slot] = (pred1Durations[slot] + pred2Durations[slot]) / 2;
    } else if (pred1Durations[slot] !== null) {
        // Only pred1 has duration: use it
        hyperDurations[slot] = pred1Durations[slot];
    } else if (pred2Durations[slot] !== null) {
        // Only pred2 has duration: use it
        hyperDurations[slot] = pred2Durations[slot];
    }
    // If neither has duration, hyperDurations[slot] remains null
}
```

**Example:**
- `pred1` says slot 0 has a pulse with duration 4.5
- `pred2` says slot 0 has a pulse with duration 5.5
- **Hyper-prediction:** Slot 0 = true, duration = **(4.5 + 5.5) / 2 = 5.0**

### Step 2: Low-Confidence Slots (8th Beats Only)

For slots that are **8th beat positions** (slot % 4 === 0) and at least one predictor says there's a pulse:

```javascript
if (isEighthBeat && (pred1Pattern[slot] || pred2Pattern[slot])) {
    hyperPred[slot] = true;
    // Use duration from whichever prediction has it (no averaging)
    if (pred1Pattern[slot] && pred1Durations[slot] !== null) {
        hyperDurations[slot] = pred1Durations[slot];
    } else if (pred2Pattern[slot] && pred2Durations[slot] !== null) {
        hyperDurations[slot] = pred2Durations[slot];
    }
}
```

**Example:**
- Slot 8 is an 8th beat position
- `pred1` says slot 8 has a pulse with duration 6.0
- `pred2` says slot 8 has no pulse
- **Hyper-prediction:** Slot 8 = true, duration = **6.0** (from pred1)

---

## How `arePatternsSimilarForDurations()` Determines Similarity

This function compares two duration arrays to see if they represent similar patterns. It's used when detecting repeating patterns in historical data.

### Similarity Logic

```javascript
function arePatternsSimilarForDurations(pattern1, pattern2, threshold) {
    // For each slot:
    const val1 = pattern1[i] !== null && pattern1[i] !== undefined ? pattern1[i] : 0;
    const val2 = pattern2[i] !== null && pattern2[i] !== undefined ? pattern2[i] : 0;
    
    // Consider similar if:
    // 1. Both are null/0 (no duration)
    // 2. Both have values and are within 20% difference
    if (val1 === val2 || (val1 > 0 && val2 > 0 && Math.abs(val1 - val2) / Math.max(val1, val2) < 0.2)) {
        matches++;
    }
}
```

### Similarity Criteria

Two duration patterns are considered similar if:

1. **Exact Match:** `val1 === val2`
   - Both null → similar
   - Both have same value → similar

2. **Near Match (20% tolerance):** Both have values and are within 20% of each other
   - Formula: `Math.abs(val1 - val2) / Math.max(val1, val2) < 0.2`
   - This allows for small variations (e.g., 4.0 vs 4.5, or 8.0 vs 9.0)

3. **Overall Similarity:** At least `threshold` (typically 80%) of slots must match

### Examples

**Example 1: Similar Patterns**
```
pattern1: [4.0, null, null, 8.0, null, null, 4.5, null]
pattern2: [4.2, null, null, 8.1, null, null, 4.4, null]
```
- Slot 0: 4.0 vs 4.2 → |4.0-4.2|/4.2 = 0.048 < 0.2 ✅
- Slot 1: null vs null → exact match ✅
- Slot 3: 8.0 vs 8.1 → |8.0-8.1|/8.1 = 0.012 < 0.2 ✅
- Slot 6: 4.5 vs 4.4 → |4.5-4.4|/4.5 = 0.022 < 0.2 ✅
- **Result:** 8/8 slots match → 100% similarity → **SIMILAR** ✅

**Example 2: Dissimilar Patterns**
```
pattern1: [4.0, null, null, 8.0, null, null, 4.5, null]
pattern2: [4.0, null, null, 2.0, null, null, 4.5, null]
```
- Slot 3: 8.0 vs 2.0 → |8.0-2.0|/8.0 = 0.75 > 0.2 ❌
- **Result:** 7/8 slots match → 87.5% similarity, but one slot differs significantly → **DISSIMILAR** ❌

**Example 3: Different Positions**
```
pattern1: [4.0, null, null, null, null, null, null, null]
pattern2: [null, null, null, 4.0, null, null, null, null]
```
- Slot 0: 4.0 vs null → not similar ❌
- Slot 3: null vs 4.0 → not similar ❌
- **Result:** 6/8 slots match → 75% similarity < 80% threshold → **DISSIMILAR** ❌

### Why 20% Tolerance?

The 20% tolerance allows for:
- **Natural variation** in how long beats are sustained
- **Measurement noise** in the detection process
- **Slight tempo fluctuations** that affect duration measurements

This tolerance is applied when **both values are non-zero**. If one is null and the other isn't, they're not considered similar.

---

## Summary

1. **Duration Length:** Determined by **averaging historical durations** for that slot, or taken directly from repeating patterns.

2. **Hyper-Prediction Combination:**
   - **Both agree:** Average the two durations
   - **Only one has duration:** Use that one
   - **Neither has duration:** Leave as null

3. **Similarity Check:**
   - Uses **20% tolerance** for numeric values
   - Requires **80% of slots** to match (threshold = 0.8)
   - Treats null values as 0 for comparison

4. **Duration Assignment:** Only assigned when:
   - The slot is predicted to have a pulse
   - Historical duration data exists for that slot

