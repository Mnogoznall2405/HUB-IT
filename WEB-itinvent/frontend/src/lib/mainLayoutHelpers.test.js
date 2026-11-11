import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearConnectionRestoredMarker,
  consumeConnectionRestoredMarker,
  formatOfflineLastSync,
  groupItemsByRelativeDate,
  normalizeDbId,
  persistConnectionRestoredMarker,
} from './mainLayoutHelpers';

describe('mainLayoutHelpers', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('normalizes database ids', () => {
    expect(normalizeDbId(' db-1 ')).toBe('db-1');
    expect(normalizeDbId(null)).toBe('');
    expect(normalizeDbId(42)).toBe('42');
  });

  it('consumes the connection-restored marker once within its ttl', () => {
    expect(consumeConnectionRestoredMarker()).toBe(false);
    persistConnectionRestoredMarker();
    expect(consumeConnectionRestoredMarker()).toBe(true);
    expect(consumeConnectionRestoredMarker()).toBe(false);
  });

  it('ignores a stale restored marker', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    persistConnectionRestoredMarker();
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + 60_000);
    expect(consumeConnectionRestoredMarker()).toBe(false);
  });

  it('clears the marker without consuming', () => {
    persistConnectionRestoredMarker();
    clearConnectionRestoredMarker();
    expect(consumeConnectionRestoredMarker()).toBe(false);
  });

  it('formats offline last-sync timestamps', () => {
    expect(formatOfflineLastSync(0)).toBe('');
    expect(formatOfflineLastSync('garbage')).toBe('');
    expect(formatOfflineLastSync(Date.parse('2026-01-02T10:30:00'))).toContain('02');
  });

  it('groups items into today/yesterday/earlier by a date key', () => {
    const now = new Date();
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const items = [
      { id: 1, at: now.toISOString() },
      { id: 2, at: yesterday.toISOString() },
      { id: 3, at: '2020-01-01T00:00:00Z' },
      { id: 4, at: 'not-a-date' },
    ];
    const groups = groupItemsByRelativeDate(items, 'at');
    expect(groups.map((g) => g.key)).toEqual(['today', 'yesterday', 'earlier']);
    expect(groups[0].items[0].id).toBe(1);
    expect(groups[2].items.map((i) => i.id)).toEqual([3, 4]);
    expect(groupItemsByRelativeDate([], 'at')).toEqual([]);
  });
});
