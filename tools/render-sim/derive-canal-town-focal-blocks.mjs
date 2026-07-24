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
const ASSETS = [
  {
    id: 'canal-town-connected-frontage',
    source: 'assets/biomes/generated/canal-town-connected-frontage-v1-source.png',
    output: 'assets/biomes/parcel-components/canal-town-connected-frontage-parcel-component-v1.png',
    sourceSha256: '3b207bdcbda8e2598f200aae6974e0f2ca7584c25e058f69afbebbf51275c916',
    outputSha256: '4f7d70759a4a259d21ecbc788561537e772de2fa3ee8cfc786894bfda0d9a286',
    dimensions: [1857, 847],
    coverage: [0.58, 0.60],
  },
  {
    id: 'canal-town-vertical-street-block',
    source: 'assets/biomes/generated/canal-town-vertical-street-block-v1-source.png',
    output: 'assets/biomes/parcel-components/canal-town-vertical-street-block-parcel-component-v1.png',
    sourceSha256: '0a2cdab2ed23953aabf36eaf719f46d825f3df15d00a4b53964e3058a6a45937',
    outputSha256: '2a0f8701e39cbe4b8b7b137f0639eb208f2fa3d215dc6298d8cfb22ae1a877a1',
    dimensions: [1064, 1479],
    coverage: [0.48, 0.50],
  },
  {
    id: 'canal-town-market-courtyard-block',
    source: 'assets/biomes/generated/canal-town-market-courtyard-block-v1-source.png',
    output: 'assets/biomes/parcel-components/canal-town-market-courtyard-block-parcel-component-v1.png',
    sourceSha256: '6e6c3ffa42f010458c3734626ce69d879700c9d4ff40fdce77fd14423e0b0e38',
    outputSha256: 'a3c85d26a77e10ea94d66c6e1708057f519e51b76751247424df9fbd03a38fe5',
    dimensions: [1050, 1498],
    coverage: [0.45, 0.47],
  },
];

if (!fs.existsSync(CHROMA_HELPER)) {
  throw new Error(`Chroma-key helper is missing: ${CHROMA_HELPER}`);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maldoror-canal-focals-'));
const derived = [];
try {
  for (const asset of ASSETS) {
    const source = path.join(ROOT, asset.source);
    const output = path.join(ROOT, asset.output);
    if (sha256File(source) !== asset.sourceSha256) {
      throw new Error(`Source hash changed for ${asset.id}`);
    }
    const temporaryOutput = path.join(temporary, `${asset.id}.png`);
    execFileSync('python3', [
      CHROMA_HELPER,
      '--input', source,
      '--out', temporaryOutput,
      '--auto-key', 'border',
      '--soft-matte',
      '--transparent-threshold', '12',
      '--opaque-threshold', '220',
      '--despill',
    ], { stdio: 'pipe' });

    const hash = sha256File(temporaryOutput);
    if (hash !== asset.outputSha256) {
      throw new Error(`Derived hash changed for ${asset.id}: ${hash}`);
    }
    const validation = await validateAlpha(temporaryOutput);
    if (validation.width !== asset.dimensions[0] || validation.height !== asset.dimensions[1] ||
        validation.cornerAlpha.some((alpha) => alpha !== 0) ||
        validation.coverage < asset.coverage[0] || validation.coverage > asset.coverage[1]) {
      throw new Error(`Invalid derived alpha for ${asset.id}: ${JSON.stringify(validation)}`);
    }
    fs.copyFileSync(temporaryOutput, output);
    derived.push({ ...asset, ...validation });
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({
  generation: 'built-in Codex/ChatGPT image generation subscription; no metered API',
  chromaHelper: CHROMA_HELPER,
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
