import type {
  BuildingDirection,
  BuildingSprite,
  BuildingTileData,
  PackedPixelGrid,
  Pixel,
  PixelGrid,
  Tile,
  WorldLightSource,
} from '@maldoror/protocol';
import {
  BIOME_FAMILIES,
  type BiomeFamily,
  type BiomeWorldSample,
  type ConstructedWaterwayDescriptor,
  type ConstructedWaterwaySample,
} from '../biomes/biome-world-field.js';
import { spatialHash2DUnit } from '../spatial-hash.js';
import type {
  RegionalLandmarkKind,
  RegionalLandmarkSite,
  RegionalRouteKind,
  RegionalRouteSample,
} from '../routes/regional-route-field.js';
import { RegionalMaterialCompositor } from './regional-material-compositor.js';
import {
  buildRegionalParcelLayout,
  rasterizeRegionalParcelLayout,
  type RegionalParcelDepthSample,
  type RegionalParcelLayout,
} from './regional-parcel-layout.js';
import {
  buildRegionalParcelPath,
  rasterizeRegionalParcelPath,
  sampleRegionalParcelPath,
  type RegionalParcelPath,
} from './regional-parcel-path.js';
import {
  buildRegionalWaterfrontLayout,
  rasterizeRegionalWaterfrontLayout,
  sampleRegionalWaterfrontLayout,
  type RegionalWaterfrontLayout,
} from './regional-waterfront-layout.js';
import {
  buildRegionalEnvironmentProgramLayout,
  rasterizeRegionalEnvironmentProgramLayout,
  type RegionalEnvironmentProgramKind,
  type RegionalEnvironmentProgramLayout,
} from './regional-environment-program-layout.js';
import {
  buildRegionalLandmarkFabricLayout,
  rasterizeRegionalLandmarkFabricLayout,
  type RegionalLandmarkFabricLayout,
  type RegionalLandmarkFocalFootprint,
} from './regional-landmark-fabric-layout.js';
import {
  buildRegionalQuayLayout,
  regionalQuayCellIsWalkable,
  sampleRegionalQuayLayout,
  type RegionalQuayLayout,
} from './regional-quay-layout.js';
import { TileProvider, type TileProviderConfig } from './tile-provider.js';

export interface RegionalVisualAsset {
  id: string;
  families: readonly BiomeFamily[];
  sprite: BuildingSprite;
  /** Tile within the sprite that owns the world anchor. Sparse vertical art
   * defaults to bottom-centre; route contacts can instead straddle an access
   * corridor around a central anchor. */
  spriteAnchor?: readonly [number, number];
  /** Solid offsets relative to the sprite's declared anchor (bottom-centre by
   * default). Open thresholds remain absent for entrances and gates. */
  collision: ReadonlyArray<readonly [number, number]>;
  /** Authored semantic light source, independent of ID and raster colours. */
  emitsLight?: boolean;
}

export interface RegionalLandmarkAsset extends RegionalVisualAsset {
  landmarkKinds: readonly RegionalLandmarkKind[];
}

export interface RegionalAmbientAsset extends RegionalVisualAsset {
  /** Eligible distance band from the regional route graph. A maximum of 999
   * means unbounded, including terrain outside any cached route influence. */
  routeDistance: readonly [number, number];
}

/** A small authored social/utility silhouette that occupies the civic shoulder
 * around a route landmark. All eligibility is manifest-owned so the placement
 * grammar never branches on an asset ID or attempts to infer use from pixels. */
export interface RegionalCivicDetailAsset extends RegionalVisualAsset {
  role: 'civic-detail';
  routeDistance: readonly [number, number];
  landmarkDistance: readonly [number, number];
  minimumFamilyWeight: number;
}

export type RegionalQuayDetailSurface = 'water' | 'quay';
export type RegionalQuayDetailAxis = 'north-south' | 'east-west' | 'any';

/** Persistent-world-time visual motion along the owning waterway tangent.
 * Collision remains at the authored wet anchor because water is already
 * non-walkable; every visual destination is revalidated against hydrology. */
export interface RegionalQuayDetailActivity {
  tangentDriftTiles: number;
  cycleMinutes: number;
  phaseOffset: number;
}

/** Authored water-edge activity whose placement is governed by continuous
 * constructed-waterway geometry. The manifest declares its physical surface,
 * tangent axis, signed bank-distance envelope, spacing, and bounded count; no
 * behavior is inferred from IDs or raster colours. */
export interface RegionalQuayDetailAsset extends RegionalVisualAsset {
  role: 'quay-detail';
  surface: RegionalQuayDetailSurface;
  waterwayAxis: RegionalQuayDetailAxis;
  bankDistance: readonly [number, number];
  progressRange: readonly [number, number];
  minimumFamilyWeight: number;
  minimumSpacing: number;
  maximumPerLandmark: number;
  placementPriority: number;
  activity?: RegionalQuayDetailActivity;
}

export type RegionalRouteContactAxis = 'north-south' | 'east-west';

export interface RegionalRouteContactAsset extends RegionalVisualAsset {
  /** Axis of the narrow walkable connector through the authored threshold.
   * The boundary mass itself is perpendicular to this axis. */
  accessAxis: RegionalRouteContactAxis;
  routeDistance: readonly [number, number];
}

/** Authored silhouette module placed inside a procedural parcel envelope.
 * Threshold art and ground surfaces remain separate semantic layers. */
export type RegionalParcelProgram = 'waterfront';
export type RegionalWaterfrontFunction =
  | 'boat-repair'
  | 'boat-shed'
  | 'fish-processing'
  | 'inn'
  | 'market'
  | 'shelter'
  | 'warehouse'
  | 'workshop';

export interface RegionalParcelComponentAsset extends RegionalVisualAsset {
  role: 'mass';
  /** Manifest-owned identity for semantic entries that share one authored
   * silhouette. Selection budgets repetition by this group rather than by ID,
   * so axis/role variants cannot masquerade as visual variety. */
  visualGroup?: string;
  /** A rare authored place-fabric anchor that should establish the local
   * composition before smaller support masses are placed. Omitted assets are
   * ordinary supports; this semantic is manifest-owned, never pixel-inferred. */
  compositionRole?: 'focal';
  /** Screen-space route axis this unrotated frontage was authored to face. */
  frontageAxis?: RegionalRouteContactAxis;
  /** Side of the route occupied by this focal's building mass. */
  compositionSide?: -1 | 1;
  /** Normalized authored access stations along the visible frontage. */
  frontageStations?: readonly number[];
  /** Optional district programs supported by this mass. Generic parcels may
   * still reuse it; specialized programs never infer function from its ID. */
  programs?: readonly RegionalParcelProgram[];
  waterfrontFunction?: RegionalWaterfrontFunction;
  /** Constructed-waterway bank this unrotated facade was authored to occupy.
   * Omitted assets remain valid for ordinary waterfront parcels, but are not
   * eligible for continuous quay frontage. */
  quayBankSide?: -1 | 1;
  /** Collision-free doorway/access tile relative to the placement anchor.
   * When declared, frontage placement must prove a bounded dry path from this
   * point to the same constructed quay. */
  quayAccessOffset?: readonly [number, number];
}

export interface RegionalEnvironmentConstraints {
  landOnly: boolean;
  waterDistance: readonly [number, number];
  elevation: readonly [number, number];
  slope: readonly [number, number];
  routeDistance: readonly [number, number];
  nearbyWaterRadius: number;
}

/** A geography-bound silhouette. Placement is driven entirely by numeric
 * physical constraints, never by IDs, filename cases, or inferred pixels. */
export interface RegionalEnvironmentContactAsset extends RegionalVisualAsset {
  role: 'environment-contact';
  constraints: RegionalEnvironmentConstraints;
  program?: RegionalEnvironmentProgramKind;
}

export interface RegionalAssetPlacement {
  assetId: string;
  kind: 'landmark' | 'ambient' | 'civic-detail' | 'quay-detail' | 'environment-contact' |
    'route-contact' | 'parcel-component';
  families: readonly BiomeFamily[];
  siteX: number;
  siteY: number;
  anchorX: number;
  anchorY: number;
  visualAnchorX?: number;
  visualAnchorY?: number;
  parcelId?: string;
  accessAxis?: RegionalRouteContactAxis;
  routeKind?: RegionalRouteKind;
  parcelLayers?: number;
  connectorLength?: number;
  parcelPathId?: string;
  parcelStation?: number;
  pathTangentX?: number;
  pathTangentY?: number;
  waterfrontId?: string;
  waterfrontFunction?: RegionalWaterfrontFunction;
  quayAccessPath?: readonly (readonly [number, number])[];
  environmentProgram?: RegionalEnvironmentProgramKind;
  environmentProgramId?: string;
}

export type RegionalLandmarkPlacement = RegionalAssetPlacement;

export interface RegionalWorldBiomeSampler {
  sample(worldX: number, worldY: number): BiomeWorldSample;
  prewarm?(minX: number, minY: number, maxX: number, maxY: number): void;
  getConstructedWaterways?(): readonly ConstructedWaterwayDescriptor[];
  sampleConstructedWaterway?(
    worldX: number,
    worldY: number,
    waterwayId?: string,
  ): ConstructedWaterwaySample | null;
}

export interface RegionalWorldRouteSampler {
  sample(worldX: number, worldY: number): RegionalRouteSample;
  prewarm?(minX: number, minY: number, maxX: number, maxY: number): void;
  getLandmarkSites?(minX: number, minY: number, maxX: number, maxY: number): RegionalLandmarkSite[];
}

export interface RegionalPrewarmResult {
  biomeBoundsPrimed: boolean;
  routeBoundsPrimed: boolean;
  terrainTilesPrimed: number;
  providerBlocksPrimed: number;
  resolution: number;
}

export interface RegionalPreparedTerrainTile {
  x: number;
  y: number;
  tile: Tile;
}

export interface RegionalPreparedOverlayTile {
  x: number;
  y: number;
  tile: BuildingTileData;
}

/** Minimal coordinate-stable program for a time-dependent authored detail.
 * The raster asset and activity semantics remain manifest-owned at runtime. */
export interface RegionalPreparedDynamicPlacement {
  assetId: string;
  anchorX: number;
  anchorY: number;
  pathTangentX?: number;
  pathTangentY?: number;
  parcelPathId?: string;
}

/**
 * Structured-clone-safe output from an off-thread regional generator.
 *
 * Every coordinate in `bounds` has exactly one terrain entry. Missing overlay
 * and solid entries are authoritative negative results inside the rectangle,
 * so importing a package never falls through to cold procedural generation.
 */
export interface RegionalPreparedViewport {
  version: 1;
  worldSeed: string;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  resolution: number;
  terrain: RegionalPreparedTerrainTile[];
  overlays: RegionalPreparedOverlayTile[];
  solid: Array<readonly [number, number]>;
  dynamicPlacements: RegionalPreparedDynamicPlacement[];
}

/** Transferable counterpart of RegionalPreparedViewport. Terrain and overlay
 * rasters are tile-major RGBA; material and collision ownership are compact
 * byte planes. Only six ArrayBuffers cross the worker boundary. */
export interface RegionalPackedPreparedViewport {
  version: 3;
  worldSeed: string;
  bounds: RegionalPreparedViewport['bounds'];
  resolution: number;
  terrainRgba: Uint8Array;
  terrainMaterial: Uint8Array;
  terrainWalkable: Uint8Array;
  overlayCoordinates: Int32Array;
  overlayRgba: Uint8Array;
  solid: Uint8Array;
  dynamicPlacements: RegionalPreparedDynamicPlacement[];
}

export type RegionalPreparedViewportPayload =
  | RegionalPreparedViewport
  | RegionalPackedPreparedViewport;

export type RegionalAmbientDistributionProfile =
  | 'uniform-blue-noise'
  | 'density-field-blue-noise'
  | 'legacy-cluster-field-blue-noise'
  | 'cluster-field-blue-noise';

export interface RegionalWorldTileProviderConfig extends TileProviderConfig {
  field: RegionalWorldBiomeSampler;
  routes: RegionalWorldRouteSampler;
  compositor: RegionalMaterialCompositor;
  landmarks: readonly RegionalLandmarkAsset[];
  ambient?: readonly RegionalAmbientAsset[];
  civicDetails?: readonly RegionalCivicDetailAsset[];
  quayDetails?: readonly RegionalQuayDetailAsset[];
  routeContacts?: readonly RegionalRouteContactAsset[];
  parcelComponents?: readonly RegionalParcelComponentAsset[];
  environmentContacts?: readonly RegionalEnvironmentContactAsset[];
  blockSize?: number;
  maxCachedBlocks?: number;
  ambientCellSize?: number;
  ambientDensity?: number;
  /** Family-neutral macro distribution layered above the local blue-noise-like
   * priority thinning. Research can compare profiles without changing asset,
   * terrain, route, collision, or cache semantics. */
  ambientDistributionProfile?: RegionalAmbientDistributionProfile;
  ambientLandmarkClearance?: number;
  civicDetailCellSize?: number;
  civicDetailDensity?: number;
  quayDetailDensity?: number;
  /** Stable fallback used before a runtime world-life snapshot is installed
   * and by render research that intentionally omits atmosphere grading. */
  quayDetailDefaultWorldMinute?: number;
  quayWidth?: number;
  quayEdgeVariation?: number;
  quayFrontageDepth?: number;
  routeContactCellSize?: number;
  routeContactDensity?: number;
  routeContactLandmarkClearance?: number;
  maxCachedRouteContactCells?: number;
  parcelMinimumLayers?: number;
  parcelMaximumLayers?: number;
  parcelLayerSpacing?: number;
  environmentContactCellSize?: number;
  environmentContactDensity?: number;
  environmentContactLandmarkClearance?: number;
  maxCachedEnvironmentContactCells?: number;
  maxPreparedViewports?: number;
  derivedCache?: RegionalWorldDerivedCache;
  /** Runtime session providers share immutable assets and field/compositor
   * caches owned by the worker. Research providers own their compositor by
   * default and clear it when destroyed. */
  clearSharedCachesOnDestroy?: boolean;
}

interface Placement {
  asset: RegionalVisualAsset;
  kind: 'landmark' | 'ambient' | 'civic-detail' | 'quay-detail' | 'environment-contact' |
    'route-contact' | 'parcel-component';
  landmarkKind?: RegionalLandmarkKind;
  siteX: number;
  siteY: number;
  anchorX: number;
  anchorY: number;
  parcelId?: string;
  accessAxis?: RegionalRouteContactAxis;
  routeKind?: RegionalRouteKind;
  parcelLayers?: number;
  connectorLength?: number;
  parcelPathId?: string;
  parcelStation?: number;
  pathTangentX?: number;
  pathTangentY?: number;
  waterfrontId?: string;
  waterfrontFunction?: RegionalWaterfrontFunction;
  quayAccessPath?: readonly (readonly [number, number])[];
  environmentProgram?: RegionalEnvironmentProgramKind;
  environmentProgramId?: string;
}

type AnimatedQuayPlacement = Pick<
  Placement,
  'anchorX' | 'anchorY' | 'parcelPathId' | 'pathTangentX' | 'pathTangentY'
> & {
  asset: RegionalQuayDetailAsset & { activity: RegionalQuayDetailActivity };
};

interface ParcelConnector {
  routeKind: RegionalRouteKind;
  parcelId: string;
  path: RegionalParcelPath;
  core: boolean;
  protected: boolean;
}

interface ParcelSurface {
  routeKind: RegionalRouteKind;
  layout: RegionalParcelLayout;
}

interface WaterfrontSurface {
  routeKind: RegionalRouteKind;
  layout: RegionalWaterfrontLayout;
}

interface EnvironmentProgramSurface {
  routeKind: RegionalRouteKind;
  layout: RegionalEnvironmentProgramLayout;
}

interface LandmarkFabricSurface {
  routeKind: RegionalRouteKind;
  layout: RegionalLandmarkFabricLayout;
}

interface CachedEnvironmentProgram {
  placement: Placement;
  layout: RegionalEnvironmentProgramLayout;
  surfaces: Map<string, EnvironmentProgramSurface>;
  walkable: Set<string>;
  solid: Set<string>;
}

export interface RegionalParcelConnectorCell {
  x: number;
  y: number;
  parcelId: string;
  pathId: string;
  routeKind: RegionalRouteKind;
  core: boolean;
  protected: boolean;
  arcLength: number;
  lateralOffset: number;
}

interface CachedBlock {
  overlays: Map<string, BuildingTileData>;
  solid: Set<string>;
  landmarkFabricSurfaces: Map<string, LandmarkFabricSurface>;
  placements: Placement[];
  accessedAt: number;
}

interface CachedParcelGroup {
  contact: Placement;
  components: Placement[];
  connectors: Map<string, ParcelConnector>;
  surfaces: Map<string, ParcelSurface>;
  waterfrontSurfaces: Map<string, WaterfrontSurface>;
  layout: RegionalParcelLayout;
  waterfrontLayout: RegionalWaterfrontLayout | null;
  overlays: Map<string, BuildingTileData>;
  solid: Set<string>;
}

interface ImportedPreparedViewport {
  key: string;
  bounds: RegionalPreparedViewport['bounds'];
  resolution: number;
  terrainTiles: number;
  materializedTerrainTiles(): number;
  materializedOverlayTiles(): number;
  dynamicPlacements: readonly RegionalPreparedDynamicPlacement[];
  terrainAt(x: number, y: number): Tile;
  overlayAt(x: number, y: number): BuildingTileData | null;
  solidAt(x: number, y: number): boolean;
}

interface CollectedDerivedLayers {
  overlays: Map<string, BuildingTileData>;
  solid: Set<string>;
  connectors: Map<string, ParcelConnector>;
  surfaces: Map<string, ParcelSurface>;
  waterfrontSurfaces: Map<string, WaterfrontSurface>;
  landmarkFabricSurfaces: Map<string, LandmarkFabricSurface>;
  environmentSurfaces: Map<string, EnvironmentProgramSurface>;
  environmentWalkable: Set<string>;
  environmentSolid: Set<string>;
  dynamicPlacements: RegionalPreparedDynamicPlacement[];
}

/** Worker-owned deterministic world-composition cache. Session providers keep
 * actor/building/road state isolated, but authored placements, parcels, and
 * collision layers depend only on the world seed and manifests. Sharing those
 * immutable results prevents N colocated SSH sessions from retaining N copies
 * of the same regional raster hierarchy. */
export class RegionalWorldDerivedCache {
  readonly blockCache = new Map<string, CachedBlock>();
  readonly parcelGroupCache = new Map<string, CachedParcelGroup | null>();
  readonly parcelLayerCache = new Map<string, CollectedDerivedLayers>();
  readonly routeContactPlacementCache = new Map<string, Placement | null>();
  readonly environmentContactPlacementCache = new Map<string, Placement | null>();
  readonly environmentProgramCache = new Map<string, CachedEnvironmentProgram | null>();
  readonly civicDetailPlacementCache = new Map<string, readonly Placement[]>();
  readonly quayDetailPlacementCache = new Map<string, readonly Placement[]>();
  readonly quayFrontagePlacementCache = new Map<string, readonly Placement[]>();
  readonly dynamicQuayOverlayCache = new Map<string, Map<string, BuildingTileData>>();
  accessClock = 0;

  clear(): void {
    this.blockCache.clear();
    this.parcelGroupCache.clear();
    this.parcelLayerCache.clear();
    this.routeContactPlacementCache.clear();
    this.environmentContactPlacementCache.clear();
    this.environmentProgramCache.clear();
    this.civicDetailPlacementCache.clear();
    this.quayDetailPlacementCache.clear();
    this.quayFrontagePlacementCache.clear();
    this.dynamicQuayOverlayCache.clear();
    this.accessClock = 0;
  }
}

const VISIBLE_TILE_CACHE = new WeakMap<BuildingTileData, boolean>();
/** One prewarm payload is intentionally fanned out to every colocated SSH
 * session. Decode its immutable typed-plane facade once; terrain/overlay
 * wrappers are materialized lazily into small shared FIFO windows, preventing
 * the arrival horizon from becoming tens of thousands of JS objects. */
const PACKED_PREPARED_VIEWPORT_CACHE = new WeakMap<
  RegionalPackedPreparedViewport,
  ImportedPreparedViewport
>();
const LANDMARK_ANCHOR_REACH = 7;
const LANDMARK_ENTOURAGE_REACH = 18;
const LANDMARK_QUAY_DETAIL_REACH = 28;
const PARCEL_SIDE_OFFSET = 3;
export const REGIONAL_MAX_PREPARED_VIEWPORT_AREA = 8192;
const ENVIRONMENT_PROGRAM_REACH = 40;

/**
 * Regional production-provider seam.
 *
 * Terrain, route material, collision, and sparse vertical landmarks all consume
 * the same coordinate-stable fields. Route sites are the global composition
 * goals; manifest compatibility and local biome weights choose visual identity;
 * terrain/route clearance constrains the final anchor. Cache blocks only retain
 * derived raster placement and cannot alter the underlying world.
 */
export class RegionalWorldTileProvider extends TileProvider {
  private readonly worldSeedString: string;
  private readonly seed32: number;
  private readonly field: RegionalWorldBiomeSampler;
  private readonly routes: RegionalWorldRouteSampler;
  private readonly compositor: RegionalMaterialCompositor;
  private readonly landmarks: readonly RegionalLandmarkAsset[];
  private readonly ambient: readonly RegionalAmbientAsset[];
  private readonly civicDetails: readonly RegionalCivicDetailAsset[];
  private readonly quayDetails: readonly RegionalQuayDetailAsset[];
  private readonly quayDetailsById: ReadonlyMap<string, RegionalQuayDetailAsset>;
  private readonly routeContacts: readonly RegionalRouteContactAsset[];
  private readonly parcelComponents: readonly RegionalParcelComponentAsset[];
  private readonly environmentContacts: readonly RegionalEnvironmentContactAsset[];
  private readonly quayLayouts: readonly RegionalQuayLayout[];
  private readonly blockSize: number;
  private readonly maxCachedBlocks: number;
  private readonly ambientCellSize: number;
  private readonly ambientDensity: number;
  private readonly ambientDistributionProfile: RegionalAmbientDistributionProfile;
  private readonly ambientLandmarkClearance: number;
  private readonly civicDetailCellSize: number;
  private readonly civicDetailDensity: number;
  private readonly quayDetailDensity: number;
  private readonly quayDetailDefaultWorldMinute: number;
  private readonly routeContactCellSize: number;
  private readonly routeContactDensity: number;
  private readonly routeContactLandmarkClearance: number;
  private readonly maxCachedRouteContactCells: number;
  private readonly parcelMinimumLayers: number;
  private readonly parcelMaximumLayers: number;
  private readonly parcelLayerSpacing: number;
  private readonly environmentContactCellSize: number;
  private readonly environmentContactDensity: number;
  private readonly environmentContactLandmarkClearance: number;
  private readonly maxCachedEnvironmentContactCells: number;
  private readonly maxPreparedViewports: number;
  private readonly clearSharedCachesOnDestroy: boolean;
  private readonly placementMinOffsetX: number;
  private readonly placementMaxOffsetX: number;
  private readonly placementMinOffsetY: number;
  private readonly placementMaxOffsetY: number;
  private readonly parcelGeometryReach: number;
  private readonly parcelSourceReach: number;
  private readonly derivedCache: RegionalWorldDerivedCache;
  private readonly ownsDerivedCache: boolean;
  private readonly blockCache: Map<string, CachedBlock>;
  private readonly parcelGroupCache: Map<string, CachedParcelGroup | null>;
  private readonly parcelLayerCache: Map<string, CollectedDerivedLayers>;
  private readonly routeContactPlacementCache: Map<string, Placement | null>;
  private readonly environmentContactPlacementCache: Map<string, Placement | null>;
  private readonly environmentProgramCache: Map<string, CachedEnvironmentProgram | null>;
  private readonly civicDetailPlacementCache: Map<string, readonly Placement[]>;
  private readonly quayDetailPlacementCache: Map<string, readonly Placement[]>;
  private readonly quayFrontagePlacementCache: Map<string, readonly Placement[]>;
  private readonly dynamicQuayOverlayCache: Map<string, Map<string, BuildingTileData>>;
  private readonly preparedViewports = new Map<string, ImportedPreparedViewport>();

