import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE = path.join(
  ROOT,
  'assets/biomes/generated/canal-town-workshop-row-meso-frontage-v1-source.png',
);
const OUTPUT = path.join(
  ROOT,
  'assets/biomes/parcel-components/canal-town-workshop-row-meso-frontage-v1.png',
);
const SOURCE_SHA256 = '94595ef00923b7f6571ce47177f29a24c4ca14d265daf944ee7d8cf11ba85502';
const OUTPUT_SHA256 = '7238259274589e82e224c61b6c50b13f7617922a554c1b72f0fb61c5d3f3ccee';
const CHROMA_HELPER_SHA256 =
  '3f7b9b14ad5c90f37618bc1c16a039a2076abca12ddc41b3ae470e2b1cad6c0e';
const CHROMA_HELPER = process.env.MALDOROR_CHROMA_HELPER ?? path.join(
  process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
  'skills/.system/imagegen/scripts/remove_chroma_key.py',
);

for (const [label, file, expected] of [
  ['source', SOURCE, SOURCE_SHA256],
  ['chroma helper', CHROMA_HELPER, CHROMA_HELPER_SHA256],
]) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${label}: ${file}`);
  const actual = sha256File(file);
  if (actual !== expected) throw new Error(`${label} hash changed: ${actual}`);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maldoror-meso-frontage-'));
try {
  const candidate = path.join(temporary, 'canal-town-workshop-row.png');
  execFileSync('python3', [
    CHROMA_HELPER,
    '--input', SOURCE,
    '--out', candidate,
    '--auto-key', 'border',
    '--soft-matte',
    '--transparent-threshold', '12',
    '--opaque-threshold', '220',
    '--despill',
    '--force',
  ], { stdio: 'pipe' });

  const actualOutputHash = sha256File(candidate);
  if (actualOutputHash !== OUTPUT_SHA256) {
    throw new Error(`Derived output hash changed: ${actualOutputHash}`);
  }
  const validation = await validateAlpha(candidate);
  if (validation.width !== 1402 || validation.height !== 1122 ||
      validation.edgeNonzero !== 0 || validation.magentaLike !== 0 ||
      validation.coverage < 0.42 || validation.coverage > 0.44 ||
      validation.strongAlphaCoverage < 0.41) {
    throw new Error(`Invalid meso-frontage alpha: ${JSON.stringify(validation)}`);
  }
  fs.copyFileSync(candidate, OUTPUT);
  console.log(JSON.stringify({
    id: 'canal-town-workshop-row-meso-frontage-v1',
    generation: 'built-in Codex/ChatGPT image generation subscription; no metered API',
    source: path.relative(ROOT, SOURCE),
    sourceSha256: SOURCE_SHA256,
    output: path.relative(ROOT, OUTPUT),
    outputSha256: OUTPUT_SHA256,
    chromaHelperSha256: CHROMA_HELPER_SHA256,
    validation,
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
