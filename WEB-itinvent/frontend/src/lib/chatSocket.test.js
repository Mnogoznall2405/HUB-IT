import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  API_V1_BASE: '/api/v1',
}));

vi.mock('./chatFeature', () => ({
  CHAT_WS_ENABLED: true,
}));

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    MockWebSocket.instances.push(this);
  }

  send(payload) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitClose(event = {}) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000, ...event });
  }
}

MockWebSocket.instances = [];

const loadChatSocket = async () => import('./chatSocket');

describe('chatSocket client lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    MockWebSocket.instances = [];
    window.WebSocket = MockWebSocket;
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores stale close events from a replaced socket', async () => {
    const { chatSocket } = await loadChatSocket();
    const release = chatSocket.retain();
    const firstSocket = MockWebSocket.instances[0];

    firstSocket.emitOpen();
    expect(chatSocket.socket).toBe(firstSocket);
    expect(chatSocket.connectionState).toBe('connected');

    firstSocket.readyState = MockWebSocket.CLOSED;
    chatSocket.connect();

    const secondSocket = MockWebSocket.instances[1];
    secondSocket.emitOpen();
    firstSocket.emitClose();

    expect(chatSocket.socket).toBe(secondSocket);
    expect(chatSocket.connectionState).toBe('connected');

    release();
    chatSocket.close(true);
  });

  it('does not create another socket while the current one is closing', async () => {
    const { chatSocket } = await loadChatSocket();
    const release = chatSocket.retain();
    const firstSocket = MockWebSocket.instances[0];

    firstSocket.readyState = MockWebSocket.CLOSING;
    chatSocket.connect();

    expect(MockWebSocket.instances).toHaveLength(1);

    release();
    chatSocket.close(true);
  });

  it('resolves sendMessage with the message payload from chat.command.ok', async () => {
    const { chatSocket } = await loadChatSocket();
    const release = chatSocket.retain();
    const socket = MockWebSocket.instances[0];

    socket.emitOpen();

    const pending = chatSocket.sendMessage('conv-1', 'Hello', {
      client_message_id: 'client-msg-1',
      database_id: 'ITINVENT',
      body_format: 'markdown',
    });
    const sentPayload = JSON.parse(socket.sent[socket.sent.length - 1]);

    expect(sentPayload.payload).toEqual(expect.objectContaining({
      body: 'Hello',
      body_format: 'markdown',
      client_message_id: 'client-msg-1',
      database_id: 'ITINVENT',
    }));
    expect(sentPayload.payload.reply_to_message_id).toBeUndefined();

    socket.onmessage?.({
      data: JSON.stringify({
        type: 'chat.command.ok',
        request_id: sentPayload.request_id,
        conversation_id: 'conv-1',
        payload: {
          message_id: 'msg-1',
          message: {
            id: 'msg-1',
            conversation_id: 'conv-1',
            kind: 'text',
            body: 'Hello',
            client_message_id: 'client-msg-1',
            created_at: '2026-03-21T10:00:00Z',
            is_own: true,
            sender: { id: 1, username: 'author', full_name: 'Task Author' },
            attachments: [],
          },
        },
      }),
    });

    await expect(pending).resolves.toEqual({
      message_id: 'msg-1',
      message: {
        id: 'msg-1',
        conversation_id: 'conv-1',
        kind: 'text',
        body: 'Hello',
        client_message_id: 'client-msg-1',
        created_at: '2026-03-21T10:00:00Z',
        is_own: true,
        sender: { id: 1, username: 'author', full_name: 'Task Author' },
        attachments: [],
      },
    });

    release();
    chatSocket.close(true);
  });

  it('resolves subscribeInbox when the server answers with chat.snapshot', async () => {
    const { chatSocket } = await loadChatSocket();
    const release = chatSocket.retain();
    const socket = MockWebSocket.instances[0];

    socket.emitOpen();

    const pending = chatSocket.subscribeInbox();
    const sentPayload = JSON.parse(socket.sent[socket.sent.length - 1]);

    expect(sentPayload.type).toBe('chat.subscribe_inbox');

    socket.onmessage?.({
      data: JSON.stringify({
        type: 'chat.snapshot',
        request_id: sentPayload.request_id,
        payload: {
          unread_summary: { conversations_unread: 2 },
        },
      }),
    });

    await expect(pending).resolves.toEqual({
      unread_summary: { conversations_unread: 2 },
    });

    release();
    chatSocket.close(true);
  });

  it('emits socket activity for inbound websocket messages including heartbeat pongs', async () => {
    const { chatSocket, CHAT_SOCKET_ACTIVITY_EVENT } = await loadChatSocket();
    const release = chatSocket.retain();
    const socket = MockWebSocket.instances[0];
    const activityEvents = [];

    window.addEventListener(CHAT_SOCKET_ACTIVITY_EVENT, (event) => {
      activityEvents.push(event.detail);
    });

    socket.emitOpen();
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'chat.pong',
        payload: {},
      }),
    });

    expect(activityEvents).toHaveLength(1);
    expect(activityEvents[0]).toEqual(expect.objectContaining({
      type: 'chat.pong',
    }));

    release();
    chatSocket.close(true);
  });

  it('handles backend rate-limited error envelopes without crashing', async () => {
    const { chatSocket, CHAT_SOCKET_ACTIVITY_EVENT } = await loadChatSocket();
    const release = chatSocket.retain();
    const socket = MockWebSocket.instances[0];
    const activityEvents = [];

    window.addEventListener(CHAT_SOCKET_ACTIVITY_EVENT, (event) => {
      activityEvents.push(event.detail);
    });

    socket.emitOpen();
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'error',
        payload: {
          code: 'rate_limited',
          retry_after_ms: 1000,
        },
      }),
    });

    expect(activityEvents[activityEvents.length - 1]).toEqual(expect.objectContaining({
      type: 'error',
    }));

    release();
    chatSocket.close(true);
  });

  it('rejects sendMessage immediately when an open socket fails to send', async () => {
    const { chatSocket } = await loadChatSocket();
    const release = chatSocket.retain();
    const socket = MockWebSocket.instances[0];

    socket.emitOpen();
    socket.send = () => {
      throw new Error('send failed');
    };

    await expect(chatSocket.sendMessage('conv-1', 'Hello')).rejects.toThrow('Chat websocket send failed');

    release();
    chatSocket.close(true);
  });

  it('rejects sendMessage immediately while the socket is not open so HTTP fallback can run', async () => {
    const { chatSocket } = await loadChatSocket();
    const release = chatSocket.retain();
    const socket = MockWebSocket.instances[0];

    expect(socket.readyState).toBe(MockWebSocket.CONNECTING);
    await expect(chatSocket.sendMessage('conv-1', 'Hello')).rejects.toThrow('Chat websocket is not connected');
    expect(chatSocket.messageQueue).toHaveLength(0);
    expect(socket.sent).toHaveLength(0);

    release();
    chatSocket.close(true);
  });

  it('does not schedule reconnect after a forbidden websocket close', async () => {
    const { chatSocket } = await loadChatSocket();
    const release = chatSocket.retain();
    const socket = MockWebSocket.instances[0];

    socket.emitOpen();
    socket.emitClose({ code: 4403 });
    await vi.runOnlyPendingTimersAsync();

    expect(chatSocket.connectionState).toBe('forbidden');
    expect(MockWebSocket.instances).toHaveLength(1);

    release();
    chatSocket.close(true);
  });

  it('replays watched presence ids after reconnect', async () => {
    const { chatSocket } = await loadChatSocket();
    const release = chatSocket.retain();
    const firstSocket = MockWebSocket.instances[0];

    firstSocket.emitOpen();

    const watchPending = chatSocket.watchPresence([5, 7, 7]);
    const firstWatchPayload = JSON.parse(firstSocket.sent[firstSocket.sent.length - 1]);

    expect(firstWatchPayload.type).toBe('chat.watch_presence');
    expect(firstWatchPayload.payload.user_ids).toEqual([5, 7]);

    firstSocket.onmessage?.({
      data: JSON.stringify({
        type: 'chat.command.ok',
        request_id: firstWatchPayload.request_id,
        payload: { user_ids: [5, 7] },
      }),
    });

    await expect(watchPending).resolves.toEqual({ user_ids: [5, 7] });

    firstSocket.emitClose({ code: 1006 });
    await vi.runOnlyPendingTimersAsync();

    const secondSocket = MockWebSocket.instances[1];
    secondSocket.emitOpen();
    const replayPayload = JSON.parse(secondSocket.sent[secondSocket.sent.length - 1]);

    expect(replayPayload).toEqual({
      type: 'chat.watch_presence',
      payload: { user_ids: [5, 7] },
    });

    release();
    chatSocket.close(true);
  });

  it('does not queue volatile typing commands while offline', async () => {
    const { chatSocket } = await loadChatSocket();
    const release = chatSocket.retain();

    chatSocket.sendTyping('conv-1', true);

    expect(chatSocket.messageQueue).toHaveLength(0);
    expect(chatSocket.pendingConversationSubscriptions.size).toBe(0);

    release();
    chatSocket.close(true);
  });

  it('keeps only the latest offline conversation subscription intent', async () => {
    const { chatSocket } = await loadChatSocket();
    const release = chatSocket.retain();

    chatSocket.subscribeConversation('conv-1');
    chatSocket.unsubscribeConversation('conv-1');
    chatSocket.subscribeConversation('conv-1');

    expect(chatSocket.messageQueue).toHaveLength(0);
    expect(chatSocket.pendingConversationSubscriptions.size).toBe(1);
    expect(chatSocket.pendingConversationSubscriptions.get('conv-1').type).toBe('chat.subscribe_conversation');

    release();
    chatSocket.close(true);
  });

  it('caps the offline message queue and drops the oldest queued message', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { chatSocket } = await loadChatSocket();
    const release = chatSocket.retain();

    for (let index = 0; index < 105; index += 1) {
      chatSocket.send({
        type: 'chat.test_command',
        payload: { index },
      });
    }

    expect(chatSocket.messageQueue).toHaveLength(100);
    expect(chatSocket.messageQueue[0].payload.index).toBe(5);
    expect(warnSpy).toHaveBeenCalled();

    release();
    chatSocket.close(true);
    warnSpy.mockRestore();
  });

  it('adds jitter to reconnect delays', async () => {
    Math.random.mockReturnValue(1);
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const { chatSocket } = await loadChatSocket();
    const release = chatSocket.retain();
    const socket = MockWebSocket.instances[0];

    socket.emitOpen();
    socket.emitClose({ code: 1006 });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1250);

    release();
    chatSocket.close(true);
    setTimeoutSpy.mockRestore();
  });
});
