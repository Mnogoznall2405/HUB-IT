import { describe, expect, it } from 'vitest';

import {
  CHAT_THREAD_BOOTSTRAP_LIMIT,
  resolveThreadHasOlderFlag,
  shouldShowOlderHistoryControl,
  threadFitsSingleBootstrapPage,
} from './chatThreadHistory';

describe('chatThreadHistory', () => {
  it('detects when the full thread fits in one bootstrap page', () => {
    expect(threadFitsSingleBootstrapPage(0)).toBe(false);
    expect(threadFitsSingleBootstrapPage(5)).toBe(true);
    expect(threadFitsSingleBootstrapPage(CHAT_THREAD_BOOTSTRAP_LIMIT - 1)).toBe(true);
    expect(threadFitsSingleBootstrapPage(CHAT_THREAD_BOOTSTRAP_LIMIT)).toBe(false);
  });

  it('hides older-history control for short threads even when has_more is true', () => {
    expect(shouldShowOlderHistoryControl({
      messagesHasMore: true,
      messageCount: 3,
      olderHistoryUnavailable: false,
    })).toBe(false);
  });

  it('shows older-history control only for long threads with more history', () => {
    expect(shouldShowOlderHistoryControl({
      messagesHasMore: true,
      messageCount: CHAT_THREAD_BOOTSTRAP_LIMIT,
      olderHistoryUnavailable: false,
    })).toBe(true);
    expect(shouldShowOlderHistoryControl({
      messagesHasMore: false,
      messageCount: CHAT_THREAD_BOOTSTRAP_LIMIT,
      olderHistoryUnavailable: false,
    })).toBe(false);
  });

  it('forces has_older false when bootstrap returns a short thread', () => {
    expect(resolveThreadHasOlderFlag({
      payloadHasOlder: true,
      incomingCount: 7,
      preservedOlderCount: 0,
      olderHistoryExhausted: false,
      currentHasMore: true,
      extendedHistory: false,
    })).toBe(false);
  });
});
