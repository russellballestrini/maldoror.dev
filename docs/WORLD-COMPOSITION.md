# Hierarchical world composition

The canal town no longer stamps a visual block every 24 tiles. `blockSize` is
retained only as a bounded cache unit for procedural overlays.

## Shared semantic field

`CanalTownWorldField` is the source of truth for large-scale water, crossings,
the exact origin plaza, bank routes, cross-town routes, and garden regions. It
combines sparse independently warped major rivers, deterministic tributaries at
basin scale, and low-frequency land-use fields. Every answer is a pure function
of the world seed and signed coordinates.

The field returns signed water distance, route distance, and semantic flags.
The terrain compositor, bridge selection, parcel constraints, visual placement,
and collision all consume those same values. This prevents a visible bridge or
building from disagreeing with a repeated collision grammar.

The origin is a singular authored landmark inside the hierarchy. The procedural
river forks continuously into twin canals around a dry north/south island and
merges back into the world field beyond the arrival frame. `(0,0)` lies at its
walkable east/west causeway; an upper stone bridge, four canal basins,
constructed banks, facade walls, lamps, planting, docks, and water detail frame
the crossing. Deliberate street portals keep the causeway open through both
facade walls. This exception does not introduce a repeating district stamp.

The causeway is composed as three connected rooms rather than one empty strip.
A produce-stall threshold and a fountain/seating threshold occupy its outer
thirds; the exact spawn court and a three-tile-wide crossing remain clear. The
room helper uses semantic street roles for its supporting furniture, while the
two different primary landmarks prevent a mirrored asset stamp. Plaza
placement is an explicit authored policy and cannot leak into ambient parcel
generation.

## Regional geography

`BiomeWorldField` is the production port of the V6 regional experiment. It
does not assign one hard biome. Elevation, slope, coast/river distance,
temperature, and moisture produce continuous coast/forest/rural/mountain
weights; canal-town and ruins are cultural opportunity overlays on that
ecology. A singular smooth arrival constraint makes `(0,0)` an exact canal-town
anchor without stamping a finite region map.

The field uses OpenSimplex2S descriptors plus a deterministic basin feature
graph. Each bounded LRU block is generated with a 12-cell halo before the
widest two-pass radius-5 filter. Tests prove identical samples across different
cache block sizes, including signed-coordinate boundaries. Internal caching
therefore cannot become visible geography.

`RegionalMaterialCompositor` consumes the continuous weights directly. It
mixes the strongest two ecological materials in linear light, then applies
town/ruin opportunity as cultural overlays. One source texture spans seven
world tiles and coarse variant phases cross-fade in world space; mapping a
whole master to each tile was retained as a rejected wallpaper experiment.
The output carries a per-pixel water ownership mask and uses a bounded tile
cache.

The authoritative worker source now selects the regional compositor by
default. One worker-owned kit shares immutable raster assets and bounded
physical, route, and material caches; each SSH session owns isolated players,
NPCs, user structures, roads, and prepared-view LRU state. The former canal
provider is an explicit environment-controlled rollback lane, never a silent
startup fallback. This topology is live in production from `v14d6b58`; its
deployment is evidence, not visual-direction or end-state acceptance.

## Regional route hierarchy

`RegionalRouteField` is the production port of the V4 route-topology lab. A
cardinal-neighbour priority thinning pass turns a jittered candidate lattice
into a sparse, irregular site process. The surviving sites form a Gabriel
proximity graph; each edge is then solved on the biome field with an
eight-neighbour least-cost search whose cost rises with terrain slope,
directional elevation change, and water exposure. Two curve-subdivision passes
hide the solver grid without changing the graph endpoints.

The route field has arterial, local-road, and trail tiers. It exposes route
distance, stable edge identity, nearby landmark semantics, and distinct ford,
bridge, and ferry crossings. A ferry is explicitly non-walkable, so a long
water connection cannot silently become a huge bridge or a collision path.
`(0,0)` is the singular arrival landmark and lies exactly on an arterial. The
arrival is treated as a place rather than a traffic hub: after the stable graph
exists, the most nearly collinear pair of incident edges becomes one continuous
through arterial and any remaining arrival spoke stays local. This keeps global
movement legible without turning every frontage into a full-width arterial.
Every new SSH login, including a returning account with persisted state, resets
and persists this exact origin. A connected session restored across a worker
hot reload is deliberately not a new login and keeps its position. A live
same-key reconnect proof moved to `(12,0)`, disconnected, and observed `(0,0)`
on the next login; raw streams and faithful replays are retained under
`track-6-acceptance-atlas/login-origin-reconnect-v1/`.

