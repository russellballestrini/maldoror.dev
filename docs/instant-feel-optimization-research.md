# SSH Terminal MMO: Instant Feel Optimization Research

## Executive Summary

This document analyzes the rendering and network architecture of the Maldoror SSH terminal MMO to identify opportunities for making the game feel instant and smooth. The codebase already has sophisticated optimizations in place, but several high-impact opportunities remain unexploited.

**Current felt latency:** 130-200ms (input to visible effect)
**Target felt latency:** <100ms (instant feel)

---

## 1. Current Architecture Overview

### 1.1 Data Flow: Input → Display

```
SSH Client Terminal
    ↓ (raw bytes: arrow keys = ESC[A, ESC[B)
KeyParser.parse() [~0.5ms]
    ↓
InputRouter.process() [~0.5ms]
    ↓
WorkerSession.handleInput() [~0.1ms]
    ↓
GameServer.queueInput() [~0.1ms - instant queue]
    ↓ (waits for next game tick... 66ms)
GameServer.processTick() → pre-tick phase
    ↓
gameServer.processInput() [~1ms]
    ↓
WorkerSession.render() [~20-50ms]
    ↓
ViewportRenderer.renderToBuffer() [~15-30ms]
    ↓
PixelGameRenderer.render() [~20-40ms]
    ↓
OutputPump.enqueue() → stream.write()
    ↓
SSH Network [RTT: 20-100ms]
    ↓
Terminal renders [16ms at 60Hz]
```

### 1.2 Key Components

| Component | File | Purpose |
|-----------|------|---------|
| KeyParser | `packages/render/src/input/key-parser.ts` | Parse ANSI escape sequences |
| InputRouter | `packages/render/src/components/input-router.ts` | Route input to handlers |
| GameServer | `packages/world/src/tick/game-server.ts` | Game state, tick loop |
| GameLoop | `packages/world/src/tick/game-loop.ts` | Fixed timestep loop (15Hz) |
| ViewportRenderer | `packages/render/src/pixel/viewport-renderer.ts` | World → pixel buffer |
| PixelGameRenderer | `packages/render/src/pixel/pixel-game-renderer.ts` | Pixels → ANSI stream |
| OutputPump | `packages/render/src/transport/output-pump.ts` | Backpressure-aware streaming |
| PredictionCache | `packages/render/src/pixel/prediction-cache.ts` | Pre-computed frame predictions |

---

## 2. Current Optimizations (Already Implemented)

### 2.1 CRLE (Chromatic Run-Length Encoding) ✓
- **Status:** Enabled by default
- **Effect:** Groups cells by color, reduces escape codes by 40-60%
- **Location:** `pixel-game-renderer.ts`

### 2.2 Foveated Temporal Rendering ✓
- **Status:** Implemented but DISABLED by default
- **Zones:**
  - Zone A (core 3 tiles): 60Hz update
  - Zone B (6 tiles around): 15Hz update
  - Zone C (periphery): 4Hz update
- **Effect:** ~70% fewer cells processed in periphery

### 2.3 Frame Skipping ✓
- Skips full render if camera position unchanged
- Only updates stats bar at 1Hz (cached)

### 2.4 Color Quantization ✓
- Zoom >70%: 4-bit quantization (16 levels)
- Zoom >50%: 5-bit quantization (32 levels)
- Uses ordered dithering to avoid banding

### 2.5 Cell-Level Diffing ✓
- Only sends changed cells to SSH stream
- Uses relative cursor positioning

### 2.6 Backpressure Handling ✓
- OutputPump drops old frames when backlogged >512KB
- Keeps latest frame for responsiveness

### 2.7 Prediction Cache ⚠️
- **Status:** IMPLEMENTED but NOT INTEGRATED
- **Location:** `packages/render/src/pixel/prediction-cache.ts`
- Pre-renders 4 predictions: continue, stop, turn-left, turn-right
- Sub-millisecond response on prediction hit
- **Expected hit rate:** ~45% continue, 30% stop, 25% turns

---

## 3. Key Bottlenecks

### Bottleneck 1: Input Latency (66ms minimum)

```
Problem: Input queued but processed in pre-tick of NEXT game loop tick
Current: SSH input → queue → wait 66ms → pre-tick → render → network
Result:  130-200ms felt latency
```

