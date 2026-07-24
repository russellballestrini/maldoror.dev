import {
  sampleRegionalParcelPath,
  type RegionalParcelPath,
  type RegionalParcelPathPoint,
} from './regional-parcel-path.js';

export type RegionalParcelPurpose = 'yard' | 'garden' | 'civic-opening';

export interface RegionalParcelLayoutConfig {
  id: string;
  path: RegionalParcelPath;
  /** Arc-length stations already owned by the component grammar. Plot limits
   * are their midpoints, so geometry and authored masses cannot drift apart. */
  centerStations: readonly number[];
  seed: number;
  frontageOffset?: number;
  minimumDepth?: number;
  maximumDepth?: number;
  civicOpeningRate?: number;
  /** Entire wet/unsafe sides can be removed by the world constraint layer. */
  sides?: readonly (-1 | 1)[];
  /** Apply local physical evidence without teaching this domain-neutral
   * geometry module biome or filename semantics. */
  constrainDepth?: (sample: RegionalParcelDepthSample) => number;
}

export interface RegionalParcelDepthSample {
  side: -1 | 1;
  boundaryIndex: number;
  pathDistance: number;
  frontage: RegionalParcelPathPoint;
  normalX: number;
  normalY: number;
  proposedDepth: number;
}

export interface RegionalParcelPlot {
  id: string;
  side: -1 | 1;
  stationIndex: number;
  centerDistance: number;
  purpose: RegionalParcelPurpose;
  polygon: readonly [
    RegionalParcelPathPoint,
    RegionalParcelPathPoint,
    RegionalParcelPathPoint,
    RegionalParcelPathPoint,
  ];
  yard: RegionalParcelPathPoint[];
  frontage: readonly [RegionalParcelPathPoint, RegionalParcelPathPoint];
  frontageOpening: readonly [RegionalParcelPathPoint, RegionalParcelPathPoint];
  frontageWidth: number;
  depth: number;
  bounds: RegionalParcelBounds;
}

export interface RegionalParcelBoundary {
  id: string;
  kind: 'separator' | 'rear' | 'end-cap';
  side: -1 | 1;
  start: RegionalParcelPathPoint;
  end: RegionalParcelPathPoint;
  bounds: RegionalParcelBounds;
}

