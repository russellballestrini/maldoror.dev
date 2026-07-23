# The Maldoror Rendering Engine — study, measurements, and roadmap

*2026-07-23 — a deep study of the sprite/NPC/terrain rendering stack, the
performance work landed this session, and researched directions for taking it
further. Visual iterations are published at <https://maldoror.dev/gallery>.*

---

## 1. How the engine works today (technique inventory)

### 1.1 Asset generation (packages/ai)
- **Sprites** (`image-generator.ts`): `gpt-image-1-mini` generates six
  HIGH-FIDELITY 1024×1024 transparent-background illustrations per character
  (down/up/left × standing/walking). The first image (down-standing) is passed
  as a **reference to `images.edit`** for the other five, keeping the subject
  consistent. Right-facing frames are **horizontal flips** of left-facing ones
  (guaranteed symmetry, 2 fewer generations). The 4-frame walk cycle is
  [stand, walk, stand, walk].
- **Pixelation**: sharp `trim` (drop transparent margins) → `resize` with
  `kernel: 'nearest'` to each of the **10-step resolution pyramid**
  (26, 51, 77, 102, 128, 154, 179, 205, 230, 256 — `RESOLUTIONS` in protocol).
  Alpha < threshold → transparent (`null` pixel).
- **Terrain** (`terrain-generator.ts`): base tiles per terrain type
  (grass/dirt/sand/water/stone) + **15 autotile transition configs**
  (n/e/s/w/ne/…/all — a 4-bit edge mask) per terrain pair. Same pixelation
  pyramid. Persisted as `data/terrain/<id>/<res>.png` + `terrain_tiles` DB rows;
  the worker loads + registers them at boot (`setTerrainTile` overrides the
  flat fallback tiles).
- **Buildings** (`building-generator.ts`): multi-tile structures, 4 camera
  directions, same pipeline; **Meshy** (`meshy-client.ts`) can lift sprites to
  3D GLB for the web viewers.

### 1.2 World → pixels (packages/world + render/viewport-renderer)
- `TileProvider` = the world data source: procedural chunk terrain (value
  noise: elevation + moisture), AI tile registry, autotile transition lookup
  (`getTransitionTileId` from the 4 neighbours), per-position deterministic
  tile **rotation** for variety, roads, buildings, players, NPCs.
- `ViewportRenderer.renderToBuffer` composites into a `PixelGrid`
  ((RGB|null)[][]) painter's-algorithm style: terrain → roads → buildings →
  **Y-sorted entities** (players+NPCs together, so overlap is correct).
  Sub-tile camera precision, follow/free camera, **90° camera rotation**
  (direction remap + point rotation), zoom 0-100% mapped exponentially to a
  4px→viewport-height tile render size. Nearest-neighbour scaling with an LRU
  frame cache picks the smallest pyramid resolution ≥ target.

### 1.3 Pixels → terminal cells (packages/render/pixel-renderer)
Three modes:
- **normal**: 1 pixel = 2 spaces with bg color (2 cells/pixel).
- **halfblock** (default): `▀` — fg = top pixel, bg = bottom pixel; 1×2
  pixels per cell.
- **braille**: U+2800 block — 2×4 dots per cell; per-cell brightness
  threshold picks dot pattern, fg = avg of "on" pixels, bg = avg of "off".
  *(This session: threshold changed from median → (min+max)/2 contrast split,
  flat cells render as solid full-dot cells — kills dot-noise on uniform
  terrain; conversion made allocation-free.)*
- **Zoom-adaptive quantization**: >50% zoom → 5-bit, >70% → 4-bit color with
  **Bayer 4×4 ordered dithering** — reduces both banding and unique-color
  count (better SGR dedup).

### 1.4 Cells → bytes on the wire
- **Production path** (`renderToString`, called by the worker's 67 ms tick =
  15 fps): renders full ANSI lines, then **line-level string diff** against
  the previous frame — only changed lines are re-emitted; identical frame ⇒
  ~zero bytes (idle costs only the 1 Hz stats bar).
- Cached, **merged SGR** escapes (`ansi-cache.ts`, this session): one
  `\x1b[38;2;…;48;2;…m` sequence instead of two; memoized on integer keys.
- **Synchronized output** (this session): every frame is wrapped in DEC-2026
  begin/end so Ghostty/kitty/WezTerm/foot/Alacritty apply it atomically — no
  tearing. Unsupporting terminals ignore it.
- A second, richer path (`render()`: cell-grid diff + **CRLE** color-grouped
  emission + **foveated zones** + a prediction cache) exists but **is not
  called by the production worker** — see §3.4.
