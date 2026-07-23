import * as fs from 'fs';
import type { Sprite, PixelGrid, DirectionFrames } from '@maldoror/protocol';
import { RESOLUTIONS } from '@maldoror/protocol';
import { db, schema } from '@maldoror/db';
import { eq, and } from 'drizzle-orm';
import {
  ensureSpriteDir,
  getSpritePngPath,
  savePixelGridAsPng,
  loadPngAsPixelGrid,
  deleteSpritePngs,
} from './png-storage.js';
import { despeckleSpriteFrame } from './sprite-hygiene.js';

const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
type Direction = typeof DIRECTIONS[number];
type SpriteFrameRecord = typeof schema.spriteFrames.$inferSelect;
const MAX_RUNTIME_SPRITE_CACHE = 64;
const runtimeSpriteCache = new Map<string, Promise<Sprite | null>>();

function runtimeSpriteTarget(): number {
  const configured = Number.parseInt(process.env.MALDOROR_RUNTIME_SPRITE_RESOLUTION ?? '128', 10);
  return Number.isFinite(configured) ? Math.max(26, Math.min(256, configured)) : 128;
}

function touchRuntimeCache(userId: string, value: Promise<Sprite | null>): void {
  runtimeSpriteCache.delete(userId);
  runtimeSpriteCache.set(userId, value);
  while (runtimeSpriteCache.size > MAX_RUNTIME_SPRITE_CACHE) {
    const oldest = runtimeSpriteCache.keys().next().value as string | undefined;
    if (!oldest) break;
    runtimeSpriteCache.delete(oldest);
  }
}

/**
 * Save a sprite to disk as individual PNG files per frame/resolution
 * Also inserts rows into the sprite_frames table
 */
export async function saveSpriteToDisk(userId: string, sprite: Sprite): Promise<void> {
  runtimeSpriteCache.delete(userId);
  ensureSpriteDir(userId);

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

        const filePath = getSpritePngPath(userId, direction, frameNum, resolution);
        const relativePath = `${userId}/frame_${direction}_${frameNum}_${resolution}.png`;

        await savePixelGridAsPng(pixels, filePath);

        // Get dimensions from the pixels
        const height = pixels.length;
        const width = pixels[0]?.length ?? 0;

        // Insert database row
        await db.insert(schema.spriteFrames).values({
          userId,
          direction,
          frameNum,
          resolution,
          filePath: relativePath,
          width,
          height,
        }).onConflictDoUpdate({
          target: [schema.spriteFrames.userId, schema.spriteFrames.direction, schema.spriteFrames.frameNum, schema.spriteFrames.resolution],
          set: { filePath: relativePath, width, height },
        });

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

  console.log(`[Sprite] Saved sprite for ${userId}: ${totalFiles} PNGs (${(totalSize / 1024).toFixed(1)}KB total)`);
}

/**
 * Load a single sprite frame at a specific resolution
 * Returns null if not found
 */
