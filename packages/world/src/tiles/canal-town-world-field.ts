import { spatialHash2DUnit, spatialHash2DUint32 } from '../spatial-hash.js';

export interface CanalTownWorldSample {
  /** Signed distance in world tiles: negative is water, positive is land. */
  waterDistance: number;
  routeDistance: number;
  isWater: boolean;
  isBridge: boolean;
  isPlaza: boolean;
  isGarden: boolean;
}

/**
 * Continuous, deterministic hierarchy for the canal town's large shapes.
 *
 * Major rivers are sparse, independently warped features. Tributaries are
 * attached at deterministic basin-scale intervals. Bank walks and much sparser
 * cross-town routes are derived from the same field, so terrain, crossings,
 * collision, and later parcel placement can share one semantic answer. No
 * modulo-sized visual block is stamped into the world.
 */
export class CanalTownWorldField {
  private readonly seed32: number;
  private readonly riverSpacing: number;
  private readonly basinHeight: number;
  private readonly routeSpacing: number;

  constructor(
    worldSeed: bigint,
    config: { riverSpacing?: number; basinHeight?: number; routeSpacing?: number } = {},
  ) {
    this.seed32 = Number(BigInt.asUintN(32, worldSeed));
    this.riverSpacing = Math.max(96, config.riverSpacing ?? 176);
    this.basinHeight = Math.max(72, config.basinHeight ?? 112);
    this.routeSpacing = Math.max(56, config.routeSpacing ?? 88);
  }

  sample(worldX: number, worldY: number): CanalTownWorldSample {
    const riverIndex = Math.round(worldX / this.riverSpacing);
    let waterDistance = Number.POSITIVE_INFINITY;
    for (let offset = -1; offset <= 1; offset++) {
      const index = riverIndex + offset;
      waterDistance = Math.min(
        waterDistance,
        this.majorRiverDistance(worldX, worldY, index),
        this.tributaryDistance(worldX, worldY, index),
      );
    }

    // The canonical arrival is a singular river island, not a plaza-coloured
    // patch painted over the river. Split the origin river into two branches
    // around a dry central causeway, then merge them continuously back into
    // the same procedural channel upstream and downstream. A broad spatial
    // blend keeps this landmark compatible with the unbounded hierarchy.
    waterDistance = this.arrivalForkDistance(worldX, worldY, waterDistance);

    const bankRouteDistance = Math.abs(waterDistance - 2.8);
    const crossRouteDistance = this.crossRouteDistance(worldX, worldY);
    const routeDistance = Math.min(bankRouteDistance, crossRouteDistance);
    const isPlaza = Math.hypot(worldX, worldY) <= 2.8 ||
      (Math.abs(worldY) <= 1.35 && Math.abs(worldX) <= 10);
    const isWater = waterDistance <= 0 && !isPlaza;
    const isBridge = isWater && crossRouteDistance <= 1.45;
    const region = this.fbm(worldX * 0.021, worldY * 0.021, 0x5b31);
    const gardenDetail = this.fbm(worldX * 0.055, worldY * 0.055, 0x7f4a);
    const isGarden = !isWater && !isPlaza && routeDistance > 4.5 && waterDistance > 3.5 &&
      region + gardenDetail * 0.28 > 0.61;

    return { waterDistance, routeDistance, isWater, isBridge, isPlaza, isGarden };
  }

  private arrivalForkDistance(worldX: number, worldY: number, proceduralDistance: number): number {
    const absoluteY = Math.abs(worldY);
    const absoluteX = Math.abs(worldX);
    if (absoluteY >= 22 || absoluteX >= 28) return proceduralDistance;

    const merge = smoothstep01((absoluteY - 11) / 11);
    const branchOffset = 5.9 * (1 - merge);
    // Keep the designed arrival frame centred; inherit the river's procedural
    // meander only while the split branches merge back into the world field.
    const centre = this.majorRiverCentre(0, worldY) * merge;
    const proceduralWidth = 3.2 + this.valueNoise(worldY * 0.031, 0, 0x13d7) * 2.1;
    const branchWidth = lerp(3.55, proceduralWidth, merge);
    const forkDistance = Math.min(
      Math.abs(worldX - (centre - branchOffset)) - branchWidth,
      Math.abs(worldX - (centre + branchOffset)) - branchWidth,
    );
    const verticalBlend = lerp(forkDistance, proceduralDistance, merge);
    const outerBlend = smoothstep01((absoluteX - 20) / 8);
    return lerp(verticalBlend, proceduralDistance, outerBlend);
  }

  private majorRiverDistance(worldX: number, worldY: number, index: number): number {
    const centre = this.majorRiverCentre(index, worldY);
    const widthNoise = this.valueNoise(worldY * 0.031, index * 0.77, 0x13d7);
    const width = 3.2 + widthNoise * 2.1;
    return Math.abs(worldX - centre) - width;
  }

