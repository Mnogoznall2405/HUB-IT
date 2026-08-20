import { API_V1_BASE } from '../api/client';
import { CHAT_WS_ENABLED } from './chatFeature';
import { emitAgentDebugLog } from './debugClientLog';
import { invalidateSWRCacheByPrefix } from './swrCache';

export const CHAT_SOCKET_STATUS_EVENT = 'chat-ws-status';
export const CHAT_SOCKET_ACTIVITY_EVENT = 'chat-ws-activity';
export const CHAT_SOCKET_SNAPSHOT_EVENT = 'chat-ws-snapshot';
export const CHAT_SOCKET_SESSION_EXPIRED_EVENT = 'chat-ws-session-expired';
export const CHAT_SOCKET_MESSAGE_CREATED_EVENT = 'chat-ws-message-created';
export const CHAT_SOCKET_MESSAGE_DELETED_EVENT = 'chat-ws-message-deleted';
export const CHAT_SOCKET_MESSAGE_UPDATED_EVENT = 'chat-ws-message-updated';
export const CHAT_SOCKET_MESSAGE_READ_EVENT = 'chat-ws-message-read';
export const CHAT_SOCKET_CONVERSATION_UPDATED_EVENT = 'chat-ws-conversation-updated';
export const CHAT_SOCKET_CONVERSATION_REMOVED_EVENT = 'chat-ws-conversation-removed';
export const CHAT_SOCKET_UNREAD_SUMMARY_EVENT = 'chat-ws-unread-summary';
export const CHAT_SOCKET_PRESENCE_UPDATED_EVENT = 'chat-ws-presence-updated';
export const CHAT_SOCKET_TYPING_EVENT = 'chat-ws-typing';
export const CHAT_SOCKET_AI_RUN_UPDATED_EVENT = 'chat-ws-ai-run-updated';
export const CHAT_SOCKET_AI_SANDBOX_UPDATED_EVENT = 'chat-ws-ai-sandbox-updated';
export const CHAT_SOCKET_MESSAGE_REACTION_EVENT = 'chat-ws-message-reaction';

const HEARTBEAT_MS = 25_000;
const REQUEST_TIMEOUT_MS = 15_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];
const RECONNECT_JITTER_RATIO = 0.25;
const STABLE_CONNECTION_MS = 5_000;
const MAX_QUEUED_MESSAGES = 100;
const NON_RECONNECTABLE_CLOSE_CODES = new Set([1008, 4000, 4400, 4401, 4403, 4404, 4503]);
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

// Survives Chat page unmount so sidebar can paint who just wrote after navigation.
const inboxMessagePreviewByConversation = new Map();
const INBOX_PREVIEW_TTL_MS = 10 * 60 * 1000;
const INBOX_PREVIEW_MAX_ENTRIES = 200;

export const pruneInboxMessagePreviews = ({
  now = Date.now(),
  maxEntries = INBOX_PREVIEW_MAX_ENTRIES,
} = {}) => {
  [...inboxMessagePreviewByConversation.entries()].forEach(([conversationId, entry]) => {
    if ((now - Number(entry?.at || 0)) > INBOX_PREVIEW_TTL_MS) {
      inboxMessagePreviewByConversation.delete(conversationId);
    }
  });
  const safeMaxEntries = Math.max(0, Number(maxEntries) || 0);
  while (inboxMessagePreviewByConversation.size > safeMaxEntries) {
    const oldestConversationId = inboxMessagePreviewByConversation.keys().next().value;
    if (oldestConversationId === undefined) break;
    inboxMessagePreviewByConversation.delete(oldestConversationId);
  }
};

export const noteInboxMessagePreview = (envelope = {}) => {
  const payload = envelope?.payload || envelope || {};
  const conversationId = normalizeConversationId(
    envelope?.conversation_id || payload?.conversation_id,
  );
  const messageId = String(payload?.id || '').trim();
  if (!conversationId || !messageId) return;
  inboxMessagePreviewByConversation.delete(conversationId);
  inboxMessagePreviewByConversation.set(conversationId, {
    message: payload,
    at: Date.now(),
  });
  pruneInboxMessagePreviews();
};

