# Regional landmark atlas V2 source provenance

- Generated: 2026-07-23
- Path: built-in Codex/ChatGPT image edit; no metered image API
- Edit target: `regional-landmark-atlas-v1-source.png`
- Source: `regional-landmark-atlas-v2-source.png`
- SHA-256: `42e194ac430bc262c69393954fcd59781f48b9bf6562ecdc6f127247c146d332`
- Source dimensions: 1536 x 1024
- Derivation: `pnpm assets:derive-landmarks` (defaults to V2); set `MALDOROR_LANDMARK_VERSION=v1` to reproduce the rejected V1 cutouts

## Exact edit prompt

```text
Use case: precise-object-edit
Asset type: painterly top-down-oblique game landmark sprite atlas for chroma-key extraction
Input images: Image 1 is the edit target, the six-cell regional landmark atlas.
Primary request: remove only the flat painted ground islands/aprons from every one of the six cells and replace those removed pixels with the exact same perfectly uniform #ff00ff chroma-key background.
Cell-specific removals: canal-town—remove the visible water puddle and loose flat paving apron outside the vertical quay/building foundation, but keep the upright stone quay wall, stairs, posts, crane, flower pots, buildings, and open central threshold; forest—remove the flat leaf-litter/soil oval outside the tree roots, rocks, ferns, trunks, and understory; coast—remove the flat water/sand/path apron outside the rocks, reeds, tree, and beacon foundation; rural—remove the flat garden soil and path apron outside the hedge wall, open gate, farmhouse, trees, and rooted planting; mountain—remove the flat trail/ground apron outside the rock outcrop, cave structure, and pines; ruins—remove the flat tiled floor apron outside the standing arch, wall fragments, structural base stones, carved stones, and vines.
Invariants: change only those flat ground/apron areas. Preserve the exact 3x2 layout, every vertical subject, silhouette, scale, top-down three-quarter viewpoint, lighting from upper left, palette, texture, open doorways/gates/cave/arch, generous padding, and bottom alignment. Keep minimal structural foundation stones and roots needed for believable contact, but no broad painted ground patch may remain.
Background: perfectly flat solid #ff00ff everywhere outside subjects, including all six cell backgrounds and thick straight gutters; no shadows, gradients, texture, reflections, floor plane, lighting variation, labels, text, watermark, extra objects, or new colors. Do not introduce magenta into any retained subject.
```
