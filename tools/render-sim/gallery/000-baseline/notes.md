# 000-baseline

2026-07-23T06:14:24.271Z

Iteration 0 — BASELINE of the current engine (halfblock + braille modes, zoom 26/51/88/102px tiles).

Findings:
- Terrain renders as FLAT solid-color rectangles: the procedural texture generator in packages/world base-tiles.ts is disabled ('DISABLED FOR PERF TESTING'), and the AI terrain_tiles DB table is empty on this install.
- Dark speckle fringe around all sprites: alpha threshold 32 lets anti-aliased edge pixels through as near-black dots; existing sprite PNGs have the fringe baked in (needs load-time despeckle).
- Sprites themselves (gpt-image generated, pixelated to a 10-step resolution pyramid) read beautifully, even in halfblock.
- Braille mode doubles detail; flat-cell optimization (this session) removed dot-noise on flat areas.
Next: AI terrain generation (in progress), sprite despeckle, then visual iteration.