- **Transport**: worker renders → IPC (`process.send`) → main-process
  `SessionProxy` → ssh2 stream. (OutputPump backpressure exists but is only
  wired in the legacy in-process path — see roadmap.)

### 1.5 Supporting machinery
- Per-chunk/per-tile caches, brightness variant cache + per-cell lighting
  grid (built, not yet driven by the world), perf-stats sampler,
  `hot-reload` (SIGUSR1 swaps the worker while SSH sessions survive).

---

## 2. Measured performance (this session's work)

Micro-benchmark: 160×44-cell viewport scene with terrain + 5 entities
(`tools/render-sim` primitives; box: 8-vCPU shared OVH VPS).

| Stage | before | after | Δ |
|---|---|---|---|
| halfblock: full pipeline | 14.5 ms/frame | **6.5 ms/frame** | −55% |
| — CRLE diff+emit | 13.2 ms | 5.0 ms | −62% |
| braille: full pipeline | 57.4 ms/frame | **29.3 ms/frame** | −49% |
| — pixels→cells | 29.2 ms | ~13 ms | −55% |
| GC churn (halfblock, 150 frames) | ~37 MB | ~18 MB | −51% |

What landed:
1. **ansi-cache.ts** — memoized fg/bg/merged-SGR escape strings (integer keys).
2. **CRLE rewrite** — integer color-pair keys (was string concat per cell),
   parallel pos/char arrays (was per-cell objects), **no per-group sort**
   (row-major scan order is already sorted), merged SGR per group.
3. **Braille converter rewrite** — allocation-free two-pass min/max contrast
   split (was: 8 heap objects + sort per cell), flat-cell solid shortcut.
4. **Frame-buffer reuse** — `renderToBuffer` clears in place instead of
   reallocating W×H rows every frame.
5. **Exact tile-scan bounds** — 90°-rotation-aware axis-aligned bounds (was: a
   square of radius max(W,H)+2 on both axes ⇒ 4-10× extra `getTile` calls at
   low zoom).
6. **Entity sort precompute** — screen-Y computed once per entity (was:
   rotation transform ×2 per comparison).
7. **Merged SGR in `renderHalfBlockRow`** — the production halfblock emitter.
8. **DEC-2026 synchronized output** around every production frame.
9. **Idle throttle** — skipped-frame stats-bar rewrite capped at 1 Hz.
10. **Sprite hygiene** (`sprite-hygiene.ts`) — see §3.1; visual, but also
    fewer unique colors per cell ⇒ fewer escapes.

Verified live: 62.5K merged SGR sequences and balanced 2026 begin/end pairs
observed in a real SSH session capture; movement, boot, and gameplay intact.

---

## 3. What was wrong visually, and what we did

*(Screenshots: gallery iterations 000-baseline → 001-ai-terrain-clean-sprites.)*

### 3.1 Dark speckle fringe around every sprite — FIXED
Generation-era alpha threshold (32) turned the artwork's anti-aliased edge
into a contiguous 1-2px near-black **opaque halo** baked into the PNGs.
Nearest-neighbour downscaling samples it into scattered black dots.
Neighbour-count despeckling can't catch a contiguous halo — the fix is
**dark-boundary erosion** (2 passes: dark pixels touching transparency die)
plus isolated-speck cleanup, applied to the 256px base at **load time**
(covers all existing assets; wired into player + NPC loaders). Generation
threshold raised 32→96 for future assets.

