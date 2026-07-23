# Terminal-native rendering codec (plan of record)

> Treat the terminal as a **retained cell framebuffer** and build a
> **motion-compensated encoder** around it. Do not transmit frames — transmit
> the smallest terminal operation that turns the previous frame into the next.
>
> — architecture spec, Thomas, 2026-07-23. This doc is the plan of record.

The octant renderer (`docs/RENDERING.md`) is the **fidelity** layer — it turns
world pixels into high-detail terminal cells. This codec is the **transport**
layer — it turns a sequence of cell-frames into the minimal ANSI that mutates
what the terminal already shows. They compose: octant makes it look right; the
codec makes it stream cheaply over SSH.

## The codec, as a video codec analogy

```
I-frame:  full redraw   — startup, resize, teleport, scene change
P-frame:  scroll vector + newly-exposed edge strips + dirty entity rects
Palette:  a few OSC-4 color-table changes for water / light / foliage animation
```

## Components (build order = user's "highest-value prototype")

1. **Retained `terminal_view` cell buffer** — the renderer already keeps
   `previousCells` (the cell-diff path). Promote it to the authoritative model
   of what Ghostty currently shows. Three buffers: `terrain_view` (static world
   at camera origin), `target_view` (terrain+actors+fx), `terminal_view` (known
   on-screen). Cells are `{glyph, fg, bg, attrs}` — structured, not strings.

2. **World inside rectangular scroll margins** (exclude the HUD):
   ```
   DECSTBM  ESC[<top>;<bottom>r         top/bottom world margins
   DECSLRM  ESC[?69h then ESC[<l>;<r>s  left/right margins (margin mode ON)
   ```
   ⚠️ With DECSLRM on, `CSI s` = *set margins*, NOT save-cursor. Use `ESC 7` /
   `ESC 8` for cursor save/restore.

3. **Vertical camera move = one scroll op** (≈160 cells → 1 row of work):
   ```
   ESC[<n>S   SU  shift world region up n rows   (camera down)
   ESC[<n>T   SD  shift world region down n rows  (camera up)
   ```
   then render only the newly-exposed edge row(s).

4. **Horizontal camera move = row-wise shift** inside the margins:
   ```
   camera right: per world row → CUP(row,left) + DCH(1); render new right col
   camera left : per world row → CUP(row,left) + ICH(1); render new left  col
   ```

5. **Player-centered camera dead zone** — separate motion:
   - actor motion = sub-cell, frequent (only the actor's small bounding rect is
     re-packed into octant/halfblock glyphs);
   - camera motion = whole-cell steps, only when the player crosses the dead-zone
     boundary → one scroll op + counter-position the player + repair edge.
   Interiors/towns can camera-lock as visual grammar (rooms fixed, scroll between).

6. **Dirty-rect entity repair** — for a moved entity,
   `dirty = old_bounds ∪ new_bounds`; recompose those cells from the depth
   stack (terrain → sorted entities → shadows → player → foreground → fx). Never
   "erase with blanks" — restore the real terrain/objects behind. Query a spatial
   grid for overlaps. Half-block/octant: expand dirty bounds by one logical
   sub-row before converting to terminal cells.

7. **OSC-4 palette-cycled animation** — reserve ~32 of the 256 indexed colors
   for animated materials (192-199 water, 200-207 specular, 208-215 foliage,
   216-223 fire/lantern). Render those cells with `38;5;n`/`48;5;n` where
   `n = BASE + phase(x,y)`; each tick rotate the RGB of those slots via one
   `OSC 4;192;<rgb>;193;<rgb>;… ST`. Glyphs never change; the highlight travels.
   A few hundred bytes animates every water cell on screen. Query+save originals
   at startup; restore with `OSC 104` on every exit path + signal handler.

8. **Cost-based ANSI emitter** — don't just iterate changed cells; compute the
   cheapest edit: `patch_cost = cursor_move + sgr_transition + utf8_glyph`.
   Merge near intervals, track SGR state (no `SGR0` between runs), relative
   cursor when shorter than CUP, `EL` for trailing-blank, `REP` for glyph runs.
   Consider the camera scroll op BEFORE cell diffing (a naive diff sees 95%
   changed when it's one translation + a thin edge).

9. **Latency-budgeted writer** — sim 60-120Hz; player patches ≤60Hz; camera
   scroll 20-60Hz; palette 20-60Hz; distant anim 8-15Hz. Writer thread, queue
   depth 1 (replace the unsent packet with a newer one; finish a partial write,
   never accumulate stale frames). One buffer, one write per frame. Adapt a
   4-12 KiB byte budget; priority order: player old/new → camera edge → hostiles
   → fx → NPCs → water/foliage → distant decoration. Perceptual partial updates
   for big animated glyph surfaces (`update_group = hash(x,y) mod K`, blue-noise).

## How it maps onto the current code

- `packages/render/src/pixel/pixel-renderer.ts` already emits structured
  `CellGrid` + a cell diff (`renderChangedCells`) + CRLE. The codec extends the
  cell-diff path — it is NOT the `renderToString` line-diff path (which repaints
  whole lines and is what production currently uses).
- Foveated zones + prediction cache (already present) are early versions of
  components 7/9.
- New module: `packages/render/src/pixel/terminal-codec.ts` — owns the three
  buffers, the scroll-region setup, motion compensation, palette state, and the
  cost-based emitter. `PixelGameRenderer` gains a `codec` transport mode
  (env/keybind gated) that, per frame: compute camera delta → emit scroll ops +
  shift buffers in memory → mark exposed strips + entity rects dirty →
  recompose dirty → cost-emit patches → emit palette phase → single write.

## Status

- [x] Design captured (this doc)
- [ ] Retained `terminal_view` + structured cell model (extend cell-diff path)
- [ ] Scroll-region setup (DECSTBM/DECSLRM) + memory-buffer shift
- [ ] Vertical SU/SD camera motion + exposed-edge render
- [ ] Horizontal DCH/ICH camera motion
- [ ] Player-centered camera dead zone (sub-cell actor / whole-cell camera)
- [ ] OSC-4 palette-cycled water (+ save/restore)
- [ ] Cost-based emitter (REP/EL/relative-cursor/merged-SGR)
- [ ] Latency-budgeted writer + byte metrics on admin/stats

Bandwidth is measured per-frame (bytes emitted) + blocked-write time, surfaced
on the stats endpoint, and tracked in the gallery notes.
