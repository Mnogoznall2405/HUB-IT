import axios from 'axios';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_V1_BASE } from '../api/config';
import { withMobileAuthHeaders } from '../api/client';

// An offline logout can never reach the server: the refresh token then stays
// valid, the session and the push registration remain alive, and a shared
// device keeps receiving the previous account's notifications. Deferred
// records repeat POST /auth/logout — the endpoint accepts the refresh token
// in the body without a live access token, and revokes the session, the
// biometric device and the device's push tokens in one call. One entry per
// refresh token lets every account on a shared device be replayed; the index
// stores only SHA-256 digests so tokens never appear in keys or lists.
const LEGACY_KEY = 'hubit_pending_logout_cleanup_v1';
const INDEX_KEY = 'hubit_pending_logout_cleanup_index_v2';
const ENTRY_PREFIX = 'hubit_pending_logout_cleanup_entry_v2_';
const MAX_PENDING = 20;
const CLEANUP_TIMEOUT_MS = 15_000;
const isWeb = Platform.OS === 'web';

export type PendingLogoutCleanup = {
  refreshToken: string;
  clientDeviceId: string | null;
  pushToken: string | null;
  createdAt: number;
};

let mutation: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const pending = mutation.catch(() => undefined).then(operation);
  mutation = pending;
  return pending;
}

async function recordId(refreshToken: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, refreshToken);
}

function entryKey(id: string): string {
  return `${ENTRY_PREFIX}${id}`;
}

async function readIds(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(INDEX_KEY);
  if (!raw) return [];
  const ids: unknown = JSON.parse(raw);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) {
    throw new Error('Invalid pending logout index');
  }
  return [...new Set(ids as string[])];
}

function parseRecord(raw: string | null): PendingLogoutCleanup | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingLogoutCleanup>;
    const refreshToken = String(value?.refreshToken || '').trim();
    if (!refreshToken) return null;
    return {
      refreshToken,
      clientDeviceId: String(value.clientDeviceId || '').trim() || null,
      pushToken: String(value.pushToken || '').trim() || null,
      createdAt: Number(value.createdAt || 0),
    };
  } catch {
    return null;
  }
}

async function storeRecord(record: PendingLogoutCleanup): Promise<void> {
  const id = await recordId(record.refreshToken);
  const ids = await readIds();
  if (!ids.includes(id) && ids.length >= MAX_PENDING) throw new Error('Pending logout queue full');
  await SecureStore.setItemAsync(entryKey(id), JSON.stringify(record));
  if (!ids.includes(id)) await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify([...ids, id]));
}

async function migrateLegacy(): Promise<void> {
  const raw = await SecureStore.getItemAsync(LEGACY_KEY);
  if (!raw) return;
  const record = parseRecord(raw);
  if (!record) return; // preserve undecodable legacy entry, don't silently overwrite
  await storeRecord(record);
  await SecureStore.deleteItemAsync(LEGACY_KEY);
}

async function removeRecord(id: string): Promise<void> {
  const ids = await readIds();
  await SecureStore.deleteItemAsync(entryKey(id));
  if (ids.includes(id)) {
    await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(ids.filter((item) => item !== id)));
  }
}

export function rememberPendingLogoutCleanup(record: {
  refreshToken: string;
  clientDeviceId: string | null;
  pushToken: string | null;
}): Promise<void> {
  if (isWeb) return Promise.resolve();
  const refreshToken = String(record.refreshToken || '').trim();
  if (!refreshToken) return Promise.resolve();
  return enqueue(async () => {
    await migrateLegacy();
    await storeRecord({
      refreshToken,
      clientDeviceId: String(record.clientDeviceId || '').trim() || null,
      pushToken: String(record.pushToken || '').trim() || null,
      createdAt: Date.now(),
    });
  });
}

export function forgetPendingLogoutCleanup(refreshToken: string): Promise<void> {
  if (isWeb) return Promise.resolve();
  const normalized = String(refreshToken || '').trim();
  if (!normalized) return Promise.resolve();
  return enqueue(async () => {
    await migrateLegacy();
    await removeRecord(await recordId(normalized));
  });
}

export function clearPendingLogoutCleanup(): Promise<void> {
  if (isWeb) return Promise.resolve();
  return enqueue(async () => {
    for (const id of await readIds()) {
      await SecureStore.deleteItemAsync(entryKey(id));
    }
    await SecureStore.deleteItemAsync(INDEX_KEY);
    await SecureStore.deleteItemAsync(LEGACY_KEY);
  });
}

export function runPendingLogoutCleanup(): Promise<void> {
  if (isWeb) return Promise.resolve();
  return enqueue(async () => {
    try {
      await migrateLegacy();
      for (const id of await readIds()) {
        const record = parseRecord(await SecureStore.getItemAsync(entryKey(id)));
        if (!record) {
          await removeRecord(id);
          continue;
        }
        try {
          await axios.post(
            `${API_V1_BASE}/auth/logout`,
            { refresh_token: record.refreshToken },
            {
              headers: {
                'Content-Type': 'application/json',
                ...withMobileAuthHeaders(record.clientDeviceId),
              },
              timeout: CLEANUP_TIMEOUT_MS,
            },
          );
          // Any HTTP response means there is nothing left to retry: either
          // the server just revoked session+push, or the tokens were already
          // dead. Push stays server-side: clearing the local FCM token here
          // could erase the next account's identical registration.
          await removeRecord(id);
        } catch (error) {
          // An answered HTTP error concerns only this record — other queued
          // accounts may still replay; a network failure stops the whole pass
          // and is retried by the next lifecycle trigger.
          if (axios.isAxiosError(error) && error.response) continue;
          break;
        }
      }
    } catch {
      // Storage/index corruption must fail closed: records stay untouched and
      // AppLifecycle never sees an unhandled rejection.
    }
  });
}
