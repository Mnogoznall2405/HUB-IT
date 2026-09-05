import { API_V1_BASE, authAPI } from '../api/client';

export const HUB_REALTIME_NOTIFICATION_EVENT = 'hub-realtime-notification-created';
export const HUB_REALTIME_TASK_EVENT = 'hub-realtime-task-changed';
export const HUB_REALTIME_MAIL_EVENT = 'hub-realtime-mail-changed';
export const HUB_REALTIME_DOCFLOW_EVENT = 'hub-realtime-docflow-changed';
export const HUB_REALTIME_INTEGRATION_EVENT = 'hub-realtime-integration-changed';
export const HUB_REALTIME_DASHBOARD_EVENT = 'hub-realtime-dashboard-invalidated';
export const HUB_REALTIME_TASK_PRESENCE_EVENT = 'hub-realtime-task-presence';
export const HUB_REALTIME_CONNECTED_EVENT = 'hub-realtime-connected';
export const HUB_REALTIME_STABLE_EVENT = 'hub-realtime-stable';
export const HUB_REALTIME_STATUS_EVENT = 'hub-realtime-status';
export const HUB_REALTIME_ENABLED = !['0', 'false', 'off', 'no'].includes(
  String(import.meta.env.VITE_HUB_REALTIME_ENABLED ?? '1').trim().toLowerCase(),
);
export const HUB_REALTIME_RELAX_POLLING_ENABLED = ['1', 'true', 'on', 'yes'].includes(
  String(import.meta.env.VITE_HUB_REALTIME_RELAX_POLLING ?? '0').trim().toLowerCase(),
);

const HEARTBEAT_MS = 25_000;
const MAX_MISSED_PONGS = 3;
const MAX_BUFFERED_BYTES = 256 * 1024;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];
const RECONNECT_JITTER_RATIO = 0.25;
const INITIAL_RECONNECT_SPREAD_MS = 5_000;
const STABLE_CONNECTION_MS = 5_000;
const NON_RECONNECTABLE_CLOSE_CODES = new Set([1008, 4000, 4400, 4403, 4404]);
const AUTH_TOKEN_REFRESHED_EVENT = 'auth-token-refreshed';
const RECENT_EVENT_IDS_LIMIT = 512;
const TASK_EVENT_TYPES = new Set(['tasks.task.created', 'tasks.task.updated', 'tasks.task.deleted']);
const MAIL_EVENT_TYPES = new Set(['mail.message.received', 'mail.unread.changed', 'mail.message.state_changed']);
const DOCFLOW_EVENT_TYPES = new Set(['docflow.task.changed']);
const INTEGRATION_EVENT_TYPES = new Set(['integration.1c.sync.completed', 'integration.1c.sync.failed']);
const TASK_PRESENCE_EVENT_TYPES = new Set([
  'tasks.presence.snapshot',
  'tasks.presence.joined',
  'tasks.presence.present',
  'tasks.presence.heartbeat',
  'tasks.presence.left',
]);

const browserWindow = typeof globalThis.window === 'undefined' ? null : globalThis.window;

const canUseBrowserSocket = () => (
  HUB_REALTIME_ENABLED
  && Boolean(browserWindow)
  && typeof browserWindow.WebSocket !== 'undefined'
);

const dispatchWindowEvent = (eventName, detail) => {
  if (!browserWindow?.dispatchEvent || typeof browserWindow.CustomEvent !== 'function') return;
  browserWindow.dispatchEvent(new browserWindow.CustomEvent(eventName, { detail }));
};

export const buildHubRealtimeSocketUrl = () => {
  if (!browserWindow) return '';
  const target = new browserWindow.URL(
    `${API_V1_BASE}/chat/hub-realtime/ws`,
    browserWindow.location.origin,
  );
  target.protocol = browserWindow.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return target.toString();
};

export class HubRealtimeSocketClient {
  constructor() {
    this.socket = null;
    this.status = 'disconnected';
    this.retainCount = 0;
    this.manualClose = false;
    this.authBlocked = false;
    this.authRecoveryAttempted = false;
    this.authRecoveryPromise = null;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.stableConnectionTimer = null;
    this.missedPongs = 0;
    this.connectionStable = false;
    this.recentEventIds = new Map();
    this.connectionId = '';
    this.taskPresenceRetains = new Map();
    this.handleAuthTokenRefreshed = () => this.resetAuthBlock();
    browserWindow?.addEventListener?.(AUTH_TOKEN_REFRESHED_EVENT, this.handleAuthTokenRefreshed);
  }

  retain() {
    if (!canUseBrowserSocket()) return () => {};
    this.retainCount += 1;
    this.manualClose = false;
    this.connect();
    return () => this.release();
  }

  isStableConnection() {
    return this.status === 'connected' && this.connectionStable;
  }

