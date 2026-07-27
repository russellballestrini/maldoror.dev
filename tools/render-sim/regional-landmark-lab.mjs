/** Faithful production-provider lab for route-site regional landmarks. */
import crypto from 'node:crypto';
import fs from 'node:fs';
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
  loadRegionalRouteMaterialKit,
  loadRegionalRouteContactKit,
} from '../../apps/ssh-world/dist/game/biome-assets.js';
import {
  REGIONAL_AMBIENT_COMPOSITION_PROFILE,
  REGIONAL_AMBIENT_DISTRIBUTION_PROFILE,
  REGIONAL_AMBIENT_PLACE_ACCESS_PROFILE,
} from '../../apps/ssh-world/dist/game/regional-world-provider.js';
import {
  BIOME_FAMILIES,
  BiomeWorldField,
  CANAL_TOWN_ARRIVAL_CIVIC_BRANCHES,
  CANAL_TOWN_QUAY_EDGE_VARIATION,
  REGIONAL_AMBIENT_CONNECTED_PLACE_CELL_SIZE,
  REGIONAL_AMBIENT_CONNECTED_PLACE_SOURCE_REACH,
  REGIONAL_MATERIAL_TEXTURE_PROFILE,
  REGIONAL_STREET_PAIR_OWNERSHIP_CELL_SIZE,
  RegionalMaterialCompositor,
  RegionalRouteField,
  RegionalWorldTileProvider,
  regionalStreetPairCandidatesConflict,
  regionalStreetPairOwnershipCell,
  rasterizeRegionalEnvironmentProgramLayout,
  rasterizeRegionalLandmarkFabricLayout,
  sampleRegionalLandmarkFabricLayout,
  sampleRegionalParcelLayout,
  sampleRegionalWaterfrontLayout,
} from '../../packages/world/dist/index.js';
import { ViewportRenderer } from '../../packages/render/dist/pixel/viewport-renderer.js';
import { renderOctantGridCells } from '../../packages/render/dist/pixel/pixel-renderer.js';
import { OCTANT_CHARS } from '../../packages/render/dist/pixel/octant-chars.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUTPUT = process.env.MALDOROR_REGIONAL_LANDMARK_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-4-world-composition/regional-landmark-v2-alpha';
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const BIOME_MANIFEST = path.resolve(process.env.MALDOROR_REGIONAL_BIOME_MANIFEST ??
  path.join(ROOT, 'assets/biomes/manifest.json'));
const WIDTH = 320;
const HEIGHT = 176;
const FRAME_FILTER = process.env.MALDOROR_REGIONAL_LANDMARK_FRAME;
const AMBIENT_DISTRIBUTION_PROFILE =
  process.env.MALDOROR_AMBIENT_DISTRIBUTION_PROFILE ??
  REGIONAL_AMBIENT_DISTRIBUTION_PROFILE;
const AMBIENT_COMPOSITION_PROFILE =
  process.env.MALDOROR_AMBIENT_COMPOSITION_PROFILE ??
  REGIONAL_AMBIENT_COMPOSITION_PROFILE;
const AMBIENT_PLACE_FABRIC_PROFILE =
  process.env.MALDOROR_AMBIENT_PLACE_FABRIC_PROFILE ?? 'terrain-only';
const AMBIENT_PLACE_ACCESS_PROFILE =
  process.env.MALDOROR_AMBIENT_PLACE_ACCESS_PROFILE ??
  REGIONAL_AMBIENT_PLACE_ACCESS_PROFILE;
const RUN_AMBIENT_DISTRIBUTION_AUDIT =
  process.env.MALDOROR_AMBIENT_DISTRIBUTION_AUDIT !== 'disabled';
if (!['single', 'bounded-ensemble', 'hierarchical-place-field'].includes(AMBIENT_COMPOSITION_PROFILE)) {
  throw new Error(`Unknown ambient composition profile: ${AMBIENT_COMPOSITION_PROFILE}`);
}
if (![
  'terrain-only',
  'internal-spine',
  'shared-common',
  'shared-common-street-overlay',
].includes(AMBIENT_PLACE_FABRIC_PROFILE)) {
  throw new Error(`Unknown ambient place-fabric profile: ${AMBIENT_PLACE_FABRIC_PROFILE}`);
}
if (!['isolated', 'route-frontage'].includes(AMBIENT_PLACE_ACCESS_PROFILE)) {
  throw new Error(`Unknown ambient place-access profile: ${AMBIENT_PLACE_ACCESS_PROFILE}`);
}
if (![
  'uniform-blue-noise',
  'density-field-blue-noise',
  'legacy-cluster-field-blue-noise',
  'cluster-field-blue-noise',
].includes(AMBIENT_DISTRIBUTION_PROFILE)) {
  throw new Error(`Unknown ambient distribution profile: ${AMBIENT_DISTRIBUTION_PROFILE}`);
}
const INFRASTRUCTURE_PROFILE_NAME = process.env.MALDOROR_INFRASTRUCTURE_PROFILE ?? 'production';
const WATER_PROFILE_NAME = process.env.MALDOROR_WATER_PROFILE ?? 'production';
const CIVIC_DETAIL_PROFILE_NAME = process.env.MALDOROR_CIVIC_DETAIL_PROFILE ?? 'production';
const QUAY_DETAIL_PROFILE_NAME = process.env.MALDOROR_QUAY_DETAIL_PROFILE ?? 'production';
const QUAY_ACTIVITY_WORLD_MINUTE = Number(
  process.env.MALDOROR_QUAY_ACTIVITY_WORLD_MINUTE ?? 720,
);
if (!Number.isSafeInteger(QUAY_ACTIVITY_WORLD_MINUTE) || QUAY_ACTIVITY_WORLD_MINUTE < 0) {
  throw new Error(`Invalid quay activity world minute: ${QUAY_ACTIVITY_WORLD_MINUTE}`);
}
const ARRIVAL_WATERWAY_PROFILE_NAME =
  process.env.MALDOROR_ARRIVAL_WATERWAY_PROFILE ?? 'production';
