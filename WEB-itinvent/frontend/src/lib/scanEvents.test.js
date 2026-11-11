import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({ API_V1_BASE: '/api/v1' }));

class MockEventSource {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.listeners = new Map();
    this.closed = false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  emit(type, payload) {
    this.listeners.get(type)?.({ data: JSON.stringify(payload), lastEventId: payload.event_id || '' });
  }

  close() {
    this.closed = true;
  }
}

describe('ScanEventsClient', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    MockEventSource.instances = [];
    globalThis.window.EventSource = MockEventSource;
    globalThis.EventSource = MockEventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('connects once, forwards invalidations, and closes after the final release', async () => {
    const {
      ScanEventsClient,
      SCAN_EVENTS_CONNECTED_EVENT,
      SCAN_EVENTS_INVALIDATE_EVENT,
    } = await import('./scanEvents');
    const connected = vi.fn();
    const invalidated = vi.fn();
    window.addEventListener(SCAN_EVENTS_CONNECTED_EVENT, connected);
    window.addEventListener(SCAN_EVENTS_INVALIDATE_EVENT, invalidated);
    const client = new ScanEventsClient();
    const firstRelease = client.retain();
    const secondRelease = client.retain();

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toContain('/api/v1/scan/events');
    expect(MockEventSource.instances[0].options).toEqual({ withCredentials: true });
    MockEventSource.instances[0].emit('scan.connected', { event_id: 'connected-1' });
    MockEventSource.instances[0].emit('scan.invalidate', {
      event_id: 'scan-1', sections: ['tasks'],
    });
    MockEventSource.instances[0].emit('scan.invalidate', {
      event_id: 'scan-1', sections: ['tasks'],
    });

    expect(connected).toHaveBeenCalledTimes(1);
    expect(invalidated).toHaveBeenCalledTimes(1);
    firstRelease();
    expect(MockEventSource.instances[0].closed).toBe(false);
    secondRelease();
    expect(MockEventSource.instances[0].closed).toBe(true);
    window.removeEventListener(SCAN_EVENTS_CONNECTED_EVENT, connected);
    window.removeEventListener(SCAN_EVENTS_INVALIDATE_EVENT, invalidated);
  });

  it('reconnects with bounded backoff after an error', async () => {
    const { ScanEventsClient } = await import('./scanEvents');
    const client = new ScanEventsClient();
    const release = client.retain();
    MockEventSource.instances[0].onerror();
    await vi.advanceTimersByTimeAsync(999);
    expect(MockEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockEventSource.instances).toHaveLength(2);
    release();
  });
});