  constructor(config: RegionalWorldTileProviderConfig) {
    super(config);
    this.worldSeedString = config.worldSeed.toString();
    this.seed32 = Number(BigInt.asUintN(32, config.worldSeed));
    this.field = config.field;
    this.routes = config.routes;
    this.compositor = config.compositor;
    this.landmarks = config.landmarks;
    this.ambient = config.ambient ?? [];
    this.civicDetails = config.civicDetails ?? [];
    this.quayDetails = config.quayDetails ?? [];
    this.quayDetailsById = new Map(this.quayDetails.map((asset) => [asset.id, asset]));
    this.routeContacts = config.routeContacts ?? [];
    this.parcelComponents = config.parcelComponents ?? [];
    this.environmentContacts = config.environmentContacts ?? [];
    this.quayLayouts = (this.field.getConstructedWaterways?.() ?? []).map((waterway) => (
      buildRegionalQuayLayout({
        id: `quay:${waterway.id}`,
        waterway,
        quayWidth: config.quayWidth,
        edgeVariation: config.quayEdgeVariation,
        frontageDepth: config.quayFrontageDepth,
      })
    ));
    this.blockSize = Math.max(16, config.blockSize ?? 32);
    this.maxCachedBlocks = Math.max(9, config.maxCachedBlocks ?? 64);
    this.ambientCellSize = Math.max(3, config.ambientCellSize ?? 4);
    this.ambientDensity = Math.max(0, Math.min(1, config.ambientDensity ?? 0.86));
    this.ambientDistributionProfile = config.ambientDistributionProfile ?? 'uniform-blue-noise';
    this.ambientLandmarkClearance = Math.max(4, config.ambientLandmarkClearance ?? 9);
    this.civicDetailCellSize = Math.max(1, Math.min(12, config.civicDetailCellSize ?? 1));
    this.civicDetailDensity = Math.max(0, Math.min(1, config.civicDetailDensity ?? 0.92));
    this.quayDetailDensity = Math.max(0, Math.min(1, config.quayDetailDensity ?? 0.9));
    this.quayDetailDefaultWorldMinute = Number.isFinite(config.quayDetailDefaultWorldMinute)
      ? Math.max(0, Math.floor(config.quayDetailDefaultWorldMinute!))
      : 720;
    this.routeContactCellSize = Math.max(6, config.routeContactCellSize ?? 10);
    this.routeContactDensity = Math.max(0, Math.min(1, config.routeContactDensity ?? 0.55));
    this.routeContactLandmarkClearance = Math.max(4, config.routeContactLandmarkClearance ?? 10);
    this.maxCachedRouteContactCells = Math.max(64, config.maxCachedRouteContactCells ?? 4096);
    this.parcelMinimumLayers = Math.max(1, Math.min(4, config.parcelMinimumLayers ?? 2));
    this.parcelMaximumLayers = Math.max(
      this.parcelMinimumLayers,
      Math.min(5, config.parcelMaximumLayers ?? 3),
    );
    this.parcelLayerSpacing = Math.max(4, Math.min(8, config.parcelLayerSpacing ?? 5));
    this.environmentContactCellSize = Math.max(10, config.environmentContactCellSize ?? 18);
    this.environmentContactDensity = Math.max(0, Math.min(1, config.environmentContactDensity ?? 0.72));
    this.environmentContactLandmarkClearance = Math.max(
      4,
      config.environmentContactLandmarkClearance ?? 9,
    );
    this.maxCachedEnvironmentContactCells = Math.max(
      64,
      config.maxCachedEnvironmentContactCells ?? 4096,
    );
    this.maxPreparedViewports = Math.max(1, Math.min(16, config.maxPreparedViewports ?? 4));
    this.clearSharedCachesOnDestroy = config.clearSharedCachesOnDestroy ?? true;
    this.ownsDerivedCache = config.derivedCache === undefined;
    this.derivedCache = config.derivedCache ?? new RegionalWorldDerivedCache();
    this.blockCache = this.derivedCache.blockCache;
    this.parcelGroupCache = this.derivedCache.parcelGroupCache;
    this.parcelLayerCache = this.derivedCache.parcelLayerCache;
    this.routeContactPlacementCache = this.derivedCache.routeContactPlacementCache;
    this.environmentContactPlacementCache = this.derivedCache.environmentContactPlacementCache;
    this.environmentProgramCache = this.derivedCache.environmentProgramCache;
    this.civicDetailPlacementCache = this.derivedCache.civicDetailPlacementCache;
    this.quayDetailPlacementCache = this.derivedCache.quayDetailPlacementCache;
    this.quayFrontagePlacementCache = this.derivedCache.quayFrontagePlacementCache;
    this.dynamicQuayOverlayCache = this.derivedCache.dynamicQuayOverlayCache;
    for (const asset of this.landmarks) {
      if (asset.families.length === 0 || asset.landmarkKinds.length === 0) {
        throw new Error(`Regional landmark has no semantic compatibility: ${asset.id}`);
      }
      if (asset.collision.length === 0) {
        throw new Error(`Regional landmark has no collision evidence: ${asset.id}`);
      }
    }
    for (const asset of this.ambient) {
      if (asset.families.length === 0 || asset.collision.length === 0 ||
          asset.routeDistance[0] < 0 || asset.routeDistance[1] < asset.routeDistance[0]) {
        throw new Error(`Regional ambient asset has invalid semantics: ${asset.id}`);
      }
    }
    for (const asset of this.civicDetails) {
      if (asset.role !== 'civic-detail' || asset.families.length === 0 ||
          asset.collision.length === 0 || asset.routeDistance[0] < 0 ||
          asset.routeDistance[1] < asset.routeDistance[0] || asset.landmarkDistance[0] < 0 ||
          asset.landmarkDistance[1] < asset.landmarkDistance[0] ||
          asset.minimumFamilyWeight < 0 || asset.minimumFamilyWeight > 1) {
        throw new Error(`Regional civic-detail asset has invalid semantics: ${asset.id}`);
      }
    }
    for (const asset of this.quayDetails) {
      if (asset.role !== 'quay-detail' || asset.families.length === 0 ||
          asset.collision.length === 0 ||
          !['water', 'quay'].includes(asset.surface) ||
          !['north-south', 'east-west', 'any'].includes(asset.waterwayAxis) ||
          asset.bankDistance[1] < asset.bankDistance[0] ||
          asset.progressRange[0] < 0 || asset.progressRange[1] > 1 ||
          asset.progressRange[1] < asset.progressRange[0] ||
          asset.minimumFamilyWeight < 0 || asset.minimumFamilyWeight > 1 ||
          asset.minimumSpacing < 0 || asset.maximumPerLandmark < 1 ||
          asset.placementPriority < 0 || asset.placementPriority > 1 ||
          (asset.activity !== undefined && (
            !Number.isFinite(asset.activity.tangentDriftTiles) ||
            asset.activity.tangentDriftTiles <= 0 || asset.activity.tangentDriftTiles > 3 ||
            !Number.isInteger(asset.activity.cycleMinutes) ||
            asset.activity.cycleMinutes < 30 || asset.activity.cycleMinutes > 1440 ||
            !Number.isFinite(asset.activity.phaseOffset) ||
            asset.activity.phaseOffset < 0 || asset.activity.phaseOffset >= 1 ||
            asset.surface !== 'water'
          ))) {
        throw new Error(`Regional quay-detail asset has invalid semantics: ${asset.id}`);
      }
    }
    for (const asset of this.routeContacts) {
      if (asset.families.length === 0 || asset.collision.length === 0 ||
          !['north-south', 'east-west'].includes(asset.accessAxis) ||
          asset.routeDistance[0] < 0 || asset.routeDistance[1] < asset.routeDistance[0]) {
        throw new Error(`Regional route-contact asset has invalid semantics: ${asset.id}`);
      }
      validateSpriteAnchor(asset);
    }
    for (const asset of this.parcelComponents) {
      if (asset.role !== 'mass' || asset.families.length === 0 || asset.collision.length === 0) {
        throw new Error(`Regional parcel component has invalid semantics: ${asset.id}`);
      }
    }
    for (const asset of this.environmentContacts) {
      if (asset.role !== 'environment-contact' || asset.families.length === 0 ||
          asset.collision.length === 0 || asset.constraints.nearbyWaterRadius < 0 ||
          (asset.program !== undefined &&
            !['cave-interior', 'highland-ascent'].includes(asset.program))) {
        throw new Error(`Regional environment contact has invalid semantics: ${asset.id}`);
      }
    }
    const placementAssets: readonly RegionalVisualAsset[] = [
      ...this.landmarks,
      ...this.ambient,
      ...this.civicDetails,
      ...this.quayDetails,
      ...this.routeContacts,
      ...this.parcelComponents,
      ...this.environmentContacts,
    ];
    const extentX = placementAssets.flatMap((asset) => {
      const reach = this.landmarks.includes(asset as RegionalLandmarkAsset) ? LANDMARK_ANCHOR_REACH : 0;
      const activityReach = isAnimatedQuayDetailAsset(asset)
        ? Math.ceil(asset.activity.tangentDriftTiles)
        : 0;
      const [spriteAnchorX] = getSpriteAnchor(asset);
      return [
        -spriteAnchorX - reach - activityReach,
        asset.sprite.width - 1 - spriteAnchorX + reach + activityReach,
        ...asset.collision.flatMap(([offsetX]) => [
          offsetX - reach - activityReach,
          offsetX + reach + activityReach,
        ]),
      ];
    });
    const extentY = placementAssets.flatMap((asset) => {
      const reach = this.landmarks.includes(asset as RegionalLandmarkAsset) ? LANDMARK_ANCHOR_REACH : 0;
      const activityReach = isAnimatedQuayDetailAsset(asset)
        ? Math.ceil(asset.activity.tangentDriftTiles)
        : 0;
      const [, spriteAnchorY] = getSpriteAnchor(asset);
      return [
        -spriteAnchorY - reach - activityReach,
        asset.sprite.height - 1 - spriteAnchorY + reach + activityReach,
        ...asset.collision.flatMap(([, offsetY]) => [
          offsetY - reach - activityReach,
          offsetY + reach + activityReach,
        ]),
      ];
    });
    const parcelAssetReach = Math.max(0, ...this.parcelComponents.flatMap((asset) => {
      const [anchorX, anchorY] = getSpriteAnchor(asset);
      return [
        Math.hypot(anchorX, anchorY),
        Math.hypot(asset.sprite.width - 1 - anchorX, anchorY),
        Math.hypot(anchorX, asset.sprite.height - 1 - anchorY),
        Math.hypot(asset.sprite.width - 1 - anchorX, asset.sprite.height - 1 - anchorY),
        ...asset.collision.map(([offsetX, offsetY]) => Math.hypot(offsetX, offsetY)),
      ];
    }));
    const maximumPathLength = 3 + this.parcelMaximumLayers * this.parcelLayerSpacing + 1;
    const maximumPathLateral = Math.min(14, maximumPathLength * 0.72);
    this.parcelGeometryReach = this.parcelComponents.length === 0 ? 0 : Math.ceil(
      Math.hypot(maximumPathLength, maximumPathLateral) + PARCEL_SIDE_OFFSET +
      parcelAssetReach + 2,
    );
    // A jittered route-contact candidate can resolve to a nearby route before
    // it seeds its parcel. This outer bound discovers candidate cells; the
    // exact site-distance check runs before any parcel group is built.
    this.parcelSourceReach = this.parcelGeometryReach + this.routeContactCellSize + 2;
    this.placementMinOffsetX = Math.min(0, ...extentX);
    this.placementMaxOffsetX = Math.max(0, ...extentX);
    this.placementMinOffsetY = Math.min(0, ...extentY);
    this.placementMaxOffsetY = Math.max(0, ...extentY);
  }

  /** Regional terrain and authored structures are coordinate-stable. Water
   * and foliage motion is palette-driven after cell reconstruction, so the
   * expensive pixel base has no per-session tick phase. */
  getStaticRenderEpoch(): number {
    return 0;
  }

  override getTile(tileX: number, tileY: number): Tile {
    const key = positionKey(tileX, tileY);
    const parcel = this.getParcelLayerBlock(tileX, tileY);
    const connector = parcel.connectors.get(key);
    const surface = parcel.surfaces.get(key);
    const waterfront = parcel.waterfrontSurfaces.get(key);
    const landmarkFabric = parcel.landmarkFabricSurfaces.get(key);
    const environment = parcel.environmentSurfaces.get(key);
    const quayLayout = this.quayLayoutAt(tileX, tileY);
    return environment
      ? this.compositor.getEnvironmentProgramGroundTile(
        tileX,
        tileY,
        environment.layout,
        environment.routeKind,
      )
      : connector
      ? this.compositor.getPathAccessTile(
        tileX,
        tileY,
        connector.path,
        connector.routeKind,
        connector.core,
        surface?.layout,
        waterfront?.layout,
      )
      : waterfront
        ? this.compositor.getWaterfrontGroundTile(
          tileX,
          tileY,
          waterfront.layout,
          waterfront.routeKind,
        )
        : landmarkFabric
        ? this.compositor.getLandmarkFabricGroundTile(
          tileX,
          tileY,
          landmarkFabric.layout,
          landmarkFabric.routeKind,
        )
        : surface
        ? this.compositor.getParcelGroundTile(tileX, tileY, surface.layout, surface.routeKind)
        : quayLayout
        ? this.compositor.getQuayGroundTile(tileX, tileY, quayLayout)
        : this.compositor.getTile(tileX, tileY);
  }

  getTileAtResolution(tileX: number, tileY: number, resolution: number): Tile {
    const prepared = this.findPreparedViewport(tileX, tileY, Math.round(resolution));
    if (prepared) return prepared.terrainAt(tileX, tileY);
    const key = positionKey(tileX, tileY);
    const parcel = this.getParcelLayerBlock(tileX, tileY);
    const connector = parcel.connectors.get(key);
    const surface = parcel.surfaces.get(key);
    const waterfront = parcel.waterfrontSurfaces.get(key);
    const landmarkFabric = parcel.landmarkFabricSurfaces.get(key);
    const environment = parcel.environmentSurfaces.get(key);
    const quayLayout = this.quayLayoutAt(tileX, tileY);
    return environment
      ? this.compositor.getEnvironmentProgramGroundTileAtResolution(
        tileX,
        tileY,
        resolution,
        environment.layout,
        environment.routeKind,
      )
      : connector
      ? this.compositor.getPathAccessTileAtResolution(
        tileX,
        tileY,
        resolution,
        connector.path,
        connector.routeKind,
        connector.core,
        surface?.layout,
        waterfront?.layout,
      )
      : waterfront
        ? this.compositor.getWaterfrontGroundTileAtResolution(
          tileX,
          tileY,
          resolution,
          waterfront.layout,
          waterfront.routeKind,
        )
        : landmarkFabric
        ? this.compositor.getLandmarkFabricGroundTileAtResolution(
          tileX,
          tileY,
          resolution,
          landmarkFabric.layout,
          landmarkFabric.routeKind,
        )
        : surface
        ? this.compositor.getParcelGroundTileAtResolution(
          tileX,
          tileY,
          resolution,
          surface.layout,
          surface.routeKind,
        )
        : quayLayout
        ? this.compositor.getQuayGroundTileAtResolution(
          tileX,
          tileY,
          resolution,
          quayLayout,
        )
        : this.compositor.getTileAtResolution(tileX, tileY, resolution);
  }

  /** Synchronously materialize one bounded predicted viewport. This is the
   * cache-import target for an off-critical-path scheduler, not permission to
   * call cold generation from an input handler. Timings must account for this
   * preparation separately from the subsequent frame. */
  prewarm(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    resolution: number,
  ): RegionalPrewarmResult {
    const tileMinX = Math.floor(Math.min(minX, maxX));
    const tileMaxX = Math.floor(Math.max(minX, maxX));
    const tileMinY = Math.floor(Math.min(minY, maxY));
    const tileMaxY = Math.floor(Math.max(minY, maxY));
    this.field.prewarm?.(tileMinX - 1, tileMinY - 1, tileMaxX + 1, tileMaxY + 1);
    this.routes.prewarm?.(tileMinX - 12, tileMinY - 12, tileMaxX + 12, tileMaxY + 12);

    const firstBlockX = floorDiv(tileMinX - this.placementMaxOffsetX, this.blockSize);
    const lastBlockX = floorDiv(tileMaxX - this.placementMinOffsetX, this.blockSize);
    const firstBlockY = floorDiv(tileMinY - this.placementMaxOffsetY, this.blockSize);
    const lastBlockY = floorDiv(tileMaxY - this.placementMinOffsetY, this.blockSize);
    let providerBlocksPrimed = 0;
    for (let blockY = firstBlockY; blockY <= lastBlockY; blockY++) {
      for (let blockX = firstBlockX; blockX <= lastBlockX; blockX++) {
        this.getBlock(blockX, blockY);
        providerBlocksPrimed++;
      }
    }

    let terrainTilesPrimed = 0;
    for (let tileY = tileMinY; tileY <= tileMaxY; tileY++) {
      for (let tileX = tileMinX; tileX <= tileMaxX; tileX++) {
        const prepared = this.findPreparedViewport(tileX, tileY, Math.round(resolution));
        if (!prepared || prepared.resolution !== Math.round(resolution)) {
          this.compositor.getTileAtResolution(tileX, tileY, resolution);
        }
        terrainTilesPrimed++;
      }
    }
    return {
      biomeBoundsPrimed: this.field.prewarm !== undefined,
      routeBoundsPrimed: this.routes.prewarm !== undefined,
      terrainTilesPrimed,
      providerBlocksPrimed,
      resolution,
    };
  }

