import { generateObject } from 'ai';
import { createModel, type ProviderConfig } from './providers.js';
import { PixelSpriteSchema } from './schema.js';
import { PIXEL_SPRITE_SYSTEM_PROMPT, buildPixelSpritePrompt } from './prompts.js';

async function main() {
  console.log('Testing pixel sprite generation with raw output...\n');

  const providerConfig: ProviderConfig = {
    provider: 'openai',
    model: 'gpt-4.1',
    apiKey: process.env.OPENAI_API_KEY!,
  };

  const model = createModel(providerConfig);
  const userPrompt = buildPixelSpritePrompt('A gaunt figure with hollow eyes');

  try {
    const result = await generateObject({
      model,
      schema: PixelSpriteSchema,
      system: PIXEL_SPRITE_SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.7,
    });

    console.log('✓ Raw generation succeeded!');
    console.log('Result keys:', Object.keys(result));
    console.log('Object width:', result.object?.width);
    console.log('Object height:', result.object?.height);
    console.log('Frames keys:', Object.keys(result.object?.frames || {}));

    // Validate with Zod
    const validated = PixelSpriteSchema.safeParse(result.object);
    if (validated.success) {
      console.log('✓ Zod validation passed!');
    } else {
      console.log('✗ Zod validation failed:');
      console.log(JSON.stringify(validated.error.errors.slice(0, 5), null, 2));
    }
  } catch (error: any) {
    console.log('✗ Generation failed!');
    console.log('Error name:', error.name);
    console.log('Error message:', error.message);
    if (error.cause) {
      console.log('Cause:', error.cause);
    }
    // Check if there's partial data
    if (error.value) {
      console.log('Partial value:', JSON.stringify(error.value).slice(0, 500));
    }
  }
}

main().catch(e => {
  console.error('Uncaught error:', e);
});
