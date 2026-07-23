import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const VERSION = process.env.MALDOROR_AMBIENT_VERSION ?? 'v2';
if (!/^v\d+$/.test(VERSION)) throw new Error(`Invalid ambient version: ${VERSION}`);
const SOURCE = path.join(ROOT, `assets/biomes/generated/regional-ambient-atlas-${VERSION}-source.png`);
const OUTPUT = path.join(ROOT, 'assets/biomes/ambient');
const CHROMA_HELPER = process.env.MALDOROR_CHROMA_HELPER ?? path.join(
  process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
  'skills/.system/imagegen/scripts/remove_chroma_key.py',
);
const COLUMNS = 4;
const ROWS = 3;
const NAMES = [
  'canal-town-facade-planter',
  'forest-twin-canopy',
  'coast-wind-pine-reeds',
  'rural-orchard-hedge-gate',
  'mountain-crag-pine',
  'ruins-wall-arch',
  'canal-town-bank-threshold',
  'forest-log-understory',
  'coast-driftwood-marker',
  'rural-field-wall-gate',
  'mountain-rock-spire',
  'ruins-columns-rubble',
];

if (!fs.existsSync(SOURCE)) throw new Error(`Regional ambient source is missing: ${SOURCE}`);
if (!fs.existsSync(CHROMA_HELPER)) {
  throw new Error(`Chroma-key helper is missing: ${CHROMA_HELPER}; set MALDOROR_CHROMA_HELPER`);
}

const metadata = await sharp(SOURCE).metadata();
const width = metadata.width ?? 0;
const height = metadata.height ?? 0;
if (width < 400 || height < 300 || width % COLUMNS !== 0 || height % ROWS !== 0) {
  throw new Error(`Expected a regular ${COLUMNS}x${ROWS} atlas; received ${width}x${height}`);
}

fs.mkdirSync(OUTPUT, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maldoror-ambient-'));
const cellWidth = width / COLUMNS;
const cellHeight = height / ROWS;
const inset = Math.max(5, Math.round(Math.min(cellWidth, cellHeight) * 0.014));
const derived = [];

try {
  for (let index = 0; index < NAMES.length; index++) {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const keyedCrop = path.join(temporary, `${NAMES[index]}-keyed.png`);
    const outputPath = path.join(OUTPUT, `${NAMES[index]}-${VERSION}.png`);
    await sharp(SOURCE)
      .extract({
        left: column * cellWidth + inset,
        top: row * cellHeight + inset,
        width: cellWidth - inset * 2,
        height: cellHeight - inset * 2,
      })
      .png()
      .toFile(keyedCrop);
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
    const cornerOffsets = [
      3,
      (info.width - 1) * info.channels + 3,
      ((info.height - 1) * info.width) * info.channels + 3,
      (info.width * info.height - 1) * info.channels + 3,
    ];
    if (coverage < 0.08 || coverage > 0.82 || cornerOffsets.some((offset) => data[offset] !== 0)) {
      throw new Error(`Invalid alpha extraction for ${NAMES[index]}: coverage=${coverage.toFixed(4)}`);
    }
    derived.push({
      id: NAMES[index],
      file: path.relative(path.join(ROOT, 'assets/biomes'), outputPath),
      sourceCell: [column, row],
      dimensions: [info.width, info.height],
      coverage: Number(coverage.toFixed(4)),
      partialAlpha: Number((partial / total).toFixed(4)),
    });
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({ source: SOURCE, version: VERSION, inset, derived }, null, 2));