const QUAY_PROFILE_NAME = process.env.MALDOROR_QUAY_PROFILE ?? 'production';
const INFRASTRUCTURE_PROFILES = {
  production: {},
  baseline: {
    civicBridgeDeckMix: 0,
    detailCivicStreetMix: 0.38,
    overviewCivicStreetMix: 0.24,
    bridgeLandingFlareScale: 1,
    bridgeMidspanWaistScale: 1,
    quaySurfaceArticulation: 0,
  },
  'civic-stone': {
    civicBridgeDeckMix: 0.68,
    bridgeLandingFlareScale: 1,
    bridgeMidspanWaistScale: 1,
    quaySurfaceArticulation: 0,
  },
  'civic-arched-worn': {
    civicBridgeDeckMix: 0.58,
    bridgeLandingFlareScale: 1.55,
    bridgeMidspanWaistScale: 1.65,
    quaySurfaceArticulation: 1,
  },
  'civic-arched-strong': {
    civicBridgeDeckMix: 0.64,
    bridgeLandingFlareScale: 3,
    bridgeMidspanWaistScale: 3.2,
    quaySurfaceArticulation: 1,
  },
  'civic-street-light': {
    detailCivicStreetMix: 0.62,
    overviewCivicStreetMix: 0.36,
  },
  'civic-street-bright': {
    detailCivicStreetMix: 0.78,
    overviewCivicStreetMix: 0.48,
  },
};
const INFRASTRUCTURE_PROFILE = INFRASTRUCTURE_PROFILES[INFRASTRUCTURE_PROFILE_NAME];
if (!INFRASTRUCTURE_PROFILE) {
  throw new Error(`Unknown infrastructure profile: ${INFRASTRUCTURE_PROFILE_NAME}`);
}
const WATER_PROFILES = {
  production: {
    detailCurrentStrength: 0.18,
    overviewCurrentStrength: 0.52,
  },
  baseline: {
    detailCurrentStrength: 0,
    overviewCurrentStrength: 0,
  },
  'current-medium': {
    detailCurrentStrength: 0.12,
    overviewCurrentStrength: 0.3,
  },
  'current-strong': {
    detailCurrentStrength: 0.18,
    overviewCurrentStrength: 0.52,
  },
};
const WATER_PROFILE = WATER_PROFILES[WATER_PROFILE_NAME];
if (!WATER_PROFILE) throw new Error(`Unknown water profile: ${WATER_PROFILE_NAME}`);
const CIVIC_DETAIL_PROFILES = {
  production: { enabled: true },
  disabled: { enabled: false },
};
const CIVIC_DETAIL_PROFILE = CIVIC_DETAIL_PROFILES[CIVIC_DETAIL_PROFILE_NAME];
if (!CIVIC_DETAIL_PROFILE) {
  throw new Error(`Unknown civic-detail profile: ${CIVIC_DETAIL_PROFILE_NAME}`);
}
const ARRIVAL_WATERWAY_PROFILES = {
  production: { arrivalCivicBranches: CANAL_TOWN_ARRIVAL_CIVIC_BRANCHES },
  baseline: { arrivalCivicBranches: [] },
  'paired-narrow': {
    arrivalCivicBranch: {
      start: [-22, 5.6],
      control: [-1, 6.4],
      end: [30, 5.1],
      baseHalfWidth: 1.45,
      middleWidening: 0.18,
      terminalWidening: 0.16,
    },
  },
  'paired-civic': {
    arrivalCivicBranch: {
      start: [-22, 5.3],
      control: [-1, 5.9],
      end: [30, 4.8],
      baseHalfWidth: 1.85,
      middleWidening: 0.28,
      terminalWidening: 0.24,
    },
  },
  'paired-bold': {
    arrivalCivicBranch: {
      start: [-23, 4.8],
      control: [0, 5.4],
      end: [32, 4.2],
      baseHalfWidth: 2.25,
      middleWidening: 0.36,
      terminalWidening: 0.3,
    },
  },
  'side-canals-narrow': {
    arrivalCivicBranches: CANAL_TOWN_ARRIVAL_CIVIC_BRANCHES,
  },
  'side-canals-civic': {
    arrivalCivicBranches: [
      {
        id: 'arrival-civic-west',
        start: [-6.6, -6.5],
        control: [-7.3, 2.5],
        end: [-6.4, 18],
        baseHalfWidth: 1.55,
        middleWidening: 0.24,
        terminalWidening: 0.16,
      },
      {
        id: 'arrival-civic-east',
        start: [6.6, -5.8],
        control: [7.4, 3],
        end: [6.3, 18],
        baseHalfWidth: 1.55,
        middleWidening: 0.24,
        terminalWidening: 0.16,
      },
    ],
  },
  'side-canals-bold': {
    arrivalCivicBranches: [
      {
        id: 'arrival-civic-west',
        start: [-6.2, -6.5],
        control: [-6.8, 2.5],
        end: [-6, 18],
        baseHalfWidth: 1.9,
        middleWidening: 0.28,
        terminalWidening: 0.2,
      },
      {
        id: 'arrival-civic-east',
        start: [6.2, -5.8],
        control: [6.9, 3],
        end: [5.9, 18],
        baseHalfWidth: 1.9,
        middleWidening: 0.28,
        terminalWidening: 0.2,
      },
    ],
  },
};
const ARRIVAL_WATERWAY_PROFILE = ARRIVAL_WATERWAY_PROFILES[ARRIVAL_WATERWAY_PROFILE_NAME];
if (!ARRIVAL_WATERWAY_PROFILE) {
  throw new Error(`Unknown arrival-waterway profile: ${ARRIVAL_WATERWAY_PROFILE_NAME}`);
}
const QUAY_PROFILES = {
  production: { quayEdgeVariation: CANAL_TOWN_QUAY_EDGE_VARIATION },
  baseline: {},
  'civic-wide': { quayWidth: 2.45, quayFrontageDepth: 4.2 },
  'civic-broad': { quayWidth: 3.05, quayFrontageDepth: 3.8 },
  'irregular-subtle': { quayEdgeVariation: CANAL_TOWN_QUAY_EDGE_VARIATION },
  'irregular-medium': { quayEdgeVariation: 0.52 },
  'irregular-bold': { quayEdgeVariation: 0.8 },
};
const QUAY_PROFILE = QUAY_PROFILES[QUAY_PROFILE_NAME];
if (!QUAY_PROFILE) throw new Error(`Unknown quay profile: ${QUAY_PROFILE_NAME}`);
const QUAY_DETAIL_PROFILES = {
  production: { enabled: true },
  disabled: { enabled: false },
};
const QUAY_DETAIL_PROFILE = QUAY_DETAIL_PROFILES[QUAY_DETAIL_PROFILE_NAME];
if (!QUAY_DETAIL_PROFILE) throw new Error(`Unknown quay-detail profile: ${QUAY_DETAIL_PROFILE_NAME}`);
let FRAMES = [
  { name: 'arrival-landmark-walking', centre: [0, 0], displayTileSize: 16 },
  { name: 'arrival-landmark-district', centre: [0, 0], displayTileSize: 8 },
  { name: 'arrival-landmark-regional', centre: [0, 0], displayTileSize: 4 },
].filter((frame) => !FRAME_FILTER || frame.name === FRAME_FILTER);
if (FRAMES.length === 0) throw new Error(`Unknown landmark frame: ${FRAME_FILTER}`);
const CENTRE_OVERRIDE = process.env.MALDOROR_REGIONAL_LANDMARK_CENTRE;
if (CENTRE_OVERRIDE) {
  const centre = CENTRE_OVERRIDE.split(',').map(Number);
  if (centre.length !== 2 || centre.some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid landmark centre: ${CENTRE_OVERRIDE}`);
  }
  const displayTileSize = Number(
    process.env.MALDOROR_REGIONAL_LANDMARK_DISPLAY_TILE_SIZE ?? '16',
  );
  if (![4, 8, 12, 16].includes(displayTileSize)) {
    throw new Error(`Invalid landmark display tile size: ${displayTileSize}`);
  }
  FRAMES = [{
    name: displayTileSize === 16 ? 'custom-walking' :
      displayTileSize === 12 ? 'custom-walking-12px' :
        displayTileSize === 8 ? 'custom-district' : 'custom-regional',
    centre,
    displayTileSize,
  }];
}

fs.mkdirSync(OUTPUT, { recursive: true });
const field = new BiomeWorldField(WORLD_SEED, {
  blockSize: 16,
  maxCachedBlocks: 32,
  ...ARRIVAL_WATERWAY_PROFILE,
});
const routes = new RegionalRouteField(WORLD_SEED, field, {
  blockSize: 32,
  maxCachedBlocks: 128,
  maxCachedPaths: 512,
  pathStep: 4,
});
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
  loadRegionalBiomeMaterialKit(BIOME_MANIFEST),
  loadRegionalRouteMaterialKit(path.join(ROOT, 'assets/routes/manifest.json')),
  loadRegionalLandmarkKit(path.join(ROOT, 'assets/biomes/landmarks-manifest.json')),
  loadRegionalAmbientKit(path.join(ROOT, 'assets/biomes/ambient-manifest.json')),
  loadRegionalCivicDetailKit(path.join(ROOT, 'assets/biomes/civic-details-manifest.json')),
  loadRegionalQuayDetailKit(path.join(ROOT, 'assets/biomes/quay-details-manifest.json')),
  loadRegionalRouteContactKit(path.join(ROOT, 'assets/biomes/route-contacts-manifest.json')),
  loadRegionalParcelComponentKit(path.join(ROOT, 'assets/biomes/parcel-components-manifest.json')),
  loadRegionalEnvironmentContactKit(path.join(ROOT, 'assets/biomes/environment-contacts-manifest.json')),
]);
if (new Set([
  landmarkKit.blockSize,
  ambientKit.blockSize,
  civicDetailKit.blockSize,
  quayDetailKit.blockSize,
  routeContactKit.blockSize,
]).size !== 1) {
  throw new Error('Regional landmark, ambient, civic-detail, quay-detail, and route-contact block sizes disagree');
}
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
  infrastructureVisualProfile: INFRASTRUCTURE_PROFILE,
  waterVisualProfile: WATER_PROFILE,
});
const world = new RegionalWorldTileProvider({
  worldSeed: WORLD_SEED,
  field,
  routes,
  compositor,
  landmarks: landmarkKit.assets,
  ambient: ambientKit.assets,
  civicDetails: CIVIC_DETAIL_PROFILE.enabled ? civicDetailKit.assets : [],
  quayDetails: QUAY_DETAIL_PROFILE.enabled ? quayDetailKit.assets : [],
  routeContacts: routeContactKit.assets,
  parcelComponents: parcelKit.assets,
  environmentContacts: environmentKit.assets,
  blockSize: landmarkKit.blockSize,
  maxCachedBlocks: 64,
  ambientCellSize: ambientKit.cellSize,
  ambientDensity: ambientKit.density,
  ambientDistributionProfile: AMBIENT_DISTRIBUTION_PROFILE,
  ambientCompositionProfile: AMBIENT_COMPOSITION_PROFILE,
  ambientPlaceFabricProfile: AMBIENT_PLACE_FABRIC_PROFILE,
  ambientPlaceAccessProfile: AMBIENT_PLACE_ACCESS_PROFILE,
  ambientLandmarkClearance: ambientKit.landmarkClearance,
  civicDetailCellSize: civicDetailKit.cellSize,
  civicDetailDensity: CIVIC_DETAIL_PROFILE.enabled ? civicDetailKit.density : 0,
  quayDetailDensity: QUAY_DETAIL_PROFILE.enabled ? quayDetailKit.density : 0,
  quayDetailDefaultWorldMinute: QUAY_ACTIVITY_WORLD_MINUTE,
  ...QUAY_PROFILE,
  routeContactCellSize: routeContactKit.cellSize,
  routeContactDensity: routeContactKit.density,
  routeContactLandmarkClearance: routeContactKit.landmarkClearance,
  parcelMinimumLayers: parcelKit.minimumLayers,
  parcelMaximumLayers: parcelKit.maximumLayers,
  parcelLayerSpacing: parcelKit.layerSpacing,
  environmentContactCellSize: environmentKit.cellSize,
  environmentContactDensity: environmentKit.density,
  environmentContactLandmarkClearance: environmentKit.landmarkClearance,
});
const environmentProgramLayouts = new Map();

function resolveEnvironmentProgramLayout(placement) {
  if (!placement.environmentProgramId) return null;
  const cached = environmentProgramLayouts.get(placement.environmentProgramId);
  if (cached) return cached;
  const layout = world.getEnvironmentProgramLayoutsInBounds(
    placement.anchorX - 48,
    placement.anchorY - 48,
    placement.anchorX + 48,
    placement.anchorY + 48,
  ).find((candidate) => candidate.id === placement.environmentProgramId) ?? null;
  if (layout) environmentProgramLayouts.set(layout.id, layout);
  return layout;
}

function environmentProgramIsExact(placement) {
  if (!placement.environmentProgram) return true;
  const layout = resolveEnvironmentProgramLayout(placement);
  if (!layout) return false;
  const audit = auditEnvironmentProgram({
    environmentProgram: placement.environmentProgram,
    environmentProgramId: placement.environmentProgramId,
  });
  if (audit?.mismatchCount === 0) return true;
  environmentProgramLayouts.delete(layout.id);
  return false;
}

function locateLandmarkFamilies() {
  const assetIds = new Set(landmarkKit.assets.map((asset) => asset.id));
  const found = new Map();
  const seenSites = new Set();
  for (const radius of [160, 320, 640, 960, 1280]) {
    for (const site of routes.getLandmarkSites(-radius, -radius, radius, radius)) {
      if (seenSites.has(site.id)) continue;
      seenSites.add(site.id);
      const placement = world.resolveLandmarkPlacement(site.x, site.y);
      if (placement && assetIds.has(placement.assetId) && !found.has(placement.assetId)) {
        found.set(placement.assetId, { site, placement });
      }
    }
    if (found.size === assetIds.size) break;
  }
  const missing = [...assetIds].filter((id) => !found.has(id));
  if (missing.length > 0) throw new Error(`Could not locate regional landmarks: ${missing.join(', ')}`);
  return found;
}

const ATLAS_MODES = [
  process.env.MALDOROR_REGIONAL_LANDMARK_ATLAS,
  process.env.MALDOROR_REGIONAL_AMBIENT_ATLAS,
  process.env.MALDOROR_REGIONAL_STREET_OVERLAY_ATLAS,
  process.env.MALDOROR_REGIONAL_CONTACT_ATLAS,
  process.env.MALDOROR_REGIONAL_ENVIRONMENT_ATLAS,
].filter((value) => value === '1').length;
if (ATLAS_MODES > 1) {
  throw new Error('Choose one regional atlas mode');
}
let streetOverlayCoverage = null;

if (process.env.MALDOROR_REGIONAL_LANDMARK_ATLAS === '1') {
  const found = locateLandmarkFamilies();
  FRAMES = landmarkKit.assets.map((asset) => {
    const match = found.get(asset.id);
    return {
      name: `${asset.families[0]}-landmark-walking`,
      centre: [match.site.x, match.site.y],
      displayTileSize: 16,
      assetId: asset.id,
      landmarkKind: match.site.landmarkKind,
      anchor: [match.placement.anchorX, match.placement.anchorY],
    };
  });
}

if (process.env.MALDOROR_REGIONAL_AMBIENT_ATLAS === '1') {
  const landmarks = locateLandmarkFamilies();
  FRAMES = landmarkKit.assets.map((landmarkAsset) => {
    const family = landmarkAsset.families[0];
    const landmark = landmarks.get(landmarkAsset.id);
    let candidates = [];
    for (const radius of [32, 64, 96]) {
      candidates = world.getAmbientPlacementsInBounds(
        landmark.site.x - radius,
        landmark.site.y - radius,
        landmark.site.x + radius,
        landmark.site.y + radius,
      ).filter((placement) => placement.families.includes(family));
      if (candidates.length > 0) break;
    }
    if (candidates.length === 0) throw new Error(`Could not locate ambient family: ${family}`);
    candidates.sort((a, b) => (
      Math.hypot(a.anchorX - landmark.site.x, a.anchorY - landmark.site.y) -
      Math.hypot(b.anchorX - landmark.site.x, b.anchorY - landmark.site.y)
    ));
    const placement = candidates[0];
    return {
      name: `${family}-ambient-walking`,
      centre: [placement.anchorX, placement.anchorY],
      displayTileSize: 16,
      assetId: placement.assetId,
      anchor: [placement.anchorX, placement.anchorY],
      nearestLandmark: [landmark.site.x, landmark.site.y],
    };
  });
}

if (process.env.MALDOROR_REGIONAL_STREET_OVERLAY_ATLAS === '1') {
  if (AMBIENT_PLACE_FABRIC_PROFILE !== 'shared-common-street-overlay') {
    throw new Error('Street-overlay atlas requires shared-common-street-overlay');
  }
  const parcelAssetById = new Map(parcelKit.assets.map((asset) => [asset.id, asset]));
  const vocabularySides = new Map();
  for (const asset of parcelKit.assets) {
    if (asset.compositionRole !== 'focal' || !asset.frontageAxis ||
        asset.compositionSide === undefined) continue;
    for (const family of asset.families) {
      const key = `${family}:${asset.frontageAxis}`;
      const sides = vocabularySides.get(key) ?? new Set();
      sides.add(asset.compositionSide);
      vocabularySides.set(key, sides);
    }
  }
  const expected = [...vocabularySides.entries()].filter(([, sides]) => (
    sides.has(-1) && sides.has(1)
  )).map(([key]) => key).sort();
  const expectedSet = new Set(expected);
  const searchRadius = Number(process.env.MALDOROR_REGIONAL_STREET_OVERLAY_RADIUS ?? '256');
  if (!Number.isInteger(searchRadius) || searchRadius < 64 || searchRadius > 1024) {
    throw new Error(`Invalid street-overlay atlas radius: ${searchRadius}`);
  }
  const discoveryStartedAt = performance.now();
  const providerBlockSize = world.getRegionalStats().blockSize;
  const expandedRadius = searchRadius + REGIONAL_AMBIENT_CONNECTED_PLACE_SOURCE_REACH;
  const firstCell = Math.floor(-expandedRadius / REGIONAL_AMBIENT_CONNECTED_PLACE_CELL_SIZE);
  const lastCell = Math.floor(expandedRadius / REGIONAL_AMBIENT_CONNECTED_PLACE_CELL_SIZE);
  const routeWindows = new Map();
  const routeOpportunities = [];
  let evaluatedPlaceCells = 0;
  let resolvedPlacePrograms = 0;
  let resolvedFabricPrograms = 0;
  for (let cellY = firstCell; cellY <= lastCell; cellY++) {
    for (let cellX = firstCell; cellX <= lastCell; cellX++) {
      evaluatedPlaceCells++;
      // TypeScript-private, not ECMAScript-private: proof tooling deliberately
      // reuses the provider's canonical meso program rather than inventing a
      // second discovery algorithm.
      const program = world.getAmbientPlaceProgram(cellX, cellY);
      if (program) resolvedPlacePrograms++;
      if (program?.fabric) resolvedFabricPrograms++;
      const routeStart = program?.fabric && program.accessPath?.points[0];
      if (!routeStart) continue;
      const routeX = Math.floor(routeStart.x);
      const routeY = Math.floor(routeStart.y);
      const route = routes.sample(routeX, routeY);
      const axis = Math.abs(route.directionX) > Math.abs(route.directionY)
        ? 'east-west'
        : 'north-south';
      const family = program.fabric.layout.materialFamily;
      const key = `${family}:${axis}`;
      const withinSearch = Math.abs(routeStart.x) <= searchRadius + 16 &&
        Math.abs(routeStart.y) <= searchRadius + 16;
      const routeValid = !field.sample(routeX, routeY).isWater && Boolean(route.routeKind);
      // TypeScript-private, not ECMAScript-private: this empty-reservation
      // probe runs the exact production fitter and isolates intrinsic terrain,
      // doorway, and manifest feasibility from meso/detail occupancy.
      const intrinsicPair = routeValid && expectedSet.has(key)
        ? world.buildAmbientSharedStreetOverlay(program, new Set())
        : [];
      routeOpportunities.push({
        key,
        siteKey: `${program.root.siteX},${program.root.siteY}`,
        site: [program.root.siteX, program.root.siteY],
        fabricId: program.fabric.layout.id,
        routeStart: [routeStart.x, routeStart.y],
        routeKind: route.routeKind,
        routeValid,
        withinSearch,
        intrinsicFit: intrinsicPair.length === 2,
        intrinsicAssets: intrinsicPair.map((placement) => placement.asset.id).sort(),
      });
      if (!withinSearch) continue;
      const blockX = Math.floor(routeStart.x / providerBlockSize);
      const blockY = Math.floor(routeStart.y / providerBlockSize);
      routeWindows.set(`${blockX},${blockY}`, { blockX, blockY });
    }
  }
  const ownershipMargin = searchRadius + 16;
  const firstOwnership = regionalStreetPairOwnershipCell(-ownershipMargin, -ownershipMargin);
  const lastOwnership = regionalStreetPairOwnershipCell(ownershipMargin, ownershipMargin);
  const canonicalCandidates = new Map();
  const ownershipMismatches = [];
  let enumeratedOwnershipCells = 0;
  let enumeratedCandidateEmissions = 0;
  let inMarginCandidateEmissions = 0;
  for (let ownershipCellY = firstOwnership.cellY;
    ownershipCellY <= lastOwnership.cellY; ownershipCellY++) {
    for (let ownershipCellX = firstOwnership.cellX;
      ownershipCellX <= lastOwnership.cellX; ownershipCellX++) {
      enumeratedOwnershipCells++;
      for (const candidate of world.getAmbientStreetPairCandidates(
        ownershipCellX,
        ownershipCellY,
      )) {
        enumeratedCandidateEmissions++;
        const owner = regionalStreetPairOwnershipCell(
          candidate.ownershipX,
          candidate.ownershipY,
        );
        if (owner.cellX !== ownershipCellX || owner.cellY !== ownershipCellY) {
          ownershipMismatches.push({
            id: candidate.id,
            emittedBy: [ownershipCellX, ownershipCellY],
            actualOwner: [owner.cellX, owner.cellY],
          });
          continue;
        }
        if (Math.abs(candidate.ownershipX) > ownershipMargin ||
            Math.abs(candidate.ownershipY) > ownershipMargin) continue;
        inMarginCandidateEmissions++;
        canonicalCandidates.set(candidate.id, candidate);
      }
    }
  }
  if (ownershipMismatches.length > 0) {
    throw new Error(`Street candidate ownership mismatch: ${JSON.stringify(ownershipMismatches)}`);
  }
  let maximumFootprintAxisReach = 0;
  let maximumFootprintEuclideanReach = 0;
  let maximumReservedCellCount = 0;
  for (const candidate of canonicalCandidates.values()) {
    maximumReservedCellCount = Math.max(
      maximumReservedCellCount,
      candidate.reservedCells.length,
    );
    for (const key of candidate.reservedCells) {
      const [cellX, cellY] = key.split(',').map(Number);
      if (!Number.isFinite(cellX) || !Number.isFinite(cellY)) {
        throw new Error(`Invalid street candidate footprint key: ${candidate.id}:${key}`);
      }
      const deltaX = Math.abs(cellX - candidate.ownershipX);
      const deltaY = Math.abs(cellY - candidate.ownershipY);
      maximumFootprintAxisReach = Math.max(maximumFootprintAxisReach, deltaX, deltaY);
      maximumFootprintEuclideanReach = Math.max(
        maximumFootprintEuclideanReach,
        Math.hypot(deltaX, deltaY),
      );
    }
  }
  const canonicalCandidateValues = [...canonicalCandidates.values()];
  let observedConflictNeighbourReach = 0;
  let observedConflictEdges = 0;
  for (let firstIndex = 0; firstIndex < canonicalCandidateValues.length; firstIndex++) {
    const first = canonicalCandidateValues[firstIndex];
    const firstOwner = regionalStreetPairOwnershipCell(first.ownershipX, first.ownershipY);
    for (let secondIndex = firstIndex + 1;
      secondIndex < canonicalCandidateValues.length; secondIndex++) {
      const second = canonicalCandidateValues[secondIndex];
      if (!regionalStreetPairCandidatesConflict(first, second)) continue;
      observedConflictEdges++;
      const secondOwner = regionalStreetPairOwnershipCell(second.ownershipX, second.ownershipY);
      observedConflictNeighbourReach = Math.max(
        observedConflictNeighbourReach,
        Math.abs(firstOwner.cellX - secondOwner.cellX),
        Math.abs(firstOwner.cellY - secondOwner.cellY),
      );
    }
  }
  const conservativeConflictNeighbourReach = maximumFootprintAxisReach === 0
    ? 0
    : Math.floor(
      Math.max(0, maximumFootprintAxisReach * 2 - 1) /
      REGIONAL_STREET_PAIR_OWNERSHIP_CELL_SIZE,
    ) + 1;
  if (inMarginCandidateEmissions !== canonicalCandidates.size) {
    throw new Error('Street candidate ownership emitted a duplicate complete identity');
  }
  if (observedConflictNeighbourReach > conservativeConflictNeighbourReach) {
    throw new Error('Observed street conflict exceeds conservative ownership-cell reach');
  }
  const canonicalCandidateDiagnostics = {
    ownershipCellSize: REGIONAL_STREET_PAIR_OWNERSHIP_CELL_SIZE,
    ownershipMargin,
    enumeratedOwnershipCells,
    enumeratedCandidateEmissions,
    inMarginCandidateEmissions,
    uniqueCandidateCount: canonicalCandidates.size,
    duplicateCandidateEmissionCount: inMarginCandidateEmissions - canonicalCandidates.size,
    ownershipMismatches,
    maximumReservedCellCount,
    maximumFootprintAxisReach,
    maximumFootprintEuclideanReach: Number(maximumFootprintEuclideanReach.toFixed(3)),
    conservativeConflictNeighbourReach,
    observedConflictEdges,
    observedConflictNeighbourReach,
  };
  console.error(JSON.stringify({ streetOverlayDiscovery: {
    searchRadius,
    evaluatedPlaceCells,
    resolvedPlacePrograms,
    resolvedFabricPrograms,
    routeWindowCount: routeWindows.size,
  } }));
  const placementsBySite = new Map();
  const admittedFabricIds = new Set();
  const pairsByVocabulary = new Map();
  for (const { blockX, blockY } of [...routeWindows.values()].sort((a, b) => (
    a.blockY - b.blockY || a.blockX - b.blockX
  ))) {
    const margin = 16;
    const minX = blockX * providerBlockSize - margin;
    const minY = blockY * providerBlockSize - margin;
    const maxX = (blockX + 1) * providerBlockSize - 1 + margin;
    const maxY = (blockY + 1) * providerBlockSize - 1 + margin;
    for (const layout of world.getLandmarkFabricLayoutsInBounds(minX, minY, maxX, maxY)) {
      if (layout.connectionMode === 'shared-common') admittedFabricIds.add(layout.id);
    }
    for (const placement of world.getAmbientPlacementsInBounds(minX, minY, maxX, maxY)) {
      if (!placement.parcelPathId?.endsWith(':street-overlay') ||
          Math.abs(placement.anchorX) > searchRadius ||
          Math.abs(placement.anchorY) > searchRadius) continue;
      const siteKey = `${placement.siteX},${placement.siteY}`;
      const site = placementsBySite.get(siteKey) ?? new Map();
      site.set(`${placement.assetId}@${placement.anchorX},${placement.anchorY}`, placement);
      placementsBySite.set(siteKey, site);
    }
  }
  for (const [siteKey, site] of placementsBySite) {
    const pair = [...site.values()];
    if (pair.length !== 2) continue;
    const assets = pair.map((placement) => parcelAssetById.get(placement.assetId));
    if (assets.some((asset) => !asset)) continue;
    const family = pair[0].families.find((candidate) => pair[1].families.includes(candidate));
    if (!family) continue;
    const axis = Math.abs(pair[0].pathTangentX ?? 0) >
      Math.abs(pair[0].pathTangentY ?? 0) ? 'east-west' : 'north-south';
    if (pair.some((placement) => (
      (Math.abs(placement.pathTangentX ?? 0) > Math.abs(placement.pathTangentY ?? 0)
        ? 'east-west'
        : 'north-south') !== axis
    ))) continue;
    const sides = new Set(assets.map((asset) => asset.compositionSide));
    if (!sides.has(-1) || !sides.has(1)) continue;
    const key = `${family}:${axis}`;
    if (!expected.includes(key)) continue;
    const candidate = {
      siteKey,
      site: [pair[0].siteX, pair[0].siteY],
      family,
      axis,
      pair: pair.sort((a, b) => a.assetId.localeCompare(b.assetId)),
    };
    const candidates = pairsByVocabulary.get(key) ?? [];
    candidates.push(candidate);
    pairsByVocabulary.set(key, candidates);
  }
  const found = [...pairsByVocabulary.keys()].sort();
  const missing = expected.filter((key) => !pairsByVocabulary.has(key));
  const incompleteSites = [...placementsBySite.entries()].filter(([, site]) => (
    site.size !== 2
  )).map(([siteKey, site]) => ({
    siteKey,
    placementCount: site.size,
    placements: [...site.values()].map((placement) => ({
      assetId: placement.assetId,
      anchor: [placement.anchorX, placement.anchorY],
      pathTangent: [placement.pathTangentX, placement.pathTangentY],
    })).sort((a, b) => a.assetId.localeCompare(b.assetId)),
  })).sort((a, b) => a.siteKey.localeCompare(b.siteKey));
  const admittedOverlaySites = new Set([...pairsByVocabulary.values()].flat().map((candidate) => (
    candidate.siteKey
  )));
  const opportunityByVocabulary = Object.fromEntries(expected.map((key) => {
    const candidates = routeOpportunities.filter((candidate) => (
      candidate.withinSearch && candidate.key === key
    ));
    const stages = {
      invalidRoute: 0,
      intrinsicFitRejected: 0,
      mesoAdmissionRejected: 0,
      detailReservationRejected: 0,
      overlayAdmitted: 0,
    };
    for (const candidate of candidates) {
      if (!candidate.routeValid) stages.invalidRoute++;
      else if (!candidate.intrinsicFit) stages.intrinsicFitRejected++;
      else if (!admittedFabricIds.has(candidate.fabricId)) stages.mesoAdmissionRejected++;
      else if (!admittedOverlaySites.has(candidate.siteKey)) stages.detailReservationRejected++;
      else stages.overlayAdmitted++;
    }
    return [key, {
      routeOpportunityCount: candidates.length,
      validRouteOpportunityCount: candidates.filter((candidate) => candidate.routeValid).length,
      intrinsicFitCount: candidates.filter((candidate) => candidate.intrinsicFit).length,
      mesoAdmittedCount: candidates.filter((candidate) => (
        admittedFabricIds.has(candidate.fabricId)
      )).length,
      overlayAdmittedCount: candidates.filter((candidate) => (
        admittedOverlaySites.has(candidate.siteKey)
      )).length,
      stages,
      exampleSites: candidates.slice(0, 4).map((candidate) => ({
        site: candidate.site,
        routeStart: candidate.routeStart,
        intrinsicAssets: candidate.intrinsicAssets,
      })),
    }];
  }));
  const opportunityStageTotals = Object.values(opportunityByVocabulary).reduce((totals, entry) => {
    for (const [stage, count] of Object.entries(entry.stages)) totals[stage] += count;
    return totals;
  }, {
    invalidRoute: 0,
    intrinsicFitRejected: 0,
    mesoAdmissionRejected: 0,
    detailReservationRejected: 0,
    overlayAdmitted: 0,
  });
  streetOverlayCoverage = {
    searchRadius,
    expandedRadius,
    evaluatedPlaceCells,
    resolvedPlacePrograms,
    resolvedFabricPrograms,
    inSearchFabricPrograms: routeOpportunities.filter((candidate) => candidate.withinSearch).length,
    outsideSearchFabricPrograms: routeOpportunities.filter((candidate) => !candidate.withinSearch).length,
    routeWindowCount: routeWindows.size,
    admittedFabricCount: admittedFabricIds.size,
    admittedSiteCount: placementsBySite.size,
    completePairSiteCount: [...pairsByVocabulary.values()].flat().length,
    incompleteSites,
    expected,
    found,
    missing,
    opportunityStageTotals,
    opportunityByVocabulary,
    canonicalCandidateDiagnostics,
    complete: missing.length === 0 && incompleteSites.length === 0,
    discoveryMs: Number((performance.now() - discoveryStartedAt).toFixed(2)),
  };
  console.error(JSON.stringify({ streetOverlayCoverage }));
  if (found.length === 0) throw new Error(`No street overlays found inside radius ${searchRadius}`);
  FRAMES = found.map((key) => {
    const candidates = pairsByVocabulary.get(key).sort((a, b) => (
      Math.hypot(a.site[0], a.site[1]) - Math.hypot(b.site[0], b.site[1]) ||
      a.site[1] - b.site[1] || a.site[0] - b.site[0]
    ));
    const selected = candidates[0];
    const centre = [
      Math.round(selected.pair.reduce((sum, placement) => sum + placement.anchorX, 0) / 2),
      Math.round(selected.pair.reduce((sum, placement) => sum + placement.anchorY, 0) / 2),
    ];
    return {
      name: `${selected.family}-street-overlay-${selected.axis}-walking`,
      centre,
      displayTileSize: 16,
      streetSite: selected.site,
      streetFamily: selected.family,
      streetAxis: selected.axis,
      streetAssets: selected.pair.map((placement) => placement.assetId),
      streetDiscoveryRadius: searchRadius,
      streetCandidateCount: candidates.length,
    };
  });
}

if (process.env.MALDOROR_REGIONAL_CONTACT_ATLAS === '1') {
  const contactAssetFilter = process.env.MALDOROR_REGIONAL_CONTACT_ASSET;
  const familyAtlas = process.env.MALDOROR_REGIONAL_CONTACT_FAMILY_ATLAS === '1';
  if (familyAtlas && contactAssetFilter) {
    throw new Error('Family contact atlas and single-asset filter are mutually exclusive');
  }
  const selectedContactAssets = routeContactKit.assets.filter((asset) =>
    !contactAssetFilter || asset.id === contactAssetFilter);
  if (selectedContactAssets.length === 0) {
    throw new Error(`Unknown route-contact asset: ${contactAssetFilter}`);
  }
  const requireWaterfront = process.env.MALDOROR_REGIONAL_CONTACT_REQUIRE_WATERFRONT === '1';
  const requireParcel = !requireWaterfront &&
    (familyAtlas || process.env.MALDOROR_REGIONAL_CONTACT_REQUIRE_PARCEL === '1');
  const wanted = new Set(selectedContactAssets.map((asset) => asset.id));
  const found = new Map();
  const rejectedParcelCandidates = new Map();
  const rejectedParcelExamples = new Map();
  let previousRadius = 0;
  for (const radius of [128, 256, 384, 512, 768]) {
    const strips = [
      [-radius, -radius, radius, -previousRadius - 1],
      [-radius, previousRadius + 1, radius, radius],
      [-radius, -previousRadius, -previousRadius - 1, previousRadius],
      [previousRadius + 1, -previousRadius, radius, previousRadius],
    ];
    for (const bounds of strips) {
      if (bounds[0] > bounds[2] || bounds[1] > bounds[3]) continue;
      for (const placement of world.getRouteContactPlacementsInBounds(...bounds)) {
        const family = placement.families[0];
        const familyAlreadyFound = familyAtlas && [...found.values()]
          .some((candidate) => candidate.families[0] === family);
        if (wanted.has(placement.assetId) && !found.has(placement.assetId) && !familyAlreadyFound) {
          if (!requireParcel && !requireWaterfront) {
            found.set(placement.assetId, placement);
            continue;
          }
          const searchBounds = [
            placement.siteX - 24,
            placement.siteY - 24,
            placement.siteX + 24,
            placement.siteY + 24,
          ];
          const hasCore = world.getParcelConnectorCellsInBounds(...searchBounds)
            .some((cell) => cell.parcelId === placement.parcelId && cell.core);
          const components = world.getParcelComponentPlacementsInBounds(...searchBounds)
            .filter((component) => component.parcelId === placement.parcelId);
          const waterfront = world.getWaterfrontLayoutsInBounds(...searchBounds)
            .find((layout) => layout.id.startsWith(`${placement.parcelId}:`));
          const parcelAudit = auditParcel({
            centre: [placement.siteX, placement.siteY],
            parcelId: placement.parcelId,
            accessAxis: placement.accessAxis,
          });
          const waterfrontAudit = parcelAudit?.waterfront;
          const layoutAudit = parcelAudit?.layout;
          const validParcel = components.length > 0 && Boolean(layoutAudit) &&
            parcelAudit.collisionOverlapCells === 0 &&
            parcelAudit.connectorCollisionBlocked === 0 &&
            parcelAudit.connectorVisuallyBlocked === 0 &&
            parcelAudit.connectorMaterialMissing === 0 &&
            parcelAudit.familyMismatchCount === 0 &&
            parcelAudit.componentPathFrameMissing === 0 &&
            layoutAudit.sharedBoundaryMismatch <= 1e-9 &&
            layoutAudit.overlapSampleRate === 0 &&
            layoutAudit.waterIntrusionSampleRate === 0 &&
            layoutAudit.protectedPathIntrusionRate === 0;
          const validWaterfront = waterfront && waterfront.piers.length >= 2 &&
            waterfront.slips.length >= 1 &&
            components.filter((component) => component.waterfrontId === waterfront.id).length >= 2 &&
            parcelAudit.collisionOverlapCells === 0 &&
            parcelAudit.connectorCollisionBlocked === 0 &&
            parcelAudit.connectorVisuallyBlocked === 0 &&
            parcelAudit.connectorMaterialMissing === 0 &&
            parcelAudit.familyMismatchCount === 0 &&
            parcelAudit.componentPathFrameMissing === 0 &&
            waterfrontAudit?.dryProgramRate >= 0.9 &&
            waterfrontAudit.wetPierRate >= 0.9 &&
            waterfrontAudit.wetSlipRate >= 0.9 &&
            waterfrontAudit.pierWalkableRate === 1 &&
            waterfrontAudit.surfaceMissingRate === 0 &&
            waterfrontAudit.componentCount >= 2 &&
            waterfrontAudit.functions.length >= 2;
          if (hasCore && (requireWaterfront ? validWaterfront : (validParcel || validWaterfront))) {
            found.set(placement.assetId, placement);
          } else {
            rejectedParcelCandidates.set(
              placement.assetId,
              (rejectedParcelCandidates.get(placement.assetId) ?? 0) + 1,
            );
            const examples = rejectedParcelExamples.get(placement.assetId) ?? [];
            if (examples.length < 8) examples.push({
              site: [placement.siteX, placement.siteY],
              anchor: [placement.anchorX, placement.anchorY],
              layers: placement.parcelLayers,
            });
            rejectedParcelExamples.set(placement.assetId, examples);
          }
        }
      }
    }
    const complete = familyAtlas
      ? new Set([...found.values()].map((placement) => placement.families[0])).size === BIOME_FAMILIES.length
      : found.size === wanted.size;
    if (complete) break;
    previousRadius = radius;
  }
  const missing = familyAtlas
    ? BIOME_FAMILIES.filter((family) => ![...found.values()]
      .some((placement) => placement.families[0] === family))
    : [...wanted].filter((id) => !found.has(id));
  if (missing.length > 0) {
    const rejections = familyAtlas
      ? missing.join(', ')
      : missing.map((id) => JSON.stringify({
        assetId: id,
        count: rejectedParcelCandidates.get(id) ?? 0,
        examples: rejectedParcelExamples.get(id) ?? [],
      })).join(', ');
    throw new Error(`Could not locate viable regional route contacts: ${rejections}`);
  }
  const contactTileSize = Number(process.env.MALDOROR_REGIONAL_CONTACT_TILE_SIZE ?? 16);
  if (![4, 8, 16].includes(contactTileSize)) {
    throw new Error(`MALDOROR_REGIONAL_CONTACT_TILE_SIZE must be 4, 8, or 16: ${contactTileSize}`);
  }
  const frameAssets = familyAtlas
    ? selectedContactAssets.filter((asset) => found.has(asset.id))
    : selectedContactAssets;
  FRAMES = frameAssets.map((asset) => {
    const placement = found.get(asset.id);
    const connectorCells = world.getParcelConnectorCellsInBounds(
      placement.siteX - 32,
      placement.siteY - 32,
      placement.siteX + 32,
      placement.siteY + 32,
    ).filter((cell) => cell.parcelId === placement.parcelId && cell.core);
    const centre = contactTileSize === 16 || connectorCells.length === 0
      ? [placement.siteX, placement.siteY]
      : [
        Math.round((Math.min(...connectorCells.map((cell) => cell.x)) +
          Math.max(...connectorCells.map((cell) => cell.x))) / 2),
        Math.round((Math.min(...connectorCells.map((cell) => cell.y)) +
          Math.max(...connectorCells.map((cell) => cell.y))) / 2),
      ];
    const scaleName = contactTileSize === 16 ? 'walking' : contactTileSize === 8 ? 'district' : 'regional';
    return {
      name: `${asset.families[0]}-route-contact-${asset.accessAxis}-${scaleName}`,
      centre,
      displayTileSize: contactTileSize,
      assetId: asset.id,
      parcelId: placement.parcelId,
      accessAxis: placement.accessAxis,
      contactSite: [placement.siteX, placement.siteY],
      rejectedParcelCandidates: rejectedParcelCandidates.get(asset.id) ?? 0,
    };
  });
}

if (process.env.MALDOROR_REGIONAL_ENVIRONMENT_ATLAS === '1') {
  const wanted = new Set(environmentKit.assets.map((asset) => asset.id));
  const found = new Map();
  const fixturePath = process.env.MALDOROR_REGIONAL_ENVIRONMENT_LOCATIONS;
  if (fixturePath) {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(fixturePath), 'utf8'));
    for (const frame of fixture.frames ?? []) {
      if (!wanted.has(frame.assetId) || !Array.isArray(frame.anchor)) continue;
      const placement = world.getEnvironmentContactPlacementsInBounds(
        frame.anchor[0], frame.anchor[1], frame.anchor[0], frame.anchor[1],
      ).find((candidate) => candidate.assetId === frame.assetId);
      if (placement && environmentProgramIsExact(placement)) {
        found.set(placement.assetId, placement);
      }
    }
  } else {
    let previousRadius = 0;
    for (const radius of [128, 256, 384, 512, 768, 1024]) {
      const strips = [
        [-radius, -radius, radius, -previousRadius - 1],
        [-radius, previousRadius + 1, radius, radius],
        [-radius, -previousRadius, -previousRadius - 1, previousRadius],
        [previousRadius + 1, -previousRadius, radius, previousRadius],
      ];
      for (const bounds of strips) {
        if (bounds[0] > bounds[2] || bounds[1] > bounds[3]) continue;
        for (const placement of world.getEnvironmentContactPlacementsInBounds(...bounds)) {
          if (wanted.has(placement.assetId) && !found.has(placement.assetId)) {
            if (!environmentProgramIsExact(placement)) continue;
            found.set(placement.assetId, placement);
          }
        }
      }
      if (found.size === wanted.size) break;
      previousRadius = radius;
    }
  }
  const missing = [...wanted].filter((id) => !found.has(id));
  if (missing.length > 0) throw new Error(`Could not locate regional environment contacts: ${missing.join(', ')}`);
  const contactTileSize = Number(process.env.MALDOROR_REGIONAL_ENVIRONMENT_TILE_SIZE ?? 8);
  if (![4, 8, 16].includes(contactTileSize)) {
    throw new Error(`MALDOROR_REGIONAL_ENVIRONMENT_TILE_SIZE must be 4, 8, or 16: ${contactTileSize}`);
  }
  FRAMES = environmentKit.assets.map((asset) => {
    const placement = found.get(asset.id);
    const layout = resolveEnvironmentProgramLayout(placement);
    if (placement.environmentProgram && !layout) {
      throw new Error(
        `Could not build ${placement.environmentProgram} at ${asset.id} (${placement.anchorX},${placement.anchorY})`,
      );
    }
    if (layout) environmentProgramLayouts.set(layout.id, layout);
    const scaleName = contactTileSize === 16 ? 'walking' : contactTileSize === 8 ? 'district' : 'regional';
    return {
      name: `${asset.id}-${scaleName}`,
      centre: layout
        ? [
          Math.round((layout.bounds.minX + layout.bounds.maxX) / 2),
          Math.round((layout.bounds.minY + layout.bounds.maxY) / 2),
        ]
        : [placement.anchorX, placement.anchorY],
      displayTileSize: contactTileSize,
      assetId: asset.id,
      anchor: [placement.anchorX, placement.anchorY],
      environmentProgram: placement.environmentProgram,
      environmentProgramId: placement.environmentProgramId,
    };
  });
}

function renderFrame(frame) {
  const renderer = new ViewportRenderer({
    widthTiles: Math.ceil(WIDTH / frame.displayTileSize),
    heightTiles: Math.ceil(HEIGHT / frame.displayTileSize),
    pixelWidth: WIDTH,
    pixelHeight: HEIGHT,
    tileRenderSize: frame.displayTileSize,
  });
  renderer.setCamera(frame.centre[0], frame.centre[1]);
  return renderer.renderToBuffer(world, 0).buffer;
}

async function writeSource(filename, grid) {
  const colours = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const pixel = grid[y]?.[x] ?? { r: 8, g: 8, b: 12 };
      const offset = (y * WIDTH + x) * 3;
      colours[offset] = pixel.r;
      colours[offset + 1] = pixel.g;
      colours[offset + 2] = pixel.b;
    }
  }
  await sharp(colours, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toFile(filename);
  return colours;
}

async function writeOctant(filename, grid) {
  const cells = renderOctantGridCells(grid);
  const cellWidth = 9;
  const cellHeight = 18;
  const width = cells[0].length * cellWidth;
  const height = cells.length * cellHeight;
  const image = Buffer.alloc(width * height * 3);
  const lookup = new Map();
  OCTANT_CHARS.forEach((character, pattern) => {
    const code = character.codePointAt(0);
    if (!lookup.has(code)) lookup.set(code, pattern);
  });
  const fill = (x0, y0, fillWidth, fillHeight, colour) => {
    for (let y = y0; y < y0 + fillHeight; y++) {
      for (let x = x0; x < x0 + fillWidth; x++) {
        const offset = (y * width + x) * 3;
        image[offset] = colour.r;
        image[offset + 1] = colour.g;
        image[offset + 2] = colour.b;
      }
    }
  };
  for (let y = 0; y < cells.length; y++) {
    for (let x = 0; x < cells[y].length; x++) {
      const cell = cells[y][x];
      const foreground = cell.fgColor ?? { r: 15, g: 15, b: 20 };
      const background = cell.bgColor ?? { r: 15, g: 15, b: 20 };
      fill(x * cellWidth, y * cellHeight, cellWidth, cellHeight, background);
      const pattern = lookup.get(cell.char.codePointAt(0)) ?? 0;
      for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 2; column++) {
          if (!(pattern & (1 << (row * 2 + column)))) continue;
          const x0 = Math.round(column * cellWidth / 2);
          const x1 = Math.round((column + 1) * cellWidth / 2);
          const y0 = Math.round(row * cellHeight / 4);
          const y1 = Math.round((row + 1) * cellHeight / 4);
          fill(x * cellWidth + x0, y * cellHeight + y0, x1 - x0, y1 - y0, foreground);
        }
      }
    }
  }
  await sharp(image, { raw: { width, height, channels: 3 } }).png().toFile(filename);
}

function auditParcel(frame) {
  if (!frame.parcelId || !frame.accessAxis) return null;
  const contactSite = frame.contactSite ?? frame.centre;
  const contacts = world.getRouteContactPlacementsInBounds(
    contactSite[0] - 8,
    contactSite[1] - 8,
    contactSite[0] + 8,
    contactSite[1] + 8,
  );
  const contact = contacts.find((placement) => placement.parcelId === frame.parcelId);
  if (!contact) throw new Error(`Could not resolve parcel audit contact: ${frame.parcelId}`);
  const components = world.getParcelComponentPlacementsInBounds(
    contact.siteX - 32,
    contact.siteY - 32,
    contact.siteX + 32,
    contact.siteY + 32,
  ).filter((placement) => placement.parcelId === contact.parcelId);
  const connectorCells = world.getParcelConnectorCellsInBounds(
    contact.siteX - 32,
    contact.siteY - 32,
    contact.siteX + 32,
    contact.siteY + 32,
  ).filter((cell) => cell.parcelId === contact.parcelId);
  const layout = world.getParcelLayoutsInBounds(
    contact.siteX - 32,
    contact.siteY - 32,
    contact.siteX + 32,
    contact.siteY + 32,
  ).find((candidate) => candidate.pathId === contact.parcelId);
  const waterfront = world.getWaterfrontLayoutsInBounds(
    contact.siteX - 32,
    contact.siteY - 32,
    contact.siteX + 32,
    contact.siteY + 32,
  ).find((candidate) => candidate.id.startsWith(`${contact.parcelId}:`));
  // Candidate discovery can encounter a semantic contact whose generated
  // parcel program is absent or terrain-invalid. That is a normal rejection,
  // not an atlas-harness crash; selected frames are gated on a non-null audit.
  if (!layout && !waterfront) return null;
  const protectedCells = connectorCells.filter((cell) => cell.protected);
  const coreCells = connectorCells.filter((cell) => cell.core);
  const assetById = new Map([
    ...routeContactKit.assets.map((asset) => [asset.id, asset]),
    ...parcelKit.assets.map((asset) => [asset.id, asset]),
  ]);
  const occupied = new Map();
  for (const placement of [contact, ...components]) {
    const asset = assetById.get(placement.assetId);
    if (!asset) throw new Error(`Parcel audit asset is missing: ${placement.assetId}`);
    for (const [offsetX, offsetY] of asset.collision) {
      const key = `${placement.anchorX + offsetX},${placement.anchorY + offsetY}`;
      const owners = occupied.get(key) ?? [];
      owners.push(`${placement.parcelId}:${placement.assetId}`);
      occupied.set(key, owners);
    }
  }
  let collisionBlocked = 0;
  let visuallyBlocked = 0;
  let materialMissing = 0;
  const connectorLength = contact.connectorLength ?? 0;
  for (const cell of protectedCells) {
    if (world.isBuildingAt(cell.x, cell.y)) collisionBlocked++;
    if (world.getBuildingTileAt(cell.x, cell.y)) visuallyBlocked++;
  }
  for (const cell of connectorCells) {
    if (!world.getTile(cell.x, cell.y).id.startsWith('regional-path-access:')) materialMissing++;
  }
  const componentPathFrameMissing = components.filter((placement) => (
    placement.parcelPathId !== (waterfront?.accessPath.id ?? contact.parcelId) ||
    !Number.isFinite(placement.parcelStation) ||
    !Number.isFinite(placement.pathTangentX) ||
    !Number.isFinite(placement.pathTangentY) ||
    Math.abs(Math.hypot(placement.pathTangentX, placement.pathTangentY) - 1) > 1e-6
  )).length;
  let sharedBoundaryMismatch = 0;
  for (const side of layout ? [-1, 1] : []) {
    const sidePlots = layout.plots.filter((plot) => plot.side === side)
      .sort((a, b) => a.stationIndex - b.stationIndex);
    for (let index = 1; index < sidePlots.length; index++) {
      const previous = sidePlots[index - 1];
      const current = sidePlots[index];
      sharedBoundaryMismatch = Math.max(
        sharedBoundaryMismatch,
        pointDistance(previous.polygon[1], current.polygon[0]),
        pointDistance(previous.polygon[2], current.polygon[3]),
      );
    }
  }
  let occupiedSamples = 0;
  let overlapSamples = 0;
  let waterIntrusionSamples = 0;
  for (let y = Math.floor(layout?.bounds.minY ?? 0); y <= Math.ceil(layout?.bounds.maxY ?? -1); y += 0.5) {
    for (let x = Math.floor(layout?.bounds.minX ?? 0); x <= Math.ceil(layout?.bounds.maxX ?? -1); x += 0.5) {
      const owners = layout.plots.filter((plot) => pointInPolygon({ x, y }, plot.polygon)).length;
      if (owners === 0) continue;
      occupiedSamples++;
      if (owners > 1) overlapSamples++;
      if (field.sample(Math.floor(x), Math.floor(y)).isWater) waterIntrusionSamples++;
    }
  }
  const pathIntrusionSamples = coreCells.filter((cell) => (
    layout && sampleRegionalParcelLayout(cell.x + 0.5, cell.y + 0.5, layout).insideWeight > 0.001
  )).length;
  const purposes = Object.fromEntries(['yard', 'garden', 'civic-opening'].map((purpose) => [
    purpose,
    layout?.plots.filter((plot) => plot.purpose === purpose).length ?? 0,
  ]));
  const visited = new Set();
  const queue = coreCells.length > 0 ? [coreCells[0]] : [];
  if (queue.length > 0) visited.add(`${queue[0].x},${queue[0].y}`);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const candidate of coreCells) {
      const key = `${candidate.x},${candidate.y}`;
      if (visited.has(key) || Math.abs(candidate.x - current.x) > 1 ||
          Math.abs(candidate.y - current.y) > 1) continue;
      visited.add(key);
      queue.push(candidate);
    }
  }
  return {
    parcelId: contact.parcelId,
    family: contact.families[0],
    accessAxis: contact.accessAxis,
    routeKind: contact.routeKind,
    layers: contact.parcelLayers,
    connectorLength,
    pathArcLength: connectorCells[0]?.arcLength ?? 0,
    pathLateralOffset: connectorCells[0]?.lateralOffset ?? 0,
    connectorRenderCells: connectorCells.length,
    connectorProtectedCells: protectedCells.length,
    connectorCoreCells: coreCells.length,
    connectorCoreConnected: visited.size === coreCells.length && coreCells.length > 0,
    connectorSpan: connectorCells.length === 0 ? [0, 0] : [
      Math.max(...connectorCells.map((cell) => cell.x)) -
        Math.min(...connectorCells.map((cell) => cell.x)) + 1,
      Math.max(...connectorCells.map((cell) => cell.y)) -
        Math.min(...connectorCells.map((cell) => cell.y)) + 1,
    ],
    componentCount: components.length,
    componentIds: components.map((placement) => placement.assetId),
    familyMismatchCount: components.filter((placement) =>
      !placement.families.includes(contact.families[0])).length,
    componentPathFrameMissing,
    collisionOverlapCells: [...occupied.values()].filter((owners) => owners.length > 1).length,
    connectorCollisionBlocked: collisionBlocked,
    connectorVisuallyBlocked: visuallyBlocked,
    connectorMaterialMissing: materialMissing,
    layout: layout ? {
      plotCount: layout.plots.length,
      boundaryCount: layout.boundaries.length,
      purposes,
      frontageAccessRate: layout.plots.length === 0 ? 0 : layout.plots.filter((plot) => (
        pointDistance(plot.frontageOpening[0], plot.frontageOpening[1]) > 0.5
      )).length / layout.plots.length,
      yardReserveRate: layout.plots.length === 0 ? 0 :
        layout.plots.filter((plot) => plot.yard.length >= 4).length / layout.plots.length,
      uniqueShapeSignatureRate: layout.plots.length === 0 ? 0 : new Set(layout.plots.map((plot) => (
        `${Math.round(plot.frontageWidth * 4)},${Math.round(plot.depth * 4)},${plot.purpose}`
      ))).size / layout.plots.length,
      sharedBoundaryMismatch,
      overlapSampleRate: overlapSamples / Math.max(1, occupiedSamples),
      waterIntrusionSampleRate: waterIntrusionSamples / Math.max(1, occupiedSamples),
      protectedPathIntrusionRate: pathIntrusionSamples / Math.max(1, coreCells.length),
    } : null,
    waterfront: waterfront ? auditWaterfront(waterfront, components) : null,
  };
}

function auditWaterfront(layout, components) {
  const dry = samplePolygons([...layout.workYards, layout.apron], (x, y) => (
    !field.sample(Math.floor(x), Math.floor(y)).isWater
  ));
  const wetPiers = samplePolygons(layout.piers, (x, y) => (
    field.sample(Math.floor(x), Math.floor(y)).isWater
  ));
  const wetSlips = samplePolygons(layout.slips, (x, y) => (
    field.sample(Math.floor(x), Math.floor(y)).isWater
  ));
  const pierCentres = layout.piers.map((pier) => centroid(pier.polygon));
  const pierCentreAudit = pierCentres.map((point) => {
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    const sample = sampleRegionalWaterfrontLayout(x + 0.5, y + 0.5, layout);
    const tile = world.getTile(x, y);
    return {
      x,
      y,
      pierWeight: sample.pierWeight,
      isWater: field.sample(x, y).isWater,
      tileId: tile.id,
      walkable: tile.walkable,
    };
  });
  const pierWalkableRate = pierCentreAudit.filter((point) => point.walkable).length /
    Math.max(1, pierCentreAudit.length);
  let sampledSurfaceCells = 0;
  let missingSurfaceCells = 0;
  for (let y = Math.floor(layout.bounds.minY); y <= Math.ceil(layout.bounds.maxY); y++) {
    for (let x = Math.floor(layout.bounds.minX); x <= Math.ceil(layout.bounds.maxX); x++) {
      const sample = sampleRegionalWaterfrontLayout(x + 0.5, y + 0.5, layout);
      if (Math.max(sample.apronWeight, sample.workYardWeight, sample.pierWeight) <= 0.001) continue;
      sampledSurfaceCells++;
      const tileId = world.getTile(x, y).id;
      if (!tileId.startsWith('regional-waterfront-ground:') &&
          !tileId.startsWith('regional-path-access:')) missingSurfaceCells++;
    }
  }
  return {
    id: layout.id,
    accessPathId: layout.accessPath.id,
    apronCount: 1,
    workYardCount: layout.workYards.length,
    pierCount: layout.piers.length,
    slipCount: layout.slips.length,
    dryProgramRate: dry.rate,
    wetPierRate: wetPiers.rate,
    wetSlipRate: wetSlips.rate,
    pierWalkableRate,
    pierCentreAudit,
    surfaceMissingRate: missingSurfaceCells / Math.max(1, sampledSurfaceCells),
    componentCount: components.filter((placement) => placement.waterfrontId === layout.id).length,
    functions: [...new Set(components
      .filter((placement) => placement.waterfrontId === layout.id)
      .map((placement) => placement.waterfrontFunction)
      .filter(Boolean))].sort(),
  };
}

function samplePolygons(polygons, predicate) {
  let samples = 0;
  let matches = 0;
  for (const polygon of polygons) {
    const minX = Math.floor(Math.min(...polygon.polygon.map((point) => point.x)));
    const maxX = Math.ceil(Math.max(...polygon.polygon.map((point) => point.x)));
    const minY = Math.floor(Math.min(...polygon.polygon.map((point) => point.y)));
    const maxY = Math.ceil(Math.max(...polygon.polygon.map((point) => point.y)));
    for (let y = minY; y <= maxY; y += 0.5) {
      for (let x = minX; x <= maxX; x += 0.5) {
        if (!pointInPolygon({ x, y }, polygon.polygon)) continue;
        samples++;
        if (predicate(x, y)) matches++;
      }
    }
  }
  return { samples, rate: matches / Math.max(1, samples) };
}

function centroid(points) {
  return points.reduce((sum, point) => ({
    x: sum.x + point.x / points.length,
    y: sum.y + point.y / points.length,
  }), { x: 0, y: 0 });
}

function auditEnvironmentContact(frame) {
  const asset = environmentKit.assets.find((candidate) => candidate.id === frame.assetId);
  if (!asset) return null;
  const sample = field.sample(frame.anchor[0], frame.anchor[1]);
  const route = routes.sample(frame.anchor[0], frame.anchor[1]);
  const constraints = asset.constraints;
  let nearbyWater = constraints.nearbyWaterRadius === 0;
  if (!nearbyWater) {
    for (let offsetY = -constraints.nearbyWaterRadius; offsetY <= constraints.nearbyWaterRadius; offsetY++) {
      for (let offsetX = -constraints.nearbyWaterRadius; offsetX <= constraints.nearbyWaterRadius; offsetX++) {
        if (offsetX * offsetX + offsetY * offsetY > constraints.nearbyWaterRadius ** 2) continue;
        if (field.sample(frame.anchor[0] + offsetX, frame.anchor[1] + offsetY).isWater) nearbyWater = true;
      }
    }
  }
  const compatibility = Math.max(...asset.families.map((family) => (
    sample.weights[BIOME_FAMILIES.indexOf(family)] ?? 0
  )));
  const checks = {
    land: !constraints.landOnly || !sample.isWater,
    waterDistance: rangeContains(sample.waterDistance, constraints.waterDistance),
    elevation: rangeContains(sample.elevation, constraints.elevation),
    slope: rangeContains(sample.slope, constraints.slope),
    routeDistance: rangeContains(route.distance, constraints.routeDistance),
    nearbyWater,
    familyCompatibility: compatibility >= 0.18,
  };
  return {
    assetId: asset.id,
    sample: {
      primary: sample.primary,
      elevation: sample.elevation,
      slope: sample.slope,
      waterDistance: sample.waterDistance,
      isWater: sample.isWater,
      routeDistance: route.distance,
      familyCompatibility: compatibility,
    },
    constraints,
    checks,
    mismatchCount: Object.values(checks).filter((value) => !value).length,
  };
}

function auditEnvironmentProgram(frame) {
  if (!frame.environmentProgramId) return null;
  const layout = environmentProgramLayouts.get(frame.environmentProgramId);
  if (!layout) return { id: frame.environmentProgramId, missing: true, mismatchCount: 1 };
  const cells = rasterizeRegionalEnvironmentProgramLayout(layout);
  const walkable = cells.filter((cell) => cell.walkable);
  const walls = cells.filter((cell) => cell.solid && cell.roles.includes('cave-wall'));
  const surfaceMatches = walkable.filter((cell) => (
    world.getTile(cell.x, cell.y).id.startsWith('regional-environment-program:')
  )).length;
  const collisionOpen = walkable.filter((cell) => !world.isBuildingAt(cell.x, cell.y)).length;
  const solidWalls = walls.filter((cell) => world.isBuildingAt(cell.x, cell.y)).length;
  const route = routes.sample(
    Math.floor(layout.routePoint.x),
    Math.floor(layout.routePoint.y),
  );
  const checks = {
    semanticKind: layout.kind === frame.environmentProgram,
    routeConnected: route.isWalkableRoute || route.distance <= 0.55,
    walkableConnected: walkableCellsConnected(walkable),
    surfaceCoverage: surfaceMatches === walkable.length,
    collisionOpen: collisionOpen === walkable.length,
    dry: walkable.every((cell) => !field.sample(cell.x, cell.y).isWater),
    caveGraph: layout.kind !== 'cave-interior' ||
      (layout.interiorPaths.length === 2 && layout.chambers.length === 2 && walls.length > 0),
    caveWallsSolid: layout.kind !== 'cave-interior' || solidWalls === walls.length,
    uphill: layout.kind !== 'highland-ascent' || layout.elevationGain >= 0.018,
    longSwitchbacks: layout.kind !== 'highland-ascent' ||
      (layout.switchbackCount === 3 && layout.traversableLength / layout.directDistance > 1.08),
  };
  return {
    id: layout.id,
    kind: layout.kind,
    routePoint: layout.routePoint,
    anchorPoint: layout.anchorPoint,
    terminalPoint: layout.terminalPoint,
    bounds: layout.bounds,
    interiorPathCount: layout.interiorPaths.length,
    chamberCount: layout.chambers.length,
    walkableCells: walkable.length,
    solidWallCells: walls.length,
    surfaceCoverageRate: surfaceMatches / Math.max(1, walkable.length),
    collisionOpenRate: collisionOpen / Math.max(1, walkable.length),
    solidWallRate: layout.kind === 'cave-interior'
      ? solidWalls / Math.max(1, walls.length)
      : null,
    startElevation: layout.startElevation,
    endElevation: layout.endElevation,
    elevationGain: layout.elevationGain,
    directDistance: layout.directDistance,
    traversableLength: layout.traversableLength,
    pathToDirectRatio: layout.traversableLength / layout.directDistance,
    switchbackCount: layout.switchbackCount,
    checks,
    mismatchCount: Object.values(checks).filter((value) => !value).length,
  };
}

function walkableCellsConnected(cells) {
  const remaining = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
  const first = remaining.values().next().value;
  if (!first) return false;
  const visited = new Set([first]);
  const queue = [first];
  while (queue.length > 0) {
    const current = queue.shift();
    const [x, y] = current.split(',').map(Number);
    for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${x + offsetX},${y + offsetY}`;
      if (!remaining.has(key) || visited.has(key)) continue;
      visited.add(key);
      queue.push(key);
    }
  }
  return visited.size === remaining.size;
}

