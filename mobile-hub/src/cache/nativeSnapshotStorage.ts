import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SNAPSHOT_DIRECTORY_NAME = 'hubit-native-snapshots';
const KEY_PREFIX = 'hubit_native_snapshot_aes_key_v2';
export const MAX_NATIVE_SNAPSHOT_BYTES = 2 * 1024 * 1024;
export const MAX_NATIVE_ADDRESS_BOOK_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const encryptionKeyRequests = new Map<number, Promise<Crypto.AESEncryptionKey>>();
const snapshotWriteRequests = new Map<string, Promise<boolean>>();

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

async function performEncryptedNativeSnapshotWrite(
  scope: string,
  userId: number,
  plaintext: string,
): Promise<boolean> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return false;
  const bytes = new TextEncoder().encode(plaintext);
  if (bytes.byteLength > maxSnapshotBytes(scope)) return false;
  const key = await getOrCreateEncryptionKey(owner);
  const sealed = await Crypto.aesEncryptAsync(bytes, key, {
    additionalData: additionalData(scope, owner),
  });
  const encoded = await sealed.combined('base64');
  const target = snapshotFile(scope, owner);
  const pending = pendingSnapshotFile(scope, owner);
  const backup = backupSnapshotFile(scope, owner);
  try {
    if (pending.exists) pending.delete();
    pending.write(encoded);
    if (!pending.exists || Number(pending.size || 0) <= 0 || String(await pending.text()).trim() !== encoded) {
      throw new Error('Snapshot staging verification failed');
    }
    if (target.exists) await target.copy(backup, { overwrite: true });
    await pending.move(target, { overwrite: true });
    if (backup.exists) backup.delete();
    return true;
  } catch {
    if (pending.exists) pending.delete();
    if (!target.exists && backup.exists) {
      await backup.copy(target, { overwrite: true }).catch(() => undefined);
    }
    return false;
  }
}

export function writeEncryptedNativeSnapshot(
  scope: string,
  userId: number,
  plaintext: string,
): Promise<boolean> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return Promise.resolve(false);
  const writeKey = `${owner}:${safeScope(scope)}`;
  const previous = snapshotWriteRequests.get(writeKey) || Promise.resolve(false);
  let request: Promise<boolean>;
  request = previous.catch(() => false)
    .then(() => performEncryptedNativeSnapshotWrite(scope, owner, plaintext))
    .finally(() => {
      if (snapshotWriteRequests.get(writeKey) === request) snapshotWriteRequests.delete(writeKey);
    });
  snapshotWriteRequests.set(writeKey, request);
  return request;
}

export async function readEncryptedNativeSnapshot(scope: string, userId: number): Promise<string | null> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return null;
  const file = snapshotFile(scope, owner);
  const backup = backupSnapshotFile(scope, owner);
  if (!file.exists) {
    const legacyFile = legacySnapshotFile(scope, owner);
    if (legacyFile.exists) {
      try {
        file.write(await legacyFile.text());
        legacyFile.delete();
      } catch {
        // A legacy cache snapshot is best-effort; continue as a normal cache miss.
      }
    }
  }
  if (!file.exists && backup.exists) {
    await backup.copy(file, { overwrite: true }).catch(() => undefined);
  }
  if (!file.exists) return null;
  try {
    const encoded = String(await file.text()).trim();
    if (!encoded) throw new Error('Empty encrypted snapshot');
    const key = await getOrCreateEncryptionKey(owner);
    const sealed = Crypto.AESSealedData.fromCombined(encoded);
    const decrypted = await Crypto.aesDecryptAsync(sealed, key, {
      additionalData: additionalData(scope, owner),
    });
    const plaintext = new TextDecoder().decode(decrypted);
    if (backup.exists) backup.delete();
    return plaintext;
  } catch {
    if (backup.exists) {
      try {
        const encoded = String(await backup.text()).trim();
        if (!encoded) throw new Error('Empty encrypted backup');
        const key = await getOrCreateEncryptionKey(owner);
        const sealed = Crypto.AESSealedData.fromCombined(encoded);
        const decrypted = await Crypto.aesDecryptAsync(sealed, key, {
          additionalData: additionalData(scope, owner),
        });
        await backup.copy(file, { overwrite: true });
        backup.delete();
        return new TextDecoder().decode(decrypted);
      } catch {
        // Both generations are unreadable and can be discarded below.
      }
    }
    if (file.exists) file.delete();
    if (backup.exists) backup.delete();
    return null;
  }
}

export async function deleteEncryptedNativeSnapshot(scope: string, userId: number): Promise<void> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return;
  const file = snapshotFile(scope, owner);
  if (file.exists) file.delete();
  const pending = pendingSnapshotFile(scope, owner);
  if (pending.exists) pending.delete();
  const backup = backupSnapshotFile(scope, owner);
  if (backup.exists) backup.delete();
  const legacyFile = legacySnapshotFile(scope, owner);
  if (legacyFile.exists) legacyFile.delete();
}

export async function clearEncryptedNativeSnapshots(userId: number): Promise<void> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return;
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
  for (const key of snapshotWriteRequests.keys()) {
    if (key.startsWith(`${owner}:`)) snapshotWriteRequests.delete(key);
  }
  await SecureStore.deleteItemAsync(encryptionKeyName(owner)).catch(() => undefined);
}
