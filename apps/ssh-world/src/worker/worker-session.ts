/**
 * WorkerSession - Game session running in worker process
 *
 * This is the worker-side counterpart to SessionProxy. It runs the actual
 * game logic (rendering, input handling, player state) in the worker process,
 * which allows the game code to be hot-reloaded without disconnecting SSH.
 *
 * Key differences from GameSession (main process):
 * - Uses VirtualStream instead of real SSH stream
 * - Has direct access to GameServer (no IPC)
 * - Sends output back to main via IPC
 */

import {
  PixelGameRenderer,
  ComponentManager,
  InputRouter,
  HelpModalComponent,
  PlayerListComponent,
  ReloadOverlayComponent,
  ChatComponent,
  BG_PRIMARY,
  CRIMSON_BRIGHT,
  ACCENT_GOLD,
  fg,
  bg,
  type PerfOptimizations,
  type ChatEntry,
  type WorldPreparationGeometry,
} from '@maldoror/render';
import { getChatMessages, addChatMessage } from '../server/stats-server.js';

/**
 * Performance optimizations configuration
 * CRLE and foveated rendering enabled for bandwidth reduction
 */
const PERF_OPTIMIZATIONS: PerfOptimizations = {
  crle: true,           // Chromatic Run-Length Encoding (~40-60% bandwidth reduction)
  foveated: true,       // Zone-based update rates (peripheral at 4Hz, core at 60Hz)
  enablePerfStats: false, // Set to true to log perf stats every 10s
};
const RENDER_INTERVAL_MS = 67;

/** Deterministically distribute session render callbacks across one 15 Hz
 * frame interval. Session startup otherwise synchronizes after the shared
 * entrance animation and forces every full viewport through one event-loop
 * burst, inflating transient heap and p99 latency without improving freshness. */
export function sessionRenderPhase(sessionId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < sessionId.length; index++) {
    hash ^= sessionId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % RENDER_INTERVAL_MS;
}

import {
  CanalTownTileProvider,
  TileProvider,
  DistrictTileProvider,
  RegionalWorldTileProvider,
  createPlaceholderSprite,
  type RegionalPreparedViewportPayload,
} from '@maldoror/world';
import type { PixelGrid } from '@maldoror/protocol';
import type { Direction, AnimationFrame, PlayerVisualState, NPCVisualState, Sprite } from '@maldoror/protocol';
import type { DirectionalBuildingSprite } from '@maldoror/ai';
import { getBuildingTilePositions } from '@maldoror/protocol';
import type { GameServer } from '../game/game-server.js';
import { OnboardingFlow } from '../server/onboarding.js';
import { AvatarScreen } from '../server/avatar-screen.js';
import { BuildingScreen } from '../server/building-screen.js';
import { NPCScreen } from '../server/npc-screen.js';
import { BootScreen } from '../server/boot-screen.js';
import { db, schema } from '@maldoror/db';
import { eq, and, between, inArray } from 'drizzle-orm';
import type { ProviderConfig } from '@maldoror/ai';
import { cacheRuntimeSprite, saveSpriteToDisk, loadSpriteFromDisk } from '../utils/sprite-storage.js';
import { saveBuildingToDisk, loadAllBuildingDirections } from '../utils/building-storage.js';
import { VirtualStream } from './virtual-stream.js';
import type { SessionState } from './game-worker.js';
import type { LoadedCanalTownKit } from '../game/canal-town-assets.js';
import type { LoadedRegionalWorldKit } from '../game/regional-world-provider.js';
import {
  RegionalPredictivePrewarmer,
  type RegionalPrewarmService,
} from '../game/regional-prewarm-service.js';
import { LOGIN_ORIGIN } from '../game/login-origin.js';
import { CooperativeRenderScheduler } from './cooperative-render-scheduler.js';

const cooperativeRenderScheduler = new CooperativeRenderScheduler();

/**
 * Choose the terminal render mode. Octant (Unicode 16 solid 2×4 mosaics) is
 * the highest-fidelity mode but needs a terminal that draws the Symbols for
 * Legacy Computing Supplement glyphs — Ghostty, kitty, foot, WezTerm, contour,
 * and VTE-based terminals (gnome/xfce). We pick it from the client's TERM;
 * everything else falls back to halfblock (universal). `MALDOROR_RENDER_MODE`
 * overrides. Players can also cycle modes in-game.
 */
export function pickRenderMode(term?: string): 'normal' | 'halfblock' | 'braille' | 'octant' {
  const env = process.env.MALDOROR_RENDER_MODE as ('normal' | 'halfblock' | 'braille' | 'octant' | undefined);
  if (env === 'normal' || env === 'halfblock' || env === 'braille' || env === 'octant') return env;
  const t = (term ?? '').toLowerCase();
  // Terminals with built-in octant/legacy-computing glyph rendering
  if (/ghostty|kitty|foot|wezterm|contour|vte|gnome|xfce|st-|rio|alacritty/.test(t)) return 'octant';
  return 'halfblock';
}

export interface WorkerSessionConfig {
  sessionId: string;
  fingerprint: string;
  username: string;
  userId: string | null;
  cols: number;
  rows: number;
  term?: string;
  gameServer: GameServer;
  worldSeed: bigint;
  providerConfig: ProviderConfig;
  canalTownKit: LoadedCanalTownKit | null;
  regionalWorldKit: LoadedRegionalWorldKit | null;
  regionalPrewarmService: RegionalPrewarmService | null;
  regionalOriginViewport: RegionalPreparedViewportPayload | null;
  regionalDefaultAvatar: Sprite | null;
  sendOutput: (sessionId: string, output: string, keyframe?: boolean, immediate?: boolean) => void;
  sendUserId: (sessionId: string, userId: string) => void;
  sendEnded: (sessionId: string) => void;
  restoredState?: SessionState;
}

export class WorkerSession {
  private sessionId: string;
  private stream: VirtualStream;
  private fingerprint: string;
  private username: string;
  private userId: string | null;
  private cols: number;
  private rows: number;
  private term?: string;
  private renderMode: 'normal' | 'halfblock' | 'braille' | 'octant';
  private districtMode: boolean = false;
  private gameServer: GameServer;
  private worldSeed: bigint;
  private providerConfig: ProviderConfig;
  private canalTownKit: LoadedCanalTownKit | null;
  private regionalWorldKit: LoadedRegionalWorldKit | null;
  private regionalPrewarmService: RegionalPrewarmService | null;
  private regionalOriginViewport: RegionalPreparedViewportPayload | null;
  private regionalDefaultAvatar: Sprite | null;
  private sendUserId: (sessionId: string, userId: string) => void;
  private sendEnded: (sessionId: string) => void;
  private sendOutput: (
    sessionId: string,
    output: string,
    keyframe?: boolean,
    immediate?: boolean,
  ) => void;

  private renderer: PixelGameRenderer | null = null;
  private componentManager: ComponentManager | null = null;
  private inputRouter: InputRouter | null = null;
  private helpModal: HelpModalComponent | null = null;
  private playerListModal: PlayerListComponent | null = null;
  private reloadOverlay: ReloadOverlayComponent | null = null;
  private chatComponent: ChatComponent | null = null;
  private bootScreen: BootScreen | null = null;
  private chatVisible: boolean = false; // hidden by default; toggle with ` or c
  private tileProvider: TileProvider | null = null;
  private regionalTileProvider: RegionalWorldTileProvider | null = null;
  private regionalPrewarmer: RegionalPredictivePrewarmer | null = null;
  private regionalPrewarmGeometryKey = '';
  private destroyed: boolean = false;
  private inputPaused: boolean = false;
  private tickInterval: NodeJS.Timeout | null = null;
  private tickStartTimeout: NodeJS.Timeout | null = null;
  private playerX: number = 0;
  private playerY: number = 0;
  private visualPlayerX: number = 0;
  private visualPlayerY: number = 0;
  private moveFromX: number = 0;
  private moveFromY: number = 0;
  private moveStartedAt = 0;
  private moveDurationMs = 200;
  private playerDirection: Direction = 'down';
  private playerAnimationFrame: AnimationFrame = 0;
  private isMoving: boolean = false;
  private inputSequence: number = 0;
  private moveTimer: NodeJS.Timeout | null = null;
  private currentPrompt: string = '';

