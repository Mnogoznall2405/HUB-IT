import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import type { MyFileRecord } from '../api/myFilesApi';
import {
  deleteEncryptedNativeSnapshot,
  readEncryptedNativeSnapshot,
  writeEncryptedNativeSnapshot,
} from '../cache/nativeSnapshotStorage';
import { sanitizeNativeFileName } from '../files/filePolicy';

const OFFLINE_DIRECTORY_NAME = 'hubit-my-files-offline';
const OFFLINE_MANIFEST_SCOPE = 'my-files-offline-manifest';
const OFFLINE_DISK_RESERVE_BYTES = 128 * 1024 * 1024;
const MAX_OFFLINE_ENTRIES = 500;

type OfflineFileEntry = {
  fileId: string;
  localName: string;
  fileName: string;
  mimeType: string;
  size: number;
  serverUpdatedAt: string;
  expiresAt: string;
  storedAt: number;
};

type OfflineFileManifest = {
  version: 1;
  userId: number;
  entries: OfflineFileEntry[];
};

const writeLocks = new Map<number, Promise<void>>();

function normalizedUserId(userId: number): number | null {
  const value = Number(userId || 0);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function expectedFileSize(item: MyFileRecord): number {
  return Math.max(0, Number(
    item.storage_mode === 'optimized_media' ? item.stored_size_bytes : item.original_size_bytes,
  ));
}

function fileExpiryMs(value: string | null | undefined): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeFileId(fileId: string): string {
  const normalized = String(fileId || '').trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 160);
  if (!normalized) throw new Error('Не выбран файл для офлайн-доступа');
  return normalized;
}

