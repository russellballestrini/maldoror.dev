import type {
  Sprite,
  NPCState,
  NPCVisualState,
  NPCConfig,
  Direction,
  NPCBehaviorState,
  NPCLifeEvent,
  WorldLifeState,
} from '@maldoror/protocol';
import { DEFAULT_NPC_CONFIG } from '@maldoror/protocol';
import {
  loadAllNPCs,
  loadNPCSpriteFromDisk,
  createNPC,
  loadNPCRelationshipFamiliarities,
  loadWorldLifeState,
  persistNPCRuntimeStates,
  type LoadedNPCRecord,
  type NPCCreateData,
  type NPCRuntimeSnapshot,
} from '../utils/npc-storage.js';
import {
  advanceNPCLifeMinute,
  advanceWorldLifeMinute,
  createInitialNPCLifeState,
  createInitialWorldLifeState,
  primaryNPCNeed,
  stableLifeHash,
  type LifePosition,
} from './npc-life-simulation.js';

/**
 * Player position for AI calculations
 */
interface PlayerPosition {
  userId: string;
  x: number;
  y: number;
}

/**
 * Collision check function type
 * Returns true if the position is blocked
 */
type CollisionChecker = (x: number, y: number) => boolean;

/**
 * NPC creation callback type
 * Called when a new NPC is created
 */
type NPCCreatedCallback = (npc: NPCVisualState) => void;

/**
 * NPCManager - Server-side NPC state management and AI
 *
 * Handles:
 * - Loading NPCs from database on startup
 * - Storing NPC sprites in memory
 * - Ticking all NPCs to update their AI/movement
 * - Providing visible NPCs for viewport queries
 */
export class NPCManager {
  private npcs: Map<string, NPCState> = new Map();
  private sprites: Map<string, Sprite> = new Map();
  private collisionChecker: CollisionChecker | null = null;
  private npcCreatedCallbacks: Set<NPCCreatedCallback> = new Set();
  private tickCounter: number = 0;
  private dirtyNPCIds: Set<string> = new Set();
  private persistencePromise: Promise<void> | null = null;
  private worldLifeState: WorldLifeState;
  private worldStateDirty: boolean = false;
  private pendingLifeEvents: NPCLifeEvent[] = [];
  private readonly worldSeed: string;
  private readonly tickRate: number;
  private relationshipFamiliarity: Map<string, number> = new Map();

  constructor(options: { worldSeed?: string; tickRate?: number } = {}) {
    this.worldSeed = options.worldSeed ?? '0';
    this.tickRate = Math.max(1, Math.floor(options.tickRate ?? 15));
    this.worldLifeState = createInitialWorldLifeState(this.worldSeed);
  }

  /**
   * Set collision checker function
   * Called to check if a position is blocked by terrain or buildings
   */
  setCollisionChecker(checker: CollisionChecker): void {
    this.collisionChecker = checker;
  }

  /**
   * Register callback for NPC creation events
   */
  onNPCCreated(callback: NPCCreatedCallback): void {
    this.npcCreatedCallbacks.add(callback);
  }

  /**
   * Unregister NPC creation callback
   */
  offNPCCreated(callback: NPCCreatedCallback): void {
    this.npcCreatedCallbacks.delete(callback);
  }

