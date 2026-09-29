import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import type { KbAttachment } from '../api/kbApi';
import { API_V1_BASE } from '../api/config';
import { getSessionUserId } from '../auth/tokenStore';
import { downloadAuthenticatedFile } from '../files/authenticatedFileDownload';
import { sanitizeNativeFileName } from '../files/filePolicy';

const CACHE_DIRECTORY_NAME = 'hubit-kb';

function kbCacheDirectory(): Directory {
  const directory = new Directory(Paths.document, CACHE_DIRECTORY_NAME);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

async function kbCacheFile(fileName: string): Promise<File> {
  const userId = Number(await getSessionUserId());
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Сессия истекла. Войдите снова');
  return new File(kbCacheDirectory(), `${userId}-${fileName}`);
}

export function clearNativeKbCache(): void {
  const directory = kbCacheDirectory();
  for (const entry of directory.list()) entry.delete();
}

function cacheKeyFor(articleId: string, attachmentId: string): string {
  return `${articleId}-${attachmentId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180);
}

export async function downloadNativeKbAttachment(
  articleId: string,
  attachment: KbAttachment,
  options: { signal?: AbortSignal } = {},
): Promise<File> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Нативное скачивание доступно только в приложении');
  }
  const safeArticleId = String(articleId || '').trim();
  const safeAttachmentId = String(attachment.id || '').trim();
  if (!safeArticleId || !safeAttachmentId) throw new Error('Не выбран файл статьи');
  const safeName = sanitizeNativeFileName(attachment.fileName || 'file.bin');
  const destination = await kbCacheFile(`${cacheKeyFor(safeArticleId, safeAttachmentId)}-${safeName}`);
  const expectedSize = Math.max(0, Number(attachment.size || 0));
  if (destination.exists && (!expectedSize || destination.size === expectedSize)) return destination;
  if (destination.exists) destination.delete();
  const sourceUrl = `${API_V1_BASE}/kb/articles/${encodeURIComponent(safeArticleId)}/attachments/${encodeURIComponent(safeAttachmentId)}`;
  try {
    const downloaded = await downloadAuthenticatedFile(sourceUrl, destination, {
      idempotent: true,
      signal: options.signal,
    });
    if (expectedSize && downloaded.size !== expectedSize) {
      if (downloaded.exists) downloaded.delete();
      throw new Error('Скачанный файл имеет неверный размер');
    }
    return downloaded;
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}
