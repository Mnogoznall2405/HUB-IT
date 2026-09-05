import { API_V1_BASE, authAPI } from '../api/client';

const HEARTBEAT_MS = 25_000;
const MAX_MISSED_PONGS = 3;
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];
const RECONNECT_JITTER_RATIO = 0.25;
const STABLE_CONNECTION_MS = 5_000;
const NON_RECONNECTABLE_CLOSE_CODES = new Set([1008, 4000, 4400, 4403, 4404]);
const AUTH_TOKEN_REFRESHED_EVENT = 'auth-token-refreshed';
const browserWindow = typeof globalThis.window === 'undefined' ? null : globalThis.window;

const canUseBrowserSocket = () => (
  Boolean(browserWindow) && typeof browserWindow.WebSocket !== 'undefined'
);

export const buildTaskCanvasSocketUrl = (taskId) => {
  if (!browserWindow) return '';
  const target = new browserWindow.URL(
    `${API_V1_BASE}/chat/task-canvas/ws`,
    browserWindow.location.origin,
  );
  target.protocol = browserWindow.location.protocol === 'https:' ? 'wss:' : 'ws:';
  target.searchParams.set('task_id', String(taskId || '').trim());
  return target.toString();
};

export class TaskCanvasSocketClient {
  constructor({ taskId, onEvent = () => {}, onStatus = () => {} }) {
    this.taskId = String(taskId || '').trim();
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.socket = null;
    this.status = 'disconnected';
    this.manualClose = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.stableConnectionTimer = null;
    this.missedPongs = 0;
    this.authBlocked = false;
    this.authRecoveryAttempted = false;
    this.authRecoveryPromise = null;
    this.handleAuthTokenRefreshed = () => this.resetAuthBlock();
    browserWindow?.addEventListener?.(AUTH_TOKEN_REFRESHED_EVENT, this.handleAuthTokenRefreshed);
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }

  connect() {
    if (!this.taskId || !canUseBrowserSocket() || this.manualClose || this.authBlocked) return;
    if (this.socket && [
      browserWindow.WebSocket.CONNECTING,
      browserWindow.WebSocket.OPEN,
      browserWindow.WebSocket.CLOSING,
    ].includes(this.socket.readyState)) {
      return;
    }
    const url = buildTaskCanvasSocketUrl(this.taskId);
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
      let envelope;
      try {
        envelope = JSON.parse(event?.data);
      } catch {
        return;
      }
      if (!envelope || typeof envelope !== 'object') return;
      if (envelope.type === 'task_canvas.pong') this.missedPongs = 0;
      if (envelope.type === 'task_canvas.connected') {
        this.setStatus('connected');
        if (this.stableConnectionTimer) browserWindow.clearTimeout(this.stableConnectionTimer);
        this.stableConnectionTimer = browserWindow.setTimeout(() => {
          this.reconnectAttempt = 0;
          this.authRecoveryAttempted = false;
          this.stableConnectionTimer = null;
        }, STABLE_CONNECTION_MS);
      }
      this.onEvent(envelope);
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
        if (!this.manualClose && !this.authRecoveryAttempted) void this.recoverAuthorization();
        return;
      }
      this.setStatus('disconnected');
      if (!this.manualClose && !NON_RECONNECTABLE_CLOSE_CODES.has(closeCode)) {
        this.scheduleReconnect();
      }
    };
  }

  recoverAuthorization() {
    if (this.authRecoveryPromise || this.manualClose) return this.authRecoveryPromise;
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
    if (!this.authBlocked || this.manualClose) return;
    this.authBlocked = false;
    this.reconnectAttempt = 0;
    this.connect();
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.manualClose || this.authBlocked) return;
    const index = Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1);
    const baseDelay = RECONNECT_DELAYS_MS[index];
    const jitter = Math.round(baseDelay * RECONNECT_JITTER_RATIO * Math.random());
    this.reconnectAttempt += 1;
    this.setStatus('reconnecting');
    this.reconnectTimer = browserWindow.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, baseDelay + jitter);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = browserWindow.setInterval(() => {
      if (!this.socket || this.socket.readyState !== browserWindow.WebSocket.OPEN) return;
      if (this.missedPongs >= MAX_MISSED_PONGS) {
        this.socket.close(1011, 'task canvas heartbeat timeout');
        return;
      }
      this.missedPongs += 1;
      this.send({ type: 'task_canvas.ping', payload: {} });
    }, HEARTBEAT_MS);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) browserWindow.clearInterval(this.heartbeatTimer);
    if (this.stableConnectionTimer) browserWindow.clearTimeout(this.stableConnectionTimer);
    this.heartbeatTimer = null;
    this.stableConnectionTimer = null;
    this.missedPongs = 0;
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

  sendCursor(payload) {
    return this.send({ type: 'task_canvas.cursor', payload });
  }

  sendScene(scene, { baseRevision = 0, targetConnectionId = '' } = {}) {
    return this.send({
      type: 'task_canvas.scene.update',
      payload: {
        scene,
        base_revision: Math.max(0, Number(baseRevision) || 0),
        target_connection_id: String(targetConnectionId || '').trim() || undefined,
      },
    });
  }

  requestSync() {
    return this.send({ type: 'task_canvas.sync.request', payload: {} });
  }

  close() {
    this.manualClose = true;
    browserWindow?.removeEventListener?.(AUTH_TOKEN_REFRESHED_EVENT, this.handleAuthTokenRefreshed);
    if (this.reconnectTimer) browserWindow.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close(1000, 'task canvas closed');
      } catch {
        // The transport is already gone.
      }
    }
    this.setStatus('disconnected');
  }
}

export const createTaskCanvasSocket = (options) => new TaskCanvasSocketClient(options);

export default createTaskCanvasSocket;