Pathfinding uses `BiomeWorldField.samplePhysical`, a cheap descriptor lane that
shares the full field's exact elevation and hydrology functions but bypasses
six-family filtering. That reduced the measured first origin block from about
2.2 seconds in the rejected V1 implementation to about 270 ms on the retained
V4 implementation; a neighbouring cold block measured 28 ms and cache hits
measured 0.01–0.03 ms. The remaining cold-path tail still requires predictive
background prewarming before this layer can enter the live input path.

All route geometry is a pure function of world seed and coordinate. Derived
site, path, and route-block caches are independently bounded, and tests prove
sample equality across cache block sizes and traversal order.

Route surfaces are a separate authored semantic manifest: worn stone for
arterials, packed earth for local roads, forest floor for trails, and timber
for bridges. The manifest owns world-space texture scale plus separate detail/
overview opacity **and width** for every class. Width and opacity are distinct
controls: fading an over-wide map road only creates a muddy over-wide road.
The route sample carries its authoritative half-width even through the
one-tile influence apron, so the compositor can interpolate a cross-section
instead of reconstructing shape from a binary mask.
`RegionalMaterialCompositor` masks those materials over the same route answers;
bridge coverage clears water ownership and is walkable, while a ferry retains
water ownership and remains non-walkable. Bridge texture axes use the route
tangent instead of a fixed screen direction. Route distance remains the exact
endpoint-capped Euclidean distance to the winning curve segment; a separate
signed value records which side of the local tangent owns the sample. The
rejected infinite-line V28 implementation leaked ownership beyond endpoints
and created false parcels, so sign must never replace authoritative distance.

A bridge narrows its visible deck from normalized centreline distance and uses
that identical shaped coverage for the material mask. Continuous hydrology
selects stone bank seats; the signed cross-section and route-aligned frame add
timber rails, asymmetric relief, shadow, and sparse support cadence. These cues
survive all three semantic zooms, but the selected V32 result is still a basis:
terrain-shaped approaches, span-aware piers, crossing-family diversity, and a
non-bar silhouette remain open.

Hydrology owns visible wet pixels before any cultural-family overlay. A strong
canal-town or ruins weight can influence dry constructed ground, but cannot
paint physical water beige while collision still reports water. In a strong
canal-town field, the dry-side water boundary may receive a semantic quay band:
near LOD samples the scale-authored landmark limestone sparingly, while district
and regional LOD use broader lower-contrast town material. The failed bright
map-scale outline remains retained as V22; V23 is the selected material-LOD
basis, not a complete quay circulation or waterfront-program claim.

The compositor now authors only the semantic resolution requested by a
resolution-aware viewport. Requests are quantized into stable zoom bands, and
linear-light mip pyramids follow the material footprint. Shrinking the detail
texture directly exposed generated root loops as repeated regional “donuts”;
retaining that failed faithful frame led to semantic material LOD rather than
another seam metric. The faithful minimum-live-zoom candidate removes the root
period and measures a tile-boundary/interior-change ratio of 0.999. Demand-
driven composition reduced the retained 80 x 44-world-tile cold lab from 50.79
seconds to 2.02 seconds. It remains research-only because background prewarming,
interactive tail evidence, and complete family composition are not complete.

## Regional landmark composition

`RegionalWorldTileProvider` is the production seam that combines the regional
material compositor with sparse vertical silhouettes. It does not scatter
assets independently. `RegionalRouteField.getLandmarkSites()` exposes the
coordinate-stable global composition goals; route semantic compatibility plus
continuous family weights choose an asset, and terrain/water/route-clearance
constraints choose its final anchor. The provider uses the same resolved
placement for overlay and collision, inspects neighbouring cache blocks, and
keeps the route threshold open.

The V2 semantic landmark manifest contains one deliberately sparse prototype
for each of canal-town, forest, coast, rural, mountain, and ruins. Each source,
prompt/edit, hash, derivation command, tile bounds, compatible site kinds, and
collision offsets is explicit. Asset colour or filename is never inspected to
invent gameplay meaning.

