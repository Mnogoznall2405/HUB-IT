import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import useChatSocketController from './useChatSocketController';
import { chatSocket } from '../../lib/chatSocket';

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
  CHAT_WS_ENABLED: true,
}));

vi.mock('../../lib/chatSocket', () => ({
  chatSocket: {
    getConnectionState: vi.fn(() => 'connected'),
    isOpen: vi.fn(() => true),
    subscribeConversation: vi.fn(),
    unsubscribeConversation: vi.fn(),
    sendTyping: vi.fn(),
  },
}));

vi.mock('../../components/chat/useChatSocketLifecycle', () => ({
  default: vi.fn(),
}));

describe('useChatSocketController — R1: mount after socket already connected', () => {
  it('initializes socketStatus from chatSocket.getConnectionState()', () => {
    const { result } = renderHook(() => useChatSocketController({
      activeConversationId: 'c1',
      deferredMessageText: '',
      logChatDebugRef: { current: null },
      skippedInitialSocketRefreshRef: { current: false },
      watchedPresenceUserIds: [],
      watchedPresenceUserIdsKey: '',
    }));

    expect(chatSocket.getConnectionState).toHaveBeenCalled();
    expect(result.current.socketStatus).toBe('connected');
    expect(result.current.socketStatusRef.current).toBe('connected');
    // An already-live socket counts as recent transport activity so the
    // thread transport state doesn't start degraded.
    expect(result.current.lastSocketActivityAt).toBeGreaterThan(0);
    expect(result.current.activeThreadTransportState).toBe('healthy');
  });
});