  /**
   * Load all NPCs from database on startup
   */
  async loadFromDB(): Promise<void> {
    const persistedWorld = await loadWorldLifeState();
    if (persistedWorld && persistedWorld.worldSeed !== this.worldSeed) {
      throw new Error(
        `World-life seed mismatch: persisted ${persistedWorld.worldSeed}, runtime ${this.worldSeed}`,
      );
    }
    this.worldLifeState = persistedWorld ?? createInitialWorldLifeState(this.worldSeed);
    this.worldStateDirty = persistedWorld === null;

    const records = await loadAllNPCs();
    const relationships = await loadNPCRelationshipFamiliarities();
    this.relationshipFamiliarity.clear();
    for (const relationship of relationships) {
      this.relationshipFamiliarity.set(
        this.relationshipKey(relationship.npcId, relationship.targetId),
        relationship.familiarity,
      );
    }
    console.log(`[NPCManager] Loading ${records.length} NPCs from database...`);

    let loadedCount = 0;
    let spriteCount = 0;

    for (const record of records) {
      // Create NPC state from record
      const state = this.createStateFromRecord(record);
      this.npcs.set(record.id, state);
      loadedCount++;

      // Load sprite from disk
      const sprite = await loadNPCSpriteFromDisk(record.id);
      if (sprite) {
        this.sprites.set(record.id, sprite);
        spriteCount++;
      }
    }

    console.log(`[NPCManager] Loaded ${loadedCount} NPCs, ${spriteCount} sprites`);
  }

  /**
   * Create NPC state from database record
   */
  private createStateFromRecord(record: LoadedNPCRecord): NPCState {
    const config: NPCConfig = {
      ...DEFAULT_NPC_CONFIG,
      roamRadius: record.roamRadius,
      playerAffinity: record.playerAffinity,
    };

    const motorState = record.motorState;
    const targetX = this.isIntegerOrNull(motorState?.targetX) ? motorState!.targetX : null;
    const targetY = this.isIntegerOrNull(motorState?.targetY) ? motorState!.targetY : null;
    const state: NPCState = {
      npcId: record.id,
      name: record.name,
      x: record.persistedX ?? record.spawnX,
      y: record.persistedY ?? record.spawnY,
      direction: this.isDirection(record.persistedDirection) ? record.persistedDirection : 'down',
      animationFrame: this.isAnimationFrame(record.persistedAnimationFrame)
        ? record.persistedAnimationFrame
        : 0,
      isMoving: motorState?.isMoving === true || targetX !== null || targetY !== null,
      spawnX: record.spawnX,
      spawnY: record.spawnY,
      targetX,
      targetY,
      ticksUntilNextDecision: this.isPositiveInteger(motorState?.ticksUntilNextDecision)
        ? motorState!.ticksUntilNextDecision
        : 0,
      behaviorState: this.isBehaviorState(motorState?.behaviorState)
        ? motorState!.behaviorState
        : 'idle',
      rngState: this.normalizeRngState(motorState?.rngState, record.id),
      movementTicksRemaining: this.isNonNegativeInteger(motorState?.movementTicksRemaining)
        ? motorState!.movementTicksRemaining
        : 0,
      config,
      lifeState: record.lifeState ?? createInitialNPCLifeState({
        npcId: record.id,
        homeX: record.spawnX,
        homeY: record.spawnY,
        roamRadius: record.roamRadius,
        worldMinute: this.worldLifeState.worldMinute,
        worldSeed: this.worldSeed,
      }),
    };

    if (state.ticksUntilNextDecision <= 0) {
      state.ticksUntilNextDecision = this.tickRate;
    }

    return state;
  }

  /**
   * Create a new NPC and add it to the manager
   */
  async addNPC(data: NPCCreateData): Promise<NPCState> {
    // Save to database and disk
    const record = await createNPC(data);

    // Create state
    const state = this.createStateFromRecord({
      ...record,
      persistedX: record.spawnX,
      persistedY: record.spawnY,
      persistedDirection: 'down',
      persistedAnimationFrame: 0,
      motorState: null,
      lifeState: null,
    });
    this.npcs.set(record.id, state);
    this.markDirty(state.npcId);

    // Cache sprite
    this.sprites.set(record.id, data.sprite);

    console.log(`[NPCManager] Created NPC "${data.name}" at (${data.spawnX}, ${data.spawnY})`);

    // Notify callbacks
    const visualState = this.toVisualState(state);
    for (const callback of this.npcCreatedCallbacks) {
      callback(visualState);
    }

    return state;
  }

