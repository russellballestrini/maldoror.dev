export interface BoundedNPCPathInput {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  homeX: number;
  homeY: number;
  roamRadius: number;
  tieBreaker: number;
  isBlocked(x: number, y: number): boolean;
}

/** Return a deterministic shortest four-neighbour path.
 * The search is bounded by the inhabitant's persisted roam disc, so obstacle
 * avoidance cannot turn a local life decision into unbounded world work. */
export function findBoundedNPCPath(input: BoundedNPCPathInput): Array<{
  x: number;
  y: number;
}> | null {
  if (input.startX === input.targetX && input.startY === input.targetY) return [];
  const radius = Math.max(1, Math.floor(input.roamRadius));
  const radiusSquared = radius * radius;
  const startKey = positionKey(input.startX, input.startY);
  const targetKey = positionKey(input.targetX, input.targetY);
  const queue: Array<{ x: number; y: number }> = [{ x: input.startX, y: input.startY }];
  const parents = new Map<string, string | null>([[startKey, null]]);
  const phase = ((input.tieBreaker % 4) + 4) % 4;
  const directions = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ] as const;

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
    for (let index = 0; index < directions.length; index++) {
      const direction = directions[(index + phase) % directions.length]!;
      const x = current.x + direction.x;
      const y = current.y + direction.y;
      const key = positionKey(x, y);
      if (parents.has(key)) continue;
      const homeDx = x - input.homeX;
      const homeDy = y - input.homeY;
      if (homeDx * homeDx + homeDy * homeDy > radiusSquared || input.isBlocked(x, y)) continue;
      parents.set(key, positionKey(current.x, current.y));
      if (key === targetKey) return reconstructPath(parents, startKey, targetKey);
      queue.push({ x, y });
    }
  }
  return null;
}

export function findBoundedNPCPathStep(input: BoundedNPCPathInput): {
  x: number;
  y: number;
} | null {
  return findBoundedNPCPath(input)?.[0] ?? null;
}

function reconstructPath(
  parents: ReadonlyMap<string, string | null>,
  startKey: string,
  targetKey: string,
): Array<{ x: number; y: number }> | null {
  let cursor = targetKey;
  const reversed: Array<{ x: number; y: number }> = [];
  while (cursor !== startKey) {
    const [x, y] = cursor.split(',').map(Number);
    reversed.push({ x: x!, y: y! });
    const parent = parents.get(cursor);
    if (!parent) return null;
    cursor = parent;
  }
  return reversed.reverse();
}

function positionKey(x: number, y: number): string {
  return `${x},${y}`;
}
