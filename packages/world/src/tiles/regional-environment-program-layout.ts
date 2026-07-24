import {
  buildRegionalPolylinePath,
  distanceToRegionalParcelPath,
  type RegionalParcelPath,
  type RegionalParcelPathPoint,
} from './regional-parcel-path.js';

export type RegionalEnvironmentProgramKind = 'cave-interior' | 'highland-ascent';
export type RegionalEnvironmentProgramRole =
  | 'access-trail'
  | 'cave-floor'
  | 'cave-wall'
  | 'highland-trail'
  | 'retaining-edge';

export interface RegionalEnvironmentTerrainSample {
  elevation: number;
  slope: number;
  isWater: boolean;
}

export interface RegionalEnvironmentProgramLayoutConfig {
  id: string;
  kind: RegionalEnvironmentProgramKind;
  routePoint: RegionalParcelPathPoint;
  anchorPoint: RegionalParcelPathPoint;
  seed: number;
  sampleTerrain: (worldX: number, worldY: number) => RegionalEnvironmentTerrainSample;
  maximumReach?: number;
}

export interface RegionalCaveChamber {
  id: string;
  centre: RegionalParcelPathPoint;
  radiusX: number;
  radiusY: number;
  angle: number;
}

export interface RegionalEnvironmentProgramBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RegionalEnvironmentProgramLayout {
  id: string;
  seed: number;
  kind: RegionalEnvironmentProgramKind;
  routePoint: RegionalParcelPathPoint;
  anchorPoint: RegionalParcelPathPoint;
  terminalPoint: RegionalParcelPathPoint;
  accessPath: RegionalParcelPath;
  interiorPaths: readonly RegionalParcelPath[];
  chambers: readonly RegionalCaveChamber[];
  bounds: RegionalEnvironmentProgramBounds;
  startElevation: number;
  endElevation: number;
  elevationGain: number;
  directDistance: number;
  traversableLength: number;
  switchbackCount: number;
}

export interface RegionalEnvironmentProgramSample {
  accessTrailWeight: number;
  caveFloorWeight: number;
  caveWallWeight: number;
  highlandTrailWeight: number;
  retainingEdgeWeight: number;
  role: RegionalEnvironmentProgramRole | null;
}

export interface RegionalEnvironmentProgramCell {
  x: number;
  y: number;
  roles: readonly RegionalEnvironmentProgramRole[];
  walkable: boolean;
  solid: boolean;
}

/**
 * Expand one semantically marked mountain contact into traversable geography.
 * The cave variant sketches a connected entrance/tunnel/chamber graph before
 * rasterization. The highland variant chooses a real higher endpoint and uses
 * a small number of long switchback legs rather than a staircase of short
 * reversals. Both remain continuous world-space masks.
 */
export function buildRegionalEnvironmentProgramLayout(
  config: RegionalEnvironmentProgramLayoutConfig,
): RegionalEnvironmentProgramLayout | null {
  const routeTerrain = config.sampleTerrain(config.routePoint.x, config.routePoint.y);
  const anchorTerrain = config.sampleTerrain(config.anchorPoint.x, config.anchorPoint.y);
  if (routeTerrain.isWater || anchorTerrain.isWater) return null;
  const approach = normalize(
    config.anchorPoint.x - config.routePoint.x,
    config.anchorPoint.y - config.routePoint.y,
    1,
    0,
  );
  const approachDistance = Math.hypot(
    config.anchorPoint.x - config.routePoint.x,
    config.anchorPoint.y - config.routePoint.y,
  );
  if (approachDistance < 1.25) return null;
  const accessPath = buildRegionalPolylinePath({
    id: `${config.id}:access`,
    points: [config.routePoint, config.anchorPoint],
    radius: 0.42,
    feather: 0.22,
  });
  return config.kind === 'cave-interior'
    ? buildCaveLayout(config, approach, accessPath, routeTerrain.elevation, anchorTerrain.elevation)
    : buildHighlandLayout(config, approach, accessPath, routeTerrain.elevation);
}

