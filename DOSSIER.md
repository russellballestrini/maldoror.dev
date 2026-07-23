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

### Layer 1 — FIDELITY (how a cell looks). ✅ milestone implementation live
- **Octants** (Unicode 16, 2×4 solid mosaics) render and auto-detect live.
- Downscaling is now **area-averaged**, with a bounded mip/resample cache; the
  nearest-neighbour mud that destroyed small architecture is gone.
- Octant fitting uses the two-colour cluster that minimizes reconstruction
  error instead of the old contrast split, eliminating its vertical streaks.
- The noisy high-zoom Bayer quantizer is no longer forced into the Ghostty
  truecolour path.
- Zoom animates over a short seek-safe curve and switches through the existing
  resolution pyramid. Actor and follow-camera coordinates interpolate at
  sub-tile precision.
- Honest verification remains the rule: replay the **real SSH ANSI capture**
  through `faithful-render.mjs`; preview rasterizers are not acceptance proof.

### Layer 2 — THE WORLD (what fills the cells). ✅ canal-town biome live
The chosen model is implemented as **AI tileset + deterministic infinite
placement**:
- `assets/canal-town/manifest.json` owns 33 modular assets, four terrain
  masters expanded to 16 deterministic variants, placement roles, scale, and
  explicit collision. Source generations are retained beside derived sprites.
- `CanalTownTileProvider` lays out an unbounded crossing canal network with
  variable-width water, continuous quays, two-axis walkable bridges, dense
  building rows, boats, foliage, street furniture, and water detail. Signed
  block coordinates and bounded block caches make it seamless in every
  direction.
- The live worker loads the shared kit once, not once per session. Full-quality
  persisted character/NPC PNGs remain intact while bounded shared 128px runtime
  caches keep the 1.6 GiB service envelope safe.
- Painterly district images remain reference/set-piece experiments; they are
  not the production world's collision model.

### Layer 3 — TRANSPORT (getting frames over SSH cheaply). ✅ codec v1 live
The production renderer now treats Ghostty as a retained framebuffer
(`docs/RENDERING-CODEC.md`):
- Camera move = **terminal scroll op** (DECSTBM/DECSLRM + SU/SD/DCH/ICH) — a
  *copy*, not a repaint. Player-centered **dead zone**: actor moves sub-cell,
  camera steps whole-cell.
- Entities = **dirty-rect repairs** (recompose old∪new bounds from the depth
  stack; never erase-with-blanks).
- Water/light/foliage = **OSC-4 palette cycling** (proven: 141 B/tick animates
  all water, 699× cheaper than repaint). Ghostty-first makes this free.
- **Cost-based dirty-run emitter** uses REP, cursor motion, merged SGR, and
  keyframes only at true dependency boundaries.
- **Latency-budgeted writer** in `SessionProxy` has queue depth one; dropped
  dependent deltas force the next worker keyframe instead of corrupting state.
- Exact live proof at 160×46: one initial 270,069-byte scene keyframe, then
  16,133 bytes over six seconds (89 × 157-byte palette ticks and two 1,080-byte
  HUD refreshes). A one-tile step costs 16,748 bytes in the five seconds after
  input, including all continuing palette/HUD traffic.

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
- ✅ **First milestone engineering gate is implemented and live:** rich modular
  canal-town kit, infinite deterministic placement with known collision,
  area-resampled octant fidelity, smooth actor/camera/zoom, retained terminal
  codec, palette water, bounded backpressure, and production SSH integration.
- ✅ Verified from a real 160×46 `TERM=xterm-ghostty` SSH capture, faithfully
  replayed to `tools/render-sim/out/live-canal-town-accepted-faithful.png`.
- ✅ Three pre-existing SSH connections survived worker hot deployment; health
  stayed responsive and the new worker remained below the cgroup high-water
  threshold after shared sprite-cache compaction.
- ⏳ **Operator sign-off in a physical Ghostty window remains external.** It is
  intentionally not replaced by a flattering simulator claim.
- ⏭ North-star continuation after sign-off: a second biome, authored far-LOD
  art, richer NPC town life, and time/weather systems.
