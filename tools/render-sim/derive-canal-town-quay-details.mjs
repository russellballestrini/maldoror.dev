import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE = path.join(
  ROOT,
  'assets/biomes/generated/canal-town-water-edge-life-atlas-v1-source.png',
);
const SOURCE_SHA256 = 'ae666c1403a4d2ccd21352be957183c12723d47b161c28a8fd58dabcfc2041c3';
const CHROMA_HELPER = process.env.MALDOROR_CHROMA_HELPER ?? path.join(
  process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
  'skills/.system/imagegen/scripts/remove_chroma_key.py',
);
const PADDING = 24;
const ASSETS = [
  {
    id: 'canal-town-boat-east-west',
    crop: { left: 0, top: 0, width: 768, height: 341 },
    output: 'assets/biomes/quay-details/canal-town-boat-east-west-v1.png',
    outputSha256: '548e5e80974d5dc8f79ddf13e0b7ee63c93748354a9a0155f24d667199f381d6',
    dimensions: [583, 228],
    coverage: [0.37, 0.38],
  },
  {
    id: 'canal-town-boat-north-south',
    crop: { left: 768, top: 0, width: 768, height: 341 },
    output: 'assets/biomes/quay-details/canal-town-boat-north-south-v1.png',
    outputSha256: 'f3897309c1c6224b92f1a86f9941eda4b281c0037dcb0de287eff63dc13bd440',
    dimensions: [201, 357],
    coverage: [0.48, 0.49],
  },
  {
    id: 'canal-town-mooring-cluster',
    crop: { left: 0, top: 341, width: 768, height: 341 },
    output: 'assets/biomes/quay-details/canal-town-mooring-cluster-v1.png',
    outputSha256: '313e05dcfa33a5040dccb9d0a86e364604fed530c3ac47e014e82d4754f899f2',
    dimensions: [544, 244],
    coverage: [0.40, 0.41],
  },
  {
    id: 'canal-town-fish-unloading',
    crop: { left: 768, top: 350, width: 768, height: 265 },
    output: 'assets/biomes/quay-details/canal-town-fish-unloading-v1.png',
    outputSha256: '3f23ba0e87634c05312fd2eebfb9af59bef94dc66ddb8deb98eb58dc4d096242',
    dimensions: [472, 288],
    coverage: [0.44, 0.45],
  },
  {
    id: 'canal-town-water-vegetation',
    crop: { left: 0, top: 682, width: 768, height: 342 },
    output: 'assets/biomes/quay-details/canal-town-water-vegetation-v1.png',
    outputSha256: 'ca52aade68af05ab8a7de18735b067797a117ae299f43908720230bd48c7a1dc',
    dimensions: [414, 278],
    coverage: [0.36, 0.37],
  },
  {
    id: 'canal-town-fish-stall',
    crop: { left: 768, top: 620, width: 768, height: 404 },
    output: 'assets/biomes/quay-details/canal-town-fish-stall-v1.png',
    outputSha256: 'cf0360ec35e641a1494d5ed5af63af2f0f4b1c05f1de2f5d63965ba664c020d6',
    dimensions: [411, 366],
    coverage: [0.54, 0.55],
  },
];

if (!fs.existsSync(CHROMA_HELPER)) {
  throw new Error(`Chroma-key helper is missing: ${CHROMA_HELPER}`);
}
if (sha256File(SOURCE) !== SOURCE_SHA256) throw new Error('Water-edge source hash changed');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maldoror-quay-details-'));
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
      throw new Error(`Invalid quay-detail alpha for ${asset.id}: ${JSON.stringify(validation)}`);
    }
    const output = path.join(ROOT, asset.output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(trimmed, output);
    derived.push({
      ...asset,
      outputSha256: hash,
      ...validation,
    });
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
    throw new Error(`Quay detail has opaque corner: ${imagePath}`);
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
