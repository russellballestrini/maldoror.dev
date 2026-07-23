# MALDOROR — the dossier (north star)

*Set 2026-07-23, from the vision interview. This is the goal. Everything is
judged against it.*

> **Implementing this? Read `docs/BUILD-BRIEF.md`** — the comprehensive
> engineering handoff: architecture, codebase map, exact build/deploy/verify
> commands, pitfalls already discovered, and the step-by-step first milestone.

---

## The one line

**Maldoror is an infinite, freely-zoomable, buttery-smooth, entirely
AI-generated *living* world — a diverse, beautiful place (canal-towns, forests,
waterways, ruins) that people explore and inhabit together, delivered as pure
high-fidelity ANSI over SSH, Ghostty-first.** You `ssh` in and walk into a
world that looks like the mockup and feels alive.

## What it is (game pillars)

- **Cozy + exploration + living.** A gorgeous shared world to wander, potter
  about, and discover — not a twitch game. The feeling of *place* is the point.
- **A living AI world.** AI townsfolk live real lives (the NPC-consciousness /
  Omega line); the world *changes over time* (day/night, weather, growth); and
  **other real players are present** with you. Cozy MMO.
- **Infinite + generated.** The world never ends and is generated in-style,
  forever. No two walks the same.
- **Diverse biomes.** Canal-towns, forests, open water, fields, mountains,
  ruins — real variety as you travel.
- **Exterior-first.** Interiors come later; all early effort is the open world.
- **Cozy scale.** ~5-20 concurrent presences (players + visible NPCs). Intimate
  by design — which buys us a generous per-viewport render budget.

## Non-negotiables

1. **It must look like the mockup** (`tools/render-sim/gallery/TARGET.png`) —
   dense, lush, organic, warm, painterly. Sparse/blocky is failure.
2. **Buttery smooth** — sub-cell character motion, smooth scroll, smooth zoom.
3. **Pure ANSI, terminal-native.** No image protocols (no kitty graphics, no
   sixel). The fidelity comes from octant glyphs. Maldoror is a *terminal* world.
4. **Ghostty-first.** Assume and exploit Ghostty fully; degrade gracefully
   elsewhere.

---

## The hard part: AAA 2D top-down inside SSH ANSI

A terminal is a grid of colored character cells. Getting a AAA world through
that pipe is three composed problems:

### Layer 1 — FIDELITY (how a cell looks). ⚠️ NOT solved — real quality bugs
- **Octants** (Unicode 16, 2×4 *solid* mosaics) render + auto-detect LIVE, and
  the *ceiling* is good: a clean whole-image octant downscale of a dense scene
  looks close to the mockup at 160 cols.
- **BUT the shipped rendering is muddy/noisy** (verified by faithfully replaying
  the live game's ANSI at 160×45 — NOT by the idealized preview rasterizer that
  fooled me earlier). Three concrete, fixable bugs:
  1. **Nearest-neighbour downscale** (`ViewportRenderer.scaleFrame`) — art is
     sliced into 32px tiles then NN-shrunk to ~8px per tile → aliasing/mud.
     **Fix: box/area averaging when downscaling.** #1 fidelity win.
  2. **Octant contrast-split → vertical streaking** on smooth gradients (rain-
     like noise). Improve the fg/bg subpixel selection / dither the pattern.
  3. **Aggressive 4-bit Bayer quantization** adds noise — unneeded in Ghostty
     (truecolor). Drop or lighten it Ghostty-side.
- **AND nothing good ships by default**: the live world is flat procedural grass
  at 100% zoom → a giant blurry player sprite fills the screen. The pretty
  district renders were tool outputs, never the game. (District-mode
  `MALDOROR_DISTRICT` now shows the town live but with the bugs above.)
- Honest verification = faithfully replay captured ANSI (see BUILD-BRIEF §4),
  never the preview rasterizer.

### Layer 2 — THE WORLD (what fills the cells). ⏳ the pivot
The chosen model: **a rich AI-generated tileset + dense procedural placement.**
- Generate, ONCE per biome, a *deep* in-style tileset: many terrain/water/
  foliage variants, full autotile transition sets, trees, bushes, flowers,
  buildings, props, **drop shadows**. (My first attempt looked sparse only
  because the tileset was 5 flat tiles — depth + density is the whole game.)
