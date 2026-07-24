/** Continuous route-relative geometry for one regional parcel compound.
 *
 * The route graph owns the entrance. A parcel path grows along the selected
 * outward normal, then accepts a bounded lateral goal. Local world constraints
 * can compare several such paths without changing their persistent parcel ID.
 * Shared arc-length stations place masses on both sides of the same path.
 */

export interface RegionalParcelPathPoint {
  x: number;
  y: number;
}

export interface RegionalParcelPath {
  id: string;
  points: readonly RegionalParcelPathPoint[];
  cumulativeLength: readonly number[];
  arcLength: number;
  targetLength: number;
  lateralOffset: number;
  radius: number;
  feather: number;
}

export interface RegionalParcelPathConfig {
  id: string;
  startX: number;
  startY: number;
  tangentX: number;
  tangentY: number;
  outwardSign: -1 | 1;
  length: number;
  lateralOffset: number;
  radius?: number;
  feather?: number;
  samplesPerTile?: number;
}

export interface RegionalPolylinePathConfig {
  id: string;
  points: readonly RegionalParcelPathPoint[];
  radius?: number;
  feather?: number;
}

export interface RegionalParcelPathFrame {
  x: number;
  y: number;
  tangentX: number;
  tangentY: number;
  distance: number;
}

export interface RegionalParcelPathCell {
  x: number;
  y: number;
  distance: number;
  core: boolean;
  protected: boolean;
}

export function buildRegionalParcelPath(config: RegionalParcelPathConfig): RegionalParcelPath {
  const tangent = normalize(config.tangentX, config.tangentY, 1, 0);
  const outward = {
    x: -tangent.y * config.outwardSign,
    y: tangent.x * config.outwardSign,
  };
  const targetLength = Math.max(4, config.length);
  // A coast- or contour-following successor may need to turn substantially
  // after clearing the route threshold. The initial control remains outward,
  // while this bound admits a roughly 38-degree endpoint fan without letting
  // a parcel fold back on its source route.
  const lateralLimit = targetLength * 0.78;
  const lateralOffset = clamp(config.lateralOffset, -lateralLimit, lateralLimit);
  const start = { x: config.startX, y: config.startY };
  const firstControlDistance = Math.min(4.2, targetLength * 0.3);
  const finalControlDistance = Math.min(5.4, targetLength * 0.34);
  const end = {
    x: start.x + outward.x * targetLength + tangent.x * lateralOffset,
    y: start.y + outward.y * targetLength + tangent.y * lateralOffset,
  };
  const controlA = {
    x: start.x + outward.x * firstControlDistance + tangent.x * lateralOffset * 0.04,
    y: start.y + outward.y * firstControlDistance + tangent.y * lateralOffset * 0.04,
  };
  const controlB = {
    x: end.x - outward.x * finalControlDistance - tangent.x * lateralOffset * 0.12,
    y: end.y - outward.y * finalControlDistance - tangent.y * lateralOffset * 0.12,
  };
  const sampleCount = Math.max(
    8,
    Math.ceil(targetLength * clamp(config.samplesPerTile ?? 1.5, 1, 4)),
  );
  const points = Array.from({ length: sampleCount + 1 }, (_, index) => cubicPoint(
    start,
    controlA,
    controlB,
    end,
    index / sampleCount,
  ));
  const cumulativeLength = [0];
  for (let index = 1; index < points.length; index++) {
    cumulativeLength.push(
      cumulativeLength[index - 1]! + distance(points[index - 1]!, points[index]!),
    );
  }
  return {
    id: config.id,
    points,
    cumulativeLength,
    arcLength: cumulativeLength.at(-1) ?? 0,
    targetLength,
    lateralOffset,
    radius: clamp(config.radius ?? 0.42, 0.24, 0.7),
    feather: clamp(config.feather ?? 0.16, 0.04, 0.3),
  };
}

/** Build the same immutable path representation from an authored/procedural
 * polyline. Environment programs use this for connected cave branches and
 * switchbacks without inventing a second raster or distance implementation. */
export function buildRegionalPolylinePath(config: RegionalPolylinePathConfig): RegionalParcelPath {
  const points = config.points.filter((point, index, source) => (
    index === 0 || distance(point, source[index - 1]!) > 1e-6
  ));
  if (points.length < 2) throw new Error(`Regional polyline path needs two points: ${config.id}`);
  const cumulativeLength = [0];
  for (let index = 1; index < points.length; index++) {
    cumulativeLength.push(
      cumulativeLength[index - 1]! + distance(points[index - 1]!, points[index]!),
    );
  }
  const arcLength = cumulativeLength.at(-1) ?? 0;
  return {
    id: config.id,
    points,
    cumulativeLength,
    arcLength,
    targetLength: arcLength,
    lateralOffset: 0,
    radius: clamp(config.radius ?? 0.42, 0.24, 1.4),
    feather: clamp(config.feather ?? 0.16, 0.04, 0.8),
  };
}

