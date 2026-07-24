import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const VERSION = process.env.MALDOROR_PARCEL_COMPONENT_VERSION ?? 'v1';
if (!/^v\d+$/.test(VERSION)) throw new Error(`Invalid parcel component version: ${VERSION}`);
const SOURCE = path.join(ROOT, `assets/biomes/generated/regional-parcel-components-${VERSION}-source.png`);
const OUTPUT = path.join(ROOT, 'assets/biomes/parcel-components');
const CHROMA_HELPER = process.env.MALDOROR_CHROMA_HELPER ?? path.join(
  process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
  'skills/.system/imagegen/scripts/remove_chroma_key.py',
);
const FAMILY_MODULES = [
  ['canal-town', ['townhouse', 'quay-workshop', 'market-pavilion', 'boat-shed']],
  ['forest', ['twin-canopy', 'log-shelter', 'hunter-lean-to', 'mushroom-stump']],
  ['coast', ['wind-pine', 'driftwood-shrine', 'fishing-rack', 'dune-hut']],
  ['rural', ['orchard-gate', 'stone-barn', 'produce-awning', 'field-shed']],
  ['mountain', ['crag-pine', 'mine-gantry', 'cairn-shelter', 'alpine-hut']],
  ['ruins', ['broken-arch', 'paired-columns', 'collapsed-tower', 'wayside-shrine']],
];

if (!fs.existsSync(SOURCE)) throw new Error(`Regional parcel component source is missing: ${SOURCE}`);
if (!fs.existsSync(CHROMA_HELPER)) {
  throw new Error(`Chroma-key helper is missing: ${CHROMA_HELPER}; set MALDOROR_CHROMA_HELPER`);
}
const metadata = await sharp(SOURCE).metadata();
const width = metadata.width ?? 0;
const height = metadata.height ?? 0;
const familyColumns = 3;
const familyRows = 2;
if (width < 600 || height < 400 || width % familyColumns !== 0 || height % familyRows !== 0) {
  throw new Error(`Expected a regular ${familyColumns}x${familyRows} family atlas; received ${width}x${height}`);
}

fs.mkdirSync(OUTPUT, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maldoror-parcel-components-'));
const familyWidth = width / familyColumns;
const familyHeight = height / familyRows;
const source = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const derived = [];

try {
  for (let familyIndex = 0; familyIndex < FAMILY_MODULES.length; familyIndex++) {
    const [family, modules] = FAMILY_MODULES[familyIndex];
    const familyColumn = familyIndex % 3;
    const familyRow = Math.floor(familyIndex / 3);
    const familyLeft = familyColumn * familyWidth;
    const familyTop = familyRow * familyHeight;
    const bounds = findModuleBounds(
      source.data,
      source.info.channels,
      width,
      familyLeft,
      familyTop,
      familyWidth,
      familyHeight,
    );
    if (bounds.length !== modules.length) {
      throw new Error(`Expected four separated ${family} modules; found ${bounds.length}: ${JSON.stringify(bounds)}`);
    }
    for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex++) {
      const module = modules[moduleIndex];
      const sourceBounds = bounds[moduleIndex];
      const id = `${family}-${module}-parcel-component`;
      const keyedCrop = path.join(temporary, `${id}-keyed.png`);
      const outputPath = path.join(OUTPUT, `${id}-${VERSION}.png`);
      await sharp(SOURCE)
        .extract(sourceBounds)
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
      const cornerAlpha = cornerOffsets.map((offset) => data[offset]);
      if (coverage < 0.045 || coverage > 0.84 || cornerAlpha.some((alpha) => alpha !== 0)) {
        throw new Error(
          `Invalid alpha extraction for ${id}: coverage=${coverage.toFixed(4)} corners=${cornerAlpha.join(',')}`,
        );
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
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({
  source: SOURCE,
  version: VERSION,
  segmentation: 'chroma-mask-adaptive-whitespace',
  derived,
}, null, 2));

function findModuleBounds(data, channels, sourceWidth, left, top, regionWidth, regionHeight) {
  const occupied = new Uint8Array(regionWidth * regionHeight);
  for (let y = 0; y < regionHeight; y++) {
    for (let x = 0; x < regionWidth; x++) {
      const offset = ((top + y) * sourceWidth + left + x) * channels;
      const redDistance = 255 - data[offset];
      const green = data[offset + 1];
      const blueDistance = 255 - data[offset + 2];
      if (Math.hypot(redDistance, green, blueDistance) > 34) occupied[y * regionWidth + x] = 1;
    }
  }
  const verticalSplit = quietestCut(
    occupied,
    regionWidth,
    regionHeight,
    'vertical',
    0,
    regionWidth,
    0,
    regionHeight,
  );
  const leftHorizontalSplit = quietestCut(
    occupied,
    regionWidth,
    regionHeight,
    'horizontal',
    0,
    verticalSplit,
    0,
    regionHeight,
  );
  const rightHorizontalSplit = quietestCut(
    occupied,
    regionWidth,
    regionHeight,
    'horizontal',
    verticalSplit,
    regionWidth,
    0,
    regionHeight,
  );
  const regions = [
    [0, 0, verticalSplit, leftHorizontalSplit],
    [verticalSplit, 0, regionWidth, rightHorizontalSplit],
    [0, leftHorizontalSplit, verticalSplit, regionHeight],
    [verticalSplit, rightHorizontalSplit, regionWidth, regionHeight],
  ];
  const padding = 10;
  return regions.map(([regionLeft, regionTop, regionRight, regionBottom]) => {
    let minX = regionRight;
    let minY = regionBottom;
    let maxX = regionLeft;
    let maxY = regionTop;
    let pixels = 0;
    for (let y = regionTop; y < regionBottom; y++) {
      for (let x = regionLeft; x < regionRight; x++) {
        if (occupied[y * regionWidth + x] === 0) continue;
        pixels++;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (pixels < 500) return { minX, minY, maxX, maxY, pixels };
    const localLeft = Math.max(regionLeft, minX - padding);
    const localTop = Math.max(regionTop, minY - padding);
    const right = Math.min(regionRight, maxX + padding + 1);
    const bottom = Math.min(regionBottom, maxY + padding + 1);
    return {
      left: left + localLeft,
      top: top + localTop,
      width: right - localLeft,
      height: bottom - localTop,
    };
  });
}

function quietestCut(mask, width, height, axis, left, right, top, bottom) {
  const minimum = axis === 'vertical'
    ? Math.floor(left + (right - left) * 0.35)
    : Math.floor(top + (bottom - top) * 0.35);
  const maximum = axis === 'vertical'
    ? Math.ceil(left + (right - left) * 0.65)
    : Math.ceil(top + (bottom - top) * 0.65);
  const centre = (minimum + maximum) / 2;
  let selected = Math.round(centre);
  let selectedScore = Number.POSITIVE_INFINITY;
  for (let cut = minimum; cut <= maximum; cut++) {
    let occupancy = 0;
    for (let band = -3; band <= 3; band++) {
      if (axis === 'vertical') {
        const x = cut + band;
        if (x < left || x >= right) continue;
        for (let y = top; y < bottom; y++) occupancy += mask[y * width + x];
      } else {
        const y = cut + band;
        if (y < top || y >= bottom) continue;
        for (let x = left; x < right; x++) occupancy += mask[y * width + x];
      }
    }
    const score = occupancy + Math.abs(cut - centre) * 0.01;
    if (score < selectedScore) {
      selected = cut;
      selectedScore = score;
    }
  }
  return selected;
}
