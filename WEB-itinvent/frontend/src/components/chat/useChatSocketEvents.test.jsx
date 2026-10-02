import React, { useRef, useState } from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useChatSocketEvents from './useChatSocketEvents';
import { buildActiveThreadPollLoadOptions } from '../../pages/chat/chatThreadTransport';
import {
  CHAT_SOCKET_CONVERSATION_UPDATED_EVENT,
  CHAT_SOCKET_MESSAGE_CREATED_EVENT,
  CHAT_SOCKET_STATUS_EVENT,
  CHAT_SOCKET_UNREAD_SUMMARY_EVENT,
} from '../../lib/chatSocket';

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
  CHAT_WS_ENABLED: true,
}));

function Harness({
  activeConversationId = '',
  buildActiveThreadPollLoadOptions = () => ({}),
  hasPersistedThreadMessageEquivalent = () => false,
  initialMessages = [],
  lastConversationsLoadAt = 0,
  loadChatFolders = vi.fn(),
  loadConversations = vi.fn(),
  loadMessages = vi.fn(),
  markConversationReadLive = vi.fn(),
  mergeMessageIntoThread = vi.fn(),
  promoteConversationToTop = vi.fn(),
  queueAutoScroll = vi.fn(),
  syncConversationPreview = vi.fn(),
  threadNearBottom = true,
  messagesHasNewer = false,
  upsertConversation = vi.fn(),
}) {
  const [socketStatus, setSocketStatus] = useState('connecting');
  const activeConversationIdRef = useRef(activeConversationId);
  const aiRunStartedAtByConversationRef = useRef({});
  const conversationsLoadingRef = useRef(false);
  const lastConversationsLoadAtRef = useRef(lastConversationsLoadAt);
  const markConversationReadLiveRef = useRef(markConversationReadLive);
  const latestActiveThreadSocketMessageRef = useRef(null);
  const loadMessagesRef = useRef(loadMessages);
  const logChatDebugRef = useRef(vi.fn());
  const messagesHasNewerRef = useRef(messagesHasNewer);
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
    buildActiveThreadPollLoadOptions,
    conversationsLoadingRef,
    hasPendingInitialAnchorForConversation: () => false,
    hasPersistedThreadMessageEquivalent,
    lastConversationsLoadAtRef,
    latestActiveThreadSocketMessageRef,
    loadChatFolders,
    loadConversations,
    loadMessages,
    loadMessagesRef,
    logChatDebug: vi.fn(),
    logChatDebugRef,
    markConversationReadLiveRef,
    markSocketActivity: vi.fn(),
    mergeAiStatusPayload: (current, payload) => ({ ...current, ...payload }),
    mergeMessageIntoThread,
    messagesHasNewerRef,
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
            sender: { id: 99 },
          },
        },
      }));
    });

    expect(mergeMessageIntoThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'msg-2', is_own: false }),
      expect.objectContaining({ liveAppear: true }),
    );
    expect(queueAutoScroll).toHaveBeenCalledWith('bottom_instant', 'socket:message_created');
  });

  it('R27: keeps a socket message out of a partial window — badge and preview only', () => {
    const mergeMessageIntoThread = vi.fn();
    const queueAutoScroll = vi.fn();
    const syncConversationPreview = vi.fn();
    const markConversationReadLive = vi.fn();
    const promoteConversationToTop = vi.fn();
    render(
      <Harness
        activeConversationId="conv-1"
        messagesHasNewer
        mergeMessageIntoThread={mergeMessageIntoThread}
        queueAutoScroll={queueAutoScroll}
        syncConversationPreview={syncConversationPreview}
        markConversationReadLive={markConversationReadLive}
        promoteConversationToTop={promoteConversationToTop}
        threadNearBottom
      />,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_MESSAGE_CREATED_EVENT, {
        detail: {
          conversation_id: 'conv-1',
          payload: {
            id: 'msg-121',
            conversation_id: 'conv-1',
            body: 'below the cut window',
            is_own: false,
            sender: { id: 99 },
            conversation_seq: 121,
          },
        },
      }));
    });

    // No insert into the feed — pagination from the contiguous tail delivers it.
    expect(mergeMessageIntoThread).not.toHaveBeenCalled();
    // ↓ badge counter + sidebar preview still update.
    expect(syncConversationPreview).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ id: 'msg-121' }),
    );
    expect(promoteConversationToTop).toHaveBeenCalled();
    // Never marked read, never pulled to the bottom of the cut window.
    expect(markConversationReadLive).not.toHaveBeenCalled();
    expect(queueAutoScroll).toHaveBeenCalledWith(false, 'socket:message_created');
  });

  it('resolves room-broadcast is_own=false back to true when sender matches current user', () => {
    const mergeMessageIntoThread = vi.fn();
    render(
      <Harness
        activeConversationId="conv-1"
        mergeMessageIntoThread={mergeMessageIntoThread}
      />,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_MESSAGE_CREATED_EVENT, {
        detail: {
          conversation_id: 'conv-1',
          payload: {
            id: 'msg-own',
            conversation_id: 'conv-1',
            body: 'mine',
            is_own: false,
            sender: { id: 1 },
          },
        },
      }));
    });

    expect(mergeMessageIntoThread).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'msg-own',
        is_own: true,
        delivery_status: 'sent',
      }),
      expect.objectContaining({ liveAppear: true }),
    );
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

  it('does not restore unread from an older conversation update after read state advanced', () => {
    const upsertConversation = vi.fn();
    render(
      <Harness
        activeConversationId="conv-1"
        threadNearBottom={false}
        upsertConversation={upsertConversation}
      />,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_CONVERSATION_UPDATED_EVENT, {
        detail: {
          conversation_id: 'conv-1',
          payload: {
            reason: 'read',
            conversation: {
              id: 'conv-1',
              last_message_seq: 5,
              viewer_last_read_seq: 5,
              unread_count: 0,
            },
          },
        },
      }));
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_CONVERSATION_UPDATED_EVENT, {
        detail: {
          conversation_id: 'conv-1',
          payload: {
            reason: 'message_created',
            conversation: {
              id: 'conv-1',
              last_message_seq: 5,
              viewer_last_read_seq: 4,
              unread_count: 1,
            },
          },
        },
      }));
    });

    expect(upsertConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'conv-1',
        viewer_last_read_seq: 5,
        unread_count: 0,
      }),
      { promote: true },
    );
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

  it('does not mark an incoming message read while the reader is away from the bottom', () => {
    const markConversationReadLive = vi.fn();
    const focusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    try {
      render(
        <Harness
          activeConversationId="conv-1"
          markConversationReadLive={markConversationReadLive}
          threadNearBottom={false}
        />,
      );

      act(() => {
        window.dispatchEvent(new CustomEvent(CHAT_SOCKET_MESSAGE_CREATED_EVENT, {
          detail: {
            conversation_id: 'conv-1',
            payload: {
              id: 'msg-unseen',
              conversation_id: 'conv-1',
              body: 'later',
              is_own: false,
              conversation_seq: 7,
            },
          },
        }));
      });

      expect(markConversationReadLive).not.toHaveBeenCalled();
    } finally {
      focusSpy.mockRestore();
      visibilitySpy.mockRestore();
    }
  });

  it('marks an incoming message read when the thread is at the bottom', () => {
    const markConversationReadLive = vi.fn();
    const focusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    try {
      render(
        <Harness
          activeConversationId="conv-1"
          markConversationReadLive={markConversationReadLive}
          threadNearBottom
        />,
      );

      act(() => {
        window.dispatchEvent(new CustomEvent(CHAT_SOCKET_MESSAGE_CREATED_EVENT, {
          detail: {
            conversation_id: 'conv-1',
            payload: {
              id: 'msg-seen',
              conversation_id: 'conv-1',
              body: 'hi',
              is_own: false,
              conversation_seq: 8,
            },
          },
        }));
      });

      expect(markConversationReadLive).toHaveBeenCalledWith('conv-1', 'msg-seen');
    } finally {
      focusSpy.mockRestore();
      visibilitySpy.mockRestore();
    }
  });

  it('reloads the active thread incrementally on reconnect even when the list was just loaded', () => {
    const loadConversations = vi.fn();
    const loadMessages = vi.fn();
    render(
      <Harness
        activeConversationId="conv-1"
        buildActiveThreadPollLoadOptions={buildActiveThreadPollLoadOptions}
        initialMessages={[{ id: 'msg-9', conversation_id: 'conv-1' }]}
        lastConversationsLoadAt={Date.now()}
        loadConversations={loadConversations}
        loadMessages={loadMessages}
      />,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_STATUS_EVENT, {
        detail: { status: 'connected' },
      }));
    });

    expect(loadMessages).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      afterMessageId: 'msg-9',
    }));
    expect(loadConversations).not.toHaveBeenCalled();
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

  it('refreshes server folder unread counts on chat.unread.summary (debounced)', () => {
    vi.useFakeTimers();
    try {
      const loadChatFolders = vi.fn().mockResolvedValue([]);
      render(<Harness loadChatFolders={loadChatFolders} />);

      act(() => {
        window.dispatchEvent(new CustomEvent(CHAT_SOCKET_UNREAD_SUMMARY_EVENT, {
          detail: { payload: { messages_unread_total: 3 } },
        }));
        window.dispatchEvent(new CustomEvent(CHAT_SOCKET_UNREAD_SUMMARY_EVENT, {
          detail: { payload: { messages_unread_total: 4 } },
        }));
      });
      expect(loadChatFolders).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(loadChatFolders).toHaveBeenCalledTimes(1);
      expect(loadChatFolders).toHaveBeenCalledWith({ silent: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes server folder unread counts on chat.conversation.updated', () => {
    vi.useFakeTimers();
    try {
      const loadChatFolders = vi.fn().mockResolvedValue([]);
      render(<Harness loadChatFolders={loadChatFolders} />);

      act(() => {
        window.dispatchEvent(new CustomEvent(CHAT_SOCKET_CONVERSATION_UPDATED_EVENT, {
          detail: {
            conversation_id: 'conv-9',
            payload: {
              reason: 'updated',
              conversation: { id: 'conv-9', kind: 'direct', unread_count: 2 },
            },
          },
        }));
      });
      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(loadChatFolders).toHaveBeenCalledTimes(1);
      expect(loadChatFolders).toHaveBeenCalledWith({ silent: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
