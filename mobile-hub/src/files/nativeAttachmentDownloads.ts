import { Directory, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { ChatAttachment } from '../api/types';
import { getSessionUserId } from '../auth/tokenStore';
import { downloadAuthenticatedFile } from './authenticatedFileDownload';
import {
  resolveTrustedAttachmentUrl,
  resolveTrustedChatMediaUrl,
  sanitizeNativeFileName,
  selectCacheEvictions,
} from './filePolicy';

const ANDROID_VIEW_ACTION = 'android.intent.action.VIEW';
const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
// v2 invalidates files that older builds could leave partially downloaded.
const CACHE_DIRECTORY_NAME = 'hubit-attachments-v2';
const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const CACHE_CLEANUP_SIZE_DELTA_BYTES = 16 * 1024 * 1024;
const CHAT_MEDIA_MAX_PARALLEL_DOWNLOADS = 3;
const chatMediaDownloads = new Map<string, Promise<File>>();
const queuedChatMediaDownloads: Array<() => void> = [];
let lastAttachmentCacheCleanupAt = 0;
let attachmentCacheBytesAddedSinceCleanup = 0;
let activeChatMediaDownloads = 0;

export type NativeTransferProgress = {
  loaded: number;
  total: number | null;
  progress: number | null;
};

export function isDownloadedAttachmentSizeValid(
  downloadedSize: number,
  responseTotalBytes: number | null,
): boolean {
  const actual = Math.max(0, Number(downloadedSize || 0));
  const responseTotal = Math.max(0, Number(responseTotalBytes || 0));
  return responseTotal <= 0 || actual === responseTotal;
}

function attachmentCacheDirectory(): Directory {
  const directory = new Directory(Paths.document, CACHE_DIRECTORY_NAME);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

async function attachmentCacheFile(fileName: string): Promise<File> {
  const userId = Number(await getSessionUserId());
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Сессия истекла. Войдите снова');
  return new File(attachmentCacheDirectory(), `${userId}-${fileName}`);
}

function cacheEntries(files: File[]) {
  return files.map((entry) => ({
    uri: entry.uri,
    size: Math.max(0, Number(entry.size || 0)),
    modifiedAt: Number(entry.lastModified || entry.creationTime || 0),
  }));
}

export function cleanupAttachmentCache(preserveUri?: string): void {
  const directory = attachmentCacheDirectory();
  const files = directory.list()
    .filter((entry): entry is File => entry instanceof File && entry.exists);
  const evictions = new Set(selectCacheEvictions(cacheEntries(files), {
    preserveUri,
    maxAgeMs: Number.POSITIVE_INFINITY,
  }));
  for (const entry of files) {
    if (evictions.has(entry.uri) && entry.exists) entry.delete();
  }
  lastAttachmentCacheCleanupAt = Date.now();
  attachmentCacheBytesAddedSinceCleanup = 0;
}

function maintainAttachmentCache(preserveUri?: string, addedBytes = 0): void {
  attachmentCacheBytesAddedSinceCleanup = Math.min(
    Number.MAX_SAFE_INTEGER,
    attachmentCacheBytesAddedSinceCleanup + Math.max(0, Number(addedBytes || 0)),
  );
  const now = Date.now();
  const intervalElapsed = lastAttachmentCacheCleanupAt <= 0
    || now < lastAttachmentCacheCleanupAt
    || now - lastAttachmentCacheCleanupAt >= CACHE_CLEANUP_INTERVAL_MS;
  if (!intervalElapsed && attachmentCacheBytesAddedSinceCleanup < CACHE_CLEANUP_SIZE_DELTA_BYTES) return;
  try {
    cleanupAttachmentCache(preserveUri);
  } catch {
    // Cache maintenance must never block an otherwise valid media hit/download.
    lastAttachmentCacheCleanupAt = now;
    attachmentCacheBytesAddedSinceCleanup = 0;
  }
}

function chatMediaAbortError(): Error {
  return Object.assign(new Error('Загрузка медиа отменена'), { name: 'AbortError' });
}

function drainChatMediaDownloadQueue(): void {
  while (
    activeChatMediaDownloads < CHAT_MEDIA_MAX_PARALLEL_DOWNLOADS
    && queuedChatMediaDownloads.length > 0
  ) {
    queuedChatMediaDownloads.shift()?.();
  }
}

function withChatMediaDownloadSlot<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let queued = true;
    const start = () => {
      if (!queued) return;
      queued = false;
      signal?.removeEventListener('abort', cancelQueued);
      if (signal?.aborted) {
        reject(chatMediaAbortError());
        return;
      }
      activeChatMediaDownloads += 1;
      void operation().then(resolve, reject).finally(() => {
        activeChatMediaDownloads = Math.max(0, activeChatMediaDownloads - 1);
        drainChatMediaDownloadQueue();
      });
    };
    const cancelQueued = () => {
      if (!queued) return;
      queued = false;
      const index = queuedChatMediaDownloads.indexOf(start);
      if (index >= 0) queuedChatMediaDownloads.splice(index, 1);
      reject(chatMediaAbortError());
    };
    if (signal?.aborted) {
      queued = false;
      reject(chatMediaAbortError());
      return;
    }
    signal?.addEventListener('abort', cancelQueued, { once: true });
    queuedChatMediaDownloads.push(start);
    drainChatMediaDownloadQueue();
  });
}

