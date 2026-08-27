import { API_V1_BASE } from '../api/config';
import { getAuthenticatedAccessToken } from '../api/client';

type SocketHandler = (payload: unknown) => void;
export type ChatSocketStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'suspended'
  | 'error';

export function shouldUseChatHttpFallback(status: ChatSocketStatus): boolean {
  return status === 'offline' || status === 'error' || status === 'reconnecting';
}

const HEARTBEAT_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 20000, 30000];

function buildWsUrl(): string {
  const base = new URL(API_V1_BASE);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = `${base.pathname.replace(/\/$/, '')}/chat/ws`;
  base.search = '';
  base.hash = '';
  return base.toString();
}

export class ChatSocketClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<SocketHandler>>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastServerActivityAt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private reconnectEnabled = false;
  private suspended = false;
  private connectGeneration = 0;
  private status: ChatSocketStatus = 'disconnected';
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

  private emitStatus(status: ChatSocketStatus) {
    this.status = status;
    this.emit('status', status);
  }

  getStatus(): ChatSocketStatus {
    return this.status;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.reconnectEnabled || this.suspended) return;
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt += 1;
    this.emitStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.lastServerActivityAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      const socket = this.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastServerActivityAt >= HEARTBEAT_TIMEOUT_MS) {
        this.emitStatus('error');
        socket.close();
        return;
      }
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

  sendTyping(conversationId: string, isTyping: boolean) {
    const id = String(conversationId || '').trim();
    if (!id) return;
    this.send({
      type: 'chat.typing',
      conversation_id: id,
      payload: { is_typing: Boolean(isTyping) },
    });
  }

  watchPresence(userIds: number[]) {
    const normalized = Array.from(new Set(
      userIds.map((value) => Number(value || 0)).filter((value) => Number.isInteger(value) && value > 0),
    )).slice(0, 50);
    this.send({
      type: 'chat.watch_presence',
      payload: { user_ids: normalized },
    });
  }

  async connect() {
    this.reconnectEnabled = true;
    if (this.suspended) {
      this.emitStatus('suspended');
      return;
    }
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;
    const generation = ++this.connectGeneration;
    this.emitStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    let token = '';
    try {
      token = await getAuthenticatedAccessToken();
    } catch {
      if (generation !== this.connectGeneration || !this.reconnectEnabled || this.suspended) return;
      this.emitStatus('error');
      this.scheduleReconnect();
      return;
    }
    if (generation !== this.connectGeneration || !this.reconnectEnabled || this.suspended) return;
    if (!token) {
      this.reconnectEnabled = false;
      this.emitStatus('offline');
      return;
    }

    const url = buildWsUrl();
    // React Native supports Authorization headers in the 3rd argument (not in DOM typings).
    let socket: WebSocket;
    try {
      socket = new (WebSocket as unknown as new (
        url: string,
        protocols?: string | string[] | null,
        options?: { headers?: Record<string, string> },
      ) => WebSocket)(url, undefined, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      this.emitStatus('error');
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket || !this.reconnectEnabled || this.suspended) {
        socket.close();
        return;
      }
      this.reconnectAttempt = 0;
      this.startHeartbeat();
      if (this.wantInbox) this.subscribeInbox();
      this.conversationIds.forEach((id) => this.subscribeConversation(id));
      this.emitStatus('connected');
    };

    socket.onmessage = (event) => {
      this.lastServerActivityAt = Date.now();
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
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopHeartbeat();
      this.emitStatus(this.suspended ? 'suspended' : 'offline');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      if (this.socket === socket) this.emitStatus('error');
    };
  }

  suspend() {
    if (this.suspended) return;
    this.suspended = true;
    this.connectGeneration += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    this.emitStatus('suspended');
  }

  async resume(): Promise<void> {
    if (!this.suspended) return;
    this.suspended = false;
    if (this.reconnectEnabled) await this.connect();
    else this.emitStatus('disconnected');
  }

  disconnect(options: { reconnect?: boolean; clearSubscriptions?: boolean } = {}) {
    this.reconnectEnabled = Boolean(options.reconnect);
    this.suspended = false;
    this.connectGeneration += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    this.reconnectAttempt = 0;
    if (options.clearSubscriptions) {
      this.wantInbox = false;
      this.conversationIds.clear();
    }
    this.emitStatus(this.reconnectEnabled ? 'offline' : 'disconnected');
    if (this.reconnectEnabled) this.scheduleReconnect();
  }
}

export const chatSocket = new ChatSocketClient();