  release() {
    this.retainCount = Math.max(0, Number(this.retainCount || 0) - 1);
    if (this.retainCount === 0) this.close(true);
  }

  watchTaskPresence(taskId) {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId || !canUseBrowserSocket()) return () => {};
    const currentCount = Number(this.taskPresenceRetains.get(normalizedTaskId) || 0);
    this.taskPresenceRetains.set(normalizedTaskId, currentCount + 1);
    const releaseSocket = this.retain();
    if (currentCount === 0) this.sendTaskPresence('tasks.presence.join', normalizedTaskId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const nextCount = Math.max(0, Number(this.taskPresenceRetains.get(normalizedTaskId) || 0) - 1);
      if (nextCount > 0) this.taskPresenceRetains.set(normalizedTaskId, nextCount);
      else {
        this.taskPresenceRetains.delete(normalizedTaskId);
        this.sendTaskPresence('tasks.presence.leave', normalizedTaskId);
      }
      releaseSocket();
    };
  }

  sendTaskPresence(type, taskId, targetConnectionId = '') {
    return this.send({
      type,
      payload: {
        task_id: String(taskId || '').trim(),
        ...(targetConnectionId ? { target_connection_id: targetConnectionId } : {}),
      },
    });
  }

  connect() {
    if (!canUseBrowserSocket() || this.manualClose || this.authBlocked || this.retainCount <= 0) return;
    if (this.socket && [
      browserWindow.WebSocket.CONNECTING,
      browserWindow.WebSocket.OPEN,
      browserWindow.WebSocket.CLOSING,
    ].includes(this.socket.readyState)) return;

    if (this.reconnectTimer) {
      browserWindow.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const url = buildHubRealtimeSocketUrl();
    if (!url) return;
    const socket = new browserWindow.WebSocket(url);
    this.socket = socket;
    this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.missedPongs = 0;
      this.startHeartbeat();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(event?.data);
    };
    socket.onerror = () => {
      if (this.socket === socket) this.setStatus('disconnected');
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      const closeCode = Number(event?.code || 0);
      this.socket = null;
      this.stopHeartbeat();
      if (closeCode === 4401) {
        this.authBlocked = true;
        this.setStatus('unauthorized');
        if (!this.manualClose && !this.authRecoveryAttempted && this.retainCount > 0) {
          void this.recoverAuthorization();
        }
        return;
      }
      this.setStatus(closeCode === 4403 ? 'forbidden' : 'disconnected');
      if (
        !this.manualClose
        && this.retainCount > 0
        && !NON_RECONNECTABLE_CLOSE_CODES.has(closeCode)
      ) {
        this.scheduleReconnect();
      }
    };
  }

  handleMessage(rawPayload) {
    let envelope;
    try {
      envelope = JSON.parse(rawPayload);
    } catch {
      return;
    }
    if (!envelope || typeof envelope !== 'object') return;
    const eventType = String(envelope.type || '').trim();
    if (eventType === 'hub.realtime.pong') {
      this.missedPongs = 0;
      return;
    }
    if (eventType === 'hub.realtime.connected') {
      this.connectionId = String(envelope?.payload?.connection_id || '').trim();
      this.connectionStable = false;
      this.setStatus('connected');
      if (this.stableConnectionTimer) browserWindow.clearTimeout(this.stableConnectionTimer);
      this.stableConnectionTimer = browserWindow.setTimeout(() => {
        if (this.status !== 'connected' || !this.socket) return;
        this.reconnectAttempt = 0;
        this.authRecoveryAttempted = false;
        this.connectionStable = true;
        this.stableConnectionTimer = null;
        dispatchWindowEvent(HUB_REALTIME_STABLE_EVENT, {
          status: 'connected',
          connection_id: this.connectionId,
        });
      }, STABLE_CONNECTION_MS);
      for (const taskId of this.taskPresenceRetains.keys()) {
        this.sendTaskPresence('tasks.presence.join', taskId);
      }
      dispatchWindowEvent(HUB_REALTIME_CONNECTED_EVENT, envelope);
      return;
    }
    if (eventType === 'tasks.presence.sync.requested') {
      const taskId = String(envelope?.payload?.task_id || '').trim();
      const targetConnectionId = String(envelope?.payload?.target_connection_id || '').trim();
      if (taskId && targetConnectionId && this.taskPresenceRetains.has(taskId)) {
        this.sendTaskPresence('tasks.presence.sync', taskId, targetConnectionId);
      }
      return;
    }
    if (TASK_PRESENCE_EVENT_TYPES.has(eventType)) {
      const targetConnectionId = String(envelope?.payload?.target_connection_id || '').trim();
      if (!targetConnectionId || targetConnectionId === this.connectionId) {
        dispatchWindowEvent(HUB_REALTIME_TASK_PRESENCE_EVENT, envelope);
      }
      return;
    }
    if (this.claimEvent(envelope)) return;
    if (eventType === 'hub.notification.created') {
      dispatchWindowEvent(HUB_REALTIME_NOTIFICATION_EVENT, envelope);
      return;
    }
    if (TASK_EVENT_TYPES.has(eventType)) {
      dispatchWindowEvent(HUB_REALTIME_TASK_EVENT, envelope);
      return;
    }
    if (MAIL_EVENT_TYPES.has(eventType)) {
      dispatchWindowEvent(HUB_REALTIME_MAIL_EVENT, envelope);
      return;
    }
    if (DOCFLOW_EVENT_TYPES.has(eventType)) {
      dispatchWindowEvent(HUB_REALTIME_DOCFLOW_EVENT, envelope);
      return;
    }
    if (INTEGRATION_EVENT_TYPES.has(eventType)) {
      dispatchWindowEvent(HUB_REALTIME_INTEGRATION_EVENT, envelope);
      return;
    }
    if (eventType === 'dashboard.invalidate') {
      dispatchWindowEvent(HUB_REALTIME_DASHBOARD_EVENT, envelope);
    }
  }

  claimEvent(envelope) {
    const eventId = String(envelope?.payload?.event_id || '').trim();
    if (!eventId) return false;
    if (this.recentEventIds.has(eventId)) return true;
    this.recentEventIds.set(eventId, Date.now());
    while (this.recentEventIds.size > RECENT_EVENT_IDS_LIMIT) {
      const oldest = this.recentEventIds.keys().next().value;
      if (!oldest) break;
      this.recentEventIds.delete(oldest);
    }
    return false;
  }

  recoverAuthorization() {
    if (this.authRecoveryPromise || this.manualClose || this.retainCount <= 0) {
      return this.authRecoveryPromise;
    }
    this.authRecoveryAttempted = true;
    this.authRecoveryPromise = Promise.resolve()
      .then(() => authAPI.refresh())
      .then(() => this.resetAuthBlock())
      .catch(() => undefined)
      .finally(() => {
        this.authRecoveryPromise = null;
      });
    return this.authRecoveryPromise;
  }

  resetAuthBlock() {
    if (!this.authBlocked || this.manualClose || this.retainCount <= 0) return;
    this.authBlocked = false;
    this.reconnectAttempt = 0;
    this.connect();
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.manualClose || this.authBlocked || this.retainCount <= 0) return;
    const baseDelay = RECONNECT_DELAYS_MS[
      Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
    ];
    const jitter = baseDelay * RECONNECT_JITTER_RATIO * ((Math.random() * 2) - 1);
    const initialSpread = this.reconnectAttempt === 0
      ? Math.random() * INITIAL_RECONNECT_SPREAD_MS
      : 0;
    const delay = Math.max(
      0,
      Math.min(RECONNECT_DELAYS_MS.at(-1), baseDelay + jitter + initialSpread),
    );
    this.reconnectAttempt += 1;
    this.setStatus('reconnecting');
    this.reconnectTimer = browserWindow.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = browserWindow.setInterval(() => {
      const socket = this.socket;
      if (!socket || socket.readyState !== browserWindow.WebSocket.OPEN) return;
      if (this.missedPongs >= MAX_MISSED_PONGS) {
        socket.close(1011, 'hub realtime heartbeat timeout');
        return;
      }
      this.missedPongs += 1;
      this.send({ type: 'hub.realtime.ping', payload: {} });
    }, HEARTBEAT_MS);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) browserWindow.clearInterval(this.heartbeatTimer);
    if (this.stableConnectionTimer) browserWindow.clearTimeout(this.stableConnectionTimer);
    this.heartbeatTimer = null;
    this.stableConnectionTimer = null;
    this.missedPongs = 0;
    this.connectionStable = false;
  }

  send(envelope) {
    const socket = this.socket;
    if (!socket || socket.readyState !== browserWindow.WebSocket.OPEN) return false;
    if (Number(socket.bufferedAmount || 0) > MAX_BUFFERED_BYTES) return false;
    try {
      socket.send(JSON.stringify(envelope));
      return true;
    } catch {
      return false;
    }
  }

  close(manual = false) {
    this.manualClose = Boolean(manual);
    if (manual) this.authBlocked = false;
    if (this.reconnectTimer) browserWindow?.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    this.connectionId = '';
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close(1000, 'hub realtime closed');
      } catch {
        // Transport already closed.
      }
    }
    this.setStatus('disconnected');
  }

  setStatus(status) {
    if (status !== 'connected') this.connectionStable = false;
    if (this.status === status) return;
    this.status = status;
    dispatchWindowEvent(HUB_REALTIME_STATUS_EVENT, { status });
  }
}

export const hubRealtimeSocket = new HubRealtimeSocketClient();

export default hubRealtimeSocket;
