# Performance Optimization Ideas

5 concrete opportunities to speed up SSH terminal rendering, based on codebase analysis.

## 1. Tile Scaling Memoization Cache

**Location:** `viewport-renderer.ts:370-390` (`scaleFrame()`)

**Problem:** `scaleFrame()` is called multiple times per frame for every visible tile (tiles, buildings, players). It performs nearest-neighbor resampling every frame without caching - expensive work repeated identically when tile render size hasn't changed.

**Evidence:**
- Lines 273, 326, 423: Three separate `scaleFrame()` calls per entity type
- Each does pixel-by-pixel resampling: `O(targetWidth × targetHeight)`
- With 20+ visible tiles at high zoom, this scales with screen size

**Solution:**
```typescript
// Cache keyed by (frameId, targetWidth, targetHeight)
private scaledFrameCache: Map<string, PixelGrid> = new Map();

private scaleFrameCached(frame: PixelGrid, frameId: string, targetSize: number): PixelGrid {
  const key = `${frameId}:${targetSize}`;
  if (this.scaledFrameCache.has(key)) {
    return this.scaledFrameCache.get(key)!;
  }
  const scaled = this.scaleFrame(frame, targetSize);
  this.scaledFrameCache.set(key, scaled);
  return scaled;
}
```

**Expected Impact:** 30-50% render time reduction at high zoom

---

## 2. Batch Sprite Loading

**Location:** `game-session.ts:279-288`

**Problem:** When multiple players enter viewport, each sprite loads via independent async database query. Three players entering = 3 separate DB round-trips without batching.

**Evidence:**
- Loop through visible players, check if sprite exists
- `loadPlayerSprite()` called async for each missing sprite
- No batching - each makes its own DB/file query

**Solution:**
```typescript
// Collect all missing IDs first
const missingPlayerIds = visiblePlayers
  .filter(p => !this.tileProvider.getPlayerSprite(p.userId) && !this.loadingSprites.has(p.userId))
  .map(p => p.userId);

// Batch load all at once
if (missingPlayerIds.length > 0) {
  missingPlayerIds.forEach(id => this.loadingSprites.add(id));
  await this.batchLoadPlayerSprites(missingPlayerIds);
}
```

**Expected Impact:** 50-70% fewer DB round-trips with multiple players

---

## 3. Visible Players Query Threshold

**Location:** `game-session.ts:250-264`

**Problem:** Visible players list refreshes every 15 ticks OR whenever player moves. No debouncing for small movements - could be 15+ DB queries/second in busy areas.

**Evidence:**
- Refresh on `positionChanged || periodicRefresh`
- `getVisiblePlayers()` is async (DB/spatial index)
- No position delta threshold

**Solution:**
```typescript
// Only refresh if moved more than threshold
const POSITION_THRESHOLD = 2; // tiles
const positionChanged =
  Math.abs(this.playerX - this.lastQueryX) > POSITION_THRESHOLD ||
  Math.abs(this.playerY - this.lastQueryY) > POSITION_THRESHOLD;

// Increase periodic interval from 15 to 45 ticks
const periodicRefresh = this.tickCounter % 45 === 0;
```

**Expected Impact:** 50-80% fewer visible players queries

---

## 4. Resolution Pre-computation & Larger Cache

**Location:** `tile-provider.ts:155-178`

**Problem:**
- Procedural tile cache only holds 256 tiles (LRU eviction)
- No per-resolution caching
- `resizeNearest()` called at runtime for missing resolutions

**Evidence:**
- Falls back to `tile.pixels` if resolution missing, then scales in `scaleFrame()`
- `maxTiles = 256` is small for active gameplay
- Cache misses trigger runtime scaling

**Solution:**
```typescript
// Increase cache size
constructor(config: TileProviderConfig) {
  this.maxTiles = config.chunkCacheSize || 1024; // Up from 256
}

// Cache per-resolution variants
private resolutionCache: Map<string, PixelGrid> = new Map();

getResolution(tileId: string, resolution: number): PixelGrid {
  const key = `${tileId}:${resolution}`;
  if (!this.resolutionCache.has(key)) {
    const tile = this.getTile(tileId);
    this.resolutionCache.set(key, resizeNearest(tile.pixels, resolution));
  }
  return this.resolutionCache.get(key)!;
}
```

**Expected Impact:** 20-40% fewer runtime scalings

---

## 5. Building Spatial Hash Index

**Location:** `tile-provider.ts:320-343`

**Problem:** Every tile render calls `getBuildingTileAt()` which iterates ALL buildings doing position checks. O(N buildings) per visible tile. At 20 tiles × 8 buildings = 160 position tests/frame.

**Evidence:**
- `getBuildingTileAt()` loops through `this.buildings.values()`
- Calls `getBuildingTileIndex()` for every building
- `buildings` Map grows unbounded, no spatial partitioning

**Solution:**
```typescript
// Spatial hash by chunk
private buildingsByChunk: Map<string, Set<string>> = new Map();

private getChunkKey(x: number, y: number): string {
  const chunkX = Math.floor(x / 16);
  const chunkY = Math.floor(y / 16);
  return `${chunkX},${chunkY}`;
}

getBuildingTileAt(x: number, y: number): BuildingTileData | null {
  const chunkKey = this.getChunkKey(x, y);
  const nearbyIds = this.buildingsByChunk.get(chunkKey);
  if (!nearbyIds) return null;

  for (const id of nearbyIds) {
    const building = this.buildings.get(id);
    // Only check buildings in this chunk
    const tileData = this.getBuildingTileIndex(building, x, y);
    if (tileData) return tileData;
  }
  return null;
}
```

**Expected Impact:** 70-90% faster building lookups in dense areas

---

## Priority Matrix

| # | Optimization | Impact | Effort | Priority |
|---|-------------|--------|--------|----------|
| 1 | Tile scaling cache | 30-50% | Low | **HIGH** |
| 2 | Batch sprite loading | 50-70% | Medium | **HIGH** |
| 3 | Query threshold | 50-80% | Low | **MEDIUM** |
| 4 | Resolution cache | 20-40% | Medium | **MEDIUM** |
| 5 | Building spatial hash | 70-90% | Medium | **HIGH** |

**Quick wins:** #1 and #3 can be done in <1 hour each with immediate visible improvement.
