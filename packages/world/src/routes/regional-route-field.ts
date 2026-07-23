import type { BiomePhysicalSample, BiomeWorldSample } from '../biomes/biome-world-field.js';

export type RegionalRouteKind = 'trail' | 'local-road' | 'arterial';
export type RegionalLandmarkKind = 'arrival' | 'settlement' | 'ruin' | 'waystation';
export type RegionalCrossingKind = 'ford' | 'bridge' | 'ferry';

export interface RegionalRouteSample {
  distance: number;
  isRoute: boolean;
  isCrossing: boolean;
  isWalkableRoute: boolean;
  crossingKind: RegionalCrossingKind | null;
  routeKind: RegionalRouteKind | null;
  routeId: string | null;
  directionX: number;
  directionY: number;
  landmarkKind: RegionalLandmarkKind | null;
  landmarkDistance: number;
}

export interface RegionalRouteBiomeSampler {
  sample(worldX: number, worldY: number): BiomeWorldSample;
  samplePhysical?(worldX: number, worldY: number): BiomePhysicalSample;
}

export interface RegionalRouteFieldConfig {
  blockSize?: number;
  maxCachedBlocks?: number;
  maxCachedPaths?: number;
  maxCachedSites?: number;
  siteCellSize?: number;
  pathStep?: number;
  pathMargin?: number;
}

interface RouteSite {
  id: string;
  cellX: number;
  cellY: number;
  x: number;
  y: number;
  priority: number;
  landmarkKind: RegionalLandmarkKind;
}

interface RouteEdge {
  id: string;
  start: RouteSite;
  end: RouteSite;
  kind: RegionalRouteKind;
  width: number;
}

interface RoutePoint {
  x: number;
  y: number;
  isWater: boolean;
  crossingCode: number;
}

interface RoutePath {
  edge: RouteEdge;
  points: RoutePoint[];
  accessedAt: number;
}

interface CachedRouteBlock {
  distance: Float32Array;
  kind: Uint8Array;
  crossing: Uint8Array;
  routeIds: Array<string | null>;
  directionX: Float32Array;
  directionY: Float32Array;
  landmarkDistance: Float32Array;
  landmarkKind: Uint8Array;
  accessedAt: number;
}

interface HeapEntry {
  index: number;
  priority: number;
}

const KIND_TRAIL = 1;
const KIND_LOCAL = 2;
const KIND_ARTERIAL = 3;
const KIND_BY_CODE: ReadonlyArray<RegionalRouteKind | null> = [null, 'trail', 'local-road', 'arterial'];
const CROSSING_BY_CODE: ReadonlyArray<RegionalCrossingKind | null> = [null, 'ford', 'bridge', 'ferry'];
const LANDMARK_ARRIVAL = 1;
const LANDMARK_SETTLEMENT = 2;
const LANDMARK_RUIN = 3;
const LANDMARK_WAYSTATION = 4;
const LANDMARK_BY_CODE: ReadonlyArray<RegionalLandmarkKind | null> = [
  null,
  'arrival',
  'settlement',
  'ruin',
  'waystation',
];

/**
 * Sparse, coordinate-stable regional route hierarchy.
 *
 * Jittered sites form a Gabriel proximity graph, avoiding a repeated street
 * lattice. Each accepted edge is then solved on the physical biome field with
 * an eight-neighbour least-cost search. Slope, elevation change and long water
 * travel are expensive; crossings remain legal and are exposed explicitly for
 * bridges or fords. Every decision is a pure function of seed and world
 * coordinate, while only derived blocks and paths are cached.
 */
export class RegionalRouteField {
  private readonly seed32: number;
  private readonly biomes: RegionalRouteBiomeSampler;
  private readonly blockSize: number;
  private readonly maxCachedBlocks: number;
  private readonly maxCachedPaths: number;
  private readonly maxCachedSites: number;
  private readonly siteCellSize: number;
  private readonly pathStep: number;
  private readonly pathMargin: number;
  private readonly maxEdgeDistance: number;
  private readonly blockCache = new Map<string, CachedRouteBlock>();
  private readonly pathCache = new Map<string, RoutePath>();
  private readonly siteCache = new Map<string, RouteSite | null>();
  private accessClock = 0;

