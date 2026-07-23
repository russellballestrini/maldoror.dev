import { describe, expect, it } from 'vitest';
import { CanalTownWorldField } from '../tiles/canal-town-world-field.js';

describe('CanalTownWorldField', () => {
  it('is deterministic across signed coordinates without a short modulo repeat', () => {
    const a = new CanalTownWorldField(42n);
    const b = new CanalTownWorldField(42n);
    for (const [x, y] of [[-201, -97], [-24, 8], [0, 0], [17, -63], [244, 173]] as const) {
      expect(a.sample(x, y)).toEqual(b.sample(x, y));
    }

    const signatures = new Set<number>();
    for (let offset = 0; offset < 8; offset++) {
      let signature = 0;
      for (let y = -12; y <= 12; y += 3) {
        for (let x = -12; x <= 12; x += 3) {
          const sample = a.sample(x + offset * 24, y + offset * 24);
          const quantizedDistance = Math.round(Math.max(-12, Math.min(12, sample.waterDistance)) * 4);
          signature = Math.imul(
            signature ^ quantizedDistance ^ Number(sample.isWater) << 7 ^ Number(sample.isGarden) << 8,
            16777619,
          );
        }
      }
      signatures.add(signature >>> 0);
    }
    expect(signatures.size).toBe(8);
  });

  it('authors a walkable origin crossing from the same water and route field', () => {
    const field = new CanalTownWorldField(42n);
    expect(field.sample(0, 0).isWater).toBe(false);
    expect(field.sample(0, 0).isBridge).toBe(false);
    expect(field.sample(0, 0).isPlaza).toBe(true);
    expect(field.sample(-8, 0).routeDistance).toBeLessThan(1.5);
    expect(field.sample(8, 0).routeDistance).toBeLessThan(1.5);
  });

  it('keeps the major river continuous while varying its centre and width', () => {
    const field = new CanalTownWorldField(8801799478018485n);
    const centres: number[] = [];
    for (let y = -240; y <= 240; y += 12) {
      let bestX = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let x = -24; x <= 24; x++) {
        const distance = Math.abs(field.sample(x, y).waterDistance);
        if (field.sample(x, y).waterDistance <= 0 && distance < bestDistance) {
          bestX = x;
          bestDistance = distance;
        }
      }
      expect(bestDistance).toBeLessThan(Number.POSITIVE_INFINITY);
      centres.push(bestX);
    }
    expect(new Set(centres).size).toBeGreaterThan(5);
  });
});