const metrics = {
  worldSeed: String(WORLD_SEED),
  ambientDistributionProfile: AMBIENT_DISTRIBUTION_PROFILE,
  ambientCompositionProfile: AMBIENT_COMPOSITION_PROFILE,
  ambientPlaceFabricProfile: AMBIENT_PLACE_FABRIC_PROFILE,
  ambientPlaceAccessProfile: AMBIENT_PLACE_ACCESS_PROFILE,
  streetOverlayCoverage,
  ambientDistributionAudit: RUN_AMBIENT_DISTRIBUTION_AUDIT
    ? auditAmbientDistribution(FRAMES[0].centre)
    : null,
  infrastructureProfile: INFRASTRUCTURE_PROFILE_NAME,
  infrastructureVisualProfile: INFRASTRUCTURE_PROFILE,
  waterProfile: WATER_PROFILE_NAME,
  waterVisualProfile: WATER_PROFILE,
  civicDetailProfile: CIVIC_DETAIL_PROFILE_NAME,
  quayDetailProfile: QUAY_DETAIL_PROFILE_NAME,
  quayActivityWorldMinute: QUAY_ACTIVITY_WORLD_MINUTE,
  arrivalWaterwayProfile: ARRIVAL_WATERWAY_PROFILE_NAME,
  arrivalWaterwayConfig: ARRIVAL_WATERWAY_PROFILE,
  quayProfile: QUAY_PROFILE_NAME,
  quayConfig: QUAY_PROFILE,
  sourceDimensions: [WIDTH, HEIGHT],
  terminalDimensions: [WIDTH / 2, HEIGHT / 4],
  landmarkManifest: path.relative(ROOT, landmarkKit.manifestPath),
  landmarkAssets: landmarkKit.assets.length,
  ambientManifest: path.relative(ROOT, ambientKit.manifestPath),
  ambientAssets: ambientKit.assets.length,
  civicDetailManifest: path.relative(ROOT, civicDetailKit.manifestPath),
  civicDetailAssets: civicDetailKit.assets.length,
  quayDetailManifest: path.relative(ROOT, quayDetailKit.manifestPath),
  quayDetailAssets: quayDetailKit.assets.length,
  routeContactManifest: path.relative(ROOT, routeContactKit.manifestPath),
  routeContactAssets: routeContactKit.assets.length,
  parcelComponentManifest: path.relative(ROOT, parcelKit.manifestPath),
  parcelComponentAssets: parcelKit.assets.length,
  environmentContactManifest: path.relative(ROOT, environmentKit.manifestPath),
  environmentContactAssets: environmentKit.assets.length,
  nearbyLandmarkSites: routes.getLandmarkSites(-30, -30, 30, 30).map((site) => ({
    ...site,
    placement: world.resolveLandmarkPlacement(site.x, site.y),
  })),
  frames: [],
};
for (const frame of FRAMES) {
  const startedAt = performance.now();
  const grid = renderFrame(frame);
  const sourcePath = path.join(OUTPUT, `${frame.name}-source.png`);
  const octantPath = path.join(OUTPUT, `${frame.name}-octant-160x44.png`);
  const colours = await writeSource(sourcePath, grid);
  await writeOctant(octantPath, grid);
  const halfWidth = Math.ceil(WIDTH / frame.displayTileSize / 2);
  const halfHeight = Math.ceil(HEIGHT / frame.displayTileSize / 2);
  const visibleBounds = [
    frame.centre[0] - halfWidth,
    frame.centre[1] - halfHeight,
    frame.centre[0] + halfWidth,
    frame.centre[1] + halfHeight,
  ];
  const visibleAmbient = world.getAmbientPlacementsInBounds(...visibleBounds);
  const visibleLandmarkFabrics = world.getLandmarkFabricLayoutsInBounds(...visibleBounds);
  const visiblePlaceConnectors = world.getParcelConnectorCellsInBounds(...visibleBounds)
    .filter((cell) => cell.parcelId.startsWith('place:'));
  metrics.frames.push({
    ...frame,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    sha256: crypto.createHash('sha256').update(colours).digest('hex'),
    fieldStats: field.getStats(),
    routeStats: routes.getStats(),
    compositorStats: compositor.getStats(),
    providerStats: world.getRegionalStats(),
    visibleAmbient,
    visiblePlaceConnectorCells: visiblePlaceConnectors.length,
    visiblePlaceConnectorPrograms: [...new Set(visiblePlaceConnectors.map((cell) => cell.parcelId))],
    landmarkCompositionAudit: auditLandmarkCompositions(visibleAmbient),
    streetOverlayAudit: auditStreetOverlay(frame, visibleAmbient),
    visibleLandmarkFabrics: visibleLandmarkFabrics.map((layout) => ({
      id: layout.id,
      materialFamily: layout.materialFamily,
      connectionMode: layout.connectionMode,
      site: [layout.siteX, layout.siteY],
      aprons: layout.aprons.map((apron) => ({
        id: apron.id,
        role: apron.role,
        axis: apron.axis,
        centre: [apron.centreX, apron.centreY],
        halfAlong: apron.halfAlong,
        halfAcross: apron.halfAcross,
      })),
    })),
    landmarkFabricAudit: auditLandmarkFabrics(visibleLandmarkFabrics),
    quayFrontageAudit: auditQuayFrontage(visibleAmbient),
    visibleCivicDetails: world.getCivicDetailPlacementsInBounds(...visibleBounds),
    visibleQuayDetails: world.getQuayDetailPlacementsInBounds(...visibleBounds),
    visibleRouteContacts: world.getRouteContactPlacementsInBounds(...visibleBounds),
    visibleParcelComponents: world.getParcelComponentPlacementsInBounds(...visibleBounds),
    visibleEnvironmentContacts: world.getEnvironmentContactPlacementsInBounds(...visibleBounds),
    parcelAudit: auditParcel(frame),
    environmentContactAudit: auditEnvironmentContact(frame),
    environmentProgramAudit: auditEnvironmentProgram(frame),
  });
}
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, ...metrics }, null, 2));

