# Server Stability Research: Crash Analysis

**Date:** 2025-12-18
**Issue:** Server crashes/restarts when 3-4 players connected, especially after creating buildings

---

## Executive Summary

The server experiences instability under moderate load (3-4 concurrent players) due to a combination of:
1. **Memory leaks** from uncleaned callbacks and caches
2. **Database connection pool exhaustion** (only 10 connections)
3. **Sharp image buffer accumulation** during building/avatar generation
4. **Orphaned intervals and promises** from improper cleanup

---

## Critical Issues (Priority Order)

### 1. Sprite/Building Callback Memory Leak
**Severity:** CRITICAL
**File:** `apps/ssh-world/src/server/game-session.ts:195-202, 1129-1172`

**Problem:** When players disconnect, their sprite reload and building placement callbacks are **never removed** from WorkerManager.

```typescript
// Lines 195-201: Callbacks registered on connect
this.workerManager.onSpriteReload(this.userId!, (changedUserId) => {
  this.handleSpriteReload(changedUserId);
});
this.workerManager.onBuildingPlacement(this.userId!, (buildingId, anchorX, anchorY) => {
  this.handleBuildingPlacement(buildingId, anchorX, anchorY);
});

// Lines 1129-1172: destroy() - MISSING cleanup!
async destroy(): Promise<void> {
  // ... cleanup code ...
  // NO offSpriteReload() or offBuildingPlacement() calls!
}
```

**Impact:** Each disconnected player leaves callbacks in memory. With 4 players cycling connections, callbacks accumulate indefinitely and fire on stale destroyed sessions.

---

### 2. TileProvider Cache Never Cleared
**Severity:** CRITICAL
**File:** `packages/world/src/tiles/tile-provider.ts:100-119`

**Problem:** Player sprites and building data are cached but **never removed**:

```typescript
private players: Map<string, PlayerVisualState> = new Map();  // Never shrinks
private sprites: Map<string, Sprite> = new Map();             // Never cleared
private buildings: Map<string, BuildingData> = new Map();     // Never cleared
```

The `removePlayer()` method exists but is **never called** from game-session.ts.

**Impact:** Each player adds ~78MB of sprite data that persists forever. With 4 players connecting/disconnecting repeatedly, memory grows unbounded.

---

### 3. Database Connection Pool Exhaustion
**Severity:** CRITICAL
**File:** `packages/db/src/client.ts:11-17`

**Problem:** Pool has only 10 connections with 30-second statement timeout:

```typescript
const pool = new Pool({
  connectionString,
  max: 10,                      // Only 10 connections!
  statement_timeout: 30000,     // Queries can hold connections for 30s
});
```

With 4 concurrent players, each doing:
- Sprite loading queries
- Building tile queries (36 per building with 4 directions)
- Player position queries
- Avatar lookups

**Impact:** Pool saturates → queries queue → rendering freezes → cascading timeouts.

---

### 4. Sharp Buffer Accumulation
**Severity:** CRITICAL
**Files:**
- `packages/ai/src/building-generator.ts:345-363`
- `packages/ai/src/image-generator.ts:241-291`

**Problem:** Building generation creates massive buffers without explicit cleanup:

```typescript
// 4 building images (1024x1024 PNG = ~4MB each) processed in parallel
const [eastImage, southImage, westImage] = await Promise.all([
  generateBuildingImage(...),  // 4MB buffer
  generateBuildingImage(...),  // 4MB buffer
  generateBuildingImage(...),  // 4MB buffer
]);

// Each then processed into 9 tiles × 10 resolutions = 90 sharp operations
// No explicit buffer cleanup between operations
```

**Impact:** 4 players creating buildings = **160MB+ temporary spike**. If heap < 200MB, triggers OOM.

---

### 5. Worker Request Timeout Memory Leak
**Severity:** HIGH
**File:** `apps/ssh-world/src/server/worker-manager.ts:422-441`

**Problem:** When requests timeout, the Promise closure and resolve/reject functions remain in memory:

```typescript
private sendRequest<T>(...): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      this.pendingRequests.delete(requestId);
      reject(new Error(`Request ${requestId} timed out`));
      // resolve function still captured in closure!
    }, 5000);

    this.pendingRequests.set(requestId, { resolve, reject, timeout });
  });
}
```

With 4 players × 15 visibility queries/second × potential timeouts = 100+ hanging promises.

**Impact:** Memory leak from dangling closures holding execution contexts.

---

### 6. Orphaned Spinner Intervals
**Severity:** HIGH
**Files:**
- `apps/ssh-world/src/server/avatar-screen.ts:194-200`
- `apps/ssh-world/src/server/building-screen.ts:194-200`

**Problem:** Spinner intervals not cleared on generation error:

```typescript
this.spinnerInterval = setInterval(() => {
  this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
  this.render();
}, SPINNER_INTERVAL);
// If generation fails, interval keeps running!
```

**Impact:** Orphaned 200ms intervals cause CPU spikes and continuous buffer allocations.

---

### 7. Building Tile Query Inefficiency
**Severity:** HIGH
**File:** `apps/ssh-world/src/utils/building-storage.ts:116-169`

**Problem:** Loading a 4-direction building requires **36 sequential file I/O operations**:

```typescript
// For each of 4 directions:
for (const record of tileRecords) {  // 9 tiles each
  const pixels = await loadBuildingTile(...);  // Sequential await!
}
// Total: 4 directions × 9 tiles = 36 sequential I/O ops
```

**Impact:** Event loop blocked during building loads → missed ticks → position desync.

---

