# Regional biome material kit

The V1 atlas is a bounded source-art prototype generated through Codex's
built-in ChatGPT image workflow. It uses no metered image API. The untouched
source, exact prompt, hash, derived masters, and semantic manifest live here.

The V2 successor is deliberately hybrid rather than a wholesale replacement.
Faithful 160x44 octant comparison selected its less-seamed canal paving and
coast marsh masters while retaining V1 forest, rural, mountain, and ruins
identity. The V2 source note records both accepted and rejected derivatives.

Run `node tools/render-sim/derive-biome-materials.mjs` to detect the flat
magenta gutters and reproduce the six square material masters. Crop geometry is
derived from the source image rather than hand-maintained coordinates.

These masters establish a shared painterly material language; they do not by
themselves constitute six production biomes. Regional weights, continuous
multi-material composition, ecology, routes, silhouettes, assets, LODs,
collision, and faithful terminal review remain separate gates.

The paired V1 route-contact atlases add one north–south and one east–west
walkable threshold for every family. They were authored separately under a
fixed screen-space light; the runtime does not rotate pixels. The semantic
manifest owns access axis, route-distance band, central sprite anchor,
collision, density, and provenance. Run `pnpm assets:derive-route-contacts` to
reproduce the 12 soft-alpha sprites. These are first parcel-edge seeds, not a
complete building/parcel library or permission to switch the live provider.
