/**
 * @maldoror/agent
 *
 * SDK for building AI agents that interact with the Maldoror world.
 *
 * @example
 * ```typescript
 * import { MaldororAgentClient } from '@maldoror/agent';
 *
 * const client = new MaldororAgentClient({
 *   serverUrl: 'ws://abyss.maldoror.dev/agent',
 *   token: 'mat_your_token_here',
 * });
 *
 * await client.connect();
 *
 * await client.subscribe({
 *   observations: true,
 *   terrain: true,
 *   chat: true,
 * });
 *
 * client.on('observation', (obs) => {
 *   console.log('Position:', obs.self.x, obs.self.y);
 * });
 *
 * await client.move('up');
 * await client.chat('Hello world!');
 * ```
 */

// Client
export { MaldororAgentClient, type AgentClientConfig, type AgentClientEvents } from './client.js';

// Types
export * from './types.js';

// Helpers
export * from './helpers.js';