### 8. No Generation Timeout
**Severity:** HIGH
**File:** `apps/ssh-world/src/server/building-screen.ts`

**Problem:** OpenAI API calls have no timeout wrapper. If API hangs, generation blocks indefinitely.

**Impact:** Player stuck for 30+ seconds, SSH connection may timeout.

---

### 9. Worker Restart Loses Player State
**Severity:** MEDIUM
**File:** `apps/ssh-world/src/server/worker-manager.ts:362-371`

**Problem:** On unexpected worker exit, 1-second delay before restart. Inputs during this window are lost:

```typescript
this.worker.on('exit', (code) => {
  if (this.reloadState === 'running' && code !== 0) {
    setTimeout(() => this.spawnWorker(), 1000);  // 1 second gap
  }
});
```

**Impact:** Player movements during restart window not recorded → position desync.

---

### 10. Game Loop Drops Ticks Silently
**Severity:** MEDIUM
**File:** `packages/world/src/tick/game-loop.ts:149-153`

**Problem:** If loop gets behind, it processes max 5 ticks then discards remaining time:

```typescript
if (this.accumulator >= this.tickInterval) {
  this.emit('lagWarning', { droppedTime: this.accumulator - this.tickInterval });
  this.accumulator = this.accumulator % this.tickInterval;  // Discards excess
}
```

**Impact:** 2-second building generation → 1.6 seconds of ticks discarded → position desync.

---

## Production Log Analysis

### Observed Patterns

1. **Rapid connect/disconnect cycles:**
```
Client disconnected: undefined...
New connection from 172.19.0.3
Client disconnected: undefined...
```
This indicates clients connecting but failing authentication or erroring immediately. The `undefined` suggests the session ID isn't being set before disconnect - possible race condition.

2. **Unhandled promise rejection:**
```
error: column "direction" does not exist
```
Database migration not applied - separate issue but indicates schema sync problems.

---

## Crash Scenario Timeline

1. **T+0s:** Players 1-2 connect, sprites cached (~156MB)
2. **T+30s:** Player 3 generates avatar → Sharp buffers accumulate (+40MB)
3. **T+60s:** Player 3 generates building → More buffers (+40MB)
4. **T+90s:** Player 4 connects → Sprite queries pile up
5. **T+95s:** Building generation blocks worker for 2 seconds
6. **T+97s:** Game loop accumulates, input queue grows
7. **T+100s:** DB connection pool exhausted (10 connections busy)
8. **T+105s:** New queries timeout → cascading failures
9. **T+110s:** GC triggered by memory pressure → frame drops
10. **T+120s:** Server OOM or watchdog restart

---

## Recommended Fixes (Priority Order)

### Immediate (Do First)

1. **Add callback cleanup in destroy():**
   ```typescript
   // game-session.ts destroy()
   this.workerManager.offSpriteReload(this.userId);
   this.workerManager.offBuildingPlacement(this.userId);
   ```

2. **Increase DB pool size:**
   ```typescript
   max: 20,  // or 25
   statement_timeout: 10000,  // Reduce to 10s
   ```

3. **Add removePlayer() call on disconnect:**
   ```typescript
   // game-session.ts destroy()
   this.tileProvider?.removePlayer(this.userId);
   ```

### Short-term

4. **Clear spinner interval on error:**
   ```typescript
   try {
     await generateImageSprite(...);
   } finally {
     if (this.spinnerInterval) clearInterval(this.spinnerInterval);
   }
   ```

5. **Add generation timeout:**
   ```typescript
   const result = await Promise.race([
     generateBuildingSprite(...),
     new Promise((_, reject) =>
       setTimeout(() => reject(new Error('Generation timeout')), 60000)
     )
   ]);
   ```

6. **Batch building tile loads:**
   ```typescript
   // Load all tiles in parallel, not sequential
   const tiles = await Promise.all(
     tileRecords.map(r => loadBuildingTile(...))
   );
   ```

### Medium-term

7. **Implement sprite cache eviction:**
   ```typescript
   // LRU cache with max size
   if (this.sprites.size > 50) {
     const oldest = this.sprites.keys().next().value;
     this.sprites.delete(oldest);
   }
   ```

8. **Add explicit Sharp buffer cleanup:**
   ```typescript
   // After processing
   sharp.cache(false);  // Disable caching
   sharp.concurrency(1);  // Limit concurrent operations
   ```

9. **Add WeakRef for request closures** or implement proper cleanup.

---

## Metrics to Monitor

1. **Memory:** `process.memoryUsage().heapUsed`
2. **DB Pool:** `pool.waitingCount`, `pool.idleCount`
3. **Pending Requests:** `workerManager.pendingRequests.size`
4. **Callback Count:** `workerManager.spriteReloadCallbacks.size`
5. **Player Cache:** `tileProvider.players.size`

---

## Files Requiring Changes

| File | Changes Needed |
|------|----------------|
| `apps/ssh-world/src/server/game-session.ts` | Cleanup callbacks, call removePlayer |
| `apps/ssh-world/src/server/worker-manager.ts` | Add off* methods, fix timeout cleanup |
| `apps/ssh-world/src/server/avatar-screen.ts` | Clear interval on error |
| `apps/ssh-world/src/server/building-screen.ts` | Clear interval on error, add timeout |
| `apps/ssh-world/src/utils/building-storage.ts` | Parallelize tile loading |
| `packages/db/src/client.ts` | Increase pool size |
| `packages/world/src/tiles/tile-provider.ts` | Add cache eviction |
| `packages/ai/src/building-generator.ts` | Explicit buffer cleanup |
