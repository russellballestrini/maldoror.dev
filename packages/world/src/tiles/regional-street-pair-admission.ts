/** Order-independent admission for complete optional street pairs.
 *
 * Runtime cache blocks are consumers of this decision, never its owners. A
 * candidate contains both authored sides, their complete visible-halo cells,
 * and semantic visual groups. Selection is a bounded local-priority
 * independent set: a candidate wins exactly when no conflicting candidate
 * outranks it. */

export const REGIONAL_STREET_PAIR_OWNERSHIP_CELL_SIZE = 64;

export type RegionalStreetPairAdmissionKind = 'strict' | 'replacement';

export interface RegionalStreetPairCandidate {
  id: string;
  ownerSiteX: number;
  ownerSiteY: number;
  kind: RegionalStreetPairAdmissionKind;
  /** Coordinate-keyed value in [0, 1]. Higher wins. */
  priority: number;
  /** Complete pair footprint including the composition halo. */
  reservedCells: readonly string[];
  /** Manifest semantic silhouettes used anywhere in the owning place. */
  visualGroups: readonly string[];
}

export interface RegionalStreetPairOwnershipCell {
  cellX: number;
  cellY: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function regionalStreetPairOwnershipCell(
  worldX: number,
  worldY: number,
): RegionalStreetPairOwnershipCell {
  const cellX = Math.floor(worldX / REGIONAL_STREET_PAIR_OWNERSHIP_CELL_SIZE);
  const cellY = Math.floor(worldY / REGIONAL_STREET_PAIR_OWNERSHIP_CELL_SIZE);
  const minX = cellX * REGIONAL_STREET_PAIR_OWNERSHIP_CELL_SIZE;
  const minY = cellY * REGIONAL_STREET_PAIR_OWNERSHIP_CELL_SIZE;
  return {
    cellX,
    cellY,
    minX,
    minY,
    maxX: minX + REGIONAL_STREET_PAIR_OWNERSHIP_CELL_SIZE - 1,
    maxY: minY + REGIONAL_STREET_PAIR_OWNERSHIP_CELL_SIZE - 1,
  };
}

export function regionalStreetPairCandidatesConflict(
  first: RegionalStreetPairCandidate,
  second: RegionalStreetPairCandidate,
): boolean {
  if (first.ownerSiteX === second.ownerSiteX && first.ownerSiteY === second.ownerSiteY) {
    const secondGroups = new Set(second.visualGroups);
    if (first.visualGroups.some((group) => secondGroups.has(group))) return true;
  }
  const smaller = first.reservedCells.length <= second.reservedCells.length
    ? first.reservedCells
    : second.reservedCells;
  const larger = smaller === first.reservedCells ? second.reservedCells : first.reservedCells;
  const largerCells = new Set(larger);
  return smaller.some((cell) => largerCells.has(cell));
}

export function regionalStreetPairCandidateOutranks(
  first: RegionalStreetPairCandidate,
  second: RegionalStreetPairCandidate,
): boolean {
  if (first.kind !== second.kind) return first.kind === 'strict';
  return first.priority > second.priority ||
    (first.priority === second.priority && first.id < second.id);
}

/** Select one-pass local-priority winners, independent of traversal order.
 *
 * This is deliberately conservative rather than globally maximal: a candidate
 * is suppressed by every higher-ranked conflicting candidate, even when that
 * blocker is itself suppressed elsewhere. That makes the result a pure local
 * function without scheduler- or cache-order fixpoint iteration. */
export function selectRegionalCanonicalStreetPairs<Candidate extends RegionalStreetPairCandidate>(
  candidates: readonly Candidate[],
): Candidate[] {
  const unique = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (unique.has(candidate.id)) throw new Error(`Duplicate street-pair candidate: ${candidate.id}`);
    if (!Number.isFinite(candidate.priority) || candidate.priority < 0 || candidate.priority > 1) {
      throw new Error(`Invalid street-pair priority for ${candidate.id}: ${candidate.priority}`);
    }
    unique.set(candidate.id, candidate);
  }
  const ordered = [...unique.values()].sort((a, b) => (
    a.id === b.id ? 0 : a.id < b.id ? -1 : 1
  ));
  return ordered.filter((candidate) => !ordered.some((competitor) => (
    competitor !== candidate &&
    regionalStreetPairCandidatesConflict(candidate, competitor) &&
    regionalStreetPairCandidateOutranks(competitor, candidate)
  )));
}
