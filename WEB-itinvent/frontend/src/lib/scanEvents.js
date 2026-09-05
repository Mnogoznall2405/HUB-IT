import { API_V1_BASE } from '../api/client';

export const SCAN_EVENTS_CONNECTED_EVENT = 'scan-sse-connected';
export const SCAN_EVENTS_INVALIDATE_EVENT = 'scan-sse-invalidate';
export const SCAN_EVENTS_STATUS_EVENT = 'scan-sse-status';
export const SCAN_EVENTS_ENABLED = !['0', 'false', 'off', 'no'].includes(
  String(import.meta.env.VITE_SCAN_SSE_ENABLED ?? '1').trim().toLowerCase(),
);

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];
const browserWindow = typeof globalThis.window === 'undefined' ? null : globalThis.window;

const dispatchWindowEvent = (eventName, detail) => {
  if (!browserWindow?.dispatchEvent || typeof browserWindow.CustomEvent !== 'function') return;
  browserWindow.dispatchEvent(new browserWindow.CustomEvent(eventName, { detail }));
};

export class ScanEventsClient {
  constructor() {
    this.source = null;
    this.retainCount = 0;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.status = 'disconnected';
    this.recentEventIds = new Set();
  }

  retain() {
    if (!SCAN_EVENTS_ENABLED || !browserWindow?.EventSource) return () => {};
    this.retainCount += 1;
    this.connect();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.retainCount = Math.max(0, this.retainCount - 1);
      if (this.retainCount === 0) this.close();
    };
  }

  connect() {
    if (!SCAN_EVENTS_ENABLED || !browserWindow?.EventSource || this.retainCount <= 0 || this.source) return;
    if (this.reconnectTimer) browserWindow.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const url = new browserWindow.URL(`${API_V1_BASE}/scan/events`, browserWindow.location.origin).toString();
    const source = new browserWindow.EventSource(url, { withCredentials: true });
    this.source = source;
    this.setStatus(this.reconnectAttempt ? 'reconnecting' : 'connecting');

    source.addEventListener('scan.connected', (event) => {
      if (this.source !== source) return;
      const payload = this.parseEvent(event);
      this.reconnectAttempt = 0;
      this.setStatus('connected');
      dispatchWindowEvent(SCAN_EVENTS_CONNECTED_EVENT, payload);
    });
    source.addEventListener('scan.invalidate', (event) => {
      if (this.source !== source) return;
      const payload = this.parseEvent(event);
      const eventId = String(payload?.event_id || event?.lastEventId || '').trim();
      if (eventId && this.recentEventIds.has(eventId)) return;
      if (eventId) {
        this.recentEventIds.add(eventId);
        while (this.recentEventIds.size > 256) {
          this.recentEventIds.delete(this.recentEventIds.values().next().value);
        }
      }
      dispatchWindowEvent(SCAN_EVENTS_INVALIDATE_EVENT, payload);
    });
    source.onerror = () => {
      if (this.source !== source) return;
      source.close();
      this.source = null;
      this.setStatus('disconnected');
      this.scheduleReconnect();
    };
  }

  parseEvent(event) {
    try {
      const payload = JSON.parse(String(event?.data || '{}'));
      return payload && typeof payload === 'object' ? payload : {};
    } catch {
      return {};
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.retainCount <= 0) return;
    const base = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    const jitter = base * 0.25 * ((Math.random() * 2) - 1);
    this.reconnectAttempt += 1;
    this.setStatus('reconnecting');
    this.reconnectTimer = browserWindow.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, Math.max(250, Math.min(RECONNECT_DELAYS_MS.at(-1), base + jitter)));
  }

  close() {
    if (this.reconnectTimer) browserWindow?.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const source = this.source;
    this.source = null;
    source?.close();
    this.reconnectAttempt = 0;
    this.setStatus('disconnected');
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    dispatchWindowEvent(SCAN_EVENTS_STATUS_EVENT, { status });
  }
}

export const scanEvents = new ScanEventsClient();

export default scanEvents;