  // Performance caches
  private cachedAllPlayers: Array<{
    userId: string;
    username: string;
    x: number;
    y: number;
    isOnline: boolean;
  }> = [];
  private cachedVisiblePlayers: Array<{
    userId: string;
    username: string;
    x: number;
    y: number;
    direction: string;
    animationFrame: number;
  }> = [];
  private cachedVisibleNPCs: NPCVisualState[] = [];
  private lastQueryX: number = -999;
  private lastQueryY: number = -999;
  private tickCounter: number = 0;
  private loadingSprites: Set<string> = new Set();
  private loadingNPCSprites: Set<string> = new Set();

  // Movement tracking
  private consecutiveMoveDirection: Direction | null = null;
  private consecutiveMoveCount: number = 0;
  private readonly MOMENTUM_THRESHOLD = 3;

  // State restoration for hot-reload
  private restoredState?: SessionState;

  constructor(config: WorkerSessionConfig) {
    this.sessionId = config.sessionId;
    this.fingerprint = config.fingerprint;
    this.username = config.username;
    this.userId = config.userId;
    this.cols = config.cols;
    this.rows = config.rows;
    this.term = config.term;
    this.renderMode = pickRenderMode(this.term);
    this.gameServer = config.gameServer;
    this.worldSeed = config.worldSeed;
    this.providerConfig = config.providerConfig;
    this.canalTownKit = config.canalTownKit;
    this.regionalWorldKit = config.regionalWorldKit;
    this.regionalPrewarmService = config.regionalPrewarmService;
    this.regionalOriginViewport = config.regionalOriginViewport;
    this.regionalDefaultAvatar = config.regionalDefaultAvatar;
    this.sendUserId = config.sendUserId;
    this.sendEnded = config.sendEnded;
    this.sendOutput = config.sendOutput;
    this.restoredState = config.restoredState;

    // Create virtual stream that sends output to main process
    this.stream = new VirtualStream(config.sessionId, config.sendOutput);
  }

  /**
   * Get serializable state for hot-reload preservation
   */
  getState(): SessionState {
    return {
      sessionId: this.sessionId,
      playerX: this.playerX,
      playerY: this.playerY,
      zoomLevel: this.renderer?.getZoomLevel() ?? 1,
      renderMode: this.renderer?.getRenderMode() ?? 'pixel',
      cameraMode: this.renderer?.getCameraMode() ?? 'follow',
    };
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getUserId(): string | null {
    return this.userId;
  }

  requestKeyframe(): void {
    this.renderer?.requestKeyframe();
  }

  getRuntimeStats(): {
    session_id: string;
    position: [number, number];
    provider: ReturnType<RegionalWorldTileProvider['getRegionalStats']> | null;
    prewarmer: ReturnType<RegionalPredictivePrewarmer['getStats']> | null;
  } {
    return {
      session_id: this.sessionId,
      position: [this.playerX, this.playerY],
      provider: this.regionalTileProvider?.getRegionalStats() ?? null,
      prewarmer: this.regionalPrewarmer?.getStats() ?? null,
    };
  }

  /**
   * Handle input data from main process
   */
  handleInput(data: Buffer): void {
    if (this.destroyed) return;
    const routed = this.renderer?.consumeTerminalResponses(data) ?? data;
    if (routed.length === 0) return;

    if (this.inputPaused) {
      // When paused (modal screens open), push input to stream
      // so modal screens can receive it via stream.on('data', ...)
      this.stream.pushInput(routed);
    } else if (this.inputRouter) {
      // Normal game mode - route through InputRouter
      this.inputRouter.process(routed);
    }
  }

  /**
   * Handle resize event from main process
   */
  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    if (this.renderer) {
      this.renderer.resize(cols, rows);
    }
    if (this.componentManager) {
      this.componentManager.resize(cols, rows);
    }
    this.helpModal?.updateScreenSize(cols, rows);
    this.playerListModal?.updateScreenSize(cols, rows);
    this.reloadOverlay?.updateScreenSize(cols, rows);
    void this.observeRegionalWorld(0, 0);
  }

