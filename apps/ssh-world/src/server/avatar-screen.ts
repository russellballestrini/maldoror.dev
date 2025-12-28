import type { Duplex } from 'stream';
import type { Sprite } from '@maldoror/protocol';
import { renderHalfBlockGrid, downsampleGrid } from '@maldoror/render';
import { generateImageSprite, type ProviderConfig } from '@maldoror/ai';
import {
  GenerationModalScreen,
  type GenerationModalConfig,
  type GenerationOutput,
  type ProgressCallback,
  type GenerationResult,
} from './generation-modal-screen.js';
import { resourceMonitor } from '../utils/resource-monitor.js';

export type AvatarScreenResult = GenerationResult<Sprite>;

interface AvatarScreenConfig {
  stream: Duplex;
  currentPrompt?: string;
  providerConfig: ProviderConfig;
  username?: string;
  cols?: number;
  rows?: number;
}

/**
 * Modal screen for avatar regeneration
 * Uses AI to generate character sprites with 4 directions x 2 poses
 */
export class AvatarScreen extends GenerationModalScreen<Sprite> {
  private providerConfig: ProviderConfig;
  private username: string;

  constructor(config: AvatarScreenConfig) {
    super(config.stream, config.cols ?? 80, config.rows ?? 24);
    this.inputBuffer = ''; // Start with empty input
    this.providerConfig = config.providerConfig;
    this.username = config.username ?? 'unknown';
  }

  protected getConfig(): GenerationModalConfig {
    return {
      title: 'REGENERATE AVATAR',
      boxWidth: 60,
      boxHeight: 22,
      startX: 5,
      startY: 2,
      borderColor: { r: 100, g: 80, b: 180 },
      titleColor: { r: 180, g: 100, b: 255 },
      inputPromptText: "Describe your character's appearance:",
      examples: [
        'A gaunt figure with hollow eyes and tattered robes',
        'A pale aristocrat with silver hair and dark armor',
        'A creature of shadow with many eyes',
      ],
      maxInputLength: 200,
      progressTotal: 8,
      generatingMessage: 'Generating 8 frames (4 directions x 2 poses)...',
    };
  }

  protected async generate(prompt: string, onProgress: ProgressCallback): Promise<GenerationOutput<Sprite>> {
    if (!this.providerConfig.apiKey) {
      return { success: false, error: 'API key not configured' };
    }

    resourceMonitor.startOperation('AVATAR_GENERATE');
    try {
      const result = await generateImageSprite({
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
      resourceMonitor.endOperation('AVATAR_GENERATE');
    }
  }

  protected renderPreview(): void {
    if (!this.generatedResult) return;

    const config = this.getCenteredConfig();

    // Use smallest resolution and downsample to fit modal
    // Target: ~12 pixels per sprite to fit 4 sprites side by side
    const previewRes = '26';
    const downsampleFactor = 2; // 26 / 2 = 13 pixels per sprite
    const spriteWidth = Math.floor(26 / downsampleFactor); // 13 columns

    // Center the 4 sprites in the modal
    const totalWidth = spriteWidth * 4;
    const startX = config.startX + Math.floor((config.boxWidth - totalWidth) / 2);
    const startY = config.startY + 4;

    // Render all 4 directions side by side
    const directions: Array<'down' | 'left' | 'right' | 'up'> = ['down', 'left', 'right', 'up'];
    const labels = ['Front', 'Left', 'Right', 'Back'];

    for (let d = 0; d < directions.length; d++) {
      const dir = directions[d]!;
      // Use pre-computed resolution if available, otherwise base frames
      const frame = this.generatedResult.resolutions?.[previewRes]?.[dir]?.[0]
        ?? this.generatedResult.frames[dir][0];
      const scaledFrame = downsampleGrid(frame, downsampleFactor);
      const xOffset = startX + d * spriteWidth;

      // Label (centered above sprite)
      const labelX = xOffset + Math.floor((spriteWidth - labels[d]!.length) / 2);
      this.stream.write(
        this.ansi
          .moveTo(labelX, startY)
          .setForeground({ type: 'rgb', value: [150, 150, 150] })
          .write(labels[d]!)
          .resetAttributes()
          .build()
      );

      // Render sprite using half-block
      const lines = renderHalfBlockGrid(scaledFrame);
      for (let i = 0; i < lines.length; i++) {
        this.stream.write(
          this.ansi
            .moveTo(xOffset, startY + 1 + i)
            .build()
        );
        this.stream.write(lines[i]!);
      }
    }
  }

  protected getConfirmButtonText(): string {
    return 'Confirm';
  }
}
