import { readFileSync } from 'node:fs';
import type { AcceptanceSSHSession } from '../server/ssh-server.js';

export interface AcceptanceRuntimeSession extends AcceptanceSSHSession {
  fixtureId: string;
  fingerprintSha256: string;
}

export interface AcceptanceRuntimeManifest {
  schemaVersion: 1;
  atlasVersion: string;
  worldSeed: bigint;
  sessions: AcceptanceRuntimeSession[];
}

export function loadAcceptanceRuntimeManifest(path: string): AcceptanceRuntimeManifest {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  return parseAcceptanceRuntimeManifest(parsed);
}

export function parseAcceptanceRuntimeManifest(value: unknown): AcceptanceRuntimeManifest {
  const root = object(value, 'manifest');
  exact(root.schemaVersion, 1, 'manifest.schemaVersion');
  const atlasVersion = string(root.atlasVersion, 'manifest.atlasVersion');
  const worldSeedText = string(root.worldSeed, 'manifest.worldSeed');
  if (!/^[0-9]+$/.test(worldSeedText)) fail('manifest.worldSeed must be an unsigned integer string');
  const worldSeed = BigInt(worldSeedText);
  if (!Array.isArray(root.sessions) || root.sessions.length === 0) {
    fail('manifest.sessions must contain at least one fixture');
  }

  const fixtureIds = new Set<string>();
  const fingerprints = new Set<string>();
  const userIds = new Set<string>();
  const sessions = root.sessions.map((entry, index) => {
    const label = `manifest.sessions[${index}]`;
    const session = object(entry, label);
    const fixtureId = string(session.fixtureId, `${label}.fixtureId`);
    const fingerprintSha256 = string(
      session.fingerprintSha256,
      `${label}.fingerprintSha256`,
    );
    const userId = string(session.userId, `${label}.userId`);
    const username = string(session.username, `${label}.username`);
    if (!/^[A-Za-z0-9+/]{43}$/.test(fingerprintSha256)) {
      fail(`${label}.fingerprintSha256 must be an unpadded SHA-256 fingerprint`);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      fail(`${label}.userId must be a version-4 UUID`);
    }
    if (username.length > 32) fail(`${label}.username exceeds the database limit`);
    unique(fixtureIds, fixtureId, `${label}.fixtureId`);
    unique(fingerprints, fingerprintSha256, `${label}.fingerprintSha256`);
    unique(userIds, userId, `${label}.userId`);

    const restored = object(session.restoredState, `${label}.restoredState`);
    const playerX = integer(restored.playerX, `${label}.restoredState.playerX`);
    const playerY = integer(restored.playerY, `${label}.restoredState.playerY`);
    const zoomLevel = number(restored.zoomLevel, `${label}.restoredState.zoomLevel`);
    if (zoomLevel < 0 || zoomLevel > 100) {
      fail(`${label}.restoredState.zoomLevel must be between 0 and 100`);
    }
    const renderMode = oneOf(
      restored.renderMode,
      ['normal', 'halfblock', 'braille', 'octant'],
      `${label}.restoredState.renderMode`,
    );
    const cameraMode = oneOf(
      restored.cameraMode,
      ['follow', 'free'],
      `${label}.restoredState.cameraMode`,
    );

    return {
      fixtureId,
      fingerprintSha256,
      userId,
      username,
      restoredState: { playerX, playerY, zoomLevel, renderMode, cameraMode },
    };
  });

  return { schemaVersion: 1, atlasVersion, worldSeed, sessions };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) fail(`${label} must be a safe integer`);
  return value as number;
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be finite`);
  return value;
}

function exact(value: unknown, expected: unknown, label: string): void {
  if (value !== expected) fail(`${label} must equal ${String(expected)}`);
}

function oneOf<const T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    fail(`${label} must be one of ${choices.join(', ')}`);
  }
  return value as T;
}

function unique(values: Set<string>, value: string, label: string): void {
  if (values.has(value)) fail(`${label} must be unique`);
  values.add(value);
}

function fail(message: string): never {
  throw new Error(`Invalid acceptance runtime manifest: ${message}`);
}