export const peekInboxMessagePreview = (conversationId) => {
  const id = normalizeConversationId(conversationId);
  if (!id) return null;
  const entry = inboxMessagePreviewByConversation.get(id);
  if (!entry) return null;
  if ((Date.now() - Number(entry.at || 0)) > INBOX_PREVIEW_TTL_MS) {
    inboxMessagePreviewByConversation.delete(id);
    return null;
  }
  return entry.message || null;
};

const buildPreviewText = (message) => {
  if (!message) return 'Сообщение';
  if (message?.is_deleted) return 'Сообщение удалено';
  if (message.kind === 'system') return String(message.body || 'Системное событие').trim() || 'Системное событие';
  if (message.kind === 'task_share') return 'Поделились задачей';
  const body = String(message.body || '').trim();
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (message.kind === 'file' && body) return body;
  if (attachments.length === 1) {
    if (String(attachments[0]?.kind || attachments[0]?.media_kind || '').trim().toLowerCase() === 'sticker') {
      return 'Стикер';
    }
    return `Файл: ${String(attachments[0]?.file_name || 'вложение').trim() || 'вложение'}`;
  }
  if (attachments.length > 1) return `Файлы: ${attachments.length}`;
  return body || 'Сообщение';
};

export const mergeInboxPreviewsIntoConversations = (items = []) => {
  const list = Array.isArray(items) ? items : [];
  pruneInboxMessagePreviews();
  if (list.length === 0 || inboxMessagePreviewByConversation.size === 0) return list;
  const now = Date.now();
  let changed = false;
  const next = list.map((item) => {
    const id = normalizeConversationId(item?.id);
    if (!id) return item;
    const entry = inboxMessagePreviewByConversation.get(id);
    if (!entry?.message) return item;
    if ((now - Number(entry.at || 0)) > INBOX_PREVIEW_TTL_MS) {
      inboxMessagePreviewByConversation.delete(id);
      return item;
    }
    const message = entry.message;
    const messageAt = String(message?.created_at || '').trim();
    const currentAt = String(item?.last_message_at || item?.updated_at || '').trim();
    // Keep server row if it is already newer than the buffered socket message.
    if (messageAt && currentAt && currentAt.localeCompare(messageAt) > 0) {
      return item;
    }
    const nextPreview = buildPreviewText(message);
    const sameStamp = Boolean(messageAt) && currentAt === messageAt;
    const samePreview = sameStamp && String(item?.last_message_preview || '') === nextPreview;
    if (samePreview) return item;
    changed = true;
    const isOwn = Boolean(message?.is_own);
    return {
      ...item,
      last_message_at: messageAt || item.last_message_at,
      updated_at: messageAt || item.updated_at,
      last_message_preview: nextPreview,
      last_message_is_own: isOwn,
      last_message_delivery_status: isOwn
        ? (String(message?.delivery_status || '').trim() || 'sent')
        : null,
      // Don't invent +1 on every merge (server unread may already be correct).
      // Only lift a stale 0 when the buffered message is clearly newer.
      unread_count: isOwn
        ? Number(item.unread_count || 0)
        : Math.max(Number(item.unread_count || 0), sameStamp ? Number(item.unread_count || 0) : 1),
    };
  });
  return changed ? next : list;
};

const normalizePresenceUserIds = (userIds = []) => Array.from(new Set(
  (Array.isArray(userIds) ? userIds : [])
    .map((value) => Number(value || 0))
    .filter((value) => Number.isFinite(value) && value > 0),
)).slice(0, 50);