  /** Materialize a complete bounded cache package suitable for structured
   * cloning from a worker. This method is deliberately synchronous and belongs
   * on the generator side of the boundary. */
  prepareViewport(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    resolution: number,
  ): RegionalPreparedViewport {
    const bounds = normalizedPreparedBounds(minX, minY, maxX, maxY);
    validatePreparedArea(bounds);
    const normalizedResolution = Math.max(1, Math.round(resolution));
    this.prewarm(
      bounds.minX,
      bounds.minY,
      bounds.maxX,
      bounds.maxY,
      normalizedResolution,
    );
    const terrain: RegionalPreparedTerrainTile[] = [];
    const overlays: RegionalPreparedOverlayTile[] = [];
    const solid: Array<readonly [number, number]> = [];
    const derived = this.collectDerivedLayers(bounds);
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        const key = positionKey(x, y);
        const imported = this.findPreparedViewport(x, y, normalizedResolution);
        if (imported?.resolution === normalizedResolution) {
          terrain.push({ x, y, tile: imported.terrainAt(x, y) });
          const overlay = imported.overlayAt(x, y);
          if (overlay) overlays.push({ x, y, tile: overlay });
          if (imported.solidAt(x, y)) solid.push([x, y]);
          continue;
        }
        const connector = derived.connectors.get(key);
        const surface = derived.surfaces.get(key);
        const waterfront = derived.waterfrontSurfaces.get(key);
        const landmarkFabric = derived.landmarkFabricSurfaces.get(key);
        const environment = derived.environmentSurfaces.get(key);
        const quayLayout = this.quayLayoutAt(x, y);
        const opensQuay = Boolean(quayLayout);
        const terrainTile = environment
          ? this.compositor.getEnvironmentProgramGroundTileAtResolution(
            x,
            y,
            normalizedResolution,
            environment.layout,
            environment.routeKind,
          )
          : connector
          ? this.compositor.getPathAccessTileAtResolution(
            x,
            y,
            normalizedResolution,
            connector.path,
            connector.routeKind,
            connector.core,
            surface?.layout,
            waterfront?.layout,
          )
          : waterfront
            ? this.compositor.getWaterfrontGroundTileAtResolution(
              x,
              y,
              normalizedResolution,
              waterfront.layout,
              waterfront.routeKind,
            )
            : landmarkFabric
            ? this.compositor.getLandmarkFabricGroundTileAtResolution(
              x,
              y,
              normalizedResolution,
              landmarkFabric.layout,
              landmarkFabric.routeKind,
            )
            : surface
            ? this.compositor.getParcelGroundTileAtResolution(
              x,
              y,
              normalizedResolution,
              surface.layout,
              surface.routeKind,
            )
            : quayLayout
            ? this.compositor.getQuayGroundTileAtResolution(
              x,
              y,
              normalizedResolution,
              quayLayout,
            )
            : this.compositor.getTileAtResolution(x, y, normalizedResolution);
        terrain.push({ x, y, tile: terrainTile });
        const authoredOverlay = super.getBuildingTileAt(x, y);
        // A tall oblique facade may visually overhang a quay while its ground
        // collision remains behind the protected ribbon. Do not cut the sprite
        // into floating roof fragments at the walkable-cell boundary.
        const overlay = authoredOverlay ?? (connector?.protected ? null : derived.overlays.get(key) ?? null);
        if (overlay) overlays.push({ x, y, tile: overlay });
        const opensAuthoredMass = connector?.protected || derived.environmentWalkable.has(key) || opensQuay;
        if (derived.environmentSolid.has(key) || (!opensAuthoredMass && (
          super.isBuildingAt(x, y) || derived.solid.has(key)
        ))) {
          solid.push([x, y]);
        }
      }
    }
    return {
      version: 1,
      worldSeed: this.worldSeedString,
      bounds,
      resolution: normalizedResolution,
      terrain,
      overlays,
      solid,
      dynamicPlacements: derived.dynamicPlacements,
    };
  }

  /** Merge the coordinate-stable derived blocks once for a bounded export.
   * Map insertion preserves the same y-major/x-major first-hit precedence as
   * `blocksNear`, while connector ownership remains dominant over derived art
   * and collision. This removes three repeated source-block scans per tile. */
  private collectDerivedLayers(bounds: RegionalPreparedViewport['bounds']): CollectedDerivedLayers {
    const overlays = new Map<string, BuildingTileData>();
    const solid = new Set<string>();
    const connectors = new Map<string, ParcelConnector>();
    const surfaces = new Map<string, ParcelSurface>();
    const waterfrontSurfaces = new Map<string, WaterfrontSurface>();
    const landmarkFabricSurfaces = new Map<string, LandmarkFabricSurface>();
    const environmentSurfaces = new Map<string, EnvironmentProgramSurface>();
    const environmentWalkable = new Set<string>();
    const environmentSolid = new Set<string>();
    const dynamicPlacements: RegionalPreparedDynamicPlacement[] = [];
    const firstBlockX = floorDiv(bounds.minX - this.placementMaxOffsetX, this.blockSize);
    const lastBlockX = floorDiv(bounds.maxX - this.placementMinOffsetX, this.blockSize);
    const firstBlockY = floorDiv(bounds.minY - this.placementMaxOffsetY, this.blockSize);
    const lastBlockY = floorDiv(bounds.maxY - this.placementMinOffsetY, this.blockSize);
    const inside = (key: string): boolean => {
      const separator = key.indexOf(',');
      const x = Number(key.slice(0, separator));
      const y = Number(key.slice(separator + 1));
      return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
    };
    for (let blockY = firstBlockY; blockY <= lastBlockY; blockY++) {
      for (let blockX = firstBlockX; blockX <= lastBlockX; blockX++) {
        const block = this.getBlock(blockX, blockY);
        for (const placement of block.placements) {
          if (!isAnimatedQuayDetailPlacement(placement)) continue;
          dynamicPlacements.push({
            assetId: placement.asset.id,
            anchorX: placement.anchorX,
            anchorY: placement.anchorY,
            ...(placement.pathTangentX === undefined ? {} : {
              pathTangentX: placement.pathTangentX,
            }),
            ...(placement.pathTangentY === undefined ? {} : {
              pathTangentY: placement.pathTangentY,
            }),
            ...(placement.parcelPathId === undefined ? {} : {
              parcelPathId: placement.parcelPathId,
            }),
          });
        }
        for (const [key, tile] of block.overlays) {
          if (inside(key) && !overlays.has(key)) overlays.set(key, tile);
        }
        for (const key of block.solid) if (inside(key)) solid.add(key);
        for (const [key, surface] of block.landmarkFabricSurfaces) {
          if (inside(key) && !landmarkFabricSurfaces.has(key)) {
            landmarkFabricSurfaces.set(key, surface);
          }
        }
      }
    }
    const parcel = this.collectParcelLayers(bounds);
    for (const [key, tile] of parcel.overlays) {
      if (parcel.environmentSurfaces.has(key)) continue;
      const beneath = overlays.get(key);
      overlays.set(key, beneath ? compositeTiles(beneath, tile) : tile);
    }
    for (const [key, connector] of parcel.connectors) {
      if (connector.protected) solid.delete(key);
    }
    for (const key of parcel.environmentWalkable) {
      environmentWalkable.add(key);
      solid.delete(key);
    }
    for (const key of parcel.environmentSolid) environmentSolid.add(key);
    for (const key of parcel.solid) solid.add(key);
    for (const [key, connector] of parcel.connectors) connectors.set(key, connector);
    for (const [key, surface] of parcel.surfaces) surfaces.set(key, surface);
    for (const [key, surface] of parcel.waterfrontSurfaces) waterfrontSurfaces.set(key, surface);
    for (const [key, surface] of parcel.environmentSurfaces) environmentSurfaces.set(key, surface);
    dynamicPlacements.sort((left, right) => (
      left.anchorY - right.anchorY || left.anchorX - right.anchorX ||
      left.assetId.localeCompare(right.assetId)
    ));
    return {
      overlays,
      solid,
      connectors,
      surfaces,
      waterfrontSurfaces,
      landmarkFabricSurfaces,
      environmentSurfaces,
      environmentWalkable,
      environmentSolid,
      dynamicPlacements,
    };
  }

  /** Import a worker-produced rectangle with bounded package-level LRU. The
   * validation cost is proportional only to the viewport and is reported by
   * the traversal lab separately from rendering. */
  importPreparedViewport(payload: RegionalPreparedViewportPayload): void {
    if (payload.version === 3) {
      this.importPackedPreparedViewport(payload);
      return;
    }
    if (payload.worldSeed !== this.worldSeedString) {
      throw new Error(`Regional viewport seed mismatch: ${payload.worldSeed} != ${this.worldSeedString}`);
    }
    const bounds = normalizedPreparedBounds(
      payload.bounds.minX,
      payload.bounds.minY,
      payload.bounds.maxX,
      payload.bounds.maxY,
    );
    if (bounds.minX !== payload.bounds.minX || bounds.minY !== payload.bounds.minY ||
        bounds.maxX !== payload.bounds.maxX || bounds.maxY !== payload.bounds.maxY) {
      throw new Error('Regional viewport bounds must be normalized integers');
    }
    validatePreparedArea(bounds);
    if (!Number.isInteger(payload.resolution) || payload.resolution < 1) {
      throw new Error(`Regional viewport resolution must be a positive integer: ${payload.resolution}`);
    }
    const expectedTerrain = preparedArea(bounds);
    if (payload.terrain.length !== expectedTerrain) {
      throw new Error(`Regional viewport terrain coverage mismatch: ${payload.terrain.length}/${expectedTerrain}`);
    }
    const terrain = new Map<string, Tile>();
    for (const entry of payload.terrain) {
      validatePreparedCoordinate(entry.x, entry.y, bounds, 'terrain');
      const key = positionKey(entry.x, entry.y);
      if (terrain.has(key)) throw new Error(`Duplicate regional viewport terrain coordinate: ${key}`);
      terrain.set(key, entry.tile);
    }
    const overlays = new Map<string, BuildingTileData>();
    for (const entry of payload.overlays) {
      validatePreparedCoordinate(entry.x, entry.y, bounds, 'overlay');
      const key = positionKey(entry.x, entry.y);
      if (overlays.has(key)) throw new Error(`Duplicate regional viewport overlay coordinate: ${key}`);
      overlays.set(key, entry.tile);
    }
    const solid = new Set<string>();
    for (const [x, y] of payload.solid) {
      validatePreparedCoordinate(x, y, bounds, 'solid');
      solid.add(positionKey(x, y));
    }
    const key = `${bounds.minX},${bounds.minY},${bounds.maxX},${bounds.maxY}@${payload.resolution}`;
    this.installPreparedViewport({
      key,
      bounds,
      resolution: payload.resolution,
      terrainTiles: terrain.size,
      materializedTerrainTiles: () => terrain.size,
      materializedOverlayTiles: () => overlays.size,
      dynamicPlacements: validatePreparedDynamicPlacements(payload.dynamicPlacements),
      terrainAt: (x, y) => terrain.get(positionKey(x, y))!,
      overlayAt: (x, y) => overlays.get(positionKey(x, y)) ?? null,
      solidAt: (x, y) => solid.has(positionKey(x, y)),
    });
  }

  private installPreparedViewport(viewport: ImportedPreparedViewport): void {
    this.preparedViewports.delete(viewport.key);
    this.preparedViewports.set(viewport.key, viewport);
    while (this.preparedViewports.size > this.maxPreparedViewports) {
      const oldest = this.preparedViewports.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.preparedViewports.delete(oldest);
    }
    this.markVisualChange();
  }

  private importPackedPreparedViewport(payload: RegionalPackedPreparedViewport): void {
    if (payload.worldSeed !== this.worldSeedString) {
      throw new Error(`Regional viewport seed mismatch: ${payload.worldSeed} != ${this.worldSeedString}`);
    }
    const shared = PACKED_PREPARED_VIEWPORT_CACHE.get(payload);
    if (shared) {
      this.installPreparedViewport(shared);
      return;
    }
    const bounds = normalizedPreparedBounds(
      payload.bounds.minX,
      payload.bounds.minY,
      payload.bounds.maxX,
      payload.bounds.maxY,
    );
    if (bounds.minX !== payload.bounds.minX || bounds.minY !== payload.bounds.minY ||
        bounds.maxX !== payload.bounds.maxX || bounds.maxY !== payload.bounds.maxY) {
      throw new Error('Regional viewport bounds must be normalized integers');
    }
    validatePreparedArea(bounds);
    if (!Number.isInteger(payload.resolution) || payload.resolution < 1 || payload.resolution > 256) {
      throw new Error(`Regional viewport resolution must be an integer in 1..256: ${payload.resolution}`);
    }
    const area = preparedArea(bounds);
    const pixelsPerTile = payload.resolution * payload.resolution;
    const bytesPerTile = pixelsPerTile * 4;
    if (payload.terrainRgba.length !== area * bytesPerTile ||
        payload.terrainMaterial.length !== area * pixelsPerTile ||
        payload.terrainWalkable.length !== area || payload.solid.length !== area) {
      throw new Error('Packed regional viewport terrain plane dimensions do not match bounds');
    }
    if (payload.overlayCoordinates.length % 2 !== 0 ||
        payload.overlayRgba.length !== payload.overlayCoordinates.length / 2 * bytesPerTile) {
      throw new Error('Packed regional viewport overlay plane dimensions do not match coordinates');
    }
    const width = bounds.maxX - bounds.minX + 1;
    const terrainCache = new Map<number, Tile>();
    const overlayIndexes = new Int32Array(area);
    overlayIndexes.fill(-1);
    const overlayCache = new Map<number, BuildingTileData>();
    for (let index = 0; index < payload.overlayCoordinates.length / 2; index++) {
      const x = payload.overlayCoordinates[index * 2]!;
      const y = payload.overlayCoordinates[index * 2 + 1]!;
      validatePreparedCoordinate(x, y, bounds, 'overlay');
      const terrainIndex = (y - bounds.minY) * width + x - bounds.minX;
      if (overlayIndexes[terrainIndex] !== -1) {
        throw new Error(`Duplicate regional viewport overlay coordinate: ${x},${y}`);
      }
      overlayIndexes[terrainIndex] = index;
    }
    const terrainIndexAt = (x: number, y: number): number => (
      (Math.floor(y) - bounds.minY) * width + Math.floor(x) - bounds.minX
    );
    const key = `${bounds.minX},${bounds.minY},${bounds.maxX},${bounds.maxY}@${payload.resolution}`;
    const imported: ImportedPreparedViewport = {
      key,
      bounds,
      resolution: payload.resolution,
      terrainTiles: area,
      materializedTerrainTiles: () => terrainCache.size,
      materializedOverlayTiles: () => overlayCache.size,
      dynamicPlacements: validatePreparedDynamicPlacements(payload.dynamicPlacements),
      terrainAt: (x, y) => {
        const index = terrainIndexAt(x, y);
        const cached = terrainCache.get(index);
        if (cached) return cached;
        const tile: Tile = {
          id: `regional-prepared:${Math.floor(x)},${Math.floor(y)}@${payload.resolution}`,
          name: 'Transferred regional material',
          pixels: [],
          packedPixels: {
            width: payload.resolution,
            height: payload.resolution,
            data: payload.terrainRgba.subarray(index * bytesPerTile, (index + 1) * bytesPerTile),
          },
          packedMaterialMask: payload.terrainMaterial.subarray(
            index * pixelsPerTile,
            (index + 1) * pixelsPerTile,
          ),
          walkable: payload.terrainWalkable[index] === 1,
        };
        installBoundedEntry(terrainCache, index, tile, 1024);
        return tile;
      },
      overlayAt: (x, y) => {
        const coordinateIndex = terrainIndexAt(x, y);
        const overlayIndex = overlayIndexes[coordinateIndex] ?? -1;
        if (overlayIndex < 0) return null;
        const cached = overlayCache.get(overlayIndex);
        if (cached) return cached;
        const tile: BuildingTileData = {
          pixels: [],
          resolutions: {},
          packedPixels: {
            width: payload.resolution,
            height: payload.resolution,
            data: payload.overlayRgba.subarray(
              overlayIndex * bytesPerTile,
              (overlayIndex + 1) * bytesPerTile,
            ),
          },
        };
        installBoundedEntry(overlayCache, overlayIndex, tile, 256);
        return tile;
      },
      solidAt: (x, y) => payload.solid[terrainIndexAt(x, y)] === 1,
    };
    PACKED_PREPARED_VIEWPORT_CACHE.set(payload, imported);
    this.installPreparedViewport(imported);
  }

  /** Constant-bounded coverage query for the predictive scheduler. Coverage
   * must come from one complete package; composing holes across rectangles
   * would make a negative overlay result ambiguous. */
  hasPreparedViewportCoverage(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    resolution: number,
  ): boolean {
    const bounds = normalizedPreparedBounds(minX, minY, maxX, maxY);
    const normalizedResolution = Math.max(1, Math.round(resolution));
    return [...this.preparedViewports.values()].some((viewport) => (
      viewport.resolution === normalizedResolution &&
      viewport.bounds.minX <= bounds.minX && viewport.bounds.maxX >= bounds.maxX &&
      viewport.bounds.minY <= bounds.minY && viewport.bounds.maxY >= bounds.maxY
    ));
  }

  override getBuildingTileAt(
    worldX: number,
    worldY: number,
    direction: BuildingDirection = 'north',
  ): BuildingTileData | null {
    const prepared = this.findPreparedViewport(worldX, worldY);
    if (prepared) return prepared.overlayAt(worldX, worldY);
    const authored = super.getBuildingTileAt(worldX, worldY, direction);
    if (authored) return authored;
    const key = positionKey(worldX, worldY);
    const parcel = this.getParcelLayerBlock(worldX, worldY);
    if (parcel.connectors.get(key)?.protected) return null;
    let derived: BuildingTileData | null = null;
    for (const block of this.blocksNear(worldX, worldY)) {
      const tile = block.overlays.get(key);
      if (tile) {
        derived = tile;
        break;
      }
    }
    const component = parcel.overlays.get(key);
    if (parcel.environmentSurfaces.has(key)) return derived;
    return component ? (derived ? compositeTiles(derived, component) : component) : derived;
  }

  /** Resolve sparse persistent-time activity outside the immutable static
   * scene. Maps are cached by source block and projected world minute, so the
   * renderer pays only bounded map lookups on ordinary frames. */
  getDynamicOverlayTileAt(
    worldX: number,
    worldY: number,
    _direction: BuildingDirection = 'north',
  ): BuildingTileData | null {
    if (!this.quayDetails.some(isAnimatedQuayDetailAsset)) return null;
    const worldMinute = this.getWorldLifeState()?.worldMinute ?? this.quayDetailDefaultWorldMinute;
    const key = positionKey(worldX, worldY);
    const prepared = this.findPreparedViewport(worldX, worldY);
    if (prepared) {
      return this.getPreparedDynamicQuayOverlays(prepared, worldMinute).get(key) ?? null;
    }
    const firstBlockX = floorDiv(worldX - this.placementMaxOffsetX, this.blockSize);
    const lastBlockX = floorDiv(worldX - this.placementMinOffsetX, this.blockSize);
    const firstBlockY = floorDiv(worldY - this.placementMaxOffsetY, this.blockSize);
    const lastBlockY = floorDiv(worldY - this.placementMinOffsetY, this.blockSize);
    let overlay: BuildingTileData | null = null;
    for (let blockY = firstBlockY; blockY <= lastBlockY; blockY++) {
      for (let blockX = firstBlockX; blockX <= lastBlockX; blockX++) {
        const tile = this.getDynamicQuayOverlayBlock(blockX, blockY, worldMinute).get(key);
        if (tile) overlay = overlay ? compositeTiles(overlay, tile) : tile;
      }
    }
    return overlay;
  }

  private getDynamicQuayOverlayBlock(
    blockX: number,
    blockY: number,
    worldMinute: number,
  ): Map<string, BuildingTileData> {
    const cacheKey = `${blockX},${blockY}@${worldMinute}`;
    const cached = this.dynamicQuayOverlayCache.get(cacheKey);
    if (cached) return cached;
    const placements = this.getBlock(blockX, blockY).placements
      .filter(isAnimatedQuayDetailPlacement);
    const overlays = this.composeDynamicQuayOverlays(placements, worldMinute);
    this.installDynamicQuayOverlayCacheEntry(cacheKey, overlays);
    return overlays;
  }

  /** A prepared viewport carries the sparse authored placement program rather
   * than one frozen raster. Runtime time still selects every active anchor;
   * only the expensive source-block discovery has moved off the frame path. */
  private getPreparedDynamicQuayOverlays(
    viewport: ImportedPreparedViewport,
    worldMinute: number,
  ): Map<string, BuildingTileData> {
    const cacheKey = `viewport:${viewport.key}@${worldMinute}`;
    const cached = this.dynamicQuayOverlayCache.get(cacheKey);
    if (cached) return cached;
    const placements = viewport.dynamicPlacements.map((placement): AnimatedQuayPlacement => {
      const asset = this.quayDetailsById.get(placement.assetId);
      if (!asset || !isAnimatedQuayDetailAsset(asset)) {
        throw new Error(`Prepared regional viewport has unknown animated asset: ${placement.assetId}`);
      }
      return { ...placement, asset };
    });
    const overlays = this.composeDynamicQuayOverlays(placements, worldMinute);
    this.installDynamicQuayOverlayCacheEntry(cacheKey, overlays);
    return overlays;
  }

  private composeDynamicQuayOverlays(
    source: readonly AnimatedQuayPlacement[],
    worldMinute: number,
  ): Map<string, BuildingTileData> {
    const overlays = new Map<string, BuildingTileData>();
    const placements = source.map((placement) => ({
      placement,
      anchor: this.activeQuayDetailAnchor(placement, worldMinute),
    })).sort((a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x ||
      a.placement.asset.id.localeCompare(b.placement.asset.id));
    for (const { placement, anchor } of placements) {
      const [offsetX, offsetY] = getSpriteAnchor(placement.asset);
      for (let tileY = 0; tileY < placement.asset.sprite.height; tileY++) {
        for (let tileX = 0; tileX < placement.asset.sprite.width; tileX++) {
          const tile = placement.asset.sprite.tiles[tileY]?.[tileX];
          if (!tile || !hasVisiblePixels(tile)) continue;
          const key = positionKey(anchor.x + tileX - offsetX, anchor.y + tileY - offsetY);
          const beneath = overlays.get(key);
          overlays.set(key, beneath ? compositeTiles(beneath, tile) : tile);
        }
      }
    }
    return overlays;
  }

  private installDynamicQuayOverlayCacheEntry(
    cacheKey: string,
    overlays: Map<string, BuildingTileData>,
  ): void {
    this.dynamicQuayOverlayCache.set(cacheKey, overlays);
    while (this.dynamicQuayOverlayCache.size > this.maxCachedBlocks * 4) {
      const oldest = this.dynamicQuayOverlayCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.dynamicQuayOverlayCache.delete(oldest);
    }
  }

  private activeQuayDetailAnchor(
    placement: AnimatedQuayPlacement,
    worldMinute: number,
  ): { x: number; y: number } {
    const { activity } = placement.asset;
    const phase = positiveMod(worldMinute, activity.cycleMinutes) / activity.cycleMinutes +
      activity.phaseOffset;
    const drift = Math.round(Math.sin(phase * Math.PI * 2) * activity.tangentDriftTiles);
    const x = placement.anchorX + Math.round((placement.pathTangentX ?? 0) * drift);
    const y = placement.anchorY + Math.round((placement.pathTangentY ?? 0) * drift);
    if (x === placement.anchorX && y === placement.anchorY) {
      return { x, y };
    }
    const layout = this.quayLayouts.find((candidate) => candidate.id === placement.parcelPathId);
    return layout && this.quayDetailFits(x, y, layout, placement.asset)
      ? { x, y }
      : { x: placement.anchorX, y: placement.anchorY };
  }

  override isBuildingAt(worldX: number, worldY: number): boolean {
    const prepared = this.findPreparedViewport(worldX, worldY);
    if (prepared) return prepared.solidAt(worldX, worldY);
    const quayLayout = this.quayLayoutAt(worldX, worldY);
    if (quayLayout) return false;
    const key = positionKey(worldX, worldY);
    const parcel = this.getParcelLayerBlock(worldX, worldY);
    if (parcel.environmentWalkable.has(key)) return false;
    if (parcel.environmentSolid.has(key)) return true;
    if (parcel.connectors.get(key)?.protected) return false;
    if (super.isBuildingAt(worldX, worldY)) return true;
    if (parcel.solid.has(key)) return true;
    return this.blocksNear(worldX, worldY).some((block) => block.solid.has(key));
  }

  getRegionalStats(): {
    landmarkAssets: number;
    ambientAssets: number;
    ambientDistributionProfile: RegionalAmbientDistributionProfile;
    civicDetailAssets: number;
    quayDetailAssets: number;
    environmentContactAssets: number;
    routeContactAssets: number;
    parcelComponentAssets: number;
    cachedBlocks: number;
    cachedPlacements: number;
    cachedLandmarkPlacements: number;
    cachedAmbientPlacements: number;
    cachedCivicDetailPlacements: number;
    cachedQuayDetailPlacements: number;
    cachedQuayFrontageSites: number;
    cachedDynamicQuayOverlayTiles: number;
    cachedEnvironmentContactPlacements: number;
    cachedRouteContactPlacements: number;
    cachedParcelGroups: number;
    cachedParcelLayerBlocks: number;
    cachedParcelComponentPlacements: number;
    cachedParcelConnectorCells: number;
    cachedParcelSurfaceCells: number;
    cachedWaterfrontPrograms: number;
    cachedWaterfrontSurfaceCells: number;
    cachedEnvironmentPrograms: number;
    cachedEnvironmentProgramSurfaceCells: number;
    cachedRouteContactCells: number;
    cachedEnvironmentContactCells: number;
    cachedOverlayTiles: number;
    cachedSolidTiles: number;
    blockSize: number;
    maxCachedBlocks: number;
    maxCachedRouteContactCells: number;
    maxCachedEnvironmentContactCells: number;
    preparedViewports: number;
    preparedTerrainTiles: number;
    preparedMaterializedTerrainTiles: number;
    preparedMaterializedOverlayTiles: number;
  } {
    return {
      landmarkAssets: this.landmarks.length,
      ambientAssets: this.ambient.length,
      ambientDistributionProfile: this.ambientDistributionProfile,
      civicDetailAssets: this.civicDetails.length,
      quayDetailAssets: this.quayDetails.length,
      environmentContactAssets: this.environmentContacts.length,
      routeContactAssets: this.routeContacts.length,
      parcelComponentAssets: this.parcelComponents.length,
      cachedBlocks: this.blockCache.size,
      cachedPlacements: [...this.blockCache.values()].reduce(
        (total, block) => total + block.placements.length,
        0,
      ) + [...this.parcelGroupCache.values()].reduce(
        (total, group) => total + (group?.components.length ?? 0),
        0,
      ),
      cachedLandmarkPlacements: [...this.blockCache.values()].reduce(
        (total, block) => total + block.placements.filter((placement) => placement.kind === 'landmark').length,
        0,
      ),
      cachedAmbientPlacements: [...this.blockCache.values()].reduce(
        (total, block) => total + block.placements.filter((placement) => placement.kind === 'ambient').length,
        0,
      ),
      cachedCivicDetailPlacements: [...this.blockCache.values()].reduce(
        (total, block) => total + block.placements.filter(
          (placement) => placement.kind === 'civic-detail',
        ).length,
        0,
      ),
      cachedQuayDetailPlacements: [...this.blockCache.values()].reduce(
        (total, block) => total + block.placements.filter(
          (placement) => placement.kind === 'quay-detail',
        ).length,
        0,
      ),
      cachedQuayFrontageSites: this.quayFrontagePlacementCache.size,
      cachedDynamicQuayOverlayTiles: [...this.dynamicQuayOverlayCache.values()].reduce(
        (total, overlays) => total + overlays.size,
        0,
      ),
      cachedEnvironmentContactPlacements: [...this.blockCache.values()].reduce(
        (total, block) => total + block.placements.filter(
          (placement) => placement.kind === 'environment-contact',
        ).length,
        0,
      ),
      cachedRouteContactPlacements: [...this.blockCache.values()].reduce(
        (total, block) => total + block.placements.filter((placement) => placement.kind === 'route-contact').length,
        0,
      ),
      cachedParcelGroups: [...this.parcelGroupCache.values()].filter((group) => group !== null).length,
      cachedParcelLayerBlocks: this.parcelLayerCache.size,
      cachedParcelComponentPlacements: [...this.parcelGroupCache.values()].reduce(
        (total, group) => total + (group?.components.length ?? 0),
        0,
      ),
      cachedParcelConnectorCells: [...this.parcelGroupCache.values()].reduce(
        (total, group) => total + (group?.connectors.size ?? 0),
        0,
      ),
      cachedParcelSurfaceCells: [...this.parcelGroupCache.values()].reduce(
        (total, group) => total + (group?.surfaces.size ?? 0),
        0,
      ),
      cachedWaterfrontPrograms: [...this.parcelGroupCache.values()].filter(
        (group) => group?.waterfrontLayout,
      ).length,
      cachedWaterfrontSurfaceCells: [...this.parcelGroupCache.values()].reduce(
        (total, group) => total + (group?.waterfrontSurfaces.size ?? 0),
        0,
      ),
      cachedEnvironmentPrograms: [...this.environmentProgramCache.values()].filter(
        (program) => program !== null,
      ).length,
      cachedEnvironmentProgramSurfaceCells: [...this.environmentProgramCache.values()].reduce(
        (total, program) => total + (program?.surfaces.size ?? 0),
        0,
      ),
      cachedRouteContactCells: this.routeContactPlacementCache.size,
      cachedEnvironmentContactCells: this.environmentContactPlacementCache.size,
      cachedOverlayTiles: [...this.blockCache.values()].reduce(
        (total, block) => total + block.overlays.size,
        0,
      ) + [...this.parcelGroupCache.values()].reduce(
        (total, group) => total + (group?.overlays.size ?? 0),
        0,
      ),
      cachedSolidTiles: [...this.blockCache.values()].reduce(
        (total, block) => total + block.solid.size,
        0,
      ) + [...this.parcelGroupCache.values()].reduce(
        (total, group) => total + (group?.solid.size ?? 0),
        0,
      ),
      blockSize: this.blockSize,
      maxCachedBlocks: this.maxCachedBlocks,
      maxCachedRouteContactCells: this.maxCachedRouteContactCells,
      maxCachedEnvironmentContactCells: this.maxCachedEnvironmentContactCells,
      preparedViewports: this.preparedViewports.size,
      preparedTerrainTiles: [...this.preparedViewports.values()].reduce(
        (total, viewport) => total + viewport.terrainTiles,
        0,
      ),
      preparedMaterializedTerrainTiles: [...this.preparedViewports.values()].reduce(
        (total, viewport) => total + viewport.materializedTerrainTiles(),
        0,
      ),
      preparedMaterializedOverlayTiles: [...this.preparedViewports.values()].reduce(
        (total, viewport) => total + viewport.materializedOverlayTiles(),
        0,
      ),
    };
  }

  /** Resolve the same constrained placement used by block composition. This is
   * useful to population systems and proof tooling; it does not create a
   * second placement algorithm. */
  resolveLandmarkPlacement(siteX: number, siteY: number): RegionalLandmarkPlacement | null {
    const placement = this.createPlacement(Math.floor(siteX), Math.floor(siteY));
    return placement ? {
      assetId: placement.asset.id,
      kind: 'landmark',
      families: placement.asset.families,
      siteX: placement.siteX,
      siteY: placement.siteY,
      anchorX: placement.anchorX,
      anchorY: placement.anchorY,
    } : null;
  }

  getAmbientPlacementsInBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): RegionalAssetPlacement[] {
    const placements: RegionalAssetPlacement[] = [];
    const firstBlockX = floorDiv(Math.floor(minX), this.blockSize);
    const lastBlockX = floorDiv(Math.floor(maxX), this.blockSize);
    const firstBlockY = floorDiv(Math.floor(minY), this.blockSize);
    const lastBlockY = floorDiv(Math.floor(maxY), this.blockSize);
    for (let blockY = firstBlockY; blockY <= lastBlockY; blockY++) {
      for (let blockX = firstBlockX; blockX <= lastBlockX; blockX++) {
        for (const placement of this.getBlock(blockX, blockY).placements) {
          if (placement.kind !== 'ambient' || placement.anchorX < minX || placement.anchorX > maxX ||
              placement.anchorY < minY || placement.anchorY > maxY) continue;
          placements.push({
            assetId: placement.asset.id,
            kind: 'ambient',
            families: placement.asset.families,
            siteX: placement.siteX,
            siteY: placement.siteY,
            anchorX: placement.anchorX,
            anchorY: placement.anchorY,
            parcelId: placement.parcelId,
            accessAxis: placement.accessAxis,
            routeKind: placement.routeKind,
            parcelLayers: placement.parcelLayers,
            connectorLength: placement.connectorLength,
            parcelPathId: placement.parcelPathId,
            parcelStation: placement.parcelStation,
            pathTangentX: placement.pathTangentX,
            pathTangentY: placement.pathTangentY,
            waterfrontId: placement.waterfrontId,
            waterfrontFunction: placement.waterfrontFunction,
            quayAccessPath: placement.quayAccessPath,
          });
        }
      }
    }
    return placements.sort((a, b) => a.anchorY - b.anchorY || a.anchorX - b.anchorX ||
      a.assetId.localeCompare(b.assetId));
  }

  getCivicDetailPlacementsInBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): RegionalAssetPlacement[] {
    const placements: RegionalAssetPlacement[] = [];
    const firstBlockX = floorDiv(Math.floor(minX), this.blockSize);
    const lastBlockX = floorDiv(Math.floor(maxX), this.blockSize);
    const firstBlockY = floorDiv(Math.floor(minY), this.blockSize);
    const lastBlockY = floorDiv(Math.floor(maxY), this.blockSize);
    for (let blockY = firstBlockY; blockY <= lastBlockY; blockY++) {
      for (let blockX = firstBlockX; blockX <= lastBlockX; blockX++) {
        for (const placement of this.getBlock(blockX, blockY).placements) {
          if (placement.kind !== 'civic-detail' || placement.anchorX < minX ||
              placement.anchorX > maxX || placement.anchorY < minY || placement.anchorY > maxY) {
            continue;
          }
          placements.push({
            assetId: placement.asset.id,
            kind: 'civic-detail',
            families: placement.asset.families,
            siteX: placement.siteX,
            siteY: placement.siteY,
            anchorX: placement.anchorX,
            anchorY: placement.anchorY,
          });
        }
      }
    }
    return placements.sort((a, b) => a.anchorY - b.anchorY || a.anchorX - b.anchorX ||
      a.assetId.localeCompare(b.assetId));
  }

  getQuayDetailPlacementsInBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): RegionalAssetPlacement[] {
    const placements = new Map<string, RegionalAssetPlacement>();
    const firstBlockX = floorDiv(Math.floor(minX), this.blockSize);
    const lastBlockX = floorDiv(Math.floor(maxX), this.blockSize);
    const firstBlockY = floorDiv(Math.floor(minY), this.blockSize);
    const lastBlockY = floorDiv(Math.floor(maxY), this.blockSize);
    for (let blockY = firstBlockY; blockY <= lastBlockY; blockY++) {
      for (let blockX = firstBlockX; blockX <= lastBlockX; blockX++) {
        for (const placement of this.getBlock(blockX, blockY).placements) {
          if (placement.kind !== 'quay-detail') continue;
          const active = isAnimatedQuayDetailPlacement(placement)
            ? this.activeQuayDetailAnchor(
              placement,
              this.getWorldLifeState()?.worldMinute ?? this.quayDetailDefaultWorldMinute,
            )
            : { x: placement.anchorX, y: placement.anchorY };
          if (active.x < minX || active.x > maxX || active.y < minY || active.y > maxY) continue;
          const value: RegionalAssetPlacement = {
            assetId: placement.asset.id,
            kind: 'quay-detail',
            families: placement.asset.families,
            siteX: placement.siteX,
            siteY: placement.siteY,
            anchorX: placement.anchorX,
            anchorY: placement.anchorY,
            visualAnchorX: active.x,
            visualAnchorY: active.y,
            accessAxis: placement.accessAxis,
            parcelPathId: placement.parcelPathId,
            parcelStation: placement.parcelStation,
            pathTangentX: placement.pathTangentX,
            pathTangentY: placement.pathTangentY,
            waterfrontId: placement.waterfrontId,
          };
          placements.set(`${value.assetId}:${value.anchorX},${value.anchorY}`, value);
        }
      }
    }
    return [...placements.values()].sort((a, b) => a.anchorY - b.anchorY ||
      a.anchorX - b.anchorX || a.assetId.localeCompare(b.assetId));
  }

  override getLightSourcesInBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): WorldLightSource[] {
    const lights = new Map<string, WorldLightSource>();
    const firstBlockX = floorDiv(Math.floor(minX), this.blockSize) - 1;
    const lastBlockX = floorDiv(Math.floor(maxX), this.blockSize) + 1;
    const firstBlockY = floorDiv(Math.floor(minY), this.blockSize) - 1;
    const lastBlockY = floorDiv(Math.floor(maxY), this.blockSize) + 1;
    for (let blockY = firstBlockY; blockY <= lastBlockY; blockY++) {
      for (let blockX = firstBlockX; blockX <= lastBlockX; blockX++) {
        for (const placement of this.getBlock(blockX, blockY).placements) {
          if (!placement.asset.emitsLight || placement.anchorX < minX || placement.anchorX > maxX ||
              placement.anchorY < minY || placement.anchorY > maxY) continue;
          const id = `${placement.asset.id}:${placement.anchorX},${placement.anchorY}`;
          lights.set(id, {
            id,
            x: placement.anchorX,
            y: placement.anchorY - 0.35,
            radius: placement.kind === 'landmark' ? 5.5 : 4.25,
            intensity: placement.kind === 'landmark' ? 0.82 : 0.74,
            color: { r: 255, g: 177, b: 88 },
          });
        }
      }
    }
    return [...lights.values()].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  }

  getRouteContactPlacementsInBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): RegionalAssetPlacement[] {
    const placements: RegionalAssetPlacement[] = [];
    const firstCellX = floorDiv(Math.floor(minX), this.routeContactCellSize) - 1;
    const lastCellX = floorDiv(Math.floor(maxX), this.routeContactCellSize) + 1;
    const firstCellY = floorDiv(Math.floor(minY), this.routeContactCellSize) - 1;
    const lastCellY = floorDiv(Math.floor(maxY), this.routeContactCellSize) + 1;
    for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
        const placement = this.getRouteContactPlacement(cellX, cellY);
        if (!placement || placement.anchorX < minX || placement.anchorX > maxX ||
            placement.anchorY < minY || placement.anchorY > maxY) continue;
        placements.push({
          assetId: placement.asset.id,
          kind: 'route-contact',
          families: placement.asset.families,
          siteX: placement.siteX,
          siteY: placement.siteY,
          anchorX: placement.anchorX,
          anchorY: placement.anchorY,
          parcelId: placement.parcelId,
          accessAxis: placement.accessAxis,
          routeKind: placement.routeKind,
          parcelLayers: placement.parcelLayers,
          connectorLength: placement.connectorLength,
        });
      }
    }
    return placements.sort((a, b) => a.anchorY - b.anchorY || a.anchorX - b.anchorX ||
      a.assetId.localeCompare(b.assetId));
  }

  getParcelComponentPlacementsInBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): RegionalAssetPlacement[] {
    const placements: RegionalAssetPlacement[] = [];
    const bounds = normalizedPreparedBounds(minX, minY, maxX, maxY);
    const seen = new Set<string>();
    for (const group of this.getParcelGroupsInBounds(bounds)) {
      for (const placement of group.components) {
        if (placement.anchorX < minX || placement.anchorX > maxX ||
            placement.anchorY < minY || placement.anchorY > maxY) continue;
        const key = `${placement.parcelId}:${placement.asset.id}:${placement.anchorX},${placement.anchorY}`;
        if (seen.has(key)) continue;
        seen.add(key);
        placements.push({
          assetId: placement.asset.id,
          kind: 'parcel-component',
          families: placement.asset.families,
          siteX: placement.siteX,
          siteY: placement.siteY,
          anchorX: placement.anchorX,
          anchorY: placement.anchorY,
          parcelId: placement.parcelId,
          accessAxis: placement.accessAxis,
          routeKind: placement.routeKind,
          parcelLayers: placement.parcelLayers,
          connectorLength: placement.connectorLength,
          parcelPathId: placement.parcelPathId,
          parcelStation: placement.parcelStation,
          pathTangentX: placement.pathTangentX,
          pathTangentY: placement.pathTangentY,
          waterfrontId: placement.waterfrontId,
          waterfrontFunction: placement.waterfrontFunction,
        });
      }
    }
    return placements.sort((a, b) => a.anchorY - b.anchorY || a.anchorX - b.anchorX ||
      a.assetId.localeCompare(b.assetId));
  }

  getParcelConnectorCellsInBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): RegionalParcelConnectorCell[] {
    const cells: RegionalParcelConnectorCell[] = [];
    const bounds = normalizedPreparedBounds(minX, minY, maxX, maxY);
    for (const [key, connector] of this.collectParcelLayers(bounds).connectors) {
      const separator = key.indexOf(',');
      const x = Number(key.slice(0, separator));
      const y = Number(key.slice(separator + 1));
      cells.push({
        x,
        y,
        parcelId: connector.parcelId,
        pathId: connector.path.id,
        routeKind: connector.routeKind,
        core: connector.core,
        protected: connector.protected,
        arcLength: connector.path.arcLength,
        lateralOffset: connector.path.lateralOffset,
      });
    }
    return cells.sort((a, b) => a.y - b.y || a.x - b.x || a.parcelId.localeCompare(b.parcelId));
  }

  /** Geometry evidence for faithful research and diagnostics. Layouts remain
   * immutable products of route contacts; callers cannot influence caches. */
  getParcelLayoutsInBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): RegionalParcelLayout[] {
    const bounds = normalizedPreparedBounds(minX, minY, maxX, maxY);
    const layouts = new Map<string, RegionalParcelLayout>();
    for (const group of this.getParcelGroupsInBounds(bounds)) {
      if (group.layout.plots.length > 0) layouts.set(group.layout.id, group.layout);
    }
    return [...layouts.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  getLandmarkFabricLayoutsInBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): RegionalLandmarkFabricLayout[] {
    const bounds = normalizedPreparedBounds(minX, minY, maxX, maxY);
    const layouts = new Map<string, RegionalLandmarkFabricLayout>();
    const firstBlockX = floorDiv(bounds.minX, this.blockSize);
    const lastBlockX = floorDiv(bounds.maxX, this.blockSize);
    const firstBlockY = floorDiv(bounds.minY, this.blockSize);
    const lastBlockY = floorDiv(bounds.maxY, this.blockSize);
    for (let blockY = firstBlockY; blockY <= lastBlockY; blockY++) {
      for (let blockX = firstBlockX; blockX <= lastBlockX; blockX++) {
        for (const surface of this.getBlock(blockX, blockY).landmarkFabricSurfaces.values()) {
          layouts.set(surface.layout.id, surface.layout);
        }
      }
    }
    return [...layouts.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  getWaterfrontLayoutsInBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): RegionalWaterfrontLayout[] {
    const bounds = normalizedPreparedBounds(minX, minY, maxX, maxY);
    const layouts = new Map<string, RegionalWaterfrontLayout>();
    for (const group of this.getParcelGroupsInBounds(bounds)) {
      if (group.waterfrontLayout) layouts.set(group.waterfrontLayout.id, group.waterfrontLayout);
    }
    return [...layouts.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  getQuayLayoutsInBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): RegionalQuayLayout[] {
    const bounds = normalizedPreparedBounds(minX, minY, maxX, maxY);
    return this.quayLayouts.filter((layout) => (
      layout.bounds.maxX >= bounds.minX && layout.bounds.minX <= bounds.maxX &&
      layout.bounds.maxY >= bounds.minY && layout.bounds.minY <= bounds.maxY
    ));
  }

  getEnvironmentContactPlacementsInBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): RegionalAssetPlacement[] {
    const placements: RegionalAssetPlacement[] = [];
    const firstCellX = floorDiv(Math.floor(minX), this.environmentContactCellSize) - 1;
    const lastCellX = floorDiv(Math.floor(maxX), this.environmentContactCellSize) + 1;
    const firstCellY = floorDiv(Math.floor(minY), this.environmentContactCellSize) - 1;
    const lastCellY = floorDiv(Math.floor(maxY), this.environmentContactCellSize) + 1;
    for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
        const placement = this.getEnvironmentContactPlacement(cellX, cellY);
        if (!placement || placement.anchorX < minX || placement.anchorX > maxX ||
            placement.anchorY < minY || placement.anchorY > maxY) continue;
        placements.push({
          assetId: placement.asset.id,
          kind: 'environment-contact',
          families: placement.asset.families,
          siteX: placement.siteX,
          siteY: placement.siteY,
          anchorX: placement.anchorX,
          anchorY: placement.anchorY,
          environmentProgram: placement.environmentProgram,
          environmentProgramId: placement.environmentProgramId,
        });
      }
    }
    return placements.sort((a, b) => a.anchorY - b.anchorY || a.anchorX - b.anchorX ||
      a.assetId.localeCompare(b.assetId));
  }

  getEnvironmentProgramLayoutsInBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): RegionalEnvironmentProgramLayout[] {
    const bounds = normalizedPreparedBounds(minX, minY, maxX, maxY);
    const layouts = new Map<string, RegionalEnvironmentProgramLayout>();
    for (const program of this.getEnvironmentProgramsInBounds(bounds)) {
      layouts.set(program.layout.id, program.layout);
    }
    return [...layouts.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  override destroy(): void {
    if (this.ownsDerivedCache) this.derivedCache.clear();
    this.preparedViewports.clear();
    if (this.clearSharedCachesOnDestroy) this.compositor.clear();
    super.destroy();
  }

  private quayLayoutAt(worldX: number, worldY: number): RegionalQuayLayout | null {
    if (!this.field.sampleConstructedWaterway) return null;
    const tileX = Math.floor(worldX);
    const tileY = Math.floor(worldY);
    for (const layout of this.quayLayouts) {
      if (tileX + 1 < layout.bounds.minX || tileX > layout.bounds.maxX ||
          tileY + 1 < layout.bounds.minY || tileY > layout.bounds.maxY) continue;
      if (this.quayCellIsWalkable(tileX, tileY, layout)) return layout;
    }
    return null;
  }

  private quayCellIsWalkable(
    tileX: number,
    tileY: number,
    layout: RegionalQuayLayout,
  ): boolean {
    const sampleWaterway = this.field.sampleConstructedWaterway;
    if (!sampleWaterway) return false;
    return regionalQuayCellIsWalkable(
      Math.floor(tileX),
      Math.floor(tileY),
      layout,
      (worldX, worldY, id) => sampleWaterway.call(this.field, worldX, worldY, id),
    );
  }

  private findPreparedViewport(
    worldX: number,
    worldY: number,
    resolution?: number,
  ): ImportedPreparedViewport | null {
    const tileX = Math.floor(worldX);
    const tileY = Math.floor(worldY);
    let exact: ImportedPreparedViewport | null = null;
    let nearest: ImportedPreparedViewport | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const viewport of this.preparedViewports.values()) {
      if (tileX < viewport.bounds.minX || tileX > viewport.bounds.maxX ||
          tileY < viewport.bounds.minY || tileY > viewport.bounds.maxY) continue;
      if (resolution === undefined || viewport.resolution === resolution) {
        exact = viewport;
        continue;
      }
      // During a short animated zoom, keep consuming an already prepared
      // semantic LOD and let the renderer resample it while the exact target
      // package is generated off-thread. This prevents an intermediate zoom
      // size from falling through to synchronous world generation.
      const distance = Math.abs(Math.log(viewport.resolution / resolution));
      if (distance <= nearestDistance) {
        nearest = viewport;
        nearestDistance = distance;
      }
    }
    return exact ?? nearest;
  }

  private blocksNear(worldX: number, worldY: number): CachedBlock[] {
    const blocks: CachedBlock[] = [];
    const firstBlockX = floorDiv(worldX - this.placementMaxOffsetX, this.blockSize);
    const lastBlockX = floorDiv(worldX - this.placementMinOffsetX, this.blockSize);
    const firstBlockY = floorDiv(worldY - this.placementMaxOffsetY, this.blockSize);
    const lastBlockY = floorDiv(worldY - this.placementMinOffsetY, this.blockSize);
    for (let blockY = firstBlockY; blockY <= lastBlockY; blockY++) {
      for (let blockX = firstBlockX; blockX <= lastBlockX; blockX++) {
        blocks.push(this.getBlock(blockX, blockY));
      }
    }
    return blocks;
  }

  private getBlock(blockX: number, blockY: number): CachedBlock {
    const key = `${blockX},${blockY}`;
    const cached = this.blockCache.get(key);
    if (cached) {
      cached.accessedAt = ++this.derivedCache.accessClock;
      this.blockCache.delete(key);
      this.blockCache.set(key, cached);
      return cached;
    }
    const block = this.buildBlock(blockX, blockY);
    this.blockCache.set(key, block);
    while (this.blockCache.size > this.maxCachedBlocks) {
      const oldest = this.blockCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.blockCache.delete(oldest);
    }
    return block;
  }

  private buildBlock(blockX: number, blockY: number): CachedBlock {
    const originX = blockX * this.blockSize;
    const originY = blockY * this.blockSize;
    const placements: Placement[] = [];
    const civicReservedPlacements: Placement[] = [];
    const landmarkFabricSurfaces = new Map<string, LandmarkFabricSurface>();
    const landmarkCompositionReach = this.quayDetails.length > 0
      ? LANDMARK_QUAY_DETAIL_REACH
      : LANDMARK_ENTOURAGE_REACH;
    const landmarkSites = this.routes.getLandmarkSites?.(
      originX - landmarkCompositionReach,
      originY - landmarkCompositionReach,
      originX + this.blockSize - 1 + landmarkCompositionReach,
      originY + this.blockSize - 1 + landmarkCompositionReach,
    );
    if (landmarkSites) {
      for (const site of landmarkSites) {
        const placement = this.createPlacement(site.x, site.y);
        if (!placement) continue;
        civicReservedPlacements.push(placement);
        if (site.x >= originX && site.x < originX + this.blockSize &&
            site.y >= originY && site.y < originY + this.blockSize) {
          placements.push(placement);
        }
        const entourageCandidates = this.buildLandmarkEntourage(placement);
        const quayFrontage = this.buildLandmarkQuayFrontage(placement, entourageCandidates.filter(
          (support) => isFocalCompositionAsset(support.asset),
        ));
        const frontageReserved = new Set<string>();
        for (const frontage of quayFrontage) {
          reserveVisibleFootprint(frontage, frontageReserved, 0);
          for (const [offsetX, offsetY] of frontage.asset.collision) {
            frontageReserved.add(positionKey(frontage.anchorX + offsetX, frontage.anchorY + offsetY));
          }
          for (const [x, y] of frontage.quayAccessPath ?? []) {
            frontageReserved.add(positionKey(x, y));
          }
        }
        const entourage = entourageCandidates.filter((support) => (
          isFocalCompositionAsset(support.asset) || (
            !visibleFootprintIntersects(support.asset, support.anchorX, support.anchorY, frontageReserved) &&
            !support.asset.collision.some(([offsetX, offsetY]) => frontageReserved.has(
              positionKey(support.anchorX + offsetX, support.anchorY + offsetY),
            ))
          )
        ));
        civicReservedPlacements.push(...entourage, ...quayFrontage);
        placements.push(...quayFrontage.filter((support) => (
          support.anchorX >= originX && support.anchorX < originX + this.blockSize &&
          support.anchorY >= originY && support.anchorY < originY + this.blockSize
        )));
        placements.push(...entourage.filter((support) => (
          support.anchorX >= originX && support.anchorX < originX + this.blockSize &&
          support.anchorY >= originY && support.anchorY < originY + this.blockSize
        )));
        const fabric = this.createLandmarkFabricSurface(placement, entourage);
        if (fabric) {
          for (const cell of rasterizeRegionalLandmarkFabricLayout(fabric.layout)) {
            if (cell.x < originX || cell.x >= originX + this.blockSize ||
                cell.y < originY || cell.y >= originY + this.blockSize) continue;
            landmarkFabricSurfaces.set(positionKey(cell.x, cell.y), fabric);
          }
        }
      }
    } else {
      for (let y = originY; y < originY + this.blockSize; y++) {
        for (let x = originX; x < originX + this.blockSize; x++) {
          const placement = this.createPlacement(x, y);
          if (placement) placements.push(placement);
        }
      }
    }
    const quayDetails = this.buildQuayDetailPlacements(
      originX,
      originY,
      civicReservedPlacements,
    );
    civicReservedPlacements.push(...quayDetails);
    placements.push(...quayDetails);
    placements.push(...this.buildCivicDetailPlacements(
      originX,
      originY,
      civicReservedPlacements,
    ));
    placements.push(...this.buildAmbientPlacements(originX, originY));
    placements.push(...this.buildEnvironmentContactPlacements(originX, originY));
    placements.push(...this.buildRouteContactPlacements(originX, originY));

    const { overlays, solid } = this.rasterizePlacements(placements);
    return {
      overlays,
      solid,
      landmarkFabricSurfaces,
      placements,
      accessedAt: ++this.derivedCache.accessClock,
    };
  }

  private rasterizePlacements(placements: readonly Placement[]): {
    overlays: Map<string, BuildingTileData>;
    solid: Set<string>;
  } {
    const overlays = new Map<string, BuildingTileData>();
    const solid = new Set<string>();
    for (const placement of placements) {
      if (!isAnimatedQuayDetailPlacement(placement)) {
        const [offsetX, offsetY] = getSpriteAnchor(placement.asset);
        for (let tileY = 0; tileY < placement.asset.sprite.height; tileY++) {
          for (let tileX = 0; tileX < placement.asset.sprite.width; tileX++) {
            const tile = placement.asset.sprite.tiles[tileY]?.[tileX];
            if (!tile || !hasVisiblePixels(tile)) continue;
            const x = placement.anchorX + tileX - offsetX;
            const y = placement.anchorY + tileY - offsetY;
            const key = positionKey(x, y);
            const beneath = overlays.get(key);
            overlays.set(key, beneath ? compositeTiles(beneath, tile) : tile);
          }
        }
      }
      for (const [offsetX, offsetY] of placement.asset.collision) {
        solid.add(positionKey(placement.anchorX + offsetX, placement.anchorY + offsetY));
      }
    }
    return { overlays, solid };
  }

  private getParcelGroup(
    cellX: number,
    cellY: number,
    knownContact?: Placement,
  ): CachedParcelGroup | null {
    const key = `${cellX},${cellY}`;
    if (this.parcelGroupCache.has(key)) {
      const cached = this.parcelGroupCache.get(key) ?? null;
      this.parcelGroupCache.delete(key);
      this.parcelGroupCache.set(key, cached);
      return cached;
    }
    const contact = knownContact ?? this.getRouteContactPlacement(cellX, cellY);
    let cached: CachedParcelGroup | null = null;
    if (contact) {
      const parcel = this.buildParcelGroup(contact);
      if (parcel.connectors.size > 0 || parcel.components.length > 0 || parcel.surfaces.size > 0 ||
          parcel.waterfrontSurfaces.size > 0) {
        const rasterized = this.rasterizePlacements(parcel.components);
        cached = {
          contact,
          components: parcel.components,
          connectors: parcel.connectors,
          surfaces: parcel.surfaces,
          waterfrontSurfaces: parcel.waterfrontSurfaces,
          layout: parcel.layout,
          waterfrontLayout: parcel.waterfrontLayout,
          overlays: rasterized.overlays,
          solid: rasterized.solid,
        };
      }
    }
    this.parcelGroupCache.set(key, cached);
    while (this.parcelGroupCache.size > this.maxCachedRouteContactCells) {
      const oldest = this.parcelGroupCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.parcelGroupCache.delete(oldest);
    }
    return cached;
  }

  private getParcelGroupsInBounds(
    bounds: RegionalPreparedViewport['bounds'],
  ): CachedParcelGroup[] {
    if (this.parcelComponents.length === 0) return [];
    const groups: CachedParcelGroup[] = [];
    const firstCellX = floorDiv(bounds.minX - this.parcelSourceReach, this.routeContactCellSize);
    const lastCellX = floorDiv(bounds.maxX + this.parcelSourceReach, this.routeContactCellSize);
    const firstCellY = floorDiv(bounds.minY - this.parcelSourceReach, this.routeContactCellSize);
    const lastCellY = floorDiv(bounds.maxY + this.parcelSourceReach, this.routeContactCellSize);
    for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
        const contact = this.getRouteContactPlacement(cellX, cellY);
        if (!contact || contact.siteX < bounds.minX - this.parcelGeometryReach ||
            contact.siteX > bounds.maxX + this.parcelGeometryReach ||
            contact.siteY < bounds.minY - this.parcelGeometryReach ||
            contact.siteY > bounds.maxY + this.parcelGeometryReach) continue;
        const group = this.getParcelGroup(cellX, cellY, contact);
        if (group) groups.push(group);
      }
    }
    return groups;
  }

  private getEnvironmentProgram(
    cellX: number,
    cellY: number,
    knownPlacement?: Placement,
  ): CachedEnvironmentProgram | null {
    const key = `${cellX},${cellY}`;
    if (this.environmentProgramCache.has(key)) {
      const cached = this.environmentProgramCache.get(key) ?? null;
      this.environmentProgramCache.delete(key);
      this.environmentProgramCache.set(key, cached);
      return cached;
    }
    const placement = knownPlacement ?? this.getEnvironmentContactPlacement(cellX, cellY);
    let program: CachedEnvironmentProgram | null = null;
    if (placement?.environmentProgram && placement.environmentProgramId) {
      const constraints = (placement.asset as RegionalEnvironmentContactAsset).constraints;
      const nearestRoute = this.findNearestEnvironmentRoutePoint(
        placement.anchorX,
        placement.anchorY,
        Math.min(16, Math.ceil(constraints.routeDistance[1])),
      );
      if (nearestRoute) {
        const layout = buildRegionalEnvironmentProgramLayout({
          id: placement.environmentProgramId,
          kind: placement.environmentProgram,
          routePoint: nearestRoute.point,
          anchorPoint: { x: placement.anchorX + 0.5, y: placement.anchorY + 0.5 },
          seed: this.seed32 ^ stringHash(placement.environmentProgramId),
          maximumReach: placement.environmentProgram === 'cave-interior' ? 13 : 18,
          sampleTerrain: (worldX, worldY) => {
            const terrain = this.field.sample(Math.floor(worldX), Math.floor(worldY));
            return {
              elevation: terrain.elevation,
              slope: terrain.slope,
              isWater: terrain.isWater,
            };
          },
        });
        if (layout) {
          const surface: EnvironmentProgramSurface = {
            routeKind: nearestRoute.routeKind,
            layout,
          };
          const surfaces = new Map<string, EnvironmentProgramSurface>();
          const walkable = new Set<string>();
          const solid = new Set<string>();
          for (const cell of rasterizeRegionalEnvironmentProgramLayout(layout)) {
            const cellKey = positionKey(cell.x, cell.y);
            surfaces.set(cellKey, surface);
            if (cell.walkable) walkable.add(cellKey);
            if (cell.solid) solid.add(cellKey);
          }
          program = { placement, layout, surfaces, walkable, solid };
        }
      }
    }
    this.environmentProgramCache.set(key, program);
    while (this.environmentProgramCache.size > this.maxCachedEnvironmentContactCells) {
      const oldest = this.environmentProgramCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.environmentProgramCache.delete(oldest);
    }
    return program;
  }

  private getEnvironmentProgramsInBounds(
    bounds: RegionalPreparedViewport['bounds'],
  ): CachedEnvironmentProgram[] {
    const programs: CachedEnvironmentProgram[] = [];
    const firstCellX = floorDiv(bounds.minX - ENVIRONMENT_PROGRAM_REACH, this.environmentContactCellSize) - 1;
    const lastCellX = floorDiv(bounds.maxX + ENVIRONMENT_PROGRAM_REACH, this.environmentContactCellSize) + 1;
    const firstCellY = floorDiv(bounds.minY - ENVIRONMENT_PROGRAM_REACH, this.environmentContactCellSize) - 1;
    const lastCellY = floorDiv(bounds.maxY + ENVIRONMENT_PROGRAM_REACH, this.environmentContactCellSize) + 1;
    for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
        const placement = this.getEnvironmentContactPlacement(cellX, cellY);
        if (!placement?.environmentProgram ||
            placement.anchorX < bounds.minX - ENVIRONMENT_PROGRAM_REACH ||
            placement.anchorX > bounds.maxX + ENVIRONMENT_PROGRAM_REACH ||
            placement.anchorY < bounds.minY - ENVIRONMENT_PROGRAM_REACH ||
            placement.anchorY > bounds.maxY + ENVIRONMENT_PROGRAM_REACH) continue;
        const program = this.getEnvironmentProgram(cellX, cellY, placement);
        if (program) programs.push(program);
      }
    }
    return programs;
  }

  private findNearestEnvironmentRoutePoint(
    anchorX: number,
    anchorY: number,
    requestedRadius: number,
  ): { point: { x: number; y: number }; routeKind: RegionalRouteKind } | null {
    const radius = Math.max(2, Math.min(16, requestedRadius));
    let selected: {
      point: { x: number; y: number };
      routeKind: RegionalRouteKind;
      score: number;
    } | null = null;
    for (let y = anchorY - radius; y <= anchorY + radius; y++) {
      for (let x = anchorX - radius; x <= anchorX + radius; x++) {
        const directDistance = Math.hypot(x - anchorX, y - anchorY);
        if (directDistance > radius) continue;
        const route = this.routes.sample(x, y);
        if ((!route.isWalkableRoute && route.distance > 0.55) ||
            this.field.sample(x, y).isWater) continue;
        const score = directDistance + route.distance * 2;
        if (!selected || score < selected.score) {
          selected = {
            point: { x: x + 0.5, y: y + 0.5 },
            routeKind: route.routeKind ?? 'trail',
            score,
          };
        }
      }
    }
    return selected ? { point: selected.point, routeKind: selected.routeKind } : null;
  }

  private collectParcelLayers(
    bounds: RegionalPreparedViewport['bounds'],
  ): CollectedDerivedLayers {
    const overlays = new Map<string, BuildingTileData>();
    const solid = new Set<string>();
    const connectors = new Map<string, ParcelConnector>();
    const surfaces = new Map<string, ParcelSurface>();
    const waterfrontSurfaces = new Map<string, WaterfrontSurface>();
    const landmarkFabricSurfaces = new Map<string, LandmarkFabricSurface>();
    const environmentSurfaces = new Map<string, EnvironmentProgramSurface>();
    const environmentWalkable = new Set<string>();
    const environmentSolid = new Set<string>();
    const inside = (key: string): boolean => {
      const separator = key.indexOf(',');
      const x = Number(key.slice(0, separator));
      const y = Number(key.slice(separator + 1));
      return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
    };
    for (const group of this.getParcelGroupsInBounds(bounds)) {
      for (const [key, tile] of group.overlays) {
        if (!inside(key)) continue;
        const beneath = overlays.get(key);
        overlays.set(key, beneath ? compositeTiles(beneath, tile) : tile);
      }
      for (const key of group.solid) if (inside(key)) solid.add(key);
      for (const [key, connector] of group.connectors) {
        if (inside(key) && !connectors.has(key)) connectors.set(key, connector);
      }
      for (const [key, surface] of group.surfaces) {
        if (inside(key) && !surfaces.has(key)) surfaces.set(key, surface);
      }
      for (const [key, surface] of group.waterfrontSurfaces) {
        if (inside(key) && !waterfrontSurfaces.has(key)) waterfrontSurfaces.set(key, surface);
      }
    }
    for (const program of this.getEnvironmentProgramsInBounds(bounds)) {
      for (const [key, surface] of program.surfaces) {
        if (!inside(key) || environmentSurfaces.has(key)) continue;
        environmentSurfaces.set(key, surface);
        if (program.walkable.has(key)) environmentWalkable.add(key);
        if (program.solid.has(key)) environmentSolid.add(key);
      }
    }
    return {
      overlays,
      solid,
      connectors,
      surfaces,
      waterfrontSurfaces,
      landmarkFabricSurfaces,
      environmentSurfaces,
      environmentWalkable,
      environmentSolid,
      dynamicPlacements: [],
    };
  }

  private getParcelLayerBlock(worldX: number, worldY: number): CollectedDerivedLayers {
    const blockX = floorDiv(worldX, this.blockSize);
    const blockY = floorDiv(worldY, this.blockSize);
    const key = `${blockX},${blockY}`;
    const cached = this.parcelLayerCache.get(key);
    if (cached) {
      this.parcelLayerCache.delete(key);
      this.parcelLayerCache.set(key, cached);
      return cached;
    }
    const minX = blockX * this.blockSize;
    const minY = blockY * this.blockSize;
    const layers = this.collectParcelLayers({
      minX,
      minY,
      maxX: minX + this.blockSize - 1,
      maxY: minY + this.blockSize - 1,
    });
    for (const [surfaceKey, surface] of this.getBlock(blockX, blockY).landmarkFabricSurfaces) {
      layers.landmarkFabricSurfaces.set(surfaceKey, surface);
    }
    this.parcelLayerCache.set(key, layers);
    while (this.parcelLayerCache.size > this.maxCachedBlocks) {
      const oldest = this.parcelLayerCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.parcelLayerCache.delete(oldest);
    }
    return layers;
  }

  /** Expand one persistent route contact into a route-relative compound.
   * One continuous spine owns circulation and shared arc-length stations; both
   * sides derive their anchors from its local frame. No sprite is rotated,
   * stretched, or trusted to encode walkability in painted pixels. */
  private buildParcelGroup(contact: Placement): {
    components: Placement[];
    connectors: Map<string, ParcelConnector>;
    surfaces: Map<string, ParcelSurface>;
    waterfrontSurfaces: Map<string, WaterfrontSurface>;
    layout: RegionalParcelLayout;
    waterfrontLayout: RegionalWaterfrontLayout | null;
  } {
    const components: Placement[] = [];
    const connectors = new Map<string, ParcelConnector>();
    const surfaces = new Map<string, ParcelSurface>();
    const waterfrontSurfaces = new Map<string, WaterfrontSurface>();
    const emptyLayout = buildRegionalParcelLayout({
      id: `${contact.parcelId ?? 'parcel:missing'}:layout`,
      path: buildRegionalParcelPath({
        id: contact.parcelId ?? 'parcel:missing',
        startX: contact.siteX + 0.5,
        startY: contact.siteY + 0.5,
        tangentX: 1,
        tangentY: 0,
        outwardSign: 1,
        length: 4,
        lateralOffset: 0,
      }),
      centerStations: [],
      seed: this.seed32,
    });
    if (!contact.parcelId || !contact.accessAxis || !contact.routeKind ||
        this.parcelComponents.length === 0) return {
          components,
          connectors,
          surfaces,
          waterfrontSurfaces,
          layout: emptyLayout,
          waterfrontLayout: null,
        };
    const family = contact.asset.families[0];
    const hasWaterfrontProgram = this.parcelComponents.some((asset) => (
      family && asset.families.includes(family) && asset.programs?.includes('waterfront')
    ));
    const waterfrontCandidate = hasWaterfrontProgram
      ? this.resolveWaterfrontLayout(contact)
      : null;
    if (waterfrontCandidate) return this.buildWaterfrontGroup(
      contact,
      components,
      connectors,
      surfaces,
      waterfrontSurfaces,
      emptyLayout,
      waterfrontCandidate,
    );
    const requestedLayers = contact.parcelLayers ?? this.parcelLayerCount(contact.siteX, contact.siteY);
    let layers = requestedLayers;
    let connectorEnd = 3 + layers * this.parcelLayerSpacing + 1;
    let path: RegionalParcelPath | null = null;
    while (layers >= this.parcelMinimumLayers && !path) {
      connectorEnd = 3 + layers * this.parcelLayerSpacing + 1;
      path = this.selectParcelPath(contact, connectorEnd);
      if (!path) layers--;
    }
    if (!path) return this.buildWaterfrontGroup(
      contact,
      components,
      connectors,
      surfaces,
      waterfrontSurfaces,
      emptyLayout,
    );
    contact.parcelLayers = layers;
    contact.connectorLength = connectorEnd;
    contact.parcelPathId = path.id;
    for (const cell of rasterizeRegionalParcelPath(path)) {
      connectors.set(positionKey(cell.x, cell.y), {
        routeKind: contact.routeKind,
        parcelId: contact.parcelId,
        path,
        core: cell.core,
        protected: cell.protected,
      });
    }
    const stationDistances = Array.from(
      { length: layers },
      (_, layer) => 3 + (layer + 1) * this.parcelLayerSpacing,
    );
    const viableSides = ([-1, 1] as const).filter((side) => (
      this.parcelSideSupportsMinimumDepth(path!, side, stationDistances)
    ));
    const layout = buildRegionalParcelLayout({
      id: `${contact.parcelId}:layout`,
      path,
      centerStations: stationDistances,
      seed: this.seed32 ^ stringHash(contact.parcelId),
      minimumDepth: 3.8,
      maximumDepth: 6.2,
      civicOpeningRate: 0.36,
      sides: viableSides,
      constrainDepth: (sample) => this.constrainParcelDepth(sample),
    });
    const surface: ParcelSurface = { routeKind: contact.routeKind, layout };
    for (const cell of rasterizeRegionalParcelLayout(layout)) {
      surfaces.set(positionKey(cell.x, cell.y), surface);
    }
    const occupied = new Set(contact.asset.collision.map(([offsetX, offsetY]) => (
      positionKey(contact.anchorX + offsetX, contact.anchorY + offsetY)
    )));
    for (let layer = 1; layer <= layers; layer++) {
      const stationDistance = stationDistances[layer - 1]!;
      const station = sampleRegionalParcelPath(path, stationDistance);
      const normalX = -station.tangentY;
      const normalY = station.tangentX;
      const doubleSided = layer === 1 || this.hashUnit(
        contact.siteX + layer,
        contact.siteY,
        0x60f1,
      ) > 0.38;
      const preferredSide = this.hashUnit(contact.siteX, contact.siteY + layer, 0x19a7) < 0.5 ? -1 : 1;
      const sides: readonly number[] = doubleSided ? [-1, 1] : [preferredSide];
      for (const side of sides) {
        const plot = layout.plots.find((candidate) => (
          candidate.side === side && candidate.stationIndex === layer - 1
        ));
        if (!plot || plot.purpose === 'civic-opening') continue;
        const anchorX = Math.floor(station.x + normalX * side * PARCEL_SIDE_OFFSET);
        const anchorY = Math.floor(station.y + normalY * side * PARCEL_SIDE_OFFSET);
        const asset = this.selectParcelComponent(contact, layer, side);
        if (!asset || !this.assetFits(anchorX, anchorY, asset)) continue;
        const collisionKeys = asset.collision.map(([offsetX, offsetY]) =>
          positionKey(anchorX + offsetX, anchorY + offsetY));
        if (collisionKeys.some((key) => connectors.get(key)?.protected || occupied.has(key))) continue;
        for (const key of collisionKeys) occupied.add(key);
        components.push({
          asset,
          kind: 'parcel-component',
          siteX: contact.siteX,
          siteY: contact.siteY,
          anchorX,
          anchorY,
          parcelId: contact.parcelId,
          accessAxis: contact.accessAxis,
          routeKind: contact.routeKind,
          parcelLayers: layers,
          connectorLength: connectorEnd,
          parcelPathId: path.id,
          parcelStation: station.distance,
          pathTangentX: station.tangentX,
          pathTangentY: station.tangentY,
        });
      }
    }
    return {
      components,
      connectors,
      surfaces,
      waterfrontSurfaces,
      layout,
      waterfrontLayout: null,
    };
  }

  /** Require the complete minimum envelope to remain on traversable terrain
   * before creating one side of a parcel strip. This is deliberately numeric:
   * geography owns the decision, not a hand-maintained biome name table. */
  private parcelSideSupportsMinimumDepth(
    path: RegionalParcelPath,
    side: -1 | 1,
    centerStations: readonly number[],
  ): boolean {
    const probes = centerStations.flatMap((distance, index) => (
      index === 0 ? [distance] : [(centerStations[index - 1]! + distance) / 2, distance]
    ));
    for (const pathDistance of probes) {
      const frame = sampleRegionalParcelPath(path, pathDistance);
      const normalX = -frame.tangentY * side;
      const normalY = frame.tangentX * side;
      for (let offset = 1.15; offset <= 4.95; offset += 0.45) {
        const x = Math.floor(frame.x + normalX * offset);
        const y = Math.floor(frame.y + normalY * offset);
        const terrain = this.field.sample(x, y);
        if (terrain.isWater || terrain.slope > 0.82) return false;
      }
    }
    return true;
  }

  /** Convert a route threshold that legitimately terminates at water into a
   * working edge instead of rejecting it or bending it back inland. Numeric
   * shore evidence owns eligibility; manifest program metadata owns function. */
  private buildWaterfrontGroup(
    contact: Placement,
    components: Placement[],
    connectors: Map<string, ParcelConnector>,
    surfaces: Map<string, ParcelSurface>,
    waterfrontSurfaces: Map<string, WaterfrontSurface>,
    emptyLayout: RegionalParcelLayout,
    resolvedLayout?: RegionalWaterfrontLayout,
  ): {
    components: Placement[];
    connectors: Map<string, ParcelConnector>;
    surfaces: Map<string, ParcelSurface>;
    waterfrontSurfaces: Map<string, WaterfrontSurface>;
    layout: RegionalParcelLayout;
    waterfrontLayout: RegionalWaterfrontLayout | null;
  } {
    const family = contact.asset.families[0];
    const programAssets = this.parcelComponents.filter((asset) => (
      family && asset.families.includes(family) && asset.programs?.includes('waterfront')
    )).sort((a, b) => a.id.localeCompare(b.id));
    if (programAssets.length === 0 || !contact.parcelId || !contact.routeKind) {
      return {
        components,
        connectors,
        surfaces,
        waterfrontSurfaces,
        layout: emptyLayout,
        waterfrontLayout: null,
      };
    }
    const waterfrontLayout = resolvedLayout ?? this.resolveWaterfrontLayout(contact);
    if (!waterfrontLayout) {
      return {
        components,
        connectors,
        surfaces,
        waterfrontSurfaces,
        layout: emptyLayout,
        waterfrontLayout: null,
      };
    }
    for (const cell of rasterizeRegionalParcelPath(waterfrontLayout.accessPath)) {
      connectors.set(positionKey(cell.x, cell.y), {
        routeKind: contact.routeKind,
        parcelId: contact.parcelId,
        path: waterfrontLayout.accessPath,
        core: cell.core,
        protected: cell.protected,
      });
    }
    const waterfrontSurface: WaterfrontSurface = {
      routeKind: contact.routeKind,
      layout: waterfrontLayout,
    };
    for (const cell of rasterizeRegionalWaterfrontLayout(waterfrontLayout)) {
      waterfrontSurfaces.set(positionKey(cell.x, cell.y), waterfrontSurface);
    }

    const protectedCells = new Set([...connectors.entries()]
      .filter(([, connector]) => connector.protected)
      .map(([key]) => key));
    const occupied = new Set(contact.asset.collision.map(([offsetX, offsetY]) => (
      positionKey(contact.anchorX + offsetX, contact.anchorY + offsetY)
    )));
    const base = Math.floor(this.hashUnit(contact.siteX, contact.siteY, 0x2af3) * programAssets.length);
    const offsets = [-4.4, 4.4];
    for (const [index, tangentOffset] of offsets.entries()) {
      const asset = programAssets[(base + index) % programAssets.length]!;
      const candidates: Array<{
        anchorX: number;
        anchorY: number;
        collisionKeys: string[];
        score: number;
      }> = [];
      for (let anchorY = Math.floor(waterfrontLayout.bounds.minY);
        anchorY <= Math.ceil(waterfrontLayout.bounds.maxY); anchorY++) {
        for (let anchorX = Math.floor(waterfrontLayout.bounds.minX);
          anchorX <= Math.ceil(waterfrontLayout.bounds.maxX); anchorX++) {
          const sample = sampleRegionalWaterfrontLayout(
            anchorX + 0.5,
            anchorY + 0.5,
            waterfrontLayout,
          );
          if (sample.workYardWeight < 0.35) continue;
          const collisionKeys = asset.collision.map(([offsetX, offsetY]) => (
            positionKey(anchorX + offsetX, anchorY + offsetY)
          ));
          if (collisionKeys.some((key) => occupied.has(key) || protectedCells.has(key)) ||
              !this.assetFits(anchorX, anchorY, asset)) continue;
          const relativeX = anchorX + 0.5 - waterfrontLayout.shorePoint.x;
          const relativeY = anchorY + 0.5 - waterfrontLayout.shorePoint.y;
          const tangentDistance = relativeX * waterfrontLayout.shoreTangentX +
            relativeY * waterfrontLayout.shoreTangentY;
          const shoreDistance = -(relativeX * waterfrontLayout.waterNormalX +
            relativeY * waterfrontLayout.waterNormalY);
          candidates.push({
            anchorX,
            anchorY,
            collisionKeys,
            score: Math.abs(tangentDistance - tangentOffset) + Math.abs(shoreDistance - 5.7) * 0.18,
          });
        }
      }
      const selected = candidates.sort((a, b) => (
        a.score - b.score || a.anchorY - b.anchorY || a.anchorX - b.anchorX
      ))[0] ?? null;
      if (!selected) continue;
      const { anchorX, anchorY, collisionKeys } = selected;
      for (const key of collisionKeys) occupied.add(key);
      components.push({
        asset,
        kind: 'parcel-component',
        siteX: contact.siteX,
        siteY: contact.siteY,
        anchorX,
        anchorY,
        parcelId: contact.parcelId,
        accessAxis: contact.accessAxis,
        routeKind: contact.routeKind,
        parcelLayers: 1,
        connectorLength: Math.ceil(waterfrontLayout.accessPath.arcLength),
        parcelPathId: waterfrontLayout.accessPath.id,
        parcelStation: waterfrontLayout.accessPath.arcLength,
        pathTangentX: waterfrontLayout.shoreTangentX,
        pathTangentY: waterfrontLayout.shoreTangentY,
        waterfrontId: waterfrontLayout.id,
        waterfrontFunction: asset.waterfrontFunction,
      });
    }
    return {
      components,
      connectors,
      surfaces,
      waterfrontSurfaces,
      layout: emptyLayout,
      waterfrontLayout,
    };
  }

  /** Find a dry-to-wet transition in a bounded fan around the authored route
   * threshold, then estimate the local water gradient. This is a physical
   * locator, not a family or asset-name lookup. */
  private resolveWaterfrontLayout(contact: Placement): RegionalWaterfrontLayout | null {
    if (!contact.parcelId) return null;
    const { outwardX: unitX, outwardY: unitY } = this.resolveParcelOutwardFrame(contact);
    const candidates: Array<{
      shoreX: number;
      shoreY: number;
      normalX: number;
      normalY: number;
      score: number;
    }> = [];
    for (const angle of [0, -0.32, 0.32, -0.62, 0.62]) {
      const directionX = unitX * Math.cos(angle) - unitY * Math.sin(angle);
      const directionY = unitX * Math.sin(angle) + unitY * Math.cos(angle);
      let previous = {
        x: contact.siteX + 0.5 + directionX * 2,
        y: contact.siteY + 0.5 + directionY * 2,
      };
      if (this.field.sample(Math.floor(previous.x), Math.floor(previous.y)).isWater) continue;
      let inWater = false;
      for (let distance = 2.5; distance <= 32; distance += 0.5) {
        const current = {
          x: contact.siteX + 0.5 + directionX * distance,
          y: contact.siteY + 0.5 + directionY * distance,
        };
        const water = this.field.sample(Math.floor(current.x), Math.floor(current.y)).isWater;
        if (!water) {
          previous = current;
          inWater = false;
          continue;
        }
        // Measure every distinct dry-to-wet transition. A nearer wet pocket
        // must not conceal a slightly farther navigable shoreline.
        if (inWater) continue;
        inWater = true;
        const cellX = Math.floor(current.x);
        const cellY = Math.floor(current.y);
        const occupancy = (x: number, y: number): number => Number(this.field.sample(x, y).isWater);
        let normalX = occupancy(cellX + 1, cellY) - occupancy(cellX - 1, cellY);
        let normalY = occupancy(cellX, cellY + 1) - occupancy(cellX, cellY - 1);
        const gradientLength = Math.hypot(normalX, normalY);
        if (gradientLength >= 0.5) {
          normalX /= gradientLength;
          normalY /= gradientLength;
        } else {
          normalX = directionX;
          normalY = directionY;
        }
        if (normalX * directionX + normalY * directionY < 0) {
          normalX *= -1;
          normalY *= -1;
        }
        const score = distance + Math.abs(angle) * 4 +
          this.field.sample(Math.floor(previous.x), Math.floor(previous.y)).slope * 8;
        candidates.push({
          // Keep the quay datum on the last proven dry sample. The first
          // half-tile of each pier crosses the measured cell boundary.
          shoreX: previous.x,
          shoreY: previous.y,
          normalX,
          normalY,
          score,
        });
      }
    }
    for (const candidate of candidates.sort((a, b) => a.score - b.score)) {
      const layout = buildRegionalWaterfrontLayout({
        id: `${contact.parcelId}:waterfront`,
        accessStart: { x: contact.siteX + 0.5, y: contact.siteY + 0.5 },
        shorePoint: { x: candidate.shoreX, y: candidate.shoreY },
        waterNormalX: candidate.normalX,
        waterNormalY: candidate.normalY,
        seed: this.seed32 ^ stringHash(contact.parcelId),
        isWater: (worldX, worldY) => this.field.sample(Math.floor(worldX), Math.floor(worldY)).isWater,
      });
      if (!layout || layout.piers.length < 2 || layout.slips.length < 1) continue;
      const dryPolygons = [layout.apron, ...layout.workYards];
      const drySamples = dryPolygons.flatMap((polygon) => polygon.polygon.map((point) => (
        !this.field.sample(Math.floor(point.x), Math.floor(point.y)).isWater
      )));
      const wetSamples = [...layout.piers, ...layout.slips].flatMap((polygon) => polygon.polygon.slice(2)
        .map((point) => this.field.sample(Math.floor(point.x), Math.floor(point.y)).isWater));
      if (drySamples.filter(Boolean).length / Math.max(1, drySamples.length) < 0.88 ||
          wetSamples.filter(Boolean).length / Math.max(1, wetSamples.length) < 0.75) continue;
      return layout;
    }
    return null;
  }

  /** Cap a shared rear station at the first physical obstruction. Adjacent
   * plots still consume that one constrained station, so the correction cannot
   * create cracks, overlaps, or cache-order-dependent ownership. */
  private constrainParcelDepth(sample: RegionalParcelDepthSample): number {
    let legalDepth = 0;
    for (let depth = 0.25; depth <= sample.proposedDepth + 1e-9; depth += 0.25) {
      const x = Math.floor(sample.frontage.x + sample.normalX * depth);
      const y = Math.floor(sample.frontage.y + sample.normalY * depth);
      const terrain = this.field.sample(x, y);
      const route = this.routes.sample(x, y);
      if (terrain.isWater || terrain.slope > 0.82 || route.distance < 0.85) break;
      legalDepth = depth;
    }
    return legalDepth;
  }

  private selectParcelComponent(
    contact: Placement,
    layer: number,
    side: number,
  ): RegionalParcelComponentAsset | null {
    const family = contact.asset.families[0];
    const candidates = this.parcelComponents
      // Landmark focals establish one deliberately rare hierarchy and own
      // route-facing access fabric. Reusing them as generic parcel rows would
      // turn that hierarchy into repeating scenery and detach the authored
      // frontage contract from its parent site.
      .filter((asset) => family && asset.families.includes(family) &&
        !isFocalCompositionAsset(asset))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (candidates.length === 0) return null;
    const base = Math.floor(this.hashUnit(contact.siteX, contact.siteY, 0x72b5) * candidates.length);
    const strideSeed = 1 + Math.floor(
      this.hashUnit(contact.siteX, contact.siteY, 0x44e9) * Math.max(1, candidates.length - 1),
    );
    const stride = coprimeStride(candidates.length, strideSeed);
    const ordinal = (layer - 1) * 2 + Number(side > 0);
    return candidates[(base + ordinal * stride) % candidates.length] ?? null;
  }

  private parcelLayerCount(siteX: number, siteY: number): number {
    const layerRange = this.parcelMaximumLayers - this.parcelMinimumLayers + 1;
    return this.parcelMinimumLayers + Math.floor(this.hashUnit(siteX, siteY, 0x28d3) * layerRange);
  }

  /** Apply local physical constraints to a small family of ideal curved
   * successors. A clear preferred bend wins; water or a second route can bend
   * it back toward the straight fallback. If no legal successor exists the
   * threshold remains, but no false walkable compound is fabricated. */
  private selectParcelPath(contact: Placement, connectorEnd: number): RegionalParcelPath | null {
    const { tangentX, tangentY, outwardSign } = this.resolveParcelOutwardFrame(contact);
    const maximumLateral = Math.min(14, connectorEnd * 0.72);
    const preferred = (this.hashUnit(contact.siteX, contact.siteY, 0x53bd) - 0.5) *
      maximumLateral * 2;
    const lateralCandidates = [...new Set([
      preferred,
      preferred * 0.35,
      preferred * -0.55,
      0,
      maximumLateral * 0.68,
      maximumLateral * -0.68,
      maximumLateral,
      -maximumLateral,
    ])];
    let selected: RegionalParcelPath | null = null;
    let selectedScore = Number.POSITIVE_INFINITY;
    for (const [candidateIndex, lateralOffset] of lateralCandidates.entries()) {
      const path = buildRegionalParcelPath({
        id: contact.parcelId!,
        startX: contact.siteX + 0.5,
        startY: contact.siteY + 0.5,
        tangentX,
        tangentY,
        outwardSign,
        length: connectorEnd,
        lateralOffset,
      });
      const coreCells = rasterizeRegionalParcelPath(path).filter((cell) => cell.core);
      const waterSamples = coreCells.filter((cell) => (
        Math.hypot(cell.x + 0.5 - path.points[0]!.x, cell.y + 0.5 - path.points[0]!.y) >= 3.25 &&
        this.field.sample(cell.x, cell.y).isWater
      )).length;
      let routeConflicts = 0;
      let slopeCost = 0;
      const stride = Math.max(1, Math.floor(path.points.length / 14));
      for (let index = 0; index < path.points.length; index += stride) {
        const point = path.points[index]!;
        const distance = path.cumulativeLength[index]!;
        if (distance < 3.25) continue;
        const x = Math.floor(point.x);
        const y = Math.floor(point.y);
        const biome = this.field.sample(x, y);
        slopeCost += biome.slope;
        if (distance > 5 && this.routes.sample(x, y).distance < 1.25) routeConflicts++;
      }
      if (waterSamples > 0) continue;
      const score = routeConflicts * 8 + slopeCost * 0.18 +
        Math.abs(lateralOffset - preferred) * 0.05 + candidateIndex * 1e-6;
      if (score < selectedScore) {
        selected = path;
        selectedScore = score;
      }
    }
    return selected;
  }

  /** One route-relative frame owns both ordinary parcel spines and working
   * waterfront approaches. Contact sprites retain cardinal authored axes, but
   * those axes cannot substitute for the continuously turning road normal. */
  private resolveParcelOutwardFrame(contact: Placement): {
    tangentX: number;
    tangentY: number;
    outwardX: number;
    outwardY: number;
    outwardSign: -1 | 1;
  } {
    const route = this.routes.sample(contact.siteX, contact.siteY);
    const tangentLength = Math.hypot(route.directionX, route.directionY);
    const tangentX = tangentLength >= 0.25
      ? route.directionX / tangentLength
      : contact.accessAxis === 'north-south' ? 1 : 0;
    const tangentY = tangentLength >= 0.25
      ? route.directionY / tangentLength
      : contact.accessAxis === 'north-south' ? 0 : 1;
    const normalX = -tangentY;
    const normalY = tangentX;
    const sideProjection = (contact.anchorX - contact.siteX) * normalX +
      (contact.anchorY - contact.siteY) * normalY;
    const outwardSign: -1 | 1 = sideProjection < 0 ? -1 : 1;
    return {
      tangentX,
      tangentY,
      outwardX: normalX * outwardSign,
      outwardY: normalY * outwardSign,
      outwardSign,
    };
  }

  private createPlacement(siteX: number, siteY: number): Placement | null {
    const route = this.routes.sample(siteX, siteY);
    if (!route.landmarkKind || route.landmarkDistance > 0.1) return null;
    const biome = this.field.sample(siteX, siteY);
    const asset = this.selectAsset(siteX, siteY, biome, route.landmarkKind);
    if (!asset) return null;
    const anchor = this.findConstrainedAnchor(siteX, siteY, route, asset);
    return anchor ? {
      asset,
      kind: 'landmark',
      landmarkKind: route.landmarkKind,
      siteX,
      siteY,
      ...anchor,
    } : null;
  }

  /** Turn a landmark into the parent of a compact local composition instead
   * of leaving one isolated sprite in an empty field. Candidate supports form
   * staggered frontage stations on both sides of the landmark's route frame,
   * then pass the same continuous family, route-distance, terrain, and
   * collision rules as ordinary ambient masses. The landmark site owns the
   * semantic group; support anchors own cache blocks, making the result
   * traversal-independent. */
  private buildLandmarkEntourage(landmark: Placement): Placement[] {
    if (landmark.kind !== 'landmark' || !landmark.landmarkKind || this.ambient.length === 0) return [];
    const profile = landmarkEntourageProfile(landmark.landmarkKind);
    const amount = profile.minimum + Math.floor(
      this.hashUnit(landmark.siteX, landmark.siteY, 0x61d3) *
      (profile.maximum - profile.minimum + 1),
    );
    const route = this.routes.sample(landmark.siteX, landmark.siteY);
    const directionLength = Math.hypot(route.directionX, route.directionY);
    const tangentX = directionLength > 0.1 ? route.directionX / directionLength : 1;
    const tangentY = directionLength > 0.1 ? route.directionY / directionLength : 0;
    const normalX = -tangentY;
    const normalY = tangentX;
    const sidePhase = this.hashUnit(landmark.siteX, landmark.siteY, 0x8b17) < 0.5 ? 0 : 1;
    const reserved = new Set<string>();
    const assetUsage = new Map<string, number>();
    reserveVisibleFootprint(landmark, reserved, 1);
    const supports: Placement[] = [];
    const attempts = amount * 5;
    const maximumStation = Math.max(1, Math.floor(profile.tangentReach / profile.stationSpacing));
    const stationCount = maximumStation * 2 + 1;
    for (let attempt = 0; attempt < attempts && supports.length < amount; attempt++) {
      const pairIndex = Math.floor(attempt / 2);
      const stationOrdinal = pairIndex % stationCount;
      const stationMagnitude = Math.ceil(stationOrdinal / 2);
      const stationIndex = stationOrdinal === 0
        ? 0
        : stationOrdinal % 2 === 1 ? stationMagnitude : -stationMagnitude;
      const side = (attempt + sidePhase) % 2 === 0 ? -1 : 1;
      const alongJitter = (
        this.hashUnit(landmark.siteX + attempt, landmark.siteY - attempt, 0x37c9) - 0.5
      ) * profile.stationJitter;
      const setbackJitter = (
        this.hashUnit(landmark.siteX - attempt, landmark.siteY + attempt, 0x4ad1) - 0.5
      ) * profile.setbackJitter;
      const along = stationIndex * profile.stationSpacing + alongJitter;
      const outward = side * (profile.frontageOffset + setbackJitter);
      let anchorX = Math.round(landmark.siteX + tangentX * along + normalX * outward);
      let anchorY = Math.round(landmark.siteY + tangentY * along + normalY * outward);
      const supportRoute = this.routes.sample(anchorX, anchorY);
      const biome = this.field.sample(anchorX, anchorY);
      const asset = this.selectEntourageAsset(
        anchorX,
        anchorY,
        landmark,
        biome,
        supportRoute,
        assetUsage,
        supports.filter((placement) => isFocalCompositionAsset(placement.asset)).length <
          profile.focalCount && attempt < Math.max(8, stationCount * 4),
        side,
      );
      if (asset && isFocalCompositionAsset(asset)) {
        const focalSearchIndex = Math.floor(attempt / 2);
        ({ anchorX, anchorY } = centredFocalAnchor(
          landmark,
          asset,
          side,
          Math.floor(focalSearchIndex / 5),
          symmetricSearchOffset(focalSearchIndex % 5),
        ));
      }
      if (!asset || !this.assetFits(anchorX, anchorY, asset) ||
          visibleFootprintIntersects(asset, anchorX, anchorY, reserved)) continue;
      const support: Placement = {
        asset,
        kind: 'ambient',
        siteX: landmark.siteX,
        siteY: landmark.siteY,
        anchorX,
        anchorY,
      };
      supports.push(support);
      const usageKey = assetVisualGroup(asset);
      assetUsage.set(usageKey, (assetUsage.get(usageKey) ?? 0) + 1);
      reserveVisibleFootprint(support, reserved, 0);
    }
    return supports;
  }

  /** Populate the reserved dry band behind a constructed quay with a sparse,
   * function-bearing frontage. Eligibility comes from manifest program tags,
   * family compatibility, continuous waterway geometry, and physical route /
   * terrain constraints. The selection is blue-noise-like in world space and
   * never depends on asset IDs or sampled raster colours. */
  private buildLandmarkQuayFrontage(
    landmark: Placement,
    existingSupports: readonly Placement[],
  ): readonly Placement[] {
    const family = landmark.asset.families[0];
    if (!family || !this.field.sampleConstructedWaterway) return [];
    const cacheKey = positionKey(landmark.siteX, landmark.siteY);
    const cached = this.quayFrontagePlacementCache.get(cacheKey);
    if (cached) {
      this.quayFrontagePlacementCache.delete(cacheKey);
      this.quayFrontagePlacementCache.set(cacheKey, cached);
      return cached;
    }
    const assets = this.parcelComponents.filter((asset) => (
      asset.families.includes(family) && asset.programs?.includes('waterfront') &&
      asset.waterfrontFunction && asset.quayBankSide !== undefined && asset.frontageAxis
    )).sort((a, b) => a.id.localeCompare(b.id));
    if (assets.length === 0) return [];
    const layouts = this.quayLayouts.filter((layout) => !(
      layout.bounds.maxX < landmark.siteX - LANDMARK_QUAY_DETAIL_REACH ||
      layout.bounds.minX > landmark.siteX + LANDMARK_QUAY_DETAIL_REACH ||
      layout.bounds.maxY < landmark.siteY - LANDMARK_QUAY_DETAIL_REACH ||
      layout.bounds.minY > landmark.siteY + LANDMARK_QUAY_DETAIL_REACH
    ));
    if (layouts.length === 0) return [];
    const ownershipLandmarks = (this.routes.getLandmarkSites?.(
      landmark.siteX - LANDMARK_QUAY_DETAIL_REACH * 2,
      landmark.siteY - LANDMARK_QUAY_DETAIL_REACH * 2,
      landmark.siteX + LANDMARK_QUAY_DETAIL_REACH * 2,
      landmark.siteY + LANDMARK_QUAY_DETAIL_REACH * 2,
    ) ?? [])
      .map((site) => this.createPlacement(site.x, site.y))
      .filter((placement): placement is Placement => (
        placement !== null && placement.asset.families.includes(family)
      ));

    const occupied = new Set<string>();
    const reservedVisible = new Set<string>();
    for (const placement of [landmark, ...existingSupports]) {
      for (const [offsetX, offsetY] of placement.asset.collision) {
        occupied.add(positionKey(placement.anchorX + offsetX, placement.anchorY + offsetY));
      }
      reserveVisibleFootprint(placement, reservedVisible, 0);
    }
    const selected: Placement[] = [];
    const assetUsage = new Map<string, number>();
    for (const layout of layouts) {
      const layoutCentreX = (layout.bounds.minX + layout.bounds.maxX) * 0.5;
      const layoutCentreY = (layout.bounds.minY + layout.bounds.maxY) * 0.5;
      const layoutOwner = ownershipLandmarks.reduce<Placement | null>((best, option) => {
        if (!best) return option;
        const bestDistance = Math.hypot(layoutCentreX - best.siteX, layoutCentreY - best.siteY);
        const optionDistance = Math.hypot(layoutCentreX - option.siteX, layoutCentreY - option.siteY);
        if (optionDistance < bestDistance - 1e-7) return option;
        if (Math.abs(optionDistance - bestDistance) > 1e-7) return best;
        return option.siteY < best.siteY ||
          (option.siteY === best.siteY && option.siteX < best.siteX) ||
          (option.siteY === best.siteY && option.siteX === best.siteX &&
            option.asset.id.localeCompare(best.asset.id) < 0)
          ? option
          : best;
      }, null);
      if (!layoutOwner || layoutOwner.siteX !== landmark.siteX ||
          layoutOwner.siteY !== landmark.siteY || layoutOwner.asset.id !== landmark.asset.id) continue;
      const candidatesByBank = new Map<-1 | 1, Array<{
        x: number;
        y: number;
        progress: number;
        tangentX: number;
        tangentY: number;
        normalX: number;
        normalY: number;
        score: number;
      }>>([[-1, []], [1, []]]);
      const minimumX = Math.max(Math.floor(layout.bounds.minX), landmark.siteX - 25);
      const maximumX = Math.min(Math.ceil(layout.bounds.maxX), landmark.siteX + 25);
      const minimumY = Math.max(Math.floor(layout.bounds.minY), landmark.siteY - 25);
      const maximumY = Math.min(Math.ceil(layout.bounds.maxY), landmark.siteY + 25);
      for (let y = minimumY; y <= maximumY; y++) {
        for (let x = minimumX; x <= maximumX; x++) {
          const waterway = this.field.sampleConstructedWaterway(x + 0.5, y + 0.5, layout.waterwayId);
          const sample = sampleRegionalQuayLayout(waterway, layout);
          if (!waterway || sample.frontageReserveWeight < 0.72) continue;
          const terrain = this.field.sample(x, y);
          const familyWeight = terrain.weights[BIOME_FAMILIES.indexOf(family)] ?? 0;
          const route = this.routes.sample(x, y);
          if (terrain.isWater || terrain.slope > 0.78 || familyWeight < 0.16 || route.distance < 2.2) {
            continue;
          }
          const landmarkDistance = Math.hypot(x - landmark.siteX, y - landmark.siteY);
          candidatesByBank.get(waterway.bankSide)!.push({
            x,
            y,
            progress: waterway.progress,
            tangentX: waterway.tangentX,
            tangentY: waterway.tangentY,
            normalX: waterway.bankNormalX,
            normalY: waterway.bankNormalY,
            score: this.hashUnit(x, y, 0x4eb7) - landmarkDistance * 0.012,
          });
        }
      }

      const perBankLimit = 3;
      for (const bankSide of [-1, 1] as const) {
        const accepted: Array<{
          x: number;
          y: number;
          progress: number;
          tangentSpan: number;
        }> = [];
        for (const candidate of candidatesByBank.get(bankSide)!.sort((a, b) => (
          b.score - a.score || a.y - b.y || a.x - b.x
        ))) {
          if (accepted.length >= perBankLimit) break;
          const frontageAxis: RegionalRouteContactAxis =
            Math.abs(candidate.tangentX) >= Math.abs(candidate.tangentY)
              ? 'east-west'
              : 'north-south';
          const eligible = assets.filter((asset) => (
            asset.quayBankSide === bankSide && asset.frontageAxis === frontageAxis
          )).sort((a, b) => (
            (assetUsage.get(a.id) ?? 0) - (assetUsage.get(b.id) ?? 0) ||
            spatialHash2DUnit(this.seed32 ^ stringHash(b.id), candidate.x, candidate.y, 0x7c31) -
              spatialHash2DUnit(this.seed32 ^ stringHash(a.id), candidate.x, candidate.y, 0x7c31) ||
            a.id.localeCompare(b.id)
          ));
          if (eligible.length === 0) continue;
          let asset: RegionalParcelComponentAsset | undefined;
          let tangentSpan = 0;
          let collisionKeys: string[] = [];
          let accessPath: readonly (readonly [number, number])[] | undefined;
          for (const option of eligible) {
            const optionSpan = frontageAxis === 'east-west'
              ? option.sprite.width
              : option.sprite.height;
            if (accepted.some((other) => (
              Math.hypot(candidate.x - other.x, candidate.y - other.y) <
                (optionSpan + other.tangentSpan) * 0.5 + 1.5 ||
              Math.abs(candidate.progress - other.progress) < 0.065
            ))) continue;
            const optionCollisionKeys = option.collision.map(([offsetX, offsetY]) => (
              positionKey(candidate.x + offsetX, candidate.y + offsetY)
            ));
            if (optionCollisionKeys.some((key) => occupied.has(key)) ||
                visibleFootprintIntersects(option, candidate.x, candidate.y, reservedVisible) ||
                !this.assetFits(candidate.x, candidate.y, option)) continue;
            const optionAccessPath = option.quayAccessOffset
              ? this.findQuayFrontageAccessPath(
                candidate.x,
                candidate.y,
                option,
                layout,
                occupied,
                new Set(optionCollisionKeys),
                -candidate.normalX,
                -candidate.normalY,
              ) ?? undefined
              : undefined;
            if (option.quayAccessOffset && !optionAccessPath) continue;
            asset = option;
            tangentSpan = optionSpan;
            collisionKeys = optionCollisionKeys;
            accessPath = optionAccessPath;
            break;
          }
          if (!asset) continue;
          for (const key of collisionKeys) occupied.add(key);
          for (const [x, y] of accessPath ?? []) occupied.add(positionKey(x, y));
          accepted.push({ ...candidate, tangentSpan });
          const placement: Placement = {
            asset,
            kind: 'ambient',
            siteX: landmark.siteX,
            siteY: landmark.siteY,
            anchorX: candidate.x,
            anchorY: candidate.y,
            parcelId: `quay-frontage:${layout.id}`,
            accessAxis: frontageAxis,
            routeKind: this.routes.sample(landmark.siteX, landmark.siteY).routeKind ?? 'local-road',
            parcelLayers: 1,
            connectorLength: accessPath ? accessPath.length - 1 : 0,
            parcelPathId: layout.id,
            parcelStation: candidate.progress,
            pathTangentX: candidate.tangentX,
            pathTangentY: candidate.tangentY,
            waterfrontId: layout.id,
            waterfrontFunction: asset.waterfrontFunction,
            quayAccessPath: accessPath,
          };
          selected.push(placement);
          assetUsage.set(asset.id, (assetUsage.get(asset.id) ?? 0) + 1);
          reserveVisibleFootprint(placement, reservedVisible, 0);
        }
      }
    }
    const stable = Object.freeze(selected
      .sort((a, b) => a.anchorY - b.anchorY || a.anchorX - b.anchorX ||
        a.asset.id.localeCompare(b.asset.id))
      .map((placement) => Object.freeze({
        ...placement,
        quayAccessPath: placement.quayAccessPath
          ? Object.freeze(placement.quayAccessPath.map((cell) => Object.freeze([...cell] as const)))
          : undefined,
      })));
    this.quayFrontagePlacementCache.set(cacheKey, stable);
    while (this.quayFrontagePlacementCache.size > this.maxCachedBlocks * 4) {
      const oldest = this.quayFrontagePlacementCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.quayFrontagePlacementCache.delete(oldest);
    }
    return stable;
  }

  /** Prove that a manifest-declared frontage doorway reaches the same quay
   * without crossing water or any established collision. The short BFS is
   * biased toward the continuous waterway normal but remains geometry-driven
   * and deterministic for curved channels. */
  private findQuayFrontageAccessPath(
    anchorX: number,
    anchorY: number,
    asset: RegionalParcelComponentAsset,
    layout: RegionalQuayLayout,
    occupied: ReadonlySet<string>,
    assetCollision: ReadonlySet<string>,
    preferredX: number,
    preferredY: number,
  ): readonly (readonly [number, number])[] | null {
    if (!asset.quayAccessOffset) return null;
    const startX = anchorX + asset.quayAccessOffset[0];
    const startY = anchorY + asset.quayAccessOffset[1];
    const startKey = positionKey(startX, startY);
    if (occupied.has(startKey) || assetCollision.has(startKey)) return null;
    const maximumLength = 9;
    const directions = ([
      [1, 0], [-1, 0], [0, 1], [0, -1],
    ] as const).slice().sort((a, b) => (
      b[0] * preferredX + b[1] * preferredY - (a[0] * preferredX + a[1] * preferredY) ||
      a[1] - b[1] || a[0] - b[0]
    ));
    const queue: Array<{ x: number; y: number; path: readonly (readonly [number, number])[] }> = [{
      x: startX,
      y: startY,
      path: [[startX, startY]],
    }];
    const visited = new Set([startKey]);
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index]!;
      if (this.quayCellIsWalkable(current.x, current.y, layout)) return current.path;
      if (current.path.length > maximumLength) continue;
      for (const [offsetX, offsetY] of directions) {
        const x = current.x + offsetX;
        const y = current.y + offsetY;
        if (Math.abs(x - startX) + Math.abs(y - startY) > maximumLength) continue;
        const key = positionKey(x, y);
        if (visited.has(key) || occupied.has(key) || assetCollision.has(key)) continue;
        const terrain = this.field.sample(x, y);
        if (terrain.isWater || terrain.slope > 0.78) continue;
        visited.add(key);
        queue.push({ x, y, path: [...current.path, [x, y]] });
      }
    }
    return null;
  }

  /** Derive walkable place ground from the placed focal contract. Large
   * art establishes the enclosing mass; a separate continuous material layer
   * joins only its declared entrance stations to circulation. This prevents
   * collision, traversal, or ground ownership from being guessed from pixels. */
  private createLandmarkFabricSurface(
    landmark: Placement,
    entourage: readonly Placement[],
  ): LandmarkFabricSurface | null {
    const focals: RegionalLandmarkFocalFootprint[] = [];
    for (const placement of entourage) {
      if (!isFocalCompositionAsset(placement.asset) ||
          placement.asset.frontageAxis === undefined ||
          placement.asset.compositionSide === undefined ||
          placement.asset.frontageStations === undefined) continue;
      const bounds = visibleSpriteWorldBounds(placement);
      if (!bounds) continue;
      focals.push({
        id: placement.asset.id,
        frontageAxis: placement.asset.frontageAxis,
        compositionSide: placement.asset.compositionSide,
        frontageStations: placement.asset.frontageStations,
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX + 1,
        maxY: bounds.maxY + 1,
      });
    }
    if (focals.length === 0) return null;
    const route = this.routes.sample(landmark.siteX, landmark.siteY);
    const layout = buildRegionalLandmarkFabricLayout({
      id: `landmark-fabric:${landmark.siteX}:${landmark.siteY}:${landmark.landmarkKind ?? 'site'}`,
      materialFamily: landmark.asset.families[0] ?? this.field.sample(
        landmark.siteX,
        landmark.siteY,
      ).primary,
      siteX: landmark.siteX + 0.5,
      siteY: landmark.siteY + 0.5,
      seed: this.seed32 ^ stringHash(`${landmark.siteX},${landmark.siteY}`),
      focals,
    });
    return layout ? { routeKind: route.routeKind ?? 'local-road', layout } : null;
  }

  /** Select support masses from the complete authored non-programmed family
   * vocabulary. The landmark supplies local cultural identity while the
   * candidate biome preserves ecotone influence. A usage penalty makes a
   * repeated silhouette lose to an equally compatible unused alternative;
   * this is data-driven over the manifest rather than an ID-specific table. */
  private selectEntourageAsset(
    worldX: number,
    worldY: number,
    landmark: Placement,
    biome: BiomeWorldSample,
    route: RegionalRouteSample,
    assetUsage: ReadonlyMap<string, number>,
    preferFocal: boolean,
    side: -1 | 1,
  ): RegionalVisualAsset | null {
    const parentBiome = this.field.sample(landmark.siteX, landmark.siteY);
    const parentRoute = this.routes.sample(landmark.siteX, landmark.siteY);
    const candidates: RegionalVisualAsset[] = [
      ...this.ambient.filter((asset) => {
        const [minimumRouteDistance, maximumRouteDistance] = asset.routeDistance;
        return route.distance >= minimumRouteDistance &&
          (maximumRouteDistance >= 999 || route.distance <= maximumRouteDistance);
      }),
      ...this.parcelComponents.filter((asset) => !asset.programs || asset.programs.length === 0),
    ];
    let selected: RegionalVisualAsset | null = null;
    let selectedScore = Number.NEGATIVE_INFINITY;
    for (const asset of candidates) {
      if (!asset.families.some((family) => landmark.asset.families.includes(family))) continue;
      if (!frontageMatchesRoute(asset, parentRoute)) continue;
      if ('compositionSide' in asset && asset.compositionSide !== undefined &&
          asset.compositionSide !== side) continue;
      const parentCompatibility = Math.max(...asset.families.map((family) => (
        parentBiome.weights[BIOME_FAMILIES.indexOf(family)] ?? 0
      )));
      const localCompatibility = Math.max(...asset.families.map((family) => (
        biome.weights[BIOME_FAMILIES.indexOf(family)] ?? 0
      )));
      const variation = this.hashUnit(worldX, worldY, stringHash(asset.id)) * 0.09;
      const usageKey = assetVisualGroup(asset);
      const repetitionPenalty = (assetUsage.get(usageKey) ?? 0) * 0.24;
      const focal = isFocalCompositionAsset(asset);
      if (focal && (assetUsage.get(usageKey) ?? 0) > 0) continue;
      const hierarchyBias = preferFocal ? (focal ? 2 : 0) : (focal ? -2 : 0);
      const score = parentCompatibility * 0.68 + localCompatibility * 0.32 +
        variation + hierarchyBias - repetitionPenalty;
      if (score > selectedScore) {
        selected = asset;
        selectedScore = score;
      }
    }
    return selected;
  }

  private buildAmbientPlacements(originX: number, originY: number): Placement[] {
    if (this.ambient.length === 0 || this.ambientDensity <= 0) return [];
    const placements: Placement[] = [];
    const firstCellX = floorDiv(originX, this.ambientCellSize) - 1;
    const lastCellX = floorDiv(originX + this.blockSize - 1, this.ambientCellSize) + 1;
    const firstCellY = floorDiv(originY, this.ambientCellSize) - 1;
    const lastCellY = floorDiv(originY + this.blockSize - 1, this.ambientCellSize) + 1;
    for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
        const candidate = this.ambientCandidate(cellX, cellY);
        if (candidate.x < originX || candidate.x >= originX + this.blockSize ||
            candidate.y < originY || candidate.y >= originY + this.blockSize ||
            !this.isAmbientPriorityMaximum(cellX, cellY) ||
            this.hashUnit(cellX, cellY, 0x4d17) > this.ambientDensity *
              this.ambientDistributionWeight(candidate.x, candidate.y)) continue;
        const route = this.routes.sample(candidate.x, candidate.y);
        if (route.landmarkDistance < this.ambientLandmarkClearance) continue;
        const biome = this.field.sample(candidate.x, candidate.y);
        const asset = this.selectAmbientAsset(candidate.x, candidate.y, biome, route);
        if (!asset || !this.assetFits(candidate.x, candidate.y, asset)) continue;
        placements.push({
          asset,
          kind: 'ambient',
          siteX: candidate.x,
          siteY: candidate.y,
          anchorX: candidate.x,
          anchorY: candidate.y,
        });
      }
    }
    return placements;
  }

  /** Bind authored activity to continuous constructed-waterway contact. Each
   * manifest asset owns a signed bank-distance envelope, physical surface,
   * tangent axis, spacing, bounded count, and priority. The algorithm scans
   * geometry rather than names, then caches one immutable result per landmark
   * so block traversal order cannot change the composition. */
  private buildQuayDetailPlacements(
    originX: number,
    originY: number,
    composition: readonly Placement[],
  ): Placement[] {
    if (this.quayDetails.length === 0 || this.quayDetailDensity <= 0 ||
        !this.field.sampleConstructedWaterway) return [];
    const landmarks = composition
      .filter((placement) => placement.kind === 'landmark')
      .sort((a, b) => a.siteY - b.siteY || a.siteX - b.siteX || a.asset.id.localeCompare(b.asset.id));
    const visible: Placement[] = [];
    for (const landmark of landmarks) {
      const cacheKey = `${landmark.siteX},${landmark.siteY}:${landmark.asset.id}`;
      const cached = this.quayDetailPlacementCache.get(cacheKey);
      if (cached) {
        this.quayDetailPlacementCache.delete(cacheKey);
        this.quayDetailPlacementCache.set(cacheKey, cached);
        visible.push(...cached.filter((placement) => (
          placement.anchorX >= originX && placement.anchorX < originX + this.blockSize &&
          placement.anchorY >= originY && placement.anchorY < originY + this.blockSize
        )));
        continue;
      }

      const reservedVisible = new Set<string>();
      const detailVisible = new Set<string>();
      const occupied = new Set<string>();
      for (const placement of composition) {
        if (placement.siteX !== landmark.siteX || placement.siteY !== landmark.siteY) continue;
        reserveVisibleFootprint(placement, reservedVisible, 0);
        for (const [offsetX, offsetY] of placement.asset.collision) {
          occupied.add(positionKey(placement.anchorX + offsetX, placement.anchorY + offsetY));
        }
      }
      const eligibleLayouts = this.quayLayouts.filter((layout) => !(
        layout.bounds.maxX < landmark.siteX - LANDMARK_QUAY_DETAIL_REACH ||
        layout.bounds.minX > landmark.siteX + LANDMARK_QUAY_DETAIL_REACH ||
        layout.bounds.maxY < landmark.siteY - LANDMARK_QUAY_DETAIL_REACH ||
        layout.bounds.minY > landmark.siteY + LANDMARK_QUAY_DETAIL_REACH
      ));
      const ownershipLandmarks = (this.routes.getLandmarkSites?.(
        landmark.siteX - LANDMARK_QUAY_DETAIL_REACH * 2,
        landmark.siteY - LANDMARK_QUAY_DETAIL_REACH * 2,
        landmark.siteX + LANDMARK_QUAY_DETAIL_REACH * 2,
        landmark.siteY + LANDMARK_QUAY_DETAIL_REACH * 2,
      ) ?? [])
        .map((site) => this.createPlacement(site.x, site.y))
        .filter((placement): placement is Placement => placement !== null);
      const selected: Placement[] = [];
      const orderedAssets = [...this.quayDetails].sort((a, b) => (
        b.placementPriority - a.placementPriority || a.id.localeCompare(b.id)
      ));
      for (const asset of orderedAssets) {
        const candidates: Array<{
          layout: RegionalQuayLayout;
          waterway: ConstructedWaterwaySample;
          axis: RegionalRouteContactAxis;
          x: number;
          y: number;
          score: number;
        }> = [];
        for (const layout of eligibleLayouts) {
          const minimumX = Math.max(
            Math.floor(layout.bounds.minX),
            landmark.siteX - LANDMARK_QUAY_DETAIL_REACH,
          );
          const maximumX = Math.min(
            Math.ceil(layout.bounds.maxX),
            landmark.siteX + LANDMARK_QUAY_DETAIL_REACH,
          );
          const minimumY = Math.max(
            Math.floor(layout.bounds.minY),
            landmark.siteY - LANDMARK_QUAY_DETAIL_REACH,
          );
          const maximumY = Math.min(
            Math.ceil(layout.bounds.maxY),
            landmark.siteY + LANDMARK_QUAY_DETAIL_REACH,
          );
          for (let y = minimumY; y <= maximumY; y++) {
            for (let x = minimumX; x <= maximumX; x++) {
              const waterway = this.field.sampleConstructedWaterway!(
                x + 0.5,
                y + 0.5,
                layout.waterwayId,
              );
              if (!waterway || waterway.progress < asset.progressRange[0] ||
                  waterway.progress > asset.progressRange[1] ||
                  waterway.signedDistance < asset.bankDistance[0] ||
                  waterway.signedDistance > asset.bankDistance[1] ||
                  this.hashUnit(x, y, stringHash(asset.id) ^ 0x67a3) > this.quayDetailDensity) {
                continue;
              }
              const axis: RegionalRouteContactAxis =
                Math.abs(waterway.tangentX) >= Math.abs(waterway.tangentY)
                  ? 'east-west'
                  : 'north-south';
              if (asset.waterwayAxis !== 'any' && asset.waterwayAxis !== axis) continue;
              const biome = this.field.sample(x, y);
              const familyWeight = Math.max(...asset.families.map((family) => (
                biome.weights[BIOME_FAMILIES.indexOf(family)] ?? 0
              )));
              const route = this.routes.sample(x, y);
              const landmarkDistance = Math.hypot(x - landmark.siteX, y - landmark.siteY);
              const owner = ownershipLandmarks.reduce<Placement | null>((best, option) => {
                if (!best) return option;
                const bestDistance = Math.hypot(x - best.siteX, y - best.siteY);
                const optionDistance = Math.hypot(x - option.siteX, y - option.siteY);
                if (optionDistance < bestDistance - 1e-7) return option;
                if (Math.abs(optionDistance - bestDistance) > 1e-7) return best;
                return option.siteY < best.siteY ||
                  (option.siteY === best.siteY && option.siteX < best.siteX) ||
                  (option.siteY === best.siteY && option.siteX === best.siteX &&
                    option.asset.id.localeCompare(best.asset.id) < 0)
                  ? option
                  : best;
              }, null);
              if (!owner || owner.siteX !== landmark.siteX || owner.siteY !== landmark.siteY ||
                  owner.asset.id !== landmark.asset.id) continue;
              if (familyWeight < asset.minimumFamilyWeight ||
                  (asset.surface === 'water' && !biome.isWater) ||
                  (asset.surface === 'quay' && (
                    biome.isWater ||
                    sampleRegionalQuayLayout(waterway, layout).quayWeight < 0.5 ||
                    route.distance < 1.35
                  ))) continue;
              const envelopeMiddle = (asset.bankDistance[0] + asset.bankDistance[1]) * 0.5;
              const envelopeError = Math.abs(waterway.signedDistance - envelopeMiddle);
              candidates.push({
                layout,
                waterway,
                axis,
                x,
                y,
                score: this.hashUnit(x, y, stringHash(asset.id) ^ 0x39d1) -
                  landmarkDistance * 0.025 - envelopeError * 0.035,
              });
            }
          }
        }
        candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x ||
          a.layout.id.localeCompare(b.layout.id));
        let accepted = 0;
        for (const candidate of candidates) {
          if (accepted >= asset.maximumPerLandmark) break;
          if (selected.some((other) => Math.hypot(
            candidate.x - other.anchorX,
            candidate.y - other.anchorY,
          ) < (asset.minimumSpacing + (other.asset as RegionalQuayDetailAsset).minimumSpacing) * 0.5)) {
            continue;
          }
          if (!this.quayDetailFits(candidate.x, candidate.y, candidate.layout, asset) ||
              visibleFootprintIntersects(asset, candidate.x, candidate.y, detailVisible) ||
              (asset.surface === 'quay' &&
                visibleFootprintIntersects(asset, candidate.x, candidate.y, reservedVisible))) continue;
          const collisionKeys = asset.collision.map(([offsetX, offsetY]) => (
            positionKey(candidate.x + offsetX, candidate.y + offsetY)
          ));
          if (collisionKeys.some((key) => occupied.has(key))) continue;
          const placement: Placement = {
            asset,
            kind: 'quay-detail',
            siteX: landmark.siteX,
            siteY: landmark.siteY,
            anchorX: candidate.x,
            anchorY: candidate.y,
            accessAxis: candidate.axis,
            parcelPathId: candidate.layout.id,
            parcelStation: candidate.waterway.progress,
            pathTangentX: candidate.waterway.tangentX,
            pathTangentY: candidate.waterway.tangentY,
            waterfrontId: candidate.layout.id,
          };
          for (const key of collisionKeys) occupied.add(key);
          reserveVisibleFootprint(placement, reservedVisible, 0);
          reserveVisibleFootprint(placement, detailVisible, 0);
          selected.push(placement);
          accepted++;
        }
      }
      const stable = selected.sort((a, b) => a.anchorY - b.anchorY || a.anchorX - b.anchorX ||
        a.asset.id.localeCompare(b.asset.id));
      this.quayDetailPlacementCache.set(cacheKey, stable);
      while (this.quayDetailPlacementCache.size > this.maxCachedBlocks * 4) {
        const oldest = this.quayDetailPlacementCache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.quayDetailPlacementCache.delete(oldest);
      }
      visible.push(...stable.filter((placement) => (
        placement.anchorX >= originX && placement.anchorX < originX + this.blockSize &&
        placement.anchorY >= originY && placement.anchorY < originY + this.blockSize
      )));
    }
    return visible.sort((a, b) => a.anchorY - b.anchorY || a.anchorX - b.anchorX ||
      a.asset.id.localeCompare(b.asset.id));
  }

  private quayDetailFits(
    anchorX: number,
    anchorY: number,
    layout: RegionalQuayLayout,
    asset: RegionalQuayDetailAsset,
  ): boolean {
    for (const [offsetX, offsetY] of asset.collision) {
      const x = anchorX + offsetX;
      const y = anchorY + offsetY;
      const waterway = this.field.sampleConstructedWaterway?.(
        x + 0.5,
        y + 0.5,
        layout.waterwayId,
      );
      if (!waterway || waterway.signedDistance < asset.bankDistance[0] ||
          waterway.signedDistance > asset.bankDistance[1]) return false;
      const biome = this.field.sample(x, y);
      if (asset.surface === 'water') {
        if (!biome.isWater) return false;
      } else if (biome.isWater ||
          sampleRegionalQuayLayout(waterway, layout).quayWeight < 0.35 ||
          this.routes.sample(x, y).distance < 1.35) return false;
    }
    return true;
  }

  /** Populate only the social shoulder of an authored route landmark. The
   * coordinate field is stable, while semantic bands select modules and the
   * complete visible footprint of the established landmark composition is
   * reserved before any detail can be accepted. */
  private buildCivicDetailPlacements(
    originX: number,
    originY: number,
    composition: readonly Placement[],
  ): Placement[] {
    if (this.civicDetails.length === 0 || this.civicDetailDensity <= 0) return [];
    const landmarks = composition
      .filter((placement) => placement.kind === 'landmark')
      .sort((a, b) => a.siteY - b.siteY || a.siteX - b.siteX || a.asset.id.localeCompare(b.asset.id));
    if (landmarks.length === 0) return [];
    const placements: Placement[] = [];
    const maximumLandmarkDistance = Math.max(...this.civicDetails.map(
      (asset) => asset.landmarkDistance[1],
    ));
    for (const landmark of landmarks) {
      const cacheKey = `${landmark.siteX},${landmark.siteY}:${landmark.asset.id}`;
      const cached = this.civicDetailPlacementCache.get(cacheKey);
      if (cached) {
        this.civicDetailPlacementCache.delete(cacheKey);
        this.civicDetailPlacementCache.set(cacheKey, cached);
        placements.push(...cached.filter((placement) => (
          placement.anchorX >= originX && placement.anchorX < originX + this.blockSize &&
          placement.anchorY >= originY && placement.anchorY < originY + this.blockSize
        )));
        continue;
      }
      const reservedVisible = new Set<string>();
      const occupied = new Set<string>();
      for (const placement of composition) {
        if (placement.siteX !== landmark.siteX || placement.siteY !== landmark.siteY) continue;
        reserveVisibleFootprint(placement, reservedVisible, 0);
        for (const [offsetX, offsetY] of placement.asset.collision) {
          occupied.add(positionKey(placement.anchorX + offsetX, placement.anchorY + offsetY));
        }
      }
      const candidates: Array<{
        biome: BiomeWorldSample;
        route: RegionalRouteSample;
        x: number;
        y: number;
        priority: number;
      }> = [];
      const firstCellX = floorDiv(
        landmark.siteX - maximumLandmarkDistance,
        this.civicDetailCellSize,
      );
      const lastCellX = floorDiv(
        landmark.siteX + maximumLandmarkDistance,
        this.civicDetailCellSize,
      );
      const firstCellY = floorDiv(
        landmark.siteY - maximumLandmarkDistance,
        this.civicDetailCellSize,
      );
      const lastCellY = floorDiv(
        landmark.siteY + maximumLandmarkDistance,
        this.civicDetailCellSize,
      );
      for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
        for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
          if (this.hashUnit(cellX, cellY, 0x1c73) > this.civicDetailDensity) continue;
          const candidate = this.civicDetailCandidate(cellX, cellY);
          const route = this.routes.sample(candidate.x, candidate.y);
          const siteDistance = Math.hypot(
            candidate.x - landmark.siteX,
            candidate.y - landmark.siteY,
          );
          if (!Number.isFinite(route.landmarkDistance) ||
              Math.abs(route.landmarkDistance - siteDistance) > 0.75) continue;
          const biome = this.field.sample(candidate.x, candidate.y);
          const asset = this.selectCivicDetailAsset(
            candidate.x,
            candidate.y,
            biome,
            route,
            undefined,
            (option) => this.assetFits(candidate.x, candidate.y, option) &&
              !visibleFootprintIntersects(
                option,
                candidate.x,
                candidate.y,
                reservedVisible,
              ),
          );
          if (!asset || !this.assetFits(candidate.x, candidate.y, asset) ||
              visibleFootprintIntersects(asset, candidate.x, candidate.y, reservedVisible)) continue;
          candidates.push({
            biome,
            route,
            x: candidate.x,
            y: candidate.y,
            priority: this.hashUnit(candidate.x, candidate.y, 0x3ba1),
          });
        }
      }
      candidates.sort((a, b) => b.priority - a.priority || a.y - b.y || a.x - b.x ||
        a.route.distance - b.route.distance);
      const assetUsage = new Map<string, number>();
      const sitePlacements: Placement[] = [];
      for (const candidate of candidates) {
        const asset = this.selectCivicDetailAsset(
          candidate.x,
          candidate.y,
          candidate.biome,
          candidate.route,
          assetUsage,
          (option) => this.assetFits(candidate.x, candidate.y, option) &&
            !visibleFootprintIntersects(option, candidate.x, candidate.y, reservedVisible) &&
            option.collision.every(([offsetX, offsetY]) => !occupied.has(
              positionKey(candidate.x + offsetX, candidate.y + offsetY),
            )),
        );
        if (!asset) continue;
        const collisionKeys = asset.collision.map(([offsetX, offsetY]) => (
          positionKey(candidate.x + offsetX, candidate.y + offsetY)
        ));
        const placement: Placement = {
          asset,
          kind: 'civic-detail',
          siteX: landmark.siteX,
          siteY: landmark.siteY,
          anchorX: candidate.x,
          anchorY: candidate.y,
        };
        for (const key of collisionKeys) occupied.add(key);
        reserveVisibleFootprint(placement, reservedVisible, 0);
        assetUsage.set(asset.id, (assetUsage.get(asset.id) ?? 0) + 1);
        sitePlacements.push(placement);
      }
      this.civicDetailPlacementCache.set(cacheKey, sitePlacements);
      while (this.civicDetailPlacementCache.size > this.maxCachedBlocks * 4) {
        const oldest = this.civicDetailPlacementCache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.civicDetailPlacementCache.delete(oldest);
      }
      placements.push(...sitePlacements.filter((placement) => (
        placement.anchorX >= originX && placement.anchorX < originX + this.blockSize &&
        placement.anchorY >= originY && placement.anchorY < originY + this.blockSize
      )));
    }
    return placements.sort((a, b) => a.anchorY - b.anchorY || a.anchorX - b.anchorX ||
      a.asset.id.localeCompare(b.asset.id));
  }

  /** Place large geography contacts from declarative physical envelopes. The
   * candidate field, exclusion priority, and asset variant are all stable in
   * world coordinates, so cache block size and traversal order cannot alter
   * the result. */
  private buildEnvironmentContactPlacements(originX: number, originY: number): Placement[] {
    if (this.environmentContacts.length === 0 || this.environmentContactDensity <= 0) return [];
    const placements: Placement[] = [];
    const firstCellX = floorDiv(originX, this.environmentContactCellSize) - 1;
    const lastCellX = floorDiv(originX + this.blockSize - 1, this.environmentContactCellSize) + 1;
    const firstCellY = floorDiv(originY, this.environmentContactCellSize) - 1;
    const lastCellY = floorDiv(originY + this.blockSize - 1, this.environmentContactCellSize) + 1;
    for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
        const placement = this.getEnvironmentContactPlacement(cellX, cellY);
        if (!placement || placement.anchorX < originX || placement.anchorX >= originX + this.blockSize ||
            placement.anchorY < originY || placement.anchorY >= originY + this.blockSize) continue;
        placements.push(placement);
      }
    }
    return placements;
  }

  private getEnvironmentContactPlacement(cellX: number, cellY: number): Placement | null {
    const key = `${cellX},${cellY}`;
    if (this.environmentContactPlacementCache.has(key)) {
      const cached = this.environmentContactPlacementCache.get(key) ?? null;
      this.environmentContactPlacementCache.delete(key);
      this.environmentContactPlacementCache.set(key, cached);
      return cached;
    }
    const placement = this.computeEnvironmentContactPlacement(cellX, cellY);
    this.environmentContactPlacementCache.set(key, placement);
    while (this.environmentContactPlacementCache.size > this.maxCachedEnvironmentContactCells) {
      const oldest = this.environmentContactPlacementCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.environmentContactPlacementCache.delete(oldest);
    }
    return placement;
  }

  private computeEnvironmentContactPlacement(cellX: number, cellY: number): Placement | null {
    if (!this.isEnvironmentContactPriorityMaximum(cellX, cellY) ||
        this.hashUnit(cellX, cellY, 0x2ac1) > this.environmentContactDensity) return null;
    const candidate = this.environmentContactCandidate(cellX, cellY);
    const route = this.routes.sample(candidate.x, candidate.y);
    if (route.landmarkDistance < this.environmentContactLandmarkClearance) return null;
    const biome = this.field.sample(candidate.x, candidate.y);
    const asset = this.selectEnvironmentContactAsset(candidate.x, candidate.y, biome, route);
    if (!asset || !this.assetFits(candidate.x, candidate.y, asset)) return null;
    return {
      asset,
      kind: 'environment-contact',
      siteX: candidate.x,
      siteY: candidate.y,
      anchorX: candidate.x,
      anchorY: candidate.y,
      environmentProgram: asset.program,
      environmentProgramId: asset.program
        ? `environment:${cellX}:${cellY}:${asset.program}`
        : undefined,
    };
  }

  private environmentContactCandidate(cellX: number, cellY: number): { x: number; y: number } {
    const margin = 0.16;
    const span = 1 - margin * 2;
    return {
      x: Math.floor((cellX + margin + this.hashUnit(cellX, cellY, 0x913d) * span) *
        this.environmentContactCellSize),
      y: Math.floor((cellY + margin + this.hashUnit(cellX, cellY, 0xc7a5) * span) *
        this.environmentContactCellSize),
    };
  }

  private isEnvironmentContactPriorityMaximum(cellX: number, cellY: number): boolean {
    const priority = this.hashUnit(cellX, cellY, 0x31f7);
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        if (offsetX === 0 && offsetY === 0) continue;
        const neighbour = this.hashUnit(cellX + offsetX, cellY + offsetY, 0x31f7);
        if (neighbour > priority || (neighbour === priority &&
            (offsetY < 0 || (offsetY === 0 && offsetX < 0)))) return false;
      }
    }
    return true;
  }

  private selectEnvironmentContactAsset(
    worldX: number,
    worldY: number,
    biome: BiomeWorldSample,
    route: RegionalRouteSample,
  ): RegionalEnvironmentContactAsset | null {
    let selected: RegionalEnvironmentContactAsset | null = null;
    let selectedScore = Number.NEGATIVE_INFINITY;
    const nearbyWater = new Map<number, boolean>();
    for (const asset of this.environmentContacts) {
      const constraints = asset.constraints;
      const compatibility = Math.max(...asset.families.map((family) => (
        biome.weights[BIOME_FAMILIES.indexOf(family)] ?? 0
      )));
      if (compatibility < 0.18) continue;
      let touchesWater = true;
      if (constraints.nearbyWaterRadius > 0) {
        const cached = nearbyWater.get(constraints.nearbyWaterRadius);
        touchesWater = cached ?? this.hasNearbyWater(worldX, worldY, constraints.nearbyWaterRadius);
        nearbyWater.set(constraints.nearbyWaterRadius, touchesWater);
      }
      if (constraints.landOnly && biome.isWater ||
          !withinRange(biome.waterDistance, constraints.waterDistance) ||
          !withinRange(biome.elevation, constraints.elevation) ||
          !withinRange(biome.slope, constraints.slope) ||
          !withinRange(route.distance, constraints.routeDistance) ||
          !touchesWater) continue;
      const variation = this.hashUnit(worldX, worldY, stringHash(asset.id)) * 0.035;
      const score = compatibility + variation;
      if (score > selectedScore) {
        selected = asset;
        selectedScore = score;
      }
    }
    return selected;
  }

  private hasNearbyWater(worldX: number, worldY: number, radius: number): boolean {
    for (let offsetY = -radius; offsetY <= radius; offsetY++) {
      for (let offsetX = -radius; offsetX <= radius; offsetX++) {
        if (offsetX * offsetX + offsetY * offsetY > radius * radius) continue;
        if (this.field.sample(worldX + offsetX, worldY + offsetY).isWater) return true;
      }
    }
    return false;
  }

  /** Route contacts are sparse parcel seeds, not generic prop scatter. A
   * coordinate-stable jittered candidate owns each coarse cell; the nearest
   * route tangent selects the authored orthogonal access axis while the biome
   * field selects family identity. The connector itself remains collision-free
   * and collision is declared only on the two parcel-edge masses. */
  private buildRouteContactPlacements(originX: number, originY: number): Placement[] {
    if (this.routeContacts.length === 0 || this.routeContactDensity <= 0) return [];
    const placements: Placement[] = [];
    const firstCellX = floorDiv(originX, this.routeContactCellSize);
    const lastCellX = floorDiv(originX + this.blockSize - 1, this.routeContactCellSize);
    const firstCellY = floorDiv(originY, this.routeContactCellSize);
    const lastCellY = floorDiv(originY + this.blockSize - 1, this.routeContactCellSize);
    for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
        const placement = this.getRouteContactPlacement(cellX, cellY);
        if (!placement || placement.anchorX < originX || placement.anchorX >= originX + this.blockSize ||
            placement.anchorY < originY || placement.anchorY >= originY + this.blockSize) continue;
        placements.push(placement);
      }
    }
    return placements;
  }

  private getRouteContactPlacement(cellX: number, cellY: number): Placement | null {
    const key = `${cellX},${cellY}`;
    if (this.routeContactPlacementCache.has(key)) {
      const cached = this.routeContactPlacementCache.get(key) ?? null;
      this.routeContactPlacementCache.delete(key);
      this.routeContactPlacementCache.set(key, cached);
      return cached;
    }
    const placement = this.computeRouteContactPlacement(cellX, cellY);
    this.routeContactPlacementCache.set(key, placement);
    while (this.routeContactPlacementCache.size > this.maxCachedRouteContactCells) {
      const oldest = this.routeContactPlacementCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.routeContactPlacementCache.delete(oldest);
    }
    return placement;
  }

  private computeRouteContactPlacement(cellX: number, cellY: number): Placement | null {
    if (this.hashUnit(cellX, cellY, 0x35a9) > this.routeContactDensity) return null;
    const candidate = this.routeContactCandidate(cellX, cellY);
    const route = this.routes.sample(candidate.x, candidate.y);
    if (!Number.isFinite(route.distance) ||
        route.landmarkDistance < this.routeContactLandmarkClearance) return null;
    if (!this.routeContacts.some((asset) => route.distance >= asset.routeDistance[0] &&
        route.distance <= asset.routeDistance[1])) return null;
    const contact = this.resolveNearestRouteContact(candidate.x, candidate.y, route);
    if (!contact) return null;
    const accessAxis: RegionalRouteContactAxis =
      Math.abs(contact.directionX) >= Math.abs(contact.directionY) ? 'north-south' : 'east-west';
    if (!this.isRouteContactPriorityMaximum(cellX, cellY, accessAxis)) return null;
    const sideSalt = this.hashUnit(cellX, cellY, 0x5ab3) < 0.5 ? -1 : 1;
    const anchorX = accessAxis === 'north-south'
      ? contact.routeX
      : contact.routeX + (Math.sign(candidate.x - contact.routeX) || sideSalt) * 3;
    const anchorY = accessAxis === 'north-south'
      ? contact.routeY + (Math.sign(candidate.y - contact.routeY) || sideSalt) * 3
      : contact.routeY;
    const anchorRoute = this.routes.sample(anchorX, anchorY);
    const biome = this.field.sample(anchorX, anchorY);
    const asset = this.selectRouteContactAsset(anchorX, anchorY, biome, anchorRoute, accessAxis);
    if (!asset || !this.assetFits(anchorX, anchorY, asset)) return null;
    const parcelLayers = this.parcelComponents.length > 0
      ? this.parcelLayerCount(contact.routeX, contact.routeY)
      : undefined;
    return {
      asset,
      kind: 'route-contact',
      siteX: contact.routeX,
      siteY: contact.routeY,
      anchorX,
      anchorY,
      parcelId: `parcel:${cellX}:${cellY}`,
      accessAxis,
      routeKind: this.routes.sample(contact.routeX, contact.routeY).routeKind ?? 'trail',
      parcelLayers,
      connectorLength: parcelLayers === undefined
        ? undefined
        : 3 + parcelLayers * this.parcelLayerSpacing + 1,
    };
  }

  private isRouteContactPriorityMaximum(
    cellX: number,
    cellY: number,
    accessAxis: RegionalRouteContactAxis,
  ): boolean {
    const priority = this.hashUnit(cellX, cellY, 0x4f9d);
    const neighbours = accessAxis === 'north-south'
      ? [[-1, 0], [1, 0]] as const
      : [[0, -1], [0, 1]] as const;
    for (const [offsetX, offsetY] of neighbours) {
      const neighbour = this.hashUnit(cellX + offsetX, cellY + offsetY, 0x4f9d);
      if (neighbour > priority || (neighbour === priority &&
          (offsetY < 0 || (offsetY === 0 && offsetX < 0)))) return false;
    }
    return true;
  }

  private resolveNearestRouteContact(
    worldX: number,
    worldY: number,
    route: RegionalRouteSample,
  ): { routeX: number; routeY: number; directionX: number; directionY: number } | null {
    if (route.isRoute && Math.hypot(route.directionX, route.directionY) >= 0.25) {
      return {
        routeX: worldX,
        routeY: worldY,
        directionX: route.directionX,
        directionY: route.directionY,
      };
    }
    const searchRadius = Math.min(12, Math.max(1, Math.ceil(route.distance) + 1));
    for (let radius = 1; radius <= searchRadius; radius++) {
      const contacts: Array<{
        routeX: number;
        routeY: number;
        directionX: number;
        directionY: number;
        distanceSquared: number;
      }> = [];
      for (let offsetY = -radius; offsetY <= radius; offsetY++) {
        for (let offsetX = -radius; offsetX <= radius; offsetX++) {
          if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
          const nearby = this.routes.sample(worldX + offsetX, worldY + offsetY);
          const tangentLength = Math.hypot(nearby.directionX, nearby.directionY);
          if (!nearby.isRoute || tangentLength < 0.25) continue;
          const distanceSquared = offsetX * offsetX + offsetY * offsetY;
          contacts.push({
            routeX: worldX + offsetX,
            routeY: worldY + offsetY,
            directionX: nearby.directionX,
            directionY: nearby.directionY,
            distanceSquared,
          });
        }
      }
      const nearest = contacts.sort((a, b) => a.distanceSquared - b.distanceSquared ||
        a.routeY - b.routeY || a.routeX - b.routeX)[0];
      if (nearest) {
        return {
          routeX: nearest.routeX,
          routeY: nearest.routeY,
          directionX: nearest.directionX,
          directionY: nearest.directionY,
        };
      }
    }
    return null;
  }

  private routeContactCandidate(cellX: number, cellY: number): { x: number; y: number } {
    const inset = 0.1;
    const span = 1 - inset * 2;
    return {
      x: Math.floor((cellX + inset + this.hashUnit(cellX, cellY, 0x13c7) * span) *
        this.routeContactCellSize),
      y: Math.floor((cellY + inset + this.hashUnit(cellX, cellY, 0x6de1) * span) *
        this.routeContactCellSize),
    };
  }

  private ambientCandidate(cellX: number, cellY: number): { x: number; y: number } {
    const inset = 0.12;
    const span = 1 - inset * 2;
    return {
      x: Math.floor((cellX + inset + this.hashUnit(cellX, cellY, 0x2d91) * span) * this.ambientCellSize),
      y: Math.floor((cellY + inset + this.hashUnit(cellX, cellY, 0x6b35) * span) * this.ambientCellSize),
    };
  }

  private civicDetailCandidate(cellX: number, cellY: number): { x: number; y: number } {
    const inset = 0.12;
    const span = 1 - inset * 2;
    return {
      x: Math.floor((cellX + inset + this.hashUnit(cellX, cellY, 0x5ed3) * span) *
        this.civicDetailCellSize),
      y: Math.floor((cellY + inset + this.hashUnit(cellX, cellY, 0x29a7) * span) *
        this.civicDetailCellSize),
    };
  }

  private isAmbientPriorityMaximum(cellX: number, cellY: number): boolean {
    const priority = this.hashUnit(cellX, cellY, 0x7f21);
    for (let offsetY = -2; offsetY <= 2; offsetY++) {
      for (let offsetX = -2; offsetX <= 2; offsetX++) {
        if ((offsetX === 0 && offsetY === 0) || Math.abs(offsetX) + Math.abs(offsetY) > 2) continue;
        const neighbour = this.hashUnit(cellX + offsetX, cellY + offsetY, 0x7f21);
        if (neighbour > priority || (neighbour === priority &&
            (offsetY < 0 || (offsetY === 0 && offsetX < 0)))) return false;
      }
    }
    return true;
  }

  /** Macro density is a separate deterministic layer above local repulsion.
   * Uniform and legacy-cluster preserve research controls. Density-field
   * follows one adaptive intensity map. Production cluster-field builds a
   * nested hierarchy: a broad continuous basin decides where background
   * silhouettes belong, then sparse local centres concentrate them into focal
   * pockets. The near-empty floor is intentional negative space;
   * landmark-owned entourage is composed through a separate path and remains
   * intact. */
  private ambientDistributionWeight(worldX: number, worldY: number): number {
    switch (this.ambientDistributionProfile) {
      case 'uniform-blue-noise':
        return 1;
      case 'density-field-blue-noise': {
        const value = this.ambientDensityField(worldX, worldY, 48, 0x35b9);
        return 0.18 + smoothUnit(value) * 0.82;
      }
      case 'legacy-cluster-field-blue-noise': {
        const cellSize = 48;
        const cellX = floorDiv(Math.floor(worldX), cellSize);
        const cellY = floorDiv(Math.floor(worldY), cellSize);
        let influence = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY++) {
          for (let offsetX = -1; offsetX <= 1; offsetX++) {
            const clusterX = cellX + offsetX;
            const clusterY = cellY + offsetY;
            const centreX = (clusterX + 0.12 + this.hashUnit(clusterX, clusterY, 0x6f13) * 0.76) *
              cellSize;
            const centreY = (clusterY + 0.12 + this.hashUnit(clusterX, clusterY, 0x29d7) * 0.76) *
              cellSize;
            const radius = cellSize * (
              0.34 + this.hashUnit(clusterX, clusterY, 0x4ca1) * 0.2
            );
            const proximity = Math.max(0, 1 - Math.hypot(worldX - centreX, worldY - centreY) /
              radius);
            const strength = 0.7 + this.hashUnit(clusterX, clusterY, 0x7b45) * 0.3;
            influence = Math.max(influence, smoothUnit(proximity) * strength);
          }
        }
        return 0.2 + Math.sqrt(influence) * 0.8;
      }
      case 'cluster-field-blue-noise': {
        const broad = this.ambientDensityField(worldX, worldY, 160, 0x35b9);
        const broadGate = smoothUnit((broad - 0.34) / 0.42);
        const cellSize = 52;
        const cellX = floorDiv(Math.floor(worldX), cellSize);
        const cellY = floorDiv(Math.floor(worldY), cellSize);
        let influence = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY++) {
          for (let offsetX = -1; offsetX <= 1; offsetX++) {
            const clusterX = cellX + offsetX;
            const clusterY = cellY + offsetY;
            if (this.hashUnit(clusterX, clusterY, 0x1127) > 0.58) continue;
            const centreX = (clusterX + 0.12 + this.hashUnit(clusterX, clusterY, 0x6f13) * 0.76) *
              cellSize;
            const centreY = (clusterY + 0.12 + this.hashUnit(clusterX, clusterY, 0x29d7) * 0.76) *
              cellSize;
            const radius = cellSize * (
              0.48 + this.hashUnit(clusterX, clusterY, 0x4ca1) * 0.28
            );
            const proximity = Math.max(0, 1 - Math.hypot(worldX - centreX, worldY - centreY) /
              radius);
            const strength = 0.72 + this.hashUnit(clusterX, clusterY, 0x7b45) * 0.28;
            influence = Math.max(influence, smoothUnit(proximity) * strength);
          }
        }
        const local = Math.pow(influence, 0.6);
        const prominence = broadGate * (0.38 + local * 0.62);
        return 0.02 + Math.pow(prominence, 0.72) * 0.98;
      }
    }
  }

  private ambientDensityField(
    worldX: number,
    worldY: number,
    scale: number,
    salt: number,
  ): number {
    const cellX = floorDiv(Math.floor(worldX), scale);
    const cellY = floorDiv(Math.floor(worldY), scale);
    const localX = smoothUnit((worldX - cellX * scale) / scale);
    const localY = smoothUnit((worldY - cellY * scale) / scale);
    const north = linearMix(
      this.hashUnit(cellX, cellY, salt),
      this.hashUnit(cellX + 1, cellY, salt),
      localX,
    );
    const south = linearMix(
      this.hashUnit(cellX, cellY + 1, salt),
      this.hashUnit(cellX + 1, cellY + 1, salt),
      localX,
    );
    return linearMix(north, south, localY);
  }

  private selectAmbientAsset(
    worldX: number,
    worldY: number,
    biome: BiomeWorldSample,
    route: RegionalRouteSample,
  ): RegionalAmbientAsset | null {
    const eligible: Array<{ asset: RegionalAmbientAsset; compatibility: number }> = [];
    for (const asset of this.ambient) {
      const [minimumRouteDistance, maximumRouteDistance] = asset.routeDistance;
      if (route.distance < minimumRouteDistance ||
          (maximumRouteDistance < 999 && route.distance > maximumRouteDistance)) continue;
      const compatibility = Math.max(...asset.families.map((family) => (
        biome.weights[BIOME_FAMILIES.indexOf(family)] ?? 0
      )));
      eligible.push({ asset, compatibility });
    }
    if (eligible.length === 0) return null;
    const strongest = Math.max(...eligible.map((candidate) => candidate.compatibility));
    const variants = eligible
      .filter((candidate) => Math.abs(candidate.compatibility - strongest) < 1e-7)
      .map((candidate) => candidate.asset)
      .sort((a, b) => a.id.localeCompare(b.id));
    const cellX = floorDiv(worldX, this.ambientCellSize);
    const cellY = floorDiv(worldY, this.ambientCellSize);
    const variantIndex = positiveMod(cellX * 3 + cellY * 5 + this.seed32, variants.length);
    return variants[variantIndex] ?? null;
  }

  private selectCivicDetailAsset(
    worldX: number,
    worldY: number,
    biome: BiomeWorldSample,
    route: RegionalRouteSample,
    assetUsage: ReadonlyMap<string, number> = new Map(),
    assetIsAvailable: (asset: RegionalCivicDetailAsset) => boolean = () => true,
  ): RegionalCivicDetailAsset | null {
    let selected: RegionalCivicDetailAsset | null = null;
    let selectedScore = Number.NEGATIVE_INFINITY;
    for (const asset of this.civicDetails) {
      if (!assetIsAvailable(asset)) continue;
      if (route.distance < asset.routeDistance[0] || route.distance > asset.routeDistance[1] ||
          route.landmarkDistance < asset.landmarkDistance[0] ||
          route.landmarkDistance > asset.landmarkDistance[1]) continue;
      const compatibility = Math.max(...asset.families.map((family) => (
        biome.weights[BIOME_FAMILIES.indexOf(family)] ?? 0
      )));
      if (compatibility < asset.minimumFamilyWeight) continue;
      const variation = this.hashUnit(worldX, worldY, stringHash(asset.id)) * 0.35;
      const repetitionPenalty = (assetUsage.get(asset.id) ?? 0) * 0.32;
      const score = compatibility * 0.65 + variation - repetitionPenalty;
      if (score > selectedScore) {
        selected = asset;
        selectedScore = score;
      }
    }
    return selected;
  }

  private selectRouteContactAsset(
    worldX: number,
    worldY: number,
    biome: BiomeWorldSample,
    route: RegionalRouteSample,
    accessAxis: RegionalRouteContactAxis,
  ): RegionalRouteContactAsset | null {
    let selected: RegionalRouteContactAsset | null = null;
    let selectedScore = Number.NEGATIVE_INFINITY;
    for (const asset of this.routeContacts) {
      if (asset.accessAxis !== accessAxis || route.distance < asset.routeDistance[0] ||
          route.distance > asset.routeDistance[1]) continue;
      const compatibility = Math.max(...asset.families.map((family) => (
        biome.weights[BIOME_FAMILIES.indexOf(family)] ?? 0
      )));
      const variation = this.hashUnit(worldX, worldY, stringHash(asset.id)) * 0.025;
      const score = compatibility + variation;
      if (score > selectedScore) {
        selected = asset;
        selectedScore = score;
      }
    }
    return selected;
  }

  private selectAsset(
    worldX: number,
    worldY: number,
    biome: BiomeWorldSample,
    landmarkKind: RegionalLandmarkKind,
  ): RegionalLandmarkAsset | null {
    const candidates = this.landmarks.filter((asset) => asset.landmarkKinds.includes(landmarkKind));
    let selected: RegionalLandmarkAsset | null = null;
    let selectedScore = Number.NEGATIVE_INFINITY;
    for (const asset of candidates) {
      const compatibility = Math.max(...asset.families.map((family) => (
        biome.weights[BIOME_FAMILIES.indexOf(family)] ?? 0
      )));
      const variation = this.hashUnit(worldX, worldY, stringHash(asset.id)) * 0.025;
      const score = compatibility + variation;
      if (score > selectedScore) {
        selected = asset;
        selectedScore = score;
      }
    }
    return selected;
  }

  private findConstrainedAnchor(
    siteX: number,
    siteY: number,
    route: RegionalRouteSample,
    asset: RegionalLandmarkAsset,
  ): { anchorX: number; anchorY: number } | null {
    const length = Math.hypot(route.directionX, route.directionY);
    const tangentX = length > 0.1 ? route.directionX / length : 1;
    const tangentY = length > 0.1 ? route.directionY / length : 0;
    const normalX = -tangentY;
    const normalY = tangentX;
    const preferredSide = this.hashUnit(siteX, siteY, 0x7a31) < 0.5 ? -1 : 1;
    for (const side of [preferredSide, -preferredSide]) {
      for (let distance = 3; distance <= 7; distance++) {
        const anchorX = Math.round(siteX + normalX * distance * side);
        const anchorY = Math.round(siteY + normalY * distance * side);
        if (this.assetFits(anchorX, anchorY, asset)) return { anchorX, anchorY };
      }
    }
    return null;
  }

  private assetFits(anchorX: number, anchorY: number, asset: RegionalVisualAsset): boolean {
    if (this.field.sample(anchorX, anchorY).isWater) return false;
    for (const [offsetX, offsetY] of asset.collision) {
      const x = anchorX + offsetX;
      const y = anchorY + offsetY;
      if (this.field.sample(x, y).isWater || this.routes.sample(x, y).distance < 1.5) return false;
    }
    return true;
  }

  private hashUnit(x: number, y: number, salt: number): number {
    return spatialHash2DUnit(this.seed32, x, y, salt);
  }
}