function auditAmbientDistribution(centre) {
  const macroCellSize = 48;
  const radius = 192;
  const minCellX = Math.floor((centre[0] - radius) / macroCellSize);
  const minCellY = Math.floor((centre[1] - radius) / macroCellSize);
  const maxCellX = Math.floor((centre[0] + radius - 1) / macroCellSize);
  const maxCellY = Math.floor((centre[1] + radius - 1) / macroCellSize);
  const bounds = [
    minCellX * macroCellSize,
    minCellY * macroCellSize,
    (maxCellX + 1) * macroCellSize - 1,
    (maxCellY + 1) * macroCellSize - 1,
  ];
  const placements = world.getAmbientPlacementsInBounds(...bounds);
  const counts = [];
  for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      counts.push(placements.filter((placement) => (
        Math.floor(placement.anchorX / macroCellSize) === cellX &&
        Math.floor(placement.anchorY / macroCellSize) === cellY
      )).length);
    }
  }
  const mean = counts.reduce((sum, count) => sum + count, 0) / counts.length;
  const standardDeviation = Math.sqrt(counts.reduce((sum, count) => (
    sum + (count - mean) ** 2
  ), 0) / counts.length);
  const nearestBinSize = 16;
  const nearestBins = new Map();
  for (const [index, placement] of placements.entries()) {
    const key = `${Math.floor(placement.anchorX / nearestBinSize)},` +
      `${Math.floor(placement.anchorY / nearestBinSize)}`;
    const entries = nearestBins.get(key) ?? [];
    entries.push(index);
    nearestBins.set(key, entries);
  }
  const maximumBinRadius = Math.ceil(Math.max(
    bounds[2] - bounds[0],
    bounds[3] - bounds[1],
  ) / nearestBinSize) + 1;
  const nearestDistances = placements.map((placement, index) => {
    const binX = Math.floor(placement.anchorX / nearestBinSize);
    const binY = Math.floor(placement.anchorY / nearestBinSize);
    let nearest = Number.POSITIVE_INFINITY;
    for (let radius = 0; radius <= maximumBinRadius; radius++) {
      for (let offsetY = -radius; offsetY <= radius; offsetY++) {
        for (let offsetX = -radius; offsetX <= radius; offsetX++) {
          if (radius > 0 && Math.abs(offsetX) !== radius && Math.abs(offsetY) !== radius) continue;
          for (const candidateIndex of nearestBins.get(`${binX + offsetX},${binY + offsetY}`) ?? []) {
            if (candidateIndex === index) continue;
            const candidate = placements[candidateIndex];
            nearest = Math.min(nearest, Math.hypot(
              placement.anchorX - candidate.anchorX,
              placement.anchorY - candidate.anchorY,
            ));
          }
        }
      }
      if (Number.isFinite(nearest) && nearest <= radius * nearestBinSize) break;
    }
    return nearest;
  }).filter(Number.isFinite).sort((a, b) => a - b);
  const coordinateCounts = new Map();
  for (const placement of placements) {
    const key = `${placement.anchorX},${placement.anchorY}`;
    const entries = coordinateCounts.get(key) ?? [];
    entries.push(`${placement.siteX},${placement.siteY}:${placement.assetId}`);
    coordinateCounts.set(key, entries);
  }
  const duplicateCoordinates = [...coordinateCounts.entries()]
    .filter(([, entries]) => entries.length > 1)
    .sort(([left], [right]) => left.localeCompare(right));
  const sortedCounts = [...counts].sort((a, b) => a - b);
  return {
    centre,
    bounds,
    macroCellSize,
    macroCellCount: counts.length,
    placementCount: placements.length,
    countMean: Number(mean.toFixed(4)),
    countStandardDeviation: Number(standardDeviation.toFixed(4)),
    countCoefficientOfVariation: Number((standardDeviation / Math.max(mean, 1e-9)).toFixed(4)),
    emptyMacroCellRate: Number((counts.filter((count) => count === 0).length / counts.length).toFixed(4)),
    minimumMacroCellCount: sortedCounts[0] ?? 0,
    medianMacroCellCount: sortedCounts[Math.floor(sortedCounts.length / 2)] ?? 0,
    maximumMacroCellCount: sortedCounts.at(-1) ?? 0,
    exactDuplicateAnchorCount: duplicateCoordinates.reduce(
      (total, [, entries]) => total + entries.length - 1,
      0,
    ),
    exactDuplicateAnchorExamples: duplicateCoordinates.slice(0, 8).map(([anchor, entries]) => ({
      anchor,
      entries,
    })),
    minimumNearestDistance: Number((nearestDistances[0] ?? 0).toFixed(4)),
    medianNearestDistance: Number((
      nearestDistances[Math.floor(nearestDistances.length / 2)] ?? 0
    ).toFixed(4)),
  };
}

