import { API_V1_BASE } from '../api/client';
import { CHAT_WS_ENABLED } from './chatFeature';

export const CHAT_SOCKET_STATUS_EVENT = 'chat-ws-status';
export const CHAT_SOCKET_ACTIVITY_EVENT = 'chat-ws-activity';
export const CHAT_SOCKET_SNAPSHOT_EVENT = 'chat-ws-snapshot';
export const CHAT_SOCKET_MESSAGE_CREATED_EVENT = 'chat-ws-message-created';
export const CHAT_SOCKET_MESSAGE_DELETED_EVENT = 'chat-ws-message-deleted';
export const CHAT_SOCKET_MESSAGE_READ_EVENT = 'chat-ws-message-read';
export const CHAT_SOCKET_CONVERSATION_UPDATED_EVENT = 'chat-ws-conversation-updated';
export const CHAT_SOCKET_CONVERSATION_REMOVED_EVENT = 'chat-ws-conversation-removed';
export const CHAT_SOCKET_UNREAD_SUMMARY_EVENT = 'chat-ws-unread-summary';
export const CHAT_SOCKET_PRESENCE_UPDATED_EVENT = 'chat-ws-presence-updated';
export const CHAT_SOCKET_TYPING_EVENT = 'chat-ws-typing';
export const CHAT_SOCKET_AI_RUN_UPDATED_EVENT = 'chat-ws-ai-run-updated';

const HEARTBEAT_MS = 25_000;
const REQUEST_TIMEOUT_MS = 15_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];
const RECONNECT_JITTER_RATIO = 0.25;
const STABLE_CONNECTION_MS = 5_000;
const MAX_QUEUED_MESSAGES = 100;
const NON_RECONNECTABLE_CLOSE_CODES = new Set([4401, 4403]);
const VOLATILE_OFFLINE_COMMANDS = new Set(['chat.typing', 'chat.ping']);
const CONVERSATION_SUBSCRIPTION_COMMANDS = new Set([
  'chat.subscribe_conversation',
  'chat.unsubscribe_conversation',
]);

const canUseBrowserSocket = () => typeof window !== 'undefined' && typeof window.WebSocket !== 'undefined';

const dispatchWindowEvent = (eventName, detail) => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
};

const normalizeConversationId = (value) => String(value || '').trim();

const buildSocketUrl = () => {
  if (typeof window === 'undefined') return '';
  const target = new URL(`${API_V1_BASE}/chat/ws`, window.location.origin);
  target.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return target.toString();
};

const createRequestId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fallback below.
  }
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

class ChatSocketClient {
  constructor() {
    this.socket = null;
    this.connectionState = 'disconnected';
    this.retainCount = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.heartbeatTimeout = null;
    this.wantInbox = false;
    this.activeConversationIds = new Set();
    this.watchedPresenceUserIds = new Set();
    this.pendingRequests = new Map();
    this.reconnectAttempt = 0;
    this.manualClose = false;
    this.messageQueue = [];
    this.pendingConversationSubscriptions = new Map();
    this.missedPongs = 0;
    this.maxMissedPongs = 3;
    this.stableConnectionTimer = null;
  }

  retain() {
    if (!CHAT_WS_ENABLED || !canUseBrowserSocket()) {
      return () => {};
    }
    this.retainCount += 1;
    this.connect();
    return () => this.release();
  }

  release() {
    this.retainCount = Math.max(0, Number(this.retainCount || 0) - 1);
    if (this.retainCount === 0) {
      this.wantInbox = false;
      this.activeConversationIds.clear();
      this.watchedPresenceUserIds.clear();
      this.close(true);
    }
  }

