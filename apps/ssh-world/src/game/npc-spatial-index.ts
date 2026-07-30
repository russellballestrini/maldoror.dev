interface NPCSpatialEntry {
  id: string;
  x: number;
  y: number;
  order: number;
  bucket: NPCSpatialBucket;
}

interface NPCSpatialBucket {
  x: number;
  y: number;
  entries: Set<NPCSpatialEntry>;
}

export interface NPCSpatialQueryResult {
  ids: string[];
  /** Non-empty buckets covered by the selected strategy. */
  visitedBuckets: number;
  /** Residents tested against the exact viewport bounds. */
  visitedCandidates: number;
  strategy: 'region' | 'occupied';
}

/**
 * Order-preserving spatial index for integer world bodies.
 *
 * Small viewport queries visit only intersecting grid cells. Extremely large
 * viewports iterate occupied buckets instead, preventing sparse-world queries
 * from expanding into an unbounded empty-cell traversal.
 */
export class NPCSpatialIndex {
  private readonly cellSize: number;
  private readonly buckets: Map<string, NPCSpatialBucket> = new Map();
  private readonly entries: Map<string, NPCSpatialEntry> = new Map();
  private nextOrder = 0;

  constructor(cellSize = 16) {
    if (!Number.isInteger(cellSize) || cellSize <= 0) {
      throw new Error(`NPC spatial cell size must be a positive integer, received ${cellSize}`);
    }
    this.cellSize = cellSize;
  }

  upsert(id: string, x: number, y: number): void {
    const bucketX = this.bucketCoordinate(x);
    const bucketY = this.bucketCoordinate(y);
    const key = this.bucketKey(bucketX, bucketY);
    const previous = this.entries.get(id);
    if (previous?.bucket.x === bucketX && previous.bucket.y === bucketY) {
      previous.x = x;
      previous.y = y;
      return;
    }

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { x: bucketX, y: bucketY, entries: new Set() };
      this.buckets.set(key, bucket);
    }

    if (previous) {
      this.removeFromBucket(previous);
      previous.x = x;
      previous.y = y;
      previous.bucket = bucket;
      bucket.entries.add(previous);
      return;
    }

    const entry: NPCSpatialEntry = {
      id,
      x,
      y,
      order: this.nextOrder++,
      bucket,
    };
    this.entries.set(id, entry);
    bucket.entries.add(entry);
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.removeFromBucket(entry);
  }

  clear(): void {
    this.entries.clear();
    this.buckets.clear();
    this.nextOrder = 0;
  }

  query(minX: number, minY: number, maxX: number, maxY: number): NPCSpatialQueryResult {
    if (maxX < minX || maxY < minY || this.entries.size === 0) {
      return { ids: [], visitedBuckets: 0, visitedCandidates: 0, strategy: 'region' };
    }

    const minBucketX = this.bucketCoordinate(minX);
    const minBucketY = this.bucketCoordinate(minY);
    const maxBucketX = this.bucketCoordinate(maxX);
    const maxBucketY = this.bucketCoordinate(maxY);
    const columns = maxBucketX - minBucketX + 1;
    const rows = maxBucketY - minBucketY + 1;
    const regionCells = columns * rows;
    const candidates: NPCSpatialEntry[] = [];
    let visitedBuckets = 0;
    let visitedCandidates = 0;

    const acceptBucket = (bucket: NPCSpatialBucket): void => {
      visitedBuckets++;
      for (const entry of bucket.entries) {
        visitedCandidates++;
        if (entry.x < minX || entry.x > maxX || entry.y < minY || entry.y > maxY) continue;
        candidates.push(entry);
      }
    };

    const strategy = Number.isSafeInteger(regionCells) && regionCells <= this.buckets.size
      ? 'region'
      : 'occupied';
    if (strategy === 'region') {
      for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY++) {
        for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX++) {
          const bucket = this.buckets.get(this.bucketKey(bucketX, bucketY));
          if (bucket) acceptBucket(bucket);
        }
      }
      candidates.sort((left, right) => left.order - right.order);
    } else {
      // Map iteration already carries canonical insertion order. Scanning the
      // bounded live set is cheaper than enumerating a vast sparse cell range,
      // and avoids sorting an all-world result after bucket traversal.
      visitedBuckets = this.buckets.size;
      for (const entry of this.entries.values()) {
        visitedCandidates++;
        if (entry.x < minX || entry.x > maxX || entry.y < minY || entry.y > maxY) continue;
        candidates.push(entry);
      }
    }

    return {
      ids: candidates.map((entry) => entry.id),
      visitedBuckets,
      visitedCandidates,
      strategy,
    };
  }

  private removeFromBucket(entry: NPCSpatialEntry): void {
    const bucket = entry.bucket;
    bucket.entries.delete(entry);
    if (bucket.entries.size === 0) this.buckets.delete(this.bucketKey(bucket.x, bucket.y));
  }

  private bucketCoordinate(value: number): number {
    return Math.floor(value / this.cellSize);
  }

  private bucketKey(x: number, y: number): string {
    return `${x},${y}`;
  }
}
