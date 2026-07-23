# MALDOROR — engineering build brief (for the implementing agent)

You are picking up maldoror. **Read `/DOSSIER.md` first (the north star), then
this.** This brief is the comprehensive, precise implementation guide: the
architecture, the codebase map, the exact APIs to reuse, the build/deploy/verify
commands, the pitfalls already discovered (don't repeat them), and the
step-by-step first milestone. Everything below is real and current
(2026-07-23).

Supporting docs: `docs/RENDERING.md` (fidelity layer, measured perf),
`docs/RENDERING-CODEC.md` (transport codec plan), `docs/architecture.md`,
`tools/render-sim/GOAL.md`. Older research: `docs/instant-feel-*`,
`docs/terminal-render-optimization.md`, `docs/PRD-ssh-performance.md`.

---

## 0. The goal in one paragraph

Infinite, freely-zoomable, buttery-smooth, entirely AI-generated **living** world
(diverse biomes: canal-towns, forests, waterways, ruins), explored together over
SSH, rendered in **pure high-fidelity octant ANSI**, **Ghostty-first**. Must look
like `tools/render-sim/gallery/TARGET.png` (dense/lush/organic). World model =
**rich AI tileset + dense procedural placement** (seamless infinite + KNOWN
collision). **No image protocols** (no kitty graphics / sixel). First milestone =
**"one gorgeous walkable block, buttery smooth."**

---

## 1. Architecture = three composed layers

```
 world state ──▶ [L2 WORLD] tiles+entities ──▶ [L1 FIDELITY] pixels→octant cells ──▶ [L3 TRANSPORT] minimal ANSI ──▶ SSH ──▶ Ghostty
```

### L1 — FIDELITY (pixels → terminal cells). ✅ built, reuse.
- `packages/render/src/pixel/pixel-renderer.ts` — the cell renderers:
  - `renderOctantGridCells(grid, brightness?)` / `renderOctantGrid(grid)` — the
    high-fidelity mode. 2×4 SOLID mosaics. Uses `octant-chars.ts`.
  - `renderBrailleGridCells` / `renderHalfBlockGridCells` (+ `…Grid` string
    variants) — other modes.
  - `renderCRLE(cells, prevCells, headerRows, mode)` — Chromatic Run-Length
    Encoding diff emitter (cell path).
  - `quantizeGridDithered(grid, bits)` — Bayer-dithered color quantization.
  - Merged-SGR via `ansi-cache.ts` `sgrCode(fg,bg)`.
- `packages/render/src/pixel/octant-chars.ts` — the authoritative 256-entry
  `OCTANT_CHARS[pattern]` glyph table. **Regenerate with `python3` (≥3.13, has
  Unicode 16) `unicodedata`** — parse `BLOCK OCTANT-<n>` names + legacy
  block/quadrant/quarter glyphs; 4 single-corner patterns approximate to their
  quadrant. (Method in git history / RENDERING.md.)
- `packages/render/src/pixel/pixel-game-renderer.ts` — `PixelGameRenderer`, the
  orchestrator. **Two render paths — CRITICAL to understand (see §3).**
- `packages/render/src/pixel/viewport-renderer.ts` — `ViewportRenderer`:
  composites the world into a pixel buffer (terrain→roads→buildings→Y-sorted
  entities), camera (follow/free, 90° rotation, sub-tile precision), zoom,
  `scaleFrame` (nearest-neighbour + LRU cache; **improve this for smooth zoom**).
- Support: `brightness-cache.ts`, `perf-stats.ts`, `prediction-cache.ts`
  (probabilistic pre-render — early codec idea), `transport/output-pump.ts`
  (SSH backpressure; **only wired in the legacy in-process path — wire it in**).

### L2 — WORLD (what fills the cells). ⏭ THE PIVOT — build this.
- Model = **rich AI tileset + dense procedural placement** (see DOSSIER §Layer 2).
- Reuse: `packages/world/src/tiles/tile-provider.ts` — `TileProvider implements
  WorldDataProvider`. Owns players/NPCs/sprites/buildings/roads + `getTile(x,y)`
  (procedural noise + autotile). `getTile` returns a `Tile { pixels, walkable,
  resolutions? }`. **This is the interface the renderer consumes.**
- Tile registry: `base-tiles.ts` (`setTerrainTile`, `getTileById`, `BASE_TILES`,
  `VOID_TILE`), `procedural-tiles.ts`, `road-tiles.ts`. Autotile lookup +
  neighbour transitions already in `tile-provider.ts` (`getTransitionTileId`,
  `TERRAIN_TRANSITIONS`).
- `district-tile-provider.ts` (`DistrictTileProvider extends TileProvider`) +
  `apps/ssh-world/src/game/district-loader.ts` — an EXPERIMENT (painterly
  district image as the world). **Not the chosen model** but shows how to swap
  the terrain source cleanly (override `getTile`/`getRoadTileAt`/
  `getBuildingTileAt`; inherit everything else). Keep as reference / possible
  future landmark set-pieces.
- Chunk system for infinite: `chunk/chunk-generator.ts`, `chunk-cache.ts`.
- Noise: `noise/noise.ts` (ValueNoise).

### L3 — TRANSPORT (frames → minimal ANSI over SSH). ⏭ build the codec.
Full spec in `docs/RENDERING-CODEC.md`. Summary: don't transmit frames,
transmit the minimal terminal op. Camera move = **scroll op** (DECSTBM/DECSLRM +
SU/SD/DCH/ICH, dead-zone camera), entities = **dirty-rect repairs**, water/light
= **OSC-4 palette cycling** (`palette-cycle.ts`, proven 141 B/tick / 699× vs
repaint), cost-based emitter + latency-budgeted writer + client prediction.
⚠️ With DECSLRM on, `CSI s` = set-margins, NOT save-cursor — use `ESC 7`/`ESC 8`.

---

## 2. Codebase map

Monorepo (pnpm + turbo). `packages/*` libs, `apps/*` services.

| Package | What |
|---|---|
| `@maldoror/protocol` | types: `Tile`, `Sprite`, `PixelGrid`(=`(RGB|null)[][]`), `RGB`, `Pixel`, `WorldDataProvider`, `Direction`; consts `TILE_SIZE=26`, `BASE_SIZE=256`, `RESOLUTIONS=[26,51,77,102,128,154,179,205,230,256]`. |
| `@maldoror/render` | all rendering (L1) + UI components, input, transport. |
| `@maldoror/world` | `TileProvider`, `DistrictTileProvider`, tiles, chunks, noise (L2). |
| `@maldoror/ai` | asset generation: `image-generator.ts` (sprites, gpt-image-1-mini), `terrain-generator.ts` (terrain + 16-config autotiles), `building-generator.ts`, `meshy-client.ts` (3D, optional), `providers.ts` (openai/anthropic). |
| `@maldoror/db` | drizzle + Postgres. **⚠️ built with tsup, not plain tsc (see §4).** |
| `@maldoror/queue`, `@maldoror/agent`, `@maldoror/ai-character` | jobs, agent harness, NPC AI. |

`apps/ssh-world` — the game server:
- `src/index.ts` — boot: SSH server + stats server + worker manager + AI config.
- `src/server/ssh-server.ts` — ssh2 server; pty (captures `cols/rows/term`),
  shell → `SessionProxy`. Game SSH on `SSH_PORT` (2222).
- `src/server/session-proxy.ts` — thin main-process proxy; forwards input to
  worker via IPC, writes worker output to the SSH stream.
- `src/server/worker-manager.ts` — forks the game worker (`fork`), hot-reload,
  `WORKER_STARTUP_TIMEOUT_MS`. `SessionProxy`↔worker messages typed in
  `game-worker.ts`.
- `src/worker/game-worker.ts` — the worker process; holds `GameServer` +
  `WorkerSession`s; message loop.
- `src/worker/worker-session.ts` — **the per-player session. THE FILE.** tick
  loop (`setInterval(tick, 67)` = 15fps), `renderToString`, movement
  (`moveOptimistic`, collision via `tile.walkable`), spawn-safety, onboarding,
  `pickRenderMode(term)` (octant auto-select), `districtMode`. ~1500 lines.
- `src/worker/virtual-stream.ts` — worker↔main stream (output via IPC, input via
  `pushInput`).
- `src/game/game-server.ts` — world sim: players, NPCs, visibility, movement
  queue. `src/game/npc-*` — NPC managers (consciousness/bot).
- `src/utils/` — `sprite-storage`/`npc-storage`/`png-storage`/`terrain-storage`
  (PNG↔PixelGrid + DB), `sprite-hygiene.ts` (despeckle fringe at load).

Tools (Node ESM, run with `node`): `tools/render-sim/{sim,showcase,town,
octant-image,octant-scene,palette-water-demo,publish-gallery}.mjs`;
`tools/gen-{canal-assets,canal-assets2,buildings,props,terrain,district}.mjs`.
**openai lives in `packages/ai/node_modules`** → tools use
`createRequire(path.join(REPO,'packages/ai/package.json'))('openai')`.

---

## 3. ⚠️ The render-path fork (most important architectural fact)

`PixelGameRenderer` has TWO frame paths:
- **`render(world)`** — cell-grid diff + **CRLE** + **foveated zones** + cell
  reuse. The sophisticated path. **NOT used by the live game.**
- **`renderToString(world)`** — renders full ANSI lines, **line-level string
  diff** vs previous frame, returns a string. **This is what production uses**
  (the worker needs a string to send over IPC): `worker-session.ts` tick →
  `this.renderer.renderToString(this.tileProvider)` → `this.stream.write`.

Consequence: line-diff repaints any line that changed → **a camera move
repaints ~the whole viewport** (every line changes). That's the movement-cost
problem. **The codec (L3) must be built on/replace the cell path and produce a
string** (or the transport must move to the cell/diff model). Unifying these is
the single biggest transport refactor. Measure first (`tools` + the perf probe
pattern in git history: build a fake stream, `renderToString`, count bytes idle
vs moving).

Both paths already: wrap frames in **synchronized output** (`\x1b[?2026h/l`),
use merged-SGR, throttle the idle stats bar to 1Hz. Perf of the cell path was
optimized this session (see RENDERING.md §2: halfblock 14.5→6.5ms, braille
57→29ms/frame).

---

## 4. Build / deploy / verify (EXACT — the box is shared + finicky)

**Environment:** OVH VPS `vps-82c9b3ae` (shared, often loaded by other tenants;
build niced). Node 22, pnpm@9.15 via corepack. Repo at
`/mnt/donto-data/workspace/maldoror.dev` (on the sdb data disk; sdb is sometimes
I/O-saturated → cold builds/starts can be slow — not a bug).

**Build (per changed package, direct tsc — fast, avoids the db clobber):**
```
export PATH=/usr/bin:/bin:/usr/local/bin
( cd packages/render && npx tsc )
( cd packages/world  && npx tsc )
( cd apps/ssh-world  && npx tsc )
```
**⚠️ NEVER `turbo build` / `pnpm build --filter` casually:** turbo rebuilds
`@maldoror/db` with plain `tsc`, whose ESM output imports `./client` without a
`.js` extension → runtime `ERR_MODULE_NOT_FOUND`. If you do a turbo build, you
MUST re-bundle db after:
```
cd packages/db && npx tsup src/index.ts src/schema/index.ts --format esm --dts \
  --clean --external drizzle-orm --external pg --external @maldoror/protocol
```
Sanity: `grep -q "from '\./client'" packages/db/dist/index.js && echo BROKEN`.

**Deploy (live game = native systemd unit, see `deploy/box/`):**
```
sudo systemctl restart maldoror-ssh-world.service
journalctl -u maldoror-ssh-world -f          # logs
```
Env: `/etc/donto/maldoror.env` (root:ajax 640). Keys: `DATABASE_URL`
(maldoror-pg docker, 127.0.0.1:5436), `SSH_PORT=2222`, `STATS_PORT=3105`,
`OPENAI_API_KEY` (sk-svcacct-…, funded), `AI_PROVIDER=openai`,
`WORKER_STARTUP_TIMEOUT_MS=300000`, `NODE_OPTIONS` (heap capped ~1.2G — the
service is in `maldoror.slice` with **MemoryMax 1.6G — do not exceed** or it
OOM-kills). Optional: `MALDOROR_RENDER_MODE` (force normal/halfblock/braille/
octant), `MALDOROR_DISTRICT=<png>` (experiment: district as world).
Worker boot takes ~30-90s under load (module load off sdb) — patience, not a
hang. `.service`/`.slice` mirrored in `deploy/box/`; `deploy/box/redeploy.sh` =
full build+tsup+push+restart.

**Verify — the LOOP (do this every change):**
1. **Headless sim** — render the real pipeline to a PNG and LOOK at it:
   `node tools/render-sim/sim.mjs` (or `showcase.mjs`/`town.mjs`/
   `octant-image.mjs <img>`). Read the PNG. **Never ship a visual change unseen.**
2. **Publish** to the public gallery:
   `node tools/render-sim/publish-gallery.mjs <slug> "notes"` →
   **https://maldoror.dev/gallery** (Caddy `handle_path /gallery/*`). The
   `COMPARISON.png` (TARGET vs NOW) is the goal-tracking artifact.
3. **Live probe over SSH** (octant needs a Ghostty TERM + a real window size):
   ```python
   import os,pty,fcntl,termios,struct,select,time
   pid,fd=pty.fork()
   if pid==0: os.execvp("ssh",["ssh","-tt","-p","2222","-o","StrictHostKeyChecking=no",
     "-o","UserKnownHostsFile=/dev/null","-o","SetEnv TERM=xterm-ghostty","user@127.0.0.1"]); os._exit(1)
   fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',50,200,0,0))  # ROWS,COLS — REQUIRED (pty.fork=0x0=empty viewport)
   # read fd; drive WASD; count bytes / check octant glyphs (U+1CD00..U+1CEBF)
   ```
   Stats: `curl -s http://127.0.0.1:3105/stats | jq`.

---

## 5. Pitfalls already discovered (do NOT repeat)

1. **Sparse tile-scatter looks nothing like the mockup.** A few atomic props on
   a coarse grid with big rectangular water = failure. Density + a rich tileset
   (variants, autotiles, foliage, shadows) is the whole game. (Gallery iters 6-7
   = the bad way; iters 8-9 = why.)
2. **Walkability from painterly art is unreliable** (terracotta roofs ≈ warm
   plaza → color thresholds walk on roofs). The tileset model AVOIDS this —
   collision is a known per-tile flag. Don't reintroduce paint-derived collision.
3. **Per-tile resolution pyramid OOMs.** `PixelGrid` is `{r,g,b}` objects
   (~40B/pixel in V8). Generating a full 26→256 pyramid per tile for a whole
   district = many GB → instant OOM (MemoryMax 1.6G). District tiles store BASE
   pixels only; the renderer's `scaleFrame` downscales on demand. (See
   `district-loader.ts` comment.) For the real tileset, share tile pixel data by
   id (autotiles are a small fixed set, not per-cell).
