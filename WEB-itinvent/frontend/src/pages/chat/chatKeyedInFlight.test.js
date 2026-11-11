import { describe, expect, it, vi } from 'vitest';

import {
  buildConversationsInFlightKey,
  buildHistoryInFlightKey,
  createKeyedInFlightController,
} from './chatKeyedInFlight';

describe('createKeyedInFlightController', () => {
  it('joins same-key callers into one in-flight promise with trailing refresh', async () => {
    const ctrl = createKeyedInFlightController();
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });

    const p1 = ctrl.run('k1', async ({ isTrailing = false } = {}) => {
      calls += 1;
      if (!isTrailing) await gate;
      return isTrailing ? 'trailing' : 'first';
    });
    const p2 = ctrl.run('k1', async () => 'ignored-factory');

    expect(ctrl.isInFlight('k1')).toBe(true);
    expect(p1).toBe(p2);
    release();
    // Join marks dirty → one trailing rerun of the original factory.
    await expect(p1).resolves.toBe('trailing');
    expect(calls).toBe(2);
    expect(ctrl.isInFlight('k1')).toBe(false);
  });

  it('does not coalesce different keys', async () => {
    const ctrl = createKeyedInFlightController();
    const order = [];
    let releaseA;
    const gateA = new Promise((resolve) => { releaseA = resolve; });

    const pA = ctrl.run('a', async () => {
      order.push('a-start');
      await gateA;
      order.push('a-end');
      return 'A';
    });
    const pB = ctrl.run('b', async () => {
      order.push('b');
      return 'B';
    });

    await expect(pB).resolves.toBe('B');
    releaseA();
    await expect(pA).resolves.toBe('A');
    expect(order).toEqual(['a-start', 'b', 'a-end']);
  });

  it('runs one trailing refresh when marked dirty during flight', async () => {
    const ctrl = createKeyedInFlightController();
    const trailFlags = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });

    const promise = ctrl.run('k', async ({ isTrailing = false } = {}) => {
      trailFlags.push(isTrailing);
      if (!isTrailing) {
        await gate;
        return 'first';
      }
      return 'trailing';
    });

    ctrl.markDirty('k');
    release();
    await expect(promise).resolves.toBe('trailing');
    expect(trailFlags).toEqual([false, true]);
  });

  it('marks dirty when a second same-key caller joins', async () => {
    const ctrl = createKeyedInFlightController();
    const trailFlags = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });

    const p1 = ctrl.run('k', async ({ isTrailing = false } = {}) => {
      trailFlags.push(isTrailing);
      if (!isTrailing) await gate;
      return isTrailing ? 'trailing' : 'first';
    });
    const p2 = ctrl.run('k', async () => 'ignored');

    expect(p1).toBe(p2);
    release();
    await expect(p1).resolves.toBe('trailing');
    expect(trailFlags).toEqual([false, true]);
  });
});

describe('in-flight key builders', () => {
  it('builds conversations key from filters/folder/search/cursor', () => {
    expect(buildConversationsInFlightKey({
      userCacheId: 'u1',
      folder: 'inbox',
      search: 'q',
      cursor: 'c1',
    })).toBe('chat-conversations|u1|inbox|q|c1');
  });

  it('builds history key from conversation/cursor/direction/limit', () => {
    expect(buildHistoryInFlightKey({
      conversationId: 'conv-1',
      cursor: 'msg-9',
      direction: 'before',
      limit: 50,
    })).toBe('chat-history|conv-1|before|msg-9|50');
  });
});
