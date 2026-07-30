import type { RegionalWorldTileProvider } from '@maldoror/world';
import type { NPCLifeWorkplace } from './npc-life-simulation.js';
import type { NPCNavigationBounds } from './npc-navigation-bounds.js';

const MAXIMUM_FRONTAGE_ACCESS_LENGTH = 10;

/**
 * Project manifest-semantic waterfront placements into embodied workplaces.
 * The first access-path cell is the declared doorway; the provider has already
 * proved that the complete path is dry, walkable, collision-free, and reaches
 * the same continuous quay. No asset ID, filename, or pixel inference enters
 * this selection.
 */
export function collectRegionalLifeWorkplaces(
  world: Pick<RegionalWorldTileProvider, 'getAmbientPlacementsInBounds'>,
  bounds: readonly NPCNavigationBounds[],
): NPCLifeWorkplace[] {
  const workplaces = new Map<string, NPCLifeWorkplace>();
  for (const region of bounds) {
    const placements = world.getAmbientPlacementsInBounds(
      region.minX - MAXIMUM_FRONTAGE_ACCESS_LENGTH,
      region.minY - MAXIMUM_FRONTAGE_ACCESS_LENGTH,
      region.maxX + MAXIMUM_FRONTAGE_ACCESS_LENGTH,
      region.maxY + MAXIMUM_FRONTAGE_ACCESS_LENGTH,
    );
    for (const placement of placements) {
      const doorway = placement.quayAccessPath?.[0];
      if (placement.waterfrontFunction === undefined || doorway === undefined ||
          !Number.isInteger(doorway[0]) || !Number.isInteger(doorway[1])) continue;
      const id = `${placement.waterfrontId ?? 'waterfront'}:${placement.assetId}` +
        `@${placement.anchorX},${placement.anchorY}`;
      workplaces.set(id, Object.freeze({ id, x: doorway[0], y: doorway[1] }));
    }
  }
  return [...workplaces.values()].sort((left, right) => (
    left.id.localeCompare(right.id) || left.y - right.y || left.x - right.x
  ));
}
