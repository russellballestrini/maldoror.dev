/**
 * G2: generate mockup-style multi-tile BUILDINGS (2x2 tiles) with transparent
 * backgrounds, sliced into per-tile 256px PNGs + resolution pyramids.
 * Output: tools/render-sim/buildings-canal/<id>/tile_<tx>_<ty>_<res>.png
 * (showcase composites these; game wiring via the buildings table comes next)
 *
 * Usage (env: OPENAI_API_KEY): node tools/gen-buildings.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const require2 = createRequire(path.join(REPO, 'packages/ai/package.json'));
const OpenAIModule = require2('openai');
const OpenAI = OpenAIModule.default ?? OpenAIModule;
const { toFile } = OpenAIModule;

const RESOLUTIONS = [26, 51, 77, 102, 128, 154, 179, 205, 230, 256];
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const STYLE_REF = fs.readFileSync(path.join(REPO, 'tools/render-sim/style-anchor.png'));
const OUTBASE = path.join(REPO, 'tools/render-sim/buildings-canal');

const STYLE = `Match the EXACT art style of the reference image: warm pastel storybook pixel-art,
cozy canal-town aesthetic, soft painterly light. Top-down RPG view with slight 3/4 perspective
(we see the roof and the front face). The building must be FULLY visible and centered.
TRANSPARENT background — nothing but the building. No characters, no text.`;

const BUILDINGS = [
  ['shop_awning', `A cozy market shop: warm cream stone walls, terracotta tiled roof,
red-and-white striped awning over a small storefront with crates of goods, flower boxes
with pink flowers, a hanging sign. Like the shops in the reference.`],
  ['house_tall', `A tall narrow canal house: cream stone walls, terracotta tiled roof with
a chimney, green shuttered windows, a wooden door with a small awning, flower pots.
Like the houses in the reference.`],
];

async function genImage(prompt) {
  const result = await openai.images.edit({
    model: 'gpt-image-1-mini',
    image: await toFile(STYLE_REF, 'style.png', { type: 'image/png' }),
    prompt, size: '1024x1024', quality: 'medium', background: 'transparent',
  });
  return Buffer.from(result.data[0].b64_json, 'base64');
}

for (const [id, desc] of BUILDINGS) {
  console.log(`[building] ${id}...`);
  const img = await genImage(`${STYLE}\n\nCreate: ${desc}`);
  const dir = path.join(OUTBASE, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'original.png'), img);

  // Trim transparent margins, fit into 512x512 (= 2x2 tiles at 256)
  const trimmed = await sharp(img).trim({ threshold: 10 }).toBuffer();
  const fitted = await sharp(trimmed)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  fs.writeFileSync(path.join(dir, 'fitted_512.png'), fitted);

  // Slice into 2x2 tiles, each with a resolution pyramid
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const tile256 = await sharp(fitted)
        .extract({ left: tx * 256, top: ty * 256, width: 256, height: 256 })
        .png().toBuffer();
      for (const res of RESOLUTIONS) {
        const buf = res === 256 ? tile256 :
          await sharp(tile256).resize(res, res, { kernel: res <= 77 ? 'lanczos3' : 'nearest' }).png().toBuffer();
        fs.writeFileSync(path.join(dir, `tile_${tx}_${ty}_${res}.png`), buf);
      }
    }
  }
  console.log(`[building] ${id} sliced (2x2 x ${RESOLUTIONS.length} res)`);
}
console.log('[gen-buildings] DONE');
process.exit(0);
