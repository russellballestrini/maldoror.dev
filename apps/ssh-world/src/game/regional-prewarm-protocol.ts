import type { RegionalPreparedViewportPayload } from '@maldoror/world';
import type { RegionalWorldAssetPaths } from './regional-world-provider.js';

export interface RegionalPrewarmWorkerOptions {
  worldSeed: string;
  assets: RegionalWorldAssetPaths;
}

export interface RegionalPrewarmBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RegionalPrewarmRequest {
  type: 'prepare';
  requestId: number;
  bounds: RegionalPrewarmBounds;
  resolution: number;
}

export interface RegionalPrewarmShutdownRequest {
  type: 'shutdown';
}

export type RegionalPrewarmWorkerRequest = RegionalPrewarmRequest | RegionalPrewarmShutdownRequest;

export interface RegionalPrewarmReadyResponse {
  type: 'ready';
  startupMs: number;
  rssMiB: number;
  assetSource: 'runtime-pack' | 'png-manifests';
  assetLoadMs: number;
  assetManifestDigest: string;
  assetSourceDigest: string | null;
  assetRuntimeDigest: string | null;
  generatorBakedViewports: number;
}

export interface RegionalPrewarmPreparedResponse {
  type: 'prepared';
  requestId: number;
  viewport: RegionalPreparedViewportPayload;
  generationMs: number;
  rssMiB: number;
}

export interface RegionalPrewarmErrorResponse {
  type: 'error';
  requestId?: number;
  message: string;
  stack?: string;
}

export type RegionalPrewarmWorkerResponse =
  | RegionalPrewarmReadyResponse
  | RegionalPrewarmPreparedResponse
  | RegionalPrewarmErrorResponse;
