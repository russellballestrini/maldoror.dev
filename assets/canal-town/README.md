# Canal-town asset kit

This is the production modular kit for the first Maldoror neighbourhood. It was
generated with Codex's built-in ChatGPT image-generation capability (not the
metered API), using `tools/render-sim/gallery/TARGET.png` as the visual-quality
reference. The source atlases use a flat magenta key; the runtime consumes the
alpha-clean sprites listed in `manifest.json`.

The manifest is authoritative for placement roles, display scale, terrain IDs,
and collision footprints. The world generator does not classify assets from
their filenames or colors.

The four active terrain masters (`paving-stone`, `water`, `garden`, `curb`) were
generated through the same built-in subscription path. At worker boot they are
area-rasterized into four deterministic variants each and registered with
explicit walkability/material metadata. `paving-master.png` is retained as an
earlier source iteration but is not referenced by the manifest.

Generation brief, architecture atlas:

> Six isolated, reusable canal-town architecture sprites in a strict 3x2
> atlas: flower shop, blue canal house, bakery, pale-stone bridge, curved quay,
> and wooden dock. Match the target's warm pastel storybook orthographic
> painterly pixel-art, upper-left sunlight, terracotta/cream/teal palette, and
> dense flowers. Flat #ff00ff background; no scene, text, UI, characters,
> overlap, cropped objects, or watermark.

Generation brief, props atlas:

> Twelve isolated foliage and street props in a strict 4x3 atlas: olive tree,
> cypress, flowering shrub, stone planter, flower pots, canal lamp, market
> stall, rowboat, bench, fountain, banner post, and ivy trellis. Match the
> architecture atlas and target exactly. Flat #ff00ff background; no scene,
> text, UI, characters, overlap, cropped objects, or watermark.

The second architecture atlas adds the bookshop, pottery workshop, flower
conservatory, ivy cafe, teal house, and rose inn. The canal-details atlas adds
lilies, floating petals, moorings, flower boat, wildflower pots, quay planter,
lemon planter, and rose arch. A separate portrait-shaped generation supplies
the north/south stone bridge.

The original portrait-derived traveler failed faithful terminal review: its
body became only six source pixels wide and reconstructed as a navy H. The
active `default-traveler-terminal-v2.png` is instead a 16x24-logical-pixel LOD
master derived from a separate built-in subscription generation. Its hood,
face, cloak, satchel, and boots are deliberately broad, palette-limited forms.
The untouched generation and exact prompt are retained beside the runtime
artifact; the intermediate alpha-clean image and visual evidence live in the
mounted rendering-research tree.

The vertical bridge source required deterministic chroma-key cleanup after the
built-in image edit baked a checkerboard into its transparency preview. The
runtime PNG is the alpha-clean, defringed result; the untouched generated source
is retained for provenance and later reprocessing.

`generated/*-source.png` preserves the built-in tool output. The keyed atlases
and individual sprites are derived, inspectable artifacts; all runtime images
remain within this directory.
