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

The origin is a singular authored landmark inside the hierarchy. `(0,0)` is
dry, walkable paving on an east/west causeway, with the river and upper crossing
framing it. Its facade and prop groups are deliberately placed; this exception
does not introduce a repeating district stamp.

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
Diagnostic and faithful review still find the origin too open and paving-heavy,
garden source art needs a stochastic interior atlas, and the world beyond route
corridors is intentionally sparse until regional/biome composition is proven.
Hot-reload session preservation and the full performance gate remain open.
