# Default traveler terminal LOD v2 provenance

- Generated: 2026-07-23
- Generator: Codex built-in ChatGPT image-generation capability, subscription path; no metered image API
- Built-in generation id: `019f8e29-3738-74d1-9d1f-685be5d47c1e/exec-dc2d5f7e-bf9e-4d58-bdc0-8f9f573d365a.png`
- Character reference: `assets/canal-town/avatars/default-traveler-vivid.png`
- Untouched result: `default-traveler-terminal-v2-source.png`
- Runtime derivative: `../avatars/default-traveler-terminal-v2.png`

## Prompt

> Use case: stylized-concept
>
> Asset type: production top-down terminal RPG character sprite source; will be reduced to a 16x24 logical pixel silhouette
>
> Primary request: create one new front-facing full-body traveler sprite based on Image 1 as a character reference, redesigned specifically as readable game pixel art rather than a portrait
>
> Input images: Image 1: character identity, blue hooded cloak, warm brown hair, amber-gold trim, leather satchel and boots reference only
>
> Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for removal, uniform edge to edge
>
> Subject: one young blue-hooded traveler, standing neutrally, compact heroic proportions, large clearly separated hood/head, narrow torso, two distinct arms, two distinct boots, tiny warm face highlight, satchel as one readable side shape
>
> Style/medium: hand-authored premium 16-bit pixel art sprite, deliberately low-frequency forms, limited high-contrast palette, large square logical pixels, no painterly microdetail, no antialiasing, no gradients
>
> Composition/framing: exactly one isolated sprite centered, front-facing with a slight top-down game-camera read, generous padding, full body visible, no sprite sheet and no alternate poses
>
> Lighting/mood: warm top-left key represented as simple pixel clusters; crisp dark outline; excellent silhouette at 16x24 pixels
>
> Color palette: saturated royal blue, deep navy outline, warm ochre-gold trim, brown hair and leather, pale warm face; do not use green anywhere in the subject
>
> Constraints: prioritize recognition after reduction to 16x24; every shape must be broad and discrete; perfectly flat #00ff00 background with no floor, shadow, gradient, texture, reflection, or variation; crisp hard edges; no text; no watermark
>
> Avoid: portrait anatomy, realistic rendering, white background, cast shadow, contact shadow, semitransparency, soft edges, tiny decorative detail, weapons, extra objects, extra characters

## Deterministic derivation

1. Remove the sampled border key with the imagegen skill's `remove_chroma_key.py`, soft matte, thresholds 12/220, and despill.
2. Trim transparent bounds and nearest-sample the figure to 14x22 logical pixels.
3. Add one logical pixel of transparent padding to make a 16x24 master.
4. Nearest-scale to 128x192 and palette-quantize to 20 colours (the result currently uses 15 including transparency).

