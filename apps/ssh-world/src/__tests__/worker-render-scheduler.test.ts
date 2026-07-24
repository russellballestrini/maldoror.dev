import { describe, expect, it } from 'vitest';
import { CooperativeRenderScheduler } from '../worker/cooperative-render-scheduler.js';

describe('CooperativeRenderScheduler', () => {
  it('coalesces duplicate session frames and yields between different sessions', async () => {
    const scheduler = new CooperativeRenderScheduler();
    const order: string[] = [];

    scheduler.schedule('a', () => order.push('stale-a'));
    scheduler.schedule('a', () => order.push('a'));
    scheduler.schedule('b', () => order.push('b'));
    setImmediate(() => order.push('event-loop-turn'));

    await new Promise((resolve) => setTimeout(resolve, 10));
    scheduler.dispose();

    expect(order).toEqual(['a', 'event-loop-turn', 'b']);
  });

  it('cancels a pending session without disturbing the remaining frame', async () => {
    const scheduler = new CooperativeRenderScheduler();
    const rendered: string[] = [];

    scheduler.schedule('cancelled', () => rendered.push('cancelled'));
    scheduler.schedule('retained', () => rendered.push('retained'));
    scheduler.cancel('cancelled');

    await new Promise((resolve) => setTimeout(resolve, 10));
    scheduler.dispose();

    expect(rendered).toEqual(['retained']);
  });
});
