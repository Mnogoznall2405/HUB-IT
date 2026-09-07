import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { HubUser } from '../api/types';

const BIOMETRIC_ENABLED_KEY = 'hubit_biometric_login_enabled';
const BIOMETRIC_CREDENTIAL_KEY = 'hubit_biometric_login_credential_v1';
const BIOMETRIC_USER_ID_KEY = 'hubit_biometric_login_user_id';
const APP_LOCK_ENABLED_KEY = 'hubit_app_lock_enabled';
const APP_LOCK_TIMEOUT_KEY = 'hubit_app_lock_timeout_seconds';
const CREDENTIAL_VERSION = 2;
export const APP_LOCK_TIMEOUT_OPTIONS = [0, 30, 60, 300, 900] as const;

const protectedStoreOptions: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  authenticationPrompt: 'Подтвердите вход в HUB-IT',
};

export type BiometricCapability = {
  available: boolean;
  enrolled: boolean;
  fingerprint: boolean;
};

export type BiometricCredential = {
  version: 2;
  user: HubUser;
  offlineCacheKey: string;
  renewalToken: string;
  createdAt: string;
};

export type LegacyBiometricCredential = Omit<BiometricCredential, 'version' | 'renewalToken'> & {
  version: 1;
};

export type StoredBiometricCredential = BiometricCredential | LegacyBiometricCredential;

export type AppLockSettings = {
  enabled: boolean;
  timeoutSeconds: number;
};

let credentialGeneration = 0;
let credentialOperations: Promise<unknown> = Promise.resolve();
function credentialOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = credentialOperations.then(operation);
  credentialOperations = result.then(() => undefined, () => undefined);
  return result;
}

type AppLockSettingsListener = (settings: AppLockSettings) => void;
const appLockSettingsListeners = new Set<AppLockSettingsListener>();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function isHubUser(value: unknown): value is HubUser {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<HubUser>;
  return (
    Number.isInteger(candidate.id)
    && typeof candidate.username === 'string'
    && typeof candidate.role === 'string'
    && Array.isArray(candidate.permissions)
  );
}

function parseCredential(raw: string): StoredBiometricCredential | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      (value.version !== 1 && value.version !== CREDENTIAL_VERSION)
      || !isHubUser(value.user)
      || typeof value.offlineCacheKey !== 'string'
      || !/^[0-9a-f]{64}$/i.test(value.offlineCacheKey)
      || typeof value.createdAt !== 'string'
      || (value.version === CREDENTIAL_VERSION && (
        typeof value.renewalToken !== 'string'
        || !/^mb1\.[0-9a-f]{32}\.[A-Za-z0-9_-]{40,128}$/.test(value.renewalToken)
      ))
    ) {
      return null;
    }
    return value as StoredBiometricCredential;
  } catch {
    return null;
  }
}

export async function getBiometricCapability(): Promise<BiometricCapability> {
  if (Platform.OS === 'web') {
    return { available: false, enrolled: false, fingerprint: false };
  }
  const [available, enrolled, authenticationTypes] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);
  return {
    available,
    enrolled,
    fingerprint: authenticationTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT),
  };
}

async function isBiometricLoginEnabledInternal(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY)) === '1';
  } catch {
    return false;
  }
}

async function getBiometricLoginUserIdInternal(): Promise<number | null> {
  if (Platform.OS === 'web') return null;
  try {
    const userId = Number(await SecureStore.getItemAsync(BIOMETRIC_USER_ID_KEY));
    return Number.isInteger(userId) && userId > 0 ? userId : null;
  } catch {
    return null;
  }
}

async function enableBiometricLoginInternal(
  user: HubUser,
  renewalToken: string,
): Promise<BiometricCredential> {
  const capability = await getBiometricCapability();
  if (!capability.available || !capability.enrolled || !capability.fingerprint) {
    throw new Error('На устройстве не настроен вход по отпечатку');
  }
  const credential: BiometricCredential = {
    version: CREDENTIAL_VERSION,
    user,
    offlineCacheKey: bytesToHex(await Crypto.getRandomBytesAsync(32)),
    renewalToken: String(renewalToken || '').trim(),
    createdAt: new Date().toISOString(),
  };
  if (!/^mb1\.[0-9a-f]{32}\.[A-Za-z0-9_-]{40,128}$/.test(credential.renewalToken)) {
    throw new Error('Сервер не выдал корректный ключ входа по отпечатку');
  }
  try {
    await SecureStore.setItemAsync(
      BIOMETRIC_CREDENTIAL_KEY,
      JSON.stringify(credential),
      protectedStoreOptions,
    );
    await SecureStore.setItemAsync(BIOMETRIC_USER_ID_KEY, String(user.id));
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, '1');
    await SecureStore.setItemAsync(APP_LOCK_ENABLED_KEY, '0');
    await SecureStore.setItemAsync(APP_LOCK_TIMEOUT_KEY, '900');
    notifyAppLockSettings({ enabled: false, timeoutSeconds: 900 });
    return credential;
  } catch (error) {
    await Promise.allSettled([
      SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY),
      SecureStore.deleteItemAsync(BIOMETRIC_CREDENTIAL_KEY),
      SecureStore.deleteItemAsync(BIOMETRIC_USER_ID_KEY),
      SecureStore.deleteItemAsync(APP_LOCK_ENABLED_KEY),
      SecureStore.deleteItemAsync(APP_LOCK_TIMEOUT_KEY),
    ]);
    throw error;
  }
}