Authored overlay alpha survives loading and coverage-aware resampling. The
viewport composites partial coverage in linear light over the continuous
terrain, which removes the hard keyed contour without a fake binary contact
shadow. The six-family faithful atlas is retained under the mounted Track-4
research tree. It is a candidate milestone only: ambient silhouettes,
route-contact layers, parcels, family-scale interactions, and interactive
prewarming remain open before this provider can replace the live canal world.

The V2 ambient manifest adds two medium-scale clustered silhouettes per family.
These are not independent prop scatter. One jittered candidate lives in each
world-space cell; a radius-two diamond priority maximum creates the retained
low-density process across cache boundaries. Continuous family weights select
the semantic family, a coordinate-stable low-discrepancy phase selects among
that family's manifest variants, and explicit route bands, landmark clearance,
water, and collision constraints decide whether the candidate survives. This
keeps negative space and prevents adjacent repeated masses without maintaining
a name-based variant table.

Provider block lookup is derived from actual sprite/collision extents and the
bounded landmark anchor search. Most overlay queries therefore build one source
block rather than a fixed 3 x 3 neighbourhood; sprites that really cross a
boundary still query every possible owner block. Fully transparent sprite
tiles are memoized and never enter overlay maps. Faithful evidence accepts the
first six-family mass hierarchy but not live readiness: directional route
contacts, parcel grammar, greater travel-scale entropy, predictive prewarming,
and traversal tail measurements remain open.

The first route-facing parcel seam is now explicit. Two separately authored
contact axes exist for every family; a central sprite anchor lets their
collision masses straddle an open connector instead of inheriting the old
bottom-centre building assumption. A coarse jittered cell supplies a parcel
identity, but its visual anchor is projected back to the exact nearest route
tile and placed three tiles along the quantized route normal. The manifest axis
is selected from the route tangent, and collision deliberately omits the
connector centre.

An early implementation failed faithful review because it oriented the art but
left the jittered anchor floating beside the road. A second exposed adjacent
duplicate thresholds. The retained process snaps to the shared route contact
and applies coordinate-stable priority only along the resolved tangent; cells
on unrelated off-route terrain cannot suppress a valid frontage. Off-route
samples do not themselves own route tangents, so the provider performs a
bounded nearest-route lookup only after the candidate has passed a route-
distance band. Exact placement/null decisions are cached in a bounded LRU and
shared by proof, raster, collision, and future population queries.

This is still a research seam rather than complete parcel generation. The
painted connector in some V1 sprites does not always match the procedural route
surface, contacts are cardinal rather than diagonal, and no deep lot, building
group, service yard, garden program, or ownership/schedule layer grows behind
the threshold yet. Those are explicit next constraints, not reasons to hide the
faithful failures or deploy the regional provider early.

## Focal entrances and constructed ground

Large focal sprites own their visible building mass and already-painted edge
sidewalks. Constructed ground is a separate continuous layer, but it no longer
derives a full frontage from sprite bounds. Each focal manifest entry declares
its frontage axis, route side, and one or more normalized entrance stations.
The provider resolves the placed visible bounds, then builds only a small
threshold and narrow rounded approach at those stations. The route surface
keeps ownership of the arterial core; physical water keeps its material mask.

This replaces a retained V12-V19 rejection ladder: duplicated facade bands and
cross-axis courts read as an H or ladder even after their texture became
correct. The selected V20 topology lets the authored sprite paving remain
dominant, uses terrain as negative space, and places scale-authored limestone
only where pedestrian access explains it. Geometry, material family,
walkability, and station semantics are manifest/world owned; filenames and
source pixels are never interpreted at runtime.

The V20 six-capture real-SSH proof covers three semantic zooms and two
viewports at exact `(0,0)`. It is a selected research architecture, not a claim
that the surrounding canal-town district or the other five families are
composition-complete.

The V26 real-SSH audit adds the exact origin, adjacent west waterfront, and one
coast crossing at all three semantic zooms. It selects physical-water ownership,
the place-led arrival hierarchy, manifest-owned route scale/opacity, and
semantic quay LOD. It rejects the current bridge as visually complete despite
its narrower and collision-consistent deck. The audit is a nine-frame research
subset, not the complete fixed Gate-A atlas and not a production deployment.

## Predictive regional cache transport

Cold regional composition remains intentionally expensive: it solves physical
biomes and routes, composes semantic material LOD, and resolves every sparse
vertical layer. It is now prohibited from the input path by an explicit worker
boundary. A persistent worker owns an identical seed/manifests/configuration
stack and prepares velocity-projected rectangles. A coverage-aware scheduler
permits one request in flight, coalesces ordinary motion inside the current
corridor, and retains only the newest uncovered pending prediction.

