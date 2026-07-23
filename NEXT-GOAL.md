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

## Execution ledger — 2026-07-23 (not completion)

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
- rejected wallpaper, dense-grid, over-sparse, solver-staircase, and regional
  root-ring experiments remain in the mounted research record; public gallery
  iterations 012–014 expose the selected research candidates without claiming
  they are live.

Still open and therefore goal-blocking:

- the regional field/compositor/routes are not the live provider; the 25.1x
  cold-path improvement is not permission to block input for 2.02 seconds, and
  predictive background prewarming plus p50/p95/p99 traversal evidence remain
  unbuilt;
- six-family silhouettes, architecture, landmarks, routeside contacts, parcel
  composition, authoritative traversal, and cave/highland/coast interactions
  are not production-complete;
- the complete Phase-0 diagnostic comparison and operator direction approval
  have not passed;
- schedules, needs, relationships, memories, environmental systems, persistent
  consequences, multi-human encounters, and the 60-minute living-world proof
  have not passed;
- the 24-coordinate multi-zoom/time/weather atlas, deterministic traversal,
  load ladder, 30-minute terminal run, production deployment, and physical
  Ghostty acceptance all remain open.

This ledger records real progress and the remaining distance. It does not
relax, subdivide, or supersede any proof gate above.

## Completion sentence

This goal is complete only when it is truthful to say:

> “Maldoror is an infinite, visually extraordinary, multi-biome living world—
> not a repeated demo block—and the public production SSH experience, raw
> evidence, sustained simulation, performance envelope, exact login origin, and
> human Ghostty acceptance all prove it.”

Until then: there is a long way to go.