interface LandmarkEntourageProfile {
  focalCount: number;
  minimum: number;
  maximum: number;
  stationSpacing: number;
  tangentReach: number;
  frontageOffset: number;
  stationJitter: number;
  setbackJitter: number;
}

function landmarkEntourageProfile(kind: RegionalLandmarkKind): LandmarkEntourageProfile {
  switch (kind) {
    case 'arrival':
      return {
        focalCount: 2,
        minimum: 10, maximum: 14, stationSpacing: 5.5, tangentReach: 17,
        frontageOffset: 6.5, stationJitter: 2.4, setbackJitter: 2,
      };
    case 'settlement':
      return {
        focalCount: 1,
        minimum: 7, maximum: 11, stationSpacing: 5.8, tangentReach: 16,
        frontageOffset: 6.5, stationJitter: 2.6, setbackJitter: 2.2,
      };
    case 'ruin':
      return {
        focalCount: 1,
        minimum: 5, maximum: 8, stationSpacing: 6.2, tangentReach: 15,
        frontageOffset: 6.8, stationJitter: 3.2, setbackJitter: 2.8,
      };
    case 'waystation':
      return {
        focalCount: 1,
        minimum: 3, maximum: 6, stationSpacing: 6.4, tangentReach: 13,
        frontageOffset: 6.6, stationJitter: 3, setbackJitter: 2.6,
      };
  }
}