function stableFileIdHash(fileId: string): string {
  let hash = 2166136261;
  for (const character of String(fileId || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

function offlineLocalName(fileId: string, fileName: string): string {
  const safeName = sanitizeNativeFileName(fileName);
  const dot = safeName.lastIndexOf('.');
  const extension = dot > 0
    ? `.${safeName.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').slice(0, 16)}`
    : '';
  return `${safeFileId(fileId).slice(0, 96)}-${stableFileIdHash(fileId)}${extension === '.' ? '' : extension}`;
}

function offlineRootDirectory(): Directory {
  return new Directory(Paths.document, OFFLINE_DIRECTORY_NAME);
}

function offlineUserDirectory(userId: number, create = false): Directory {
  const directory = new Directory(offlineRootDirectory(), `user-${userId}`);
  if (create) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function offlineFile(userId: number, localName: string): File {
  return new File(offlineUserDirectory(userId), localName);
}

function emptyManifest(userId: number): OfflineFileManifest {
  return { version: 1, userId, entries: [] };
}

function normalizeEntry(value: unknown): OfflineFileEntry | null {
  const raw = value as Partial<OfflineFileEntry>;
  const fileId = String(raw?.fileId || '').trim();
  const localName = String(raw?.localName || '').trim();
  const fileName = String(raw?.fileName || '').trim();
  const size = Math.max(0, Number(raw?.size || 0));
  const storedAt = Number(raw?.storedAt || 0);
  if (
    !fileId
    || !localName
    || localName.includes('/')
    || localName.includes('\\')
    || !fileName
    || !Number.isFinite(size)
    || size <= 0
    || !Number.isFinite(storedAt)
    || storedAt <= 0
  ) return null;
  return {
    fileId,
    localName,
    fileName,
    mimeType: String(raw.mimeType || 'application/octet-stream'),
    size,
    serverUpdatedAt: String(raw.serverUpdatedAt || ''),
    expiresAt: String(raw.expiresAt || ''),
    storedAt,
  };
}

async function readManifest(userId: number): Promise<OfflineFileManifest> {
  try {
    const raw = await readEncryptedNativeSnapshot(OFFLINE_MANIFEST_SCOPE, userId);
    if (!raw) return emptyManifest(userId);
    const parsed = JSON.parse(raw) as Partial<OfflineFileManifest>;
    if (parsed.version !== 1 || parsed.userId !== userId || !Array.isArray(parsed.entries)) {
      await deleteEncryptedNativeSnapshot(OFFLINE_MANIFEST_SCOPE, userId).catch(() => undefined);
      return emptyManifest(userId);
    }
    const entries: OfflineFileEntry[] = [];
    const ids = new Set<string>();
    for (const value of parsed.entries) {
      const entry = normalizeEntry(value);
      if (!entry || ids.has(entry.fileId)) continue;
      ids.add(entry.fileId);
      entries.push(entry);
    }
    return { version: 1, userId, entries: entries.slice(0, MAX_OFFLINE_ENTRIES) };
  } catch {
    await deleteEncryptedNativeSnapshot(OFFLINE_MANIFEST_SCOPE, userId).catch(() => undefined);
    return emptyManifest(userId);
  }
}

async function writeManifest(manifest: OfflineFileManifest): Promise<void> {
  if (!manifest.entries.length) {
    await deleteEncryptedNativeSnapshot(OFFLINE_MANIFEST_SCOPE, manifest.userId);
    return;
  }
  const stored = await writeEncryptedNativeSnapshot(
    OFFLINE_MANIFEST_SCOPE,
    manifest.userId,
    JSON.stringify(manifest),
  );
  if (!stored) throw new Error('Не удалось сохранить офлайн-копию файла');
}

async function withWriteLock<T>(userId: number, operation: () => Promise<T>): Promise<T> {
  const previous = writeLocks.get(userId) || Promise.resolve();
  let resolveResult: (value: T | PromiseLike<T>) => void;
  let rejectResult: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const current = previous.catch(() => undefined).then(async () => {
    try {
      resolveResult(await operation());
    } catch (error) {
      rejectResult(error);
    }
  }).finally(() => {
    if (writeLocks.get(userId) === current) writeLocks.delete(userId);
  });
  writeLocks.set(userId, current);
  return result;
}

function entryMatchesItem(entry: OfflineFileEntry, item: MyFileRecord): boolean {
  const expectedSize = expectedFileSize(item);
  const expiresAt = fileExpiryMs(entry.expiresAt);
  return entry.fileId === item.id
    && (!expectedSize || entry.size === expectedSize)
    && (!expiresAt || expiresAt > Date.now());
}

function entryFileIsValid(userId: number, entry: OfflineFileEntry): boolean {
  const file = offlineFile(userId, entry.localName);
  return file.exists && file.size === entry.size;
}

export async function getNativeMyFilesOfflineFile(
  userId: number,
  item: MyFileRecord,
): Promise<File | null> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return null;
  const manifest = await readManifest(owner);
  const entry = manifest.entries.find((candidate) => candidate.fileId === item.id);
  if (!entry) return null;
  if (entryMatchesItem(entry, item) && entryFileIsValid(owner, entry)) {
    return offlineFile(owner, entry.localName);
  }
  await removeNativeMyFileOffline(owner, item.id);
  return null;
}

export async function getNativeMyFilesOfflineIds(
  userId: number,
  items: readonly MyFileRecord[],
): Promise<Set<string>> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return new Set();
  return withWriteLock(owner, async () => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const manifest = await readManifest(owner);
    const valid: OfflineFileEntry[] = [];
    const visibleIds = new Set<string>();
    for (const entry of manifest.entries) {
      const item = byId.get(entry.fileId);
      const isValid = item
        ? entryMatchesItem(entry, item) && entryFileIsValid(owner, entry)
        : (!fileExpiryMs(entry.expiresAt) || fileExpiryMs(entry.expiresAt) > Date.now())
          && entryFileIsValid(owner, entry);
      if (isValid) {
        valid.push(entry);
        if (item) visibleIds.add(entry.fileId);
      } else {
        const file = offlineFile(owner, entry.localName);
        if (file.exists) file.delete();
      }
    }
    if (valid.length !== manifest.entries.length) {
      await writeManifest({ ...manifest, entries: valid });
    }
    return visibleIds;
  });
}

export async function pinNativeMyFileOffline(
  userId: number,
  item: MyFileRecord,
  source: File,
): Promise<File> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') throw new Error('Офлайн-копия доступна только в приложении');
  if (!source.exists || source.size <= 0) throw new Error('Файл пустой или недоступен');
  const expectedSize = expectedFileSize(item);
  if (expectedSize && source.size !== expectedSize) {
    throw new Error('Скачанный файл имеет неверный размер');
  }
  const expiresAtMs = fileExpiryMs(item.expires_at);
  if (expiresAtMs && expiresAtMs <= Date.now()) throw new Error('Срок хранения файла истёк');

  return withWriteLock(owner, async () => {
    const manifest = await readManifest(owner);
    const existing = manifest.entries.find((entry) => entry.fileId === item.id);
    if (existing && entryMatchesItem(existing, item) && entryFileIsValid(owner, existing)) {
      return offlineFile(owner, existing.localName);
    }
    if (!existing && manifest.entries.length >= MAX_OFFLINE_ENTRIES) {
      throw new Error('Достигнут лимит офлайн-файлов. Удалите ненужные копии');
    }
    const available = Number(Paths.availableDiskSpace || 0);
    if (Number.isFinite(available) && available > 0 && source.size + OFFLINE_DISK_RESERVE_BYTES > available) {
      throw new Error('Недостаточно свободного места для офлайн-копии');
    }

    const directory = offlineUserDirectory(owner, true);
    const visibleFileName = sanitizeNativeFileName(item.download_file_name || item.original_file_name || 'file.bin');
    const localName = offlineLocalName(item.id, visibleFileName);
    const destination = new File(directory, localName);
    const temporary = new File(directory, `${localName}.partial`);
    if (temporary.exists) temporary.delete();
    try {
      await source.copy(temporary, { overwrite: true });
      if (!temporary.exists || temporary.size !== source.size) {
        throw new Error('Офлайн-копия файла повреждена');
      }
      await temporary.move(destination, { overwrite: true });
      const entry: OfflineFileEntry = {
        fileId: item.id,
        localName,
        fileName: visibleFileName,
        mimeType: String(item.download_mime_type || item.mime_type || 'application/octet-stream'),
        size: source.size,
        serverUpdatedAt: String(item.updated_at || ''),
        expiresAt: String(item.expires_at || ''),
        storedAt: Date.now(),
      };
      await writeManifest({
        version: 1,
        userId: owner,
        entries: [entry, ...manifest.entries.filter((candidate) => candidate.fileId !== item.id)],
      });
      if (existing && existing.localName !== localName) {
        const previous = offlineFile(owner, existing.localName);
        if (previous.exists) previous.delete();
      }
      return destination;
    } catch (error) {
      if (temporary.exists) temporary.delete();
      if (destination.exists) destination.delete();
      throw error;
    }
  });
}

export async function removeNativeMyFileOffline(userId: number, fileId: string): Promise<void> {
  const owner = normalizedUserId(userId);
  const normalizedFileId = String(fileId || '').trim();
  if (!owner || !normalizedFileId || Platform.OS === 'web') return;
  await withWriteLock(owner, async () => {
    const manifest = await readManifest(owner);
    const removed = manifest.entries.filter((entry) => entry.fileId === normalizedFileId);
    for (const entry of removed) {
      const file = offlineFile(owner, entry.localName);
      if (file.exists) file.delete();
    }
    await writeManifest({
      ...manifest,
      entries: manifest.entries.filter((entry) => entry.fileId !== normalizedFileId),
    });
  });
}

export async function clearNativeMyFilesOffline(userId: number): Promise<void> {
  const owner = normalizedUserId(userId);
  if (!owner || Platform.OS === 'web') return;
  await withWriteLock(owner, async () => {
    const directory = offlineUserDirectory(owner);
    if (directory.exists) directory.delete();
    await deleteEncryptedNativeSnapshot(OFFLINE_MANIFEST_SCOPE, owner);
  });
}
