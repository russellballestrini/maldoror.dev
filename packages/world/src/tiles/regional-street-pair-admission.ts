/** Order-independent admission for complete optional street pairs.
 *
 * Runtime cache blocks are consumers of this decision, never its owners. A
 * candidate contains both authored sides, their complete visible-halo cells,
 * and semantic visual groups. Selection is a bounded local-priority
 * independent set: a candidate wins exactly when no conflicting candidate
 * outranks it. */

export const REGIONAL_STREET_PAIR_OWNERSHIP_CELL_SIZE = 64;
export const REGIONAL_STREET_PAIR_MAX_EXTRA_SETBACK = 3;
export const REGIONAL_STREET_PAIR_SEARCH_NUDGE_COUNT = 7;
export const REGIONAL_STREET_PAIR_ALONG_SIDE_BIAS = 1.5;
export const REGIONAL_STREET_PAIR_CROSS_GAP = 0.9;
export const REGIONAL_STREET_PAIR_VISIBLE_HALO = 1;

export type RegionalStreetPairAdmissionKind = 'strict' | 'replacement';
export type RegionalStreetPairAxis = 'north-south' | 'east-west';

export interface RegionalStreetPairAnchorInput {
  axis: RegionalStreetPairAxis;
  side: -1 | 1;
  routeStartX: number;
  routeStartY: number;
  routeHalfWidth: number;
  spriteWidth: number;
  spriteHeight: number;
  spriteAnchorX: number;
  spriteAnchorY: number;
  extraSetback: number;
  nudgeIndex: number;
}

export interface RegionalStreetPairConservativeFootprintBound {
  minOffsetX: number;
  minOffsetY: number;
  maxOffsetX: number;
  maxOffsetY: number;
  maximumAxisReach: number;
  maximumEuclideanReach: number;
}

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

export interface RegionalStreetPairProtectedVisualGroup {
  ownerSiteX: number;
  ownerSiteY: number;
  visualGroup: string;
}

export interface RegionalStreetPairProtectedReservation {
  reservedCells: readonly string[];
  visualGroups: readonly RegionalStreetPairProtectedVisualGroup[];
}