  /**
   * Get an NPC by ID
   */
  getNPC(npcId: string): NPCState | null {
    return this.npcs.get(npcId) ?? null;
  }

  /**
   * Get NPC sprite by ID
   */
  getNPCSprite(npcId: string): Sprite | null {
    return this.sprites.get(npcId) ?? null;
  }

  /**
   * Get all NPCs as visual states
   */
  getAllNPCs(): NPCVisualState[] {
    return Array.from(this.npcs.values()).map(npc => this.toVisualState(npc));
  }

  /**
   * Get NPCs visible within a viewport
   */
  getVisibleNPCs(
    centerX: number,
    centerY: number,
    width: number,
    height: number
  ): NPCVisualState[] {
    const viewportX = centerX - Math.floor(width / 2);
    const viewportY = centerY - Math.floor(height / 2);

    const result: NPCVisualState[] = [];

    for (const npc of this.npcs.values()) {
      // Check if NPC is in viewport (with some padding for sprites)
      if (
        npc.x >= viewportX - 2 &&
        npc.x < viewportX + width + 2 &&
        npc.y >= viewportY - 2 &&
        npc.y < viewportY + height + 2
      ) {
        result.push(this.toVisualState(npc));
      }
    }

    return result;
  }

  /**
   * Tick all NPCs - update AI and movement
   * @param playerPositions - Current positions of all players for AI calculations
   */
  tickAll(playerPositions: PlayerPosition[]): void {
    this.tickCounter++;

    if (this.tickCounter % this.tickRate === 0) {
      this.advanceLivingWorld(playerPositions);
    }

    for (const npc of this.npcs.values()) {
      this.tickNPC(npc);
    }

    // One atomic checkpoint per second at the production 15 Hz tick rate.
    if (
      this.tickCounter % this.tickRate === 0
      && (this.dirtyNPCIds.size > 0 || this.worldStateDirty || this.pendingLifeEvents.length > 0)
    ) {
      void this.flushRuntimeState().catch((error) => {
        console.error('[NPCManager] Failed to checkpoint runtime state:', error);
      });
    }
  }

  /**
   * Tick a single NPC
   */
  private tickNPC(npc: NPCState): void {
    // 1. Update animation if moving (cycle through frames)
    if (npc.isMoving) {
      npc.animationFrame = ((this.tickCounter % 4) as 0 | 1 | 2 | 3);
    }

    // 2. Decrement decision timer
    npc.ticksUntilNextDecision--;
    this.markDirty(npc.npcId);

    if (npc.targetX === null && npc.targetY === null && npc.movementTicksRemaining > 0) {
      npc.movementTicksRemaining--;
      if (npc.movementTicksRemaining === 0) {
        npc.isMoving = false;
        npc.animationFrame = 0;
      }
    }

    // 3. If we have a target, try to move toward it
    // Only move every 4 ticks (5 moves/second at 20 TPS) to avoid too-fast movement
    if (npc.targetX !== null && npc.targetY !== null && this.tickCounter % 4 === 0) {
      const moved = this.moveTowardTarget(npc);
      this.markDirty(npc.npcId);

      // Check if we reached the target
      if (!moved || (npc.x === npc.targetX && npc.y === npc.targetY)) {
        npc.targetX = null;
        npc.targetY = null;
        npc.isMoving = false;
        npc.animationFrame = 0;
        npc.movementTicksRemaining = 0;
        npc.behaviorState = 'idle';
      }
    }

    // 4. Make a new decision if timer expired
    if (npc.ticksUntilNextDecision <= 0) {
      this.applyLifeIntent(npc);
      npc.ticksUntilNextDecision = this.tickRate;
      this.markDirty(npc.npcId);
    }
  }

