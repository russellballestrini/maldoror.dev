import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { BuildingSprite } from '@maldoror/protocol';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Building storage directory - mounted as Docker volume in production, local directory in development
const BUILDINGS_DIR = process.env.BUILDINGS_DIR ||
  (fs.existsSync('/app/buildings') ? '/app/buildings' : path.join(__dirname, '../../buildings'));

/**
 * Ensure the buildings directory exists
 */
function ensureBuildingsDir(): void {
  if (!fs.existsSync(BUILDINGS_DIR)) {
    fs.mkdirSync(BUILDINGS_DIR, { recursive: true });
  }
}

/**
 * Get the file path for a building's sprite
 */
function getBuildingPath(buildingId: string): string {
  return path.join(BUILDINGS_DIR, `${buildingId}.json`);
}

/**
 * Save a building sprite to disk
 */
export async function saveBuildingToDisk(buildingId: string, sprite: BuildingSprite): Promise<void> {
  ensureBuildingsDir();
  const filePath = getBuildingPath(buildingId);
  const json = JSON.stringify(sprite);
  await fs.promises.writeFile(filePath, json, 'utf-8');
  console.log(`[Building] Saved building ${buildingId} (${(json.length / 1024 / 1024).toFixed(2)}MB)`);
}

/**
 * Load a building sprite from disk
 * Returns null if not found
 */
export async function loadBuildingFromDisk(buildingId: string): Promise<BuildingSprite | null> {
  const filePath = getBuildingPath(buildingId);

  try {
    const json = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(json) as BuildingSprite;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    console.error(`[Building] Failed to load building ${buildingId}:`, error);
    return null;
  }
}

/**
 * Check if a building sprite exists on disk
 */
export function buildingExistsOnDisk(buildingId: string): boolean {
  const filePath = getBuildingPath(buildingId);
  return fs.existsSync(filePath);
}

/**
 * Delete a building sprite from disk
 */
export async function deleteBuildingFromDisk(buildingId: string): Promise<void> {
  const filePath = getBuildingPath(buildingId);
  try {
    await fs.promises.unlink(filePath);
    console.log(`[Building] Deleted building ${buildingId}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[Building] Failed to delete building ${buildingId}:`, error);
    }
  }
}
