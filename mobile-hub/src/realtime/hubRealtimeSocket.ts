import { API_V1_BASE } from '../api/config';
import { getAuthenticatedAccessToken } from '../api/client';

type SocketHandler = (payload: unknown) => void;

export type HubRealtimeStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'suspended'
  | 'error';

const HEARTBEAT_MS = 25_000;
const MAX_MISSED_PONGS = 3;
const MAX_BUFFERED_BYTES = 256 * 1024;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];
const RECONNECT_JITTER_RATIO = 0.25;
const INITIAL_RECONNECT_SPREAD_MS = 5_000;
const RECENT_EVENT_IDS_LIMIT = 512;
const NON_RECONNECTABLE_CLOSE_CODES = new Set([1008, 4000, 4400, 4403, 4404]);

export const HUB_TASK_REALTIME_EVENT_TYPES = [
  'tasks.task.created',
  'tasks.task.updated',
  'tasks.task.deleted',
] as const;

export const HUB_MAIL_REALTIME_EVENT_TYPES = [
  'mail.message.received',
  'mail.unread.changed',
  'mail.message.state_changed',
] as const;

export const HUB_DOCFLOW_REALTIME_EVENT_TYPES = ['docflow.task.changed'] as const;
export const HUB_INTEGRATION_REALTIME_EVENT_TYPES = [
  'integration.1c.sync.completed',
  'integration.1c.sync.failed',
] as const;

const HUB_TASK_PRESENCE_EVENT_TYPES = new Set([
  'tasks.presence.snapshot',
  'tasks.presence.joined',
  'tasks.presence.present',
  'tasks.presence.heartbeat',
  'tasks.presence.left',
]);

function buildWsUrl(): string {
  const base = new URL(API_V1_BASE);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = `${base.pathname.replace(/\/$/, '')}/chat/hub-realtime/ws`;
  base.search = '';
  base.hash = '';
  return base.toString();
}