  async start(): Promise<void> {
    // Check if this is a hot-reload restoration
    const isRestoring = !!this.restoredState;

    // Handle new vs returning user
    if (!this.userId) {
      // New user - run onboarding.
      // Pause the (not-yet-created) input router so handleInput() forwards
      // keystrokes to the stream, where OnboardingFlow reads them via
      // stream.on('data'). Without this, inputPaused=false + inputRouter=null
      // means every keystroke is silently dropped and the name prompt hangs.
      this.inputPaused = true;
      const onboarding = new OnboardingFlow(this.stream, this.fingerprint);
      let result: Awaited<ReturnType<OnboardingFlow['run']>>;
      try {
        result = await onboarding.run();
      } finally {
        this.inputPaused = false;
      }

      if (this.destroyed) return;

      if (!result) {
        // User quit during onboarding
        this.sendEnded(this.sessionId);
        return;
      }

      this.userId = result.userId;
      this.username = result.username;
      // Notify main process of new userId
      this.sendUserId(this.sessionId, this.userId);
    }

    // Skip boot screen for hot-reload restoration
    let boot: BootScreen | null = null;
    if (!isRestoring) {
      boot = new BootScreen(this.stream, this.cols, this.rows);
      this.bootScreen = boot;
      boot.show();

      // Fetch online players for honourable mentions
      const allPlayers = this.gameServer.getAllPlayers();
      const onlinePlayers = allPlayers
        .filter(p => p.isOnline && p.userId !== this.userId)
        .map(p => ({ username: p.username }));
      boot.renderHonourableMentions(onlinePlayers);
      boot.updateStep('Loading player state...', 'loading');
    }

    // A worker hot reload preserves the already-running session. Every actual
    // SSH login, including a returning user, begins at the canonical origin and
    // persists that reset before the player enters the world.
    if (isRestoring && this.restoredState) {
      this.playerX = this.restoredState.playerX;
      this.playerY = this.restoredState.playerY;
      // Keep current direction
    } else {
      const playerState = await db.query.playerState.findFirst({
        where: eq(schema.playerState.userId, this.userId!),
      });
      if (this.destroyed) return;

      this.playerX = LOGIN_ORIGIN.x;
      this.playerY = LOGIN_ORIGIN.y;
      if (playerState) {
        this.playerDirection = (playerState.direction as Direction) || 'down';
        await db
          .update(schema.playerState)
          .set({
            x: LOGIN_ORIGIN.x,
            y: LOGIN_ORIGIN.y,
            animationFrame: 0,
            updatedAt: new Date(),
          })
          .where(eq(schema.playerState.userId, this.userId!));
      } else {
        // Create initial player state
        await db.insert(schema.playerState).values({
          userId: this.userId!,
          x: LOGIN_ORIGIN.x,
          y: LOGIN_ORIGIN.y,
          direction: 'down',
        });
      }
      if (this.destroyed) return;
    }
    boot?.markPreviousDone();

    // Initialize the authoritative world provider. Regional field/material,
    // routes, parcels, authored landmarks, and prepared viewports now own the
    // default runtime. Canal/district providers remain explicit rollback lanes.
    boot?.updateStep('Generating world chunks...', 'loading');
    const createDefaultProvider = (): TileProvider => {
      if (this.regionalWorldKit) {
        const regional = this.regionalWorldKit.createSessionWorld();
        if (this.regionalOriginViewport) regional.importPreparedViewport(this.regionalOriginViewport);
        this.regionalTileProvider = regional;
        return regional;
      }
      return this.canalTownKit
        ? new CanalTownTileProvider({
          worldSeed: this.worldSeed,
          chunkCacheSize: 64,
          assets: this.canalTownKit.assets,
          terrain: this.canalTownKit.terrain,
          blockSize: this.canalTownKit.blockSize,
          materialCompositor: this.canalTownKit.materialCompositor,
          cornerTerrain: this.canalTownKit.cornerTerrain,
          })
        : new TileProvider({ worldSeed: this.worldSeed, chunkCacheSize: 64 });
    };
    const hasCanonicalWorld = Boolean(this.regionalWorldKit || this.canalTownKit);
    const districtPath = hasCanonicalWorld ? undefined : process.env.MALDOROR_DISTRICT;
    if (hasCanonicalWorld && process.env.MALDOROR_DISTRICT) {
      console.log('[World] Canonical world kit active; ignoring legacy MALDOROR_DISTRICT override');
    }
    if (districtPath) {
      const dtp = new DistrictTileProvider({ worldSeed: this.worldSeed, chunkCacheSize: 64 });
      try {
        const { loadDistrict } = await import('../game/district-loader.js');
        const d = await loadDistrict(districtPath, 32);
        const edgeWater = {
          id: 'district:edge', name: 'edge', walkable: false,
          pixels: DistrictTileProvider.solidGrid(32, 30, 110, 120),
          resolutions: {} as Record<string, PixelGrid>,
        };
        dtp.loadDistrict(d.tiles, d.widthTiles, d.heightTiles, edgeWater);
        this.tileProvider = dtp;
        this.districtMode = true;
        console.log(`[District] Loaded ${d.tiles.size} tiles (${d.widthTiles}x${d.heightTiles}) from ${districtPath}`);
        // Spawn near the district center on walkable ground
        if (!dtp.isWalkable(this.playerX, this.playerY)) {
          const cx = Math.floor(d.widthTiles / 2), cy = Math.floor(d.heightTiles / 2);
          this.playerX = cx; this.playerY = cy;
        }
      } catch (e) {
        console.error('[District] load failed, falling back to procedural world:', e);
        this.tileProvider = createDefaultProvider();
      }
    } else {
      this.tileProvider = createDefaultProvider();
    }
    this.tileProvider.setLocalPlayerId(this.userId!);

    // Do not apply a nearest-walkable fallback here. The canonical provider
    // authors a dry arrival island and route at (0,0); a fresh SSH login must
    // remain exactly there, while a hot-reload restoration must not teleport.
    this.visualPlayerX = this.playerX;
    this.visualPlayerY = this.playerY;
    this.moveFromX = this.playerX;
    this.moveFromY = this.playerY;
    boot?.markPreviousDone();

    // Load avatar
    boot?.updateStep('Loading avatar sprites...', 'loading');
    let sprite = await loadSpriteFromDisk(this.userId!);
    if (this.destroyed) return;
    const avatar = await db.query.avatars.findFirst({
      where: eq(schema.avatars.userId, this.userId!),
    });
    if (this.destroyed) return;

    if (sprite) {
      this.tileProvider.setPlayerSprite(this.userId!, sprite);
      this.currentPrompt = avatar?.prompt || '';
    } else if (avatar?.spriteJson) {
      this.tileProvider.setPlayerSprite(
        this.userId!,
        cacheRuntimeSprite(this.userId!, avatar.spriteJson as Sprite),
      );
      this.currentPrompt = avatar.prompt || '';
    } else {
      const placeholderSprite = this.regionalDefaultAvatar ?? this.canalTownKit?.defaultAvatar ??
        createPlaceholderSprite({ r: 100, g: 150, b: 255 });
      this.tileProvider.setPlayerSprite(this.userId!, placeholderSprite);
    }
    boot?.markPreviousDone();

    // Load nearby buildings
    boot?.updateStep('Loading nearby buildings...', 'loading');
    await this.loadNearbyBuildings();
    if (this.destroyed) return;
    boot?.markPreviousDone();

    // Load nearby roads
    boot?.updateStep('Loading nearby roads...', 'loading');
    await this.loadNearbyRoads();
    if (this.destroyed) return;
    boot?.markPreviousDone();

    // Update local player state
    this.updateLocalPlayerState();

    // Initialize renderer with chat sidebar
    boot?.updateStep('Initializing renderer...', 'loading');
    const chatWidth = this.chatVisible ? this.getChatWidth() : 0;
    this.renderer = new PixelGameRenderer({
      stream: this.stream,
      cols: this.cols,
      rows: this.rows,
      username: this.username,
      renderMode: this.renderMode,
      optimizations: PERF_OPTIMIZATIONS,
      layout: {
        headerRows: 2,
        footerRows: 0,
        leftSidebarCols: 0,
        rightSidebarCols: chatWidth,
      },
    });
    // District mode: zoom out so the player sees a wide swathe of the town
    // (each district tile is a scene-slice; at full zoom you'd see one tile).
    if (this.districtMode) {
      this.renderer.setZoomLevel(20);
    } else if (this.regionalWorldKit || this.canalTownKit) {
      // Walking-scale framing: at a typical 160x46 Ghostty viewport this
      // resolves to 12 screen pixels per tile.
      this.renderer.setZoomLevel(30);
    }
    boot?.markPreviousDone();

    // Initialize component manager
    this.componentManager = new ComponentManager(this.cols, this.rows);

    // Create modal components
    this.helpModal = new HelpModalComponent(this.cols, this.rows);
    this.helpModal.setOnClose(() => this.componentManager?.popFocus());
    this.componentManager.addComponent(this.helpModal);

    this.playerListModal = new PlayerListComponent(this.cols, this.rows);
    this.playerListModal.setOnClose(() => this.componentManager?.popFocus());
    this.componentManager.addComponent(this.playerListModal);

    this.reloadOverlay = new ReloadOverlayComponent(this.cols, this.rows);
    this.componentManager.addComponent(this.reloadOverlay);

    // Create chat component (sidebar, not modal)
    this.chatComponent = new ChatComponent({
      id: 'chat',
      bounds: {
        x: this.cols - this.getChatWidth(),
        y: 2,  // Below header
        width: this.getChatWidth(),
        height: this.rows - 2,
      },
      visible: this.chatVisible,
      focusable: true,
      currentUserId: this.userId ?? undefined,
      showActions: true,
      onSendMessage: (message: string) => this.handleChatSend(message),
    });
    this.componentManager.addComponent(this.chatComponent);
    if (this.chatVisible) {
      this.chatComponent.show();
    }

    // Initialize input router
    this.inputRouter = new InputRouter(this.componentManager);
    this.inputRouter.setFallbackHandler((action, event) => {
      this.handleAction(action, event);
    });

    // Set up stream handlers (for VirtualStream)
    this.stream.on('data', (data: Buffer) => {
      if (this.inputRouter && !this.destroyed && !this.inputPaused) {
        this.inputRouter.process(data);
      }
    });

    // Register with game server (direct, no IPC)
    boot?.updateStep('Connecting to game server...', 'loading');
    await this.gameServer.playerConnect(this.userId!, this.sessionId, this.username);
    if (this.destroyed) {
      await this.gameServer.playerDisconnect(this.userId!);
      return;
    }
    this.gameServer.updatePlayerPosition(this.userId!, this.playerX, this.playerY);

    // Register road callbacks to receive updates from other players
    this.gameServer.onRoadPlacement(this.userId!, (x, y, placedBy) => {
      if (placedBy !== this.userId && this.tileProvider) {
        this.tileProvider.setRoad(x, y, placedBy);
      }
    });
    this.gameServer.onRoadRemoval(this.userId!, (x, y) => {
      if (this.tileProvider) {
        this.tileProvider.removeRoad(x, y);
      }
    });
    boot?.markPreviousDone();

    // Restore renderer state if hot-reloading
    if (isRestoring && this.restoredState) {
      this.renderer.setZoomLevel(this.restoredState.zoomLevel);
      this.renderer.setRenderMode(this.restoredState.renderMode as 'normal' | 'halfblock' | 'braille' | 'octant');
      this.renderer.setCameraMode(this.restoredState.cameraMode as 'follow' | 'free');
    }

    if (this.regionalTileProvider) {
      boot?.updateStep('Priming the regional world...', 'loading');
      await this.observeRegionalWorld(0, 0, true);
      if (this.destroyed) return;
      boot?.markPreviousDone();
    }

    // Clean up boot screen and start game only after the first authoritative
    // viewport is present. Cold world generation never runs behind input.
    boot?.hide();
    if (this.bootScreen === boot) this.bootScreen = null;

    // Show entrance screen (skip for hot-reload)
    if (!isRestoring) {
      await this.showEntranceScreen();
      if (this.destroyed) return;
    }

    // Zoom/layout configuration initially centers the renderer on its default
    // (0,0). Prime the retained camera at the actual saved spawn so startup is
    // one keyframe, not seconds of SU/DCH catch-up traffic.
    this.renderer.primeCamera(this.visualPlayerX, this.visualPlayerY);

    // Initialize the renderer
    this.renderer.initialize();

    // Keep every session at the same 15 Hz cadence, but do not queue all
    // viewport reconstruction and IPC output in one synchronized burst.
    this.tickStartTimeout = setTimeout(() => {
      this.tickStartTimeout = null;
      if (this.destroyed) return;
      this.scheduleTick();
      this.tickInterval = setInterval(() => this.scheduleTick(), RENDER_INTERVAL_MS);
    }, sessionRenderPhase(this.sessionId));
  }

