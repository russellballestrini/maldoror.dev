# Regional ambient atlas V2 source provenance

- Generated: 2026-07-23
- Path: built-in Codex/ChatGPT image edit; no metered image API
- Edit target: `regional-ambient-atlas-v1-source.png`
- Source: `regional-ambient-atlas-v2-source.png`
- SHA-256: `db9a703dd28342b265d926f48cb6d4b6a4bbfbc57b410d7c9b94ebb2d84aa4f7`
- Source dimensions: 1448 x 1086
- Derivation: `pnpm assets:derive-ambient` (defaults to V2)

## Exact edit prompt

```text
Use case: precise-object-edit
Asset type: painterly top-down-oblique game ambient silhouette and route-contact sprite atlas for chroma-key extraction
Input images: Image 1 is the edit target, the exact twelve-cell regional ambient atlas.
Primary request: change only the small flat painted ground/path/floor aprons in the route-threshold cells and replace those removed pixels with the exact surrounding solid magenta chroma-key background.
Required removals: cell 7 (row 2 column 3, canal-town constructed-bank contact)—remove the flat paving/floor strip visible through and in front of the central opening, while preserving both upright quay-wall halves, short stair structure, wall faces, caps, bollards, flower pots, and the full clean central negative-space threshold; cell 10 (row 3 column 2, rural field-edge)—remove the flat beige soil/path wedge behind and through the open gate, while preserving the low dry-stone walls, shed, hedge, both gateposts, open gate leaf, and clean threshold. In every other cell, remove any loose flat painted ground plane extending beyond structural base stones, roots, vegetation, rubble, or foundations, but preserve all rooted vegetation, structural rocks, scree, rubble masses, masonry bases, and upright subjects.
Invariants: preserve the exact 4x3 layout and cell order, every vertical subject, scale, silhouette, top-down three-quarter viewpoint, late-afternoon light from upper left, palette, physical texture, open gates/thresholds, equal padding, and bottom alignment. Do not redesign, add, move, crop, or restyle any object.
Background: perfectly flat uniform solid magenta chroma-key everywhere outside retained subjects and through cleared thresholds; keep the straight gutters and cell backgrounds; no shadows, gradients, texture, reflections, floor plane, lighting variation, labels, text, watermark, extra objects, or new colors. Do not introduce magenta into retained subjects.
```
