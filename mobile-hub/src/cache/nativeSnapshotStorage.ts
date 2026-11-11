import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { recordSnapshotFailure } from '../diagnostics/diagnostics';
import { trackWork } from '../diagnostics/perfProbes';

const SNAPSHOT_DIRECTORY_NAME = 'hubit-native-snapshots';
const KEY_PREFIX = 'hubit_native_snapshot_aes_key_v2';
export const MAX_NATIVE_SNAPSHOT_BYTES = 2 * 1024 * 1024;
export const MAX_NATIVE_ADDRESS_BOOK_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const encryptionKeyRequests = new Map<number, Promise<Crypto.AESEncryptionKey>>();
const snapshotWriteRequests = new Map<string, Promise<void>>();
const clearingUsers = new Map<number, Promise<void>>();

function normalizedUserId(userId: number): number | null {
  const value = Number(userId || 0);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function snapshotDirectory(): Directory {
  const directory = new Directory(Paths.document, SNAPSHOT_DIRECTORY_NAME);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function legacySnapshotDirectory(): Directory {
  return new Directory(Paths.cache, SNAPSHOT_DIRECTORY_NAME);
}

function safeScope(scope: string): string {
  return String(scope || '').trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}

function snapshotFile(scope: string, userId: number): File {
  return new File(snapshotDirectory(), `snapshot-${userId}-${safeScope(scope)}.aes`);
}

function pendingSnapshotFile(scope: string, userId: number): File {
  return new File(snapshotDirectory(), `snapshot-${userId}-${safeScope(scope)}.pending`);
}

function backupSnapshotFile(scope: string, userId: number): File {
  return new File(snapshotDirectory(), `snapshot-${userId}-${safeScope(scope)}.backup`);
}

function legacySnapshotFile(scope: string, userId: number): File {
  return new File(legacySnapshotDirectory(), `snapshot-${userId}-${safeScope(scope)}.aes`);
}

function encryptionKeyName(userId: number): string {
  return `${KEY_PREFIX}_${userId}`;
}

function additionalData(scope: string, userId: number): Uint8Array {
  return new TextEncoder().encode(`hubit-native-snapshot:v2:${userId}:${safeScope(scope)}`);
}

function maxSnapshotBytes(scope: string): number {
  return safeScope(scope) === 'address-book'
    ? MAX_NATIVE_ADDRESS_BOOK_SNAPSHOT_BYTES
    : MAX_NATIVE_SNAPSHOT_BYTES;
}

async function loadOrCreateEncryptionKey(userId: number): Promise<Crypto.AESEncryptionKey> {
  const keyName = encryptionKeyName(userId);
  const stored = String((await SecureStore.getItemAsync(keyName)) || '').trim();
  if (stored) return Crypto.AESEncryptionKey.import(stored, 'base64');
  const generated = await Crypto.AESEncryptionKey.generate(Crypto.AESKeySize.AES256);
  await SecureStore.setItemAsync(keyName, await generated.encoded('base64'));
  return generated;
}

async function getOrCreateEncryptionKey(userId: number): Promise<Crypto.AESEncryptionKey> {
  const pending = encryptionKeyRequests.get(userId);
  if (pending) return pending;
  const request = loadOrCreateEncryptionKey(userId).finally(() => {
    encryptionKeyRequests.delete(userId);
  });
  encryptionKeyRequests.set(userId, request);
  return request;
}

let base64LookupTable: Uint8Array | null = null;

// A char-code table: the old decoder ran four String.indexOf scans per 4 characters,
// which cost hundreds of milliseconds of JS time on a 350 KB snapshot.
function base64Lookup(): Uint8Array {
  if (base64LookupTable) return base64LookupTable;
  const table = new Uint8Array(128);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let index = 0; index < alphabet.length; index += 1) table[alphabet.charCodeAt(index)] = index;
  base64LookupTable = table;
  return table;
}

function decodeCombinedBase64(encoded: string): Uint8Array {
  // expo-crypto 57.0.2 declares string input, but Android's fromCombined
  // takes ByteArray, whose JSI converter accepts only Uint8Array. Decode here;
  // do not change the on-disk format, AAD, key, IV or tag.
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('Invalid encrypted snapshot base64');
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((encoded.length / 4) * 3 - padding);
  const lookup = base64Lookup();
  for (let index = 0, offset = 0; index < encoded.length; index += 4) {
    // '=' maps to 0 in the table, as the previous indexOf-based decoder treated it.
    const block = (lookup[encoded.charCodeAt(index)] << 18) | (lookup[encoded.charCodeAt(index + 1)] << 12)
      | (lookup[encoded.charCodeAt(index + 2)] << 6) | lookup[encoded.charCodeAt(index + 3)];
    bytes[offset++] = block >>> 16;
    if (offset < bytes.length) bytes[offset++] = (block >>> 8) & 255;
    if (offset < bytes.length) bytes[offset++] = block & 255;
  }
  return bytes;
}

// Decrypting a snapshot costs JS-thread time (base64 decode, UTF-8, parse by the
// caller): the diagnostics showed repeated reads/writes of the same cache stalling
// the UI. The decrypted text of the last known on-disk generation is kept in
// memory, validated against the file's size and modification time, so a changed
// file (another JS context, restore) is never served from the cache.
const PLAINTEXT_CACHE_MAX_CHARS = 10_000_000;
// Equipment-catalog shards are read in bulk and rarely again: caching them would only
// evict the small, frequently used snapshots (inbox, folders, threads).
const UNCACHED_SCOPE_PREFIXES = ['database-catalog'];
const plaintextCache = new Map<string, { signature: string; plaintext: string }>();
let plaintextCacheChars = 0;

function snapshotCacheKey(owner: number, scope: string): string {
  return `${owner}:${safeScope(scope)}`;
}

function fileSignature(file: File): string | null {
  try {
    const modified = file.lastModified;
    const size = file.size;
    return typeof modified === 'number' && Number.isFinite(modified) && typeof size === 'number' && size > 0
      ? `${size}:${modified}`
      : null;
  } catch {
    return null;
  }
}

function forgetCachedPlaintext(key: string): void {
  const existing = plaintextCache.get(key);
  if (!existing) return;
  plaintextCacheChars -= existing.plaintext.length;
  plaintextCache.delete(key);
}

function rememberPlaintext(key: string, file: File, plaintext: string): void {
  forgetCachedPlaintext(key);
  if (UNCACHED_SCOPE_PREFIXES.some((prefix) => key.includes(`:${prefix}`))) return;
  const signature = fileSignature(file);
  if (!signature || plaintext.length > PLAINTEXT_CACHE_MAX_CHARS) return;
  plaintextCache.set(key, { signature, plaintext });
  plaintextCacheChars += plaintext.length;
  // Map keeps insertion order: drop the least recently stored entries first.
  for (const oldest of plaintextCache.keys()) {
    if (plaintextCacheChars <= PLAINTEXT_CACHE_MAX_CHARS) break;
    forgetCachedPlaintext(oldest);
  }
}

function cachedPlaintext(key: string, file: File): string | null {
  const entry = plaintextCache.get(key);
  if (!entry) return null;
  if (!file.exists || fileSignature(file) !== entry.signature) {
    forgetCachedPlaintext(key);
    return null;
  }
  // Refresh recency.
  plaintextCache.delete(key);
  plaintextCache.set(key, entry);
  return entry.plaintext;
}

function snapshotFileState(file?: File): { exists: boolean | null; size: number | null } {
  try { return file ? { exists: file.exists, size: file.exists ? file.size : null } : { exists: null, size: null }; }
  catch { return { exists: null, size: null }; }
}

function withSnapshotOperation<T>(scope: string, owner: number, operation: () => Promise<T>): Promise<T> {
  const writeKey = `${owner}:${safeScope(scope)}`;
  const previous = snapshotWriteRequests.get(writeKey) || Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const marker = result.then(() => undefined, () => undefined).finally(() => {
    if (snapshotWriteRequests.get(writeKey) === marker) snapshotWriteRequests.delete(writeKey);
  });
  snapshotWriteRequests.set(writeKey, marker);
  return result;
}

async function decryptSnapshotFile(
  file: File, scope: string, owner: number, stage: (value: string) => void,
  sizes: Record<string, number>, backup = false,
): Promise<string> {
  stage(backup ? 'backup-read' : 'target-read');
  const raw = await file.text();
  if (typeof raw !== 'string') throw new TypeError('Snapshot read returned a non-string');
  const encoded = raw.trim();
  sizes.readChars = raw.length;
  sizes.encodedChars = encoded.length;
  if (!encoded) throw new Error(backup ? 'Empty encrypted backup' : 'Empty encrypted snapshot');
  stage('key-load');
  const key = await getOrCreateEncryptionKey(owner);
  stage('sealed-decode');
  const combined = decodeCombinedBase64(encoded);
  sizes.combinedBytes = combined.byteLength;
  const sealed = Crypto.AESSealedData.fromCombined(combined);
  stage('decrypt');
  const decrypted = await Crypto.aesDecryptAsync(sealed, key, { additionalData: additionalData(scope, owner) });
  sizes.decryptedBytes = decrypted.byteLength;
  stage('utf8-decode');
  return new TextDecoder().decode(decrypted);
}

async function performEncryptedNativeSnapshotWrite(scope: string, owner: number, plaintext: string): Promise<boolean> {
  let stage = 'serialize-bytes';
  let target: File | undefined;
  let pending: File | undefined;
  let backup: File | undefined;
  let backupReady = false;
  let moveStarted = false;
  const sizes: Record<string, number> = {};
  const report = (error: unknown) => recordSnapshotFailure(scope, stage, error, {
    sizes, files: { target: snapshotFileState(target), pending: snapshotFileState(pending), backup: snapshotFileState(backup) },
  });
  try {
    const bytes = new TextEncoder().encode(plaintext);
    sizes.plaintextBytes = bytes.byteLength;
    if (bytes.byteLength > maxSnapshotBytes(scope)) throw new Error('Snapshot size limit exceeded');
    stage = 'key-load';
    const key = await getOrCreateEncryptionKey(owner);
    stage = 'encrypt';
    const sealed = await Crypto.aesEncryptAsync(bytes, key, { additionalData: additionalData(scope, owner) });
    stage = 'combined-base64';
    const encoded = await sealed.combined('base64');
    sizes.encodedChars = encoded.length;
    stage = 'directory';
    target = snapshotFile(scope, owner);
    pending = pendingSnapshotFile(scope, owner);
    backup = backupSnapshotFile(scope, owner);
    stage = 'pending-write';
    if (pending.exists) pending.delete();
    pending.write(encoded);
    stage = 'pending-read';
    const readBack = await pending.text();
    if (typeof readBack === 'string') sizes.readChars = readBack.length;
    if (!pending.exists || pending.size !== encoded.length || readBack !== encoded) {
      throw new Error('Snapshot staging verification failed');
    }
    stage = 'backup-copy';
    if (target.exists) {
      await target.copy(backup, { overwrite: true });
      backupReady = true;
    }
    stage = 'pending-move';
    moveStarted = true;
    // move mutates its source URI. Keep pending anchored to the staging path,
    // including when native move changes its URI and then rejects.
    await new File(pending.uri).move(target, { overwrite: true });
    const verified = await decryptSnapshotFile(target, scope, owner, (value) => { stage = value; }, sizes);
    stage = 'commit-verify';
    if (verified !== plaintext) throw new Error('Snapshot commit verification failed');
    rememberPlaintext(snapshotCacheKey(owner, scope), target, plaintext);
  } catch (error) {
    await report(error);
    // Never delete through the source File object after move, even if move rejects late.
    stage = 'pending-cleanup';
    try {
      const staging = pendingSnapshotFile(scope, owner);
      if (staging.exists) staging.delete();
    } catch (cleanupError) { await report(cleanupError); }
    if (moveStarted && backupReady && backup && target) {
      stage = 'backup-restore';
      try { await backup.copy(target, { overwrite: true }); }
      catch (restoreError) { await report(restoreError); }
    }
    return false;
  }
  // A failed cleanup must not roll back an already verified commit.
  stage = 'backup-cleanup';
  try { if (backup?.exists) backup.delete(); }
  catch (error) { await report(error); }
  return true;
}

/** TEMPORARY diagnostics name: `chat-inbox-collection-<hash>-0` -> `chat-inbox`. */
function snapshotWorkName(kind: 'write' | 'read', scope: string): string {
  const family = scope.split('-collection-')[0].split('-entity-')[0].replace(/[^a-z0-9-]/gi, '').toLowerCase();
  return `snap-${kind}:${family}`.slice(0, 32);
}

export function writeEncryptedNativeSnapshot(scope: string, userId: number, plaintext: string): Promise<boolean> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web' || clearingUsers.has(owner)) return Promise.resolve(false);
  const done = trackWork(snapshotWorkName('write', scope));
  const cacheKey = snapshotCacheKey(owner, scope);
  return withSnapshotOperation(scope, owner, async () => {
    // Re-writing identical content (a refresh that changed nothing) would redo a full
    // encrypt + verify for no durable change.
    try {
      const current = snapshotFile(scope, owner);
      if (cachedPlaintext(cacheKey, current) === plaintext) return true;
    } catch { /* fall through to a normal write */ }
    forgetCachedPlaintext(cacheKey);
    return performEncryptedNativeSnapshotWrite(scope, owner, plaintext);
  }).finally(done);
}