  private scheduleTick(): void {
    cooperativeRenderScheduler.schedule(this.sessionId, () => this.tick());
  }

  private cancelScheduledTick(): void {
    cooperativeRenderScheduler.cancel(this.sessionId);
  }

  private updateLocalPlayerState(): void {
    if (!this.tileProvider || !this.userId) return;

    const state: PlayerVisualState = {
      userId: this.userId,
      username: this.username,
      x: this.visualPlayerX,
      y: this.visualPlayerY,
      direction: this.playerDirection,
      animationFrame: this.playerAnimationFrame,
      isMoving: this.isMoving,
    };

    this.tileProvider.updatePlayer(state);
  }

  /** Apply the canonical world-scale zoom whenever a modal recreates the
   * renderer. Without this, returning from avatar/building/NPC creation fell
   * back to the 100% single-tile view. */
  private applyDefaultWorldFraming(renderer: PixelGameRenderer): void {
    if (this.districtMode) renderer.setZoomLevel(20);
    else if (this.regionalWorldKit || this.canalTownKit) renderer.setZoomLevel(30);
  }

  private ensureRegionalPrewarmer(
    geometry: WorldPreparationGeometry,
  ): RegionalPredictivePrewarmer | null {
    if (!this.regionalTileProvider || !this.regionalPrewarmService) return null;
    const key = `${geometry.resolution}:${geometry.viewportRadiusX}:${geometry.viewportRadiusY}`;
    if (this.regionalPrewarmer && this.regionalPrewarmGeometryKey === key) {
      return this.regionalPrewarmer;
    }
    this.regionalPrewarmer?.stop();
    this.regionalPrewarmGeometryKey = key;
    this.regionalPrewarmer = new RegionalPredictivePrewarmer({
      generator: this.regionalPrewarmService,
      target: this.regionalTileProvider,
      resolution: geometry.resolution,
      viewportRadiusX: geometry.viewportRadiusX,
      viewportRadiusY: geometry.viewportRadiusY,
      lookaheadTiles: 32,
      fringeTiles: 4,
      onError: (error) => {
        console.error(`[WorkerSession] Regional prewarm failed for ${this.sessionId.slice(0, 8)}:`, error);
      },
    });
    return this.regionalPrewarmer;
  }

  private async observeRegionalWorld(
    velocityX: number,
    velocityY: number,
    requireCoverage = false,
    centerX = this.playerX,
    centerY = this.playerY,
  ): Promise<void> {
    if (!this.renderer || !this.regionalTileProvider) return;
    const geometry = this.renderer.getWorldPreparationGeometry();
    const prewarmer = this.ensureRegionalPrewarmer(geometry);
    if (!prewarmer) {
      if (requireCoverage) throw new Error('Regional prewarm service is unavailable');
      return;
    }
    prewarmer.observe(centerX, centerY, velocityX, velocityY);
    if (!requireCoverage) return;
    await prewarmer.whenIdle();
    if (!this.regionalTileProvider.hasPreparedViewportCoverage(
      Math.floor(centerX - geometry.viewportRadiusX),
      Math.floor(centerY - geometry.viewportRadiusY),
      Math.ceil(centerX + geometry.viewportRadiusX),
      Math.ceil(centerY + geometry.viewportRadiusY),
      geometry.resolution,
    )) {
      throw new Error(`Regional viewport preparation failed at ${centerX},${centerY}`);
    }
  }

  private observeRegionalCamera(): Promise<void> {
    const center = this.renderer?.getCameraTilePosition();
    return this.observeRegionalWorld(0, 0, false, center?.x, center?.y);
  }

