/**
 * Exact baseline/candidate oracle for the arrival-market access contract.
 *
 * Both worlds use the same production manifests and provider configuration.
 * The baseline removes only the candidate `quayAccessOffset`; the candidate
 * retains the loaded manifest. Timings are intentionally absent because this
 * is a visual-placement and physical-topology proof, not a benchmark.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  loadRegionalAmbientKit,
  loadRegionalBiomeMaterialKit,
  loadRegionalCivicDetailKit,
  loadRegionalEnvironmentContactKit,
  loadRegionalLandmarkKit,
  loadRegionalParcelComponentKit,
  loadRegionalQuayDetailKit,
  loadRegionalRouteContactKit,
  loadRegionalRouteMaterialKit,
} from '../../apps/ssh-world/dist/game/biome-assets.js';
import {
  defaultRegionalWorldAssetPaths,
  REGIONAL_AMBIENT_COMPOSITION_PROFILE,
  REGIONAL_AMBIENT_DISTRIBUTION_PROFILE,
  REGIONAL_AMBIENT_PLACE_ACCESS_PROFILE,
  REGIONAL_AMBIENT_PLACE_FABRIC_PROFILE,
} from '../../apps/ssh-world/dist/game/regional-world-provider.js';
import { ViewportRenderer } from '../../packages/render/dist/pixel/viewport-renderer.js';
import {
  BiomeWorldField,
  CANAL_TOWN_ARRIVAL_CIVIC_BRANCHES,
  CANAL_TOWN_QUAY_EDGE_VARIATION,
  REGIONAL_MATERIAL_TEXTURE_PROFILE,
  RegionalMaterialCompositor,
  RegionalRouteField,
  RegionalWorldDerivedCache,
  RegionalWorldTileProvider,
} from '../../packages/world/dist/index.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUTPUT = path.resolve(process.argv[2] ?? (
  '/mnt/donto-data/donto-resources/maldoror/living-world-research/' +
  'market-pavilion-access-v268'
));
const WORLD_SEED = 8801799478018485n;
const TARGET_ASSET_ID = 'canal-town-market-pavilion-parcel-component-v1';
const FRAME = { width: 320, height: 176, tileSize: 12, cameraX: -8, cameraY: -11 };
const BOUNDS = { minX: -32, minY: -32, maxX: 32, maxY: 32 };

await fs.mkdir(OUTPUT, { recursive: true });
const assets = defaultRegionalWorldAssetPaths(ROOT);
const [
  biomeKit,
  routeKit,
  landmarkKit,
  ambientKit,
  civicDetailKit,
  quayDetailKit,
  routeContactKit,
  parcelKit,
  environmentKit,
] = await Promise.all([
  loadRegionalBiomeMaterialKit(assets.biomeMaterials),
  loadRegionalRouteMaterialKit(assets.routeMaterials),
  loadRegionalLandmarkKit(assets.landmarks),
  loadRegionalAmbientKit(assets.ambient),
  loadRegionalCivicDetailKit(assets.civicDetails),
  loadRegionalQuayDetailKit(assets.quayDetails),
  loadRegionalRouteContactKit(assets.routeContacts),
  loadRegionalParcelComponentKit(assets.parcelComponents),
  loadRegionalEnvironmentContactKit(assets.environmentContacts),
]);
const candidateAsset = parcelKit.assets.find((asset) => asset.id === TARGET_ASSET_ID);
if (!candidateAsset?.quayAccessOffset) {
  throw new Error(`Candidate manifest has no quay access offset: ${TARGET_ASSET_ID}`);
}
const baselineAssets = parcelKit.assets.map((asset) => (
  asset.id === TARGET_ASSET_ID ? Object.freeze({ ...asset, quayAccessOffset: undefined }) : asset
));

const baseline = await capture('baseline', baselineAssets);
const candidate = await capture('candidate', parcelKit.assets);
const frameDifferencePixels = countFrameDifferences(baseline.frame, candidate.frame);
const report = {
  generatedAt: new Date().toISOString(),
  measurementKind: 'deterministic visual-placement and physical-topology parity; no timing',
  worldSeed: String(WORLD_SEED),
  candidate: {
    assetId: TARGET_ASSET_ID,
    quayAccessOffset: candidateAsset.quayAccessOffset,
  },
  frame: FRAME,
  bounds: BOUNDS,
  baseline: baseline.report,
  candidateResult: candidate.report,
  comparison: {
    visualPlacementsExact:
      baseline.report.visualPlacementHash === candidate.report.visualPlacementHash,
    physicalPlaneExact: baseline.report.physicalPlaneHash === candidate.report.physicalPlaneHash,
    framePixelsExact: baseline.report.frameHash === candidate.report.frameHash,
    frameDifferencePixels,
  },
};
await fs.writeFile(path.join(OUTPUT, 'parity-report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFrame(path.join(OUTPUT, 'baseline-source.png'), baseline.frame);
await writeFrame(path.join(OUTPUT, 'candidate-source.png'), candidate.frame);
await writeComparison(
  path.join(OUTPUT, 'baseline-left-candidate-right.png'),
  baseline.frame,
  candidate.frame,
);
console.log(JSON.stringify({ output: OUTPUT, ...report }, null, 2));

async function capture(id, parcelComponents) {
  const field = new BiomeWorldField(WORLD_SEED, {
    blockSize: 16,
    maxCachedBlocks: 48,
    arrivalCivicBranches: CANAL_TOWN_ARRIVAL_CIVIC_BRANCHES,
  });
  const routes = new RegionalRouteField(WORLD_SEED, field, {
    blockSize: 32,
    maxCachedBlocks: 128,
    maxCachedPaths: 512,
    maxCachedSites: 4096,
    pathStep: 4,
  });
  const compositor = new RegionalMaterialCompositor({
    worldSeed: WORLD_SEED,
    field,
    materials: biomeKit.materials,
    overviewMaterials: biomeKit.overviewMaterials,
    landmarkFabricMaterials: biomeKit.landmarkFabricMaterials,
    routes,
    routeMaterials: routeKit.routeMaterials,
    crossingMaterials: routeKit.crossingMaterials,
    routeSurfaceStyles: routeKit.routeSurfaceStyles,
    crossingSurfaceStyles: routeKit.crossingSurfaceStyles,
    maxCachedTiles: 4096,
    ...REGIONAL_MATERIAL_TEXTURE_PROFILE,
    maxOutputResolution: Math.min(biomeKit.sourceTileSize, routeKit.sourceTileSize),
  });
  const world = new RegionalWorldTileProvider({
    worldSeed: WORLD_SEED,
    field,
    routes,
    compositor,
    landmarks: landmarkKit.assets,
    ambient: ambientKit.assets,
    civicDetails: civicDetailKit.assets,
    quayDetails: quayDetailKit.assets,
    routeContacts: routeContactKit.assets,
    parcelComponents,
    environmentContacts: environmentKit.assets,
    blockSize: landmarkKit.blockSize,
    maxCachedBlocks: 64,
    ambientCellSize: ambientKit.cellSize,
    ambientDensity: ambientKit.density,
    ambientDistributionProfile: REGIONAL_AMBIENT_DISTRIBUTION_PROFILE,
    ambientCompositionProfile: REGIONAL_AMBIENT_COMPOSITION_PROFILE,
    ambientPlaceFabricProfile: REGIONAL_AMBIENT_PLACE_FABRIC_PROFILE,
    ambientPlaceAccessProfile: REGIONAL_AMBIENT_PLACE_ACCESS_PROFILE,
    ambientLandmarkClearance: ambientKit.landmarkClearance,
    civicDetailCellSize: civicDetailKit.cellSize,
    civicDetailDensity: civicDetailKit.density,
    quayDetailDensity: quayDetailKit.density,
    quayEdgeVariation: CANAL_TOWN_QUAY_EDGE_VARIATION,
    routeContactCellSize: routeContactKit.cellSize,
    routeContactDensity: routeContactKit.density,
    routeContactLandmarkClearance: routeContactKit.landmarkClearance,
    maxCachedRouteContactCells: 4096,
    parcelMinimumLayers: parcelKit.minimumLayers,
    parcelMaximumLayers: parcelKit.maximumLayers,
    parcelLayerSpacing: parcelKit.layerSpacing,
    environmentContactCellSize: environmentKit.cellSize,
    environmentContactDensity: environmentKit.density,
    environmentContactLandmarkClearance: environmentKit.landmarkClearance,
    maxPreparedViewports: 6,
    derivedCache: new RegionalWorldDerivedCache(),
    staticRenderIdentity: {},
    clearSharedCachesOnDestroy: true,
  });
  try {
    const placements = world.getAmbientPlacementsInBounds(
      BOUNDS.minX,
      BOUNDS.minY,
      BOUNDS.maxX,
      BOUNDS.maxY,
    ).map((placement) => ({
      assetId: placement.assetId,
      kind: placement.kind,
      anchorX: placement.anchorX,
      anchorY: placement.anchorY,
      visualAnchorX: placement.visualAnchorX ?? null,
      visualAnchorY: placement.visualAnchorY ?? null,
    })).sort((left, right) => (
      left.anchorY - right.anchorY || left.anchorX - right.anchorX ||
      left.kind.localeCompare(right.kind) || left.assetId.localeCompare(right.assetId)
    ));
    const physical = [];
    for (let y = BOUNDS.minY; y <= BOUNDS.maxY; y++) {
      for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x++) {
        const tile = world.getTileAtResolution(x, y, 1);
        physical.push([x, y, tile.material, tile.walkable, world.isBuildingAt(x, y)]);
      }
    }
    const renderer = new ViewportRenderer({
      widthTiles: Math.ceil(FRAME.width / FRAME.tileSize),
      heightTiles: Math.ceil(FRAME.height / FRAME.tileSize),
      pixelWidth: FRAME.width,
      pixelHeight: FRAME.height,
      tileRenderSize: FRAME.tileSize,
    });
    renderer.setCamera(FRAME.cameraX, FRAME.cameraY);
    const frame = renderer.renderToBuffer(world, 0).buffer;
    return {
      frame,
      report: {
        id,
        visualPlacements: placements.length,
        visualPlacementHash: hashJson(placements),
        physicalCells: physical.length,
        physicalPlaneHash: hashJson(physical),
        frameHash: hashFrame(frame),
      },
    };
  } finally {
    world.destroy();
  }
}

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function hashFrame(frame) {
  const bytes = Buffer.alloc(FRAME.width * FRAME.height * 3);
  let offset = 0;
  for (const row of frame) {
    for (const pixel of row) {
      bytes[offset++] = pixel.r;
      bytes[offset++] = pixel.g;
      bytes[offset++] = pixel.b;
    }
  }
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function countFrameDifferences(left, right) {
  let differences = 0;
  for (let y = 0; y < FRAME.height; y++) {
    for (let x = 0; x < FRAME.width; x++) {
      const a = left[y][x];
      const b = right[y][x];
      if (a.r !== b.r || a.g !== b.g || a.b !== b.b) differences++;
    }
  }
  return differences;
}

async function writeFrame(filename, frame) {
  const pixels = Buffer.alloc(FRAME.width * FRAME.height * 3);
  let offset = 0;
  for (const row of frame) {
    for (const pixel of row) {
      pixels[offset++] = pixel.r;
      pixels[offset++] = pixel.g;
      pixels[offset++] = pixel.b;
    }
  }
  await sharp(pixels, {
    raw: { width: FRAME.width, height: FRAME.height, channels: 3 },
  }).png().toFile(filename);
}

async function writeComparison(filename, left, right) {
  const width = FRAME.width * 2;
  const pixels = Buffer.alloc(width * FRAME.height * 3);
  for (let y = 0; y < FRAME.height; y++) {
    for (let x = 0; x < FRAME.width; x++) {
      for (const [column, pixel] of [[x, left[y][x]], [x + FRAME.width, right[y][x]]]) {
        const offset = (y * width + column) * 3;
        pixels[offset] = pixel.r;
        pixels[offset + 1] = pixel.g;
        pixels[offset + 2] = pixel.b;
      }
    }
  }
  await sharp(pixels, {
    raw: { width, height: FRAME.height, channels: 3 },
  }).png().toFile(filename);
}
