import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE = path.join(
  ROOT,
  'assets/biomes/generated/canal-town-side-canal-frontage-v1-source.png',
);
const SOURCE_SHA256 = '54ea24529ba262e9a07bd2b8a02c582b4bc1faa71fb3fc7d34dd4510c7f94ba2';
const CHROMA_HELPER = process.env.MALDOROR_CHROMA_HELPER ?? path.join(
  process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
  'skills/.system/imagegen/scripts/remove_chroma_key.py',
);
const PADDING = 24;
const ASSETS = [
  {
    id: 'canal-town-side-canal-warehouse-frontage',
    crop: { left: 0, top: 0, width: 768, height: 512 },
    mirror: true,
    output: 'assets/biomes/parcel-components/canal-town-side-canal-warehouse-frontage-v1.png',
    outputSha256: 'bebfae276e9a7ec04402877222d0a9884b3f1c283e61f12712f5b3449b763505',
    expected: { width: 404, height: 493, coverage: 0.343964, partialAlpha: 0.021193 },
  },
  {
    id: 'canal-town-side-canal-market-house-frontage',
    crop: { left: 768, top: 0, width: 768, height: 512 },
    mirror: false,
    output: 'assets/biomes/parcel-components/canal-town-side-canal-market-house-frontage-v1.png',
    outputSha256: '443d3d214a0dec7ae31b843aa810a104ff0975e5da5aadd34e6edc30667257b4',
    expected: { width: 386, height: 536, coverage: 0.41066, partialAlpha: 0.037289 },
  },
  {
    id: 'canal-town-side-canal-boat-repair-frontage',
    crop: { left: 0, top: 512, width: 768, height: 512 },
    mirror: true,
    output: 'assets/biomes/parcel-components/canal-town-side-canal-boat-repair-frontage-v1.png',
    outputSha256: '37b3cbafce0c10d4670fda35ba2eef665b46e242d873c5b6e21240d515ff0022',
    expected: { width: 411, height: 482, coverage: 0.360456, partialAlpha: 0.034911 },
  },
  {
    id: 'canal-town-side-canal-inn-dwelling-frontage',
    crop: { left: 768, top: 512, width: 768, height: 512 },
    mirror: false,
    output: 'assets/biomes/parcel-components/canal-town-side-canal-inn-dwelling-frontage-v1.png',
    outputSha256: 'bcd7aa643e6acb6dafe321f1dbbc535ebc5d12705835d56d2ed1da7b71f46afc',
    expected: { width: 428, height: 524, coverage: 0.414051, partialAlpha: 0.022486 },
  },
];

if (!fs.existsSync(CHROMA_HELPER)) {
  throw new Error(`Chroma-key helper is missing: ${CHROMA_HELPER}`);
}
if (sha256File(SOURCE) !== SOURCE_SHA256) throw new Error('Side-canal frontage source hash changed');
const metadata = await sharp(SOURCE).metadata();
if (metadata.width !== 1536 || metadata.height !== 1024) {
  throw new Error(`Unexpected side-canal frontage atlas dimensions: ${metadata.width}x${metadata.height}`);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maldoror-side-canal-frontages-'));
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
    let pipeline = sharp(keyed);
    if (asset.mirror) pipeline = pipeline.flop();
    await pipeline
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
    if (asset.outputSha256 !== null && hash !== asset.outputSha256) {
      throw new Error(`Derived hash changed for ${asset.id}: ${hash}`);
    }
    const validation = await validateAlpha(trimmed);
    if (validation.width < 220 || validation.height < 300 ||
        validation.coverage < 0.2 || validation.coverage > 0.72 ||
        validation.partialAlpha < 0.002) {
      throw new Error(`Invalid side-canal frontage alpha for ${asset.id}: ${JSON.stringify(validation)}`);
    }
    if (asset.expected !== null && (
      validation.width !== asset.expected.width || validation.height !== asset.expected.height ||
      validation.coverage !== asset.expected.coverage ||
      validation.partialAlpha !== asset.expected.partialAlpha
    )) {
      throw new Error(`Derived validation changed for ${asset.id}: ${JSON.stringify(validation)}`);
    }
    const output = path.join(ROOT, asset.output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(trimmed, output);
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
    throw new Error(`Side-canal frontage has opaque corner: ${imagePath}`);
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
