// -----------------------------
// Target class
// -----------------------------
class Target {
    constructor(beatNumber, x, y, color = null) {
        this.beatSpawn = beatNumber;  // Beat number when target appeared
        this.beatDisappear = beatNumber + TARGET_LIFETIME_BEATS;  // Beat number when target should disappear
        this.x = x;
        this.y = y;
        this.hit = false;  // Whether this target has been hit
        this.markers = [];  // Array of markers moving toward this target
        this.color = color || 'rgb(80, 150, 255)';  // Target color
        this.score = 0;  // Running score for this target (0-5+, resets at 5)
    }
    
    shouldDisappear(beatNumber) {
        // Check if target should disappear on this beat
        return beatNumber >= this.beatDisappear;
    }
    
    getBeatTime(beatNumber, t0, beatInterval) {
        // Get the actual time for a given beat number
        return t0 + beatNumber * beatInterval;
    }
    
    // Check if marker circle is entirely inside target circle
    isMarkerEntirelyIn(markerX, markerY, targetRadius) {
        const dx = markerX - this.x;
        const dy = markerY - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance + MARKER_RADIUS <= targetRadius;
    }
    
    // Check if marker circle overlaps (partially in) target circle
    isMarkerPartiallyIn(markerX, markerY, targetRadius) {
        const dx = markerX - this.x;
        const dy = markerY - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance <= MARKER_RADIUS + targetRadius;
    }
    
    getHitResult(markerX, markerY) {
        // Position-based scoring: check from inner to outer circles
        // Define circle radii
        const blueRadius = TARGET_RADIUS;  // 28
        const greenRadius = TARGET_RADIUS + (PERFECT_W / GOOD_W) * 30;  // ~43
        const yellowRadius = TARGET_RADIUS + 30;  // 58
        
        // PERFECT: marker entirely in blue circle
        if (this.isMarkerEntirelyIn(markerX, markerY, blueRadius)) {
            return "PERFECT";
        }
        
        // GREAT: marker entirely in green circle (but not blue)
        if (this.isMarkerEntirelyIn(markerX, markerY, greenRadius)) {
            return "GREAT";
        }
        
        // GOOD: marker partially in green circle (but not entirely in green)
        if (this.isMarkerPartiallyIn(markerX, markerY, greenRadius)) {
            return "GOOD";
        }
        
        // OKAY: marker partially in yellow circle (but not in green)
        if (this.isMarkerPartiallyIn(markerX, markerY, yellowRadius)) {
            return "OKAY";
        }
        
        // MISS: marker not in any circle
        return "MISS";
    }
}

