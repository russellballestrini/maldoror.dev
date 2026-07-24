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

The selected code is live as `vb07c0d4`. Deployment auditing exposed and fixed
a stale-artifact seam: the SSH package build now copies `src/version.json` into
`dist/version.json`, and the production startup banner was checked after a
zero-session controlled restart. The replacement worker reached regional ready
in 8.37 seconds at 671 MB RSS and restored both persistent NPCs. A fresh public
SSH capture at exact `(0,0)` retained 32 synchronized frames, 309,531 total
bytes, and 6,713 steady bytes. Gallery iteration 032 exposes that live frame and
the exact rejected/selected night-storm pair.

### Connected focal-block composition (2026-07-24)

The first post-atlas composition pass rejects placement-only density as
insufficient. V1-V3 proved that more isolated 5x4 masses still read as props;
V4-V10 then established a larger focal-asset contract, authoritative route-axis
selection, full-silhouette centering, explicit walkable-frontage collision, and
a nearest-legal symmetric anchor search. The selected V11 arrival uses two
distinct 10x14 canal-town blocks on opposite sides of the arterial. It does not
mirror one source or infer function from image pixels.

The source PNGs were created through the built-in Codex/ChatGPT image-generation
subscription, not a metered API. Exact prompts, source and derived SHA-256,
alpha metrics, and runtime semantics live under `assets/biomes/generated/` and
`assets/biomes/parcel-components-manifest.json`. Reproduce and validate all
three alpha-keyed assets with:

```
pnpm assets:derive-canal-town-focals
```

The V11 real-SSH proof retains walking, district, and regional captures at
160x46 and 210x60: 2,170,860 raw bytes and 150 synchronized frames. The exact
fresh-login origin remains `(0,0)` and both focal placements preserve arterial
access. Evidence and the complete eleven-step rejection ladder are in
`/mnt/donto-data/donto-resources/maldoror/rendering-research/track-6-acceptance-atlas/composition-hierarchy-v11-two-sided-street-wall/`.
Gallery iteration 033 exposes V3, one-sided V10, selected two-sided V11, and all
three reference zooms.

Repository verification passes 37 files / 196 tests, all 18 typecheck tasks,
all 12 build tasks, and exact SHA-256/alpha reproduction for the three derived
focal assets.

This is a selected composition sub-gate, not Gate A. The blocks still sit near
the walking viewport edges; paving, canal/quay continuity, district density,
horizontal counterparts, and five biome-specific focal vocabularies remain
open. Production is unchanged at `vb07c0d4`.

### Scale-authored landmark paving and semantic entrances (2026-07-24)

V12-V19 prove why a seamless texture alone is not enough. Route-derived brown
wash, procedural joints over coarse arterial stone, oversized pale plates,
cloudy SDF islands, synchronized H sidewalks, and a readable material under a
wrong ladder grammar are all retained as visual rejections. The general terrain
sampler also averaged four unrelated paver phases on narrow surfaces, erasing
mortar contrast. Landmark paving now uses one deterministic scale-authored
mapping rather than that open-terrain blend.

Two untouched limestone sources were generated through the built-in
Codex/ChatGPT subscription path with no metered project API. V1 is retained as
a rejected fine-frequency source. Selected V2 deliberately uses broad stones,
dark joints, strong mid-scale value groups, and one full-master variant so its
construction survives 12-pixel tiles and ANSI octant fitting. Exact prompts,
source hashes, derived hashes, and the deterministic 192x192 derivation live in
`assets/biomes/generated/` and
`tools/render-sim/derive-landmark-fabric-materials.mjs`. Reproduce it with:

```
pnpm assets:derive-landmark-fabric-materials
```

The focal sprites already contain their own edge sidewalks. V20 therefore
removes full facade bands and encodes normalized entrance stations in the
parcel manifest. The continuous world layer emits only a small worn threshold
and one narrow approach at each authored station; it does not inspect filenames
or pixels, paints no water, and leaves most terrain untouched. Six exact-origin
real-SSH captures retain walking/district/regional zooms at both Ghostty
viewports: 2,171,890 raw bytes and 150 synchronized frames. Full verification
passes 38 files / 200 tests, 18/18 typecheck tasks, 12/12 build tasks, and exact
V2 derivation. Evidence is under
`track-6-acceptance-atlas/composition-hierarchy-v20-authored-entry-thresholds/`;
gallery iteration 034 exposes rejections, source, and selected three-scale
frames.

This selects an entrance-grounding architecture and material tier only. It is
not deployed, does not pass Gate A, and does not close canal/quay continuity,
civic-space composition, the five remaining family vocabularies, performance,
the fresh full atlas, or physical Ghostty acceptance.

