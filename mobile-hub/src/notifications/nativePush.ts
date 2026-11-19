import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as notificationApi from '../api/notificationApi';
import * as tokenStore from '../auth/tokenStore';
import { logChatDevice } from '../diagnostics/chatDeviceLog';
import { recordReleaseHealthMetric } from '../diagnostics/diagnostics';

export const HUBIT_NOTIFICATION_CHANNELS = Object.freeze({
  chat: 'hubit_chat',
  chatAi: 'hubit_chat_ai',
  tasks: 'hubit_tasks',
  mail: 'hubit_mail',
  system: 'hubit_system',
  fallback: 'hubit_default',
});

export const HUBIT_NOTIFICATION_CHANNEL = HUBIT_NOTIFICATION_CHANNELS.fallback;
export const HUBIT_NOTIFICATION_CHANNEL_GROUP = 'hubit_work';
export const HUBIT_CHAT_MESSAGE_CATEGORY = 'hubit_chat_message';
export const HUBIT_CHAT_REPLY_RETRY_CATEGORY = 'hubit_chat_reply_retry';
export const HUBIT_CHAT_REPLY_ACTION = 'hubit_chat_reply';
export const HUBIT_CHAT_MARK_READ_ACTION = 'hubit_chat_mark_read';
export const HUBIT_CHAT_RETRY_REPLY_ACTION = 'hubit_chat_retry_reply';
export const HUBIT_MAIL_MESSAGE_CATEGORY = 'hubit_mail_message';
export const HUBIT_MAIL_MARK_READ_ACTION = 'hubit_mail_mark_read';

export type NativePushState =
  | { status: 'unsupported'; message: string }
  | { status: 'disabled'; message: string }
  | { status: 'denied'; message: string }
  | { status: 'registered'; message: string }
  | { status: 'error'; message: string };

type PushStage =
  | 'channels'
  | 'permission'
  | 'device-token'
  | 'runtime'
  | 'local-token'
  | 'device-id'
  | 'register'
  | 'store';

const PUSH_ERROR_CODES = new Set(['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED']);

// Fixed classification only — never a token, error message, URL or device id.
function pushErrorCode(error: unknown): string {
  const candidate = error as { code?: unknown; response?: { status?: unknown } } | null;
  const status = Number(candidate?.response?.status);
  if (Number.isInteger(status) && status >= 400 && status <= 599) return `http${status}`;
  const code = String(candidate?.code || '');
  return PUSH_ERROR_CODES.has(code) ? code : 'other';
}

function trackPushRegistrationState(
  state: NativePushState,
  origin: 'sync' | 'rotation',
  stage: PushStage,
  error?: unknown,
): NativePushState {
  if (state.status === 'registered') {
    void recordReleaseHealthMetric('push_registration_succeeded');
  } else if (state.status === 'error') {
    void recordReleaseHealthMetric('push_registration_failed');
    logChatDevice('push_registration', {
      origin,
      stage,
      code: error ? pushErrorCode(error) : stage === 'device-token' ? 'empty_token' : 'other',
    });
  }
  return state;
}

export async function ensureAndroidNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const privateVisibility = Notifications.AndroidNotificationVisibility.PRIVATE;
  await Notifications.setNotificationChannelGroupAsync(HUBIT_NOTIFICATION_CHANNEL_GROUP, {
    name: 'HUB-IT',
    description: 'Рабочие уведомления приложения HUB-IT',
  });
  await Promise.all([
    Notifications.setNotificationChannelAsync(HUBIT_NOTIFICATION_CHANNELS.chat, {
      name: 'Чат',
      description: 'Новые сообщения и упоминания в чатах HUB-IT',
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: privateVisibility,
      showBadge: true,
      vibrationPattern: [0, 250, 120, 250],
      groupId: HUBIT_NOTIFICATION_CHANNEL_GROUP,
    }),
    Notifications.setNotificationChannelAsync(HUBIT_NOTIFICATION_CHANNELS.chatAi, {
      name: 'ИИ-агенты',
      description: 'Ответы ИИ-агентов и события ИИ-диалогов HUB-IT',
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: privateVisibility,
      showBadge: true,
      vibrationPattern: [0, 250, 120, 250],
      groupId: HUBIT_NOTIFICATION_CHANNEL_GROUP,
    }),
    Notifications.setNotificationChannelAsync(HUBIT_NOTIFICATION_CHANNELS.tasks, {
      name: 'Задачи',
      description: 'Назначения, сроки и изменения задач',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: privateVisibility,
      showBadge: true,
      vibrationPattern: [0, 180, 100, 180],
      groupId: HUBIT_NOTIFICATION_CHANNEL_GROUP,
    }),
    Notifications.setNotificationChannelAsync(HUBIT_NOTIFICATION_CHANNELS.mail, {
      name: 'Почта',
      description: 'Новые письма и события почты',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: privateVisibility,
      showBadge: true,
      vibrationPattern: [0, 220, 100, 220],
      groupId: HUBIT_NOTIFICATION_CHANNEL_GROUP,
    }),
    Notifications.setNotificationChannelAsync(HUBIT_NOTIFICATION_CHANNELS.system, {
      name: 'Системные события',
      description: 'Служебные сообщения HUB-IT',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: privateVisibility,
      showBadge: false,
      groupId: HUBIT_NOTIFICATION_CHANNEL_GROUP,
    }),
    Notifications.setNotificationChannelAsync(HUBIT_NOTIFICATION_CHANNELS.fallback, {
      name: 'HUB-IT — остальные',
      description: 'Совместимость с уведомлениями предыдущих версий',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: privateVisibility,
      showBadge: true,
      groupId: HUBIT_NOTIFICATION_CHANNEL_GROUP,
    }),
  ]);
  await Notifications.setNotificationCategoryAsync(HUBIT_CHAT_MESSAGE_CATEGORY, [
    {
      identifier: HUBIT_CHAT_REPLY_ACTION,
      buttonTitle: 'Ответить',
      textInput: {
        submitButtonTitle: 'Отправить',
        placeholder: 'Сообщение',
      },
      options: { opensAppToForeground: false },
    },
    {
      identifier: HUBIT_CHAT_MARK_READ_ACTION,
      buttonTitle: 'Прочитано',
      options: { opensAppToForeground: false },
    },
  ]);
  await Notifications.setNotificationCategoryAsync(HUBIT_CHAT_REPLY_RETRY_CATEGORY, [
    {
      identifier: HUBIT_CHAT_RETRY_REPLY_ACTION,
      buttonTitle: 'Повторить отправку',
      options: { opensAppToForeground: false },
    },
  ]);
  await Notifications.setNotificationCategoryAsync(HUBIT_MAIL_MESSAGE_CATEGORY, [
    {
      identifier: HUBIT_MAIL_MARK_READ_ACTION,
      buttonTitle: 'Прочитано',
      options: { opensAppToForeground: false },
    },
  ]);
}