function visibleFootprintIntersects(
  asset: RegionalVisualAsset,
  anchorX: number,
  anchorY: number,
  reserved: ReadonlySet<string>,
): boolean {
  const [offsetX, offsetY] = getSpriteAnchor(asset);
  for (let tileY = 0; tileY < asset.sprite.height; tileY++) {
    for (let tileX = 0; tileX < asset.sprite.width; tileX++) {
      const tile = asset.sprite.tiles[tileY]?.[tileX];
      if (!tile || !hasVisiblePixels(tile)) continue;
      if (reserved.has(positionKey(anchorX + tileX - offsetX, anchorY + tileY - offsetY))) return true;
    }
  }
  return false;
}

function reserveVisibleFootprint(
  placement: Placement,
  reserved: Set<string>,
  halo: number,
): void {
  const [offsetX, offsetY] = getSpriteAnchor(placement.asset);
  for (let tileY = 0; tileY < placement.asset.sprite.height; tileY++) {
    for (let tileX = 0; tileX < placement.asset.sprite.width; tileX++) {
      const tile = placement.asset.sprite.tiles[tileY]?.[tileX];
      if (!tile || !hasVisiblePixels(tile)) continue;
      const worldX = placement.anchorX + tileX - offsetX;
      const worldY = placement.anchorY + tileY - offsetY;
      for (let offsetY = -halo; offsetY <= halo; offsetY++) {
        for (let offsetX = -halo; offsetX <= halo; offsetX++) {
          reserved.add(positionKey(worldX + offsetX, worldY + offsetY));
        }
      }
    }
  }
}

