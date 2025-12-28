/**
 * Maldoror Agent Bot - Entry Point
 *
 * An LLM-powered bot that connects to the Maldoror world via WebSocket
 * and autonomously explores, interacts with players, and performs actions.
 */

import 'dotenv/config';
import { loadConfig } from './config.js';
import { MaldororBot } from './bot.js';

async function main() {
  console.log('=== Maldoror Agent Bot ===\n');

  try {
    const config = loadConfig();
    const bot = new MaldororBot(config);

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\nShutting down...');
      await bot.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await bot.start();

    // Keep process alive
    await new Promise(() => {});
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
