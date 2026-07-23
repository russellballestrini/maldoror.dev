import type { Tile } from '@maldoror/protocol';

export interface CornerCodedTileSetConfig {
  worldSeed: bigint;
  cornerColours: number;
  tilesByCombination: readonly (readonly Tile[])[];
  salt?: number;
}

export interface CornerTileAddress {
  corners: readonly [number, number, number, number];
  combination: number;
  variant: number;
}

/**
 * Deterministic corner-coded stochastic tiling.
 *
 * Every lattice vertex owns one hashed colour. A tile is addressed by its
 * NW/NE/SW/SE colours, so adjacent cells necessarily select atlas families
 * with the same two colours on their shared edge. Multiple quilted interiors
 * per combination break the remaining short-period repetition without runtime
 * synthesis or an unbounded cache.
 */
export class CornerCodedTileSet {
  private readonly seed32: number;
  private readonly cornerColours: number;
  private readonly combinations: number;
  private readonly tilesByCombination: readonly (readonly Tile[])[];
  private readonly salt: number;

  constructor(config: CornerCodedTileSetConfig) {
    this.seed32 = Number(BigInt.asUintN(32, config.worldSeed));
    this.cornerColours = Math.floor(config.cornerColours);
    this.combinations = Math.pow(this.cornerColours, 4);
    this.tilesByCombination = config.tilesByCombination;
    this.salt = config.salt ?? 0x6a09e667;
    if (this.cornerColours < 2 || this.cornerColours > 8) {
      throw new Error('CornerCodedTileSet cornerColours must be between 2 and 8');
    }
    if (config.tilesByCombination.length !== this.combinations ||
        config.tilesByCombination.some((tiles) => tiles.length === 0)) {
      throw new Error(
        `CornerCodedTileSet requires ${this.combinations} non-empty combinations`,
      );
    }
  }

  getTile(tileX: number, tileY: number): Tile {
    const address = this.getAddress(tileX, tileY);
    return this.tilesByCombination[address.combination]![address.variant]!;
  }

  getAddress(tileX: number, tileY: number): CornerTileAddress {
    const nw = this.cornerAt(tileX, tileY);
    const ne = this.cornerAt(tileX + 1, tileY);
    const sw = this.cornerAt(tileX, tileY + 1);
    const se = this.cornerAt(tileX + 1, tileY + 1);
    const combination = nw +
      ne * this.cornerColours +
      sw * this.cornerColours ** 2 +
      se * this.cornerColours ** 3;
    const variants = this.tilesByCombination[combination]!;
    const variant = this.hash(tileX, tileY, this.salt ^ 0xbb67ae85) % variants.length;
    return { corners: [nw, ne, sw, se], combination, variant };
  }

  getStats(): { cornerColours: number; combinations: number; totalTiles: number } {
    return {
      cornerColours: this.cornerColours,
      combinations: this.combinations,
      totalTiles: this.tilesByCombination.reduce((sum, tiles) => sum + tiles.length, 0),
    };
  }

  private cornerAt(x: number, y: number): number {
    return this.hash(x, y, this.salt) % this.cornerColours;
  }

  private hash(x: number, y: number, salt: number): number {
    let value = (this.seed32 ^ salt) | 0;
    value = Math.imul(value ^ x, 0x45d9f3b);
    value = Math.imul(value ^ y, 0x119de1f3);
    value ^= value >>> 16;
    return value >>> 0;
  }
}
