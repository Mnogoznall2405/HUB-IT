import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';
import {
  applyChatPushDiagnostic,
  getChatNotificationState,
  refreshChatNotificationState,
  requestChatPushSyncDrain,
  syncChatPushSubscription,
} from '../../lib/chatNotifications';
import { emitAgentDebugLog } from '../../lib/debugClientLog';
import { hasAnyAppPushPermission } from '../../lib/appPushPermissions';
import { syncAppBadge } from '../../lib/appBadge';
import { WINDOWS_NOTIFICATIONS_CHANGED_EVENT } from '../../lib/windowsNotifications';
import ChatSocketBootstrap from '../chat/ChatSocketBootstrap';
import DesktopNavigationBootstrap from './DesktopNavigationBootstrap';
import DesktopProtocolHandoff from './DesktopProtocolHandoff';
import DesktopPresenceBootstrap from './DesktopPresenceBootstrap';
import DesktopLifecycleBootstrap from './DesktopLifecycleBootstrap';
import DesktopMemoryPressureBootstrap from './DesktopMemoryPressureBootstrap';
import NativeMobileShellBridge from './NativeMobileShellBridge';

export const AppPushBootstrap = () => {
  const { user, hasPermission } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const hasAppPushPermission = hasAnyAppPushPermission(hasPermission, {
    chatFeatureEnabled: CHAT_FEATURE_ENABLED,
  });
  const isChatRoute = String(location?.pathname || '').startsWith('/chat');

  const runPushSync = useCallback((force = false) => {
    if (!hasAppPushPermission || !user) {
      // AppPushBootstrap mounts before AuthProvider finishes restoring the
      // cookie session. Unsubscribing here invalidates a healthy browser
      // endpoint on every cold start. Explicit logout/revocation owns cleanup.
      return;
    }
    void syncChatPushSubscription({ user, force }).catch(() => {
      refreshChatNotificationState();
    });
    requestChatPushSyncDrain();
  }, [hasAppPushPermission, user]);

  const schedulePushSync = useCallback(({ force = false } = {}) => {
    const currentState = getChatNotificationState();
    const needsFastBootstrap = Boolean(
      currentState?.permission === 'granted'
      && (!currentState?.pushSubscribed || currentState?.pendingResubscribe)
    );
    if (!isChatRoute) {
      runPushSync(force);
      return () => {};
    }

    if (needsFastBootstrap && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      let cancelled = false;
      navigator.serviceWorker.ready
        .then(() => {
          if (!cancelled) {
            runPushSync(force);
          }
        })
        .catch(() => {
          if (!cancelled) {
            runPushSync(force);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    let timeoutId = null;
    let idleId = null;
    const start = () => {
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        runPushSync(force);
      }, needsFastBootstrap ? 1_500 : 8_000);
    };

    if (!needsFastBootstrap && typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(() => {
        idleId = null;
        start();
      }, { timeout: 12_000 });
    } else {
      start();
    }

    return () => {
      if (idleId != null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isChatRoute, runPushSync]);

  useEffect(() => {
    if (!user) {
      void syncAppBadge(0);
    }
  }, [user]);

  useEffect(() => {
    return schedulePushSync({ force: false });
  }, [schedulePushSync]);

  useEffect(() => {
    if (!user || !hasAppPushPermission) {
      return undefined;
    }

    const retryTimer = window.setInterval(() => {
      const currentState = getChatNotificationState();
      if (currentState?.permission !== 'granted') return;
      if (currentState?.pushSubscribed && !currentState?.pendingResubscribe) return;
      runPushSync(Boolean(currentState?.pendingResubscribe));
    }, 30_000);

    return () => {
      window.clearInterval(retryTimer);
    };
  }, [hasAppPushPermission, runPushSync, user]);

  useEffect(() => {
    const handleNotificationSettingsChange = () => {
      if (document.visibilityState === 'hidden') return;
      const currentState = getChatNotificationState();
      if (currentState?.permission !== 'granted') return;
      runPushSync(false);
    };

    window.addEventListener(WINDOWS_NOTIFICATIONS_CHANGED_EVENT, handleNotificationSettingsChange);
    return () => {
      window.removeEventListener(WINDOWS_NOTIFICATIONS_CHANGED_EVENT, handleNotificationSettingsChange);
    };
  }, [runPushSync]);

  useEffect(() => {
    const handleSyncRequest = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      schedulePushSync({ force: false });
    };

    window.addEventListener('focus', handleSyncRequest);
    document.addEventListener('visibilitychange', handleSyncRequest);
    return () => {
      window.removeEventListener('focus', handleSyncRequest);
      document.removeEventListener('visibilitychange', handleSyncRequest);
    };
  }, [schedulePushSync]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }

    const handleWorkerMessage = (event) => {
      const messageType = String(event?.data?.type || '').trim();
      if (!messageType) return;

      if (messageType === 'itinvent:navigate') {
        const rawRoute = String(event?.data?.route || event?.data?.url || '').trim();
        if (!rawRoute) return;
        const source = String(event?.data?.source || '').trim();
        try {
          const target = new URL(rawRoute, window.location.origin);
          if (target.origin !== window.location.origin) return;
          const nextRoute = `${target.pathname}${target.search}${target.hash}` || '/';
          const fromPath = `${window.location.pathname}${window.location.search}${window.location.hash}` || '/';
          // #region agent log
          emitAgentDebugLog({
            location: 'App.jsx:itinvent:navigate',
            message: 'Navigate from notification/service worker',
            hypothesisId: 'H-NAV',
            runId: 'post-fix',
            data: {
              route: nextRoute,
              source,
              fromPath,
            },
          });
          // #endregion
          // Push opens on mobile often resume a long-lived PWA with a stale JS graph.
          // Soft React navigate then fails lazy /chat chunk load and shows "Нужно обновить экран".
          // One hard assign loads a fresh document that matches the active service worker.
          if (source === 'notificationclick') {
            if (fromPath !== nextRoute) {
              window.location.assign(nextRoute);
            }
            return;
          }
          navigate(nextRoute);
        } catch {
          if (rawRoute.startsWith('/')) {
            if (source === 'notificationclick') {
              const fromPath = `${window.location.pathname}${window.location.search}${window.location.hash}` || '/';
              if (fromPath !== rawRoute) {
                window.location.assign(rawRoute);
              }
              return;
            }
            navigate(rawRoute);
          }
        }
        return;
      }

      if (messageType === 'itinvent:push-subscription-updated') {
        refreshChatNotificationState();
        return;
      }

      if (messageType === 'itinvent:push-diagnostic') {
        applyChatPushDiagnostic({
          stage: String(event?.data?.detail?.stage || event?.data?.stage || '').trim(),
          detail: event?.data?.detail?.detail || event?.data?.detail || {},
          sw_version: String(event?.data?.detail?.sw_version || event?.data?.sw_version || '').trim(),
          ts: String(event?.data?.detail?.ts || event?.data?.ts || '').trim(),
        });
        return;
      }

      if (messageType === 'itinvent:push-foreground-notification') {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('itinvent:push-foreground-notification', {
            detail: event?.data?.detail || {},
          }));
        }
        return;
      }

      if (messageType === 'itinvent:push-subscription-refresh-required') {
        schedulePushSync({ force: true });
      }
    };

    navigator.serviceWorker.addEventListener('message', handleWorkerMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleWorkerMessage);
    };
  }, [navigate, schedulePushSync]);

  return null;
};

// Post-auth infrastructure: push, realtime socket, desktop bridges and the
// mobile shell bridge. Mounted behind <PostAuthGate> so the public login and
// shared-file pages neither run nor download this subtree.
export default function AuthenticatedBootstraps() {
  return (
    <>
      <DesktopProtocolHandoff />
      <DesktopNavigationBootstrap />
      <DesktopPresenceBootstrap />
      <DesktopLifecycleBootstrap />
      <DesktopMemoryPressureBootstrap />
      <AppPushBootstrap />
      <ChatSocketBootstrap />
      <NativeMobileShellBridge />
    </>
  );
}
