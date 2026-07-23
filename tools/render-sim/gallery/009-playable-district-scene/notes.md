# 009-playable-district-scene

2026-07-23T08:15:15.405Z

Iteration 9 — PLAYABLE DISTRICT SCENE (player composited into an octant district).

district_playable_scene.png: a generated dense canal district, octant-rendered, with the player sprite composited onto walkable stone (with a drop shadow) near the bridge. This is a real game screen in the mockup's world.

MECHANISM: octant-render the district as the backdrop -> derive a walkability layer -> place/move the player on walkable ground -> camera-locked 'room' (codec spec's visual grammar), scroll transitions between districts.

HONEST STATUS on walkability: color-exclusion (block water/foliage/dark, walk the rest) places the player on valid ground BUT over-includes rooftops (walkmask_debug.png: terracotta roofs ~ warm plaza -> both green). Reliable collision from a painterly scene needs a proper layer, not a color heuristic: either (a) vision-segment a walkable-ground mask (GPT-4o-vision), or (b) generate ground/water and buildings/props in SEPARATE layers so footprints are exact. That's the next build.

SUMMARY: the LOOK is solved (districts + octant = TARGET league). Playability = collision layer + live integration next.
