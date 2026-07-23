/**
 * G2: mockup-style world furniture — a canal bridge + props (lamp post,
 * planter, market umbrella, rowboat). Transparent-bg, sliced into per-tile
 * PNGs like gen-buildings.mjs. Bridge = 3x2 tiles; props = 1x1.
 * Output: tools/render-sim/props-canal/<id>/tile_<tx>_<ty>_<res>.png
 *
 * node tools/gen-props.mjs   (env: OPENAI_API_KEY)
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
const OUTBASE = path.join(REPO, 'tools/render-sim/props-canal');

const STYLE = `Match the EXACT art style of the reference image: warm pastel storybook pixel-art,
cozy canal-town, soft painterly light. Top-down RPG view, slight 3/4 perspective.
FULLY visible, centered. TRANSPARENT background — nothing but the object. No text.`;

// [id, cols, rows, prompt]
const PROPS = [
  ['bridge_h', 3, 2, `An arched stone footbridge crossing a canal LEFT-to-RIGHT: pale sandstone like the
reference's bridges, low balustrade railings, a gentle arch, a couple of potted pink flowers on it.`],
  ['lamp_post', 1, 1, `A wrought-iron canal lamp post with a warm glowing lantern and a hanging flower basket,
like the reference's street lamps.`],
  ['planter', 1, 1, `A wooden planter box overflowing with pink and white flowers and green foliage,
like the reference's flower boxes.`],
  ['umbrella_stall', 1, 1, `A small market stall with a pink-and-white striped umbrella and crates of fruit,
like the reference's canal-side stalls.`],
  ['rowboat', 1, 1, `A small wooden rowboat floating, viewed top-down, like the reference's canal boats.`],
];

async function genImage(prompt) {
  const result = await openai.images.edit({
    model: 'gpt-image-1-mini',
    image: await toFile(STYLE_REF, 'style.png', { type: 'image/png' }),
    prompt, size: '1024x1024', quality: 'medium', background: 'transparent',
  });
  return Buffer.from(result.data[0].b64_json, 'base64');
}

for (const [id, cols, rows, desc] of PROPS) {
  console.log(`[prop] ${id} (${cols}x${rows})...`);
  const img = await genImage(`${STYLE}\n\nCreate: ${desc}`);
  const dir = path.join(OUTBASE, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'original.png'), img);

  const trimmed = await sharp(img).trim({ threshold: 10 }).toBuffer();
  const fitted = await sharp(trimmed)
    .resize(cols * 256, rows * 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();

  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    const tile256 = await sharp(fitted)
      .extract({ left: tx * 256, top: ty * 256, width: 256, height: 256 }).png().toBuffer();
    for (const res of RESOLUTIONS) {
      const buf = res === 256 ? tile256 :
        await sharp(tile256).resize(res, res, { kernel: res <= 77 ? 'lanczos3' : 'nearest' }).png().toBuffer();
      fs.writeFileSync(path.join(dir, `tile_${tx}_${ty}_${res}.png`), buf);
    }
  }
  console.log(`[prop] ${id} sliced`);
}
console.log('[gen-props] DONE');
process.exit(0);
