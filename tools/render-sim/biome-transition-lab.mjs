/** Regional biome-transition research lab.
 *
 * Compares three deterministic world-family classifiers at the exact 320x176
 * source grid consumed by a 160x44 octant terminal frame:
 *   A. nearest cellular region (coherent but arbitrary hard borders),
 *   B. hydroclimate descriptors collapsed to hard argmax,
 *   C. the same descriptors retained as broad, layered ecotone weights.
 *
 * Research output belongs on the mounted data disk, never in the repository.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import FastNoiseLite from 'fastnoise-lite';
import { renderOctantGridCells } from '../../packages/render/dist/pixel/pixel-renderer.js';
import { OCTANT_CHARS } from '../../packages/render/dist/pixel/octant-chars.js';

const LAB_VERSION = process.env.MALDOROR_BIOME_LAB_VERSION ?? 'v6';
const ORIGIN_X = Number.parseInt(process.env.MALDOROR_BIOME_ORIGIN_X ?? '0', 10);
const ORIGIN_Y = Number.parseInt(process.env.MALDOROR_BIOME_ORIGIN_Y ?? '0', 10);
const OUTPUT = process.env.MALDOROR_BIOME_LAB_OUTPUT ??
  `/mnt/donto-data/donto-resources/maldoror/rendering-research/track-5-biome-transitions/biome-lab-${LAB_VERSION}/origin-${ORIGIN_X}-${ORIGIN_Y}`;
const WIDTH = 320;
const HEIGHT = 176;
// The widest ecological filter is two radius-5 passes. Sampling beyond the
// requested frame keeps independently generated neighbouring frames identical
// through the complete visible area instead of clamping at screenshot edges.
const FILTER_HALO = 12;
const SEA_LEVEL = 0.44;
const SEED = Number(BigInt.asUintN(32, BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485')));
const FAMILY_NAMES = ['canal-town', 'forest', 'coast', 'rural', 'mountain', 'ruins'];
const FAMILY_COLOURS = [
  [194, 122, 83],
  [50, 91, 66],
  [35, 126, 146],
  [151, 143, 77],
  [112, 112, 126],
  [112, 77, 119],
];
fs.mkdirSync(OUTPUT, { recursive: true });

function makeNoise(seedOffset, frequency, fractalType = FastNoiseLite.FractalType.FBm, octaves = 5) {
  const noise = new FastNoiseLite((SEED + seedOffset) | 0);
  noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
  noise.SetFrequency(frequency);
  noise.SetFractalType(fractalType);
  noise.SetFractalOctaves(octaves);
  noise.SetFractalLacunarity(2.03);
  noise.SetFractalGain(0.5);
  return noise;
}

const warpNoiseX = makeNoise(0x391a, 1 / 118, FastNoiseLite.FractalType.FBm, 3);
const warpNoiseY = makeNoise(0x75b1, 1 / 131, FastNoiseLite.FractalType.FBm, 3);
const continentNoise = makeNoise(0x1b63, 1 / 194);
const ridgeNoise = makeNoise(0x8d27, 1 / 92, FastNoiseLite.FractalType.Ridged, 4);
const shelfNoise = makeNoise(0xc241, 1 / 330, FastNoiseLite.FractalType.FBm, 3);
const temperatureNoise = makeNoise(0x16f3, 1 / 155, FastNoiseLite.FractalType.FBm, 4);
const regionalTemperatureNoise = makeNoise(0xd317, 1 / 920, FastNoiseLite.FractalType.FBm, 4);
const moistureNoise = makeNoise(0x9271, 1 / 128);
const settlementNoise = makeNoise(0x53c7, 1 / 78, FastNoiseLite.FractalType.FBm, 4);
const ancientNoise = makeNoise(0xb591, 1 / 61, FastNoiseLite.FractalType.FBm, 4);
const ancientRidgeNoise = makeNoise(0x31e9, 1 / 38, FastNoiseLite.FractalType.Ridged, 3);
const detailNoise = makeNoise(0x77a3, 1 / 7.5, FastNoiseLite.FractalType.FBm, 3);
const sampleNoise = (noise, x, y, angle = 0) => {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return noise.GetNoise(x * cosine - y * sine, x * sine + y * cosine);
};
const noise01 = (noise, x, y, angle = 0) => sampleNoise(noise, x, y, angle) * 0.5 + 0.5;

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smoothstep = (low, high, value) => {
  const t = clamp((value - low) / Math.max(1e-9, high - low));
  return t * t * (3 - 2 * t);
};
const gaussian = (value, centre, spread) => Math.exp(-((value - centre) ** 2) / (2 * spread ** 2));
const gridIndex = (x, y, width) => y * width + x;
const indexAt = (x, y) => gridIndex(x, y, WIDTH);

function hash(x, y, salt) {
  let value = Math.imul((x | 0) ^ SEED ^ salt, 0x45d9f3b);
  value = Math.imul(value ^ (y | 0), 0x119de1f3);
  return (value ^ (value >>> 16)) >>> 0;
}

function hashUnit(x, y, salt) {
  return hash(x, y, salt) / 0xffffffff;
}

function elevationAt(x, y) {
  const warpX = sampleNoise(warpNoiseX, x, y, 0.23) * 74;
  const warpY = sampleNoise(warpNoiseY, x, y, -0.51) * 62;
  const warpedX = x + warpX;
  const warpedY = y + warpY;
  const continent = noise01(continentNoise, warpedX, warpedY, 0.12);
  const ridge = noise01(ridgeNoise, warpedX, warpedY, 0.71);
  const broadShelf = noise01(shelfNoise, x + warpX * 0.3, y + warpY * 0.3, -0.33);
  return clamp(continent * 0.61 + ridge * 0.23 + broadShelf * 0.16);
}

const BASIN_SIZE = 112;

function basinNode(cellX, cellY) {
  return {
    cellX,
    cellY,
    x: (cellX + 0.16 + hashUnit(cellX, cellY, 0x4137) * 0.68) * BASIN_SIZE,
    y: (cellY + 0.16 + hashUnit(cellX, cellY, 0x97c1) * 0.68) * BASIN_SIZE,
  };
}

function buildRiverSegments(originX, originY, width, height) {
  const firstCellX = Math.floor(originX / BASIN_SIZE) - 3;
  const lastCellX = Math.floor((originX + width - 1) / BASIN_SIZE) + 3;
  const firstCellY = Math.floor(originY / BASIN_SIZE) - 3;
  const lastCellY = Math.floor((originY + height - 1) / BASIN_SIZE) + 3;
  const nodes = new Map();
  const nodeFor = (cellX, cellY) => {
    const key = `${cellX},${cellY}`;
    let node = nodes.get(key);
    if (!node) {
      node = basinNode(cellX, cellY);
      node.elevation = elevationAt(node.x, node.y);
      nodes.set(key, node);
    }
    return node;
  };
  const rawSegments = [];
  for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
    for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
      const start = nodeFor(cellX, cellY);
      if (start.elevation <= SEA_LEVEL + 0.025) continue;
      let receiver = null;
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (offsetX === 0 && offsetY === 0) continue;
          const candidate = nodeFor(cellX + offsetX, cellY + offsetY);
          if (candidate.elevation >= start.elevation - 0.002) continue;
          if (!receiver || candidate.elevation < receiver.elevation) receiver = candidate;
        }
      }
      if (!receiver) continue;
      rawSegments.push({ start, receiver });
    }
  }
  const incoming = new Map();
  for (const segment of rawSegments) {
    const key = `${segment.receiver.cellX},${segment.receiver.cellY}`;
    incoming.set(key, (incoming.get(key) ?? 0) + 1);
  }
  return rawSegments.map((segment) => {
    const dx = segment.receiver.x - segment.start.x;
    const dy = segment.receiver.y - segment.start.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const bendSign = hashUnit(segment.start.cellX, segment.start.cellY, 0x6c2f) < 0.5 ? -1 : 1;
    const bend = bendSign * length * (
      0.08 + hashUnit(segment.start.cellX, segment.start.cellY, 0x17b9) * 0.17
    );
    const receiverKey = `${segment.receiver.cellX},${segment.receiver.cellY}`;
    return {
      x0: segment.start.x,
      y0: segment.start.y,
      x1: (segment.start.x + segment.receiver.x) / 2 - dy / length * bend,
      y1: (segment.start.y + segment.receiver.y) / 2 + dx / length * bend,
      x2: segment.receiver.x,
      y2: segment.receiver.y,
      width: 0.8 + Math.sqrt(incoming.get(receiverKey) ?? 1) * 0.48,
      meanderAmplitude: 2.4 + hashUnit(segment.start.cellX, segment.start.cellY, 0x8a73) * 5.2,
      meanderPhase: hashUnit(segment.start.cellX, segment.start.cellY, 0x214d) * Math.PI * 2,
    };
  });
}

function distanceToRiver(worldX, worldY, segments) {
  let nearest = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const bounds = 14 + segment.width + segment.meanderAmplitude;
    if (worldX < Math.min(segment.x0, segment.x1, segment.x2) - bounds ||
        worldX > Math.max(segment.x0, segment.x1, segment.x2) + bounds ||
        worldY < Math.min(segment.y0, segment.y1, segment.y2) - bounds ||
        worldY > Math.max(segment.y0, segment.y1, segment.y2) + bounds) continue;
    let previousX = segment.x0;
    let previousY = segment.y0;
    for (let step = 1; step <= 36; step++) {
      const t = step / 36;
      const inverse = 1 - t;
      const baseX = inverse * inverse * segment.x0 + 2 * inverse * t * segment.x1 + t * t * segment.x2;
      const baseY = inverse * inverse * segment.y0 + 2 * inverse * t * segment.y1 + t * t * segment.y2;
      const tangentX = 2 * inverse * (segment.x1 - segment.x0) + 2 * t * (segment.x2 - segment.x1);
      const tangentY = 2 * inverse * (segment.y1 - segment.y0) + 2 * t * (segment.y2 - segment.y1);
      const tangentLength = Math.max(1e-6, Math.hypot(tangentX, tangentY));
      const endpointEnvelope = Math.sin(Math.PI * t);
      const offset = endpointEnvelope * segment.meanderAmplitude * (
        Math.sin(Math.PI * 2 * t + segment.meanderPhase) * 0.72 +
        Math.sin(Math.PI * 5 * t - segment.meanderPhase * 0.63) * 0.28
      );
      const x = baseX - tangentY / tangentLength * offset;
      const y = baseY + tangentX / tangentLength * offset;
      const dx = x - previousX;
      const dy = y - previousY;
      const lengthSquared = dx * dx + dy * dy;
      const projection = lengthSquared > 0
        ? clamp(((worldX - previousX) * dx + (worldY - previousY) * dy) / lengthSquared)
        : 0;
      nearest = Math.min(nearest, Math.hypot(
        worldX - (previousX + dx * projection),
        worldY - (previousY + dy * projection),
      ) - segment.width);
      previousX = x;
      previousY = y;
    }
  }
  return nearest;
}

function buildDescriptors(originX, originY, width, height) {
  const size = width * height;
  const elevation = new Float32Array(size);
  const slope = new Float32Array(size);
  const river = new Uint8Array(size);
  const waterDistance = new Float32Array(size);
  const segments = buildRiverSegments(originX, originY, width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const worldX = originX + x;
      const worldY = originY + y;
      const index = gridIndex(x, y, width);
      const elevationHere = elevationAt(worldX, worldY);
      const slopeHere = Math.max(
        Math.abs(elevationAt(worldX - 1, worldY) - elevationAt(worldX + 1, worldY)) / 2,
        Math.abs(elevationAt(worldX, worldY - 1) - elevationAt(worldX, worldY + 1)) / 2,
      );
      const riverDistance = distanceToRiver(worldX, worldY, segments);
      const coastDistance = elevationHere <= SEA_LEVEL
        ? 0
        : (elevationHere - SEA_LEVEL) / Math.max(0.0025, slopeHere);
      elevation[index] = elevationHere;
      slope[index] = slopeHere;
      river[index] = riverDistance <= 0 && elevationHere > SEA_LEVEL ? 1 : 0;
      waterDistance[index] = Math.min(coastDistance, Math.max(0, riverDistance));
    }
  }
  return { elevation, slope, river, waterDistance, riverSegmentCount: segments.length };
}

function familyWeights(descriptors, originX, originY, width, height) {
  const weights = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const worldX = originX + x;
      const worldY = originY + y;
      const index = gridIndex(x, y, width);
      const elevation = descriptors.elevation[index];
      const slope = descriptors.slope[index];
      const distance = descriptors.waterDistance[index];
      const land = smoothstep(SEA_LEVEL - 0.015, SEA_LEVEL + 0.025, elevation);
      const riverWater = descriptors.river[index] ? 1 : 0;
      const dryLand = land * (1 - riverWater);
      const water = Math.max(1 - land, riverWater);
      const temperature = clamp(
        0.35 + noise01(regionalTemperatureNoise, worldX, worldY, -0.18) * 0.52 -
        elevation * 0.32 + (noise01(temperatureNoise, worldX, worldY, 0.55) - 0.5) * 0.18,
      );
      const waterInfluence = Math.exp(-distance / 17);
      const moisture = clamp(
        0.12 + noise01(moistureNoise, worldX, worldY, -0.47) * 0.56 +
        waterInfluence * 0.42 - elevation * 0.12,
      );
      const accessibility = dryLand * (1 - smoothstep(0.018, 0.09, slope));
      const settlementField = noise01(settlementNoise, worldX, worldY, 0.88);
      const ancientField = noise01(ancientNoise, worldX, worldY, 0.2) * 0.68 +
        noise01(ancientRidgeNoise, worldX, worldY, -0.75) * 0.32;
      const temperate = gaussian(temperature, 0.58, 0.23);
      const shoreBand = gaussian(distance, 5.4, 5.1);

      const coast = water * 2.8 + dryLand * waterInfluence * (0.34 + moisture * 0.46);
      const mountain = dryLand * (
        smoothstep(0.585, 0.715, elevation) * 1.8 +
        smoothstep(0.011, 0.032, slope) * 0.86
      );
      const forest = dryLand * smoothstep(0.34, 0.69, moisture) * temperate *
        (1 - smoothstep(0.72, 0.86, elevation)) * 1.62;
      const rural = accessibility * gaussian(moisture, 0.5, 0.24) * temperate *
        (0.52 + (1 - settlementField) * 0.34) * (1 - water * 0.9);
      const canalTown = accessibility * shoreBand * smoothstep(0.47, 0.70, settlementField) *
        temperate * 2.28;
      const ruins = dryLand * smoothstep(0.52, 0.72, ancientField) *
        (0.50 + smoothstep(0.011, 0.032, slope) * 0.36 + waterInfluence * 0.22) * 1.92;
      const raw = [canalTown, forest, coast, rural, mountain, ruins].map((value) => value + 0.025);
      const softened = raw.map((value) => value ** 2.65);
      const total = softened.reduce((sum, value) => sum + value, 0);
      weights[index] = softened.map((value) => value / total);
    }
  }
  return weights;
}

function blurField(source, radius, width, height) {
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      sum += source[gridIndex(clamp(x, 0, width - 1), y, width)];
    }
    for (let x = 0; x < width; x++) {
      horizontal[gridIndex(x, y, width)] = sum / (radius * 2 + 1);
      sum -= source[gridIndex(clamp(x - radius, 0, width - 1), y, width)];
      sum += source[gridIndex(clamp(x + radius + 1, 0, width - 1), y, width)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += horizontal[gridIndex(x, clamp(y, 0, height - 1), width)];
    }
    for (let y = 0; y < height; y++) {
      output[gridIndex(x, y, width)] = sum / (radius * 2 + 1);
      sum -= horizontal[gridIndex(x, clamp(y - radius, 0, height - 1), width)];
      sum += horizontal[gridIndex(x, clamp(y + radius + 1, 0, height - 1), width)];
    }
  }
  return output;
}

function smoothWeightField(weights, width, height) {
  const byFamily = Array.from({ length: FAMILY_NAMES.length }, (_, family) => {
    const field = Float32Array.from(weights, (cell) => cell[family]);
    // Ecological identity is regional. Cultural opportunity remains more
    // local, but still cannot collapse into one-cell confetti.
    const radius = family === 0 || family === 5 ? 2 : family === 2 ? 3 : 5;
    return blurField(blurField(field, radius, width, height), radius, width, height);
  });
  return Array.from({ length: width * height }, (_, index) => {
    const sharpened = byFamily.map((field) => Math.max(1e-7, field[index]) ** 1.55);
    const total = sharpened.reduce((sum, value) => sum + value, 0);
    return sharpened.map((value) => value / total);
  });
}

function cropDescriptors(source, sourceWidth, offsetX, offsetY, width, height) {
  const copy = (field, Type) => {
    const output = new Type(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        output[gridIndex(x, y, width)] = field[gridIndex(x + offsetX, y + offsetY, sourceWidth)];
      }
    }
    return output;
  };
  return {
    elevation: copy(source.elevation, Float32Array),
    slope: copy(source.slope, Float32Array),
    river: copy(source.river, Uint8Array),
    waterDistance: copy(source.waterDistance, Float32Array),
    riverSegmentCount: source.riverSegmentCount,
  };
}

function cropWeights(source, sourceWidth, offsetX, offsetY, width, height) {
  return Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return source[gridIndex(x + offsetX, y + offsetY, sourceWidth)];
  });
}

function buildWorldFrame(originX, originY, width = WIDTH, height = HEIGHT) {
  const paddedOriginX = originX - FILTER_HALO;
  const paddedOriginY = originY - FILTER_HALO;
  const paddedWidth = width + FILTER_HALO * 2;
  const paddedHeight = height + FILTER_HALO * 2;
  const paddedDescriptors = buildDescriptors(
    paddedOriginX,
    paddedOriginY,
    paddedWidth,
    paddedHeight,
  );
  const paddedWeights = familyWeights(
    paddedDescriptors,
    paddedOriginX,
    paddedOriginY,
    paddedWidth,
    paddedHeight,
  );
  const paddedSmoothedWeights = smoothWeightField(paddedWeights, paddedWidth, paddedHeight);
  return {
    descriptors: cropDescriptors(
      paddedDescriptors,
      paddedWidth,
      FILTER_HALO,
      FILTER_HALO,
      width,
      height,
    ),
    weights: cropWeights(paddedWeights, paddedWidth, FILTER_HALO, FILTER_HALO, width, height),
    smoothedWeights: cropWeights(
      paddedSmoothedWeights,
      paddedWidth,
      FILTER_HALO,
      FILTER_HALO,
      width,
      height,
    ),
  };
}

function validateCoordinateStability(baseFrame) {
  const shiftX = Math.floor(WIDTH / 2);
  const neighbour = buildWorldFrame(ORIGIN_X + shiftX, ORIGIN_Y);
  let maxDescriptorDelta = 0;
  let maxWeightDelta = 0;
  let mismatchedPrimaryFamilies = 0;
  let samples = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let neighbourX = 0; neighbourX < WIDTH - shiftX; neighbourX++) {
      const baseIndex = indexAt(neighbourX + shiftX, y);
      const neighbourIndex = gridIndex(neighbourX, y, WIDTH);
      for (const key of ['elevation', 'slope', 'river', 'waterDistance']) {
        maxDescriptorDelta = Math.max(
          maxDescriptorDelta,
          Math.abs(baseFrame.descriptors[key][baseIndex] - neighbour.descriptors[key][neighbourIndex]),
        );
      }
      for (let family = 0; family < FAMILY_NAMES.length; family++) {
        maxWeightDelta = Math.max(
          maxWeightDelta,
          Math.abs(
            baseFrame.smoothedWeights[baseIndex][family] -
            neighbour.smoothedWeights[neighbourIndex][family],
          ),
        );
      }
      if (primaryIndex(baseFrame.smoothedWeights[baseIndex]) !==
          primaryIndex(neighbour.smoothedWeights[neighbourIndex])) {
        mismatchedPrimaryFamilies++;
      }
      samples++;
    }
  }
  return {
    comparedShift: [shiftX, 0],
    overlappingSamples: samples,
    maxDescriptorDelta,
    maxSmoothedWeightDelta: maxWeightDelta,
    mismatchedPrimaryFamilies,
    exact: maxDescriptorDelta === 0 && maxWeightDelta === 0 && mismatchedPrimaryFamilies === 0,
  };
}

function primaryIndex(weights) {
  let winner = 0;
  for (let index = 1; index < weights.length; index++) {
    if (weights[index] > weights[winner]) winner = index;
  }
  return winner;
}

function cellularCandidate() {
  const colours = new Uint8Array(WIDTH * HEIGHT * 3);
  const labels = new Uint8Array(WIDTH * HEIGHT);
  const cellSize = 42;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const worldX = ORIGIN_X + x;
      const worldY = ORIGIN_Y + y;
      const cellX = Math.floor(worldX / cellSize);
      const cellY = Math.floor(worldY / cellSize);
      let bestDistance = Number.POSITIVE_INFINITY;
      let family = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const regionX = cellX + ox;
          const regionY = cellY + oy;
          const centreX = (regionX + 0.18 + hashUnit(regionX, regionY, 0x4137) * 0.64) * cellSize;
          const centreY = (regionY + 0.18 + hashUnit(regionX, regionY, 0x97c1) * 0.64) * cellSize;
          const distance = (worldX - centreX) ** 2 + (worldY - centreY) ** 2;
          if (distance < bestDistance) {
            bestDistance = distance;
            family = hash(regionX, regionY, 0x2269) % FAMILY_NAMES.length;
          }
        }
      }
      const index = indexAt(x, y);
      labels[index] = family;
      for (let channel = 0; channel < 3; channel++) colours[index * 3 + channel] = FAMILY_COLOURS[family][channel];
    }
  }
  return { colours, labels, weights: null };
}

function hardClimateCandidate(weights) {
  const colours = new Uint8Array(WIDTH * HEIGHT * 3);
  const labels = new Uint8Array(WIDTH * HEIGHT);
  for (let index = 0; index < weights.length; index++) {
    const family = primaryIndex(weights[index]);
    labels[index] = family;
    for (let channel = 0; channel < 3; channel++) colours[index * 3 + channel] = FAMILY_COLOURS[family][channel];
  }
  return { colours, labels, weights: null };
}

function ecotoneCandidate(weights, descriptors) {
  const colours = new Uint8Array(WIDTH * HEIGHT * 3);
  const labels = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const worldX = ORIGIN_X + x;
      const worldY = ORIGIN_Y + y;
      const index = indexAt(x, y);
      const ranked = [1, 2, 3, 4]
        .map((family) => ({ weight: weights[index][family], family }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 2);
      const canalTownOverlay = smoothstep(0.12, 0.62, weights[index][0]);
      const ruinsOverlay = smoothstep(0.14, 0.68, weights[index][5]);
      labels[index] = canalTownOverlay > 0.55 && canalTownOverlay > ruinsOverlay
        ? 0
        : ruinsOverlay > 0.55 ? 5 : ranked[0].family;
      const total = ranked.reduce((sum, entry) => sum + entry.weight, 0);
      const grain = (noise01(detailNoise, worldX, worldY, 0.41) - 0.5) * 13;
      const elevationLight = (descriptors.elevation[index] - 0.5) * 16;
      for (let channel = 0; channel < 3; channel++) {
        const mixed = ranked.reduce(
          (sum, entry) => sum + FAMILY_COLOURS[entry.family][channel] * entry.weight / total,
          0,
        );
        const ecological = mixed + grain + elevationLight;
        const townMixed = ecological + (FAMILY_COLOURS[0][channel] - ecological) * canalTownOverlay * 0.78;
        const culturallyLayered = townMixed +
          (FAMILY_COLOURS[5][channel] - townMixed) * ruinsOverlay * (0.68 - canalTownOverlay * 0.2);
        colours[index * 3 + channel] = Math.round(clamp(culturallyLayered, 0, 255));
      }
    }
  }
  return { colours, labels, weights };
}

function componentMetrics(labels) {
  const seen = new Uint8Array(labels.length);
  const largest = Array(FAMILY_NAMES.length).fill(0);
  const totals = Array(FAMILY_NAMES.length).fill(0);
  const small = Array(FAMILY_NAMES.length).fill(0);
  const queue = new Int32Array(labels.length);
  for (let start = 0; start < labels.length; start++) {
    const family = labels[start];
    totals[family]++;
    if (seen[start]) continue;
    seen[start] = 1;
    let head = 0;
    let tail = 1;
    let count = 0;
    queue[0] = start;
    while (head < tail) {
      const index = queue[head++];
      count++;
      const x = index % WIDTH;
      const y = Math.floor(index / WIDTH);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT) continue;
        const next = indexAt(nx, ny);
        if (seen[next] || labels[next] !== family) continue;
        seen[next] = 1;
        queue[tail++] = next;
      }
    }
    largest[family] = Math.max(largest[family], count);
    if (count < 24) small[family]++;
  }
  return {
    largestComponentShare: Object.fromEntries(FAMILY_NAMES.map((name, index) => [
      name,
      totals[index] ? Number((largest[index] / totals[index]).toFixed(4)) : 0,
    ])),
    smallComponents: Object.fromEntries(FAMILY_NAMES.map((name, index) => [name, small[index]])),
  };
}

function measure(candidate, descriptors) {
  const coverage = Array(FAMILY_NAMES.length).fill(0);
  const weightSamples = candidate.weights
    ? Array.from({ length: FAMILY_NAMES.length }, () => [])
    : null;
  const jumps = [];
  let entropy = 0;
  let ecotone = 0;
  let riverCoastWeight = 0;
  let riverCells = 0;
  let townDistance = 0;
  let townCells = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const index = indexAt(x, y);
      coverage[candidate.labels[index]]++;
      if (candidate.weights) {
        for (let family = 0; family < FAMILY_NAMES.length; family++) {
          weightSamples[family].push(candidate.weights[index][family]);
        }
        const ranked = [...candidate.weights[index]].sort((a, b) => b - a);
        if (ranked[0] - ranked[1] < 0.24) ecotone++;
        entropy += -candidate.weights[index].reduce(
          (sum, weight) => sum + (weight > 0 ? weight * Math.log(weight) : 0),
          0,
        ) / Math.log(FAMILY_NAMES.length);
        if (descriptors.river[index]) {
          riverCoastWeight += candidate.weights[index][2];
          riverCells++;
        }
      }
      if (candidate.labels[index] === 0) {
        townDistance += descriptors.waterDistance[index];
        townCells++;
      }
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= WIDTH || ny >= HEIGHT) continue;
        const neighbour = indexAt(nx, ny);
        if (candidate.labels[neighbour] === candidate.labels[index]) continue;
        const offsetA = index * 3;
        const offsetB = neighbour * 3;
        jumps.push(Math.hypot(
          candidate.colours[offsetA] - candidate.colours[offsetB],
          candidate.colours[offsetA + 1] - candidate.colours[offsetB + 1],
          candidate.colours[offsetA + 2] - candidate.colours[offsetB + 2],
        ));
      }
    }
  }
  jumps.sort((a, b) => a - b);
  const component = componentMetrics(candidate.labels);
  const weightQuantiles = weightSamples
    ? Object.fromEntries(FAMILY_NAMES.map((name, family) => {
        const samples = weightSamples[family].sort((a, b) => a - b);
        const at = (quantile) => samples[Math.floor((samples.length - 1) * quantile)] ?? 0;
        return [name, {
          p50: Number(at(0.5).toFixed(4)),
          p90: Number(at(0.9).toFixed(4)),
          p99: Number(at(0.99).toFixed(4)),
          max: Number(at(1).toFixed(4)),
        }];
      }))
    : null;
  return {
    familyCoverage: Object.fromEntries(FAMILY_NAMES.map((name, index) => [
      name,
      Number((coverage[index] / candidate.labels.length).toFixed(4)),
    ])),
    meanNormalizedEntropy: Number((entropy / candidate.labels.length).toFixed(4)),
    ecotoneShare: Number((ecotone / candidate.labels.length).toFixed(4)),
    meanBoundaryColourJump: Number((jumps.reduce((sum, value) => sum + value, 0) / Math.max(1, jumps.length)).toFixed(2)),
    p95BoundaryColourJump: Number((jumps[Math.floor(jumps.length * 0.95)] ?? 0).toFixed(2)),
    meanRiverCoastWeight: riverCells ? Number((riverCoastWeight / riverCells).toFixed(4)) : null,
    canalTownMeanWaterDistance: townCells ? Number((townDistance / townCells).toFixed(2)) : null,
    sha256: crypto.createHash('sha256').update(candidate.colours).digest('hex'),
    weightQuantiles,
    ...component,
  };
}

function descriptorQuantiles(descriptors) {
  const summarize = (field) => {
    const values = Array.from(field).sort((a, b) => a - b);
    const at = (quantile) => values[Math.floor((values.length - 1) * quantile)] ?? 0;
    return Object.fromEntries([0.1, 0.25, 0.5, 0.75, 0.9, 0.99].map((quantile) => [
      `p${Math.round(quantile * 100)}`,
      Number(at(quantile).toFixed(4)),
    ]));
  };
  return {
    elevation: summarize(descriptors.elevation),
    slope: summarize(descriptors.slope),
    waterDistance: summarize(descriptors.waterDistance),
  };
}

async function writeRaster(filename, colours, scale = 3) {
  await sharp(colours, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .resize(WIDTH * scale, HEIGHT * scale, { kernel: 'nearest' })
    .png()
    .toFile(path.join(OUTPUT, filename));
}

async function writeOctant(filename, colours) {
  const grid = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => {
      const offset = indexAt(x, y) * 3;
      return { r: colours[offset], g: colours[offset + 1], b: colours[offset + 2] };
    }));
  const cells = renderOctantGridCells(grid);
  const cellWidth = 9;
  const cellHeight = 18;
  const width = cells[0].length * cellWidth;
  const height = cells.length * cellHeight;
  const image = Buffer.alloc(width * height * 3);
  const lookup = new Map();
  OCTANT_CHARS.forEach((character, pattern) => {
    const code = character.codePointAt(0);
    if (!lookup.has(code)) lookup.set(code, pattern);
  });
  const fill = (x0, y0, w, h, colour) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const offset = (y * width + x) * 3;
        image[offset] = colour.r;
        image[offset + 1] = colour.g;
        image[offset + 2] = colour.b;
      }
    }
  };
  for (let y = 0; y < cells.length; y++) {
    for (let x = 0; x < cells[y].length; x++) {
      const cell = cells[y][x];
      const foreground = cell.fgColor ?? { r: 15, g: 15, b: 20 };
      const background = cell.bgColor ?? { r: 15, g: 15, b: 20 };
      fill(x * cellWidth, y * cellHeight, cellWidth, cellHeight, background);
      const pattern = lookup.get(cell.char.codePointAt(0)) ?? 0;
      for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 2; column++) {
          if (!(pattern & (1 << (row * 2 + column)))) continue;
          const x0 = Math.round(column * cellWidth / 2);
          const x1 = Math.round((column + 1) * cellWidth / 2);
          const y0 = Math.round(row * cellHeight / 4);
          const y1 = Math.round((row + 1) * cellHeight / 4);
          fill(x * cellWidth + x0, y * cellHeight + y0, x1 - x0, y1 - y0, foreground);
        }
      }
    }
  }
  await sharp(image, { raw: { width, height, channels: 3 } }).png().toFile(path.join(OUTPUT, filename));
}

async function writeComparison(entries) {
  const panelWidth = 640;
  const panelHeight = 352;
  const labelHeight = 44;
  const composites = [];
  for (let index = 0; index < entries.length; index++) {
    const image = await sharp(path.join(OUTPUT, entries[index].filename))
      .resize(panelWidth, panelHeight, { fit: 'cover' })
      .png()
      .toBuffer();
    composites.push({ input: image, left: index * panelWidth, top: labelHeight });
    composites.push({
      input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#0d0d12"/><text x="${panelWidth / 2}" y="30" fill="#f3eee7" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" font-size="22">${entries[index].label}</text></svg>`),
      left: index * panelWidth,
      top: 0,
    });
  }
  await sharp({
    create: {
      width: panelWidth * entries.length,
      height: panelHeight + labelHeight,
      channels: 3,
      background: '#0d0d12',
    },
  }).composite(composites).png().toFile(path.join(OUTPUT, 'comparison.png'));
}

const startedAt = performance.now();
const worldFrame = buildWorldFrame(ORIGIN_X, ORIGIN_Y);
const { descriptors, weights, smoothedWeights } = worldFrame;
const candidates = {
  'cellular-hard': cellularCandidate(),
  'climate-hard': hardClimateCandidate(weights),
  'layered-ecotone': ecotoneCandidate(smoothedWeights, descriptors),
};
for (const [name, candidate] of Object.entries(candidates)) {
  await writeRaster(`${name}.png`, candidate.colours);
}
await writeOctant('layered-ecotone-ansi-160x44.png', candidates['layered-ecotone'].colours);
await writeComparison([
  { filename: 'cellular-hard.png', label: 'CELLULAR HARD REGIONS' },
  { filename: 'climate-hard.png', label: 'HYDROCLIMATE ARGMAX' },
  { filename: 'layered-ecotone.png', label: 'LAYERED ECOTONES' },
]);
const metrics = {
  labVersion: LAB_VERSION,
  worldSeed: process.env.MALDOROR_WORLD_SEED ?? '8801799478018485',
  seed: String(BigInt.asUintN(32, BigInt(SEED))),
  origin: [ORIGIN_X, ORIGIN_Y],
  dimensions: { source: [WIDTH, HEIGHT], terminal: [WIDTH / 2, HEIGHT / 4] },
  seaLevel: SEA_LEVEL,
  filterHalo: FILTER_HALO,
  hydrologyModel: 'coordinate-stable deterministic basin graph with bowed, multi-frequency meandering river segments',
  riverSegmentCount: descriptors.riverSegmentCount,
  riverCells: descriptors.river.reduce((sum, value) => sum + value, 0),
  descriptorQuantiles: descriptorQuantiles(descriptors),
  coordinateStability: validateCoordinateStability(worldFrame),
  elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
  candidates: Object.fromEntries(Object.entries(candidates).map(([name, candidate]) => [
    name,
    measure(candidate, descriptors),
  ])),
};
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, ...metrics }, null, 2));
