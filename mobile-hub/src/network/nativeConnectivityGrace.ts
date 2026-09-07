import type { NativeConnectivitySnapshot } from '../network/nativeConnectivity';

export const RECENT_API_SUCCESS_GRACE_MS = 30_000;

export type DeferredOfflineController = {
  apply: (snapshot: NativeConnectivitySnapshot) => void;
  dispose: () => void;
};

/**
 * Physical offline events inside the API-success grace window must be retained
 * and rechecked after the grace ends (OFF-03). Online events clear the deferral.
 */
export function createDeferredOfflineConnectivityController(options: {
  getLastApiSuccessAt: () => number;
  getNow?: () => number;
  setOffline: (offline: boolean) => void;
  setKnownOnline: (online: boolean) => void;
  setVpnActive: (active: boolean) => void;
  recheck: () => Promise<NativeConnectivitySnapshot>;
  schedule?: (fn: () => void, ms: number) => unknown;
  clearSchedule?: (timer: unknown) => void;
}): DeferredOfflineController {
  const getNow = options.getNow || Date.now;
  const schedule = options.schedule || ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearSchedule = options.clearSchedule || ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let deferredTimer: unknown = null;
  let pendingOffline: NativeConnectivitySnapshot | null = null;
  let active = true;

  const clearDeferred = () => {
    if (deferredTimer != null) {
      clearSchedule(deferredTimer);
      deferredTimer = null;
    }
    pendingOffline = null;
  };

  const apply = (snapshot: NativeConnectivitySnapshot) => {
    if (!active || !snapshot.available) return;
    const canReachNetwork = snapshot.connected || snapshot.online;
    options.setVpnActive(snapshot.transport === 'vpn');
    if (canReachNetwork) {
      clearDeferred();
      options.setOffline(false);
      options.setKnownOnline(true);
      return;
    }
    const lastSuccess = options.getLastApiSuccessAt();
    const withinGrace = lastSuccess > 0
      && getNow() - lastSuccess <= RECENT_API_SUCCESS_GRACE_MS;
    if (!withinGrace) {
      clearDeferred();
      options.setOffline(true);
      options.setKnownOnline(false);
      return;
    }
    pendingOffline = snapshot;
    if (deferredTimer) return;
    const delay = Math.max(0, RECENT_API_SUCCESS_GRACE_MS - (getNow() - lastSuccess));
    deferredTimer = schedule(() => {
      deferredTimer = null;
      if (!active || !pendingOffline) return;
      pendingOffline = null;
      void options.recheck().then((current) => {
        if (!active) return;
        if (!current.available) {
          options.setOffline(true);
          options.setKnownOnline(false);
          return;
        }
        const recovered = current.connected || current.online;
        options.setOffline(!recovered);
        options.setKnownOnline(recovered);
        options.setVpnActive(current.transport === 'vpn');
      }).catch(() => {
        if (!active) return;
        options.setOffline(true);
        options.setKnownOnline(false);
      });
    }, delay);
  };

  return {
    apply,
    dispose: () => {
      active = false;
      clearDeferred();
    },
  };
}