export function readEncryptedNativeSnapshot(scope: string, userId: number): Promise<string | null> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web' || clearingUsers.has(owner)) return Promise.resolve(null);
  const done = trackWork(snapshotWorkName('read', scope));
  return withSnapshotOperation(scope, owner, async () => {
    let stage = 'directory';
    let file: File | undefined;
    let backup: File | undefined;
    let legacy: File | undefined;
    const sizes: Record<string, number> = {};
    const report = (error: unknown) => recordSnapshotFailure(scope, stage, error, {
      sizes, files: { target: snapshotFileState(file), backup: snapshotFileState(backup), legacy: snapshotFileState(legacy) },
    });
    try {
      file = snapshotFile(scope, owner);
      backup = backupSnapshotFile(scope, owner);
      if (!file.exists) {
        legacy = legacySnapshotFile(scope, owner);
        if (legacy.exists) {
          stage = 'legacy-copy';
          await legacy.copy(file, { overwrite: true });
        }
      }
      if (!file.exists && !backup.exists) return null;
      const cacheKey = snapshotCacheKey(owner, scope);
      const fromCache = file.exists ? cachedPlaintext(cacheKey, file) : null;
      if (fromCache !== null) return fromCache;
      const plaintext = await decryptSnapshotFile(file, scope, owner, (value) => { stage = value; }, sizes);
      if (file.exists) rememberPlaintext(cacheKey, file, plaintext);
      stage = 'read-cleanup';
      try {
        if (backup.exists) backup.delete();
        if (legacy?.exists) legacy.delete();
      } catch (error) { await report(error); }
      return plaintext;
    } catch (error) {
      await report(error);
      if (backup?.exists && file) {
        try {
          const plaintext = await decryptSnapshotFile(backup, scope, owner, (value) => { stage = value; }, sizes, true);
          stage = 'backup-restore';
          try { await backup.copy(file, { overwrite: true }); }
          catch (restoreError) { await report(restoreError); }
          return plaintext;
        } catch (backupError) { await report(backupError); }
      }
      // A transient bridge/key/read error is not evidence that either generation is corrupt.
      return null;
    }
  }).finally(done);
}