The first structured-clone implementation is rejected. Although its imported
frames were exact and fast, deserializing RGB object graphs stalled the main
event loop for 1.237 seconds. The selected V2 package transfers six typed
planes: terrain RGBA/material/walkability, sparse overlay coordinates/RGBA, and
collision. Packages are seed-, version-, bounds-, resolution-, and
length-validated into a per-session six-rectangle LRU. The persistent generator
deduplicates equal in-flight requests and keeps a second LRU bounded by both
eight entries and 192 MiB. The renderer lazily memoizes only packed tiles that
become visible, keeping arrival work bounded. During a short animated zoom, the
nearest prepared semantic LOD remains authoritative until the exact target LOD
arrives; there is no synchronous intermediate-resolution escape hatch.

The retained 180-frame, 15 Hz, 160x46 lab has zero coverage misses and exact
checkpoint hashes. Render p50/p95/p99 is 4.09/8.32/27.74 ms; event-loop delay is
1.09/1.22/5.21 ms with a 34.47 ms maximum; import p95 is 4.84 ms; peak RSS is
633.61 MiB. A separate 32-coordinate cold stress fixture records demand p99 at
1.635 seconds versus worker-primed render p99 at 42.28 ms. Raw measurements and
the rejected design live in mounted Track 5 `FINDINGS.md`.

The retained production-topology readiness run constructs one shared kit, one
persistent generator, and two isolated session providers. The exact origin is
ready in 9.147 seconds, an identical repeat is served in 0.085 ms, both sessions
produce the same origin hash, and destroying one session preserves shared
caches. Thirteen movement frames have zero coverage misses and render at
5.261/13.868/13.868 ms p50/p95/p99; the generator retains 2.78 MiB and measured
peak RSS is 776.02 MiB. The authoritative session now observes player motion,
free-camera motion, resize, rotation, render-mode changes, and zoom; input opens
only after exact visible coverage exists.

The production 160x46 SSH capture then exposed a presentation-cadence failure:
the exact one-minute-per-second simulation clock triggered seven full global
truecolour repaints and 1,327,492 steady bytes over six seconds. The selected
terminal projector now holds 48 coherent global atmosphere states per world day
while preserving immediate weather/season transitions and one-second localized
rain/storm animation. Repeating the live capture retains 90 synchronized frames
at 19,787 steady bytes, a 98.51% reduction with zero full-world idle repaints.

These are live bounded measurements, not Gate-D completion. The subsequent
fixed 144-frame real-SSH atlas at `v4d6bebd` confirms organic material blends
and correct traveler alpha, but rejects the current composition at Gate A for
sparsity/repetition, angular route ribbons, rectangular crossing masses, night
compression, and storm loss of identity. The complete failed sheets and raw
streams are retained under `track-6-acceptance-atlas/acceptance-atlas-v3-final/`.
The 5/10/20-presence ladder, 30-minute run, corrective composition pass, and
physical Ghostty proof remain open.

## Non-periodic asset placement

Procedural anchors come from a world-space priority field. A candidate survives
only when it wins against its cardinal neighbourhood, producing an unbounded
blue-noise-like distribution independent of cache borders. Semantic constraints
then choose waterfront, route, garden, or water roles.

Buildings must keep collision masks off water, bridge decks, plazas, and
protected route centres. Their lower opaque sprite rows also require dry land,
which prevents large facades from balancing on tiny islands. Queries inspect
neighbouring cache blocks so a sprite may cross an internal cache boundary
without clipping or duplication.

## Material hierarchy

Water/paving and garden/paving transitions use the same shared-corner,
world-space compositor. Garden boundaries have their own continuous texture
blend without a water material mask; water retains ownership of constructed
curbs, wet contact, reflections, collision, and terminal animation phases.

## Current limits

This is a live production foundation, not the end-state world or a
Phase-0 art-direction approval.
The rebuilt origin now has coherent canal topology, dense side walls, legible
crossing-scale negative space, and constructed water contacts in faithful ANSI
review. It still needs physical Ghostty direction approval. Garden source art
needs a stochastic interior atlas, and the world beyond route corridors is
intentionally sparse until regional/biome composition is proven.
The active-session hot-reload path now preserves position and view state through
a worker replacement, with a real SSH proof retained under the mounted research
tree. The complete physical-display and performance gate remains open.