function buildCaveLayout(
  config: RegionalEnvironmentProgramLayoutConfig,
  approach: RegionalParcelPathPoint,
  accessPath: RegionalParcelPath,
  startElevation: number,
  anchorElevation: number,
): RegionalEnvironmentProgramLayout | null {
  const tangent = { x: -approach.y, y: approach.x };
  const reach = clamp(config.maximumReach ?? 13, 9, 18);
  const bendA = (hashUnit(config.seed, 0x41a3) - 0.5) * 2.6;
  const bendB = (hashUnit(config.seed, 0x7b19) - 0.5) * 3.4;
  const mainPoints = [
    config.anchorPoint,
    point(config.anchorPoint, approach, reach * 0.34, tangent, bendA),
    point(config.anchorPoint, approach, reach * 0.7, tangent, bendB),
    point(config.anchorPoint, approach, reach, tangent, bendB * 0.45),
  ];
  if (!pathStaysDry(mainPoints, config.sampleTerrain)) return null;
  const branchSign = hashUnit(config.seed, 0xa1d7) < 0.5 ? -1 : 1;
  const branchOrigin = mainPoints[1]!;
  const branchEnd = point(
    branchOrigin,
    approach,
    reach * 0.12,
    tangent,
    branchSign * (3.2 + hashUnit(config.seed, 0xc903) * 1.4),
  );
  const branchPoints = [branchOrigin, branchEnd];
  if (!pathStaysDry(branchPoints, config.sampleTerrain)) return null;
  const smoothedMainPoints = smoothPolyline(mainPoints, 2);
  const smoothedBranchPoints = smoothPolyline(branchPoints, 1);
  if (!pathStaysDry(smoothedMainPoints, config.sampleTerrain) ||
      !pathStaysDry(smoothedBranchPoints, config.sampleTerrain)) return null;
  const mainPath = buildRegionalPolylinePath({
    id: `${config.id}:cave-main`,
    points: smoothedMainPoints,
    radius: 0.76,
    feather: 0.32,
  });
  const branchPath = buildRegionalPolylinePath({
    id: `${config.id}:cave-branch`,
    points: smoothedBranchPoints,
    radius: 0.64,
    feather: 0.3,
  });
  const chamberAngle = Math.atan2(approach.y, approach.x) +
    (hashUnit(config.seed, 0x43f1) - 0.5) * 0.45;
  const chambers: RegionalCaveChamber[] = [
    {
      id: `${config.id}:chamber:main`,
      centre: mainPoints.at(-1)!,
      radiusX: 3.75 + hashUnit(config.seed, 0x1e73) * 1.05,
      radiusY: 2.15 + hashUnit(config.seed, 0x2d59) * 0.65,
      angle: chamberAngle,
    },
    {
      id: `${config.id}:chamber:branch`,
      centre: branchEnd,
      radiusX: 1.55 + hashUnit(config.seed, 0x93b7) * 0.55,
      radiusY: 1.15 + hashUnit(config.seed, 0x5ac1) * 0.4,
      angle: chamberAngle + branchSign * 0.72,
    },
  ];
  const terminalPoint = mainPoints.at(-1)!;
  const endElevation = config.sampleTerrain(terminalPoint.x, terminalPoint.y).elevation;
  return finishLayout({
    id: config.id,
    seed: config.seed,
    kind: config.kind,
    routePoint: config.routePoint,
    anchorPoint: config.anchorPoint,
    terminalPoint,
    accessPath,
    interiorPaths: [mainPath, branchPath],
    chambers,
    startElevation,
    endElevation,
    elevationGain: anchorElevation - startElevation,
    directDistance: distance(config.routePoint, terminalPoint),
    traversableLength: accessPath.arcLength + mainPath.arcLength + branchPath.arcLength,
    switchbackCount: 0,
  });
}

