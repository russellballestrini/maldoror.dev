# Canal-town civic-life atlas v1

- Generated: 2026-07-25
- Mode: Codex built-in image generation on the ChatGPT subscription
- Metered API spend: none
- Style reference: `regional-ambient-atlas-v2-source.png`
- Style-reference SHA-256: `db9a703dd28342b265d926f48cb6d4b6a4bbfbc57b410d7c9b94ebb2d84aa4f7`
- Generated source: `canal-town-civic-life-atlas-v1-source.png`
- Generated-source SHA-256: `65cb523e5179aeaf014c1bcd4af679857bb594bf7af5bb7b4ce67f6f82172e3a`

## Exact prompt

```text
Use case: stylized-concept
Asset type: source atlas for small isometric game-environment sprites rendered through a 160x44 terminal
Input images: Image 1 is a STYLE REFERENCE ONLY for the existing painterly isometric sprite language, warm material rendering, dark readable outlines, and isolated magenta-key atlas layout. Create new subjects; do not copy its objects.
Primary request: create exactly four distinct, low-profile civic-life modules for a lived-in Mediterranean canal-town arrival plaza.
Scene/backdrop: a perfectly flat uniform solid #ff00ff chroma-key background, divided conceptually into a precise 2 by 2 grid with one isolated module centered in each equal quadrant and generous empty magenta padding; no visible divider lines.
Subjects, exactly one per quadrant:
1. upper left: a low pale-limestone public bench with two tiny seated townsfolk in muted ochre and faded blue clothing, plus one woven basket at their feet;
2. upper right: a compact wooden market handcart with a small worn ochre canvas shade, terracotta produce crates, folded cloth, and a clear narrow passage beside it;
3. lower left: two short dark-iron quay lantern bollards with coiled rope, a pair of flower pots, and worn stone bases;
4. lower right: a small weathered pale-stone drinking fountain or public well with one amphora, a few pigeons, moss, and chipped edges.
Style/medium: painterly isometric game sprite art, matching Image 1's visual language; coherent three-quarter top-down view; materially detailed but designed to survive aggressive downsampling; slightly irregular lived-in silhouettes.
Composition/framing: every module fully contained within its own quadrant; low horizontal silhouette, no subject taller than roughly 60 percent of a quadrant; consistent ground baseline and isometric viewpoint; strong readable negative spaces; no overlap between quadrants.
Lighting/mood: soft warm daylight from upper left, restrained cast shading confined to each object, aged civic warmth rather than pristine fantasy.
Color palette: pale limestone, oxidized iron, faded ochre, muted terracotta, dusty blue, small natural greens; never use #ff00ff in any subject.
Constraints: the background must be exactly one uniform flat #ff00ff with no gradient, texture, floor plane, reflections, atmospheric haze, or background shadows; crisp isolated edges; no text, labels, borders, logos, watermark, UI, loose detached fragments, giant buildings, combat items, or modern objects.
```

The four runtime sprites are deterministic crops, chroma-key removals, trims,
and transparent pads produced by `pnpm assets:derive-canal-civic-details`.
