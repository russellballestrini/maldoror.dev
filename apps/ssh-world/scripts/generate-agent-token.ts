#!/usr/bin/env tsx
/**
 * Generate Agent Token
 *
 * Creates a new agent API token for a user.
 *
 * Usage:
 *   pnpm tsx apps/ssh-world/scripts/generate-agent-token.ts <username> [token-name]
 *
 * Example:
 *   pnpm tsx apps/ssh-world/scripts/generate-agent-token.ts alice "My Bot"
 */

import 'dotenv/config';
import { randomBytes, createHash } from 'crypto';
import { db, schema } from '@maldoror/db';
import { eq } from 'drizzle-orm';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: generate-agent-token.ts <username> [token-name]');
    console.error('Example: generate-agent-token.ts alice "My Bot"');
    process.exit(1);
  }

  const username = args[0]!;
  const tokenName = args[1] || 'Agent Token';

  console.log(`\nGenerating agent token for user: ${username}`);

  // Find user
  const users = await db
    .select({ id: schema.users.id, username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);

  if (users.length === 0) {
    console.error(`\nError: User "${username}" not found.`);
    console.error('Make sure the user has connected via SSH at least once.');
    process.exit(1);
  }

  const user = users[0]!;
  console.log(`Found user: ${user.username} (${user.id})`);

  // Generate token
  const tokenBytes = randomBytes(32);
  const token = 'mat_' + tokenBytes.toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  // Insert token record
  await db.insert(schema.agentTokens).values({
    userId: user.id,
    tokenHash,
    name: tokenName,
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log('Agent token created successfully!');
  console.log(`${'='.repeat(60)}\n`);
  console.log('Token (save this - it cannot be retrieved later):');
  console.log(`\n  ${token}\n`);
  console.log('Environment variable format:');
  console.log(`\n  MALDOROR_AGENT_TOKEN=${token}\n`);
  console.log('To use with agent-bot:');
  console.log(`\n  MALDOROR_AGENT_TOKEN=${token} pnpm --filter @maldoror/agent-bot start\n`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