**Why it matters:** MMO feel depends on <100ms input response.

### Bottleneck 2: Disabled Foveated Rendering

```
Current:   CRLE alone = ~40-60% bandwidth reduction
Potential: CRLE + Foveated = ~70-80% reduction
Wasted:    ~2-3KB per frame on periphery updates at full rate
```

### Bottleneck 3: Unused Prediction Cache

- Fully implemented, tested, ready to use
- Never integrated into WorkerSession
- Zero-copy pre-computed diffs sitting idle

### Bottleneck 4: No Client-Side Interpolation

- Server sends position at 15Hz
- Client renders immediately (no smoothing)
- Network jitter causes character jumping

### Bottleneck 5: Stats Bar Always Updates

- FPS/bytes display changes every frame
- Forces re-render even when world unchanged
- ~50 bytes/frame wasted

---

## 4. Novel Optimization Opportunities

### 4.1 Input-Driven Rendering (HIGH IMPACT)

**Current:** Fixed 15Hz game tick, input waits for next tick
**Proposed:** Input immediately triggers optimistic render

```typescript
// When input received, don't wait for tick
onInput(input) {
  // Immediate optimistic position update
  const predictedPos = this.predictPosition(input);
  this.queueOptimisticRender(predictedPos);

  // Also queue for authoritative tick
  this.gameServer.queueInput(input);
}
```

**Effect:** Input → visible = ~50ms instead of 130ms

### 4.2 Integrate Prediction Cache

**Current:** PredictionCache exists but never called
**Proposed:** Use predictions for instant response

```typescript
// Every N ticks, pre-render predictions
if (tick % 10 === 0) {
  this.predictionCache.preRenderPredictions(playerState, camera);
}

// On input, check cache first
onInput(input) {
  const cached = this.predictionCache.getPrediction(input.direction);
  if (cached) {
    this.outputPump.enqueue(cached.diff); // Sub-1ms response
    return;
  }
  // Fall back to normal render
}
```

**Effect:** 45% of moves respond in <1ms

### 4.3 Progressive/Incremental Rendering

**Concept:** Render in priority order within frame budget

```
Priority Order:
1. Player position (1-2ms) - ALWAYS
2. Nearby players (5-10ms) - HIGH
3. Visible NPCs (5ms) - MEDIUM
4. World tiles (20-30ms) - LOW
5. Periphery (0-10ms) - IDLE
```

**Effect:** Core gameplay stays responsive under load

### 4.4 Adaptive Bandwidth Control

**Current:** Drop frames when >512KB backlogged
**Proposed:** Graceful quality degradation

```typescript
adaptQuality(backlogBytes: number) {
  if (backlogBytes > 1024 * 1024) {
    this.setViewportScale(0.5);  // Reduce resolution
  } else if (backlogBytes > 512 * 1024) {
    this.setFrameSkip(2);  // Every other frame
  } else if (backlogBytes > 256 * 1024) {
    this.setColorDepth(4);  // Reduce colors
  }
}
```

**Effect:** Smooth quality reduction instead of freezing

### 4.5 Client-Side Position Interpolation

**Current:** Server 15Hz → Client renders immediately
**Proposed:** Client interpolates at 60Hz

```
Server sends: { x, y, velocity, direction, timestamp }
Client does:  lerp(lastPos, targetPos, localTime - serverTime)
```

**Effect:** Smooth 60Hz motion from 15Hz server updates

### 4.6 Delta-Encoded Position Streams

**Current:** Full render each frame
**Proposed:** Delta-only for moving entities

```typescript
// Instead of re-rendering 100 players
sendPositionDeltas([
  { id: 1, dx: 1, dy: 0 },  // 5 bytes
  { id: 2, dx: 0, dy: -1 }, // 5 bytes
]);
// Client applies deltas locally
```

**Effect:** 100 moving players = ~500 bytes instead of full re-render

### 4.7 Animation State Machine (Client-Side)

**Current:** Server sends animation frame 0-3 every tick
**Proposed:** Client manages animation timing

```typescript
// Server sends state changes only
{ state: 'walking', direction: 'north', speed: 1.0 }

// Client picks animation frame locally
const frame = Math.floor(localTime * speed) % 4;
```

**Effect:** 4x smoother animation, less bandwidth

