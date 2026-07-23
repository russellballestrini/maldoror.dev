/** Assemble the regional biome-transition lab into one inspectable atlas.
 *
 * Inputs and outputs remain in the mounted research area. The repository keeps
 * only this reproducible compositor and the field experiment itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const LAB_VERSION = process.env.MALDOROR_BIOME_LAB_VERSION ?? 'v6';
const ROOT = process.env.MALDOROR_BIOME_LAB_ROOT ??
  `/mnt/donto-data/donto-resources/maldoror/rendering-research/track-5-biome-transitions/biome-lab-${LAB_VERSION}`;
const PANEL_WIDTH = 480;
const PANEL_HEIGHT = 264;
const LABEL_HEIGHT = 38;
const COLUMNS = 3;

const entries = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('origin-'))
  .map((entry) => {
    const directory = path.join(ROOT, entry.name);
    const metricsPath = path.join(directory, 'metrics.json');
    const imagePath = path.join(directory, 'layered-ecotone-ansi-160x44.png');
    if (!fs.existsSync(metricsPath) || !fs.existsSync(imagePath)) return null;
    return {
      directory,
      imagePath,
      metrics: JSON.parse(fs.readFileSync(metricsPath, 'utf8')),
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.metrics.origin[1] - b.metrics.origin[1] || a.metrics.origin[0] - b.metrics.origin[0]);

if (entries.length === 0) throw new Error(`No complete biome frames beneath ${ROOT}`);

const rows = Math.ceil(entries.length / COLUMNS);
const composites = [];
for (let index = 0; index < entries.length; index++) {
  const entry = entries[index];
  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const left = column * PANEL_WIDTH;
  const top = row * (PANEL_HEIGHT + LABEL_HEIGHT);
  const image = await sharp(entry.imagePath)
    .resize(PANEL_WIDTH, PANEL_HEIGHT, { fit: 'fill' })
    .png()
    .toBuffer();
  composites.push({ input: image, left, top: top + LABEL_HEIGHT });
  const [originX, originY] = entry.metrics.origin;
  const label = `WORLD ${originX >= 0 ? '+' : ''}${originX}, ${originY >= 0 ? '+' : ''}${originY}`;
  composites.push({
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL_WIDTH}" height="${LABEL_HEIGHT}">` +
      `<rect width="100%" height="100%" fill="#0d0d12"/>` +
      `<text x="${PANEL_WIDTH / 2}" y="26" fill="#f3eee7" text-anchor="middle" ` +
      `font-family="DejaVu Sans Mono, monospace" font-size="17">${label}</text></svg>`,
    ),
    left,
    top,
  });
}

await sharp({
  create: {
    width: COLUMNS * PANEL_WIDTH,
    height: rows * (PANEL_HEIGHT + LABEL_HEIGHT),
    channels: 3,
    background: '#0d0d12',
  },
}).composite(composites).png().toFile(path.join(ROOT, 'ATLAS.png'));

const familyNames = Object.keys(entries[0].metrics.candidates['layered-ecotone'].familyCoverage);
const aggregateCoverage = Object.fromEntries(familyNames.map((family) => [
  family,
  Number((entries.reduce(
    (sum, entry) => sum + entry.metrics.candidates['layered-ecotone'].familyCoverage[family],
    0,
  ) / entries.length).toFixed(4)),
]));
const report = {
  labVersion: LAB_VERSION,
  frameCount: entries.length,
  origins: entries.map((entry) => entry.metrics.origin),
  exactCoordinateStability: entries.every((entry) => entry.metrics.coordinateStability.exact),
  aggregateCoverage,
  meanBoundaryColourJump: Number((entries.reduce(
    (sum, entry) => sum + entry.metrics.candidates['layered-ecotone'].meanBoundaryColourJump,
    0,
  ) / entries.length).toFixed(2)),
  candidates: entries.map((entry) => ({
    origin: entry.metrics.origin,
    coordinateStability: entry.metrics.coordinateStability,
    coverage: entry.metrics.candidates['layered-ecotone'].familyCoverage,
    entropy: entry.metrics.candidates['layered-ecotone'].meanNormalizedEntropy,
    ecotoneShare: entry.metrics.candidates['layered-ecotone'].ecotoneShare,
    boundaryColourJump: entry.metrics.candidates['layered-ecotone'].meanBoundaryColourJump,
  })),
};
fs.writeFileSync(path.join(ROOT, 'ATLAS-METRICS.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ root: ROOT, atlas: path.join(ROOT, 'ATLAS.png'), ...report }, null, 2));
