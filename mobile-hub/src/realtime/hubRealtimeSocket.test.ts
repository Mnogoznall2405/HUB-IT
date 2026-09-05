import * as tokenStore from '../auth/tokenStore';
import * as clientApi from '../api/client';
import { HubRealtimeSocketClient } from './hubRealtimeSocket';

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = 0;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = jest.fn();

  constructor(
    public url: string,
    public protocols?: string | string[] | null,
    public options?: { headers?: Record<string, string> },
  ) {
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  message(envelope: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(envelope) });
  }

  close(code = 1000) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

const originalWebSocket = global.WebSocket;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  MockWebSocket.instances = [];
  Object.defineProperty(global, 'WebSocket', { configurable: true, value: MockWebSocket });
  await tokenStore.setTokens('hub-socket-access', 'hub-socket-refresh');
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  Object.defineProperty(global, 'WebSocket', { configurable: true, value: originalWebSocket });
});

describe('HubRealtimeSocketClient', () => {
  it('connects with bearer auth and deduplicates task and mail events', async () => {
    jest.spyOn(clientApi, 'getAuthenticatedAccessToken').mockResolvedValueOnce('fresh-access');
    const client = new HubRealtimeSocketClient();
    const taskChanged = jest.fn();
    const mailChanged = jest.fn();
    client.onTaskChanged(taskChanged);
    client.onMailChanged(mailChanged);

    await client.connect();
    const socket = MockWebSocket.instances[0];
    expect(socket.url).toContain('/api/v1/chat/hub-realtime/ws');
    expect(socket.options?.headers?.Authorization).toBe('Bearer fresh-access');
    socket.open();
    socket.message({ type: 'hub.realtime.connected', payload: { protocol: 1 } });
    socket.message({ type: 'tasks.task.updated', payload: { event_id: 'task-1', task_id: 'task-id-1' } });
    socket.message({ type: 'tasks.task.updated', payload: { event_id: 'task-1', task_id: 'task-id-1' } });
    socket.message({ type: 'mail.message.received', payload: { event_id: 'mail-1', message_id: 'message-1' } });

    expect(client.getStatus()).toBe('connected');
    expect(taskChanged).toHaveBeenCalledTimes(1);
    expect(mailChanged).toHaveBeenCalledTimes(1);
    client.disconnect();
  });

  it('reconnects with bounded jitter and resumes after suspension', async () => {
    const client = new HubRealtimeSocketClient();
    await client.connect();
    const first = MockWebSocket.instances[0];
    first.open();
    first.close(1011);

    expect(client.getStatus()).toBe('reconnecting');
    await jest.advanceTimersByTimeAsync(3_499);
    expect(MockWebSocket.instances).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    client.suspend();
    expect(client.getStatus()).toBe('suspended');
    await client.resume();
    expect(MockWebSocket.instances).toHaveLength(3);
    client.disconnect();
  });

  it('tracks task presence and responds to peer sync requests', async () => {
    const client = new HubRealtimeSocketClient();
    await client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.message({
      type: 'hub.realtime.connected',
      payload: { protocol: 1, connection_id: 'mobile-self' },
    });
    const changed = jest.fn();
    const release = client.watchTaskPresence('task-7', changed);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'tasks.presence.join', payload: { task_id: 'task-7' },
    }));

    socket.message({
      type: 'tasks.presence.sync.requested',
      payload: { task_id: 'task-7', target_connection_id: 'web-peer' },
    });
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'tasks.presence.sync',
      payload: { task_id: 'task-7', target_connection_id: 'web-peer' },
    }));

    socket.message({
      type: 'tasks.presence.present',
      payload: {
        task_id: 'task-7',
        connection_id: 'web-peer',
        target_connection_id: 'mobile-self',
      },
    });
    expect(changed).toHaveBeenCalledTimes(1);
    release();
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'tasks.presence.leave', payload: { task_id: 'task-7' },
    }));
    client.disconnect();
  });
});
