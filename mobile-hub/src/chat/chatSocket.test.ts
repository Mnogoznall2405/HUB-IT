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
  onclose: (() => void) | null = null;
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
  MockWebSocket.instances = [];
  Object.defineProperty(global, 'WebSocket', { configurable: true, value: MockWebSocket });
  await tokenStore.setTokens('socket-access', 'socket-refresh');
});

afterEach(() => {
  jest.useRealTimers();
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
