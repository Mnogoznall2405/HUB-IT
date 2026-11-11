import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  ensureAndroidNotificationChannels,
  HUBIT_NOTIFICATION_CHANNEL_GROUP,
  HUBIT_NOTIFICATION_CHANNELS,
} from './nativePush';

jest.mock('expo-application', () => ({ applicationId: 'ru.zsgp.hubit.mobile' }));

jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn(async () => undefined) }));

jest.mock('../api/notificationApi', () => ({
  getNativePushRuntimeStatus: jest.fn(),
  registerNativePushToken: jest.fn(),
  deleteNativePushToken: jest.fn(),
}));

const originalPlatform = Object.getOwnPropertyDescriptor(Platform, 'OS');

beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
});

afterAll(() => {
  if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
});

describe('android notification channel options', () => {
  it('registers the dedicated AI-agents channel with chat-grade options', async () => {
    await ensureAndroidNotificationChannels();

    expect(HUBIT_NOTIFICATION_CHANNELS.chatAi).toBe('hubit_chat_ai');
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      'hubit_chat_ai',
      expect.objectContaining({
        name: 'ИИ-агенты',
        importance: Notifications.AndroidImportance.HIGH,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
        showBadge: true,
        groupId: HUBIT_NOTIFICATION_CHANNEL_GROUP,
      }),
    );
  });
});
