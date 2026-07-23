# 003-curbs-variants-buildings

2026-07-23T07:11:16.683Z

Iteration 3 — G1 curb refinement + water variants + first BUILDINGS (G2 start).

- Regenerated all 8 stone_to_water transitions with the GENERATED STONE TILE as the images.edit reference + explicit full-length-curb instructions -> continuous curb lines on both axes, stone tone now matches the base tile closely.
- water__v2/water__v3 variants + NEW spatial-variant mechanism in TileProvider (position-hashed pick among registered <id>__vN tiles — the general lever for infinite asset variety; live in the world package).
- First two multi-tile buildings generated in mockup style (tools/gen-buildings.mjs, style-anchor reference, transparent bg, sliced 2x2 tiles x 10-res pyramid): market shop w/ striped awning + tall shuttered canal house. Placed in the showcase via the engine's own getBuildingTileAt compositing path.

vs TARGET: palette/materials/furniture now clearly the same family. Remaining gaps:
- n/s vs e/w transition stone tone drift; water variant patches slightly visible in large pools
- buildings not yet wired into the LIVE game's buildings table (showcase only)
- props (lamps/planters/boats), bridges, HUD (G3), kitty-graphics mode (G4)
Goal + gates: tools/render-sim/GOAL.md