### 3.2 Flat solid-color world — FIXED
`base-tiles.ts` had its texture generator disabled ("DISABLED FOR PERF
TESTING") and the `terrain_tiles` DB was empty. Generated **35 AI tiles**
(5 base + grass↔dirt + grass↔water transition sets, `tools/gen-terrain.mjs`,
~$0.40 of gpt-image-1-mini) — the world now has textured earth, grass tufts,
rippled sand, stone. With quantization+CRLE+line-diff, texture is affordable:
the perf work paid for the beauty.

### 3.3 Transition-tile style mismatch — OPEN (next iteration)
The autotile transition tiles were generated **without a reference image**,
so their grass/dirt art style doesn't match the base tiles (visible seams).
Fix: regenerate transitions passing the base-tile original PNG through
`images.edit` as reference — same trick the sprite pipeline already uses for
view consistency. (Originals are kept in `tools/render-sim/terrain-debug/`.)

### 3.4 The unused rich render path
`render()` (cell-diff + CRLE + foveated + prediction) is dead code in
production; `renderToString` (line-diff) is what runs, because the worker
needs a string to send over IPC. Line-diff is decent when idle but **degrades
to full-frame on any camera move** (every line changes). The CRLE cell path
emits only changed cells and is now ~2.6× cheaper than before. **Unifying
these** — a `renderToString`-shaped API over the cell-diff/CRLE engine — is
the single biggest remaining bandwidth win (movement frames are ~100-280KB
at 160×46; cell-diff+CRLE would cut most of it).

---

## 4. Researched directions (state of the art → applied)

### 4.1 Better glyphs than braille: sextants & octants
- **Sextants** (2×3, Unicode 13 *Symbols for Legacy Computing*): ~universal
  in modern terminals (Ghostty/kitty/VTE 100%, WezTerm with
  `custom_block_glyphs`); solid mosaics — no braille dot-gap texture.
- **Octants** (2×4, Unicode 16 *SfLC Supplement*): braille's resolution with
  solid fills; Ghostty ~85-100%, VTE partial, kitty partial/alignment quirks.
  Terminals increasingly draw these with built-in routines (font-independent).
- Plan: a **`sextant` render mode** (2×3 cells, same two-color-per-cell
  model, 64 glyph patterns) as the new high-detail default, octants as
  progressive enhancement after a capability probe.
- **Chafa-style per-cell glyph optimization**: pick the glyph+fg+bg from a
  repertoire (blocks/quads/sextants) minimizing per-cell error — the quality
  ceiling for pure-text rendering (chafa's whole trick; work-factor knob).

### 4.2 Real pixels: kitty graphics protocol (Ghostty supports it)
The kitty protocol can **transmit an image once** (PNG, chunked, by ID) and
then **place it many times by ID** with z-index and pixel offsets — i.e., a
genuine *sprite engine in the terminal*: upload each sprite frame once per
session, then each game frame just re-places images (tiny bytes). Works over
SSH (it's all escape sequences). Sixel/iTerm2 as fallbacks. Detection: query
DA1 + a graphics probe (`ESC[c`, XTGETTCAP) with a short timeout at session
start. This is the "it looks like an actual game" endgame for supporting
terminals, with the cell renderer as the universal fallback.

### 4.3 Asset-quality pipeline
- **Downscale before posterize**: nearest-from-1024 aliases fine detail;
  box/Lanczos to ~2× target, then nearest + **k-means/median-cut palette**
  (~16-32 colors per sprite) reads dramatically cleaner at 26-51px, and fewer
  unique colors ⇒ fewer SGR escapes. (K-Centroid-style downscaling is the
  community standard for AI→pixel-art.)
- **1px dark outline** pass after quantization: classic sprite readability
  trick over busy terrain.
- **Reference-image transitions** (§3.3) and **animated water** (2-3 AI
  frames or hue-cycled variants; the tile system already supports
  `animationFrames`).
- **Blue-noise dithering** instead of Bayer 4×4 at high zoom (removes the
  woven-cloth artifact on dirt).

### 4.4 Motion & transport
- **Movement interpolation**: entities snap tile-to-tile today; lerping
  screen position across the ~200 ms move animation would read as smooth
  motion (the sub-tile camera machinery already exists).
- **Unify on the cell-diff/CRLE path** (§3.4).
- **Scroll-region optimization**: on pure vertical camera moves, `CSI r` +
  scroll + repaint only the exposed band.
- **REP (`CSI Ps b`)** repeat-character compression for long runs (halfblock
  rows are runs of `▀`) — opt-in after capability probe.
- **Backpressure**: wire OutputPump (drop-oldest + forced full redraw on
  drop) into SessionProxy so one stalled client can't balloon main-process
  memory. Worker startup already hardened this session
  (`WORKER_STARTUP_TIMEOUT_MS`).
- **Typed-array framebuffer** (Uint32 RGBA) end-to-end: the remaining ~2×
  CPU + GC win; biggest refactor, do after the mode/protocol work settles.

---

## 5. The iteration loop (how to work on this)

```
# 1. change renderer / assets
node tools/render-sim/sim.mjs            # headless screenshots from the REAL pipeline
# 2. LOOK at tools/render-sim/out/*.png  (rasterized terminal cells, 1:2 aspect)
node tools/render-sim/publish-gallery.mjs <slug> "notes"   # -> maldoror.dev/gallery
# 3. deploy: npx tsc in packages/render + apps/ssh-world, restart service
# benchmarks: node --expose-gc <scratch>/render-bench.mjs
# terrain assets: cd apps/ssh-world && node ../../tools/gen-terrain.mjs --pairs a:b,c:d
```

The simulator drives the actual `TileProvider`/`ViewportRenderer`/cell
renderers with the live world seed and real on-disk sprites — what it draws
is what an SSH client gets, minus font rendering.