  constructor(worldSeed: bigint, biomes: RegionalRouteBiomeSampler, config: RegionalRouteFieldConfig = {}) {
    this.seed32 = Number(BigInt.asUintN(32, worldSeed));
    this.biomes = biomes;
    this.blockSize = Math.max(16, config.blockSize ?? 32);
    this.maxCachedBlocks = Math.max(4, config.maxCachedBlocks ?? 32);
    this.maxCachedPaths = Math.max(16, config.maxCachedPaths ?? 192);
    this.maxCachedSites = Math.max(256, config.maxCachedSites ?? 4096);
    this.siteCellSize = Math.max(32, config.siteCellSize ?? 40);
    this.pathStep = Math.max(2, config.pathStep ?? 5);
    this.pathMargin = Math.max(12, config.pathMargin ?? 18);
    this.maxEdgeDistance = this.siteCellSize * 7.2;
  }

  sample(worldX: number, worldY: number): RegionalRouteSample {
    const tileX = Math.floor(worldX);
    const tileY = Math.floor(worldY);
    const blockX = floorDiv(tileX, this.blockSize);
    const blockY = floorDiv(tileY, this.blockSize);
    const block = this.getBlock(blockX, blockY);
    const localX = tileX - blockX * this.blockSize;
    const localY = tileY - blockY * this.blockSize;
    const index = gridIndex(localX, localY, this.blockSize);
    const kind = KIND_BY_CODE[block.kind[index]!] ?? null;
    const crossingKind = CROSSING_BY_CODE[block.crossing[index]!] ?? null;
    return {
      distance: block.distance[index]!,
      isRoute: kind !== null,
      isCrossing: crossingKind !== null,
      isWalkableRoute: kind !== null && crossingKind !== 'ferry',
      crossingKind,
      routeKind: kind,
      routeId: block.routeIds[index]!,
      directionX: block.directionX[index]!,
      directionY: block.directionY[index]!,
      landmarkKind: LANDMARK_BY_CODE[block.landmarkKind[index]!] ?? null,
      landmarkDistance: block.landmarkDistance[index]!,
    };
  }

  prewarm(minX: number, minY: number, maxX: number, maxY: number): void {
    const firstBlockX = floorDiv(Math.floor(minX), this.blockSize);
    const lastBlockX = floorDiv(Math.floor(maxX), this.blockSize);
    const firstBlockY = floorDiv(Math.floor(minY), this.blockSize);
    const lastBlockY = floorDiv(Math.floor(maxY), this.blockSize);
    for (let blockY = firstBlockY; blockY <= lastBlockY; blockY++) {
      for (let blockX = firstBlockX; blockX <= lastBlockX; blockX++) this.getBlock(blockX, blockY);
    }
  }

  getStats(): {
    cachedBlocks: number;
    cachedPaths: number;
    cachedSites: number;
    maxCachedBlocks: number;
    maxCachedPaths: number;
    maxCachedSites: number;
    blockSize: number;
  } {
    return {
      cachedBlocks: this.blockCache.size,
      cachedPaths: this.pathCache.size,
      cachedSites: this.siteCache.size,
      maxCachedBlocks: this.maxCachedBlocks,
      maxCachedPaths: this.maxCachedPaths,
      maxCachedSites: this.maxCachedSites,
      blockSize: this.blockSize,
    };
  }

  clear(): void {
    this.blockCache.clear();
    this.pathCache.clear();
    this.siteCache.clear();
  }

  private getBlock(blockX: number, blockY: number): CachedRouteBlock {
    const key = `${blockX},${blockY}`;
    const cached = this.blockCache.get(key);
    if (cached) {
      cached.accessedAt = ++this.accessClock;
      this.blockCache.delete(key);
      this.blockCache.set(key, cached);
      return cached;
    }
    const block = this.buildBlock(blockX, blockY);
    this.blockCache.set(key, block);
    trimLru(this.blockCache, this.maxCachedBlocks);
    return block;
  }