  private advanceLivingWorld(playerPositions: PlayerPosition[]): void {
    const worldResult = advanceWorldLifeMinute(this.worldLifeState);
    this.worldLifeState = worldResult.state;
    this.worldStateDirty = true;
    this.pendingLifeEvents.push(...worldResult.events);

    const people: LifePosition[] = [
      ...Array.from(this.npcs.values(), (npc): LifePosition => ({
        id: npc.npcId,
        x: npc.x,
        y: npc.y,
        kind: 'npc',
      })),
      ...playerPositions.map((player): LifePosition => ({
        id: player.userId,
        x: player.x,
        y: player.y,
        kind: 'player',
      })),
    ];

    for (const npc of this.npcs.values()) {
      const perceivedPeople = people.map((person): LifePosition => ({
        ...person,
        familiarity: this.relationshipFamiliarity.get(
          this.relationshipKey(npc.npcId, person.id),
        ) ?? 0,
        disposition: person.kind === 'player'
          ? Math.max(-1, Math.min(1, (npc.config.playerAffinity - 50) / 50))
          : 0,
      }));
      const result = advanceNPCLifeMinute(
        npc.lifeState,
        this.worldLifeState,
        {
          id: npc.npcId,
          x: npc.x,
          y: npc.y,
          kind: 'npc',
          detectionRadius: npc.config.detectionRadius,
        },
        perceivedPeople,
      );
      npc.lifeState = result.state;
      this.pendingLifeEvents.push(...result.events);
      for (const event of result.events) {
        if (event.eventType !== 'social_encounter' || !event.npcId || !event.targetId) continue;
        const key = this.relationshipKey(event.npcId, event.targetId);
        this.relationshipFamiliarity.set(
          key,
          Math.min(1, (this.relationshipFamiliarity.get(key) ?? 0) + 0.04),
        );
      }
      this.applyLifeIntent(npc);
      npc.ticksUntilNextDecision = this.tickRate;
      this.markDirty(npc.npcId);
    }
  }

  private applyLifeIntent(npc: NPCState): void {
    const desired = this.findWalkableLifeDestination(
      npc,
      npc.lifeState.destinationX,
      npc.lifeState.destinationY,
    );
    if (!desired || (desired.x === npc.x && desired.y === npc.y)) {
      npc.targetX = null;
      npc.targetY = null;
      npc.isMoving = false;
      npc.animationFrame = 0;
      npc.behaviorState = 'idle';
      return;
    }
    npc.behaviorState = 'wandering';
    npc.targetX = desired.x;
    npc.targetY = desired.y;
    npc.isMoving = true;
  }

