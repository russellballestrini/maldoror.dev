# RENDER GOAL — match the TARGET mockup

See `/DOSSIER.md` for the north star. Maldoror is an infinite, freely zoomable,
buttery-smooth, AI-authored living world over pure high-fidelity ANSI,
Ghostty-first. No kitty graphics or sixel.

The visual target is `gallery/TARGET.png`: dense, lush, organic, warm and
painterly. The implementation model is a rich modular AI tileset plus
deterministic infinite placement with explicit collision.

## Acceptance loop

Every visual change follows:

```
change
  -> production simulator
  -> look at the PNG
  -> deploy worker
  -> real xterm-ghostty SSH capture
  -> faithful ANSI replay
  -> TARGET side-by-side
  -> gallery
```

Preview rasterizers help iteration but cannot pass the live gate. Only
`faithful-render.mjs` replaying the real SSH bytes proves the terminal state
Ghostty receives. Its block geometry and colours are exact; its local
monospace font is an explicit glyph-metrics approximation. Physical Ghostty
acceptance remains separate.

## Gates

- **G0 — loop:** ✅ simulator, live capture, faithful replay, and public gallery.
- **G1 — coherent terrain:** ✅ paving, water, garden and curb masters; four
  deterministic variants each; continuous crossing canal grammar.
- **G2 — world vocabulary:** ✅ 33 assets: nine façades, two bridge axes,
  quay/dock, foliage, furniture, planters, water details and boats.
- **G3 — live world:** ✅ `CanalTownTileProvider` is the production default;
  infinite signed-coordinate blocks; deterministic density; explicit collision.
- **G4 — fidelity:** 🔄 area-resampled truecolour octants with error-minimizing
  two-colour fitting are live; one 160x46 arrival frame is direction evidence,
  but the multi-coordinate/multi-zoom atlas and physical review remain open.
- **G5 — motion:** ✅ 200ms sub-tile actor interpolation, dead-zone follow
  camera, cell-quantized scrolling, 180ms zoom, discrete source LOD.
- **G6 — terminal codec:** ✅ retained framebuffer, DECSTBM/DECSLRM,
  SU/SD/DCH/ICH, dirty repairs, REP, merged SGR, synchronized output, keyframes,
  exact OSC-4 palette ownership, bounded depth-one SSH output.
- **G7 — operational:** ✅ worker hot deployment preserved three established SSH
  connections; health remained responsive; shared runtime sprite caches brought
  memory below the cgroup high-water threshold.
- **G8 — physical Ghostty sign-off:** ⏳ operator action. Automated evidence
  cannot honestly substitute for the user's physical-client acceptance.

## Current proof

- Faithful automated live frame:
  `out/live-canal-town-accepted-faithful.png`
- Raw idle capture:
  `out/live-idle-primed-v2.bin`
- Raw one-step capture:
  `out/live-one-step-primed.bin`
- Headless production view:
  `out/canal-town-production-octant-14-14.png`
- Target:
  `gallery/TARGET.png`

At 160x46, the live initial cell frame is 270,069 bytes. After it, six idle
seconds cost 16,133 bytes: 89 157-byte palette ticks and two 1,080-byte HUD
refreshes. A one-tile step costs 16,748 bytes in the five seconds after input,
including palette and HUD traffic. The former startup camera catch-up is gone.

## After sign-off

Build a second biome through the same manifest/role/collision contract; add
authored far-LOD map art; deepen visible NPC schedules and conversation; then
use the palette ownership machinery for day/night, weather, foliage and light.
