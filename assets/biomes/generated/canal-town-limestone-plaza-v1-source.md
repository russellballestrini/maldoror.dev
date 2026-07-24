# Canal-town limestone plaza material source V1

- Generator: built-in Codex/ChatGPT image generation subscription; no metered API
- Tool output: `exec-9f4dc78d-efe6-45fb-b2b3-914ba577d085.png`
- Generated source: `canal-town-limestone-plaza-v1-source.png`
- Source dimensions: 1254x1254
- Source SHA-256: `bea851617a96081ab2880c24b73e78f57992fce9e9eb63f76e9f0ea946547e2d`
- Derived master: `../settlement-materials/canal-town-limestone-plaza-master-v1.png`
- Derived dimensions: 192x192
- Derived SHA-256: `c222aee0214cd67cdef746441515977b0487c0098750895957eec4f3ce4cc5f8`
- Derivation: Lanczos3 resize to 192x192, PNG compression level 9 with adaptive filtering. The runtime loader samples 96x96 quadrants, so this scale preserves several readable stones per variant instead of cropping a single oversized slab.

Prompt:

> Create a production-ready source texture for a painterly 2D terminal-world renderer. A single square, perfectly top-down orthographic material field of an old Mediterranean canal-town civic plaza and quay promenade: warm pale limestone and muted honey-colored stone pavers, mostly irregular rectangular and softly worn polygonal slabs at several related sizes, fine dark mortar joints, occasional repaired stones, subtle mineral staining, restrained moss only inside a few joints, tiny chips and hairline cracks, gentle tonal variation, and believable age. It must remain readable when sampled into 12-pixel world tiles and reconstructed as ANSI octant art, so use clear mid-scale stone cadence and avoid micro-noise. Uniform diffuse overcast illumination with no directional cast shadows, no vignette, no central focal object, no perspective, no depth-of-field, no raised curb, no border, no edge frame. The entire canvas is material; no background and no transparency. Texture-source quality, hand-painted realism, grounded historic material, matte surface, rich but restrained variation. Approximately seamless in all directions, but do not create an obvious repeating grid or identical rows. No flowers, grass tufts, leaves, water, buildings, characters, props, text, signs, symbols, logos, labels, UI, watermark, tile-grid overlay, checkerboard, isometric angle, glossy 3D render, or photogrammetry artifacts. Square 1:1 composition.

Runtime SDF geometry, irregular boundary feathering, water exclusion,
walkability, LOD, and family selection remain code- and manifest-owned.