  private buildBlock(blockX: number, blockY: number): CachedRouteBlock {
    const originX = blockX * this.blockSize;
    const originY = blockY * this.blockSize;
    const size = this.blockSize * this.blockSize;
    const distance = new Float32Array(size);
    distance.fill(Number.POSITIVE_INFINITY);
    const kind = new Uint8Array(size);
    const crossing = new Uint8Array(size);
    const routeIds = new Array<string | null>(size).fill(null);
    const directionX = new Float32Array(size);
    const directionY = new Float32Array(size);
    const landmarkDistance = new Float32Array(size);
    landmarkDistance.fill(Number.POSITIVE_INFINITY);
    const landmarkKind = new Uint8Array(size);
    const queryPadding = this.maxEdgeDistance + this.pathMargin;
    const sites = this.collectSites(
      originX - queryPadding,
      originY - queryPadding,
      originX + this.blockSize + queryPadding,
      originY + this.blockSize + queryPadding,
    );
    const edges = this.buildEdges(sites);
    for (const edge of edges) {
      if (!edgeMayReachBounds(
        edge,
        this.pathMargin,
        originX,
        originY,
        originX + this.blockSize,
        originY + this.blockSize,
      )) continue;
      const path = this.getPath(edge);
      if (!pathIntersectsBounds(
        path.points,
        originX - edge.width,
        originY - edge.width,
        originX + this.blockSize + edge.width,
        originY + this.blockSize + edge.width,
      )) continue;
      this.rasterizePath(
        path,
        originX,
        originY,
        distance,
        kind,
        crossing,
        routeIds,
        directionX,
        directionY,
      );
    }
    for (const site of sites) {
      if (site.x < originX - 4 || site.x > originX + this.blockSize + 4 ||
          site.y < originY - 4 || site.y > originY + this.blockSize + 4) continue;
      const resolvedLandmarkKind = site.landmarkKind === 'arrival'
        ? 'arrival'
        : landmarkKindForBiome(this.biomes.sample(site.x, site.y));
      const minX = Math.max(0, Math.floor(site.x - originX - 4));
      const maxX = Math.min(this.blockSize - 1, Math.ceil(site.x - originX + 4));
      const minY = Math.max(0, Math.floor(site.y - originY - 4));
      const maxY = Math.min(this.blockSize - 1, Math.ceil(site.y - originY + 4));
      for (let localY = minY; localY <= maxY; localY++) {
        for (let localX = minX; localX <= maxX; localX++) {
          const index = gridIndex(localX, localY, this.blockSize);
          const value = Math.hypot(originX + localX - site.x, originY + localY - site.y);
          if (value >= landmarkDistance[index]!) continue;
          landmarkDistance[index] = value;
          landmarkKind[index] = landmarkCode(resolvedLandmarkKind);
        }
      }
    }
    return {
      distance,
      kind,
      crossing,
      routeIds,
      directionX,
      directionY,
      landmarkDistance,
      landmarkKind,
      accessedAt: ++this.accessClock,
    };
  }

  private rasterizePath(
    path: RoutePath,
    originX: number,
    originY: number,
    distance: Float32Array,
    kind: Uint8Array,
    crossing: Uint8Array,
    routeIds: Array<string | null>,
    directionX: Float32Array,
    directionY: Float32Array,
  ): void {
    const routeCode = routeKindCode(path.edge.kind);
    for (let pointIndex = 1; pointIndex < path.points.length; pointIndex++) {
      const start = path.points[pointIndex - 1]!;
      const end = path.points[pointIndex]!;
      const segmentLength = Math.max(1e-9, Math.hypot(end.x - start.x, end.y - start.y));
      const tangentX = (end.x - start.x) / segmentLength;
      const tangentY = (end.y - start.y) / segmentLength;
      const reach = path.edge.width + 1;
      const minX = Math.max(0, Math.floor(Math.min(start.x, end.x) - reach - originX));
      const maxX = Math.min(this.blockSize - 1, Math.ceil(Math.max(start.x, end.x) + reach - originX));
      const minY = Math.max(0, Math.floor(Math.min(start.y, end.y) - reach - originY));
      const maxY = Math.min(this.blockSize - 1, Math.ceil(Math.max(start.y, end.y) + reach - originY));
      if (minX > maxX || minY > maxY) continue;
      for (let localY = minY; localY <= maxY; localY++) {
        for (let localX = minX; localX <= maxX; localX++) {
          const worldX = originX + localX;
          const worldY = originY + localY;
          const value = segmentDistance(worldX, worldY, start.x, start.y, end.x, end.y);
          const index = gridIndex(localX, localY, this.blockSize);
          if (value >= distance[index]!) continue;
          distance[index] = value;
          if (value <= path.edge.width) {
            kind[index] = routeCode;
            routeIds[index] = path.edge.id;
            directionX[index] = tangentX;
            directionY[index] = tangentY;
            if (start.isWater || end.isWater || this.physicalSample(worldX, worldY).isWater) {
              crossing[index] = Math.max(1, start.crossingCode, end.crossingCode);
            }
          }
        }
      }
    }
  }