  private findWalkableLifeDestination(
    npc: NPCState,
    requestedX: number,
    requestedY: number,
  ): { x: number; y: number } | null {
    const dx = requestedX - npc.spawnX;
    const dy = requestedY - npc.spawnY;
    const distance = Math.hypot(dx, dy);
    const scale = distance > npc.config.roamRadius ? npc.config.roamRadius / distance : 1;
    const centerX = npc.spawnX + Math.round(dx * scale);
    const centerY = npc.spawnY + Math.round(dy * scale);
    if (!this.isBlocked(centerX, centerY)) return { x: centerX, y: centerY };

    const phase = stableLifeHash(npc.npcId, centerX, centerY, 'walkable-target') % 8;
    const directions = [
      { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 },
      { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
    ];
    for (let radius = 1; radius <= 4; radius++) {
      for (let index = 0; index < directions.length; index++) {
        const direction = directions[(index + phase) % directions.length]!;
        const candidateX = centerX + direction.x * radius;
        const candidateY = centerY + direction.y * radius;
        if (
          Math.hypot(candidateX - npc.spawnX, candidateY - npc.spawnY) <= npc.config.roamRadius
          && !this.isBlocked(candidateX, candidateY)
        ) {
          return { x: candidateX, y: candidateY };
        }
      }
    }
    return null;
  }

  /**
   * Move NPC one step toward target
   * Returns true if moved, false if blocked
   */
  private moveTowardTarget(npc: NPCState): boolean {
    if (npc.targetX === null || npc.targetY === null) {
      return false;
    }

    const dx = npc.targetX - npc.x;
    const dy = npc.targetY - npc.y;

    if (dx === 0 && dy === 0) {
      return false; // Already at target
    }

    // Determine move direction (prioritize larger axis)
    let moveX = 0;
    let moveY = 0;

    if (Math.abs(dx) > Math.abs(dy)) {
      moveX = Math.sign(dx);
    } else if (dy !== 0) {
      moveY = Math.sign(dy);
    } else {
      moveX = Math.sign(dx);
    }

    // Update direction based on movement
    npc.direction = this.getDirection(moveX, moveY);

    // Check collision
    const newX = npc.x + moveX;
    const newY = npc.y + moveY;

    if (this.isBlocked(newX, newY)) {
      // Try alternate direction
      if (moveX !== 0 && dy !== 0) {
        // Was moving horizontally, try vertical
        moveX = 0;
        moveY = Math.sign(dy);
        npc.direction = this.getDirection(moveX, moveY);
        if (!this.isBlocked(npc.x, npc.y + moveY)) {
          npc.y += moveY;
          return true;
        }
      } else if (moveY !== 0 && dx !== 0) {
        // Was moving vertically, try horizontal
        moveY = 0;
        moveX = Math.sign(dx);
        npc.direction = this.getDirection(moveX, moveY);
        if (!this.isBlocked(npc.x + moveX, npc.y)) {
          npc.x += moveX;
          return true;
        }
      }

      // Completely blocked - cancel target
      return false;
    }

    // Move
    npc.x = newX;
    npc.y = newY;
    npc.isMoving = true;

    return true;
  }

  /**
   * Check if a position is blocked
   */
  private isBlocked(x: number, y: number): boolean {
    if (!this.collisionChecker) {
      return false;
    }
    return this.collisionChecker(x, y);
  }

  /**
   * Get direction from movement delta
   */
  private getDirection(dx: number, dy: number): Direction {
    if (dy < 0) return 'up';
    if (dy > 0) return 'down';
    if (dx < 0) return 'left';
    if (dx > 0) return 'right';
    return 'down';
  }

  /** Move the one canonical NPC body in response to a cognitive action. */
  moveNPC(npcId: string, direction: Direction): NPCVisualState | null {
    const npc = this.npcs.get(npcId);
    if (!npc) return null;

    const delta = this.directionDelta(direction);
    const newX = npc.x + delta.x;
    const newY = npc.y + delta.y;
    const dx = newX - npc.spawnX;
    const dy = newY - npc.spawnY;
    const withinRoamRadius = Math.sqrt(dx * dx + dy * dy) <= npc.config.roamRadius;

    npc.direction = direction;
    npc.targetX = null;
    npc.targetY = null;
    npc.behaviorState = 'idle';

    if (withinRoamRadius && !this.isBlocked(newX, newY)) {
      npc.x = newX;
      npc.y = newY;
      npc.isMoving = true;
      npc.movementTicksRemaining = 3;
    } else {
      npc.isMoving = false;
      npc.animationFrame = 0;
      npc.movementTicksRemaining = 0;
    }

    this.markDirty(npcId);
    return this.toVisualState(npc);
  }

  /** Flush the latest body and motor snapshots before a reload or shutdown. */
  async flushRuntimeState(): Promise<void> {
    if (this.persistencePromise) {
      await this.persistencePromise;
      if (
        this.dirtyNPCIds.size > 0
        || this.worldStateDirty
        || this.pendingLifeEvents.length > 0
      ) {
        await this.flushRuntimeState();
      }
      return;
    }

    const ids = Array.from(this.dirtyNPCIds);
    if (ids.length === 0 && !this.worldStateDirty && this.pendingLifeEvents.length === 0) return;
    this.dirtyNPCIds.clear();
    const worldState = this.worldStateDirty ? { ...this.worldLifeState } : undefined;
    this.worldStateDirty = false;
    const lifeEvents = this.pendingLifeEvents;
    this.pendingLifeEvents = [];

    const snapshots = ids
      .map((id): NPCRuntimeSnapshot | null => {
        const npc = this.npcs.get(id);
        if (!npc) return null;
        return {
          npcId: npc.npcId,
          x: npc.x,
          y: npc.y,
          direction: npc.direction,
          animationFrame: npc.animationFrame,
          motorState: {
            targetX: npc.targetX,
            targetY: npc.targetY,
            ticksUntilNextDecision: npc.ticksUntilNextDecision,
            behaviorState: npc.behaviorState,
            rngState: npc.rngState,
            isMoving: npc.isMoving,
            movementTicksRemaining: npc.movementTicksRemaining,
          },
          lifeState: npc.lifeState,
        };
      })
      .filter((snapshot): snapshot is NPCRuntimeSnapshot => snapshot !== null);

    this.persistencePromise = persistNPCRuntimeStates(snapshots, worldState, lifeEvents);
    try {
      await this.persistencePromise;
    } catch (error) {
      for (const id of ids) this.dirtyNPCIds.add(id);
      if (worldState) this.worldStateDirty = true;
      this.pendingLifeEvents = [...lifeEvents, ...this.pendingLifeEvents];
      throw error;
    } finally {
      this.persistencePromise = null;
    }
  }

  private markDirty(npcId: string): void {
    this.dirtyNPCIds.add(npcId);
  }

  private relationshipKey(npcId: string, targetId: string): string {
    return `${npcId}\u001f${targetId}`;
  }

  private normalizeRngState(value: unknown, npcId: string): number {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0xffffffff) {
      return value >>> 0;
    }

    let hash = 2166136261;
    for (let i = 0; i < npcId.length; i++) {
      hash ^= npcId.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) || 0x6d2b79f5;
  }

