import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import type { DocflowTaskFile } from '../api/docflowApi';
import { getDocflowFilePreviewState } from '../api/docflowApi';
import { API_V1_BASE } from '../api/config';
import { getSessionUserId } from '../auth/tokenStore';
import { downloadAuthenticatedFile } from '../files/authenticatedFileDownload';
import { sanitizeNativeFileName } from '../files/filePolicy';

const CACHE_DIRECTORY_NAME = 'hubit-docflow';

function docflowCacheDirectory(): Directory {
  const directory = new Directory(Paths.document, CACHE_DIRECTORY_NAME);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

async function docflowCacheFile(fileName: string): Promise<File> {
  const userId = Number(await getSessionUserId());
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Сессия истекла. Войдите снова');
  return new File(docflowCacheDirectory(), `${userId}-${fileName}`);
}

export function clearNativeDocflowCache(): void {
  const directory = docflowCacheDirectory();
  for (const entry of directory.list()) entry.delete();
}

export function getNativeDocflowCacheSize(): number {
  return docflowCacheDirectory().list().reduce((total, entry) => (
    entry instanceof File && entry.exists ? total + Math.max(0, Number(entry.size || 0)) : total
  ), 0);
}

export function nativeDocflowFilePath(taskRef: string, fileRef: string): string {
  const safeTaskRef = String(taskRef || '').trim();
  const safeFileRef = String(fileRef || '').trim();
  if (!safeTaskRef || !safeFileRef) throw new Error('Не выбран файл задания 1С');
  return `/docflow/tasks/${encodeURIComponent(safeTaskRef)}/files/${encodeURIComponent(safeFileRef)}/content?disposition=attachment`;
}

export function nativeDocflowPreviewPath(taskRef: string, fileRef: string): string {
  const safeTaskRef = String(taskRef || '').trim();
  const safeFileRef = String(fileRef || '').trim();
  if (!safeTaskRef || !safeFileRef) throw new Error('Не выбран файл задания 1С');
  return `/docflow/tasks/${encodeURIComponent(safeTaskRef)}/files/${encodeURIComponent(safeFileRef)}/preview/pdf`;
}

function waitForPreviewRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Операция отменена'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('Операция отменена'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function downloadNativeDocflowPreview(
  taskRef: string,
  file: DocflowTaskFile,
  options: { signal?: AbortSignal; onProgress?: (progress: number | null) => void } = {},
): Promise<File> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Нативный просмотр доступен только в приложении');
  }
  if (!file.preview_supported) throw new Error('Предпросмотр этого файла недоступен');
  const safeTaskRef = String(taskRef || '').trim();
  const safeFileRef = String(file.ref || '').trim();
  const previewPath = nativeDocflowPreviewPath(safeTaskRef, safeFileRef);
  const deadline = Date.now() + 60_000;
  while (true) {
    const state = await getDocflowFilePreviewState(safeTaskRef, safeFileRef, options.signal);
    if (state.status === 'ready') break;
    if (state.status === 'failed') throw new Error('1С не смогла подготовить предпросмотр файла');
    if (Date.now() >= deadline) throw new Error('Предпросмотр готовится слишком долго. Повторите попытку позже');
    await waitForPreviewRetry(state.retry_after_ms, options.signal);
  }

  const cacheKey = `${safeTaskRef}-${safeFileRef}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180);
  const destination = await docflowCacheFile(`${cacheKey}-preview.pdf`);
  if (destination.exists && destination.size > 0) return destination;
  if (destination.exists) destination.delete();
  try {
    return await downloadAuthenticatedFile(`${API_V1_BASE}${previewPath}`, destination, {
      idempotent: true,
      signal: options.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        options.onProgress?.(totalBytes > 0
          ? Math.max(0, Math.min(1, bytesWritten / totalBytes))
          : null);
      },
    });
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}

export async function downloadNativeDocflowFile(
  taskRef: string,
  file: DocflowTaskFile,
  options: { signal?: AbortSignal; onProgress?: (progress: number | null) => void } = {},
): Promise<File> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Нативное скачивание доступно только в приложении');
  }
  const safeTaskRef = String(taskRef || '').trim();
  const safeFileRef = String(file.ref || '').trim();
  const downloadPath = nativeDocflowFilePath(safeTaskRef, safeFileRef);
  const safeName = sanitizeNativeFileName(file.name || 'document.bin');
  const cacheKey = `${safeTaskRef}-${safeFileRef}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180);
  const destination = await docflowCacheFile(`${cacheKey}-${safeName}`);
  const expectedSize = Math.max(0, Number(file.size || 0));
  if (destination.exists && (!expectedSize || destination.size === expectedSize)) return destination;
  if (destination.exists) destination.delete();
  const sourceUrl = `${API_V1_BASE}${downloadPath}`;
  try {
    const downloaded = await downloadAuthenticatedFile(sourceUrl, destination, {
      idempotent: true,
      signal: options.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : expectedSize || 0;
        options.onProgress?.(total ? Math.max(0, Math.min(1, bytesWritten / total)) : null);
      },
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