function auditLandmarkFabrics(layouts) {
  const audits = layouts.map((layout) => {
    const cells = rasterizeRegionalLandmarkFabricLayout(layout);
    const routeDistances = cells.map((cell) => routes.sample(cell.x, cell.y).distance);
    const walkableCells = cells.filter((cell) => world.getTile(cell.x, cell.y).walkable).length;
    const surfaceCells = cells.filter((cell) => (
      world.getTile(cell.x, cell.y).id.includes(`regional-landmark-fabric:${layout.id}`)
    )).length;
    const thresholdCount = layout.aprons.filter((apron) => apron.role === 'threshold').length;
    const approachCount = layout.aprons.filter((apron) => apron.role === 'approach').length;
    const spineCount = layout.aprons.filter((apron) => apron.role === 'spine').length;
    const commons = layout.aprons.filter((apron) => apron.role === 'common');
    const commonCount = commons.length;
    const common = commons[0];
    const publicCore = common ? [
      [common.centreX, common.centreY],
      [
        common.centreX + (common.axis === 'north-south' ? 0 : common.halfAlong * 0.45),
        common.centreY + (common.axis === 'north-south' ? common.halfAlong * 0.45 : 0),
      ],
      [
        common.centreX - (common.axis === 'north-south' ? 0 : common.halfAlong * 0.45),
        common.centreY - (common.axis === 'north-south' ? common.halfAlong * 0.45 : 0),
      ],
      [
        common.centreX + (common.axis === 'north-south' ? common.halfAcross * 0.45 : 0),
        common.centreY + (common.axis === 'north-south' ? 0 : common.halfAcross * 0.45),
      ],
      [
        common.centreX - (common.axis === 'north-south' ? common.halfAcross * 0.45 : 0),
        common.centreY - (common.axis === 'north-south' ? 0 : common.halfAcross * 0.45),
      ],
    ] : [];
    const publicCorePaved = publicCore.filter(([x, y]) => (
      sampleRegionalLandmarkFabricLayout(x, y, layout).pavingWeight > 0.9
    )).length;
    const publicCoreWalkable = publicCore.filter(([x, y]) => (
      world.getTile(Math.floor(x), Math.floor(y)).walkable
    )).length;
    const minimumRouteDistance = Math.min(...routeDistances);
    const routeValid = layout.connectionMode === 'route-threshold' &&
      minimumRouteDistance <= 1 && thresholdCount > 0 && thresholdCount === approachCount;
    const internalValid = layout.connectionMode === 'internal-spine' &&
      spineCount === 1 && thresholdCount > 0 && thresholdCount === approachCount;
    const sharedCommonValid = layout.connectionMode === 'shared-common' &&
      commonCount === 1 && spineCount === 1 && thresholdCount >= 2 &&
      thresholdCount === approachCount && publicCore.length === 5 &&
      publicCorePaved === publicCore.length && publicCoreWalkable === publicCore.length;
    return {
      id: layout.id,
      materialFamily: layout.materialFamily,
      connectionMode: layout.connectionMode,
      cellCount: cells.length,
      thresholdCount,
      approachCount,
      spineCount,
      commonCount,
      publicCorePaved,
      publicCoreWalkable,
      minimumRouteDistance,
      walkableRate: cells.length > 0 ? walkableCells / cells.length : 0,
      renderedSurfaceRate: cells.length > 0 ? surfaceCells / cells.length : 0,
      valid: cells.length > 0 && (routeValid || internalValid || sharedCommonValid) &&
        (layout.connectionMode === 'shared-common' || walkableCells === cells.length) &&
        surfaceCells > 0,
    };
  });
  return {
    layoutCount: audits.length,
    allValid: audits.every((audit) => audit.valid),
    audits,
  };
}

