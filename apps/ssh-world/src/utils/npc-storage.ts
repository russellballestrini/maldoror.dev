import * as fs from 'fs';
import type {
  Sprite,
  PixelGrid,
  DirectionFrames,
  Direction,
  NPCMotorState,
  NPCLifeEvent,
  NPCLifeState,
  WorldLifeState,
} from '@maldoror/protocol';
import { RESOLUTIONS } from '@maldoror/protocol';
import type { NPCRecord } from '@maldoror/protocol';
import { db, schema } from '@maldoror/db';
import { eq, sql } from 'drizzle-orm';
import {
  ensureNPCDir,
  getNPCPngPath,
  savePixelGridAsPng,
  loadPngAsPixelGrid,
  deleteNPCPngs,
} from './png-storage.js';
import { despeckleSpriteFrame } from './sprite-hygiene.js';

const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

/**
 * NPC data with sprite for creation
 */
export interface NPCCreateData {
  creatorId: string;
  name: string;
  prompt: string;
  spawnX: number;
  spawnY: number;
  roamRadius?: number;
  playerAffinity?: number;
  sprite: Sprite;
}

function buildInitialPersonality(name: string, visualPrompt: string): string {
  return [
    `You are ${name}, a persistent inhabitant of Maldoror.`,
    `Your visible form was described as: ${visualPrompt}`,
    'Develop a coherent disposition through lived events, memories, needs, and relationships.',
    'Act with continuity: remember prior encounters, pursue your own goals, and respond to the place around you.',
  ].join(' ');
}

/**
 * Create a new NPC and save its sprite to disk
 * Creates a legacy asset/provenance row and one canonical NPC user identity.
 * Both rows deliberately share the same UUID.
 * Returns the created NPC record
 */
export async function createNPC(data: NPCCreateData): Promise<NPCRecord> {
  const npcRecord = await db.transaction(async (tx) => {
    const [record] = await tx.insert(schema.npcs).values({
      creatorId: data.creatorId,
      name: data.name,
      prompt: data.prompt,
      spawnX: data.spawnX,
      spawnY: data.spawnY,
      roamRadius: data.roamRadius ?? 15,
      playerAffinity: data.playerAffinity ?? 50,
      modelUsed: 'gpt-image-1-mini',
    }).returning();

    if (!record) {
      throw new Error('Failed to create NPC record');
    }

    const existingUser = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, data.name))
      .limit(1);

    const suffix = `-${record.id.slice(0, 7)}`;
    const username = existingUser.length > 0
      ? `${data.name.slice(0, 32 - suffix.length)}${suffix}`
      : data.name.slice(0, 32);

    await tx.insert(schema.users).values({
      id: record.id,
      username,
      isNpc: true,
      personality: buildInitialPersonality(data.name, data.prompt),
      goals: [
        'Develop a life shaped by memories and relationships',
        'Participate in the surrounding place and its changing events',
      ],
      visualPrompt: data.prompt,
      aiProvider: 'openai',
      aiModel: 'gpt-4o-mini',
      decisionIntervalMs: 300000, // 5 minutes
      spawnX: data.spawnX,
      spawnY: data.spawnY,
      roamRadius: data.roamRadius ?? 15,
      npcCreatorId: data.creatorId,
    });

    await tx.insert(schema.playerState).values({
      userId: record.id,
      x: data.spawnX,
      y: data.spawnY,
      direction: 'down',
      isOnline: false,
    });

    console.log(`[NPC] Created canonical NPC user "${username}"`);
    return record;
  });

  // Save sprite to disk
  await saveNPCSpriteToDisk(npcRecord.id, data.sprite);

  console.log(`[NPC] Created NPC "${data.name}" at (${data.spawnX}, ${data.spawnY})`);

  return npcRecord as NPCRecord;
}

/**
 * Save an NPC sprite to disk as individual PNG files per frame/resolution
 */
