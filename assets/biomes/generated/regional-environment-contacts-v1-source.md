# Regional environment-contact source V1

- Generator: built-in Codex/ChatGPT image generation subscription; no metered API
- Tool output: `exec-ad339e1a-1573-4123-acb7-798d70d72ae5.png`
- Source SHA-256: `747d7ad1864f9d758c59e3d8ffc8ccaf54550cbde6fa1fa0f7070022d09aca0c`
- Derivation: `pnpm assets:derive-environment-contacts`

Prompt:

> Create a production sprite-source atlas for the Maldoror painterly ANSI-world renderer. One image, exactly 4 equal columns by 2 equal rows. Entire background and all empty space must be solid pure chroma magenta #ff00ff, perfectly flat: no texture, gradient, vignette, cast ground shadow, border, labels, gutters, terrain patches, water patches, paths, or UI. Put exactly one isolated compact orthographic three-quarter-view environmental silhouette in each cell, centered with a generous uninterrupted magenta moat on all four sides. Consistent warm upper-left light, painterly high-detail top-down RPG art, strong readable silhouettes at tiny scale, weathered materials, no people, no text. Top row, four structurally distinct coast/headland contacts in this exact order: windswept pine growing from a narrow stratified sea-cliff crag; broken timber jetty posts and short elevated landing with no painted water; tidal basalt stack with a small natural arch and seaweed hanging from the rock but no painted water; compact stone beacon tower on an eroded headland crag. Bottom row, four structurally distinct cave/highland contacts in this exact order: deep dark cave mouth cut into a steep fractured rock face with a narrow stone threshold but no ground apron; slender waterfall emerging between mossy highland rocks with only the falling water and rock silhouette, no pool or painted ground; abandoned mine gantry and timber stair braced into a crag; alpine way-shrine and cairn sheltered against a jagged ridge spur. Each object must be self-contained, irregular, materially rich, and visually distinct. Avoid repeated copies, mirrors, long walls, compounds, large rectangular footprints, complete floor slabs, square stamps, roads, shorelines, oceans, grass, and background scenery. Preserve pure magenta around every silhouette for deterministic alpha extraction and unrotated placement over compositor-owned terrain.

The source was accepted because all eight silhouettes are isolated, have strong
small-scale shape differences, and do not paint terrain or water. Runtime
placement and collision are declared in the manifest; pixels do not infer
geography.
