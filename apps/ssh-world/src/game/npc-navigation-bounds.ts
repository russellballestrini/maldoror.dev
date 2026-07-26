export interface NPCNavigationBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function npcNavigationBoundsForHome(
  homeX: number,
  homeY: number,
  roamRadius: number,
  padding = 2,
): NPCNavigationBounds {
  const margin = Math.max(0, Math.floor(padding));
  const radius = Math.max(1, Math.ceil(roamRadius)) + margin;
  return {
    minX: Math.floor(homeX) - radius,
    minY: Math.floor(homeY) - radius,
    maxX: Math.floor(homeX) + radius,
    maxY: Math.floor(homeY) + radius,
  };
}

/** Merge overlapping roam regions, then deterministically compact the nearest
 * remaining regions until they fit the collision provider's bounded LRU. */
export function coalesceNPCNavigationBounds(
  source: readonly NPCNavigationBounds[],
  maximumRegions: number,
  maximumArea: number,
): NPCNavigationBounds[] {
  const regions = source.map(normalizeBounds).sort(compareBounds);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let left = 0; left < regions.length; left++) {
      for (let right = left + 1; right < regions.length; right++) {
        if (!boundsTouch(regions[left]!, regions[right]!)) continue;
        const merged = unionBounds(regions[left]!, regions[right]!);
        if (boundsArea(merged) > maximumArea) continue;
        regions.splice(right, 1);
        regions.splice(left, 1, merged);
        regions.sort(compareBounds);
        changed = true;
        break outer;
      }
    }
  }

  while (regions.length > maximumRegions) {
    let selected: { left: number; right: number; merged: NPCNavigationBounds; growth: number } | null =
      null;
    for (let left = 0; left < regions.length; left++) {
      for (let right = left + 1; right < regions.length; right++) {
        const merged = unionBounds(regions[left]!, regions[right]!);
        const area = boundsArea(merged);
        if (area > maximumArea) continue;
        const growth = area - boundsArea(regions[left]!) - boundsArea(regions[right]!);
        if (!selected || growth < selected.growth || (growth === selected.growth &&
            compareBounds(merged, selected.merged) < 0)) {
          selected = { left, right, merged, growth };
        }
      }
    }
    if (!selected) {
      throw new Error(
        `NPC navigation requires ${regions.length} prepared regions; cannot compact to ` +
        `${maximumRegions} within area ${maximumArea}`,
      );
    }
    regions.splice(selected.right, 1);
    regions.splice(selected.left, 1, selected.merged);
    regions.sort(compareBounds);
  }
  return regions;
}

function normalizeBounds(bounds: NPCNavigationBounds): NPCNavigationBounds {
  return {
    minX: Math.floor(Math.min(bounds.minX, bounds.maxX)),
    minY: Math.floor(Math.min(bounds.minY, bounds.maxY)),
    maxX: Math.floor(Math.max(bounds.minX, bounds.maxX)),
    maxY: Math.floor(Math.max(bounds.minY, bounds.maxY)),
  };
}

function boundsTouch(left: NPCNavigationBounds, right: NPCNavigationBounds): boolean {
  return left.minX <= right.maxX + 1 && left.maxX + 1 >= right.minX &&
    left.minY <= right.maxY + 1 && left.maxY + 1 >= right.minY;
}

function unionBounds(left: NPCNavigationBounds, right: NPCNavigationBounds): NPCNavigationBounds {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  };
}

function boundsArea(bounds: NPCNavigationBounds): number {
  return (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);
}

function compareBounds(left: NPCNavigationBounds, right: NPCNavigationBounds): number {
  return left.minY - right.minY || left.minX - right.minX ||
    left.maxY - right.maxY || left.maxX - right.maxX;
}
