import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  clearEncryptedNativeSnapshots,
  deleteEncryptedNativeSnapshot,
  readEncryptedNativeSnapshot,
  writeEncryptedNativeSnapshot,
} from './nativeSnapshotStorage';

export const NATIVE_SNAPSHOT_SCOPES = [
  'dashboard',
  'feed-inbox',
  'feed-post-details',
  'tasks-inbox',
  'chat-inbox',
  'chat-folders',
  'chat-thread-details',
  'address-book',
  'address-book-chat-links',
  'mail-inbox',
  'notifications',
  'mail-message-details',
  'mail-conversation-details',
  'task-details',
  'docflow-inbox',
  'docflow-task-details',
  'database-bootstrap',
  'database-inbox',
  'database-item-details',
  'my-files-inbox',
  'my-file-details',
  'company-structure-tree',
  'company-structure-people',
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
  'feed-post-details' | 'chat-thread-details' | 'address-book-chat-links' | 'mail-message-details' | 'mail-conversation-details' | 'task-details' | 'docflow-task-details' | 'database-item-details' | 'my-file-details' | 'company-structure-people'>;

export type NativeCollectionSnapshotScope = Extract<NativeSnapshotScope,
  'feed-inbox' | 'tasks-inbox' | 'chat-inbox' | 'mail-inbox' | 'docflow-inbox' | 'database-inbox'>;

export type NativeCollectionSnapshot<T> = NativeSnapshot<T> & { key: string };

type NativeEntitySnapshotEntry<T> = {
  key: string;
  savedAt: number;
  data: T;
};

type NativeEntitySnapshotBundle<T> = {
  entries: NativeEntitySnapshotEntry<T>[];
};

type NativeEntitySnapshotManifest = {
  entityKeys: Array<{ key: string; savedAt: number; storageScope: string }>;
};

const COLLECTION_MANIFEST_KIND = 'collection-shards-v1';
const COLLECTION_SHARD_KIND = 'collection-shard-v1';

type NativeCollectionSnapshotManifestEntry = {
  key: string;
  savedAt: number;
  revision: string;
  serializedLength: number;
  storageScopes: string[];
};

type NativeCollectionSnapshotManifest = {
  kind: typeof COLLECTION_MANIFEST_KIND;
  collectionKeys: NativeCollectionSnapshotManifestEntry[];
};

type NativeCollectionSnapshotShard = {
  kind: typeof COLLECTION_SHARD_KIND;
  revision: string;
  index: number;
  chunk: string;
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
// Offline data remains available until the user signs out, clears it, or a bounded
// cache limit evicts it. Online screens still revalidate these snapshots immediately.
const DEFAULT_MAX_AGE_MS = Number.MAX_SAFE_INTEGER;
const MAX_ENTITY_ENTRIES = 1000;
const MAX_COLLECTION_ENTRIES = 8;
// JSON chunks are intentionally much smaller than the encrypted-file limit.
// A chunk is JSON-escaped once more inside its shard envelope, so keeping it at
// 256K UTF-16 code units also leaves ample room for escapes and multibyte text.
const COLLECTION_SHARD_TARGET_CHARS = 256 * 1024;
const entityWriteLocks = new Map<string, Promise<void>>();
let collectionRevisionSequence = 0;

function normalizedUserId(userId: number): number | null {
  const value = Number(userId || 0);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function cacheKey(scope: NativeSnapshotScope, userId: number): string {
  return `${CACHE_PREFIX}_${scope.replace(/-/g, '_')}_${userId}`;
}

function hashEntityKey(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

function entityShardScope(scope: NativeEntitySnapshotScope, key: string): string {
  return `${scope}-entity-${hashEntityKey(key, 2166136261)}-${hashEntityKey(key, 3339675911)}`;
}

function collectionShardScope(
  scope: NativeCollectionSnapshotScope,
  key: string,
  revision: string,
  index: number,
): string {
  return `${scope}-collection-${hashEntityKey(key, 2166136261)}-${hashEntityKey(key, 3339675911)}-${revision}-${index}`;
}

function isCollectionManifest(value: unknown): value is NativeCollectionSnapshotManifest {
  const candidate = value as Partial<NativeCollectionSnapshotManifest> | null;
  return Boolean(
    candidate
    && candidate.kind === COLLECTION_MANIFEST_KIND
    && Array.isArray(candidate.collectionKeys),
  );
}

export function hasNativeCollectionSnapshotManifest(value: unknown): boolean {
  return isCollectionManifest(value);
}

function isCollectionManifestEntry(value: unknown): value is NativeCollectionSnapshotManifestEntry {
  const candidate = value as Partial<NativeCollectionSnapshotManifestEntry> | null;
  return Boolean(
    candidate
    && typeof candidate.key === 'string'
    && Number.isFinite(candidate.savedAt)
    && typeof candidate.revision === 'string'
    && Number.isInteger(candidate.serializedLength)
    && Array.isArray(candidate.storageScopes)
    && candidate.storageScopes.every((storageScope) => typeof storageScope === 'string' && storageScope),
  );
}

function splitSerializedCollection(serialized: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < serialized.length;) {
    let end = Math.min(serialized.length, offset + COLLECTION_SHARD_TARGET_CHARS);
    const lastCodeUnit = serialized.charCodeAt(end - 1);
    const nextCodeUnit = serialized.charCodeAt(end);
    if (
      end < serialized.length
      && lastCodeUnit >= 0xD800
      && lastCodeUnit <= 0xDBFF
      && nextCodeUnit >= 0xDC00
      && nextCodeUnit <= 0xDFFF
    ) end -= 1;
    chunks.push(serialized.slice(offset, end));
    offset = end;
  }
  return chunks.length > 0 ? chunks : [''];
}

function legacyDefaultCollectionKey(scope: NativeCollectionSnapshotScope, value: unknown): string {
  if (scope !== 'chat-inbox') return '';
  const candidate = value as { items?: unknown; has_more?: unknown } | null;
  return candidate && Array.isArray(candidate.items) && 'has_more' in candidate ? 'default' : '';
}

function nativeCollectionPayloadIsComplete(
  scope: NativeCollectionSnapshotScope,
  value: unknown,
): boolean {
  const payload = value as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object') return false;
  if (scope === 'chat-inbox') return payload.has_more !== true;
  if (scope === 'feed-inbox') {
    const total = Number(payload.total);
    return !Number.isFinite(total) || (Array.isArray(payload.items) && payload.items.length >= total);
  }
  if (scope === 'tasks-inbox') {
    const page = payload.page as Record<string, unknown> | undefined;
    if (!page) return false;
    const total = Number(page?.total);
    return !Number.isFinite(total) || (Array.isArray(page.items) && page.items.length >= total);
  }
  if (scope === 'mail-inbox') {
    const total = Number(payload.total);
    return payload.hasMore !== true
      && (!Number.isFinite(total) || (Array.isArray(payload.items) && payload.items.length >= total));
  }
  if (scope === 'docflow-inbox') {
    const result = payload.result as Record<string, unknown> | undefined;
    if (!result || result.truncated === true || result.has_more === true) return false;
    const total = result.total == null ? null : Number(result.total);
    return total == null || !Number.isFinite(total)
      || (Array.isArray(result.items) && result.items.length >= total);
  }
  return false;
}

async function cleanupCollectionScopes(userId: number, storageScopes: string[]): Promise<void> {
  await Promise.allSettled(
    storageScopes.map((storageScope) => deleteEncryptedNativeSnapshot(storageScope, userId)),
  );
}

async function writeCollectionEntry<T>(
  scope: NativeCollectionSnapshotScope,
  userId: number,
  key: string,
  savedAt: number,
  data: T,
): Promise<{ entry: NativeCollectionSnapshotManifestEntry; serialized: string } | null> {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(data);
  } catch {
    return null;
  }
  if (typeof serialized !== 'string') return null;

  collectionRevisionSequence += 1;
  const revision = `${Date.now().toString(36)}-${collectionRevisionSequence.toString(36)}`;
  const chunks = splitSerializedCollection(serialized);
  const storageScopes: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const storageScope = collectionShardScope(scope, key, revision, index);
    const stored = await writeNativeSnapshot(
      storageScope as NativeSnapshotScope,
      userId,
      {
        kind: COLLECTION_SHARD_KIND,
        revision,
        index,
        chunk: chunks[index],
      } satisfies NativeCollectionSnapshotShard,
    );
    if (!stored) {
      await cleanupCollectionScopes(userId, storageScopes);
      return null;
    }
    storageScopes.push(storageScope);
  }
  return {
    entry: { key, savedAt, revision, serializedLength: serialized.length, storageScopes },
    serialized,
  };
}

async function readCollectionManifestEntry<T>(
  entry: NativeCollectionSnapshotManifestEntry,
  userId: number,
): Promise<T | null> {
  if (
    !entry.revision
    || !Number.isInteger(entry.serializedLength)
    || entry.serializedLength < 0
    || !Array.isArray(entry.storageScopes)
    || entry.storageScopes.length === 0
  ) return null;
  const chunks: string[] = [];
  for (let index = 0; index < entry.storageScopes.length; index += 1) {
    const snapshot = await readNativeSnapshot<NativeCollectionSnapshotShard>(
      entry.storageScopes[index] as NativeSnapshotScope,
      userId,
      DEFAULT_MAX_AGE_MS,
    );
    const shard = snapshot?.data as Partial<NativeCollectionSnapshotShard> | null | undefined;
    if (
      !shard
      || shard.kind !== COLLECTION_SHARD_KIND
      || shard.revision !== entry.revision
      || shard.index !== index
      || typeof shard.chunk !== 'string'
    ) return null;
    chunks.push(shard.chunk);
  }
  const serialized = chunks.join('');
  if (serialized.length !== entry.serializedLength) return null;
  try {
    return JSON.parse(serialized) as T;
  } catch {
    return null;
  }
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

export async function readNativeCollectionSnapshot<T>(
  scope: NativeCollectionSnapshotScope,
  userId: number,
  collectionKey: string,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): Promise<NativeSnapshot<T> | null> {
  const key = String(collectionKey || '').trim();
  if (!key) return null;
  const snapshot = await readNativeSnapshot<
    NativeCollectionSnapshotManifest | NativeEntitySnapshotBundle<T> | (T & { signature?: string })
  >(
    scope,
    userId,
    maxAgeMs,
  );
  if (!snapshot) return null;

  if (isCollectionManifest(snapshot.data)) {
    const manifestEntry = snapshot.data.collectionKeys.find((item) => item.key === key);
    if (
      !isCollectionManifestEntry(manifestEntry)
      || Date.now() - manifestEntry.savedAt > Math.max(0, maxAgeMs)
    ) return null;
    const manifestData = await readCollectionManifestEntry<T>(manifestEntry, userId);
    return manifestData == null ? null : { savedAt: manifestEntry.savedAt, data: manifestData };
  }

  const data = snapshot.data as (NativeEntitySnapshotBundle<T> & T & { signature?: string }) | null;
  if (!data || typeof data !== 'object') return null;
  const entry = Array.isArray(data.entries)
    ? data.entries.find((item) => item.key === key)
    : null;
  if (entry && Date.now() - entry.savedAt <= Math.max(0, maxAgeMs)) {
    return { savedAt: entry.savedAt, data: entry.data };
  }
  // Backward compatibility with the single-filter snapshots used before 1.1.18.
  if (!Array.isArray(data.entries) && data.signature === key) {
    return { savedAt: snapshot.savedAt, data: snapshot.data as T };
  }
  // Chat inbox used to persist one unkeyed page directly under chat-inbox.
  if (!Array.isArray(data.entries) && key === legacyDefaultCollectionKey(scope, data)) {
    return { savedAt: snapshot.savedAt, data: snapshot.data as T };
  }
  return null;
}

export async function readNativeCollectionSnapshots<T>(
  scope: NativeCollectionSnapshotScope,
  userId: number,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): Promise<NativeCollectionSnapshot<T>[]> {
  const snapshot = await readNativeSnapshot<
    NativeCollectionSnapshotManifest | NativeEntitySnapshotBundle<T> | (T & { signature?: string })
  >(scope, userId, maxAgeMs);
  if (!snapshot) return [];

  if (isCollectionManifest(snapshot.data)) {
    const result: NativeCollectionSnapshot<T>[] = [];
    for (const entry of snapshot.data.collectionKeys) {
      if (
        !isCollectionManifestEntry(entry)
        || Date.now() - entry.savedAt > Math.max(0, maxAgeMs)
      ) continue;
      const data = await readCollectionManifestEntry<T>(entry, userId);
      if (data != null) result.push({ key: entry.key, savedAt: entry.savedAt, data });
    }
    return result;
  }

  const data = snapshot.data as (NativeEntitySnapshotBundle<T> & T & { signature?: string }) | null;
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.entries)) {
    return data.entries.filter((entry) => (
      entry
      && typeof entry.key === 'string'
      && Date.now() - Number(entry.savedAt || 0) <= Math.max(0, maxAgeMs)
    )).map((entry) => ({ key: entry.key, savedAt: entry.savedAt, data: entry.data }));
  }
  const key = String(data.signature || legacyDefaultCollectionKey(scope, data)).trim();
  return key ? [{ key, savedAt: snapshot.savedAt, data: snapshot.data as T }] : [];
}

