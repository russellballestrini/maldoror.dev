import {
  buildRegionalParcelPath,
  type RegionalParcelPath,
  type RegionalParcelPathPoint,
} from './regional-parcel-path.js';

export type RegionalWaterfrontSurfaceRole = 'apron' | 'work-yard' | 'pier' | 'slip';

export interface RegionalWaterfrontLayoutConfig {
  id: string;
  accessStart: RegionalParcelPathPoint;
  shorePoint: RegionalParcelPathPoint;
  /** Unit vector from dry land into navigable water. */
  waterNormalX: number;
  waterNormalY: number;
  seed: number;
  apronHalfLength?: number;
  apronDepth?: number;
  maximumPierLength?: number;
  /** Optional physical oracle. Piers shorten or disappear rather than claiming
   * land, while slips remain honest water reservations. */
  isWater?: (worldX: number, worldY: number) => boolean;
}

export interface RegionalWaterfrontPolygon {
  id: string;
  role: RegionalWaterfrontSurfaceRole;
  polygon: readonly RegionalParcelPathPoint[];
  bounds: RegionalWaterfrontBounds;
}

export interface RegionalWaterfrontBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RegionalWaterfrontSpatialCell {
  polygonIndices: number[];
}

export interface RegionalWaterfrontLayout {
  id: string;
  accessPath: RegionalParcelPath;
  shorePoint: RegionalParcelPathPoint;
  waterNormalX: number;
  waterNormalY: number;
  shoreTangentX: number;
  shoreTangentY: number;
  apron: RegionalWaterfrontPolygon;
  workYards: RegionalWaterfrontPolygon[];
  piers: RegionalWaterfrontPolygon[];
  slips: RegionalWaterfrontPolygon[];
  polygons: RegionalWaterfrontPolygon[];
  bounds: RegionalWaterfrontBounds;
  spatialIndex: ReadonlyMap<string, RegionalWaterfrontSpatialCell>;
}

export interface RegionalWaterfrontLayoutSample {
  apronWeight: number;
  workYardWeight: number;
  pierWeight: number;
  slipWeight: number;
  edgeWeight: number;
  role: RegionalWaterfrontSurfaceRole | null;
}

export interface RegionalWaterfrontLayoutCell {
  x: number;
  y: number;
  roles: readonly RegionalWaterfrontSurfaceRole[];
}

/**
 * Build a transverse working-waterfront program around one measured shore
 * contact. The access lane terminates at a dry apron; work yards stay behind
 * it; separated fingers project into water and preserve water-filled slips.
 * Geometry is continuous world-space data rather than a shoreline prop stamp.
 */
