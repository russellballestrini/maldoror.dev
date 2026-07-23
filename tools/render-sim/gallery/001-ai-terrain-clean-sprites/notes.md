# 001-ai-terrain-clean-sprites

2026-07-23T06:22:54.629Z

Iteration 1 — AI TERRAIN + SPRITE DESPECKLE.

Changes since baseline:
- Generated 20 AI terrain tiles with gpt-image-1-mini (5 base: grass/dirt/sand/water/stone + 15 grass_to_dirt autotile transitions), pixelated to the 10-step resolution pyramid, persisted to data/terrain PNGs + terrain_tiles DB (what the live worker loads at boot). Flat solid-color world -> textured earth, grass tufts, rippled sand.
- Sprite fringe FIXED: the baked-in dark alpha halo (generation-era threshold 32) is now stripped at load: 2-pass dark-boundary erosion + isolated-speck cleanup on the 256px base before the renderer's downscale (sprite-hygiene.ts, wired into player + NPC loaders; generation threshold raised 32->96 for future assets).
- Sim now mirrors the live zoom-based quantization (4/5-bit + Bayer dithering).

Known issues to iterate:
- grass_to_dirt TRANSITION tiles don't match the base grass art style (generated without a reference image) -> visible style seam. Next: regenerate transitions via images.edit with the base tile as reference.
- Water transitions (grass_to_water) still generating.
- Water is static; fallback water was animated. Consider animated AI water frames.
- Bayer dithering gives dirt a subtle woven look at close zoom; try 5-bit or blue-noise.
