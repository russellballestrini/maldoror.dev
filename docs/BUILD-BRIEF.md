# MALDOROR — engineering build brief (for the implementing agent)

You are picking up maldoror. **Read `/DOSSIER.md` first (the north star), then
[`/NEXT-GOAL.md`](../NEXT-GOAL.md), then this.** `NEXT-GOAL.md` is the governing
definition of done; the old one-block milestone is foundation only. This brief
is the comprehensive, precise implementation guide: the
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

### L1 — FIDELITY (pixels → terminal cells). ✅ milestone path live

Honest 160×46 SSH replay now passes the visual gate. `ViewportRenderer` uses
area-average resampling with a bounded cache; the octant renderer fits a
two-colour reconstruction instead of threshold-streaking; Ghostty retains
truecolour; and zoom follows a 180ms eased, discrete-LOD curve. The acceptance
artifact is `tools/render-sim/out/live-canal-town-accepted-faithful.png`.
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
  orchestrator and single production cell/codec path.
- `packages/render/src/pixel/viewport-renderer.ts` — `ViewportRenderer`:
  composites the world into a pixel buffer (terrain→roads→buildings→Y-sorted
  entities), camera (follow/free, 90° rotation, sub-tile precision), zoom, and
  area-resampled LOD selection with an LRU cache.
- Support: `brightness-cache.ts`, `perf-stats.ts`, `prediction-cache.ts`
  (probabilistic pre-render — early codec idea), `transport/output-pump.ts`
  (SSH backpressure; **only wired in the legacy in-process path — wire it in**).

### L2 — WORLD (what fills the cells). ✅ canal-town biome live
- Model = **rich AI tileset + dense deterministic procedural placement**.
- `assets/canal-town/manifest.json`: 33 modular assets, four terrain masters
  expanded to 16 variants, explicit roles/scales/collision, retained sources.
- `canal-town-tile-provider.ts`: unbounded signed-coordinate blocks, variable
  crossing canals, continuous curbs, two-axis bridges, dense façades, foliage,
  props, boats, deterministic variation, and a bounded block cache.
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

### L3 — TRANSPORT (frames → minimal ANSI over SSH). ✅ codec v1 live
`terminal-codec.ts` owns the retained terminal framebuffer, exact DECSTBM/
DECSLRM scroll transforms, SU/SD/DCH/ICH motion compensation, dirty cell runs,
REP, merged SGR, synchronized output, keyframes, and byte metrics. OSC-4 cycles
all water for 157 bytes/tick while saving/querying/restoring the user's exact
palette. `SessionProxy` applies a 64 KiB, depth-one output budget; a dropped
dependent delta requests a worker keyframe. With DECSLRM on, save/restore uses
`ESC 7`/`ESC 8`, never ambiguous `CSI s`.

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

## 3. The production render/transport path

The old line-diff fork is closed. Both `render()` and `renderToString()` compose
the same structured `CellGrid` and retained `TerminalCodec`; the live worker
uses `renderToString()` only because IPC needs a string. The codec compares the
new camera/world revision with its retained terminal model, applies an exact
scroll transform when profitable, and emits only exposed strips or dirty runs.

`PixelGameRenderer.primeCamera()` is an I-frame boundary used after the final
zoom/layout restore. It prevents saved spawns from easing out of `(0,0)` and
turning startup into dozens of fake motion frames. Resize, teleport, palette
failure, or an output drop similarly requests a keyframe. Ordinary idle frames
are only the 157-byte OSC-4 packet; the HUD refreshes at 1 Hz.

Backpressure lives in the main-process `SessionProxy`, where it can observe the
actual ssh2 stream. The queue is bounded to 64 KiB and one complete pending
frame. A dropped delta invalidates the dependency chain and sends a
`request-keyframe` IPC message before another delta is accepted.

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
# Worker-only hot deploy; preserves established SSH sockets.
kill -USR1 "$(systemctl show maldoror-ssh-world.service -p MainPID --value)"

