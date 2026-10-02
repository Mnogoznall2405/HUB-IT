import * as Crypto from 'expo-crypto';
import { API_V1_BASE } from '../api/config';
import { getAuthenticatedAccessToken } from '../api/client';
import { subscribeAccessTokenChanges } from '../auth/tokenStore';

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
const CONNECT_TIMEOUT_MS = 15_000;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 20000, 30000];
const RECONNECT_JITTER_RATIO = 0.25;
const INITIAL_RECONNECT_SPREAD_MS = 5_000;
const MAX_BUFFERED_BYTES = 256 * 1024;

let pingSequence = 0;
function createPingRequestId(): string {
  pingSequence += 1;
  try {
    const nativeId = typeof Crypto.randomUUID === 'function' ? Crypto.randomUUID() : '';
    if (typeof nativeId === 'string' && nativeId.trim()) return nativeId;
  } catch {
    // The counter in the fallback keeps ids unique within the client session.
  }
  return `ping-${Date.now().toString(36)}-${pingSequence}-${Math.random().toString(36).slice(2, 10)}`;
}

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
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastServerActivityAt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private reconnectEnabled = false;
  private suspended = false;
  private connectGeneration = 0;
  private forceTokenRefresh = false;
  private accessTokenUnsubscribe: (() => void) | null = null;
  private lastAuthPushedToken: string | null = null;
  private authRefreshInFlight = false;
  private status: ChatSocketStatus = 'disconnected';
  private wantInbox = false;
  private conversationIds = new Set<string>();
  // M5: watched presence ids survive a socket reconnect — they replay on
  // open exactly like inbox/conversation subscriptions.
  private presenceIds = new Set<number>();

  on(eventType: string, handler: SocketHandler) {
    if (!this.handlers.has(eventType)) this.handlers.set(eventType, new Set());
    this.handlers.get(eventType)!.add(handler);
    return () => this.handlers.get(eventType)?.delete(handler);
  }

  private emit(eventType: string, payload: unknown) {
    this.handlers.get(eventType)?.forEach((handler) => {
      try { handler(payload); } catch { /* One observer cannot interrupt delivery or reconnect. */ }
    });
  }

  private emitStatus(status: ChatSocketStatus) {
    this.status = status;
    this.emit('status', status);
  }

  // D5/W8: in-socket re-auth — a committed token refresh is pushed into the
  // open socket so the server lease stays alive past the 15-minute exp.
  private ensureAccessTokenListener() {
    if (this.accessTokenUnsubscribe) return;
    this.accessTokenUnsubscribe = subscribeAccessTokenChanges((token) => {
      const normalized = String(token || '').trim();
      if (!normalized || normalized === this.lastAuthPushedToken) return;
      const socket = this.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      this.lastAuthPushedToken = normalized;
      this.send({ type: 'chat.auth', payload: { access_token: normalized } });
    });
  }

  private handleAuthRequired() {
    if (this.authRefreshInFlight) return;
    this.authRefreshInFlight = true;
    // The store listener pushes the minted token into the socket on commit.
    void getAuthenticatedAccessToken({ forceRefresh: true })
      .catch(() => undefined)
      .finally(() => { this.authRefreshInFlight = false; });
  }

  getStatus(): ChatSocketStatus {
    return this.status;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.reconnectEnabled || this.suspended) return;
    // Jitter + initial spread keep hundreds of clients from hitting the farm
    // on the same ladder step after an outage or cold start.
    const baseDelay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    const jitter = baseDelay * RECONNECT_JITTER_RATIO * ((Math.random() * 2) - 1);
    const initialSpread = this.reconnectAttempt === 0 ? Math.random() * INITIAL_RECONNECT_SPREAD_MS : 0;
    const maxDelay = RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1];
    const delay = Math.max(0, Math.min(maxDelay, baseDelay + jitter + initialSpread));
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
        this.abandonSocket(socket);
        return;
      }
      this.send({ type: 'chat.ping', request_id: createPingRequestId() });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearConnectWatchdog() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private abandonSocket(socket: WebSocket) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.clearConnectWatchdog();
    this.stopHeartbeat();
    // Native close is asynchronous and may never deliver onclose on a dead link.
    socket.onclose = null;
    try { socket.close(); } catch { /* Reconnect still proceeds. */ }
    this.emitStatus('error');
    this.scheduleReconnect();
  }

  private armConnectWatchdog(socket: WebSocket) {
    this.clearConnectWatchdog();
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      // A stalled TCP/TLS handshake fires neither onopen nor onerror and would
      // otherwise pin the client in 'connecting' until the OS gives up.
      if (this.socket === socket && socket.readyState === WebSocket.CONNECTING) {
        this.abandonSocket(socket);
      }
    }, CONNECT_TIMEOUT_MS);
  }

  send(message: Record<string, unknown>) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (Number(socket.bufferedAmount || 0) > MAX_BUFFERED_BYTES) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      /* a dying socket must not throw into UI handlers */
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
    this.presenceIds = new Set(normalized);
    this.send({
      type: 'chat.watch_presence',
      payload: { user_ids: normalized },
    });
  }

  async connect() {
    this.reconnectEnabled = true;
    this.ensureAccessTokenListener();
    if (this.suspended) {
      this.emitStatus('suspended');
      return;
    }
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;
    const generation = ++this.connectGeneration;
    this.emitStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    let token = '';
    // A 4401 close means the server rejected the cached access token; the next
    // connect must mint a fresh one instead of looping with the same token.
    const forceRefresh = this.forceTokenRefresh;
    this.forceTokenRefresh = false;
    try {
      token = await getAuthenticatedAccessToken({ forceRefresh });
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
    this.armConnectWatchdog(socket);

    socket.onopen = () => {
      if (this.socket !== socket || !this.reconnectEnabled || this.suspended) {
        socket.close();
        return;
      }
      this.clearConnectWatchdog();
      this.reconnectAttempt = 0;
      this.lastAuthPushedToken = token;
      this.startHeartbeat();
      if (this.wantInbox) this.subscribeInbox();
      this.conversationIds.forEach((id) => this.subscribeConversation(id));
      if (this.presenceIds.size) this.watchPresence([...this.presenceIds]);
      this.emitStatus('connected');
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket || !this.reconnectEnabled || this.suspended) return;
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
        if (eventType === 'chat.auth.required') {
          this.handleAuthRequired();
          return;
        }
        // Internal control frames — nothing for UI subscribers.
        if (eventType === 'chat.auth.ok' || eventType === 'chat.auth.rejected') return;
        this.emit(eventType, envelope);
      } catch {
        // ignore malformed frames
      }
    };

    socket.onclose = (event?: { code?: number }) => {
      if (this.socket !== socket) return;
      if (Number(event?.code || 0) === 4401) this.forceTokenRefresh = true;
      this.socket = null;
      this.clearConnectWatchdog();
      this.stopHeartbeat();
      this.emitStatus(this.suspended ? 'suspended' : 'offline');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // Native transports do not always follow an error with onclose. Release
      // the failed socket now so a CLOSED/CLOSING handle cannot pin reconnect.
      this.abandonSocket(socket);
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
    this.clearConnectWatchdog();
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
    this.clearConnectWatchdog();
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
      this.presenceIds.clear();
    }
    this.emitStatus(this.reconnectEnabled ? 'offline' : 'disconnected');
    if (this.reconnectEnabled) this.scheduleReconnect();
  }
}

export const chatSocket = new ChatSocketClient();
