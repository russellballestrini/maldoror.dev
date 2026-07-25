import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CHROMA_HELPER = process.env.MALDOROR_CHROMA_HELPER ?? path.join(
  process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
  'skills/.system/imagegen/scripts/remove_chroma_key.py',
);
const PADDING = 24;
const ASSETS = [
  {
    id: 'canal-town-near-bank-market-frontage',
    source: 'assets/biomes/generated/canal-town-near-bank-market-frontage-v1-source.png',
    output: 'assets/biomes/parcel-components/canal-town-near-bank-market-frontage-v1.png',
    sourceSha256: '3ea403cefc4a57ac781160181c5ba225a392093c355178b1ea8c47eb051e8458',
    outputSha256: '7d53d0e9c7444b34a5165a5a145ae67e65113165dc70eb36ea5430d21301db5d',
    dimensions: [1592, 534],
    coverage: [0.70, 0.73],
  },
  {
    id: 'canal-town-far-bank-warehouse-frontage',
    source: 'assets/biomes/generated/canal-town-far-bank-warehouse-frontage-v1-source.png',
    output: 'assets/biomes/parcel-components/canal-town-far-bank-warehouse-frontage-v1.png',
    sourceSha256: '76a572ebd9399a8a41592df25c7cdb6ee9c09ee404c99da0035528a6fb6c69d0',
    outputSha256: 'f6f061b190e3be1c8d32b59457f403fbcafd21c2cd73666e726274139ce2949f',
    dimensions: [2087, 433],
    coverage: [0.73, 0.76],
  },
];

if (!fs.existsSync(CHROMA_HELPER)) {
  throw new Error(`Chroma-key helper is missing: ${CHROMA_HELPER}`);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maldoror-quay-frontages-'));
const derived = [];
try {
  for (const asset of ASSETS) {
    const source = path.join(ROOT, asset.source);
    const output = path.join(ROOT, asset.output);
    if (sha256File(source) !== asset.sourceSha256) {
      throw new Error(`Source hash changed for ${asset.id}`);
    }
    const keyed = path.join(temporary, `${asset.id}-keyed.png`);
    const trimmed = path.join(temporary, `${asset.id}.png`);
    execFileSync('python3', [
      CHROMA_HELPER,
      '--input', source,
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
        validation.cornerAlpha.some((alpha) => alpha !== 0) ||
        validation.coverage < asset.coverage[0] || validation.coverage > asset.coverage[1]) {
      throw new Error(`Invalid derived alpha for ${asset.id}: ${JSON.stringify(validation)}`);
    }
    fs.copyFileSync(trimmed, output);
    derived.push({ ...asset, ...validation });
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({
  generation: 'built-in Codex/ChatGPT image generation subscription; no metered API',
  chromaHelper: CHROMA_HELPER,
  padding: PADDING,
  derived,
}, null, 2));

async function validateAlpha(imagePath) {
  const { data, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