  private tick(): void {
    if (this.destroyed || !this.renderer || !this.tileProvider) return;

    this.advanceVisualPlayer(Date.now());

    // Update animation frame when moving
    if (this.isMoving) {
      this.playerAnimationFrame = ((this.playerAnimationFrame + 1) % 4) as AnimationFrame;
      this.updateLocalPlayerState();
    }

    this.tickCounter++;

    // Refresh visible players/NPCs periodically
    this.refreshVisiblePlayersIfNeeded();
    this.refreshVisibleNPCsIfNeeded();

    // Update other players
    const missingPlayerIds: string[] = [];
    for (const player of this.cachedVisiblePlayers) {
      if (player.userId === this.userId) continue;

      const state: PlayerVisualState = {
        userId: player.userId,
        username: player.username,
        x: player.x,
        y: player.y,
        direction: player.direction as Direction,
        animationFrame: player.animationFrame as AnimationFrame,
        isMoving: false,
      };
      this.tileProvider.updatePlayer(state);

      if (!this.tileProvider.getPlayerSprite(player.userId) && !this.loadingSprites.has(player.userId)) {
        const color = this.getPlayerColor(player.userId);
        this.tileProvider.setPlayerSprite(player.userId, createPlaceholderSprite(color));
        missingPlayerIds.push(player.userId);
      }
    }

    if (missingPlayerIds.length > 0) {
      missingPlayerIds.forEach(id => this.loadingSprites.add(id));
      void this.batchLoadPlayerSprites(missingPlayerIds);
    }

    // Update visible NPCs
    const missingNPCIds: string[] = [];
    for (const npc of this.cachedVisibleNPCs) {
      this.tileProvider.updateNPC({
        npcId: npc.npcId,
        name: npc.name,
        x: npc.x,
        y: npc.y,
        direction: npc.direction as Direction,
        animationFrame: npc.animationFrame as AnimationFrame,
        isMoving: npc.isMoving,
        role: npc.role,
        activity: npc.activity,
        primaryNeed: npc.primaryNeed,
      });

      if (!this.tileProvider.getNPCSprite(npc.npcId) && !this.loadingNPCSprites.has(npc.npcId)) {
        missingNPCIds.push(npc.npcId);
      }
    }

    if (missingNPCIds.length > 0) {
      missingNPCIds.forEach(id => this.loadingNPCSprites.add(id));
      void this.batchLoadNPCSprites(missingNPCIds);
    }

    // Refresh chat messages periodically (every ~10 ticks = ~670ms at 15fps)
    if (this.tickCounter % 10 === 0 && this.chatComponent && this.chatVisible) {
      const messages = getChatMessages();
      const entries: ChatEntry[] = messages.map((m) => ({
        id: `${m.senderId}-${m.timestamp.getTime()}`,  // Stable ID without array index
        actorId: m.senderId,
        actorName: m.senderName,
        actorType: m.senderType,
        type: 'chat' as const,
        message: m.message,
        position: m.position,
        timestamp: m.timestamp,
      }));
      this.chatComponent.updateEntries(entries);
    }

    // Center camera on player
    this.renderer.setCamera(this.visualPlayerX, this.visualPlayerY);
    // The simulation accepts a discrete tile immediately; keep that exact
    // coordinate visible while the avatar traverses the tile smoothly.
    this.renderer.setAuthoritativePosition(this.playerX, this.playerY);
    const worldLife = this.gameServer.getTerminalWorldLifeProjection();
    this.tileProvider.setWorldLifeState(worldLife.state, worldLife.animationEpoch);

    // Render
    let output = this.renderer.renderToString(this.tileProvider);

    if (this.componentManager?.hasVisibleComponents()) {
      output += this.componentManager.renderToString();
    }

    if (output) {
      this.sendOutput(this.sessionId, output, this.renderer.getCodecMetrics()?.keyframe ?? false);
    }
  }

  private refreshVisiblePlayersIfNeeded(): void {
    const POSITION_THRESHOLD = 2;
    const positionChanged =
      Math.abs(this.playerX - this.lastQueryX) > POSITION_THRESHOLD ||
      Math.abs(this.playerY - this.lastQueryY) > POSITION_THRESHOLD;

    if (!positionChanged && this.tickCounter % 45 !== 0) {
      return;
    }

    // Direct call to GameServer (no IPC!)
    this.cachedVisiblePlayers = this.gameServer.getVisiblePlayers(
      this.playerX,
      this.playerY,
      this.cols,
      this.rows,
      this.userId!
    );
    this.lastQueryX = this.playerX;
    this.lastQueryY = this.playerY;
  }

  private refreshVisibleNPCsIfNeeded(): void {
    if (this.tickCounter % 45 !== 0) {
      return;
    }

    // Direct call to GameServer (no IPC!)
    this.cachedVisibleNPCs = this.gameServer.getVisibleNPCs(
      this.playerX,
      this.playerY,
      this.cols,
      this.rows
    );
  }

  private async batchLoadNPCSprites(npcIds: string[]): Promise<void> {
    for (const npcId of npcIds) {
      try {
        const sprite = this.gameServer.getNPCSprite(npcId);
        if (sprite && this.tileProvider) {
          this.tileProvider.setNPCSprite(npcId, sprite);
        }
      } catch (err) {
        console.error(`[WorkerSession] Failed to load NPC sprite ${npcId}:`, err);
      } finally {
        this.loadingNPCSprites.delete(npcId);
      }
    }
  }

