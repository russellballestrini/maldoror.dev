# Canal-town modular frontage atlas v1

- Generated: 2026-07-29
- Generator: built-in Codex/ChatGPT image generation subscription
- Metered API: none
- Source: `canal-town-modular-frontage-atlas-v1-source.png`
- Source SHA-256: `b3b2bb5db0814832feb284ffb99ae6d90a40108ebc7d30726cd3aa9d739afb45`
- Chroma-keyed atlas SHA-256: `a200c3a96cca5acabb0843e787e039d1412e5f7ee4f36941ab755d12abf936c9`
- Deterministic derivation: `node tools/render-sim/derive-canal-town-modular-frontages.mjs`
- Runtime manifest: false

## Prompt

```text
Use case: stylized-concept
Asset type: production game-environment sprite atlas for a pure-ANSI isometric world
Input images: Image 1 is a style, palette, material, brushwork, and camera reference only; generate a new modular atlas and do not copy its layout.

Primary request: Create one polished sprite-atlas source containing exactly THREE independent canal-town frontage modules that can be assembled into a dense continuous street without becoming one unplaceable monolith:
1) a compact two-shop ochre-limestone facade with varied terracotta roofs and two distinct canvas awnings;
2) a compact inhabited courtyard/arch module with a clearly open walk-through passage from the bottom/south edge deep into the structure, laundry above, and tiny planters;
3) a compact workshop-and-inn facade with barrels, crates, flowers, a recessed doorway, and varied roof heights.
Each module should feel architecturally substantial and richly inhabited, but its physical foundation must stay tightly beneath its own buildings. The three modules share construction vocabulary and align visually when placed near one another, while retaining distinct silhouettes.

Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for deterministic local removal. It must be one uniform color with no gradient, texture, lighting variation, floor plane, reflection, or shadow.
Style/medium: exquisite painterly isometric game art; warm Mediterranean canal town; dense hand-painted material detail; strong readable mass/value hierarchy; not pixel art and not a 3D render.
Composition/framing: orthographic three-quarter top-down view matching Image 1; exactly three fully separated modules arranged left-to-right in one row with very generous empty magenta gaps and outer padding; no module may touch or overlap another.
Lighting/mood: warm clear daylight, consistent upper-left key light, restrained contrast that survives terminal downsampling.
Color palette: sun-warmed ochre limestone, varied burnt-orange terracotta, muted cream/green/rust awnings, dark timber, small natural flower accents. Do not use #ff00ff anywhere in a module.
Materials/textures: individually readable roof planes, plaster wear, stone joints, timber shutters, fabric folds, foliage, barrels, baskets, and tight contact darkening only.
Constraints: exact three modules; transparent-ready clean silhouettes; one or more obvious south-edge entrances per module; module 2 must preserve a visibly empty walk-through arch corridor; no baked road, plaza, quay, canal, water, terrain tile, broad pavement base, or decorative ground island; no people, vehicles, boats, signs, lettering, logos, watermark, border, frame, UI, or labels; no cast shadow outside the silhouette; keep all subjects fully inside canvas with crisp antialiased edges and generous padding.
```
