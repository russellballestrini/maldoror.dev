/**
 * Controlled travel-scale placement entropy comparison.
 *
 * This isolates the coordinate hash from biome eligibility so a visually
 * structured distribution cannot hide behind content scarcity. The candidate,
 * 3x3 priority thinning, bounds, and route-clearance rules match the synthetic
 * RegionalWorldTileProvider regression fixture.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const OUTPUT = process.env.MALDOROR_PLACEMENT_ENTROPY_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-4-world-composition/travel-entropy-v3-hash-audit';
const SEED = 42;
const CELL_SIZE = 18;
const BOUNDS = { minX: -2000, minY: -48, maxX: 2000, maxY: 48 };
const WIDTH = 1200;
const PANEL_HEIGHT = 270;

fs.mkdirSync(OUTPUT, { recursive: true });

function legacyHash(x, y, salt) {
  let value = Math.imul((x | 0) ^ SEED ^ salt, 0x45d9f3b);
  value = Math.imul(value ^ (y | 0), 0x119de1f3);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function selectedHash(x, y, salt) {
  let value = (SEED ^ salt ^ Math.imul(x | 0, 0x9e3779b1)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value ^= Math.imul(y | 0, 0xc2b2ae35);
  value = Math.imul(value ^ (value >>> 13), 0x27d4eb2d);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function generatePlacements(hashUnit) {
  const placements = [];
  const firstCellX = Math.floor(BOUNDS.minX / CELL_SIZE) - 1;
  const lastCellX = Math.floor(BOUNDS.maxX / CELL_SIZE) + 1;
  const firstCellY = Math.floor(BOUNDS.minY / CELL_SIZE) - 1;
  const lastCellY = Math.floor(BOUNDS.maxY / CELL_SIZE) + 1;
  for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
    for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
      const priority = hashUnit(cellX, cellY, 0x31f7);
      let maximum = true;
      for (let offsetY = -1; offsetY <= 1 && maximum; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (offsetX === 0 && offsetY === 0) continue;
          const neighbour = hashUnit(cellX + offsetX, cellY + offsetY, 0x31f7);
          if (neighbour > priority || (neighbour === priority &&
              (offsetY < 0 || (offsetY === 0 && offsetX < 0)))) {
            maximum = false;
            break;
          }
        }
      }
      if (!maximum) continue;
      const margin = 0.16;
      const span = 1 - margin * 2;
      const x = Math.floor((cellX + margin + hashUnit(cellX, cellY, 0x913d) * span) * CELL_SIZE);
      const y = Math.floor((cellY + margin + hashUnit(cellX, cellY, 0xc7a5) * span) * CELL_SIZE);
      if (x < BOUNDS.minX || x > BOUNDS.maxX || y < BOUNDS.minY || y > BOUNDS.maxY) continue;
      if (Math.abs(y) < 1.5) continue;
      placements.push({ cellX, cellY, x, y });
    }
  }
  return placements.sort((a, b) => a.y - b.y || a.x - b.x);
}

function entropy(counts) {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return -[...counts.values()].reduce((sum, count) => {
    const probability = count / total;
    return sum + probability * Math.log(probability);
  }, 0);
}

function quantile(values, amount) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * amount)));
  return sorted[index] ?? 0;
}

function summarize(placements) {
  const rows = new Map();
  const phases = new Map();
  const nearestDistances = [];
  const nearestVectors = new Map();
  for (const placement of placements) {
    rows.set(placement.y, (rows.get(placement.y) ?? 0) + 1);
    const phase = `${((placement.x % CELL_SIZE) + CELL_SIZE) % CELL_SIZE},${
      ((placement.y % CELL_SIZE) + CELL_SIZE) % CELL_SIZE}`;
    phases.set(phase, (phases.get(phase) ?? 0) + 1);
    let nearest = null;
    for (const candidate of placements) {
      if (candidate === placement) continue;
      const dx = candidate.x - placement.x;
      const dy = candidate.y - placement.y;
      const distance = Math.hypot(dx, dy);
      if (!nearest || distance < nearest.distance ||
          (distance === nearest.distance && (dy < nearest.dy || (dy === nearest.dy && dx < nearest.dx)))) {
        nearest = { dx, dy, distance };
      }
    }
    if (nearest) {
      nearestDistances.push(nearest.distance);
      const vector = `${nearest.dx},${nearest.dy}`;
      nearestVectors.set(vector, (nearestVectors.get(vector) ?? 0) + 1);
    }
  }
  const rowEntropy = entropy(rows);
  const phaseEntropy = entropy(phases);
  return {
    placements: placements.length,
    occupiedRows: rows.size,
    maximumPlacementsOnOneRow: Math.max(...rows.values()),
    maximumRowShare: Number((Math.max(...rows.values()) / placements.length).toFixed(6)),
    effectiveRows: Number(Math.exp(rowEntropy).toFixed(3)),
    uniqueJitterPhases: phases.size,
    effectiveJitterPhases: Number(Math.exp(phaseEntropy).toFixed(3)),
    uniqueNearestVectors: nearestVectors.size,
    maximumRepeatedNearestVector: Math.max(...nearestVectors.values()),
    nearestDistance: {
      minimum: Number(Math.min(...nearestDistances).toFixed(3)),
      p50: Number(quantile(nearestDistances, 0.5).toFixed(3)),
      p95: Number(quantile(nearestDistances, 0.95).toFixed(3)),
    },
  };
}

function panelSvg(label, note, placements, metrics, colour, offsetY) {
  const marginX = 42;
  const plotTop = offsetY + 72;
  const plotHeight = PANEL_HEIGHT - 98;
  const scaleX = (x) => marginX + (x - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX) * (WIDTH - marginX * 2);
  const scaleY = (y) => plotTop + (y - BOUNDS.minY) / (BOUNDS.maxY - BOUNDS.minY) * plotHeight;
  const points = placements.map(({ x, y }) => (
    `<circle cx="${scaleX(x).toFixed(2)}" cy="${scaleY(y).toFixed(2)}" r="2.35" fill="${colour}"/>`
  )).join('');
  return `
    <rect x="18" y="${offsetY + 14}" width="${WIDTH - 36}" height="${PANEL_HEIGHT - 20}" rx="14" fill="#11151e" stroke="#2e3447"/>
    <text x="42" y="${offsetY + 45}" fill="#f1eadc" font-size="22" font-weight="700">${label}</text>
    <text x="42" y="${offsetY + 66}" fill="#98a3b7" font-size="13">${note}</text>
    <text x="${WIDTH - 42}" y="${offsetY + 46}" text-anchor="end" fill="${colour}" font-size="15" font-weight="700">${metrics.placements} contacts · ${metrics.occupiedRows} rows · ${metrics.uniqueJitterPhases} phases</text>
    <rect x="${marginX}" y="${plotTop}" width="${WIDTH - marginX * 2}" height="${plotHeight}" fill="#090c12" stroke="#252b3a"/>
    ${points}`;
}

const legacyPlacements = generatePlacements(legacyHash);
const selectedPlacements = generatePlacements(selectedHash);
const legacy = summarize(legacyPlacements);
const selected = summarize(selectedPlacements);
const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${PANEL_HEIGHT * 2 + 24}" viewBox="0 0 ${WIDTH} ${PANEL_HEIGHT * 2 + 24}">
    <rect width="100%" height="100%" fill="#080a10"/>
    <style>text { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }</style>
    ${panelSvg('Rejected: folded-axis hash', 'The y axis is mixed after x, preserving visible coordinate correlations.', legacyPlacements, legacy, '#e06c75', 0)}
    ${panelSvg('Selected: independent-axis avalanche', 'Both signed axes are diffused before the final avalanche; density remains comparable.', selectedPlacements, selected, '#65d6ad', PANEL_HEIGHT)}
  </svg>`;
const comparisonPath = path.join(OUTPUT, 'placement-row-comparison.png');
await sharp(Buffer.from(svg)).png().toFile(comparisonPath);
const metrics = {
  worldSeed: SEED,
  cellSize: CELL_SIZE,
  bounds: BOUNDS,
  controlledRules: ['3x3 priority maximum', '16% cell inset', 'route clearance |y| >= 1.5'],
  legacy,
  selected,
  comparisonSha256: crypto.createHash('sha256').update(fs.readFileSync(comparisonPath)).digest('hex'),
  research: [
    'https://jcgt.org/published/0009/03/02/',
    'https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf',
  ],
};
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, ...metrics }, null, 2));
