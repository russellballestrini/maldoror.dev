/**
 * Probabilistic Pre-Rendering Cache
 *
 * Predicts likely next player actions and pre-renders frames.
 * When input arrives, checks if prediction was correct:
 * - Hit: Send pre-computed diff instantly (sub-millisecond response)
 * - Miss: Compute normally
 */

import type { CellGrid } from './pixel-renderer.js';
import { renderCRLE } from './pixel-renderer.js';
import { perfStats } from './perf-stats.js';
import type { Direction } from '@maldoror/protocol';

/**
 * Prediction type
 */
export type PredictionType =
  | 'continue'  // Player continues moving in current direction
  | 'stop'      // Player stops moving
  | 'turn_left' // Player turns left
  | 'turn_right'; // Player turns right

/**
 * Pre-rendered prediction with diff output
 */
export interface PreRenderedPrediction {
  type: PredictionType;
  probability: number;
  playerX: number;
  playerY: number;
  direction: Direction;
  output: string;  // Pre-computed ANSI output
  bytesSize: number;
  timestamp: number;
}

/**
 * Movement history entry
 */
interface MovementEntry {
  x: number;
  y: number;
  direction: Direction;
  timestamp: number;
}

/**
 * Get the left turn direction
 */
function leftDirection(dir: Direction): Direction {
  switch (dir) {
    case 'up': return 'left';
    case 'down': return 'right';
    case 'left': return 'down';
    case 'right': return 'up';
  }
}

/**
 * Get the right turn direction
 */
function rightDirection(dir: Direction): Direction {
  switch (dir) {
    case 'up': return 'right';
    case 'down': return 'left';
    case 'left': return 'up';
    case 'right': return 'down';
  }
}

/**
 * Get next position in a direction
 */
function nextPosition(x: number, y: number, dir: Direction): { x: number; y: number } {
  switch (dir) {
    case 'up': return { x, y: y - 1 };
    case 'down': return { x, y: y + 1 };
    case 'left': return { x: x - 1, y };
    case 'right': return { x: x + 1, y };
  }
}

/**
 * Prediction Cache for probabilistic pre-rendering
 */
export class PredictionCache {
  private predictions: Map<string, PreRenderedPrediction> = new Map();
  private movementHistory: MovementEntry[] = [];
  private maxHistory: number = 10;
  private enabled: boolean = false;

  // Prediction probabilities based on player behavior
  private continueProbability: number = 0.45;
  private stopProbability: number = 0.30;
  private turnProbability: number = 0.25; // Split between left/right

  /**
   * Enable prediction cache
   */
  enable(): void {
    this.enabled = true;
    console.log('[PerfOpt] Probabilistic pre-rendering enabled');
  }

