import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { HubUser } from '../api/types';
import { clearNativeSnapshots } from '../cache/nativeSnapshotCache';
import { clearNativeMyFilesOffline } from '../myFiles/nativeMyFilesOfflineStore';

const ACCESS_KEY = 'hubit_access_token';
const REFRESH_KEY = 'hubit_refresh_token';
const CLIENT_DEVICE_KEY = 'hubit_client_device_id';
const NATIVE_PUSH_TOKEN_KEY = 'hubit_native_push_token';
const SESSION_USER_ID_KEY = 'hubit_session_user_id';
const SESSION_USER_CACHE_KEY = 'hubit_session_user_cache_v1';

type AccessTokenChangeListener = (accessToken: string | null) => void;

const accessTokenChangeListeners = new Set<AccessTokenChangeListener>();

function notifyAccessTokenChanges(accessToken: string | null): void {
  for (const listener of accessTokenChangeListeners) {
    try {
      listener(accessToken);
    } catch {
      /* one subscriber must not break auth persistence */
    }
  }
}

export function subscribeAccessTokenChanges(listener: AccessTokenChangeListener): () => void {
  accessTokenChangeListeners.add(listener);
  return () => accessTokenChangeListeners.delete(listener);
}

const isWeb = Platform.OS === 'web';

async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* storage unavailable */
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function getAccessToken(): Promise<string | null> {
  return getItem(ACCESS_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return getItem(REFRESH_KEY);
}

export async function getClientDeviceId(): Promise<string | null> {
  return getItem(CLIENT_DEVICE_KEY);
}

let clientDevicePromise: Promise<string> | null = null;

function createClientDeviceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 14);
  return `mobile-${timestamp}-${random}`;
}

export async function getOrCreateClientDeviceId(): Promise<string> {
  const existing = String((await getClientDeviceId()) || '').trim();
  if (existing) return existing;
  if (!clientDevicePromise) {
    clientDevicePromise = (async () => {
      const afterWait = String((await getClientDeviceId()) || '').trim();
      if (afterWait) return afterWait;
      const created = createClientDeviceId();
      await setItem(CLIENT_DEVICE_KEY, created);
      return created;
    })().finally(() => {
      clientDevicePromise = null;
    });
  }
  return clientDevicePromise;
}

export async function setClientDeviceId(clientDeviceId: string | null | undefined): Promise<void> {
  const normalized = String(clientDeviceId || '').trim();
  if (normalized) await setItem(CLIENT_DEVICE_KEY, normalized);
}

export async function setTokens(accessToken: string, refreshToken: string): Promise<void> {
  await setItem(ACCESS_KEY, accessToken);
  await setItem(REFRESH_KEY, refreshToken);
  notifyAccessTokenChanges(accessToken);
}

export async function clearTokens(options: { clearOfflineData?: boolean } = {}): Promise<void> {
  const sessionUserId = await getSessionUserId().catch(() => null);
  const cleanup: Promise<unknown>[] = [
    deleteItem(ACCESS_KEY),
    deleteItem(REFRESH_KEY),
    deleteItem(SESSION_USER_ID_KEY),
    deleteItem(SESSION_USER_CACHE_KEY),
  ];
  // A server-side session can expire while the user still owns a valid encrypted
  // offline snapshot. Only an explicit logout is allowed to erase that data.
  if (options.clearOfflineData && sessionUserId) {
    cleanup.push(
      clearNativeSnapshots(sessionUserId),
      clearNativeMyFilesOffline(sessionUserId),
    );
  }
  await Promise.allSettled(cleanup);
  notifyAccessTokenChanges(null);
}

export async function getCachedSessionUser(): Promise<HubUser | null> {
  try {
    const raw = await getItem(SESSION_USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HubUser>;
    const id = Number(parsed.id || 0);
    const username = String(parsed.username || '').trim();
    const role = String(parsed.role || '').trim();
    if (!Number.isInteger(id) || id <= 0 || !username || !role || !Array.isArray(parsed.permissions)) {
      await deleteItem(SESSION_USER_CACHE_KEY);
      return null;
    }
    return {
      ...parsed,
      id,
      username,
      role,
      permissions: parsed.permissions.map((item) => String(item)).filter(Boolean),
    } as HubUser;
  } catch {
    await deleteItem(SESSION_USER_CACHE_KEY).catch(() => undefined);
    return null;
  }
}

export async function setCachedSessionUser(user: HubUser): Promise<void> {
  const id = Number(user?.id || 0);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Некорректный идентификатор пользователя');
  }
  await Promise.all([
    setItem(SESSION_USER_ID_KEY, String(id)),
    setItem(SESSION_USER_CACHE_KEY, JSON.stringify(user)),
  ]);
}

export async function getSessionUserId(): Promise<number | null> {
  const value = Number(await getItem(SESSION_USER_ID_KEY));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function setSessionUserId(userId: number): Promise<void> {
  const normalized = Number(userId || 0);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error('Некорректный идентификатор пользователя');
  }
  await setItem(SESSION_USER_ID_KEY, String(normalized));
}

export async function getNativePushToken(): Promise<string | null> {
  return getItem(NATIVE_PUSH_TOKEN_KEY);
}

export async function setNativePushToken(token: string): Promise<void> {
  const normalized = String(token || '').trim();
  if (normalized) await setItem(NATIVE_PUSH_TOKEN_KEY, normalized);
}

export async function clearNativePushToken(): Promise<void> {
  await deleteItem(NATIVE_PUSH_TOKEN_KEY);
}

export async function hasSession(): Promise<boolean> {
  const token = await getAccessToken();
  return Boolean(token && token.trim());
}
