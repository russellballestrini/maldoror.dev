import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { db, schema } from '@maldoror/db';
import { sql, count, min, max, eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import type { WorkerManager } from './worker-manager.js';
import { resourceMonitor } from '../utils/resource-monitor.js';
import {
  getUnifiedActivities,
  formatActivityForDisplay,
  type UnifiedActivityEntry,
} from './activity-logger.js';
import type { PixelGrid } from '@maldoror/protocol';

// Asset directories
const BUILDINGS_DIR = process.env.BUILDINGS_DIR || '/app/buildings';
const SPRITES_DIR = process.env.SPRITES_DIR || '/app/sprites';
const NPCS_DIR = process.env.NPCS_DIR || '/app/npcs';
const MODELS_DIR = process.env.MODELS_DIR || '/app/models';
const WEB_DIST_DIR = process.env.WEB_DIST_DIR || '/app/apps/web/dist';

// Log capture ring buffer
const MAX_LOG_LINES = 2000;
const logBuffer: { timestamp: Date; level: string; message: string }[] = [];

// Bot activity ring buffer
const MAX_BOT_ENTRIES = 500;
export interface BotLogEntry {
  timestamp: Date;
  type: 'observation' | 'decision' | 'action' | 'error' | 'info';
  agentName: string;
  data: {
    position?: { x: number; y: number };
    nearbyPlayers?: string[];
    nearbyNpcs?: string[];
    llmPrompt?: string;
    llmResponse?: string;
    actions?: Array<{ type: string; direction?: string; message?: string }>;
    error?: string;
    message?: string;
    tokens?: { input: number; output: number };
  };
}
const botActivityBuffer: BotLogEntry[] = [];

export function addBotActivity(entry: Omit<BotLogEntry, 'timestamp'>): void {
  botActivityBuffer.push({ ...entry, timestamp: new Date() });
  while (botActivityBuffer.length > MAX_BOT_ENTRIES) {
    botActivityBuffer.shift();
  }
}

function nanosecondsToMilliseconds(value: number): number {
  return roundRuntimeMetric(value / 1e6);
}

function roundRuntimeMetric(value: number): number {
  return Number(value.toFixed(3));
}

export function getBotActivity(): BotLogEntry[] {
  return botActivityBuffer;
}

// Global chat message buffer
const MAX_CHAT_ENTRIES = 200;
export interface ChatMessage {
  timestamp: Date;
  senderId: string;
  senderName: string;
  senderType: 'player' | 'auton';
  message: string;
  position?: { x: number; y: number };
}
const chatBuffer: ChatMessage[] = [];

export function addChatMessage(entry: Omit<ChatMessage, 'timestamp'>): void {
  chatBuffer.push({ ...entry, timestamp: new Date() });
  while (chatBuffer.length > MAX_CHAT_ENTRIES) {
    chatBuffer.shift();
  }
}

export function getChatMessages(): ChatMessage[] {
  return chatBuffer;
}

function captureLog(level: string, ...args: unknown[]): void {
  const message = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');

  logBuffer.push({ timestamp: new Date(), level, message });

  // Trim buffer if too large
  while (logBuffer.length > MAX_LOG_LINES) {
    logBuffer.shift();
  }
}

// Intercept console methods
const originalLog = console.log.bind(console);
const originalError = console.error.bind(console);
const originalWarn = console.warn.bind(console);

console.log = (...args: unknown[]) => {
  captureLog('INFO', ...args);
  originalLog(...args);
};

console.error = (...args: unknown[]) => {
  captureLog('ERROR', ...args);
  originalError(...args);
};

console.warn = (...args: unknown[]) => {
  captureLog('WARN', ...args);
  originalWarn(...args);
};

// Export for external access
export function getLogs(): typeof logBuffer {
  return logBuffer;
}

interface TransportMetrics {
  queuedBytes: number;
  droppedFrames: number;
  drainCount: number;
  totalBytesWritten: number;
  peakQueuedBytes: number;
  totalFramesWritten: number;
  keyframesAccepted: number;
  recoveryKeyframesAccepted: number;
  recoveryRequests: number;
}

interface StatsServerConfig {
  port: number;
  host?: string;
  getSessionCount: () => number;
  getTransportMetrics?: () => TransportMetrics[];  // Returns metrics from all active sessions
  workerManager: WorkerManager;
  worldSeed: bigint;
  startTime: Date;
}

interface WorldStats {
  server: {
    uptime_seconds: number;
    uptime_human: string;
    memory: {
      rss_mb: number;
      heap_used_mb: number;
      heap_total_mb: number;
      external_mb: number;
      array_buffers_mb: number;
    };
    active_sessions: number;
    node_version: string;
    started_at: string;
    pid: number;
    platform: string;
  };
  world: {
    seed: string;
    name: string;
    bounds: {
      min_x: number | null;
      max_x: number | null;
      min_y: number | null;
      max_y: number | null;
      width: number | null;
      height: number | null;
      area_tiles: number | null;
    };
  };
  players: {
    total_registered: number;
    online_now: number;
    with_avatars: number;
  };
  buildings: {
    total_placed: number;
    total_tiles: number;
  };
  sprites: {
    total_frames: number;
    unique_users_with_sprites: number;
  };
  database: {
    users: number;
    user_keys: number;
    avatars: number;
    player_states: number;
    buildings: number;
    building_tiles: number;
    sprite_frames: number;
  };
  transport?: {
    total_sessions: number;
    total_queued_bytes: number;
    total_dropped_frames: number;
    total_drain_events: number;
    total_bytes_written: number;
    peak_queued_bytes: number;
    total_frames_written: number;
    keyframes_accepted: number;
    recovery_keyframes_accepted: number;
    recovery_requests: number;
  };
}

// Cache stats for 30 seconds to avoid hammering DB
const STATS_CACHE_TTL_MS = 30000;

export class StatsServer {
  private server: ReturnType<typeof createServer>;
  private config: StatsServerConfig;
  private statsCache: { data: WorldStats; timestamp: number } | null = null;
  private readonly eventLoopDelay = monitorEventLoopDelay({ resolution: 1 });
  private lastRuntimeSampleAt = performance.now();
  private lastCpuUsage = process.cpuUsage();
  private lastEventLoopUtilization = performance.eventLoopUtilization();

  constructor(config: StatsServerConfig) {
    this.config = config;
    this.server = createServer(this.handleRequest.bind(this));
    this.eventLoopDelay.enable();
  }

  start(): Promise<void> {
    const host = this.config.host ?? '0.0.0.0';
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server.once('error', onError);
      this.server.listen(this.config.port, host, () => {
        this.server.off('error', onError);
        console.log(`Stats server listening on http://${host}:${this.config.port}/stats`);
        resolve();
      });
    });
  }

  stop(): void {
    this.eventLoopDelay.disable();
    this.server.close();
  }

  /**
   * Get the underlying HTTP server for WebSocket upgrades
   */
  getHttpServer(): ReturnType<typeof createServer> {
    return this.server;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (url.pathname === '/runtime' || url.pathname === '/runtime/') {
      try {
        const sample = await this.sampleRuntime();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(sample, null, 2));
      } catch (error) {
        console.error('Error sampling runtime:', error);
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Worker runtime sample unavailable' }));
      }
    } else if (url.pathname === '/stats' || url.pathname === '/stats/') {
      try {
        const stats = await this.getCachedStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats, null, 2));
      } catch (error) {
        console.error('Error gathering stats:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to gather stats' }));
      }
    } else if (url.pathname === '/health' || url.pathname === '/health/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    } else if (url.pathname === '/operations' || url.pathname === '/operations/') {
      // Check for active generation operations (used by deploy script)
      const activeOps = resourceMonitor.getActiveOperations();
      const hasActiveGenerations = resourceMonitor.hasActiveGenerations();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        active_operations: activeOps,
        has_active_generations: hasActiveGenerations,
        safe_to_deploy: !hasActiveGenerations,
        timestamp: new Date().toISOString(),
      }));
    } else if (url.pathname === '/logs' || url.pathname === '/logs/') {
      this.serveLogsPage(req, res, url);
    } else if (url.pathname === '/bot-logs' || url.pathname === '/bot-logs/') {
      if (req.method === 'POST') {
        await this.handleBotLogPost(req, res);
      } else {
        this.serveBotLogsPage(req, res, url);
      }
    } else if (url.pathname === '/api/bot-activity' || url.pathname === '/api/bot-activity/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getBotActivity(), null, 2));
    } else if (url.pathname === '/api/chat' || url.pathname === '/api/chat/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getChatMessages(), null, 2));
    } else if (url.pathname === '/api/activity' || url.pathname === '/api/activity/') {
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getUnifiedActivities(limit), null, 2));
    } else if (url.pathname === '/chat' || url.pathname === '/chat/') {
      this.serveGlobalChatPage(req, res, url);
    } else if (url.pathname === '/api/world' || url.pathname === '/api/world/') {
      try {
        const worldData = await this.getWorldData();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(worldData, null, 2));
      } catch (error) {
        console.error('Error getting world data:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to get world data' }));
      }
    } else if (url.pathname === '/api/entities' || url.pathname === '/api/entities/') {
      try {
        const entities = await this.getEntities();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(entities, null, 2));
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : '';
        console.error('Error getting entities:', errorMsg, errorStack);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to get entities', details: errorMsg }));
      }
    } else if (url.pathname === '/api/terrain-tiles' || url.pathname === '/api/terrain-tiles/') {
      try {
        const terrainTiles = await this.getTerrainTiles();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(terrainTiles, null, 2));
      } catch (error) {
        console.error('Error getting terrain tiles:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to get terrain tiles' }));
      }
    } else if (url.pathname.startsWith('/api/terrain-chunks')) {
      // Get terrain chunk data for 3D rendering
      try {
        const chunks = await this.getTerrainChunks();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(chunks, null, 2));
      } catch (error) {
        console.error('Error getting terrain chunks:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to get terrain chunks' }));
      }
    } else if (url.pathname.startsWith('/files/terrain/')) {
      // Serve terrain tile PNGs dynamically from database
      await this.serveTerrainTile(req, res, url.pathname);
    } else if (url.pathname === '/files' || url.pathname === '/files/') {
      // File browser index
      this.serveFileBrowserIndex(res);
    } else if (url.pathname.startsWith('/files/buildings')) {
      // Serve buildings directory
      await this.serveAssetPath(req, res, url.pathname.replace('/files/buildings', ''), BUILDINGS_DIR, 'buildings');
    } else if (url.pathname.startsWith('/files/sprites')) {
      // Serve sprites - try file system first, then database
      await this.serveSpriteFromDbOrFile(req, res, url.pathname);
    } else if (url.pathname.startsWith('/files/npcs')) {
      // Serve NPCs directory
      await this.serveAssetPath(req, res, url.pathname.replace('/files/npcs', ''), NPCS_DIR, 'npcs');
    } else if (url.pathname.startsWith('/files/models')) {
      // Serve 3D models directory (GLB files)
      await this.serveAssetPath(req, res, url.pathname.replace('/files/models', ''), MODELS_DIR, 'models');
    } else {
      // Serve web app static files from root
      await this.serveWebApp(req, res, url);
    }
  }

  /**
   * Serve the web app static files
   */
  private async serveWebApp(_req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    try {
      // Determine file path
      let filePath = url.pathname;
      if (filePath === '/' || filePath === '') {
        filePath = '/index.html';
      }

      const fullPath = path.join(WEB_DIST_DIR, filePath);

      // Security: prevent directory traversal
      if (!fullPath.startsWith(WEB_DIST_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      // Try to read the file
      const stat = await fs.promises.stat(fullPath).catch(() => null);

      if (stat && stat.isFile()) {
        await this.serveFile(res, fullPath);
      } else {
        // For SPA routing, serve index.html for non-file paths
        const indexPath = path.join(WEB_DIST_DIR, 'index.html');
        const indexStat = await fs.promises.stat(indexPath).catch(() => null);

        if (indexStat && indexStat.isFile()) {
          await this.serveFile(res, indexPath);
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Not found',
            endpoints: ['/stats', '/health', '/operations', '/logs', '/api/world', '/api/entities', '/files']
          }));
        }
      }
    } catch (error) {
      console.error('Error serving web app:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }

  private serveLogsPage(_req: IncomingMessage, res: ServerResponse, url: URL): void {
    // Check for JSON format
    const format = url.searchParams.get('format');
    if (format === 'json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(logBuffer, null, 2));
      return;
    }

    // Check for plain text format
    if (format === 'text') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      const text = logBuffer.map(entry => {
        const ts = entry.timestamp.toISOString().replace('T', ' ').replace('Z', '');
        return `[${ts}] [${entry.level}] ${entry.message}`;
      }).join('\n');
      res.end(text);
      return;
    }

    // Filter by level
    const levelFilter = url.searchParams.get('level')?.toUpperCase();
    const filteredLogs = levelFilter
      ? logBuffer.filter(entry => entry.level === levelFilter)
      : logBuffer;

    // Auto-refresh interval (default 5 seconds)
    const refresh = parseInt(url.searchParams.get('refresh') || '5', 10);

    const escapeHtml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };

    const formatTimestamp = (date: Date): string => {
      return date.toISOString().replace('T', ' ').replace('Z', '');
    };

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="${refresh}">
  <title>Maldoror Server Logs</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
      background: #0a0a0f;
      color: #e0e0e0;
      margin: 0;
      padding: 20px;
      line-height: 1.4;
      font-size: 12px;
    }
    h1 { color: #ff9900; margin-bottom: 5px; font-size: 1.4em; }
    .subtitle { color: #666; margin-bottom: 15px; font-size: 0.9em; }
    .controls {
      display: flex;
      gap: 15px;
      margin-bottom: 15px;
      flex-wrap: wrap;
      align-items: center;
    }
    .controls a, .controls select {
      background: #1a1a25;
      color: #66aaff;
      padding: 6px 12px;
      border-radius: 4px;
      text-decoration: none;
      border: 1px solid #333;
      font-size: 0.85em;
    }
    .controls a:hover { background: #252535; }
    .controls a.active { background: #333; color: #fff; }
    .controls select { cursor: pointer; }
    .stats {
      color: #888;
      font-size: 0.85em;
    }
    .log-container {
      background: #0d0d12;
      border: 1px solid #222;
      border-radius: 8px;
      overflow: auto;
      max-height: calc(100vh - 180px);
    }
    .log-entry {
      padding: 4px 12px;
      border-bottom: 1px solid #1a1a1f;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .log-entry:hover { background: #151520; }
    .log-entry:last-child { border-bottom: none; }
    .log-timestamp { color: #555; margin-right: 10px; }
    .log-level {
      display: inline-block;
      width: 50px;
      font-weight: bold;
      margin-right: 10px;
    }
    .log-message { color: #ccc; }
    .level-ERROR { color: #ff6b6b; }
    .level-WARN { color: #ffd93d; }
    .level-INFO { color: #6bcb77; }
    .empty { color: #666; padding: 40px; text-align: center; }
    .scroll-bottom {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #333;
      color: #fff;
      padding: 10px 15px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85em;
      border: none;
    }
    .scroll-bottom:hover { background: #444; }
  </style>
</head>
<body>
  <h1>Server Logs</h1>
  <p class="subtitle">Auto-refreshes every ${refresh}s • Last ${filteredLogs.length} entries</p>

  <div class="controls">
    <a href="/logs" class="${!levelFilter ? 'active' : ''}">All</a>
    <a href="/logs?level=info" class="${levelFilter === 'INFO' ? 'active' : ''}">Info</a>
    <a href="/logs?level=warn" class="${levelFilter === 'WARN' ? 'active' : ''}">Warn</a>
    <a href="/logs?level=error" class="${levelFilter === 'ERROR' ? 'active' : ''}">Error</a>
    <span class="stats">|</span>
    <a href="/logs?format=json">JSON</a>
    <a href="/logs?format=text">Plain Text</a>
    <span class="stats">|</span>
    <span class="stats">Refresh:
      <a href="/logs?refresh=2${levelFilter ? '&level=' + levelFilter.toLowerCase() : ''}" class="${refresh === 2 ? 'active' : ''}">2s</a>
      <a href="/logs?refresh=5${levelFilter ? '&level=' + levelFilter.toLowerCase() : ''}" class="${refresh === 5 ? 'active' : ''}">5s</a>
      <a href="/logs?refresh=30${levelFilter ? '&level=' + levelFilter.toLowerCase() : ''}" class="${refresh === 30 ? 'active' : ''}">30s</a>
      <a href="/logs?refresh=0${levelFilter ? '&level=' + levelFilter.toLowerCase() : ''}" class="${refresh === 0 ? 'active' : ''}">off</a>
    </span>
  </div>

  <div class="log-container" id="logs">
    ${filteredLogs.length === 0 ? '<div class="empty">No logs yet</div>' : ''}
    ${filteredLogs.map(entry => `
      <div class="log-entry">
        <span class="log-timestamp">${formatTimestamp(entry.timestamp)}</span>
        <span class="log-level level-${entry.level}">${entry.level}</span>
        <span class="log-message">${escapeHtml(entry.message)}</span>
      </div>
    `).join('')}
  </div>

  <button class="scroll-bottom" onclick="scrollToBottom()">↓ Scroll to Bottom</button>

  <script>
    function scrollToBottom() {
      const container = document.getElementById('logs');
      container.scrollTop = container.scrollHeight;
    }
    // Auto-scroll to bottom on load
    scrollToBottom();
  </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  private async handleBotLogPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf-8');
      const entry = JSON.parse(body) as Omit<BotLogEntry, 'timestamp'>;
      addBotActivity(entry);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request' }));
    }
  }

  private serveBotLogsPage(_req: IncomingMessage, res: ServerResponse, url: URL): void {
    const format = url.searchParams.get('format');
    if (format === 'json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getBotActivity(), null, 2));
      return;
    }

    const refresh = parseInt(url.searchParams.get('refresh') || '5', 10);
    const activity = getBotActivity();

    const escapeHtml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };

    const formatTimestamp = (date: Date): string => {
      return date.toISOString().replace('T', ' ').replace('Z', '');
    };

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${refresh > 0 ? `<meta http-equiv="refresh" content="${refresh}">` : ''}
  <title>Maldoror Bot Activity</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
      background: #0a0a0f;
      color: #e0e0e0;
      margin: 0;
      padding: 20px;
      line-height: 1.4;
      font-size: 12px;
    }
    h1 { color: #ff9900; margin-bottom: 5px; font-size: 1.4em; }
    .subtitle { color: #666; margin-bottom: 15px; font-size: 0.9em; }
    .controls {
      display: flex;
      gap: 15px;
      margin-bottom: 15px;
      flex-wrap: wrap;
      align-items: center;
    }
    .controls a {
      background: #1a1a25;
      color: #66aaff;
      padding: 6px 12px;
      border-radius: 4px;
      text-decoration: none;
      border: 1px solid #333;
      font-size: 0.85em;
    }
    .controls a:hover { background: #252535; }
    .controls a.active { background: #333; color: #fff; }
    .stats { color: #888; font-size: 0.85em; }
    .activity-container {
      background: #0d0d12;
      border: 1px solid #222;
      border-radius: 8px;
      overflow: auto;
      max-height: calc(100vh - 180px);
    }
    .entry {
      padding: 12px 15px;
      border-bottom: 1px solid #1a1a1f;
    }
    .entry:hover { background: #151520; }
    .entry:last-child { border-bottom: none; }
    .entry-header {
      display: flex;
      gap: 15px;
      align-items: center;
      margin-bottom: 8px;
    }
    .timestamp { color: #555; }
    .type {
      font-weight: bold;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.8em;
    }
    .type-observation { background: #1a3a4a; color: #6bcb77; }
    .type-decision { background: #3a3a1a; color: #ffd93d; }
    .type-action { background: #3a1a3a; color: #ff9900; }
    .type-error { background: #4a1a1a; color: #ff6b6b; }
    .type-info { background: #1a1a3a; color: #66aaff; }
    .agent-name { color: #888; }
    .entry-content { color: #aaa; }
    .position { color: #66ff99; }
    .players, .npcs { color: #66aaff; }
    .llm-section {
      margin-top: 10px;
      padding: 10px;
      background: #0a0a10;
      border-radius: 4px;
      border-left: 3px solid #333;
    }
    .llm-label { color: #666; font-size: 0.8em; margin-bottom: 5px; }
    .llm-content { white-space: pre-wrap; color: #ccc; font-size: 0.9em; }
    .actions-list { color: #ff9900; margin-top: 5px; }
    .error-msg { color: #ff6b6b; }
    .empty { color: #666; padding: 40px; text-align: center; }
    .scroll-bottom {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #333;
      color: #fff;
      padding: 10px 15px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85em;
      border: none;
    }
    .scroll-bottom:hover { background: #444; }
  </style>
</head>
<body>
  <h1>🤖 Bot Activity Log</h1>
  <p class="subtitle">Showing ${activity.length} entries • ${refresh > 0 ? `Auto-refreshes every ${refresh}s` : 'Auto-refresh off'}</p>

  <div class="controls">
    <a href="/bot-logs?format=json">JSON</a>
    <span class="stats">|</span>
    <span class="stats">Refresh:
      <a href="/bot-logs?refresh=2" class="${refresh === 2 ? 'active' : ''}">2s</a>
      <a href="/bot-logs?refresh=5" class="${refresh === 5 ? 'active' : ''}">5s</a>
      <a href="/bot-logs?refresh=30" class="${refresh === 30 ? 'active' : ''}">30s</a>
      <a href="/bot-logs?refresh=0" class="${refresh === 0 ? 'active' : ''}">off</a>
    </span>
    <span class="stats">|</span>
    <a href="/logs">Server Logs</a>
  </div>

  <div class="activity-container" id="activity">
    ${activity.length === 0 ? '<div class="empty">No bot activity yet. Waiting for bot to connect...</div>' : ''}
    ${activity.map(entry => {
      const d = entry.data;
      let content = '';

      if (d.position) {
        content += `<span class="position">📍 Position: (${d.position.x}, ${d.position.y})</span>`;
      }
      if (d.nearbyPlayers && d.nearbyPlayers.length > 0) {
        content += `<br><span class="players">👥 Players: ${escapeHtml(d.nearbyPlayers.join(', '))}</span>`;
      }
      if (d.nearbyNpcs && d.nearbyNpcs.length > 0) {
        content += `<br><span class="npcs">🎭 NPCs: ${escapeHtml(d.nearbyNpcs.join(', '))}</span>`;
      }
      if (d.message) {
        content += `<br>${escapeHtml(d.message)}`;
      }
      if (d.error) {
        content += `<br><span class="error-msg">❌ ${escapeHtml(d.error)}</span>`;
      }
      if (d.actions && d.actions.length > 0) {
        const actionStrs = d.actions.map(a => {
          if (a.type === 'move') return `move ${a.direction}`;
          if (a.type === 'chat') return `say "${escapeHtml(a.message || '')}"`;
          return a.type;
        });
        content += `<div class="actions-list">⚡ Actions: ${actionStrs.join(', ')}</div>`;
      }

      let llmSection = '';
      if (d.llmPrompt) {
        llmSection += `<div class="llm-section"><div class="llm-label">📝 LLM Prompt:</div><div class="llm-content">${escapeHtml(d.llmPrompt)}</div></div>`;
      }
      if (d.llmResponse) {
        llmSection += `<div class="llm-section"><div class="llm-label">🤖 LLM Response:</div><div class="llm-content">${escapeHtml(d.llmResponse)}</div></div>`;
      }

      return `
        <div class="entry">
          <div class="entry-header">
            <span class="timestamp">${formatTimestamp(new Date(entry.timestamp))}</span>
            <span class="type type-${entry.type}">${entry.type.toUpperCase()}</span>
            <span class="agent-name">${escapeHtml(entry.agentName)}</span>
          </div>
          <div class="entry-content">${content}</div>
          ${llmSection}
        </div>
      `;
    }).join('')}
  </div>

  <button class="scroll-bottom" onclick="scrollToBottom()">↓ Scroll to Bottom</button>

  <script>
    function scrollToBottom() {
      const container = document.getElementById('activity');
      container.scrollTop = container.scrollHeight;
    }
    scrollToBottom();
  </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  private serveGlobalChatPage(_req: IncomingMessage, res: ServerResponse, url: URL): void {
    const format = url.searchParams.get('format');
    const mode = url.searchParams.get('mode') || 'activity'; // 'chat' or 'activity'

    if (format === 'json') {
      if (mode === 'activity') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getUnifiedActivities(200), null, 2));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getChatMessages(), null, 2));
      }
      return;
    }

    const refresh = parseInt(url.searchParams.get('refresh') || '5', 10);
    const chatMessages = getChatMessages();
    const activities = getUnifiedActivities(200);

    const escapeHtml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };

    const formatTimestamp = (date: Date): string => {
      return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    };

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${refresh > 0 ? `<meta http-equiv="refresh" content="${refresh}">` : ''}
  <title>Maldoror Global Chat</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
      background: #0a0a0f;
      color: #e0e0e0;
      margin: 0;
      padding: 20px;
      line-height: 1.4;
      font-size: 13px;
    }
    h1 { color: #ff9900; margin-bottom: 5px; font-size: 1.4em; }
    .subtitle { color: #666; margin-bottom: 15px; font-size: 0.9em; }
    .controls {
      display: flex;
      gap: 15px;
      margin-bottom: 15px;
      flex-wrap: wrap;
      align-items: center;
    }
    .controls a {
      background: #1a1a25;
      color: #66aaff;
      padding: 6px 12px;
      border-radius: 4px;
      text-decoration: none;
      border: 1px solid #333;
      font-size: 0.85em;
    }
    .controls a:hover { background: #252535; }
    .controls a.active { background: #333; color: #fff; }
    .stats { color: #888; font-size: 0.85em; }
    .chat-container {
      background: #0d0d12;
      border: 1px solid #222;
      border-radius: 8px;
      overflow: auto;
      max-height: calc(100vh - 180px);
      padding: 10px;
    }
    .message {
      padding: 8px 12px;
      margin: 5px 0;
      border-radius: 6px;
      background: #151520;
    }
    .message:hover { background: #1a1a28; }
    .message-header {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 5px;
    }
    .timestamp { color: #555; font-size: 0.8em; }
    .sender {
      font-weight: bold;
    }
    .sender-player { color: #66ff99; }
    .sender-npc { color: #ff9900; }
    .sender-bot { color: #ff66aa; }
    .sender-type {
      font-size: 0.7em;
      padding: 2px 6px;
      border-radius: 3px;
      text-transform: uppercase;
    }
    .type-player { background: #1a3a2a; color: #66ff99; }
    .type-npc { background: #3a2a1a; color: #ff9900; }
    .type-bot { background: #3a1a2a; color: #ff66aa; }
    .position { color: #666; font-size: 0.75em; }
    .message-text {
      color: #ddd;
      margin-left: 2px;
    }
    .action-message {
      background: #12121a;
      border-left: 3px solid #555;
    }
    .action-text {
      color: #aaa;
      font-style: italic;
    }
    .empty { color: #666; padding: 40px; text-align: center; }
    .scroll-bottom {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #333;
      color: #fff;
      padding: 10px 15px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85em;
      border: none;
    }
    .scroll-bottom:hover { background: #444; }
  </style>
</head>
<body>
  <h1>World Activity</h1>
  <p class="subtitle">${mode === 'activity' ? 'All activity (chat, actions, events)' : 'Chat messages only'} • ${mode === 'activity' ? activities.length : chatMessages.length} entries</p>

  <div class="controls">
    <span class="stats">View:
      <a href="/chat?mode=activity&refresh=${refresh}" class="${mode === 'activity' ? 'active' : ''}">Timeline</a>
      <a href="/chat?mode=chat&refresh=${refresh}" class="${mode === 'chat' ? 'active' : ''}">Chat Only</a>
    </span>
    <span class="stats">|</span>
    <a href="/chat?mode=${mode}&format=json">JSON</a>
    <span class="stats">|</span>
    <span class="stats">Refresh:
      <a href="/chat?mode=${mode}&refresh=2" class="${refresh === 2 ? 'active' : ''}">2s</a>
      <a href="/chat?mode=${mode}&refresh=5" class="${refresh === 5 ? 'active' : ''}">5s</a>
      <a href="/chat?mode=${mode}&refresh=30" class="${refresh === 30 ? 'active' : ''}">30s</a>
      <a href="/chat?mode=${mode}&refresh=0" class="${refresh === 0 ? 'active' : ''}">off</a>
    </span>
    <span class="stats">|</span>
    <a href="/bot-logs">Bot Logs</a>
    <a href="/logs">Server Logs</a>
  </div>

  <div class="chat-container" id="chat">
    ${mode === 'activity' ? (
      activities.length === 0 ? '<div class="empty">No activity yet. The world is waiting...</div>' :
      activities.map((act: UnifiedActivityEntry) => `
        <div class="message ${act.activityType !== 'chat' ? 'action-message' : ''}">
          <div class="message-header">
            <span class="timestamp">${formatTimestamp(act.timestamp)}</span>
            <span class="sender sender-${act.actorType}">${escapeHtml(act.actorName)}</span>
            <span class="sender-type type-${act.actorType}">${act.actorType}</span>
            ${act.locationX !== undefined ? `<span class="position">(${act.locationX}, ${act.locationY})</span>` : ''}
          </div>
          <div class="message-text ${act.activityType !== 'chat' ? 'action-text' : ''}">${escapeHtml(formatActivityForDisplay(act))}</div>
        </div>
      `).join('')
    ) : (
      chatMessages.length === 0 ? '<div class="empty">No chat messages yet. Waiting for someone to speak...</div>' :
      chatMessages.map(msg => `
        <div class="message">
          <div class="message-header">
            <span class="timestamp">${formatTimestamp(new Date(msg.timestamp))}</span>
            <span class="sender sender-${msg.senderType}">${escapeHtml(msg.senderName)}</span>
            <span class="sender-type type-${msg.senderType}">${msg.senderType}</span>
            ${msg.position ? `<span class="position">(${msg.position.x}, ${msg.position.y})</span>` : ''}
          </div>
          <div class="message-text">${escapeHtml(msg.message)}</div>
        </div>
      `).join('')
    )}
  </div>

  <button class="scroll-bottom" onclick="scrollToBottom()">↓ Scroll to Bottom</button>

  <script>
    function scrollToBottom() {
      const container = document.getElementById('chat');
      container.scrollTop = container.scrollHeight;
    }
    scrollToBottom();
  </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  private serveFileBrowserIndex(res: ServerResponse): void {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Maldoror Asset Browser</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
      background: #0a0a0f;
      color: #e0e0e0;
      margin: 0;
      padding: 20px;
      line-height: 1.6;
    }
    h1 { color: #ff9900; margin-bottom: 10px; }
    h2 { color: #66aaff; margin-top: 30px; }
    .subtitle { color: #666; margin-bottom: 30px; }
    a { color: #66ff99; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .card {
      background: #151520;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
      margin: 10px 0;
    }
    .card h3 { margin-top: 0; color: #ff9900; }
  </style>
</head>
<body>
  <h1>Maldoror Asset Browser</h1>
  <p class="subtitle">Browse generated game assets</p>

  <div class="card">
    <h3>Buildings</h3>
    <p>AI-generated building sprites (3x3 tile grids, 4 directions each)</p>
    <a href="/files/buildings/">Browse Buildings →</a>
  </div>

  <div class="card">
    <h3>Sprites</h3>
    <p>Player avatar sprites (4 directions, 2 frames each)</p>
    <a href="/files/sprites/">Browse Sprites →</a>
  </div>

  <h2>API Endpoints</h2>
  <ul>
    <li><a href="/stats">/stats</a> - Server statistics (JSON)</li>
    <li><a href="/health">/health</a> - Health check</li>
  </ul>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  private async serveAssetPath(
    _req: IncomingMessage,
    res: ServerResponse,
    subPath: string,
    baseDir: string,
    category: string
  ): Promise<void> {
    // Normalize and sanitize path
    const safePath = path.normalize(subPath).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(baseDir, safePath);

    // Prevent directory traversal
    if (!fullPath.startsWith(baseDir)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    try {
      const stat = await fs.promises.stat(fullPath);

      if (stat.isDirectory()) {
        await this.serveDirectoryListing(res, fullPath, `/files/${category}${safePath}`, category);
      } else if (stat.isFile()) {
        await this.serveFile(res, fullPath);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      } else {
        console.error('Error serving asset:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error' }));
      }
    }
  }

  private async serveDirectoryListing(
    res: ServerResponse,
    dirPath: string,
    urlPath: string,
    _category: string
  ): Promise<void> {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    // Get stats for all entries (dirs and files)
    const dirEntries = entries.filter(e => e.isDirectory());
    const fileEntries = entries.filter(e => e.isFile());

    // Get dir stats and sort by mtime (newest first)
    const dirInfos = await Promise.all(
      dirEntries.map(async (d) => {
        const stat = await fs.promises.stat(path.join(dirPath, d.name));
        return { name: d.name, mtime: stat.mtime };
      })
    );
    dirInfos.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // Get file stats and sort by mtime (newest first)
    const fileInfos = await Promise.all(
      fileEntries.map(async (f) => {
        const stat = await fs.promises.stat(path.join(dirPath, f.name));
        return { name: f.name, size: stat.size, mtime: stat.mtime };
      })
    );
    fileInfos.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    const formatSize = (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    };

    const formatDate = (date: Date): string => {
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (seconds < 60) return 'just now';
      if (minutes < 60) return `${minutes}m ago`;
      if (hours < 24) return `${hours}h ago`;
      if (days < 7) return `${days}d ago`;
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: days > 365 ? 'numeric' : undefined });
    };

    // Build breadcrumb
    const pathParts = urlPath.split('/').filter(Boolean);
    let breadcrumb = '<a href="/files">files</a>';
    let buildPath = '/files';
    for (const part of pathParts.slice(1)) {
      buildPath += '/' + part;
      breadcrumb += ` / <a href="${buildPath}">${part}</a>`;
    }

    // Check for PNG preview grid
    const pngFiles = fileInfos.filter(f => f.name.endsWith('.png'));
    const showPreviewGrid = pngFiles.length > 0 && pngFiles.length <= 50;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${urlPath} - Maldoror Assets</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
      background: #0a0a0f;
      color: #e0e0e0;
      margin: 0;
      padding: 20px;
      line-height: 1.6;
    }
    h1 { color: #ff9900; margin-bottom: 5px; font-size: 1.2em; }
    .breadcrumb { color: #666; margin-bottom: 20px; }
    .breadcrumb a { color: #66aaff; text-decoration: none; }
    .breadcrumb a:hover { text-decoration: underline; }
    a { color: #66ff99; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .listing {
      background: #151520;
      border: 1px solid #333;
      border-radius: 8px;
      overflow: hidden;
    }
    .entry {
      padding: 10px 15px;
      border-bottom: 1px solid #222;
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 15px;
      align-items: center;
    }
    .entry:last-child { border-bottom: none; }
    .entry:hover { background: #1a1a25; }
    .dir { color: #66aaff; }
    .file { color: #66ff99; }
    .meta { color: #666; font-size: 0.85em; text-align: right; white-space: nowrap; }
    .icon { margin-right: 10px; }
    .preview-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 15px;
      margin-top: 20px;
    }
    .preview-item {
      background: #151520;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 10px;
      text-align: center;
    }
    .preview-item img {
      max-width: 100%;
      height: auto;
      image-rendering: pixelated;
      background: repeating-conic-gradient(#222 0% 25%, #333 0% 50%) 50% / 10px 10px;
      border-radius: 4px;
    }
    .preview-item .name {
      font-size: 0.7em;
      color: #888;
      margin-top: 8px;
      word-break: break-all;
    }
    .section-title { color: #888; margin-top: 20px; font-size: 0.9em; }

    /* Lightbox styles */
    .lightbox {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.95);
      z-index: 1000;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .lightbox.active { display: flex; }
    .lightbox img {
      max-width: 90vw;
      max-height: 70vh;
      image-rendering: pixelated;
      background: repeating-conic-gradient(#222 0% 25%, #333 0% 50%) 50% / 10px 10px;
    }
    .lightbox-info {
      margin-top: 20px;
      text-align: center;
    }
    .lightbox-name { color: #fff; font-size: 1.1em; margin-bottom: 8px; }
    .lightbox-counter { color: #666; font-size: 0.9em; margin-bottom: 12px; }
    .lightbox-link {
      color: #66ff99;
      font-size: 0.85em;
      padding: 6px 12px;
      background: #1a1a25;
      border-radius: 4px;
      display: inline-block;
    }
    .lightbox-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      font-size: 3em;
      color: #666;
      cursor: pointer;
      padding: 20px;
      user-select: none;
    }
    .lightbox-nav:hover { color: #fff; }
    .lightbox-prev { left: 20px; }
    .lightbox-next { right: 20px; }
    .lightbox-close {
      position: absolute;
      top: 20px;
      right: 30px;
      font-size: 2em;
      color: #666;
      cursor: pointer;
    }
    .lightbox-close:hover { color: #fff; }
    .lightbox-hint {
      position: absolute;
      bottom: 20px;
      color: #444;
      font-size: 0.8em;
    }
  </style>
</head>
<body>
  <h1>Asset Browser</h1>
  <div class="breadcrumb">${breadcrumb}</div>

  <div class="listing">
    ${dirInfos.length === 0 && fileInfos.length === 0 ? '<div class="entry">Empty directory</div>' : ''}
    ${dirInfos.map(d => `
      <div class="entry">
        <span><span class="icon">📁</span><a href="${urlPath}/${d.name}" class="dir">${d.name}/</a></span>
        <span class="meta">—</span>
        <span class="meta">${formatDate(d.mtime)}</span>
      </div>
    `).join('')}
    ${fileInfos.map(f => `
      <div class="entry">
        <span><span class="icon">${f.name.endsWith('.png') ? '🖼️' : '📄'}</span><a href="${urlPath}/${f.name}" class="file">${f.name}</a></span>
        <span class="meta">${formatSize(f.size)}</span>
        <span class="meta">${formatDate(f.mtime)}</span>
      </div>
    `).join('')}
  </div>

  ${showPreviewGrid ? `
    <p class="section-title">Image Previews (click to enlarge)</p>
    <div class="preview-grid">
      ${pngFiles.map((f, i) => `
        <div class="preview-item" onclick="openLightbox(${i})" style="cursor:pointer">
          <img src="${urlPath}/${f.name}" alt="${f.name}" loading="lazy">
          <div class="name">${f.name}</div>
        </div>
      `).join('')}
    </div>

    <div class="lightbox" id="lightbox" onclick="if(event.target===this)closeLightbox()">
      <span class="lightbox-close" onclick="closeLightbox()">&times;</span>
      <span class="lightbox-nav lightbox-prev" onclick="navLightbox(-1)">&#8249;</span>
      <img id="lightbox-img" src="" alt="">
      <div class="lightbox-info">
        <div class="lightbox-name" id="lightbox-name"></div>
        <div class="lightbox-counter" id="lightbox-counter"></div>
        <a class="lightbox-link" id="lightbox-link" href="" target="_blank">Open direct link</a>
      </div>
      <span class="lightbox-nav lightbox-next" onclick="navLightbox(1)">&#8250;</span>
      <div class="lightbox-hint">← → arrow keys to navigate • ESC to close</div>
    </div>

    <script>
      const images = ${JSON.stringify(pngFiles.map(f => ({ name: f.name, url: `${urlPath}/${f.name}` })))};
      let currentIndex = 0;

      function openLightbox(index) {
        currentIndex = index;
        updateLightbox();
        document.getElementById('lightbox').classList.add('active');
      }

      function closeLightbox() {
        document.getElementById('lightbox').classList.remove('active');
      }

      function navLightbox(dir) {
        currentIndex = (currentIndex + dir + images.length) % images.length;
        updateLightbox();
      }

      function updateLightbox() {
        const img = images[currentIndex];
        document.getElementById('lightbox-img').src = img.url;
        document.getElementById('lightbox-name').textContent = img.name;
        document.getElementById('lightbox-counter').textContent = (currentIndex + 1) + ' / ' + images.length;
        document.getElementById('lightbox-link').href = img.url;
      }

      document.addEventListener('keydown', (e) => {
        const lb = document.getElementById('lightbox');
        if (!lb.classList.contains('active')) return;
        if (e.key === 'ArrowLeft') navLightbox(-1);
        if (e.key === 'ArrowRight') navLightbox(1);
        if (e.key === 'Escape') closeLightbox();
      });
    </script>
  ` : ''}
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  private async serveFile(res: ServerResponse, filePath: string): Promise<void> {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.json': 'application/json',
      '.txt': 'text/plain',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.map': 'application/json',
    };

    const contentType = contentTypes[ext] || 'application/octet-stream';
    const data = await fs.promises.readFile(filePath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(data);
  }

  /**
   * Get cached stats or refresh if stale (30s TTL)
   * Prevents DB hammering if /stats is polled frequently
   */
  private async getCachedStats(): Promise<WorldStats> {
    const now = Date.now();
    if (this.statsCache && (now - this.statsCache.timestamp) < STATS_CACHE_TTL_MS) {
      return this.statsCache.data;
    }

    const stats = await this.gatherStats();
    this.statsCache = { data: stats, timestamp: now };
    return stats;
  }

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);

    return parts.join(' ');
  }

  private async gatherStats(): Promise<WorldStats> {
    const uptimeSeconds = (Date.now() - this.config.startTime.getTime()) / 1000;
    const memUsage = process.memoryUsage();

    // Get world info
    const worldRecord = await db.query.world.findFirst();

    // Get player position bounds (shows explored area)
    const boundsResult = await db
      .select({
        minX: min(schema.playerState.x),
        maxX: max(schema.playerState.x),
        minY: min(schema.playerState.y),
        maxY: max(schema.playerState.y),
      })
      .from(schema.playerState);
    const bounds = boundsResult[0];

    // Count queries
    const [
      usersCount,
      userKeysCount,
      avatarsCount,
      playerStatesCount,
      buildingsCount,
      buildingTilesCount,
      spriteFramesCount,
    ] = await Promise.all([
      db.select({ count: count() }).from(schema.users),
      db.select({ count: count() }).from(schema.userKeys),
      db.select({ count: count() }).from(schema.avatars),
      db.select({ count: count() }).from(schema.playerState),
      db.select({ count: count() }).from(schema.buildings),
      db.select({ count: count() }).from(schema.buildingTiles),
      db.select({ count: count() }).from(schema.spriteFrames),
    ]);

    // Get unique users with sprites
    const uniqueSpriteUsers = await db
      .select({ count: sql<number>`count(distinct ${schema.spriteFrames.userId})` })
      .from(schema.spriteFrames);

    // Get online players from worker manager
    const onlinePlayers = await this.config.workerManager.getAllPlayers();
    const onlineCount = onlinePlayers.filter(p => p.isOnline).length;

    const width = bounds?.maxX != null && bounds?.minX != null ? bounds.maxX - bounds.minX + 1 : null;
    const height = bounds?.maxY != null && bounds?.minY != null ? bounds.maxY - bounds.minY + 1 : null;

    return {
      server: {
        uptime_seconds: Math.floor(uptimeSeconds),
        uptime_human: this.formatUptime(uptimeSeconds),
        memory: {
          rss_mb: Math.round(memUsage.rss / 1024 / 1024),
          heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
          heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
          external_mb: Math.round(memUsage.external / 1024 / 1024),
          array_buffers_mb: Math.round(memUsage.arrayBuffers / 1024 / 1024),
        },
        active_sessions: this.config.getSessionCount(),
        node_version: process.version,
        started_at: this.config.startTime.toISOString(),
        pid: process.pid,
        platform: process.platform,
      },
      world: {
        seed: worldRecord?.seed?.toString() || 'unknown',
        name: worldRecord?.name || 'Maldoror',
        bounds: {
          min_x: bounds?.minX ?? null,
          max_x: bounds?.maxX ?? null,
          min_y: bounds?.minY ?? null,
          max_y: bounds?.maxY ?? null,
          width,
          height,
          area_tiles: width && height ? width * height : null,
        },
      },
      players: {
        total_registered: usersCount[0]?.count ?? 0,
        online_now: onlineCount,
        with_avatars: avatarsCount[0]?.count ?? 0,
      },
      buildings: {
        total_placed: buildingsCount[0]?.count ?? 0,
        total_tiles: buildingTilesCount[0]?.count ?? 0,
      },
      sprites: {
        total_frames: spriteFramesCount[0]?.count ?? 0,
        unique_users_with_sprites: Number(uniqueSpriteUsers[0]?.count ?? 0),
      },
      database: {
        users: usersCount[0]?.count ?? 0,
        user_keys: userKeysCount[0]?.count ?? 0,
        avatars: avatarsCount[0]?.count ?? 0,
        player_states: playerStatesCount[0]?.count ?? 0,
        buildings: buildingsCount[0]?.count ?? 0,
        building_tiles: buildingTilesCount[0]?.count ?? 0,
        sprite_frames: spriteFramesCount[0]?.count ?? 0,
      },
      ...this.getTransportStats(),
    };
  }

  /**
   * Gather transport (SSH backpressure) metrics from all sessions
   */
  private getTransportStats(): { transport?: WorldStats['transport'] } {
    if (!this.config.getTransportMetrics) {
      return {};
    }

    const metrics = this.config.getTransportMetrics();
    if (metrics.length === 0) {
      return {};
    }

    // Aggregate metrics across all sessions
    let totalQueuedBytes = 0;
    let totalDroppedFrames = 0;
    let totalDrainEvents = 0;
    let totalBytesWritten = 0;
    let peakQueuedBytes = 0;
    let totalFramesWritten = 0;
    let keyframesAccepted = 0;
    let recoveryKeyframesAccepted = 0;
    let recoveryRequests = 0;

    for (const m of metrics) {
      totalQueuedBytes += m.queuedBytes;
      totalDroppedFrames += m.droppedFrames;
      totalDrainEvents += m.drainCount;
      totalBytesWritten += m.totalBytesWritten;
      totalFramesWritten += m.totalFramesWritten;
      keyframesAccepted += m.keyframesAccepted;
      recoveryKeyframesAccepted += m.recoveryKeyframesAccepted;
      recoveryRequests += m.recoveryRequests;
      if (m.peakQueuedBytes > peakQueuedBytes) {
        peakQueuedBytes = m.peakQueuedBytes;
      }
    }

    return {
      transport: {
        total_sessions: metrics.length,
        total_queued_bytes: totalQueuedBytes,
        total_dropped_frames: totalDroppedFrames,
        total_drain_events: totalDrainEvents,
        total_bytes_written: totalBytesWritten,
        peak_queued_bytes: peakQueuedBytes,
        total_frames_written: totalFramesWritten,
        keyframes_accepted: keyframesAccepted,
        recovery_keyframes_accepted: recoveryKeyframesAccepted,
        recovery_requests: recoveryRequests,
      },
    };
  }

  /** Lightweight uncached runtime window for load and transport probes. Each
   * read closes one interval and resets the event-loop histogram; unlike
   * /stats it performs no database queries and has no 30-second cache. */
  private async sampleRuntime(): Promise<{
    sampled_at: string;
    interval_ms: number;
    pid: number;
    active_sessions: number;
    memory: WorldStats['server']['memory'];
    cpu: { user_ms: number; system_ms: number; one_core_percent: number };
    event_loop: {
      utilization: number;
      delay_p50_ms: number;
      delay_p95_ms: number;
      delay_p99_ms: number;
      delay_max_ms: number;
    };
    transport?: WorldStats['transport'];
    worker: Awaited<ReturnType<WorkerManager['getWorkerRuntime']>>;
  }> {
    const now = performance.now();
    const intervalMs = Math.max(0.001, now - this.lastRuntimeSampleAt);
    const cpu = process.cpuUsage(this.lastCpuUsage);
    const utilization = performance.eventLoopUtilization(this.lastEventLoopUtilization);
    const memory = process.memoryUsage();
    const transport = this.getTransportStats().transport;
    const worker = await this.config.workerManager.getWorkerRuntime();
    const result = {
      sampled_at: new Date().toISOString(),
      interval_ms: roundRuntimeMetric(intervalMs),
      pid: process.pid,
      active_sessions: this.config.getSessionCount(),
      memory: {
        rss_mb: Math.round(memory.rss / 1024 / 1024),
        heap_used_mb: Math.round(memory.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(memory.heapTotal / 1024 / 1024),
        external_mb: Math.round(memory.external / 1024 / 1024),
        array_buffers_mb: Math.round(memory.arrayBuffers / 1024 / 1024),
      },
      cpu: {
        user_ms: roundRuntimeMetric(cpu.user / 1000),
        system_ms: roundRuntimeMetric(cpu.system / 1000),
        one_core_percent: roundRuntimeMetric((cpu.user + cpu.system) / (intervalMs * 10)),
      },
      event_loop: {
        utilization: roundRuntimeMetric(utilization.utilization),
        delay_p50_ms: nanosecondsToMilliseconds(this.eventLoopDelay.percentile(50)),
        delay_p95_ms: nanosecondsToMilliseconds(this.eventLoopDelay.percentile(95)),
        delay_p99_ms: nanosecondsToMilliseconds(this.eventLoopDelay.percentile(99)),
        delay_max_ms: nanosecondsToMilliseconds(this.eventLoopDelay.max),
      },
      ...(transport ? { transport } : {}),
      worker,
    };
    this.lastRuntimeSampleAt = now;
    this.lastCpuUsage = process.cpuUsage();
    this.lastEventLoopUtilization = performance.eventLoopUtilization();
    this.eventLoopDelay.reset();
    return result;
  }

  /**
   * Get world data for web viewer
   */
  private async getWorldData(): Promise<{
    seed: string;
    chunkSize: number;
    tileSize: number;
  }> {
    const worldRecord = await db.query.world.findFirst();
    return {
      seed: worldRecord?.seed?.toString() || '0',
      chunkSize: 16,
      tileSize: 256,
    };
  }

  /**
   * Get all entities for web viewer
   */
  private async getEntities(): Promise<{
    entities: Array<{
      id: string;
      type: 'player' | 'building' | 'auton' | 'road';
      x: number;
      y: number;
      spriteUrl?: string;
      modelUrl?: string;
      name?: string;
      direction?: string;
      online?: boolean;
      lastSeen?: string;
      tiles?: Array<{ x: number; y: number; url: string }>;
    }>;
  }> {
    const entities: Array<{
      id: string;
      type: 'player' | 'building' | 'auton' | 'road';
      x: number;
      y: number;
      spriteUrl?: string;
      modelUrl?: string;
      name?: string;
      direction?: string;
      online?: boolean;
      lastSeen?: string;
      tiles?: Array<{ x: number; y: number; url: string }>;
    }> = [];

    // Get players from worker manager
    try {
      const players = await this.config.workerManager.getAllPlayers();
      for (const player of players) {
        entities.push({
          id: player.userId,
          type: 'player',
          x: player.x,
          y: player.y,
          name: player.username,
          direction: 'down',
          online: player.isOnline,
          spriteUrl: `/files/sprites/${player.userId}/frame_down_0_256.png`,
          modelUrl: `/files/models/players/${player.userId}.glb`,
        });
      }
    } catch (err) {
      console.log('Failed to get players:', err instanceof Error ? err.message : err);
    }

    // Get buildings from database (using raw select to avoid drizzle relation issues)
    try {
      const buildings = await db.select().from(schema.buildings);

      for (const building of buildings) {
        // Generate default 3x3 tile URLs
        const buildingTiles: Array<{ x: number; y: number; url: string }> = [];
        for (let ty = 0; ty < 3; ty++) {
          for (let tx = 0; tx < 3; tx++) {
            buildingTiles.push({
              x: tx,
              y: ty,
              url: `/files/buildings/${building.id}/tile_north_${tx}_${ty}_256.png`,
            });
          }
        }
        entities.push({
          id: building.id,
          type: 'building',
          x: building.anchorX,
          y: building.anchorY,
          tiles: buildingTiles,
          modelUrl: `/files/models/buildings/${building.id}.glb`,
        });
      }
    } catch (err) {
      console.log('Failed to get buildings:', err instanceof Error ? err.message : err);
    }

    // Get roads from database (may not exist in older deployments)
    try {
      const roads = await db.query.roads.findMany();
      for (const road of roads) {
        entities.push({
          id: `road_${road.x}_${road.y}`,
          type: 'road',
          x: road.x,
          y: road.y,
        });
      }
    } catch (err) {
      console.log('Failed to get roads:', err instanceof Error ? err.message : err);
    }

    // Get NPCs from database
    try {
      const npcs = await db.select().from(schema.npcs);
      for (const npc of npcs) {
        entities.push({
          id: npc.id,
          type: 'auton',
          x: npc.spawnX,
          y: npc.spawnY,
          name: npc.name,
          spriteUrl: `/files/npcs/${npc.id}/frame_down_0_256.png`,
          modelUrl: `/files/models/npcs/${npc.id}.glb`,
        });
      }
    } catch (err) {
      console.log('Failed to get NPCs:', err instanceof Error ? err.message : err);
    }

    return { entities };
  }

  /**
   * Get terrain tiles list
   */
  private async getTerrainTiles(): Promise<{ tiles: Array<{ id: string; name: string; walkable: boolean }> }> {
    const tiles = await db.select({
      id: schema.terrainTiles.id,
      name: schema.terrainTiles.name,
      walkable: schema.terrainTiles.walkable,
    }).from(schema.terrainTiles);

    return { tiles };
  }

  /**
   * Get terrain chunks for 3D world rendering
   * Returns chunk data with tile IDs for each position
   */
  private async getTerrainChunks(): Promise<{
    chunks: Array<{
      chunkX: number;
      chunkY: number;
      tiles: string[][];
    }>;
    chunkSize: number;
  }> {
    const chunks = await db.select({
      chunkX: schema.tilemapChunks.chunkX,
      chunkY: schema.tilemapChunks.chunkY,
      tiles: schema.tilemapChunks.tiles,
    }).from(schema.tilemapChunks);

    return {
      chunks: chunks.map((c: { chunkX: number; chunkY: number; tiles: string[][] }) => ({
        chunkX: c.chunkX,
        chunkY: c.chunkY,
        tiles: c.tiles,
      })),
      chunkSize: 16,
    };
  }

  /**
   * Serve terrain tile PNG dynamically from database
   * URL format: /files/terrain/{tileId}_{resolution}.png
   */
  private async serveTerrainTile(_req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    try {
      // Parse URL: /files/terrain/{tileId}_{resolution}.png
      const match = pathname.match(/^\/files\/terrain\/(.+)_(\d+)\.png$/);
      if (!match) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid terrain tile URL format' }));
        return;
      }

      const tileId = match[1]!;
      const resolutionStr = match[2]!;
      const resolution = parseInt(resolutionStr, 10);

      // Fetch tile from database
      const [tile] = await db.select().from(schema.terrainTiles).where(eq(schema.terrainTiles.id, tileId));
      if (!tile) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Terrain tile not found' }));
        return;
      }

      // Get pixel data for requested resolution
      let pixels: PixelGrid;
      if (tile.resolutions) {
        const resolutions = JSON.parse(tile.resolutions) as Record<string, PixelGrid>;
        pixels = resolutions[String(resolution)] ?? JSON.parse(tile.pixels);
      } else {
        pixels = JSON.parse(tile.pixels);
      }

      // Convert to RGBA buffer
      const height = pixels.length;
      const width = pixels[0]?.length ?? 0;
      const buffer = Buffer.alloc(width * height * 4);

      for (let y = 0; y < height; y++) {
        const row = pixels[y];
        if (!row) continue;
        for (let x = 0; x < width; x++) {
          const pixel = row[x];
          const idx = (y * width + x) * 4;
          if (pixel && 'r' in pixel) {
            buffer[idx] = pixel.r;
            buffer[idx + 1] = pixel.g;
            buffer[idx + 2] = pixel.b;
            buffer[idx + 3] = 255;
          } else {
            buffer[idx] = 0;
            buffer[idx + 1] = 0;
            buffer[idx + 2] = 0;
            buffer[idx + 3] = 0;
          }
        }
      }

      // Convert to PNG
      const pngBuffer = await sharp(buffer, {
        raw: { width, height, channels: 4 },
      }).png({ compressionLevel: 6 }).toBuffer();

      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': pngBuffer.length,
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(pngBuffer);
    } catch (error) {
      console.error('Error serving terrain tile:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to serve terrain tile' }));
    }
  }

  /**
   * Serve sprite from file system, or fall back to database (avatars.spriteJson)
   */
  private async serveSpriteFromDbOrFile(_req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    // First try file system
    const relativePath = pathname.replace('/files/sprites', '');
    const fullPath = path.join(SPRITES_DIR, relativePath);

    try {
      const stat = await fs.promises.stat(fullPath);
      if (stat.isFile()) {
        await this.serveFile(res, fullPath);
        return;
      }
    } catch {
      // File doesn't exist, try database
    }

    // Parse URL: /files/sprites/{userId}/frame_{direction}_{frame}_{resolution}.png
    const match = pathname.match(/^\/files\/sprites\/([^/]+)\/frame_(\w+)_(\d+)_(\d+)\.png$/);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Sprite not found' }));
      return;
    }

    const userId = match[1]!;
    const direction = match[2]! as 'up' | 'down' | 'left' | 'right';
    const frameNum = parseInt(match[3]!, 10);
    const resolution = parseInt(match[4]!, 10);

    try {
      // Fetch avatar from database
      const [avatar] = await db.select().from(schema.avatars).where(eq(schema.avatars.userId, userId));
      if (!avatar || !avatar.spriteJson) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Avatar not found' }));
        return;
      }

      // Get sprite data
      const spriteJson = avatar.spriteJson as { frames: Record<string, PixelGrid[]> };
      const frames = spriteJson.frames[direction];
      if (!frames || !frames[frameNum]) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Sprite frame not found' }));
        return;
      }

      const pixels = frames[frameNum] as PixelGrid;
      const height = pixels.length;
      const width = pixels[0]?.length ?? 0;

      // Convert to RGBA buffer
      const buffer = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++) {
        const row = pixels[y];
        if (!row) continue;
        for (let x = 0; x < width; x++) {
          const pixel = row[x];
          const idx = (y * width + x) * 4;
          if (pixel && 'r' in pixel) {
            buffer[idx] = pixel.r;
            buffer[idx + 1] = pixel.g;
            buffer[idx + 2] = pixel.b;
            buffer[idx + 3] = 255;
          } else {
            buffer[idx] = 0;
            buffer[idx + 1] = 0;
            buffer[idx + 2] = 0;
            buffer[idx + 3] = 0;
          }
        }
      }

      // Scale to requested resolution if needed
      let pngBuffer: Buffer;
      if (width !== resolution || height !== resolution) {
        pngBuffer = await sharp(buffer, {
          raw: { width, height, channels: 4 },
        }).resize(resolution, resolution, { kernel: 'nearest' }).png({ compressionLevel: 6 }).toBuffer();
      } else {
        pngBuffer = await sharp(buffer, {
          raw: { width, height, channels: 4 },
        }).png({ compressionLevel: 6 }).toBuffer();
      }

      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': pngBuffer.length,
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(pngBuffer);
    } catch (error) {
      console.error('Error serving sprite from database:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to serve sprite' }));
    }
  }
}
