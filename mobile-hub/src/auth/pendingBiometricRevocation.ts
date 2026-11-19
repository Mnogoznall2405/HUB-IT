import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_V1_BASE } from '../api/config';
import { withMobileAuthHeaders } from '../api/client';
import * as tokenStore from './tokenStore';

// Disabling fingerprint login while offline leaves the server credential
// alive: the device could keep unlocking until the user revokes it elsewhere.
// A durable record replays DELETE /auth/mobile-biometric once connectivity
// and a matching user session are back — the endpoint needs that user's live
// access token, so the record stores only owner and device ids.
const STORAGE_KEY = 'hubit_pending_biometric_revocation_v1';
const REVOKE_TIMEOUT_MS = 10_000;
const isWeb = Platform.OS === 'web';

type PendingBiometricRevocation = {
  userId: number;
  clientDeviceId: string;
  createdAt: number;
};

let mutation: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const pending = mutation.catch(() => undefined).then(operation);
  mutation = pending;
  return pending;
}

async function readRecord(): Promise<PendingBiometricRevocation | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingBiometricRevocation>;
    const userId = Number(value.userId || 0);
    const clientDeviceId = String(value.clientDeviceId || '').trim();
    if (!Number.isInteger(userId) || userId <= 0 || !clientDeviceId) return null;
    return { userId, clientDeviceId, createdAt: Number(value.createdAt || 0) };
  } catch {
    return null;
  }
}

export function rememberPendingBiometricRevocation(userId: number, clientDeviceId: string): Promise<void> {
  const normalizedDeviceId = String(clientDeviceId || '').trim();
  if (isWeb || !Number.isInteger(userId) || userId <= 0 || !normalizedDeviceId) {
    return Promise.resolve();
  }
  return enqueue(async () => {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({
      userId,
      clientDeviceId: normalizedDeviceId,
      createdAt: Date.now(),
    }));
  });
}

export function clearPendingBiometricRevocation(): Promise<void> {
  if (isWeb) return Promise.resolve();
  return enqueue(() => SecureStore.deleteItemAsync(STORAGE_KEY));
}

/** Replays the deferred revocation under the record owner's live session.
 * A different signed-in account is skipped, never revoked by proxy: the
 * record waits for its owner (or dies with a definitive server answer). */
export function runPendingBiometricRevocation(userId: number): Promise<void> {
  if (isWeb || !Number.isInteger(userId) || userId <= 0) return Promise.resolve();
  return enqueue(async () => {
    const record = await readRecord();
    if (!record || record.userId !== userId) return;
    const accessToken = await tokenStore.getAccessToken().catch(() => null);
    if (!accessToken) return;
    try {
      await axios.delete(`${API_V1_BASE}/auth/mobile-biometric`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...withMobileAuthHeaders(record.clientDeviceId),
        },
        timeout: REVOKE_TIMEOUT_MS,
      });
      await SecureStore.deleteItemAsync(STORAGE_KEY);
    } catch (error) {
      // An answered request means there is nothing left to retry (already
      // revoked or superseded) — except answers that are not definitive:
      // an auth rejection may just be an expired token while a valid
      // credential still needs revoking (401/403), and transient failures
      // (408, 429, any 5xx) deserve a later retry too, so those keep the
      // record. Only other definitive 4xx answers clear it.
      if (axios.isAxiosError(error) && error.response) {
        const status = Number(error.response.status || 0);
        if (status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status)) {
          await SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => undefined);
        }
      }
    }
  });
}