function buildHighlandLayout(
  config: RegionalEnvironmentProgramLayoutConfig,
  approach: RegionalParcelPathPoint,
  _accessPath: RegionalParcelPath,
  startElevation: number,
): RegionalEnvironmentProgramLayout | null {
  const maximumReach = clamp(config.maximumReach ?? 18, 12, 26);
  const tangent = { x: -approach.y, y: approach.x };
  const candidates: Array<{
    point: RegionalParcelPathPoint;
    direction: RegionalParcelPathPoint;
    elevation: number;
    score: number;
  }> = [];
  for (const angle of [0, -0.38, 0.38, -0.7, 0.7]) {
    const direction = rotate(approach, angle);
    for (const reach of [maximumReach * 0.68, maximumReach * 0.84, maximumReach]) {
      const destination = point(config.anchorPoint, direction, reach, tangent, 0);
      const terrain = config.sampleTerrain(destination.x, destination.y);
      if (terrain.isWater) continue;
      const gain = terrain.elevation - startElevation;
      if (gain < 0.018) continue;
      candidates.push({
        point: destination,
        direction,
        elevation: terrain.elevation,
        score: gain * 180 - terrain.slope * 32 - Math.abs(angle) * 0.65 + reach * 0.015,
      });
    }
  }
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const localTangent = { x: -candidate.direction.y, y: candidate.direction.x };
    const reach = distance(config.anchorPoint, candidate.point);
    const width = Math.min(5.2, Math.max(2.8, reach * 0.27));
    const points = [
      config.routePoint,
      config.anchorPoint,
      point(config.anchorPoint, candidate.direction, reach * 0.3, localTangent, width),
      point(config.anchorPoint, candidate.direction, reach * 0.56, localTangent, -width),
      point(config.anchorPoint, candidate.direction, reach * 0.8, localTangent, width * 0.62),
      candidate.point,
    ];
    if (!pathStaysDry(points, config.sampleTerrain)) continue;
    const smoothedPoints = smoothPolyline(points, 2);
    if (!pathStaysDry(smoothedPoints, config.sampleTerrain)) continue;
    const ascentPath = buildRegionalPolylinePath({
      id: `${config.id}:highland-ascent`,
      points: smoothedPoints,
      radius: 0.62,
      feather: 0.3,
    });
    const directDistance = distance(config.routePoint, candidate.point);
    if (ascentPath.arcLength < directDistance * 1.08) continue;
    return finishLayout({
      id: config.id,
      seed: config.seed,
      kind: config.kind,
      routePoint: config.routePoint,
      anchorPoint: config.anchorPoint,
      terminalPoint: candidate.point,
      accessPath: ascentPath,
      interiorPaths: [],
      chambers: [],
      startElevation,
      endElevation: candidate.elevation,
      elevationGain: candidate.elevation - startElevation,
      directDistance,
      traversableLength: ascentPath.arcLength,
      switchbackCount: 3,
    });
  }
  return null;
}

export function sampleRegionalEnvironmentProgramLayout(
  worldX: number,
  worldY: number,
  layout: RegionalEnvironmentProgramLayout,
): RegionalEnvironmentProgramSample {
  const accessDistance = distanceToRegionalParcelPath(worldX, worldY, layout.accessPath);
  const accessTrailWeight = 1 - smoothstep(
    layout.accessPath.radius,
    layout.accessPath.radius + layout.accessPath.feather,
    accessDistance,
  );
  let cavePathSignedDistance = Number.POSITIVE_INFINITY;
  for (const path of layout.interiorPaths) {
    cavePathSignedDistance = Math.min(
      cavePathSignedDistance,
      distanceToRegionalParcelPath(worldX, worldY, path) - path.radius,
    );
  }
  let caveChamberSignedDistance = Number.POSITIVE_INFINITY;
  for (const chamber of layout.chambers) {
    caveChamberSignedDistance = Math.min(
      caveChamberSignedDistance,
      signedEllipseDistance(worldX, worldY, chamber),
    );
  }
  const caveBoundaryNoise = valueNoise(
    worldX * 0.31,
    worldY * 0.31,
    layout.seed ^ 0x4c9d,
  ) * 0.72 + valueNoise(
    worldX * 0.87,
    worldY * 0.87,
    layout.seed ^ 0xa731,
  ) * 0.28;
  const caveSignedDistance = Math.min(
    cavePathSignedDistance + caveBoundaryNoise * 0.14,
    caveChamberSignedDistance + caveBoundaryNoise * 0.24,
  );
  const caveFloorWeight = layout.kind === 'cave-interior' && caveSignedDistance <= 0
    ? 0.84 + smoothstep(0, 1.2, -caveSignedDistance) * 0.16
    : 0;
  const caveWallWeight = layout.kind === 'cave-interior' && caveSignedDistance > 0
    ? 1 - smoothstep(0.04, 1.45, caveSignedDistance)
    : 0;
  const highlandTrailWeight = layout.kind === 'highland-ascent' ? accessTrailWeight : 0;
  const retainingEdgeWeight = layout.kind === 'highland-ascent'
    ? smoothstep(
      layout.accessPath.radius - 0.08,
      layout.accessPath.radius + 0.08,
      accessDistance,
    ) * (1 - smoothstep(
      layout.accessPath.radius + 0.08,
      layout.accessPath.radius + 0.48,
      accessDistance,
    ))
    : 0;
  const weights: Array<[RegionalEnvironmentProgramRole, number]> = [
    ['cave-floor', caveFloorWeight],
    ['highland-trail', highlandTrailWeight],
    ['access-trail', layout.kind === 'cave-interior' ? accessTrailWeight : 0],
    ['cave-wall', caveWallWeight],
    ['retaining-edge', retainingEdgeWeight],
  ];
  const role = weights.sort((a, b) => b[1] - a[1])[0]![1] > 0.001
    ? weights[0]![0]
    : null;
  return {
    accessTrailWeight: layout.kind === 'cave-interior' ? accessTrailWeight : 0,
    caveFloorWeight,
    caveWallWeight,
    highlandTrailWeight,
    retainingEdgeWeight,
    role,
  };
}

