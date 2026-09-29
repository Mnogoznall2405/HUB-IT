import * as tokenStore from '../auth/tokenStore';
import * as clientApi from '../api/client';
import { ChatSocketClient, shouldUseChatHttpFallback } from './chatSocket';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event?: { code?: number }) => void) | null = null;
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

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

const originalWebSocket = global.WebSocket;

beforeEach(async () => {
  jest.useFakeTimers();
  // Deterministic jitter: random()=0 yields base*0.75 and zero initial spread,
  // so every nominal advance in the tests still crosses the timer deadline.
  jest.spyOn(Math, 'random').mockReturnValue(0);
  MockWebSocket.instances = [];
  Object.defineProperty(global, 'WebSocket', { configurable: true, value: MockWebSocket });
  await tokenStore.setTokens('socket-access', 'socket-refresh');
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  Object.defineProperty(global, 'WebSocket', { configurable: true, value: originalWebSocket });
});

describe('ChatSocketClient lifecycle', () => {
  it('reconnects after a native socket error without waiting for an onclose event', async () => {
    const client = new ChatSocketClient();
    await client.connect();
    const failed = MockWebSocket.instances[0];
    failed.open();
    failed.close = jest.fn();
    failed.readyState = MockWebSocket.CLOSED;
    failed.onerror?.();
    await jest.advanceTimersByTimeAsync(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it('isolates a failing observer from message delivery and reconnect lifecycle', async () => {
    const client = new ChatSocketClient();
    const received = jest.fn();
    client.on('chat.message.created', () => { throw new Error('Broken observer'); });
    client.on('chat.message.created', received);
    await client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.onmessage?.({ data: JSON.stringify({ type: 'chat.message.created', payload: { id: 'server-1' } }) });
    expect(received).toHaveBeenCalledTimes(1);
    const off = client.on('status', () => { throw new Error('Broken status observer'); });
    expect(() => socket.close()).not.toThrow();
    await jest.advanceTimersByTimeAsync(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
    off();
    client.disconnect();
  });

  it('ignores late frames from a socket belonging to the previous session', async () => {
    const client = new ChatSocketClient();
    const received = jest.fn();
    client.on('chat.message.created', received);
    await client.connect();
    const previous = MockWebSocket.instances[0];
    previous.open();
    client.disconnect({ clearSubscriptions: true });
    await client.connect();
    MockWebSocket.instances[1].open();
    previous.onmessage?.({ data: JSON.stringify({ type: 'chat.message.created', payload: { id: 'old' } }) });
    expect(received).not.toHaveBeenCalled();
    client.disconnect();
  });

  it('reconnects after the handshake deadline even when native close never reports onclose', async () => {
    const client = new ChatSocketClient();
    await client.connect();
    const previous = MockWebSocket.instances[0];
    previous.close = jest.fn();
    await jest.advanceTimersByTimeAsync(16_000);
    expect(MockWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it('uses HTTP fallback only while realtime delivery is degraded', () => {
    expect(shouldUseChatHttpFallback('offline')).toBe(true);
    expect(shouldUseChatHttpFallback('error')).toBe(true);
    expect(shouldUseChatHttpFallback('reconnecting')).toBe(true);
    expect(shouldUseChatHttpFallback('connected')).toBe(false);
    expect(shouldUseChatHttpFallback('connecting')).toBe(false);
    expect(shouldUseChatHttpFallback('suspended')).toBe(false);
  });

  it('spreads the first reconnect over jitter plus an initial window', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const client = new ChatSocketClient();
    await client.connect();
    const first = MockWebSocket.instances[0];
    first.open();
    first.close();

    // random=0.5 → jitter 0, initial spread 2500 → delay 3500ms.
    await jest.advanceTimersByTimeAsync(1000);
    expect(MockWebSocket.instances).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(2500);
    expect(MockWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it('reconnects after an unexpected close', async () => {
    const client = new ChatSocketClient();
    await client.connect();
    const first = MockWebSocket.instances[0];
    first.open();
    first.close();

    expect(client.getStatus()).toBe('reconnecting');
    await jest.advanceTimersByTimeAsync(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it('abandons a socket whose handshake stalls and reconnects', async () => {
    const client = new ChatSocketClient();
    await client.connect();
    const stalled = MockWebSocket.instances[0];

    await jest.advanceTimersByTimeAsync(15_000);
    expect(stalled.readyState).toBe(MockWebSocket.CLOSED);
    expect(client.getStatus()).toBe('reconnecting');

    await jest.advanceTimersByTimeAsync(1_000);
    expect(MockWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it('does not disturb a socket that opens before the watchdog', async () => {
    const client = new ChatSocketClient();
    await client.connect();
    MockWebSocket.instances[0].open();

    await jest.advanceTimersByTimeAsync(30_000);
    expect(client.getStatus()).toBe('connected');
    expect(MockWebSocket.instances).toHaveLength(1);
    client.disconnect();
  });

  it('opens the socket with a refreshed access token', async () => {
    jest.spyOn(clientApi, 'getAuthenticatedAccessToken').mockResolvedValueOnce('fresh-socket-access');
    const client = new ChatSocketClient();

    await client.connect();

    expect(MockWebSocket.instances[0].options?.headers?.Authorization).toBe('Bearer fresh-socket-access');
    client.disconnect();
  });

  it('never reconnects after an explicit disconnect', async () => {
    const client = new ChatSocketClient();
    await client.connect();
    MockWebSocket.instances[0].open();
    client.disconnect({ reconnect: false, clearSubscriptions: true });

    await jest.advanceTimersByTimeAsync(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(client.getStatus()).toBe('disconnected');
  });

  it('suspends in background and reconnects on resume', async () => {
    const client = new ChatSocketClient();
    await client.connect();
    MockWebSocket.instances[0].open();
    client.suspend();
    expect(client.getStatus()).toBe('suspended');

    await client.resume();
    expect(MockWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it('reconnects when an open socket stops answering heartbeats', async () => {
    const client = new ChatSocketClient();
    await client.connect();
    MockWebSocket.instances[0].open();

    await jest.advanceTimersByTimeAsync(75_000);
    expect(client.getStatus()).toBe('reconnecting');

    await jest.advanceTimersByTimeAsync(1_000);
    expect(MockWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it('force-refreshes the access token after a 4401 session-expired close', async () => {
    const tokenSpy = jest.spyOn(clientApi, 'getAuthenticatedAccessToken')
      .mockResolvedValueOnce('stale-access')
      .mockResolvedValue('fresh-access');
    const client = new ChatSocketClient();
    await client.connect();
    const first = MockWebSocket.instances[0];
    first.open();
    first.onclose?.({ code: 4401 });

    await jest.advanceTimersByTimeAsync(1_000);

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(tokenSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ forceRefresh: true }),
    );
    expect(MockWebSocket.instances[1].options?.headers?.Authorization).toBe('Bearer fresh-access');
    client.disconnect();
  });

  it('sends heartbeat pings with a unique request_id', async () => {
    const client = new ChatSocketClient();
    await client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();

    for (let index = 0; index < 4; index += 1) {
      await jest.advanceTimersByTimeAsync(25_000);
      socket.onmessage?.({ data: JSON.stringify({ type: 'chat.pong' }) });
    }

    const pings = socket.send.mock.calls
      .map(([raw]) => JSON.parse(String(raw)) as { type?: string; request_id?: string })
      .filter((message) => message.type === 'chat.ping');
    expect(pings.length).toBeGreaterThanOrEqual(4);
    const requestIds = pings.map((message) => message.request_id);
    expect(requestIds.every((id) => typeof id === 'string' && id.trim().length > 0)).toBe(true);
    expect(new Set(requestIds).size).toBe(requestIds.length);
    client.disconnect();
  });

  it('pushes a committed token refresh into the open socket (D5/W8)', async () => {
    const client = new ChatSocketClient();
    await client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();

    await tokenStore.setTokens('renewed-access', 'renewed-refresh');

    const authFrames = socket.send.mock.calls
      .map(([raw]) => JSON.parse(String(raw)) as { type?: string; payload?: Record<string, unknown> })
      .filter((message) => message.type === 'chat.auth');
    expect(authFrames).toHaveLength(1);
    expect(authFrames[0].payload?.access_token).toBe('renewed-access');
    client.disconnect();
  });

  it('does not push chat.auth while the socket is not open', async () => {
    const client = new ChatSocketClient();
    await client.connect();
    const socket = MockWebSocket.instances[0];
    // still CONNECTING
    await tokenStore.setTokens('renewed-access-2', 'renewed-refresh-2');
    const authFrames = socket.send.mock.calls
      .map(([raw]) => JSON.parse(String(raw)) as { type?: string })
      .filter((message) => message.type === 'chat.auth');
    expect(authFrames).toHaveLength(0);
    client.disconnect();
  });

  it('answers chat.auth.required with a forced token refresh', async () => {
    const tokenSpy = jest.spyOn(clientApi, 'getAuthenticatedAccessToken')
      .mockResolvedValueOnce('handshake-access')
      .mockResolvedValue('renewed-after-hint');
    const client = new ChatSocketClient();
    await client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();

    socket.onmessage?.({ data: JSON.stringify({ type: 'chat.auth.required', payload: { retry_after_ms: 30000 } }) });
    await Promise.resolve();
    await Promise.resolve();

    expect(tokenSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ forceRefresh: true }),
    );
    client.disconnect();
  });

  it('does not surface chat.auth.ok/rejected to subscribers', async () => {
    const client = new ChatSocketClient();
    const received = jest.fn();
    client.on('chat.auth.ok', received);
    client.on('chat.auth.rejected', received);
    await client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.onmessage?.({ data: JSON.stringify({ type: 'chat.auth.ok' }) });
    socket.onmessage?.({ data: JSON.stringify({ type: 'chat.auth.rejected' }) });
    expect(received).not.toHaveBeenCalled();
    client.disconnect();
  });

  it('keeps a responsive socket connected while pong frames arrive', async () => {
    const client = new ChatSocketClient();
    await client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();

    for (let index = 0; index < 4; index += 1) {
      await jest.advanceTimersByTimeAsync(25_000);
      socket.onmessage?.({ data: JSON.stringify({ type: 'chat.pong' }) });
    }

    expect(client.getStatus()).toBe('connected');
    expect(MockWebSocket.instances).toHaveLength(1);
    client.disconnect();
  });
});
