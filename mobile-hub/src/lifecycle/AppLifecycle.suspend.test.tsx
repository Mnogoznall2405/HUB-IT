import { act, render } from '@testing-library/react-native';
import React from 'react';
import { AppState } from 'react-native';
import type { HubUser } from '../api/types';
import { chatSocket } from '../chat/chatSocket';
import { hubRealtimeSocket } from '../realtime/hubRealtimeSocket';
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

jest.mock('../realtime/hubRealtimeSocket', () => ({
  hubRealtimeSocket: {
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(),
    resume: jest.fn(async () => undefined),
    suspend: jest.fn(),
    on: jest.fn(() => jest.fn()),
    onTaskChanged: jest.fn(() => jest.fn()),
    onMailChanged: jest.fn(() => jest.fn()),
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
  processNotificationAction: jest.fn(async () => ({ kind: 'open' })),
}));

jest.mock('../notifications/notificationBackgroundTask', () => ({
  handleNotificationBackgroundTask: jest.fn(async () => undefined),
}));

jest.mock('../offline/offlineCommandQueue', () => ({
  drainOfflineCommandQueue: jest.fn(async () => undefined),
}));
jest.mock('../offline/nativeReadCacheRefresh', () => ({
  refreshNativeReadCaches: jest.fn(async () => ({ refreshed: [], failed: [] })),
}));
jest.mock('../offline/nativeOfflineBackgroundRefresh', () => ({
  refreshStaleNativeOfflineData: jest.fn(async () => ({ preparedModules: [], failedModules: [] })),
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

type AppStateListener = (state: string) => void;

function captureAppStateListener() {
  let listener: AppStateListener | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
    if (type === 'change') listener = handler as AppStateListener;
    return { remove: jest.fn() };
  });
  return () => listener;
}

describe('AppLifecycle deferred socket suspend (W12)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUser = signedInUser;
    mockOfflineMode = false;
    jest.mocked(chatSocket.suspend).mockClear();
    jest.mocked(chatSocket.resume).mockClear();
    jest.mocked(hubRealtimeSocket.suspend).mockClear();
    jest.mocked(hubRealtimeSocket.resume).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps sockets alive through transient inactive states and suspends after the delay', async () => {
    const getListener = captureAppStateListener();
    await render(<AppLifecycle />);
    const listener = getListener();
    expect(listener).toBeDefined();

    // 'inactive' (picker/permission dialog/notification shade) must not suspend.
    await act(async () => listener?.('inactive'));
    jest.advanceTimersByTime(60_000);
    expect(hubRealtimeSocket.suspend).not.toHaveBeenCalled();
    expect(chatSocket.suspend).not.toHaveBeenCalled();

    // 'background' suspends only after the deferral window.
    await act(async () => listener?.('background'));
    jest.advanceTimersByTime(30_000);
    expect(hubRealtimeSocket.suspend).not.toHaveBeenCalled();
    jest.advanceTimersByTime(20_000);
    expect(hubRealtimeSocket.suspend).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending suspend when the app returns before the delay', async () => {
    const getListener = captureAppStateListener();
    await render(<AppLifecycle />);
    const listener = getListener();

    await act(async () => listener?.('background'));
    jest.advanceTimersByTime(10_000);
    await act(async () => listener?.('active'));
    jest.advanceTimersByTime(120_000);

    expect(hubRealtimeSocket.suspend).not.toHaveBeenCalled();
    expect(hubRealtimeSocket.resume).toHaveBeenCalled();
  });
});
