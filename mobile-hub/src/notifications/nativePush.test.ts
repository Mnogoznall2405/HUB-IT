import * as IntentLauncher from 'expo-intent-launcher';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as notificationApi from '../api/notificationApi';
import * as tokenStore from '../auth/tokenStore';
import { getChatDeviceLogSnapshot, resetChatDeviceLog } from '../diagnostics/chatDeviceLog';
import {
  ensureAndroidNotificationChannels,
  handlePushTokenRotation,
  HUBIT_NOTIFICATION_CHANNEL_GROUP,
  HUBIT_MAIL_MARK_READ_ACTION,
  HUBIT_MAIL_MESSAGE_CATEGORY,
  openAndroidNotificationChannelSettings,
  revokeNativePushToken,
  syncNativePushToken,
} from './nativePush';

jest.mock('expo-application', () => ({ applicationId: 'ru.zsgp.hubit.mobile' }));

jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn(async () => undefined) }));

jest.mock('../api/notificationApi', () => ({
  getNativePushRuntimeStatus: jest.fn(),
  registerNativePushToken: jest.fn(),
  deleteNativePushToken: jest.fn(),
}));

const getRuntimeStatus = notificationApi.getNativePushRuntimeStatus as jest.MockedFunction<
  typeof notificationApi.getNativePushRuntimeStatus
>;
const registerToken = notificationApi.registerNativePushToken as jest.MockedFunction<
  typeof notificationApi.registerNativePushToken
>;
const deleteToken = notificationApi.deleteNativePushToken as jest.MockedFunction<
  typeof notificationApi.deleteNativePushToken
>;
const originalPlatform = Object.getOwnPropertyDescriptor(Platform, 'OS');

beforeEach(async () => {
  await resetChatDeviceLog();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  getRuntimeStatus.mockResolvedValue({
    enabled: true,
    configured: true,
    storage_available: true,
    project_id_present: true,
    service_account_present: true,
  });
  registerToken.mockResolvedValue({
    ok: true,
    registered: true,
    push_enabled: true,
    configured: true,
    removed: false,
  });
  deleteToken.mockResolvedValue({
    ok: true,
    registered: false,
    push_enabled: true,
    configured: true,
    removed: true,
  });
});

afterAll(() => {
  if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
});

describe('native push lifecycle', () => {
  it('keeps all HUB-IT notification channels in one Android settings group', async () => {
    await ensureAndroidNotificationChannels();

    expect(Notifications.setNotificationChannelGroupAsync).toHaveBeenCalledWith(
      HUBIT_NOTIFICATION_CHANNEL_GROUP,
      expect.objectContaining({ name: 'HUB-IT' }),
    );
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledTimes(6);
    for (const [, channel] of (Notifications.setNotificationChannelAsync as jest.Mock).mock.calls) {
      expect(channel).toEqual(expect.objectContaining({ groupId: HUBIT_NOTIFICATION_CHANNEL_GROUP }));
    }
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledWith(
      HUBIT_MAIL_MESSAGE_CATEGORY,
      [expect.objectContaining({ identifier: HUBIT_MAIL_MARK_READ_ACTION })],
    );
  });

  it('replaces a rotated token and registers it with the stable device id', async () => {
    await tokenStore.setNativePushToken('fcm-old');
    const deviceId = jest.spyOn(tokenStore, 'getOrCreateClientDeviceId')
      .mockResolvedValueOnce('mobile-device-1');
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockResolvedValueOnce({
      type: 'fcm',
      data: 'fcm-new',
    });

    await expect(syncNativePushToken()).resolves.toEqual({
      status: 'registered',
      message: 'Push-уведомления включены',
    });

    expect(deleteToken).toHaveBeenCalledWith('fcm-old');
    expect(registerToken).toHaveBeenCalledWith('fcm-new', 'mobile-device-1');
    await expect(tokenStore.getNativePushToken()).resolves.toBe('fcm-new');
    deviceId.mockRestore();
  });

  it('does not register a token while backend FCM is disabled', async () => {
    getRuntimeStatus.mockResolvedValueOnce({
      enabled: false,
      configured: false,
      storage_available: true,
      project_id_present: false,
      service_account_present: false,
    });

    await expect(syncNativePushToken()).resolves.toEqual({
      status: 'disabled',
      message: 'Push пока не настроен на сервере HUB-IT',
    });
    expect(registerToken).not.toHaveBeenCalled();
  });

  it('does not request an FCM token when notification permission remains denied', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied' });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied' });

    await expect(syncNativePushToken({ requestPermission: true })).resolves.toEqual({
      status: 'denied',
      message: 'Разрешение на уведомления не выдано',
    });
    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
  });

  it('resolves a failed token rotation and logs only stage and status', async () => {
    jest.spyOn(tokenStore, 'getOrCreateClientDeviceId').mockResolvedValueOnce('mobile-device-9');
    registerToken.mockRejectedValueOnce(Object.assign(
      new Error('503 from hub for token fcm-rotated-secret-value'),
      { isAxiosError: true, response: { status: 503 } },
    ));

    // The AppLifecycle listener is fire-and-forget: a rejection here would be
    // an unhandled promise rejection on the JS thread.
    await expect(handlePushTokenRotation({
      type: 'fcm',
      data: 'fcm-rotated-secret-value',
    } as Parameters<typeof handlePushTokenRotation>[0])).resolves.toBeUndefined();

    const events = getChatDeviceLogSnapshot().filter((entry) => entry.e === 'push_registration');
    expect(events).toHaveLength(1);
    expect(events[0].f).toEqual({ origin: 'rotation', stage: 'register', code: 'http503' });
    const serialized = JSON.stringify(getChatDeviceLogSnapshot());
    expect(serialized).not.toContain('fcm-rotated-secret-value');
    expect(serialized).not.toContain('from hub');
  });

  it('logs a sync failure at the device-token stage with the transport code only', async () => {
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('fetch fcm-rotated-secret-value failed: device offline'), {
        code: 'ERR_NETWORK',
      }),
    );

    const state = await syncNativePushToken();
    expect(state.status).toBe('error');

    const events = getChatDeviceLogSnapshot().filter((entry) => entry.e === 'push_registration');
    expect(events).toHaveLength(1);
    expect(events[0].f).toEqual({ origin: 'sync', stage: 'device-token', code: 'ERR_NETWORK' });
    const serialized = JSON.stringify(getChatDeviceLogSnapshot());
    expect(serialized).not.toContain('fcm-rotated-secret-value');
    expect(serialized).not.toContain('device offline');
  });

  it('revokes the backend token and removes the local copy on logout', async () => {
    await tokenStore.setNativePushToken('fcm-current');

    await expect(revokeNativePushToken()).resolves.toBe(true);
    expect(deleteToken).toHaveBeenCalledWith('fcm-current');
    await expect(tokenStore.getNativePushToken()).resolves.toBeNull();
  });

  it('opens only an allowlisted Android notification channel', async () => {
    await openAndroidNotificationChannelSettings('hubit_chat');

    expect(IntentLauncher.startActivityAsync).toHaveBeenCalledWith(
      'android.settings.CHANNEL_NOTIFICATION_SETTINGS',
      { extra: {
        'android.provider.extra.APP_PACKAGE': 'ru.zsgp.hubit.mobile',
        'android.provider.extra.CHANNEL_ID': 'hubit_chat',
      } },
    );
    await expect(openAndroidNotificationChannelSettings('external_channel')).rejects
      .toThrow('Unknown HUB-IT notification channel');
  });
});
