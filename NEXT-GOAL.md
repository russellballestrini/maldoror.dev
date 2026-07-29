# MALDOROR — next active goal

*Set 2026-07-23 after rejecting the one-block engineering milestone as nowhere
near the actual product bar. This file is the governing, proof-gated definition
of done. `DOSSIER.md` remains the vision; `docs/BUILD-BRIEF.md` remains the
implementation map.*

## Objective

Transform Maldoror from a repeating canal-town rendering prototype into an
**infinite, painterly, freely zoomable, genuinely living shared world that feels
impossible to be running as pure ANSI over SSH—and make every layer of that
world extremely high-performance without sacrificing anything that makes it
beautiful, coherent, alive, safe, or exact**. A player must be able to enter at
the world's origin, travel for hours through coherent but surprising places,
meet inhabitants with continuing lives, encounter other people, watch the world
change, and never see the machinery collapse into obvious tiles, repetition,
empty filler, transport jank, load stalls, memory pressure, or degraded fidelity
under concurrency.

The target is no longer “one block works.” The target is **a world worth
inhabiting that feels immediate at every scale and remains immediate under real
load**.

## Governing truth

The current build is useful foundation and visually inadequate. Its renderer,
codec, asset manifest, and deterministic placement are means, not success. Do
not mark this goal complete because a package builds, one attractive frame
exists, a procedural map is technically infinite, or a partial milestone is
live. Milestones may be recorded, but this active goal remains open until every
acceptance gate below passes with inspectable evidence.

`tools/render-sim/gallery/TARGET.png` is the minimum visual reference, not a
license to imitate one composition forever. Maldoror must match its density,
warmth, depth, organic edge quality, hierarchy, and sense of place across an
entire generated world.

The live `tools/render-sim/gallery/COMPARISON.png` is the baseline truth. It
currently shows large flat material plates, ruler-straight boundaries, pasted
asset islands, repeated spacing, weak ground contact, little depth or occlusion,
and a composition with no relationship to the target's organic hierarchy. This
is a world-composition and raster-reconstruction problem before it is a content
quantity problem. Adding more assets or biomes without replacing that visual
grammar does not count as progress.

## Extreme performance without sacrifice

Performance is a co-equal product invariant, not a cleanup phase after visual
acceptance. Profile and optimize the complete path: world-field sampling,
constraint solving, material composition, alpha/LOD work, terminal
reconstruction, animation, state simulation, persistence, cache admission and
eviction, runtime-pack loading, worker scheduling, retained-frame diffing,
encoding, SSH transport, recovery keyframes, and client-visible response.

No performance result counts if it is obtained by rendering less world,
reducing viewport or zoom coverage, weakening the glyph/material search,
removing detail, lowering animation/weather/life cadence, reducing inhabitants,
disabling a biome or transition, using stale or incorrect caches, relaxing
determinism/collision/ownership/provenance, hiding keyframes, dropping work, or
moving latency outside the measured interval. Lossless reuse, sparse exact
updates, precomputation, compact representations, parallelism, vectorization,
allocation removal, better algorithms, bounded prediction, and measured cache
locality are the intended route.

Every selected optimization requires a same-workload A/B proof. Retain raw
profiles, CPU time, wall time, allocations, RSS, cache sizes/hit rates, I/O,
bytes, frame hashes or perceptual-equivalence evidence, and p50/p95/p99 tails.
The optimized side must pass every visual, semantic, collision, determinism,
login, persistence, and living-world gate that the control passes. Prefer
architectural and asymptotic gains over benchmark-specific special cases, and
ratchet budgets downward as bottlenecks are removed.

## Mandatory Phase 0 — rendering and world-art research reset

Before mass-producing another biome, conduct a serious research-and-prototype
program and turn its findings into the production renderer. Research artifacts
belong under
`/mnt/donto-data/donto-resources/maldoror/rendering-research/`; production code,
fixtures, and concise architecture decisions belong in this repository.

This phase must investigate, implement, compare, and make evidence-backed
choices across all five tracks below. The named work is a starting set, not a
closed whitelist.

### Track 1 — seamless materials and transitions

Replace “one square tile owns one square patch of ground” with a continuous
material compositor:

- a low-frequency semantic material field for water, stone, soil, grass,
  wetlands, cliff, and built surfaces;
- signed-distance/coverage masks with broad, irregular boundaries and
  high-frequency edge breakup;