export class HubRealtimeSocketClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<SocketHandler>>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private reconnectEnabled = false;
  private suspended = false;
  private connectGeneration = 0;
  private missedPongs = 0;
  private status: HubRealtimeStatus = 'disconnected';
  private recentEventIds = new Map<string, number>();
  private connectionId = '';
  private taskPresenceHandlers = new Map<string, Set<SocketHandler>>();

  on(eventType: string, handler: SocketHandler): () => void {
    if (!this.handlers.has(eventType)) this.handlers.set(eventType, new Set());
    this.handlers.get(eventType)!.add(handler);
    return () => this.handlers.get(eventType)?.delete(handler);
  }

  onTaskChanged(handler: SocketHandler): () => void {
    const releases = HUB_TASK_REALTIME_EVENT_TYPES.map((eventType) => this.on(eventType, handler));
    return () => releases.forEach((release) => release());
  }

  onMailChanged(handler: SocketHandler): () => void {
    const releases = HUB_MAIL_REALTIME_EVENT_TYPES.map((eventType) => this.on(eventType, handler));
    return () => releases.forEach((release) => release());
  }

  onDocflowChanged(handler: SocketHandler): () => void {
    const releases = HUB_DOCFLOW_REALTIME_EVENT_TYPES.map((eventType) => this.on(eventType, handler));
    return () => releases.forEach((release) => release());
  }

  onIntegrationChanged(handler: SocketHandler): () => void {
    const releases = HUB_INTEGRATION_REALTIME_EVENT_TYPES.map((eventType) => this.on(eventType, handler));
    return () => releases.forEach((release) => release());
  }

  watchTaskPresence(taskId: string, handler: SocketHandler): () => void {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) return () => undefined;
    if (!this.taskPresenceHandlers.has(normalizedTaskId)) {
      this.taskPresenceHandlers.set(normalizedTaskId, new Set());
    }
    const handlers = this.taskPresenceHandlers.get(normalizedTaskId)!;
    const first = handlers.size === 0;
    handlers.add(handler);
    if (first) this.sendTaskPresence('tasks.presence.join', normalizedTaskId);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.taskPresenceHandlers.delete(normalizedTaskId);
        this.sendTaskPresence('tasks.presence.leave', normalizedTaskId);
      }
    };
  }

  getStatus(): HubRealtimeStatus {
    return this.status;
  }

  private emit(eventType: string, payload: unknown): void {
    this.handlers.get(eventType)?.forEach((handler) => handler(payload));
  }

  private emitStatus(status: HubRealtimeStatus): void {
    this.status = status;
    this.emit('status', status);
  }

  private claimEvent(envelope: { payload?: unknown }): boolean {
    const payload = envelope.payload && typeof envelope.payload === 'object'
      ? envelope.payload as Record<string, unknown>
      : {};
    const eventId = String(payload.event_id || '').trim();
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

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.reconnectEnabled || this.suspended) return;
    const baseDelay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    const jitter = baseDelay * RECONNECT_JITTER_RATIO * ((Math.random() * 2) - 1);
    const initialSpread = this.reconnectAttempt === 0 ? Math.random() * INITIAL_RECONNECT_SPREAD_MS : 0;
    const maxDelay = RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1];
    const delay = Math.max(0, Math.min(maxDelay, baseDelay + jitter + initialSpread));
    this.reconnectAttempt += 1;
    this.emitStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedPongs = 0;
    this.heartbeatTimer = setInterval(() => {
      const socket = this.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      if (this.missedPongs >= MAX_MISSED_PONGS) {
        this.emitStatus('error');
        socket.close(1011, 'hub realtime heartbeat timeout');
        return;
      }
      this.missedPongs += 1;
      this.send({ type: 'hub.realtime.ping', payload: {} });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.missedPongs = 0;
  }

  private send(message: Record<string, unknown>): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    if (Number(socket.bufferedAmount || 0) > MAX_BUFFERED_BYTES) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  private sendTaskPresence(type: string, taskId: string, targetConnectionId = ''): boolean {
    return this.send({
      type,
      payload: {
        task_id: String(taskId || '').trim(),
        ...(targetConnectionId ? { target_connection_id: targetConnectionId } : {}),
      },
    });
  }

  async connect(): Promise<void> {
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

    let socket: WebSocket;
    try {
      socket = new (WebSocket as unknown as new (
        url: string,
        protocols?: string | string[] | null,
        options?: { headers?: Record<string, string> },
      ) => WebSocket)(buildWsUrl(), undefined, {
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
      this.startHeartbeat();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      try {
        const envelope = JSON.parse(String(event.data || '{}')) as {
          type?: string;
          payload?: unknown;
        };
        const eventType = String(envelope.type || '').trim();
        if (!eventType) return;
        if (eventType === 'hub.realtime.pong') {
          this.missedPongs = 0;
          return;
        }
        if (eventType === 'hub.realtime.connected') {
          const payload = envelope.payload && typeof envelope.payload === 'object'
            ? envelope.payload as Record<string, unknown>
            : {};
          this.connectionId = String(payload.connection_id || '').trim();
          this.reconnectAttempt = 0;
          this.emitStatus('connected');
          this.taskPresenceHandlers.forEach((_, taskId) => {
            this.sendTaskPresence('tasks.presence.join', taskId);
          });
          this.emit(eventType, envelope);
          return;
        }
        const payload = envelope.payload && typeof envelope.payload === 'object'
          ? envelope.payload as Record<string, unknown>
          : {};
        if (eventType === 'tasks.presence.sync.requested') {
          const taskId = String(payload.task_id || '').trim();
          const targetConnectionId = String(payload.target_connection_id || '').trim();
          if (taskId && targetConnectionId && this.taskPresenceHandlers.has(taskId)) {
            this.sendTaskPresence('tasks.presence.sync', taskId, targetConnectionId);
          }
          return;
        }
        if (HUB_TASK_PRESENCE_EVENT_TYPES.has(eventType)) {
          const taskId = String(payload.task_id || '').trim();
          const targetConnectionId = String(payload.target_connection_id || '').trim();
          if (!targetConnectionId || targetConnectionId === this.connectionId) {
            this.taskPresenceHandlers.get(taskId)?.forEach((handler) => handler(envelope));
          }
          return;
        }
        if (this.claimEvent(envelope)) return;
        this.emit(eventType, envelope);
      } catch {
        // Ignore malformed frames and keep the connection usable.
      }
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.connectionId = '';
      this.stopHeartbeat();
      const closeCode = Number(event.code || 0);
      if (NON_RECONNECTABLE_CLOSE_CODES.has(closeCode)) {
        this.reconnectEnabled = false;
      }
      this.emitStatus(this.suspended ? 'suspended' : 'offline');
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      if (this.socket === socket) this.emitStatus('error');
    };
  }

  suspend(): void {
    if (this.suspended) return;
    this.suspended = true;
    this.connectGeneration += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    this.connectionId = '';
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

  disconnect(): void {
    this.reconnectEnabled = false;
    this.suspended = false;
    this.connectGeneration += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    this.connectionId = '';
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    this.reconnectAttempt = 0;
    this.emitStatus('disconnected');
  }
}

export const hubRealtimeSocket = new HubRealtimeSocketClient();
