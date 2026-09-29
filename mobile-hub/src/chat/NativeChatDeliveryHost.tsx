import { useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { getSessionGeneration } from '../auth/tokenStore';
import { isNativeOfflineReadOnly } from '../offline/nativeOfflinePolicy';
import { recordDiagnosticEvent } from '../diagnostics/diagnostics';
import { chatSocket } from './chatSocket';
import { NATIVE_CHAT_ENABLED } from './nativeChatFeature';
import { createNativeChatDeliveryRunner } from './nativeChatDeliveryRunner';
import {
  createNativeChatDeliveryTransport, createNativeChatPersistConfirmed,
} from './nativeChatDeliveryTransport';
import { isNativeChatDeliveryBlocked, subscribeNativeChatDeliveryGate } from './nativeChatDeliveryGate';
import { getNativeChatThreadHistoryGeneration } from './nativeChatThreadHistory';

/** Mounted once in the authenticated shell, never once per conversation. */
export function NativeChatDeliveryHost() {
  const { user, hasPermission, offlineMode } = useAuth();
  const userId = Number(user?.id || 0);
  const allowed = NATIVE_CHAT_ENABLED && hasPermission('chat.read') && hasPermission('chat.write');
  const access = useRef({ userId, allowed, offlineMode });
  useLayoutEffect(() => { access.current = { userId, allowed, offlineMode }; }, [userId, allowed, offlineMode]);
  useEffect(() => {
    if (!userId || !allowed) return;
    const sessionGeneration = getSessionGeneration();
    const historyGeneration = getNativeChatThreadHistoryGeneration();
    let active = true;
    let runner: ReturnType<typeof createNativeChatDeliveryRunner> | null = null;
    const ownsSession = () => active && access.current.userId === userId && access.current.allowed
      && sessionGeneration === getSessionGeneration()
      && historyGeneration === getNativeChatThreadHistoryGeneration();
    // S8-A: delivery is not tied to the foreground anymore — in-flight uploads
    // finish while the OS lets the app run. The runner is torn down only by a
    // real suspend: unmount, session/generation change, offline mode or gate.
    const canDeliver = () => ownsSession() && !access.current.offlineMode
      && !isNativeOfflineReadOnly() && !isNativeChatDeliveryBlocked();
    const reconcile = () => {
      if (!canDeliver()) { runner?.dispose(); runner = null; return; }
      if (runner) { runner.wake(); return; }
      runner = createNativeChatDeliveryRunner({
        userId, canDeliver,
        transport: createNativeChatDeliveryTransport(canDeliver),
        persistConfirmed: createNativeChatPersistConfirmed({ ownsSession, userId, historyGeneration }),
        onError: () => { void recordDiagnosticEvent('native_file_error'); },
      });
    };
    const offGate = subscribeNativeChatDeliveryGate(reconcile);
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') reconcile(); });
    const offSocket = chatSocket.on('status', () => reconcile());
    // Parent offline-policy effects can settle after child effects. Recheck once,
    // without keeping a polling loop alive when there is no eligible session.
    const initial = setTimeout(reconcile, 0);
    return () => {
      active = false; clearTimeout(initial); runner?.dispose();
      appState.remove(); offGate(); offSocket();
    };
  }, [userId, allowed, offlineMode]);
  return null;
}