export function rasterizeRegionalEnvironmentProgramLayout(
  layout: RegionalEnvironmentProgramLayout,
): RegionalEnvironmentProgramCell[] {
  const cells: RegionalEnvironmentProgramCell[] = [];
  for (let y = Math.floor(layout.bounds.minY); y <= Math.ceil(layout.bounds.maxY); y++) {
    for (let x = Math.floor(layout.bounds.minX); x <= Math.ceil(layout.bounds.maxX); x++) {
      const sample = sampleRegionalEnvironmentProgramLayout(x + 0.5, y + 0.5, layout);
      const roles: RegionalEnvironmentProgramRole[] = [];
      if (sample.accessTrailWeight > 0.01) roles.push('access-trail');
      if (sample.caveFloorWeight > 0.01) roles.push('cave-floor');
      if (sample.caveWallWeight > 0.01) roles.push('cave-wall');
      if (sample.highlandTrailWeight > 0.01) roles.push('highland-trail');
      if (sample.retainingEdgeWeight > 0.01) roles.push('retaining-edge');
      if (roles.length === 0) continue;
      const walkable = Math.max(
        sample.accessTrailWeight,
        sample.caveFloorWeight,
        sample.highlandTrailWeight,
      ) > 0.08;
      cells.push({
        x,
        y,
        roles,
        walkable,
        solid: !walkable && sample.caveWallWeight > 0.12,
      });
    }
  }
  return cells;
}

function finishLayout(
  layout: Omit<RegionalEnvironmentProgramLayout, 'bounds'>,
): RegionalEnvironmentProgramLayout {
  const points = [
    ...layout.accessPath.points,
    ...layout.interiorPaths.flatMap((path) => path.points),
    ...layout.chambers.flatMap((chamber) => [
      { x: chamber.centre.x - chamber.radiusX, y: chamber.centre.y - chamber.radiusY },
      { x: chamber.centre.x + chamber.radiusX, y: chamber.centre.y + chamber.radiusY },
    ]),
  ];
  const boundsMargin = layout.kind === 'cave-interior' ? 2.1 : 1.5;
  return {
    ...layout,
    bounds: {
      minX: Math.min(...points.map((candidate) => candidate.x)) - boundsMargin,
      minY: Math.min(...points.map((candidate) => candidate.y)) - boundsMargin,
      maxX: Math.max(...points.map((candidate) => candidate.x)) + boundsMargin,
      maxY: Math.max(...points.map((candidate) => candidate.y)) + boundsMargin,
    },
  };
}

