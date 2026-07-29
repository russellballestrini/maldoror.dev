import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const VERSION = process.env.MALDOROR_PAIRED_FOCAL_VERSION ?? 'v1';
if (!/^v\d+$/.test(VERSION)) throw new Error(`Invalid paired focal version: ${VERSION}`);

const OUTPUT = path.join(ROOT, 'assets/biomes/parcel-components');
const TRANSPARENT_DISTANCE = 8;
const OPAQUE_DISTANCE = 32;
const MINIMUM_WEIGHTED_ALPHA_COVERAGE = 0.12;
const MINIMUM_STRONG_ALPHA_COVERAGE = 0.08;
const EXPECTED_CHROMA_HELPER_SHA256 =
  '3f7b9b14ad5c90f37618bc1c16a039a2076abca12ddc41b3ae470e2b1cad6c0e';
const CHROMA_HELPER = process.env.MALDOROR_CHROMA_HELPER ?? path.join(
  process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
  'skills/.system/imagegen/scripts/remove_chroma_key.py',
);
const BOARD_VERSIONS = {
  v1: [
    {
      id: 'a',
      file: 'assets/biomes/generated/regional-paired-focal-alternatives-a-v1-source.png',
      cells: [
        ['canal-town', 'coopers-loading-house'],
        ['forest', 'charcoal-kiln'],
        ['coast', 'boatwright-skiff-shed'],
        ['rural', 'blacksmith-forge'],
        ['mountain', 'assay-house'],
        ['ruins', 'cloister-arcade'],
      ],
    },
    {
      id: 'b',
      file: 'assets/biomes/generated/regional-paired-focal-alternatives-b-v1-source.png',
      cells: [
        ['canal-town', 'dyers-shophouse'],
        ['forest', 'resin-distillery'],
        ['coast', 'salt-smokehouse'],
        ['rural', 'dovecote-mill-cottage'],
        ['mountain', 'mule-stable'],
        ['ruins', 'sunken-bathhouse'],
      ],
    },
  ],
  v2: [
    {
      id: 'a',
      file: 'assets/biomes/generated/regional-paired-focal-alternatives-a-v2-source.png',
      cells: [
        ['canal-town', 'ropemakers-walk'],
        ['forest', 'coppice-sawpit-works'],
        ['coast', 'sailmaker-net-loft'],
        ['rural', 'cider-press-house'],
        ['mountain', 'ore-stamp-mill'],
        ['ruins', 'ossuary-gatehouse'],
      ],
    },
    {
      id: 'b',
      file: 'assets/biomes/generated/regional-paired-focal-alternatives-b-v2-source.png',
      cells: [
        ['canal-town', 'lantern-chandlery-watch-house'],
        ['forest', 'woodland-apiary-honey-house'],
        ['coast', 'tide-observatory-signal-house'],
        ['rural', 'threshing-barn-winnow-tower'],
        ['mountain', 'cable-hoist-station'],
        ['ruins', 'collapsed-amphitheatre-shrine'],
      ],
    },
  ],
};
const BOARDS = BOARD_VERSIONS[VERSION];
if (!BOARDS) throw new Error(`Unknown paired focal source version: ${VERSION}`);

