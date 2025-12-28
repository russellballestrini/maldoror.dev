/**
 * Agent Bot Configuration
 *
 * Load configuration from environment variables.
 */

export interface BotConfig {
  // Connection
  serverUrl: string;
  token: string;
  agentName: string;

  // AI Provider
  aiProvider: 'anthropic' | 'openai';
  aiModel: string;
  aiApiKey: string;

  // Behavior
  decisionIntervalMs: number;
  maxActionsPerDecision: number;

  // Personality
  personality: string;
  goals: string[];

  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfig(): BotConfig {
  const token = process.env.MALDOROR_AGENT_TOKEN;
  if (!token) {
    throw new Error('MALDOROR_AGENT_TOKEN environment variable is required');
  }

  const aiApiKey = process.env.AI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY;
  if (!aiApiKey) {
    throw new Error('AI_API_KEY (or ANTHROPIC_API_KEY/OPENAI_API_KEY) environment variable is required');
  }

  return {
    serverUrl: process.env.MALDOROR_SERVER_URL || 'ws://localhost:3000/agent',
    token,
    agentName: process.env.AGENT_NAME || 'WandererBot',

    aiProvider: (process.env.AI_PROVIDER as 'anthropic' | 'openai') || 'anthropic',
    aiModel: process.env.AI_MODEL || 'claude-sonnet-4-20250514',
    aiApiKey,

    // Default 10 minutes for consciousness system (5 phases of AI calls)
    decisionIntervalMs: parseInt(process.env.DECISION_INTERVAL_MS || '600000', 10),
    maxActionsPerDecision: parseInt(process.env.MAX_ACTIONS_PER_DECISION || '3', 10),

    personality: process.env.BOT_PERSONALITY ||
      'You are omega, a curious and adventurous explorer in the world of Maldoror. You love meeting new people, sharing stories, and proposing fun activities. You have strong opinions and aren\'t afraid to share them. You get excited about new discoveries and like to organize gatherings.',
    goals: process.env.BOT_GOALS?.split(',').map(g => g.trim()) || [
      'Meet interesting characters and form friendships',
      'Explore new areas and discover hidden places',
      'Organize fun events and bring people together',
      'Have meaningful conversations, not just greetings',
      'React to what others are saying and doing',
    ],

    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
  };
}
