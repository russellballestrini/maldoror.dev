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

### Bounded bridge landings and coastal road subgrade (2026-07-24)

V34-V39 continue at the same fixed coast crossing. `RegionalRouteSample` now
separates the physical crossing core from its bounded structural context. It
carries bank-to-bank span plus signed longitudinal progress (`-1/+1` at the
banks); `crossingKind` remains the water/collision authority, while
`crossingInfluenceKind` exists only across the short dry landing approaches.
Tests pin wet core, dry approach, far ordinary road, cache equality, and the
rule that visual landing influence cannot clear the water material mask.

The compositor uses that frame to taper material from timber into the route,
flare the bank section, slightly waist the mid-span deck, station stone
abutments at both banks, derive panel/post count from span, and place one or two
support stations according to span. A channel-specific warm deck lift retains
readability after OCTANT reduction. Ordinary physically dry roads in a strong
coast field receive a subtle wider subgrade at overview LOD; bridge/ford/ferry
cores do not. This repairs a case where correct dry route geometry looked like
a vector drawn over water because coarse coast material visually submerged the
narrow bank.

V34 (long dark bar), V36 (too-dark warm deck), and V38 (ineffective generic
ground restoration) remain rejections. V39 is selected only as the next
crossing architecture. Its origin safeguards are byte-identical at walking,
district, and regional zoom, and the west-waterfront walking composition is
unchanged.

V40 proves V39 through 9/9 fresh-scratch real-SSH frames at origin, west
waterfront, and coast crossing over all three semantic zooms. It retains
2,376,797 raw bytes and 223 synchronized frames with all position, zoom, and
OCTANT assertions. Cold readiness was 10.188 seconds; worker RSS grew from
about 818 MB to about 952 MB; coordinator heap warnings reached 94%. The strict
complete-atlas validator correctly rejects the three-site fixture as
incomplete. Evidence is under
`track-6-acceptance-atlas/composition-hierarchy-v40-real-ssh-landing-and-subgrade/`.
Full verification passes 38 files / 208 tests, 18/18 typecheck tasks, and 12/12
build tasks.

This does not pass Gate A. The bridge is still more rectilinear than the target
bar, only one bridge vocabulary exists, and approach wear, longer-span support
variation, topology-specific crossings, the fresh complete atlas, load, and
physical Ghostty acceptance remain open. Production remains `vb07c0d4`.

## Packed authored raster ownership

The first Gate-D memory profile found the largest retained duplication below
the renderer: the complete regional kit held roughly 4.6 million authored
source pixels as nested JavaScript arrays of RGB objects in both the coordinator
and persistent generator. Forced-GC kit heap grew by 181.35 MiB, even though the
transport and imported viewport paths already used typed RGBA planes.

Regional material masters and multi-tile silhouettes now keep their immutable
source raster in `PackedPixelGrid`. The compositor reads material bytes directly;
visibility, overlap composition, prewarm packing, and the renderer accept the
same packed form. The painterly resampler has a packed-source path whose output
is exact against object-grid reconstruction at native size, reduction, and
enlargement. Alpha below the existing authored threshold remains transparent;
partial alpha remains byte-exact. No art or placement vocabulary is removed.

On the identical two-isolate readiness proof, peak RSS falls from 863.508 to
546.707 MiB and total origin readiness from 9.761 to 8.949 seconds. Both the
origin and traversal hashes remain unchanged. The full 180-frame 160x46
predictive proof peaks at 570.40 MiB with render p50/p95/p99
4.44/7.84/18.92 ms, event-loop-delay p99 5.79 ms, and no coverage miss,
mismatch, or worker error. This is a selected architecture increment, not a
Gate-D pass: real-SSH churn, load ladder, long run, bandwidth, cgroup, and
physical Ghostty evidence remain open. Detailed evidence is under
`track-7-performance/packed-raster-v1/` on the mounted research drive.

### Civic bridge, canal depth, and semantic civic life (2026-07-25)

V50-V66 refine the origin canal as one shared physical and visual composition.
`RegionalInfrastructureVisualProfile` controls the civic stone/timber deck
mix, bank-landing flare, mid-span waist, and quay surface articulation. The
same shaped bridge coverage owns visible material and the physical route;
quay joints, edge wear, and patina use continuous waterway progress and world
coordinates without moving the shared walkable quay ribbon.

