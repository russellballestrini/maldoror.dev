import { describe, expect, it } from 'vitest';
import {
  SessionAdmissionCancelledError,
  SessionAdmissionQueue,
} from '../worker/session-admission-queue.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SessionAdmissionQueue', () => {
  it('admits one cold leader then drains warm work at bounded concurrency', async () => {
    const queue = new SessionAdmissionQueue(2);
    const first = deferred<string>();
    const second = deferred<string>();
    const third = deferred<string>();
    const started: string[] = [];
    const firstResult = queue.enqueue('first', () => {
      started.push('first');
      return first.promise;
    });
    const secondResult = queue.enqueue('second', () => {
      started.push('second');
      return second.promise;
    });
    const thirdResult = queue.enqueue('third', () => {
      started.push('third');
      return third.promise;
    });

    expect(started).toEqual(['first']);
    expect(queue.getStats()).toMatchObject({ coldReady: false, active: 1, pending: 2 });
    first.resolve('one');
    await settle();
    expect(await firstResult).toBe('one');
    expect(started).toEqual(['first', 'second', 'third']);
    expect(queue.getStats()).toMatchObject({ coldReady: true, active: 2, pending: 0 });

    second.resolve('two');
    third.resolve('three');
    await expect(secondResult).resolves.toBe('two');
    await expect(thirdResult).resolves.toBe('three');
    expect(queue.getStats()).toMatchObject({ coldReady: true, active: 0, pending: 0 });
  });

  it('hands cold leadership to the next task after a failed leader', async () => {
    const queue = new SessionAdmissionQueue(3);
    const first = deferred<void>();
    const second = deferred<void>();
    const started: string[] = [];
    const firstResult = queue.enqueue('first', () => {
      started.push('first');
      return first.promise;
    });
    const secondResult = queue.enqueue('second', () => {
      started.push('second');
      return second.promise;
    });

    first.reject(new Error('cold failure'));
    await expect(firstResult).rejects.toThrow('cold failure');
    await settle();
    expect(started).toEqual(['first', 'second']);
    expect(queue.getStats()).toMatchObject({ coldReady: false, active: 1 });
    second.resolve();
    await secondResult;
    await settle();
    expect(queue.getStats()).toMatchObject({ coldReady: true, active: 0 });
  });

  it('cancels queued sessions without disturbing the active leader', async () => {
    const queue = new SessionAdmissionQueue(2);
    const leader = deferred<void>();
    const leaderResult = queue.enqueue('leader', () => leader.promise);
    const queuedResult = queue.enqueue('queued', async () => undefined);

    expect(queue.cancel('queued')).toBe(true);
    await expect(queuedResult).rejects.toBeInstanceOf(SessionAdmissionCancelledError);
    expect(queue.getStats()).toMatchObject({ active: 1, pending: 0 });
    leader.resolve();
    await leaderResult;
  });

  it('rejects duplicate admission identities', async () => {
    const queue = new SessionAdmissionQueue();
    const leader = deferred<void>();
    const leaderResult = queue.enqueue('same', () => leader.promise);
    await expect(queue.enqueue('same', async () => undefined))
      .rejects.toThrow('Session admission already exists: same');
    leader.resolve();
    await leaderResult;
  });
});