- Procedurally lay out infinite dense worlds from it. This gives, for free, the
  three things the painterly-chunk approach couldn't: **seamless infinite
  scroll, clean tiling, and KNOWN collision per tile** (no guessing walkability
  from paint).
- Painterly "district" images remain a useful *reference/experiment* and maybe
  future set-piece landmarks, but the generation model is the tileset.

### Layer 3 — TRANSPORT (getting frames over SSH cheaply). ⏳ the codec
Buttery-smooth free-scroll over SSH **requires** the terminal-native codec
(`docs/RENDERING-CODEC.md`) — do not transmit frames, transmit the minimal
terminal op that mutates the last frame:
- Camera move = **terminal scroll op** (DECSTBM/DECSLRM + SU/SD/DCH/ICH) — a
  *copy*, not a repaint. Player-centered **dead zone**: actor moves sub-cell,
  camera steps whole-cell.
- Entities = **dirty-rect repairs** (recompose old∪new bounds from the depth
  stack; never erase-with-blanks).
- Water/light/foliage = **OSC-4 palette cycling** (proven: 141 B/tick animates
  all water, 699× cheaper than repaint). Ghostty-first makes this free.
- **Cost-based emitter** (REP/EL/relative-cursor/merged-SGR) + **latency-budgeted
  writer** (queue depth 1) + **client-side prediction** for input feel.

### Zoom / LOD
- **Improve the existing scaling** first: the resolution pyramid (`RESOLUTIONS`)
  + `ViewportRenderer.scaleFrame` LRU cache already do multi-res tiles — study
  and sharpen it (better downsampling than nearest, mip-correct sampling).
- **Discrete LODs**: near = full octant detail; far = a distinct stylized
  *map/overview* art (not the same art shrunk to mush). Prototype a
  **cost-efficient LOD-art generation** path (gpt-image-2 etc.) — e.g. generate
  a low-detail "map tileset" once per biome.
- Zoom itself must be smooth (animate tile render size + re-LOD at thresholds).

### Ghostty-first capabilities we exploit
octants · full 256-color + **OSC-4 palette cycling** · **synchronized output
(DEC 2026)** (no tearing) · **kitty keyboard protocol** (precise, low-latency
input) · large windows · speed. Fallback path for other terminals: octant/
halfblock, truecolor, no palette animation.

### Scale / compute
Rendering is server-side (thin SSH client). Cozy scale (~5-20) keeps the
per-viewport budget generous on the one box. Interest management + the dirty-
rect codec keep many entities affordable. (Hundreds+ would need a rendering
split — out of scope now.)

---

## FIRST MILESTONE — "one gorgeous walkable block, buttery smooth"

The foundation everything else needs. **Definition of done:** you `ssh` into
Ghostty and walk around **one dense, mockup-quality neighborhood** with **smooth
scrolling and smooth zoom**, rendered in octant, at a comfortable frame rate and
sane bandwidth.

Proves, together: the **rich tileset** can look like the mockup · **dense
placement** · **known collision** · the **motion codec** (scroll-as-copy +
dirty-rect + palette water) · **smooth zoom/LOD** · Ghostty-first.

### Milestone build order
1. **Rich canal-town tileset** — generate a deep in-style set (terrain variants,
   full autotiles, trees/foliage, buildings, props, shadows). Prove one dense
   hand-laid block from it matches the mockup (octant screenshot vs TARGET).
2. **Dense procedural placement** for that block (buildings framing canals,
   foliage borders, props) + per-tile collision.
3. **Motion codec v1** — scroll-region camera (dead zone) + dirty-rect player +
   OSC-4 water. Measure bytes/frame moving; get it smooth.
4. **Smooth zoom** — improve `scaleFrame`; animate zoom; discrete-LOD prototype.
5. **Live** — wire into the SSH game, Ghostty-first; verify in real Ghostty;
   side-by-side vs TARGET; **sign-off**.

Then: a second biome · NPC life · other-players-present · world-over-time.

---

## Status (2026-07-23)
- ✅ Octant fidelity (LIVE, auto-detected), the sim/gallery iteration loop,
  OSC-4 palette-water proven, codec plan, mockup-style asset generation pipeline.
- ⏭ Pivot to the **rich tileset** model; build the **motion codec**; first
  milestone above.
- Working notes: `docs/RENDERING.md` (fidelity), `docs/RENDERING-CODEC.md`
  (transport), `tools/render-sim/` (loop + gallery).