export async function unlockBiometricLogin(): Promise<StoredBiometricCredential> {
  const generation = credentialGeneration;
  await credentialOperation(async () => undefined);
  const raw = await SecureStore.getItemAsync(BIOMETRIC_CREDENTIAL_KEY, protectedStoreOptions);
  return credentialOperation(async () => {
    if (generation !== credentialGeneration) throw new Error('Настройки входа изменились. Повторите вход.');
    const credential = raw ? parseCredential(raw) : null;
    if (!credential) {
      await disableBiometricLoginInternal();
      throw new Error('Вход по отпечатку недоступен. Войдите по логину и паролю.');
    }
    return credential;
  });
}

async function disableBiometricLoginInternal(): Promise<void> {
  await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY).catch(() => undefined);
  await SecureStore.deleteItemAsync(BIOMETRIC_CREDENTIAL_KEY).catch(() => undefined);
  await SecureStore.deleteItemAsync(BIOMETRIC_USER_ID_KEY).catch(() => undefined);
  await SecureStore.deleteItemAsync(APP_LOCK_ENABLED_KEY).catch(() => undefined);
  await SecureStore.deleteItemAsync(APP_LOCK_TIMEOUT_KEY).catch(() => undefined);
  notifyAppLockSettings({ enabled: false, timeoutSeconds: 60 });
}

function normalizeAppLockTimeout(value: unknown): number {
  if (value === null || value === undefined || value === '') return 60;
  const timeout = Number(value);
  return APP_LOCK_TIMEOUT_OPTIONS.includes(timeout as (typeof APP_LOCK_TIMEOUT_OPTIONS)[number])
    ? timeout
    : 60;
}

function notifyAppLockSettings(settings: AppLockSettings): void {
  for (const listener of appLockSettingsListeners) {
    try { listener(settings); } catch { /* Observers cannot invalidate storage changes. */ }
  }
}

async function getAppLockSettingsInternal(): Promise<AppLockSettings> {
  if (Platform.OS === 'web' || !(await isBiometricLoginEnabledInternal())) {
    return { enabled: false, timeoutSeconds: 60 };
  }
  const [enabledValue, timeoutValue] = await Promise.all([
    SecureStore.getItemAsync(APP_LOCK_ENABLED_KEY).catch(() => null),
    SecureStore.getItemAsync(APP_LOCK_TIMEOUT_KEY).catch(() => null),
  ]);
  return {
    // Existing installs without an explicit key stay unlocked; users opt into app lock.
    enabled: enabledValue === '1',
    timeoutSeconds: normalizeAppLockTimeout(timeoutValue),
  };
}

async function setAppLockSettingsInternal(settings: AppLockSettings): Promise<AppLockSettings> {
  if (settings.enabled && !(await isBiometricLoginEnabledInternal())) {
    throw new Error('Сначала включите вход по отпечатку');
  }
  const normalized = {
    enabled: Boolean(settings.enabled),
    timeoutSeconds: normalizeAppLockTimeout(settings.timeoutSeconds),
  };
  const results = await Promise.allSettled([
    SecureStore.setItemAsync(APP_LOCK_ENABLED_KEY, normalized.enabled ? '1' : '0'),
    SecureStore.setItemAsync(APP_LOCK_TIMEOUT_KEY, String(normalized.timeoutSeconds)),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
  }
  notifyAppLockSettings(normalized);
  return normalized;
}

export function subscribeAppLockSettings(listener: AppLockSettingsListener): () => void {
  appLockSettingsListeners.add(listener);
  return () => appLockSettingsListeners.delete(listener);
}

export function shouldLockAfterBackground(
  backgroundAt: number,
  now: number,
  settings: AppLockSettings,
): boolean {
  if (!settings.enabled || backgroundAt <= 0 || now < backgroundAt) return false;
  return now - backgroundAt >= settings.timeoutSeconds * 1000;
}

export async function unlockBiometricAppLock(): Promise<void> {
  await unlockBiometricLogin();
}

export function isBiometricLoginEnabled(...args: Parameters<typeof isBiometricLoginEnabledInternal>): ReturnType<typeof isBiometricLoginEnabledInternal> {
  return credentialOperation(() => isBiometricLoginEnabledInternal(...args));
}

export function getBiometricLoginUserId(...args: Parameters<typeof getBiometricLoginUserIdInternal>): ReturnType<typeof getBiometricLoginUserIdInternal> {
  return credentialOperation(() => getBiometricLoginUserIdInternal(...args));
}

export function enableBiometricLogin(...args: Parameters<typeof enableBiometricLoginInternal>): ReturnType<typeof enableBiometricLoginInternal> {
  credentialGeneration += 1;
  return credentialOperation(() => enableBiometricLoginInternal(...args));
}

export function disableBiometricLogin(...args: Parameters<typeof disableBiometricLoginInternal>): ReturnType<typeof disableBiometricLoginInternal> {
  credentialGeneration += 1;
  return credentialOperation(() => disableBiometricLoginInternal(...args));
}

export function getAppLockSettings(...args: Parameters<typeof getAppLockSettingsInternal>): ReturnType<typeof getAppLockSettingsInternal> {
  return credentialOperation(() => getAppLockSettingsInternal(...args));
}

export function setAppLockSettings(...args: Parameters<typeof setAppLockSettingsInternal>): ReturnType<typeof setAppLockSettingsInternal> {
  return credentialOperation(() => setAppLockSettingsInternal(...args));
}