  async subscribeInbox() {
    if (!CHAT_WS_ENABLED) return;
    this.wantInbox = true;
    this.connect();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return null;
    }
    return this.sendCommand({ type: 'chat.subscribe_inbox' });
  }

  unsubscribeInbox() {
    this.wantInbox = false;
  }

  subscribeConversation(conversationId) {
    const normalizedConversationId = normalizeConversationId(conversationId);
    if (!CHAT_WS_ENABLED || !normalizedConversationId) return;
    this.activeConversationIds.add(normalizedConversationId);
    this.connect();
    this.send({
      type: 'chat.subscribe_conversation',
      conversation_id: normalizedConversationId,
    });
  }

  unsubscribeConversation(conversationId) {
    const normalizedConversationId = normalizeConversationId(conversationId);
    if (!normalizedConversationId) return;
    this.activeConversationIds.delete(normalizedConversationId);
    this.send({
      type: 'chat.unsubscribe_conversation',
      conversation_id: normalizedConversationId,
    });
  }

  watchPresence(userIds = []) {
    const normalizedUserIds = Array.from(new Set(
      (Array.isArray(userIds) ? userIds : [])
        .map((value) => Number(value || 0))
        .filter((value) => Number.isFinite(value) && value > 0),
    )).slice(0, 50);
    this.watchedPresenceUserIds = new Set(normalizedUserIds);
    if (!CHAT_WS_ENABLED) return Promise.resolve({ user_ids: normalizedUserIds });
    this.connect();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ user_ids: normalizedUserIds });
    }
    return this.sendCommand({
      type: 'chat.watch_presence',
      payload: {
        user_ids: normalizedUserIds,
      },
    });
  }

  async sendMessage(conversationId, body, options = {}) {
    const normalizedConversationId = normalizeConversationId(conversationId);
    return this.sendCommand({
      type: 'chat.send_message',
      conversation_id: normalizedConversationId,
      payload: {
        body,
        body_format: options?.body_format || undefined,
        client_message_id: options?.client_message_id || undefined,
        database_id: options?.database_id || undefined,
        reply_to_message_id: options?.reply_to_message_id || undefined,
      },
    }, {
      requireOpen: true,
    });
  }

  async markRead(conversationId, messageId) {
    const normalizedConversationId = normalizeConversationId(conversationId);
    return this.sendCommand({
      type: 'chat.mark_read',
      conversation_id: normalizedConversationId,
      payload: {
        message_id: String(messageId || '').trim(),
      },
    }, {
      requireOpen: true,
    });
  }

  isOpen() {
    return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN);
  }

  sendTyping(conversationId, isTyping) {
    const normalizedConversationId = normalizeConversationId(conversationId);
    if (!normalizedConversationId) return;
    this.send({
      type: 'chat.typing',
      conversation_id: normalizedConversationId,
      payload: { is_typing: Boolean(isTyping) },
    });
  }

  connect() {
    if (!CHAT_WS_ENABLED || !canUseBrowserSocket()) return;
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      return;
    }
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.manualClose = false;
    const url = buildSocketUrl();
    if (!url) return;
    const socket = new window.WebSocket(url);
    this.socket = socket;
    this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.missedPongs = 0;
      this.setStatus('connected');
      this.startHeartbeat();
      this.flushQueue();
      if (this.wantInbox) {
        this.send({ type: 'chat.subscribe_inbox' });
      }
      this.activeConversationIds.forEach((conversationId) => {
        this.send({
          type: 'chat.subscribe_conversation',
          conversation_id: conversationId,
        });
      });
      if (this.watchedPresenceUserIds.size > 0) {
        this.send({
          type: 'chat.watch_presence',
          payload: {
            user_ids: Array.from(this.watchedPresenceUserIds),
          },
        });
      }
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(event?.data);
    };
    socket.onerror = () => {
      if (this.socket !== socket) return;
      this.setStatus('disconnected');
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopHeartbeat();
      const closeCode = Number(event?.code || 0);
      const authBlocked = NON_RECONNECTABLE_CLOSE_CODES.has(closeCode);
      const nextStatus = closeCode === 4401 ? 'unauthorized' : closeCode === 4403 ? 'forbidden' : 'disconnected';
      this.rejectPendingRequests(new Error(authBlocked ? 'Chat websocket access denied' : 'Chat websocket disconnected'));
      this.setStatus(nextStatus);
      if (!this.manualClose && !authBlocked && this.retainCount > 0) {
        this.scheduleReconnect();
      }
    };
  }

  close(manual = false) {
    this.manualClose = Boolean(manual);
    this.messageQueue = [];
    this.pendingConversationSubscriptions.clear();
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      } catch {
        // Ignore socket close errors.
      }
    }
    this.rejectPendingRequests(new Error('Chat websocket closed'));
    this.setStatus('disconnected');
  }

  send(payload) {
    if (!CHAT_WS_ENABLED || !canUseBrowserSocket()) return false;
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.enqueueOfflineMessage(payload);
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        this.connect();
      }
      return false;
    }
    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  sendCommand(command, options = {}) {
    if (!CHAT_WS_ENABLED || !canUseBrowserSocket()) {
      return Promise.reject(new Error('Chat websocket is disabled'));
    }
    if (options?.requireOpen && !this.isOpen()) {
      this.connect();
      return Promise.reject(new Error('Chat websocket is not connected'));
    }
    const requestId = createRequestId();
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Chat websocket command timed out'));
      }, REQUEST_TIMEOUT_MS);
      this.pendingRequests.set(requestId, { resolve, reject, timeoutId });
      const socket = this.socket;
      const dispatched = this.send({
        ...command,
        request_id: requestId,
      });
      if (!dispatched && socket && socket.readyState === WebSocket.OPEN) {
        window.clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        reject(new Error('Chat websocket send failed'));
      }
    });
  }

  handleMessage(rawPayload) {
    let envelope;
    try {
      envelope = JSON.parse(rawPayload);
    } catch {
      return;
    }
    const eventType = String(envelope?.type || '').trim();
    const requestId = String(envelope?.request_id || '').trim();
    const payload = envelope?.payload || {};

    dispatchWindowEvent(CHAT_SOCKET_ACTIVITY_EVENT, {
      type: eventType,
      received_at: Date.now(),
    });

    if (eventType === 'chat.pong') {
      this.missedPongs = 0;
      this.resolvePendingRequest(requestId, payload);
      return;
    }
    if (eventType === 'chat.command.ok') {
      this.resolvePendingRequest(requestId, payload);
      return;
    }
    if (eventType === 'chat.error' || eventType === 'error') {
      const message = String(payload?.detail || payload?.code || 'Chat websocket error');
      this.rejectPendingRequest(requestId, new Error(message));
      return;
    }
    if (eventType === 'chat.snapshot') {
      this.resolvePendingRequest(requestId, payload);
      dispatchWindowEvent(CHAT_SOCKET_SNAPSHOT_EVENT, envelope);
      if (payload?.unread_summary) {
        dispatchWindowEvent(CHAT_SOCKET_UNREAD_SUMMARY_EVENT, payload.unread_summary);
      }
      return;
    }
    if (eventType === 'chat.message.created') {
      dispatchWindowEvent(CHAT_SOCKET_MESSAGE_CREATED_EVENT, envelope);
      return;
    }
    if (eventType === 'chat.message.deleted') {
      dispatchWindowEvent(CHAT_SOCKET_MESSAGE_DELETED_EVENT, envelope);
      return;
    }
    if (eventType === 'chat.message.read') {
      dispatchWindowEvent(CHAT_SOCKET_MESSAGE_READ_EVENT, envelope);
      return;
    }
    if (eventType === 'chat.conversation.updated') {
      dispatchWindowEvent(CHAT_SOCKET_CONVERSATION_UPDATED_EVENT, envelope);
      return;
    }
    if (eventType === 'chat.conversation.removed') {
      dispatchWindowEvent(CHAT_SOCKET_CONVERSATION_REMOVED_EVENT, envelope);
      return;
    }
    if (eventType === 'chat.unread.summary') {
      dispatchWindowEvent(CHAT_SOCKET_UNREAD_SUMMARY_EVENT, payload);
      return;
    }
    if (eventType === 'chat.presence.updated') {
      dispatchWindowEvent(CHAT_SOCKET_PRESENCE_UPDATED_EVENT, envelope);
      return;
    }
    if (eventType === 'chat.typing.started' || eventType === 'chat.typing.stopped') {
      dispatchWindowEvent(CHAT_SOCKET_TYPING_EVENT, envelope);
      return;
    }
    if (eventType === 'chat.ai.run.updated') {
      dispatchWindowEvent(CHAT_SOCKET_AI_RUN_UPDATED_EVENT, envelope);
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.retainCount <= 0) return;
    const baseDelay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    const jitter = baseDelay * RECONNECT_JITTER_RATIO * ((Math.random() * 2) - 1);
    const delay = Math.max(0, Math.min(RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1], baseDelay + jitter));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.stableConnectionTimer = window.setTimeout(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.reconnectAttempt = 0;
      }
      this.stableConnectionTimer = null;
    }, STABLE_CONNECTION_MS);
    this.heartbeatTimer = window.setInterval(() => {
      if (this.missedPongs >= this.maxMissedPongs) {
        // Connection is dead, force reconnect
        this.stopHeartbeat();
        if (this.socket) {
          try {
            this.socket.close();
          } catch {}
        }
        this.socket = null;
        this.setStatus('disconnected');
        this.scheduleReconnect();
        return;
      }
      this.missedPongs += 1;
      this.sendCommand({
        type: 'chat.ping',
      }).catch(() => {
        // Ping failed, will be handled by missedPongs check
      });
    }, HEARTBEAT_MS);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeout) {
      window.clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
    if (this.stableConnectionTimer) {
      window.clearTimeout(this.stableConnectionTimer);
      this.stableConnectionTimer = null;
    }
  }

  setStatus(status) {
    this.connectionState = status;
    dispatchWindowEvent(CHAT_SOCKET_STATUS_EVENT, { status });
  }

  resolvePendingRequest(requestId, payload) {
    const normalizedRequestId = String(requestId || '').trim();
    const pending = this.pendingRequests.get(normalizedRequestId);
    if (!pending) return;
    window.clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(normalizedRequestId);
    pending.resolve(payload);
  }

  rejectPendingRequest(requestId, error) {
    const normalizedRequestId = String(requestId || '').trim();
    if (!normalizedRequestId) return;
    const pending = this.pendingRequests.get(normalizedRequestId);
    if (!pending) return;
    window.clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(normalizedRequestId);
    pending.reject(error);
  }

  rejectPendingRequests(error) {
    Array.from(this.pendingRequests.entries()).forEach(([requestId, pending]) => {
      window.clearTimeout(pending.timeoutId);
      pending.reject(error);
      this.pendingRequests.delete(requestId);
    });
  }

  enqueueOfflineMessage(payload) {
    const messageType = String(payload?.type || '').trim();
    if (!messageType || VOLATILE_OFFLINE_COMMANDS.has(messageType)) {
      return;
    }
    if (CONVERSATION_SUBSCRIPTION_COMMANDS.has(messageType)) {
      const conversationId = normalizeConversationId(payload?.conversation_id);
      if (!conversationId) return;
      this.pendingConversationSubscriptions.set(conversationId, payload);
      return;
    }
    if (this.messageQueue.length >= MAX_QUEUED_MESSAGES) {
      this.messageQueue.shift();
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('chatSocket offline queue limit reached; dropped oldest queued message');
      }
    }
    this.messageQueue.push(payload);
  }

  flushQueue() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    // Conversation subscriptions are replayed from activeConversationIds on connect.
    // Keep only the last offline intent so stale subscribe/unsubscribe commands do not flush.
    this.pendingConversationSubscriptions.clear();
    const queued = [...this.messageQueue];
    this.messageQueue = [];
    if (queued.length === 0) return;
    queued.forEach((payload) => {
      try {
        this.socket.send(JSON.stringify(payload));
      } catch {
        this.enqueueOfflineMessage(payload);
      }
    });
  }
}

export const chatSocket = new ChatSocketClient();
