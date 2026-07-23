# RENDER GOAL — match the TARGET mockup

**The goal:** the live game, played over SSH in Ghostty, is visually
indistinguishable *in style and fidelity* from `gallery/TARGET.png`
(the cozy pastel canal-town mockup) — backed by pipelines that can generate
infinite terrains/buildings/props in that style, not hand-placed one-offs.

**The loop (every iteration):** change → `sim.mjs`/`showcase.mjs` screenshot →
LOOK → publish to <https://maldoror.dev/gallery> with notes → compare vs
TARGET → next. No change ships without being seen.

## Gates

- **G0 — Loop operational** ✅ *(iter 000-002)*
  Headless sim drives the real pipeline, rasterized screenshots, public
  gallery with TARGET pinned, live deploys verified end-to-end.

- **G1 — Style-coherent terrain**
  All terrain visible in the showcase matches the TARGET palette/materials.
  Checkable: curb lines continuous on BOTH axes; no tone mismatch between
  base stone and transition tiles at intersections; ≥2 water variants so
  repetition isn't obvious at a glance; no style-mismatched tiles on screen.

- **G2 — World furniture**
  Showcase contains, in TARGET style: ≥2 multi-tile buildings (terracotta
  roofs / awnings), ≥1 bridge across a canal, ≥3 prop types (lamp post,
  planter, boat). Generated via repeatable scripts, not hand-drawn.

- **G3 — HUD**
  Hearts (top-left) + coin counter (bottom-left) overlays in the live game,
  styled like the TARGET.

- **G4 — Fidelity: octant solid mosaics** ✅ *(iter 004)*
  Unicode 16 octant (2×4 solid) render mode, auto-selected from the client's
  TERM (Ghostty/kitty/VTE → octant; else halfblock). Image protocols (kitty
  graphics) are REJECTED — maldoror is a *terminal* game, pure ANSI only.
  Verified: a Ghostty client renders octant (0 braille) live.

- **G5 — Terminal-native codec** (docs/RENDERING-CODEC.md)
  Retained cell framebuffer + motion-compensated ANSI: camera motion = scroll
  op (DECSTBM/DECSLRM + SU/SD/DCH/ICH), actors = dirty-rect repairs, water/
  light = OSC-4 palette cycling, cost-based emitter under a byte/latency budget.
  - [x] palette-cycled water (141 B/tick animates all water, 699× vs repaint)
  - [ ] retained terminal_view + scroll-region motion compensation
  - [ ] dead-zone camera (sub-cell actor / whole-cell camera)
  - [ ] dirty-rect entity repair + cost-based emitter + latency budget
  Checkable: steady-state bytes/frame during camera pan < a few KiB; smooth in
  a real Ghostty SSH session.

- **G6 — The match (sign-off)**
  A screenshot of the REAL game in Ghostty, side-by-side with TARGET in the
  gallery, and the operator (Thomas) signs off that it hits the bar.

## Current status

| Gate | Status |
|---|---|
| G0 | ✅ done |
| G1 | in progress — curb continuity + intersection tone + water variants |
| G2 | next |
| G3 | pending |
| G4 | designed (docs/RENDERING.md §4.2), pending build |
| G5 | pending |
