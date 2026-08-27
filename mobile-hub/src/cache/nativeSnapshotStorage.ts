import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CACHE_DIRECTORY_NAME = 'hubit-native-snapshots';
const KEY_PREFIX = 'hubit_native_snapshot_aes_key_v2';
export const MAX_NATIVE_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const encryptionKeyRequests = new Map<number, Promise<Crypto.AESEncryptionKey>>();

function normalizedUserId(userId: number): number | null {
  const value = Number(userId || 0);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function snapshotDirectory(): Directory {
  const directory = new Directory(Paths.cache, CACHE_DIRECTORY_NAME);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function safeScope(scope: string): string {
  return String(scope || '').trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}

function snapshotFile(scope: string, userId: number): File {
  return new File(snapshotDirectory(), `snapshot-${userId}-${safeScope(scope)}.aes`);
}

function encryptionKeyName(userId: number): string {
  return `${KEY_PREFIX}_${userId}`;
}

function additionalData(scope: string, userId: number): Uint8Array {
  return new TextEncoder().encode(`hubit-native-snapshot:v2:${userId}:${safeScope(scope)}`);
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

export async function writeEncryptedNativeSnapshot(
  scope: string,
  userId: number,
  plaintext: string,
): Promise<boolean> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return false;
  const bytes = new TextEncoder().encode(plaintext);
  if (bytes.byteLength > MAX_NATIVE_SNAPSHOT_BYTES) return false;
  const key = await getOrCreateEncryptionKey(owner);
  const sealed = await Crypto.aesEncryptAsync(bytes, key, {
    additionalData: additionalData(scope, owner),
  });
  const encoded = await sealed.combined('base64');
  snapshotFile(scope, owner).write(encoded);
  return true;
}

export async function readEncryptedNativeSnapshot(scope: string, userId: number): Promise<string | null> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return null;
  const file = snapshotFile(scope, owner);
  if (!file.exists) return null;
  try {
    const encoded = String(await file.text()).trim();
    if (!encoded) throw new Error('Empty encrypted snapshot');
    const key = await getOrCreateEncryptionKey(owner);
    const sealed = Crypto.AESSealedData.fromCombined(encoded);
    const decrypted = await Crypto.aesDecryptAsync(sealed, key, {
      additionalData: additionalData(scope, owner),
    });
    return new TextDecoder().decode(decrypted);
  } catch {
    if (file.exists) file.delete();
    return null;
  }
}

export async function deleteEncryptedNativeSnapshot(scope: string, userId: number): Promise<void> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return;
  const file = snapshotFile(scope, owner);
  if (file.exists) file.delete();
}

export async function clearEncryptedNativeSnapshots(userId: number): Promise<void> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return;
  const prefix = `snapshot-${owner}-`;
  for (const entry of snapshotDirectory().list()) {
    if (entry instanceof File && entry.name.startsWith(prefix) && entry.exists) entry.delete();
  }
  encryptionKeyRequests.delete(owner);
  await SecureStore.deleteItemAsync(encryptionKeyName(owner)).catch(() => undefined);
}
