import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });
import { generateObject } from 'ai';
import { createModel, type ProviderConfig } from './providers.js';
import { CompactPixelSpriteSchema, parseCompactFrame } from './schema.js';
import { PIXEL_SPRITE_SYSTEM_PROMPT, buildPixelSpritePrompt } from './prompts.js';

async function main() {
  console.log('Testing pixel sprite generation with compact format...\n');

  const providerConfig: ProviderConfig = {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    apiKey: process.env.OPENAI_API_KEY!,
  };

  const model = createModel(providerConfig);
  const userPrompt = buildPixelSpritePrompt('A gaunt figure with hollow eyes');

  console.log('System prompt:', PIXEL_SPRITE_SYSTEM_PROMPT);
  console.log('\nUser prompt:', userPrompt);
  console.log('\n--- Starting generation ---\n');

  try {
    const result = await generateObject({
      model,
      schema: CompactPixelSpriteSchema,
      system: PIXEL_SPRITE_SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.5,
      maxOutputTokens: 30000,
    });

    console.log('✓ Generation succeeded!');
    console.log('Width:', result.object?.width);
    console.log('Height:', result.object?.height);
    console.log('Frames:', Object.keys(result.object?.frames || {}));

    // Check row counts
    const frames = result.object?.frames;
    if (frames) {
      for (const dir of ['up', 'down', 'left', 'right'] as const) {
        const rows = frames[dir] || [];
        console.log(`  ${dir}: ${rows.length} rows`);
        if (rows.length > 0) {
          console.log(`    first row: ${rows[0]?.length || 0} pixels`);
        }
      }
    }

    // Test parsing
    if (frames?.down) {
      const parsed = parseCompactFrame(frames.down as string[][], 16, 24);
      const greenCount = parsed.flat().filter(p => p.r === 0 && p.g === 255 && p.b === 0).length;
      console.log(`\nDebug pixels (bright green): ${greenCount} / ${16 * 24} = ${(greenCount / (16 * 24) * 100).toFixed(1)}%`);
    }
  } catch (error: any) {
    console.log('✗ Generation failed!');
    console.log('Error name:', error.name);
    console.log('Error message:', error.message);
    if (error.cause) {
      console.log('Cause:', error.cause);
    }
  }
}

main().catch(e => {
  console.error('Uncaught error:', e);
});
