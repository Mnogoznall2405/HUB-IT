import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import useChatActiveConversationThreadBootstrap, {
  buildActiveConversationThreadLayoutKey,
  shouldInvalidateThreadCacheFromNotification,
} from './useChatActiveConversationThreadBootstrap';
import { CHAT_MOBILE_SCREEN_TRANSITION_MS } from './chatMobileModel';

vi.mock('../../lib/swrCache', () => ({
  invalidateSWRCacheByPrefix: vi.fn(),
  peekSWRCache: vi.fn(() => null),
}));

describe('useChatActiveConversationThreadBootstrap helpers', () => {
  it('buildActiveConversationThreadLayoutKey combines user and conversation ids', () => {
    expect(buildActiveConversationThreadLayoutKey('user-1', 'conv-42')).toBe('user-1:conv-42');
    expect(buildActiveConversationThreadLayoutKey('user-1', '')).toBe('user-1:');
    expect(buildActiveConversationThreadLayoutKey('user-1', '  c1  ')).toBe('user-1:c1');
  });

  it('shouldInvalidateThreadCacheFromNotification matches requested deep link', () => {
    expect(shouldInvalidateThreadCacheFromNotification('c1', 'c1')).toBe(true);
    expect(shouldInvalidateThreadCacheFromNotification('  c1 ', 'c1')).toBe(true);
    expect(shouldInvalidateThreadCacheFromNotification('c2', 'c1')).toBe(false);
    expect(shouldInvalidateThreadCacheFromNotification('', 'c1')).toBe(false);
  });
});

function buildBootstrapHookArgs(overrides = {}) {
  return {
    activeConversationId: 'conv-1',
    applyLatestThreadPayload: vi.fn(),
    cancelPendingInitialAnchorRef: { current: vi.fn() },
    clearInitialViewportGuard: vi.fn(),
    clearMobileKeyboardSettleTimeouts: vi.fn(),
    focusComposerRef: { current: vi.fn() },
    hydratedThreadConversationIdRef: { current: '' },
    isMobile: true,
    lastHandledThreadLayoutKeyRef: { current: '' },
    loadThreadBootstrap: vi.fn(),
    logChatDebugRef: { current: vi.fn() },
    messagesLoadingRequestSeqRef: { current: 0 },
    mobileMotionDisabled: false,
    olderHistoryExhaustedRef: { current: new Set() },
    queueInitialThreadPositionRef: { current: vi.fn() },
    requestedConversationId: '',
    resetMessageSearch: vi.fn(),
    resolvePendingInitialAnchorFromPayload: vi.fn(),
    setEditingMessage: vi.fn(),
    setMessages: vi.fn(),
    setMessagesHasMore: vi.fn(),
    setMessagesHasNewer: vi.fn(),
    setMessagesLoading: vi.fn(),
    setOlderHistoryUnavailable: vi.fn(),
    setReplyMessage: vi.fn(),
    setViewerLastReadAt: vi.fn(),
    setViewerLastReadMessageId: vi.fn(),
    userCacheId: 'user-1',
    ...overrides,
  };
}

describe('useChatActiveConversationThreadBootstrap hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'setTimeout');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts cold thread load immediately on mobile before position scheduling', () => {
    const loadThreadBootstrap = vi.fn();
    const queueInitialThreadPosition = vi.fn();

    renderHook(() => useChatActiveConversationThreadBootstrap(buildBootstrapHookArgs({
      loadThreadBootstrap,
      queueInitialThreadPositionRef: { current: queueInitialThreadPosition },
    })));

    expect(loadThreadBootstrap).toHaveBeenCalledWith('conv-1', {
      reason: 'effect:activeConversation',
      force: false,
    });
    expect(queueInitialThreadPosition).not.toHaveBeenCalled();

    const delayedCalls = window.setTimeout.mock.calls.filter(
      (call) => call[1] === CHAT_MOBILE_SCREEN_TRANSITION_MS,
    );
    expect(delayedCalls.length).toBe(2);
  });

  it('delays only focusComposer on mobile, not thread position scheduling', () => {
    const focusComposer = vi.fn();
    const queueInitialThreadPosition = vi.fn();

    renderHook(() => useChatActiveConversationThreadBootstrap(buildBootstrapHookArgs({
      focusComposerRef: { current: focusComposer },
      queueInitialThreadPositionRef: { current: queueInitialThreadPosition },
    })));

    expect(focusComposer).not.toHaveBeenCalled();
    expect(queueInitialThreadPosition).not.toHaveBeenCalled();

    const delayedCalls = window.setTimeout.mock.calls.filter(
      (call) => call[1] === CHAT_MOBILE_SCREEN_TRANSITION_MS,
    );
    expect(delayedCalls.length).toBe(2);
  });
});
