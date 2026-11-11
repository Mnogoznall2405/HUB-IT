import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { getWarehouse1CMovementFilePreviewState } from '../api/warehouse1cApi';
import type { Warehouse1CMovementFile } from '../api/warehouse1cApi';
import { API_V1_BASE } from '../api/config';
import { getSessionUserId } from '../auth/tokenStore';
import { downloadAuthenticatedFile } from '../files/authenticatedFileDownload';
import { sanitizeNativeFileName } from '../files/filePolicy';

const CACHE_DIRECTORY_NAME = 'hubit-warehouse-1c';

function warehouse1cCacheDirectory(): Directory {
  const directory = new Directory(Paths.document, CACHE_DIRECTORY_NAME);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

async function warehouse1cCacheFile(fileName: string): Promise<File> {
  const userId = Number(await getSessionUserId());
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Сессия истекла. Войдите снова');
  return new File(warehouse1cCacheDirectory(), `${userId}-${fileName}`);
}

export function clearNativeWarehouse1cCache(): void {
  const directory = warehouse1cCacheDirectory();
  for (const entry of directory.list()) entry.delete();
}

export function getNativeWarehouse1cCacheSize(): number {
  return warehouse1cCacheDirectory().list().reduce((total, entry) => (
    entry instanceof File && entry.exists ? total + Math.max(0, Number(entry.size || 0)) : total
  ), 0);
}

export function nativeWarehouse1cFilePath(registrarRef: string, fileRef: string): string {
  const safeRegistrarRef = String(registrarRef || '').trim();
  const safeFileRef = String(fileRef || '').trim();
  if (!safeRegistrarRef || !safeFileRef) throw new Error('Не выбран файл документа 1С');
  return `/warehouse-1c/movements/files/${encodeURIComponent(safeFileRef)}?registrar_ref=${encodeURIComponent(safeRegistrarRef)}`;
}

export function nativeWarehouse1cPreviewPath(registrarRef: string, fileRef: string): string {
  const safeRegistrarRef = String(registrarRef || '').trim();
  const safeFileRef = String(fileRef || '').trim();
  if (!safeRegistrarRef || !safeFileRef) throw new Error('Не выбран файл документа 1С');
  return `/warehouse-1c/movements/files/${encodeURIComponent(safeFileRef)}/preview/pdf?registrar_ref=${encodeURIComponent(safeRegistrarRef)}`;
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

function cacheKeyFor(registrarRef: string, fileRef: string): string {
  return `${registrarRef}-${fileRef}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180);
}

export async function downloadNativeWarehouse1cPreview(
  registrarRef: string,
  file: Warehouse1CMovementFile,
  options: { signal?: AbortSignal; onProgress?: (progress: number | null) => void } = {},
): Promise<File> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Нативный просмотр доступен только в приложении');
  }
  const safeRegistrarRef = String(registrarRef || '').trim();
  const safeFileRef = String(file.ref || '').trim();
  if (!safeRegistrarRef || !safeFileRef) throw new Error('Не выбран файл документа 1С');
  const previewPath = nativeWarehouse1cPreviewPath(safeRegistrarRef, safeFileRef);
  const deadline = Date.now() + 60_000;
  while (true) {
    const state = await getWarehouse1CMovementFilePreviewState(safeRegistrarRef, safeFileRef, options.signal);
    if (state.status === 'ready') break;
    if (state.status === 'failed') throw new Error('1С не смогла подготовить предпросмотр файла');
    if (Date.now() >= deadline) throw new Error('Предпросмотр готовится слишком долго. Повторите попытку позже');
    await waitForPreviewRetry(state.retryAfterMs, options.signal);
  }

  const destination = await warehouse1cCacheFile(`${cacheKeyFor(safeRegistrarRef, safeFileRef)}-preview.pdf`);
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

export async function downloadNativeWarehouse1cFile(
  registrarRef: string,
  file: Warehouse1CMovementFile,
  options: { signal?: AbortSignal; onProgress?: (progress: number | null) => void } = {},
): Promise<File> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Нативное скачивание доступно только в приложении');
  }
  const safeRegistrarRef = String(registrarRef || '').trim();
  const safeFileRef = String(file.ref || '').trim();
  if (!safeRegistrarRef || !safeFileRef) throw new Error('Не выбран файл документа 1С');
  const downloadPath = nativeWarehouse1cFilePath(safeRegistrarRef, safeFileRef);
  const safeName = sanitizeNativeFileName(file.name || 'document.bin');
  const destination = await warehouse1cCacheFile(`${cacheKeyFor(safeRegistrarRef, safeFileRef)}-${safeName}`);
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