/** Arc-length station shared by the two sides of a compound. */
export function sampleRegionalParcelPath(
  path: RegionalParcelPath,
  requestedDistance: number,
): RegionalParcelPathFrame {
  const target = clamp(requestedDistance, 0, path.arcLength);
  let upper = path.cumulativeLength.findIndex((value) => value >= target);
  if (upper <= 0) upper = Math.min(1, path.points.length - 1);
  const lower = Math.max(0, upper - 1);
  const start = path.points[lower]!;
  const end = path.points[upper]!;
  const startDistance = path.cumulativeLength[lower]!;
  const endDistance = path.cumulativeLength[upper]!;
  const amount = (target - startDistance) / Math.max(1e-9, endDistance - startDistance);
  const tangent = normalize(end.x - start.x, end.y - start.y, 1, 0);
  return {
    x: lerp(start.x, end.x, amount),
    y: lerp(start.y, end.y, amount),
    tangentX: tangent.x,
    tangentY: tangent.y,
    distance: target,
  };
}

/** Exact world-space distance used by both the raster audit and compositor. */
export function distanceToRegionalParcelPath(
  worldX: number,
  worldY: number,
  path: RegionalParcelPath,
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.points.length; index++) {
    nearest = Math.min(nearest, pointSegmentDistance(
      worldX,
      worldY,
      path.points[index - 1]!,
      path.points[index]!,
    ));
  }
  return nearest;
}

/** Bounded cell cover for terrain reconstruction and protected circulation.
 * Render coverage is slightly wider than protection so the continuous SDF is
 * never clipped at a tile boundary. Only the inner band overrides collision. */
export function rasterizeRegionalParcelPath(path: RegionalParcelPath): RegionalParcelPathCell[] {
  const candidates = new Set<string>();
  for (let index = 1; index < path.points.length; index++) {
    const start = path.points[index - 1]!;
    const end = path.points[index]!;
    const steps = Math.max(1, Math.ceil(distance(start, end) * 4));
    for (let step = 0; step <= steps; step++) {
      const amount = step / steps;
      const x = Math.floor(lerp(start.x, end.x, amount));
      const y = Math.floor(lerp(start.y, end.y, amount));
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          candidates.add(`${x + offsetX},${y + offsetY}`);
        }
      }
    }
  }
  const renderReach = path.radius + path.feather + Math.SQRT1_2;
  const protectedReach = path.radius + 0.28;
  const coreReach = path.radius + 0.08;
  return [...candidates].map((key) => {
    const [x, y] = key.split(',').map(Number) as [number, number];
    const value = distanceToRegionalParcelPath(x + 0.5, y + 0.5, path);
    return {
      x,
      y,
      distance: value,
      core: value <= coreReach,
      protected: value <= protectedReach,
    };
  }).filter((cell) => cell.distance <= renderReach)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function cubicPoint(
  a: RegionalParcelPathPoint,
  b: RegionalParcelPathPoint,
  c: RegionalParcelPathPoint,
  d: RegionalParcelPathPoint,
  amount: number,
): RegionalParcelPathPoint {
  const inverse = 1 - amount;
  const aa = inverse ** 3;
  const bb = 3 * inverse ** 2 * amount;
  const cc = 3 * inverse * amount ** 2;
  const dd = amount ** 3;
  return {
    x: a.x * aa + b.x * bb + c.x * cc + d.x * dd,
    y: a.y * aa + b.y * bb + c.y * cc + d.y * dd,
  };
}

function pointSegmentDistance(
  x: number,
  y: number,
  start: RegionalParcelPathPoint,
  end: RegionalParcelPathPoint,
): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const denominator = deltaX * deltaX + deltaY * deltaY;
  const amount = denominator <= 1e-12
    ? 0
    : clamp(((x - start.x) * deltaX + (y - start.y) * deltaY) / denominator, 0, 1);
  return Math.hypot(x - lerp(start.x, end.x, amount), y - lerp(start.y, end.y, amount));
}

function normalize(x: number, y: number, fallbackX: number, fallbackY: number): { x: number; y: number } {
  const length = Math.hypot(x, y);
  return length <= 1e-9
    ? { x: fallbackX, y: fallbackY }
    : { x: x / length, y: y / length };
}

function distance(a: RegionalParcelPathPoint, b: RegionalParcelPathPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
