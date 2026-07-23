# Regional route-contact source atlases — V1

Generated 2026-07-23 with the built-in Codex/ChatGPT image-generation tool
through the user's subscription. No metered image/API credit was used. The
existing V2 ambient atlas was supplied only as a style reference.

Accepted sources:

- `regional-route-contacts-ns-v1-source.png` — SHA-256
  `1f973c1723770d3158e62011c697a6d87c92230c9aefa7607569a24f210f757a`
- `regional-route-contacts-ew-v1-source.png` — SHA-256
  `a88d32d52df7bf240afd0807d2be3e19bad13811071d575d6e5e7f9b3578443d`

The failed edit that moved the connector but left both masses on the same
left/right axis is retained under the mounted research record as
`regional-route-contacts-v1/rejected-orthogonal-edit-left-right-masses.png`
(SHA-256 `b2a3ccd2ff773dde85277ddb7710efb67c332eafe9f9e481c61547886a5c3ca0`).

## North–south connector prompt (accepted)

```text
Use case: stylized-concept
Asset type: production game route-contact sprite atlas, north-facing variant
Input image: style reference only; do not edit or copy its layout. Match its painterly hand-rendered game-sprite finish, oblique top-down camera, fine material texture, readable silhouette, coherent warm upper-left light, and restrained dark contact grounding.
Primary request: create one exact regular 3-column by 2-row atlas containing six isolated route-facing parcel thresholds. Every cell must contain exactly one complete subject, centered with generous padding, in this exact order:
top-left dense canal town: a low weathered stone quay/frontage with one small open pedestrian threshold, a few iron bollards, one lantern and restrained planters;
top-middle deep forest: a living hedge and old log/stone woodland edge with one open trail threshold, ferns and roots;
top-right coast: a wind-bent dune fence, reeds, driftwood and small rocks with one open sandy threshold;
bottom-left rural: an orchard hedge and low dry-stone wall with one open timber gate threshold;
bottom-middle mountain: a low rocky retaining edge with dwarf pine and one narrow open highland-pass threshold;
bottom-right ruins: a broken ancient wall/column edge with one open worn threshold, moss and restrained rubble.
Direction/layout invariant: these are NORTH-FACING contacts. In every cell, the frontage/edge runs horizontally left-to-right and the open threshold is centered. A very narrow irregular access strip passes through the opening and exits toward the TOP edge of the cell, showing that the route lies north of the parcel. The access strip must be only a thin semantic connector, never a broad painted ground apron.
Scene/backdrop: perfectly flat uniform solid #ff00ff chroma-key background, including gutters and cell borders.
Composition/framing: exact equal 3x2 grid, no overlap across cells, no cropping, consistent apparent scale, each subject uses roughly 65 percent of its cell.
Lighting/mood: coherent upper-left warm daylight across all six sprites; painterly depth and contact shading stay attached to the subject.
Constraints: no people, creatures, vehicles, signs, labels, text, watermark, UI, complete buildings, square floor plates, rectangular terrain islands, broad grass/soil/sand/stone aprons, long roads, cast shadows floating on the chroma background, gradients or texture in the background. Do not use #ff00ff in any subject. Keep the four outer corners of every cell pure #ff00ff. Preserve openings as visibly walkable negative space.
```

## First orthogonal edit prompt (rejected)

```text
Use case: precise-object-edit
Asset type: production game route-contact sprite atlas, orthogonal east-west access variant
Input image: edit target.
Primary request: keep the exact 3-column by 2-row atlas, the six biome subjects, their identity, materials, scale, detail density, painterly rendering, chroma background, padding, and order unchanged. Redraw only the spatial orientation of every threshold/contact by ninety degrees in the ground plane so it is a genuinely authored orthogonal variant, not a mechanically rotated bitmap.
Required geometry change in all six cells: the frontage/edge mass must now recede vertically from top to bottom, and the centered narrow walkable access strip must pass through its opening and extend horizontally toward both the LEFT and RIGHT sides of the cell. The route connector must read clearly left-to-right. Preserve the open negative-space threshold.
Lighting invariant: keep world/screen lighting from the upper-left exactly as in the input; highlights and shadows must be repainted so the light direction does not rotate with the geometry.
Preserve exactly: top-left canal quay/frontage; top-middle forest hedge/log/stone edge; top-right coast dune fence/reeds/driftwood; bottom-left rural orchard/dry-stone wall/gate; bottom-middle mountain retaining crag/dwarf pine; bottom-right broken ruins wall/columns.
Scene/backdrop: perfectly flat uniform solid #ff00ff chroma-key background, including gutters and borders.
Constraints: change only the ground-plane orientation and necessary perspective/lighting response. No people, creatures, vehicles, signs, labels, text, watermark, UI, complete buildings, square floor plates, rectangular terrain islands, broad aprons, long roads, floating cast shadows, background gradients or texture. Do not use #ff00ff in subjects. Keep all cell corners pure #ff00ff and all subjects uncropped.
```

Rejection: the edit changed the connector direction but kept the two dominant
masses as left/right halves. It therefore failed the requested orthogonal
front/back parcel geometry even though the image was attractive.

## East–west connector prompt (accepted)

```text
Use case: stylized-concept
Asset type: production game route-contact sprite atlas, east-west access variant
Input image: style reference only. Match its painterly hand-rendered game-sprite finish, oblique top-down camera, material detail, silhouette scale, coherent warm upper-left light, and restrained contact grounding.
Primary request: create one exact regular 3-column by 2-row atlas containing six isolated route-facing parcel thresholds, in this exact order:
top-left canal-town quay/frontage; top-middle forest hedge/log/stone edge; top-right coast dune fence/reeds/driftwood edge; bottom-left rural orchard/dry-stone wall/gate; bottom-middle mountain retaining crag/dwarf-pine edge; bottom-right broken ruins wall/columns.
CRITICAL ORTHOGONAL GEOMETRY: in every cell, place one part of the frontage mass in the BACK/TOP half of the cell and the other part in the FRONT/BOTTOM half. They form a boundary receding vertically in the ground plane. Leave a clear centered corridor between these top and bottom masses. A very narrow irregular walkable access strip must run LEFT-TO-RIGHT through that corridor and touch both the left and right directions. It must look like an east-west route connector. Do not arrange the two main masses as left and right halves. Do not draw a north-south path.
Scene/backdrop: perfectly flat uniform solid #ff00ff chroma-key background including gutters and cell borders.
Composition/framing: exact equal 3x2 grid, no overlap, no cropping, consistent scale, each subject roughly 65 percent of its cell, generous pure-magenta padding.
Lighting/mood: fixed upper-left warm daylight across all sprites; world-space highlights and shadows stay consistent.
Constraints: no people, creatures, vehicles, signs, labels, text, watermark, UI, complete buildings, square floor plates, rectangular terrain islands, broad grass/soil/sand/stone aprons, long roads, floating cast shadows, background gradients or texture. A thin access strip is allowed; broad painted ground is forbidden. Do not use #ff00ff in any subject. Keep every cell corner pure #ff00ff. Preserve the corridor as visibly walkable negative space.
```

Derive repeatably with `pnpm assets:derive-route-contacts`. The manifest owns
family, access axis, route-distance band, sprite anchor, placement density, and
collision. Runtime code never infers these semantics from pixels or filenames.