# Full restart only when main-process code must be activated and connections
# have drained (or a maintenance interruption is explicitly acceptable).
sudo systemctl restart maldoror-ssh-world.service
sudo journalctl -u maldoror-ssh-world -f
```
Env: `/etc/donto/maldoror.env` (root:ajax 640). Keys: `DATABASE_URL`
(maldoror-pg docker, 127.0.0.1:5436), `SSH_PORT=2222`, `STATS_PORT=3105`,
`OPENAI_API_KEY` (sk-svcacct-…, funded), `AI_PROVIDER=openai`,
`WORKER_STARTUP_TIMEOUT_MS=300000`, `NODE_OPTIONS` (heap capped ~1.2G — the
service is in `maldoror.slice` with **MemoryMax 1.6G — do not exceed** or it
OOM-kills). Optional: `MALDOROR_RENDER_MODE` (force normal/halfblock/braille/
octant), `MALDOROR_DISTRICT=<png>` (legacy experiment: district as world;
also set `MALDOROR_CANAL_TOWN=0`, because the generated canal-town is the
production default and deliberately takes precedence).
Worker boot takes ~30-90s under load (module load off sdb) — patience, not a
hang. `.service`/`.slice` mirrored in `deploy/box/`; `deploy/box/redeploy.sh` =
full build+tsup+push+restart.

**Verify — the LOOP (do this every change):**
1. **Headless sim** — render the real pipeline to a PNG and LOOK at it:
   `node tools/render-sim/sim.mjs` (or `showcase.mjs`/`town.mjs`/
   `octant-image.mjs <img>`). Read the PNG. **Never ship a visual change unseen.**
2. **Publish** to the public gallery:
   `node tools/render-sim/publish-gallery.mjs <slug> "notes" --files=a.png,b.png` →
   **https://maldoror.dev/gallery** (Caddy `handle_path /gallery/*`). The
   `COMPARISON.png` (TARGET vs NOW) is the goal-tracking artifact.
3. **Live probe over SSH** (the harness handles PTY size, cleanup and exact
   startup/steady byte accounting):
   ```
   python3 tools/render-sim/capture-live.py tools/render-sim/out/live.bin \
     --cols 160 --rows 46 --settle 6
   python3 tools/render-sim/capture-live.py tools/render-sim/out/step.bin \
     --cols 160 --rows 46 --keys d --settle 6
   curl -s http://127.0.0.1:3105/stats | jq
   ```
4. **Faithful look** — the ONLY honest way to judge fidelity: capture the ssh
   stream to a `.bin` (python pty, 160×46, ghostty TERM), then
   `node tools/render-sim/faithful-render.mjs <cap.bin> 160 46` → replays the
   real bytes the way Ghostty paints them. Judge from THIS, never the preview
   rasterizers (`octant-image.mjs` etc. flatter the output — they fooled the
   prior agent into "fidelity solved" when it wasn't).

---

## 5. Pitfalls already discovered (do NOT repeat)

1. **Sparse tile-scatter looks nothing like the mockup.** A few atomic props on
   a coarse grid with big rectangular water = failure. Density + a rich tileset
   (variants, autotiles, foliage, shadows) is the whole game. (Gallery iters 6-7
   = the bad way; iters 8-9 = why.)
2. **Walkability from painterly art is unreliable** (terracotta roofs ≈ warm
   plaza → color thresholds walk on roofs). The tileset model AVOIDS this —
   collision is a known per-tile flag. Don't reintroduce paint-derived collision.
3. **Per-session resolution pyramids OOM.** `PixelGrid` is `{r,g,b}` objects
   (~40B/pixel in V8). Generating a full 26→256 pyramid per tile for a whole
   district = many GB → instant OOM (MemoryMax 1.6G). District tiles store BASE
   pixels only; the renderer's `scaleFrame` downscales on demand. (See
   `district-loader.ts` comment.) For the real tileset, share tile pixel data by
   id. Runtime player/NPC rendering selects the nearest complete 128px level
   into shared, bounded caches; never mutate or delete the persisted 256px PNG.
4. **`pty.fork` gives a 0×0 window** → empty viewport → "no frames". Always
   `TIOCSWINSZ`. And octant only appears with a Ghostty-ish `TERM`.
5. **turbo build clobbers the db ESM bundle** (§4).
6. **A frame drop breaks retained deltas.** Never drop one and continue as if
   the terminal received it; request a keyframe first.
7. Sprites have a baked-in dark alpha fringe → despeckle at load
   (`sprite-hygiene.ts`); raise generation alpha threshold.
8. **Image protocols are banned** — the user vetoed kitty graphics. Terminal
   glyphs only.

---

## 6. HISTORICAL FOUNDATION — "one walkable block, buttery smooth"

This section records implemented mechanics; it is not a completion claim.
`/NEXT-GOAL.md` governs acceptance and explicitly requires world-scale visual,
biome, life, zoom, concurrency, and physical-Ghostty proof.

**Definition of done:** `ssh -p 2222` in real Ghostty into ONE dense,
mockup-quality neighborhood; walk it with **smooth scroll + smooth zoom**;
octant; comfortable frame rate; sane bandwidth. Side-by-side vs TARGET; user
sign-off.

**Engineering gate status:**

1. ✅ Rich coherent canal-town kit: 33 assets + 16 terrain variants, generated
   through Codex's built-in ChatGPT image capability and retained with sources.
2. ✅ Dense infinite placement and explicit collision: live
   `CanalTownTileProvider`, crossing waterways and two-axis bridges.
3. ✅ Codec v1: retained framebuffer, exact scroll transforms, dirty repairs,
   palette water, keyframes, and bounded output.
4. ✅ Smooth actor/camera/zoom plus area-resampled LOD.
5. ✅ Live worker deployment and honest real-SSH capture. Current 160×46 proof:
   270,069-byte initial cell frame; 16,133 post-keyframe bytes over six seconds;
   one step adds 5,130 bytes over the equivalent idle interval.
6. ⏳ Operator sign-off in a physical Ghostty window. This is an external
   acceptance action and must not be fabricated by the automated harness.

After the milestone: 2nd biome (forest) tileset · NPC townsfolk (reuse
`npc-*`) · other-players-present (already multiplayer) · world-over-time
(day/night palette via OSC-4).

---

## 7. Next work after milestone sign-off

- Generate a second biome (forest/ruins) through the same manifest/role/collision
  contract and add deterministic biome transitions.
- Generate authored far-LOD/map art per biome instead of shrinking near-detail
  sprites beyond their useful scale.
- Expand NPC schedules, conversation, and visible life; preserve the compact
  shared runtime sprite strategy.
- Add day/night, weather, foliage, and lantern material palettes using the same
  OSC-4 ownership/save/restore contract.
- Load the latest main-process lifecycle hardening on the next safe full service
  restart; the worker path is already deployed without disconnecting the three
  established SSH clients.

Judge every visual change against `tools/render-sim/gallery/TARGET.png`. Keep
the gallery + COMPARISON updated — it's how progress is made legible.