4. **`pty.fork` gives a 0×0 window** → empty viewport → "no frames". Always
   `TIOCSWINSZ`. And octant only appears with a Ghostty-ish `TERM`.
5. **turbo build clobbers the db ESM bundle** (§4).
6. **The live render path is `renderToString` (line-diff), not the CRLE cell
   path** (§3). Don't optimize the wrong one.
7. Sprites have a baked-in dark alpha fringe → despeckle at load
   (`sprite-hygiene.ts`); raise generation alpha threshold.
8. **Image protocols are banned** — the user vetoed kitty graphics. Terminal
   glyphs only.

---

## 6. FIRST MILESTONE — "one gorgeous walkable block, buttery smooth"

**Definition of done:** `ssh -p 2222` in real Ghostty into ONE dense,
mockup-quality neighborhood; walk it with **smooth scroll + smooth zoom**;
octant; comfortable frame rate; sane bandwidth. Side-by-side vs TARGET; user
sign-off.

**Build order (each step: sim-screenshot → LOOK → gallery → then wire live):**

1. **Rich canal-town tileset (the make-or-break).** Generate, in the mockup
   style (via `packages/ai` + the mockup as `images.edit` style reference — see
   `tools/gen-*.mjs` patterns; OPENAI key in `/etc/donto/maldoror.env`):
   - terrain: many stone-plaza + water variants; FULL autotile transition sets
     (the 16 edge configs) for stone↔water and biome edges; grass/dirt.
   - objects with DROP SHADOWS: trees, bushes, flower clumps, vines, planters,
     lamp posts, market stalls, boats; buildings (multi-tile) in several styles.
   - Register terrain via `setTerrainTile`; objects as building/overlay tiles.
   - **DoD:** one dense hand-laid block from the tileset, octant-rendered, is
     honestly in TARGET's league (COMPARISON.png). Iterate the tileset until it
     is — this is where the quality lives.