function auditLandmarkCompositions(placements) {
  const assetById = new Map(parcelKit.assets.map((asset) => [asset.id, asset]));
  const focalIds = new Set(parcelKit.assets
    .filter((asset) => asset.compositionRole === 'focal')
    .map((asset) => asset.id));
  const focalSites = new Set(placements
    .filter((placement) => focalIds.has(placement.assetId))
    .map((placement) => `${placement.siteX},${placement.siteY}`));
  const compositions = [...focalSites].sort().map((site) => {
    const members = placements.filter((placement) => (
      `${placement.siteX},${placement.siteY}` === site
    ));
    const groups = members.map((placement) => {
      const asset = assetById.get(placement.assetId);
      return asset?.visualGroup ?? `asset:${placement.assetId}`;
    });
    const counts = Object.fromEntries([...new Set(groups)].sort().map((group) => [
      group,
      groups.filter((candidate) => candidate === group).length,
    ]));
    const duplicateVisualGroups = Object.entries(counts)
      .filter(([, count]) => count > 1)
      .map(([group]) => group);
    return {
      site,
      memberCount: members.length,
      assetIds: members.map((placement) => placement.assetId).sort(),
      visualGroups: counts,
      duplicateVisualGroups,
      valid: duplicateVisualGroups.length === 0,
    };
  });
  return {
    compositionCount: compositions.length,
    allVisualGroupsUnique: compositions.every((composition) => composition.valid),
    compositions,
  };
}