  private collectSites(minX: number, minY: number, maxX: number, maxY: number): RouteSite[] {
    const firstCellX = floorDiv(Math.floor(minX), this.siteCellSize) - 1;
    const lastCellX = floorDiv(Math.ceil(maxX), this.siteCellSize) + 1;
    const firstCellY = floorDiv(Math.floor(minY), this.siteCellSize) - 1;
    const lastCellY = floorDiv(Math.ceil(maxY), this.siteCellSize) + 1;
    const sites: RouteSite[] = [];
    for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
        const site = this.siteAt(cellX, cellY);
        if (site) sites.push(site);
      }
    }
    if (minX <= 0 && maxX >= 0 && minY <= 0 && maxY >= 0) sites.push(this.arrivalSite());
    return sites;
  }

  private siteAt(cellX: number, cellY: number): RouteSite | null {
    const id = `site:${cellX},${cellY}`;
    if (this.siteCache.has(id)) {
      const cached = this.siteCache.get(id) ?? null;
      this.siteCache.delete(id);
      this.siteCache.set(id, cached);
      return cached;
    }
    const acceptance = this.hashUnit(cellX, cellY, 0x71a3);
    const neighbours = [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;
    for (const [offsetX, offsetY] of neighbours) {
      if (this.hashUnit(cellX + offsetX, cellY + offsetY, 0x71a3) < acceptance) {
          this.siteCache.set(id, null);
          trimLru(this.siteCache, this.maxCachedSites);
          return null;
      }
    }
    const candidates = Array.from({ length: 5 }, (_, index) => {
      const x = Math.round((cellX + 0.08 + this.hashUnit(cellX, cellY, 0x2171 + index * 37) * 0.84) * this.siteCellSize);
      const y = Math.round((cellY + 0.08 + this.hashUnit(cellX, cellY, 0x691d + index * 53) * 0.84) * this.siteCellSize);
      const physical = this.physicalSample(x, y);
      return { x, y, suitability: Number(physical.isWater) * 80 + physical.slope * 220 };
    });
    candidates.sort((a, b) => a.suitability - b.suitability || a.x - b.x || a.y - b.y);
    const selected = candidates[0]!;
    const priority = this.hashUnit(cellX, cellY, 0xc341);
    const site = {
      id,
      cellX,
      cellY,
      x: selected.x,
      y: selected.y,
      priority,
      landmarkKind: 'waystation' as const,
    };
    this.siteCache.set(id, site);
    trimLru(this.siteCache, this.maxCachedSites);
    return site;
  }

  private arrivalSite(): RouteSite {
    return {
      id: 'site:arrival',
      cellX: 0,
      cellY: 0,
      x: 0,
      y: 0,
      priority: 0,
      landmarkKind: 'arrival',
    };
  }

  private buildEdges(sites: RouteSite[]): RouteEdge[] {
    const edges: RouteEdge[] = [];
    const byId = new Map(sites.map((site) => [site.id, site]));
    const uniqueSites = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    for (let first = 0; first < uniqueSites.length; first++) {
      const start = uniqueSites[first]!;
      for (let second = first + 1; second < uniqueSites.length; second++) {
        const end = uniqueSites[second]!;
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        if (length > this.maxEdgeDistance || length < 4) continue;
        if (!this.isGabrielEdge(start, end)) continue;
        const kind = routeKindFor(start, end, length, this.siteCellSize);
        edges.push({
          id: `${start.id}|${end.id}`,
          start,
          end,
          kind,
          width: kind === 'arterial' ? 1.85 : kind === 'local-road' ? 1.3 : 0.85,
        });
      }
    }
    return edges;
  }

  private isGabrielEdge(start: RouteSite, end: RouteSite): boolean {
    const centreX = (start.x + end.x) / 2;
    const centreY = (start.y + end.y) / 2;
    const radius = Math.hypot(end.x - start.x, end.y - start.y) / 2;
    const firstCellX = floorDiv(Math.floor(centreX - radius), this.siteCellSize) - 1;
    const lastCellX = floorDiv(Math.ceil(centreX + radius), this.siteCellSize) + 1;
    const firstCellY = floorDiv(Math.floor(centreY - radius), this.siteCellSize) - 1;
    const lastCellY = floorDiv(Math.ceil(centreY + radius), this.siteCellSize) + 1;
    for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
        const site = this.siteAt(cellX, cellY);
        if (!site) continue;
        if (site.id === start.id || site.id === end.id) continue;
        if (Math.hypot(site.x - centreX, site.y - centreY) < radius * 0.985) return false;
      }
    }
    const arrival = this.arrivalSite();
    if (arrival.id !== start.id && arrival.id !== end.id &&
        Math.hypot(arrival.x - centreX, arrival.y - centreY) < radius * 0.985) return false;
    return true;
  }

  private getPath(edge: RouteEdge): RoutePath {
    const cached = this.pathCache.get(edge.id);
    if (cached) {
      cached.accessedAt = ++this.accessClock;
      this.pathCache.delete(edge.id);
      this.pathCache.set(edge.id, cached);
      return cached;
    }
    const path = { edge, points: this.solvePath(edge), accessedAt: ++this.accessClock };
    this.pathCache.set(edge.id, path);
    trimLru(this.pathCache, this.maxCachedPaths);
    return path;
  }

  private solvePath(edge: RouteEdge): RoutePoint[] {
    const minX = Math.floor(Math.min(edge.start.x, edge.end.x) - this.pathMargin);
    const minY = Math.floor(Math.min(edge.start.y, edge.end.y) - this.pathMargin);
    const maxX = Math.ceil(Math.max(edge.start.x, edge.end.x) + this.pathMargin);
    const maxY = Math.ceil(Math.max(edge.start.y, edge.end.y) + this.pathMargin);
    const columns = Math.ceil((maxX - minX) / this.pathStep) + 1;
    const rows = Math.ceil((maxY - minY) / this.pathStep) + 1;
    const toIndex = (column: number, row: number) => row * columns + column;
    const toWorld = (index: number) => ({
      x: minX + (index % columns) * this.pathStep,
      y: minY + Math.floor(index / columns) * this.pathStep,
    });
    const closestIndex = (x: number, y: number) => toIndex(
      clampInt(Math.round((x - minX) / this.pathStep), 0, columns - 1),
      clampInt(Math.round((y - minY) / this.pathStep), 0, rows - 1),
    );
    const startIndex = closestIndex(edge.start.x, edge.start.y);
    const endIndex = closestIndex(edge.end.x, edge.end.y);
    const count = columns * rows;
    const costs = new Float64Array(count);
    costs.fill(Number.POSITIVE_INFINITY);
    const previous = new Int32Array(count);
    previous.fill(-1);
    const closed = new Uint8Array(count);
    const heap = new MinHeap();
    const terrain = new Map<number, BiomePhysicalSample>();
    const terrainAt = (index: number) => {
      let sample = terrain.get(index);
      if (!sample) {
        const point = toWorld(index);
        sample = this.physicalSample(point.x, point.y);
        terrain.set(index, sample);
      }
      return sample;
    };
    costs[startIndex] = 0;
    heap.push({ index: startIndex, priority: 0 });
    const directions = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0], [1, 0],
      [-1, 1], [0, 1], [1, 1],
    ] as const;
    while (heap.size > 0) {
      const current = heap.pop()!;
      if (closed[current.index]) continue;
      if (current.index === endIndex) break;
      closed[current.index] = 1;
      const column = current.index % columns;
      const row = Math.floor(current.index / columns);
      const currentTerrain = terrainAt(current.index);
      for (const [offsetX, offsetY] of directions) {
        const nextColumn = column + offsetX;
        const nextRow = row + offsetY;
        if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
        const nextIndex = toIndex(nextColumn, nextRow);
        if (closed[nextIndex]) continue;
        const nextTerrain = terrainAt(nextIndex);
        const stepLength = Math.hypot(offsetX, offsetY) * this.pathStep;
        const slope = (currentTerrain.slope + nextTerrain.slope) / 2;
        const rise = Math.abs(nextTerrain.elevation - currentTerrain.elevation) / stepLength;
        const waterCost = currentTerrain.isWater && nextTerrain.isWater
          ? 9.5
          : currentTerrain.isWater || nextTerrain.isWater
            ? 3.8
            : 0;
        const multiplier = Math.max(0.35, 1 + Math.pow(slope / 0.028, 2) * 1.9 +
          Math.pow(rise / 0.018, 2) * 1.6 + waterCost);
        const tentative = costs[current.index]! + stepLength * multiplier;
        if (tentative >= costs[nextIndex]!) continue;
        costs[nextIndex] = tentative;
        previous[nextIndex] = current.index;
        const nextPoint = toWorld(nextIndex);
        const heuristic = Math.hypot(edge.end.x - nextPoint.x, edge.end.y - nextPoint.y) * 0.35;
        heap.push({ index: nextIndex, priority: tentative + heuristic });
      }
    }
    if (previous[endIndex] === -1) return this.straightPath(edge);
    const reversed: RoutePoint[] = [];
    for (let index = endIndex; index !== -1; index = previous[index]!) {
      const point = toWorld(index);
      reversed.push({ ...point, isWater: terrainAt(index).isWater, crossingCode: 0 });
      if (index === startIndex) break;
    }
    reversed.reverse();
    const points = [
      { x: edge.start.x, y: edge.start.y, isWater: this.physicalSample(edge.start.x, edge.start.y).isWater, crossingCode: 0 },
      ...reversed,
      { x: edge.end.x, y: edge.end.y, isWater: this.physicalSample(edge.end.x, edge.end.y).isWater, crossingCode: 0 },
    ];
    return smoothRoutePoints(removeCollinearPoints(points), (x, y) => this.physicalSample(x, y).isWater);
  }

  private straightPath(edge: RouteEdge): RoutePoint[] {
    return classifyCrossings([edge.start, edge.end].map((point) => ({
      x: point.x,
      y: point.y,
      isWater: this.physicalSample(point.x, point.y).isWater,
      crossingCode: 0,
    })));
  }

  private physicalSample(worldX: number, worldY: number): BiomePhysicalSample {
    const samplePhysical = this.biomes.samplePhysical;
    if (samplePhysical) return samplePhysical.call(this.biomes, worldX, worldY);
    const sample = this.biomes.sample(worldX, worldY);
    return {
      elevation: sample.elevation,
      slope: sample.slope,
      waterDistance: sample.waterDistance,
      isWater: sample.isWater,
      isRiver: sample.isRiver,
    };
  }

  private hashUnit(x: number, y: number, salt: number): number {
    let value = Math.imul((x | 0) ^ this.seed32 ^ salt, 0x45d9f3b);
    value = Math.imul(value ^ (y | 0), 0x119de1f3);
    return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
  }
}

