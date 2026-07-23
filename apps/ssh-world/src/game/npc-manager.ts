import type {
  Sprite,
  NPCState,
  NPCVisualState,
  NPCConfig,
  Direction,
  NPCBehaviorState,
} from '@maldoror/protocol';
import { DEFAULT_NPC_CONFIG } from '@maldoror/protocol';
import {
  loadAllNPCs,
  loadNPCSpriteFromDisk,
  createNPC,
  persistNPCRuntimeStates,
  type LoadedNPCRecord,
  type NPCCreateData,
  type NPCRuntimeSnapshot,
} from '../utils/npc-storage.js';

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
    const records = await loadAllNPCs();
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
    };

    if (state.ticksUntilNextDecision <= 0) {
      state.ticksUntilNextDecision = this.randomDecisionTicks(state);
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

    for (const npc of this.npcs.values()) {
      this.tickNPC(npc, playerPositions);
    }

    // One atomic checkpoint per second at the production 15 Hz tick rate.
    if (this.tickCounter % 15 === 0 && this.dirtyNPCIds.size > 0) {
      void this.flushRuntimeState().catch((error) => {
        console.error('[NPCManager] Failed to checkpoint runtime state:', error);
      });
    }
  }

  /**
   * Tick a single NPC
   */
  private tickNPC(npc: NPCState, playerPositions: PlayerPosition[]): void {
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
      this.makeDecision(npc, playerPositions);
      npc.ticksUntilNextDecision = this.randomDecisionTicks(npc);
      this.markDirty(npc.npcId);
    }
  }

  /**
   * Make an AI decision for an NPC
   */
  private makeDecision(npc: NPCState, playerPositions: PlayerPosition[]): void {
    // Find nearest player within detection radius
    const nearestPlayer = this.findNearestPlayer(npc, playerPositions);

    // Decide behavior based on player proximity and affinity
    if (nearestPlayer) {
      const { player } = nearestPlayer;

      if (npc.config.playerAffinity > 60) {
        // Follow player
        npc.behaviorState = 'following_player';
        this.setTargetNear(npc, player.x, player.y, 2, 4);
      } else if (npc.config.playerAffinity < 40) {
        // Flee from player
        npc.behaviorState = 'fleeing';
        const dx = npc.x - player.x;
        const dy = npc.y - player.y;
        const fleeDistance = 8;
        const targetX = npc.x + Math.sign(dx) * fleeDistance;
        const targetY = npc.y + Math.sign(dy) * fleeDistance;
        this.setTargetWithinBounds(npc, targetX, targetY);
      } else {
        // Neutral - wander or idle
        this.wanderOrIdle(npc);
      }
    } else {
      // No player nearby - wander or idle
      this.wanderOrIdle(npc);
    }
  }

  /**
   * Find the nearest player within detection radius
   */
  private findNearestPlayer(
    npc: NPCState,
    playerPositions: PlayerPosition[]
  ): { player: PlayerPosition; distance: number } | null {
    let nearest: { player: PlayerPosition; distance: number } | null = null;

    for (const player of playerPositions) {
      const dx = player.x - npc.x;
      const dy = player.y - npc.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= npc.config.detectionRadius) {
        if (!nearest || distance < nearest.distance) {
          nearest = { player, distance };
        }
      }
    }

    return nearest;
  }

  /**
   * Wander randomly or stay idle
   */
  private wanderOrIdle(npc: NPCState): void {
    // 30% chance to idle
    if (this.nextRandom(npc) < npc.config.idleChance) {
      npc.behaviorState = 'idle';
      npc.targetX = null;
      npc.targetY = null;
      npc.isMoving = false;
      npc.animationFrame = 0;
      return;
    }

    // Wander to a random point within roam radius
    npc.behaviorState = 'wandering';
    const angle = this.nextRandom(npc) * Math.PI * 2;
    const distance = 3 + this.nextRandom(npc) * 5; // 3-8 tiles
    const targetX = npc.x + Math.round(Math.cos(angle) * distance);
    const targetY = npc.y + Math.round(Math.sin(angle) * distance);

    this.setTargetWithinBounds(npc, targetX, targetY);
  }

  /**
   * Set target position ensuring it's within roam radius of spawn
   */
  private setTargetWithinBounds(npc: NPCState, targetX: number, targetY: number): void {
    const radius = npc.config.roamRadius;

    // Clamp to roam radius
    const dx = targetX - npc.spawnX;
    const dy = targetY - npc.spawnY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > radius) {
      // Scale back to radius
      const scale = radius / dist;
      targetX = npc.spawnX + Math.round(dx * scale);
      targetY = npc.spawnY + Math.round(dy * scale);
    }

    npc.targetX = targetX;
    npc.targetY = targetY;
    npc.isMoving = true;
  }

  /**
   * Set target near a position with some random offset
   */
  private setTargetNear(npc: NPCState, x: number, y: number, minDist: number, maxDist: number): void {
    const angle = this.nextRandom(npc) * Math.PI * 2;
    const distance = minDist + this.nextRandom(npc) * (maxDist - minDist);
    const targetX = x + Math.round(Math.cos(angle) * distance);
    const targetY = y + Math.round(Math.sin(angle) * distance);

    this.setTargetWithinBounds(npc, targetX, targetY);
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

  /**
   * Generate random ticks until next decision (1 minute at 20 TPS)
   */
  private randomDecisionTicks(npc: NPCState): number {
    return 900 + Math.floor(this.nextRandom(npc) * 150); // ~60-70 seconds at 15 TPS
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
      if (this.dirtyNPCIds.size > 0) await this.flushRuntimeState();
      return;
    }

    const ids = Array.from(this.dirtyNPCIds);
    if (ids.length === 0) return;
    this.dirtyNPCIds.clear();

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
        };
      })
      .filter((snapshot): snapshot is NPCRuntimeSnapshot => snapshot !== null);

    this.persistencePromise = persistNPCRuntimeStates(snapshots);
    try {
      await this.persistencePromise;
    } catch (error) {
      for (const id of ids) this.dirtyNPCIds.add(id);
      throw error;
    } finally {
      this.persistencePromise = null;
    }
  }

  private markDirty(npcId: string): void {
    this.dirtyNPCIds.add(npcId);
  }

  private nextRandom(npc: NPCState): number {
    let state = npc.rngState >>> 0;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    npc.rngState = (state >>> 0) || 0x6d2b79f5;
    return npc.rngState / 0x100000000;
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
    };
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
