import { API_V1_BASE } from '../api/config';
import * as tokenStore from '../auth/tokenStore';

type SocketHandler = (payload: unknown) => void;

const HEARTBEAT_MS = 25_000;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 20000, 30000];

function buildWsUrl(): string {
  const base = new URL(API_V1_BASE);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = `${base.pathname.replace(/\/$/, '')}/chat/ws`;
  base.search = '';
  base.hash = '';
  return base.toString();
}

class ChatSocketClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<SocketHandler>>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private wantInbox = false;
  private conversationIds = new Set<string>();

  on(eventType: string, handler: SocketHandler) {
    if (!this.handlers.has(eventType)) this.handlers.set(eventType, new Set());
    this.handlers.get(eventType)!.add(handler);
    return () => this.handlers.get(eventType)?.delete(handler);
  }

  private emit(eventType: string, payload: unknown) {
    this.handlers.get(eventType)?.forEach((handler) => handler(payload));
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'chat.ping' });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  send(message: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  subscribeInbox() {
    this.wantInbox = true;
    this.send({ type: 'chat.subscribe_inbox' });
  }

  subscribeConversation(conversationId: string) {
    const id = String(conversationId || '').trim();
    if (!id) return;
    this.conversationIds.add(id);
    this.send({ type: 'chat.subscribe_conversation', conversation_id: id });
  }

  unsubscribeConversation(conversationId: string) {
    const id = String(conversationId || '').trim();
    if (!id) return;
    this.conversationIds.delete(id);
    this.send({ type: 'chat.unsubscribe_conversation', conversation_id: id });
  }

  async connect() {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;
    const token = await tokenStore.getAccessToken();
    if (!token) return;

    const url = buildWsUrl();
    // React Native supports Authorization headers in the 3rd argument (not in DOM typings).
    const socket = new (WebSocket as unknown as new (
      url: string,
      protocols?: string | string[] | null,
      options?: { headers?: Record<string, string> },
    ) => WebSocket)(url, undefined, {
      headers: { Authorization: `Bearer ${token}` },
    });

    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.startHeartbeat();
      if (this.wantInbox) this.subscribeInbox();
      this.conversationIds.forEach((id) => this.subscribeConversation(id));
      this.emit('status', 'connected');
    };

    socket.onmessage = (event) => {
      try {
        const envelope = JSON.parse(String(event.data || '{}')) as {
          type?: string;
          payload?: unknown;
          request_id?: string;
        };
        const eventType = String(envelope?.type || '').trim();
        if (!eventType) return;
        if (eventType === 'chat.pong' || eventType === 'chat.command.ok') return;
        this.emit(eventType, envelope);
      } catch {
        // ignore malformed frames
      }
    };

    socket.onclose = () => {
      this.socket = null;
      this.stopHeartbeat();
      this.emit('status', 'disconnected');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      this.emit('status', 'error');
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.socket?.close();
    this.socket = null;
  }
}

export const chatSocket = new ChatSocketClient();