### Hydrology-owned place hierarchy and semantic quay LOD (2026-07-24)

V21-V26 correct a deeper contradiction exposed by the failed atlas: strong
canal-town family weights could repaint physically wet cells as beige town
material while the material/collision mask still identified water. The
regional compositor now resolves continuous water coverage before cultural
overlays. Wet pixels reconstruct from the authored coast/water material;
canal-town and ruins overlays fade out before the wet boundary. Visible
material, collision, and world hydrology therefore agree.

The singular arrival no longer promotes every incident graph edge to a broad
arterial. The route field deterministically chooses the most nearly collinear
pair as one through arterial and leaves other arrival access local. Named route
half-widths survive into the sample apron, while the route manifest owns each
class's world-space texture scale and separate near/map opacity. Infrastructure
can remain legible without erasing the place it crosses.

V22's first continuous quay is retained as a rejection because its pale paver
edge collapsed into a bright staircase at district and regional zoom. The
selected V23 semantic LOD uses broad limestone only at walking scale on the dry
side of the hydrology edge, with a restrained wet contact; map scales use a
broader, lower-contrast town material. This is a material/ownership sub-gate,
not a claim that a complete walkable quay program exists.

V24 proved that eroding only binary bridge coverage did not fix the rectangular
slab. V25 now carries interpolated route distance and half-width through the
compositor so visible timber and material-mask ownership share a narrower deck
cross-section. Route-aligned edge/support shading adds a first construction
rhythm. The real-SSH V26 audit shows the deck is narrower but still rejects it
as a final crossing: the bar-like silhouette, abrupt banks, absent approaches,
and weak support/load story remain visible.

The 9/9 V26 real-SSH frames retain 2,564,855 raw bytes and 225 synchronized
frames across exact origin, west waterfront, and coast crossing at all three
semantic zooms. Cold readiness was 22.554 seconds and RSS reached 826 MB, both
failures against the final envelope. Evidence and the complete selected/rejected
ladder are under
`track-6-acceptance-atlas/composition-hierarchy-v26-real-ssh-water-route-crossing/`.
Public gallery iteration 035 exposes V22/V24 rejects, the V23/V25 selected or
partial candidates, and the three V26 zoom sheets. Full verification passes 38
files / 204 tests, 18/18 typecheck tasks, and 12/12 build tasks. Production
remains `vb07c0d4`; Gate A and physical Ghostty acceptance remain open.

The deployed fresh-login invariant was then checked separately with one
returning account through real SSH. The first capture moved from the canonical
origin to authoritative `Pos: (12, 0)` before disconnect; the second login with
the same key rendered `Pos: (0, 0)`. The two retained streams contain 364,400
and 284,492 bytes with 30 and 62 synchronized frames. This proves the public
worker login reset, not physical Ghostty operation. Evidence is in
`track-6-acceptance-atlas/login-origin-reconnect-v1/`.

### Structural bridge cross-section and semantic route width (2026-07-24)

V27-V32 continue at the exact V26 coast crossing rather than selecting a new
site. The renderer now treats the crossing as deck plus substructure: continuous
water coverage locates stone bank seats, the signed local route cross-section
adds one-light-direction rail relief and side shadow, and the route-aligned
longitudinal frame supplies sparse timber support cadence. The visible deck and
walkability/material mask retain the same shaped coverage.

V28 is an important retained rejection. Its first signed-distance pass used
distance to an infinite tangent line as route authority. That extended paths
beyond their actual endpoints and spawned a false parcel mass. V29 restores
endpoint-capped Euclidean distance as authority and carries the side sign
separately; the exact provider placement counts return to the pre-defect state.

The route manifest now authors detail and overview width independently from
opacity for every route class. Walking scale preserves construction width;
district and regional scales use a narrower semantic cross-section so routes
remain connected and legible without becoming broad tan carpets. A regression
compares the painted overview fraction against the detail fraction.

V33 verifies this state through 9/9 fresh scratch real-SSH captures at exact
origin, west waterfront, and coast crossing over walking/district/regional
zoom. It retains 2,566,848 raw bytes and 225 synchronized frames with all
position, zoom, and OCTANT assertions. Cold worker readiness was 10.081 seconds
and worker RSS reached 819 MB; repeated coordinator heap warnings remain an
explicit performance failure. Evidence is under
`track-6-acceptance-atlas/composition-hierarchy-v33-real-ssh-structural-crossing/`.

This selects the cross-section and route-width architecture, not the bridge as
finished art. The centre is still rectilinear, approaches lack terrain-shaped
taper and wear, support locations are cadence-based rather than span-aware, and
only one bridge vocabulary exists. Production remains `vb07c0d4`; Gate A and
physical Ghostty acceptance remain open.
