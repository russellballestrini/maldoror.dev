/** Faithful production-provider lab for route-site regional landmarks. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  loadRegionalAmbientKit,
  loadRegionalBiomeMaterialKit,
  loadRegionalEnvironmentContactKit,
  loadRegionalLandmarkKit,
  loadRegionalParcelComponentKit,
  loadRegionalRouteMaterialKit,
  loadRegionalRouteContactKit,
} from '../../apps/ssh-world/dist/game/biome-assets.js';
import {
  BIOME_FAMILIES,
  BiomeWorldField,
  RegionalMaterialCompositor,
  RegionalRouteField,
  RegionalWorldTileProvider,
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
const WIDTH = 320;
const HEIGHT = 176;
const FRAME_FILTER = process.env.MALDOROR_REGIONAL_LANDMARK_FRAME;
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
  if (![4, 8, 16].includes(displayTileSize)) {
    throw new Error(`Invalid landmark display tile size: ${displayTileSize}`);
  }
  FRAMES = [{
    name: displayTileSize === 16 ? 'custom-walking' :
      displayTileSize === 8 ? 'custom-district' : 'custom-regional',
    centre,
    displayTileSize,
  }];
}

fs.mkdirSync(OUTPUT, { recursive: true });
const field = new BiomeWorldField(WORLD_SEED, { blockSize: 16, maxCachedBlocks: 32 });
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
  routeContactKit,
  parcelKit,
  environmentKit,
] = await Promise.all([
  loadRegionalBiomeMaterialKit(path.join(ROOT, 'assets/biomes/manifest.json')),
  loadRegionalRouteMaterialKit(path.join(ROOT, 'assets/routes/manifest.json')),
  loadRegionalLandmarkKit(path.join(ROOT, 'assets/biomes/landmarks-manifest.json')),
  loadRegionalAmbientKit(path.join(ROOT, 'assets/biomes/ambient-manifest.json')),
  loadRegionalRouteContactKit(path.join(ROOT, 'assets/biomes/route-contacts-manifest.json')),
  loadRegionalParcelComponentKit(path.join(ROOT, 'assets/biomes/parcel-components-manifest.json')),
  loadRegionalEnvironmentContactKit(path.join(ROOT, 'assets/biomes/environment-contacts-manifest.json')),
]);
if (new Set([landmarkKit.blockSize, ambientKit.blockSize, routeContactKit.blockSize]).size !== 1) {
  throw new Error('Regional landmark, ambient, and route-contact block sizes disagree');
}
const compositor = new RegionalMaterialCompositor({
  worldSeed: WORLD_SEED,
  field,
  materials: biomeKit.materials,
  overviewMaterials: biomeKit.overviewMaterials,
  routes,
  routeMaterials: routeKit.routeMaterials,
  crossingMaterials: routeKit.crossingMaterials,
  maxCachedTiles: 4096,
  variantPeriodTiles: 5,
  textureScaleTiles: 7,
  maxOutputResolution: Math.min(biomeKit.sourceTileSize, routeKit.sourceTileSize),
});
const world = new RegionalWorldTileProvider({
  worldSeed: WORLD_SEED,
  field,
  routes,
  compositor,
  landmarks: landmarkKit.assets,
  ambient: ambientKit.assets,
  routeContacts: routeContactKit.assets,
  parcelComponents: parcelKit.assets,
  environmentContacts: environmentKit.assets,
  blockSize: landmarkKit.blockSize,
  maxCachedBlocks: 64,
  ambientCellSize: ambientKit.cellSize,
  ambientDensity: ambientKit.density,
  ambientLandmarkClearance: ambientKit.landmarkClearance,
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
  process.env.MALDOROR_REGIONAL_CONTACT_ATLAS,
  process.env.MALDOROR_REGIONAL_ENVIRONMENT_ATLAS,
].filter((value) => value === '1').length;
if (ATLAS_MODES > 1) {
  throw new Error('Choose one regional atlas mode');
}

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
          const validWaterfront = waterfront && waterfront.piers.length >= 2 &&
            waterfront.slips.length >= 1 &&
            components.filter((component) => component.waterfrontId === waterfront.id).length >= 2;
          if (hasCore && (requireWaterfront ? validWaterfront : components.length > 0)) {
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
      if (placement) found.set(placement.assetId, placement);
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
    const scaleName = contactTileSize === 16 ? 'walking' : contactTileSize === 8 ? 'district' : 'regional';
    return {
      name: `${asset.id}-${scaleName}`,
      centre: [placement.anchorX, placement.anchorY],
      displayTileSize: contactTileSize,
      assetId: asset.id,
      anchor: [placement.anchorX, placement.anchorY],
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
  const contacts = world.getRouteContactPlacementsInBounds(
    frame.centre[0] - 8,
    frame.centre[1] - 8,
    frame.centre[0] + 8,
    frame.centre[1] + 8,
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
  if (!layout && !waterfront) throw new Error(`Could not resolve parcel program: ${contact.parcelId}`);
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
  const pierWalkableRate = pierCentres.filter((point) => (
    world.getTile(Math.floor(point.x), Math.floor(point.y)).walkable
  )).length / Math.max(1, pierCentres.length);
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

const metrics = {
  worldSeed: String(WORLD_SEED),
  sourceDimensions: [WIDTH, HEIGHT],
  terminalDimensions: [WIDTH / 2, HEIGHT / 4],
  landmarkManifest: path.relative(ROOT, landmarkKit.manifestPath),
  landmarkAssets: landmarkKit.assets.length,
  ambientManifest: path.relative(ROOT, ambientKit.manifestPath),
  ambientAssets: ambientKit.assets.length,
  routeContactManifest: path.relative(ROOT, routeContactKit.manifestPath),
  routeContactAssets: routeContactKit.assets.length,
  parcelComponentManifest: path.relative(ROOT, parcelKit.manifestPath),
  parcelComponentAssets: parcelKit.assets.length,
  environmentContactManifest: path.relative(ROOT, environmentKit.manifestPath),
  environmentContactAssets: environmentKit.assets.length,
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
  metrics.frames.push({
    ...frame,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    sha256: crypto.createHash('sha256').update(colours).digest('hex'),
    fieldStats: field.getStats(),
    routeStats: routes.getStats(),
    compositorStats: compositor.getStats(),
    providerStats: world.getRegionalStats(),
    visibleAmbient: world.getAmbientPlacementsInBounds(...visibleBounds),
    visibleRouteContacts: world.getRouteContactPlacementsInBounds(...visibleBounds),
    visibleParcelComponents: world.getParcelComponentPlacementsInBounds(...visibleBounds),
    visibleEnvironmentContacts: world.getEnvironmentContactPlacementsInBounds(...visibleBounds),
    parcelAudit: auditParcel(frame),
    environmentContactAudit: auditEnvironmentContact(frame),
  });
}
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, ...metrics }, null, 2));

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
