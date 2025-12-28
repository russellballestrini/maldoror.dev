/**
 * NPC Migration Script
 *
 * Migrates NPCs from the `npcs` table to the `users` table with is_npc = true.
 * Generates personalities for each NPC using their visual prompt.
 *
 * Run with: npx tsx apps/ssh-world/scripts/migrate-npcs-to-users.ts
 */

import 'dotenv/config';
import { db, schema } from '@maldoror/db';
import { eq } from 'drizzle-orm';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const PERSONALITY_GENERATION_PROMPT = `You are creating a personality for an NPC character in a terminal-based MMO game called Maldoror.

Based on the following visual description of the character, create a concise personality profile that includes:
1. Their general demeanor and temperament
2. How they interact with players (friendly, mysterious, grumpy, etc.)
3. A brief backstory or motivation (1-2 sentences)
4. Their speech style (formal, casual, cryptic, etc.)

Visual description of the character:
{VISUAL_PROMPT}

Write a 2-3 sentence personality description that a game AI can use to roleplay this character.
Focus on making them feel like a real inhabitant of this world.
Keep it concise - under 200 words.`;

async function generatePersonality(visualPrompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('No OPENAI_API_KEY - using default personality');
    return 'A curious inhabitant of Maldoror who enjoys wandering and occasionally chatting with passing travelers.';
  }

  const openai = createOpenAI({ apiKey });

  try {
    const result = await generateText({
      model: openai('gpt-4o-mini'),
      prompt: PERSONALITY_GENERATION_PROMPT.replace('{VISUAL_PROMPT}', visualPrompt),
      maxTokens: 250,
      temperature: 0.8,
    });

    return result.text.trim();
  } catch (error) {
    console.error('Failed to generate personality:', error);
    return 'A curious inhabitant of Maldoror who enjoys wandering and occasionally chatting with passing travelers.';
  }
}

async function main() {
  console.log('=== NPC to Users Migration ===\n');

  // Load all NPCs
  const npcs = await db.select().from(schema.npcs);
  console.log(`Found ${npcs.length} NPCs to migrate\n`);

  if (npcs.length === 0) {
    console.log('No NPCs to migrate. Exiting.');
    return;
  }

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const npc of npcs) {
    console.log(`\nMigrating: ${npc.name} (${npc.id})`);

    try {
      // Check if user already exists with this ID (in case of partial migration)
      const existingUser = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, npc.id))
        .limit(1);

      if (existingUser.length > 0) {
        console.log(`  - User already exists, skipping`);
        skipped++;
        continue;
      }

      // Check if username is taken
      const existingUsername = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, npc.name))
        .limit(1);

      let username = npc.name;
      if (existingUsername.length > 0) {
        // Append random suffix
        username = `${npc.name}_${Math.random().toString(36).substring(2, 6)}`;
        console.log(`  - Username taken, using: ${username}`);
      }

      // Generate personality from visual prompt
      console.log(`  - Generating personality...`);
      const personality = await generatePersonality(npc.prompt);
      console.log(`  - Personality: ${personality.substring(0, 80)}...`);

      // Create user with NPC ID
      const [user] = await db
        .insert(schema.users)
        .values({
          id: npc.id, // Use same ID for sprite file compatibility
          username,
          isNpc: true,
          personality,
          goals: ['Explore the area', 'Greet players who pass by', 'Have friendly conversations'],
          visualPrompt: npc.prompt,
          aiProvider: 'openai',
          aiModel: 'gpt-4o-mini',
          decisionIntervalMs: 300000, // 5 minutes
          spawnX: npc.spawnX,
          spawnY: npc.spawnY,
          roamRadius: npc.roamRadius,
          npcCreatorId: npc.creatorId,
        })
        .returning();

      if (!user) {
        throw new Error('Failed to create user');
      }

      // Create player_state at spawn position
      await db.insert(schema.playerState).values({
        userId: npc.id,
        x: npc.spawnX,
        y: npc.spawnY,
        direction: 'down',
        isOnline: false,
      });

      console.log(`  - Created user and player_state at (${npc.spawnX}, ${npc.spawnY})`);
      migrated++;

    } catch (error) {
      console.error(`  - Error: ${error}`);
      errors++;
    }
  }

  console.log('\n=== Migration Complete ===');
  console.log(`Migrated: ${migrated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);

  if (migrated > 0) {
    console.log('\nNote: NPC sprites are still stored on disk.');
    console.log('The NPCBotManager will use the existing sprite files.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
