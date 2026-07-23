# Terminal-native rendering codec

> Treat the terminal as a retained cell framebuffer. Transmit the smallest
> operation that turns the previous frame into the next.

This is the implemented production contract as of 2026-07-23. The octant
renderer is the fidelity layer; `TerminalCodec` is the transport layer.

## Frame model

```
I-frame  = complete cell redraw
P-frame  = exact scroll transform + exposed strips + dirty repairs
Palette  = OSC-4 slot changes; cells remain untouched
```

An I-frame is required at startup, resize, teleport, renderer re-creation, or
after a dropped dependent frame. Ordinary camera/actor updates are P-frames.

## Implemented components

### Retained cell state

`packages/render/src/pixel/terminal-codec.ts` retains the exact `CellGrid` the
server believes the client displays. `PixelGameRenderer.render()` and
`renderToString()` both feed it the same composed cell frame. Keyframe and
byte/operation metrics are available after each encode.

### Rectangular world margins

The HUD is excluded with DECSTBM; a chat sidebar is excluded with DECSLRM:

```
ESC[<top>;<bottom>r
ESC[?69h
ESC[<left>;<right>s
```

With DECSLRM active, `CSI s` means margins. Cursor preservation therefore uses
`ESC 7` and `ESC 8`.

### Camera motion compensation

Whole-cell vertical translations use SU/SD. Horizontal translations use one
DCH/ICH operation per world row inside the margins. The in-memory retained
grid is transformed identically before exposed cells and mismatches are
repaired. If a proposed transform is not exact or not cheaper than patches,
the codec emits dirty runs instead.

The follow camera uses a dead zone: the actor moves at sub-cell precision while
the camera remains still, then advances in cell-quantized steps. Startup calls
`primeCamera()` after final zoom/layout restoration so there is no synthetic
catch-up from the origin.

### Dirty repair and cost emitter

The renderer recomposes the whole target view for correctness; the codec emits
only cells whose structured glyph/fg/bg state changed after any motion
transform. Runs share cursor and SGR state, repeated glyphs use REP when
cheaper, and every packet is wrapped in synchronized output. Old actor pixels
are never erased with blanks: target composition restores the depth stack.

### Palette animation

Water's spatial phase is stable in the cells. Eight indexed colour slots rotate
their RGB definitions in a 157-byte OSC-4 packet, animating all eligible water
without repainting it. Only bright water subpixels use the slots, preserving
the AI source texture beneath the glints.

The renderer queries and saves each original slot. OSC replies are intercepted
before game input. Cleanup restores the exact saved colours, with OSC-104 as a
last-resort reset path when no exact response was obtained.

### Bounded writer and recovery

`SessionProxy` owns a 64 KiB, depth-one `OutputPump` around the actual ssh2
stream. It tracks queued bytes and drain events. When it drops a complete
unsent frame, it marks subsequent deltas unsafe and sends `request-keyframe` to
the worker. The next I-frame re-establishes terminal state.

## Verification

Unit tests cover:

- exact vertical and horizontal retained transforms;
- margin semantics and sidebar exclusion;
- REP and merged SGR emission;
- keyframe recovery;
- palette query/save/restore and terminal reply consumption;
- queue bounds, drops, and clear behavior;
- startup camera priming.

`tools/render-sim/faithful-render.mjs` replays the ANSI subset the codec emits,
including margins, SU/SD, DCH/ICH, REP, synchronized output, and OSC-4. This is
the visual oracle for real captures.

Measured at 160x46:

| probe | bytes |
|---|---:|
| initial live cell frame | 270,069 |
| live idle after first frame, six seconds | 16,133 |
| one-step live traffic after input, five seconds | 16,748 |
| synthetic ordinary idle delta | 0 |
| synthetic actor move, 0.2 tile | 321 |
| synthetic free-camera x, one cell | 1,181 |
| synthetic free-camera y, one cell | 315 |

Run:

```
node tools/render-sim/codec-bench.mjs
python3 tools/render-sim/capture-live.py tools/render-sim/out/idle.bin --settle 6
python3 tools/render-sim/capture-live.py tools/render-sim/out/step.bin --keys d --settle 6
node tools/render-sim/faithful-render.mjs tools/render-sim/out/idle.bin 160 46
```

## Remaining extensions

Codec v1 satisfies the first milestone. Future work may add adaptive per-frame
byte budgets, spatial dirty regions before full target composition, and more
animated material families. Those are optimizations/extensions, not blockers
for the retained transport now running in production.