if (!fs.existsSync(CHROMA_HELPER)) {
  throw new Error(`Chroma-key helper is missing: ${CHROMA_HELPER}; set MALDOROR_CHROMA_HELPER`);
}
const chromaHelperSha256 = createHash('sha256').update(fs.readFileSync(CHROMA_HELPER)).digest('hex');
if (chromaHelperSha256 !== EXPECTED_CHROMA_HELPER_SHA256) {
  throw new Error(
    `Chroma-key helper drifted: expected ${EXPECTED_CHROMA_HELPER_SHA256}, got ${chromaHelperSha256}`,
  );
}
fs.mkdirSync(OUTPUT, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maldoror-paired-focals-'));
const derived = [];

try {
  for (const board of BOARDS) {
    const sourcePath = path.join(ROOT, board.file);
    const metadata = await sharp(sourcePath).metadata();
    if (metadata.width !== 1536 || metadata.height !== 1024) {
      throw new Error(`Expected 1536x1024 paired focal board: ${sourcePath}`);
    }
    for (let index = 0; index < board.cells.length; index++) {
      const [family, module] = board.cells[index];
      const left = index % 3 * 512;
      const top = Math.floor(index / 3) * 512;
      const id = `${family}-${module}-${VERSION}`;
      const cropPath = path.join(temporary, `${id}-crop.png`);
      const keyedPath = path.join(temporary, `${id}-keyed.png`);
      const outputPath = path.join(OUTPUT, `${id}.png`);
      await sharp(sourcePath).extract({ left, top, width: 512, height: 512 }).png().toFile(cropPath);
      execFileSync('python3', [
        CHROMA_HELPER,
        '--input', cropPath,
        '--out', keyedPath,
        '--auto-key', 'border',
        '--soft-matte',
        '--transparent-threshold', String(TRANSPARENT_DISTANCE),
        '--opaque-threshold', String(OPAQUE_DISTANCE),
        '--despill',
        '--force',
      ], { stdio: 'pipe' });
      execFileSync('convert', [
        keyedPath,
        '-trim', '+repage',
        '-bordercolor', 'none', '-border', '2x2',
        '-channel', 'RGB', '-gamma', '1.32', '+channel',
        '-strip',
        outputPath,
      ], { stdio: 'pipe' });

      const { data, info } = await sharp(outputPath).ensureAlpha().raw().toBuffer({
        resolveWithObject: true,
      });
      let transparent = 0;
      let partial = 0;
      let opaque = 0;
      let strong = 0;
      let alphaTotal = 0;
      for (let pixel = 0; pixel < info.width * info.height; pixel++) {
        const alpha = data[pixel * info.channels + 3] ?? 0;
        alphaTotal += alpha;
        if (alpha === 0) transparent++;
        else if (alpha === 255) opaque++;
        else partial++;
        if (alpha >= 128) strong++;
      }
      const total = transparent + partial + opaque;
      const coverage = (partial + opaque) / total;
      const weightedAlphaCoverage = alphaTotal / (255 * total);
      const strongAlphaCoverage = strong / total;
      const cornerAlpha = [
        data[3],
        data[(info.width - 1) * info.channels + 3],
        data[((info.height - 1) * info.width) * info.channels + 3],
        data[(info.width * info.height - 1) * info.channels + 3],
      ];
      if (coverage < 0.08 || coverage > 0.88 ||
          weightedAlphaCoverage < MINIMUM_WEIGHTED_ALPHA_COVERAGE ||
          strongAlphaCoverage < MINIMUM_STRONG_ALPHA_COVERAGE ||
          cornerAlpha.some((alpha) => alpha !== 0)) {
        throw new Error(
          `Invalid alpha extraction for ${id}: coverage=${coverage.toFixed(4)} ` +
          `weighted=${weightedAlphaCoverage.toFixed(4)} strong=${strongAlphaCoverage.toFixed(4)} ` +
          `corners=${cornerAlpha.join(',')}`,
        );
      }
      derived.push({
        id,
        family,
        board: board.id,
        sourceCell: [index % 3, Math.floor(index / 3)],
        file: path.relative(path.join(ROOT, 'assets/biomes'), outputPath),
        dimensions: [info.width, info.height],
        coverage: Number(coverage.toFixed(4)),
        weightedAlphaCoverage: Number(weightedAlphaCoverage.toFixed(4)),
        strongAlphaCoverage: Number(strongAlphaCoverage.toFixed(4)),
        partialAlpha: Number((partial / total).toFixed(4)),
        sha256: createHash('sha256').update(await fs.promises.readFile(outputPath)).digest('hex'),
      });
    }
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({
  version: VERSION,
  generation: 'built-in Codex/ChatGPT image generation subscription; no metered API',
  segmentation: `fixed 3x2 cells plus border-key matte ${TRANSPARENT_DISTANCE}..${OPAQUE_DISTANCE}`,
  colourGrade: 'RGB gamma 1.32 for terminal-scale shadow legibility',
  chromaHelperSha256,
  pngMetadata: 'stripped for byte-stable derivation',
  sourceSha256: Object.fromEntries(await Promise.all(BOARDS.map(async (board) => [
    board.id,
    createHash('sha256').update(await fs.promises.readFile(path.join(ROOT, board.file))).digest('hex'),
  ]))),
  derived,
}, null, 2));
