# 005-codec-palette-water

2026-07-23T07:49:54.331Z

Iteration 5 — TERMINAL CODEC begins: OSC-4 palette-cycled water (the plan of record is docs/RENDERING-CODEC.md).

Per the architecture spec (terminal-native video codec): animated materials render with a SPATIAL phase field using indexed palette colors; the framebuffer cells NEVER change; each tick rotates the 8 water-palette RGBs via ONE OSC-4 packet, so the glint travels across ALL water for a few hundred bytes.

water_animation_strip.png = 8 palette ticks (top->bottom). Watch the diagonal wave bands sweep. MEASURED: 141 bytes/tick animates 4,480 water cells; truecolor repaint of the same region = ~98,560 bytes/frame => 699x more. Zero cells rewritten.

Module packages/render/src/pixel/palette-cycle.ts (materialPhase, waterPalette, osc4Packet/osc104Restore) — reusable by the codec. Colors matched to the mockup's teal canals.

This is codec component #7 (palette animation). Next: retained terminal_view buffer + scroll-region motion compensation (DECSTBM/DECSLRM + SU/SD/DCH/ICH) so camera motion becomes a terminal COPY, and dirty-rect entity repair. Fidelity layer (octant, iter 4) + this transport layer compose.
