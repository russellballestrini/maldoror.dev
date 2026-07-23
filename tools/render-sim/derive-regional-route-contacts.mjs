import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const VERSION = process.env.MALDOROR_ROUTE_CONTACT_VERSION ?? 'v1';
if (!/^v\d+$/.test(VERSION)) throw new Error(`Invalid route-contact version: ${VERSION}`);
const OUTPUT = path.join(ROOT, 'assets/biomes/route-contacts');
const CHROMA_HELPER = process.env.MALDOROR_CHROMA_HELPER ?? path.join(
  process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
  'skills/.system/imagegen/scripts/remove_chroma_key.py',
);
const COLUMNS = 3;
const ROWS = 2;
const FAMILIES = ['canal-town', 'forest', 'coast', 'rural', 'mountain', 'ruins'];
const SOURCES = [
  {
    axis: 'north-south',
    file: path.join(ROOT, `assets/biomes/generated/regional-route-contacts-ns-${VERSION}-source.png`),
  },
  {
    axis: 'east-west',
    file: path.join(ROOT, `assets/biomes/generated/regional-route-contacts-ew-${VERSION}-source.png`),
  },
];

if (!fs.existsSync(CHROMA_HELPER)) {
  throw new Error(`Chroma-key helper is missing: ${CHROMA_HELPER}; set MALDOROR_CHROMA_HELPER`);
}
fs.mkdirSync(OUTPUT, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maldoror-route-contacts-'));
const derived = [];

try {
  for (const source of SOURCES) {
    if (!fs.existsSync(source.file)) throw new Error(`Route-contact source is missing: ${source.file}`);
    const metadata = await sharp(source.file).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width < 600 || height < 400 || width % COLUMNS !== 0 || height % ROWS !== 0) {
      throw new Error(`Expected a regular ${COLUMNS}x${ROWS} atlas; received ${width}x${height}`);
    }
    const cellWidth = width / COLUMNS;
    const cellHeight = height / ROWS;
    const inset = Math.max(5, Math.round(Math.min(cellWidth, cellHeight) * 0.014));
    for (let index = 0; index < FAMILIES.length; index++) {
      const family = FAMILIES[index];
      const column = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      const id = `${family}-route-contact-${source.axis}`;
      const keyedCrop = path.join(temporary, `${id}-keyed.png`);
      const outputPath = path.join(OUTPUT, `${id}-${VERSION}.png`);
      await sharp(source.file)
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

      const { data, info } = await sharp(outputPath).ensureAlpha().raw()
        .toBuffer({ resolveWithObject: true });
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
        3,
        (info.width - 1) * info.channels + 3,
        ((info.height - 1) * info.width) * info.channels + 3,
        (info.width * info.height - 1) * info.channels + 3,
      ];
      if (coverage < 0.06 || coverage > 0.72 || corners.some((offset) => data[offset] !== 0)) {
        throw new Error(`Invalid alpha extraction for ${id}: coverage=${coverage.toFixed(4)}`);
      }
      derived.push({
        id,
        axis: source.axis,
        family,
        file: path.relative(path.join(ROOT, 'assets/biomes'), outputPath),
        sourceCell: [column, row],
        dimensions: [info.width, info.height],
        coverage: Number(coverage.toFixed(4)),
        partialAlpha: Number((partial / total).toFixed(4)),
      });
    }
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({ version: VERSION, sources: SOURCES, derived }, null, 2));
