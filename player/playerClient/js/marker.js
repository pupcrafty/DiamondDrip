// -----------------------------
// Marker class
// -----------------------------
class Marker {
    constructor(target, tSpawn, tArrival, topX, topY, holdDuration, fallVx, fallVy, sustainedDuration = 0) {
        this.target = target;  // Reference to the target this marker is moving toward
        this.tSpawn = tSpawn;  // Time when marker spawns
        this.tArrival = tArrival;  // Time when marker should arrive at target center
        this.sustainedDuration = sustainedDuration;  // Duration of sustained beat (0 for single beats)
        this.tEnd = sustainedDuration > 0 ? tArrival + sustainedDuration : tArrival;  // Time when sustained beat ends
        
        // Top position where marker holds before falling
        this.topX = topX;
        this.topY = topY;
        
        // Hold phase
        this.holdDuration = holdDuration;  // Time to hold at top before falling
        this.tStartFall = tSpawn + holdDuration;  // Time when falling starts
        
        // Fall velocity (calculated to hit target at tArrival)
        this.fallVx = fallVx;
        this.fallVy = fallVy;
        
        // Current position (starts at top position)
        this.x = topX;
        this.y = topY;
        
        this.hit = false;  // Whether this marker's target has been hit
    }
    
    update(t) {
        if (this.hit) return;  // Don't update if target is already hit
        
        if (t < this.tStartFall) {
            // Hold phase: stay at top position
            this.x = this.topX;
            this.y = this.topY;
        } else {
            // Fall phase: move toward target
            const fallElapsed = t - this.tStartFall;
            this.x = this.topX + this.fallVx * fallElapsed;
            this.y = this.topY + this.fallVy * fallElapsed;
        }
    }
    
    hasLeftYellowCircle(currentTime) {
        // For sustained beats, marker should stay on target until tEnd
        if (this.sustainedDuration > 0) {
            // Don't remove sustained markers until after the sustained duration ends
            if (currentTime < this.tEnd) {
                return false;
            }
        }
        
        // Check if marker has left the yellow circle (clickable area)
        // Only check after it has passed through the target center
        
        const yellowRadius = getYellowRadius();
        const dx = this.x - this.target.x;
        const dy = this.y - this.target.y;
        const distanceFromTarget = Math.sqrt(dx * dx + dy * dy);
        
        // Vector from top position to target
        const toTargetX = this.target.x - this.topX;
        const toTargetY = this.target.y - this.topY;
        
        // Vector from current position to target
        const fromCurrentToTargetX = this.target.x - this.x;
        const fromCurrentToTargetY = this.target.y - this.y;
        
        // Check if marker has passed the target center:
        // If the dot product of (top->target) and (current->target) is negative,
        // it means we're on the opposite side of the target from where we started
        const dotProduct = toTargetX * fromCurrentToTargetX + toTargetY * fromCurrentToTargetY;
        const hasPassedTarget = dotProduct < 0;
        
        // Marker has left if it's beyond the yellow circle AND has passed through the target center
        return hasPassedTarget && distanceFromTarget > yellowRadius + MARKER_RADIUS;
    }
}

