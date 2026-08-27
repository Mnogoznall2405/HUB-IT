import { Directory, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { ChatAttachment } from '../api/types';
import { downloadAuthenticatedFile } from './authenticatedFileDownload';
import {
  resolveTrustedAttachmentUrl,
  resolveTrustedChatMediaUrl,
  sanitizeNativeFileName,
  selectCacheEvictions,
} from './filePolicy';

const ANDROID_VIEW_ACTION = 'android.intent.action.VIEW';
const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
const CACHE_DIRECTORY_NAME = 'hubit-attachments';
const chatMediaDownloads = new Map<string, Promise<File>>();

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
  const directory = new Directory(Paths.cache, CACHE_DIRECTORY_NAME);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function cacheEntries(directory: Directory) {
  return directory.list()
    .filter((entry): entry is File => entry instanceof File && entry.exists)
    .map((entry) => ({
      uri: entry.uri,
      size: Math.max(0, Number(entry.size || 0)),
      modifiedAt: Number(entry.lastModified || entry.creationTime || 0),
    }));
}

export function cleanupAttachmentCache(preserveUri?: string): void {
  const directory = attachmentCacheDirectory();
  const evictions = new Set(selectCacheEvictions(cacheEntries(directory), { preserveUri }));
  for (const entry of directory.list()) {
    if (entry instanceof File && evictions.has(entry.uri) && entry.exists) entry.delete();
  }
}

export function clearAttachmentCache(): void {
  const directory = attachmentCacheDirectory();
  for (const entry of directory.list()) entry.delete();
}

export function getAttachmentCacheSize(): number {
  return cacheEntries(attachmentCacheDirectory()).reduce((sum, entry) => sum + entry.size, 0);
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
  const destination = new File(attachmentCacheDirectory(), downloadFileName(attachment));
  const metadataSize = Math.max(0, Number(attachment.file_size || 0));
  if (destination.exists && destination.size > 0) {
    options.onProgress?.({ loaded: destination.size, total: destination.size, progress: 1 });
    cleanupAttachmentCache(destination.uri);
    return destination;
  }
  if (destination.exists) destination.delete();
  cleanupAttachmentCache();
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
    cleanupAttachmentCache(downloaded.uri);
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
  const destination = new File(attachmentCacheDirectory(), sanitizeNativeFileName(cacheName));
  if (destination.exists && !options.forceDownload) {
    cleanupAttachmentCache(destination.uri);
    return destination;
  }
  const pending = chatMediaDownloads.get(destination.uri);
  if (pending) return pending;
  const download = (async () => {
    if (destination.exists) destination.delete();
    cleanupAttachmentCache();
    try {
      const downloaded = await downloadAuthenticatedFile(sourceUrl, destination, {
        idempotent: true,
        signal: options.signal,
        preserveSessionOnAuthFailure: true,
      });
      cleanupAttachmentCache(downloaded.uri);
      return downloaded;
    } catch (error) {
      if (destination.exists) destination.delete();
      throw error;
    }
  })().finally(() => {
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
