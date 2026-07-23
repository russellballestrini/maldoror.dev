/** Derive square material masters from the subscription-generated 3x2 atlas.
 *
 * Detection uses the atlas's explicit magenta gutters rather than hard-coded
 * crop coordinates. The source generation is never modified.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SOURCE = process.env.MALDOROR_BIOME_ATLAS_SOURCE ??
  'assets/biomes/generated/regional-materials-atlas-v1-source.png';
const OUTPUT = process.env.MALDOROR_BIOME_MATERIAL_OUTPUT ?? 'assets/biomes/materials';
const OUTPUT_SIZE = Number.parseInt(process.env.MALDOROR_BIOME_MATERIAL_SIZE ?? '512', 10);
const NAMES = [
  'canal-town-paving',
  'forest-floor',
  'coast-marsh',
  'rural-orchard',
  'mountain-highland',
  'ancient-ruins',
];

const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const isKey = (offset) => data[offset] >= 225 && data[offset + 1] <= 55 && data[offset + 2] >= 205;

function axisRuns(axis) {
  const length = axis === 'x' ? info.width : info.height;
  const crossLength = axis === 'x' ? info.height : info.width;
  const active = Array.from({ length }, (_, coordinate) => {
    let material = 0;
    for (let cross = 0; cross < crossLength; cross++) {
      const x = axis === 'x' ? coordinate : cross;
      const y = axis === 'x' ? cross : coordinate;
      if (!isKey((y * info.width + x) * 3)) material++;
    }
    return material / crossLength > 0.52;
  });
  const runs = [];
  let start = null;
  for (let index = 0; index <= active.length; index++) {
    if (active[index] && start === null) start = index;
    if ((!active[index] || index === active.length) && start !== null) {
      if (index - start >= 32) runs.push([start, index]);
      start = null;
    }
  }
  return runs;
}

const columns = axisRuns('x');
const rows = axisRuns('y');
if (columns.length !== 3 || rows.length !== 2) {
  throw new Error(`Expected a 3x2 keyed atlas; detected ${columns.length}x${rows.length}`);
}

fs.mkdirSync(OUTPUT, { recursive: true });
const derived = [];
for (let row = 0; row < rows.length; row++) {
  for (let column = 0; column < columns.length; column++) {
    const [left, right] = columns[column];
    const [top, bottom] = rows[row];
    const width = right - left;
    const height = bottom - top;
    const side = Math.min(width, height) - 4;
    const cropLeft = left + Math.floor((width - side) / 2);
    const cropTop = top + Math.floor((height - side) / 2);
    const name = NAMES[row * columns.length + column];
    const outputPath = path.join(OUTPUT, `${name}-master-v1.png`);
    await sharp(SOURCE)
      .extract({ left: cropLeft, top: cropTop, width: side, height: side })
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toFile(outputPath);
    const stats = await sharp(outputPath).stats();
    derived.push({
      name,
      outputPath,
      sourceCrop: [cropLeft, cropTop, side, side],
      outputSize: [OUTPUT_SIZE, OUTPUT_SIZE],
      entropy: Number(stats.entropy.toFixed(4)),
    });
  }
}

console.log(JSON.stringify({
  source: SOURCE,
  detectedColumns: columns,
  detectedRows: rows,
  derived,
}, null, 2));
