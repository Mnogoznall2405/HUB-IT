import { describe, expect, it } from 'vitest';

import {
  FIRST_UNREAD_TOP_PADDING,
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

  it('resolveInitialAnchorState stays at bottom when nothing is unread and last_read is null', () => {
    const ownOnly = [
      { id: 'm1', is_own: true },
      { id: 'm2', is_own: true },
    ];
    expect(resolveInitialAnchorState(ownOnly, '', { unread_count: 0 })).toEqual({
      mode: 'bottom_instant',
      anchorMessageId: '',
    });
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

  it('computePendingInitialAnchorScrollTop anchors on the unread separator, not the message (R37)', () => {
    // Разделитель «Непрочитанные» стоит выше первого непрочитанного — якорь на
    // сообщение прячет его за верхней кромкой.
    const separatorNode = { offsetTop: 140 };
    const messageNode = { offsetTop: 170 };
    const container = {
      scrollHeight: 1200,
      clientHeight: 400,
      querySelector: (selector) => (
        selector === '[data-testid="chat-unread-separator"]' ? separatorNode
          : selector === '[data-chat-message-id="m9"]' ? messageNode
            : null
      ),
    };
    expect(computePendingInitialAnchorScrollTop({
      pendingAnchor: { mode: 'first_unread_top', anchorMessageId: 'm9', anchorResolved: true },
      container,
      messages: [{ id: 'm8' }, { id: 'm9' }],
      viewerLastReadMessageId: 'm8',
    })).toBe(140 - FIRST_UNREAD_TOP_PADDING);
  });

  it('computePendingInitialAnchorScrollTop falls back to the message when separator is absent', () => {
    const messageNode = { offsetTop: 170 };
    const container = {
      scrollHeight: 1200,
      clientHeight: 400,
      querySelector: (selector) => (selector === '[data-chat-message-id="m9"]' ? messageNode : null),
    };
    expect(computePendingInitialAnchorScrollTop({
      pendingAnchor: { mode: 'first_unread_top', anchorMessageId: 'm9', anchorResolved: true },
      container,
      messages: [{ id: 'm8' }, { id: 'm9' }],
      viewerLastReadMessageId: 'm8',
    })).toBe(170 - FIRST_UNREAD_TOP_PADDING);
  });
});
