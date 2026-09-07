import { createDeferredOfflineConnectivityController, RECENT_API_SUCCESS_GRACE_MS } from './nativeConnectivityGrace';
import type { NativeConnectivitySnapshot } from './nativeConnectivity';

function snapshot(partial: Partial<NativeConnectivitySnapshot>): NativeConnectivitySnapshot {
  return {
    available: true,
    online: false,
    connected: false,
    transport: 'none',
    metered: false,
    changedAtMs: 1,
    ...partial,
  };
}

describe('nativeConnectivityGrace', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not lose a single offline event inside the API success grace window', async () => {
    const setOffline = jest.fn();
    const setKnownOnline = jest.fn();
    const setVpnActive = jest.fn();
    const recheck = jest.fn(async () => snapshot({ connected: false, online: false }));
    let now = 1_000;
    const controller = createDeferredOfflineConnectivityController({
      getLastApiSuccessAt: () => 1_000,
      getNow: () => now,
      setOffline,
      setKnownOnline,
      setVpnActive,
      recheck,
      schedule: (fn, ms) => setTimeout(fn, ms),
      clearSchedule: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    });

    controller.apply(snapshot({ connected: true, online: true, transport: 'wifi' }));
    expect(setOffline).toHaveBeenLastCalledWith(false);

    now = 1_000 + 5_000;
    controller.apply(snapshot({ connected: false, online: false, transport: 'none' }));
    expect(setOffline).toHaveBeenLastCalledWith(false);
    expect(recheck).not.toHaveBeenCalled();

    jest.advanceTimersByTime(RECENT_API_SUCCESS_GRACE_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(recheck).toHaveBeenCalledTimes(1);
    expect(setOffline).toHaveBeenLastCalledWith(true);
    expect(setKnownOnline).toHaveBeenLastCalledWith(false);
    controller.dispose();
  });
});