export interface RegionalParcelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RegionalParcelLayout {
  id: string;
  pathId: string;
  frontageOffset: number;
  plots: RegionalParcelPlot[];
  boundaries: RegionalParcelBoundary[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  spatialIndex: ReadonlyMap<string, RegionalParcelSpatialCell>;
}

export interface RegionalParcelSpatialCell {
  plotIndices: number[];
  boundaryIndices: number[];
}

export interface RegionalParcelLayoutSample {
  plotId: string | null;
  purpose: RegionalParcelPurpose | null;
  insideWeight: number;
  yardWeight: number;
  civicWeight: number;
  boundaryWeight: number;
}

export interface RegionalParcelLayoutCell {
  x: number;
  y: number;
}

interface BoundaryFrame {
  pathDistance: number;
  front: RegionalParcelPathPoint;
  rear: RegionalParcelPathPoint;
  depth: number;
}

/**
 * Build a persistent route-relative strip whose adjacent plots share the exact
 * same station frames. There are no independent footprint halos to overlap and
 * no frontage wall to sever the protected circulation spine.
 */
export function buildRegionalParcelLayout(config: RegionalParcelLayoutConfig): RegionalParcelLayout {
  const stations = [...new Set(config.centerStations
    .map((value) => clamp(value, 0, config.path.arcLength))
    .filter(Number.isFinite))]
    .sort((a, b) => a - b);
  const frontageOffset = Math.max(
    config.path.radius + config.path.feather + 0.2,
    config.frontageOffset ?? 1.15,
  );
  const minimumDepth = Math.max(1.8, config.minimumDepth ?? 3.8);
  const maximumDepth = Math.max(minimumDepth, config.maximumDepth ?? 6.2);
  if (stations.length === 0) return emptyLayout(config.id, config.path.id, frontageOffset);

  const limits = stationLimits(stations, config.path.arcLength);
  const plots: RegionalParcelPlot[] = [];
  const boundaries: RegionalParcelBoundary[] = [];
  const sides = config.sides ?? [-1, 1] as const;
  for (const side of sides) {
    const frames = limits.map((pathDistance, boundaryIndex) => boundaryFrame(
      config,
      side,
      boundaryIndex,
      pathDistance,
      frontageOffset,
      minimumDepth,
      maximumDepth,
    ));
    constrainDepthEnvelope(frames, minimumDepth);
    for (let index = 0; index < stations.length; index++) {
      const start = frames[index]!;
      const end = frames[index + 1]!;
      const polygon = [start.front, end.front, end.rear, start.rear] as const;
      const frontageWidth = distance(start.front, end.front);
      const centerDistance = stations[index]!;
      const openingHalf = Math.min(frontageWidth * 0.28, 0.85);
      const openingCenter = sampleOffsetPoint(config.path, centerDistance, side, frontageOffset);
      const openingTangent = sampleRegionalParcelPath(config.path, centerDistance);
      const frontageOpening = [
        {
          x: openingCenter.x - openingTangent.tangentX * openingHalf,
          y: openingCenter.y - openingTangent.tangentY * openingHalf,
        },
        {
          x: openingCenter.x + openingTangent.tangentX * openingHalf,
          y: openingCenter.y + openingTangent.tangentY * openingHalf,
        },
      ] as const;
      plots.push({
        id: `${config.id}:${side}:${index}`,
        side,
        stationIndex: index,
        centerDistance,
        purpose: hashUnit(config.seed, side, index, 0x7a31) < 0.56 ? 'garden' : 'yard',
        polygon,
        yard: insetYard(polygon),
        frontage: [start.front, end.front],
        frontageOpening,
        frontageWidth,
        depth: (start.depth + end.depth) / 2,
        bounds: boundsOf(polygon),
      });
      boundaries.push(boundary({
        id: `${config.id}:${side}:rear:${index}`,
        kind: 'rear', side, start: start.rear, end: end.rear,
      }));
    }
    for (let boundaryIndex = 0; boundaryIndex < frames.length; boundaryIndex++) {
      const frame = frames[boundaryIndex]!;
      boundaries.push(boundary({
        id: `${config.id}:${side}:${boundaryIndex === 0 || boundaryIndex === frames.length - 1 ? 'cap' : 'separator'}:${boundaryIndex}`,
        kind: boundaryIndex === 0 || boundaryIndex === frames.length - 1 ? 'end-cap' : 'separator',
        side,
        start: frame.front,
        end: frame.rear,
      }));
    }
  }

  const civicOpeningRate = clamp(config.civicOpeningRate ?? 0.36, 0, 1);
  if (plots.length > 0 && hashUnit(config.seed, hashString(config.id), plots.length, 0x11c7) < civicOpeningRate) {
    const civicIndex = Math.floor(
      hashUnit(config.seed, plots.length, hashString(config.path.id), 0x25e1) * plots.length,
    );
    const civic = plots[civicIndex]!;
    civic.purpose = 'civic-opening';
    // The open plot keeps shared side limits but drops its private rear wall.
    const rearId = `${config.id}:${civic.side}:rear:${civic.stationIndex}`;
    const rearIndex = boundaries.findIndex((boundary) => boundary.id === rearId);
    if (rearIndex >= 0) boundaries.splice(rearIndex, 1);
  }

  const points = plots.flatMap((plot) => [...plot.polygon]);
  const padding = 0.45;
  return {
    id: config.id,
    pathId: config.path.id,
    frontageOffset,
    plots,
    boundaries,
    spatialIndex: buildSpatialIndex(plots, boundaries),
    bounds: {
      minX: Math.min(...points.map((point) => point.x)) - padding,
      minY: Math.min(...points.map((point) => point.y)) - padding,
      maxX: Math.max(...points.map((point) => point.x)) + padding,
      maxY: Math.max(...points.map((point) => point.y)) + padding,
    },
  };
}

/** Continuous material masks; values depend only on world coordinates. */
export function sampleRegionalParcelLayout(
  worldX: number,
  worldY: number,
  layout: RegionalParcelLayout,
): RegionalParcelLayoutSample {
  const point = { x: worldX, y: worldY };
  let plot: RegionalParcelPlot | undefined;
  let insideWeight = 0;
  let yardWeight = 0;
  const spatial = layout.spatialIndex.get(`${Math.floor(worldX)},${Math.floor(worldY)}`);
  for (const plotIndex of spatial?.plotIndices ?? []) {
    const candidate = layout.plots[plotIndex]!;
    if (!contains(candidate.bounds, point, 0)) continue;
    if (!pointInPolygon(point, candidate.polygon)) continue;
    const distanceInside = distanceToPolygonEdges(point, candidate.polygon);
    const weight = smoothstep(0, 0.3, distanceInside);
    if (weight >= insideWeight) {
      plot = candidate;
      insideWeight = weight;
      yardWeight = pointInPolygon(point, candidate.yard)
        ? smoothstep(0, 0.38, distanceToPolygonEdges(point, candidate.yard))
        : 0;
    }
  }
  let nearestBoundary = Number.POSITIVE_INFINITY;
  for (const boundaryIndex of spatial?.boundaryIndices ?? []) {
    const boundary = layout.boundaries[boundaryIndex]!;
    if (!contains(boundary.bounds, point, 0.28)) continue;
    nearestBoundary = Math.min(
      nearestBoundary,
      pointSegmentDistance(point, boundary.start, boundary.end),
    );
  }
  return {
    plotId: plot?.id ?? null,
    purpose: plot?.purpose ?? null,
    insideWeight,
    yardWeight,
    civicWeight: plot?.purpose === 'civic-opening' ? insideWeight : 0,
    boundaryWeight: 1 - smoothstep(0.08, 0.28, nearestBoundary),
  };
}

/** Conservative tile cover. Exact material opacity is still evaluated per
 * pixel, keeping cache-block and LOD results byte-identical. */
export function rasterizeRegionalParcelLayout(
  layout: RegionalParcelLayout,
): RegionalParcelLayoutCell[] {
  return [...layout.spatialIndex.keys()].map((key) => {
    const [x, y] = key.split(',').map(Number) as [number, number];
    return { x, y };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
}

function boundaryFrame(
  config: RegionalParcelLayoutConfig,
  side: -1 | 1,
  boundaryIndex: number,
  pathDistance: number,
  frontageOffset: number,
  minimumDepth: number,
  maximumDepth: number,
): BoundaryFrame {
  const frame = sampleRegionalParcelPath(config.path, pathDistance);
  const normalX = -frame.tangentY * side;
  const normalY = frame.tangentX * side;
  const frontage = {
    x: frame.x + normalX * frontageOffset,
    y: frame.y + normalY * frontageOffset,
  };
  const phase = radicalInverse(boundaryIndex + (side > 0 ? 17 : 29), 3);
  const jitter = hashUnit(config.seed, side, boundaryIndex, hashString(config.id));
  let proposedDepth = minimumDepth + (maximumDepth - minimumDepth) * (phase * 0.72 + jitter * 0.28);
  const curvature = pathCurvature(config.path, pathDistance);
  if (curvature > 1e-6) {
    proposedDepth = Math.min(
      proposedDepth,
      Math.max(minimumDepth, 0.44 / curvature - frontageOffset),
    );
  }
  const constrained = config.constrainDepth?.({
    side,
    boundaryIndex,
    pathDistance,
    frontage,
    normalX,
    normalY,
    proposedDepth,
  }) ?? proposedDepth;
  const depth = clamp(constrained, minimumDepth, maximumDepth);
  return {
    pathDistance,
    front: frontage,
    rear: {
      x: frame.x + normalX * (frontageOffset + depth),
      y: frame.y + normalY * (frontageOffset + depth),
    },
    depth,
  };
}

function constrainDepthEnvelope(
  frames: BoundaryFrame[],
  minimumDepth: number,
): void {
  for (let index = 1; index < frames.length; index++) {
    const previous = frames[index - 1]!;
    const current = frames[index]!;
    const maximumDelta = Math.max(0.6, distance(previous.front, current.front) * 0.55);
    current.depth = Math.min(current.depth, previous.depth + maximumDelta);
    setRearFromDepth(current, minimumDepth);
  }
  for (let index = frames.length - 2; index >= 0; index--) {
    const current = frames[index]!;
    const next = frames[index + 1]!;
    const maximumDelta = Math.max(0.6, distance(current.front, next.front) * 0.55);
    current.depth = Math.min(current.depth, next.depth + maximumDelta);
    setRearFromDepth(current, minimumDepth);
  }
}

function setRearFromDepth(frame: BoundaryFrame, minimumDepth: number): void {
  frame.depth = Math.max(minimumDepth, frame.depth);
  const normal = rearNormal(frame);
  frame.rear = {
    x: frame.front.x + normal.x * frame.depth,
    y: frame.front.y + normal.y * frame.depth,
  };
}

function rearNormal(frame: BoundaryFrame): { x: number; y: number } {
  const length = Math.max(1e-9, Math.hypot(frame.rear.x - frame.front.x, frame.rear.y - frame.front.y));
  return {
    x: (frame.rear.x - frame.front.x) / length,
    y: (frame.rear.y - frame.front.y) / length,
  };
}

function stationLimits(stations: readonly number[], arcLength: number): number[] {
  if (stations.length === 1) {
    return [Math.max(0, stations[0]! - 2.5), Math.min(arcLength, stations[0]! + 2.5)];
  }
  const limits = [Math.max(0, stations[0]! - (stations[1]! - stations[0]!) / 2)];
  for (let index = 1; index < stations.length; index++) {
    limits.push((stations[index - 1]! + stations[index]!) / 2);
  }
  limits.push(Math.min(
    arcLength,
    stations.at(-1)! + (stations.at(-1)! - stations.at(-2)!) / 2,
  ));
  return limits;
}

function sampleOffsetPoint(
  path: RegionalParcelPath,
  pathDistance: number,
  side: -1 | 1,
  offset: number,
): RegionalParcelPathPoint {
  const frame = sampleRegionalParcelPath(path, pathDistance);
  return {
    x: frame.x - frame.tangentY * side * offset,
    y: frame.y + frame.tangentX * side * offset,
  };
}

function pathCurvature(path: RegionalParcelPath, pathDistance: number): number {
  const delta = Math.min(0.75, Math.max(0.2, path.arcLength * 0.03));
  const before = sampleRegionalParcelPath(path, pathDistance - delta);
  const after = sampleRegionalParcelPath(path, pathDistance + delta);
  const dot = clamp(before.tangentX * after.tangentX + before.tangentY * after.tangentY, -1, 1);
  return Math.acos(dot) / Math.max(0.01, after.distance - before.distance);
}

function insetYard(
  polygon: RegionalParcelPlot['polygon'],
): RegionalParcelPathPoint[] {
  const center = centroid(polygon);
  return polygon.map((point, index) => {
    const inset = index < 2 ? 0.24 : 0.16;
    return {
      x: lerp(point.x, center.x, inset),
      y: lerp(point.y, center.y, inset),
    };
  });
}

function emptyLayout(id: string, pathId: string, frontageOffset: number): RegionalParcelLayout {
  return {
    id,
    pathId,
    frontageOffset,
    plots: [],
    boundaries: [],
    bounds: { minX: 0, minY: 0, maxX: -1, maxY: -1 },
    spatialIndex: new Map(),
  };
}

function buildSpatialIndex(
  plots: readonly RegionalParcelPlot[],
  boundaries: readonly RegionalParcelBoundary[],
): Map<string, RegionalParcelSpatialCell> {
  const cells = new Map<string, RegionalParcelSpatialCell>();
  const get = (x: number, y: number): RegionalParcelSpatialCell => {
    const key = `${x},${y}`;
    let value = cells.get(key);
    if (!value) {
      value = { plotIndices: [], boundaryIndices: [] };
      cells.set(key, value);
    }
    return value;
  };
  for (const [plotIndex, plot] of plots.entries()) {
    for (let y = Math.floor(plot.bounds.minY - 0.3); y <= Math.floor(plot.bounds.maxY + 0.3); y++) {
      for (let x = Math.floor(plot.bounds.minX - 0.3); x <= Math.floor(plot.bounds.maxX + 0.3); x++) {
        get(x, y).plotIndices.push(plotIndex);
      }
    }
  }
  for (const [boundaryIndex, value] of boundaries.entries()) {
    for (let y = Math.floor(value.bounds.minY - 0.3); y <= Math.floor(value.bounds.maxY + 0.3); y++) {
      for (let x = Math.floor(value.bounds.minX - 0.3); x <= Math.floor(value.bounds.maxX + 0.3); x++) {
        get(x, y).boundaryIndices.push(boundaryIndex);
      }
    }
  }
  return cells;
}

function boundary(
  value: Omit<RegionalParcelBoundary, 'bounds'>,
): RegionalParcelBoundary {
  return {
    ...value,
    bounds: boundsOf([value.start, value.end]),
  };
}

function boundsOf(points: readonly RegionalParcelPathPoint[]): RegionalParcelBounds {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function contains(
  bounds: RegionalParcelBounds,
  point: RegionalParcelPathPoint,
  padding: number,
): boolean {
  return point.x >= bounds.minX - padding && point.x <= bounds.maxX + padding &&
    point.y >= bounds.minY - padding && point.y <= bounds.maxY + padding;
}

function pointInPolygon(
  point: RegionalParcelPathPoint,
  polygon: readonly RegionalParcelPathPoint[],
): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToPolygonEdges(
  point: RegionalParcelPathPoint,
  polygon: readonly RegionalParcelPathPoint[],
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index++) {
    nearest = Math.min(nearest, pointSegmentDistance(
      point,
      polygon[index]!,
      polygon[(index + 1) % polygon.length]!,
    ));
  }
  return nearest;
}

function pointSegmentDistance(
  point: RegionalParcelPathPoint,
  start: RegionalParcelPathPoint,
  end: RegionalParcelPathPoint,
): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const denominator = deltaX * deltaX + deltaY * deltaY;
  const amount = denominator <= 1e-12
    ? 0
    : clamp(((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / denominator, 0, 1);
  return Math.hypot(
    point.x - lerp(start.x, end.x, amount),
    point.y - lerp(start.y, end.y, amount),
  );
}

function centroid(points: readonly RegionalParcelPathPoint[]): RegionalParcelPathPoint {
  return points.reduce((sum, point) => ({
    x: sum.x + point.x / points.length,
    y: sum.y + point.y / points.length,
  }), { x: 0, y: 0 });
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

function hashUnit(seed: number, a: number, b: number, salt: number): number {
  let value = (seed ^ salt) | 0;
  value = Math.imul(value ^ Math.trunc(a), 0x45d9f3b);
  value = Math.imul(value ^ Math.trunc(b), 0x119de1f3);
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000;
}

function radicalInverse(value: number, base: number): number {
  let denominator = 1;
  let result = 0;
  let integer = Math.max(0, Math.floor(value));
  while (integer > 0) {
    denominator *= base;
    result += (integer % base) / denominator;
    integer = Math.floor(integer / base);
  }
  return result;
}

function distance(a: RegionalParcelPathPoint, b: RegionalParcelPathPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
