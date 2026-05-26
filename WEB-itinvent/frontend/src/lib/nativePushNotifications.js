import { settingsAPI } from '../api/client';
import { getCapacitorPlugin, removeCapacitorListener } from './capacitorRuntime';
import { isNativeShellRuntime } from './platform';

export const NATIVE_PUSH_DEVICE_ID_KEY = 'hubit_native_push_device_id';
export const NATIVE_PUSH_TOKEN_KEY = 'hubit_native_push_token';
export const NATIVE_PUSH_USER_ID_KEY = 'hubit_native_push_user_id';
export const NATIVE_PUSH_CHANGED_EVENT = 'hubit:native-push-changed';

const CHANNEL_ID = 'hubit_default';
const CHANNEL_NAME = 'HUB-IT';

let listenerHandles = [];
let listenersRegistered = false;
let currentUser = null;
let syncPromise = null;

const readStorage = (key, fallback = '') => {
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
};

const writeStorage = (key, value) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, String(value || ''));
  } catch {
    // Ignore storage failures.
  }
};

const removeStorage = (key) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
};

const emitNativePushChange = (detail = {}) => {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(NATIVE_PUSH_CHANGED_EVENT, { detail }));
  }
};

export const getNativePushDeviceId = () => {
  const existing = readStorage(NATIVE_PUSH_DEVICE_ID_KEY, '').trim();
  if (existing) return existing;
  const generated = (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  writeStorage(NATIVE_PUSH_DEVICE_ID_KEY, generated);
  return generated;
};

export const buildNativePushTokenPayload = (token, {
  platform = 'android',
  appVersion = '',
} = {}) => ({
  token: String(token || '').trim(),
  platform: String(platform || 'android').trim().toLowerCase() || 'android',
  device_id: getNativePushDeviceId(),
  device_label: typeof navigator === 'undefined' ? '' : String(navigator.userAgent || '').trim(),
  app_version: String(appVersion || '').trim(),
});

const normalizePermission = (permissionResult) => {
  const receive = String(permissionResult?.receive || permissionResult?.display || '').trim().toLowerCase();
  if (receive === 'granted') return 'granted';
  if (receive === 'denied') return 'denied';
  return receive || 'prompt';
};

const registerTokenOnBackend = async (token) => {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken || !currentUser?.id) {
    return null;
  }
  const payload = buildNativePushTokenPayload(normalizedToken);
  const result = await settingsAPI.upsertNativePushToken(payload);
  writeStorage(NATIVE_PUSH_TOKEN_KEY, normalizedToken);
  writeStorage(NATIVE_PUSH_USER_ID_KEY, String(currentUser.id));
  emitNativePushChange({ stage: 'registered', result });
  return result;
};

const ensureNotificationChannel = async (pushPlugin) => {
  if (!pushPlugin || typeof pushPlugin.createChannel !== 'function') return;
  try {
    await pushPlugin.createChannel({
      id: CHANNEL_ID,
      name: CHANNEL_NAME,
      description: 'HUB-IT notifications',
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
    });
  } catch (error) {
    console.warn('Native push channel setup failed', error);
  }
};

const ensurePushListeners = (pushPlugin) => {
  if (listenersRegistered || !pushPlugin || typeof pushPlugin.addListener !== 'function') {
    return;
  }

  listenersRegistered = true;
  listenerHandles = [
    pushPlugin.addListener('registration', (token) => {
      void registerTokenOnBackend(token?.value || token).catch((error) => {
        console.warn('Native push token registration failed', error);
        emitNativePushChange({ stage: 'registration_failed' });
      });
    }),
    pushPlugin.addListener('registrationError', (error) => {
      console.warn('Native push registration error', error);
      emitNativePushChange({ stage: 'registration_error', error });
    }),
    pushPlugin.addListener('pushNotificationReceived', (notification) => {
      emitNativePushChange({ stage: 'foreground_notification', notification });
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('hubit:native-push-foreground-notification', {
          detail: notification || {},
        }));
      }
    }),
  ];
};

