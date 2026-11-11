import { authAPI } from '../api/client';
import {
  isDesktopBridgeReady,
  subscribeDesktopBridgeReady,
  subscribeDesktopLifecycle,
} from './desktopBridge';
import {
  DESKTOP_LIFECYCLE_COOLDOWN_MS,
  isLifecycleEventFresh as isLifecycleEventFreshByPolicy,
  MAX_LIFECYCLE_EVENT_AGE_MS,
} from './desktopLifecyclePolicy';

export {
  DESKTOP_LIFECYCLE_COOLDOWN_MS,
  isLifecycleEventFresh,
  MAX_LIFECYCLE_EVENT_AGE_MS,
  MAX_LIFECYCLE_FUTURE_SKEW_MS,
} from './desktopLifecyclePolicy';

export const DESKTOP_LIFECYCLE_RECOVERY_EVENT = 'itinvent:desktop-lifecycle-recovery';
export const DESKTOP_PRESENCE_HEARTBEAT_EVENT = 'itinvent:desktop-presence-heartbeat';
export const MAIL_NEEDS_REFRESH_EVENT = 'mail-needs-refresh';

const defaultNow = () => Date.now();

const isDefinitiveSessionRejection = (error) => {
  const status = Number(error?.response?.status || 0);
  return status === 401 || status === 403;
};

const dispatchWindowEvent = (name, detail) => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  if (detail === undefined) {
    window.dispatchEvent(new CustomEvent(name));
    return;
  }
  window.dispatchEvent(new CustomEvent(name, { detail }));
};

const defaultScheduleOneShot = (delayMs, callback) => {
  const timerId = window.setTimeout(callback, Math.max(0, delayMs));
  return () => window.clearTimeout(timerId);
};

export function createDesktopLifecycleController({
  cooldownMs = DESKTOP_LIFECYCLE_COOLDOWN_MS,
  maxAgeMs = MAX_LIFECYCLE_EVENT_AGE_MS,
  isAuthenticated = () => false,
  refreshAuth = () => authAPI.refresh(),
  notifyMailNeedsRefresh = () => dispatchWindowEvent(MAIL_NEEDS_REFRESH_EVENT),
  notifyChatNeedsRecovery = () => dispatchWindowEvent(DESKTOP_LIFECYCLE_RECOVERY_EVENT),
  notifyPresenceHeartbeat = () => dispatchWindowEvent(DESKTOP_PRESENCE_HEARTBEAT_EVENT),
  now = defaultNow,
  scheduleOneShot = defaultScheduleOneShot,
} = {}) {
  let lastStartedGeneration = 0;
  let lastObservedGeneration = 0;
  let lastRecoveryAt = 0;
  let inFlight = null;
  let pendingRecoveryEvent = null;
  let cancelTimer = null;
  let disposed = false;
  let recoveryCycles = 0;

  const clearTimer = () => {
    if (!cancelTimer) return;
    cancelTimer();
    cancelTimer = null;
  };

  const cancelPending = () => {
    pendingRecoveryEvent = null;
    clearTimer();
  };

  const isFresh = (event) => isLifecycleEventFreshByPolicy(event, now(), maxAgeMs);

  const startRecovery = (event) => {
    lastStartedGeneration = event.generation;
    lastRecoveryAt = now();
    recoveryCycles += 1;
    inFlight = (async () => {
      try {
        try {
          await refreshAuth();
        } catch (error) {
          if (isDefinitiveSessionRejection(error)) {
            cancelPending();
            return;
          }
        }
        if (disposed || !isAuthenticated()) {
          return;
        }
        notifyMailNeedsRefresh();
        notifyChatNeedsRecovery();
        await notifyPresenceHeartbeat();
      } finally {
        inFlight = null;
        if (!disposed && pendingRecoveryEvent) {
          const pending = pendingRecoveryEvent;
          pendingRecoveryEvent = null;
          queueOrStart(pending, { replayPending: true });
        }
      }
    })();
    return inFlight;
  };

  const armCooldownTimer = () => {
    if (cancelTimer || !pendingRecoveryEvent || lastRecoveryAt <= 0) return;
    const remainingMs = Math.max(0, cooldownMs - (now() - lastRecoveryAt));
    cancelTimer = scheduleOneShot(remainingMs, () => {
      cancelTimer = null;
      if (disposed) return;
      const pending = pendingRecoveryEvent;
      pendingRecoveryEvent = null;
      if (pending) {
        queueOrStart(pending, { replayPending: true });
      }
    });
  };

  const queueOrStart = (event, { replayPending = false } = {}) => {
    if (disposed || !event || typeof event !== 'object') return inFlight;
    const generation = Number(event.generation || 0);
    if (!Number.isInteger(generation) || generation < 1) return inFlight;
    if (generation < lastObservedGeneration) {
      return inFlight;
    }
    // Duplicate deliveries of the current generation must not cancel a pending
    // cooldown recovery. Cooldown drain replays the same generation explicitly.
    if (!replayPending && generation <= lastObservedGeneration) {
      return inFlight;
    }
    if (!isFresh(event)) {
      return inFlight;
    }
    lastObservedGeneration = generation;

    if (event.isRecoveryAttempt !== true) {
      cancelPending();
      return inFlight;
    }

    if (typeof isAuthenticated === 'function' && !isAuthenticated()) {
      cancelPending();
      return inFlight;
    }

    if (generation <= lastStartedGeneration) {
      return inFlight;
    }

    if (inFlight) {
      pendingRecoveryEvent = event;
      return inFlight;
    }

    if (lastRecoveryAt > 0 && (now() - lastRecoveryAt) < cooldownMs) {
      pendingRecoveryEvent = event;
      armCooldownTimer();
      return inFlight;
    }

    return startRecovery(event);
  };

  return {
    handleEvent: (event) => queueOrStart(event),
    dispose() {
      disposed = true;
      cancelPending();
      inFlight = null;
    },
    getLastGeneration: () => lastStartedGeneration,
    getRecoveryCycles: () => recoveryCycles,
  };
}

let activeStop = null;

export function startDesktopLifecycleRecovery(options = {}) {
  if (typeof activeStop === 'function') {
    activeStop();
    activeStop = null;
  }

  let stopped = false;
  let attached = false;
  let controller = null;
  let unsubscribeLifecycle = null;
  let unsubscribeReady = null;

  const attach = () => {
    if (stopped || attached) return;
    attached = true;
    controller = createDesktopLifecycleController(options);
    unsubscribeLifecycle = subscribeDesktopLifecycle((event) => {
      void controller.handleEvent(event);
    });
  };

  if (isDesktopBridgeReady()) {
    attach();
  } else {
    unsubscribeReady = subscribeDesktopBridgeReady(attach);
  }

  const stop = () => {
    stopped = true;
    if (typeof unsubscribeReady === 'function') {
      unsubscribeReady();
      unsubscribeReady = null;
    }
    if (typeof unsubscribeLifecycle === 'function') {
      unsubscribeLifecycle();
      unsubscribeLifecycle = null;
    }
    controller?.dispose();
    controller = null;
    if (activeStop === stop) {
      activeStop = null;
    }
  };
  activeStop = stop;
  return stop;
}
