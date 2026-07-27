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
> evidence, sustained simulation, performance envelope, exact login origin, and
> human Ghostty acceptance all prove it.”

Until then: there is a long way to go.
