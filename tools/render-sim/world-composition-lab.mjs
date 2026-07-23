#!/usr/bin/env node
/**
 * Phase-0 / Track-4 fixed experiment: compare a repeated block stamp with
 * three materially different hierarchical spatial grammars. The scene goals,
 * output dimensions, palette, rasterizer, terminal codec, and measurements are
 * held constant. Generated evidence belongs on the mounted research drive.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUTPUT = path.resolve(process.argv[2] ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-4-world-composition/composition-lab-v1');
const W = 120;
const H = 80;
const SCALE = 8;
const ANSI_COLS = 120;
const ANSI_ROWS = 40;
const SEED = 0x71aa31;
const WATER = 0;
const PAVING = 1;
const GARDEN = 2;
const BUILDING = 3;
const SOIL = 4;
const PLAZA = 5;
const BRIDGE = 6;
const LANDMARKS = [
  { id: 'origin', x: 60, y: 40 },
  { id: 'market', x: 83, y: 20 },
  { id: 'garden', x: 35, y: 22 },
  { id: 'dock', x: 30, y: 61 },
  { id: 'chapel', x: 91, y: 61 },
];
const CANDIDATES = [
  ['periodic-block', periodicBlock],
  ['warped-field', warpedField],
  ['hydrology-graph', hydrologyGraph],
  ['goal-constraint', goalConstraint],
];

const { renderOctantGridCells } = await import(`${REPO}/packages/render/dist/pixel/pixel-renderer.js`);
const { TerminalCodec } = await import(`${REPO}/packages/render/dist/pixel/terminal-codec.js`);
fs.mkdirSync(OUTPUT, { recursive: true });

const scenes = new Map();
const measurements = {};
for (const [name, generate] of CANDIDATES) {
  const started = performance.now();
  const scene = generate();
  measurements[name] = {
    generationMs: Number((performance.now() - started).toFixed(2)),
    ...measure(scene),
  };
  scenes.set(name, scene);
  const sourcePath = path.join(OUTPUT, `${name}-source.png`);
  await sharp(render(scene), { raw: { width: W * SCALE, height: H * SCALE, channels: 3 } })
    .png().toFile(sourcePath);
  await sharp(renderMask(scene), { raw: { width: W, height: H, channels: 3 } })
    .png().toFile(path.join(OUTPUT, `${name}-semantic-mask.png`));
  await writeAnsi(name, sourcePath);
}
await writeComparison();

const metrics = {
  experiment: 'track-4-world-composition/composition-lab-v1',
  generatedAt: new Date().toISOString(),
  worldSeed: SEED,
  fixedContent: {
    worldCells: [W, H],
    sourcePixels: [W * SCALE, H * SCALE],
    ansi: [ANSI_COLS, ANSI_ROWS],
    landmarks: LANDMARKS,
  },
  approaches: {
    'periodic-block': 'current-style modulo water crosses and repeated parcel stamps',
    'warped-field': 'domain-warped continuous water and land-use fields with bank-following routes',
    'hydrology-graph': 'explicit hierarchical drainage graph with confluences, offset quays, and cross-basin routes',
    'goal-constraint': 'global landmark goals connected by A* routes under local water, clearance, and turn constraints',
  },
  measurements,
  interpretation: {
    maximumLagAutocorrelation: 'largest class-field correlation at 6..36-cell axis lags; lower indicates less periodic repetition',
    uniqueWindowRatio: 'unique 12x12 semantic signatures sampled every four cells; higher indicates less repeated local composition',
    largestWalkableComponent: 'share of non-water, non-building cells in the largest four-neighbour component',
    connectedLandmarks: `landmarks reachable from the origin out of ${LANDMARKS.length}`,
    protectedLandmarkClearance: 'mean non-water, non-building share in radius four around each fixed landmark',
    waterBoundaryComplexity: 'water boundary cells divided by square root of water area; diagnostic, not a realism score',
  },
  limitations: [
    'This lab compares semantic composition, not final asset quality; every candidate uses the same deliberately simple diagnostic paint.',
    'Finite-window metrics can miss repetition beyond the sampled extent and cannot judge place quality by themselves.',
    'Buildings are bounded diagnostic masses, not the production parcel or architecture system.',
    'Direct source and faithful terminal review remain authoritative.',
  ],
};
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, ...metrics }, null, 2));

function emptyScene() {
  return { kind: new Uint8Array(W * H).fill(SOIL), roads: new Uint8Array(W * H) };
}

function periodicBlock() {
  const scene = emptyScene();
  forEachCell((x, y, index) => {
    const lx = mod(x, 30);
    const ly = mod(y, 26);
    if (lx < 7 || (ly >= 11 && ly < 17)) scene.kind[index] = WATER;
    else scene.kind[index] = PAVING;
  });
  for (let by = 0; by < H; by += 26) {
    for (let bx = 0; bx < W; bx += 30) {
      for (const y of [by + 8, by + 20]) {
        for (const x of [bx + 11, bx + 18, bx + 25]) stampRect(scene, x - 3, y - 2, 6, 4, BUILDING);
      }
      stampRoute(scene, [[bx + 3, by + 13], [bx + 27, by + 13]], 1.4, true);
      stampRoute(scene, [[bx + 14, by + 2], [bx + 14, by + 24]], 1.1, true);
    }
  }
  protectLandmarks(scene);
  return scene;
}

function warpedField() {
  const scene = emptyScene();
  forEachCell((x, y, index) => {
    const wx = (valueNoise(x * 0.025, y * 0.025, 11) - 0.5) * 18;
    const wy = (valueNoise(x * 0.022, y * 0.022, 19) - 0.5) * 14;
    const trunkX = 57 + 13 * Math.sin((y + wy) * 0.055) + 4 * Math.sin(y * 0.137);
    const branchY = 28 + 8 * Math.sin((x + wx) * 0.066 + 1.2);
    const trunk = Math.abs(x + wx * 0.34 - trunkX) < 5.2 + 1.1 * valueNoise(x * 0.08, y * 0.08, 23);
    const branch = x > trunkX - 2 && Math.abs(y + wy * 0.25 - branchY) < 3.1;
    if (trunk || branch) scene.kind[index] = WATER;
    else if (fbm(x * 0.035, y * 0.035, 37) > 0.57) scene.kind[index] = GARDEN;
  });
  const westBank = [], eastBank = [];
  for (let y = 0; y < H; y += 2) {
    const centre = 57 + 13 * Math.sin(y * 0.055) + 4 * Math.sin(y * 0.137);
    westBank.push([centre - 8.5, y]);
    eastBank.push([centre + 8.5, y]);
  }
  stampRoute(scene, westBank, 1.6);
  stampRoute(scene, eastBank, 1.6);
  stampRoute(scene, [[7, 40], [39, 37], [60, 40], [86, 35], [116, 40]], 2.1, true);
  stampRoute(scene, [[35, 22], [53, 34], [60, 40], [75, 52], [91, 61]], 1.5, true);
  addOrganicMasses(scene, 0x101);
  protectLandmarks(scene);
  return scene;
}

function hydrologyGraph() {
  const scene = emptyScene();
  const channels = [
    [[48, -4], [51, 15], [55, 31], [61, 44], [68, 60], [76, 84]],
    [[5, 12], [22, 16], [36, 25], [55, 31]],
    [[112, 7], [96, 12], [81, 24], [61, 44]],
    [[8, 73], [28, 67], [47, 55], [61, 44]],
  ];
  forEachCell((x, y, index) => {
    let d = Infinity;
    for (let branch = 0; branch < channels.length; branch++) {
      d = Math.min(d, distanceToPolyline(x, y, channels[branch]));
    }
    const perturb = (fbm(x * 0.065, y * 0.065, 43) - 0.5) * 2.2;
    if (d + perturb < 3.7) scene.kind[index] = WATER;
    else if (fbm(x * 0.028, y * 0.028, 47) > 0.60) scene.kind[index] = GARDEN;
  });
  for (const channel of channels) {
    const left = offsetPolyline(channel, -6.5);
    const right = offsetPolyline(channel, 6.5);
    stampRoute(scene, left, 1.2);
    stampRoute(scene, right, 1.2);
  }
  stampRoute(scene, [[9, 43], [29, 37], [50, 39], [60, 40], [82, 39], [111, 48]], 1.8, true);
  stampRoute(scene, [[35, 22], [44, 35], [60, 40], [76, 49], [91, 61]], 1.4, true);
  addOrganicMasses(scene, 0x202);
  protectLandmarks(scene);
  return scene;
}

function goalConstraint() {
  const scene = emptyScene();
  forEachCell((x, y, index) => {
    const centre = 54 + 12 * Math.sin(y * 0.052 + 0.7) + 5 * Math.sin(y * 0.121);
    const inlet = y > 50 && Math.abs(y - (57 + 5 * Math.sin(x * 0.09))) < 3 && x < centre;
    if (Math.abs(x - centre) < 4.4 || inlet) scene.kind[index] = WATER;
    else if (fbm(x * 0.031, y * 0.031, 59) > 0.62) scene.kind[index] = GARDEN;
  });
  const pairs = [
    [LANDMARKS[0], LANDMARKS[1]], [LANDMARKS[0], LANDMARKS[2]],
    [LANDMARKS[0], LANDMARKS[3]], [LANDMARKS[0], LANDMARKS[4]],
    [LANDMARKS[2], LANDMARKS[3]], [LANDMARKS[1], LANDMARKS[4]],
  ];
  for (const [from, to] of pairs) {
    const route = findRoute(scene, from, to);
    stampRoute(scene, route, from.id === 'origin' ? 1.8 : 1.2, true);
  }
  addOrganicMasses(scene, 0x303);
  protectLandmarks(scene);
  return scene;
}

function addOrganicMasses(scene, salt) {
  const points = [];
  for (let gy = 3; gy < H - 3; gy += 5) {
    for (let gx = 3; gx < W - 3; gx += 5) {
      const x = gx + (hash2(gx, gy, salt) % 5) - 2;
      const y = gy + (hash2(gx, gy, salt + 1) % 5) - 2;
      if (scene.kind[y * W + x] === WATER || distanceToRoad(scene, x, y, 8) < 2) continue;
      const radius = 5 + (hash2(x, y, salt + 2) % 4);
      if (points.some(([px, py]) => Math.hypot(px - x, py - y) < radius)) continue;
      if (distanceToRoad(scene, x, y, 9) > 8) continue;
      points.push([x, y]);
    }
  }
  for (const [x, y] of points) {
    const wide = 4 + hash2(x, y, salt + 3) % 5;
    const high = 3 + hash2(x, y, salt + 4) % 4;
    stampRect(scene, x - Math.floor(wide / 2), y - Math.floor(high / 2), wide, high, BUILDING, true);
  }
}

function protectLandmarks(scene) {
  for (const landmark of LANDMARKS) {
    forEachRadius(landmark.x, landmark.y, 4.2, (x, y) => {
      const index = y * W + x;
      scene.kind[index] = scene.kind[index] === WATER ? BRIDGE : PLAZA;
      scene.roads[index] = 1;
    });
  }
}

function stampRoute(scene, points, radius, bridge = false) {
  if (points.length < 2) return;
  forEachCell((x, y, index) => {
    if (distanceToPolyline(x, y, points) > radius) return;
    if (scene.kind[index] === WATER) {
      if (bridge) scene.kind[index] = BRIDGE;
      return;
    }
    scene.kind[index] = PAVING;
    scene.roads[index] = 1;
  });
}

function stampRect(scene, x0, y0, width, height, kind, constrained = false) {
  if (constrained) {
    for (let y = y0 - 1; y <= y0 + height; y++) for (let x = x0 - 1; x <= x0 + width; x++) {
      if (!inside(x, y) || scene.kind[y * W + x] === WATER || scene.kind[y * W + x] === PLAZA) return;
    }
  }
  for (let y = y0; y < y0 + height; y++) for (let x = x0; x < x0 + width; x++) {
    if (!inside(x, y)) continue;
    const index = y * W + x;
    if (scene.kind[index] !== WATER && scene.kind[index] !== BRIDGE && scene.kind[index] !== PLAZA) scene.kind[index] = kind;
  }
}

function findRoute(scene, from, to) {
  const start = from.y * W + from.x;
  const target = to.y * W + to.x;
  const cost = new Float64Array(W * H).fill(Infinity);
  const previous = new Int32Array(W * H).fill(-1);
  const open = [{ index: start, score: 0 }];
  cost[start] = 0;
  while (open.length > 0) {
    open.sort((a, b) => a.score - b.score);
    const current = open.shift().index;
    if (current === target) break;
    const x = current % W, y = Math.floor(current / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny)) continue;
      const next = ny * W + nx;
      const waterPenalty = scene.kind[next] === WATER ? 11 : 0;
      const gardenPenalty = scene.kind[next] === GARDEN ? 1.8 : 0;
      const terrainPenalty = fbm(nx * 0.04, ny * 0.04, 71) * 0.8;
      const tentative = cost[current] + 1 + waterPenalty + gardenPenalty + terrainPenalty;
      if (tentative >= cost[next]) continue;
      cost[next] = tentative;
      previous[next] = current;
      open.push({ index: next, score: tentative + Math.hypot(to.x - nx, to.y - ny) });
    }
  }
  const route = [];
  for (let cursor = target, guard = 0; cursor >= 0 && guard < W * H; guard++) {
    route.push([cursor % W, Math.floor(cursor / W)]);
    if (cursor === start) break;
    cursor = previous[cursor];
  }
  return route.reverse();
}

function offsetPolyline(points, amount) {
  return points.map((point, index) => {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const dx = after[0] - before[0], dy = after[1] - before[1];
    const length = Math.max(1, Math.hypot(dx, dy));
    return [point[0] - dy / length * amount, point[1] + dx / length * amount];
  });
}

function render(scene) {
  const width = W * SCALE, height = H * SCALE;
  const rgb = Buffer.alloc(width * height * 3);
  const palette = {
    [WATER]: [37, 151, 169], [PAVING]: [217, 194, 151], [GARDEN]: [91, 119, 64],
    [BUILDING]: [171, 84, 55], [SOIL]: [139, 119, 82], [PLAZA]: [235, 213, 172], [BRIDGE]: [197, 172, 127],
  };
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const x = Math.floor(px / SCALE), y = Math.floor(py / SCALE);
    const kind = scene.kind[y * W + x];
    const base = palette[kind];
    let texture = (valueNoise(px * 0.18, py * 0.18, 83) - 0.5) * 15;
    if (kind === WATER) texture += Math.sin(px * 0.16 + py * 0.11) * 8;
    if (kind === BUILDING) texture += mod(px + py, 13) < 2 ? 17 : -3;
    if (kind === GARDEN) texture += fbm(px * 0.06, py * 0.06, 89) * 18 - 7;
    const boundary = x > 0 && scene.kind[y * W + x - 1] !== kind || y > 0 && scene.kind[(y - 1) * W + x] !== kind;
    if (boundary && (px % SCALE < 2 || py % SCALE < 2)) texture -= 22;
    const offset = (py * width + px) * 3;
    rgb[offset] = clampByte(base[0] + texture);
    rgb[offset + 1] = clampByte(base[1] + texture);
    rgb[offset + 2] = clampByte(base[2] + texture);
  }
  return rgb;
}

function renderMask(scene) {
  const palette = [[21, 111, 135], [221, 199, 155], [72, 119, 66], [168, 70, 45], [126, 106, 76], [250, 224, 175], [190, 165, 120]];
  const rgb = Buffer.alloc(W * H * 3);
  for (let index = 0; index < scene.kind.length; index++) {
    const colour = palette[scene.kind[index]];
    rgb[index * 3] = colour[0]; rgb[index * 3 + 1] = colour[1]; rgb[index * 3 + 2] = colour[2];
  }
  return rgb;
}

function measure(scene) {
  const walkable = scene.kind.map((kind) => Number(kind !== WATER && kind !== BUILDING));
  const component = floodLargest(walkable);
  const originReachable = floodFrom(walkable, LANDMARKS[0].x, LANDMARKS[0].y);
  const signatures = new Set();
  let samples = 0;
  for (let y = 0; y <= H - 12; y += 4) for (let x = 0; x <= W - 12; x += 4) {
    let hash = 2166136261;
    for (let yy = 0; yy < 12; yy++) for (let xx = 0; xx < 12; xx++) {
      hash = Math.imul(hash ^ scene.kind[(y + yy) * W + x + xx], 16777619);
    }
    signatures.add(hash >>> 0); samples++;
  }
  let waterArea = 0, waterBoundary = 0;
  forEachCell((x, y, index) => {
    if (scene.kind[index] !== WATER) return;
    waterArea++;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inside(x + dx, y + dy) || scene.kind[(y + dy) * W + x + dx] !== WATER)) waterBoundary++;
  });
  const clearances = LANDMARKS.map((landmark) => {
    let clear = 0, total = 0;
    forEachRadius(landmark.x, landmark.y, 4, (x, y) => {
      const kind = scene.kind[y * W + x];
      clear += Number(kind !== WATER && kind !== BUILDING); total++;
    });
    return clear / total;
  });
  return {
    maximumLagAutocorrelation: Number(maxLagCorrelation(scene.kind).toFixed(3)),
    uniqueWindowRatio: Number((signatures.size / samples).toFixed(3)),
    largestWalkableComponent: Number((component / Math.max(1, sum(walkable))).toFixed(3)),
    connectedLandmarks: LANDMARKS.filter((landmark) => originReachable[landmark.y * W + landmark.x]).length,
    protectedLandmarkClearance: Number((sum(clearances) / clearances.length).toFixed(3)),
    waterBoundaryComplexity: Number((waterBoundary / Math.sqrt(Math.max(1, waterArea))).toFixed(3)),
    classShares: Object.fromEntries(['water', 'paving', 'garden', 'building', 'soil', 'plaza', 'bridge'].map((name, kind) => [name, Number((scene.kind.filter((value) => value === kind).length / scene.kind.length).toFixed(3))])),
  };
}

function maxLagCorrelation(values) {
  let maximum = -1;
  for (let lag = 6; lag <= 36; lag += 3) {
    maximum = Math.max(maximum, correlationAt(values, lag, 0), correlationAt(values, 0, lag));
  }
  return maximum;
}

function correlationAt(values, dx, dy) {
  const pairs = [];
  for (let y = 0; y < H - dy; y++) for (let x = 0; x < W - dx; x++) {
    pairs.push([semanticSignal(values[y * W + x]), semanticSignal(values[(y + dy) * W + x + dx])]);
  }
  const meanA = sum(pairs.map((pair) => pair[0])) / pairs.length;
  const meanB = sum(pairs.map((pair) => pair[1])) / pairs.length;
  let numerator = 0, denominatorA = 0, denominatorB = 0;
  for (const [a, b] of pairs) {
    numerator += (a - meanA) * (b - meanB);
    denominatorA += (a - meanA) ** 2; denominatorB += (b - meanB) ** 2;
  }
  return numerator / Math.max(1e-9, Math.sqrt(denominatorA * denominatorB));
}

function semanticSignal(kind) {
  return [1, -0.35, -0.05, 0.55, 0.1, -0.6, -0.5][kind];
}

function floodLargest(walkable) {
  const seen = new Uint8Array(W * H);
  let largest = 0;
  for (let index = 0; index < seen.length; index++) {
    if (!walkable[index] || seen[index]) continue;
    largest = Math.max(largest, flood(walkable, index, seen));
  }
  return largest;
}

function floodFrom(walkable, x, y) {
  const seen = new Uint8Array(W * H);
  flood(walkable, y * W + x, seen);
  return seen;
}

function flood(walkable, start, seen) {
  if (!walkable[start]) return 0;
  const queue = [start]; seen[start] = 1; let count = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor], x = index % W, y = Math.floor(index / W); count++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = ny * W + nx;
      if (inside(nx, ny) && walkable[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
    }
  }
  return count;
}

function distanceToRoad(scene, x, y, maximum) {
  for (let radius = 0; radius <= maximum; radius++) {
    for (let yy = y - radius; yy <= y + radius; yy++) for (let xx = x - radius; xx <= x + radius; xx++) {
      if (inside(xx, yy) && scene.roads[yy * W + xx]) return Math.hypot(xx - x, yy - y);
    }
  }
  return maximum + 1;
}

function distanceToPolyline(x, y, points) {
  let distance = Infinity;
  for (let index = 1; index < points.length; index++) distance = Math.min(distance, distanceToSegment(x, y, points[index - 1], points[index]));
  return distance;
}

function distanceToSegment(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
  return Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
}

function valueNoise(x, y, salt) {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = smooth(x - x0), ty = smooth(y - y0);
  const a = hashUnit(x0, y0, salt), b = hashUnit(x0 + 1, y0, salt);
  const c = hashUnit(x0, y0 + 1, salt), d = hashUnit(x0 + 1, y0 + 1, salt);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function fbm(x, y, salt) {
  let total = 0, amplitude = 0.55, normalizer = 0;
  for (let octave = 0; octave < 4; octave++) {
    total += valueNoise(x, y, salt + octave * 17) * amplitude; normalizer += amplitude;
    x *= 2.03; y *= 2.03; amplitude *= 0.5;
  }
  return total / normalizer;
}

function hashUnit(x, y, salt) { return hash2(x, y, salt) / 0xffffffff; }
function hash2(x, y, salt) {
  let h = Math.imul((x | 0) ^ SEED ^ salt, 0x45d9f3b);
  h = Math.imul(h ^ (y | 0), 0x119de1f3);
  return (h ^ (h >>> 16)) >>> 0;
}

async function writeAnsi(name, sourcePath) {
  const { data, info } = await sharp(sourcePath).resize(ANSI_COLS * 2, ANSI_ROWS * 4, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).raw().toBuffer({ resolveWithObject: true });
  const grid = Array.from({ length: info.height }, (_, y) => Array.from({ length: info.width }, (_, x) => {
    const offset = (y * info.width + x) * info.channels;
    return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
  }));
  const cells = renderOctantGridCells(grid);
  const codec = new TerminalCodec({ headerRows: 0, terminalCols: ANSI_COLS, terminalRows: ANSI_ROWS });
  const frame = codec.encode(cells, { x: 0, y: 0, cellPixelWidth: 2, cellPixelHeight: 4 });
  fs.writeFileSync(path.join(OUTPUT, `${name}-ansi.bin`), `\x1b[?2026h${frame.output}\x1b[?2026l`);
}

async function writeComparison() {
  const thumbWidth = 600, thumbHeight = 400, labelHeight = 46, gap = 14;
  const composites = [];
  for (let index = 0; index < CANDIDATES.length; index++) {
    const name = CANDIDATES[index][0], column = index % 2, row = Math.floor(index / 2);
    const left = gap + column * (thumbWidth + gap), top = gap + row * (thumbHeight + labelHeight + gap);
    composites.push({ input: await sharp(path.join(OUTPUT, `${name}-source.png`)).resize(thumbWidth, thumbHeight).png().toBuffer(), left, top: top + labelHeight });
    composites.push({ input: Buffer.from(`<svg width="${thumbWidth}" height="${labelHeight}"><text x="10" y="31" fill="#f4eadb" font-family="sans-serif" font-size="24">${name}</text></svg>`), left, top });
  }
  await sharp({ create: { width: thumbWidth * 2 + gap * 3, height: (thumbHeight + labelHeight) * 2 + gap * 3, channels: 3, background: '#111118' } })
    .composite(composites).png().toFile(path.join(OUTPUT, 'comparison-source.png'));
}

function forEachCell(callback) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) callback(x, y, y * W + x); }
function forEachRadius(cx, cy, radius, callback) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
    if (inside(x, y) && Math.hypot(x - cx, y - cy) <= radius) callback(x, y);
  }
}
function inside(x, y) { return x >= 0 && x < W && y >= 0 && y < H; }
function sum(values) { let total = 0; for (const value of values) total += value; return total; }
function mod(value, divisor) { return ((value % divisor) + divisor) % divisor; }
function smooth(value) { return value * value * (3 - 2 * value); }
function lerp(a, b, t) { return a + (b - a) * t; }
function clampByte(value) { return Math.max(0, Math.min(255, Math.round(value))); }