### 4.8 Speculative Execution for Projectiles

**For future projectile system:**

```typescript
// Fire projectile optimistically
onFireProjectile(target) {
  // Client shows projectile immediately
  this.renderProjectile(start, target, localTime);

  // Server validates and corrects if needed
  this.server.queueProjectile(target);
}
```

**Effect:** Instant visual feedback, server validates

---

## 5. Implementation Priorities

### P0: Quick Wins (< 1 hour total)

| Task | Impact | Time |
|------|--------|------|
| Enable foveated rendering by default | 20-30% bandwidth reduction | 5 min |
| Reduce stats bar update to 0.5Hz | ~25 bytes/frame saved | 10 min |

### P1: High Impact (1-3 hours each)

| Task | Impact | Time |
|------|--------|------|
| Integrate PredictionCache | 45% of moves respond <1ms | 30 min |
| Input-driven immediate render | ~50ms latency reduction | 2 hours |
| Client-side position interpolation | Smooth 60Hz motion | 3 hours |

### P2: Medium Impact (4-6 hours each)

| Task | Impact | Time |
|------|--------|------|
| Adaptive bandwidth scaling | Graceful degradation | 4 hours |
| Progressive viewport rendering | Responsive under load | 6 hours |

### P3: Future Enhancements

| Task | Impact | Time |
|------|--------|------|
| Delta-encoded position streams | Massive multi-player scale | 8 hours |
| Client-side animation timing | Smooth animation | 1 hour |
| Speculative projectile rendering | Instant combat feel | 4 hours |

---

## 6. Micro-Optimizations Checklist

- [ ] String pooling for common ANSI codes (~10% faster)
- [ ] Pre-compute direction mapping lookup tables
- [ ] Reuse typed arrays for pixel buffers (reduce GC)
- [ ] Cache tile bounding boxes per frame
- [ ] Debounce resize events
- [ ] Lazy-load sprite resolutions
- [ ] Implement LRU viewport cache (partially exists)

---

## 7. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SSH CLIENT                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │
│  │   Input     │───▶│  Terminal   │◀───│   Network   │              │
│  │  (keyboard) │    │  (display)  │    │   Buffer    │              │
│  └─────────────┘    └─────────────┘    └──────▲──────┘              │
└─────────────────────────────────────────────────│────────────────────┘
                                                  │ SSH/TCP
┌─────────────────────────────────────────────────│────────────────────┐
│                         SERVER                  │                     │
│  ┌─────────────┐    ┌─────────────┐    ┌───────┴──────┐              │
│  │  KeyParser  │───▶│ InputRouter │───▶│ OutputPump   │              │
│  └─────────────┘    └──────┬──────┘    └──────▲───────┘              │
│                            │                  │                       │
│                     ┌──────▼──────┐    ┌──────┴───────┐              │
│                     │ GameServer  │───▶│PixelRenderer │              │
│                     │  (15Hz)     │    │   + CRLE     │              │
│                     └──────┬──────┘    └──────▲───────┘              │
│                            │                  │                       │
│                     ┌──────▼──────┐    ┌──────┴───────┐              │
│                     │  GameLoop   │    │  Viewport    │              │
│                     │ (tick/pre/  │    │  Renderer    │              │
│                     │  post)      │    │              │              │
│                     └─────────────┘    └──────────────┘              │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │                    UNUSED/DISABLED                           │     │
│  │  ┌─────────────────┐    ┌─────────────────┐                 │     │
│  │  │ PredictionCache │    │ Foveated Render │                 │     │
│  │  │ (implemented)   │    │ (disabled)      │                 │     │
│  │  └─────────────────┘    └─────────────────┘                 │     │
│  └─────────────────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 8. Conclusion

The codebase is production-quality with thoughtful optimizations. The biggest wins come from:

1. **Enabling what's already built** (foveated rendering, prediction cache)
2. **Reducing input latency** (input-driven rendering vs waiting for tick)
3. **Client-side smoothing** (interpolation at 60Hz from 15Hz updates)

These changes can reduce felt latency from 130-200ms to <100ms, achieving the "instant feel" goal. For future features like projectiles, the speculative execution pattern will be essential.

---

*Generated: 2024-12-27*
*Agent: Maldoror Architecture Analysis*