class MinHeap {
  private readonly entries: HeapEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  push(entry: HeapEntry): void {
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.entries[parent]!.priority <= entry.priority) break;
      this.entries[index] = this.entries[parent]!;
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): HeapEntry | undefined {
    const root = this.entries[0];
    const last = this.entries.pop();
    if (!root || !last || this.entries.length === 0) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.entries.length) break;
      const right = left + 1;
      const child = right < this.entries.length && this.entries[right]!.priority < this.entries[left]!.priority
        ? right
        : left;
      if (this.entries[child]!.priority >= last.priority) break;
      this.entries[index] = this.entries[child]!;
      index = child;
    }
    this.entries[index] = last;
    return root;
  }
}

function routeKindFor(start: RouteSite, end: RouteSite, length: number, siteCellSize: number): RegionalRouteKind {
  const priority = Math.min(start.priority, end.priority);
  if (start.landmarkKind === 'arrival' || end.landmarkKind === 'arrival' ||
      (priority < 0.12 && length > siteCellSize * 2.15)) return 'arterial';
  if (priority < 0.48 || start.landmarkKind === 'settlement' || end.landmarkKind === 'settlement') return 'local-road';
  return 'trail';
}

function routeKindCode(kind: RegionalRouteKind): number {
  return kind === 'arterial' ? KIND_ARTERIAL : kind === 'local-road' ? KIND_LOCAL : KIND_TRAIL;
}