export function buildRegionalWaterfrontLayout(
  config: RegionalWaterfrontLayoutConfig,
): RegionalWaterfrontLayout | null {
  const normalLength = Math.hypot(config.waterNormalX, config.waterNormalY);
  if (normalLength < 1e-6) return null;
  const waterNormalX = config.waterNormalX / normalLength;
  const waterNormalY = config.waterNormalY / normalLength;
  const shoreTangentX = -waterNormalY;
  const shoreTangentY = waterNormalX;
  const approachX = config.shorePoint.x - config.accessStart.x;
  const approachY = config.shorePoint.y - config.accessStart.y;
  const approachLength = Math.hypot(approachX, approachY);
  // A decorative jetty may fit closer, but a working program needs enough dry
  // depth to separate its upland route, service lane, and shore apron.
  if (approachLength < 7.5) return null;

  const apronHalfLength = Math.max(5, config.apronHalfLength ?? 7.5);
  const apronDepth = Math.max(2.5, config.apronDepth ?? 4.25);
  const maximumPierLength = Math.max(3, config.maximumPierLength ?? 7.5);
  const accessPath = buildRegionalParcelPath({
    id: `${config.id}:access`,
    startX: config.accessStart.x,
    startY: config.accessStart.y,
    // Parcel paths grow along the normal of their declared route tangent.
    // Supplying the perpendicular therefore makes the service lane terminate
    // exactly at the measured shore point.
    tangentX: approachY / approachLength,
    tangentY: -approachX / approachLength,
    outwardSign: 1,
    length: approachLength,
    lateralOffset: 0,
  });

  const apron = polygon(
    `${config.id}:apron`,
    'apron',
    orientedRectangle(
      config.shorePoint,
      shoreTangentX,
      shoreTangentY,
      -apronHalfLength,
      apronHalfLength,
      waterNormalX,
      waterNormalY,
      -apronDepth,
      -0.12,
    ),
  );
  const accessClearance = Math.min(1.8, apronHalfLength * 0.24);
  const yardRear = apronDepth + 3.1;
  const workYards = [
    polygon(
      `${config.id}:work-yard:0`,
      'work-yard',
      orientedRectangle(
        config.shorePoint,
        shoreTangentX,
        shoreTangentY,
        -apronHalfLength,
        -accessClearance,
        waterNormalX,
        waterNormalY,
        -yardRear,
        -apronDepth - 0.2,
      ),
    ),
    polygon(
      `${config.id}:work-yard:1`,
      'work-yard',
      orientedRectangle(
        config.shorePoint,
        shoreTangentX,
        shoreTangentY,
        accessClearance,
        apronHalfLength,
        waterNormalX,
        waterNormalY,
        -yardRear,
        -apronDepth - 0.2,
      ),
    ),
  ];

  const pierOffsets = [-0.72, -0.38, -0.12, 0.12, 0.38, 0.72]
    .map((amount) => amount * apronHalfLength);
  const pierCandidates: Array<{
    index: number;
    offset: number;
    length: number;
    shoreShift: number;
    polygon: RegionalWaterfrontPolygon;
  }> = [];
  for (const [index, offset] of pierOffsets.entries()) {
    const width = 1.15 + hashUnit(config.seed, index, 0x5d31) * 0.5;
    const proposedLength = maximumPierLength * (0.72 + hashUnit(config.seed, index, 0x91a7) * 0.28);
    const shoreShift = localShoreShift(
      config,
      offset,
      shoreTangentX,
      shoreTangentY,
      waterNormalX,
      waterNormalY,
    );
    if (shoreShift === null) continue;
    const legalLength = constrainPierLength(
      config,
      offset,
      width,
      proposedLength,
      shoreShift,
      shoreTangentX,
      shoreTangentY,
      waterNormalX,
      waterNormalY,
    );
    if (legalLength < 2.5) continue;
    pierCandidates.push({
      index,
      offset,
      length: legalLength,
      shoreShift,
      polygon: polygon(
      `${config.id}:pier:${index}`,
      'pier',
      orientedRectangle(
        config.shorePoint,
        shoreTangentX,
        shoreTangentY,
        offset - width / 2,
        offset + width / 2,
        waterNormalX,
        waterNormalY,
        shoreShift - 0.08,
        shoreShift + legalLength,
      )),
    });
  }
  const firstPier = [...pierCandidates].sort((a, b) => (
    b.length - a.length || Math.abs(b.offset) - Math.abs(a.offset) || a.index - b.index
  ))[0];
  const secondPier = firstPier ? [...pierCandidates]
    .filter((candidate) => candidate.index !== firstPier.index &&
      Math.abs(candidate.offset - firstPier.offset) >= 3)
    .sort((a, b) => (
      (Math.abs(b.offset - firstPier.offset) + b.length * 0.35) -
      (Math.abs(a.offset - firstPier.offset) + a.length * 0.35) || a.index - b.index
    ))[0] : undefined;
  const selectedPierCandidates = [firstPier, secondPier]
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((a, b) => a.offset - b.offset);
  const piers = selectedPierCandidates.map((candidate) => candidate.polygon);
  if (piers.length === 0) return null;

  const slips: RegionalWaterfrontPolygon[] = [];
  for (let index = 1; index < selectedPierCandidates.length; index++) {
    const previousPier = selectedPierCandidates[index - 1]!;
    const currentPier = selectedPierCandidates[index]!;
    const left = tangentExtents(
      previousPier.polygon.polygon,
      config.shorePoint,
      shoreTangentX,
      shoreTangentY,
    );
    const right = tangentExtents(
      currentPier.polygon.polygon,
      config.shorePoint,
      shoreTangentX,
      shoreTangentY,
    );
    const slipStart = left.max + 0.2;
    const slipEnd = right.min - 0.2;
    if (slipEnd - slipStart < 1.4) continue;
    const waterStart = Math.max(previousPier.shoreShift, currentPier.shoreShift) + 0.35;
    const waterEnd = Math.min(
      previousPier.shoreShift + previousPier.length,
      currentPier.shoreShift + currentPier.length,
    ) - 0.35;
    if (waterEnd - waterStart < 0.75) continue;
    slips.push(polygon(
      `${config.id}:slip:${index - 1}`,
      'slip',
      orientedRectangle(
        config.shorePoint,
        shoreTangentX,
        shoreTangentY,
        slipStart,
        slipEnd,
        waterNormalX,
        waterNormalY,
        waterStart,
        waterEnd,
      ),
    ));
  }

  const polygons = [apron, ...workYards, ...piers, ...slips];
  const points = polygons.flatMap((candidate) => candidate.polygon);
  const bounds = boundsOf(points, 0.4);
  return {
    id: config.id,
    accessPath,
    shorePoint: config.shorePoint,
    waterNormalX,
    waterNormalY,
    shoreTangentX,
    shoreTangentY,
    apron,
    workYards,
    piers,
    slips,
    polygons,
    bounds,
    spatialIndex: buildSpatialIndex(polygons),
  };
}