2. **Dense procedural placement** for the block: autotiled canals, buildings
   framing water, foliage/prop borders (Poisson/weighted placement, not sparse).
   Per-tile `walkable` from the tileset (KNOWN, not derived).
3. **Motion codec v1** (`docs/RENDERING-CODEC.md`): scroll-region camera with a
   dead zone (actor sub-cell, camera whole-cell), dirty-rect player repair,
   OSC-4 water animation. Extend/replace the cell path so it yields a string for
   the worker (§3). **Measure bytes/frame moving** (must be a few KiB, not the
   whole viewport). Client prediction for input feel.
4. **Smooth zoom:** study + improve `ViewportRenderer.scaleFrame` (better
   downsampling than nearest; mip-correct), animate the tile render size across
   zoom, and prototype **discrete-LOD art** (cheap map-view tileset via
   gpt-image-2) with a clean threshold crossover.
5. **Live + Ghostty-first:** wire the block into `worker-session.ts` as the
   world; exploit Ghostty (octant + OSC-4 + sync + kitty-keyboard input); verify
   in real Ghostty; COMPARISON vs TARGET; **sign-off**.

After the milestone: 2nd biome (forest) tileset · NPC townsfolk (reuse
`npc-*`) · other-players-present (already multiplayer) · world-over-time
(day/night palette via OSC-4).

---

## 7. Open technical problems + recommended approach

- **Transport codec** (biggest): unify onto a cell/dirty model that emits a
  string; scroll-region motion compensation; latency budget. Start by MEASURING
  the current `renderToString` bytes idle vs moving to quantify the win.
- **LOD generation** (cost-efficient): generate a small "map/overview" tileset
  per biome once (gpt-image-2), crossover at a zoom threshold; don't shrink
  detail art to mush.
- **Tileset coherence at scale**: autotiling handles edges; use a fixed,
  richly-varied set + weighted placement + blue-noise scatter for density.
- **Backpressure**: wire `transport/output-pump.ts` into `SessionProxy` so a
  slow client can't balloon memory (drop-oldest + forced redraw).

Judge every visual change against `tools/render-sim/gallery/TARGET.png`. Keep
the gallery + COMPARISON updated — it's how progress is made legible.
