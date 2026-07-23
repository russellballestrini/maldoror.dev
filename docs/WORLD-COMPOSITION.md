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

This is the selected Phase-0 production candidate, not the end-state world.
The rebuilt origin now has coherent canal topology, dense side walls, legible
crossing-scale negative space, and constructed water contacts in faithful ANSI
review. It still needs physical Ghostty direction approval. Garden source art
needs a stochastic interior atlas, and the world beyond route corridors is
intentionally sparse until regional/biome composition is proven.
The active-session hot-reload path now preserves position and view state through
a worker replacement, with a real SSH proof retained under the mounted research
tree. The complete physical-display and performance gate remains open.