export function sampleRegionalWaterfrontLayout(
  worldX: number,
  worldY: number,
  layout: RegionalWaterfrontLayout,
): RegionalWaterfrontLayoutSample {
  const point = { x: worldX, y: worldY };
  const weights: Record<RegionalWaterfrontSurfaceRole, number> = {
    apron: 0,
    'work-yard': 0,
    pier: 0,
    slip: 0,
  };
  let edgeWeight = 0;
  const spatial = layout.spatialIndex.get(`${Math.floor(worldX)},${Math.floor(worldY)}`);
  for (const polygonIndex of spatial?.polygonIndices ?? []) {
    const candidate = layout.polygons[polygonIndex]!;
    if (!contains(candidate.bounds, point, 0.3)) continue;
    const distance = distanceToPolygonEdges(point, candidate.polygon);
    if (pointInPolygon(point, candidate.polygon)) {
      const feather = candidate.role === 'work-yard' ? 1.1 :
        candidate.role === 'apron' ? 0.62 :
          candidate.role === 'pier' ? 0.2 : 0.28;
      weights[candidate.role] = Math.max(
        weights[candidate.role],
        smoothstep(0, feather, distance),
      );
    }
    // Dry program edges dissolve into local terrain; outlining every apron and
    // yard makes the program read as a pasted rectangular sprite. Pier sides
    // remain crisp because they are real constructed land/water contacts.
    if (candidate.role === 'pier') {
      edgeWeight = Math.max(edgeWeight, 1 - smoothstep(0.06, 0.26, distance));
    }
  }
  const role = (['pier', 'apron', 'work-yard', 'slip'] as const)
    .reduce<RegionalWaterfrontSurfaceRole | null>((best, candidate) => (
      weights[candidate] > (best ? weights[best] : 0) ? candidate : best
    ), null);
  return {
    apronWeight: weights.apron,
    workYardWeight: weights['work-yard'],
    pierWeight: weights.pier,
    slipWeight: weights.slip,
    edgeWeight,
    role,
  };
}