export async function ensureAndroidNotificationChannel(): Promise<void> {
  await ensureAndroidNotificationChannels();
}

export async function openAndroidNotificationChannelSettings(channelId: string): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Android notification settings are unavailable');
  const normalized = String(channelId || '').trim();
  if (!Object.values(HUBIT_NOTIFICATION_CHANNELS).some((value) => value === normalized)) {
    throw new Error('Unknown HUB-IT notification channel');
  }
  const packageName = String(Application.applicationId || '').trim();
  if (!packageName) throw new Error('Android package is unavailable');
  await ensureAndroidNotificationChannels();
  await IntentLauncher.startActivityAsync('android.settings.CHANNEL_NOTIFICATION_SETTINGS', {
    extra: {
      'android.provider.extra.APP_PACKAGE': packageName,
      'android.provider.extra.CHANNEL_ID': normalized,
    },
  });
}

async function replaceStoredPushToken(
  token: string,
  onStage: (stage: PushStage) => void,
): Promise<NativePushState> {
  const normalized = String(token || '').trim();
  if (!normalized) return { status: 'error', message: 'FCM не вернул токен устройства' };

  onStage('runtime');
  const runtime = await notificationApi.getNativePushRuntimeStatus();
  if (!runtime.configured || !runtime.enabled || !runtime.storage_available) {
    return { status: 'disabled', message: 'Push пока не настроен на сервере HUB-IT' };
  }

  onStage('local-token');
  const previous = String((await tokenStore.getNativePushToken()) || '').trim();
  if (previous && previous !== normalized) {
    try {
      await notificationApi.deleteNativePushToken(previous);
    } catch {
      // Register the rotated token even when stale-token cleanup must be retried later.
    }
  }

  onStage('device-id');
  const deviceId = await tokenStore.getOrCreateClientDeviceId();
  onStage('register');
  const result = await notificationApi.registerNativePushToken(normalized, deviceId);
  if (!result.configured || !result.push_enabled || !result.registered) {
    return { status: 'disabled', message: 'Сервер не подтвердил регистрацию push' };
  }
  onStage('store');
  await tokenStore.setNativePushToken(normalized);
  return { status: 'registered', message: 'Push-уведомления включены' };
}

export async function syncNativePushToken(options: {
  requestPermission?: boolean;
} = {}): Promise<NativePushState> {
  if (Platform.OS !== 'android') {
    return { status: 'unsupported', message: 'Push прототипа поддерживается только на Android' };
  }

  let stage: PushStage = 'channels';
  try {
    await ensureAndroidNotificationChannel();
    stage = 'permission';
    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted' && options.requestPermission) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (permission.status !== 'granted') {
      return { status: 'denied', message: 'Разрешение на уведомления не выдано' };
    }
    stage = 'device-token';
    const tokenData = await Notifications.getDevicePushTokenAsync();
    return trackPushRegistrationState(
      await replaceStoredPushToken(String(tokenData.data || ''), (next) => { stage = next; }),
      'sync',
      stage,
    );
  } catch (error) {
    return trackPushRegistrationState({
      status: 'error',
      message: error instanceof Error ? error.message : 'Не удалось зарегистрировать push',
    }, 'sync', stage, error);
  }
}

export async function handlePushTokenRotation(token: Notifications.DevicePushToken): Promise<void> {
  let stage: PushStage = 'device-token';
  try {
    const state = await replaceStoredPushToken(String(token.data || ''), (next) => { stage = next; });
    trackPushRegistrationState(state, 'rotation', stage);
  } catch (error) {
    // AppLifecycle fires this listener without awaiting it: the failure is
    // recorded with its stage and must never surface as an unhandled rejection.
    trackPushRegistrationState({
      status: 'error',
      message: error instanceof Error ? error.message : 'Не удалось зарегистрировать push',
    }, 'rotation', stage, error);
  }
}

export async function revokeNativePushToken(): Promise<boolean> {
  const token = String((await tokenStore.getNativePushToken()) || '').trim();
  if (!token) return true;
  try {
    await notificationApi.deleteNativePushToken(token);
    await tokenStore.clearNativePushToken();
    return true;
  } catch {
    // Keep the token locally so cleanup can be retried after the next authenticated login.
    return false;
  }
}
