import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE = path.join(
  ROOT,
  'assets/biomes/generated/canal-town-civic-life-atlas-v1-source.png',
);
const SOURCE_SHA256 = '65cb523e5179aeaf014c1bcd4af679857bb594bf7af5bb7b4ce67f6f82172e3a';
const CHROMA_HELPER = process.env.MALDOROR_CHROMA_HELPER ?? path.join(
  process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
  'skills/.system/imagegen/scripts/remove_chroma_key.py',
);
const PADDING = 24;
const ASSETS = [
  {
    id: 'canal-town-civic-bench',
    crop: { left: 0, top: 0, width: 768, height: 512 },
    output: 'assets/biomes/civic-details/canal-town-civic-bench-v1.png',
    outputSha256: '5adc7efdfe683310467a7fc24eef4b960f5ca97ec6452adeb647b578d0fa48be',
    dimensions: [520, 316],
    coverage: [0.48, 0.49],
  },
  {
    id: 'canal-town-civic-cart',
    crop: { left: 768, top: 0, width: 768, height: 512 },
    output: 'assets/biomes/civic-details/canal-town-civic-cart-v1.png',
    outputSha256: 'bd2e40437b138f4e1e6889079e8dda8d310a3629c4b7793047c70636029753f9',
    dimensions: [528, 429],
    coverage: [0.50, 0.52],
  },
  {
    id: 'canal-town-civic-lantern',
    crop: { left: 0, top: 512, width: 768, height: 512 },
    output: 'assets/biomes/civic-details/canal-town-civic-lantern-v1.png',
    outputSha256: '3481e6f1ccb8843ea146afda2db1fea0d29f562355bcbcf21c81b31ca481c1e5',
    dimensions: [552, 347],
    coverage: [0.39, 0.41],
  },
  {
    id: 'canal-town-civic-fountain',
    crop: { left: 768, top: 512, width: 768, height: 512 },
    output: 'assets/biomes/civic-details/canal-town-civic-fountain-v1.png',
    outputSha256: '7add6b86d9dc87b4d4b975fe7e62c8f793b57d6dd4e38ac7587b234083449efd',
    dimensions: [509, 398],
    coverage: [0.39, 0.40],
  },
];

if (!fs.existsSync(CHROMA_HELPER)) {
  throw new Error(`Chroma-key helper is missing: ${CHROMA_HELPER}`);
}
if (sha256File(SOURCE) !== SOURCE_SHA256) throw new Error('Civic-life source hash changed');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maldoror-civic-details-'));
const derived = [];
try {
  for (const asset of ASSETS) {
    const crop = path.join(temporary, `${asset.id}-crop.png`);
    const keyed = path.join(temporary, `${asset.id}-keyed.png`);
    const trimmed = path.join(temporary, `${asset.id}.png`);
    await sharp(SOURCE).extract(asset.crop).png().toFile(crop);
    execFileSync('python3', [
      CHROMA_HELPER,
      '--input', crop,
      '--out', keyed,
      '--auto-key', 'border',
      '--soft-matte',
      '--transparent-threshold', '12',
      '--opaque-threshold', '220',
      '--despill',
    ], { stdio: 'pipe' });
    await sharp(keyed)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
      .extend({
        top: PADDING,
        bottom: PADDING,
        left: PADDING,
        right: PADDING,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(trimmed);

    const hash = sha256File(trimmed);
    if (hash !== asset.outputSha256) {
      throw new Error(`Derived hash changed for ${asset.id}: ${hash}`);
    }
    const validation = await validateAlpha(trimmed);
    if (validation.width !== asset.dimensions[0] || validation.height !== asset.dimensions[1] ||
        validation.coverage < asset.coverage[0] || validation.coverage > asset.coverage[1]) {
      throw new Error(`Invalid civic-detail alpha for ${asset.id}: ${JSON.stringify(validation)}`);
    }
    fs.copyFileSync(trimmed, path.join(ROOT, asset.output));
    derived.push({ ...asset, outputSha256: hash, ...validation });
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({
  generation: 'Codex built-in image generation on ChatGPT subscription; no metered API',
  source: path.relative(ROOT, SOURCE),
  sourceSha256: SOURCE_SHA256,
  chromaHelper: CHROMA_HELPER,
  padding: PADDING,
  derived,
}, null, 2));

async function validateAlpha(imagePath) {
  const { data, info } = await sharp(imagePath).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  let visible = 0;
  let partial = 0;
  for (let pixel = 0; pixel < info.width * info.height; pixel++) {
    const alpha = data[pixel * info.channels + 3] ?? 0;
    if (alpha > 0) visible++;
    if (alpha > 0 && alpha < 255) partial++;
  }
  const cornerAlpha = [
    data[3],
    data[(info.width - 1) * info.channels + 3],
    data[((info.height - 1) * info.width) * info.channels + 3],
    data[(info.width * info.height - 1) * info.channels + 3],
  ];
  if (cornerAlpha.some((alpha) => alpha !== 0)) {
    throw new Error(`Civic detail has opaque corner: ${imagePath}`);
  }
  return {
    width: info.width,
    height: info.height,
    coverage: Number((visible / (info.width * info.height)).toFixed(6)),
    partialAlpha: Number((partial / (info.width * info.height)).toFixed(6)),
    cornerAlpha,
  };
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
