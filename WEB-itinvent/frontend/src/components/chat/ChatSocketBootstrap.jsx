import { useEffect, useRef } from 'react';

import { authAPI } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';
import { emitAgentDebugLog } from '../../lib/debugClientLog';
import {
  CHAT_SOCKET_SESSION_EXPIRED_EVENT,
  chatSocket,
} from '../../lib/chatSocket';
import { DESKTOP_LIFECYCLE_RECOVERY_EVENT } from '../../lib/desktopLifecycle';

export const AUTH_TOKEN_REFRESHED_EVENT = 'auth-token-refreshed';

const isDefinitiveSessionRejection = (error) => {
  const status = Number(error?.response?.status || 0);
  return status === 401 || status === 403;
};

export default function ChatSocketBootstrap() {
  const { user, hasPermission } = useAuth();
  const hasChatPermission = CHAT_FEATURE_ENABLED && Boolean(user) && hasPermission('chat.read');
  const recoveryInFlightRef = useRef(null);
  const lastRecoveryAtRef = useRef(0);
  const pendingForceResumeRef = useRef(false);

  useEffect(() => {
    if (!hasChatPermission || !CHAT_WS_ENABLED) return undefined;
    const releaseSocket = chatSocket.retain();
    void chatSocket.subscribeInbox().catch(() => {});
    return () => {
      chatSocket.unsubscribeInbox();
      releaseSocket();
    };
  }, [hasChatPermission]);

  useEffect(() => {
    if (!hasChatPermission || !CHAT_WS_ENABLED) return undefined;

    let cancelled = false;

    const recoverSocketAfterAuth = async (source = 'unknown') => {
      if (source === 'desktop-lifecycle') {
        pendingForceResumeRef.current = true;
      }
      if (cancelled) {
        pendingForceResumeRef.current = false;
        return undefined;
      }
      if (recoveryInFlightRef.current) {
        return recoveryInFlightRef.current;
      }
      const healthyConnected = !chatSocket.authBlocked
        && chatSocket.getConnectionState() === 'connected';
      if (
        source === 'token-refreshed'
        && healthyConnected
        && !pendingForceResumeRef.current
      ) {
        return undefined;
      }
      const now = Date.now();
      if (
        (now - Number(lastRecoveryAtRef.current || 0)) < 5_000
        && !pendingForceResumeRef.current
      ) {
        return undefined;
      }
      lastRecoveryAtRef.current = now;
      recoveryInFlightRef.current = (async () => {
        let sessionRefreshAttempted = false;
        try {
          await Promise.resolve();
          do {
            if (cancelled) {
              pendingForceResumeRef.current = false;
              return;
            }
            if (source === 'session-expired' && !sessionRefreshAttempted) {
              sessionRefreshAttempted = true;
              try {
                await authAPI.refresh();
              } catch (error) {
                if (isDefinitiveSessionRejection(error)) {
                  pendingForceResumeRef.current = false;
                  return;
                }
              }
            }
            if (cancelled) {
              pendingForceResumeRef.current = false;
              return;
            }
            const forceResume = pendingForceResumeRef.current;
            pendingForceResumeRef.current = false;
            // #region agent log
            emitAgentDebugLog({
              location: 'ChatSocketBootstrap.jsx:recoverSocketAfterAuth',
              message: 'attempting chat socket auth recovery',
              hypothesisId: 'H1',
              runId: 'post-fix',
              data: {
                source,
                forceResume,
                connectionState: chatSocket.getConnectionState(),
                authBlocked: Boolean(chatSocket.authBlocked),
              },
            });
            // #endregion
            if (forceResume) {
              chatSocket.recoverAfterSystemResume();
            } else {
              chatSocket.resetAuthBlock();
              if (chatSocket.wantInbox) {
                await chatSocket.subscribeInbox().catch(() => {});
              }
            }
          } while (!cancelled && pendingForceResumeRef.current);
        } catch (error) {
          // #region agent log
          emitAgentDebugLog({
            location: 'ChatSocketBootstrap.jsx:recoverSocketAfterAuth',
            message: 'chat socket auth recovery failed',
            hypothesisId: 'H1',
            runId: 'post-fix',
            data: {
              source,
              error: String(error?.message || error || 'unknown'),
            },
          });
          // #endregion
        } finally {
          recoveryInFlightRef.current = null;
        }
      })();
      return recoveryInFlightRef.current;
    };

    const handleSessionExpired = () => {
      void recoverSocketAfterAuth('session-expired');
    };
    const handleTokenRefreshed = () => {
      void recoverSocketAfterAuth('token-refreshed');
    };
    const handleDesktopLifecycle = () => {
      void recoverSocketAfterAuth('desktop-lifecycle');
    };

    window.addEventListener(CHAT_SOCKET_SESSION_EXPIRED_EVENT, handleSessionExpired);
    window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
    window.addEventListener(DESKTOP_LIFECYCLE_RECOVERY_EVENT, handleDesktopLifecycle);
    return () => {
      cancelled = true;
      pendingForceResumeRef.current = false;
      window.removeEventListener(CHAT_SOCKET_SESSION_EXPIRED_EVENT, handleSessionExpired);
      window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
      window.removeEventListener(DESKTOP_LIFECYCLE_RECOVERY_EVENT, handleDesktopLifecycle);
    };
  }, [hasChatPermission]);

  return null;
}