export async function writeNativeCollectionSnapshot<T>(
  scope: NativeCollectionSnapshotScope,
  userId: number,
  collectionKey: string,
  data: T,
): Promise<boolean> {
  const owner = normalizedUserId(userId);
  const key = String(collectionKey || '').trim();
  if (!owner || !key || Platform.OS === 'web') return false;
  const lockKey = `${scope}:${owner}`;
  const previous = entityWriteLocks.get(lockKey) || Promise.resolve();
  let stored = false;
  let current: Promise<void>;
  current = previous.catch(() => undefined).then(async () => {
    const currentEntry = await readNativeCollectionSnapshot<T>(scope, owner, key).catch(() => null);
    if (
      currentEntry
      && nativeCollectionPayloadIsComplete(scope, currentEntry.data)
      && !nativeCollectionPayloadIsComplete(scope, data)
    ) {
      stored = true;
      return;
    }
    const existing = await readNativeSnapshot<
      NativeCollectionSnapshotManifest | NativeEntitySnapshotBundle<T> | T
    >(scope, owner);
    const now = Date.now();
    const existingData = existing?.data;
    const previousManifestEntries = isCollectionManifest(existingData)
      ? existingData.collectionKeys.filter(isCollectionManifestEntry)
      : [];
    const inlineBundle = existingData as NativeEntitySnapshotBundle<T> | undefined;
    const inlineEntries = Array.isArray(inlineBundle?.entries) ? inlineBundle.entries : [];
    const legacyData = existingData as (T & { signature?: string }) | undefined;
    const legacyKey = legacyData && !Array.isArray(inlineBundle?.entries)
      ? String(legacyData.signature || legacyDefaultCollectionKey(scope, legacyData)).trim()
      : '';
    const legacyEntries: NativeEntitySnapshotEntry<T>[] = legacyKey ? [{
      key: legacyKey,
      savedAt: existing?.savedAt || now,
      data: legacyData as T,
    }] : [];
    const retainedManifestEntries = previousManifestEntries.filter((entry) => (
      entry.key !== key && now - Number(entry.savedAt || 0) <= DEFAULT_MAX_AGE_MS
    )).slice(0, MAX_COLLECTION_ENTRIES - 1);
    const remainingSlots = MAX_COLLECTION_ENTRIES - 1 - retainedManifestEntries.length;
    const retainedInlineEntries = [...inlineEntries, ...legacyEntries].filter((entry, index, entries) => (
      entry.key !== key
      && now - Number(entry.savedAt || 0) <= DEFAULT_MAX_AGE_MS
      && entries.findIndex((candidate) => candidate.key === entry.key) === index
    )).slice(0, remainingSlots);

    const target = await writeCollectionEntry(scope, owner, key, now, data);
    if (!target) return;
    const writtenScopes = [...target.entry.storageScopes];
    const migratedEntries: NativeCollectionSnapshotManifestEntry[] = [];
    for (const inlineEntry of retainedInlineEntries) {
      const migrated = await writeCollectionEntry(
        scope,
        owner,
        inlineEntry.key,
        inlineEntry.savedAt,
        inlineEntry.data,
      );
      if (!migrated) {
        await cleanupCollectionScopes(owner, writtenScopes);
        return;
      }
      writtenScopes.push(...migrated.entry.storageScopes);
      migratedEntries.push(migrated.entry);
    }

    const collectionKeys = [
      target.entry,
      ...retainedManifestEntries,
      ...migratedEntries,
    ].slice(0, MAX_COLLECTION_ENTRIES);
    const committed = await writeNativeSnapshot(scope, owner, {
      kind: COLLECTION_MANIFEST_KIND,
      collectionKeys,
    } satisfies NativeCollectionSnapshotManifest);
    if (!committed) {
      await cleanupCollectionScopes(owner, writtenScopes);
      return;
    }

    const verified = await readNativeCollectionSnapshot<T>(scope, owner, key).catch(() => null);
    let verifiedSerialized: string | undefined;
    try {
      verifiedSerialized = JSON.stringify(verified?.data);
    } catch {
      verifiedSerialized = undefined;
    }
    if (!verified || verifiedSerialized !== target.serialized) {
      const restored = existing
        ? await writeNativeSnapshot(scope, owner, existing.data).catch(() => false)
        : false;
      if (!restored) await deleteEncryptedNativeSnapshot(scope, owner).catch(() => undefined);
      await cleanupCollectionScopes(owner, writtenScopes);
      return;
    }

    const retainedScopes = new Set(collectionKeys.flatMap((entry) => entry.storageScopes));
    const obsoleteScopes = previousManifestEntries
      .flatMap((entry) => entry.storageScopes)
      .filter((storageScope) => !retainedScopes.has(storageScope));
    await cleanupCollectionScopes(owner, obsoleteScopes);
    stored = true;
  }).finally(() => {
    if (entityWriteLocks.get(lockKey) === current) entityWriteLocks.delete(lockKey);
  });
  entityWriteLocks.set(lockKey, current);
  await current;
  return stored;
}