function landmarkCode(kind: RegionalLandmarkKind): number {
  if (kind === 'arrival') return LANDMARK_ARRIVAL;
  if (kind === 'settlement') return LANDMARK_SETTLEMENT;
  if (kind === 'ruin') return LANDMARK_RUIN;
  return LANDMARK_WAYSTATION;
}

function landmarkKindForBiome(biome: BiomeWorldSample): RegionalLandmarkKind {
  if (biome.weights[0] >= 0.23) return 'settlement';
  if (biome.weights[5] >= 0.28) return 'ruin';
  return 'waystation';
}

function edgeMayReachBounds(
  edge: RouteEdge,
  pathMargin: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  return Math.max(edge.start.x, edge.end.x) + pathMargin >= minX &&
    Math.min(edge.start.x, edge.end.x) - pathMargin <= maxX &&
    Math.max(edge.start.y, edge.end.y) + pathMargin >= minY &&
    Math.min(edge.start.y, edge.end.y) - pathMargin <= maxY;
}

function removeCollinearPoints(points: RoutePoint[]): RoutePoint[] {
  if (points.length <= 2) return points;
  const result = [points[0]!];
  for (let index = 1; index < points.length - 1; index++) {
    const previous = result[result.length - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const cross = (current.x - previous.x) * (next.y - current.y) -
      (current.y - previous.y) * (next.x - current.x);
    if (Math.abs(cross) > 1e-7 || current.isWater !== previous.isWater || current.isWater !== next.isWater) {
      result.push(current);
    }
  }
  result.push(points[points.length - 1]!);
  return result;
}

function smoothRoutePoints(
  source: RoutePoint[],
  isWaterAt: (x: number, y: number) => boolean,
): RoutePoint[] {
  let points = source.map(({ x, y }) => ({ x, y }));
  for (let pass = 0; pass < 2; pass++) {
    const next = [points[0]!];
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1]!;
      const end = points[index]!;
      next.push(
        { x: start.x * 0.75 + end.x * 0.25, y: start.y * 0.75 + end.y * 0.25 },
        { x: start.x * 0.25 + end.x * 0.75, y: start.y * 0.25 + end.y * 0.75 },
      );
    }
    next.push(points[points.length - 1]!);
    points = next;
  }
  return classifyCrossings(points.map(({ x, y }) => ({
    x,
    y,
    isWater: isWaterAt(x, y),
    crossingCode: 0,
  })));
}