export async function saveNPCSpriteToDisk(npcId: string, sprite: Sprite): Promise<void> {
  ensureNPCDir(npcId);

  let totalFiles = 0;
  let totalSize = 0;

  // For each direction and frame
  for (const direction of DIRECTIONS) {
    for (let frameNum = 0; frameNum < 4; frameNum++) {
      // Save each resolution as a separate PNG
      for (const resolution of RESOLUTIONS) {
        // Get pixels from the appropriate resolution
        let pixels: PixelGrid | undefined;
        const resKey = String(resolution);

        if (sprite.resolutions?.[resKey]) {
          const dirFrames = sprite.resolutions[resKey][direction];
          pixels = dirFrames?.[frameNum];
        } else if (resolution === 256) {
          // Fall back to base frames for resolution 256
          pixels = sprite.frames[direction]?.[frameNum];
        }

        if (!pixels) continue;

        const filePath = getNPCPngPath(npcId, direction, frameNum, resolution);
        await savePixelGridAsPng(pixels, filePath);

        totalFiles++;
        try {
          const stat = await fs.promises.stat(filePath);
          totalSize += stat.size;
        } catch {
          // Ignore stat errors
        }
      }
    }
  }

  console.log(`[NPC] Saved sprite for ${npcId}: ${totalFiles} PNGs (${(totalSize / 1024).toFixed(1)}KB total)`);
}

/**
 * Load a single NPC sprite frame at a specific resolution
 */
