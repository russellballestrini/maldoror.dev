import { describe, expect, it } from 'vitest';
import { parseAcceptanceRuntimeManifest } from '../acceptance/manifest.js';

const SESSION = {
  fixtureId: 'origin--walking',
  fingerprintSha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  userId: 'c48b92c5-bffa-47a8-a6e5-897e8f28a05a',
  username: 'atlas-origin-walking',
  restoredState: {
    playerX: 0,
    playerY: 0,
    zoomLevel: 30,
    renderMode: 'octant',
    cameraMode: 'follow',
  },
};

describe('acceptance runtime manifest', () => {
  it('accepts an explicit deterministic fixture', () => {
    expect(parseAcceptanceRuntimeManifest({
      schemaVersion: 1,
      atlasVersion: 'acceptance-atlas-v1',
      worldSeed: '8801799478018485',
      sessions: [SESSION],
    })).toEqual(expect.objectContaining({
      worldSeed: 8801799478018485n,
      sessions: [expect.objectContaining({ fixtureId: 'origin--walking' })],
    }));
  });

  it('rejects duplicate identities and out-of-range zooms', () => {
    expect(() => parseAcceptanceRuntimeManifest({
      schemaVersion: 1,
      atlasVersion: 'acceptance-atlas-v1',
      worldSeed: '8801799478018485',
      sessions: [SESSION, { ...SESSION, fixtureId: 'other' }],
    })).toThrow(/fingerprintSha256 must be unique/);
    expect(() => parseAcceptanceRuntimeManifest({
      schemaVersion: 1,
      atlasVersion: 'acceptance-atlas-v1',
      worldSeed: '8801799478018485',
      sessions: [{ ...SESSION, restoredState: { ...SESSION.restoredState, zoomLevel: 101 } }],
    })).toThrow(/zoomLevel must be between 0 and 100/);
  });
});