function auditStreetOverlay(frame, placements) {
  if (!frame.streetSite) return null;
  const street = placements.filter((placement) => (
    placement.siteX === frame.streetSite[0] && placement.siteY === frame.streetSite[1] &&
    placement.parcelPathId?.endsWith(':street-overlay')
  ));
  const assetById = new Map(parcelKit.assets.map((asset) => [asset.id, asset]));
  const assets = street.map((placement) => assetById.get(placement.assetId));
  const streetGroups = new Set(assets.filter(Boolean).map((asset) => (
    asset.visualGroup ?? asset.id
  )));
  const visibleStreetGroupCounts = Object.fromEntries([...streetGroups].sort().map((group) => [
    group,
    placements.filter((placement) => {
      const asset = assetById.get(placement.assetId);
      return asset && (asset.visualGroup ?? asset.id) === group;
    }).length,
  ]));
  const axisOf = (placement) => Math.abs(placement.pathTangentX ?? 0) >
    Math.abs(placement.pathTangentY ?? 0) ? 'east-west' : 'north-south';
  const checks = {
    pairVisible: street.length === 2,
    expectedAssets: street.length === 2 &&
      [...street.map((placement) => placement.assetId)].sort().join('|') ===
      [...frame.streetAssets].sort().join('|'),
    familyExact: street.length === 2 && street.every((placement) => (
      placement.families.includes(frame.streetFamily)
    )),
    axisExact: street.length === 2 && street.every((placement) => (
      axisOf(placement) === frame.streetAxis
    )),
    oppositeSides: assets.length === 2 && assets.every(Boolean) &&
      new Set(assets.map((asset) => asset.compositionSide)).has(-1) &&
      new Set(assets.map((asset) => asset.compositionSide)).has(1),
    visualGroupsUnique: assets.length === 2 && assets.every(Boolean) &&
      new Set(assets.map((asset) => asset.visualGroup ?? asset.id)).size === 2,
    streetGroupsUniqueInFrame: Object.values(visibleStreetGroupCounts).every((count) => count === 1),
  };
  return {
    site: frame.streetSite,
    family: frame.streetFamily,
    axis: frame.streetAxis,
    assetIds: street.map((placement) => placement.assetId).sort(),
    anchors: street.map((placement) => [placement.anchorX, placement.anchorY]),
    visibleStreetGroupCounts,
    checks,
    mismatchCount: Object.values(checks).filter((value) => !value).length,
  };
}