function classifyCrossings(points: RoutePoint[]): RoutePoint[] {
  let runStart = -1;
  for (let index = 0; index <= points.length; index++) {
    const isWater = index < points.length && points[index]!.isWater;
    if (isWater && runStart < 0) runStart = index;
    if (isWater || runStart < 0) continue;
    const runEnd = index - 1;
    let span = 0;
    for (let pointIndex = runStart + 1; pointIndex <= runEnd; pointIndex++) {
      const previous = points[pointIndex - 1]!;
      const current = points[pointIndex]!;
      span += Math.hypot(current.x - previous.x, current.y - previous.y);
    }
    if (runStart === runEnd) {
      const previous = points[Math.max(0, runStart - 1)]!;
      const current = points[runStart]!;
      const next = points[Math.min(points.length - 1, runStart + 1)]!;
      span = (Math.hypot(current.x - previous.x, current.y - previous.y) +
        Math.hypot(next.x - current.x, next.y - current.y)) / 2;
    }
    const crossingCode = span > 12 ? 3 : span > 3.5 ? 2 : 1;
    for (let pointIndex = runStart; pointIndex <= runEnd; pointIndex++) {
      points[pointIndex]!.crossingCode = crossingCode;
    }
    runStart = -1;
  }
  return points;
}

function pathIntersectsBounds(
  points: RoutePoint[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]!;
    const end = points[index]!;
    if (Math.max(start.x, end.x) >= minX && Math.min(start.x, end.x) <= maxX &&
        Math.max(start.y, end.y) >= minY && Math.min(start.y, end.y) <= maxY) return true;
  }
  return false;
}

function segmentDistance(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lengthSquared))
    : 0;
  return Math.hypot(px - (x0 + dx * projection), py - (y0 + dy * projection));
}

function trimLru<Value>(cache: Map<string, Value>, maxSize: number): void {
  while (cache.size > maxSize) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function clampInt(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, Math.trunc(value)));
}

function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

function gridIndex(x: number, y: number, width: number): number {
  return y * width + x;
}
