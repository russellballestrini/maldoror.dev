export type NPCWorldCollisionChecker = (x: number, y: number) => boolean;

/** Select exactly one terrain authority. The legacy generator is evaluated
 * lazily so a regional runtime cannot accidentally consult both worlds. */
export function resolveNPCWorldCollision(
  checker: NPCWorldCollisionChecker | null,
  legacyWalkable: () => boolean,
  x: number,
  y: number,
): boolean {
  return checker ? checker(x, y) : !legacyWalkable();
}
