/**
 * Repeatable transport benchmark for the production renderer API.
 *
 * This deliberately calls PixelGameRenderer.renderToString(), the path used by
 * WorkerSession, rather than the older stream-writing render() path. It reports
 * initial, idle, actor-only, and camera-pan packet sizes so codec changes are
 * judged against the actual SSH integration contract.
 *
 * Usage:
 *   node tools/render-sim/codec-bench.mjs
 */
import { Duplex } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { PixelGameRenderer } from '../../packages/render/dist/pixel/pixel-game-renderer.js';
import { BASE_TILES } from '../../packages/world/dist/tiles/base-tiles.js';

class Sink extends Duplex {
  _read() {}
  _write(_chunk, _encoding, callback) { callback(); }
}

const player = {
  userId: 'bench-player',
  username: 'bench',
  x: 0,
  y: 0,
  direction: 'down',
  animationFrame: 0,
  isMoving: false,
};

const world = {
  getTile(x, y) {
    // Deterministic material boundaries make a pan representative without
    // involving DB/filesystem assets.
    if (Math.abs((x + 37) % 11) < 3) return BASE_TILES.water;
    if (Math.abs((y + 19) % 13) < 2) return BASE_TILES.stone;
    return BASE_TILES.grass;
  },
  getPlayers: () => [player],
  getNPCs: () => [],
  getLocalPlayerId: () => player.userId,
  getPlayerSprite: () => null,
  getNPCSprite: () => null,
};

const renderer = new PixelGameRenderer({
  stream: new Sink(),
  cols: 160,
  rows: 46,
  username: 'bench',
  zoomLevel: 30,
  renderMode: 'octant',
  layout: { headerRows: 2, footerRows: 0, leftSidebarCols: 0, rightSidebarCols: 0 },
  paletteAnimation: false,
});

function sample(label, render) {
  const start = performance.now();
  const output = render();
  const elapsed = performance.now() - start;
  const bytes = Buffer.byteLength(output, 'utf8');
  return {
    label,
    bytes,
    ms: Number(elapsed.toFixed(2)),
    camera: renderer.getCameraCenter(),
    codec: renderer.getCodecMetrics(),
  };
}

renderer.setCamera(0, 0);
const results = [sample('initial', () => renderer.renderToString(world))];
results.push(sample('idle', () => renderer.renderToString(world)));

player.x = 0.2;
results.push(sample('actor-0.2-tile', () => renderer.renderToString(world)));

renderer.setCamera(0.2, 0);
results.push(sample('camera-0.2-tile-x', () => renderer.renderToString(world)));

renderer.setCamera(0.2, 0.2);
results.push(sample('camera-0.2-tile-y', () => renderer.renderToString(world)));

renderer.setCamera(1.2, 0.2);
results.push(sample('camera-1-tile-x', () => renderer.renderToString(world)));

renderer.setCameraMode('free');
renderer.panCamera(2, 0);
results.push(sample('free-camera-1-cell-x', () => renderer.renderToString(world)));

renderer.panCamera(0, 4);
results.push(sample('free-camera-1-cell-y', () => renderer.renderToString(world)));

console.log(JSON.stringify({
  viewport: { cols: 160, rows: 46, mode: 'octant', zoom: 30 },
  results,
}, null, 2));
