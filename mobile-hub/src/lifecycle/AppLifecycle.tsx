import * as Notifications from 'expo-notifications';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { chatSocket } from '../chat/chatSocket';
import {
  ensureAndroidNotificationChannels,
  handlePushTokenRotation,
  HUBIT_CHAT_MARK_READ_ACTION,
  HUBIT_CHAT_REPLY_ACTION,
  HUBIT_CHAT_RETRY_REPLY_ACTION,
  HUBIT_MAIL_MARK_READ_ACTION,
  syncNativePushToken,
} from '../notifications/nativePush';
import { clearNativeBadge, reconcileNativeBadge } from '../notifications/notificationBadge';
import { processNotificationAction } from '../notifications/notificationActions';
import { handleNotificationBackgroundTask } from '../notifications/notificationBackgroundTask';
import {
  notificationOpenHrefFromResponse,
  rememberNotificationDestination,
} from '../notifications/notificationNavigation';
import { drainOfflineCommandQueue } from '../offline/offlineCommandQueue';
import {
  ensureMobileBackgroundSyncRegistered,
  syncPendingNotificationReplies,
  unregisterMobileBackgroundSync,
} from './mobileBackgroundSync';

function scheduleAfterInitialRender(callback: () => void): () => void {
  let cancelled = false;
  let secondFrame: number | null = null;
  const firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(() => {
      if (!cancelled) callback();
    });
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(firstFrame);
    if (secondFrame !== null) cancelAnimationFrame(secondFrame);
  };
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const handledResponseKeys = new Set<string>();
const handledResponseOrder: string[] = [];

function claimNotificationResponse(response: Notifications.NotificationResponse): boolean {
  const key = [
    response.notification.request.identifier,
    response.actionIdentifier,
    response.userText || '',
  ].join('|');
  if (handledResponseKeys.has(key)) return false;
  handledResponseKeys.add(key);
  handledResponseOrder.push(key);
  if (handledResponseOrder.length > 64) {
    const oldest = handledResponseOrder.shift();
    if (oldest) handledResponseKeys.delete(oldest);
  }
  return true;
}

function notificationActionRunsWithoutNavigation(
  response: Notifications.NotificationResponse,
): boolean {
  const action = String(response.actionIdentifier || '').trim();
  return [
    HUBIT_CHAT_REPLY_ACTION,
    HUBIT_CHAT_MARK_READ_ACTION,
    HUBIT_CHAT_RETRY_REPLY_ACTION,
    HUBIT_MAIL_MARK_READ_ACTION,
  ].includes(action);
}

async function openNotificationResponse(
  response: Notifications.NotificationResponse,
  { navigate = true }: { navigate?: boolean } = {},
): Promise<void> {
  if (!claimNotificationResponse(response)) return;
  const actionRunsWithoutNavigation = notificationActionRunsWithoutNavigation(response);
  if (navigate && !actionRunsWithoutNavigation) {
    router.navigate(notificationOpenHrefFromResponse(response) as never);
  }
  try {
    if (actionRunsWithoutNavigation) {
      await handleNotificationBackgroundTask(response);
    } else {
      await processNotificationAction(response);
    }
    await reconcileNativeBadge();
  } catch (error) {
    Alert.alert(
      'Не удалось выполнить действие',
      error instanceof Error ? error.message : 'Откройте HUB-IT и повторите действие.',
    );
  } finally {
    await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }
}

export function AppLifecycle() {
  const { user, offlineMode } = useAuth();
  const pathname = usePathname();
  const nativeChatActive = pathname.startsWith('/chat');
  const userRef = useRef(user);
  const previousOfflineModeRef = useRef(offlineMode);
  const pendingNotificationResponseRef = useRef<Notifications.NotificationResponse | null>(null);
  userRef.current = user;

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    void ensureAndroidNotificationChannels();

    const deliverResponse = (response: Notifications.NotificationResponse) => {
      if (!userRef.current) {
        if (!notificationActionRunsWithoutNavigation(response)) {
          rememberNotificationDestination(response);
        }
        pendingNotificationResponseRef.current = response;
        return;
      }
      void openNotificationResponse(response);
    };

    const tokenSubscription = Notifications.addPushTokenListener((token) => {
      void handlePushTokenRotation(token);
    });
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(deliverResponse);
    const receivedSubscription = Notifications.addNotificationReceivedListener(() => {
      void reconcileNativeBadge();
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) deliverResponse(response);
    }).catch(() => undefined);

    return () => {
      tokenSubscription.remove();
      responseSubscription.remove();
      receivedSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      chatSocket.disconnect({ reconnect: false, clearSubscriptions: true });
      void clearNativeBadge();
      void unregisterMobileBackgroundSync();
      return;
    }

    const pending = pendingNotificationResponseRef.current;
    if (pending) {
      pendingNotificationResponseRef.current = null;
      void openNotificationResponse(pending, { navigate: false });
    }

    return scheduleAfterInitialRender(() => {
      if (userRef.current?.id !== user.id) return;
      void ensureMobileBackgroundSyncRegistered();
      void syncNativePushToken({ requestPermission: false });
      void reconcileNativeBadge();
      void drainOfflineCommandQueue(user.id);
      void syncPendingNotificationReplies(user.id);
    });
  }, [user]);

  useEffect(() => {
    const wasOffline = previousOfflineModeRef.current;
    previousOfflineModeRef.current = offlineMode;
    if (!user || !wasOffline || offlineMode) return;
    void drainOfflineCommandQueue(user.id);
    void syncPendingNotificationReplies(user.id);
  }, [offlineMode, user]);

  useEffect(() => {
    if (!user || !nativeChatActive) {
      chatSocket.disconnect({ reconnect: false, clearSubscriptions: true });
      return;
    }
    void chatSocket.connect();
    return () => chatSocket.disconnect({ reconnect: false, clearSubscriptions: true });
  }, [nativeChatActive, user]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (!user) return;
      if (nextState === 'active') {
        void syncNativePushToken({ requestPermission: false });
        void reconcileNativeBadge();
        void drainOfflineCommandQueue(user.id);
        void syncPendingNotificationReplies(user.id);
        if (nativeChatActive) void chatSocket.resume();
      } else if (nativeChatActive) {
        chatSocket.suspend();
      }
    });
    return () => subscription.remove();
  }, [nativeChatActive, user]);

  return null;
}