- edge- and corner-compatible stochastic tiles for non-periodic detail, drawing
  from [Wang Tiles for Image and Texture Generation](https://graphics.uni-konstanz.de/publikationen/Cohen2003WangTilesImage/index.html);
- patch synthesis with minimum-error or graph-cut seams, drawing from
  [Image Quilting](https://people.eecs.berkeley.edu/~efros/research/quilting.html)
  and [Graphcut Textures](https://cpl.cc.gatech.edu/projects/graphcuttextures/);
- multiscale/Laplacian material blending that preserves local contrast instead
  of producing either a seam or muddy crossfade, drawing from
  [GPU Friendly Laplacian Texture Blending](https://research.nvidia.com/labs/rtr/publication/wronski2025laplacian/);
- transition-specific detail layers: curb stones, wet edges, foam, moss,
  sediment, cracks, leaf litter, footprints, reflections, and decals that cross
  chunk boundaries naturally;
- texture gutters/aprons and neighborhood-aware sampling so neither source
  pixels nor mip levels leak a rectangular border.

The world may still be chunked and cached internally, but chunk or tile borders
must become visually unobservable.

### Track 2 — alpha, scale, light, and depth correctness

Audit the complete pixel pipeline from generated source to terminal cell:

- linear-light, premultiplied-alpha compositing;
- edge-color dilation without dark/bright halos;
- alpha-coverage-preserving mip/LOD construction so foliage, railings, flowers,
  and roof detail do not erode or inflate with distance, informed by
  [Hashed Alpha Testing](https://research.nvidia.com/labs/rtr/publication/wyman2017hashed/)
  while adapting the principle to deterministic 2D/ANSI coverage;
- contact shadows, ambient occlusion cues, cast-shadow direction, water-edge
  reflections, height ordering, canopy occlusion, and atmospheric depth that
  obey one coherent scene light;
- material-aware downsampling that preserves thin structural edges, faces, and
  readable silhouettes rather than averaging every class of content equally;
- separately authored semantic LODs where filtering cannot retain meaning.

### Track 3 — terminal reconstruction as an optimization problem

Treat conversion to ANSI as a measured reconstruction stage, not a final string
formatter. Prototype and compare:

- perceptual color error in a uniform color space rather than RGB distance;
- joint foreground/background/glyph fitting over octant coverage;
- neighborhood regularization across adjacent cells so locally optimal cells do
  not create global streaks, zipper seams, or color chatter;
- temporally stable dithering and palette decisions during motion, water,
  lighting, and zoom;
- content-aware weighting for silhouettes, faces, paths, material edges, and
  high-salience landmarks;
- multi-resolution error budgets that distinguish world-compositor loss,
  resampling loss, octant-fit loss, and terminal playback loss.

The renderer must be able to produce an error/decomposition view showing where
quality was lost. A prettier source PNG is not success if the faithful SSH frame
still fails, and a sophisticated glyph fitter cannot excuse a badly composed
source scene.

### Track 4 — composition and non-repetition

Replace the repeated block stamp with hierarchical spatial grammar:

1. terrain, hydrology, coast/ridge, and biome fields;
2. routes, crossings, districts, viewsheds, and landmarks shaped by global
   goals plus local constraints;
3. parcels, building groups, waterfronts, squares, paths, and garden masses;
4. clustered vegetation and props using variable-density blue-noise/Poisson
   placement rather than a visible array, informed by
   [Fast Poisson Disk Sampling](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf);
5. final overlap, occlusion, wear, story details, and deliberately protected
   circulation/negative space.

Study global-goal/local-constraint methods such as
[Procedural Modeling of Cities](https://cgl.ethz.ch/Downloads/Publications/Papers/2001/p_Par01.pdf),
but do not blindly import an urban L-system. Prototype at least three materially
different spatial approaches and compare their autocorrelation, navigability,
silhouette diversity, landmark readability, and direct visual result.

### Track 5 — motion, transport, and physical display

Re-profile the entire retained-frame path after visual composition changes.
Research cell-stable animation, sub-cell actor coverage, scroll-copy repair,
palette ownership, synchronized output, backpressure recovery, Ghostty glyph
metrics, and perceptual behavior at real font sizes. A method only wins if it
survives faithful replay and a physical Ghostty window within the production
CPU, memory, latency, and bandwidth envelope.

### Phase-0 experiment discipline and exit gate

Build a fixed diagnostic scene containing curved water/stone/soil transitions,
two intersecting paths, a building embedded in its surroundings, canopy and
fine foliage, transparent detail, cast/contact shadows, animated water, a player
silhouette, and near/mid/far views. Render identical content through the current
baseline and every candidate pipeline.

For every experiment retain source inputs, code/parameters, full-resolution
composite, faithful ANSI stream/replay, diff/error decomposition, timing, memory,
and a written conclusion—including failed ideas. Use seam energy, spatial
autocorrelation/repetition, edge preservation, alpha coverage, perceptual image
quality, and frame/byte cost as diagnostic signals; direct side-by-side visual
judgment remains authoritative.

Phase 0 exits only when the selected pipeline visibly transforms the diagnostic
scene and a regenerated canal district from “flat tiled prototype” into a
cohesive painterly place at faithful ANSI output. Publish the full comparison,
record the architecture decision, and obtain operator approval of the rendering
direction. Until then, large-scale biome generation is premature.

## Non-negotiable experience

1. **Arrival is exact and legible.** Every fresh human SSH login starts at
   world coordinate `(0,0)`, persisted to `player_state` before play begins.
   Worker hot reload is not a login and must preserve an already-running
   session. The origin is a beautiful, walkable, recognizable arrival place—not
   water and not an invisible safety relocation.
2. **Pure terminal magic.** The production view remains ANSI glyphs and terminal
   control sequences only: no Kitty graphics, sixel, iTerm images, browser
   canvas, or client install. Ghostty is the reference client; useful fallbacks
   remain functional.
3. **Continuous, tactile movement.** Walking, camera follow, animation, and zoom
   feel immediate and spatially continuous. No tile-hop judder, tearing,
   corrupt retained frames, blocking generation pauses, or zooming into mush.
4. **A place, not a pattern.** Macro geography, neighborhoods, paths, water,
   landmarks, vegetation, and negative space form readable places at several
   scales. Repeated crossings, rigid grids, rectangular paving carpets, asset
   confetti, and obvious block cadence are acceptance failures.
5. **Alive without the player.** Inhabitants and world systems continue with
   or without an observer. Their behavior must create visible consequences,
   continuity, and stories rather than decorative random wandering.

## Scope of the world

### 1. A generative geography, not an endless stamp

Build a deterministic, unbounded world field with regional identity and
seamless travel. It must contain at least these six materially distinct families
of place:

- dense canal towns and working waterfronts;
- deep forest, woodland clearings, and overgrown paths;
- coast, islands, open water, marsh, and river systems;
- fields, orchards, farms, and small rural settlements;
- mountains, escarpments, caves, and highland routes;
- ruins and strange ancient places that can occur inside and between biomes.

Biome borders must be broad ecological transitions, not straight seams. Rivers,
roads, coastlines, ridges, and settlements must agree at region scale. The
generator must produce named landmarks and memorable silhouettes without a
finite handcrafted map. Determinism, collision, and provenance remain exact.

### 2. Painterly art at every scale

Create coherent production asset families for every biome: ground and edge
materials, transitions, canopy/foliage layers, architecture, landmarks, props,
shadows, water/weather effects, and characters. Assets need role and collision
metadata, retained source generations, prompt/model provenance, and repeatable
derivation into runtime sprites.

Terrain assets are material samples and semantic layers—not opaque rectangular
plates. The production compositor must blend them through continuous masks,
compatible edge/corner conditions, cross-boundary details, and coherent light.
Buildings and props must be integrated with foundations, thresholds, paths,
occlusion, vegetation, wear, and contact shadow; isolated pasted sprites fail.

Use Codex/ChatGPT subscription image generation for production generation work
performed by the agent. Do not silently spend per-token or image API credit.
Any other paid generation requires explicit operator authorization.

Every biome needs authored near, middle, and far visual language. Far zoom is a
designed living map, not near art reduced until it becomes noise. Transitions
between LODs must preserve landmarks and spatial orientation.

### 3. A living simulation

Ship a visible, persistent life layer:

- townsfolk have homes, roles, schedules, needs, relationships, memories,
  conversations, and plans that survive reconnects;
- NPC decisions respond to place, time, weather, other inhabitants, and player
  actions, rather than selecting from brittle name/keyword tables;
- day/night, weather fronts, seasons, water state, growth, decay, lanterns, and
  local events alter both appearance and behavior;
- significant changes persist and can be revisited, while the system remains
  bitemporally/auditably inspectable where practical;
- 5–20 concurrent human/NPC presences share consistent local state, can see one
  another, and produce coherent social activity without turning the world into
  a crowded chat room.

### 4. Free exploration and zoom

The player can travel indefinitely in every direction with no visible loading
boundary. Zoom must cover intimate character/prop inspection, normal walking,
district navigation, and regional overview. At every level, collision,
entities, labels, water, and landmarks remain semantically consistent.

Generation, asset loading, and AI work occur outside the input/render critical
path. Cache growth is bounded; uncached territory streams predictively; a slow
provider cannot freeze a player's controls.

## Proof gates

### Gate A — visual world bar

Create and retain a fixed, reproducible acceptance atlas, not a cherry-picked
screenshot:

- at least 24 predetermined coordinates spanning all six place families and at
  least four transition zones;
- every coordinate captured at walking, district, and regional zoom;
- two materially different Ghostty viewport sizes;
- day, night, and at least two weather conditions represented;
- raw SSH ANSI streams and faithful replays retained alongside the PNG atlas.

Review the complete atlas side by side with `TARGET.png`. Every walking-scale
frame must meet its standard for density, organic composition, depth, coherent
palette, alpha/edge quality, and readable paths. Repetition visible across the
atlas, rectangular slab terrain, harsh sprite cut-outs, empty quadrants, or a
biome that reads as a recolor fails the gate. Automated perceptual metrics may
help find regressions but may never overrule direct visual review.

Additionally, retain material-boundary crops for every material pair used in
production. At near, walking, and district zoom there may be no straight tile
seam, repeated edge signature, alpha fringe, mip gutter, abrupt lighting change,
or collision boundary that disagrees with the visible blend.

### Gate B — world coherence

Prove deterministic regeneration from the same seed and meaningful diversity
across different seeds. Automated traversals must cross every biome and
transition without a discontinuous seam, blocked required route, unwalkable
spawn, finite edge, or collision/visual disagreement. Macro features seen at
regional zoom must still exist and line up when approached on foot.

### Gate C — living-world observation

Run and retain at least one uninterrupted 60-minute observation with multiple
NPCs and two human clients. The evidence must show schedules, travel, social
interaction, memory continuity, environmental response, a persisted world
change, disconnect/reconnect, and another player arriving at `(0,0)`. Empty AI
responses or provider failure must degrade honestly and must not fabricate life.

### Gate D — extreme end-to-end performance without fidelity loss

On the production box and real SSH path, prove at 160×46 and one larger physical
Ghostty viewport:

- cached incremental render-to-queue work stays below 16.7 ms p95 and 33 ms
  p99; unavoidable full keyframes stay below 50 ms p95 and 100 ms p99;
- input-to-visible-response stays below 75 ms p95 and 125 ms p99 under normal
  box load, with server, queue, network, terminal-write, and display portions
  measured separately rather than conflated;
- fresh-login time to the first correct interactive `(0,0)` frame stays below
  750 ms p95 after assets are resident, and reconnect/hot-reload paths do not
  introduce an unmeasured stall;
- no retained-frame corruption, tearing, or dependency break during a
  60-minute mixed movement/zoom/weather/life run;
- render and simulation cadence maintain their declared interactive budgets
  without long-tail stalls; report p50/p95/p99/max, missed deadlines, queue
  depth, allocation rate, and cache hit/eviction rates rather than averages
  alone;
- steady idle, continuous walking, zoom, and weather bandwidth are separately
  measured and bounded at p50/p95/p99; keyframes and recovery bursts are
  identified rather than hidden in means;
- steady-state service RSS remains below 1.2 GiB and the existing 1.6 GiB hard
  envelope is never crossed; caches remain bounded, the service causes zero
  swap I/O, and memory returns to its expected band after traversal and churn;
- a 5-, 10-, 20-, and 40-presence ladder reports CPU, RSS, event-loop delay,
  simulation latency, frame latency, allocations, cache behavior,
  bytes/client, dropped deltas, and recovery keyframes. The 20-presence rung
  must meet the interactive budgets; the 40-presence rung proves graceful
  headroom and recovery without correctness or fidelity loss;
- runtime-pack decode, origin prewarm, provider cold start, first uncached
  territory, zoom changes, and weather transitions each have explicit budgets
  and flame/profile evidence, with no unprofiled multi-second phase;
- the complete acceptance atlas, living-system checks, deterministic traversal,
  and exact materialization/collision audits remain identical or improve under
  the performance build. A faster partial frame is a failed result.

Thresholds may become stricter as measurement improves. They may not be relaxed
to make a failing build pass without explicit operator approval and a written
tradeoff.

### Gate E — login invariant

Automated integration proof must move an existing account away from the origin,
disconnect, reconnect, and demonstrate all of the following:

- the first authoritative position sent to the renderer is exactly `(0,0)`;
- the persisted `player_state` is exactly `(0,0)` at login;
- the shared presence/spatial index reports exactly `(0,0)`;
- the origin tile and its route to the surrounding world are walkable;
- a worker hot reload during a connection does **not** reset that active player.

### Gate F — physical acceptance

The operator must use a real Ghostty session to walk, zoom, cross at least three
biomes, meet living inhabitants, and inspect the acceptance atlas. Record the
date and exact build commit of explicit operator acceptance. Automation cannot
invent this sign-off, and “awaiting sign-off” is not completion.

## Engineering constraints

- Keep world generation deterministic and testable; keep mutable life state
  explicit and recoverable.
- Reuse the existing fidelity/codec/world interfaces where sound, but replace
  any architecture whose output visibly exposes the prototype's grid.
- Do not solve semantic generation, biome classification, alignment, dialogue,
  or behavior with hand-maintained string tables or `if/else` name ladders.
- Never discard source art, prompts, provenance, collision metadata, player
  creations, or persisted world state to simplify a migration. Back up and
  verify before destructive operations.
- Preserve queue-depth/backpressure correctness: a dropped dependent delta must
  force a keyframe before further deltas.
- All background generation and long verification runs are resumable and are
  verified by real progress, resource use, and output—not merely a started PID.
- Keep unrelated dirty worktree files out of goal commits.

## Required handoff artifacts

Completion requires all of these in the repository or the mounted-drive
research area, linked from this file:

1. current architecture and world-generation design;
2. the Phase-0 rendering research dossier, failed experiments, benchmark scene,
   selected architecture decision, and operator direction approval;
3. versioned biome/asset manifests with generation provenance;
4. deterministic seed and traversal fixtures;
5. the complete multi-coordinate/multi-zoom faithful acceptance atlas;
6. living-world observation logs and persisted-state evidence;
7. login-reset integration evidence;
8. same-workload performance A/B reports, profiles, tail distributions, and
   5/10/20/40-presence load evidence proving extreme speed without fidelity,
   correctness, density, or feature loss;
9. production deployment commit and rollback procedure;
10. explicit physical-Ghostty operator acceptance.

## Execution ledger — 2026-07-24–25 (not completion)

Completed foundations:

- fresh human login writes and renders exact `(0,0)`; active-session hot reload
  preserves position instead of invoking login semantics;
- canonical NPC body/motor/cognitive state now checkpoints and resumes instead
  of respawning decorative walkers;
- the V6 continuous regional field deterministically composes all six required
  place families with exact cache/block invariance;
- six source materials and four route/crossing materials were generated through
  the built-in Codex/ChatGPT subscription path with prompt, source, hash,
  semantic manifest, and repeatable keyed derivation retained;
- the V4 regional route field replaces the rejected grid with sparse Gabriel
  topology, terrain-cost curves, three route tiers, and explicit ford/bridge/
  non-walkable-ferry consequences;
- route-aware linear-light composition, physical water ownership, tangent-
  aligned timber bridges, demand-driven semantic LOD, and linear-light material
  mip pyramids pass focused tests and faithful octant review; the identical
  retained overview improved from 50.79 seconds to 2.02 seconds cold without
  restoring the rejected root-ring or tile-seam failures;
- a built-in-subscription V2 landmark atlas now supplies one provenance-traced
  vertical silhouette for each family; real route sites, family compatibility,
  terrain-constrained anchors, shared overlay/collision placement, soft-alpha
  reconstruction, and linear-light terrain contact pass focused tests and a
  faithful six-coordinate walking atlas; the V1 ground-apron version remains
  retained as a rejected sticker-island experiment;
- a second built-in-subscription atlas adds 12 soft-alpha medium-scale family
  masses through manifest semantics and radius-two coordinate-stable placement;
  retained evidence rejects painted path aprons and adjacent duplicate masses,
  while exact manifest-derived source-block lookup reduces the first identical
  atlas frame from 2.46 to 1.21 seconds without clipping boundary sprites;
- paired built-in-subscription route-contact atlases now add separately
  authored north-south and east-west parcel thresholds for all six families;
  exact prompt/source/hash/derivation/collision/central-anchor semantics are
  retained, a failed pseudo-rotation remains in the research record, and the
  selected provider projects candidates onto the nearest route contact before
  tangent-only blue-noise thinning; faithful review rejected both floating
  unsnapped contacts and adjacent duplicate thresholds rather than publishing
  source art as runtime proof;
- a three-way parcel-geometry comparison rejects isotropic Voronoi cells for
  weak frontage and uniform strips for repetition; the selected anisotropic
  hierarchy measures 100% frontage access, 0 sampled overlap, 0.2% route
  intrusion, 0.783 unique-shape rate, and reserved yards. Monolithic
  directional parcel sheets were also rejected because full-cell painted
  ground failed strict contact-band extraction and could not follow curved
  routes. The selected modular research candidate separates exact 14--19-tile
  route-material connectors from 3--6-piece collision-aware compounds; 24 new
  built-in-subscription modules plus 12 explicitly role-reused silhouettes
  provide 36 family-compatible assets, and all 12 family/axis faithful audits
  report distinct in-compound components with zero family mismatch, overlap,
  blocked connector, collision intrusion, or missing connector material;
- bounded regional predictive preparation now runs in an identical persistent
  worker stack with vector lookahead, coverage hysteresis, one in-flight/latest-
  pending scheduling, seed/version/bounds validation, and a four-viewport LRU;
  the rejected RGB-object transfer is retained because it hid a 1.237-second
  event-loop stall, while the selected transferable-plane path yields zero
  uncovered frames and exact checkpoints over 180 frames at 160x46 with render
  p50/p95/p99 4.09/8.32/27.74 ms, event-loop p99 5.21 ms, import p95 4.84 ms,
  and 633.61 MiB peak RSS;
- after parcel composition, rejected over-wide preparation took 9.25 seconds;
  collecting derived layers once and proving an exact 18-tile source reach
  recovered the current 180-frame corridor to 5.41 seconds initial
  preparation, render p50/p95/p99 4.65/11.90/27.47 ms, event-loop p99 5.89 ms,
  import p95 5.13 ms, and 734.03 MiB peak RSS with zero misses, mismatches, or
  worker errors. Immutable decoded-sprite reuse lowers the separate
  32-coordinate teleport-stress worker peak from 1,455.32 to 1,196.11 MiB;
- a third built-in-subscription source adds four coast/headland and four
  cave/highland silhouettes without painted terrain or water. A generic
  manifest envelope controls family compatibility, land, water distance,
  elevation, slope, route distance, and nearby-water contact; eight faithful
  district fixtures pass all seven physical checks with zero mismatches. The
  first broad locator was rejected at 3.5 minutes/~967 MiB for rebuilding full
  derived blocks, and the first waterfall envelope was rejected as unreachable;
  the selected bounded semantic cell cache plus reachable envelope preserves
  the 180-frame corridor at render p50/p95/p99 4.08/9.38/30.54 ms, event-loop
  p99 5.35 ms, import p95 4.29 ms, 756.21 MiB peak RSS, and zero misses,
  mismatches, or errors;
- a five-method reconstruction lab now makes the dominant regional repetition
  failure explicit. Square blending remains a quilt; stochastic hex lowers a
  diagnostic correlation but retains wrong-scale leaves/cobbles; the
  Laplacian candidate clips them; cellular reconstruction makes broad plaid.
  Direct faithful review selects a separately authored far-scale tier. Its
  six-family 3 x 2 source atlas was generated through the built-in
  ChatGPT/Codex subscription path, retains its exact prompt and source hash
  `66b78392...589db`, and derives six 512 px masters byte-for-byte. Detail stays
  at a seven-world-tile frequency while regional art spans 42 world tiles; this
  also removes the inverted two/four-tile far-zoom scale. Exact `(0,0)` walking,
  district, and regional frames preserve near construction, simplify at the
  middle tier, and replace the map-scale motif quilt with painterly fields;
- the perfect circular arrival/root ring is replaced by a bounded smooth union
  of anisotropic hub, quay, and ward components. An over-broad first tuning is
  retained because it incorrectly captured the `(60,20)` mountain fixture; the
  selected field passes all six deterministic family fixtures. After rejecting
  four 192 px overview variants and global source upscaling for excessive
  startup/RSS, the current 180-frame corridor uses one 128 px overview master
  per family: 1.365 s startup, 6.055 s initial preparation, render
  p50/p95/p99 4.39/9.22/26.32 ms, event-loop p99 5.60 ms, import p95 8.58 ms,
  779.57 MiB peak RSS, and zero misses, mismatches, or worker errors;
- the straight U-shaped parcel connector is replaced in the research provider
  by one route-relative cubic spine with a deterministic water/route/slope
  successor fan, shared arc-length component stations, continuous
  route-material reconstruction, and separately protected core/negative-space
  bands. The selected six-family district atlas has connected cores, 3--5
  compatible components per compound, and zero mismatch, overlap, blocked
  circulation, painted circulation, missing path material, or missing path
  frame. A failed all-asset requirement is retained: both discovered coast
  north/south thresholds correctly face water and have no legal same-side
  compound, so they remain waterfront contacts rather than fabricated inland
  parcels;
- the first conservative curve integration regressed identical cold predictive
  lead to 9.730 seconds. Separating base blocks, route-cell parcel groups, and
  output-block parcel spatial layers preserves all six faithful hashes
  byte-for-byte and restores the current identical 180-frame lead to 5.997
  seconds. Render p50/p95/p99 is 4.60/11.49/43.29 ms, event-loop p99 6.15 ms,
  import p95 9.52 ms, peak RSS 775.70 MiB, with zero misses, mismatches, or
  worker errors. The p99 increase remains an explicit profiling follow-up, not
  a hidden pass;
- the selected anisotropic parcel comparison is now integrated as a persistent
  shared-boundary fabric rather than remaining a geometry diagram. Component
  and plot centers consume the same curved arc-length stations; exact midpoint
  boundaries, variable constrained depth, open frontage, inset yards/gardens,
  and sparse civic openings are continuous terrain masks rather than painted
  square sprites. The faithful six-family audit covers 31 plots with 100%
  frontage access and yard reserve, 94.4% mean unique-shape signature, two
  civic openings, and zero shared-boundary mismatch, sampled overlap, water
  intrusion, or protected-path intrusion. The exhaustive 1,787-coordinate
  cross-block proof remains exact and measured no slower than its committed
  baseline under the same extended window. Full evidence is in
  `regional-parcel-fabric-v2-audited/`. Two identical 180-frame repeats kept
  zero misses/mismatches/errors with 4.98/10.27/18.59 and
  5.03/12.15/36.78 ms render p50/p95/p99; their 6.616/6.078-second cold leads
  and broad p99 spread keep service readiness open. Public gallery iteration
  023 exposes the selected result; production is intentionally unchanged;
- a route threshold can now become a physical working waterfront instead of a
  decorative shore prop or a fabricated inland parcel. Ordinary parcels and
  waterfronts share one continuous route-normal frame; the locator evaluates
  every bounded dry-to-wet transition so a nearer puddle cannot conceal a
  farther navigable channel. The selected real canal program has one protected
  22.5-tile service approach, two dry work yards, two 95.7%-wet walkable piers,
  one fully wet slip, and two manifest-declared maritime functions with zero
  mismatch, overlap, blocked/painted access, missing material, or missing
  waterfront surface. Early one-pier/no-slip coast variants, the cardinal-axis
  orientation error, and the dark outlined quay stamp remain retained rejects;
  the selected compositor feathers dry program ownership into local terrain
  while keeping constructed pier contacts crisp. Two independent 180-frame
  160x46 repeats retained zero misses/mismatches/errors with
  4.18/7.38/17.62 and 4.35/9.41/17.00 ms render p50/p95/p99; their
  5.786/6.390-second cold leads keep service readiness open. Full source,
  comparison, metrics, and primary-source deductions are in
  `regional-waterfront-v10-blended-canal/FINDINGS.md`; public gallery iteration
  024 exposes the rejected outline and selected regional/district frames;
  production is unchanged;
- geography-bound mountain contacts can now become physical traversal programs
  instead of decorative silhouettes. The selected real cave connects a route
  through its authored mouth to a smoothed main tunnel, an upstream branch, two
  unequal radially distorted chambers, 70 connected walkable cells, and 75
  solid rock-wall cells; material/collision/dryness coverage is 100%. The real
  highland route gains 0.11118 elevation through three long smoothed
  switchbacks at a 1.3543 path/direct ratio, with 39 connected walkable cells
  and 100% material/collision agreement. Seven visual/physical intermediates
  remain retained: hard circular cutaways, a four-neighbour diagonal gap,
  unreadable blur, brown road-like interiors, paired-circle chambers, and a
  flat-floor pass were all rejected before the selected cool cracked/pebbled
  cutaway. Full evidence and primary-source deductions are in
  `regional-environment-programs-v8-textured-cave/FINDINGS.md`. Three
  independent 180-frame repeats retained zero misses/mismatches/errors, but
  their 6.246/7.051/6.434-second cold leads and 26.42/54.62/34.67 ms render
  p99s keep service readiness open. Production is unchanged;
- a controlled travel-scale audit proved that the regional overlay hash was
  collapsing sparse detail into a visible lattice: 142 contacts occupied only
  three rows, two sub-cell phases, and four nearest-neighbour vectors. The
  selected independent-axis avalanche retains comparable density (133
  contacts) across 62 rows, 93 phases, and 131 nearest-neighbour vectors. A
  behavioral regression now guards this visual property. The placement reset
  then found and retained a real rejected cave with three topology/ownership
  mismatches instead of choosing a convenient coordinate. Branches now attach
  to the actual smoothed centreline, a 192-layout orientation/grid-phase/seed
  sweep requires four-neighbour connectivity, and environment programs own
  terrain/collision deterministically across parcel and program overlaps.
  Replaying the identical cave coordinate changes surface coverage 26.15% to
  100%, wall solidity 97.06% to 100%, and total mismatches three to zero; all
  eight declarative environment contacts remain exact. Full comparison,
  primary-source deductions, faithful frames, and raw metrics are in
  `travel-entropy-v3-hash-audit/FINDINGS.md`. This closes one lattice defect,
  not the travel-scale entropy gate. The same coordinate reset re-located one
  viable route/parcel program per family. Its first waterfront was explicitly
  rejected for two collision overlaps and 50% pier-center walkability; tile
  collision now consumes the same sub-pixel program coverage as rendering,
  contact collision is reserved before yard placement, and the strict locator
  accepts only the complete invariant set. The selected `parcel:62:-54`
  waterfront has 100% dry/wet/pier-walkability/surface agreement and zero
  overlap, blockage, semantic, path-frame, or missing-material mismatches.
  Two independent 180-frame predictive traversals retained zero coverage
  misses, checkpoint mismatches, scheduler failures, or errors at render
  p50/p95/p99 4.35/10.75/38.82 and 4.37/9.38/22.62 ms; initial leads
  6.056/6.339 seconds and 788.72 MiB peak RSS keep service readiness open.
  Production is unchanged;
- the placement defect was not isolated to overlays: biome basin centres,
  hydrology, canal variation, and route sites still used the same folded-axis
  mixer. One shared signed-coordinate primitive now owns all five consumers,
  and the production basin size is exported once so research cannot silently
  audit a different scale. At the real 112-tile scale, 10,201 rejected basin
  centres had 4,872 unique x positions but only 1,275 y positions, 51 centres
  on one row, and 1,126 phases; the selected field has 5,693/5,709 x/y
  positions, at most seven on a row, and 4,831 phases. A real four-neighbour
  flat-terrain route-site audit moves from 188/95 unique x/y positions and 14
  repeats of one nearest vector to 261/299 and at most two repeats. Behavioral
  regressions now guard both macro fields. Every coordinate proof was then
  invalidated and replayed: the four-region route graph remains cache-exact
  with all tiers/crossings at 6.55-7.97% coverage; six ecotone frames retain
  exact overlap and all family coverage; all eight terrain contacts have zero
  mismatch; the new 71-cell/two-chamber cave and three-switchback ascent have
  100% surface/collision integrity. The strict six-family locator itself was
  hardened after retaining one canal parcel with 2.1352% water intrusion, one
  missing-program candidate, and one contact-centre audit error; the selected
  family set has zero overlap, blockage, missing surface, family/path mismatch,
  ordinary-parcel water/path intrusion, or shared-boundary drift. Full evidence
  and primary-source deductions are in
  `travel-entropy-v12-macro-hash-audit/FINDINGS.md`. Full verification is 31
  files / 161 tests plus all 13 package typechecks and builds. Two independent
  180-frame traversals retained zero misses/mismatches/failures/errors at render
  p50/p95/p99 4.54/11.42/19.14 and 3.82/6.79/17.71 ms. Their 6.985/7.019-second
  cold leads and 809.98/808.91 MiB peak RSS keep service readiness open.
  Production is unchanged;
- the random-wander NPC motor now consumes a canonical integer world clock and
  a restart-safe living policy instead of name/prompt conditionals. Every
  inhabitant has a deterministic gapless day, one of six persistent roles,
  six typed need pressures, activity-duration hysteresis, collision-adjusted
  destinations, and continuous utility over schedule, place, time, weather,
  exposure, nearby people, role, and prior activity. Directed familiarity is
  loaded from durable relationships and feeds back into whom an inhabitant
  seeks; the existing continuous player-affinity value now shapes both social
  attraction and proximity-scaled retreat instead of being ignored by the new
  policy. Encounters atomically append an auditable life fact, an episodic
  memory, and an idempotently strengthened relationship. World time, season,
  weather, needs, schedules, current intent, remembered social target, body,
  and motor state checkpoint in one transaction. One consolidated additive
  migration creates the canonical world/life tables and append-only event
  ledger; all 34 tables and state-version default 2 were proven on a disposable
  local scratch database, which was then removed. No metered/model call is in
  the always-on policy. A full accelerated day with 18 residents and two human
  presence traces covers all six roles, all seven activities, four weather
  states, 574 facts, 90 social encounters, ten human encounters, persistent
  directed relationships, and 44 sampled shelter responses; a restart after
  613 minutes produces the exact same SHA-256 state/event digest as the
  uninterrupted run (`c3610219...e068`). The same persistent clock now grades
  terrain, structures, and actors together through day/night, mist, rain,
  storm, cold, and heat, with deterministic diagonal precipitation and
  walking-scale role/activity labels in both worker transports. The atmosphere
  pass never mutates shared cached samples. A second additive migration now
  persists surface wetness, independent water turbulence, vegetation vitality,
  and decay pressure. Rain fills a retained reservoir; drying, water settling,
  phenology, and decay evolve at separate rates instead of snapping with the
  weather label. The renderer uses explicit material ownership to darken and
  sparsely glint wet rough surfaces, disturb only water, and alter only authored
  foliage. Declarative landmark/route/ambient light metadata produces bounded
  night pools and wet bounce without filename or colour inference. The full-day
  observation records wetness 0.000-0.791, water disturbance 0.080-0.664, and
  gradual vitality/decay movement while retaining the exact restart digest.
  An interleaved 160x46 profile puts clear/storm/wet-night-with-36-lights p95
  atmosphere overhead at 0.572/1.919/9.074 ms (0.931/2.278/9.433 ms total).
  Research, sources, raw facts, timeline, performance, and both real-provider
  four-state atlases are in `living-world-research/deterministic-life-v1/`.
  Full verification is 33 files / 180 tests, all 18 typecheck tasks, all 12
  build tasks, complete 0000-0009 scratch migration replay, and clean diff
  validation. Public gallery iterations 028-029 expose the timeline, atmosphere,
  and persistent environmental-consequence atlases. The last remaining
  production-worker fallback that could relocate a fresh login away from
  `(0,0)` was removed; the canonical arrival island/route tests remain the
  walkability proof. This is an accelerated local proof, not Gate C, and
  production remains unchanged;
- the regional field, routes, seamless material compositor, hierarchical
  parcels, landmarks, environment programs, and physical consequences now own
  the authoritative SSH-worker source path instead of remaining a render-lab
  island. One worker-owned semantic kit and persistent off-thread generator
  serve isolated per-session providers; the exact origin package is prepared
  before worker readiness, and input never opens without exact visible
  coverage. Player movement, free camera, resize, rotation, render-mode change,
  and target zoom all drive one coverage-aware scheduler. Repeated and in-flight
  generation requests deduplicate; generator results are bounded by eight
  entries and 192 MiB, while sessions retain six viewports and never clear the
  shared compositor on disconnect. Intermediate animated zoom consumes the
  nearest prepared semantic LOD rather than escaping to synchronous generation.
  The authored traveler remains the default identity without loading the
  retired canal world. A production-topology lab with one shared kit, one
  generator, and two sessions reaches exact origin readiness in 9.147 seconds,
  serves the identical package in 0.085 ms, proves actor isolation and
  shared-cache ownership, and crosses 13 movement frames with zero coverage
  misses at 5.261/13.868/13.868 ms render p50/p95/p99. It retains 2.78 MiB of
  generator payload and peaks at 776.02 MiB RSS. The exact two-session origin
  hash is `e3cd83a3...ffe8f`; no model call occurs. Full raw evidence is in
  `track-5-motion-transport/regional-runtime-readiness-v1/report.json`. Full
  verification is 34 files / 184 tests, all 18 typecheck tasks, all 12 build
  tasks, and clean diff validation. This is source readiness, not production
  activation; production remains unchanged;
- the regional stack and persistent living-world migrations are now activated
  in the public production SSH service. A verified 44,655,547-byte pre-migration
  custom-format backup (`18905ea1...bfdff4`) precedes the exact transactional
  application of additive migrations 0008-0009; five users, two NPCs, and five
  player states remained intact. The retained hot reload at `v14d6b58` reaches
  regional readiness in 8.757 seconds (1.109-second generator startup,
  5.663-second origin generation), restores both NPCs, has zero service
  restarts, and peaks at 839.79 MiB. A controlled key-backed production login
  staged at `(17,-11)` persists exactly `(0,0)` after entry, twice. The first
  faithful live capture exposed and retains a real failure: advancing the exact
  simulation clock once per second caused seven 210-235 KiB global atmosphere
  repaints and 1,327,492 steady bytes over six seconds. The selected presentation
  cadence keeps 48 coherent global atmosphere states per world day while rain
  and storm retain one-second localized animation; the repeated 160x46 capture
  keeps 90 synchronized frames but emits only 19,787 steady bytes, a 98.51%
  reduction with zero full-world idle repaints. Full evidence and hashes are in
  `track-5-motion-transport/live-regional-deploy-v1/`. Public gallery iteration
  030 and TARGET-vs-NOW now show the faithfully replayed live regional frame.
  Full verification is 36 files / 189 tests, 18/18 typecheck tasks, and 12/12
  build tasks. No image generation or metered model call was used. This closes
  production activation, not the remaining atlas/load/life/human-display gates;
- the fixed acceptance-atlas contract now has a loopback-only executable that
  exercises the real `ssh2 -> SessionProxy -> WorkerManager -> WorkerSession`
  path against an owned scratch database. The committed manifest fixes 24
  distinct walkable coordinates, three strong sites per family, six transition
  pairs, three semantic zooms, two Ghostty-class viewports, and four assigned
  day/night/rain/storm environments. Its first 72-frame run honestly exposed a
  universal black traveler backing: Sharp's default opaque padding had turned
  the portrait fallback into a square, partial alpha was discarded, and actors
  bypassed the linear-light compositor. The rejected half-atlas is retained.
  Explicit transparent padding, preserved coverage, and actor alpha-over remove
  the cut-out; 9 focused tests and a real-SSH smoke frame prove the correction.
  Commit `4d6bebd` passed 37 files / 193 tests, 18/18 typecheck tasks, and 12/12
  build tasks, then hot-reloaded live as `v4d6bebd` with exact NPC checkpoint/
  restore and zero connected sessions. The fresh final audit retains all 144
  raw SSH streams, 144 faithful replays, 3,560 synchronized frames, and
  62,939,851 bytes; all 288 raw/image hashes match. Direct review of complete
  walking/district/regional sheets nevertheless **rejects Gate A**: composition
  is too sparse and repetitive, routes remain angular/uniform, coast crossings
  expose slabs, night crushes hierarchy, and storm erases place identity. The
  exact rejection and next pass live under
  `track-6-acceptance-atlas/acceptance-atlas-v3-final/FINDINGS.md`; public gallery
  iteration 031 exposes the non-cherry-picked sheets. This is audit completion,
  not visual acceptance. A first corrective pass then used the exact rejected
  `forest-west-deep` real-SSH fixture plus a clear-night guard. Raising the
  moonlit navigation floor, separating the storm grade, reducing night-streak
  dominance, and broadening declarative lamp falloff raised forest-storm median
  luminance 23.01 -> 28.79 while cutting cool-streak coverage 6.11% -> 3.16%;
  the clear-night guard raised both median and contrast without losing its night
  read. Both raw streams, faithful frames, hashes, metrics, and the explicitly
  selected sub-gate live under
  `track-6-acceptance-atlas/atmosphere-legibility-v1*/`. The correction passes
  37 files / 193 tests, 18/18 typecheck tasks, and 12/12 build tasks. It closes
  the crushed-night / precipitation-dominance defect only; Gate A remains open.
  A build-stamp audit caught that `tsc` left stale `dist/version.json`; the SSH
  build now copies the source stamp deterministically. A zero-session controlled
  restart loaded `vb07c0d4`, restored both persistent NPCs, and reached regional
  ready in 8.37s at 671MB worker RSS. A fresh public-production SSH capture at
  exact `(0,0)` retained 32 synchronized frames, 309,531 raw bytes, and 6,713
  steady bytes. Public gallery iteration 032 exposes the exact rejected/selected
  storm pair and this current live frame. No image generation or metered model
  call was used;
- the first composition correction after the failed atlas has now replaced the
  arrival's isolated-prop grammar with two distinct connected urban blocks.
  Three authored source assets were generated through the built-in
  Codex/ChatGPT subscription workflow with no metered API, soft-alpha keyed,
  hash-pinned, and made reproducible through
  `pnpm assets:derive-canal-town-focals`. Their runtime semantics explicitly own
  focal hierarchy, screen frontage axis, composition side, footprint,
  collision, walkable frontage, and light; neither filenames nor pixels decide
  placement. Eleven retained iterations rejected repeated pairs, ornamental
  radial scatter, frontage-only props, crushed 8x4 reconstruction, wrong route
  orientation, clipped tall sprites, false collision, one-dimensional anchor
  search, and a one-sided settlement before selecting the two-sided street
  wall. The production seed resolves the two focal anchors at `(10,6)` and
  `(-10,6)` while preserving the exact `(0,0)` arterial. Six real-SSH origin
  captures cover walking/district/regional at 160x46 and 210x60 with 2,170,860
  raw bytes and 150 synchronized frames. Full verification passes 37 files / 196
  tests, all 18 typecheck tasks, all 12 build tasks, and exact alpha/hash
  reproduction. Evidence is in
  `track-6-acceptance-atlas/composition-hierarchy-v11-two-sided-street-wall/`;
  public gallery iteration 033 exposes V3 -> V10 -> V11 plus the three zooms.
  This is a selected composition sub-gate, not Gate A and not deployed: paving,
  canal/quay continuity, block edge spacing, district density, horizontal
  companions, five other biome vocabularies, and a fresh complete atlas remain
  open;
- the focal-grounding pass now retains V12-V19 as explicit visual failures and
  selects V20's semantic-entry architecture. Bounds-derived brown wash, giant
  plates, cloudy islands, synchronized H sidewalks, phase-averaged mortar, and
  the final readable-material/wrong-ladder candidate are all preserved rather
  than hidden. Two limestone sources were generated through built-in
  Codex/ChatGPT subscription image generation with no metered project API; V1
  remains rejected and V2 is selected because broad stones and dark joints
  survive 12-pixel ANSI reconstruction. The focal manifest now declares
  normalized entrance stations. Runtime creates only small thresholds and
  narrow approaches at those stations, because the focal sprites already own
  their edge sidewalks; it performs no filename or pixel inference. Six fresh
  scratch real-SSH origin captures cover walking/district/regional at 160x46
  and 210x60 with 2,171,890 raw bytes and 150 synchronized frames. Full
  verification passes 38 files / 200 tests, 18/18 typecheck tasks, 12/12 build
  tasks, and exact V2 derivation. Evidence is under
  `track-6-acceptance-atlas/composition-hierarchy-v20-authored-entry-thresholds/`;
  public gallery iteration 034 exposes the rejections, selected source, and
  three-scale result. This selects one rendering/composition sub-gate only: it
  is not live, not Gate A, and cold readiness (21.891s at 817MB RSS) remains a
  performance failure;
- the V21-V26 water/route/crossing pass now fixes a world/render contradiction
  instead of cosmetically covering it. Physical hydrology owns visibly wet
  pixels before cultural overlays, so canal-town weights can no longer paint
  water beige while collision still reports water. At the singular arrival,
  the most nearly collinear pair of stable graph edges forms one continuous
  through arterial and the remaining spoke stays local; named half-widths plus
  manifest-owned texture scale and near/map opacity keep the hierarchy legible
  without letting roads erase the place. V22's bright stair-step quay and V24's
  visually unchanged binary bridge erosion are retained rejections. V23 selects
  semantic quay LOD: broad V2 limestone is restrained to the dry near-scale
  water edge, while map views use lower-contrast town material. V25 carries
  interpolated route distance/half-width into a narrower visible and collision-
  consistent bridge deck, but its rigid bar, abrupt landings, absent piers, and
  weak bank engineering remain an explicit failure. The V26 loopback real-SSH
  audit completed 9/9 assigned day/clear frames at exact origin, west waterfront,
  and coast crossing across walking/district/regional zoom: 2,564,855 raw bytes,
  225 synchronized frames, and all position/zoom/OCTANT and hash evidence
  retained. The west-waterfront walking composition is selected for continued
  work; the crossing is not. Cold readiness was 22.554s, origin preparation
  6.946s, and RSS 826MB with repeated high-heap warnings, so performance remains
  a failure. Scratch ports/container were verified absent after capture.
  Production remains `vb07c0d4`; no new image generation or metered model call
  was used. A separate live same-account proof then moved a returning user to
  authoritative `(12,0)`, disconnected, and observed exact `(0,0)` on the next
  real SSH login. Its two streams retain 648,892 raw bytes and 92 synchronized
  frames, with zero active sessions after the audit; hot-reload restoration
  remains correctly exempt because it is not a new login. Full verification
  passes 38 files / 204 tests, 18/18 typecheck tasks, and 12/12 build tasks.
  Public gallery iteration 035 exposes the retained visual ladder without
  changing live TARGET-vs-NOW. Evidence and primary-source rationale are in
  `track-6-acceptance-atlas/composition-hierarchy-v26-real-ssh-water-route-crossing/FINDINGS.md`;
- V27-V33 turn the bridge from one painted deck into the first explicit
  structural cross-section and separately author route width at semantic LOD.
  Continuous water coverage now locates stone bank seats; a signed local route
  normal drives timber rail relief and side shadow; a route-aligned frame adds
  sparse support cadence. V28 is retained as a severe rejection because it
  confused infinite-line normal distance with endpoint-capped route distance,
  extended road ownership beyond endpoints, and spawned a false parcel blob.
  V29 keeps Euclidean segment distance authoritative and stores sign
  separately, restoring the exact V27 placement counts. V32 gives arterial,
  local, trail, and bridge surfaces independent manifest-authored near/map
  width as well as opacity, so district/regional approaches stay connected
  without becoming tan carpets. The 9/9 V33 real-SSH audit at the unchanged
  origin, west waterfront, and coast crossing retains 2,566,848 raw bytes and
  225 synchronized frames with every position/zoom/OCTANT assertion passing.
  Cold readiness is still 10.081s, worker RSS still reaches 819MB, and repeated
  high-heap warnings keep performance failed. Full verification is 38 files /
  206 tests, 18/18 typecheck tasks, and 12/12 builds. The selected bridge is
  structurally clearer but still too rectilinear and austere for Gate A;
  approach shaping, span-aware supports, crossing-family diversity, full-atlas
  recapture, load, and physical Ghostty remain open. Production remains
  `vb07c0d4`; no image generation or metered model call was used. Evidence and
  primary-source deductions are in
  `track-6-acceptance-atlas/composition-hierarchy-v32-semantic-route-width-bridge/FINDINGS.md`
  and
  `track-6-acceptance-atlas/composition-hierarchy-v33-real-ssh-structural-crossing/FINDINGS.md`;
- V34-V40 add longitudinal crossing semantics instead of extending a bridge
  texture blindly onto land. The route field now exposes bank-to-bank span and
  signed progress where `-1/+1` are the banks; physical `crossingKind` remains
  the collision authority while bounded `crossingInfluenceKind` gives only the
  dry landing visual context. A warm lifted deck, thin rail/post rhythm,
  bank-stationed stone abutments, mid-span shaping, and span-aware support
  placement replace the uniform V32 bar. V34's longer dark bar, V36's lost dark
  deck, and V38's visually ineffective generic-ground shoulder remain explicit
  rejections. V39 adds a subtle coastal subgrade only beneath ordinary
  physically dry roads, so map-scale approaches read as causeways rather than
  vectors painted over water without changing crossing collision. Origin
  walking/district/regional safeguards remain byte-identical; west waterfront
  remains selected. The 9/9 V40 real-SSH audit retains 2,376,797 raw bytes and
  223 synchronized frames with every position/zoom/OCTANT assertion passing.
  Cold readiness is still 10.188s, worker RSS grows from about 818MB to about
  952MB, and coordinator heap warnings reach 94%, so performance remains
  failed. The strict atlas validator correctly rejects this bounded three-site
  manifest as incomplete. Production remains `vb07c0d4`; no image generation
  or metered model call was used. Full verification is 38 files / 208 tests,
  18/18 typecheck tasks, and 12/12 build tasks. Evidence is in
  `track-6-acceptance-atlas/composition-hierarchy-v40-real-ssh-landing-and-subgrade/FINDINGS.md`;
- the first Gate-D memory pass profiles the complete authored kit instead of
  guessing from aggregate RSS. Roughly 4.6 million source pixels per isolate
  were retained as individual RGB objects; forced-GC heap grew by 181.35 MiB
  across the seven kits. Immutable tile-major RGBA planes reduce that retained
  heap delta to 1.23 MiB and the full-kit RSS delta from 192.43 to 39.49 MiB
  without removing an asset, semantic layer, or cache. The identical two-isolate
  origin-readiness proof falls from 863.508 to 546.707 MiB peak RSS and from
  9.761 to 8.949 seconds, with byte-identical origin and traversal hashes. A
  180-frame 160x46 predictive traversal peaks at 570.40 MiB, renders at
  4.44/7.84/18.92 ms p50/p95/p99, and has zero coverage misses, checkpoint
  mismatches, or errors. Packed/object resampling is exact at native, reduced,
  and enlarged resolutions. This is selected research, not deployment or Gate
  D completion: fresh real-SSH churn, the 5/10/20 ladder, long run, cgroup,
  bandwidth, and physical Ghostty proofs remain open. Verification is 38 files
  / 212 tests, 18/18 typecheck tasks, and 12/12 build tasks. Evidence is in
  `track-7-performance/packed-raster-v1/FINDINGS.md`; no image generation or
  metered model call was used;
- the follow-on Gate-D source pass now turns the real V8 profile into a
  shared-static render architecture instead of tuning by intuition. Static
  terrain/route/building atmosphere is graded once per exact world-life state;
  a shared packed octant plane is reconstructed once per static scene; and
  actor/shadow drawing returns explicit dirty cell offsets so sessions refit
  only genuinely dynamic cells. Movement acceptance is reported separately
  from smooth actor travel through a synchronized authoritative-position
  acknowledgement. A cooperative scheduler coalesces lagging session frames
  and yields through the event loop between viewports so queued SSH input is
  not trapped behind a burst of expired render timers. The selected v41
  160x46 real-SSH ladder passes all three steady rungs: at 5/10/20 presences,
  input-response p95 is 23.994/25.963/76.974 ms, frame-gap p99 is
  154.832/155.909/181.583 ms, peak coordinator-plus-worker RSS is
  674.895/700.102/807.758 MiB, and one-core CPU is
  28.569/29.816/44.881%. All rungs have zero dropped frames, drain events, and
  recovery requests; two-client churn returns to exact `(0,0)`, restores all
  20 sessions, and cleanup reaches zero. The 16 MiB semi-space experiment is
  retained as rejected because it raised 20-client RSS to 846.023 MiB and
  worsened frame p99 to 268.496 ms. Cold and steady evidence remain separate:
  the first five-client cohort still has 2,344.696 ms cold response p95 even
  though later additions settle at 23.192/24.146 ms. A fresh faithful real-SSH
  origin replay is retained, while deterministic origin and traversal hashes
  remain byte-identical at `25cf0516...9313` and `ea499954...5188`. This is a
  selected source architecture and the first ladder pass, not Gate D, not a
  deployment, and not physical acceptance. Full evidence, profile attribution,
  rejected runs, and measurement semantics are in
  `track-7-performance/packed-raster-v1/FINDINGS.md`. Verification is 42 files
  / 231 tests, 18/18 typecheck tasks, 12/12 build tasks, 7/7 configured lint
  tasks, and clean diff validation. Production remains `vb07c0d4`; no image
  generation or metered model call was used;
- the V42-V44 composition ladder corrects the V41 origin's missing water and
  circulation hierarchy at the world-model level. A bounded curved arrival
  canal now participates in the same signed hydrology distance used by full
  terrain and physical collision; the route solver therefore creates a real
  bridge while exact `(0,0)` stays dry. V42's terminal basin is retained as a
  rejection because the route went around its end. V43 selects the extended
  physical canal and crossing; V44 adds contextual authored limestone to strong
  canal-town streets and a restrained linear-light lift to bridge timber. The
  faithful 160x46 source-build SSH subset retains 798,387 raw bytes and 75
  synchronized frames across walking/district/regional views, with every
  position, zoom, and OCTANT assertion passing. This is a selected composition
  sub-gate only: overview water is still dull/blocky, the bridge is too large
  and orthogonal, the centre is sparse, continuous usable quays and dense
  secondary waterfront frontage are absent, and physical Ghostty acceptance is
  still unperformed. Full verification is 42 files / 232 tests, 18/18
  typecheck tasks, 12/12 build tasks, and 7/7 configured lint tasks. Fresh
  readiness is 10.833 seconds, worker RSS reaches about 548 MiB after capture,
  and coordinator heap warnings reach 87%, so Gate D also remains open.
  Evidence is in
  `track-6-acceptance-atlas/composition-hierarchy-v44-real-ssh-canal-civic-material/FINDINGS.md`.
  Production remains `vb07c0d4`; no image generation or metered model call was
  used;
- V45-V49 turn that bounded canal into shared civic infrastructure instead of
  a painted water feature. One public constructed-waterway contract now exposes
  continuous centre, tangent, normal, signed bank distance, side, width, and
  progress; paired dry quay ribbons derive both walkable collision and
  linear-light limestone material from that same geometry at every semantic
  LOD. Two new low-profile frontages were generated through built-in
  Codex/ChatGPT subscription image generation with exact prompts, source and
  derived hashes, deterministic chroma/trim derivation, alpha validation, and
  explicit bank-side/axis/function semantics; no metered API was used. V46's
  clipped roof fragments, V47's tall generic waterfront vocabulary, and V48's
  collision-only focal overlap remain retained rejections. V49 selects full
  painted-footprint reservation plus bank-aware sparse placement. Its fresh
  160x46 source-build SSH subset retains 802,689 raw bytes and 75 synchronized
  frames across `(0,0)` walking/district/regional views, with every position,
  zoom, and OCTANT assertion passing. This is still only an incremental
  composition sub-gate: close arrival is too open, the bridge too orthogonal,
  quay edges too regular, overview water too dull, frontage and lived detail
  too sparse, and the grammar is not yet generalized across the six families.
  Repository-wide verification passes 43 files / 236 tests, 18/18 typecheck
  tasks, 12/12 build tasks, and 7/7 configured lint tasks.
  Readiness is 11.445 seconds, post-capture worker RSS about 556 MiB, and
  coordinator heap warnings reach 92%, so Gate D remains open. Evidence is in
  `track-6-acceptance-atlas/composition-hierarchy-v49-real-ssh-authored-quay-frontage/FINDINGS.md`.
  Production remains `vb07c0d4`; there was no deploy, restart, push, or
  physical Ghostty claim;
- V50-V66 deepen the same arrival composition without changing its hydrology,
  route, collision, or material-mask authorities. The selected bridge blends
  civic limestone into timber, has stronger bank landings and a readable
  mid-span waist, while deterministic world-space wear articulates the paired
  quays. Continuous tangent-aligned current and real canal bank distance now
  separate a deeper channel from shallows. A new four-module civic-detail kit
  (bench/townsfolk, cart, lantern/bollards/flowers, and fountain/pigeons) was
  generated with built-in Codex/ChatGPT-subscription image generation; exact
  prompt, source/derived hashes, chroma derivation, alpha checks, semantic
  route/landmark bands, collision, and light behavior are retained. Placement
  scans semantic viability before deterministic ranking, reserves complete
  focal footprints, avoids the route core, penalizes repeated modules, and
  caches one bounded immutable result per landmark site without ID/filename
  conditionals. V52's visually lost bridge shaping, V56-V59's incomplete water
  studies, V62/V63's zero-placement civic studies, and V65's 20.869-second
  repeated site-search regression remain retained failures. V66 selects the
  cached result: its fresh 160x46 source-build SSH subset retains 804,635 raw
  bytes and 75 synchronized frames across exact `(0,0)` walking, district, and
  regional views, with all position, zoom, OCTANT, dimension, and hash
  assertions passing. Cold readiness was 13.096 seconds (generator 1.801,
  origin preparation 8.503), readiness RSS about 457 MiB, and post-capture
  worker RSS about 542 MiB. SSH and agent/API fresh logins now both persist and
  enter at `(0,0)`; hot-reload restoration remains a continuation rather than
  a login. This is still an incremental composition sub-gate: large empty
  paving remains, only two static origin details are selected, the single
  crossing vocabulary needs stronger bank contact, and moving people, stalls,
  boats, commons, secondary frontage, the other five family grammars, and
  complete-atlas proof remain open. Evidence is in
  `track-6-acceptance-atlas/composition-hierarchy-v66-real-ssh-cached-civic-life/FINDINGS.md`.
  Repository-wide verification passes 44 files / 241 tests, 18/18 typecheck
  tasks, 12/12 build tasks, and 7/7 configured lint tasks; strict civic-detail
  source and derived-asset hash verification also passes.
  Production remains `vb07c0d4`; there was no deploy, service restart, push,
  complete Gate-A claim, Gate-D claim, or physical Ghostty claim;
- V67-V89 generalize the arrival field to multiple finite constructed
  waterways, then select two narrow north-south civic canals around the dry
  origin causeway. One canonical branch constant now feeds the live kit and
  research renderer; hydrology, routes, material, collision, bilateral quays,
  and bank-aware frontage all consume the same descriptors. The horizontal
  branch, wider side canals, wider quays, over-bright street, and ineffective
  focal-search expansion remain retained rejections; the failed focal-search
  code was removed. Compact waterfront assets now carry explicit axis and bank
  semantics. V88 proves the normal production profile exactly matches the V87
  selected source hashes at walking/district/regional zoom. V89's fresh
  source-build SSH subset retains 805,712 raw bytes and 75 synchronized frames
  at exact `(0,0)`, with position, zoom, OCTANT, dimensions, and hashes
  asserted. Cold readiness was 19.020 seconds (generator 1.848, origin 9.973),
  readiness RSS about 442 MiB, and post-capture worker RSS about 543 MiB. The
  result is materially closer to the target's canal-framed hierarchy, but still
  has large empty ochre space, straight quay edges, sparse frontage, and no
  moving people, boats, or stalls. Evidence is in
  `track-6-acceptance-atlas/composition-hierarchy-v89-real-ssh-paired-civic-canals/FINDINGS.md`.
  Repository-wide verification passes 44 files / 244 tests, 18/18 typecheck
  tasks, 12/12 build tasks, 7/7 configured lint tasks, and strict civic-asset
  derivation.
  Production remains `vb07c0d4`; there was no deploy, service restart, push,
  complete Gate-A claim, Gate-D claim, or physical Ghostty claim;
- V90-V97 replace the ruler-straight landside quay outline with one
  deterministic low-frequency width field shared by rendering, frontage
  reservation, and physical walkability. The 0.52 and 0.80 amplitudes create
  pale plaza-like lobes and remain retained rejections; 0.28 is selected.
  `CANAL_TOWN_QUAY_EDGE_VARIATION` is imported by both the live kit and normal
  research production profile, while unspecified callers retain a zero-change
  baseline. V96 proves production byte-identical to the explicit V94 candidate
  at walking `12526c9c...`, district `2b863cc0...`, and regional
  `288877ab...`. V97's fresh source-build SSH subset retains 804,823 raw bytes
  and 75 synchronized frames at exact `(0,0)`, with position, zoom, OCTANT,
  dimensions, and hashes asserted. Cold readiness was 22.100 seconds
  (generator 4.511, origin 14.286), readiness RSS about 460 MiB, and
  post-capture worker RSS about 565 MiB. The irregular edge survives faithful
  terminal reconstruction without changing canal cores, bridges, causeway, or
  authored frontage, but it is intentionally modest: empty commons, regular
  waterside curbs, weak side-canal frontage, and absent boats, stalls, moving
  people, and vegetation masses remain. Evidence is in
  `track-6-acceptance-atlas/composition-hierarchy-v97-real-ssh-irregular-quays/FINDINGS.md`.
  Repository-wide verification passes 44 files / 245 tests, 18/18 typecheck
  tasks, 12/12 build tasks, 7/7 configured lint tasks, strict civic-asset
  derivation, and `git diff --check`.
  Production remains `vb07c0d4`; there was no deploy, service restart, push,
  complete Gate-A claim, Gate-D claim, or physical Ghostty claim;
- V98-V106 add the first semantic water-edge life layer to those shared canals.
  Six new modules—two axis-specific boats, mooring, fish unloading, fish stall,
  and water vegetation—were generated through built-in Codex/ChatGPT
  subscription image generation with exact prompt, source/derived hashes,
  deterministic chroma/trim derivation, alpha checks, and explicit physical
  semantics; no metered API was used. Placement scans continuous constructed
  waterways rather than names or coordinates: manifests own water/quay
  surface, tangent axis, signed bank-distance and progress bands, family
  threshold, spacing, count, priority, collision, and light behavior. Stable
  nearest-landmark ownership and an immutable per-site cache remove V99's
  duplicate claims and V100/V101's route-distance exclusion of side canals.
  V102 restores all three canals; V103's selected general near-origin weight
  brings a second boat into the walking frame. V104 exposes 3/7/8 details at
  walking/district/regional scale. V105 disables only this layer and is
  byte-identical to the V96 baseline at all three scales. V106's fresh
  source-build SSH subset retains 804,585 raw bytes and 75 synchronized frames
  at exact `(0,0)`, with position, zoom, OCTANT, dimensions, and hashes
  asserted. Cold readiness was 15.816 seconds (generator 2.007, origin 10.435),
  readiness RSS about 456 MiB, and post-capture worker RSS about 545 MiB.
  Boats remain in physical water, quay activity remains on walkable quay, and
  the origin remains dry, open, and walkable. Evidence is in
  `track-6-acceptance-atlas/composition-hierarchy-v106-real-ssh-semantic-quay-life/FINDINGS.md`.
  Repository-wide verification passes 44 files / 247 tests, 18/18 typecheck
  tasks, 12/12 build tasks, 7/7 configured lint tasks, strict six-asset
  derivation, and `git diff --check`. This is still static first vocabulary:
  moving inhabitants/boats, temporal market activity, stronger side-canal
  frontage, larger commons, and equivalent contact grammar for the other five
  families remain open. Production remains `vb07c0d4`; there was no deploy,
  service restart, push, complete Gate-A claim, Gate-D claim, or physical
  Ghostty claim;
- V107-V115 turn the two boats into the first persistent-time authored world
  activity. Manifest-owned tangent drift, cycle, and phase feed a generic
  regional dynamic-overlay plane from persisted `WorldLifeState.worldMinute`;
  target anchors are revalidated against the same constructed-waterway
  geometry and collision remains on already non-walkable water. V107/V109/V111
  prove exact base-position replay at minutes 720/780/840, while V108 and V110
  prove one-tile movement in both directions. V112 retains 3/7/8 semantic
  details across walking/district/regional scale; V114/V115 repeat the selected
  720/750 pair at the live 12-pixel scale. The first fresh-SSH V113 pair is a
  retained rejection: activity existed in the provider buffer but disappeared
  from production OCTANT output because the shared-static encoder did not know
  its cells were dynamic. The selected renderer fix marks those cells, and a
  regression test pins that transport contract. Corrected V113 then starts two
  separate source-build SSH processes against database minutes 720 and 750;
  faithful images visibly move both boats one channel tile while architecture,
  weather, camera, and exact `(0,0)` login remain fixed. It retains 548,067 raw
  bytes and 50 synchronized frames. Accepted cold starts were 16.428 and
  15.866 seconds, readiness worker RSS 463/453 MiB, and coordinator RSS
  85-90 MiB. Evidence and rejected rehearsals are in
  `track-6-acceptance-atlas/composition-hierarchy-v113-real-ssh-persistent-quay-activity/FINDINGS.md`.
  Repository verification passes 44 files / 248 tests, 18/18 typecheck tasks,
  12/12 build tasks, 7/7 configured lint tasks, strict six-asset derivation,
  and `git diff --check`. This is not living-city completion: moving people,
  temporal stalls/unloading, stronger side-canal frontage, larger commons, and
  equivalent grammar for the other five families remain open. Production
  remains `vb07c0d4`; there was no deploy, service restart, push, complete
  Gate-A claim, Gate-D claim, or physical Ghostty claim;
- V116-V130 add route-connected secondary frontage to both civic side canals
  and prove the fresh-login origin against deliberately stale persisted
  positions. Four distinct tall/narrow canal-town modules—warehouse,
  market-house, boat-repair workshop, and inn/dwelling—come from Codex
  built-in image generation on the ChatGPT subscription, with no metered API.
  Exact prompts, original source hashes, deterministic crop/mirror/chroma
  derivation, output hashes, alpha metrics, and two rejected source generations
  are retained. The first selected tall sheet failed V127 visual inspection:
  its broad baked-in limestone strips doubled the procedural quay and made the
  buildings resemble boats. V128 removes those strips and retains only
  doorstep-scale thresholds. Declarative axis/bank/function/access metadata
  drives continuous-waterway discovery, one owner per whole quay layout,
  viable usage-balanced selection, tangent spacing, dry collision-free doorway
  pathfinding, full access reservation, and program-first composition without
  filename or coordinate conditionals. V128 retains 8 unique waterfront
  frontages with 0 physical duplicates, including 3 north-south frontages over
  both civic waterways; all 3 doorway paths start at their manifest offsets,
  remain walkable and collision-free, and reach their exact declared quay.
  V129 proves the selected result through three source-build SSH captures.
  V130 then persists three returning fixtures at `(137,-211)` before startup;
  all three independently render and are machine-asserted at `(0,0)` at
  walking/district/regional zoom, and all three database rows finish at `0|0`.
  It retains 807,301 raw bytes and 75 synchronized frames. Cold readiness was
  26.274 seconds (generator 2.860, origin 13.760), readiness worker RSS 474 MiB,
  and coordinator RSS about 84-88 MiB. Evidence is in
  `track-6-acceptance-atlas/composition-hierarchy-v128-side-canal-frontage-ground-blended/FINDINGS.md`
  and
  `track-6-acceptance-atlas/composition-hierarchy-v130-real-ssh-returning-login-reset/FINDINGS.md`.
  Repository verification passes 44 files / 250 tests, 18/18 typecheck tasks,
  12/12 build tasks, 7/7 configured lint tasks, strict four-asset derivation,
  and `git diff --check`. This completes neither the canal city nor Gate A:
  moving inhabitants, temporal stalls/unloading, larger commons, crossing and
  support diversity, equivalent grammars for the other five families, the
  fresh complete atlas, sustained Gate D, deployment, and physical Ghostty
  acceptance remain open. Production remains `vb07c0d4`; there was no deploy,
  service restart, push, complete-gate claim, or physical Ghostty claim;
- V131-V134 add the first non-canal authored place grammar at current forest
  waystations. V131 rejects a stale historic landmark coordinate, re-locates
  the current deterministic north-south site `(92,43)`, and retains the sparse
  three-scale baseline. V132 activates the existing generic focal/frontage/
  access-apron contract with the already-authored log shelter and hunter's
  lean-to, but is rejected after a test exposes landmark focals leaking into
  ordinary parcel rows. V133 closes that leak but is visually rejected because
  orientation-specific semantic IDs sharing one shelter raster produce a
  duplicate silhouette in the same district composition. V134 introduces
  manifest-owned `visualGroup` identity, so semantic role/axis variants share
  one repetition budget without filename or family conditionals. The selected
  north-south camp contains a log-shelter focal, distinct support silhouettes,
  and a 24-cell threshold/approach whose minimum route distance is 0, with
  walkable and rendered-surface rates both 1. A second 97.8%-forest east-west
  waystation at `(-412,211)` independently selects the other axis: its 29-cell
  access fabric reaches route distance `0.0277`, remains entirely walkable and
  rendered, and all visible focal-site visual groups are unique. All six
  walking/district/regional captures are retained under
  `track-6-acceptance-atlas/composition-hierarchy-v134-forest-visual-group-place/FINDINGS.md`.
  Repository verification passes 44 files / 251 tests, 18/18 typecheck tasks,
  12/12 build tasks, 7/7 configured lint tasks, and `git diff --check`. This is
  a selected forest-waystation tranche, not forest completion: open fields,
  living forest activity, crossing/topology diversity, the other four
  non-canal families, fresh full-atlas proof, sustained Gate D, deployment,
  and physical Ghostty acceptance remain open. Production remains `vb07c0d4`;
  there was no deploy, service restart, push, complete-gate claim, or physical
  Ghostty claim;
- V135-V138 extend the same generic place grammar into the coast without new
  art. V135 retains the fresh sparse baseline at the current north-south coast
  waystation `(-302,-47)`. Existing dune-hut and fishing-rack rasters now own
  stable visual groups and four semantic focal variants cover both route axes
  and sides; no coast ID, filename, coordinate, or colour condition enters the
  runtime. V136 produces a 24-cell north-south threshold/approach with minimum
  route distance 0 and walkable/rendered rates both 1. V137 then rejects four
  nominal east-west coast sites after proving that route labels alone do not
  imply a physically placeable beacon. A bounded production-region anchor
  audit finds the one actual east-west placement at `(-623,-396)`. V138 proves
  it independently: the 26-cell access fabric reaches route distance 0,
  remains entirely walkable/rendered, and district/regional focal-site visual
  groups are all unique. All six selected walking/district/regional captures,
  exact hashes, and the rejected physical-site search are retained under
  `track-6-acceptance-atlas/composition-hierarchy-v138-coast-two-axis-place/FINDINGS.md`.
  This is a selected coast-waystation tranche, not coast completion: most
  nominal coast sites still cannot host the current large landmark, and
  shoreline programs, topology/crossing diversity, living coast activity,
  the other three non-canal families, fresh full-atlas proof, sustained Gate
  D, deployment, and physical Ghostty acceptance remain open. Production
  remains `vb07c0d4`; there was no deploy, service restart, push,
  complete-gate claim, or physical Ghostty claim;
- V139-V141 extend route-connected hierarchy into rural using the existing
  farmstead kit. V139 retains the fresh sparse baseline at the current dry
  north-south waystation `(-73,-69)`. Stone-barn and produce-awning entries now
  share manifest-owned visual groups with four axis/side focal variants; no
  rural runtime conditional is introduced. V140's north-south barn anchors a
  24-cell threshold/approach at route distance 0 with walkable/rendered rates
  both 1, while its district/regional support silhouettes remain unique. A
  bounded physical placement scan finds four actual east-west rural
  waystations; V141 selects the strongest at `(337,35)` (rural weight 0.8717),
  where the corresponding barn variant owns a 26-cell fully
  walkable/rendered route-connected fabric and all visible composition groups
  are unique. The same ±640 audit contains no physically placeable rural
  settlement, so settlement-profile proof remains explicitly open rather than
  being inferred from the two waystations. All six selected captures, hashes,
  and the baseline are retained under
  `track-6-acceptance-atlas/composition-hierarchy-v141-rural-two-axis-place/FINDINGS.md`.
  This is not rural completion: settlement hierarchy, continuous hedgerow/
  field composition, farm/market schedules, moving workers/animals/carts,
  persistent field state, crossings, fresh full-atlas proof, sustained Gate D,
  deployment, and physical Ghostty acceptance remain open. Production remains
  `vb07c0d4`; there was no deploy, service restart, push, complete-gate claim,
  or physical Ghostty claim;
- V142-V144 extend the generic place grammar into mountain waystations. V142
  retains a fresh production-seed baseline at the dry north-south site
  `(61,-71)`, where a cave and spire had no shelter, threshold, or coherent
  local hierarchy and the regional frame exposed conspicuous crag wallpaper.
  Existing alpine-hut and mine-gantry rasters now share manifest-owned visual
  groups with four axis/side focal variants; no mountain, filename, colour, or
  coordinate conditional enters the runtime. The north-south alpine refuge
  owns a 24-cell access fabric that reaches route distance 0 and is entirely
  walkable/rendered. A bounded ±640 physical scan finds four actual east-west
  mountain waystations. Direct review rejects the highest-weight site because
  its cave, gantry, and hut split across three walking-frame edges; V144
  instead selects `(376,-350)` (mountain weight 0.8994), whose mine/pass
  compound has a 26-cell fully walkable/rendered threshold/approach and unique
  visible focal-site groups at all three scales. All selected captures, exact
  hashes, raw metrics, baseline, and rejected high-weight attempt are retained
  under
  `track-6-acceptance-atlas/composition-hierarchy-v144-mountain-two-axis-place/FINDINGS.md`.
  Repository verification passes 44 files / 251 tests, 18/18 typecheck tasks,
  12/12 build tasks, 7/7 configured lint tasks, and `git diff --check`.
  This is not mountain completion: regional crag/hut/cave repetition remains
  visibly unresolved, alongside ridge/cliff fields, multiple cave/highland
  programs, production cave transitions, route/crossing diversity, living
  actors/work cycles, ruins composition, fresh full-atlas proof, sustained
  Gate D, deployment, and physical Ghostty acceptance. Production remains
  `vb07c0d4`; there was no deploy, service restart, push, complete-gate claim,
  or physical Ghostty claim;
- V145-V147 extend the same generic grammar into semantic `ruin` sites. V145
  retains the empty-centred baseline at the strongest current ruin
  `(-7,130)`. Wayside-shrine and collapsed-tower entries now share stable
  visual groups with four axis/side focal variants while the landmark remains
  strictly declared for `ruin`; no relabelled waystation or ruins-specific
  runtime branch is introduced. The post-change physical replay rejects that
  baseline site because neither focal fits and rejects the highest-weight
  composed north-south boundary frame after a modern frontage intrudes on the
  walking view. V147 selects the cleaner north-south shrine at `(-144,-494)`
  and east-west tower at `(-567,-284)`. Their respective 28- and 26-cell
  access fabrics reach route distance 0, are entirely walkable/rendered, and
  retain unique focal-site visual groups at walking, district, and regional
  scale. Exact captures, hashes, raw metrics, baseline, and both rejection
  classes are retained under
  `track-6-acceptance-atlas/composition-hierarchy-v147-ruins-two-axis-place/FINDINGS.md`.
  Repository verification passes 44 files / 251 tests, 18/18 typecheck tasks,
  12/12 build tasks, 7/7 configured lint tasks, and `git diff --check`.
  Regional ruins still repeat as evenly spaced arch/column icons; larger wall,
  courtyard, buried/interior, artifact/history, and living-site programs are
  likewise open. This is not ruins completion, Gate A, sustained Gate D,
  deployment, or physical Ghostty acceptance. Production remains `vb07c0d4`;
  there was no deploy, service restart, push, complete-gate claim, or physical
  Ghostty claim;
- V148 addresses the shared mountain/ruins ambient-wallpaper failure with a
  family-neutral hierarchy above the existing deterministic local priority
  thinning. Three faithful provider profiles remain switchable and retained:
  the historical uniform control, a smooth 48-tile density field, and a
  jittered 48-tile cluster field with variable radius/strength. Two aligned
  approximately 384-tile audits show the selected cluster profile raising
  macro-cell count variation from 0.5758 to 0.7851 in mountain and from 0.4107
  to 0.6001 in ruins, while median nearest-anchor separation rises from 10.198
  to 11.402 and 10.440 to 11.705 tiles respectively. Direct review of all six
  faithful regional frames rejects uniform wallpaper and the broadly even
  density fade; the cluster field creates deliberate clearings and
  concentrations around unchanged authored terrain/routes. A single typed
  production constant now drives session creation plus the landmark and
  traversal labs, and unoverridden selected-production captures reproduce the
  explicit cluster captures byte-for-byte at both sites. Regression coverage
  proves all three profiles exact across 32- and 47-tile block sizes over
  signed coordinates with no duplicate anchors. Research, raw metrics,
  selected and rejected captures, primary-source links, and hashes are in
  `track-4-world-composition/ambient-hierarchy-v148-three-profile/FINDINGS.md`.
  Repository verification passes 44 files / 252 tests, 18/18 typecheck tasks,
  12/12 build tasks, 7/7 configured lint tasks, and `git diff --check`. This
  closes uniform macro density, not the limited ambient silhouette vocabulary,
  mountain ridges, ruins walls/courtyards, living actors, fresh full-atlas
  proof, sustained Gate D, deployment, or physical Ghostty acceptance.
  Production remains `vb07c0d4`; there was no deploy, service restart, push,
  complete-gate claim, or physical Ghostty claim;
- V149 closes a living-world runtime split-brain in source. Two production
  residents with full sprites and schedules were persisted beside the arrival
  district, but `NPCManager` still collided against the retired chunk
  generator: the Dog's `(-9,1)` quay cell and exact `(0,0)` are walkable in the
  visible regional world and blocked in the legacy world. Regional mode now
  installs one exclusive physical authority; the old generator remains only
  the explicit rollback lane. Persisted roam discs coalesce into bounded
  resolution-1 collision packages generated off-thread, imported and coverage-
  checked before movement begins. A deterministic four-neighbour shortest-path
  motor caches the remaining route, validates dynamic collision per step, and
  never escapes the resident's roam disc. New resident creation atomically
  prepares a complete replacement collision set before the body becomes tick-
  visible. The faithful production-seed lab coalesces both resident envelopes
  into 1,976 cells, generates them off-thread in 5,520.888 ms, imports in
  14.164 ms, and resolves the Unicorn's 15-step route in 2.279 ms plus the
  Dog's 21-step route in 3.401 ms with zero main-thread material fallbacks. An
  owned migrated scratch runtime then loads both residents and sprites, reports
  `npc_count=2` with `npc_collision_authority=regional`, and checkpoints both
  bodies at their resolved work destinations. Its sampled worker event-loop
  p99 is 3.697 ms and RSS 468.383 MiB, but the retained 46.501-second cold
  regional readiness remains unacceptable. Full evidence and the exact routes
  are under
  `living-world-research/v149-regional-inhabitant-navigation/FINDINGS.md`.
  Repository verification passes 47 files / 261 tests, 18/18 typecheck tasks,
  12/12 build tasks, 7/7 configured lint tasks, and `git diff --check`. This is
  source and isolated-runtime proof, not a public deploy, visual inhabitant
  observation, Gate C, or physical Ghostty acceptance. Production remains
  `vb07c0d4` with the same PID/start timestamp; there was no deploy, service
  restart, push, production database write, complete-gate claim, or physical
  Ghostty claim;
- V150 removes scattered PNG/Sharp decoding from the selected regional cold
  path without changing the world image. The build validates the same nine
  authored kits, hashes nine manifests plus 116 unique referenced PNGs, and
  atomically emits one deterministic 8,052,460-byte V8/gzip pack. Runtime
  checks its schema and ordered-manifest digest before opening it; missing,
  corrupt, disabled, or stale packs use the explicit original validator/source
  fallback. Turbo now treats every root asset as an SSH build input, and both
  main and generator provenance flow through startup logs, runtime telemetry,
  and research reports. In a current-code faithful control, the pack reduces
  main asset load from 8,027.505 to 446.139 ms, generator asset load from
  3,138.024 to 225.465 ms, and total origin readiness from 24,642.628 to
  15,215.664 ms. Source and packed origin/traversal hashes are exactly equal,
  with zero coverage misses or main-thread material fallbacks. An owned
  migrated scratch worker independently reports `runtime-pack`, loads two
  residents and sprites, establishes regional collision authority, and becomes
  ready in 12,920 ms versus V149's 46,501 ms cold observation; both residents
  reach and persist at their work destinations. A real loopback SSH capture
  asserts `Pos: (0, 0)`, OCTANT mode, and 30% zoom across 274,146 raw bytes and
  24 synchronized frames, and its faithful replay was directly inspected. The
  rejected ncc/native-worker bundles and the host's 21-32% I/O-wait confounder
  are retained beside the selected evidence under
  `track-5-motion-transport/runtime-asset-pack-v150/FINDINGS.md`. Repository
  verification passes 48 files / 265 tests, 18/18 typecheck tasks, 12/12 build
  tasks, 7/7 configured lint tasks, and `git diff --check`. This is undeployed
  source and isolated-runtime proof: origin generation still dominates at
  about 10.8 seconds, and fresh full-atlas Gate A, sustained/deployed Gate D,
  Gate C, richer living systems, deployment, and physical Ghostty acceptance
  remain open. Production remains `vb07c0d4` with the same PID/start timestamp;
  there was no deploy, service restart, push, production database write,
  complete-gate claim, or physical Ghostty claim;
- V151 removes the remaining ~10.8-second origin-generation cliff without
  moving it into the first walk. A build-time, provenance-bound typed-plane
  artifact now carries one centre visual halo, four long cardinal visual
  corridors, and one resolution-1 collision halo; all six packages remain
  independently below the existing 8,192-cell transfer ceiling. Runtime
  accepts them only when world seed, runtime digest, ordered asset-manifest
  digest, and full asset-source digest match; every other seed or stale/corrupt
  artifact uses the explicit generator fallback. Sessions import five shared
  visual planes through bounded lazy facades, while the persistent generator
  imports all six to reuse overlap beyond the horizon. The final readiness
  topology reaches exact origin in 1,535.329 ms versus V150's 15,215.664 ms,
  reports 0 ms origin generation, preserves the byte-exact origin hash, and
  renders 260 frames through 64 tiles in each cardinal direction with zero
  coverage misses, generator requests, failures, or main-thread material
  fallbacks. Only 3,952 of 40,501 logical terrain wrappers materialize during
  that four-direction proof. The final owned scratch worker becomes ready in
  1,402 ms versus V150's 12,920 ms, loads both persistent residents and
  sprites, installs regional collision authority in 2 ms, and advances both
  bodies to their persisted work destinations. A real loopback SSH capture
  asserts `(0,0)`, OCTANT, and 30% zoom across 297,890 bytes and 39 synchronized
  frames; its faithful 1440x828 replay was directly inspected. A separate
  adversarial returning login proves persisted `(77,-33)` becomes `(0,0)` in
  both terminal and database. Rejected single-origin and centre-halo attempts,
  CPU profiles, final artifacts, hashes, and limitations are retained under
  `track-5-motion-transport/origin-generation-v151/FINDINGS.md`. Repository
  verification passes 49 files / 270 tests, 18/18 typecheck tasks, 12/12 build
  tasks, 7/7 configured lint tasks, and `git diff --check`. This is not the
  performance finish: the synthetic four-direction lab still records a
  478.891 ms render p99, 907.248 ms maximum, 765.996 MiB peak, and a 2,148.304
  ms first full frame; the isolated worker retains a 2,308.964 ms event-loop
  maximum. Fresh full-atlas Gate A, sustained/deployed Gate D, Gate C, richer
  living systems, deployment, and physical Ghostty acceptance remain open.
  Production remains `vb07c0d4` with PID `1022033` and the same start
  timestamp; there was no deploy, service restart, push, production database
  write, complete-gate claim, or physical Ghostty claim;
- V152 profiles and removes V151's cold full-frame reconstruction defect
  without freezing its two persistent-time moving boats. Public-provider
  attribution found 2,149.679 of the origin's 2,260.412 ms inside dynamic quay
  overlay discovery: each tile query was rebuilding regional source blocks
  whose authored placements the prepared viewport already knew. Packed
  viewport V3 now transfers a bounded coordinate-stable activity program with
  its six raster planes; runtime resolves the provenance-matched manifest,
  applies the existing world-minute motion and hydrology fit, and caches one
  sparse overlay per viewport/minute. A fresh provider advanced to a different
  minute matches every source dynamic tile and creates zero source blocks.
  All five measured frame hashes remain byte-exact while origin/east/west/
  north/south cold frames fall from 2,260.412/819.833/628.602/817.108/996.492
  ms to 100.716/29.583/34.924/14.671/14.711 ms. The selected 260-frame
  four-direction repeat has zero misses, generator requests, failures, or
  main-thread fallbacks at render p50/p95/p99/max
  5.569/13.502/28.867/48.311 ms, replacing V151's 478.891 ms p99 and 907.248
  ms maximum. Its exact warm-host origin readiness is 1,406.986 ms; the honest
  first cold-storage run was 4,630.731 ms. The resolution-1 NPC proof uses the
  baked package with 0 ms generation and 2.238 ms import, retaining both exact
  resident routes. An owned migrated scratch worker becomes ready in 2,258 ms,
  loads both residents and sprites, installs regional collision authority in
  3 ms, and persists their work destinations. Real loopback SSH asserts
  `(0,0)`, OCTANT, and 30% zoom across 280,805 bytes and 62 synchronized
  frames; its faithful 1440x828 replay was directly inspected and the scratch
  login remains `(0,0)` in the database. Full profiles, before/after data,
  artifact hashes, raw SSH, faithful replay, and limitations are retained in
  `track-5-motion-transport/first-frame-v152/FINDINGS.md`. Repository
  verification passes 49 files / 270 tests, 18/18 typecheck tasks, 12/12 build
  tasks, 7/7 configured lint tasks, and `git diff --check`. This closes one
  runtime stall, not Gate D: first full frame is still 100.716--135.466 ms,
  the 30-minute physical run, current-source load ladder, deployed cgroup
  observation, and larger physical Ghostty proof remain open. Gate A, Gate C,
  deployment, richer world content, and physical operator acceptance also
  remain open. Production remains `vb07c0d4` with PID `1022033` and the same
  start timestamp; there was no deploy, service restart, push, production
  database write, complete-gate claim, or physical Ghostty claim;
- V153 replaces the evenly scattered unparented ambient cadence with a
  family-neutral nested prominence field while preserving every authored local
  landmark group. A controlled 2,048x2,048-tile lab holds candidate cells,
  jitter, priority thinning, and density constant: the exact former production
  field produces 16.82% quiet 32x32 windows and 0.7235 count CV; the selected
  broad-basin plus sparse-local field produces 41.02% quiet windows, 1.1009 CV,
  and 0.4648 adjacent correlation without exposing the rejected circular-island
  or saturated two-octave failure modes. A current-source six-family control
  removes 8 of 25 unparented icons (32%) while all 41 landmark-owned placement
  records remain byte-identical. Final-source readiness reaches exact origin in
  1,399.038 ms with 0 ms generation, renders 260 frames through 64 tiles in all
  four cardinal directions with zero coverage misses, generator requests,
  imports, failures, or main-thread source fallbacks, and records
  p50/p95/p99/max 5.688/13.625/24.178/31.596 ms. The baked collision proof
  retains the Unicorn and Dog's exact 15- and 21-step routes. An owned migrated
  scratch worker becomes ready in 1,398 ms; a real loopback SSH session asserts
  `(0,0)`, OCTANT, and 30% zoom across 274,191 bytes and 25 synchronized frames,
  and its faithful 1440x828 replay was directly inspected. Controlled profiles,
  exact before/after records, hashes, runtime proof, SSH capture, evidence
  recovery, and limitations are retained under
  `track-4-world-composition/regional-place-prominence-v153/FINDINGS.md`.
  Repository verification passes 49 files / 271 tests, 18/18 typecheck tasks,
  12/12 build tasks, 7/7 configured lint tasks, and `git diff --check`. This is
  a selected hierarchy sub-gate, not Gate A: route-contact parcels,
  environment programs, the route-site field, the fresh 144-capture atlas,
  uninterrupted Gate C, sustained/deployed Gate D, deployment, and explicit
  physical Ghostty operator acceptance remain open. Production remains
  `vb07c0d4` with PID `1022033` and the same start timestamp; there was no
  deploy, service restart, push, production database write, complete-gate
  claim, or physical Ghostty claim;
- V154 replaces the material-pair checklist gap with a dynamic production
  boundary atlas and refuses six route/texture shortcuts that did not survive
  direct review. A fixed 768x768-tile ownership scan discovers 16 emitted
  classes and all 92 adjacent class pairs, then retains 276 exact near,
  walking, and district crops. Mean seam-to-interior RGB delta is 0.8792,
  only 2 crops exceed 1.2, and no crop repeats a tile-edge delta signature;
  direct inspection of the complete 8,050-pixel atlas and its numerical
  outliers finds intentional semantic contrast rather than a rectangular
  source, alpha, mip, or world-tile seam. Five geometry candidates and one
  six-family route-edge candidate are rejected: they either inflate crossing
  tiles by 17.8--32.3%, introduce slower orthogonal doglegs, or remain
  visually indistinguishable after faithful octant reconstruction. Two
  equal-density detailed-material candidates are also rejected. Extending
  four 96 px/seven-tile quadrant fields into one 192 px/fourteen-tile master
  doubles peak correlation from 0.031/0.030 to 0.068/0.069 and visibly enlarges
  the quilt; toroidal bilinear wrapping introduces rectangular coast seams,
  loses about 11% luminance contrast, and raises correlation to 0.044/0.044.
  Production route, asset, and compositor source is restored byte-for-byte.
  Reusable dynamic boundary and 40x32-tile texture-horizon harnesses, exact
  patches, atlas hashes, failed candidates, logs, decisions, and limitations
  are retained under `track-1-material-blending/` and
  `track-6-route-topology/route-geometry-v154/`. Repository verification passes
  49 files / 271 tests, 18/18 typecheck tasks, 12/12 build tasks, 7/7 configured
  lint tasks, both harness syntax checks, and `git diff --check`. This closes a
  bounded material-boundary enumeration sub-gate, not Gate A: detailed
  material patch synthesis, the route-site hierarchy, the fresh 144-capture
  atlas, Gate C, sustained/deployed Gate D, deployment, and explicit physical
  Ghostty operator acceptance remain open. Production remains `vb07c0d4` with
  PID `1022033` and the same start timestamp; there was no deploy, service
  restart, push, production database write, complete-gate claim, or physical
  Ghostty claim;
- V155 replaces detailed-material mirror quilting with an evidence-selected
  bounded triangular reconstruction. Four 192 px family variants are sampled
  through three deterministic, dihedrally oriented windows on a triangular
  lattice and blended with linear barycentric weights; windows activate only
  when their full source support fits, while scale-authored overview
  interpolation retains the former path. An equal-density square control
  proves that more pixels alone do not solve the visible lattice: translation
  peaks are nearly equal, but the new two-world-tile reflection diagnostic
  falls from 0.1851/0.2111 to 0.1422/0.1658 near/walking, a 23.2%/21.4%
  reduction that tracks direct inspection. Four earlier bounded-window
  candidates are retained and rejected for bands, herringbone, one-source
  repetition, or triangular value facets. The final 589,824-tile scan covers
  all 16 emitted classes, 92 adjacent class pairs, and 276 scale-authored
  crops: mean seam ratio is 0.9330, only one intentional forest/coast district
  transition exceeds 1.2, maximum remains 1.2679, and repeated edge signatures
  remain zero. The selected material pack is 10,120,850 bytes (+25.7%), the
  prewarm is 17,279,521 bytes (-2.1%), and retained full-kit RSS delta is 44.38
  MiB. Final-source readiness reaches exact origin in 1,826.375 ms with 0 ms
  generation, then renders 260 four-direction frames at
  5.992/18.009/37.529/41.494 ms p50/p95/p99/max with zero misses, requests,
  failures, imports, or main-thread fallbacks and 758.344 MiB peak RSS. An owned
  migrated scratch worker becomes ready in 1,816 ms; real loopback SSH asserts
  `(0,0)`, OCTANT, and 30% zoom across 276,672 bytes and 32 synchronized frames,
  and its faithful 1440×828 replay was directly inspected. Full controls,
  failed candidates, reflection and boundary atlases, hashes, runtime evidence,
  and limits are retained in
  `track-1-material-blending/texture-horizon-v155/FINDINGS.md`. Repository
  verification passes 49 files / 272 tests, 18/18 typecheck tasks, 12/12 build
  tasks, 7/7 configured lint tasks, both harness syntax checks, and
  `git diff --check`. This closes a detailed-material reconstruction sub-gate,
  not Gate A: the fresh 144-capture atlas, Gate C, sustained/deployed Gate D,
  deployment, and explicit physical Ghostty acceptance remain open. Production
  remains `vb07c0d4` with main PID `1022033`, worker PID `1022180`, and the same
  start timestamp; there was no deploy, service restart, push, production
  database write, complete-gate claim, or physical Ghostty claim;
- V156 completes a fresh current-source run of the unchanged 144-capture Gate A
  matrix after V49--V155. One owned scratch database and loopback-only real SSH
  lane retain 24 predetermined walkable sites, all six families and six
  transitions, walking/district/regional zooms, two Ghostty-class viewports,
  and day-clear/night-clear/day-rain/night-storm. All 144 raw streams, 144
  faithful replays, 30 contact sheets, and 288 raw/image hashes validate; the
  run contains 3,588 synchronized frames and 63,239,496 raw bytes. Capture
  duration is 5.926/13.994/15.745/16.381 s p50/p95/p99/max. Direct inspection
  of all six complete all-environment sheets against `TARGET.png` nevertheless
  **rejects Gate A**. V155 materially improves walking-scale painterly detail,
  V153 removes uniform icon wallpaper, broad boundaries remain soft, and the
  exact origin now reads as a real paired-quay canal place. Those improvements
  do not generalise: most other sites are attractive but empty material fields
  with isolated silhouettes; district and regional views collapse toward the
  same under-authored macro image; routes lack surrounding thresholds and
  frontage; waterfront success remains local; weather flattens family identity;
  and night-storm still compresses sparse sites toward a common near-black
  field. Eleven animated-weather captures also settle below the requested 25
  synchronized frames (minimum 18), retained as an explicit timing caveat.
  Full matrices, ledgers, hashes, sheets, startup observations, direct-review
  findings, and the next composition requirement are retained in
  `track-6-acceptance-atlas/acceptance-atlas-v4-current-source/FINDINGS.md`.
  No image generation or metered model call was used. This is audit completion,
  not visual acceptance: Gate A, Gate C, sustained/deployed Gate D, deployment,
  and explicit physical Ghostty acceptance remain open. Production remains
  `vb07c0d4`; there was no deploy, service restart, push, production database
  write, complete-gate claim, or physical Ghostty claim;
- V157 selects a 24-tile hierarchical, terrain-only regional place field as a
  bounded composition sub-gate. A meso parent now chooses one compatible
  family landmark from the semantic manifest and one to eight supports through
  continuous prominence/biome weights, route distance, terrain, collision,
  visible-footprint reservation, and deterministic hashes; no family-name or
  asset-ID table owns the result. All six final 432-by-432-tile audits have zero
  exact duplicate anchors, minimum nearest distance 1, median 6.3246--6.7082,
  coefficient of variation 0.4040--0.5619, and empty 48-tile-cell rate
  0--1.39%. Coast, rural, mountain, and ruins fixed walking views now contain
  readable multi-mass places. Forest and the forest/mountain transition remain
  under-composed, and direct comparison with `TARGET.png` still rejects Gate A:
  continuous route-connected frontages, circulation, activity, and dense
  function-bearing place grammar have not generalized beyond the origin.
  Rejected tiny ensembles, sparse golden-angle root search, a 32-tile cadence,
  and an expensive off-route paving experiment remain in the mounted evidence.
  The selected wilderness profile retains its biome ground rather than making
  a false regional-route claim or paying for mostly invisible high-resolution
  paving; route-owned civic compounds keep validated threshold/approach
  fabric. The final baked source reaches exact origin in 2,649.185 ms with zero
  generation, traverses 260 prepared frames with zero misses or main-thread
  fallback at 6.347/12.671/17.602/36.031 ms p50/p95/p99/max, and peaks at
  758.879 MiB RSS. Its first full frame is 109.293 ms, so Gate D remains open.
  Full candidates, CPU profiles, six-family ledgers, contact sheet, runtime
  report, hashes, and direct-review findings are retained in
  `track-4-world-composition/regional-place-ensembles-v157/FINDINGS.md`. No
  image generation or metered model call was used. Production remains
  `vb07c0d4`; there was no deploy, service restart, push, production database
  write, complete-gate claim, or physical Ghostty claim;
- V158 selects a route-frontage successor to V157's hierarchical place field
  as another bounded composition sub-gate. Authoritative bulk route-cell
  queries now bind a manifest-declared focal entrance to one terrain-, slope-,
  collision-, civic-, and cross-program-proven curve and distribute three to
  six compatible secondary masses along its arc-length frame. Continuous
  prominence, runner-up biome weight, and physical shoreline pressure govern
  admission; route geometry, manifest roles, parent affinity, and visual-group
  repetition pressure govern composition. No family-name or asset-ID table
  owns the result. Distinct axis-compatible gateway groups eliminate the
  two-rotations-of-one-silhouette failure while retaining the established
  focal, accepted access rasters/civic reservations are bounded shared-cache
  data, and the connected source envelope is corrected from a false summed
  88-tile reach to a geometry-proven 64-tile bound. Trail detail width/opacity
  rises to 0.90/0.82 and non-urban waystation reach to 20 tiles so circulation
  survives terminal projection. The selected six fixed frames retain the V157
  coast and rural strengths, materially improve forest/transition circulation,
  and report 2--3 visible place masses, 0--35 visible connector cells, and
  unique visual groups in every frame; cold source frames remain an expensive
  12.453--17.634 seconds. Direct comparison still rejects Gate A because most
  non-origin space remains sparse terrain rather than continuous inhabited,
  function-bearing district frontage. The exact 10,120,805-byte runtime kit
  and 17,643,731-byte six-viewport prewarm reach origin in 3,213.315 ms with
  zero generation; the first full frame improves from 109.293 to 92.461 ms and
  260 prepared traversal frames have zero misses/fallbacks at
  6.166/15.559/29.034/34.823 ms p50/p95/p99/max and 749.859 MiB peak RSS. This
  clears one local first-frame sample, not sustained/deployed Gate D: the fresh
  5/10/20-presence ladder, ten-minute stability proof, deployed cgroup proof,
  Gate C, complete 144-capture Gate A rerun, deployment, and physical Ghostty
  acceptance remain open. Complete A--V candidates, failed controls, direct
  review, six-family ledger, pack/report hashes, and limits are retained in
  `track-4-world-composition/regional-route-frontage-v158/FINDINGS.md`.
  Repository verification passes 49 files / 276 tests, both owned package
  typechecks, 7/7 lint graph tasks, the full SSH build, and 10/10 post-pack
  runtime tests. No image generation or metered model call was used. Production
  remains `vb07c0d4`; there was no deploy, service restart, push, production
  database write, complete-gate claim, or physical Ghostty claim;
- V159 completes the unchanged fresh 144-capture Gate A matrix on committed
  V158 source and **rejects Gate A again**. One owned tmpfs scratch PostgreSQL
  container and loopback-only real SSH lane retain all 24 predetermined sites,
  six families and six transitions, three semantic zooms, two Ghostty-class
  viewports, and four day/night/weather environments. All 144 raw streams, 144
  faithful replays, 30 contact sheets, and 288 recomputed raw/image digests
  validate with zero mismatches; the run contains 3,590 synchronized frames
  and 62,254,467 raw bytes. Direct original-resolution inspection of
  `TARGET.png` and all six complete sheets confirms V158's bounded improvement:
  more non-origin route contact, clearer approach lines, small multi-mass
  groups, and more visible route topology. It also proves how far the world
  remains from the target. Most walking views are still terrain plus a route
  and a handful of isolated silhouettes; routes do not own continuous
  thresholds, crossings, frontage, public space, or activity; neighbouring
  mountain/ruins parents collapse into repeated overview icon constellations;
  district and regional zoom remain nearly interchangeable; non-origin banks
  remain largely uninhabited; rain/storm dominate sparse compositions; and
  night/storm compresses family identity while detached overview lights become
  glowing discs. The larger viewport exposes more emptiness rather than hidden
  density. Successful capture duration also regresses to
  9.945/33.494/50.324/53.662 s p50/p95/p99/max. One authoritative day/rain
  regional-large session emitted no game frame within the 60-second deadline;
  its digest-resumable retry completed in 2.579 s, proving a one-time cold
  materialization stall but not cold reliability. Fifteen captures settle
  below the exact 25-frame contract and seven above it (range 23--27). Full
  matrices, hashes, sheets, logs, the retained failure, direct-review findings,
  and the required multi-parent district successor live in
  `track-6-acceptance-atlas/acceptance-atlas-v5-route-frontage-v158/FINDINGS.md`.
  The next pass must reserve whole multi-parent place footprints around shared
  circulation/public-space structure, extend neighbouring parcels as one
  destination, give overview zooms distinct aggregation silhouettes, bind
  atmosphere/lights/life to occupied structure, and correct cold cache
  admission before this exact atlas is attempted again. No image generation or
  metered model call was used. This is audit completion, not visual acceptance:
  Gate A, Gate C, sustained/deployed Gate D, deployment, and explicit physical
  Ghostty acceptance remain open. Production remains `vb07c0d4`; there was no
  deploy, service restart, push, production database write, complete-gate
  claim, or physical Ghostty claim;
- V160 corrects the cold-login thundering herd and completes the first genuine
  ten-minute-per-rung 5/10/20-presence real-SSH ladder on V158 source, while
  **rejecting Gate D at 20 presences**. The retained unmodified cold retry lets
  only one of five clients reach exact-origin readiness and records four
  PostgreSQL connection timeouts in concurrent `WorkerSession.start()` sprite
  loads. A cold leader followed by four concurrent warm initializers is also
  retained and rejected after reproducing three connection timeouts. The
  selected process-local admission queue therefore serializes the short
  database/world/renderer/first-frame stage, exposes cold/active/pending state,
  cancels queued disconnects, and leaves established gameplay concurrent. A
  fresh-idle five-client smoke reaches exact `(0,0)` for all clients, measures
  43.375 ms input p95 and 178.415 ms frame p99 over 30 seconds, reconnects two
  clients at exact origin, and cleans to zero sessions. The final 160x46
  loopback OpenSSH ladder then runs 600.096/600.165/600.237 seconds at 5/10/20
  presences with zero frame drops, drain events, recovery requests, recovery
  keyframes, or runtime-sampler failures. Input p95 is 42.868/50.201/**135.774**
  ms, frame p99 is 181.350/382.891/**752.541** ms, one-core CPU is
  32.713/59.965/87.745%, and peak tree RSS is 870.758/662.258/858.551 MiB. The
  20-client response violates the fixed 100 ms target and has 5.615-second
  input and 5.493-second frame maxima; worker utilization reaches 1.0 while the
  coordinator and transport remain healthy. The measuring harness itself is
  hardened so `/runtime` sampling cannot stop PTY drainage and every failure
  writes atomic client/rung evidence. Two-client churn restores 20 sessions at
  exact origin and final cleanup reaches zero. Focused verification passes 4/4
  admission tests, Python byte-compilation, current-source SSH build, and diff
  hygiene; the build reproduces a 10,120,821-byte runtime pack and
  17,643,726-byte six-viewport prewarm. Full failures, metrics, logs, hashes,
  diagnosis, and limitations are retained in
  `track-7-performance/route-frontage-v158/load-ladder-v1-sustained/FINDINGS.md`.
  This closes a cold-admission defect, not Gate D: worker/render reuse at 20
  presences, mode-separated bandwidth, a production-cgroup run, the larger
  physical Ghostty viewport, and the mixed movement/zoom/weather proof remain
  open. Full SSH-world verification passes 21 files / 86 tests. Production
  remains `vb07c0d4` with main PID `1022033`, worker PID
  `1022180`, and the same start timestamp; there was no deploy, service restart,
  push, production database write, complete-gate claim, or physical Ghostty
  claim;
- V161 selects the first bounded non-origin two-parent public-space grammar as
  a composition foundation while **continuing to reject Gate A**. The new
  experimental `shared-common` profile reuses one route-proved
  manifest-declared doorway as a public parent, finds one visually distinct
  opposite-side focal through the same semantic manifest, and reserves both
  complete visible footprints around one enlarged common, internal spine, two
  thresholds, and two approaches before up to four non-repeating frontage
  wings can compete. Terrain, slope, collision, protected access, public-core
  walkability, full civic composition, visual-group usage, and shared material
  SDFs own acceptance; no family-name or asset-ID case table owns selection.
  Extended search remains a rescue lane, but its solved displacement/depth/
  separation cost now lets the tighter valid common win overlap arbitration,
  restoring the stronger five-mass mountain composition without a fixture
  exception. Rejected owners may retain only collision-safe satellite masses
  outside public-space and connector reservations. The synthetic stress proof
  retains exactly two public parents per admitted program, one common and one
  spine, at least two approaches, five of five strongly paved and walkable
  public-core samples, and an exact protected access path that remains
  collision-free and walkable even where multiple curves merge onto one
  physical connector surface. The selected six fixed frames contain 2/4/5/6/
  4/2 ambient masses for coast/forest/mountain/ruins/rural/transition, 0/35/19/
  15/25/0 visible connector cells, and 1--3 structurally valid shared-common
  layouts intersecting each crop. Direct original-resolution inspection of
  common-centred forest and ruins frames finally shows four distinct structures
  enclosing broad warm public clearings, and mountain materially improves;
  coast remains sparse, rural still reads partly as scattered objects, and the
  forest/mountain transition is essentially unchanged. Complete A--J controls,
  failed candidates, final metrics, hashes, logs, direct-review findings, and
  limitations are retained in
  `track-4-world-composition/regional-multi-parent-district-v161/FINDINGS.md`.
  Repository verification passes 50 files / 282 tests, 18/18 typecheck tasks,
  7/7 configured lint tasks, 12/12 build tasks, lab syntax, and diff hygiene;
  the build produces a 10,120,821-byte runtime pack and 17,643,726-byte
  six-viewport prewarm. No image generation or metered model call was used.
  This profile is not enabled in production and does not justify another full
  atlas yet: coast/rural/transition generalization, continuous neighboring
  parcels/frontage, overview-specific aggregation, structure-bound life/light/
  weather, Gate C, sustained/deployed Gate D, deployment, and explicit physical
  Ghostty acceptance remain open. Production remains `vb07c0d4`; there was no
  deploy, service restart, push, production database write, complete-gate
  claim, or physical Ghostty claim;
- V162 selects a sparse clear-day dynamic-composition path and bounded direct
  IPC telemetry while **continuing to reject Gate D**. Providers may now
  enumerate visual activity from a prepared viewport's sparse persistent-time
  map, with explicit authoritative-empty versus point-query-fallback semantics.
  The renderer grades only exact actor/activity pixels, clones the shared
  graded static atmosphere rows, restores those patches, and retains the full
  path for night/lights, rain, and storm. An alternating 800-frame-per-lane
  160x46 benchmark with 20 colocated players, five baked viewports, and 18
  sparse activity tiles is pixel-identical at hash
  `ac04069dfe0e3e3f15644407da0f0ddcde00dbf899794a005e0e2a85b89bb751`:
  viewport-composition p95 improves 5.666→5.015 ms (-11.498%) and production
  `renderToString` p95 improves 6.360→5.935 ms (-6.692%). The V8 profile moves
  `applyWorldAtmosphere` from 50.1% to 12.8% of non-library JavaScript ticks.
  Direct `process.send` remains selected; cumulative bounded telemetry now
  decomposes main→worker input, handler time, callback pressure/latency, and all
  versus immediate worker→main receipt. Three built and measured dispatcher
  variants are rejected: callback serialization creates a 16.038-second
  synchronized 10-client response tail; one-yield dispatch reaches 459.757 ms
  20-client input p95 and a 333-message queue; callback bursts do not provide a
  durable gain. A final direct-send diagnostic localizes only about 13--15 ms
  of the p95 server-side worker path, leaving the larger main/ssh2/OpenSSH PTY/
  kernel/harness tail unassigned. The first 60-second real-SSH smoke preserves
  exact origin and zero drops/drains/recovery but fails response at 10 and 20
  clients (114.883/158.849 ms p95) on a severely memory/CPU-pressured host, so
  it is not a sustained or production pass. The probes also prove that scratch
  world-time drift into night/lights expands work materially; every future
  variant must reset environment state and measure clear day, night/lights,
  rain, and storm separately before the mixed run. Complete controls, failed
  variants, metrics, profiles, hashes, host-pressure limits, and next proof are
  retained in
  `track-7-performance/sparse-dynamic-overlay-v162/FINDINGS.md`. Full repository
  verification passes 51 files / 284 tests, 18/18 typecheck tasks, 7/7 lint
  tasks, 12/12 build tasks, and diff hygiene; the build produces a
  10,120,822-byte runtime pack and 17,643,726-byte six-viewport prewarm. The
  selected source is not deployed. A reset sustained 5/10/20 ladder under a
  recorded normal-load window, separate environment-mode audits, downstream
  terminal-delivery decomposition, mixed 30-minute movement/zoom/weather,
  mode/keyframe bandwidth, deployed cgroup observation, larger physical
  Ghostty viewport, and operator use remain open. Production remains
  `vb07c0d4`; there was no deploy, service restart, push, production database
  write, complete-gate claim, or physical Ghostty claim;
- V163 generalizes V162's shared dynamic plane through authored night lights,
  rain, and storm while **continuing to reject Gate D**. The selected renderer
  prepares source-ordered local lights once, caches their immutable static
  atmosphere contribution, and applies exact falloff only to actor/activity
  pixels. Rain/storm now cache one exact anchor-ordered static weather plane per
  phase; dynamic pixels analytically invert every streak anchor that can reach
  them and replay repeated mixes in the original order. Weak keys and bounded
  LRUs own retention. The exhaustive provider fallback, 15 Hz weather cadence,
  authored colours, and pixels remain unchanged. Tests prove exact exhaustive-
  versus-shared buffers with translucent actors under clear-night lights and
  night storm, plus exact complete production ANSI output. At 160x46 with 20
  colocated actors, clear-night 400-frame viewport p50/p95 improves
  17.882/23.896→7.710/12.164 ms and `renderToString` improves
  24.018/33.952→8.962/13.217 ms, retaining hash
  `5d13904e9d63b8d7f3c90cff01525c9678cdb8d9e18cac5bd531bbc1343550f3`.
  Exact 200-frame day-rain viewport p50/p95 improves
  6.124/9.978→3.042/5.725 ms; exact night-storm improves
  21.596/31.444→7.582/14.251 ms, while its genuinely changing terminal path
  improves 35.102/46.939→21.793/35.585 ms. A synchronized 20-renderer
  night-storm probe measures 27.136 ms leader p50 versus 15.516 ms across 19
  followers, proving cross-session reuse rather than one-renderer memoization;
  independent legal ANSI deltas are not mislabelled as visual equivalence.
  The selected profile reduces `applyWorldAtmosphere` to 2.0% of non-library
  JavaScript ticks (12.8% after V162; 50.1% before it); regional noise/material
  sampling now dominates. Complete mode controls, profile logs, hashes,
  synchronized-sharing evidence, limits, and next proof are retained in
  `track-7-performance/static-night-light-v163/FINDINGS.md`. Full repository
  verification passes 51 files / 285 tests, 18/18 typecheck tasks, 7/7 lint
  tasks, 12/12 build tasks, and diff hygiene; the build produces a
  10,120,820-byte runtime pack and 17,643,730-byte six-viewport prewarm. The
  source is not deployed: a deterministic-mode reset, normal-host sustained
  5/10/20 SSH ladder, mixed 30-minute run, bandwidth/delivery decomposition,
  deployed cgroup observation, larger physical Ghostty viewport, and operator
  use remain open. Production remains `vb07c0d4`; there was no deploy, service
  restart, push, production database write, complete-gate claim, or physical
  Ghostty claim;
- V164 corrects V163's profiling methodology and selects exact parent-cell
  weather deltas while **continuing to reject Gate D**. The benchmark now starts
  the V8 inspector profile only after regional kit initialization and 30 warmup
  frames; the corrected V163 profile proves packed terminal emission and OCTANT
  fitting dominate steady storm rendering, not regional sampling. Each cached
  static precipitation plane now retains its immutable lit/graded parent and
  the exact terminal-cell offsets touched by the original ordered streak
  algorithm. Production OCTANT conversion copies the parent's five typed-array
  planes and perceptually re-fits only those weather cells before the existing
  actor/activity delta. Weak ownership, bounded weather-frame retention, 15 Hz
  cadence, authored pixels, material phases, and exhaustive fallback remain
  unchanged. At 160x46, world minute 0, storm intensity 0.9, 20 colocated
  actors and 400 alternating frames, the selected control keeps the exact V163
  hash `b73372415cd6f3e8fef9a109510edd0d80a96821ec991a526ea4c6de7a58662f`
  while production `renderToString` p50/p95 improves
  20.337/34.887→16.470/25.252 ms. Corrected-profile sampled
  `renderOctantScratchPacked` falls 2248.1→871.6 ms (-61.2%) and total sampled
  CPU falls 16.535→13.668 seconds (-17.3%). The new direct proof compares all
  five parent-derived packed planes with exhaustive reconstruction, alongside
  complete cached-versus-exhaustive storm ANSI equality. Complete evidence and
  the retained V163 profiling correction are in
  `track-7-performance/static-weather-cell-delta-v164/FINDINGS.md`. Repository
  verification passes 51 files / 286 tests, 18/18 typecheck tasks, 7/7 lint
  tasks, 12/12 build tasks, and diff hygiene; the build produces a
  10,120,806-byte runtime pack and 17,643,731-byte six-viewport prewarm. The
  next bounded target is byte-equivalent packed terminal emission/SGR/GC, not
  regional sampling. The source is not deployed, and the severely pressured
  host is not accepted as sustained latency evidence. The reset normal-host
  5/10/20 real-SSH ladder, mixed 30-minute run, bandwidth/delivery
  decomposition, deployed cgroup observation, larger physical Ghostty viewport,
  and operator use remain open. Production remains `vb07c0d4`; there was no
  deploy, service restart, push, production database write, complete-gate
  claim, or physical Ghostty claim;
- V165 decomposes the packed terminal delivery path and selects delayed SSH
  compression while **continuing to reject Gate D**. The representative 160x46
  storm delta is 106,110 bytes of byte-exact ANSI but raw-DEFLATEs to 28,995
  bytes (0.273 ratio), so production source now requires only the post-auth
  `zlib@openssh.com` transport by default, with an explicit optional-mode
  operational rollback. A reset matched one-presence, 60-second real-SSH A/B
  reduces OpenSSH wire receive from 1,296,184 to 226,864 bytes (-82.5%) while
  process-tree CPU is effectively unchanged at 10.014%→10.143%, with zero
  drops, drains, or recovery requests. The compressed connection itself
  records 1,190,500 raw bytes becoming 211,414 compressed bytes (factor 0.18).
  Frame p95/p99 varies 135.842/167.654→140.644/174.856 ms and the response
  distribution is mixed, so this is a bandwidth selection rather than a
  rendering-latency claim. An ordinary OpenSSH client launched with
  `Compression=no` still negotiates the server's sole delayed-zlib algorithm,
  authenticates, and opens the world. Rejected and reverted experiments include
  string-rope return allocation, 262K `Map` and direct-mapped SGR caches,
  six-bit lossy terminal colour, and removal of delta REP scanning; none earned
  a durable CPU/byte gain. The load ladder now retains optional OpenSSH
  negotiation/wire counters and supports isolated 1/3-presence diagnostics.
  Complete payload probes, failed candidates, controlled A/B metrics, client
  logs, limits, and next proof are retained in
  `track-7-performance/packed-terminal-emission-v165/FINDINGS.md`. Repository
  verification passes 51 files / 286 tests, 18/18 typecheck tasks, 7/7 lint
  tasks, 12/12 build tasks, and diff hygiene. The build produces a
  10,120,819-byte runtime pack and 17,643,725-byte six-viewport prewarm. The
  severely pressured host is not normal-host evidence, and the reset sustained
  5/10/20 ladder, environment-mode audit, mixed 30-minute run, deployed cgroup
  observation, larger physical Ghostty viewport, and operator use remain open.
  The selected source is not deployed. Production remains `vb07c0d4`; there
  was no deploy, service restart, push, production database write,
  complete-gate claim, or physical Ghostty claim;
- V166 makes normal-host qualification a machine-enforced part of the real-SSH
  proof contract while **continuing to reject Gate D**. The ladder now records
  CPU/memory/I/O PSI, load per logical CPU, available memory, resident swap, and
  swap-I/O rate before admission, continuously across warmup/rungs/churn, and
  per rung. `--require-normal-host` rejects a contaminated preflight before
  opening SSH clients and returns exit code 2 if any later workload sample
  invalidates the window; completed raw evidence remains retained with
  `normalHostQualified=false`. Fixed limits reject memory or I/O full-PSI above
  1%, CPU some-PSI above 20%, load above one runnable task per logical CPU,
  available memory below 2 GiB, or swap I/O above 1 MiB/s. Three deterministic
  tests cover a passing window, all six rejection signals, and the live kernel
  snapshot contract. The first live preflight correctly refuses this host
  without admitting a client: memory full-PSI 44.37%, I/O full-PSI 37.94%, and
  load/core 1.290 violate the contract. Evidence and threshold rationale are in
  `track-7-performance/host-pressure-qualification-v166/FINDINGS.md`. Full
  repository verification remains green at 51 files / 286 tests, 18/18
  typecheck tasks, 7/7 lint tasks, and 12/12 build tasks. This closes the
  evidence loophole, not the sustained 5/10/20 run: a genuine qualified window,
  environment-mode audit, mixed 30-minute run, deployed cgroup observation,
  larger physical Ghostty viewport, and operator use remain open. Production
  remains `vb07c0d4`; there was no deploy, service restart, push, production
  database write, complete-gate claim, or physical Ghostty claim;
- V167 selects a faithfully reviewed **hybrid regional-material successor**
  while continuing to reject Gate A. Codex's built-in image-generation path on
  the existing ChatGPT subscription produced one untouched six-panel V2 atlas,
  with exact prompt and SHA-256 provenance and no metered API spend. Fresh
  gutter-derived reconstruction reproduces all six derivatives byte for byte.
  Direct 160x44 OCTANT review accepts only the less-washed canal limestone and
  more cohesive blue-green coast marsh: coast walking boundary/interior ratio
  improves `0.862 -> 0.839`, arrival detail `1.094 -> 1.045`, and bridge detail
  `0.959 -> 0.939`. V2 forest, rural, mountain, and ruins are explicitly
  rejected for softened identity, conspicuous furrow repetition, lost rock
  fractures, or lost mosaic identity even where a metric improved. Six
  full-world shared-common frames retain exact placement counts; the deliberate
  coast change measures 7.63% normalized mean pixel difference from V161 while
  forest/rural/mountain/ruins/transition remain bounded at 1.30/1.05/0.79/
  0.22/1.36%. An independent default-manifest proof reproduces the accepted
  material-only and full-world PNGs byte for byte, the exact full-world semantic
  hash `c1a18d782e652e5c95e6c9a83fe652c8dc0db84efa7c6958243e8d2d58f4ecb8`,
  44 placements, 7 parcel components, and four valid visible fabrics. The labs
  now resolve material files from an overridable manifest and fail early on
  duplicate, missing-family, missing-field, or missing-file input instead of
  retaining stale V1 filename tables. A parallel continuous-frontage inquiry
  rejects and reverts route-frontage candidates A--J: the compatible rural road
  was about 42 tiles from the visible core, and the road-centred view exposed
  only two clipped objects. Occupation-yard candidates K--M are likewise
  reverted after one displaced a good shed and the corrected/stronger versions
  remained visually too subtle (about 0.59--1.03% rural change) for their cost.
  Complete generation, derivation, hybrid, parity, direct-review, and rejected
  evidence lives in
  `track-1-material-blending/regional-imagegen-materials-v167/FINDINGS.md` and
  `track-4-world-composition/regional-continuous-frontage-v167/FINDINGS.md`.
  Repository verification passes 51 files / 286 tests, 18/18 typecheck tasks,
  7/7 lint tasks, 12/12 build tasks, lab syntax, derivation reproducibility,
  and manifest/full-world parity. The uncached build produces a 10,119,049-byte
  runtime pack from 126 source files and a 17,299,670-byte six-viewport prewarm.
  Its 9m46s wall time and the 19.986--31.583s research frames are correctness
  observations only: the host showed load above 20, about 22 GiB resident swap,
  and severe memory/I/O PSI, so V166 correctly excludes them from Gate D.
  Continuous frontage, stronger coast/rural/transition composition, the fresh
  complete Gate A atlas, a qualified sustained 5/10/20 ladder, Gate C, deployed
  cgroup proof, and explicit physical Ghostty acceptance remain open. Production
  remains `vb07c0d4`; there was no deploy, service restart, push, production
  database write, complete-gate claim, or physical Ghostty claim;
- V168 **rejects and fully reverts** a route-first `route-common` topology.
  The candidate projected one meso district from a solved road tangent/normal
  before choosing its landmark, paired parents, common, approach, and frontage.
  Its synthetic invariant was sound across cache sizes: two public parents,
  route-starting access no longer than 24 tiles, and a common within 18 tiles
  of the road. At the actual admitted mountain common `(96,116)`, direct
  same-coordinate comparison materially improved one isolated-object V161
  control into four unique masses around valid public ground. That local win
  failed the family preservation gate: the established rural coordinate became
  nearly empty, Candidate A duplicated a mountain visual group, and the V167
  coast coordinate fell from 44 to 25 cached placements with zero visible
  ambient masses, leaving bare marsh. A continuous six-family biome-distance
  penalty could move the failure but could not preserve meso ownership. The
  batch therefore stopped after the decisive coast regression, every source,
  type, lab, and test change was removed, and all candidates/controls remain in
  `track-4-world-composition/regional-route-common-v168/FINDINGS.md`. The next
  topology must keep the low-frequency place/identity field stable while
  jointly reserving an additional route-owned street node; short access alone
  cannot replace an accepted destination. Gate A, production enablement, and
  physical Ghostty acceptance remain open;
- V169 **rejects and fully reverts** the additive `shared-street` successor.
  Unlike V168 it keeps the selected meso root and common fixed, then fits a
  two-sided route node at the start of that place's proved access path. The
  rural destination retained all four accepted visible masses, and the
  route-centred view genuinely improved two clipped mountain props into a
  complete rural barn/produce-awning pair with distinct visual groups on
  opposite sides of the trail. The architecture still failed the decisive
  coast-preservation gate: the accepted marsh-beacon cluster disappeared,
  visible fabric layouts fell 4 -> 3, and a clipped forest lean-to replaced it
  at the frame edge even though local audits remained valid. This proves that
  adding child footprints before global program admission can evict a peer
  program without relocating its own root. The batch stopped at that failure,
  all source/type/lab/test changes were removed, and controls, candidates,
  metrics, logs, and diagnosis remain in
  `track-4-world-composition/regional-shared-street-v169/FINDINGS.md`. The next
  experiment must freeze meso program admission and identities first, then add
  omittable route detail in a non-authoritative second pass that cannot evict or
  resize any accepted place. Gate A, production enablement, and physical
  Ghostty acceptance remain open;
- V170 selects a bounded experimental `shared-common-street-overlay` successor
  while continuing to reject Gate A. Meso roots, parents, commons, access,
  fabrics, overlap admission, and connectors are frozen first; only then may a
  stable second pass fit a complete two-sided family-coherent route node. The
  detail pair yields as a unit to every accepted program, connector, civic mass,
  terrain constraint, earlier detail, and pathless low-frequency meso root, so
  it cannot resize or evict a place. A focused invariant proves complete
  admitted-program identity parity against `shared-common`, exact pathless-root
  parity, paired opposite-side semantics, and exact output across 32/47-tile
  cache blocks; it also caught and eliminated duplicate source-block emission.
  At the real rural road `(106,122)`, two clipped mountain props become a
  coherent rural stone-barn/produce-awning pair belonging to the unchanged
  destination. At the decisive coast coordinate, the accepted V167 frame now
  reproduces byte for byte: semantic hash `c1a18d...ecb8`, OCTANT SHA
  `7a7115...58`, 44 placements, both coast masses, and four valid fabrics.
  Forest and transition are also byte-identical; rural/mountain/ruins keep exact
  visible inventories and fabric counts with directly reviewed normalized PNG
  deltas of 1.03/0.79/0.21%. Candidate A's place-wide vocabulary suppression
  and Candidate B's unprotected retained-root regression remain as negative
  evidence. Full verification passes 51 files / 287 tests, 18/18 typecheck,
  7/7 lint, and 12/12 build; the 10,119,052-byte runtime pack and 17,299,671-byte
  six-viewport prewarm completed. The 7m30 uncached SSH-world build ran under
  roughly 23 GiB swap and severe memory/I/O PSI, so it is correctness only, not
  Gate D. Complete evidence lives in
  `track-4-world-composition/regional-post-admission-street-overlay-v170/FINDINGS.md`.
  The profile is not production-enabled. A dynamically enumerated multi-place/
  multi-route atlas, fresh complete Gate A atlas, production proof, Gate C, and
  physical Ghostty acceptance remain open;
- V171 selects a sparse, manifest-driven dynamic street-atlas harness while
  explicitly **failing** V170's completeness gate. Targets are derived from
  focal family/axis/side metadata, not a hand-maintained list; discovery reuses
  canonical meso programs and actual provider route blocks; exported place-cell
  size/source reach plus runtime block size eliminate duplicated geometry. The
  first dense radius-1024 design was terminated after about ten CPU-active,
  memory-stable minutes with no frames and is retained as a rejected harness.
  Sparse Candidate B exposed a contradiction, and instrumentation found the
  exact bug: parcel kits do not own block geometry, so an undefined block size
  collapsed every route key to `NaN,NaN`. Correct Candidates D/E independently
  reproduce 400 evaluated cells, 181 place programs, 112 shared fabrics, 40
  route windows, and nine admitted sites inside radius 160. Coverage is only
  4/11 manifest-supported combinations—forest, mountain, ruins, and rural,
  all north-south; canal-town, both coast axes, and every east-west case are
  absent. Mountain, ruins, and rural pass all seven visible street checks.
  Forest correctly fails the strengthened viewport-scale repetition check
  because `forest-log-shelter-v1` appears twice, once clipped at the frame edge,
  despite local pair uniqueness. Candidate D/E OCTANT frames are byte-identical
  and direct-reviewed. Evidence lives in
  `track-4-world-composition/regional-dynamic-street-atlas-v171/FINDINGS.md`.
  Repository verification passes 51 files / 287 tests, 18/18 typecheck, 7/7
  lint, a fresh `@maldoror/world` build, lab syntax check, and diff check. The
  2m49.89s typecheck ran under severe shared-host memory/I/O pressure and is
  correctness evidence only, not Gate D.
  The harness is selected; the world gate is not. Next work must count route-
  axis opportunity versus overlay-fit rejection for each missing family/axis,
  then solve cross-site repetition without coupling detail back into meso
  admission. Production, fresh Gate A, Gate C, Gate D, and physical Ghostty
  acceptance remain open;
- V172 selects the manifest-derived street opportunity census and identifies
  the missing vocabulary's distinct causes without changing world topology.
  Inside radius 160, 112 raw shared-fabric programs yield 51 in-scope route
  opportunities across the same 40 authoritative route windows; every route is
  valid. The ordered outcomes partition exactly into six intrinsic-fit
  rejections, 12 meso-admission rejections, 24 final detail-reservation
  rejections, and nine admitted pairs. Canal-town and both coast axes have no
  opportunity in this field; mountain and ruins have no east-west opportunity.
  Forest has four and rural three valid east-west opportunities, all with exact
  production-fitter pairs under empty reservation, but their final overlays are
  lost downstream (forest: two meso + two detail; rural: one meso + two detail).
  Thus missing east-west forest/rural is not an art or route-axis problem. The
  four selected OCTANT PNGs remain byte-identical to V171 and forest retains
  its correctly failing viewport repetition audit. Evidence lives in
  `track-4-world-composition/regional-street-opportunity-v172/FINDINGS.md`.
  Next, test the documented-but-not-realized replacement contract: preserve all
  meso parents, commons, fabric, paths, connectors, and earlier street pairs,
  but let only fine access-path frontage props yield to a complete street pair
  and cull the displaced props afterward. Program parity, cache/block exactness,
  coast/arrival preservation, and expanded atlas coverage are mandatory;
- V173 rejects and fully reverts the access-frontage replacement experiment.
  The candidate preserved all nine strict V170 pairs and added five complete
  replacement pairs, reducing final detail rejections 24→19 and exposing one
  rural east-west frame. However, authoritative collection reported 15 sites
  with street detail but only 14 complete pairs: one real site emitted a
  cross-block half-pair. The rural east-west frame also repeats semantic visual
  group `rural-stone-barn-v1` between its new street barn and preserved common
  frontage, so both the street uniqueness and whole-place composition audits
  fail. Direct review found the new forest/mountain selections locally strong,
  but they cannot outweigh atomicity and repetition failures. A synthetic
  32/47-block invariant and all 34 provider tests had passed, proving that the
  fixture was insufficient; the faithful dynamic atlas remains authoritative.
  All provider/test/lab changes were reverted, accepted `dist` output rebuilt,
  and the restored focused invariant re-passed. Evidence lives in
  `track-4-world-composition/regional-frontage-replacement-v173/FINDINGS.md`.
  Next work requires one canonical pair-level detail decision reused by every
  block/cache size plus whole-place semantic-group reservation; hash thinning
  cannot repair a block-context admission contract;
- V174 hardens the dynamic atlas with explicit `completePairSiteCount` and
  structured `incompleteSites`; coverage can no longer report complete when a
  block emits only one side. Its mounted-drive research contract synthesizes
  primary parallel Poisson-disk, unique-priority conflict-resolution, and
  counter-based deterministic-randomness work into a Maldoror-specific design:
  one coordinate-addressed complete-pair candidate, fixed world ownership cells
  independent of provider block size, immutable protected geometry, semantic
  visual-group conflict edges, strict V170 pairs at higher priority, and a
  bounded one-pass local-priority independent set. Blocks may materialize a
  winning pair but never decide it. Exact 32/47 signatures, traversal-order
  equality, empty incomplete-site diagnostics, whole-place semantic uniqueness,
  bounded cache/neighbour counts, and coast/arrival regression are mandatory
  before another regional atlas. Research lives in
  `track-4-world-composition/regional-canonical-pair-admission-v174/RESEARCH.md`;
- V175 selects the pure canonical street-pair admission kernel without claiming
  a rendered-world change. Complete candidates now carry owning-place identity,
  strict/replacement rank, coordinate-keyed priority, full visible-halo cell
  reservations, and semantic visual groups. Exact geometry intersections and
  same-place group reuse form conflict edges; established strict pairs outrank
  replacements; locale-independent identity breaks exact ties. The bounded
  one-pass local-priority result is traversal-order independent and deliberately
  conservative rather than globally maximal. Seven focused tests prove fixed
  negative-coordinate ownership, three traversal orders, strict precedence,
  conservative chain suppression, semantic isolation, cross-place reuse, ties,
  and invalid-input rejection; all 34 existing provider tests still pass, as do
  world typecheck/build and all seven repository lint tasks. The proposed
  64-cell ownership size is not yet an
  empirically proved neighbour bound, and the kernel is not connected to the
  provider. No placement or frame has changed and no atlas is warranted.
  Evidence lives in
  `track-4-world-composition/regional-canonical-pair-kernel-v175/FINDINGS.md`.
  Next work must derive real complete-pair candidates, prove footprint/reach
  bounds, cache canonical winners by ownership cell, materialize both halves
  from the same winner, and pass exact 32/47/traversal/atomicity/semantic/
  coast-arrival gates before any visual comparison;
- V176 selects real complete-pair candidate identity while preserving V170
  output exactly. Every successful production fitter result is now one typed
  record containing owning-place and route-ownership coordinates, access/axis/
  two-placement identity, the union of both visible one-tile-halo footprints,
  manifest visual groups, strict rank, and a world/full-identity keyed priority.
  The generic selector retains enriched placement payloads. A focused real-
  provider proof derives the same intrinsic candidate from 32- and 47-tile
  providers and compares its full ID, ownership, priority, footprint, groups,
  and asset/anchor tuple exactly. All 41 kernel/provider tests, world typecheck/
  build, and seven repository lint tasks pass. This is still a compatibility
  refactor: candidate fitting receives V170's sequential block-local reservation
  set, canonical competition is disabled, no placement changed, and no atlas is
  warranted. Evidence lives in
  `track-4-world-composition/regional-real-pair-candidates-v176/FINDINGS.md`.
  Next, enumerate these real candidates by fixed route-contact ownership cells,
  measure and prove the finite footprint neighbour ring, validate complete
  pairs against immutable protected geometry, and compare cached winner
  signatures across block sizes/traversals before materialization changes;
- V177 selects diagnostic-only fixed-cell enumeration of real intrinsic pair
  candidates. A worker-shared bounded LRU enumerates canonical 24-tile meso
  sources through the proved 64-tile source reach, filters each pair to an exact
  64-tile route-contact owner, and never consults provider block geometry. Five
  ownership cells produce exact signatures under forward 32-tile, reverse
  47-tile, and reversed cached traversal. The faithful radius-160 production-
  manifest census resolves the unchanged 400/181/112 place/program/fabric
  field and enumerates 36 ownership cells: 60 total candidates, 46 inside the
  exact margin, 46 unique identities, zero duplicate emissions, and zero owner
  mismatches. Observed complete halos contain at most 76 cells and reach at most
  11 tiles per axis (12.042 Euclidean), yielding a conservative one-cell ring;
  all three observed conflicts are same-cell. A saturation test overfills the
  worker LRU and proves its exact `maxCachedBlocks * 16` cap. The proof is
  field-bounded—not yet global—because missing canal/coast and several missing
  axes could carry a larger manifest asset. V170 remains nine complete sites
  with no incomplete pair, the same 4/11 coverage and exact `0/6/12/24/9`
  opportunity partition;
  all eight source/OCTANT PNG hashes are byte-identical to V172. All 41 tests,
  world typecheck/build, lab syntax, faithful census, and seven lint tasks pass.
  The cache remains diagnostic-only, so no rendered improvement is claimed.
  Evidence lives in
  `track-4-world-composition/regional-fixed-cell-candidates-v177/FINDINGS.md`.
  Next, prove the neighbour ring against every eligible manifest family/axis,
  derive immutable fixed-space protected reservations, and compare canonical
  winner signatures across blocks/traversals before any materialization change;
- V178 selects the manifest-wide street-pair footprint proof without claiming a
  rendered-world change. The production fitter and proof tool now share one
  exact route-relative anchor/search contract: three setback steps, seven
  symmetric nudges, 1.5-tile along-side bias, 0.9-tile frontage gap, one-tile
  visible halo, and the exported 1.45 maximum route half-width. The analytic
  lab retains full sprite rectangles, including transparent cells, and covers
  all 22 eligible assets across all 11 paired family/axis vocabularies rather
  than only families observed in one field. The worst 10x14 canal-town asset
  reaches 16 tiles per axis (20.616 Euclidean), proving one neighbouring
  64-tile ownership-cell ring is globally sufficient under the production
  manifest. The faithful V178 census still observes only 11/12.042 reach, 60
  emissions, 46 in-margin unique candidates, no duplicates or ownership
  mismatches, and three same-cell conflicts. V170 remains nine complete sites,
  no incomplete pair, 4/11 coverage, and exact `0/6/12/24/9` opportunity
  stages; all eight source/OCTANT hashes are byte-identical to V177. All 42
  focused tests, world typecheck/build, lab syntax, faithful census, seven lint
  tasks, and source diff check pass. This closes only the finite-neighbour
  proof: canonical selection and materialization are still disconnected and no
  visual improvement is claimed. Evidence lives in
  `track-4-world-composition/regional-manifest-pair-bound-v178/FINDINGS.md`.
  Next, derive immutable protected-geometry reservations in fixed space, prove
  their signatures across blocks/traversals, and run the selector over each
  ownership cell plus its proved one-cell ring before materialization changes;
- V179 selects a diagnostic-only fixed-space protected-reservation layer. Each
  64-tile ownership cell now derives sorted, frozen cells, same-place visual
  groups, and exact provenance sources from pathless/common masses, explicitly
  protected common frontage, collision/visible halos, fabric, connectors, and
  bounded civic composition. Fine access-path props explicitly opt into
  `streetPairProtection='replaceable'`; all other geometry is protected by
  default, avoiding brittle path-ID inference. The clip/source envelope is
  derived dynamically from the actual paired manifest and route widths, not an
  asset/family table or remembered reach. Five-cell signatures are exact across
  forward 32-tile, reverse 47-tile, and reversed cached traversal; the separate
  LRU saturates at `maxCachedBlocks * 16`. The faithful census produces 36
  non-empty reservations, 76,286 cell references (41,799 unique; max 3,969 per
  cell), 1,293 unique sources, 503 protected group references, a 16-tile
  manifest reach, and zero reach mismatch. Crucially, all 46 intrinsic first
  fits conflict geometrically and all 46 repeat a protected same-place visual
  group. Filtering V177 candidates would therefore erase the layer: canonical
  candidates must be refit against immutable reservations and use genuinely
  distinct semantic groups. V170 remains nine complete pairs, 4/11 coverage,
  exact `0/6/12/24/9` stages, and eight PNG hashes byte-identical to V178. All
  43 focused tests, world typecheck/build, lab syntax, faithful census, seven
  lint tasks, and source diff check pass. No admission/materialization path
  changed and no visual improvement is claimed. Evidence lives in
  `track-4-world-composition/regional-protected-reservations-v179/FINDINGS.md`.
  Next, generate protected-fit alternatives with non-repeating visual groups,
  prove their exact signatures, then feed the one-cell selector without
  changing V170 materialization;
- V180 selects the diagnostic protected-refit factory and proves the current
  production manifest is insufficient. For each fixed ownership cell it loads
  V179's immutable cells/groups, indexes protected groups by owning site,
  reruns the exact bounded production setback/nudge fitter with those groups
  excluded, rejects residual conflicts through the V175 kernel, and stores
  sorted frozen candidates in its own bounded LRU. An alternative-rich fixture
  proves the fitter can select a complete second semantic pair when geometry is
  open; the full conservative fixture truthfully yields zero across forward
  32-tile, reverse 47-tile, and reversed cached traversal. The faithful census
  likewise refits all 36 ownership cells to **zero** protected candidates from
  the current atlas, so `currentManifestBlocked=true`: each required
  family/axis has only the same pair already protected in its owning common.
  The one-cell selector remains disconnected because connecting it now would
  erase the active layer. V170 stays at nine complete pairs, 4/11 coverage,
  exact `0/6/12/24/9` stages, and all eight PNG hashes byte-identical to V179.
  All 43 focused tests, world typecheck/build, lab syntax, faithful census,
  seven lint tasks, and source diff check pass. No visual improvement is
  claimed. Evidence lives in
  `track-4-world-composition/regional-protected-refit-v180/FINDINGS.md`. Next,
  author a genuinely distinct paired focal vocabulary for every required
  family/axis through the selected hybrid imagegen-to-ANSI pipeline, prove
  non-empty exact protected-fit signatures, and only then exercise the selector;
- V181 selects a subscription-generated paired focal alternative vocabulary
  without enabling it in V170. Two retained 3x2 source boards supply twelve
  distinct workplaces/civic silhouettes: cooper/dyer, charcoal/resin,
  boatwright/smokehouse, forge/dovecote, assay/stable, and cloister/bathhouse.
  A tracked deterministic pipeline crops, adaptive-chroma-mattes, trims, alpha-
  validates, and applies the selected gamma-1.32 terminal-shadow grade; all
  source/output hashes are pinned. Twenty-two axis aliases cover both sides of
  all eleven required family/axis vocabularies with twelve new visual groups.
  Explicit `canonical-alternative` metadata excludes them from ordinary
  entourage, gateway, shared-common parent, and active V170 overlay selection,
  while the protected refit and manifest-wide bound can see them. The faithful
  36-cell census changes V180's zero to one legal candidate: a forest north-
  south charcoal-kiln/resin-distillery pair; `currentManifestBlocked=false`.
  The global proof now covers 44 eligible focal aliases but retains the same
  16/20.616 maximum reach and one-cell ring. V170 remains exactly nine complete
  sites, 4/11 coverage, `0/6/12/24/9`, and all eight active PNGs byte-identical
  to V180. Derivation, 43 world/kernel tests, 9 loader tests, world/SSH
  typechecks, fresh builds, runtime-pack construction, faithful census, and
  seven lint tasks plus source diff check pass; failed worker-startup,
  ten-second I/O timeout, and
  stale-declaration attempts are retained. No in-world visual improvement is
  claimed. Evidence lives in
  `track-4-world-composition/regional-paired-focal-vocabulary-v181/FINDINGS.md`.
  Next, prove the non-empty production signature across 32/47/reversed/cached
  providers, exercise the V175 one-cell selector, and diagnose the other ten
  geometry/admission absences before materialization changes;
- V182 selects a diagnostic-only canonical winner cache over the proved
  one-cell conflict ring. Each ownership cell gathers the complete protected-
  fit neighbourhood implied by the manifest-wide 16-tile reach, applies the
  pure V175 selector before ownership filtering, and stores sorted frozen
  winners in a separate `maxCachedBlocks * 16` LRU. The faithful radius-160
  census produces exactly one protected candidate and one winner: the V181
  forest north-south charcoal-kiln/resin-distillery pair in ownership cell
  `(-2,-2)`. Its full ID, owner, priority, reserved cells, visual groups, asset
  placements, anchors, parcel provenance, station, and tangent are exact across
  32- and 47-tile providers, reversed traversal, and cached replay. The global
  proof remains 44 eligible aliases, 11 vocabularies, 16/20.616 maximum reach,
  and one neighbouring cell. Active V170 materialization remains disconnected:
  nine complete sites, 4/11 coverage, exact `0/6/12/24/9` stages, and all eight
  PNGs byte-identical to V181. Focused 43/43 tests, world typecheck/build,
  faithful census, lint, and source diff checks pass. No visual improvement is
  claimed. Evidence lives in
  `track-4-world-composition/regional-canonical-selection-v182/FINDINGS.md`.
  Next, record conflict-source/stage diagnostics for the other ten protected-
  fit absences, compare the proved winner against the active V170 pair, and
  render the canonical candidate at walking/district/regional scales in
  scratch before any materialization change;
- V183 selects an exact diagnostic-only protected-refit rejection ledger. Each
  fixed-cell reservation now retains sorted source-to-cell provenance across
  placement, fabric, connector, and civic geometry; each refit records dynamic
  family/axis vocabulary, exact floating route contact, semantic exclusions,
  every bounded terrain/route, protected-cell, pair-footprint, doorway, and
  route-distance rejection, plus any final reserved-halo conflict. The faithful
  radius-160 census reconciles exactly 51 route opportunities to 51 attempts:
  35 exhaust the bounded search, 15 reach a pair whose one-tile halo still
  conflicts with protected geometry, and one is accepted. The failed searches
  comprise 665 terrain/route attempts, 823 protected-reservation attempts, 31
  distant-doorway attempts, and zero missing-doorway or pair-self conflicts.
  Their exact evidence spans 1,451 protected cells and 144 unique sources;
  the 15 residuals expose 99 halo-conflict cells and zero residual semantic-
  group conflict. Five vocabularies have no route opportunity at all; the six
  attempted vocabularies are accounted separately rather than conflated with
  topology absence. All diagnostics are byte-exact across 32/47 providers,
  reverse traversal over 29 emitting ownership cells, and cached replay. The
  single V182 forest winner and one-cell bound remain unchanged. Active V170
  remains nine complete sites, 4/11 coverage, exact `0/6/12/24/9` stages, and
  all eight PNGs byte-identical to V182. The initial 52-attempt boundary probe
  is retained as rejected evidence; exact route-contact filtering corrects it.
  Tests, world typecheck/build, faithful census, lint, and source diff checks
  pass. No in-world visual improvement is claimed. Evidence lives in
  `track-4-world-composition/regional-protected-refit-diagnostics-v183/FINDINGS.md`.
  Next, make the bounded refit search halo-aware without shrinking protected
  geometry, prove whether any of the 15 residuals become legal alternatives,
  then compare and render the canonical winner at walking/district/regional
  scales in scratch before materialization;
- V184 selects a diagnostic-only halo-aware protected refit. Every bounded
  asset/setback/nudge probe now tests the same one-tile visible halo exported by
  the final candidate, while the immutable parent reservation, semantic
  exclusions, and halo size stay unchanged. The exact radius-160 ledger remains
  51 route opportunities and 51 attempts: V183's 15 residual conflicts become
  nine newly legal accepts and six honest bounded exhaustions, for 10 accepted
  in-radius attempts, 41 exhaustions, and zero residual conflicts. A separate
  expanded conflict-margin site contributes one additional proved candidate,
  so the global selector has 11 candidates and 11 winners. Search records 629
  terrain/route, 1,104 protected-reservation (including 123 halo-specific), 26
  distant-doorway, and zero pair-self or missing-doorway rejections across
  1,651 exact conflict cells and 153 protected sources. All candidate,
  rejection, and selection identities are exact across 32/47 providers,
  reverse traversal, and cached replay. The original V182 forest winner remains
  among the eleven. Active V170 remains nine complete sites, 4/11 coverage,
  exact `0/6/12/24/9` stages, and all eight PNGs byte-identical to V183. The
  five zero-opportunity vocabularies remain topology absences. Focused 43/43
  tests, world typecheck/build, downstream SSH typecheck, faithful census,
  seven lint tasks, lab syntax, hash parity, and source diff checks pass; the
  two stale empty-result fixture assertions are retained as failed evidence.
  No in-world visual improvement is claimed. Evidence lives in
  `track-4-world-composition/regional-halo-aware-refit-v184/FINDINGS.md`. Next,
  render and compare the eleven proved winners with their meso parents,
  protected reservations, circulation, and halos at walking, district, and
  regional scales in scratch before choosing any materialization policy;
- V185 selects a scratch-only canonical-winner atlas and rejects direct
  materialization of the V184 candidate set. All 11 exact winners are parsed
  back into authored semantics and rendered against their untouched baselines
  at walking, district, and regional scales, producing 33 source PNGs, 33
  faithful OCTANT reconstructions, 33 base-left/scratch-right comparisons, and
  six corrected contact sheets. Every frame has a non-zero delta, all 33
  scratch and baseline hashes are unique, and all fabric audits remain valid.
  The visual result is nevertheless insufficient: eleven placements collapse
  to four asset/visual-group pairs, including the identical forest pair six
  times; all are north-south and confined to forest, mountain, and rural, so
  they add zero coverage beyond active V170's 4/11 vocabulary. Mean changed
  area falls from 6.0702% walking to 1.6469% district and 0.46294% regional.
  The pairs remain isolated endpoint props on often-long access corridors and
  do not transform their empty meso composition into occupied street fabric.
  Thirteen frames also expose a separate repeated-placement enumeration audit
  that is not yet proven to duplicate physical or rendered pixels. The first
  overly strict parser failure and the corrected run are retained; focused
  38/38 world tests, world typecheck, seven lint tasks, lab syntax, and source
  diff checks pass. Active pixels and production remain untouched, and no
  physical Ghostty acceptance is claimed. Evidence lives in
  `track-4-world-composition/regional-canonical-scratch-v185/FINDINGS.md`.
  Next, prove enumeration, physical-placement, and rendered-cell uniqueness
  separately; improve family/axis route opportunity and multi-building
  occupied-frontage grammar; then rerun this scratch atlas before any active
  materialization;
- V186 selects an exact composition-identity audit and rejects V185's
  provisional bounds-query duplication hypothesis. The faithful 33-frame run
  separates canonical `asset@anchor` query identity, physical anchor identity,
  visible sprite cells, and manifest visual groups across 50 visible
  composition observations at 31 owner sites. Query identities and physical
  anchors are unique in 33/33 frames. The actual defects are deeper: 13 frames
  at 10 sites contain 19 unique site/group silhouette repetitions, while two
  forest compositions each interpenetrate on eight exact visible cells.
  Axis-specific and parcel/place asset IDs therefore were masking real visual
  reuse, and two distinct-anchor placement pairs were genuinely composited
  through each other. Failed parcel-only and ambient-plus-parcel audit models
  are retained; candidate C correctly resolves the complete provider visual
  vocabulary. Focused 38/38 tests, world typecheck, seven lint tasks, lab
  syntax, and source diff checks pass. Only diagnostics and a canonical-query
  fixture assertion change; active V170 and production remain untouched.
  Evidence lives in
  `track-4-world-composition/regional-composition-identity-v186/FINDINGS.md`.
  Next, build a scratch placement-policy successor that reconciles complete
  footprints after shared-parent substitution and excludes the assembled
  place's dynamic visual groups from optional street pairs; prove lost
  coverage and the exact failing sites before any active-pixel change;
- V187 selects an opt-in exact whole-place composition profile as a proof
  instrument but rejects candidate A for active materialization. The profile
  pins roots, route-access targets, and shared public parents, then admits an
  optional mass only when its complete visible footprint is disjoint and its
  manifest visual group is new; it assembles complete street pairs before
  cross-program arbitration and removes both sides if either later fails.
  The fail-closed 33-frame atlas reproduces every V186 legacy hash, both real
  footprint failures, and all 13 repeated-group frames. The exact candidate
  passes all four composition invariants in 33/33 frames, with 25 changed
  frames, but the visible ambient union falls from 263 to 239 and all 16
  legacy street placements at eight sites fall to zero because every ordinary
  focal pair repeats a group already used by its parent. Visual inspection
  confirms structurally clean but visibly thinner walking/district places.
  The earlier block-local implementation's 32/47 disagreement and two atlas
  harness failures are retained; the corrected coordinate-owned program,
  focused 39/39 tests, typecheck/build, downstream SSH typecheck, seven lint
  tasks, lab syntax, baseline parity, and source-diff checks pass. Active V170,
  production, and physical Ghostty remain untouched. Evidence lives in
  `track-4-world-composition/regional-composition-exact-v187/FINDINGS.md`.
  Next, inventory alternate focal eligibility dynamically, select distinct
  silhouettes under a district repetition budget, expand the five zero-route-
  opportunity family/axis vocabularies, and build multi-building frontage
  before rerunning the same exact atlas;
- V188 selects a data-derived exact focal-eligibility census. Across 400 meso
  cells and 112 exact fabric programs at radius 160, 51 route-facing sites are
  probed against the same complete program reservation with ordinary and then
  complete alternative vocabulary. The manifest has 45 eligible focals (23
  ordinary, 22 canonical alternatives): 44 form 11 paired family/axis
  vocabularies, each with one ordinary and one alternative group per side;
  canal-town retains one unpaired east-west negative-side ordinary frontage.
  Ordinary vocabulary yields 0/51 exact pairs because its groups are already
  used by the parent programs. Alternatives recover 18/51, all using two
  genuinely distinct canonical alternatives, but collapse to four repeated
  pairs: forest 10, mountain four, ruins two, rural two. The remaining 33 fits
  exhaust bounded geometry with 528 terrain/route, 747 protected-reservation,
  and 18 distant-doorway rejections; pair-self collision and missing-doorway
  counts are zero. Five vocabularies have no route opportunity at all
  (canal-town north-south, both coast axes, mountain east-west, ruins
  east-west), while forest/rural east-west have seven opportunities but zero
  fits. Candidate A is retained; B adds the unpaired and exact rejection
  ledger. Lab syntax, faithful execution, and diff checks pass. Only research
  instrumentation changes; active V170, V187 semantics, production, and
  physical Ghostty remain untouched. Evidence lives in
  `track-4-world-composition/regional-focal-eligibility-v188/FINDINGS.md`.
  Next, render an opt-in exact-alternative profile unbudgeted against the same
  33 frames, measure its four-pair stamping, then add a deterministic spatial
  repetition budget only if it preserves occupied frontage and every exact
  invariant;
- V189 selects an **experimental, non-active** exact-alternative profile and
  fixes the generated focal derivation before trusting it. Candidate A passed
  declared geometry but enlarged crops exposed functionally invisible art:
  the dark subjects had been matted toward roughly five-percent alpha by an
  inappropriate 12..220 soft range. The same built-in Codex/ChatGPT
  subscription boards are now deterministically re-derived with a measured
  dark-key 8..32 matte plus fail-closed weighted/strong-alpha gates; all 12
  assets reconcile to their updated manifest hashes. The final faithful
  Candidate D matches all 33 immutable V186 legacy RGB hashes, preserves
  candidate identity/anchor/disjoint-footprint/group invariants 33/33, changes
  26/33 frames, and visibly replaces repeated generic huts with eight occupied
  sites across four forest, three mountain, and one rural pair. Its 44
  frame-visible street-member occurrences have zero missing cells and zero
  protected-connector clips. It is **not promoted**: only three pair
  vocabularies appear, the fixed sheets show obvious forest/mountain stamping,
  and the broadened raster audit exposes 134 missing cells in older parent
  members (130 clipped by protected connectors) so true whole-program
  materialization passes only 19/33 candidate frames. Host load 11..24 on eight
  CPUs makes timing inadmissible; production and physical Ghostty remain
  untouched. Forty-five focused tests, both TypeScript builds, and the 138-file
  regional runtime-pack build pass. Metrics SHA
  `044aed3b70b45a376c05725ae13eb1d6c7d4a4602267f35a3fba275f5c259220`;
  evidence lives in
  `track-4-world-composition/regional-composition-exact-alternatives-v189/FINDINGS.md`.
  Next, attribute every raster cell to its owning placement and remove parent
  connector/overlay suppression by re-routing or refitting; only after full
  program materialization passes should a district repetition budget and new
  family/axis vocabularies be tested;
- V190 selects an exact ambient-materialization foundation while keeping it
  **experimental and non-active**. The provider now retains only non-colliding
  placement contributions over protected connectors, exposes batched
  placement-level raster provenance, reserves proved access paths before
  shared-common frontage, and makes exact-profile route-parcel admission
  coordinate-stable and fail-closed. The final Candidate K matches all 33
  immutable V186 baseline hashes and materializes 5,149/5,149 visible cells
  across every ambient placement in the fixed atlas: zero collision loss,
  zero non-collision loss, zero false-owner coverage, and 60/60 safe connector
  overlaps retained. Its nested exact compositions materialize 4,105/4,105
  cells and pass identity, anchor, disjoint-footprint, visual-group, and
  complete-pair gates in 33/33 frames. Forty-six provider/street-pair tests,
  both TypeScript builds, and the 138-source runtime-pack plus six-viewport
  origin-prewarm build pass. Candidate elapsed timings are inadmissible under
  heavy host contention; active V170, production, and physical Ghostty remain
  untouched. This is not a visual promotion: the same four forest, three
  mountain, and one rural pair sites remain visibly stamped, with no coast,
  canal-town, or ruins alternative in the fixed atlas. Metrics SHA
  `86cb981f74f40c3bcecbc7eaad28b68ed4bfedadd160aa425a3370b636c59bea`;
  evidence lives in
  `track-4-world-composition/regional-composition-materialization-v190/FINDINGS.md`.
  Next, use Candidate K as the corrected unbudgeted baseline for a
  deterministic district repetition budget, but require genuinely new
  family/axis vocabulary wherever a budget would otherwise create empty
  frontage;
- V191 selects a broader exact-pair vocabulary and repetition-budget
  **foundation, not an active render policy**. Two new built-in
  Codex/ChatGPT-subscription boards add 12 genuinely different workplace/civic
  silhouettes and 22 canonical-alternative aliases; no metered image API was
  used. The manifest now has 67 focal aliases (23 active, 44 alternatives) and
  24 alternative visual groups. A radius-160 authoritative census raises
  valid pair signatures from four to 12 and valid sites from 18 to 20 while
  identifying five remaining zero-route topology samples. The lab-only
  radius-96 budget keeps all 20 sites occupied, raises effective pair entropy
  10.4410→11.1904, and reduces near repeated-pair edges 3→0 without
  suppressing frontage. It is not materialized as a coordinate-owned world
  program yet. The faithful unbudgeted atlas matches all 33 immutable V186
  base hashes, materializes 5,143/5,143 broad visible cells with 60/60 safe
  connector overlaps, passes all 47 exact composition observations, changes
  29/33 frames, and doubles its visible pair vocabulary from three to six.
  Original-resolution V190/V191 comparisons show readable sawpit, apiary,
  ore-stamp, and threshing silhouettes but still reject promotion: the world
  remains sparse, two signatures still repeat, five family/axis samples lack
  route opportunities, and endpoint buildings are not continuous street
  fabric. A reproduction audit additionally found volatile PNG timestamps;
  derivation now strips metadata, pins the matte-helper hash, reproduces all 24
  V1/V2 assets byte-for-byte, and reconciles source/derived hashes in tests.
  Ten asset/provenance tests, 46 provider/street-pair tests, both TypeScript
  builds, and the 150-source runtime-pack plus six-viewport origin-prewarm
  build pass. Production, active V170, and physical Ghostty remain untouched.
  Metrics SHA
  `61c66ed0928aae5f033deec3d30b71402bd65ec85501414b71d781d229e7fad4`;
  evidence lives in
  `track-4-world-composition/regional-district-repetition-v191/FINDINGS.md`.
  Next, materialize the selected budget through one coordinate-owned decision
  that is block-size independent, then solve the zero-route and east/west fit
  gaps without relaxing collision, reservation, or V190 ownership gates;
- V192 **rejects every tested runtime materialization of the district budget**
  while retaining a stronger diagnostic target. Three shifted radius-160
  censuses at `[192,0]`, `[96,96]`, and `[-192,192]` extend the origin sample
  to 92 occupied pair sites. A corrected ownership sweep caught and removed a
  SHA/runtime-spatial-hash mismatch: 192×192 introduces boundary repeats, and
  the only zero-repeat fixed seam tested across all four samples is 512×512 at
  Y phase 256, requiring 729 cold place-cell evaluations. An exhaustive
  coordinate-local search proves that constant-time hash and lattice policies
  retain 3–8 near repeats. One higher-priority-neighbour pass at salt `0x3b67`
  preserves all 92 sites, reaches zero near-pair repeats in every sample,
  raises combined unique signatures to 60, and reduces combined nearby group
  reuse to 33—but its materializers fail runtime acceptance. Against a
  3:07.53 / 649,724-KiB unbudgeted three-frame control, fixed ownership costs
  9:15.95 / 884,388 KiB, local selection costs 6:37.30 / 923,652 KiB, and
  post-admission local selection costs 6:25.11 / 953,400 KiB. All three
  candidates change exactly zero pixels at walking, district, and regional
  scales. Their experimental provider profile, caches, tests, and exports were
  removed; production and V191 behavior remain untouched. Evidence lives in
  `track-4-world-composition/regional-district-budget-ownership-v192/FINDINGS.md`.
  Next, enlarge valid per-site vocabulary and route opportunity first so a
  constant-time policy can approach the zero-repeat target without neighbour
  enumeration, then rerun the explicit 33-frame atlas and accept only visible
  gain within the runtime envelope;
- V193 selects terrain-clipped shoreline commons as an **experimental exact-
  profile improvement, not an active production policy**, and revises this
  governing goal so extreme end-to-end performance is co-equal with fidelity
  and may never be won by rendering or simulating less. An exhaustive
  `[-1024,1024]` route-field scout evaluates 263,169 samples and proves nonzero
  route opportunities for all twelve family/axis combinations. Exact fallback
  diagnostics then localize the bounded coast gap to common admission rather
  than art or route topology. A shared common may now retain water beneath only
  its peripheral material mask when at least two thirds of its raster is dry,
  all five public-core probes and every threshold are dry, and the existing
  slope gate passes; the compositor leaves water-owned pixels unpaved. The
  origin radius-64 sample improves from 4/16 to 9/16 exact fabrics and recovers
  east/west coast, while honestly retaining two north/south coast failures.
  The complete atlas finds a valid north/south coast pair elsewhere at
  `[182,89]`. Focused original-resolution walking inspection selects both coast
  axes as coherent waterfront places. The full 33-frame V186 atlas preserves
  every base hash, passes 48/48 exact composition observations, materializes
  5,212/5,212 broad cells with zero false owners or connector clips, and keeps
  all 365 public-core probes paved and walkable. Eight frame hashes change from
  V191; the walking sheet is pixel-identical and sparse district/regional
  differences add place objects without a terrain-wide shift. Forty-two
  provider/fabric tests, fourteen asset/runtime-pack tests, both TypeScript
  builds, the 150-source runtime pack plus six-viewport prewarm, and 7/7 lint
  tasks pass. The complete atlas takes 16:52.99 at 2,652,980-KiB peak RSS with
  zero swaps; the downstream pack/prewarm build takes 4:47.19 at
  1,802,020-KiB peak, exposing the first explicit V194 performance target under
  the new no-sacrifice A/B contract. Metrics SHA
  `e248f6fb8682c995b69544585ace86480e6a0a7514aba3de52a9b67c44271d4b`;
  evidence lives in
  `track-4-world-composition/regional-route-family-opportunity-v193/FINDINGS.md`.
  V194 profiles that exposed downstream build and selects the first strict
  no-sacrifice correction: viewport export no longer fills and then overruns a
  bounded compositor LRU before consuming the same rectangle. All six decoded
  viewport payloads remain byte-identical across schema, identity, dynamic
  placements, terrain RGBA/material/walkability, overlay coordinates/RGBA, and
  collision. Full build wall time falls 4:47.19 to 3:21.23 (-29.93%), summed
  generation 252,674.730 to 170,845.977 ms (-32.39%), and peak RSS 1,802,020 to
  1,387,752 KiB (-22.99%), with zero swaps. This is a selected build-path
  milestone, not Gate D. A more aggressive overlapping packed-viewport reuse
  candidate now passes a low-priority full build, 67/67 relevant tests, exact
  cross-LOD regression, and six-viewport decoded parity; its contaminated run
  directionally reaches 3:01.06 wall, 137,184.452 ms summed generation, and
  1,172,504-KiB peak RSS with zero swaps. It remains unselected because a
  machine-readable post-run preflight records I/O-full PSI 30.48% against the
  fixed 1% limit. Candidate-B parity SHA
  `400ee88b717b2915daa0ecf4a634d4d81501d5bddddbb665b897a3369f7d4a28`;
  host-rejection SHA
  `31e67aa295637b4aa9cb72e717890e2e9d9292d58d8c42b77efae3945c1cad12`.
  Candidate-A selected parity SHA
  `589ab2f79ba76dd588c3bf446742638f2150b83bbfe0183dd59ec7ed3e806f80`;
  evidence lives in
  `track-7-performance/regional-prewarm-v194/FINDINGS.md`.
  V195 then profiles the actual production OCTANT packed
  `PixelGameRenderer.renderToString` path at 160x46, storm intensity 0.9, five
  baked viewports, and 20 colocated players. Sparse composition reaches
  12.374-ms p95, but complete production render reaches 27.957-ms p95 and the
  20-session batch reaches 32.017-ms per-session p95, both above the governing
  16.7-ms runtime target before transport. The representative frame changes
  2,841 cells and emits 101,946 bytes through 2,849 SGR and 656 cursor commands;
  its exact final pixel hash matches across alternating lanes. The CPU profile
  localizes the largest self costs to packed terminal emission, SGR generation,
  GC, changed-run emission, and OCTANT scratch rendering. An indexed/truecolor
  style-state candidate is rejected: it preserves exact pixels but changes
  neither payload bytes nor command counts and worsens measured latency under a
  more pressured host window. Its source changes were removed while its profile
  remains as negative evidence. Baseline benchmark SHA
  `f2d7fdbffd96a526d6a9832f980a8c1f6cc5a25ee5e9cf559f27a086a90e69a7`;
  rejected-candidate benchmark SHA
  `900c60b372c11783e6f519c78a8443aae302c6102cd0f66c27e957b104976d2e`;
  evidence lives in
  `track-7-performance/production-packed-profile-v195/FINDINGS.md`.
  V196 selects the first semantic emission correction from that profile.
  Truecolor OCTANT full blocks with identical foreground/background now emit
  as background-painted spaces: exactly the same terminal pixels, without the
  unused foreground or three-byte glyph. Indexed water and every non-flat cell
  stay conservative. An independent fail-closed test terminal proves semantic
  equality through keyframes, deltas, and exact camera-cell scrolling. On the
  same representative storm frame, application output falls 101,946 to 90,187
  bytes (-11.53%) and delayed-SSH deflate falls 27,866 to 26,187 bytes (-6.03%)
  while changed cells, cursor commands, and final world-pixel hash remain
  exact. Fifty-two test files / 308 tests, 18/18 typecheck tasks, 7/7 lint
  tasks, and 12/12 build tasks pass. Candidate benchmark SHA
  `a61c93bfefe495c6a36012b9f072e881da6d64f70ae8794566cea02c1b734a83`;
  evidence lives in
  `track-7-performance/flat-octant-terminal-v196/FINDINGS.md`. This is selected
  source evidence, not deployed or sustained Gate D; pressured-host latency is
  retained only as directional evidence.
  V197 then replaces only same-row follow-up absolute cursor addresses with
  shorter relative moves. The optimization is width-safe: generated OCTANT
  glyphs and printable ASCII may retain cursor position, while any arbitrary
  Unicode overlay forces the next run back to absolute addressing. The
  independent terminal oracle now proves CUF, disjoint runs, DCH camera motion,
  and the unknown-width fallback. Two full repetitions preserve the exact
  final world-pixel hash and representative 2,841 changed cells while replacing
  612/656 absolute addresses. Application bytes fall another 90,187 to 87,711
  (-2.75%) and delayed-SSH deflate falls 26,187 to 24,961 (-4.68%); cumulative
  reductions from V195 are 13.96% and 10.42%. Selected benchmark SHA
  `86238060c0082ed20fed8739673caffadb0e4a31b3ba997d2c079dc687e73e73`;
  evidence lives in
  `track-7-performance/relative-cursor-v197/FINDINGS.md`. This remains selected
  source evidence, not an admissible-host latency claim, deployment, real-SSH
  proof, physical Ghostty acceptance, or Gate D.
  V198 rejects a general exact dynamic truecolor palette before adding its
  substantial state machinery. Across day clear, night clear, day rain, and
  night storm, the representative 7,040-cell packed frame contains
  7,893--10,738 exact truecolors across 10,995--13,267 semantic channel uses.
  All 208 slots that remain after protecting base terminal and material bands
  cover only 7.1--11.0% of those uses; text overlays would make the real
  cardinality slightly worse. Quantization remains forbidden, and the selected
  eight-phase water palette remains intact because its bounded material
  vocabulary has the opposite shape. Evidence lives in
  `track-7-performance/dynamic-palette-cardinality-v198/FINDINGS.md`. This is a
  retained negative result, not a production change or Gate-D claim.
  V199 removes nested packed-run string arrays and intermediate joins while
  preserving V197 output byte-for-byte. Packed cells now append directly to
  one frame chunk buffer and join once. Two full workloads retain 87,711
  application bytes, 24,961 deflated bytes, 2,841 changed cells, the exact
  final world-pixel hash, and the width-safe cursor split. Against V195, the
  combined packed helper/parent, SGR, and GC self-time group falls 5,951 to
  4,913 ms (-17.4%) and profiled user CPU falls 92.13 to 88.76 seconds (-3.66%).
  Two pressured-host 20-session batch p95 readings reach 18.946 and 20.228 ms
  versus V195's 32.017 ms, directionally better but still above the 16.7-ms
  target and not host-admissible. Eleven render test files / 76 tests pass.
  Profiled benchmark SHA
  `b9f73091f2c1160fb3a7db9d41b4cfb7088c99b10ed5c5bfb4fc02bb0aa9a013`;
  evidence lives in
  `track-7-performance/flat-packed-emission-v199/FINDINGS.md`. This is selected
  source evidence, not deployment, sustained Gate D, real-SSH proof, or
  physical Ghostty acceptance.
  V200 then rejects compacting or translating the shared common as the remedy
  for the two unresolved origin north/south coast sites. Five bounded,
  coordinate-owned variants retained every dry-raster, five-point core,
  threshold, slope, collision, civic, ownership, and determinism gate. The
  strongest bank shift found 5/5 dry cores and 2/2 dry thresholds at both
  sites, but only in fabrics that were 46.4% and 51.9% dry; the most compact
  trial peaked at 64.567% dry with only 1/5 dry core, still below the fixed
  two-thirds floor. Candidate code is removed. Selected exact diagnostics now
  retain the actual best-dry and best-public centre, extents, dry rate, core
  rate, and threshold rate instead of unrelated aggregate maxima. The clean
  radius-64 census remains 16 access programs, 9 exact fabrics, 7 fallbacks,
  and 6 terrain-clipped survivors. Metrics SHA
  `ab68a5a35ae6c58876a413ce6ab956038f8389639af1aa5b5912e4204d12f17f`;
  evidence lives in
  `track-4-world-composition/bank-aware-common-v200/FINDINGS.md`. This is a
  selected diagnostic and retained failure, not Gate A or a visual milestone.
  V201 removes the packed delta encoder's repaint bridge: every run now
  contains exactly one contiguous changed island, with V197's width-safe CUF
  moving between islands. A bounded candidate ladder proves that bridging
  three unchanged cells worsens output to 98,302 bytes, one cell improves it
  to 78,529, and zero is the exact optimum at 73,125 bytes. Against V199's
  identical 400-frame-per-lane, world-minute-0 storm workload, application
  bytes fall 87,711 -> 73,125 (-16.63%), delayed-SSH deflate 24,961 -> 20,809
  (-16.63%), SGR commands 2,847 -> 2,171 (-23.74%), changed-cell p50 2,841 ->
  2,164 (-23.83%), and byte p95 92,774 -> 76,689 (-17.34%). More short CUF
  commands intentionally replace much more expensive truecolor repaint. An
  independent terminal emulator proves separated deltas equal a fresh
  keyframe; 11 render files / 77 tests pass and the exact final world-pixel
  hash remains
  `43e268d450634356e365b1adb92d5b19321f18bda2553c7a876eba7866fa51bb`.
  Comparable benchmark SHA
  `b22ee0b7b5acab48eda143d8a4fcc8ae0d8689e1149007cc767056e6ec3a910f`;
  evidence lives in
  `track-7-performance/changed-run-bridge-v201/FINDINGS.md`. This is selected
  source/protocol evidence, not deployment, sustained Gate D, real SSH, or
  physical Ghostty acceptance: post-run I/O-full PSI was 6.07%/60s against the
  fixed 1% host gate.
  V202 then reuses the exact relative CUF packet for each previously observed
  cursor-forward distance in a lazy integer-indexed array. The selected cache
  changes zero bytes, commands, changed cells, or pixels. A candidate/control/
  candidate bracket over identical 400-frame-per-lane production workloads
  reduces user CPU by 1.91% and 2.90%, wall time by 5.26% and 4.37%, and the
  combined packed-emitter/SGR/GC self group by 3.86% and 7.26% versus the
  intervening uncached control. Both candidates retain 73,125 application
  bytes, 20,809 deflated bytes, and exact final world-pixel hash
  `43e268d450634356e365b1adb92d5b19321f18bda2553c7a876eba7866fa51bb`;
  11 render files / 77 tests pass. Repeat benchmark SHA
  `4085500affc5dc9a341666814a40900fa305dd46f87963bdef35481cd44f3c5a`;
  evidence lives in
  `track-7-performance/cursor-forward-cache-v202/FINDINGS.md`. This is selected
  exact source/allocation evidence, not deployment or Gate D: post-run
  I/O-full PSI was 5.56%/60s against the fixed 1% host gate.
  V203 measures the packed-SGR pair cache before changing it. Temporary
  diagnostics show the 65,536-entry cache hits only 67.60% and clears seven
  times over the exact 400-frame-per-lane workload; retaining the full
  166,421-pair working set raises hits to 91.35%. Capacity is nevertheless
  rejected: a clean 262,144-entry candidate/control/candidate bracket moves
  user CPU +9.11% and -1.81%, while the targeted packed-emitter/SGR/GC self
  group regresses in both candidates by 48.34% and 17.56%. Every candidate and
  control retains 73,125 application bytes, 20,809 deflated bytes, and exact
  final pixel hash
  `43e268d450634356e365b1adb92d5b19321f18bda2553c7a876eba7866fa51bb`.
  The 65,536 cap is restored and all counters are removed; evidence lives in
  `track-7-performance/sgr-cache-cap-v203/FINDINGS.md`. This is a retained
  failure, not Gate D: post-run I/O-full PSI was 47.03%/60s.
  V204 then tests a fixed-memory, two-way set-associative SGR cache at the
  original 65,536-entry capacity, validating both exact color keys on every
  hit and replacing one collision without Map nodes or whole-cache clears.
  Although helper-inclusive SGR/cache self time falls 48.90% and 46.45%, the
  exact candidate/control/candidate bracket rejects the system result: user
  CPU rises 2.13% and 13.93%, peak RSS rises 6.22% and 6.77%, and the complete
  packed-emitter/SGR/GC self group rises 22.25% and 31.12%. All legs retain
  73,125 application bytes, 20,809 deflated bytes, and exact final pixel hash
  `43e268d450634356e365b1adb92d5b19321f18bda2553c7a876eba7866fa51bb`.
  The original Map is restored; evidence lives in
  `track-7-performance/sgr-set-cache-v204/FINDINGS.md`. This is a retained
  failure, not Gate D: post-run I/O-full PSI was 34.73%/60s.
  V205 moves above the rejected pair-cache variants into linear-light
  composition. It precomputes the exact IEC sRGB transfer result for all 256
  byte inputs once, while retaining the original formula for every non-byte
  input. No interpolation, quantization, alpha, or color-space rule changes.
  In the exact candidate/control/candidate bracket, user CPU falls 8.73% and
  11.51%, wall falls 8.70% and 16.02%, peak RSS falls 2.67% and 2.90%, and the
  atmosphere/blend/weather/light/GC self group falls 26.41% and 36.67%.
  `srgbByteToLinear` self time falls 89.85% and 96.82%. All legs retain 73,125
  application bytes, 20,809 deflated bytes, and exact final pixel hash
  `43e268d450634356e365b1adb92d5b19321f18bda2553c7a876eba7866fa51bb`;
  11 render files / 77 tests pass. Repeat benchmark SHA
  `593f7208b8d6c060da16fde9e7cf27ff89e10a7ec03bc3772b54200a5943b9c7`;
  evidence lives in
  `track-7-performance/srgb-linear-lut-v205/FINDINGS.md`. This is selected
  exact source evidence, not deployment or Gate D: post-run I/O-full PSI was
  54.36%/60s and memory-full PSI was 13.93%/60s.
  V206 applies the same exact-transfer principle inside painterly OCTANT
  fitting, where every production call previously divided a byte by 255 and
  reran the sRGB power function. A 256-entry Float64 table stores the original
  `srgbToLinear(byte / 255)` result; non-byte values retain the formula. An
  independent 257-case byte/fractional Oklab oracle requires exact equality.
  In the candidate/control/candidate bracket, user CPU falls 5.72% and 3.30%,
  peak RSS falls 0.42% and 3.29%, and OCTANT byte-transfer self time falls
  96.60% and 94.83%. Wall moves -0.39% and +2.10%, so no wall or latency win is
  claimed. All legs retain 73,125 application bytes, 20,809 deflated bytes,
  and exact final pixel hash
  `43e268d450634356e365b1adb92d5b19321f18bda2553c7a876eba7866fa51bb`;
  11 render files / 78 tests pass. Repeat benchmark SHA
  `72d0bd4f8b758267a353ec1665b48eae73c62cab4c327522edc0c48e80cbc197`;
  evidence lives in
  `track-7-performance/octant-srgb-lut-v206/FINDINGS.md`. This is selected
  exact source/CPU evidence, not deployment or Gate D: post-run I/O-full PSI
  was 20.41%/60s against the fixed 1% ceiling.
  V207 then measures the remaining alpha compositor rather than guessing:
  across 400 frames/lane it receives 2,343,200 calls, including 1,320,000
  implicit-opaque calls (56.33%) and 1,023,200 partial calls over 165 alpha
  values. The partial identity cache is already healthy at 87.26% hits. An
  exact internal opaque early return improves the alpha/transfer/GC group by
  19.52% and 10.18%, but is rejected because total user CPU is flat then 2.93%
  worse and RSS rises twice. V208 moves the same exact bypass to the three
  callers, eliminating the opaque call boundary; it too is rejected because
  user CPU rises 1.69% and 2.17% and wall rises 3.05% and 3.88%, despite a
  smaller target group. Original compositor and call sites are restored and
  all counters are removed. Evidence lives in
  `track-7-performance/alpha-implicit-opaque-v207/FINDINGS.md` and
  `track-7-performance/alpha-caller-bypass-v208/FINDINGS.md`. These are
  retained failures, not deployment or Gate D; the post-V208 I/O-full PSI was
  12.58%/60s.
  V209 tests an algebraically exact rolling 32-bit precipitation row hash,
  replacing the exhaustive scan's repeated x multiply while retaining the
  original sparse point predicate and every weather/color rule. It is also
  rejected: against the intervening original control, candidate user CPU
  rises 5.37% and 14.22%, wall rises 9.57% and 21.16%, and the targeted
  `applyPrecipitation` leaf itself rises 2.00% and 2.49%. All three legs retain
  exact final pixel hash
  `43e268d450634356e365b1adb92d5b19321f18bda2553c7a876eba7866fa51bb`
  and identical codec/payload distributions; the original expression is
  restored. Evidence lives in
  `track-7-performance/precipitation-row-hash-v209/FINDINGS.md`. This is a
  retained failed experiment, not deployment or Gate D. Post-run I/O-full PSI
  is 28.67%/60s, and `/mnt/donto-data` is 96% full with 41 GiB available, so
  further large benchmarks and V194 admission remain suspended until storage
  pressure and the fixed host contract recover.
  V210 is the next larger exact candidate and remains deliberately unselected.
  In the shared-static OCTANT production path it materializes atmosphere only
  into the already-recorded dynamic 2x4 cells instead of cloning all 56,320
  pixel references a second time. A production-shape census finds 492 dirty
  cells, bounding the candidate at 3,936 writes and avoiding 52,384 reference
  writes (93.011%). The new oracle proves exact packed codepoint, foreground,
  background, and both palette-index planes between full and deferred storm
  frames; all 11 render files / 78 tests and the render build pass. This is
  cardinality and semantic evidence only: V210 must remain an uncommitted,
  undeployed candidate until candidate/original/candidate production profiles
  pass under host admission. Evidence lives in
  `track-7-performance/dirty-atmosphere-materialization-v210/FINDINGS.md`.
  After the census/checks, I/O-full PSI is 60.39%/10s and 51.34%/60s,
  memory-full PSI is 9.98%/10s and 5.24%/60s, `/mnt/donto-data` remains 96%
  full, and `/` is 91% full. No latency or Gate D claim is admissible.
  V210's no-sacrifice boundary now also has exact cached/uncached output proof
  at zoom 80 (full-buffer quantization) and with a generated brightness grid;
  both unsafe-to-defer paths retain original materialization. A subsequent
  read-only live audit is explicit negative evidence: one active session used
  1,199.688 MiB worker RSS and 762.759 MiB heap, then two `/runtime` requests
  timed out at ten seconds and `/health` timed out at three seconds. Latest
  `smaps_rollup` reached 1,251,192 KiB RSS plus 237,808 KiB swap. The window
  simultaneously failed CPU, memory, I/O, and load admission, so it neither
  selects nor rejects V210; it proves current production-like memory and
  responsiveness are nowhere near the final gate. Exact evidence is retained
  in `track-7-performance/dirty-atmosphere-materialization-v210/live-runtime-audit.json`.
  Four stale read-only research scans launched by this execution were resolved
  by exact PID and terminated; I/O-full avg10 fell from 64.33% to 23.58%, but
  unrelated long-running work and the service remained far outside admission.
  No database, corpus job, service, or other agent process was interrupted.
  V211 closes the immediate observability gap exposed by that audit without
  claiming a fix. The on-demand worker `/runtime` response now reports every
  dynamically enumerated V8 heap space plus cumulative maximum RSS, minor and
  major page faults, filesystem operations, and voluntary/involuntary context
  switches. It starts no timer, forces no GC, names no expected spaces, and
  adds nothing to frame/input/simulation paths. Focused telemetry plus existing
  worker-manager IPC tests pass 7/7 and SSH-world typecheck passes; commit
  `8e341ff`, with evidence in
  `track-7-performance/worker-runtime-memory-telemetry-v211/FINDINGS.md`.
  This is selected measurement infrastructure, not performance acceptance,
  deployment, or Gate D. At its final source check, CPU-some PSI was
  25.29%/10s, memory-full PSI 1.10%/10s, I/O-full PSI 13.46%/10s, and
  load-per-CPU 3.411, so three host thresholds still failed.
  V212 then measures the packed-colour object graph before changing it. The
  canonical six-viewport prewarm contains 6,082,699 opaque samples but only
  253,746 unique RGB values (23.972x reuse). A hard-bounded 65,536-entry exact
  first-seen dictionary would record 4,042,309 hits in bundle traversal order,
  avoiding 66.456% of opaque RGB allocations; an isolated forced-GC sample
  prices the retained table at 4.755 MiB used heap. The source candidate
  interns only fully opaque values, leaving transparent `null` and
  partial-alpha weak-cache lifetimes unchanged; it quantizes nothing and uses
  exact 24-bit keys. The complete render suite passes 12 files / 81 tests and
  the render build passes. This remains an uncommitted, undeployed candidate,
  not a selected memory or latency win: CPU-some PSI was 32.65%/10s,
  memory-full PSI 5.34%/10s, I/O-full PSI 4.14%/10s, load-per-CPU 2.521, and
  swap-out 17,836 KiB/s. Evidence lives in
  `track-7-performance/opaque-packed-rgb-interner-v212/FINDINGS.md`.
  V213 refuses a smaller speculative representation branch before it can
  become maintenance debt. At the exact six-viewport imported-cache ceiling,
  decoded tiles retain 922,880 pixel references in 7,680 outer grids plus
  78,080 row arrays. A separate-process forced-GC comparison shows that one
  flat reference plane per tile would save only 3.448 MiB used heap and 0.172
  MiB RSS while requiring parallel exact-size terrain, authored-alpha overlay,
  and resampling paths. It is rejected before source implementation; the
  renderer remains on one path. Evidence lives in
  `track-7-performance/flat-packed-grid-layout-v213/FINDINGS.md`. At the census,
  CPU-some PSI was 15.80%/10s, memory-full PSI 1.21%/10s, I/O-full PSI
  19.55%/10s, and load-per-CPU 2.123, so no timing or Gate D claim is made.
  V214 obtains the strongest no-restart attribution available from the current
  live worker. Kernel rollup reports 1,268,832 KiB RSS, of which 1,249,524 KiB
  (98.478%) is anonymous and 1,249,560 KiB is private dirty; proportional
  file-backed memory is only 1,065 KiB, shared-memory PSS is zero, and another
  237,784 KiB is swapped. The dominant class is therefore private application
  allocation/V8 residency, not mapped runtime-pack files. It does not identify
  the owning heap space: another `/runtime` request returned zero bytes before
  ten seconds, so V211 deployment remains necessary. Evidence lives in
  `track-7-performance/live-worker-anonymous-memory-v214/FINDINGS.md`. The same
  sample had memory-full PSI 19.94%/10s, I/O-full PSI 51.11%/10s, and
  load-per-CPU 3.094; this is negative runtime truth, not V212 selection or
  Gate D.
  V215 re-audits the exact-login contract on current source rather than relying
  on the earlier milestone alone. One frozen `LOGIN_ORIGIN={x:0,y:0}` drives
  production worker SSH, legacy SSH, and agent admission. Fresh and returning
  sessions await the `player_state` reset before provider/game registration;
  no nearest-walkable relocation follows it. Only an explicitly restored
  already-running session preserves coordinates across hot reload. Four focused
  admission/restoration files pass 10/10 tests. Evidence lives in
  `track-5-motion-transport/login-origin-current-audit-v215/FINDINGS.md`. This
  is source/test proof, not a new deployed adversarial login or physical
  Ghostty acceptance; the post-test host still failed every sustained gate.
  V216 removes a circular observability failure without adding render-path
  work. The `/runtime` endpoint previously depended entirely on the overloaded
  worker servicing a normal five-second IPC request, so the live endpoint could
  return no bytes precisely when its memory evidence mattered. The selected
  source keeps that detailed V8/IPC/session sample when healthy, but bounds the
  endpoint probe at 250 ms and independently reads the worker's Linux procfs
  status. A missed IPC response now preserves PID/state, RSS split into
  anonymous/file/shared memory, swap, virtual size, threads, and context
  switches plus an explicit probe error. Thirty-two reads against the live
  worker under severe contention cost 1.115/7.274/8.726 ms p50/p95/max. Three
  focused files pass 9/9 tests and the SSH-world typecheck exits zero; the
  latter's roughly three-minute disk-waiting duration is retained as host
  pressure, not a performance result. Evidence lives in
  `track-7-performance/fail-soft-runtime-probe-v216/FINDINGS.md`. This is not
  deployed: a controlled restart, deliberate worker-stall response proof, and
  healthy detailed-sample parity remain open. At the evidence sample CPU-some
  PSI was 35.12%/10s, memory-full 5.58%/10s, I/O-full 10.52%/10s, and
  load-per-CPU 4.10, so no Gate-D claim is made.
  V217 then uses the required built-in ChatGPT/Codex image-generation path to
  select a materially stronger six-family meso-frontage vocabulary direction:
  canal workshop row, forest timber/charcoal workstead, coast boatwright/
  smokehouse, rural orchard hamlet, mountain assay/forge terrace, and occupied
  ruins cloister market. All six clusters define passages, courts, street or
  working edges, attached uses, and irregular vertical enclosure instead of
  isolated endpoint props. Exact prompt, original source, clean-alpha board,
  six projection-gap-owned crops, hashes, and direct rejection rationale live
  in `track-4-world-composition/meso-frontage-v217/FINDINGS.md`. The visual
  direction is selected but direct runtime use is rejected: the boards combine
  structure, local surface, water, vegetation, shadow, and implied collision,
  so pasting them would merely create larger terrain plates and physical
  contradictions. The next bounded pass must semantically decompose one family
  into structure/occlusion, continuous world-material masks, entrances,
  circulation, protected negative space, collision, constraints, function,
  visual group, and designed LOD; admit it only after the meso-parent set is
  frozen; and prove faithful ANSI gain with exact parent/program/circulation/
  collision parity before deriving the other five. This is source research,
  not an in-world visual improvement or Gate A.
  V218 selects the first structure-only successor source without promoting it.
  A built-in ChatGPT/Codex edit removes V217's boat, canal, quay slab, paving
  field, curb, water stairs, and broad ground ownership while retaining a
  three-mass workshop row, four occupied openings, the central arch, laundry
  bridge, roof hierarchy, planters, and facade work clutter. The clean
  1402x1122 alpha source has zero nontransparent border pixels and no surviving
  magenta-like key pixels; exact prompt, source/alpha hashes, visual review, and
  the independent-provenance ruling live in
  `track-4-world-composition/canal-structure-plane-v218/FINDINGS.md`. The edit
  is a newly authored source rather than a pixel-preserving mask. It still
  requires a deterministic manifest derivation with atomic row identity,
  arch-preserving collision and entrance semantics, threshold/frontage
  metadata, contact-shadow-only influence, designed semantic LODs, and a
  post-parent corridor role before one faithful experimental placement. No
  provider consumes it, no active pixel changes, and Gate A remains open.
  V219 adds the tracked deterministic derivation seam while keeping that
  boundary intact. A hash-pinned built-in-generation source and exact RGBA
  output now reproduce through one fail-closed script that verifies the source,
  installed chroma helper, derived bytes, 1402x1122 dimensions, visible and
  strong-alpha coverage, transparent outer border, and zero surviving magenta-
  like pixels. The fresh run reproduces output
  `72382592...d3f3ccee` with 0.426580 visible coverage, 0.423797 strong-alpha
  coverage, and zero border/key contamination. The script explicitly reports
  `runtimeManifest: false`; the asset is not present in the parcel manifest,
  runtime pack, placement policy, or active pixels. Exact code/source/output
  hashes and the non-promotion gate live in
  `track-4-world-composition/canal-meso-derivation-v219/FINDINGS.md`.
  V220 corrects that derivation for real runtime anchoring and compactness
  without relaxing fidelity. The selected deterministic output trims the
  transparent generation canvas, restores a two-pixel transparent resampling
  apron, applies alpha-preserving RGB gamma 1.32, strips incidental metadata,
  and fail-closes on exact source/helper/output hashes and alpha properties.
  The resulting 1284x899 candidate has 0.581322 visible coverage, 0.577530
  strong-alpha coverage, zero occupied border pixels, and zero surviving key
  colour. Walking and district comparisons select the grade because it
  preserves shadowed shop, roof, wall, laundry, and arch divisions; both raw
  and graded naive regional reductions are rejected as dense rectangular
  blobs. Exact previews, luma distributions, hashes, and decision live in
  `track-4-world-composition/canal-runtime-derivation-v220/FINDINGS.md`. The
  script continues to report `runtimeManifest: false`, so this is not an active
  visual change or a performance claim.
  V221 then selects the research-only semantic representation while withholding
  placement. A typed descriptor declares one atomic 20x14 canal corridor
  frontage, row-wide visual identity, frontage axis/side/station, bounded
  authored collision, and five explicit collision-free offsets through the
  central arch. The production parser accepts this separately loaded candidate
  through the same path/cache/sprite reconstruction boundary, rejects missing
  semantics or collision/circulation overlap, and permits larger place-detail
  bounds only for this explicit role. Every current ordinary, alternative,
  diagnostic, common, and entourage selector excludes place details, and the
  production parcel manifest remains unchanged. Two focused files pass four
  selected tests, including 20x14 reconstruction, arch semantics, deliberate
  overlap rejection, manifest absence, and selector non-leakage; world build
  and SSH-world typecheck pass. Evidence lives in
  `track-4-world-composition/canal-corridor-semantics-v221/FINDINGS.md`. No
  provider consumes the candidate, no runtime pack contains it, and no active
  pixel changes. The next bounded visual proof is an opt-in post-parent
  corridor placement with exact parent/program/route/collision identity parity,
  connected arch circulation, and faithful ANSI walking/district comparison;
  it must also measure incremental preparation, memory, frame, and transport
  cost without weakening pixels, world coverage, or simulation. A designed
  regional LOD remains mandatory before regional admission.
  V222 selects an exact asset-residency improvement discovered at that new
  scale. Regional sprite reconstruction previously allocated a full zero-filled
  48x48 RGBA plane before learning that a logical sprite tile was completely
  transparent. Allocation now begins only at the first retained alpha sample;
  a wholly transparent tile uses the existing empty-pixels/no-packed-plane
  representation. The V220 20x14 candidate keeps all 207 visible or partial-
  alpha planes byte-for-byte while omitting 73 provably empty planes: packed
  storage falls from 2,580,480 to 1,907,712 bytes, an exact 672,768-byte
  (26.07%) reduction. All ten regional biome-loader tests and all three meso
  candidate tests pass, every allocated plane is proved non-empty, and the
  SSH-world typecheck passes. Evidence lives in
  `track-7-performance/sparse-transparent-sprite-v222/FINDINGS.md`. This is a
  source-selected immutable-asset reduction, not deployed whole-process RSS,
  latency, or Gate-D proof; it changes no manifest, placement, collision,
  sampling, pixel, or active-frame contract.
  V223 selects the isolated post-parent admission seam while withholding visual
  acceptance. A new profile defaults to `disabled`; its opt-in
  `corridor-frontage` pass runs only after the complete meso program and
  connector set is frozen. It reuses route-relative anchoring, requires a
  connected authored circulation path, permits visible path overlap only at
  that opening, rejects every parent structural conflict, all ambient-path
  collision, all protected and unprotected route-parcel connector collision,
  water, terrain, and distant entrances, and lets the optional detail yield
  without feeding any result back into parent admission. The first focused run
  retained and corrected a cache-edge failure by resolving complete connector
  programs in world coordinates before blocks consume slices. Control and
  candidate now preserve identical parent programs and connector exports;
  32- and 47-tile cache blocks produce identical details; the opening lands on
  the path; collision remains outside every connector; and disabled emits
  nothing. Place-detail bounds affect general placement reach only while
  enabled and never inflate route-parcel reach. The full provider file passes
  42/42 tests, the real descriptor passes 4/4 fail-closed loader tests, world
  typecheck/build and SSH-world typecheck pass, and the faithful regional lab
  has an explicit descriptor/profile input with default-off metrics. Evidence
  lives in `track-4-world-composition/canal-post-parent-admission-v223/FINDINGS.md`.
  This changes no production manifest or active pixel. A real V220 faithful
  walking/district control-candidate render, exact incremental preparation/
  residency/frame/byte measurement, designed regional LOD, and physical SSH
  proof remain mandatory under an admitted host.
  V224-V229 then execute the missing real-world census and reject V220 for the
  post-parent role. The origin and radius-64 full-provider runs admit no V220
  placement; a radius-128 production-composition prefilter finds an eligible
  canal program at `(157,-180)` but neither side fits. The preserved V1 side
  fails on collision-water, the V2 side fails on anchor-water, and a temporary
  84-position lateral expansion still yields only water, frozen-parent, anchor,
  and route-clearance rejections. The expansion is removed and no exclusion is
  weakened. Exact parent/program/connector parity remains true where the full
  control proof runs, but zero candidate placements means no honest faithful
  visual or performance A/B exists. The monolith remains source/reference art,
  not a selected runtime candidate. Consolidated evidence lives in
  `track-4-world-composition/canal-place-detail-prefilter-v229-v1-expanded-site-157--180/FINDINGS.md`.
  V230-V236 select the next modular source direction without pretending it is
  in-world progress. Built-in ChatGPT/Codex image generation (no metered API)
  produces one shared-palette atlas containing separate shops, inhabited open
  arch, and workshop/inn modules with no baked road, terrain, quay, or water.
  A hash-pinned derivation reproduces three clean-alpha assets and the
  production parser loads their independent collision/circulation semantics
  from a research-only multi-asset descriptor. Correcting the provisional 8x9
  logical scale to 6x7 preserves the original generated sources and 48px
  source-tile pipeline while reducing retained packed sprite planes from
  1,732,608 to 1,050,624 bytes, an exact 681,984-byte (39.36%) reduction. The
  disabled diagnostic path now creates no audit object, per-candidate/path
  evidence is available only when requested, and wide-census records filter
  irrelevant no-semantic entries. Real diagnostics also replace arbitrary
  wider nudges with a bounded nine-station fallback derived from the already
  authoritative connector: route-start anchors retain priority, and the path
  stations are constructed lazily only after every route-start attempt fails,
  so the common acceptance path pays no fallback sampling or anchor-allocation
  cost. Every water, route, parent, circulation, collision, reservation,
  visibility, entrance, and connector rejection remains. A full-fitter test forces all
  route-start positions to lose to frozen structure and proves a safe
  connector-cell acceptance. The real `(157,-180)` place still correctly
  rejects every compact module because it is genuinely full; the radius-128
  prefilter also finds no placement. The clean walking board selects the art;
  its naive regional reduction is rejected as icon-like. Exact provenance,
  hashes, memory arithmetic, tests, and V231-V236 failure distributions live
  in `track-4-world-composition/canal-modular-frontages-v230/FINDINGS.md`.
  V237's radius-256 pass is explicitly incomplete: it was interrupted while
  healthy but opaque and produced no metrics, so it is not evidence. The lab
  now emits opt-in JSON progress every eight blocks. The kit remains absent
  from the production manifest with zero real-world placement, no faithful
  ANSI gain, no designed regional LOD, no admitted-host A/B, and no deployment.
  V238-V240 replace that opaque research unit with an exact resumable census.
  Each bounded window records the complete centre-out block-order hash,
  absolute position, next offset, exhaustion state, and stop reason. Two
  windows at the known nine-block site concatenate to the old monolithic block
  sequence exactly, share order hash `ada7e6bf...ad5`, contain nine unique
  blocks, and reproduce the same empty-detail hash. Five low-priority
  radius-256 windows then cover 64 unique blocks under order hash
  `32735a84...76d3`, discovering new eligible canal programs at `(231,-62)` and
  `(-38,206)` but admitting no module. Frozen parent structure dominates both
  rejection sets and no exclusion is weakened. This is explicitly not an
  exhaustive radius result: current-source offsets 16-59, 76-79, and 112-255
  remain open. A retained 5x6 reconstruction reduces packed planes another
  294,912 bytes (28.07%) but is rejected after authoritative source-block
  probes still admit nothing and add protected/path conflicts; the visually
  safer 6x7 kit remains selected. Exact segmentation proof, raw ranges, failure
  distributions, and host truth live in
  `track-4-world-composition/canal-modular-frontages-v238-v240-resumable-census/FINDINGS.md`.
  The final sample still fails memory, I/O, load, and disk admission, so none of
  these geometry runs supplies a runtime performance result.
  V241 then removes irrelevant work from that resumable search without
  approximating parent admission. A private opt-in output profile preserves
  complete parent programs, priority/collision resolution, access paths,
  connectors, structural reservations, and the post-parent fitter, while
  omitting ordinary ambient-ensemble probes and parent output materialization.
  Default production output remains unchanged and the lab fails closed unless
  the profile is used by the discovery-only production-composition prefilter.
  At the production block/grid shape it avoids exactly 100 ordinary ensemble
  probes per block, or 25,600 across a 256-block scan. A focused test proves
  identical details, parent signatures, and connectors through a real accepted
  synthetic block while the candidate performs zero ordinary probes. A real
  offset-63 control/candidate pair has identical combined semantic SHA
  `1fb2e45d...bf09` and rejection SHA `7aaaad1a...dd60`, while the candidate
  omits four irrelevant returned placements. This is selected source
  cardinality and parity evidence only: memory, I/O, and load still fail host
  admission, so elapsed values do not count. Evidence lives in
  `track-7-performance/place-detail-census-detail-only-v241/FINDINGS.md`.
  Next, finish or reject the V194 packed-overlap candidate under an admissible
  host window, admit or reject V210 and V212 under exact whole-process A/B/A,
  repeat the V196/V197/V199/V201/V202/V205/V206 stack under the same admission
  contract, then remove larger exact composition traversals, share prepared
  overlay planes, operate on dirty regions, or move
  emission off the input-critical path with the semantic oracle, alternating
  same-workload profiles, exact decoded-frame parity, and real SSH proof. In
  parallel, treat any further shoreline recovery as a full
  parent-threshold-approach-spine bank-following topology problem rather than a
  smaller plaza, without relaxing dry-core, threshold, slope, collision,
  civic, or ownership gates;
- rejected wallpaper, dense-grid, over-sparse, solver-staircase, and regional
  root-ring experiments remain in the mounted research record; public gallery
  iterations 012–035 expose selected and rejected research candidates without
  claiming they are live.

Still open and therefore goal-blocking:

- the regional stack is now the live authoritative provider with exact-origin
  readiness, real SSH latency, movement/camera/zoom transport, and one bounded
  six-second production capture. The selected source build now completes a
  loopback real-SSH 5/10/20-presence ladder and corrects the first-cohort cold
  admission failure in scratch, but 20 presences miss the fixed 100 ms p95
  response target and expose multi-second worker/render tails. Worker reuse and
  scheduling, the 30-minute mixed movement/zoom/weather run, separated
  mode/keyframe bandwidth audit, deployed cgroup observation, larger physical
  Ghostty viewport, and operator use remain unproven. V162 reduces the ordinary
  clear-day atmosphere traversal and instruments both IPC directions, but its
  short host-confounded SSH probes do not replace the reset sustained ladder.
  V163 makes night/light/rain/storm static planes reusable. V164's corrected
  post-warmup profile supersedes the earlier regional-sampling inference,
  selects exact weather-cell OCTANT deltas, and leaves packed terminal emission
  as the dominant bounded local target; neither milestone has normal-host
  sustained/deployed SSH evidence;
- the first six-family landmark silhouettes and shared-boundary parcel
  compounds now include a selected two-sided canal-town focal core, but remain
  sparse research prototypes rather than a complete world layer. The core now
  has selected entrance-level constructed grounding plus water-owned semantic
  quay material, paired walkable arrival quays, the first two bank-authored low
  frontages, modest deterministic landside-edge variation, a semantic
  water/quay activity vocabulary, two persistent-time moving boats, and three
  access-proven secondary frontages distributed across both civic side canals,
  but
  still lacks bank-aware crossing silhouettes, moving inhabitants, temporal
  work/market states, larger squares/commons, dense
  route-connected frontage beyond this bounded origin tranche, and
  complete forest, coast, rural, mountain, and ruins vocabularies. V158's
  route-frontage meso place field supplies the first non-origin multi-mass
  layer with proved circulation; V161's selected experimental successor adds
  the first two-parent shared commons and bounded frontage wings, with strong
  local forest/ruins evidence but no production enablement. V167 selects only a
  canal/coast material successor and explicitly rejects its attempted
  continuous-frontage composition; texture improvement is not a substitute for
  occupied topology. V159's full fixed
  atlas and V161's still-sparse coast/rural/transition frames prove that a few
  connected public compounds are not a substitute for continuous frontage,
  crossings, activity, or settlement fabric.
  Coast-specific waterfront diversity, far
  greater travel-scale entropy across route topology, hydrology, biome fields,
  ambient clusters, landmarks, and parcel programs, authoritative traversal,
  stronger landmark framing, multiple cave/highland programs and production
  cave transitions, tidal/open-water/boat/island interactions, and richer
  terrain-scale physical consequences remain before the family layer is
  production-complete;
- the complete Phase-0 diagnostic comparison and operator direction approval
  have not passed;
- the deterministic schedule/need/role/relationship/memory core plus the first
  persistent wetness, water-state, phenology/decay, and authored-light
  consequences now have restart-exact accelerated evidence and their additive
  state schema is live. Gate C has not passed: uninterrupted physical 60-minute
  observation with two real human clients, reconnect and newcomer
  checks, natural conversations and plans, richer event coordination,
  player-caused persisted world change, coherent fronts, long-horizon geometric
  growth/decay, and production multi-human integration remain open;
- the fresh V159 24-coordinate multi-zoom/time/weather atlas is complete as an
  honest **failed** visual audit on V158 source. Gate A remains open until the
  remaining multi-parent generalization, route/crossing/frontage, overview-LOD,
  and dynamically enumerated material-boundary failures are corrected and the
  exact fixed atlas passes on a fresh build. V161 closes only the first bounded
  forest/ruins public-common case, and V167 closes only a bounded canal/coast
  material-quality case; neither has earned production enablement or an atlas
  rerun. V160 corrects process-local cold
  session admission in scratch, but is not deployed and exposes a separate
  20-presence worker-latency failure. The selected
  night/storm and water/route/quay corrections have now been tested by the
  fresh complete atlas and proven insufficient; neither is a substitute for
  the next post-correction full proof. The selected
  V39's bounded landing/span-aware bridge is only a selected sub-gate and
  remains visually short of acceptance until approach wear, longer-span and
  topology-specific support vocabularies, crossing-family diversity, and the
  surrounding coast-composition failures close, followed by the fresh full
  atlas. V130 adds adversarial returning-login reset proof and both-bank
  secondary side-canal frontage to V113's restart-exact moving boats and
  V106's fish work/market silhouettes, mooring, and water vegetation on top of
  V97's modest physical
  quay-edge variation and
  V89's paired civic canals and lighter central causeway, building on V66's
  bridge shaping, quay articulation, canal depth/current, and two static
  civic-life modules, but is likewise only a selected sub-gate.
  Crossing and support diversity, richer bank contact, larger commons,
  denser frontage beyond the origin, moving people, working stalls
  and unloading,
  less empty paving, and equivalent complete grammar beyond the bounded
  canal-town origin and the two-axis forest/coast/rural/mountain waystation
  and ruins-site tranches
  remain required before a fresh full-atlas recapture can attempt Gate A.
  Fresh post-correction deterministic traversal, the 30-minute terminal run,
  deployed-service/cgroup audit, and physical Ghostty acceptance also remain
  open.

This ledger records real progress and the remaining distance. It does not
relax, subdivide, or supersede any proof gate above.

## Completion sentence

This goal is complete only when it is truthful to say:

> “Maldoror is an infinite, visually extraordinary, multi-biome living world—
> not a repeated demo block—and the public production SSH experience, raw
> evidence, sustained simulation, extreme no-sacrifice performance envelope,
> exact login origin, and human Ghostty acceptance all prove it.”

Until then: there is a long way to go.
