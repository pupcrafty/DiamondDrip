// -----------------------------
// Marker class
// -----------------------------
class Marker {
    constructor(target, tSpawn, tArrival) {
        this.target = target;  // Reference to the target this marker is moving toward
        this.tSpawn = tSpawn;  // Time when marker spawns
        this.tArrival = tArrival;  // Time when marker should arrive at target center
        
        // Calculate spawn position (off-screen, random edge)
        const [spawnX, spawnY] = randomSpawnPosition(target.x, target.y);
        this.spawnX = spawnX;
        this.spawnY = spawnY;
        
        // Current position (starts at spawn position)
        this.x = spawnX;
        this.y = spawnY;
        
        // Calculate velocity to arrive at target center at exact right time
        const travelTime = tArrival - tSpawn;
        const dx = target.x - spawnX;
        const dy = target.y - spawnY;
        this.vx = dx / travelTime;
        this.vy = dy / travelTime;
        
        this.hit = false;  // Whether this marker's target has been hit
    }
    
    update(t) {
        if (this.hit) return;  // Don't update if target is already hit
        
        // Calculate position based on velocity
        const elapsed = t - this.tSpawn;
        this.x = this.spawnX + this.vx * elapsed;
        this.y = this.spawnY + this.vy * elapsed;
    }
    
    hasLeftYellowCircle() {
        // Check if marker has left the yellow circle (clickable area)
        // Only check after it has passed through the target center
        
        const yellowRadius = TARGET_RADIUS + 30;
        const dx = this.x - this.target.x;
        const dy = this.y - this.target.y;
        const distanceFromTarget = Math.sqrt(dx * dx + dy * dy);
        
        // Vector from spawn to target
        const toTargetX = this.target.x - this.spawnX;
        const toTargetY = this.target.y - this.spawnY;
        
        // Vector from current position to target
        const fromCurrentToTargetX = this.target.x - this.x;
        const fromCurrentToTargetY = this.target.y - this.y;
        
        // Check if marker has passed the target center:
        // If the dot product of (spawn->target) and (current->target) is negative,
        // it means we're on the opposite side of the target from where we started
        const dotProduct = toTargetX * fromCurrentToTargetX + toTargetY * fromCurrentToTargetY;
        const hasPassedTarget = dotProduct < 0;
        
        // Marker has left if it's beyond the yellow circle AND has passed through the target center
        return hasPassedTarget && distanceFromTarget > yellowRadius + MARKER_RADIUS;
    }
}

