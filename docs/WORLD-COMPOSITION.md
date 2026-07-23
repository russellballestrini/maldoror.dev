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

The current production canal provider has not yet been replaced by the
regional compositor. The port and real-material octant labs now establish the
semantic/material layers, route agreement, semantic LOD, and first sparse
family-specific landmark/collision seam. Predictive cold-block streaming,
dense local parcel composition, interactions, and full faithful atlas proof
are still required before a live switch.

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
`(0,0)` is the singular arrival landmark and lies exactly on an arterial.

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
for bridges. `RegionalMaterialCompositor` masks those materials over the same
route answers; bridge coverage clears water ownership and is walkable, while a
ferry retains water ownership and remains non-walkable. Bridge texture axes use
the route tangent instead of a fixed screen direction.

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

This is a researched production candidate, not the end-state world or a
Phase-0 art-direction approval.
The rebuilt origin now has coherent canal topology, dense side walls, legible
crossing-scale negative space, and constructed water contacts in faithful ANSI
review. It still needs physical Ghostty direction approval. Garden source art
needs a stochastic interior atlas, and the world beyond route corridors is
intentionally sparse until regional/biome composition is proven.
The active-session hot-reload path now preserves position and view state through
a worker replacement, with a real SSH proof retained under the mounted research
tree. The complete physical-display and performance gate remains open.
