#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { imageToGlb } from '@maldoror/ai';
import { execSync } from 'child_process';

config({ path: path.resolve(process.cwd(), '../../.env') });

const PROD_API = 'https://abyss.maldoror.dev';
const LOCAL_MODELS_DIR = path.join(process.cwd(), '../web-3d/public/models');
const TEMP_DIR = path.join(process.cwd(), 'temp-sprites');

const SERVER = 'root@134.199.180.251';
const ADMIN_SSH_PORT = '22022';
const CONTAINER_NAME = 'deploy-ssh-world-1';
const REMOTE_MODELS_DIR = '/app/models';

interface Entity {
  id: string;
  type: 'player' | 'building' | 'auton' | 'npc';
  name?: string;
  spriteUrl?: string;
  modelUrl?: string;
}

interface ConversionResult {
  id: string;
  type: string;
  status: 'converted' | 'skipped' | 'failed';
  error?: string;
}

async function fetchEntities(): Promise<Entity[]> {
  console.log('Fetching entities from production API...');
  const response = await fetch(`${PROD_API}/api/entities`);
  if (!response.ok) {
    throw new Error(`Failed to fetch entities: ${response.status}`);
  }
  const data = await response.json() as { entities: Entity[] };
  return data.entities;
}

async function downloadSprite(url: string, outputPath: string): Promise<void> {
  const fullUrl = url.startsWith('http') ? url : `${PROD_API}${url}`;
  const response = await fetch(fullUrl);
  if (!response.ok) {
    throw new Error(`Failed to download sprite: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);
}

async function glbExists(type: string, id: string): Promise<boolean> {
  const folder = type === 'auton' || type === 'npc' ? 'npcs' : type + 's';
  const glbPath = path.join(LOCAL_MODELS_DIR, folder, `${id}.glb`);
  try {
    await fs.access(glbPath);
    return true;
  } catch {
    return false;
  }
}

function getSpriteUrl(entity: Entity): string | null {
  if (entity.type === 'building') {
    return `/files/buildings/${entity.id}/tile_north_1_1_256.png`;
  } else if (entity.type === 'player') {
    return `/files/sprites/${entity.id}/frame_down_0_256.png`;
  } else if (entity.type === 'auton' || entity.type === 'npc') {
    return `/files/npcs/${entity.id}/frame_down_0_256.png`;
  }
  return null;
}

function getOutputPath(type: string, id: string): string {
  const folder = type === 'auton' || type === 'npc' ? 'npcs' : type + 's';
  return path.join(LOCAL_MODELS_DIR, folder, `${id}.glb`);
}

async function deployToProduction(type: string, id: string): Promise<void> {
  const folder = type === 'auton' || type === 'npc' ? 'npcs' : type + 's';
  const localPath = path.join(LOCAL_MODELS_DIR, folder, `${id}.glb`);
  const remotePath = `${REMOTE_MODELS_DIR}/${folder}/${id}.glb`;
  
  console.log(`  Deploying ${id}.glb to production...`);
  
  try {
    execSync(
      `ssh -p ${ADMIN_SSH_PORT} ${SERVER} "docker exec ${CONTAINER_NAME} mkdir -p ${REMOTE_MODELS_DIR}/${folder}"`,
      { stdio: 'pipe' }
    );
    
    const tempRemote = `/tmp/${id}.glb`;
    execSync(
      `scp -P ${ADMIN_SSH_PORT} "${localPath}" ${SERVER}:${tempRemote}`,
      { stdio: 'pipe' }
    );
    execSync(
      `ssh -p ${ADMIN_SSH_PORT} ${SERVER} "docker cp ${tempRemote} ${CONTAINER_NAME}:${remotePath} && rm ${tempRemote}"`,
      { stdio: 'pipe' }
    );
    
    console.log(`  Deployed ${id}.glb successfully`);
  } catch (err) {
    console.error(`  Failed to deploy ${id}.glb:`, err instanceof Error ? err.message : err);
    throw err;
  }
}

async function convertEntity(entity: Entity, index: number, total: number): Promise<ConversionResult> {
  const { id, type } = entity;
  
  if (await glbExists(type, id)) {
    return { id, type, status: 'skipped' };
  }
  
  const spriteUrl = getSpriteUrl(entity);
  if (!spriteUrl) {
    return { id, type, status: 'skipped' };
  }
  
  const outputPath = getOutputPath(type, id);
  const tempSpritePath = path.join(TEMP_DIR, `${type}_${id}.png`);
  
  try {
    console.log(`[${index + 1}/${total}] Converting ${type}: ${id}`);
    
    console.log(`  Downloading sprite...`);
    await downloadSprite(spriteUrl, tempSpritePath);
    
    console.log(`  Converting to GLB via Meshy API...`);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    
    await imageToGlb(tempSpritePath, outputPath, {
      aiModel: 'meshy-4',
      targetPolycount: type === 'building' ? 15000 : 10000,
      onProgress: (p) => process.stdout.write(`\r  Progress: ${p}%`),
    });
    console.log('');
    
    await deployToProduction(type, id);
    
    await fs.unlink(tempSpritePath).catch(() => {});
    
    return { id, type, status: 'converted' };
  } catch (err) {
    console.error(`  ERROR: ${err instanceof Error ? err.message : err}`);
    return { id, type, status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  if (!process.env.MESHY_API_KEY) {
    console.error('Error: MESHY_API_KEY required in .env file');
    process.exit(1);
  }
  
  const args = process.argv.slice(2);
  const typeFilter = args.find(a => ['--buildings', '--players', '--npcs', '--all'].includes(a));
  const specificId = args.find(a => a.startsWith('--id='))?.split('=')[1];
  
  console.log('=== Maldoror 3D Model Converter ===\n');
  
  await fs.mkdir(TEMP_DIR, { recursive: true });
  
  const entities = await fetchEntities();
  console.log(`Found ${entities.length} total entities\n`);
  
  let toConvert = entities.filter(e => 
    e.type === 'building' || e.type === 'player' || e.type === 'auton' || e.type === 'npc'
  );
  
  if (specificId) {
    toConvert = toConvert.filter(e => e.id === specificId);
  } else if (typeFilter && typeFilter !== '--all') {
    const filterType = typeFilter.replace('--', '').replace('s', '');
    toConvert = toConvert.filter(e => 
      e.type === filterType || 
      (filterType === 'npc' && (e.type === 'npc' || e.type === 'auton'))
    );
  }
  
  const needsConversion: Entity[] = [];
  for (const entity of toConvert) {
    if (!(await glbExists(entity.type, entity.id))) {
      needsConversion.push(entity);
    }
  }
  
  console.log(`Entities needing conversion: ${needsConversion.length}`);
  console.log(`  Buildings: ${needsConversion.filter(e => e.type === 'building').length}`);
  console.log(`  Players: ${needsConversion.filter(e => e.type === 'player').length}`);
  console.log(`  NPCs/Autons: ${needsConversion.filter(e => e.type === 'auton' || e.type === 'npc').length}`);
  console.log('');
  
  if (needsConversion.length === 0) {
    console.log('All models already converted!');
    return;
  }
  
  const results: ConversionResult[] = [];
  for (let i = 0; i < needsConversion.length; i++) {
    const result = await convertEntity(needsConversion[i]!, i, needsConversion.length);
    results.push(result);
    
    if (i < needsConversion.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  console.log('\n=== Conversion Summary ===');
  console.log(`Converted: ${results.filter(r => r.status === 'converted').length}`);
  console.log(`Skipped: ${results.filter(r => r.status === 'skipped').length}`);
  console.log(`Failed: ${results.filter(r => r.status === 'failed').length}`);
  
  const failed = results.filter(r => r.status === 'failed');
  if (failed.length > 0) {
    console.log('\nFailed conversions:');
    for (const f of failed) {
      console.log(`  - ${f.type}/${f.id}: ${f.error}`);
    }
  }
  
  await fs.rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {});
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
