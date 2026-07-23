/**
 * G1 refinement pass:
 *  - Regenerate the 8 stone_to_water transitions using the GENERATED STONE
 *    BASE TILE as the images.edit reference (not the mockup crop), so the
 *    stone tone + texture match the base tile exactly and curb lines join.
 *  - Generate 2 extra water variants (water__v2, water__v3) for spatial
 *    variety (tile-provider picks variants by position hash).
 *
 * Usage (env: OPENAI_API_KEY, DATABASE_URL; cwd apps/ssh-world):
 *   node ../../tools/gen-canal-assets2.mjs
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

const { saveTerrainTileToDisk } = await import(`${REPO}/apps/ssh-world/dist/utils/terrain-storage.js`);
const { db, schema } = await import(`${REPO}/packages/db/dist/index.js`);

const RESOLUTIONS = [26, 51, 77, 102, 128, 154, 179, 205, 230, 256];
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OUTDIR = path.join(REPO, 'tools/render-sim/terrain-debug/canal2');
fs.mkdirSync(OUTDIR, { recursive: true });

const STONE_REF = fs.readFileSync(path.join(REPO, 'tools/render-sim/terrain-debug/canal/stone.png'));
const WATER_REF = fs.readFileSync(path.join(REPO, 'tools/render-sim/terrain-debug/canal/water.png'));

async function genImage(refBuf, prompt) {
  const result = await openai.images.edit({
    model: 'gpt-image-1-mini',
    image: await toFile(refBuf, 'ref.png', { type: 'image/png' }),
    prompt, size: '1024x1024', quality: 'medium',
  });
  return Buffer.from(result.data[0].b64_json, 'base64');
}

async function toPixelGrid(buf, size) {
  const { data, info } = await sharp(buf)
    .resize(size, size, { fit: 'cover', kernel: size <= 77 ? 'lanczos3' : 'nearest' })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const grid = [];
  for (let y = 0; y < info.height; y++) {
    const row = [];
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      row.push(data[i + 3] < 96 ? null : { r: data[i], g: data[i + 1], b: data[i + 2] });
    }
    grid.push(row);
  }
  return grid;
}

async function persistTile(id, name, buf, walkable) {
  const resolutions = {};
  for (const res of RESOLUTIONS) resolutions[String(res)] = await toPixelGrid(buf, res);
  const tile = { id, name, pixels: resolutions['256'], walkable, resolutions };
  await saveTerrainTileToDisk(tile);
  const row = {
    id, name, pixels: JSON.stringify(tile.pixels), walkable,
    resolutions: JSON.stringify(resolutions), animated: false,
    animationFrames: null, animationResolutions: null,
  };
  await db.insert(schema.terrainTiles).values(row)
    .onConflictDoUpdate({ target: schema.terrainTiles.id, set: row });
  console.log(`[persist] ${id}`);
}

const EDGES = [
  ['n', 'the TOP edge only'], ['e', 'the RIGHT edge only'],
  ['s', 'the BOTTOM edge only'], ['w', 'the LEFT edge only'],
  ['ne', 'the TOP and RIGHT edges'], ['nw', 'the TOP and LEFT edges'],
  ['se', 'the BOTTOM and RIGHT edges'], ['sw', 'the BOTTOM and LEFT edges'],
];

for (const [name, edgeDesc] of EDGES) {
  const id = `stone_to_water_${name}`;
  console.log(`[transition] ${id}...`);
  const img = await genImage(STONE_REF, `This image is a seamless stone plaza tile.
KEEP the stone texture, color and tone EXACTLY as-is across most of the tile.
Modify ONLY ${edgeDesc}: replace a strip (about 25% of the tile) along ${edgeDesc}
with calm teal canal water, separated from the stone by a thin straight sandstone
curb running the FULL LENGTH of that edge. The curb must reach both corners of the
tile edge so adjacent tiles connect seamlessly. Straight, clean edges — no rounded
corners, no frames. Top-down orthographic view. Fill the entire image.`);
  fs.writeFileSync(path.join(OUTDIR, `${id}.png`), img);
  await persistTile(id, id, img, false);
}

for (const v of [2, 3]) {
  const id = `water__v${v}`;
  console.log(`[variant] ${id}...`);
  const img = await genImage(WATER_REF, `This image is a seamless teal canal water tile.
Create a VARIATION with the same exact palette, tone and style: gentle ripples,
${v === 2 ? 'no lily pads at all, slightly different ripple pattern' : 'two small lily pads in different positions and a subtle light sparkle'}.
Seamless/tileable. Top-down orthographic. Fill the entire image.`);
  fs.writeFileSync(path.join(OUTDIR, `${id}.png`), img);
  await persistTile(id, id, img, false);
}

const rows = await db.select().from(schema.terrainTiles);
console.log(`[gen-canal2] DONE — terrain_tiles rows: ${rows.length}`);
process.exit(0);
