# The Maldoror rendering engine

*Current production truth, 2026-07-23. Visual evidence is published at
<https://maldoror.dev/gallery>.*

Maldoror renders an AI-authored world as pure ANSI. The current path is one
composition:

```
world tiles + entities
  -> retained world pixels
  -> area-resampled LOD
  -> two-colour octant cells
  -> retained terminal codec
  -> bounded SSH output
```

## 1. Assets and world pixels

### Canal-town kit

`assets/canal-town/manifest.json` is the authority for the first production
biome. It declares:

- 33 architecture, bridge, quay, boat, foliage, water-detail, and street assets;
- four terrain masters expanded into 16 deterministic raster variants;
- each asset's placement roles, visual scale, and explicit collision offsets;
- the default traveler sprite.

The source generations remain under `assets/canal-town/generated/`; derived
alpha-clean runtime sprites remain under `sprites/` and `avatars/`. These assets were made
with Codex's built-in ChatGPT image-generation capability, not an unofficial
token scraper or a metered one-off script.

`CanalTownTileProvider` composes those assets into unbounded signed-coordinate
blocks: variable-width crossing canals, continuous curbs, east/west and
north/south bridge decks, dense building fronts, foliage, street furniture,
boats, and water detail. Its placement is deterministic from world seed and
block coordinate. Collision comes from terrain/manifest metadata, never colour
classification.

The kit and terrain grids load once per worker. Persisted player/NPC PNGs retain
their complete high-resolution data; shared bounded runtime caches select the
closest complete resolution to 128px by default. This holds production below
the 1.6 GiB cgroup limit without destroying source quality.

### Painter's order

`ViewportRenderer.renderToBuffer` composes terrain, roads, buildings, and
Y-sorted players/NPCs into a `PixelGrid`. It supports sub-tile cameras,
follow/free modes, 90-degree rotation, explicit viewport pixels, and a bounded
scaled-frame cache.

Downscaling uses area averaging rather than nearest-neighbour sampling. At the
live town's 30% zoom, a 160x46 terminal resolves each source tile to 12 screen
pixels while retaining roof, awning, foliage, and water texture.

Characters have their own semantic LOD. The active traveler is a retained,
prompt-provenanced 16x24-logical-pixel master rather than a portrait shrunk
until its anatomy disappears. Actors render at 1.25 terrain tiles,
bottom-centred on their authoritative collision tile, over a renderer-owned
upper-left-lit contact shadow.

## 2. Pixels to terminal cells

Ghostty-class terminals auto-select `octant`: every cell represents a 2x4
pixel sample with one glyph plus foreground/background colours. The fast
production fitter retains its brightness split and solid-cell path. A bounded
opponent-chroma gate detects the case brightness cannot represent—different
hues at nearly equal luminance—and uses two-cluster Oklab only for those cells.
The fixed reconstruction lab rejected global Oklab fitting: its target-scene
gain was visually slight for roughly five times the fitting cost.

Fallbacks remain:

- `halfblock`: 1x2 pixels per cell, broadly compatible;
- `braille`: 2x4 dotted representation;
- `normal`: background-colour cells for diagnostics.

The Ghostty octant path preserves truecolour. The earlier aggressive Bayer
quantizer is not imposed on the production view.

## 3. Motion and zoom

Logical movement updates immediately for collision/server state. Visual actor
coordinates interpolate over 200ms, and the follow camera has a small dead
zone. Inside it, only actor cells change; after crossing it, the retained
camera advances in whole terminal-cell steps that the codec can express as
scroll operations.

Zoom targets discrete 10% levels and follows a 180ms cubic ease. The viewport
uses the nearest useful source LOD and area-resamples to the exact screen size.
`primeCamera()` establishes the saved spawn after final zoom/layout restore and
before the first keyframe, preventing an expensive animation from `(0,0)`.

## 4. Terminal codec and animation

`terminal-codec.ts` owns the terminal framebuffer. It emits:

- full keyframes at startup, resize, teleport, or dependency loss;
- DECSTBM/DECSLRM plus SU/SD/DCH/ICH for exact camera translations;
- dirty cell intervals for actor/world repairs;
- cost-aware cursor moves, REP runs, and merged SGR;
- synchronized-output wrappers so compatible terminals apply a frame at once.

Water glints use eight reserved indexed palette slots. Only genuinely bright
water subpixels opt into those slots, leaving the source texture visible.
Each tick rotates the slots in one 157-byte OSC-4 packet. Startup queries and
saves the client's exact palette; cleanup restores it on every normal path.
Terminal replies are consumed by the renderer rather than leaking into game
input.

## 5. Backpressure and lifecycle

The worker returns complete encoded frames over IPC. Main-process
`SessionProxy` writes them through a 64 KiB, depth-one `OutputPump`. A slow
client may lose an unsent frame, but the proxy then requests a keyframe before
accepting another dependent delta. Stats expose queued bytes, drops, drain
events, written bytes, and peak queue.

SSH connections, shells, and worker sessions have distinct IDs and idempotent
cleanup. A `SIGUSR1` worker replacement preserves the established SSH sockets.
Main-process error/end/close hardening is source-complete and should be loaded
on the next safe full service restart after existing connections drain.

## 6. Measured production result

Real `TERM=xterm-ghostty` SSH capture at 160x46, July 23:

| condition | measured terminal bytes |
|---|---:|
| initial synchronized cell frame | 270,069 |
| six seconds after the initial frame, idle | 16,133 |
| idle frame distribution | 89 x 157 B palette, 2 x 1,080 B HUD |
| five seconds after one `d` input | 16,748 |
| extra traffic vs equivalent idle capture | 5,130 |

The idle capture contains zero camera scroll/catch-up operations after its first
frame. `codec-bench.mjs` independently reports a zero-byte ordinary idle delta,
321 bytes for a 0.2-tile actor update, and 1,181/315 bytes for one-cell x/y
camera translations.

The honest screenshot is
`tools/render-sim/out/live-canal-town-accepted-faithful.png`. It was produced by
replaying the actual SSH byte stream through `faithful-render.mjs`, including
palette changes, margins, scroll operations, REP, DCH, and ICH.

## 7. Verification loop

```
node tools/render-sim/canal-town-production.mjs
python3 tools/render-sim/capture-live.py tools/render-sim/out/live.bin --settle 6
node tools/render-sim/faithful-render.mjs tools/render-sim/out/live.bin 160 46
node tools/render-sim/codec-bench.mjs
pnpm test
```

Always look at the faithful PNG and compare it with
`tools/render-sim/gallery/TARGET.png`. An idealized source-image raster is a
useful development preview, not live acceptance evidence.
