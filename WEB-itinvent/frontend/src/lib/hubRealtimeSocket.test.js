import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authHarness = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock('../api/client', () => ({
  API_V1_BASE: '/api/v1',
  authAPI: authHarness,
}));

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.bufferedAmount = 0;
    this.sent = [];
    MockWebSocket.instances.push(this);
  }

  send(payload) {
    this.sent.push(payload);
  }

  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitMessage(envelope) {
    this.onmessage?.({ data: JSON.stringify(envelope) });
  }

  emitClose(event = {}) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: '', ...event });
  }
}

const loadHubRealtimeSocket = async () => import('./hubRealtimeSocket');

describe('HubRealtimeSocketClient', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    MockWebSocket.instances = [];
    authHarness.refresh.mockReset();
    authHarness.refresh.mockResolvedValue({});
    globalThis.window.WebSocket = MockWebSocket;
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('connects once for retained consumers and forwards notification invalidations', async () => {
    const {
      HubRealtimeSocketClient,
      HUB_REALTIME_CONNECTED_EVENT,
      HUB_REALTIME_MAIL_EVENT,
      HUB_REALTIME_NOTIFICATION_EVENT,
      HUB_REALTIME_STABLE_EVENT,
      HUB_REALTIME_TASK_EVENT,
    } = await loadHubRealtimeSocket();
    const connected = vi.fn();
    const stable = vi.fn();
    const notified = vi.fn();
    const taskChanged = vi.fn();
    const mailChanged = vi.fn();
    globalThis.window.addEventListener(HUB_REALTIME_CONNECTED_EVENT, connected);
    globalThis.window.addEventListener(HUB_REALTIME_STABLE_EVENT, stable);
    globalThis.window.addEventListener(HUB_REALTIME_NOTIFICATION_EVENT, notified);
    globalThis.window.addEventListener(HUB_REALTIME_TASK_EVENT, taskChanged);
    globalThis.window.addEventListener(HUB_REALTIME_MAIL_EVENT, mailChanged);
    const client = new HubRealtimeSocketClient();

    const releaseFirst = client.retain();
    const releaseSecond = client.retain();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain('/api/v1/chat/hub-realtime/ws');

    const socket = MockWebSocket.instances[0];
    socket.emitOpen();
    socket.emitMessage({ type: 'hub.realtime.connected', payload: { protocol: 1 } });
    socket.emitMessage({
      type: 'hub.notification.created',
      payload: { protocol: 1, event_id: 'notification-1' },
    });
    socket.emitMessage({
      type: 'tasks.task.updated',
      payload: { protocol: 1, event_id: 'task-1', task_id: 'task-id-1' },
    });
    socket.emitMessage({
      type: 'tasks.task.updated',
      payload: { protocol: 1, event_id: 'task-1', task_id: 'task-id-1' },
    });
    socket.emitMessage({
      type: 'mail.message.received',
      payload: { protocol: 1, event_id: 'mail-1', message_id: 'message-1' },
    });

    expect(connected).toHaveBeenCalledTimes(1);
    expect(client.isStableConnection()).toBe(false);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(stable).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(stable).toHaveBeenCalledTimes(1);
    expect(client.isStableConnection()).toBe(true);
    expect(notified).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ type: 'hub.notification.created' }),
    }));
    expect(taskChanged).toHaveBeenCalledTimes(1);
    expect(mailChanged).toHaveBeenCalledTimes(1);

    releaseFirst();
    expect(socket.readyState).toBe(MockWebSocket.OPEN);
    releaseSecond();
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
    globalThis.window.removeEventListener(HUB_REALTIME_CONNECTED_EVENT, connected);
    globalThis.window.removeEventListener(HUB_REALTIME_STABLE_EVENT, stable);
    globalThis.window.removeEventListener(HUB_REALTIME_NOTIFICATION_EVENT, notified);
    globalThis.window.removeEventListener(HUB_REALTIME_TASK_EVENT, taskChanged);
    globalThis.window.removeEventListener(HUB_REALTIME_MAIL_EVENT, mailChanged);
  });

  it('reconnects with bounded exponential backoff and initial restart spread', async () => {
    const { HubRealtimeSocketClient } = await loadHubRealtimeSocket();
    const client = new HubRealtimeSocketClient();
    const release = client.retain();

    MockWebSocket.instances[0].emitClose({ code: 1011 });
    await vi.advanceTimersByTimeAsync(3_499);
    expect(MockWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    release();
  });

  it('refreshes authorization once after a 4401 close', async () => {
    const { HubRealtimeSocketClient } = await loadHubRealtimeSocket();
    const client = new HubRealtimeSocketClient();
    const release = client.retain();

    MockWebSocket.instances[0].emitClose({ code: 4401 });
    await Promise.resolve();
    expect(authHarness.refresh).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));

    MockWebSocket.instances[1].emitClose({ code: 4401 });
    await Promise.resolve();
    expect(authHarness.refresh).toHaveBeenCalledTimes(1);
    release();
  });

  it('closes a dead connection after three missed heartbeat replies', async () => {
    const { HubRealtimeSocketClient } = await loadHubRealtimeSocket();
    const client = new HubRealtimeSocketClient();
    const release = client.retain();
    const socket = MockWebSocket.instances[0];
    socket.emitOpen();

    await vi.advanceTimersByTimeAsync(100_000);

    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'hub.realtime.ping', payload: {} });
    release();
  });

  it('rejoins task presence and answers peer sync requests', async () => {
    const {
      HubRealtimeSocketClient,
      HUB_REALTIME_TASK_PRESENCE_EVENT,
    } = await loadHubRealtimeSocket();
    const presenceChanged = vi.fn();
    globalThis.window.addEventListener(HUB_REALTIME_TASK_PRESENCE_EVENT, presenceChanged);
    const client = new HubRealtimeSocketClient();
    const release = client.watchTaskPresence('task-7');
    const socket = MockWebSocket.instances[0];
    socket.emitOpen();
    socket.emitMessage({
      type: 'hub.realtime.connected',
      payload: { protocol: 1, connection_id: 'self-connection' },
    });

    expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual({
      type: 'tasks.presence.join',
      payload: { task_id: 'task-7' },
    });

    socket.emitMessage({
      type: 'tasks.presence.sync.requested',
      payload: { task_id: 'task-7', target_connection_id: 'peer-connection' },
    });
    expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual({
      type: 'tasks.presence.sync',
      payload: { task_id: 'task-7', target_connection_id: 'peer-connection' },
    });

    socket.emitMessage({
      type: 'tasks.presence.present',
      payload: {
        task_id: 'task-7',
        connection_id: 'peer-connection',
        target_connection_id: 'self-connection',
        collaborator: { id: 9, full_name: 'Иван Иванов' },
      },
    });
    expect(presenceChanged).toHaveBeenCalledTimes(1);

    release();
    expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual({
      type: 'tasks.presence.leave',
      payload: { task_id: 'task-7' },
    });
    globalThis.window.removeEventListener(HUB_REALTIME_TASK_PRESENCE_EVENT, presenceChanged);
  });
});