function positionKey(x: number, y: number): string {
  return `${x},${y}`;
}

function isFocalCompositionAsset(asset: RegionalVisualAsset): asset is RegionalParcelComponentAsset {
  return 'compositionRole' in asset && asset.compositionRole === 'focal';
}

function assetVisualGroup(asset: RegionalVisualAsset): string {
  return 'visualGroup' in asset && typeof asset.visualGroup === 'string'
    ? `group:${asset.visualGroup}`
    : `asset:${asset.id}`;
}

function visibleSpriteWorldBounds(placement: Placement): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  const [anchorOffsetX, anchorOffsetY] = getSpriteAnchor(placement.asset);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let tileY = 0; tileY < placement.asset.sprite.height; tileY++) {
    for (let tileX = 0; tileX < placement.asset.sprite.width; tileX++) {
      const tile = placement.asset.sprite.tiles[tileY]?.[tileX];
      if (!tile || !hasVisiblePixels(tile)) continue;
      const worldX = placement.anchorX + tileX - anchorOffsetX;
      const worldY = placement.anchorY + tileY - anchorOffsetY;
      minX = Math.min(minX, worldX);
      minY = Math.min(minY, worldY);
      maxX = Math.max(maxX, worldX);
      maxY = Math.max(maxY, worldY);
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Large unrotated blocks use their authored screen-space frontage rather than
 * a bottom-edge route station. This keeps the complete silhouette beside the
 * route and near the landmark while ordinary support props retain the curved
 * route frame. */
function centredFocalAnchor(
  landmark: Placement,
  asset: RegionalVisualAsset,
  side: -1 | 1,
  extraSeparation: number,
  parallelNudge: number,
): { anchorX: number; anchorY: number } {
  const frontageAxis = 'frontageAxis' in asset ? asset.frontageAxis : undefined;
  const [spriteAnchorX, spriteAnchorY] = getSpriteAnchor(asset);
  const relativeCentreX = (asset.sprite.width - 1) / 2 - spriteAnchorX;
  const relativeCentreY = (asset.sprite.height - 1) / 2 - spriteAnchorY;
  const crossOffset = frontageAxis === 'north-south'
    ? asset.sprite.width / 2 + landmark.asset.sprite.width / 2 + 1
    : asset.sprite.height / 2 + landmark.asset.sprite.height / 2 + 1;
  const separatedOffset = crossOffset + extraSeparation;
  const desiredCentreX = landmark.siteX +
    (frontageAxis === 'north-south' ? side * separatedOffset : parallelNudge);
  const desiredCentreY = landmark.siteY +
    (frontageAxis === 'north-south' ? parallelNudge : side * separatedOffset);
  return {
    anchorX: Math.round(desiredCentreX - relativeCentreX),
    anchorY: Math.round(desiredCentreY - relativeCentreY),
  };
}

function symmetricSearchOffset(index: number): number {
  if (index <= 0) return 0;
  const magnitude = Math.ceil(index / 2);
  return index % 2 === 1 ? -magnitude : magnitude;
}

function frontageMatchesRoute(asset: RegionalVisualAsset, route: RegionalRouteSample): boolean {
  if (!('frontageAxis' in asset) || asset.frontageAxis === undefined) return true;
  const routeAxis: RegionalRouteContactAxis = Math.abs(route.directionX) > Math.abs(route.directionY)
    ? 'east-west'
    : 'north-south';
  return asset.frontageAxis === routeAxis;
}

function normalizedPreparedBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): RegionalPreparedViewport['bounds'] {
  return {
    minX: Math.floor(Math.min(minX, maxX)),
    minY: Math.floor(Math.min(minY, maxY)),
    maxX: Math.floor(Math.max(minX, maxX)),
    maxY: Math.floor(Math.max(minY, maxY)),
  };
}

function preparedArea(bounds: RegionalPreparedViewport['bounds']): number {
  return (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);
}

function validatePreparedArea(bounds: RegionalPreparedViewport['bounds']): void {
  const area = preparedArea(bounds);
  if (!Number.isSafeInteger(area) || area < 1 || area > REGIONAL_MAX_PREPARED_VIEWPORT_AREA) {
    throw new Error(`Regional viewport area must be in 1..${REGIONAL_MAX_PREPARED_VIEWPORT_AREA}: ${area}`);
  }
}

function validatePreparedCoordinate(
  x: number,
  y: number,
  bounds: RegionalPreparedViewport['bounds'],
  kind: string,
): void {
  if (!Number.isInteger(x) || !Number.isInteger(y) ||
      x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
    throw new Error(`Regional viewport ${kind} coordinate outside bounds: ${x},${y}`);
  }
}

function validatePreparedDynamicPlacements(
  value: unknown,
): RegionalPreparedDynamicPlacement[] {
  if (!Array.isArray(value) || value.length > REGIONAL_MAX_PREPARED_VIEWPORT_AREA) {
    throw new Error('Regional viewport dynamic placements must be a bounded array');
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Regional viewport dynamic placement ${index} must be an object`);
    }
    const placement = entry as Record<string, unknown>;
    if (typeof placement.assetId !== 'string' || placement.assetId.length < 1 ||
        placement.assetId.length > 256 || typeof placement.anchorX !== 'number' ||
        !Number.isSafeInteger(placement.anchorX) || typeof placement.anchorY !== 'number' ||
        !Number.isSafeInteger(placement.anchorY)) {
      throw new Error(`Regional viewport dynamic placement ${index} has invalid identity or anchor`);
    }
    for (const key of ['pathTangentX', 'pathTangentY'] as const) {
      const component = placement[key];
      if (component !== undefined && (typeof component !== 'number' ||
          !Number.isFinite(component) || Math.abs(component) > 1.000001)) {
        throw new Error(`Regional viewport dynamic placement ${index} has invalid ${key}`);
      }
    }
    if (placement.parcelPathId !== undefined &&
        (typeof placement.parcelPathId !== 'string' || placement.parcelPathId.length > 512)) {
      throw new Error(`Regional viewport dynamic placement ${index} has invalid parcelPathId`);
    }
    return {
      assetId: placement.assetId,
      anchorX: placement.anchorX,
      anchorY: placement.anchorY,
      ...(placement.pathTangentX === undefined ? {} : {
        pathTangentX: placement.pathTangentX as number,
      }),
      ...(placement.pathTangentY === undefined ? {} : {
        pathTangentY: placement.pathTangentY as number,
      }),
      ...(placement.parcelPathId === undefined ? {} : {
        parcelPathId: placement.parcelPathId,
      }),
    };
  });
}

function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

function smoothUnit(value: number): number {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded * bounded * (3 - 2 * bounded);
}

function linearMix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function positiveMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function withinRange(value: number, range: readonly [number, number]): boolean {
  return value >= range[0] && (range[1] >= 999 || value <= range[1]);
}

function coprimeStride(size: number, start: number): number {
  if (size <= 1) return 1;
  for (let offset = 0; offset < size; offset++) {
    const candidate = 1 + ((start - 1 + offset) % size);
    if (greatestCommonDivisor(candidate, size) === 1) return candidate;
  }
  return 1;
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right !== 0) [left, right] = [right, left % right];
  return left;
}

function hasVisiblePixels(tile: BuildingTileData): boolean {
  const cached = VISIBLE_TILE_CACHE.get(tile);
  if (cached !== undefined) return cached;
  const visible = tile.packedPixels
    ? packedHasVisiblePixels(tile.packedPixels)
    : tile.pixels.some((row) => row.some((pixel) => pixel !== null));
  VISIBLE_TILE_CACHE.set(tile, visible);
  return visible;
}

function installBoundedEntry<K, V>(
  cache: Map<K, V>,
  key: K,
  value: V,
  maximumEntries: number,
): void {
  if (cache.size >= maximumEntries) {
    const oldest = cache.keys().next().value as K | undefined;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

function stringHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isAnimatedQuayDetailAsset(
  asset: RegionalVisualAsset,
): asset is RegionalQuayDetailAsset & { activity: RegionalQuayDetailActivity } {
  const candidate = asset as Partial<RegionalQuayDetailAsset>;
  return candidate.role === 'quay-detail' && candidate.activity !== undefined;
}

function isAnimatedQuayDetailPlacement(
  placement: Placement,
): placement is Placement & {
  asset: RegionalQuayDetailAsset & { activity: RegionalQuayDetailActivity };
} {
  return placement.kind === 'quay-detail' && isAnimatedQuayDetailAsset(placement.asset);
}

function getSpriteAnchor(asset: RegionalVisualAsset): readonly [number, number] {
  return asset.spriteAnchor ?? [Math.floor(asset.sprite.width / 2), asset.sprite.height - 1];
}

function validateSpriteAnchor(asset: RegionalVisualAsset): void {
  const [anchorX, anchorY] = getSpriteAnchor(asset);
  if (!Number.isInteger(anchorX) || !Number.isInteger(anchorY) ||
      anchorX < 0 || anchorX >= asset.sprite.width || anchorY < 0 || anchorY >= asset.sprite.height) {
    throw new Error(`Regional visual asset has invalid sprite anchor: ${asset.id}`);
  }
}

function compositeTiles(beneath: BuildingTileData, above: BuildingTileData): BuildingTileData {
  if (beneath.packedPixels || above.packedPixels) return compositePackedTiles(beneath, above);
  const pixels = compositeGrids(beneath.pixels, above.pixels);
  return { pixels, resolutions: { [String(pixels.length)]: pixels } };
}

function packedHasVisiblePixels(packed: PackedPixelGrid): boolean {
  validatePackedGrid(packed);
  for (let index = 3; index < packed.data.length; index += 4) {
    if (packed.data[index] !== 0) return true;
  }
  return false;
}

function compositePackedTiles(
  beneath: BuildingTileData,
  above: BuildingTileData,
): BuildingTileData {
  const beneathDimensions = tileDimensions(beneath);
  const aboveDimensions = tileDimensions(above);
  const width = Math.max(beneathDimensions.width, aboveDimensions.width);
  const height = Math.max(beneathDimensions.height, aboveDimensions.height);
  const packedPixels: PackedPixelGrid = { width, height, data: new Uint8Array(width * height * 4) };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = tilePixelAt(above, x, y) ?? tilePixelAt(beneath, x, y);
      if (!pixel) continue;
      const offset = (y * width + x) * 4;
      packedPixels.data[offset] = pixel.r;
      packedPixels.data[offset + 1] = pixel.g;
      packedPixels.data[offset + 2] = pixel.b;
      packedPixels.data[offset + 3] = pixel.a ?? 255;
    }
  }
  return { pixels: [], resolutions: {}, packedPixels };
}

function tileDimensions(tile: BuildingTileData): { width: number; height: number } {
  if (tile.packedPixels) {
    validatePackedGrid(tile.packedPixels);
    return { width: tile.packedPixels.width, height: tile.packedPixels.height };
  }
  return { width: tile.pixels[0]?.length ?? 0, height: tile.pixels.length };
}

function tilePixelAt(tile: BuildingTileData, x: number, y: number): Pixel {
  if (!tile.packedPixels) return tile.pixels[y]?.[x] ?? null;
  if (x >= tile.packedPixels.width || y >= tile.packedPixels.height) return null;
  const offset = (y * tile.packedPixels.width + x) * 4;
  const alpha = tile.packedPixels.data[offset + 3]!;
  if (alpha === 0) return null;
  return {
    r: tile.packedPixels.data[offset]!,
    g: tile.packedPixels.data[offset + 1]!,
    b: tile.packedPixels.data[offset + 2]!,
    ...(alpha < 255 ? { a: alpha } : {}),
  };
}

function validatePackedGrid(packed: PackedPixelGrid): void {
  if (!Number.isInteger(packed.width) || !Number.isInteger(packed.height) ||
      packed.width < 1 || packed.height < 1 || packed.data.length !== packed.width * packed.height * 4) {
    throw new Error('Packed building tile dimensions do not match its RGBA data');
  }
}

function compositeGrids(beneath: PixelGrid, above: PixelGrid): PixelGrid {
  const height = Math.max(beneath.length, above.length);
  const width = Math.max(beneath[0]?.length ?? 0, above[0]?.length ?? 0);
  const result: PixelGrid = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) row.push(above[y]?.[x] ?? beneath[y]?.[x] ?? null);
    result.push(row);
  }
  return result;
}