`RegionalWaterVisualProfile` adds broad and fine current plus flow-aligned
crests. Constructed waterways use their actual tangent, half-width, and signed
bank distance, producing a darker deep core and lighter shallows while leaving
the water material mask and collision ownership unchanged. Seed direction
provides the same continuous treatment for non-constructed water. V56/V57's
tonal-only studies and V58/V59's incomplete crest studies remain rejected;
V60's depth-and-flow treatment is selected.

The semantic civic-detail kit is declared in
`assets/biomes/civic-details-manifest.json`. Its four modules came from the
built-in Codex image generator on the ChatGPT subscription, not a metered API.
The exact generation prompt and source hash live beside the source atlas in
`assets/biomes/generated/canal-town-civic-life-atlas-v1-source.md`.
`pnpm assets:derive-canal-civic-details` performs strict hash-gated cropping,
chroma removal, trim/padding, and output verification. Runtime loading validates
biome, route-distance, landmark-distance, family-weight, collision, light, and
sprite metadata rather than inferring semantics from filenames.

Placement scans real landmark cells for semantic eligibility before ranking
them deterministically. It reserves the complete visible and collision
footprint of the focal composition, preserves route cores, applies a
data-driven repetition penalty, and caches one bounded immutable result per
landmark site in the shared derived cache. V62/V63's priority-before-viability
and oversized-module experiments produced zero legal placements and remain
retained failures. V65 rendered the selected art but repeated the site-wide
search per cache block, raising readiness to 20.869 seconds; V66's shared site
cache reduced readiness to 13.096 seconds.

The V66 fresh-scratch real-SSH proof captured exact `(0,0)` at walking,
district, and regional zoom through the actual SSH/session/worker/render/ANSI
path: 804,635 raw bytes and 75 synchronized frames, with position, zoom,
OCTANT, dimensions, and hashes asserted. Generator startup was 1.801 seconds,
origin preparation 8.503 seconds, readiness RSS about 457 MiB, and post-capture
worker RSS about 542 MiB. The selected walking frame adds a two-person bench
and a lantern/bollard/flower cluster; broader views retain them as small
punctuation. Large empty paving, moving civic life, stalls, boats, commons,
secondary frontage, crossing diversity, the other five place-family grammars,
complete-atlas recapture, sustained Gate-D evidence, deployment, and physical
Ghostty acceptance remain open. Full evidence is in
`track-6-acceptance-atlas/composition-hierarchy-v66-real-ssh-cached-civic-life/`
on the mounted research drive. Fresh SSH and agent/API authentication reset
position to `(0,0)`; only active-session hot reload restores position. Full
repository verification passes 44 files / 241 tests, 18/18 typecheck tasks,
12/12 build tasks, 7/7 configured lint tasks, and strict source/derived-asset
hash verification.

### Paired civic canals and a legible arrival causeway (2026-07-25)

V67-V89 replace the origin's single-water-edge composition with three finite
waterway descriptors: the existing curved arrival canal plus two narrow civic
canals framing the dry central causeway. The selected branch coordinates live
once in `CANAL_TOWN_ARRIVAL_CIVIC_BRANCHES`; the live world kit and research
renderer pass that same data to hydrology, route generation, rendering,
collision, bilateral quays, and bank-aware frontage. `(0,0)` remains a dry,
walkable arterial landmark.

The retained ladder rejects a second horizontal canal, wider side canals,
wider quays, and an over-bright causeway. An attempted expanded focal search
did not recover missing frontage and was removed. V85 selects restrained
limestone street mixing; V87 selects the paired narrow side canals; V88 proves
the normal production profile is byte-identical to that explicit candidate at
walking `f07d160c...`, district `29dafb42...`, and regional `b3742514...`.

V89 proves the promoted source through three fresh-scratch real-SSH captures at
exact `(0,0)`: 805,712 raw bytes, 75 synchronized frames, and asserted zoom,
OCTANT, dimensions, and hashes. Cold readiness was 19.020 seconds (generator
1.848, origin preparation 9.973), readiness RSS about 442 MiB, and post-capture
worker RSS about 543 MiB. The full decision, rejected ladder, hashes, faithful
images, and teardown proof are under
`track-6-acceptance-atlas/composition-hierarchy-v89-real-ssh-paired-civic-canals/`.

The new hierarchy is visibly stronger, especially at district and regional
zoom, but the arrival remains too empty and static relative to the gallery
target. Boats, stalls, moving inhabitants, flower/vegetation masses, irregular
edge contact, secondary frontage, the other five place-family grammars, a new
complete atlas, Gate-D endurance, deployment, and physical Ghostty acceptance
remain open. Repository verification passes 44 files / 244 tests, 18/18
typecheck tasks, 12/12 build tasks, 7/7 configured lint tasks, and strict civic
asset derivation. Production still reports `vb07c0d4`.

