import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import useChatSocketController, { SOCKET_ACTIVITY_COALESCE_MS } from './useChatSocketController';

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
  CHAT_WS_ENABLED: false,
}));

vi.mock('../../components/chat/useChatSocketLifecycle', () => ({
  default: vi.fn(),
}));

describe('useChatSocketController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-27T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('markSocketActivity coalesces state updates within SOCKET_ACTIVITY_COALESCE_MS', () => {
    const logChatDebugRef = { current: vi.fn() };
    const { result } = renderHook(() => useChatSocketController({
      activeConversationId: 'c1',
      deferredMessageText: '',
      logChatDebugRef,
      watchedPresenceUserIds: [],
      watchedPresenceUserIdsKey: '',
    }));

    act(() => {
      result.current.markSocketActivity('socket:message');
    });
    const firstActivityAt = result.current.lastSocketActivityAt;
    expect(firstActivityAt).toBeGreaterThan(0);
    expect(logChatDebugRef.current).toHaveBeenCalledWith('socket:activity', expect.objectContaining({
      source: 'socket:message',
    }));

    act(() => {
      vi.advanceTimersByTime(SOCKET_ACTIVITY_COALESCE_MS - 1);
      result.current.markSocketActivity('socket:pong');
    });
    expect(result.current.lastSocketActivityAt).toBe(firstActivityAt);

    act(() => {
      vi.advanceTimersByTime(2);
      result.current.markSocketActivity('socket:pong');
    });
    expect(result.current.lastSocketActivityAt).toBeGreaterThan(firstActivityAt);
  });

  it('exposes disabled socket status when websocket feature is off', () => {
    const { result } = renderHook(() => useChatSocketController({
      activeConversationId: '',
      deferredMessageText: '',
      logChatDebugRef: { current: null },
      watchedPresenceUserIds: [],
      watchedPresenceUserIdsKey: '',
    }));

    expect(result.current.socketStatus).toBe('disabled');
    expect(result.current.typingUsers).toEqual([]);
  });
});
