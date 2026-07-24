# MALDOROR — next active goal

*Set 2026-07-23 after rejecting the one-block engineering milestone as nowhere
near the actual product bar. This file is the governing, proof-gated definition
of done. `DOSSIER.md` remains the vision; `docs/BUILD-BRIEF.md` remains the
implementation map.*

## Objective

Transform Maldoror from a repeating canal-town rendering prototype into an
**infinite, painterly, freely zoomable, genuinely living shared world that feels
impossible to be running as pure ANSI over SSH**. A player must be able to enter
at the world's origin, travel for hours through coherent but surprising places,
meet inhabitants with continuing lives, encounter other people, watch the world
change, and never see the machinery collapse into obvious tiles, repetition,
empty filler, or transport jank.

The target is no longer “one block works.” The target is **a world worth
inhabiting**.

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

### Gate D — terminal feel and performance

On the production box and real SSH path, prove at 160×46 and one larger physical
Ghostty viewport:

- input-to-visible-response p95 below 100 ms under normal box load;
- no retained-frame corruption, tearing, or dependency break during a
  30-minute movement/zoom/weather run;
- render cadence maintains its chosen interactive budget without long-tail
  stalls; report p50/p95/p99 rather than averages alone;
- steady idle, continuous walking, zoom, and weather bandwidth are separately
  measured and bounded; keyframes are identified rather than hidden in means;
- memory and caches remain bounded inside the 1.6 GiB service envelope;
- a 5-, 10-, and 20-presence load ladder reports CPU, RSS, event-loop delay,
  frame latency, bytes/client, dropped deltas, and recovery keyframes.

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
8. performance/load reports with raw measurements;
9. production deployment commit and rollback procedure;
10. explicit physical-Ghostty operator acceptance.

## Execution ledger — 2026-07-24 (not completion)

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
- rejected wallpaper, dense-grid, over-sparse, solver-staircase, and regional
  root-ring experiments remain in the mounted research record; public gallery
  iterations 012–031 expose selected and rejected research candidates without
  claiming they are live.

Still open and therefore goal-blocking:

- the regional stack is now the live authoritative provider with exact-origin
  readiness, real SSH latency, movement/camera/zoom transport, and one bounded
  six-second production capture. The 5/10/20-presence ladder, 30-minute run,
  long-run cgroup behavior, and physical Ghostty remain unproven;
- the first six-family landmark silhouettes and shared-boundary parcel
  compounds now include a selected two-sided canal-town focal core, but remain
  sparse research prototypes rather than a complete world layer. The core still
  lacks continuous paving/canal/quay ground contact and thins immediately at
  district scale; the other five families lack equivalent connected focal
  vocabularies. Coast-specific waterfront diversity, larger squares/commons, far
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
- the 24-coordinate multi-zoom/time/weather atlas is now complete as an honest
  **failed** visual audit. Gate A remains open until the recorded composition,
  route/crossing, and dynamically enumerated material-boundary failures are
  corrected and the exact fixed atlas passes on a fresh build. The selected
  night/storm correction still requires that fresh complete-atlas proof; it is
  not a substitute for it.
  Deterministic traversal, the load ladder, 30-minute terminal run, and physical
  Ghostty acceptance also remain open.

This ledger records real progress and the remaining distance. It does not
relax, subdivide, or supersede any proof gate above.

## Completion sentence

This goal is complete only when it is truthful to say:

> “Maldoror is an infinite, visually extraordinary, multi-biome living world—
> not a repeated demo block—and the public production SSH experience, raw
> evidence, sustained simulation, performance envelope, exact login origin, and
> human Ghostty acceptance all prove it.”

Until then: there is a long way to go.