  /**
   * Disable prediction cache
   */
  disable(): void {
    this.enabled = false;
    this.clear();
    console.log('[PerfOpt] Probabilistic pre-rendering disabled');
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Record player movement for learning probabilities
   */
  recordMovement(x: number, y: number, direction: Direction): void {
    if (!this.enabled) return;

    const now = Date.now();

    // Add to history
    this.movementHistory.push({ x, y, direction, timestamp: now });

    // Trim history
    while (this.movementHistory.length > this.maxHistory) {
      this.movementHistory.shift();
    }

    // Update probabilities based on recent history
    this.updateProbabilities();
  }

  /**
   * Update probabilities based on movement history
   */
  private updateProbabilities(): void {
    if (this.movementHistory.length < 3) return;

    let continues = 0;
    let stops = 0;
    let turns = 0;

    for (let i = 1; i < this.movementHistory.length; i++) {
      const prev = this.movementHistory[i - 1]!;
      const curr = this.movementHistory[i]!;

      // Check if player continued in same direction
      const expected = nextPosition(prev.x, prev.y, prev.direction);
      if (curr.x === expected.x && curr.y === expected.y && curr.direction === prev.direction) {
        continues++;
      } else if (curr.x === prev.x && curr.y === prev.y) {
        // Same position = stopped
        stops++;
      } else {
        // Different direction
        turns++;
      }
    }

    const total = continues + stops + turns;
    if (total > 0) {
      // Weighted average with default values
      const alpha = 0.3; // Learning rate
      this.continueProbability = alpha * (continues / total) + (1 - alpha) * 0.45;
      this.stopProbability = alpha * (stops / total) + (1 - alpha) * 0.30;
      this.turnProbability = 1 - this.continueProbability - this.stopProbability;
    }
  }

  /**
   * Generate prediction key
   */
  private predictionKey(type: PredictionType, x: number, y: number, dir: Direction): string {
    return `${type}:${x},${y}:${dir}`;
  }

  /**
   * Pre-render predictions for current player state
   * @param currentX - Current player X position
   * @param currentY - Current player Y position
   * @param currentDirection - Current facing direction
   * @param currentCells - Current frame's cells (used as base for diff)
   * @param renderFrame - Callback to render a frame for given position/direction
   * @param headerRows - Header rows offset for terminal positioning
   * @param renderMode - Render mode for CRLE
   */
  preRenderPredictions(
    currentX: number,
    currentY: number,
    currentDirection: Direction,
    currentCells: CellGrid,
    renderFrame: (x: number, y: number, dir: Direction) => CellGrid,
    headerRows: number,
    renderMode: 'normal' | 'halfblock' | 'braille'
  ): void {
    if (!this.enabled) return;

    const now = Date.now();

    // Clear old predictions
    this.predictions.clear();

    // 1. Continue prediction (highest probability)
    const continuePos = nextPosition(currentX, currentY, currentDirection);
    const continueCells = renderFrame(continuePos.x, continuePos.y, currentDirection);
    const continueResult = renderCRLE(continueCells, currentCells, headerRows, renderMode);

    this.predictions.set(
      this.predictionKey('continue', continuePos.x, continuePos.y, currentDirection),
      {
        type: 'continue',
        probability: this.continueProbability,
        playerX: continuePos.x,
        playerY: continuePos.y,
        direction: currentDirection,
        output: continueResult.output,
        bytesSize: continueResult.bytesWithCRLE,
        timestamp: now,
      }
    );

    // 2. Stop prediction
    // Player stays in place, cells don't change (empty diff)
    this.predictions.set(
      this.predictionKey('stop', currentX, currentY, currentDirection),
      {
        type: 'stop',
        probability: this.stopProbability,
        playerX: currentX,
        playerY: currentY,
        direction: currentDirection,
        output: '', // No change
        bytesSize: 0,
        timestamp: now,
      }
    );

    // 3. Turn left prediction
    const leftDir = leftDirection(currentDirection);
    const leftCells = renderFrame(currentX, currentY, leftDir);
    const leftResult = renderCRLE(leftCells, currentCells, headerRows, renderMode);

    this.predictions.set(
      this.predictionKey('turn_left', currentX, currentY, leftDir),
      {
        type: 'turn_left',
        probability: this.turnProbability / 2,
        playerX: currentX,
        playerY: currentY,
        direction: leftDir,
        output: leftResult.output,
        bytesSize: leftResult.bytesWithCRLE,
        timestamp: now,
      }
    );

    // 4. Turn right prediction
    const rightDir = rightDirection(currentDirection);
    const rightCells = renderFrame(currentX, currentY, rightDir);
    const rightResult = renderCRLE(rightCells, currentCells, headerRows, renderMode);

    this.predictions.set(
      this.predictionKey('turn_right', currentX, currentY, rightDir),
      {
        type: 'turn_right',
        probability: this.turnProbability / 2,
        playerX: currentX,
        playerY: currentY,
        direction: rightDir,
        output: rightResult.output,
        bytesSize: rightResult.bytesWithCRLE,
        timestamp: now,
      }
    );

    // Record that we pre-rendered
    perfStats.recordPrediction(false, 4);
  }

  /**
   * Check if we have a prediction for the given state
   * Returns the pre-rendered output if hit, null if miss
   */
  checkPrediction(
    x: number,
    y: number,
    direction: Direction
  ): PreRenderedPrediction | null {
    if (!this.enabled) return null;

    // Try each prediction type
    for (const type of ['continue', 'stop', 'turn_left', 'turn_right'] as PredictionType[]) {
      const key = this.predictionKey(type, x, y, direction);
      const prediction = this.predictions.get(key);

      if (prediction) {
        // Check if prediction is still fresh (< 500ms old)
        if (Date.now() - prediction.timestamp < 500) {
          perfStats.recordPrediction(true);
          return prediction;
        }
      }
    }

    perfStats.recordPrediction(false);
    return null;
  }

  /**
   * Get current probabilities
   */
  getProbabilities(): { continue: number; stop: number; turn: number } {
    return {
      continue: this.continueProbability,
      stop: this.stopProbability,
      turn: this.turnProbability,
    };
  }

  /**
   * Clear all predictions
   */
  clear(): void {
    this.predictions.clear();
  }

  /**
   * Get stats
   */
  getStats(): { cached: number; probabilities: ReturnType<PredictionCache['getProbabilities']> } {
    return {
      cached: this.predictions.size,
      probabilities: this.getProbabilities(),
    };
  }
}

// Singleton instance
export const predictionCache = new PredictionCache();
