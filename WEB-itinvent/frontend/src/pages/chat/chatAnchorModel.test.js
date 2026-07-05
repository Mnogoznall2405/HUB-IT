import { describe, expect, it } from 'vitest';

import {
  computePendingInitialAnchorScrollTop,
  getInitialScrollMode,
  isPendingAnchorScrollUnchanged,
  resolveInitialAnchorState,
  resolvePendingAnchorFieldsFromPayload,
} from './chatAnchorModel';

describe('chatAnchorModel', () => {
  it('getInitialScrollMode returns first_unread_top when unread_count > 0', () => {
    expect(getInitialScrollMode('c1', [{ id: 'c1', unread_count: 2 }])).toBe('first_unread_top');
    expect(getInitialScrollMode('c1', [{ id: 'c1', unread_count: 0 }])).toBe('bottom_instant');
    expect(getInitialScrollMode('', [{ id: 'c1', unread_count: 2 }])).toBe(false);
  });

  it('resolveInitialAnchorState prefers first unread when counter and marker agree', () => {
    const items = [
      { id: 'm1', sender: { id: 'other' } },
      { id: 'm2', sender: { id: 'other' } },
    ];
    const result = resolveInitialAnchorState(items, 'm1', { unread_count: 1 });
    expect(result.mode).toBe('first_unread_top');
    expect(result.anchorMessageId).toBe('m2');
  });

  it('resolvePendingAnchorFieldsFromPayload maps API first_unread mode', () => {
    const derived = { mode: 'bottom_instant', anchorMessageId: '' };
    expect(resolvePendingAnchorFieldsFromPayload(
      { initial_anchor_mode: 'first_unread', initial_anchor_message_id: 'm9' },
      null,
      derived,
    )).toEqual({
      mode: 'first_unread_top',
      anchorMessageId: 'm9',
      source: 'payload',
    });
  });

  it('computePendingInitialAnchorScrollTop uses bottom for bottom_instant', () => {
    const container = { scrollHeight: 500, clientHeight: 200, querySelector: () => null };
    expect(computePendingInitialAnchorScrollTop({
      pendingAnchor: { mode: 'bottom_instant', anchorResolved: true },
      container,
    })).toBe(300);
  });

  it('isPendingAnchorScrollUnchanged detects stable scroll position', () => {
    expect(isPendingAnchorScrollUnchanged(100, 100, 100.5)).toBe(true);
    expect(isPendingAnchorScrollUnchanged(100, 50, 100)).toBe(false);
  });
});
