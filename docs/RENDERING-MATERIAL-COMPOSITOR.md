# Continuous material compositor

Status: provisional production direction, 2026-07-23

## Decision

Terrain classification and terrain texture sampling are separate concerns.
Material boundaries are reconstructed as a deterministic continuous coverage
field in world space; they are not represented by fading one opaque square tile
toward another square tile.

The first production seam keeps the existing `TileProvider` contract:

- one shared `CanalMaterialCompositor` is loaded with the terrain kit;
- shared lattice corners make adjacent boundary tiles reconstruct the same
  geometric edge;
- world-space noise breaks up the edge without chunk-local phase;
- texture variants cross-fade over a coarse world lattice and are composited in
  linear light;
- only boundary tiles allocate composites, under a bounded LRU;
- a categorical per-pixel material mask carries water ownership through
  resampling and into the OSC-4 terminal palette path;
- collision remains authoritative and deterministic at the world-cell level.

## Why this seam

It removes the visible square as the unit of water/land composition without a
flag-day rewrite of world generation, collision, animation, or the retained
terminal renderer. The output is cacheable and deterministic, and mixed tiles
no longer force every pixel into one terminal material palette.

## Guardrails

- Uniform interior materials continue to use shared source tiles; this is an
  optimisation, not acceptance of their current repetition.
- Cache bounds are part of correctness. A session may not retain an unbounded
  trail of generated composites.
- Material masks are categorical and use nearest-neighbour resampling. Colour
  uses the normal reconstruction filter.
- The diagnostic metric does not select a winner by itself. Faithful ANSI
  side-by-side review remains authoritative.

## Deferred work

This candidate does not complete Track 1. Interior stochastic detail,
patch-synthesis comparisons, multiscale contrast-preserving blending,
directional transition detail, bridge contacts, and a single shared
sub-cell collision/visual semantic field remain open. Evidence and rejection
records live under
`/mnt/donto-data/donto-resources/maldoror/rendering-research/track-1-material-blending/`.

## Interior stochastic tiling addendum — 2026-07-23

Uniform material interiors now have an independent, bounded strategy. The
full-resolution exemplar is synthesized offline into a corner-coded atlas:

- every world-lattice vertex receives a deterministic colour;
- a tile family is addressed by its NW/NE/SW/SE colours, so adjacent cells
  necessarily agree on both endpoints of their shared edge;
- each combination has eight constraint-matched quilted cores;
- shared two-sided aprons give neighbouring tiles consecutive texture samples,
  avoiding the derivative ridge produced by copying one border texel twice;
- the runtime performs one hash/address lookup and returns a shared immutable
  tile. It does not synthesize pixels or retain visited world coordinates.

The paving atlas has 16 corner combinations x 8 interiors (128 tiles, 1.6 MiB
compressed). The production manifest owns its dimensions and the loader fails
closed if the atlas shape is wrong or any combination is missing. Water and
garden atlases remain research work; transition tiles still use the continuous
material compositor above.

## Garden/paving transition addendum — 2026-07-23

Garden and soil masses now use the same shared-corner reconstruction through
`getGardenTransitionTile`. Their linear-light paving/garden blend has a
separate cache namespace and never writes the water material mask. Water is
resolved first, so a land-use transition cannot paint over a canal edge.

## Constructed bank-face addendum — 2026-07-23

Faithful origin review rejected the pale antialiased water/paving handoff even
after its seams were continuous. The same signed material field now builds a
multi-band waterfront: light land-side lip, jointed vertical stone face, dark
wet contact, then water reflection. The face is explicitly removed from the
animated water material mask, so OSC palette cycling cannot recolour masonry.
This is still one continuous world-space function and does not reintroduce
edge-tile lookup tables.
