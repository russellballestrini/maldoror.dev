import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RegionalPackedPreparedViewport } from '@maldoror/world';
import { packRegionalPreparedViewport } from '../game/regional-prewarm-packer.js';
import {
  REGIONAL_BUILD_PREWARM_SPECS,
  parseRegionalRuntimeBuildConfig,
} from '../game/regional-runtime-config.js';
import { buildRegionalRuntimeAssetPack } from '../game/regional-runtime-asset-pack.js';
import { writeRegionalRuntimePrewarmBundle } from '../game/regional-runtime-prewarm.js';
import {
  defaultRegionalWorldAssetPaths,
  loadRegionalWorldKit,
} from '../game/regional-world-provider.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const assets = defaultRegionalWorldAssetPaths(root);
const runtimeCode = await runtimeCodeDigest(root);
const assetPack = await buildRegionalRuntimeAssetPack(
  assets,
  assets.runtimePack,
  runtimeCode.digest,
);
const runtimeConfigPath = path.join(root, 'assets/runtime-world.json');
const runtimeConfig = parseRegionalRuntimeBuildConfig(
  JSON.parse(await fs.promises.readFile(runtimeConfigPath, 'utf8')) as unknown,
);
const viewports: RegionalPackedPreparedViewport[] = [];
const viewportBuilds = [];
for (const worldSeed of runtimeConfig.prewarmWorldSeeds) {
  const kit = await loadRegionalWorldKit({ worldSeed: BigInt(worldSeed), assets });
  if (kit.assetLoad.source !== 'runtime-pack' ||
      kit.assetLoad.sourceDigest !== assetPack.sourceDigest ||
      kit.assetLoad.runtimeDigest !== assetPack.runtimeDigest) {
    throw new Error('Regional origin build did not consume the just-built runtime asset pack');
  }
  const world = kit.createSessionWorld();
  try {
    for (const spec of REGIONAL_BUILD_PREWARM_SPECS) {
      const startedAt = performance.now();
      const prepared = world.prepareViewport(
        spec.bounds.minX,
        spec.bounds.minY,
        spec.bounds.maxX,
        spec.bounds.maxY,
        spec.resolution,
      );
      const viewport = packRegionalPreparedViewport(prepared);
      viewports.push(viewport);
      viewportBuilds.push({
        id: spec.id,
        worldSeed,
        bounds: viewport.bounds,
        resolution: viewport.resolution,
        terrainTiles: (viewport.bounds.maxX - viewport.bounds.minX + 1) *
          (viewport.bounds.maxY - viewport.bounds.minY + 1),
        overlayTiles: viewport.overlayCoordinates.length / 2,
        generationMs: Number((performance.now() - startedAt).toFixed(3)),
      });
    }
  } finally {
    world.destroy();
    kit.clearSharedCaches();
  }
}
const runtimePrewarm = await writeRegionalRuntimePrewarmBundle(assets.runtimePrewarm, {
  schemaVersion: 1,
  runtimeDigest: assetPack.runtimeDigest,
  assetManifestDigest: assetPack.manifestDigest,
  assetSourceDigest: assetPack.sourceDigest,
  viewports,
});
const reportPath = `${assetPack.destination}.json`;
const report = {
  schemaVersion: 2,
  manifestDigest: assetPack.manifestDigest,
  sourceDigest: assetPack.sourceDigest,
  runtimeDigest: assetPack.runtimeDigest,
  runtimeCodeFiles: runtimeCode.files,
  sourceFiles: assetPack.sourceFiles,
  packedBytes: assetPack.packedBytes,
  loadMs: Number(assetPack.loadMs.toFixed(3)),
  encodeMs: Number(assetPack.encodeMs.toFixed(3)),
  runtimePrewarm: {
    destination: runtimePrewarm.destination,
    packedBytes: runtimePrewarm.packedBytes,
    encodeMs: Number(runtimePrewarm.encodeMs.toFixed(3)),
    viewports: runtimePrewarm.viewports,
    builds: viewportBuilds,
  },
};
await atomicJson(reportPath, report);
console.log(
  `[RegionalAssets] Built ${assetPack.packedBytes} byte runtime pack from ` +
  `${assetPack.sourceFiles} source files and ${runtimePrewarm.packedBytes} byte ` +
  `origin prewarm with ${runtimePrewarm.viewports} viewport(s)`,
);

async function runtimeCodeDigest(
  repoRoot: string,
): Promise<{ digest: string; files: number }> {
  const roots = [
    path.join(repoRoot, 'packages/world/src'),
    path.join(repoRoot, 'packages/render/src'),
    path.join(repoRoot, 'apps/ssh-world/src'),
  ];
  const files = [
    ...(await Promise.all(roots.map((directory) => typescriptFiles(directory)))).flat(),
    path.join(repoRoot, 'packages/world/package.json'),
    path.join(repoRoot, 'packages/render/package.json'),
    path.join(repoRoot, 'apps/ssh-world/package.json'),
    path.join(repoRoot, 'pnpm-lock.yaml'),
  ].sort((left, right) => left.localeCompare(right));
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const relative = path.relative(repoRoot, file);
    const contents = await fs.promises.readFile(file);
    hash.update(relative);
    hash.update('\0');
    hash.update(String(contents.length));
    hash.update('\0');
    hash.update(contents);
    hash.update('\0');
  }
  return { digest: hash.digest('hex'), files: files.length };
}

async function typescriptFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await typescriptFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(file);
  }
  return result;
}

async function atomicJson(destination: string, value: unknown): Promise<void> {
  const temporary = `${destination}.tmp-${process.pid}`;
  await fs.promises.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.promises.rename(temporary, destination);
}
