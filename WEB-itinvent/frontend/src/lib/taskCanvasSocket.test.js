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

const loadTaskCanvasSocket = async () => import('./taskCanvasSocket');

describe('TaskCanvasSocketClient', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
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

  it('connects to the task room and forwards protocol events', async () => {
    const { TaskCanvasSocketClient } = await loadTaskCanvasSocket();
    const onEvent = vi.fn();
    const onStatus = vi.fn();
    const client = new TaskCanvasSocketClient({ taskId: 'task 7', onEvent, onStatus });

    client.connect();
    const socket = MockWebSocket.instances[0];
    expect(socket.url).toContain('/api/v1/chat/task-canvas/ws?task_id=task+7');
    expect(onStatus).toHaveBeenLastCalledWith('connecting');

    socket.emitOpen();
    const connected = { type: 'task_canvas.connected', payload: { connection_id: 'conn-1' } };
    socket.emitMessage(connected);

    expect(onStatus).toHaveBeenLastCalledWith('connected');
    expect(onEvent).toHaveBeenCalledWith(connected);
    client.close();
  });

  it('sends cursors and scenes but drops updates under websocket backpressure', async () => {
    const { TaskCanvasSocketClient } = await loadTaskCanvasSocket();
    const client = new TaskCanvasSocketClient({ taskId: 'task-1' });
    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.emitOpen();

    expect(client.sendCursor({ pointer: { x: 1, y: 2 }, button: 'up' })).toBe(true);
    expect(JSON.parse(socket.sent.at(-1))).toEqual({
      type: 'task_canvas.cursor',
      payload: { pointer: { x: 1, y: 2 }, button: 'up' },
    });
    expect(client.sendScene({ elements: [], appState: {}, files: {} }, {
      baseRevision: 4,
      targetConnectionId: 'peer-1',
    })).toBe(true);
    expect(JSON.parse(socket.sent.at(-1))).toEqual(expect.objectContaining({
      type: 'task_canvas.scene.update',
      payload: expect.objectContaining({ base_revision: 4, target_connection_id: 'peer-1' }),
    }));

    socket.bufferedAmount = (2 * 1024 * 1024) + 1;
    expect(client.sendCursor({ pointer: { x: 3, y: 4 }, button: 'up' })).toBe(false);
    client.close();
  });

  it('reconnects with backoff after a transient close', async () => {
    const { TaskCanvasSocketClient } = await loadTaskCanvasSocket();
    const onStatus = vi.fn();
    const client = new TaskCanvasSocketClient({ taskId: 'task-1', onStatus });
    client.connect();

    MockWebSocket.instances[0].emitClose({ code: 1011 });
    expect(onStatus).toHaveBeenLastCalledWith('reconnecting');
    await vi.advanceTimersByTimeAsync(999);
    expect(MockWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    client.close();
  });

  it('refreshes authorization and reconnects after a 4401 close', async () => {
    const { TaskCanvasSocketClient } = await loadTaskCanvasSocket();
    const onStatus = vi.fn();
    const client = new TaskCanvasSocketClient({ taskId: 'task-1', onStatus });
    client.connect();

    MockWebSocket.instances[0].emitClose({ code: 4401 });
    expect(onStatus).toHaveBeenLastCalledWith('unauthorized');
    await Promise.resolve();
    expect(authHarness.refresh).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(onStatus).toHaveBeenLastCalledWith('connecting');

    MockWebSocket.instances[1].emitClose({ code: 4401 });
    await Promise.resolve();
    expect(authHarness.refresh).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenLastCalledWith('unauthorized');

    client.close();
  });
});
