/**
 * Controlled macro-field entropy audit.
 *
 * The two experiments isolate the coordinate hash from terrain and content:
 * basin centres exercise the biome/hydrology jitter at 10,201 travel-scale
 * cells; route sites exercise the real four-neighbour thinning and five
 * candidate selection on a flat biome. This prevents rich material colour
 * from hiding axis-correlated geography or topology.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  REGIONAL_BASIN_SIZE,
  spatialHash2DUnit,
} from '../../packages/world/dist/index.js';

const OUTPUT = process.env.MALDOROR_MACRO_ENTROPY_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-4-world-composition/travel-entropy-v12-macro-hash-audit';
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const SEED = Number(BigInt.asUintN(32, WORLD_SEED));
const WIDTH = 1200;
const PANEL_HEIGHT = 338;
const BASIN_CELL_SIZE = REGIONAL_BASIN_SIZE;
const BASIN_RADIUS = 50;
const ROUTE_CELL_SIZE = 40;
const ROUTE_BOUNDS = { minX: -800, minY: -800, maxX: 800, maxY: 800 };

fs.mkdirSync(OUTPUT, { recursive: true });

function legacyHash(x, y, salt) {
  let value = Math.imul((x | 0) ^ SEED ^ salt, 0x45d9f3b);
  value = Math.imul(value ^ (y | 0), 0x119de1f3);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function selectedHash(x, y, salt) {
  return spatialHash2DUnit(SEED, x, y, salt);
}

function generateBasinCentres(hashUnit) {
  const points = [];
  for (let cellY = -BASIN_RADIUS; cellY <= BASIN_RADIUS; cellY++) {
    for (let cellX = -BASIN_RADIUS; cellX <= BASIN_RADIUS; cellX++) {
      points.push({
        x: Math.floor((cellX + 0.16 + hashUnit(cellX, cellY, 0x4137) * 0.68) * BASIN_CELL_SIZE),
        y: Math.floor((cellY + 0.16 + hashUnit(cellX, cellY, 0x97c1) * 0.68) * BASIN_CELL_SIZE),
      });
    }
  }
  return points;
}

function generateRouteSites(hashUnit) {
  const points = [];
  const firstCellX = Math.floor(ROUTE_BOUNDS.minX / ROUTE_CELL_SIZE) - 1;
  const lastCellX = Math.floor(ROUTE_BOUNDS.maxX / ROUTE_CELL_SIZE) + 1;
  const firstCellY = Math.floor(ROUTE_BOUNDS.minY / ROUTE_CELL_SIZE) - 1;
  const lastCellY = Math.floor(ROUTE_BOUNDS.maxY / ROUTE_CELL_SIZE) + 1;
  for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
    for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
      const acceptance = hashUnit(cellX, cellY, 0x71a3);
      const neighbours = [[0, -1], [-1, 0], [1, 0], [0, 1]];
      if (neighbours.some(([offsetX, offsetY]) => (
        hashUnit(cellX + offsetX, cellY + offsetY, 0x71a3) < acceptance
      ))) continue;
      const candidates = Array.from({ length: 5 }, (_, index) => ({
        x: Math.round((cellX + 0.08 + hashUnit(cellX, cellY, 0x2171 + index * 37) * 0.84) * ROUTE_CELL_SIZE),
        y: Math.round((cellY + 0.08 + hashUnit(cellX, cellY, 0x691d + index * 53) * 0.84) * ROUTE_CELL_SIZE),
      })).sort((a, b) => a.x - b.x || a.y - b.y);
      const selected = candidates[0];
      if (selected.x < ROUTE_BOUNDS.minX || selected.x > ROUTE_BOUNDS.maxX ||
          selected.y < ROUTE_BOUNDS.minY || selected.y > ROUTE_BOUNDS.maxY) continue;
      points.push(selected);
    }
  }
  return points;
}

function entropy(counts) {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return -[...counts.values()].reduce((sum, count) => {
    const probability = count / total;
    return sum + probability * Math.log(probability);
  }, 0);
}

function countBy(points, key) {
  const counts = new Map();
  for (const point of points) {
    const value = key(point);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function summarize(points, cellSize, withNearestVectors = false) {
  const rows = countBy(points, (point) => point.y);
  const columns = countBy(points, (point) => point.x);
  const phases = countBy(points, (point) => (
    `${positiveMod(point.x, cellSize)},${positiveMod(point.y, cellSize)}`
  ));
  const result = {
    points: points.length,
    uniqueX: columns.size,
    uniqueY: rows.size,
    axisUniqueImbalance: Number((Math.abs(columns.size - rows.size) / points.length).toFixed(6)),
    maximumOnOneColumn: Math.max(...columns.values()),
    maximumOnOneRow: Math.max(...rows.values()),
    effectiveColumns: Number(Math.exp(entropy(columns)).toFixed(3)),
    effectiveRows: Number(Math.exp(entropy(rows)).toFixed(3)),
    uniqueCellPhases: phases.size,
    effectiveCellPhases: Number(Math.exp(entropy(phases)).toFixed(3)),
  };
  if (!withNearestVectors) return result;
  const vectors = new Map();
  for (const point of points) {
    let nearest = null;
    for (const candidate of points) {
      if (candidate === point) continue;
      const dx = candidate.x - point.x;
      const dy = candidate.y - point.y;
      const distance = dx * dx + dy * dy;
      if (!nearest || distance < nearest.distance ||
          (distance === nearest.distance && (dy < nearest.dy || (dy === nearest.dy && dx < nearest.dx)))) {
        nearest = { dx, dy, distance };
      }
    }
    if (nearest) {
      const key = `${nearest.dx},${nearest.dy}`;
      vectors.set(key, (vectors.get(key) ?? 0) + 1);
    }
  }
  return {
    ...result,
    uniqueNearestVectors: vectors.size,
    maximumRepeatedNearestVector: Math.max(...vectors.values()),
  };
}

function panelSvg({ offsetY, title, note, points, metrics, colour, bounds, radius }) {
  const marginX = 44;
  const plotTop = offsetY + 90;
  const plotHeight = PANEL_HEIGHT - 118;
  const plotWidth = WIDTH - marginX * 2;
  const scale = Math.min(
    plotWidth / (bounds.maxX - bounds.minX),
    plotHeight / (bounds.maxY - bounds.minY),
  );
  const renderedWidth = (bounds.maxX - bounds.minX) * scale;
  const renderedHeight = (bounds.maxY - bounds.minY) * scale;
  const left = marginX + (plotWidth - renderedWidth) / 2;
  const top = plotTop + (plotHeight - renderedHeight) / 2;
  const scaleX = (x) => left + (x - bounds.minX) * scale;
  const scaleY = (y) => top + (y - bounds.minY) * scale;
  const marks = points.map(({ x, y }) => (
    `<circle cx="${scaleX(x).toFixed(2)}" cy="${scaleY(y).toFixed(2)}" r="${radius}" fill="${colour}" fill-opacity="0.83"/>`
  )).join('');
  return `
    <rect x="18" y="${offsetY + 12}" width="${WIDTH - 36}" height="${PANEL_HEIGHT - 20}" rx="14" fill="#11151e" stroke="#2e3447"/>
    <text x="44" y="${offsetY + 43}" fill="#f1eadc" font-size="21" font-weight="700">${title}</text>
    <text x="44" y="${offsetY + 66}" fill="#98a3b7" font-size="13">${note}</text>
    <text x="${WIDTH - 44}" y="${offsetY + 43}" text-anchor="end" fill="${colour}" font-size="14" font-weight="700">${metrics.points} points · x ${metrics.uniqueX} · y ${metrics.uniqueY} · phases ${metrics.uniqueCellPhases}</text>
    <rect x="${left}" y="${top}" width="${renderedWidth}" height="${renderedHeight}" fill="#090c12" stroke="#252b3a"/>
    ${marks}`;
}

const legacyBasins = generateBasinCentres(legacyHash);
const selectedBasins = generateBasinCentres(selectedHash);
const legacyRoutes = generateRouteSites(legacyHash);
const selectedRoutes = generateRouteSites(selectedHash);
const basinWorldBounds = {
  minX: -BASIN_RADIUS * BASIN_CELL_SIZE,
  minY: -BASIN_RADIUS * BASIN_CELL_SIZE,
  maxX: (BASIN_RADIUS + 1) * BASIN_CELL_SIZE,
  maxY: (BASIN_RADIUS + 1) * BASIN_CELL_SIZE,
};
const experiments = {
  basinCentres: {
    cellSize: BASIN_CELL_SIZE,
    cellsPerAxis: BASIN_RADIUS * 2 + 1,
    legacy: summarize(legacyBasins, BASIN_CELL_SIZE),
    selected: summarize(selectedBasins, BASIN_CELL_SIZE),
  },
  routeSites: {
    cellSize: ROUTE_CELL_SIZE,
    bounds: ROUTE_BOUNDS,
    controlledTerrain: 'flat dry forest; five candidates tie on suitability, then x/y',
    legacy: summarize(legacyRoutes, ROUTE_CELL_SIZE, true),
    selected: summarize(selectedRoutes, ROUTE_CELL_SIZE, true),
  },
};
const panels = [
  {
    title: 'Rejected macro basins · folded axes',
    note: 'Hydrology seed centres collapse y positions and repeat sub-cell phases over 10,201 basins.',
    points: legacyBasins,
    metrics: experiments.basinCentres.legacy,
    colour: '#e06c75',
    bounds: basinWorldBounds,
    radius: 0.72,
  },
  {
    title: 'Selected macro basins · independent axes',
    note: 'The same density and jitter envelope, with symmetric coordinate diversity after a two-axis avalanche.',
    points: selectedBasins,
    metrics: experiments.basinCentres.selected,
    colour: '#65d6ad',
    bounds: basinWorldBounds,
    radius: 0.72,
  },
  {
    title: 'Rejected route sites · folded axes',
    note: 'The real four-neighbour thinning rule on flat terrain exposes repeated rows before any route is drawn.',
    points: legacyRoutes,
    metrics: experiments.routeSites.legacy,
    colour: '#e6a35c',
    bounds: ROUTE_BOUNDS,
    radius: 2.25,
  },
  {
    title: 'Selected route sites · independent axes',
    note: 'Accepted nodes spread through both dimensions; Gabriel edges inherit a less anisotropic foundation.',
    points: selectedRoutes,
    metrics: experiments.routeSites.selected,
    colour: '#68b9e8',
    bounds: ROUTE_BOUNDS,
    radius: 2.25,
  },
];
const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${PANEL_HEIGHT * panels.length + 20}">
    <rect width="100%" height="100%" fill="#080a10"/>
    <style>text { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }</style>
    ${panels.map((panel, index) => panelSvg({ ...panel, offsetY: index * PANEL_HEIGHT })).join('')}
  </svg>`;
const comparisonPath = path.join(OUTPUT, 'macro-hash-comparison.png');
await sharp(Buffer.from(svg)).png().toFile(comparisonPath);
const metrics = {
  worldSeed: String(WORLD_SEED),
  seed32: SEED,
  experiments,
  comparisonSha256: crypto.createHash('sha256').update(fs.readFileSync(comparisonPath)).digest('hex'),
  research: [
    'https://jcgt.org/published/0009/03/02/',
    'https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf',
  ],
};
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, ...metrics }, null, 2));

function positiveMod(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}
