# Canal-town side-canal frontage atlas v1

- Generator: Codex built-in image generation on the ChatGPT subscription
- Metered API spend: none
- Selected source: `canal-town-side-canal-frontage-v1-source.png`
- Selected source SHA-256: `54ea24529ba262e9a07bd2b8a02c582b4bc1faa71fb3fc7d34dd4510c7f94ba2`
- Selected source dimensions: 1536 x 1024
- Derivation: `pnpm assets:derive-side-canal-frontages`
- Chroma removal: imagegen skill `remove_chroma_key.py`, automatic border key,
  soft matte, despill, thresholds 12/220, trim, then 24 transparent pixels of
  padding.
- Bank orientation: the warehouse and boat-repair crops are deterministically
  mirrored during derivation. The market-house and inn/dwelling crops retain
  source orientation. This supplies authored silhouettes for both banks of a
  north-south canal without runtime rotation or filename inference.

## Initial generation prompt

> Create a single 1536x1024 sprite atlas on a perfectly flat, uniform saturated chroma-key green background (#00ff00), with NO shadows or marks on the green background and NO text, labels, borders, grid lines, or panel dividers. Arrange exactly four fully separated isometric painterly pixel-art architectural modules in a 2 by 2 layout, one centered in each quadrant, with generous green clearance around every silhouette and nothing crossing a quadrant boundary.
>
> These are compact secondary frontages for a beautiful Mediterranean canal town viewed from a high oblique 3/4 top-down angle. Every module must be authored as a LONG NORTH-SOUTH / VERTICAL street-and-canal edge in the composition: its receding facade line and attached pale limestone quay run predominantly from upper-left toward lower-right, rather than as a horizontal panoramic strip. Keep each module low-to-medium height and narrow enough to fit beside a canal without becoming a giant landmark. Match a warm painterly game-world style: aged cream and ochre plaster, limestone bases, terracotta roofs, teal shutters and awnings, softened organic edges, small flowers and vines, rich but restrained detail, coherent daylight from upper-left, no black outlines.
>
> Top-left: a compact working canal warehouse terrace with arched doors, hoist, rope, barrels, stacked crates, and a clear doorway opening onto the attached vertical limestone quay.
> Top-right: a lively narrow market-house frontage with teal awnings, produce baskets, flower pots, two linked entrances, and a visible uninterrupted vertical quay strip.
> Bottom-left: a boat-repair workshop row with timber doors, nets, spars, tools, pulley, and a small covered work bay, all accessed from a vertical limestone quay.
> Bottom-right: a modest inn-and-dwelling row with balconies, laundry, vines, lanterns, tables, and multiple doors addressing a vertical limestone quay.
>
> All four must read as different places, not recolors. Each silhouette must be complete and unclipped, with clean separable edges suitable for deterministic chroma-key removal and downsampling into transparent terminal-world sprites. No people, no boats, no water, no sky, no distant scenery; only architecture, work objects, vegetation accents, and its attached pale stone access/quay footprint.

The result remained too horizontal for the side canals. It is retained as
`composition-hierarchy-v116-side-canal-frontage-art/rejected-horizontal-source.png`
on the mounted research drive, SHA-256
`d0eccbda7a7c030968964ed1924fb5ae16a938283730a1e27532c64aec7a95e0`.

## First edit prompt (rejected after regional-scale inspection)

> Re-author this four-module sprite atlas while preserving its exact painterly Mediterranean materials, palette, high-oblique isometric viewpoint, flat uniform #00ff00 chroma background, clean separation, and the four distinct functions. The current modules are too wide and horizontal. Make EVERY module a genuinely TALL, NARROW north-south canal frontage silhouette: each attached limestone quay and facade row must recede predominantly from the lower foreground toward the upper background, with the complete silhouette substantially taller than it is wide in its quadrant (roughly 1:1.5 to 1:2 width:height). Think of a long narrow canal-side street seen end-on, not a panoramic elevation. Arrange one centered tall module in each quadrant of the 1536x1024 atlas with generous green clearance and nothing crossing quadrant boundaries.
>
> Keep:
> top-left working canal warehouse terrace with arched doors, hoist, ropes, barrels and crates;
> top-right narrow market-house frontage with teal awnings, produce and flower pots;
> bottom-left boat-repair workshop row with timber doors, nets, spars and covered work bay;
> bottom-right modest inn/dwelling row with balconies, laundry, vines, lanterns and small tables.
>
> Entrances must visibly address the continuous pale limestone quay running along the module's long receding axis. No people, boats, water, sky, scenery, text, labels, borders, shadows or marks on the green background. All silhouettes complete and unclipped, with clean chroma-key edges suitable for deterministic transparent-sprite derivation.

This edit achieved the required tall orientation, but its broad baked-in stone
platforms doubled the procedural quay edge and made the compact modules read as
small ships in V127 regional composition. It is retained as
`composition-hierarchy-v116-side-canal-frontage-art/rejected-baked-quay-source.png`
on the mounted research drive, SHA-256
`7dbb14226f7ddda753b7e015e14eeb48b60fc254895c06256bd1c5c64f6432aa`.

## Selected ground-blending edit prompt

> Edit this exact four-module 1536x1024 chroma-key sprite atlas while preserving the four tall narrow Mediterranean canal-front architecture silhouettes, their distinct functions, palette, painterly high-oblique isometric style, rooflines, facade details, props, vegetation, quadrant positions, full unclipped separation, and perfectly flat uniform #00ff00 background.
>
> Critical change: REMOVE the long broad pale limestone quay/platform slab attached to every module. The procedural world already renders the continuous quay, so baked-in stone strips create double edges and make the buildings look like boats at small scale. Each building row should meet the green background cleanly at its footprint. Retain only a very small architectural doorstep or threshold immediately in front of each visible door, no more than roughly one doorway deep, plus a few facade-adjacent barrels, crates, pots, tools, tables, bollards or hoist elements where appropriate. No long pavement tongue, no continuous stone strip, no detached platform, no water.
>
> Keep each module genuinely taller than wide and receding from lower foreground toward upper background:
> top-left working warehouse terrace;
> top-right market-house frontage;
> bottom-left boat-repair workshop row;
> bottom-right inn/dwelling row.
> Doors and thresholds must still clearly face the same canal-side edge, but surrounding ground must be chroma green so the runtime quay material can blend seamlessly beneath them.
>
> No people, boats, water, sky, scenery, text, labels, borders, panel lines, background shadows or marks. Clean chroma-key edges, complete silhouettes, generous green clearance, nothing crossing quadrant boundaries.

## Derived outputs

| Asset | Mirrored | Dimensions | Alpha coverage | Partial alpha | SHA-256 |
|---|---:|---:|---:|---:|---|
| warehouse frontage | yes | 404 x 493 | 0.343964 | 0.021193 | `bebfae276e9a7ec04402877222d0a9884b3f1c283e61f12712f5b3449b763505` |
| market-house frontage | no | 386 x 536 | 0.410660 | 0.037289 | `443d3d214a0dec7ae31b843aa810a104ff0975e5da5aadd34e6edc30667257b4` |
| boat-repair frontage | yes | 411 x 482 | 0.360456 | 0.034911 | `37b3cbafce0c10d4670fda35ba2eef665b46e242d873c5b6e21240d515ff0022` |
| inn/dwelling frontage | no | 428 x 524 | 0.414051 | 0.022486 | `bcd7aa643e6acb6dafe321f1dbbc535ebc5d12705835d56d2ed1da7b71f46afc` |

All four derived assets have transparent corners and non-zero soft alpha. The
source hash, output hashes, dimensions, coverage, and partial-alpha metrics are
enforced by the derivation script.