function auditQuayFrontage(placements) {
  const frontage = placements.filter((placement) => placement.waterfrontId !== undefined);
  const unique = new Map();
  for (const placement of frontage) {
    const key = `${placement.anchorX},${placement.anchorY}:${placement.waterfrontId}`;
    if (!unique.has(key)) unique.set(key, placement);
  }
  const accessAudit = [...unique.values()].filter((placement) => placement.quayAccessPath)
    .map((placement) => {
      const asset = parcelKit.assets.find((candidate) => candidate.id === placement.assetId);
      const path = placement.quayAccessPath;
      const expectedStart = asset?.quayAccessOffset
        ? [
          placement.anchorX + asset.quayAccessOffset[0],
          placement.anchorY + asset.quayAccessOffset[1],
        ]
        : null;
      const end = path.at(-1);
      const endTile = end ? world.getTile(end[0], end[1]) : null;
      const connected = path.every((cell, index) => index === 0 || (
        Math.abs(cell[0] - path[index - 1][0]) + Math.abs(cell[1] - path[index - 1][1]) === 1
      ));
      const collisionFree = path.every(([x, y]) => !world.isBuildingAt(x, y));
      const walkable = path.every(([x, y]) => world.getTile(x, y).walkable);
      const startMatchesManifest = expectedStart !== null && path[0]?.[0] === expectedStart[0] &&
        path[0]?.[1] === expectedStart[1];
      const reachesDeclaredQuay = endTile?.id.includes(`regional-quay-ground:${placement.waterfrontId}`)
        ?? false;
      return {
        assetId: placement.assetId,
        owner: [placement.siteX, placement.siteY],
        anchor: [placement.anchorX, placement.anchorY],
        waterway: placement.waterfrontId,
        path,
        pathLength: path.length,
        startMatchesManifest,
        connected,
        collisionFree,
        walkable,
        reachesDeclaredQuay,
        endTileId: endTile?.id ?? null,
        valid: startMatchesManifest && connected && collisionFree && walkable && reachesDeclaredQuay,
      };
    });
  return {
    frontageCount: frontage.length,
    uniquePhysicalFrontageCount: unique.size,
    physicalDuplicateCount: frontage.length - unique.size,
    axes: [...new Set([...unique.values()].map((placement) => placement.accessAxis))].sort(),
    waterways: [...new Set([...unique.values()].map((placement) => placement.waterfrontId))].sort(),
    sideCanalCount: [...unique.values()].filter(
      (placement) => placement.accessAxis === 'north-south',
    ).length,
    declaredAccessCount: accessAudit.length,
    allAccessValid: accessAudit.every((audit) => audit.valid),
    accessAudit,
  };
}

function rangeContains(value, range) {
  return value >= range[0] && (range[1] >= 999 || value <= range[1]);
}

function pointDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
