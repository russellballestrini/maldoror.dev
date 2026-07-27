# Regional material atlas V2 source

- Generated: 2026-07-27
- Mode: Codex built-in image generation on the ChatGPT subscription
- Metered image/API credit: none
- Reference: V1 source atlas, used for art direction and palette only
- Untouched source: `regional-materials-atlas-v2-source.png`
- Source SHA-256: `e8262e6f33fc65bd7105ab627714794038f4a3ecca7aeb8fe919fd03b77138ac`
- Intended derivation: `tools/render-sim/derive-biome-materials.mjs`
- Selected derivatives:
  - `materials/canal-town-paving-master-v2.png` — `96f9cf3846d810cfb78af4413493d169022a4c4008fb23e5b25522da65d76ef7`
  - `materials/coast-marsh-master-v2.png` — `a5120d869b95f49635167619085db9a9dd9308ee54bbe39ca242582f38ef2efa`
- Rejected derivatives: forest, rural, mountain, and ruins remain on V1 after
  direct faithful-octant review; V2 softened or repeated their defining motifs.

## Prompt

> Use case: stylized-concept
> Asset type: source atlas for tileable game textures in a painterly ANSI terminal world
> Input images: Image 1 is a style and palette reference only; generate a new successor atlas, do not edit or copy exact motifs.
> Primary request: create one exact 3-column by 2-row atlas of six richly hand-painted, orthographic top-down terrain materials designed to be cropped into independent square-ish source textures and reconstructed aperiodically.
> Panel order: top-left warm canal-town limestone paving with subtle moss and sparse tiny pink petals; top-middle deep forest floor with leaf litter, roots, ferns and restrained flowers; top-right coast marsh shallows with sand, clear blue-green water, stones and reeds; bottom-left rural orchard ground with grass, earth paths, sparse fallen fruit and small flowers; bottom-middle mountain highland with fractured slate, gravel, dry alpine grass and restrained purple heather; bottom-right ancient ruins floor with broken geometric mosaic, moss, roots and weathered stone.
> Style/medium: premium painterly game-environment texture, naturalistic hand-painted realism, coherent with Image 1, rich material identity but optimized for ANSI downsampling.
> Composition/framing: perfectly orthographic top-down; six equal panels; broad, medium and fine texture clusters in every panel; no horizon and no perspective; no single dominant focal object.
> Grid/background: panels separated on all sides by perfectly flat solid #ff00ff magenta gutters, uniform color with no shadow, glow, texture or antialias spill; generous outer magenta border; do not use #ff00ff inside any material panel.
> Seam behavior: each individual panel must have statistically matching opposite edges, continuous lighting and scale, no vignette, no edge darkening, no frame, and no obvious repeating central motif; suitable for seamless quilting and multi-resolution sampling.
> Lighting/mood: diffuse neutral overcast reference lighting, no cast shadows, no directional sun.
> Constraints: exactly six panels in the stated order; no labels, no text, no buildings, no characters, no props larger than natural ground details, no logos, no watermark; restrained high-frequency noise so each material remains readable at 8px, 16px and 32px terminal resolutions.
