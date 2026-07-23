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