### Physically shared irregular quay edges (2026-07-25)

V90-V97 test deterministic landside quay modulation against the V89 paired
canal baseline. A three-harmonic width field uses continuous waterway progress,
waterway identity, and bank side. Crucially, the same local width drives the
raster material weight, visible landside edge, frontage reserve, and physical
cell walkability; there is no decorative edge/collision split.

The selected 0.28-world-tile amplitude is named
`CANAL_TOWN_QUAY_EDGE_VARIATION`. Both the live kit and the normal research
production profile import it. V96 is byte-identical to the explicit V94
candidate at walking `12526c9c...`, district `2b863cc0...`, and regional
`288877ab...`. The 0.52 and 0.80 studies remain retained failures because their
walking views create pale plaza-like lobes without enough broader-scale gain.

V97 proves the selected source through three fresh-scratch real-SSH captures at
exact `(0,0)`: 804,823 raw bytes, 75 synchronized frames, and asserted zoom,
OCTANT, dimensions, and hashes. Cold readiness was 22.100 seconds (generator
4.511, origin preparation 14.286), readiness RSS about 460 MiB, and
post-capture worker RSS about 565 MiB. The full ladder, hashes, faithful images,
and teardown proof are under
`track-6-acceptance-atlas/composition-hierarchy-v97-real-ssh-irregular-quays/`.

The terminal result modestly breaks the ruler-straight outer edge while
preserving the wet cores, bridges, causeway, and authored frontage. Empty
commons, regular waterside curbs, boats, stalls, moving inhabitants,
vegetation masses, side-canal frontage, the other five family grammars, a
fresh complete atlas, Gate-D endurance, deployment, and physical Ghostty
acceptance remain open. Repository verification passes 44 files / 245 tests,
18/18 typecheck tasks, 12/12 build tasks, 7/7 configured lint tasks, strict
civic-asset derivation, and `git diff --check`. Production still reports
`vb07c0d4`.

### Semantic water-edge life (2026-07-25)

V98-V106 add a first authored activity vocabulary to the shared canal
geometry: east-west and north-south boats, a quay mooring cluster, fish
unloading, a fish stall, and floating vegetation. The source sheet was made
with Codex built-in image generation on the user's ChatGPT subscription; no
metered API was used. Prompt, source hash, strict deterministic crops, chroma
removal, derived hashes/dimensions, alpha coverage, partial-alpha presence, and
transparent corners are retained.

Placement is semantic rather than image- or name-driven. Manifest fields own
physical water/quay surface, tangent axis, signed bank-distance and waterway
progress envelopes, family threshold, spacing, maximum count, priority,
collision, and lights. Candidate and every collision cell must fit the same
continuous constructed-waterway/quay geometry used by material and traversal.
A bounded nearest-valid-landmark calculation owns each candidate; deterministic
ties and one immutable cache entry per landmark keep composition exact across
cache blocks and traversal order.

V99's neighbouring-site duplicates and V100/V101's route-distance exclusion of
off-route canal cells remain retained failures. V102 restores side-canal life;
V103 selects the stronger general near-origin weight. V104 then shows 3/7/8
details at walking/district/regional scale with source hashes
`b312ecba...`, `c3ac84dc...`, and `9b914e80...`. V105 disables only this layer
and is byte-identical to the V96 pre-feature hashes at all three scales.

V106 proves the selected source through three fresh-scratch real-SSH captures
at exact `(0,0)`: 804,585 raw bytes, 75 synchronized frames, and asserted zoom,
OCTANT mode, dimensions, and hashes. Cold readiness was 15.816 seconds
(generator 2.007, origin preparation 10.435), readiness RSS about 456 MiB, and
post-capture worker RSS about 545 MiB. The complete decision, generated-asset
provenance, rejected ladder, hashes, faithful images, and teardown proof are
under
`track-6-acceptance-atlas/composition-hierarchy-v106-real-ssh-semantic-quay-life/`.

This is a static first layer, not living-waterfront completion. Moving boats
and workers, temporal market state, stronger side-canal frontage, larger
commons, the other five family grammars, fresh complete-atlas proof, Gate-D
endurance, deployment, and physical Ghostty acceptance remain open. Repository
verification passes 44 files / 247 tests, 18/18 typecheck tasks, 12/12 build
tasks, 7/7 configured lint tasks, strict six-asset derivation, and
`git diff --check`. Production still reports `vb07c0d4`.
