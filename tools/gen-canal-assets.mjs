/**
 * Generate MOCKUP-STYLE canal-town terrain via images.edit with a style
 * reference (tools/render-sim/style-anchor.png — a crop of the target
 * mockup), so every tile matches the target art direction.
 *
 * Replaces base tiles stone/water/grass and adds stone_to_water autotiles.
 * Persists to data/terrain PNGs + terrain_tiles DB (live worker loads at boot).
 *
 * Usage (env: OPENAI_API_KEY, DATABASE_URL; cwd apps/ssh-world):
 *   node ../../tools/gen-canal-assets.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

// openai lives in packages/ai's dependency tree, not the repo root
const require2 = createRequire(path.join(REPO, 'packages/ai/package.json'));
const OpenAIModule = require2('openai');
const OpenAI = OpenAIModule.default ?? OpenAIModule;
const { toFile } = OpenAIModule;
const { saveTerrainTileToDisk } = await import(`${REPO}/apps/ssh-world/dist/utils/terrain-storage.js`);
const { db, schema } = await import(`${REPO}/packages/db/dist/index.js`);

const RESOLUTIONS = [26, 51, 77, 102, 128, 154, 179, 205, 230, 256];
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const STYLE_REF = fs.readFileSync(path.join(REPO, 'tools/render-sim/style-anchor.png'));
const OUTDIR = path.join(REPO, 'tools/render-sim/terrain-debug/canal');
fs.mkdirSync(OUTDIR, { recursive: true });

const STYLE = `Match the EXACT art style of the reference image: warm pastel storybook pixel-art,
soft painterly light, cozy canal-town aesthetic. Top-down orthographic view. Seamless/tileable.
Fill the ENTIRE image. No characters, no text, no UI.`;

const BASES = [
  ['stone', `Seamless tileable warm beige flagstone plaza pavement, like the reference's stone walkways. Subtle stone-tile grid, gentle color variation, a few tiny flower petals scattered.`, true],
  ['water', `Seamless tileable teal canal water like the reference's canals: gentle ripples, soft light sparkle, one or two small lily pads.`, false],
  ['grass', `Seamless tileable lush garden grass in the reference style: soft green with occasional tiny pink flowers and clover.`, true],
];

const EDGES = [
  ['n', 'the TOP edge'], ['e', 'the RIGHT edge'], ['s', 'the BOTTOM edge'], ['w', 'the LEFT edge'],
  ['ne', 'the TOP and RIGHT edges'], ['nw', 'the TOP and LEFT edges'],
  ['se', 'the BOTTOM and RIGHT edges'], ['sw', 'the BOTTOM and LEFT edges'],
];

async function genImage(prompt) {
  const result = await openai.images.edit({
    model: 'gpt-image-1-mini',
    image: await toFile(STYLE_REF, 'style.png', { type: 'image/png' }),
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

async function makeTile(id, name, buf, walkable) {
  const resolutions = {};
  for (const res of RESOLUTIONS) resolutions[String(res)] = await toPixelGrid(buf, res);
  return { id, name, pixels: resolutions['256'], walkable, resolutions };
}

async function persist(tile) {
  await saveTerrainTileToDisk(tile);
  const row = {
    id: tile.id, name: tile.name, pixels: JSON.stringify(tile.pixels),
    walkable: tile.walkable, resolutions: JSON.stringify(tile.resolutions),
    animated: false, animationFrames: null, animationResolutions: null,
  };
  await db.insert(schema.terrainTiles).values(row)
    .onConflictDoUpdate({ target: schema.terrainTiles.id, set: row });
  console.log(`[persist] ${tile.id}`);
}

for (const [id, desc, walkable] of BASES) {
  console.log(`[base] ${id}...`);
  const img = await genImage(`${STYLE}\n\nCreate: ${desc}`);
  fs.writeFileSync(path.join(OUTDIR, `${id}.png`), img);
  await persist(await makeTile(id, `canal ${id}`, img, walkable));
}

for (const [name, edgeDesc] of EDGES) {
  const id = `stone_to_water_${name}`;
  console.log(`[transition] ${id}...`);
  const img = await genImage(`${STYLE}

Create a terrain TRANSITION tile: warm beige flagstone plaza (like the reference's walkways)
occupying the center and most of the tile, transitioning to teal canal water at ${edgeDesc}.
The stone should end in a neat sandstone canal-edge curb (like the reference's canal borders)
where it meets the water. The water matches the reference's teal canals.`);
  fs.writeFileSync(path.join(OUTDIR, `${id}.png`), img);
  await persist(await makeTile(id, id, img, false));
}

const rows = await db.select().from(schema.terrainTiles);
console.log(`[gen-canal] DONE — terrain_tiles rows: ${rows.length}`);
process.exit(0);