const buildPresenceUserIdsKey = (userIds = []) => [...userIds].sort((a, b) => a - b).join(',');

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
    this.wantInbox = false;
    this.activeConversationIds = new Set();
    this.watchedPresenceUserIds = new Set();
    this.watchedPresenceUserIdsKey = '';
    this.pendingRequests = new Map();
    this.reconnectAttempt = 0;
    this.manualClose = false;
    this.messageQueue = [];
    this.pendingConversationSubscriptions = new Map();
    this.missedPongs = 0;
    this.maxMissedPongs = 3;
    this.stableConnectionTimer = null;
    this.authBlocked = false;
    this.resumeRecoverInFlight = false;
  }

  hasActiveOrPendingSocket() {
    if (!this.socket) return false;
    const state = this.socket.readyState;
    return state === WebSocket.CONNECTING
      || state === WebSocket.OPEN
      || state === WebSocket.CLOSING;
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
      this.watchedPresenceUserIdsKey = '';
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
    const normalizedUserIds = normalizePresenceUserIds(userIds);
    const normalizedKey = buildPresenceUserIdsKey(normalizedUserIds);
    if (!CHAT_WS_ENABLED) return Promise.resolve({ user_ids: normalizedUserIds });
    this.connect();
    if (normalizedKey === this.watchedPresenceUserIdsKey) {
      return Promise.resolve({ user_ids: normalizedUserIds });
    }
    this.watchedPresenceUserIds = new Set(normalizedUserIds);
    this.watchedPresenceUserIdsKey = normalizedKey;
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
    if (this.authBlocked) {
      // #region agent log
      emitAgentDebugLog({
        location: 'chatSocket.js:connect',
        message: 'connect skipped: authBlocked',
        hypothesisId: 'H1',
        data: {
          connectionState: this.connectionState,
          retainCount: this.retainCount,
          wantInbox: this.wantInbox,
          activeConversationIds: Array.from(this.activeConversationIds),
        },
      });
      // #endregion
      return;
    }
    if (this.hasActiveOrPendingSocket()) return;
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
      this.resumeRecoverInFlight = false;
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
      this.resumeRecoverInFlight = false;
      this.setStatus('disconnected');
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.resumeRecoverInFlight = false;
      this.socket = null;
      this.stopHeartbeat();
      const closeCode = Number(event?.code || 0);
      const authBlocked = NON_RECONNECTABLE_CLOSE_CODES.has(closeCode);
      const nextStatus = closeCode === 4401 ? 'unauthorized' : closeCode === 4403 ? 'forbidden' : 'disconnected';
      if (authBlocked) {
        this.authBlocked = true;
      }
      // #region agent log
      emitAgentDebugLog({
        location: 'chatSocket.js:onclose',
        message: 'websocket closed',
        hypothesisId: 'H1',
        data: {
          closeCode,
          reason: String(event?.reason || '').slice(0, 200),
          authBlocked,
          willReconnect: !this.manualClose && !authBlocked && this.retainCount > 0,
          nextStatus,
          retainCount: this.retainCount,
          missedPongs: this.missedPongs,
          wantInbox: this.wantInbox,
          activeConversationIds: Array.from(this.activeConversationIds),
        },
      });
      // #endregion
      this.rejectPendingRequests(new Error(authBlocked ? 'Chat websocket access denied' : 'Chat websocket disconnected'));
      this.setStatus(nextStatus);
      if (closeCode === 4401 && !this.manualClose && this.retainCount > 0) {
        dispatchWindowEvent(CHAT_SOCKET_SESSION_EXPIRED_EVENT, {
          closeCode,
          reason: String(event?.reason || '').slice(0, 200),
        });
      }
      if (!this.manualClose && !authBlocked && this.retainCount > 0) {
        this.scheduleReconnect();
      }
    };
  }

  close(manual = false) {
    this.manualClose = Boolean(manual);
    this.resumeRecoverInFlight = false;
    if (manual) {
      this.authBlocked = false;
    }
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
      const conversationId = String(envelope?.conversation_id || payload?.conversation_id || '').trim();
      const messageId = String(payload?.id || '').trim();
      // Keep previews even when Chat page is unmounted — otherwise the sidebar
      // reloads stale SWR/server cache and hides who just wrote.
      noteInboxMessagePreview(envelope);
      invalidateSWRCacheByPrefix('chat', 'conversations');
      // #region agent log
      emitAgentDebugLog({
        location: 'chatSocket.js:handleMessage',
        message: 'chat.message.created received on socket',
        hypothesisId: 'H2',
        data: {
          conversationId,
          messageId,
          isOwn: Boolean(payload?.is_own),
          connectionState: this.connectionState,
          activeConversationIds: Array.from(this.activeConversationIds),
          previewBuffered: Boolean(conversationId && messageId),
        },
      });
      // #endregion
      dispatchWindowEvent(CHAT_SOCKET_MESSAGE_CREATED_EVENT, envelope);
      return;
    }
    if (eventType === 'chat.message.deleted') {
      dispatchWindowEvent(CHAT_SOCKET_MESSAGE_DELETED_EVENT, envelope);
      return;
    }
    if (eventType === 'chat.message.updated') {
      dispatchWindowEvent(CHAT_SOCKET_MESSAGE_UPDATED_EVENT, envelope);
      return;
    }
    if (eventType === 'chat.message.read') {
      dispatchWindowEvent(CHAT_SOCKET_MESSAGE_READ_EVENT, envelope);
      return;
    }
    if (eventType === 'chat.message.reaction') {
      dispatchWindowEvent(CHAT_SOCKET_MESSAGE_REACTION_EVENT, envelope);
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
      return;
    }
    if (eventType === 'chat.ai.sandbox.updated') {
      dispatchWindowEvent(CHAT_SOCKET_AI_SANDBOX_UPDATED_EVENT, envelope);
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
      if (!this.isOpen()) {
        return;
      }
      if (this.missedPongs >= this.maxMissedPongs) {
        // #region agent log
        emitAgentDebugLog({
          location: 'chatSocket.js:heartbeat',
          message: 'missed pongs threshold, force reconnect',
          hypothesisId: 'H1',
          data: {
            missedPongs: this.missedPongs,
            connectionState: this.connectionState,
            retainCount: this.retainCount,
          },
        });
        // #endregion
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
    if (this.stableConnectionTimer) {
      window.clearTimeout(this.stableConnectionTimer);
      this.stableConnectionTimer = null;
    }
  }

  resetAuthBlock() {
    const wasBlocked = Boolean(this.authBlocked);
    this.authBlocked = false;
    this.reconnectAttempt = 0;
    // #region agent log
    emitAgentDebugLog({
      location: 'chatSocket.js:resetAuthBlock',
      message: 'auth block cleared, reconnecting socket',
      hypothesisId: 'H1',
      runId: 'post-fix',
      data: {
        wasBlocked,
        retainCount: this.retainCount,
        connectionState: this.connectionState,
        wantInbox: this.wantInbox,
        activeConversationIds: Array.from(this.activeConversationIds),
      },
    });
    // #endregion
    if (this.retainCount > 0) {
      this.connect();
    }
  }

  recoverAfterSystemResume() {
    if (this.resumeRecoverInFlight) {
      return false;
    }
    if (this.retainCount <= 0) {
      return false;
    }
    if (!CHAT_WS_ENABLED || !canUseBrowserSocket()) {
      return false;
    }

    this.resumeRecoverInFlight = true;
    try {
      // Stale WS 401 from before sleep must not block reconnect after a live session refresh.
      this.authBlocked = false;
      this.stopHeartbeat();
      if (this.reconnectTimer) {
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      const socket = this.socket;
      this.socket = null;
      this.manualClose = false;
      this.reconnectAttempt = 0;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
          if (
            socket.readyState === WebSocket.OPEN
            || socket.readyState === WebSocket.CONNECTING
          ) {
            socket.close();
          }
        } catch {
          // Stale transport may already be gone after sleep.
        }
      }
      this.setStatus('disconnected');
      this.connect();
      if (!this.hasActiveOrPendingSocket()) {
        this.resumeRecoverInFlight = false;
      }
      return true;
    } catch (error) {
      this.resumeRecoverInFlight = false;
      throw error;
    }
  }

  getConnectionState() {
    return String(this.connectionState || '').trim() || 'disconnected';
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
    // Extend timeouts for pending requests that were queued while offline so
    // their request_id is still registered when the server responds after flush.
    this.pendingRequests.forEach((pending, requestId) => {
      window.clearTimeout(pending.timeoutId);
      pending.timeoutId = window.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        pending.reject(new Error('Chat websocket command timed out'));
      }, REQUEST_TIMEOUT_MS);
    });
    const queued = [...this.messageQueue];
    this.messageQueue = [];
    if (queued.length === 0) return;
    queued.forEach((payload) => {
      const requestId = String(payload?.request_id || '').trim();
      // Skip messages whose request_id already timed out (no longer in pendingRequests).
      if (requestId && !this.pendingRequests.has(requestId)) return;
      try {
        this.socket.send(JSON.stringify(payload));
      } catch {
        this.enqueueOfflineMessage(payload);
      }
    });
  }
}

export const chatSocket = new ChatSocketClient();
