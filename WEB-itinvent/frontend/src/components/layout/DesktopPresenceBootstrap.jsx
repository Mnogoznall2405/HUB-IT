import { useEffect } from 'react';

import { desktopPresenceAPI } from '../../api/desktopPresence';
import { useAuth } from '../../contexts/AuthContext';
import { DESKTOP_PRESENCE_HEARTBEAT_EVENT } from '../../lib/desktopLifecycle';
import { isNativeShellRuntime } from '../../lib/platform';

const HEARTBEAT_BASE_MS = 60_000;
const HEARTBEAT_JITTER_MS = 10_000;

function nextHeartbeatDelay() {
  return HEARTBEAT_BASE_MS + ((Math.random() - 0.5) * HEARTBEAT_JITTER_MS);
}

const DesktopPresenceBootstrap = () => {
  const { user } = useAuth();
  const userId = Number(user?.id || 0);

  useEffect(() => {
    if (userId <= 0 || !isNativeShellRuntime()) return undefined;

    let active = true;
    let timerId = null;
    let disconnectSent = false;
    let heartbeatGeneration = 0;

    const clearTimer = () => {
      if (timerId != null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
    };

    const sendDisconnect = () => {
      if (disconnectSent) return;
      disconnectSent = true;
      void Promise.resolve(desktopPresenceAPI.disconnect()).catch(() => {
        // TTL remains the correctness boundary if graceful disconnect fails.
      });
    };

    const runHeartbeat = async () => {
      if (!active) return;
      const generation = heartbeatGeneration + 1;
      heartbeatGeneration = generation;
      try {
        await desktopPresenceAPI.heartbeat();
      } catch {
        // Presence is best-effort and must never block HUB startup or notifications.
      } finally {
        if (active && heartbeatGeneration === generation) {
          timerId = window.setTimeout(runHeartbeat, nextHeartbeatDelay());
        }
      }
    };

    const handlePageHide = () => {
      active = false;
      clearTimer();
      sendDisconnect();
    };

    const handlePageShow = () => {
      if (active) return;
      active = true;
      disconnectSent = false;
      void runHeartbeat();
    };

    const handleDesktopLifecycleHeartbeat = () => {
      if (!active) return;
      clearTimer();
      void runHeartbeat();
    };

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener(DESKTOP_PRESENCE_HEARTBEAT_EVENT, handleDesktopLifecycleHeartbeat);
    void runHeartbeat();

    return () => {
      active = false;
      heartbeatGeneration += 1;
      clearTimer();
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener(DESKTOP_PRESENCE_HEARTBEAT_EVENT, handleDesktopLifecycleHeartbeat);
      sendDisconnect();
    };
  }, [userId]);

  return null;
};

export default DesktopPresenceBootstrap;
