import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { API_V1_BASE } from '../api/config';
import {
  taskAnalyticsPath,
  type TaskAnalyticsParams,
  type TaskAttachment,
  type TaskUploadFile,
} from '../api/taskApi';
import { getSessionUserId } from '../auth/tokenStore';
import { downloadAuthenticatedFile } from '../files/authenticatedFileDownload';
import { sanitizeNativeFileName } from '../files/filePolicy';

export const TASK_FILE_MAX_BYTES = 20 * 1024 * 1024;
const CACHE_DIRECTORY_NAME = 'hubit-task-files';
const TASK_ANALYTICS_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function assertNativeRuntime(): void {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Работа с файлами задачи доступна только в приложении');
  }
}

function taskCacheDirectory(): Directory {
  const directory = new Directory(Paths.cache, CACHE_DIRECTORY_NAME);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export function clearNativeTaskFileCache(): void {
  for (const entry of taskCacheDirectory().list()) entry.delete();
}

export function getNativeTaskFileCacheSize(): number {
  return taskCacheDirectory().list().reduce((total, entry) => (
    entry instanceof File && entry.exists ? total + Math.max(0, Number(entry.size || 0)) : total
  ), 0);
}

async function taskCacheFile(fileName: string): Promise<File> {
  const userId = Number(await getSessionUserId());
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Сессия истекла. Войдите снова');
  return new File(taskCacheDirectory(), `${userId}-${fileName}`);
}

export function taskAttachmentPath(taskId: string, attachmentId: string): string {
  const safeTaskId = String(taskId || '').trim();
  const safeAttachmentId = String(attachmentId || '').trim();
  if (!safeTaskId || !safeAttachmentId) throw new Error('Не выбран файл задачи');
  return `/hub/tasks/${encodeURIComponent(safeTaskId)}/attachments/${encodeURIComponent(safeAttachmentId)}/file`;
}

export async function pickNativeTaskFile(): Promise<TaskUploadFile | null> {
  assertNativeRuntime();
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
    type: '*/*',
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  const name = sanitizeNativeFileName(asset.name || file.name || 'file.bin');
  const size = Math.max(0, Number(asset.size || file.size || 0));
  if (!file.exists || size <= 0) throw new Error(`Файл «${name}» пустой или недоступен`);
  if (size > TASK_FILE_MAX_BYTES) throw new Error(`Файл «${name}» превышает 20 МБ`);
  return {
    uri: asset.uri,
    name,
    mimeType: String(asset.mimeType || file.type || 'application/octet-stream'),
    size,
  };
}

export async function downloadNativeTaskAttachment(
  taskId: string,
  attachment: TaskAttachment,
): Promise<File> {
  assertNativeRuntime();
  const attachmentId = String(attachment.id || '').trim();
  const sourceUrl = `${API_V1_BASE}${taskAttachmentPath(taskId, attachmentId)}`;
  const safeName = sanitizeNativeFileName(attachment.file_name || 'file.bin');
  const cacheKey = `${taskId}-${attachmentId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 160);
  const destination = await taskCacheFile(`${cacheKey}-${safeName}`);
  const expectedSize = Math.max(0, Number(attachment.file_size || 0));
  if (destination.exists && (!expectedSize || destination.size === expectedSize)) return destination;
  if (destination.exists) destination.delete();
  try {
    const downloaded = await downloadAuthenticatedFile(sourceUrl, destination, {
      idempotent: true,
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

export async function downloadNativeTaskAnalytics(params: TaskAnalyticsParams): Promise<{
  file: File;
  fileName: string;
  mimeType: string;
}> {
  assertNativeRuntime();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = sanitizeNativeFileName(`hub_tasks_analytics_${timestamp}.xlsx`);
  const destination = await taskCacheFile(fileName);
  if (destination.exists) destination.delete();
  const sourceUrl = `${API_V1_BASE}${taskAnalyticsPath('/hub/tasks/analytics/export', params)}`;
  try {
    const downloaded = await downloadAuthenticatedFile(sourceUrl, destination, {
      idempotent: true,
    });
    if (!downloaded.exists || Number(downloaded.size || 0) <= 0) {
      if (downloaded.exists) downloaded.delete();
      throw new Error('Сервер вернул пустой файл аналитики');
    }
    return { file: downloaded, fileName, mimeType: TASK_ANALYTICS_MIME };
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}