export async function loadSpriteFrame(
  userId: string,
  direction: string,
  frameNum: number,
  resolution: number
): Promise<PixelGrid | null> {
  const filePath = getSpritePngPath(userId, direction, frameNum, resolution);

  try {
    return await loadPngAsPixelGrid(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    console.error(`[Sprite] Failed to load frame ${direction}_${frameNum}@${resolution} for ${userId}:`, error);
    return null;
  }
}

/**
 * Load all frames for a direction at a specific resolution
 */
export async function loadDirectionFrames(
  userId: string,
  direction: string,
  resolution: number
): Promise<DirectionFrames | null> {
  const frames: PixelGrid[] = [];

  for (let frameNum = 0; frameNum < 4; frameNum++) {
    const frame = await loadSpriteFrame(userId, direction, frameNum, resolution);
    if (!frame) return null;
    frames.push(frame);
  }

  return frames as DirectionFrames;
}

/**
 * Load a full sprite from disk
 * Loads one dynamically selected runtime resolution and shares the immutable
 * Sprite object across every session in this worker. Full-quality PNGs remain
 * on disk; the renderer scales the bounded runtime source on demand.
 * The renderer's scaling cache handles other resolutions on-demand
 */
export async function loadSpriteFromDisk(userId: string): Promise<Sprite | null> {
  const cached = runtimeSpriteCache.get(userId);
  if (cached) {
    touchRuntimeCache(userId, cached);
    return cached;
  }

  const pending = loadSpriteFromDiskUncached(userId);
  touchRuntimeCache(userId, pending);
  const sprite = await pending;
  if (!sprite && runtimeSpriteCache.get(userId) === pending) runtimeSpriteCache.delete(userId);
  return sprite;
}

async function loadSpriteFromDiskUncached(userId: string): Promise<Sprite | null> {
  const frameRecords: SpriteFrameRecord[] = await db.select()
    .from(schema.spriteFrames)
    .where(eq(schema.spriteFrames.userId, userId));

  if (frameRecords.length === 0) {
    return null;
  }

  const framesByResolution = new Map<number, Set<string>>();
  for (const record of frameRecords) {
    const identities = framesByResolution.get(record.resolution) ?? new Set<string>();
    identities.add(`${record.direction}:${record.frameNum}`);
    framesByResolution.set(record.resolution, identities);
  }
  const fullFrameCount = DIRECTIONS.length * 4;
  const complete = [...framesByResolution.entries()].filter(([, frames]) => frames.size >= fullFrameCount);
  const largestPartial = Math.max(...[...framesByResolution.values()].map((frames) => frames.size), 0);
  const candidates = complete.length > 0
    ? complete
    : [...framesByResolution.entries()].filter(([, frames]) => frames.size === largestPartial);
  const target = runtimeSpriteTarget();
  candidates.sort((a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target) || a[0] - b[0]);
  const runtimeResolution = candidates[0]?.[0];
  if (runtimeResolution === undefined) return null;
  const runtimeRecords = frameRecords.filter((record) => record.resolution === runtimeResolution);

  // Get dimensions from any frame record
  const firstRecord = runtimeRecords[0];
  const width = firstRecord?.width ?? runtimeResolution;
  const height = firstRecord?.height ?? runtimeResolution;

  // Initialize the sprite structure - only base frames, no pre-loaded resolutions
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

  for (const record of runtimeRecords) {
    const pixels = await loadSpriteFrame(userId, record.direction, record.frameNum, runtimeResolution);
    if (pixels) {
      const dir = record.direction as Direction;
      // Strip the baked-in dark alpha fringe (see sprite-hygiene.ts) so the
      // renderer's downscaling doesn't scatter black speckles around sprites
      sprite.frames[dir][record.frameNum] = despeckleSpriteFrame(pixels);
    }
  }

  return sprite;
}

/** Compact a just-generated or legacy JSON sprite to one runtime frame set and
 * prime the shared worker cache. Persistence keeps every original resolution. */
export function cacheRuntimeSprite(userId: string, sprite: Sprite): Sprite {
  const target = runtimeSpriteTarget();
  const candidates = Object.entries(sprite.resolutions ?? {})
    .map(([key, frames]) => ({ resolution: Number.parseInt(key, 10), frames }))
    .filter((entry) => Number.isFinite(entry.resolution));
  candidates.sort((a, b) =>
    Math.abs(a.resolution - target) - Math.abs(b.resolution - target) ||
    a.resolution - b.resolution
  );
  const selected = candidates[0];
  const compact = selected
    ? {
        width: selected.frames.down[0]?.[0]?.length ?? selected.resolution,
        height: selected.frames.down[0]?.length ?? selected.resolution,
        frames: selected.frames,
        resolutions: {},
      }
    : sprite;
  touchRuntimeCache(userId, Promise.resolve(compact));
  return compact;
}

/**
 * Load only specific resolution for a sprite (for rendering)
 * More efficient than loading the full sprite
 */
export async function loadSpriteAtResolution(
  userId: string,
  resolution: number
): Promise<Record<Direction, DirectionFrames> | null> {
  const frameRecords = await db.select()
    .from(schema.spriteFrames)
    .where(and(
      eq(schema.spriteFrames.userId, userId),
      eq(schema.spriteFrames.resolution, resolution)
    ));

  if (frameRecords.length === 0) {
    return null;
  }

  const result: Record<Direction, DirectionFrames> = {
    up: [[], [], [], []] as unknown as DirectionFrames,
    down: [[], [], [], []] as unknown as DirectionFrames,
    left: [[], [], [], []] as unknown as DirectionFrames,
    right: [[], [], [], []] as unknown as DirectionFrames,
  };

  for (const record of frameRecords) {
    const pixels = await loadSpriteFrame(userId, record.direction, record.frameNum, resolution);
    if (pixels) {
      const dir = record.direction as Direction;
      result[dir][record.frameNum] = pixels;
    }
  }

  return result;
}

/**
 * Check if a sprite has PNG files on disk
 */
export async function spriteExistsOnDisk(userId: string): Promise<boolean> {
  const count = await db.select()
    .from(schema.spriteFrames)
    .where(eq(schema.spriteFrames.userId, userId))
    .limit(1);

  return count.length > 0;
}

/**
 * Delete a sprite's PNG files and database records
 */
export async function deleteSpriteFromDisk(userId: string): Promise<void> {
  runtimeSpriteCache.delete(userId);
  // Delete PNG files
  await deleteSpritePngs(userId);

  // Delete database records (should cascade from users table, but just in case)
  await db.delete(schema.spriteFrames)
    .where(eq(schema.spriteFrames.userId, userId));

  console.log(`[Sprite] Deleted sprite for ${userId}`);
}
