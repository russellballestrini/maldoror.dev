/**
 * Generate AI terrain tiles (base + transitions) with OpenAI gpt-image-1-mini,
 * save PNGs to apps/ssh-world/data/terrain/<id>/<res>.png and upsert into the
 * terrain_tiles DB table (what game-worker loads at startup).
 *
 * Usage (needs OPENAI_API_KEY + DATABASE_URL in env):
 *   cd apps/ssh-world && node ../../tools/gen-terrain.mjs [--only-base] [--pairs grass:dirt,grass:water]
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const { generateBaseTerrain, generateTransitionTiles } =
  await import(`${REPO}/packages/ai/dist/terrain-generator.js`);
const { saveTerrainTileToDisk } =
  await import(`${REPO}/apps/ssh-world/dist/utils/terrain-storage.js`);
const { db, schema } = await import(`${REPO}/packages/db/dist/index.js`);

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) { console.error('OPENAI_API_KEY required'); process.exit(1); }

const args = process.argv.slice(2);
const onlyBase = args.includes('--only-base');
const pairsArg = args.find(a => a.startsWith('--pairs'));
const pairs = pairsArg
  ? (pairsArg.split('=')[1] ?? args[args.indexOf(pairsArg) + 1]).split(',').map(p => p.split(':'))
  : [['grass', 'dirt'], ['grass', 'water']];

const QUALITY = 'medium';

async function upsertTile(tile) {
  const row = {
    id: tile.id,
    name: tile.name,
    pixels: JSON.stringify(tile.pixels),
    walkable: tile.walkable,
    resolutions: tile.resolutions ? JSON.stringify(tile.resolutions) : null,
    animated: tile.animated ?? false,
    animationFrames: tile.animationFrames ? JSON.stringify(tile.animationFrames) : null,
    animationResolutions: tile.animationResolutions ? JSON.stringify(tile.animationResolutions) : null,
  };
  await db.insert(schema.terrainTiles).values(row)
    .onConflictDoUpdate({ target: schema.terrainTiles.id, set: row });
}

async function persist(tile) {
  await saveTerrainTileToDisk(tile);
  await upsertTile(tile);
  console.log(`[persist] ${tile.id} -> disk + db`);
}

console.log(`[gen-terrain] base=5 pairs=${onlyBase ? 'none' : pairs.map(p => p.join('->')).join(',')} quality=${QUALITY}`);

// 1. Base tiles
const baseTiles = await generateBaseTerrain({
  apiKey, quality: QUALITY,
  outputDir: `${REPO}/tools/render-sim/terrain-debug`,
  onProgress: (s, c, t) => console.log(`[base ${c}/${t}] ${s}`),
});
for (const tile of baseTiles.values()) await persist(tile);

// 2. Transition sets
if (!onlyBase) {
  for (const [from, to] of pairs) {
    console.log(`[transitions] ${from} -> ${to}`);
    const tiles = await generateTransitionTiles(from, to, {
      apiKey, quality: QUALITY,
      outputDir: `${REPO}/tools/render-sim/terrain-debug`,
      onProgress: (s, c, t) => console.log(`[${from}->${to} ${c}/${t}] ${s}`),
    });
    for (const tile of tiles.values()) await persist(tile);
  }
}

const count = await db.select().from(schema.terrainTiles);
console.log(`[gen-terrain] DONE — terrain_tiles rows: ${count.length}`);
process.exit(0);