export async function readNativeEntitySnapshot<T>(
  scope: NativeEntitySnapshotScope,
  userId: number,
  entityKey: string,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): Promise<NativeSnapshot<T> | null> {
  const key = String(entityKey || '').trim();
  if (!key) return null;
  const shard = await readNativeSnapshot<NativeEntitySnapshotEntry<T>>(
    entityShardScope(scope, key) as NativeSnapshotScope,
    userId,
    maxAgeMs,
  );
  if (shard?.data.key === key) {
    return { savedAt: shard.data.savedAt, data: shard.data.data };
  }

  const snapshot = await readNativeSnapshot<NativeEntitySnapshotBundle<T> | NativeEntitySnapshotManifest>(
    scope,
    userId,
    maxAgeMs,
  );
  const bundle = snapshot?.data as NativeEntitySnapshotBundle<T> | undefined;
  const entry = Array.isArray(bundle?.entries) ? bundle.entries.find((item) => item.key === key) : null;
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
    const now = Date.now();
    const storageScope = entityShardScope(scope, key);
    const stored = await writeNativeSnapshot(
      storageScope as NativeSnapshotScope,
      owner,
      { key, savedAt: now, data } satisfies NativeEntitySnapshotEntry<T>,
    );
    if (!stored) return;

    const existing = await readNativeSnapshot<NativeEntitySnapshotBundle<T> | NativeEntitySnapshotManifest>(
      scope,
      owner,
      Number.MAX_SAFE_INTEGER,
    );
    const existingData = existing?.data;
    const legacyEntries = Array.isArray((existingData as NativeEntitySnapshotBundle<T> | undefined)?.entries)
      ? (existingData as NativeEntitySnapshotBundle<T>).entries
      : [];
    const manifestEntries = Array.isArray((existingData as NativeEntitySnapshotManifest | undefined)?.entityKeys)
      ? (existingData as NativeEntitySnapshotManifest).entityKeys
      : [];
    const migratedEntries: NativeEntitySnapshotManifest['entityKeys'] = [];

    for (const legacyEntry of legacyEntries) {
      const legacyStorageScope = entityShardScope(scope, legacyEntry.key);
      const migrated = legacyEntry.key === key || await writeNativeSnapshot(
        legacyStorageScope as NativeSnapshotScope,
        owner,
        legacyEntry,
      );
      if (migrated) {
        migratedEntries.push({
          key: legacyEntry.key,
          savedAt: legacyEntry.savedAt,
          storageScope: legacyStorageScope,
        });
      }
    }

    const candidates = [
      { key, savedAt: now, storageScope },
      ...manifestEntries,
      ...migratedEntries,
    ];
    const entityKeys = candidates.filter((entry, index) => (
      entry.key === key
      || (
        candidates.findIndex((candidate) => candidate.key === entry.key) === index
      )
    )).slice(0, MAX_ENTITY_ENTRIES);
    const retainedScopes = new Set(entityKeys.map((entry) => entry.storageScope));
    await Promise.allSettled(
      [...manifestEntries, ...migratedEntries]
        .filter((entry) => !retainedScopes.has(entry.storageScope))
        .map((entry) => deleteEncryptedNativeSnapshot(entry.storageScope, owner)),
    );
    await writeNativeSnapshot(scope, owner, { entityKeys } satisfies NativeEntitySnapshotManifest);
  }).finally(() => {
    if (entityWriteLocks.get(lockKey) === current) entityWriteLocks.delete(lockKey);
  });
  entityWriteLocks.set(lockKey, current);
  return current;
}

export async function clearNativeSnapshots(userId: number): Promise<void> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return;
  await Promise.allSettled(
    NATIVE_SNAPSHOT_SCOPES.map((scope) => SecureStore.deleteItemAsync(cacheKey(scope, owner))),
  );
  await clearEncryptedNativeSnapshots(owner);
}
