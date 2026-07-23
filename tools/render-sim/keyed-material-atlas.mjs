import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/** Derive versioned square masters from an explicitly magenta-keyed atlas.
 * Crop bounds come from the authored key, never hard-coded pixel positions. */
export async function deriveKeyedMaterialAtlas({
  source,
  output,
  outputSize,
  names,
  expectedColumns,
  expectedRows,
}) {
  const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const isKey = (offset) => data[offset] >= 225 && data[offset + 1] <= 55 && data[offset + 2] >= 205;

  const axisRuns = (axis) => {
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
  };

  const columns = axisRuns('x');
  const rows = axisRuns('y');
  if (columns.length !== expectedColumns || rows.length !== expectedRows) {
    throw new Error(
      `Expected a ${expectedColumns}x${expectedRows} keyed atlas; detected ${columns.length}x${rows.length}`,
    );
  }
  if (names.length !== expectedColumns * expectedRows) {
    throw new Error(`Material name count ${names.length} does not match ${expectedColumns}x${expectedRows}`);
  }

  fs.mkdirSync(output, { recursive: true });
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
      const name = names[row * columns.length + column];
      const outputPath = path.join(output, `${name}-master-v1.png`);
      await sharp(source)
        .extract({ left: cropLeft, top: cropTop, width: side, height: side })
        .resize(outputSize, outputSize, { kernel: sharp.kernel.lanczos3 })
        .png()
        .toFile(outputPath);
      const stats = await sharp(outputPath).stats();
      derived.push({
        name,
        outputPath,
        sourceCrop: [cropLeft, cropTop, side, side],
        outputSize: [outputSize, outputSize],
        entropy: Number(stats.entropy.toFixed(4)),
      });
    }
  }
  return { source, detectedColumns: columns, detectedRows: rows, derived };
}