  private majorRiverCentre(index: number, worldY: number): number {
    const jitter = index === 0 ? 0 : (this.hashUnit(index, 0, 0x2c11) - 0.5) * 56;
    const phaseA = this.hashUnit(index, 0, 0x421d) * Math.PI * 2;
    const phaseB = this.hashUnit(index, 0, 0x91b3) * Math.PI * 2;
    const wave = Math.sin(worldY / 31 + phaseA) * 8.5 + Math.sin(worldY / 67 + phaseB) * 6.5;
    // The origin river is authored through (0,0) while retaining the same
    // continuous function everywhere else.
    const originCorrection = index === 0
      ? Math.sin(phaseA) * 8.5 + Math.sin(phaseB) * 6.5
      : 0;
    return index * this.riverSpacing + jitter + wave - originCorrection;
  }

  private tributaryDistance(worldX: number, worldY: number, riverIndex: number): number {
    const basinIndex = Math.round(worldY / this.basinHeight);
    let nearest = Number.POSITIVE_INFINITY;
    for (let offset = -1; offset <= 1; offset++) {
      const basin = basinIndex + offset;
      const confluenceY = this.tributaryConfluenceY(riverIndex, basin);
      const direction = this.hash(riverIndex, basin, 0x82a7) % 2 === 0 ? -1 : 1;
      const riverX = this.majorRiverCentre(riverIndex, confluenceY);
      const reach = 38 + this.hashUnit(riverIndex, basin, 0x19e1) * 42;
      const along = direction * (worldX - riverX);
      if (along < -3 || along > reach) continue;
      const bend = Math.sin(along / 13 + this.hashUnit(riverIndex, basin, 0x4c73) * 5) * 5;
      const centreY = confluenceY + bend * smoothstep01(along / Math.max(1, reach));
      const width = 2.2 + this.hashUnit(riverIndex, basin, 0x6a0d) * 1.4;
      const endTaper = smoothstep01((reach - along) / 10);
      nearest = Math.min(nearest, Math.abs(worldY - centreY) - width * endTaper);
    }
    return nearest;
  }

  private tributaryConfluenceY(riverIndex: number, basinIndex: number): number {
    // Keep the canonical arrival clear: its two nearest tributaries frame the
    // place instead of collapsing into a starburst under the player.
    if (riverIndex === 0 && basinIndex === 0) return -8;
    const jitter = (this.hashUnit(riverIndex, basinIndex, 0xb253) - 0.5) * 48;
    return basinIndex * this.basinHeight + jitter;
  }

  private crossRouteDistance(worldX: number, worldY: number): number {
    const routeIndex = Math.round(worldY / this.routeSpacing);
    let nearest = Number.POSITIVE_INFINITY;
    for (let offset = -1; offset <= 1; offset++) {
      const index = routeIndex + offset;
      const base = index === 0
        ? 0
        : index * this.routeSpacing + (this.hashUnit(index, 0, 0xe12b) - 0.5) * 28;
      const phase = this.hashUnit(index, 0, 0x724f) * Math.PI * 2;
      const wave = Math.sin(worldX / 41 + phase) * 4.2 - Math.sin(phase) * (index === 0 ? 4.2 : 0);
      nearest = Math.min(nearest, Math.abs(worldY - (base + wave)));
    }
    // A second crossing frames the canonical arrival above the plaza. It is a
    // singular landmark constraint, not a repeating short-period road.
    if (Math.abs(worldX) <= 22) nearest = Math.min(nearest, Math.abs(worldY + 6));
    return nearest;
  }

  private fbm(x: number, y: number, salt: number): number {
    let value = 0;
    let amplitude = 0.55;
    let normalizer = 0;
    for (let octave = 0; octave < 4; octave++) {
      value += this.valueNoise(x, y, salt + octave * 0x117) * amplitude;
      normalizer += amplitude;
      x *= 2.03;
      y *= 2.03;
      amplitude *= 0.5;
    }
    return value / normalizer;
  }

  private valueNoise(x: number, y: number, salt: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smoothstep01(x - x0);
    const ty = smoothstep01(y - y0);
    const a = this.hashUnit(x0, y0, salt);
    const b = this.hashUnit(x0 + 1, y0, salt);
    const c = this.hashUnit(x0, y0 + 1, salt);
    const d = this.hashUnit(x0 + 1, y0 + 1, salt);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  }

  private hashUnit(x: number, y: number, salt: number): number {
    return spatialHash2DUnit(this.seed32, x, y, salt);
  }

  private hash(x: number, y: number, salt: number): number {
    return spatialHash2DUint32(this.seed32, x, y, salt);
  }
}

function smoothstep01(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
