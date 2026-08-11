import { useEffect, useRef } from 'react';

import { authAPI } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';
import { emitAgentDebugLog } from '../../lib/debugClientLog';
import {
  CHAT_SOCKET_SESSION_EXPIRED_EVENT,
  chatSocket,
} from '../../lib/chatSocket';

export const AUTH_TOKEN_REFRESHED_EVENT = 'auth-token-refreshed';

export default function ChatSocketBootstrap() {
  const { user, hasPermission } = useAuth();
  const hasChatPermission = CHAT_FEATURE_ENABLED && Boolean(user) && hasPermission('chat.read');
  const recoveryInFlightRef = useRef(null);
  const lastRecoveryAtRef = useRef(0);

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

    const recoverSocketAfterAuth = async (source = 'unknown') => {
      if (recoveryInFlightRef.current) {
        return recoveryInFlightRef.current;
      }
      const now = Date.now();
      if ((now - Number(lastRecoveryAtRef.current || 0)) < 5_000) {
        return undefined;
      }
      lastRecoveryAtRef.current = now;
      recoveryInFlightRef.current = (async () => {
        // #region agent log
        emitAgentDebugLog({
          location: 'ChatSocketBootstrap.jsx:recoverSocketAfterAuth',
          message: 'attempting chat socket auth recovery',
          hypothesisId: 'H1',
          runId: 'post-fix',
          data: {
            source,
            connectionState: chatSocket.getConnectionState(),
            authBlocked: Boolean(chatSocket.authBlocked),
          },
        });
        // #endregion
        try {
          if (source === 'session-expired') {
            await authAPI.refresh();
          }
          chatSocket.resetAuthBlock();
          if (chatSocket.wantInbox) {
            await chatSocket.subscribeInbox().catch(() => {});
          }
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
      if (!chatSocket.authBlocked && chatSocket.getConnectionState() === 'connected') {
        return;
      }
      void recoverSocketAfterAuth('token-refreshed');
    };

    window.addEventListener(CHAT_SOCKET_SESSION_EXPIRED_EVENT, handleSessionExpired);
    window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
    return () => {
      window.removeEventListener(CHAT_SOCKET_SESSION_EXPIRED_EVENT, handleSessionExpired);
      window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
    };
  }, [hasChatPermission]);

  return null;
}