export const getNativeRuntimeInfo = async () => {
  const runtimePlugin = getCapacitorPlugin('HubitRuntime');
  if (!runtimePlugin || typeof runtimePlugin.getInfo !== 'function') {
    return {
      firebaseConfigured: false,
      reason: 'runtime_plugin_missing',
    };
  }

  try {
    const info = await runtimePlugin.getInfo();
    const rawFirebaseConfigured = info?.firebaseConfigured;
    const firebaseConfigured = rawFirebaseConfigured === true
      || String(rawFirebaseConfigured || '').trim().toLowerCase() === 'true';

    return {
      ...(info || {}),
      firebaseConfigured,
    };
  } catch (error) {
    console.warn('Native runtime info unavailable', error);
    return {
      firebaseConfigured: false,
      reason: 'runtime_info_failed',
    };
  }
};

export const resetNativePushListenersForTests = () => {
  listenerHandles.forEach(removeCapacitorListener);
  listenerHandles = [];
  listenersRegistered = false;
  currentUser = null;
  syncPromise = null;
};

export async function disableNativePushNotifications({ removeServer = true } = {}) {
  const token = readStorage(NATIVE_PUSH_TOKEN_KEY, '').trim();
  if (removeServer && token) {
    try {
      await settingsAPI.deleteNativePushToken(token);
    } catch {
      // Ignore cleanup failures during logout/session expiry.
    }
  }
  removeStorage(NATIVE_PUSH_TOKEN_KEY);
  removeStorage(NATIVE_PUSH_USER_ID_KEY);
  emitNativePushChange({ stage: 'disabled' });
  return { ok: true, registered: false };
}

export async function syncNativePushNotifications({ user, enabled = true } = {}) {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    if (!isNativeShellRuntime()) {
      return { ok: false, supported: false, reason: 'not_native' };
    }
    const normalizedUser = user && typeof user === 'object' ? user : null;
    currentUser = normalizedUser;
    if (!enabled || !normalizedUser?.id) {
      return disableNativePushNotifications({ removeServer: Boolean(normalizedUser?.id) });
    }

    const runtimeInfo = await getNativeRuntimeInfo();
    if (!runtimeInfo.firebaseConfigured) {
      emitNativePushChange({
        stage: 'firebase_missing',
        runtimeInfo,
      });
      return {
        ok: false,
        supported: false,
        reason: runtimeInfo.reason || 'firebase_missing',
        runtimeInfo,
      };
    }

    const pushPlugin = getCapacitorPlugin('PushNotifications');
    if (!pushPlugin) {
      return { ok: false, supported: false, reason: 'plugin_missing' };
    }

    await ensureNotificationChannel(pushPlugin);
    ensurePushListeners(pushPlugin);

    let permission = 'prompt';
    if (typeof pushPlugin.checkPermissions === 'function') {
      try {
        permission = normalizePermission(await pushPlugin.checkPermissions());
      } catch {
        permission = 'prompt';
      }
    }
    if (permission !== 'granted' && typeof pushPlugin.requestPermissions === 'function') {
      permission = normalizePermission(await pushPlugin.requestPermissions());
    }
    if (permission !== 'granted') {
      emitNativePushChange({ stage: 'permission_denied', permission });
      return { ok: false, supported: true, permission };
    }

    const cachedToken = readStorage(NATIVE_PUSH_TOKEN_KEY, '').trim();
    const cachedUserId = readStorage(NATIVE_PUSH_USER_ID_KEY, '').trim();
    if (cachedToken && cachedUserId === String(normalizedUser.id)) {
      void registerTokenOnBackend(cachedToken).catch(() => {});
    }

    if (typeof pushPlugin.register === 'function') {
      await pushPlugin.register();
    }

    return { ok: true, supported: true, permission };
  })();

  try {
    return await syncPromise;
  } finally {
    syncPromise = null;
  }
}
