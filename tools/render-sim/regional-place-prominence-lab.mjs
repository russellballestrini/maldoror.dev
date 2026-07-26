/**
 * Controlled regional-prominence field comparison.
 *
 * The production ambient scatter uses a locally repulsive candidate lattice,
 * then multiplies acceptance by a macro field. This lab keeps the world seed,
 * candidate jitter, priority thinning, and density fixed while comparing only
 * that macro field. It deliberately ignores biome eligibility so a weak field
 * cannot hide behind missing assets or terrain exclusions.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { spatialHash2DUnit } from '../../packages/world/dist/index.js';

const OUTPUT = process.env.MALDOROR_PLACE_PROMINENCE_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-4-world-composition/regional-place-prominence-v153';
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const SEED = Number(BigInt.asUintN(32, WORLD_SEED));
const BOUNDS = { minX: -1024, minY: -1024, maxX: 1024, maxY: 1024 };
const AMBIENT_CELL_SIZE = 4;
const AMBIENT_DENSITY = 0.86;
const ANALYSIS_WINDOW = 32;
const PANEL_SIZE = 560;

fs.mkdirSync(OUTPUT, { recursive: true });

const hashUnit = (x, y, salt) => spatialHash2DUnit(SEED, x, y, salt);
const clampUnit = (value) => Math.max(0, Math.min(1, value));
const smoothUnit = (value) => {
  const unit = clampUnit(value);
  return unit * unit * (3 - 2 * unit);
};
const mix = (from, to, amount) => from + (to - from) * amount;

function valueField(worldX, worldY, scale, salt) {
  const cellX = Math.floor(worldX / scale);
  const cellY = Math.floor(worldY / scale);
  const localX = smoothUnit((worldX - cellX * scale) / scale);
  const localY = smoothUnit((worldY - cellY * scale) / scale);
  const north = mix(hashUnit(cellX, cellY, salt), hashUnit(cellX + 1, cellY, salt), localX);
  const south = mix(
    hashUnit(cellX, cellY + 1, salt),
    hashUnit(cellX + 1, cellY + 1, salt),
    localX,
  );
  return mix(north, south, localY);
}

function clusterField(worldX, worldY, options) {
  const cellX = Math.floor(worldX / options.cellSize);
  const cellY = Math.floor(worldY / options.cellSize);
  const neighbourReach = Math.max(1, Math.ceil(options.maximumRadius));
  let influence = 0;
  for (let offsetY = -neighbourReach; offsetY <= neighbourReach; offsetY++) {
    for (let offsetX = -neighbourReach; offsetX <= neighbourReach; offsetX++) {
      const clusterX = cellX + offsetX;
      const clusterY = cellY + offsetY;
      if (hashUnit(clusterX, clusterY, options.activeSalt) > options.activeRate) continue;
      const centreX = (
        clusterX + 0.12 + hashUnit(clusterX, clusterY, options.xSalt) * 0.76
      ) * options.cellSize;
      const centreY = (
        clusterY + 0.12 + hashUnit(clusterX, clusterY, options.ySalt) * 0.76
      ) * options.cellSize;
      const radius = options.cellSize * mix(
        options.minimumRadius,
        options.maximumRadius,
        hashUnit(clusterX, clusterY, options.radiusSalt),
      );
      const proximity = Math.max(0, 1 - Math.hypot(worldX - centreX, worldY - centreY) / radius);
      const strength = mix(
        options.minimumStrength,
        1,
        hashUnit(clusterX, clusterY, options.strengthSalt),
      );
      influence = Math.max(influence, smoothUnit(proximity) * strength);
    }
  }
  return options.floor + Math.pow(influence, options.exponent) * (1 - options.floor);
}

const PROFILES = [
  {
    id: 'production-cluster-field',
    label: 'Control · one cluster per 48-tile cell',
    note: 'Every macro cell is active and the 0.20 floor keeps quiet regions populated.',
    weight(worldX, worldY) {
      return clusterField(worldX, worldY, {
        cellSize: 48,
        activeRate: 1,
        minimumRadius: 0.34,
        maximumRadius: 0.54,
        minimumStrength: 0.7,
        floor: 0.2,
        exponent: 0.5,
        activeSalt: 0x1127,
        xSalt: 0x6f13,
        ySalt: 0x29d7,
        radiusSalt: 0x4ca1,
        strengthSalt: 0x7b45,
      });
    },
  },
  {
    id: 'sparse-cluster-field',
    label: 'Candidate A · sparse prominence islands',
    note: 'Fewer, wider centres create active islands separated by a near-empty floor.',
    weight(worldX, worldY) {
      return clusterField(worldX, worldY, {
        cellSize: 72,
        activeRate: 0.42,
        minimumRadius: 0.54,
        maximumRadius: 0.82,
        minimumStrength: 0.72,
        floor: 0.025,
        exponent: 0.62,
        activeSalt: 0x1127,
        xSalt: 0x6f13,
        ySalt: 0x29d7,
        radiusSalt: 0x4ca1,
        strengthSalt: 0x7b45,
      });
    },
  },
  {
    id: 'two-octave-field',
    label: 'Candidate B · continuous two-octave basins',
    note: 'A broad value field owns importance; a second octave shapes it without hard edges.',
    weight(worldX, worldY) {
      const broad = valueField(worldX, worldY, 144, 0x35b9);
      const local = valueField(worldX, worldY, 56, 0x6a71);
      const shaped = smoothUnit((broad * 0.72 + local * 0.28 - 0.39) / 0.34);
      return 0.025 + Math.pow(shaped, 0.72) * 0.975;
    },
  },
  {
    id: 'nested-prominence-field',
    label: 'Candidate C · nested prominence hierarchy',
    note: 'Broad basins decide where detail belongs; sparse local islands focus it into places.',
    weight(worldX, worldY) {
      const broad = valueField(worldX, worldY, 160, 0x35b9);
      const broadGate = smoothUnit((broad - 0.34) / 0.42);
      const local = clusterField(worldX, worldY, {
        cellSize: 52,
        activeRate: 0.58,
        minimumRadius: 0.48,
        maximumRadius: 0.76,
        minimumStrength: 0.72,
        floor: 0,
        exponent: 0.6,
        activeSalt: 0x1127,
        xSalt: 0x6f13,
        ySalt: 0x29d7,
        radiusSalt: 0x4ca1,
        strengthSalt: 0x7b45,
      });
      const prominence = broadGate * (0.38 + local * 0.62);
      return 0.02 + Math.pow(prominence, 0.72) * 0.98;
    },
  },
];

function ambientCandidate(cellX, cellY) {
  const inset = 0.12;
  const span = 1 - inset * 2;
  return {
    x: Math.floor((cellX + inset + hashUnit(cellX, cellY, 0x2d91) * span) * AMBIENT_CELL_SIZE),
    y: Math.floor((cellY + inset + hashUnit(cellX, cellY, 0x6b35) * span) * AMBIENT_CELL_SIZE),
  };
}

function isPriorityMaximum(cellX, cellY) {
  const priority = hashUnit(cellX, cellY, 0x7f21);
  for (let offsetY = -2; offsetY <= 2; offsetY++) {
    for (let offsetX = -2; offsetX <= 2; offsetX++) {
      if ((offsetX === 0 && offsetY === 0) || Math.abs(offsetX) + Math.abs(offsetY) > 2) continue;
      const neighbour = hashUnit(cellX + offsetX, cellY + offsetY, 0x7f21);
      if (neighbour > priority || (neighbour === priority &&
          (offsetY < 0 || (offsetY === 0 && offsetX < 0)))) return false;
    }
  }
  return true;
}

function placementsFor(profile) {
  const placements = [];
  const firstCellX = Math.floor(BOUNDS.minX / AMBIENT_CELL_SIZE) - 1;
  const lastCellX = Math.floor((BOUNDS.maxX - 1) / AMBIENT_CELL_SIZE) + 1;
  const firstCellY = Math.floor(BOUNDS.minY / AMBIENT_CELL_SIZE) - 1;
  const lastCellY = Math.floor((BOUNDS.maxY - 1) / AMBIENT_CELL_SIZE) + 1;
  for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
    for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
      if (!isPriorityMaximum(cellX, cellY)) continue;
      const candidate = ambientCandidate(cellX, cellY);
      if (candidate.x < BOUNDS.minX || candidate.x >= BOUNDS.maxX ||
          candidate.y < BOUNDS.minY || candidate.y >= BOUNDS.maxY) continue;
      const weight = profile.weight(candidate.x, candidate.y);
      if (hashUnit(cellX, cellY, 0x4d17) > AMBIENT_DENSITY * weight) continue;
      placements.push({ ...candidate, weight });
    }
  }
  return placements;
}

function quantile(values, amount) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * amount)));
  return sorted[index] ?? 0;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function standardDeviation(values, average = mean(values)) {
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function gini(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;
  const weighted = sorted.reduce((sum, value, index) => sum + (index + 1) * value, 0);
  return (2 * weighted) / (sorted.length * total) - (sorted.length + 1) / sorted.length;
}

function summarize(profile, placements) {
  const windowsWide = (BOUNDS.maxX - BOUNDS.minX) / ANALYSIS_WINDOW;
  const windowsHigh = (BOUNDS.maxY - BOUNDS.minY) / ANALYSIS_WINDOW;
  const counts = new Array(windowsWide * windowsHigh).fill(0);
  for (const placement of placements) {
    const x = Math.floor((placement.x - BOUNDS.minX) / ANALYSIS_WINDOW);
    const y = Math.floor((placement.y - BOUNDS.minY) / ANALYSIS_WINDOW);
    counts[y * windowsWide + x]++;
  }
  const fieldSamples = [];
  for (let y = BOUNDS.minY; y < BOUNDS.maxY; y += 8) {
    for (let x = BOUNDS.minX; x < BOUNDS.maxX; x += 8) fieldSamples.push(profile.weight(x, y));
  }
  const countMean = mean(counts);
  const countSd = standardDeviation(counts, countMean);
  let adjacentProduct = 0;
  let adjacentPairs = 0;
  for (let y = 0; y < windowsHigh; y++) {
    for (let x = 0; x < windowsWide; x++) {
      const centred = counts[y * windowsWide + x] - countMean;
      if (x + 1 < windowsWide) {
        adjacentProduct += centred * (counts[y * windowsWide + x + 1] - countMean);
        adjacentPairs++;
      }
      if (y + 1 < windowsHigh) {
        adjacentProduct += centred * (counts[(y + 1) * windowsWide + x] - countMean);
        adjacentPairs++;
      }
    }
  }
  const variance = countSd ** 2;
  return {
    placements: placements.length,
    placementsPerSquareKilocell: Number((placements.length / 4.194304).toFixed(3)),
    fieldWeight: {
      mean: Number(mean(fieldSamples).toFixed(4)),
      p10: Number(quantile(fieldSamples, 0.1).toFixed(4)),
      p50: Number(quantile(fieldSamples, 0.5).toFixed(4)),
      p90: Number(quantile(fieldSamples, 0.9).toFixed(4)),
      nearQuietRate: Number((fieldSamples.filter((value) => value <= 0.08).length /
        fieldSamples.length).toFixed(4)),
      highProminenceRate: Number((fieldSamples.filter((value) => value >= 0.72).length /
        fieldSamples.length).toFixed(4)),
    },
    windows: {
      size: ANALYSIS_WINDOW,
      count: counts.length,
      mean: Number(countMean.toFixed(4)),
      p10: quantile(counts, 0.1),
      p50: quantile(counts, 0.5),
      p90: quantile(counts, 0.9),
      maximum: Math.max(...counts),
      emptyRate: Number((counts.filter((value) => value === 0).length / counts.length).toFixed(4)),
      quietRate: Number((counts.filter((value) => value <= countMean * 0.25).length /
        counts.length).toFixed(4)),
      activeRate: Number((counts.filter((value) => value >= countMean * 1.75).length /
        counts.length).toFixed(4)),
      coefficientOfVariation: Number((countSd / Math.max(countMean, 1e-9)).toFixed(4)),
      gini: Number(gini(counts).toFixed(4)),
      adjacentAutocorrelation: Number((variance > 0
        ? adjacentProduct / adjacentPairs / variance
        : 0).toFixed(4)),
    },
  };
}

async function renderPanel(profile, placements, metrics) {
  const rgba = Buffer.alloc(PANEL_SIZE * PANEL_SIZE * 4);
  for (let py = 0; py < PANEL_SIZE; py++) {
    for (let px = 0; px < PANEL_SIZE; px++) {
      const worldX = mix(BOUNDS.minX, BOUNDS.maxX, (px + 0.5) / PANEL_SIZE);
      const worldY = mix(BOUNDS.minY, BOUNDS.maxY, (py + 0.5) / PANEL_SIZE);
      const weight = profile.weight(worldX, worldY);
      const offset = (py * PANEL_SIZE + px) * 4;
      rgba[offset] = Math.round(mix(17, 92, weight));
      rgba[offset + 1] = Math.round(mix(20, 111, weight));
      rgba[offset + 2] = Math.round(mix(27, 81, weight));
      rgba[offset + 3] = 255;
    }
  }
  const dots = placements.map((placement) => {
    const x = (placement.x - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX) * PANEL_SIZE;
    const y = (placement.y - BOUNDS.minY) / (BOUNDS.maxY - BOUNDS.minY) * PANEL_SIZE;
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="0.82" fill="#f1c77d" fill-opacity="0.88"/>`;
  }).join('');
  const labelHeight = 76;
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL_SIZE}" height="${labelHeight}">
    <rect width="100%" height="100%" fill="#0b0d13"/>
    <text x="16" y="25" fill="#f2eadf" font-family="monospace" font-size="16" font-weight="700">${profile.label}</text>
    <text x="16" y="46" fill="#a9b0bd" font-family="monospace" font-size="11">${profile.note}</text>
    <text x="16" y="65" fill="#e4bc78" font-family="monospace" font-size="11">${metrics.placements} placements · quiet ${Math.round(metrics.windows.quietRate * 100)}% · CV ${metrics.windows.coefficientOfVariation} · adjacent ${metrics.windows.adjacentAutocorrelation}</text>
  </svg>`);
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL_SIZE}" height="${PANEL_SIZE}">${dots}</svg>`);
  const map = await sharp(rgba, {
    raw: { width: PANEL_SIZE, height: PANEL_SIZE, channels: 4 },
  }).composite([{ input: overlay }]).png().toBuffer();
  const panelPath = path.join(OUTPUT, `${profile.id}.png`);
  await sharp({
    create: {
      width: PANEL_SIZE,
      height: PANEL_SIZE + labelHeight,
      channels: 4,
      background: '#0b0d13',
    },
  }).composite([{ input: label, top: 0, left: 0 }, { input: map, top: labelHeight, left: 0 }])
    .png().toFile(panelPath);
  return panelPath;
}

const results = [];
for (const profile of PROFILES) {
  const placements = placementsFor(profile);
  const metrics = summarize(profile, placements);
  const panelPath = await renderPanel(profile, placements, metrics);
  results.push({ profile, placements, metrics, panelPath });
}

const comparisonPath = path.join(OUTPUT, 'prominence-comparison.png');
await sharp({
  create: {
    width: PANEL_SIZE * 2 + 12,
    height: (PANEL_SIZE + 76) * 2 + 12,
    channels: 4,
    background: '#05060a',
  },
}).composite(results.map((result, index) => ({
  input: result.panelPath,
  left: (index % 2) * (PANEL_SIZE + 12),
  top: Math.floor(index / 2) * (PANEL_SIZE + 76 + 12),
}))).png().toFile(comparisonPath);

const report = {
  worldSeed: String(WORLD_SEED),
  bounds: BOUNDS,
  controlledPlacement: {
    cellSize: AMBIENT_CELL_SIZE,
    density: AMBIENT_DENSITY,
    priority: 'Manhattan-radius-2 local maximum',
    candidateJitter: 'production salts and 12% inset',
    biomeAndAssetEligibility: 'intentionally omitted',
  },
  profiles: Object.fromEntries(results.map(({ profile, metrics }) => [profile.id, metrics])),
  comparisonSha256: crypto.createHash('sha256').update(fs.readFileSync(comparisonPath)).digest('hex'),
};
fs.writeFileSync(path.join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, comparisonPath, ...report }, null, 2));
