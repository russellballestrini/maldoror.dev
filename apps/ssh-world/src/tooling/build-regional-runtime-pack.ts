import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildRegionalRuntimeAssetPack,
} from '../game/regional-runtime-asset-pack.js';
import { defaultRegionalWorldAssetPaths } from '../game/regional-world-provider.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const assets = defaultRegionalWorldAssetPaths(root);
const result = await buildRegionalRuntimeAssetPack(assets, assets.runtimePack);
const reportPath = `${result.destination}.json`;
await fs.promises.writeFile(reportPath, `${JSON.stringify({
  schemaVersion: 1,
  manifestDigest: result.manifestDigest,
  sourceDigest: result.sourceDigest,
  sourceFiles: result.sourceFiles,
  packedBytes: result.packedBytes,
  loadMs: Number(result.loadMs.toFixed(3)),
  encodeMs: Number(result.encodeMs.toFixed(3)),
}, null, 2)}\n`);
console.log(
  `[RegionalAssets] Built ${result.packedBytes} byte runtime pack from ` +
  `${result.sourceFiles} source files`,
);
