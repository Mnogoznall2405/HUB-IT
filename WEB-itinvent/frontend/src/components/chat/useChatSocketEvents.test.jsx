import React, { useRef, useState } from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useChatSocketEvents from './useChatSocketEvents';
import {
  CHAT_SOCKET_CONVERSATION_UPDATED_EVENT,
  CHAT_SOCKET_MESSAGE_CREATED_EVENT,
  CHAT_SOCKET_STATUS_EVENT,
} from '../../lib/chatSocket';

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
  CHAT_WS_ENABLED: true,
}));

function Harness({
  activeConversationId = '',
  hasPersistedThreadMessageEquivalent = () => false,
  initialMessages = [],
  loadConversations = vi.fn(),
  loadMessages = vi.fn(),
  mergeMessageIntoThread = vi.fn(),
  promoteConversationToTop = vi.fn(),
  queueAutoScroll = vi.fn(),
  syncConversationPreview = vi.fn(),
  threadNearBottom = true,
  upsertConversation = vi.fn(),
}) {
  const [socketStatus, setSocketStatus] = useState('connecting');
  const activeConversationIdRef = useRef(activeConversationId);
  const aiRunStartedAtByConversationRef = useRef({});
  const conversationsLoadingRef = useRef(false);
  const lastConversationsLoadAtRef = useRef(0);
  const latestActiveThreadSocketMessageRef = useRef(null);
  const loadMessagesRef = useRef(loadMessages);
  const logChatDebugRef = useRef(vi.fn());
  const messagesLoadingRef = useRef(false);
  const messagesRef = useRef(initialMessages);
  const skippedInitialSnapshotRefreshRef = useRef(true);
  const skippedInitialSocketRefreshRef = useRef(true);
  const socketStatusRef = useRef(socketStatus);
  const threadNearBottomRef = useRef(threadNearBottom);
  const typingParticipantsTimeoutsRef = useRef(new Map());

  useChatSocketEvents({
    activeConversation: null,
    activeConversationIdRef,
    aiRunStartedAtByConversationRef,
    applyMessageReadDelta: vi.fn(),
    buildActiveThreadPollLoadOptions: () => ({}),
    conversationsLoadingRef,
    hasPendingInitialAnchorForConversation: () => false,
    hasPersistedThreadMessageEquivalent,
    lastConversationsLoadAtRef,
    latestActiveThreadSocketMessageRef,
    loadConversations,
    loadMessages,
    loadMessagesRef,
    logChatDebug: vi.fn(),
    logChatDebugRef,
    markSocketActivity: vi.fn(),
    mergeAiStatusPayload: (current, payload) => ({ ...current, ...payload }),
    mergeMessageIntoThread,
    messagesLoadingRef,
    messagesRef,
    promoteConversationToTop,
    queueAutoScroll,
    setAiStatusByConversation: vi.fn(),
    setSocketStatus,
    setTypingUsers: vi.fn(),
    setViewerLastReadAt: vi.fn(),
    setViewerLastReadMessageId: vi.fn(),
    shouldSkipActiveThreadRevalidate: () => false,
    skippedInitialSnapshotRefreshRef,
    skippedInitialSocketRefreshRef,
    socketStatusRef,
    syncConversationPreview,
    threadNearBottomRef,
    typingParticipantsTimeoutsRef,
    updatePresenceInCollections: vi.fn(),
    upsertConversation,
    userId: 1,
  });

  return <output data-testid="socket-status">{socketStatus}</output>;
}