function pathStaysDry(
  points: readonly RegionalParcelPathPoint[],
  sampleTerrain: RegionalEnvironmentProgramLayoutConfig['sampleTerrain'],
): boolean {
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const steps = Math.max(1, Math.ceil(distance(start, end) * 2));
    for (let step = 0; step <= steps; step++) {
      const amount = step / steps;
      const sample = sampleTerrain(
        lerp(start.x, end.x, amount),
        lerp(start.y, end.y, amount),
      );
      if (sample.isWater || sample.slope > 0.24) return false;
    }
  }
  return true;
}

/** Two restrained Chaikin passes turn procedural graph corners into natural
 * tunnel bends and full-bench hairpins without changing endpoints or topology. */
function smoothPolyline(
  points: readonly RegionalParcelPathPoint[],
  passes: number,
): RegionalParcelPathPoint[] {
  let result = [...points];
  for (let pass = 0; pass < passes; pass++) {
    const smoothed = [result[0]!];
    for (let index = 1; index < result.length; index++) {
      const start = result[index - 1]!;
      const end = result[index]!;
      smoothed.push({
        x: lerp(start.x, end.x, 0.25),
        y: lerp(start.y, end.y, 0.25),
      }, {
        x: lerp(start.x, end.x, 0.75),
        y: lerp(start.y, end.y, 0.75),
      });
    }
    smoothed.push(result.at(-1)!);
    result = smoothed;
  }
  return result;
}

function signedEllipseDistance(
  worldX: number,
  worldY: number,
  chamber: RegionalCaveChamber,
): number {
  const dx = worldX - chamber.centre.x;
  const dy = worldY - chamber.centre.y;
  const cosine = Math.cos(-chamber.angle);
  const sine = Math.sin(-chamber.angle);
  const localX = dx * cosine - dy * sine;
  const localY = dx * sine + dy * cosine;
  const normalized = Math.hypot(localX / chamber.radiusX, localY / chamber.radiusY);
  const angle = Math.atan2(localY / chamber.radiusY, localX / chamber.radiusX);
  const chamberSeed = hashString(chamber.id);
  const phaseA = hashUnit(chamberSeed, 0x2a71) * Math.PI * 2;
  const phaseB = hashUnit(chamberSeed, 0x913d) * Math.PI * 2;
  const radialBoundary = 1 + Math.sin(angle * 3 + phaseA) * 0.23 +
    Math.sin(angle * 5 + phaseB) * 0.12;
  return (normalized - radialBoundary) * Math.min(chamber.radiusX, chamber.radiusY);
}

function point(
  origin: RegionalParcelPathPoint,
  axis: RegionalParcelPathPoint,
  axisDistance: number,
  tangent: RegionalParcelPathPoint,
  tangentDistance: number,
): RegionalParcelPathPoint {
  return {
    x: origin.x + axis.x * axisDistance + tangent.x * tangentDistance,
    y: origin.y + axis.y * axisDistance + tangent.y * tangentDistance,
  };
}

function rotate(vector: RegionalParcelPathPoint, angle: number): RegionalParcelPathPoint {
  return {
    x: vector.x * Math.cos(angle) - vector.y * Math.sin(angle),
    y: vector.x * Math.sin(angle) + vector.y * Math.cos(angle),
  };
}

function normalize(
  x: number,
  y: number,
  fallbackX: number,
  fallbackY: number,
): RegionalParcelPathPoint {
  const length = Math.hypot(x, y);
  return length < 1e-9 ? { x: fallbackX, y: fallbackY } : { x: x / length, y: y / length };
}

function distance(a: RegionalParcelPathPoint, b: RegionalParcelPathPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function hashUnit(seed: number, salt: number): number {
  let value = (seed ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const u = smoothstep(0, 1, x - x0);
  const v = smoothstep(0, 1, y - y0);
  const top = lerp(hashSigned(x0, y0, seed), hashSigned(x1, y0, seed), u);
  const bottom = lerp(hashSigned(x0, y1, seed), hashSigned(x1, y1, seed), u);
  return lerp(top, bottom, v);
}

function hashSigned(x: number, y: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x9e3779b1) ^ Math.imul(y ^ (seed >>> 1), 0x85ebca77);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (((value ^ (value >>> 16)) >>> 0) / 2147483648) - 1;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function smoothstep(minimum: number, maximum: number, value: number): number {
  const amount = clamp((value - minimum) / Math.max(1e-9, maximum - minimum), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
