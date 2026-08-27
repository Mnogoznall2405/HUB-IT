import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import {
  buildFeedAttachmentUrl,
  buildFeedCommentAttachmentUrl,
  type FeedUploadFile,
} from '../api/feedApi';
import type { FeedAttachment } from './feedFormat';
import { downloadAuthenticatedFile } from '../files/authenticatedFileDownload';
import { sanitizeNativeFileName, selectCacheEvictions } from '../files/filePolicy';

export const FEED_FILE_MAX_BYTES = 20 * 1024 * 1024;
const CACHE_DIRECTORY_NAME = 'hubit-feed-files';
const ANDROID_VIEW_ACTION = 'android.intent.action.VIEW';
const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;

function createFeedUploadId(): string {
  return Crypto.randomUUID?.()
    || `feed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function assertNativeRuntime(): void {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Работа с файлами ленты доступна только в приложении');
  }
}

function feedCacheDirectory(): Directory {
  const directory = new Directory(Paths.cache, CACHE_DIRECTORY_NAME);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function cleanupFeedCache(preserveUri?: string): void {
  const directory = feedCacheDirectory();
  const files = directory.list().filter((entry): entry is File => entry instanceof File && entry.exists);
  const evictions = new Set(selectCacheEvictions(files.map((entry) => ({
    uri: entry.uri,
    size: Math.max(0, Number(entry.size || 0)),
    modifiedAt: Number(entry.lastModified || entry.creationTime || 0),
  })), { preserveUri }));
  files.forEach((entry) => {
    if (evictions.has(entry.uri) && entry.exists) entry.delete();
  });
}

export async function pickNativeFeedFiles(): Promise<FeedUploadFile[]> {
  assertNativeRuntime();
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
    type: '*/*',
  });
  if (result.canceled || !result.assets?.length) return [];
  return result.assets.map((asset) => {
    const file = new File(asset.uri);
    const name = sanitizeNativeFileName(asset.name || file.name || 'file.bin');
    const size = Math.max(0, Number(asset.size || file.size || 0));
    if (!file.exists || size <= 0) throw new Error(`Файл «${name}» пустой или недоступен`);
    if (size > FEED_FILE_MAX_BYTES) throw new Error(`Файл «${name}» превышает 20 МБ`);
    return {
      uri: asset.uri,
      name,
      mimeType: String(asset.mimeType || file.type || 'application/octet-stream'),
      size,
      uploadId: createFeedUploadId(),
    };
  });
}

export async function downloadNativeFeedAttachment(
  postId: string,
  attachment: FeedAttachment,
  commentId?: string,
): Promise<File> {
  assertNativeRuntime();
  const attachmentId = String(attachment.id || '').trim();
  if (!postId || !attachmentId) throw new Error('Не выбран файл публикации');
  const sourceUrl = commentId
    ? buildFeedCommentAttachmentUrl(postId, commentId, attachmentId)
    : buildFeedAttachmentUrl(postId, attachmentId);
  const safeName = sanitizeNativeFileName(attachment.file_name || 'file.bin');
  const cacheKey = `${postId}-${commentId || 'post'}-${attachmentId}`
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 160);
  const destination = new File(feedCacheDirectory(), `${cacheKey}-${safeName}`);
  const expectedSize = Math.max(0, Number(attachment.file_size || 0));
  if (destination.exists && (!expectedSize || destination.size === expectedSize)) {
    cleanupFeedCache(destination.uri);
    return destination;
  }
  if (destination.exists) destination.delete();
  cleanupFeedCache();
  try {
    const downloaded = await downloadAuthenticatedFile(sourceUrl, destination, {
      idempotent: true,
    });
    if (expectedSize && downloaded.size !== expectedSize) {
      if (downloaded.exists) downloaded.delete();
      throw new Error('Скачанный файл имеет неверный размер');
    }
    cleanupFeedCache(downloaded.uri);
    return downloaded;
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}

export async function openNativeFeedFile(file: File, mimeType?: string | null): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Открытие файла поддерживается только на Android');
  await IntentLauncher.startActivityAsync(ANDROID_VIEW_ACTION, {
    data: file.contentUri,
    type: String(mimeType || file.type || 'application/octet-stream'),
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}
