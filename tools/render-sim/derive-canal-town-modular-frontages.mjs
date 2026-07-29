import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE = path.join(
  ROOT,
  'assets/biomes/generated/canal-town-modular-frontage-atlas-v1-source.png',
);
const SOURCE_SHA256 = 'b3b2bb5db0814832feb284ffb99ae6d90a40108ebc7d30726cd3aa9d739afb45';
const KEYED_SHA256 = 'a200c3a96cca5acabb0843e787e039d1412e5f7ee4f36941ab755d12abf936c9';
const CHROMA_HELPER_SHA256 =
  '3f7b9b14ad5c90f37618bc1c16a039a2076abca12ddc41b3ae470e2b1cad6c0e';
const CHROMA_HELPER = process.env.MALDOROR_CHROMA_HELPER ?? path.join(
  process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
  'skills/.system/imagegen/scripts/remove_chroma_key.py',
);
const ASSETS = [
  {
    id: 'canal-town-modular-shops-frontage-v1',
    crop: '560x577+37+149',
    dimensions: [564, 581],
    outputSha256: 'b4c20b9d1aadf85bdbc14a09fc3ca89c4ac3f0149b45d83818e28e2c9d441af0',
    coverage: [0.68, 0.70],
  },
  {
    id: 'canal-town-modular-arch-frontage-v1',
    crop: '488x519+652+206',
    dimensions: [492, 523],
    outputSha256: 'ca1712ea9938fdf19dc262fdab8d71eee1ba28a68d86b65030a1a5023bfb3296',
    coverage: [0.67, 0.69],
  },
  {
    id: 'canal-town-modular-workshop-frontage-v1',
    crop: '521x604+1202+136',
    dimensions: [525, 608],
    outputSha256: '126d03f8c6a6d74c3eb25c4be841412d81a3c83a6e2c8c7e237c6fb7dcb28689',
    coverage: [0.70, 0.73],
  },
];

for (const [label, file, expected] of [
  ['source', SOURCE, SOURCE_SHA256],
  ['chroma helper', CHROMA_HELPER, CHROMA_HELPER_SHA256],
]) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${label}: ${file}`);
  const actual = sha256File(file);
  if (actual !== expected) throw new Error(`${label} hash changed: ${actual}`);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maldoror-modular-frontages-'));
try {
  const keyed = path.join(temporary, 'keyed.png');
  execFileSync('python3', [
    CHROMA_HELPER,
    '--input', SOURCE,
    '--out', keyed,
    '--auto-key', 'border',
    '--soft-matte',
    '--transparent-threshold', '12',
    '--opaque-threshold', '220',
    '--despill',
    '--force',
  ], { stdio: 'pipe' });
  const keyedHash = sha256File(keyed);
  if (keyedHash !== KEYED_SHA256) {
    throw new Error(`Chroma-keyed atlas hash changed: ${keyedHash}`);
  }

  const results = [];
  for (const asset of ASSETS) {
    const candidate = path.join(temporary, `${asset.id}.png`);
    const output = path.join(ROOT, `assets/biomes/parcel-components/${asset.id}.png`);
    execFileSync('convert', [
      keyed,
      '-crop', asset.crop,
      '+repage',
      '-bordercolor', 'none',
      '-border', '2x2',
      '-strip',
      candidate,
    ], { stdio: 'pipe' });
    const actualOutputHash = sha256File(candidate);
    if (actualOutputHash !== asset.outputSha256) {
      throw new Error(`${asset.id} output hash changed: ${actualOutputHash}`);
    }
    const validation = await validateAlpha(candidate);
    if (validation.width !== asset.dimensions[0] || validation.height !== asset.dimensions[1] ||
        validation.edgeNonzero !== 0 || validation.magentaLike !== 0 ||
        validation.coverage < asset.coverage[0] || validation.coverage > asset.coverage[1] ||
        validation.strongAlphaCoverage < asset.coverage[0] - 0.02) {
      throw new Error(`${asset.id} alpha validation failed: ${JSON.stringify(validation)}`);
    }
    fs.copyFileSync(candidate, output);
    results.push({
      id: asset.id,
      crop: asset.crop,
      output: path.relative(ROOT, output),
      outputSha256: asset.outputSha256,
      validation,
    });
  }
  console.log(JSON.stringify({
    generation: 'built-in Codex/ChatGPT image generation subscription; no metered API',
    source: path.relative(ROOT, SOURCE),
    sourceSha256: SOURCE_SHA256,
    keyedSha256: KEYED_SHA256,
    chromaHelperSha256: CHROMA_HELPER_SHA256,
    derivation: 'chroma removal, exact connected-component crops, two-pixel transparent border',
    assets: results,
    runtimeManifest: false,
  }, null, 2));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

async function validateAlpha(imagePath) {
  const { data, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  let visible = 0;
  let strong = 0;
  let partial = 0;
  let alphaTotal = 0;
  let edgeNonzero = 0;
  let magentaLike = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels;
      const alpha = data[offset + 3] ?? 0;
      alphaTotal += alpha;
      if (alpha > 0) visible++;
      if (alpha >= 128) strong++;
      if (alpha > 0 && alpha < 255) partial++;
      if (alpha > 0 && (x === 0 || y === 0 || x === info.width - 1 ||
          y === info.height - 1)) edgeNonzero++;
      if (alpha > 0 && (data[offset] ?? 0) > 220 && (data[offset + 1] ?? 0) < 80 &&
          (data[offset + 2] ?? 0) > 220) magentaLike++;
    }
  }
  const total = info.width * info.height;
  return {
    width: info.width,
    height: info.height,
    coverage: fixed(visible / total),
    weightedAlphaCoverage: fixed(alphaTotal / (255 * total)),
    strongAlphaCoverage: fixed(strong / total),
    partialAlphaCoverage: fixed(partial / total),
    edgeNonzero,
    magentaLike,
  };
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fixed(value) {
  return Number(value.toFixed(6));
}
