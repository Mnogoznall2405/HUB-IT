import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { act, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import type { HubUser } from '../api/types';
import { clearPendingPortalPathForTests } from '../navigation/systemIntent';
import { postAuthDestination } from '../navigation/postAuthDestination';
import { processNotificationAction } from '../notifications/notificationActions';
import { syncNativePushToken } from '../notifications/nativePush';
import { reconcileNativeBadge } from '../notifications/notificationBadge';
import { drainOfflineCommandQueue } from '../offline/offlineCommandQueue';
import { ensureMobileBackgroundSyncRegistered, syncPendingNotificationReplies } from './mobileBackgroundSync';
import { AppLifecycle } from './AppLifecycle';

let mockUser: HubUser | null = null;
let mockOfflineMode = false;

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, offlineMode: mockOfflineMode }),
}));

jest.mock('../chat/chatSocket', () => ({
  chatSocket: {
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(),
    resume: jest.fn(async () => undefined),
    suspend: jest.fn(),
  },
}));

jest.mock('../notifications/nativePush', () => ({
  ensureAndroidNotificationChannels: jest.fn(async () => undefined),
  handlePushTokenRotation: jest.fn(async () => undefined),
  syncNativePushToken: jest.fn(async () => undefined),
  HUBIT_CHAT_MARK_READ_ACTION: 'CHAT_MARK_READ',
  HUBIT_CHAT_REPLY_ACTION: 'CHAT_REPLY',
  HUBIT_CHAT_RETRY_REPLY_ACTION: 'CHAT_RETRY_REPLY',
  HUBIT_MAIL_MARK_READ_ACTION: 'MAIL_MARK_READ',
}));

jest.mock('../notifications/notificationBadge', () => ({
  clearNativeBadge: jest.fn(async () => undefined),
  reconcileNativeBadge: jest.fn(async () => undefined),
}));

jest.mock('../notifications/notificationActions', () => ({
  processNotificationAction: jest.fn(async () => ({ kind: 'open', route: '/tasks?task=task-42' })),
}));

jest.mock('../notifications/notificationBackgroundTask', () => ({
  handleNotificationBackgroundTask: jest.fn(async () => undefined),
}));

jest.mock('../offline/offlineCommandQueue', () => ({
  drainOfflineCommandQueue: jest.fn(async () => undefined),
}));

jest.mock('./mobileBackgroundSync', () => ({
  ensureMobileBackgroundSyncRegistered: jest.fn(async () => undefined),
  syncPendingNotificationReplies: jest.fn(async () => undefined),
  unregisterMobileBackgroundSync: jest.fn(async () => undefined),
}));

const signedInUser: HubUser = {
  id: 7,
  username: 'mobile-test',
  role: 'viewer',
  permissions: ['tasks.read'],
};

const notificationResponse = {
  actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
  notification: {
    request: {
      identifier: 'task:task-42',
      content: { data: { route: '/tasks?task=task-42' } },
    },
  },
} as unknown as Notifications.NotificationResponse;

describe('AppLifecycle notification authentication', () => {
  beforeEach(() => {
    mockUser = null;
    mockOfflineMode = false;
    clearPendingPortalPathForTests();
    jest.mocked(router.push).mockClear();
    jest.mocked(router.navigate).mockClear();
    jest.mocked(processNotificationAction).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defers non-critical session synchronization until after the first interaction', async () => {
    mockUser = signedInUser;
    const scheduled: Array<(timestamp: number) => void> = [];
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      scheduled.push(callback);
      return scheduled.length;
    });
    jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => undefined);

    await render(<AppLifecycle />);

    expect(syncNativePushToken).not.toHaveBeenCalled();
    expect(reconcileNativeBadge).not.toHaveBeenCalled();
    expect(drainOfflineCommandQueue).not.toHaveBeenCalled();
    expect(syncPendingNotificationReplies).not.toHaveBeenCalled();
    expect(ensureMobileBackgroundSyncRegistered).not.toHaveBeenCalled();

    await act(async () => scheduled[0]?.(0));
    expect(syncNativePushToken).not.toHaveBeenCalled();
    await act(async () => scheduled[1]?.(16));

    expect(syncNativePushToken).toHaveBeenCalledWith({ requestPermission: false });
    expect(reconcileNativeBadge).toHaveBeenCalledTimes(1);
    expect(drainOfflineCommandQueue).toHaveBeenCalledWith(7);
    expect(syncPendingNotificationReplies).toHaveBeenCalledWith(7);
    expect(ensureMobileBackgroundSyncRegistered).toHaveBeenCalledTimes(1);
  });

  it('preserves a cold-start notification through authentication without a competing redirect', async () => {
    let responseListener: ((response: Notifications.NotificationResponse) => void) | undefined;
    jest.mocked(Notifications.addNotificationResponseReceivedListener).mockImplementation((listener) => {
      responseListener = listener;
      return { remove: jest.fn() } as Notifications.EventSubscription;
    });
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValue(null);

    const view = await render(<AppLifecycle />);
    await waitFor(() => expect(responseListener).toBeDefined());
    await act(async () => responseListener?.(notificationResponse));

    expect(postAuthDestination('android', '/dashboard')).toEqual({
      pathname: '/(shell)/tasks/[taskId]',
      params: { taskId: 'task-42' },
    });

    mockUser = signedInUser;
    await view.rerender(<AppLifecycle />);
    await waitFor(() => expect(processNotificationAction).toHaveBeenCalledWith(notificationResponse));
    expect(router.push).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('opens a notification immediately without waiting for badge reconciliation', async () => {
    mockUser = signedInUser;
    let responseListener: ((response: Notifications.NotificationResponse) => void) | undefined;
    jest.mocked(Notifications.addNotificationResponseReceivedListener).mockImplementation((listener) => {
      responseListener = listener;
      return { remove: jest.fn() } as Notifications.EventSubscription;
    });
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValue(null);
    jest.mocked(reconcileNativeBadge).mockImplementationOnce(() => new Promise(() => undefined));
    const immediateResponse = {
      ...notificationResponse,
      notification: {
        ...notificationResponse.notification,
        request: {
          ...notificationResponse.notification.request,
          identifier: 'task:task-42:immediate',
        },
      },
    } as Notifications.NotificationResponse;

    await render(<AppLifecycle />);
    await waitFor(() => expect(responseListener).toBeDefined());
    await act(async () => responseListener?.(immediateResponse));

    expect(router.navigate).toHaveBeenCalledWith({
      pathname: '/(shell)/tasks/[taskId]',
      params: { taskId: 'task-42' },
    });
  });

  it('drains durable queues immediately when validated connectivity returns', async () => {
    mockUser = signedInUser;
    mockOfflineMode = true;
    const view = await render(<AppLifecycle />);
    await waitFor(() => expect(ensureMobileBackgroundSyncRegistered).toHaveBeenCalled());
    jest.mocked(drainOfflineCommandQueue).mockClear();
    jest.mocked(syncPendingNotificationReplies).mockClear();

    mockOfflineMode = false;
    await view.rerender(<AppLifecycle />);

    await waitFor(() => expect(drainOfflineCommandQueue).toHaveBeenCalledWith(7));
    expect(syncPendingNotificationReplies).toHaveBeenCalledWith(7);
  });
});
