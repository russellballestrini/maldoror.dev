# SSH World Architecture

## Overview

SSH World is a multiplayer terminal-based game where players connect via SSH and explore a procedurally generated world. The architecture uses a server-authoritative model with optimistic client updates.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SSH Server (Port 2222)                        │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      GameServer (Singleton)                      │   │
│  │                         15 Hz tick loop                          │   │
│  │                                                                  │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │   │
│  │  │ PlayerState  │  │ SpatialIndex │  │    InputQueue      │    │   │
│  │  │   Map<id>    │  │  (hash grid) │  │ (sorted by time)   │    │   │
│  │  └──────────────┘  └──────────────┘  └────────────────────┘    │   │
│  │                                                                  │   │
│  │  Pre-tick: drain inputs → Tick: update anims → Post-tick: sync  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│            ┌───────────────────────┼───────────────────────┐           │
│            │                       │                       │           │
│            ▼                       ▼                       ▼           │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐   │
│  │  GameSession 1  │    │  GameSession 2  │    │  GameSession 3  │   │
│  │   60ms render   │    │   60ms render   │    │   60ms render   │   │
│  │                 │    │                 │    │                 │   │
│  │ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │   │
│  │ │TileProvider │ │    │ │TileProvider │ │    │ │TileProvider │ │   │
│  │ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │   │
│  │ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │   │
│  │ │  Renderer   │ │    │ │  Renderer   │ │    │ │  Renderer   │ │   │
│  │ │ (viewport)  │ │    │ │ (viewport)  │ │    │ │ (viewport)  │ │   │
│  │ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │   │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘   │
│           │                      │                      │             │
│           ▼                      ▼                      ▼             │
│      SSH Stream 1           SSH Stream 2           SSH Stream 3       │
│      (ANSI output)          (ANSI output)          (ANSI output)      │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                            ┌─────────────┐
                            │  Database   │
                            │ (sprites,   │
                            │  players)   │
                            └─────────────┘
```

## Component Details

### GameServer (Singleton)

- **Tick Rate:** 15 Hz (66.67ms per tick)
- **Responsibilities:**
  - Maintains authoritative player state (position, direction, animation)
  - Processes input queue from all clients
  - Manages spatial index for efficient viewport queries
  - Broadcasts state changes to connected sessions

**Game Loop Phases:**
1. **Pre-tick:** Drain and process input queue (sorted by timestamp)
2. **Tick:** Update animation frames, game logic
3. **Post-tick:** Reserved for state broadcast

### GameSession (Per Client)

- **Render Rate:** ~17 Hz (60ms interval)
- **Responsibilities:**
  - Handle SSH stream I/O
  - Process keyboard input
  - Query visible players from GameServer
  - Render viewport to terminal via ANSI codes

**Render Loop:**
1. Update local animation frame (if moving)
2. Query `getVisiblePlayers()` from GameServer
3. Update TileProvider with player sprites
4. Render frame with PixelGameRenderer
5. Draw overlays (username labels, Tab menu)

### Rendering Pipeline

```
TileProvider (world + players)
       │
       ▼
ViewportRenderer
       │
       ├── Render tiles at camera position
       ├── Sort players by Y (layering)
       ├── Composite sprites onto buffer
       └── Generate text overlays
       │
       ▼
PixelGameRenderer
       │
       ├── Downsample if scale > 1
       ├── Convert to ANSI (braille/halfblock/normal)
       ├── Incremental update (only changed lines)
       └── Apply text overlays
       │
       ▼
SSH Stream (ANSI output)
```

### Render Modes

| Mode      | Resolution          | Performance |
|-----------|---------------------|-------------|
| Braille   | 2px/char, 4px/row   | Highest res, slower |
| Halfblock | 1px/char, 2px/row   | Balanced (default) |
| Normal    | 0.5px/char, 1px/row | Lowest res, fastest |

## Data Flow

### Input Flow
```
Keyboard → InputHandler → GameSession.handleAction()
                              │
                              ├── Local: Optimistic update (immediate)
                              │
                              └── Server: queueInput() + updatePlayerPosition()
                                              │
                                              ▼
                                     GameServer.inputQueue
                                              │
                                              ▼ (pre-tick)
                                     Process & apply to PlayerState
```

### State Sync Flow
```
GameServer.PlayerState
       │
       ▼ (each client render tick)
getVisiblePlayers(viewport)
       │
       ▼
SpatialIndex.getPlayersInViewport()
       │
       ▼
Filter online players in viewport
       │
       ▼
Return to GameSession for rendering
```

## Performance Optimizations (Implemented)

### 1. Tick Rate Synchronization ✅
- **Issue:** Server (67ms) vs Client render (60ms) caused animation jitter
- **Solution:** Client render loop now uses 67ms interval to match server's 15Hz tick rate
- **Location:** `game-session.ts:173`

### 2. Cached Visible Players Query ✅
- **Issue:** Each client called `getVisiblePlayers()` every render tick
- **Solution:** Results cached per session, only re-queried when player position changes
- **Location:** `game-session.ts:201-213` - `cachedVisiblePlayers`, `lastQueryX`, `lastQueryY`

### 3. Incremental Overlay Redraw ✅
- **Issue:** Username labels forced full screen redraw every frame
- **Solution:** Track overlay count changes, only force full redraw when overlay count changes
- **Location:** `pixel-game-renderer.ts:362-364` - `previousOverlayCount`

### 4. Sprite Loading Deduplication ✅
- **Issue:** `loadPlayerSprite()` could fire multiple times during render ticks
- **Solution:** Track sprites being loaded in a Set, skip duplicate load requests
- **Location:** `game-session.ts:229-237` - `loadingSprites` Set

### 5. Batched Stream Output ✅
- **Issue:** Multiple `stream.write()` calls per frame
- **Solution:** `renderToString()` returns frame as string, concatenate with overlays, single write
- **Location:** `pixel-game-renderer.ts:529-577`, `game-session.ts:243-254`

## File Locations

| Component | Path |
|-----------|------|
| SSH Server | `apps/ssh-world/src/server/ssh-server.ts` |
| Game Server | `apps/ssh-world/src/game/game-server.ts` |
| Game Session | `apps/ssh-world/src/server/game-session.ts` |
| Game Loop | `packages/world/src/tick/game-loop.ts` |
| Pixel Renderer | `packages/render/src/pixel/pixel-game-renderer.ts` |
| Viewport Renderer | `packages/render/src/pixel/viewport-renderer.ts` |
| Spatial Index | `packages/world/src/spatial/spatial-index.ts` |
| Tile Provider | `packages/world/src/tiles/tile-provider.ts` |
