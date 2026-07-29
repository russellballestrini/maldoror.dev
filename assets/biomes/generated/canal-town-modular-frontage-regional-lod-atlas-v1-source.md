# Canal-town modular frontage regional LOD atlas v1

- Generated: 2026-07-29 UTC
- Tool: built-in Codex/ChatGPT image generation subscription
- Metered image API: not used
- Intent: edit of the walking atlas into a separately designed semantic
  regional LOD, not a mechanical reduction
- Edit target:
  `assets/biomes/generated/canal-town-modular-frontage-atlas-v1-source.png`
- Edit-target SHA-256:
  `b3b2bb5db0814832feb284ffb99ae6d90a40108ebc7d30726cd3aa9d739afb45`
- Source:
  `assets/biomes/generated/canal-town-modular-frontage-regional-lod-atlas-v1-source.png`
- Source SHA-256:
  `ea943b52208f3bc4350d8030917c2ba180e054c63b324c67429cf3170f81037c`
- Dimensions: 1774x887 RGB PNG

## Prompt

```text
Use case: stylized-concept
Asset type: separately authored semantic regional-LOD source atlas for Maldoror, a painterly ANSI world
Input image: edit target and identity/composition reference
Primary request: redraw exactly the same three independent canal-town frontage modules as deliberately simplified regional-scale silhouettes, not as a mechanically downsampled thumbnail.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local removal; uniform edge-to-edge, with no gradient, texture, floor plane, shadow, or lighting variation.
Subjects: preserve exactly three buildings and their left-to-right identities and order from the reference: paired shops with striped awnings; inhabited open walk-through arch; tall workshop/inn with deep timber awning. Preserve the same front-facing three-quarter/isometric orientation, warm ochre plaster, pale stone trim, terracotta roofs, teal-green joinery, and overall relative footprints.
Style/medium: painterly game-environment semantic LOD; bold coherent masses, crisp rooflines, broad value planes, strong entrance/arch negative space, sparse signature windows and foliage. Reduce microtexture, tiny flowers, individual roof tiles, laundry detail, crates, and ornamental noise. The image must stay beautiful and inhabited at distance through silhouette, palette blocks, openings, and one or two high-value accents per building.
Composition/framing: three fully visible disconnected modules with generous transparent-removal padding and broad separation; no overlaps; no cropping; similar overall placement to the reference.
Lighting/mood: one coherent warm upper-left light, readable dark openings, restrained contact cues only inside each building silhouette.
Constraints: exactly three modules; the central arch opening must remain fully open and unmistakable; both shop awnings must remain distinct; workshop awning and tall roof hierarchy must remain distinct; no ground, road, quay, water, scenery, characters, labels, text, logo, or watermark; no cast shadow or contact shadow onto the background; do not use #ff00ff or magenta anywhere in the buildings; background must remain one perfectly flat chroma color.
Avoid: icon badges, sticker outlines, miniature toy look, generic fantasy castle, extra buildings, merged components, repeated facades, black outlines, photorealism, blur, halos, busy fine detail.
```

The generated source is not selected merely because it looks plausible. It
must pass deterministic chroma derivation, semantic opening checks, typed
per-resolution loading, faithful octant comparison against normal reduction,
and memory accounting before use.