export interface RegionalStreetPairOwnershipCell {
  cellX: number;
  cellY: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Exact route-relative anchor used by the production pair fitter. */
export function regionalStreetPairAnchor(input: RegionalStreetPairAnchorInput): {
  anchorX: number;
  anchorY: number;
} {
  if (!Number.isFinite(input.routeStartX) || !Number.isFinite(input.routeStartY) ||
      !Number.isFinite(input.routeHalfWidth) || input.routeHalfWidth < 0 ||
      !Number.isInteger(input.spriteWidth) || input.spriteWidth < 1 ||
      !Number.isInteger(input.spriteHeight) || input.spriteHeight < 1 ||
      !Number.isInteger(input.spriteAnchorX) || input.spriteAnchorX < 0 ||
      input.spriteAnchorX >= input.spriteWidth ||
      !Number.isInteger(input.spriteAnchorY) || input.spriteAnchorY < 0 ||
      input.spriteAnchorY >= input.spriteHeight ||
      !Number.isInteger(input.extraSetback) || input.extraSetback < 0 ||
      input.extraSetback > REGIONAL_STREET_PAIR_MAX_EXTRA_SETBACK ||
      !Number.isInteger(input.nudgeIndex) || input.nudgeIndex < 0 ||
      input.nudgeIndex >= REGIONAL_STREET_PAIR_SEARCH_NUDGE_COUNT) {
    throw new Error('Invalid regional street-pair anchor input');
  }
  const tangentX = input.axis === 'east-west' ? 1 : 0;
  const tangentY = input.axis === 'east-west' ? 0 : 1;
  const normalX = input.axis === 'east-west' ? 0 : 1;
  const normalY = input.axis === 'east-west' ? 1 : 0;
  const crossSpan = input.axis === 'east-west' ? input.spriteHeight : input.spriteWidth;
  const along = streetPairSymmetricSearchOffset(input.nudgeIndex) +
    input.side * REGIONAL_STREET_PAIR_ALONG_SIDE_BIAS;
  const across = input.side * (
    input.routeHalfWidth + crossSpan * 0.5 +
    REGIONAL_STREET_PAIR_CROSS_GAP + input.extraSetback
  );
  const centreX = input.routeStartX + tangentX * along + normalX * across;
  const centreY = input.routeStartY + tangentY * along + normalY * across;
  const relativeCentreX = (input.spriteWidth - 1) * 0.5 - input.spriteAnchorX;
  const relativeCentreY = (input.spriteHeight - 1) * 0.5 - input.spriteAnchorY;
  return {
    anchorX: Math.round(centreX - relativeCentreX),
    anchorY: Math.round(centreY - relativeCentreY),
  };
}

/** Full-rectangle upper bound over every production street-search position.
 * Transparent sprite cells are intentionally retained, making this a safe
 * manifest-wide bound rather than an observed visible-pixel measurement. */
export function regionalStreetPairConservativeFootprintBound(
  input: Omit<RegionalStreetPairAnchorInput, 'extraSetback' | 'nudgeIndex'>,
): RegionalStreetPairConservativeFootprintBound {
  const ownerX = Math.floor(input.routeStartX);
  const ownerY = Math.floor(input.routeStartY);
  let minOffsetX = Number.POSITIVE_INFINITY;
  let minOffsetY = Number.POSITIVE_INFINITY;
  let maxOffsetX = Number.NEGATIVE_INFINITY;
  let maxOffsetY = Number.NEGATIVE_INFINITY;
  for (let extraSetback = 0;
    extraSetback <= REGIONAL_STREET_PAIR_MAX_EXTRA_SETBACK; extraSetback++) {
    for (let nudgeIndex = 0;
      nudgeIndex < REGIONAL_STREET_PAIR_SEARCH_NUDGE_COUNT; nudgeIndex++) {
      const anchor = regionalStreetPairAnchor({ ...input, extraSetback, nudgeIndex });
      minOffsetX = Math.min(
        minOffsetX,
        anchor.anchorX - input.spriteAnchorX - REGIONAL_STREET_PAIR_VISIBLE_HALO - ownerX,
      );
      minOffsetY = Math.min(
        minOffsetY,
        anchor.anchorY - input.spriteAnchorY - REGIONAL_STREET_PAIR_VISIBLE_HALO - ownerY,
      );
      maxOffsetX = Math.max(
        maxOffsetX,
        anchor.anchorX + input.spriteWidth - input.spriteAnchorX - 1 +
          REGIONAL_STREET_PAIR_VISIBLE_HALO - ownerX,
      );
      maxOffsetY = Math.max(
        maxOffsetY,
        anchor.anchorY + input.spriteHeight - input.spriteAnchorY - 1 +
          REGIONAL_STREET_PAIR_VISIBLE_HALO - ownerY,
      );
    }
  }
  const maximumXReach = Math.max(Math.abs(minOffsetX), Math.abs(maxOffsetX));
  const maximumYReach = Math.max(Math.abs(minOffsetY), Math.abs(maxOffsetY));
  return {
    minOffsetX,
    minOffsetY,
    maxOffsetX,
    maxOffsetY,
    maximumAxisReach: Math.max(maximumXReach, maximumYReach),
    maximumEuclideanReach: Math.hypot(maximumXReach, maximumYReach),
  };
}

export function regionalStreetPairConflictNeighbourReach(maximumAxisReach: number): number {
  if (!Number.isFinite(maximumAxisReach) || maximumAxisReach < 0) {
    throw new Error(`Invalid regional street-pair footprint reach: ${maximumAxisReach}`);
  }
  return maximumAxisReach === 0
    ? 0
    : Math.floor(
      Math.max(0, maximumAxisReach * 2 - 1) /
      REGIONAL_STREET_PAIR_OWNERSHIP_CELL_SIZE,
    ) + 1;
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

/** Protected meso/civic geometry is immutable input to pair validity. It is
 * intentionally separate from pair-pair conflict selection so optional detail
 * can never evict an established composition. */
export function regionalStreetPairCandidateConflictsWithProtectedReservation(
  candidate: RegionalStreetPairCandidate,
  reservation: RegionalStreetPairProtectedReservation,
): boolean {
  const protectedCells = new Set(reservation.reservedCells);
  if (candidate.reservedCells.some((cell) => protectedCells.has(cell))) return true;
  const candidateGroups = new Set(candidate.visualGroups);
  return reservation.visualGroups.some((entry) => (
    entry.ownerSiteX === candidate.ownerSiteX &&
    entry.ownerSiteY === candidate.ownerSiteY &&
    candidateGroups.has(entry.visualGroup)
  ));
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

function streetPairSymmetricSearchOffset(index: number): number {
  if (index <= 0) return 0;
  const magnitude = Math.ceil(index / 2);
  return index % 2 === 1 ? -magnitude : magnitude;
}
