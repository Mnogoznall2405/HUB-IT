import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  clearEncryptedNativeSnapshots,
  deleteEncryptedNativeSnapshot,
  MAX_NATIVE_SNAPSHOT_BYTES,
  readEncryptedNativeSnapshot,
  writeEncryptedNativeSnapshot,
} from './nativeSnapshotStorage';

export const NATIVE_SNAPSHOT_SCOPES = [
  'dashboard',
  'tasks-inbox',
  'chat-inbox',
  'chat-folders',
  'mail-inbox',
  'notifications',
  'mail-message-details',
  'mail-conversation-details',
  'task-details',
] as const;

export type NativeSnapshotScope = typeof NATIVE_SNAPSHOT_SCOPES[number];

type NativeSnapshotEnvelope<T> = {
  version: 1;
  userId: number;
  savedAt: number;
  data: T;
};

export type NativeSnapshot<T> = Pick<NativeSnapshotEnvelope<T>, 'savedAt' | 'data'>;

export type NativeEntitySnapshotScope = Extract<NativeSnapshotScope,
  'mail-message-details' | 'mail-conversation-details' | 'task-details'>;

type NativeEntitySnapshotEntry<T> = {
  key: string;
  savedAt: number;
  data: T;
};

type NativeEntitySnapshotBundle<T> = {
  entries: NativeEntitySnapshotEntry<T>[];
};

export type NativeSnapshotInventory = {
  ready: boolean;
  scopes: NativeSnapshotScope[];
  lastSyncAt: number;
};

export function formatNativeSnapshotSavedAt(savedAt: number): string {
  if (!Number.isFinite(savedAt) || savedAt <= 0) return '';
  return new Date(savedAt).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const CACHE_PREFIX = 'hubit_native_snapshot_v1';
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTITY_ENTRIES = 8;
const entityWriteLocks = new Map<string, Promise<void>>();

function normalizedUserId(userId: number): number | null {
  const value = Number(userId || 0);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function cacheKey(scope: NativeSnapshotScope, userId: number): string {
  return `${CACHE_PREFIX}_${scope.replace(/-/g, '_')}_${userId}`;
}

export async function readNativeSnapshot<T>(
  scope: NativeSnapshotScope,
  userId: number,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): Promise<NativeSnapshot<T> | null> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return null;
  const key = cacheKey(scope, owner);
  try {
    let raw = await readEncryptedNativeSnapshot(scope, owner);
    if (!raw) {
      raw = await SecureStore.getItemAsync(key);
      if (raw && await writeEncryptedNativeSnapshot(scope, owner, raw)) {
        await SecureStore.deleteItemAsync(key).catch(() => undefined);
      }
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NativeSnapshotEnvelope<T>>;
    const savedAt = Number(parsed.savedAt || 0);
    if (
      parsed.version !== 1
      || parsed.userId !== owner
      || !Number.isFinite(savedAt)
      || savedAt <= 0
      || Date.now() - savedAt > Math.max(0, maxAgeMs)
      || !('data' in parsed)
    ) {
      await Promise.allSettled([
        deleteEncryptedNativeSnapshot(scope, owner),
        SecureStore.deleteItemAsync(key),
      ]);
      return null;
    }
    return { savedAt, data: parsed.data as T };
  } catch {
    await Promise.allSettled([
      deleteEncryptedNativeSnapshot(scope, owner),
      SecureStore.deleteItemAsync(key),
    ]);
    return null;
  }
}

export async function writeNativeSnapshot<T>(
  scope: NativeSnapshotScope,
  userId: number,
  data: T,
): Promise<boolean> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return false;
  try {
    const serialized = JSON.stringify({
      version: 1,
      userId: owner,
      savedAt: Date.now(),
      data,
    } satisfies NativeSnapshotEnvelope<T>);
    return writeEncryptedNativeSnapshot(scope, owner, serialized);
  } catch {
    // Snapshot persistence is best-effort and must never block a live screen.
    return false;
  }
}

export async function readNativeEntitySnapshot<T>(
  scope: NativeEntitySnapshotScope,
  userId: number,
  entityKey: string,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): Promise<NativeSnapshot<T> | null> {
  const key = String(entityKey || '').trim();
  if (!key) return null;
  const snapshot = await readNativeSnapshot<NativeEntitySnapshotBundle<T>>(scope, userId, maxAgeMs);
  const entry = snapshot?.data.entries?.find((item) => item.key === key);
  if (!entry || Date.now() - entry.savedAt > Math.max(0, maxAgeMs)) return null;
  return { savedAt: entry.savedAt, data: entry.data };
}

export async function writeNativeEntitySnapshot<T>(
  scope: NativeEntitySnapshotScope,
  userId: number,
  entityKey: string,
  data: T,
): Promise<void> {
  const owner = normalizedUserId(userId);
  const key = String(entityKey || '').trim();
  if (!owner || !key || Platform.OS === 'web') return;
  const lockKey = `${scope}:${owner}`;
  const previous = entityWriteLocks.get(lockKey) || Promise.resolve();
  let current: Promise<void>;
  current = previous.catch(() => undefined).then(async () => {
    const existing = await readNativeSnapshot<NativeEntitySnapshotBundle<T>>(scope, owner);
    const now = Date.now();
    const entries = [
      { key, savedAt: now, data },
      ...(existing?.data.entries || []).filter((item) => (
        item.key !== key && now - Number(item.savedAt || 0) <= DEFAULT_MAX_AGE_MS
      )),
    ].slice(0, MAX_ENTITY_ENTRIES);

    while (entries.length > 0) {
      const serializedLength = new TextEncoder().encode(JSON.stringify({
        version: 1,
        userId: owner,
        savedAt: now,
        data: { entries },
      })).byteLength;
      if (serializedLength <= MAX_NATIVE_SNAPSHOT_BYTES) break;
      entries.pop();
    }
    if (!entries.some((entry) => entry.key === key)) return;
    await writeNativeSnapshot(scope, owner, { entries });
  }).finally(() => {
    if (entityWriteLocks.get(lockKey) === current) entityWriteLocks.delete(lockKey);
  });
  entityWriteLocks.set(lockKey, current);
  return current;
}

export async function getNativeSnapshotInventory(userId: number): Promise<NativeSnapshotInventory> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return { ready: false, scopes: [], lastSyncAt: 0 };
  const snapshots = await Promise.all(NATIVE_SNAPSHOT_SCOPES.map(async (scope) => ({
    scope,
    snapshot: await readNativeSnapshot<unknown>(scope, owner),
  })));
  const available = snapshots.filter((item) => item.snapshot);
  return {
    ready: available.length > 0,
    scopes: available.map((item) => item.scope),
    lastSyncAt: available.reduce((latest, item) => Math.max(latest, item.snapshot?.savedAt || 0), 0),
  };
}

export async function clearNativeSnapshots(userId: number): Promise<void> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return;
  await Promise.allSettled(
    NATIVE_SNAPSHOT_SCOPES.map((scope) => SecureStore.deleteItemAsync(cacheKey(scope, owner))),
  );
  await clearEncryptedNativeSnapshots(owner);
}
