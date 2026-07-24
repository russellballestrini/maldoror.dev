# Regional parcel component source V1

- Generator: built-in Codex/ChatGPT image generation subscription; no metered API
- Tool output: `exec-04b3ac29-9900-42d0-a3c4-68102e6cdc46.png`
- Source SHA-256: `065f326ae106866d85f79dfa07137601a29f584e1f13b11d12f6ea0bfb207056`
- Derivation: `pnpm assets:derive-parcel-components`

Prompt:

> Create a production sprite-source atlas for the Maldoror ANSI world renderer. One image, exactly 3 equal columns by 2 equal rows, semantic order canal town, forest, coast / rural, mountain, ruins. The entire background and empty space must be solid pure chroma magenta `#ff00ff`, without texture, gradient, vignette, cast ground shadow, border, label, gutter, terrain, or water. Inside each large cell arrange exactly four separate compact orthographic three-quarter-view silhouette modules in a clean 2x2 subgrid, each isolated by a generous magenta moat. These are individual masses, not compounds or terrain tiles. Use consistent warm upper-left light, painterly high-detail game art, strong top-down RPG silhouettes, weathered materials, no people or UI. Make all 24 modules structurally distinct: canal townhouse, quay workshop, market pavilion, boat shed; forest twin canopy, log shelter, hunter lean-to, mushroom stump; coast wind pine, driftwood shrine, fishing rack, dune hut; rural orchard gate, stone barn, produce awning, field shed; mountain crag pine, mine gantry, cairn shelter, alpine hut; ruins broken arch, paired columns, collapsed tower, wayside shrine. Avoid repeated copies, mirrors, long walls, U compounds, rings, and large rectangular footprints. Preserve transparent-looking magenta around every module for deterministic unrotated placement around compositor-owned paths.

The generated sheet obeyed the effective 6x4 isolated-module grid and was accepted for alpha derivation. Runtime collision and placement remain explicit manifest semantics; the generated pixels do not decide either.