  private getPlayerColor(userId: string): { r: number; g: number; b: number } {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash) + userId.charCodeAt(i);
      hash = hash & hash;
    }
    return {
      r: ((hash >> 16) & 0xFF),
      g: ((hash >> 8) & 0xFF),
      b: (hash & 0xFF),
    };
  }

  private handleAction(action: string, _event: unknown): void {
    if (this.destroyed) return;

    switch (action) {
      case 'move_up':
        this.moveScreenRelative('up');
        break;
      case 'move_down':
        this.moveScreenRelative('down');
        break;
      case 'move_left':
        this.moveScreenRelative('left');
        break;
      case 'move_right':
        this.moveScreenRelative('right');
        break;
      case 'zoom_in':
        this.renderer?.zoomIn();
        void this.observeRegionalCamera();
        break;
      case 'zoom_out':
        this.renderer?.zoomOut();
        void this.observeRegionalCamera();
        break;
      case 'cycle_render_mode':
        this.renderer?.cycleRenderMode();
        void this.observeRegionalCamera();
        break;
      case 'regenerate_avatar':
        this.openAvatarScreen();
        break;
      case 'place_building':
        this.openBuildingScreen();
        break;
      case 'place_road':
        void this.placeRoad();
        break;
      case 'remove_road':
        void this.removeRoad();
        break;
      case 'create_npc':
        this.openNPCScreen();
        break;
      case 'toggle_players':
        this.togglePlayerList();
        break;
      case 'toggle_camera_mode':
        this.renderer?.toggleCameraMode();
        this.renderer?.invalidate();
        break;
      case 'snap_to_player':
        this.renderer?.snapCameraToPlayer();
        this.renderer?.setCameraMode('follow');
        this.renderer?.invalidate();
        break;
      case 'pan_camera_up':
        this.panCamera(0, -1);
        break;
      case 'pan_camera_down':
        this.panCamera(0, 1);
        break;
      case 'pan_camera_left':
        this.panCamera(-1, 0);
        break;
      case 'pan_camera_right':
        this.panCamera(1, 0);
        break;
      case 'rotate_camera_cw':
        this.renderer?.rotateCameraClockwise();
        this.renderer?.invalidate();
        void this.observeRegionalCamera();
        break;
      case 'rotate_camera_ccw':
        this.renderer?.rotateCameraCounterClockwise();
        this.renderer?.invalidate();
        void this.observeRegionalCamera();
        break;
      case 'show_help':
        if (this.helpModal && !this.helpModal.isVisible()) {
          this.componentManager?.pushFocus(this.helpModal);
        }
        break;
      case 'quit':
        this.quit();
        break;
      case 'toggle_chat':
        this.toggleChat();
        break;
      case 'focus_chat':
        if (this.chatComponent && this.chatVisible) {
          this.componentManager?.pushFocus(this.chatComponent);
        }
        break;
    }
  }

  private togglePlayerList(): void {
    if (!this.playerListModal) return;

    if (this.playerListModal.isVisible()) {
      this.componentManager?.popFocus();
    } else {
      this.cachedAllPlayers = this.gameServer.getAllPlayers();
      this.playerListModal.setPlayers(this.cachedAllPlayers, this.userId);
      this.componentManager?.pushFocus(this.playerListModal);
    }
  }

  /**
   * Toggle chat visibility
   */
  private toggleChat(): void {
    this.chatVisible = !this.chatVisible;
    const chatWidthT = this.chatVisible ? this.getChatWidth() : 0;

    // Update renderer layout
    if (this.renderer) {
      this.renderer.setLayout({
        headerRows: 2,
        footerRows: 0,
        leftSidebarCols: 0,
        rightSidebarCols: chatWidthT,
      });
      this.renderer.invalidate();
    }

    // Show/hide chat component
    if (this.chatComponent) {
      if (this.chatVisible) {
        this.chatComponent.resize({
          x: this.cols - this.getChatWidth(),
          y: 2,
          width: this.getChatWidth(),
          height: this.rows - 2,
        });
        this.chatComponent.show();
      } else {
        // If chat is focused, pop focus first
        if (this.componentManager?.getFocusedComponent() === this.chatComponent) {
          this.componentManager.popFocus();
        }
        this.chatComponent.hide();
      }
    }
  }

  /**
   * Handle sending a chat message
   */
  private handleChatSend(message: string): void {
    console.log('[WorkerSession] handleChatSend called with:', message, 'userId:', this.userId);
    if (!this.userId) {
      console.log('[WorkerSession] No userId, cannot send message');
      return;
    }
    if (!message.trim()) {
      console.log('[WorkerSession] Empty message, not sending');
      return;
    }

    addChatMessage({
      senderId: this.userId,
      senderName: this.username,
      senderType: 'player',
      message: message.trim(),
      position: { x: this.playerX, y: this.playerY },
    });
    console.log('[WorkerSession] Message added to chat buffer');

    // Pop focus from chat after sending
    if (this.componentManager?.getFocusedComponent() === this.chatComponent) {
      this.componentManager.popFocus();
    }
  }

  private panCamera(dx: number, dy: number): void {
    if (!this.renderer) return;
    if (this.renderer.getCameraMode() === 'follow') {
      this.renderer.setCameraMode('free');
    }
    this.renderer.panCameraByTiles(dx, dy);
    this.renderer.invalidate();
    void this.observeRegionalCamera();
  }

  private getWorldDirection(screenDirection: Direction): Direction {
    if (!this.renderer) return screenDirection;
    return this.renderer.getWorldDirection(screenDirection);
  }

  private async quit(): Promise<void> {
    await this.destroy();
  }

  private async openAvatarScreen(): Promise<void> {
    this.inputPaused = true;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.tickStartTimeout) {
      clearTimeout(this.tickStartTimeout);
      this.tickStartTimeout = null;
    }
    this.cancelScheduledTick();

    this.bootScreen?.destroy();
    this.bootScreen = null;

    this.renderer?.cleanup();

    try {
      const screen = new AvatarScreen({
        stream: this.stream,
        currentPrompt: this.currentPrompt,
        providerConfig: this.providerConfig,
        username: this.username,
      });

      const result = await screen.run();

      if (result.action === 'confirm' && result.result && result.prompt) {
        this.currentPrompt = result.prompt;

        try {
          await this.saveAvatar(result.prompt, result.result);
        } catch (err) {
          console.error('Failed to save avatar:', err);
        }

        if (this.tileProvider && this.userId) {
          this.tileProvider.setPlayerSprite(
            this.userId,
            cacheRuntimeSprite(this.userId, result.result),
          );
        }

        if (this.userId) {
          await this.gameServer.broadcastSpriteReload(this.userId);
        }
      }
    } catch (err) {
      console.error('Avatar screen error:', err);
    }

    const chatWidthA = this.chatVisible ? this.getChatWidth() : 0;
    this.renderer = new PixelGameRenderer({
      stream: this.stream,
      cols: this.cols,
      rows: this.rows,
      username: this.username,
      renderMode: this.renderMode,
      optimizations: PERF_OPTIMIZATIONS,
      layout: {
        headerRows: 2,
        footerRows: 0,
        leftSidebarCols: 0,
        rightSidebarCols: chatWidthA,
      },
    });
    this.applyDefaultWorldFraming(this.renderer);
    this.renderer.primeCamera(this.visualPlayerX, this.visualPlayerY);
    this.renderer.initialize();

    this.inputPaused = false;
    this.renderer.invalidate();
    this.tickInterval = setInterval(() => this.scheduleTick(), RENDER_INTERVAL_MS);
  }

  private async saveAvatar(prompt: string, sprite: Sprite): Promise<void> {
    if (!this.userId) return;

    await saveSpriteToDisk(this.userId, sprite);

    await db
      .update(schema.avatars)
      .set({
        prompt,
        generationStatus: 'completed',
        modelUsed: this.providerConfig.model || 'default',
        updatedAt: new Date(),
      })
      .where(eq(schema.avatars.userId, this.userId));
  }

  private async openBuildingScreen(): Promise<void> {
    this.inputPaused = true;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.tickStartTimeout) {
      clearTimeout(this.tickStartTimeout);
      this.tickStartTimeout = null;
    }
    this.cancelScheduledTick();

    this.renderer?.cleanup();

    try {
      const screen = new BuildingScreen({
        stream: this.stream,
        providerConfig: this.providerConfig,
        username: this.username,
        playerX: this.playerX,
        playerY: this.playerY,
      });

      const result = await screen.run();

      if (result.action === 'confirm' && result.result && result.prompt) {
        try {
          await this.saveBuilding(result.prompt, result.result);
        } catch (err) {
          console.error('Failed to save building:', err);
        }
      }
    } catch (err) {
      console.error('Building screen error:', err);
    }

    const chatWidthB = this.chatVisible ? this.getChatWidth() : 0;
    this.renderer = new PixelGameRenderer({
      stream: this.stream,
      cols: this.cols,
      rows: this.rows,
      username: this.username,
      renderMode: this.renderMode,
      optimizations: PERF_OPTIMIZATIONS,
      layout: {
        headerRows: 2,
        footerRows: 0,
        leftSidebarCols: 0,
        rightSidebarCols: chatWidthB,
      },
    });
    this.applyDefaultWorldFraming(this.renderer);
    this.renderer.primeCamera(this.visualPlayerX, this.visualPlayerY);
    this.renderer.initialize();

    this.inputPaused = false;
    this.renderer.invalidate();
    this.tickInterval = setInterval(() => this.scheduleTick(), RENDER_INTERVAL_MS);
  }

  private async saveBuilding(prompt: string, sprite: DirectionalBuildingSprite): Promise<void> {
    if (!this.userId) return;

    const anchorX = this.playerX;
    const anchorY = this.playerY - 1;

    const positions = getBuildingTilePositions(anchorX, anchorY);
    for (const [x, y] of positions) {
      if (this.tileProvider?.isBuildingAt(x, y)) {
        console.log(`[Building] Cannot place - tile (${x}, ${y}) already occupied`);
        return;
      }
    }

    const [building] = await db
      .insert(schema.buildings)
      .values({
        ownerId: this.userId,
        anchorX,
        anchorY,
        prompt,
        modelUsed: this.providerConfig.model || 'gpt-image-1-mini',
      })
      .returning({ id: schema.buildings.id });

    if (!building) {
      console.error('[Building] Failed to create building record');
      return;
    }

    await saveBuildingToDisk(building.id, sprite);

    this.tileProvider?.setBuilding(building.id, anchorX, anchorY, sprite.north, {
      north: sprite.north,
      east: sprite.east,
      south: sprite.south,
      west: sprite.west,
    });

    // Update collision cache directly
    this.gameServer.addBuildingToCollisionCache(anchorX, anchorY);

    console.log(`[Building] Placed building ${building.id} at (${anchorX}, ${anchorY})`);
  }

  private async placeRoad(): Promise<void> {
    if (!this.userId || !this.tileProvider) return;

    const x = this.playerX;
    const y = this.playerY;

    // Check if road already exists at this position
    if (this.tileProvider.hasRoadAt(x, y)) {
      return;
    }

    // Check if building exists at this position (can't place road on building)
    if (this.tileProvider.isBuildingAt(x, y)) {
      return;
    }

    try {
      // Insert into database
      await db.insert(schema.roads).values({
        x,
        y,
        placedBy: this.userId,
      });

      // Update local tile provider
      this.tileProvider.setRoad(x, y, this.userId);

      // Broadcast to all players via game server
      this.gameServer.broadcastRoadPlacement(x, y, this.userId);

      console.log(`[Road] Placed road at (${x}, ${y}) by ${this.username}`);
    } catch (error: unknown) {
      // Handle unique constraint violation (road already exists)
      const err = error as { code?: string };
      if (err.code === '23505') {
        // Road already exists, just update local state
        this.tileProvider.setRoad(x, y, this.userId);
      } else {
        console.error('[Road] Failed to place road:', error);
      }
    }
  }

  private async removeRoad(): Promise<void> {
    if (!this.userId || !this.tileProvider) return;

    const x = this.playerX;
    const y = this.playerY;

    // Check if road exists at this position
    if (!this.tileProvider.hasRoadAt(x, y)) {
      return;
    }

    try {
      // Delete from database
      await db.delete(schema.roads).where(
        and(eq(schema.roads.x, x), eq(schema.roads.y, y))
      );

      // Update local tile provider
      this.tileProvider.removeRoad(x, y);

      // Broadcast to all players via game server
      this.gameServer.broadcastRoadRemoval(x, y);

      console.log(`[Road] Removed road at (${x}, ${y}) by ${this.username}`);
    } catch (error) {
      console.error('[Road] Failed to remove road:', error);
    }
  }

  private async openNPCScreen(): Promise<void> {
    this.inputPaused = true;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.tickStartTimeout) {
      clearTimeout(this.tickStartTimeout);
      this.tickStartTimeout = null;
    }
    this.cancelScheduledTick();

    this.renderer?.cleanup();

    try {
      const screen = new NPCScreen({
        stream: this.stream,
        providerConfig: this.providerConfig,
        username: this.username,
        playerX: this.playerX,
        playerY: this.playerY,
      });

      const result = await screen.run();

      if (result.action === 'confirm' && result.result && result.prompt) {
        const npcData = {
          creatorId: this.userId!,
          name: result.result.name,
          prompt: result.prompt,
          spawnX: this.playerX,
          spawnY: this.playerY,
          roamRadius: 15,
          playerAffinity: 50,
          sprite: result.result.sprite,
        };

        const createdNpc = await this.gameServer.createNPC(npcData);

        if (createdNpc) {
          console.log(`[NPC] Created "${createdNpc.name}" at (${createdNpc.x}, ${createdNpc.y})`);

          this.tileProvider?.updateNPC(createdNpc);

          const sprite = this.gameServer.getNPCSprite(createdNpc.npcId);
          if (sprite) {
            this.tileProvider?.setNPCSprite(createdNpc.npcId, sprite);
          }
        }
      }
    } catch (err) {
      console.error('NPC screen error:', err);
    }

    const chatWidthN = this.chatVisible ? this.getChatWidth() : 0;
    this.renderer = new PixelGameRenderer({
      stream: this.stream,
      cols: this.cols,
      rows: this.rows,
      username: this.username,
      renderMode: this.renderMode,
      optimizations: PERF_OPTIMIZATIONS,
      layout: {
        headerRows: 2,
        footerRows: 0,
        leftSidebarCols: 0,
        rightSidebarCols: chatWidthN,
      },
    });
    this.applyDefaultWorldFraming(this.renderer);
    this.renderer.primeCamera(this.visualPlayerX, this.visualPlayerY);
    this.renderer.initialize();

    this.inputPaused = false;
    this.renderer.invalidate();
    this.tickInterval = setInterval(() => this.scheduleTick(), RENDER_INTERVAL_MS);
  }

  private async loadNearbyBuildings(): Promise<void> {
    if (!this.tileProvider) return;

    const range = 50;
    const buildings = await db.query.buildings.findMany({
      where: and(
        between(schema.buildings.anchorX, this.playerX - range, this.playerX + range),
        between(schema.buildings.anchorY, this.playerY - range, this.playerY + range)
      ),
    });

    for (const building of buildings) {
      if (this.tileProvider.getBuildingAt(building.anchorX, building.anchorY)) {
        continue;
      }

      const dirSprite = await loadAllBuildingDirections(building.id);
      if (dirSprite) {
        this.tileProvider.setBuilding(building.id, building.anchorX, building.anchorY, dirSprite.north, {
          north: dirSprite.north,
          east: dirSprite.east,
          south: dirSprite.south,
          west: dirSprite.west,
        });
      }
    }
  }

  private async loadNearbyRoads(): Promise<void> {
    if (!this.tileProvider) return;

    const range = 100; // Load roads in a larger area since they're lightweight
    const roads = await db.query.roads.findMany({
      where: and(
        between(schema.roads.x, this.playerX - range, this.playerX + range),
        between(schema.roads.y, this.playerY - range, this.playerY + range)
      ),
    });

    for (const road of roads) {
      this.tileProvider.setRoad(road.x, road.y, road.placedBy);
    }

    console.log(`[WorkerSession] Loaded ${roads.length} nearby roads`);
  }

  private async batchLoadPlayerSprites(playerIds: string[]): Promise<void> {
    if (!this.tileProvider || playerIds.length === 0) return;

    const diskResults = await Promise.all(
      playerIds.map(async (playerId) => {
        try {
          const sprite = await loadSpriteFromDisk(playerId);
          return { playerId, sprite, success: !!sprite };
        } catch {
          return { playerId, sprite: null, success: false };
        }
      })
    );

    const needsDbLookup: string[] = [];
    for (const result of diskResults) {
      if (result.success && result.sprite) {
        this.tileProvider?.setPlayerSprite(result.playerId, result.sprite);
        this.loadingSprites.delete(result.playerId);
      } else {
        needsDbLookup.push(result.playerId);
      }
    }

    if (needsDbLookup.length > 0) {
      try {
        const avatars: Array<{ userId: string; spriteJson: Sprite | null }> = await db.select({
          userId: schema.avatars.userId,
          spriteJson: schema.avatars.spriteJson,
        })
          .from(schema.avatars)
          .where(inArray(schema.avatars.userId, needsDbLookup)) as Array<{ userId: string; spriteJson: Sprite | null }>;

        const avatarMap = new Map(avatars.map(a => [a.userId, a]));

        for (const playerId of needsDbLookup) {
          const avatar = avatarMap.get(playerId);
          if (avatar?.spriteJson) {
            this.tileProvider?.setPlayerSprite(
              playerId,
              cacheRuntimeSprite(playerId, avatar.spriteJson),
            );
          }
          this.loadingSprites.delete(playerId);
        }
      } catch (error) {
        console.error('Failed to batch load avatars from DB:', error);
        for (const playerId of needsDbLookup) {
          this.loadingSprites.delete(playerId);
        }
      }
    }
  }

  private moveScreenRelative(screenDirection: Direction): void {
    const worldDirection = this.getWorldDirection(screenDirection);

    const deltas: Record<Direction, { dx: number; dy: number }> = {
      up: { dx: 0, dy: -1 },
      down: { dx: 0, dy: 1 },
      left: { dx: -1, dy: 0 },
      right: { dx: 1, dy: 0 },
    };

    const { dx, dy } = deltas[worldDirection];

    if (this.consecutiveMoveDirection === worldDirection) {
      this.consecutiveMoveCount++;
    } else {
      this.consecutiveMoveDirection = worldDirection;
      this.consecutiveMoveCount = 1;
    }

    this.moveOptimistic(dx, dy, worldDirection);
  }

  private moveOptimistic(dx: number, dy: number, direction: Direction): void {
    dx = Math.max(-1, Math.min(1, dx));
    dy = Math.max(-1, Math.min(1, dy));

    const targetX = this.playerX + dx;
    const targetY = this.playerY + dy;
    const targetTile = this.tileProvider?.getTile(targetX, targetY);

    if (targetTile && !targetTile.walkable) {
      return;
    }

    if (this.tileProvider?.isBuildingAt(targetX, targetY)) {
      return;
    }

    this.moveFromX = this.visualPlayerX;
    this.moveFromY = this.visualPlayerY;
    this.moveStartedAt = Date.now();
    this.moveDurationMs = this.consecutiveMoveCount >= this.MOMENTUM_THRESHOLD ? 100 : 200;
    this.playerX = targetX;
    this.playerY = targetY;
    this.playerDirection = direction;
    this.isMoving = true;
    this.inputSequence++;

    this.updateLocalPlayerState();

    // Direct update to game server (no IPC!)
    this.gameServer.queueInput({
      userId: this.userId!,
      sessionId: this.sessionId,
      type: 'move',
      payload: { dx, dy },
      timestamp: Date.now(),
      sequence: this.inputSequence,
    });

    this.gameServer.updatePlayerPosition(this.userId!, this.playerX, this.playerY);
    if (this.renderer) {
      const acknowledgement = this.renderer.renderPositionAcknowledgement(
        this.playerX,
        this.playerY,
      );
      if (acknowledgement) this.sendOutput(this.sessionId, acknowledgement, false, true);
    }
    void this.observeRegionalWorld(dx, dy);

    this.updateMoveAnimation();
  }

  private updateMoveAnimation(): void {
    if (this.moveTimer) {
      clearTimeout(this.moveTimer);
    }

    const isRunning = this.consecutiveMoveCount >= this.MOMENTUM_THRESHOLD;
    const animationDelay = isRunning ? 100 : 200;

    this.moveTimer = setTimeout(() => {
      this.visualPlayerX = this.playerX;
      this.visualPlayerY = this.playerY;
      this.isMoving = false;
      this.playerAnimationFrame = 0;
      this.consecutiveMoveCount = 0;
      this.consecutiveMoveDirection = null;
      this.updateLocalPlayerState();
    }, animationDelay);
  }

  private advanceVisualPlayer(now: number): void {
    if (!this.isMoving) return;
    const elapsed = now - this.moveStartedAt;
    const t = Math.max(0, Math.min(1, elapsed / Math.max(1, this.moveDurationMs)));
    // Smoothstep is monotonic and seek-safe; no overshoot or elastic motion.
    const eased = t * t * (3 - 2 * t);
    const nextX = this.moveFromX + (this.playerX - this.moveFromX) * eased;
    const nextY = this.moveFromY + (this.playerY - this.moveFromY) * eased;
    if (nextX === this.visualPlayerX && nextY === this.visualPlayerY) return;
    this.visualPlayerX = nextX;
    this.visualPlayerY = nextY;
    this.updateLocalPlayerState();
  }

  private async showEntranceScreen(): Promise<void> {
    const ESC = '\x1b';
    const bgAnsi = bg(BG_PRIMARY);
    const crimsonFg = fg(CRIMSON_BRIGHT);
    const goldFg = fg(ACCENT_GOLD);
    const reset = `${ESC}[0m`;

    const write = (output: string): boolean => {
      if (this.destroyed || this.stream.isStreamDestroyed() || this.stream.writableEnded) {
        return false;
      }
      this.stream.write(output);
      return true;
    };

    for (let row = 1; row <= this.rows; row++) {
      if (!write(`${ESC}[${row};1H${bgAnsi}${' '.repeat(this.cols)}`)) return;
    }

    const centerY = Math.floor(this.rows / 2);

    const nameDisplay = this.username.toUpperCase();
    const nameX = Math.floor((this.cols - nameDisplay.length) / 2);
    if (!write(`${ESC}[${centerY - 2};${nameX}H${goldFg}${nameDisplay}${reset}`)) return;
    await new Promise(resolve => setTimeout(resolve, 400));
    if (this.destroyed) return;

    const vsText = 'VS';
    const vsX = Math.floor((this.cols - vsText.length) / 2);
    if (!write(`${ESC}[${centerY};${vsX}H${crimsonFg}${vsText}${reset}`)) return;
    await new Promise(resolve => setTimeout(resolve, 300));
    if (this.destroyed) return;

    const abyssText = 'THE ABYSS';
    const abyssX = Math.floor((this.cols - abyssText.length) / 2);
    if (!write(`${ESC}[${centerY + 2};${abyssX}H${goldFg}${abyssText}${reset}`)) return;
    await new Promise(resolve => setTimeout(resolve, 500));
    if (this.destroyed) return;

    const fightArt = [
      '███████╗██╗ ██████╗ ██╗  ██╗████████╗██╗',
      '██╔════╝██║██╔════╝ ██║  ██║╚══██╔══╝██║',
      '█████╗  ██║██║  ███╗███████║   ██║   ██║',
      '██╔══╝  ██║██║   ██║██╔══██║   ██║   ╚═╝',
      '██║     ██║╚██████╔╝██║  ██║   ██║   ██╗',
      '╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝',
    ];

    const fightWidth = fightArt[0]!.length;
    const fightX = Math.floor((this.cols - fightWidth) / 2);
    const fightY = centerY + 5;

    for (let i = 0; i < fightArt.length; i++) {
      if (!write(`${ESC}[${fightY + i};${fightX}H${crimsonFg}${fightArt[i]}${reset}`)) return;
    }

    await new Promise(resolve => setTimeout(resolve, 800));
    if (this.destroyed) return;

    const whiteFg = `${ESC}[38;2;255;255;255m`;
    for (let i = 0; i < fightArt.length; i++) {
      if (!write(`${ESC}[${fightY + i};${fightX}H${whiteFg}${fightArt[i]}${reset}`)) return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    if (this.destroyed) return;

    for (let i = 0; i < fightArt.length; i++) {
      if (!write(`${ESC}[${fightY + i};${fightX}H${crimsonFg}${fightArt[i]}${reset}`)) return;
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }

  /**
   * Get appropriate chat width based on terminal size
   */
  private getChatWidth(): number {
    // 40 cols for normal terminals, narrower for small screens
    if (this.cols < 100) {
      return Math.min(32, Math.floor(this.cols * 0.35));
    }
    return 40;
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.tickStartTimeout) {
      clearTimeout(this.tickStartTimeout);
      this.tickStartTimeout = null;
    }
    this.cancelScheduledTick();

    if (this.moveTimer) {
      clearTimeout(this.moveTimer);
      this.moveTimer = null;
    }

    if (this.componentManager) {
      this.componentManager.destroy();
      this.componentManager = null;
    }
    this.inputRouter = null;
    this.helpModal = null;
    this.playerListModal = null;
    this.reloadOverlay = null;
    this.chatComponent = null;

    if (this.renderer) {
      this.renderer.cleanup();
    }
    this.regionalPrewarmer?.stop();
    this.regionalPrewarmer = null;

    // Save state and disconnect from game server
    if (this.userId) {
      await db
        .update(schema.playerState)
        .set({
          x: this.playerX,
          y: this.playerY,
          direction: this.playerDirection,
          animationFrame: this.playerAnimationFrame,
          isOnline: false,
          lastSeenAt: new Date(),
        })
        .where(eq(schema.playerState.userId, this.userId));

      await this.gameServer.playerDisconnect(this.userId);
    }

    this.tileProvider?.destroy();
    this.tileProvider = null;
    this.regionalTileProvider = null;

    // Close the virtual stream
    this.stream.end();

    // Notify main process
    this.sendEnded(this.sessionId);
  }
}