export async function loadNPCFrame(
  npcId: string,
  direction: string,
  frameNum: number,
  resolution: number
): Promise<PixelGrid | null> {
  const filePath = getNPCPngPath(npcId, direction, frameNum, resolution);

  try {
    return await loadPngAsPixelGrid(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    console.error(`[NPC] Failed to load frame ${direction}_${frameNum}@${resolution} for ${npcId}:`, error);
    return null;
  }
}

/**
 * Load a full NPC sprite from disk
 * Only loads base resolution (256) - renderer handles scaling
 */
export async function loadNPCSpriteFromDisk(npcId: string): Promise<Sprite | null> {
  const configured = Number.parseInt(process.env.MALDOROR_RUNTIME_SPRITE_RESOLUTION ?? '128', 10);
  const target = Number.isFinite(configured) ? Math.max(26, Math.min(256, configured)) : 128;
  const candidates = [...RESOLUTIONS].sort((a, b) =>
    Math.abs(a - target) - Math.abs(b - target) || a - b
  );
  let runtimeResolution: number | null = null;
  let testFrame: PixelGrid | null = null;
  for (const resolution of candidates) {
    testFrame = await loadNPCFrame(npcId, 'down', 0, resolution);
    if (testFrame) {
      runtimeResolution = resolution;
      break;
    }
  }
  if (!testFrame) {
    return null;
  }

  const width = testFrame[0]?.length ?? runtimeResolution ?? target;
  const height = testFrame.length;

  // Initialize the sprite structure
  const sprite: Sprite = {
    width,
    height,
    frames: {
      up: [[], [], [], []] as unknown as DirectionFrames,
      down: [[], [], [], []] as unknown as DirectionFrames,
      left: [[], [], [], []] as unknown as DirectionFrames,
      right: [[], [], [], []] as unknown as DirectionFrames,
    },
    resolutions: {},
  };

  // Load one deploy-time-selected resolution; full-quality files stay on disk.
  for (const direction of DIRECTIONS) {
    for (let frameNum = 0; frameNum < 4; frameNum++) {
      const pixels = await loadNPCFrame(npcId, direction, frameNum, runtimeResolution!);
      if (pixels) {
        // Strip baked-in dark alpha fringe (see sprite-hygiene.ts)
        sprite.frames[direction][frameNum] = despeckleSpriteFrame(pixels);
      }
    }
  }

  return sprite;
}

/**
 * Load all NPCs from database
 */
export async function loadAllNPCs(): Promise<LoadedNPCRecord[]> {
  const records = await db
    .select({
      id: schema.npcs.id,
      creatorId: schema.npcs.creatorId,
      name: schema.npcs.name,
      prompt: schema.npcs.prompt,
      spawnX: schema.npcs.spawnX,
      spawnY: schema.npcs.spawnY,
      roamRadius: schema.npcs.roamRadius,
      playerAffinity: schema.npcs.playerAffinity,
      modelUsed: schema.npcs.modelUsed,
      createdAt: schema.npcs.createdAt,
      persistedX: schema.playerState.x,
      persistedY: schema.playerState.y,
      persistedDirection: schema.playerState.direction,
      persistedAnimationFrame: schema.playerState.animationFrame,
      motorState: schema.playerState.npcMotorState,
      lifeNpcId: schema.npcLifeState.npcId,
      lifeHomeX: schema.npcLifeState.homeX,
      lifeHomeY: schema.npcLifeState.homeY,
      lifeRole: schema.npcLifeState.role,
      lifeSchedule: schema.npcLifeState.schedule,
      lifeNeeds: schema.npcLifeState.needs,
      lifeCurrentActivity: schema.npcLifeState.currentActivity,
      lifeActivityStartedWorldMinute: schema.npcLifeState.activityStartedWorldMinute,
      lifeDestinationX: schema.npcLifeState.destinationX,
      lifeDestinationY: schema.npcLifeState.destinationY,
      lifeLastWorldMinute: schema.npcLifeState.lastWorldMinute,
      lifeLastEncounterWorldMinute: schema.npcLifeState.lastEncounterWorldMinute,
      lifeLastSocialTargetId: schema.npcLifeState.lastSocialTargetId,
      lifeStateVersion: schema.npcLifeState.stateVersion,
    })
    .from(schema.npcs)
    .leftJoin(schema.playerState, eq(schema.playerState.userId, schema.npcs.id))
    .leftJoin(schema.npcLifeState, eq(schema.npcLifeState.npcId, schema.npcs.id));
  console.log(`[NPC] Loaded ${records.length} NPCs from database`);
  return records.map((record): LoadedNPCRecord => ({
    id: record.id,
    creatorId: record.creatorId,
    name: record.name,
    prompt: record.prompt,
    spawnX: record.spawnX,
    spawnY: record.spawnY,
    roamRadius: record.roamRadius,
    playerAffinity: record.playerAffinity,
    modelUsed: record.modelUsed,
    createdAt: record.createdAt,
    persistedX: record.persistedX,
    persistedY: record.persistedY,
    persistedDirection: record.persistedDirection,
    persistedAnimationFrame: record.persistedAnimationFrame,
    motorState: record.motorState,
    lifeState: record.lifeNpcId === null ? null : {
      npcId: record.lifeNpcId,
      homeX: record.lifeHomeX!,
      homeY: record.lifeHomeY!,
      role: record.lifeRole!,
      schedule: record.lifeSchedule!,
      needs: record.lifeNeeds!,
      currentActivity: record.lifeCurrentActivity!,
      activityStartedWorldMinute: record.lifeActivityStartedWorldMinute!,
      destinationX: record.lifeDestinationX!,
      destinationY: record.lifeDestinationY!,
      lastWorldMinute: record.lifeLastWorldMinute!,
      lastEncounterWorldMinute: record.lifeLastEncounterWorldMinute,
      lastSocialTargetId: record.lifeLastSocialTargetId,
      stateVersion: record.lifeStateVersion!,
    },
  }));
}

export async function loadWorldLifeState(worldId = 'primary'): Promise<WorldLifeState | null> {
  const [record] = await db
    .select()
    .from(schema.worldLifeState)
    .where(eq(schema.worldLifeState.worldId, worldId))
    .limit(1);
  if (!record) return null;
  return {
    worldId: record.worldId,
    worldSeed: record.worldSeed,
    worldMinute: record.worldMinute,
    weather: record.weather,
    weatherIntensity: record.weatherIntensity,
    weatherUntilWorldMinute: record.weatherUntilWorldMinute,
    season: record.season,
    rngState: record.rngState,
    surfaceWetness: record.surfaceWetness,
    waterTurbulence: record.waterTurbulence,
    vegetationVitality: record.vegetationVitality,
    decayPressure: record.decayPressure,
  };
}

export interface NPCRelationshipFamiliarity {
  npcId: string;
  targetId: string;
  familiarity: number;
}

export async function loadNPCRelationshipFamiliarities(): Promise<NPCRelationshipFamiliarity[]> {
  const records = await db.select({
    npcId: schema.npcRelationships.npcId,
    targetId: schema.npcRelationships.targetId,
    familiarity: schema.npcRelationships.familiarity,
  }).from(schema.npcRelationships);
  return records.map((record) => ({
    npcId: record.npcId,
    targetId: record.targetId,
    familiarity: record.familiarity ?? 0,
  }));
}

export interface LoadedNPCRecord extends NPCRecord {
  persistedX: number | null;
  persistedY: number | null;
  persistedDirection: string | null;
  persistedAnimationFrame: number | null;
  motorState: NPCMotorState | null;
  lifeState: NPCLifeState | null;
}

export interface NPCRuntimeSnapshot {
  npcId: string;
  x: number;
  y: number;
  direction: Direction;
  animationFrame: number;
  motorState: NPCMotorState;
  lifeState?: NPCLifeState;
}

/** Persist a batch atomically so spatial and motor state never disagree. */
export async function persistNPCRuntimeStates(
  snapshots: NPCRuntimeSnapshot[],
  worldState?: WorldLifeState,
  events: NPCLifeEvent[] = [],
): Promise<void> {
  if (snapshots.length === 0 && !worldState && events.length === 0) return;

  await db.transaction(async (tx) => {
    for (const snapshot of snapshots) {
      const updated = await tx
        .update(schema.playerState)
        .set({
          x: snapshot.x,
          y: snapshot.y,
          direction: snapshot.direction,
          animationFrame: snapshot.animationFrame,
          npcMotorState: snapshot.motorState,
          updatedAt: new Date(),
        })
        .where(eq(schema.playerState.userId, snapshot.npcId))
        .returning({ userId: schema.playerState.userId });

      if (updated.length !== 1) {
        throw new Error(`Missing canonical player_state for NPC ${snapshot.npcId}`);
      }

      if (snapshot.lifeState) {
        const life = snapshot.lifeState;
        await tx.insert(schema.npcLifeState).values({
          npcId: snapshot.npcId,
          homeX: life.homeX,
          homeY: life.homeY,
          role: life.role,
          schedule: life.schedule,
          needs: life.needs,
          currentActivity: life.currentActivity,
          activityStartedWorldMinute: life.activityStartedWorldMinute,
          destinationX: life.destinationX,
          destinationY: life.destinationY,
          lastWorldMinute: life.lastWorldMinute,
          lastEncounterWorldMinute: life.lastEncounterWorldMinute,
          lastSocialTargetId: life.lastSocialTargetId,
          stateVersion: life.stateVersion,
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: schema.npcLifeState.npcId,
          set: {
            homeX: life.homeX,
            homeY: life.homeY,
            role: life.role,
            schedule: life.schedule,
            needs: life.needs,
            currentActivity: life.currentActivity,
            activityStartedWorldMinute: life.activityStartedWorldMinute,
            destinationX: life.destinationX,
            destinationY: life.destinationY,
            lastWorldMinute: life.lastWorldMinute,
            lastEncounterWorldMinute: life.lastEncounterWorldMinute,
            lastSocialTargetId: life.lastSocialTargetId,
            stateVersion: life.stateVersion,
            updatedAt: new Date(),
          },
        });
      }
    }

    if (worldState) {
      await tx.insert(schema.worldLifeState).values({
        worldId: worldState.worldId,
        worldSeed: worldState.worldSeed,
        worldMinute: worldState.worldMinute,
        weather: worldState.weather,
        weatherIntensity: worldState.weatherIntensity,
        weatherUntilWorldMinute: worldState.weatherUntilWorldMinute,
        season: worldState.season,
        rngState: worldState.rngState,
        surfaceWetness: worldState.surfaceWetness,
        waterTurbulence: worldState.waterTurbulence,
        vegetationVitality: worldState.vegetationVitality,
        decayPressure: worldState.decayPressure,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: schema.worldLifeState.worldId,
        set: {
          worldSeed: worldState.worldSeed,
          worldMinute: worldState.worldMinute,
          weather: worldState.weather,
          weatherIntensity: worldState.weatherIntensity,
          weatherUntilWorldMinute: worldState.weatherUntilWorldMinute,
          season: worldState.season,
          rngState: worldState.rngState,
          surfaceWetness: worldState.surfaceWetness,
          waterTurbulence: worldState.waterTurbulence,
          vegetationVitality: worldState.vegetationVitality,
          decayPressure: worldState.decayPressure,
          updatedAt: new Date(),
        },
      });
    }

    for (const event of events) {
      const inserted = await tx.insert(schema.npcLifeEvents).values({
        dedupeKey: event.dedupeKey,
        eventType: event.eventType,
        worldMinute: event.worldMinute,
        npcId: event.npcId,
        targetId: event.targetId,
        x: event.x,
        y: event.y,
        cause: event.cause,
        consequence: event.consequence,
      }).onConflictDoNothing({
        target: schema.npcLifeEvents.dedupeKey,
      }).returning({ id: schema.npcLifeEvents.id });

      if (
        inserted.length === 1
        && event.eventType === 'social_encounter'
        && event.npcId
        && event.targetId
        && event.npcId !== event.targetId
      ) {
        await tx.insert(schema.npcMemories).values({
          npcId: event.npcId,
          memoryType: 'observation',
          summary: `Spent time with ${event.targetId} while socializing`,
          details: `Observed encounter ${event.dedupeKey} at world minute ${event.worldMinute}.`,
          location: event.x === null || event.y === null ? undefined : { x: event.x, y: event.y },
          participants: [event.targetId],
          emotionalValence: 0.25,
          emotionalIntensity: 0.35,
          primaryEmotion: 'belonging',
          importance: 0.42,
          tags: ['social-encounter', `world-minute:${event.worldMinute}`],
        });

        await tx.insert(schema.npcRelationships).values({
          npcId: event.npcId,
          targetId: event.targetId,
          familiarity: 0.04,
          affection: 0.01,
          trust: 0,
          respect: 0,
          attraction: 0,
          rivalry: 0,
          relationshipType: 'acquaintance',
          interactionCount: 1,
          lastInteractionAt: new Date(),
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: [schema.npcRelationships.npcId, schema.npcRelationships.targetId],
          set: {
            familiarity: sql`LEAST(1.0, COALESCE(${schema.npcRelationships.familiarity}, 0) + 0.04)`,
            affection: sql`LEAST(1.0, COALESCE(${schema.npcRelationships.affection}, 0) + 0.01)`,
            interactionCount: sql`COALESCE(${schema.npcRelationships.interactionCount}, 0) + 1`,
            lastInteractionAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
    }
  });
}

/**
 * Get an NPC by ID
 */
export async function getNPC(npcId: string): Promise<NPCRecord | null> {
  const [record] = await db.select().from(schema.npcs).where(eq(schema.npcs.id, npcId));
  return (record as NPCRecord) || null;
}

/**
 * Delete an NPC and its sprite files
 */
export async function deleteNPC(npcId: string): Promise<void> {
  // Delete PNG files
  await deleteNPCPngs(npcId);

  // Delete database record
  await db.delete(schema.npcs).where(eq(schema.npcs.id, npcId));

  console.log(`[NPC] Deleted NPC ${npcId}`);
}

/**
 * Check if an NPC sprite exists on disk
 */
export async function npcSpriteExists(npcId: string): Promise<boolean> {
  const frame = await loadNPCFrame(npcId, 'down', 0, 256);
  return frame !== null;
}
