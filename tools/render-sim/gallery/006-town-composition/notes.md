# 006-town-composition

2026-07-23T07:56:20.075Z

Iteration 6 — TOWN COMPOSITION (G2). The whole stack composed against the TARGET.

A denser canal-town scene (terrain + stone<->water autotile curbs + water variants + 2 buildings + arched flower BRIDGE + props: lamp posts, planter, umbrella market stall, rowboats + player/NPCs) rendered in OCTANT (the live fidelity mode) and fullres.

Compare town_fullres.png and town_octant_wide.png against TARGET.png at the top: same art family — warm sandstone plaza, teal canals, terracotta-roof buildings, arched sandstone bridge with flowers, wrought-iron lamp posts, striped market umbrella, wooden rowboats. All generated in mockup style via images.edit with the style anchor (gen-buildings.mjs, gen-props.mjs). Octant renders it as clean SOLID mosaics.

Remaining to hit G5/G6 (see GOAL.md + RENDERING-CODEC.md): wire buildings/props into the LIVE procedural world-gen (currently in the showcase composer); integrate OSC-4 palette water into the live renderer (module proven, iter 5); denser/organic canal layout; HUD (hearts/coins); and the scroll-region motion-compensation codec for cheap streaming.