export function clearAttachmentCache(): void {
  const directory = attachmentCacheDirectory();
  for (const entry of directory.list()) entry.delete();
  lastAttachmentCacheCleanupAt = Date.now();
  attachmentCacheBytesAddedSinceCleanup = 0;
}

export function getAttachmentCacheSize(): number {
  const directory = attachmentCacheDirectory();
  const files = directory.list()
    .filter((entry): entry is File => entry instanceof File && entry.exists);
  return cacheEntries(files).reduce((sum, entry) => sum + entry.size, 0);
}

function downloadFileName(attachment: ChatAttachment): string {
  const safeName = sanitizeNativeFileName(attachment.file_name || 'hubit-file');
  const safeId = String(attachment.id || 'file').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return `${safeId}-${safeName}`;
}

export async function downloadChatAttachment(
  attachment: ChatAttachment,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: NativeTransferProgress) => void;
  } = {},
): Promise<File> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Нативное скачивание доступно только в приложении');
  }
  const sourceUrl = resolveTrustedAttachmentUrl(
    attachment.download_url || attachment.url || attachment.original_url,
  );
  const destination = await attachmentCacheFile(downloadFileName(attachment));
  const metadataSize = Math.max(0, Number(attachment.file_size || 0));
  if (destination.exists && destination.size > 0) {
    options.onProgress?.({ loaded: destination.size, total: destination.size, progress: 1 });
    maintainAttachmentCache(destination.uri);
    return destination;
  }
  if (destination.exists) destination.delete();
  maintainAttachmentCache();
  let responseTotalBytes: number | null = null;
  try {
    const downloaded = await downloadAuthenticatedFile(sourceUrl, destination, {
      idempotent: true,
      signal: options.signal,
      preserveSessionOnAuthFailure: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (totalBytes > 0) responseTotalBytes = totalBytes;
        const total = totalBytes > 0 ? totalBytes : metadataSize || null;
        options.onProgress?.({
          loaded: bytesWritten,
          total,
          progress: total ? Math.max(0, Math.min(1, bytesWritten / total)) : null,
        });
      },
    });
    if (!isDownloadedAttachmentSizeValid(downloaded.size, responseTotalBytes)) {
      if (downloaded.exists) downloaded.delete();
      throw new Error('Скачанный файл имеет неверный размер');
    }
    maintainAttachmentCache(downloaded.uri, downloaded.size);
    return downloaded;
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}

export async function downloadTrustedChatMedia(
  url: string,
  cacheName: string,
  options: { forceDownload?: boolean; signal?: AbortSignal } = {},
): Promise<File> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Нативное скачивание доступно только в приложении');
  }
  const sourceUrl = resolveTrustedChatMediaUrl(url);
  const destination = await attachmentCacheFile(sanitizeNativeFileName(cacheName));
  if (destination.exists && !options.forceDownload) {
    maintainAttachmentCache(destination.uri);
    return destination;
  }
  const pending = chatMediaDownloads.get(destination.uri);
  if (pending) return pending;
  const download = withChatMediaDownloadSlot(async () => {
    const hadExisting = destination.exists && destination.size > 0;
    if (!hadExisting) {
      if (destination.exists) destination.delete();
      maintainAttachmentCache();
      try {
        const downloaded = await downloadAuthenticatedFile(sourceUrl, destination, {
          idempotent: true,
          signal: options.signal,
          preserveSessionOnAuthFailure: true,
        });
        maintainAttachmentCache(downloaded.uri, downloaded.size);
        return downloaded;
      } catch (error) {
        if (destination.exists) destination.delete();
        throw error;
      }
    }

    // Refresh without deleting the working original until the replacement is verified.
    const staging = await attachmentCacheFile(`pending-${sanitizeNativeFileName(cacheName)}`);
    if (staging.exists) staging.delete();
    try {
      const downloaded = await downloadAuthenticatedFile(sourceUrl, staging, {
        idempotent: true,
        signal: options.signal,
        preserveSessionOnAuthFailure: true,
      });
      if (typeof downloaded.move === 'function') {
        await downloaded.move(destination, { overwrite: true });
      } else if (typeof downloaded.copy === 'function') {
        await downloaded.copy(destination, { overwrite: true });
        if (staging.exists) staging.delete();
      } else {
        throw new Error('Не удалось заменить локальную копию вложения');
      }
      maintainAttachmentCache(destination.uri, destination.size);
      return destination;
    } catch (error) {
      if (staging.exists) staging.delete();
      if (destination.exists && destination.size > 0) {
        maintainAttachmentCache(destination.uri, destination.size);
      }
      throw error;
    }
  }, options.signal).finally(() => {
    chatMediaDownloads.delete(destination.uri);
  });
  chatMediaDownloads.set(destination.uri, download);
  return download;
}

export async function openNativeFile(file: File, mimeType?: string | null): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Открытие файла поддерживается только на Android');
  await IntentLauncher.startActivityAsync(ANDROID_VIEW_ACTION, {
    data: file.contentUri,
    type: String(mimeType || file.type || 'application/octet-stream'),
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}

export async function shareNativeFile(
  file: File,
  fileName: string,
  mimeType?: string | null,
): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Системное меню «Поделиться» недоступно');
  await Sharing.shareAsync(file.uri, {
    dialogTitle: `Поделиться: ${sanitizeNativeFileName(fileName)}`,
    mimeType: String(mimeType || file.type || 'application/octet-stream'),
  });
}
