# The Maldoror rendering engine

*Current production truth, 2026-07-24. Visual evidence is published at
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

Real `TERM=xterm-ghostty` SSH capture at 160x46 from deployed `vea2e691`,
July 23:

| condition | measured terminal bytes |
|---|---:|
| startup plus first synchronized frame | 306,008 |
| subsequent six seconds, no input | 8,597 |
| synchronized frames | 44 |

`codec-bench.mjs` independently reports a zero-byte ordinary idle delta, 321
bytes for a 0.2-tile actor update, and 1,181/315 bytes for one-cell x/y camera
translations. After the live session populated its renderer caches, the service
cgroup was approximately 733 MiB current/peak with zero swap, inside its 1.6
GiB envelope.

The raw stream and faithful automated screenshot are retained under
`/mnt/donto-data/donto-resources/maldoror/rendering-research/track-4-world-composition/arrival-vea2e691/`.
The screenshot was produced by replaying the actual SSH byte stream through
`faithful-render.mjs`, including palette changes, margins, scroll operations,
REP, DCH, ICH, and ordinary text overlays. Block geometry and cell colours are
exact; the installed DejaVu Sans Mono font approximates Ghostty glyph metrics.
This is direction evidence, not physical operator acceptance.

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

### Regional production capture (2026-07-24)

The regional provider is live at `v14d6b58`. Its first retained 160x46 capture
failed the bandwidth gate: the one-world-minute-per-second simulation clock
forced seven global atmosphere repaints and 1,327,492 bytes after the first
frame over six seconds. The simulation cadence remains exact; a terminal-only
projector now presents 48 coherent global grades per world day, immediate
weather/season transitions, and localized one-second rain/storm animation.

The repeated real SSH capture retains 90 synchronized frames while reducing the
same steady window to 19,787 bytes (98.51%) with no full-world idle repaint.
The raw rejected/selected streams, faithful PNGs, hashes, database backup proof,
and exact `(17,-11)` to `(0,0)` login test live under
`/mnt/donto-data/donto-resources/maldoror/rendering-research/track-5-motion-transport/live-regional-deploy-v1/`.
Public gallery iteration 030 shows the selected faithful frame. Physical
Ghostty acceptance and sustained concurrency remain open.

### Fixed real-SSH acceptance atlas (2026-07-24)

Build `v4d6bebd` adds a separate loopback-only acceptance executable and an
owned scratch-Postgres harness. Production has no environment flag that can
enable fixture restoration. The fixed manifest covers 24 predetermined
coordinates, all six families, six transition pairs, three semantic zooms, two
Ghostty-class viewports, and day/clear, night/clear, day/rain, and night/storm.
Every capture travels through the real SSH/session/worker/render path and
retains its raw ANSI stream, faithful replay, dimensions, synchronized-frame
count, and SHA-256.

The completed audit contains 144/144 captures and 3,560 synchronized frames;
all 288 raw/image hashes match. It is intentionally **rejected**, not accepted.
The full sheets expose sparse/repeated composition, angular routes, rectangular
waterfront/crossing masses, crushed night hierarchy, and storm precipitation
that overwhelms biome identity. They also prove the alpha correction: Sharp
contain-padding is explicitly transparent, partial coverage survives loading,
and actors use linear-light alpha-over, eliminating the earlier black traveler
rectangle.

Evidence and the exact rejection are in
`/mnt/donto-data/donto-resources/maldoror/rendering-research/track-6-acceptance-atlas/acceptance-atlas-v3-final/`.
Public gallery iteration 031 exposes the walking, district, and regional review
sheets. A successful Gate-A atlas and physical Ghostty acceptance remain open.

### Night and storm hierarchy correction (2026-07-24)

The first Gate-A correction targets the exact rejected
`forest-west-deep` night-storm fixture rather than a new favourable coordinate.
The moonlit floor now preserves navigation values before weather grading;
storms retain a cool, darker state with less dominant precipitation; and
declarative lamps use a soft bounded falloff that remains visible over that
floor. A separate clear-night capture guards against flattening night into day.

In faithful real-SSH scene pixels, the forest-storm median rises from 23.01 to
28.79 while cool-streak coverage falls from 6.11% to 3.16%. The clear-night
guard raises median luminance from 33.92 to 45.83 and standard deviation from
9.14 to 12.45, preserving rather than compressing material contrast. Raw
streams, faithful frames, hashes, and the decision are retained under
`/mnt/donto-data/donto-resources/maldoror/rendering-research/track-6-acceptance-atlas/atmosphere-legibility-v1*/`.

This is a selected corrective sub-gate. It does not pass Gate A; the complete
fixed atlas must be recaptured after the remaining composition, route,
waterfront, and material-boundary defects are corrected.