describe('useChatSocketEvents', () => {
  it('removes event listeners on remount cleanup', () => {
    const loadConversations = vi.fn();
    const { unmount } = render(<Harness loadConversations={loadConversations} />);

    act(() => {
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_STATUS_EVENT, {
        detail: { status: 'connected' },
      }));
    });
    expect(loadConversations).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_STATUS_EVENT, {
        detail: { status: 'disconnected' },
      }));
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_STATUS_EVENT, {
        detail: { status: 'connected' },
      }));
    });

    expect(loadConversations).toHaveBeenCalledTimes(1);
  });

  it('uses instant bottom-stick for a new incoming message when the active thread is near bottom', () => {
    const mergeMessageIntoThread = vi.fn();
    const queueAutoScroll = vi.fn();
    render(
      <Harness
        activeConversationId="conv-1"
        mergeMessageIntoThread={mergeMessageIntoThread}
        queueAutoScroll={queueAutoScroll}
        threadNearBottom
      />,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_MESSAGE_CREATED_EVENT, {
        detail: {
          conversation_id: 'conv-1',
          payload: {
            id: 'msg-2',
            conversation_id: 'conv-1',
            body: 'hello',
            is_own: false,
          },
        },
      }));
    });

    expect(mergeMessageIntoThread).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-2' }));
    expect(queueAutoScroll).toHaveBeenCalledWith('bottom_instant', 'socket:message_created');
  });

  it('does not auto-scroll for a new incoming message when the user is reading above bottom', () => {
    const queueAutoScroll = vi.fn();
    render(
      <Harness
        activeConversationId="conv-1"
        queueAutoScroll={queueAutoScroll}
        threadNearBottom={false}
      />,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_MESSAGE_CREATED_EVENT, {
        detail: {
          conversation_id: 'conv-1',
          payload: {
            id: 'msg-3',
            conversation_id: 'conv-1',
            body: 'incoming',
            is_own: false,
          },
        },
      }));
    });

    expect(queueAutoScroll).toHaveBeenCalledWith(false, 'socket:message_created');
  });

  it('skips merge and auto-scroll when the persisted message is already rendered', () => {
    const mergeMessageIntoThread = vi.fn();
    const queueAutoScroll = vi.fn();
    const existingMessage = {
      id: 'msg-dedupe',
      conversation_id: 'conv-1',
      body: 'already here',
      is_own: false,
    };
    render(
      <Harness
        activeConversationId="conv-1"
        initialMessages={[existingMessage]}
        hasPersistedThreadMessageEquivalent={() => true}
        mergeMessageIntoThread={mergeMessageIntoThread}
        queueAutoScroll={queueAutoScroll}
        threadNearBottom
      />,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_MESSAGE_CREATED_EVENT, {
        detail: {
          conversation_id: 'conv-1',
          payload: existingMessage,
        },
      }));
    });

    expect(mergeMessageIntoThread).not.toHaveBeenCalled();
    expect(queueAutoScroll).toHaveBeenCalledWith(false, 'socket:message_created');
  });

    it('syncs inbox preview for inactive conversations on message.created', () => {
    const syncConversationPreview = vi.fn();
    const promoteConversationToTop = vi.fn();
    render(
      <Harness
        activeConversationId="conv-active"
        syncConversationPreview={syncConversationPreview}
        promoteConversationToTop={promoteConversationToTop}
      />,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_MESSAGE_CREATED_EVENT, {
        detail: {
          conversation_id: 'conv-other',
          payload: {
            id: 'msg-other',
            conversation_id: 'conv-other',
            body: 'hello from elsewhere',
            is_own: false,
          },
        },
      }));
    });

    expect(syncConversationPreview).toHaveBeenCalledWith(
      'conv-other',
      expect.objectContaining({ id: 'msg-other' }),
      {},
    );
    expect(promoteConversationToTop).toHaveBeenCalledWith('conv-other');
  });

  it('applies task metadata updates without reloading the message thread', () => {
    const loadMessages = vi.fn();
    const upsertConversation = vi.fn();
    render(
      <Harness
        activeConversationId="conv-task"
        loadMessages={loadMessages}
        upsertConversation={upsertConversation}
      />,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_CONVERSATION_UPDATED_EVENT, {
        detail: {
          conversation_id: 'conv-task',
          payload: {
            reason: 'task_updated',
            conversation: {
              id: 'conv-task',
              kind: 'task',
              task_id: 'task-1',
              task_title: 'Закрытая задача',
              task_status: 'done',
              task_completed_at: '2026-06-23T14:32:00',
            },
          },
        },
      }));
    });

    expect(upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'conv-task',
        task_status: 'done',
        task_completed_at: '2026-06-23T14:32:00',
      }),
      { promote: false },
    );
    expect(loadMessages).not.toHaveBeenCalled();
  });
});