export function rasterizeRegionalWaterfrontLayout(
  layout: RegionalWaterfrontLayout,
): RegionalWaterfrontLayoutCell[] {
  return [...layout.spatialIndex.entries()].map(([key, cell]) => {
    const [x, y] = key.split(',').map(Number) as [number, number];
    return {
      x,
      y,
      roles: [...new Set(cell.polygonIndices.map((index) => layout.polygons[index]!.role))],
    };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
}

function constrainPierLength(
  config: RegionalWaterfrontLayoutConfig,
  tangentOffset: number,
  width: number,
  proposedLength: number,
  shoreShift: number,
  tangentX: number,
  tangentY: number,
  waterNormalX: number,
  waterNormalY: number,
): number {
  if (!config.isWater) return proposedLength;
  let legalLength = 0;
  for (let distance = 0.5; distance <= proposedLength + 1e-9; distance += 0.25) {
    const waterAcrossWidth = [-width * 0.34, 0, width * 0.34].every((offset) => config.isWater!(
      config.shorePoint.x + tangentX * (tangentOffset + offset) +
        waterNormalX * (shoreShift + distance),
      config.shorePoint.y + tangentY * (tangentOffset + offset) +
        waterNormalY * (shoreShift + distance),
    ));
    if (!waterAcrossWidth) break;
    legalLength = distance;
  }
  return legalLength;
}

function localShoreShift(
  config: RegionalWaterfrontLayoutConfig,
  tangentOffset: number,
  tangentX: number,
  tangentY: number,
  waterNormalX: number,
  waterNormalY: number,
): number | null {
  if (!config.isWater) return 0;
  let previousShift = -6;
  let previousWater = config.isWater(
    config.shorePoint.x + tangentX * tangentOffset + waterNormalX * previousShift,
    config.shorePoint.y + tangentY * tangentOffset + waterNormalY * previousShift,
  );
  for (let shift = -5.75; shift <= 6 + 1e-9; shift += 0.25) {
    const water = config.isWater(
      config.shorePoint.x + tangentX * tangentOffset + waterNormalX * shift,
      config.shorePoint.y + tangentY * tangentOffset + waterNormalY * shift,
    );
    if (!previousWater && water) return previousShift;
    previousShift = shift;
    previousWater = water;
  }
  return null;
}

function orientedRectangle(
  origin: RegionalParcelPathPoint,
  axisX: number,
  axisY: number,
  axisMinimum: number,
  axisMaximum: number,
  crossX: number,
  crossY: number,
  crossMinimum: number,
  crossMaximum: number,
): readonly RegionalParcelPathPoint[] {
  return [
    pointAt(origin, axisX, axisY, axisMinimum, crossX, crossY, crossMinimum),
    pointAt(origin, axisX, axisY, axisMaximum, crossX, crossY, crossMinimum),
    pointAt(origin, axisX, axisY, axisMaximum, crossX, crossY, crossMaximum),
    pointAt(origin, axisX, axisY, axisMinimum, crossX, crossY, crossMaximum),
  ];
}

function pointAt(
  origin: RegionalParcelPathPoint,
  axisX: number,
  axisY: number,
  axisDistance: number,
  crossX: number,
  crossY: number,
  crossDistance: number,
): RegionalParcelPathPoint {
  return {
    x: origin.x + axisX * axisDistance + crossX * crossDistance,
    y: origin.y + axisY * axisDistance + crossY * crossDistance,
  };
}

function polygon(
  id: string,
  role: RegionalWaterfrontSurfaceRole,
  points: readonly RegionalParcelPathPoint[],
): RegionalWaterfrontPolygon {
  return { id, role, polygon: points, bounds: boundsOf(points, 0) };
}

function buildSpatialIndex(
  polygons: readonly RegionalWaterfrontPolygon[],
): Map<string, RegionalWaterfrontSpatialCell> {
  const index = new Map<string, RegionalWaterfrontSpatialCell>();
  for (const [polygonIndex, candidate] of polygons.entries()) {
    for (let y = Math.floor(candidate.bounds.minY - 0.3); y <= Math.floor(candidate.bounds.maxY + 0.3); y++) {
      for (let x = Math.floor(candidate.bounds.minX - 0.3); x <= Math.floor(candidate.bounds.maxX + 0.3); x++) {
        const key = `${x},${y}`;
        const cell = index.get(key) ?? { polygonIndices: [] };
        cell.polygonIndices.push(polygonIndex);
        index.set(key, cell);
      }
    }
  }
  return index;
}

function boundsOf(points: readonly RegionalParcelPathPoint[], padding: number): RegionalWaterfrontBounds {
  return {
    minX: Math.min(...points.map((point) => point.x)) - padding,
    minY: Math.min(...points.map((point) => point.y)) - padding,
    maxX: Math.max(...points.map((point) => point.x)) + padding,
    maxY: Math.max(...points.map((point) => point.y)) + padding,
  };
}

function tangentExtents(
  points: readonly RegionalParcelPathPoint[],
  origin: RegionalParcelPathPoint,
  tangentX: number,
  tangentY: number,
): { min: number; max: number } {
  const values = points.map((point) => (
    (point.x - origin.x) * tangentX + (point.y - origin.y) * tangentY
  ));
  return { min: Math.min(...values), max: Math.max(...values) };
}

function contains(
  bounds: RegionalWaterfrontBounds,
  point: RegionalParcelPathPoint,
  padding: number,
): boolean {
  return point.x >= bounds.minX - padding && point.x <= bounds.maxX + padding &&
    point.y >= bounds.minY - padding && point.y <= bounds.maxY + padding;
}

function pointInPolygon(
  point: RegionalParcelPathPoint,
  points: readonly RegionalParcelPathPoint[],
): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index]!;
    const b = points[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToPolygonEdges(
  point: RegionalParcelPathPoint,
  points: readonly RegionalParcelPathPoint[],
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index++) {
    nearest = Math.min(nearest, pointSegmentDistance(point, points[index]!, points[(index + 1) % points.length]!));
  }
  return nearest;
}

function pointSegmentDistance(
  point: RegionalParcelPathPoint,
  start: RegionalParcelPathPoint,
  end: RegionalParcelPathPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (!Number.isFinite(value)) return value > 0 ? 1 : 0;
  const t = clamp((value - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hashUnit(a: number, b: number, salt: number): number {
  let value = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return value / 0x1_0000_0000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