  private directionDelta(direction: Direction): { x: number; y: number } {
    switch (direction) {
      case 'up': return { x: 0, y: -1 };
      case 'down': return { x: 0, y: 1 };
      case 'left': return { x: -1, y: 0 };
      case 'right': return { x: 1, y: 0 };
    }
  }

  private isDirection(value: unknown): value is Direction {
    return value === 'up' || value === 'down' || value === 'left' || value === 'right';
  }

  private isBehaviorState(value: unknown): value is NPCBehaviorState {
    return value === 'idle'
      || value === 'wandering'
      || value === 'following_player'
      || value === 'fleeing';
  }

  private isIntegerOrNull(value: unknown): value is number | null {
    return value === null || Number.isInteger(value);
  }

  private isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
  }

  private isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
  }

  private isAnimationFrame(value: unknown): value is 0 | 1 | 2 | 3 {
    return value === 0 || value === 1 || value === 2 || value === 3;
  }

  /**
   * Convert full state to visual state for broadcasting
   */
  private toVisualState(npc: NPCState): NPCVisualState {
    return {
      npcId: npc.npcId,
      name: npc.name,
      x: npc.x,
      y: npc.y,
      direction: npc.direction,
      animationFrame: npc.animationFrame,
      isMoving: npc.isMoving,
      role: npc.lifeState.role,
      activity: npc.lifeState.currentActivity,
      primaryNeed: primaryNPCNeed(npc.lifeState.needs),
    };
  }

  getWorldLifeState(): WorldLifeState {
    return { ...this.worldLifeState };
  }

  /**
   * Get NPC count
   */
  getCount(): number {
    return this.npcs.size;
  }

  /**
   * Remove an NPC by ID
   */
  removeNPC(npcId: string): void {
    this.npcs.delete(npcId);
    this.sprites.delete(npcId);
  }

  /**
   * Clear all NPCs
   */
  clear(): void {
    this.npcs.clear();
    this.sprites.clear();
  }
}
