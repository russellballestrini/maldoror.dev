import * as fs from 'fs';
import type {
  Sprite,
  PixelGrid,
  DirectionFrames,
  Direction,
  NPCMotorState,
} from '@maldoror/protocol';
import { RESOLUTIONS } from '@maldoror/protocol';
import type { NPCRecord } from '@maldoror/protocol';
import { db, schema } from '@maldoror/db';
import { eq } from 'drizzle-orm';
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
    })
    .from(schema.npcs)
    .leftJoin(schema.playerState, eq(schema.playerState.userId, schema.npcs.id));
  console.log(`[NPC] Loaded ${records.length} NPCs from database`);
  return records as LoadedNPCRecord[];
}

export interface LoadedNPCRecord extends NPCRecord {
  persistedX: number | null;
  persistedY: number | null;
  persistedDirection: string | null;
  persistedAnimationFrame: number | null;
  motorState: NPCMotorState | null;
}

export interface NPCRuntimeSnapshot {
  npcId: string;
  x: number;
  y: number;
  direction: Direction;
  animationFrame: number;
  motorState: NPCMotorState;
}

/** Persist a batch atomically so spatial and motor state never disagree. */
export async function persistNPCRuntimeStates(snapshots: NPCRuntimeSnapshot[]): Promise<void> {
  if (snapshots.length === 0) return;

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
