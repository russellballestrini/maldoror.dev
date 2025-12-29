/**
 * Meshy.ai API client for image-to-3D conversion
 * https://docs.meshy.ai/api-image-to-3d
 */

import fs from 'fs/promises';
import path from 'path';

const MESHY_API_BASE = 'https://api.meshy.ai/openapi/v1';

export interface MeshyTaskResult {
  id: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  progress: number;
  model_urls?: {
    glb?: string;
    fbx?: string;
    obj?: string;
    usdz?: string;
  };
  thumbnail_url?: string;
  error?: string;
}

export interface MeshyConversionOptions {
  /** AI model to use: meshy-4, meshy-5, or latest */
  aiModel?: 'meshy-4' | 'meshy-5' | 'latest';
  /** Target polygon count (100-300000, default 30000) */
  targetPolycount?: number;
  /** Enable PBR textures */
  enablePbr?: boolean;
  /** Symmetry mode */
  symmetryMode?: 'off' | 'auto' | 'on';
}

/**
 * Create an image-to-3D conversion task
 */
export async function createImageTo3DTask(
  imagePathOrUrl: string,
  options: MeshyConversionOptions = {}
): Promise<string> {
  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey) {
    throw new Error('MESHY_API_KEY environment variable is required');
  }

  let imageUrl: string;

  // Check if it's a file path or URL
  if (imagePathOrUrl.startsWith('http://') || imagePathOrUrl.startsWith('https://')) {
    imageUrl = imagePathOrUrl;
  } else {
    // Read file and convert to base64 data URI
    const imageBuffer = await fs.readFile(imagePathOrUrl);
    const ext = path.extname(imagePathOrUrl).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    imageUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
  }

  const response = await fetch(`${MESHY_API_BASE}/image-to-3d`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image_url: imageUrl,
      ai_model: options.aiModel || 'meshy-4',
      target_polycount: options.targetPolycount || 30000,
      enable_pbr: options.enablePbr ?? false,
      symmetry_mode: options.symmetryMode || 'auto',
      should_texture: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Meshy API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as { result: string };
  return data.result; // Task ID
}

/**
 * Get the status of a conversion task
 */
export async function getTaskStatus(taskId: string): Promise<MeshyTaskResult> {
  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey) {
    throw new Error('MESHY_API_KEY environment variable is required');
  }

  const response = await fetch(`${MESHY_API_BASE}/image-to-3d/${taskId}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Meshy API error: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<MeshyTaskResult>;
}

/**
 * Wait for a task to complete, polling at the specified interval
 */
export async function waitForTask(
  taskId: string,
  options: { pollIntervalMs?: number; timeoutMs?: number; onProgress?: (progress: number) => void } = {}
): Promise<MeshyTaskResult> {
  const pollInterval = options.pollIntervalMs || 5000;
  const timeout = options.timeoutMs || 300000; // 5 minutes default
  const startTime = Date.now();

  while (true) {
    const status = await getTaskStatus(taskId);

    if (options.onProgress) {
      options.onProgress(status.progress);
    }

    if (status.status === 'SUCCEEDED') {
      return status;
    }

    if (status.status === 'FAILED' || status.status === 'CANCELED') {
      throw new Error(`Task ${status.status}: ${status.error || 'Unknown error'}`);
    }

    if (Date.now() - startTime > timeout) {
      throw new Error(`Task timed out after ${timeout}ms`);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}

/**
 * Download a GLB model from a URL and save to disk
 */
export async function downloadGlb(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download GLB: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);
}

/**
 * Convert an image to a 3D GLB model (full pipeline)
 */
export async function imageToGlb(
  imagePath: string,
  outputPath: string,
  options: MeshyConversionOptions & { onProgress?: (progress: number) => void } = {}
): Promise<void> {
  console.log(`Starting image-to-3D conversion: ${imagePath}`);

  // Create task
  const taskId = await createImageTo3DTask(imagePath, options);
  console.log(`Task created: ${taskId}`);

  // Wait for completion
  const result = await waitForTask(taskId, {
    onProgress: (progress) => {
      if (options.onProgress) {
        options.onProgress(progress);
      }
      console.log(`Progress: ${progress}%`);
    },
  });

  // Download GLB
  if (!result.model_urls?.glb) {
    throw new Error('No GLB URL in result');
  }

  await downloadGlb(result.model_urls.glb, outputPath);
  console.log(`Saved to: ${outputPath}`);
}
