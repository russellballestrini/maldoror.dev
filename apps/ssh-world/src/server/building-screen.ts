import type { Duplex } from 'stream';
import { renderHalfBlockGrid, downsampleGrid } from '@maldoror/render';
import { generateBuildingSprite, type ProviderConfig, type DirectionalBuildingSprite } from '@maldoror/ai';
import {
  GenerationModalScreen,
  type GenerationModalConfig,
  type GenerationOutput,
  type ProgressCallback,
  type GenerationResult,
} from './generation-modal-screen.js';
import { resourceMonitor } from '../utils/resource-monitor.js';

export type BuildingScreenResult = GenerationResult<DirectionalBuildingSprite>;

interface BuildingScreenConfig {
  stream: Duplex;
  providerConfig: ProviderConfig;
  username?: string;
  playerX: number;
  playerY: number;
  cols?: number;
  rows?: number;
}

/**
 * Modal screen for building placement
 * Uses AI to generate 3x3 tile building sprites with 4 directional views
 */
export class BuildingScreen extends GenerationModalScreen<DirectionalBuildingSprite> {
  private providerConfig: ProviderConfig;
  private username: string;
  private playerX: number;
  private playerY: number;

  constructor(config: BuildingScreenConfig) {
    super(config.stream, config.cols ?? 80, config.rows ?? 24);
    this.providerConfig = config.providerConfig;
    this.username = config.username ?? 'unknown';
    this.playerX = config.playerX;
    this.playerY = config.playerY;
  }

  protected getConfig(): GenerationModalConfig {
    return {
      title: 'BUILD STRUCTURE',
      boxWidth: 70,
      boxHeight: 24,
      startX: 3,
      startY: 1,
      borderColor: { r: 100, g: 150, b: 80 },
      titleColor: { r: 150, g: 200, b: 100 },
      inputPromptText: 'Describe the building or structure you want to create:',
      examples: [
        'A medieval stone tower with a pointed roof',
        'A small wooden cabin with a chimney',
        'An ancient temple with pillars and stairs',
        'A futuristic metal structure with glowing panels',
      ],
      maxInputLength: 200,
      progressTotal: 3,
      generatingMessage: 'Generating 3×3 tile building...',
    };
  }

  protected getAdditionalInputInfo(): string[] {
    const anchorX = this.playerX;
    const anchorY = this.playerY - 1;
    return [
      `Building will be placed at (${anchorX - 1} to ${anchorX + 1}, ${anchorY - 2} to ${anchorY})`,
      'Size: 3×3 tiles, directly above your character',
    ];
  }

  protected async generate(prompt: string, onProgress: ProgressCallback): Promise<GenerationOutput<DirectionalBuildingSprite>> {
    if (!this.providerConfig.apiKey) {
      return { success: false, error: 'API key not configured' };
    }

    resourceMonitor.startOperation('BUILDING_GENERATE');
    try {
      const result = await generateBuildingSprite({
        description: prompt,
        apiKey: this.providerConfig.apiKey,
        username: this.username,
        onProgress,
      });

      if (result.success && result.sprite) {
        return { success: true, result: result.sprite };
      } else {
        return { success: false, error: result.error };
      }
    } finally {
      resourceMonitor.endOperation('BUILDING_GENERATE');
    }
  }

  protected renderPreview(): void {
    if (!this.generatedResult) return;

    const config = this.getCenteredConfig();

    // Use 'north' direction for preview (camera at 0° rotation)
    const northSprite = this.generatedResult.north;

    // Use smallest resolution '26' and downsample to fit modal
    // Target: ~12 pixels per tile to fit 3 tiles in available space
    const previewRes = '26';
    const downsampleFactor = 2; // 26 / 2 = 13 pixels per tile

    // Calculate sizes after downsampling
    const tileWidth = Math.floor(26 / downsampleFactor); // 13 pixels = 13 columns
    const tileHeight = Math.ceil(26 / downsampleFactor / 2); // 13 pixels / 2 = ~7 terminal rows

    // Center the 3x3 grid in the modal
    const gridWidth = tileWidth * 3;
    const gridHeight = tileHeight * 3;
    const startX = config.startX + Math.floor((config.boxWidth - gridWidth) / 2);
    const startY = config.startY + 4;

    // Render 3×3 grid of tiles
    for (let ty = 0; ty < 3; ty++) {
      for (let tx = 0; tx < 3; tx++) {
        const tile = northSprite.tiles[ty]?.[tx];
        if (!tile) continue;

        // Use the pre-computed resolution and downsample
        const pixels = tile.resolutions[previewRes] || tile.pixels;
        const scaledPixels = downsampleGrid(pixels, downsampleFactor);

        const lines = renderHalfBlockGrid(scaledPixels);
        const offsetX = startX + tx * tileWidth;
        const offsetY = startY + ty * tileHeight;

        for (let i = 0; i < lines.length; i++) {
          this.stream.write(
            this.ansi
              .moveTo(offsetX, offsetY + i)
              .build()
          );
          this.stream.write(lines[i]!);
        }
      }
    }

    // Placement info
    const anchorX = this.playerX;
    const anchorY = this.playerY - 1;
    const infoY = startY + gridHeight + 1;
    this.stream.write(
      this.ansi
        .moveTo(config.startX + 3, infoY)
        .setForeground({ type: 'rgb', value: [150, 150, 100] })
        .write(`Will be placed at (${anchorX}, ${anchorY}) - above your character`)
        .resetAttributes()
        .build()
    );
  }

  protected getConfirmButtonText(): string {
    return 'Place Building';
  }
}