export async function deleteEncryptedNativeSnapshot(scope: string, userId: number): Promise<void> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return;
  await withSnapshotOperation(scope, owner, async () => {
    forgetCachedPlaintext(snapshotCacheKey(owner, scope));
    const file = snapshotFile(scope, owner);
    if (file.exists) file.delete();
    const pending = pendingSnapshotFile(scope, owner);
    if (pending.exists) pending.delete();
    const backup = backupSnapshotFile(scope, owner);
    if (backup.exists) backup.delete();
    const legacyFile = legacySnapshotFile(scope, owner);
    if (legacyFile.exists) legacyFile.delete();
  });
}

export async function clearEncryptedNativeSnapshots(userId: number): Promise<void> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return;
  const existing = clearingUsers.get(owner);
  if (existing) return existing;
  const pending = (async () => {
    // Finish native copy/move/key operations before deleting their files and key.
    await Promise.allSettled([...snapshotWriteRequests.entries()]
      .filter(([key]) => key.startsWith(`${owner}:`)).map(([, operation]) => operation));
    const prefix = `snapshot-${owner}-`;
    for (const entry of snapshotDirectory().list()) {
      if (entry instanceof File && entry.name.startsWith(prefix) && entry.exists) entry.delete();
    }
    const legacyDirectory = legacySnapshotDirectory();
    if (legacyDirectory.exists) {
      for (const entry of legacyDirectory.list()) {
        if (entry instanceof File && entry.name.startsWith(prefix) && entry.exists) entry.delete();
      }
    }
    encryptionKeyRequests.delete(owner);
    for (const key of [...plaintextCache.keys()]) {
      if (key.startsWith(`${owner}:`)) forgetCachedPlaintext(key);
    }
    for (const key of snapshotWriteRequests.keys()) {
      if (key.startsWith(`${owner}:`)) snapshotWriteRequests.delete(key);
    }
    await SecureStore.deleteItemAsync(encryptionKeyName(owner)).catch(() => undefined);
  })().finally(() => { if (clearingUsers.get(owner) === pending) clearingUsers.delete(owner); });
  clearingUsers.set(owner, pending);
  return pending;
}
