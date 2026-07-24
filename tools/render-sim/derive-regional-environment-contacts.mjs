import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const VERSION = process.env.MALDOROR_ENVIRONMENT_CONTACT_VERSION ?? 'v1';
if (!/^v\d+$/.test(VERSION)) throw new Error(`Invalid environment-contact version: ${VERSION}`);
const SOURCE = path.join(ROOT, `assets/biomes/generated/regional-environment-contacts-${VERSION}-source.png`);
const OUTPUT = path.join(ROOT, 'assets/biomes/environment-contacts');
const CHROMA_HELPER = process.env.MALDOROR_CHROMA_HELPER ?? path.join(
  process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
  'skills/.system/imagegen/scripts/remove_chroma_key.py',
);
const CONTACTS = [
  ['coast', 'cliff-pine'],
  ['coast', 'broken-jetty'],
  ['coast', 'basalt-arch'],
  ['coast', 'headland-beacon'],
  ['mountain', 'cave-mouth'],
  ['mountain', 'falling-water'],
  ['mountain', 'mine-gantry'],
  ['mountain', 'way-shrine'],
];

if (!fs.existsSync(SOURCE)) throw new Error(`Regional environment-contact source is missing: ${SOURCE}`);
if (!fs.existsSync(CHROMA_HELPER)) {
  throw new Error(`Chroma-key helper is missing: ${CHROMA_HELPER}; set MALDOROR_CHROMA_HELPER`);
}
const metadata = await sharp(SOURCE).metadata();
const width = metadata.width ?? 0;
const height = metadata.height ?? 0;
if (width < 800 || height < 400) throw new Error(`Environment-contact atlas is too small: ${width}x${height}`);

const source = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maldoror-environment-contacts-'));
const derived = [];
fs.mkdirSync(OUTPUT, { recursive: true });

try {
  for (let index = 0; index < CONTACTS.length; index++) {
    const [family, contact] = CONTACTS[index];
    const column = index % 4;
    const row = Math.floor(index / 4);
    const cellLeft = Math.round(column * width / 4);
    const cellRight = Math.round((column + 1) * width / 4);
    const cellTop = Math.round(row * height / 2);
    const cellBottom = Math.round((row + 1) * height / 2);
    const sourceBounds = occupiedBounds(
      source.data,
      source.info.channels,
      width,
      cellLeft,
      cellTop,
      cellRight,
      cellBottom,
    );
    const id = `${family}-${contact}-environment-contact`;
    const keyedCrop = path.join(temporary, `${id}-keyed.png`);
    const outputPath = path.join(OUTPUT, `${id}-${VERSION}.png`);
    await sharp(SOURCE).extract(sourceBounds).png().toFile(keyedCrop);
    execFileSync('python3', [
      CHROMA_HELPER,
      '--input', keyedCrop,
      '--out', outputPath,
      '--auto-key', 'border',
      '--soft-matte',
      '--transparent-threshold', '12',
      '--opaque-threshold', '220',
      '--despill',
      '--force',
    ], { stdio: 'pipe' });
    const { data, info } = await sharp(outputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparent = 0;
    let partial = 0;
    let opaque = 0;
    for (let pixel = 0; pixel < info.width * info.height; pixel++) {
      const alpha = data[pixel * info.channels + 3] ?? 0;
      if (alpha === 0) transparent++;
      else if (alpha === 255) opaque++;
      else partial++;
    }
    const total = transparent + partial + opaque;
    const coverage = (partial + opaque) / total;
    const corners = [
      data[3],
      data[(info.width - 1) * info.channels + 3],
      data[((info.height - 1) * info.width) * info.channels + 3],
      data[(info.width * info.height - 1) * info.channels + 3],
    ];
    if (coverage < 0.08 || coverage > 0.82 || corners.some((alpha) => alpha !== 0)) {
      throw new Error(`Invalid ${id} alpha: coverage=${coverage.toFixed(4)} corners=${corners.join(',')}`);
    }
    derived.push({
      id: `${id}-${VERSION}`,
      family,
      file: path.relative(path.join(ROOT, 'assets/biomes'), outputPath),
      sourceBounds,
      dimensions: [info.width, info.height],
      coverage: Number(coverage.toFixed(4)),
      partialAlpha: Number((partial / total).toFixed(4)),
    });
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({ source: SOURCE, version: VERSION, derived }, null, 2));

function occupiedBounds(data, channels, sourceWidth, left, top, right, bottom) {
  let minX = right;
  let minY = bottom;
  let maxX = left;
  let maxY = top;
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * sourceWidth + x) * channels;
      const distance = Math.hypot(255 - data[offset], data[offset + 1], 255 - data[offset + 2]);
      if (distance <= 34) continue;
      count++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (count < 100) throw new Error(`No substantial silhouette in cell ${left},${top}`);
  const padding = 10;
  const paddedLeft = Math.max(left, minX - padding);
  const paddedTop = Math.max(top, minY - padding);
  const paddedRight = Math.min(right, maxX + padding + 1);
  const paddedBottom = Math.min(bottom, maxY + padding + 1);
  return {
    left: paddedLeft,
    top: paddedTop,
    width: paddedRight - paddedLeft,
    height: paddedBottom - paddedTop,
  };
}
