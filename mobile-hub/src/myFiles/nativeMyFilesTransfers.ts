import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import HubitFolderZip from '../../modules/hubit-folder-zip';
import { API_V1_BASE, HUB_WEB_ORIGIN } from '../api/config';
import {
  cancelMyFileUploadSession,
  completeMyFileUploadSession,
  createMyFileDownloadGrant,
  createMyFileUploadSession,
  getMyFileUploadSession,
  uploadMyFileChunk,
  type MyFilePreview,
  type MyFileRecord,
  type MyFileUploadSession,
} from '../api/myFilesApi';
import { downloadAuthenticatedFile } from '../files/authenticatedFileDownload';
import { sanitizeNativeFileName, selectCacheEvictions } from '../files/filePolicy';
import {
  MY_FILES_MAX_FILE_BYTES,
  MY_FILES_TEXT_PREVIEW_MAX_BYTES,
  normalizeMyFilesRetention,
} from './nativeMyFilesModel';
import { getNativeMyFilesOfflineFile } from './nativeMyFilesOfflineStore';

const CACHE_DIRECTORY_NAME = 'hubit-my-files';
const NATIVE_PREVIEW_MAX_BYTES = 64 * 1024 * 1024;
const TEXT_PREVIEW_MAX_CHARACTERS = 200_000;
/** Паритет с вебом: сервер резервирует сессию на upload_reservation_ttl_sec (2ч). */
const UPLOAD_RESUME_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const UPLOAD_RETRY_DELAYS_MS = [1_000, 2_500, 5_000, 10_000, 20_000];
const UPLOAD_SESSION_CAPACITY_MAX_RETRIES = 40;
const UPLOAD_SESSION_CAPACITY_FALLBACK_MS = 5_000;
const UPLOAD_SESSION_CAPACITY_MAX_DELAY_MS = 15_000;
const UPLOAD_RESUME_FILE_NAME = 'hubit-my-files-upload-resume.json';

export type NativeMyFileUpload = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
};

export type MyFileTransferProgress = {
  loaded: number;
  total: number | null;
  progress: number | null;
};

function assertNativeRuntime(): void {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Операция с файлами доступна только в приложении');
  }
}

function cacheDirectory(): Directory {
  const directory = new Directory(Paths.cache, CACHE_DIRECTORY_NAME);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function cleanupCache(preserveUri?: string): void {
  const directory = cacheDirectory();
  const entries = directory.list()
    .filter((entry): entry is File => entry instanceof File && entry.exists)
    .map((entry) => ({
      uri: entry.uri,
      size: Math.max(0, Number(entry.size || 0)),
      modifiedAt: Number(entry.lastModified || entry.creationTime || 0),
    }));
  const evictions = new Set(selectCacheEvictions(entries, { preserveUri }));
  directory.list().forEach((entry) => {
    if (entry instanceof File && evictions.has(entry.uri) && entry.exists) entry.delete();
  });
}

export function clearNativeMyFilesCache(): void {
  cacheDirectory().list().forEach((entry) => entry.delete());
}

export function getNativeMyFilesCacheSize(): number {
  return cacheDirectory().list()
    .filter((entry): entry is File => entry instanceof File && entry.exists)
    .reduce((sum, entry) => sum + Math.max(0, Number(entry.size || 0)), 0);
}

export async function pickNativeMyFiles(): Promise<NativeMyFileUpload[]> {
  assertNativeRuntime();
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
    type: '*/*',
  });
  if (result.canceled) return [];
  return (result.assets || []).map((asset) => {
    const file = new File(asset.uri);
    const size = Math.max(0, Number(asset.size || file.size || 0));
    const name = sanitizeNativeFileName(asset.name || file.name || 'file.bin');
    if (!file.exists || size <= 0) throw new Error(`Файл «${name}» пустой или недоступен`);
    if (size > MY_FILES_MAX_FILE_BYTES) throw new Error(`Файл «${name}» превышает лимит 10 ГБ`);
    return {
      uri: asset.uri,
      name,
      mimeType: String(asset.mimeType || file.type || 'application/octet-stream'),
      size,
    };
  });
}

export async function pickNativeMyFilesFolder(): Promise<NativeMyFileUpload | null> {
  assertNativeRuntime();
  if (!HubitFolderZip) {
    throw new Error('Упаковка папок недоступна в этой версии приложения. Обновите APK');
  }
  const result = await HubitFolderZip.pickAndZipFolderAsync();
  if (result.canceled || !result.asset) return null;
  const asset = result.asset;
  const file = new File(asset.uri);
  const size = Math.max(0, Number(asset.size || file.size || 0));
  const name = sanitizeNativeFileName(asset.name || `${asset.folderName || 'folder'}.zip`);
  if (!file.exists || size <= 0) throw new Error(`Архив «${name}» пустой или недоступен`);
  if (size > MY_FILES_MAX_FILE_BYTES) throw new Error(`Архив «${name}» превышает лимит 10 ГБ`);
  return {
    uri: asset.uri,
    name,
    mimeType: 'application/zip',
    size,
  };
}

type UploadResumeEntry = { fileId?: unknown; savedAt?: unknown };

function uploadResumeFile(): File {
  return new File(Paths.document, UPLOAD_RESUME_FILE_NAME);
}

async function readUploadResumeMap(): Promise<Record<string, UploadResumeEntry>> {
  try {
    const file = uploadResumeFile();
    if (!file.exists) return {};
    const parsed = JSON.parse(await file.text()) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, UploadResumeEntry>
      : {};
  } catch {
    return {};
  }
}

async function writeUploadResumeMap(map: Record<string, UploadResumeEntry>): Promise<void> {
  try {
    const cutoff = Date.now() - UPLOAD_RESUME_MAX_AGE_MS;
    const pruned = Object.fromEntries(
      Object.entries(map).filter(([, entry]) => Number(entry?.savedAt || 0) > cutoff),
    );
    const file = uploadResumeFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(pruned));
  } catch {
    // Resume map is best-effort.
  }
}

function uploadResumeKey(name: string, size: number, folderId: string, modifiedAtMs: number): string {
  return [String(name || ''), String(Math.max(0, Math.trunc(size))), String(folderId || ''), String(Math.trunc(modifiedAtMs || 0))].join('|');
}

async function findResumableUploadSession(
  key: string,
  expectedSize: number,
  signal?: AbortSignal,
): Promise<MyFileUploadSession | null> {
  const entry = (await readUploadResumeMap())[key];
  const fileId = String(entry?.fileId || '').trim();
  if (!fileId || Date.now() - Number(entry?.savedAt || 0) > UPLOAD_RESUME_MAX_AGE_MS) return null;
  try {
    const session = await getMyFileUploadSession(fileId, signal);
    if (session.file_size_bytes !== expectedSize || session.complete) return null;
    return session;
  } catch {
    return null;
  }
}

async function saveUploadResume(key: string, fileId: string): Promise<void> {
  const map = await readUploadResumeMap();
  map[key] = { fileId, savedAt: Date.now() };
  await writeUploadResumeMap(map);
}

async function clearUploadResume(key: string): Promise<void> {
  const map = await readUploadResumeMap();
  if (!(key in map)) return;
  delete map[key];
  await writeUploadResumeMap(map);
}

function createUploadAbortError(): Error {
  return Object.assign(new Error('Upload aborted'), { name: 'AbortError' });
}

function waitForUploadRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createUploadAbortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(createUploadAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function isRetriableUploadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: string; code?: string; response?: { status?: number } };
  if (candidate.name === 'AbortError' || candidate.code === 'ERR_CANCELED') return false;
  const status = Number(candidate.response?.status || 0);
  if (!status) return true;
  if (status === 408 || status === 425 || status === 429) return true;
  return status >= 500;
}

function describeUploadFailure(error: unknown, aborted = false): string {
  const candidate = error as {
    name?: string;
    code?: string;
    message?: string;
    response?: { status?: number; data?: { detail?: unknown } };
  } | null;
  if (aborted || candidate?.name === 'AbortError' || candidate?.code === 'ERR_CANCELED') {
    return 'Upload cancelled';
  }
  const detail = candidate?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim().slice(0, 2000);
  if (Array.isArray(detail)) {
    const first = detail.find((item) => typeof item?.msg === 'string' && String(item.msg).trim());
    if (first) return String(first.msg).trim().slice(0, 2000);
  }
  const message = String(candidate?.message || '').trim();
  if (message) return message.slice(0, 2000);
  const status = Number(candidate?.response?.status || 0);
  return status > 0 ? `Upload failed (HTTP ${status})` : 'Upload failed';
}

function capacityRetryDelayMs(error: unknown): number {
  const headers = (error as { response?: { headers?: Record<string, unknown> } } | null)
    ?.response?.headers;
  const retryAfterSeconds = Number(headers?.['retry-after'] || 0);
  const suggested = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : UPLOAD_SESSION_CAPACITY_FALLBACK_MS;
  return Math.min(Math.max(suggested, 2_000), UPLOAD_SESSION_CAPACITY_MAX_DELAY_MS);
}

async function createUploadSessionWithCapacityRetry(input: {
  fileName: string;
  fileSize: number;
  retentionDays: number;
  mimeType: string;
  folderId?: string | null;
  signal?: AbortSignal;
}): Promise<MyFileUploadSession> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await createMyFileUploadSession(input);
    } catch (error) {
      const status = Number(
        (error as { response?: { status?: number } } | null)?.response?.status || 0,
      );
      if (status !== 429 || input.signal?.aborted || attempt >= UPLOAD_SESSION_CAPACITY_MAX_RETRIES) {
        throw error;
      }
      await waitForUploadRetry(capacityRetryDelayMs(error), input.signal);
    }
  }
}

function emitUploadProgress(
  callback: ((progress: MyFileTransferProgress) => void) | undefined,
  loaded: number,
  total: number,
): void {
  if (typeof callback !== 'function') return;
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeLoaded = Math.max(0, Math.min(safeTotal || loaded, Number(loaded) || 0));
  callback({
    loaded: safeLoaded,
    total: safeTotal || null,
    progress: safeTotal > 0 ? Math.max(0, Math.min(1, safeLoaded / safeTotal)) : null,
  });
}

export async function uploadNativeMyFile(
  picked: NativeMyFileUpload,
  retentionDays: number,
  options: {
    signal?: AbortSignal;
    folderId?: string | null;
    onProgress?: (progress: MyFileTransferProgress) => void;
  } = {},
): Promise<MyFileRecord> {
  assertNativeRuntime();
  const source = new File(picked.uri);
  const actualSize = Math.max(0, Number(source.size || picked.size || 0));
  if (!source.exists || actualSize <= 0) throw new Error('Файл пустой или недоступен');
  if (actualSize > MY_FILES_MAX_FILE_BYTES) throw new Error('Размер файла превышает лимит 10 ГБ');
  const signal = options.signal;
  const safeName = sanitizeNativeFileName(picked.name);
  const mimeType = picked.mimeType || source.type || 'application/octet-stream';
  const resumeKey = uploadResumeKey(safeName, actualSize, String(options.folderId || ''), Number(source.modificationTime || 0));
  let fileId = '';
  emitUploadProgress(options.onProgress, 0, actualSize);
  try {
    const session = (await findResumableUploadSession(resumeKey, actualSize, signal))
      || await createUploadSessionWithCapacityRetry({
        fileName: safeName,
        fileSize: actualSize,
        retentionDays: normalizeMyFilesRetention(retentionDays),
        mimeType,
        folderId: options.folderId || null,
        signal,
      });
    fileId = session.file_id;
    await saveUploadResume(resumeKey, fileId);
    const chunkSizeBytes = Number(session.chunk_size_bytes || 0);
    let uploadedBytes = Math.max(0, Number(session.uploaded_bytes || 0));
    if (!fileId || !Number.isFinite(chunkSizeBytes) || chunkSizeBytes <= 0 || uploadedBytes > actualSize) {
      throw new Error('Сервер вернул некорректную сессию загрузки');
    }

    emitUploadProgress(options.onProgress, uploadedBytes, actualSize);
    while (uploadedBytes < actualSize) {
      const chunkOffset = uploadedBytes;
      const chunk = source.slice(chunkOffset, Math.min(actualSize, chunkOffset + chunkSizeBytes));
      let acknowledged = false;
      let lastError: unknown = null;

      for (let attempt = 0; attempt <= UPLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          const result = await uploadMyFileChunk(fileId, chunk, {
            offset: chunkOffset,
            signal,
            onUploadProgress: (event) => {
              const sent = Math.min(chunk.size, Number(event?.loaded || 0));
              emitUploadProgress(options.onProgress, chunkOffset + sent, actualSize);
            },
          });
          const nextUploadedBytes = Math.max(0, Number(result.uploaded_bytes || 0));
          if (nextUploadedBytes <= chunkOffset || nextUploadedBytes > actualSize) {
            throw new Error('Сервер подтвердил некорректный объём загрузки');
          }
          uploadedBytes = nextUploadedBytes;
          acknowledged = true;
          break;
        } catch (error) {
          lastError = error;
          if (signal?.aborted) throw error;
          try {
            const status = await getMyFileUploadSession(fileId, signal);
            const recoveredBytes = Math.max(0, Number(status.uploaded_bytes || 0));
            if (recoveredBytes > chunkOffset && recoveredBytes <= actualSize) {
              uploadedBytes = recoveredBytes;
              acknowledged = true;
              break;
            }
          } catch (statusError) {
            if (signal?.aborted) throw statusError;
          }
          if (!isRetriableUploadError(error)) throw error;
          if (attempt < UPLOAD_RETRY_DELAYS_MS.length) {
            await waitForUploadRetry(UPLOAD_RETRY_DELAYS_MS[attempt], signal);
          }
        }
      }

      if (!acknowledged) throw lastError || new Error('Не удалось отправить часть файла');
      emitUploadProgress(options.onProgress, uploadedBytes, actualSize);
    }

    const completed = await completeMyFileUploadSession(fileId, signal);
    emitUploadProgress(options.onProgress, actualSize, actualSize);
    await clearUploadResume(resumeKey);
    return completed;
  } catch (error) {
    const aborted = Boolean(signal?.aborted)
      || (error as { name?: string; code?: string } | null)?.name === 'AbortError'
      || (error as { name?: string; code?: string } | null)?.code === 'ERR_CANCELED';
    if (fileId && (aborted || !isRetriableUploadError(error))) {
      // Точные провалы отменяем на сервере; сетевые сбои оставляем сессию для resume.
      await clearUploadResume(resumeKey);
      try {
        await cancelMyFileUploadSession(fileId, describeUploadFailure(error, aborted));
      } catch {
        // Сервер сам истечёт незавершённые резервации.
      }
    }
    throw aborted ? createUploadAbortError() : error;
  }
}

export function resolveMyFileDownloadGrantUrl(downloadPath: string): string {
  const raw = String(downloadPath || '').trim();
  if (!/^\/my-files\/download-grant\/[A-Za-z0-9_-]{16,512}$/.test(raw)) {
    throw new Error('Сервер вернул недопустимую ссылку для скачивания');
  }
  const api = new URL(API_V1_BASE);
  const trusted = new URL(HUB_WEB_ORIGIN);
  if (api.protocol !== 'https:' || api.origin !== trusted.origin) {
    throw new Error('Адрес API не соответствует защищённому HUB-IT');
  }
  return `${API_V1_BASE}${raw}`;
}

export function resolveMyFilePreviewContentUrl(fileId: string): string {
  const normalized = String(fileId || '').trim();
  if (!normalized || normalized.length > 200) throw new Error('Не выбран файл для предпросмотра');
  const api = new URL(API_V1_BASE);
  const trusted = new URL(HUB_WEB_ORIGIN);
  if (api.protocol !== 'https:' || api.origin !== trusted.origin) {
    throw new Error('Адрес API не соответствует защищённому HUB-IT');
  }
  return `${API_V1_BASE}/my-files/${encodeURIComponent(normalized)}/preview/content`;
}

export async function downloadNativeMyFilePreview(
  item: MyFileRecord,
  metadata: MyFilePreview,
  options: { signal?: AbortSignal } = {},
): Promise<{ file: File; mimeType: string }> {
  assertNativeRuntime();
  const kind = String(metadata.preview_kind || '').toLowerCase();
  if (!['image', 'pdf', 'office_pdf'].includes(kind)) {
    throw new Error('Этот формат нельзя безопасно просмотреть в приложении');
  }
  const listedKind = String(item.preview_kind || '').toLowerCase();
  const kindMatchesList = listedKind === 'image'
    ? kind === 'image'
    : ['pdf', 'office_pdf'].includes(listedKind) && ['pdf', 'office_pdf'].includes(kind);
  if (!kindMatchesList) throw new Error('Тип предпросмотра изменился. Обновите список файлов');
  const mimeType = kind === 'image' ? myPreviewImageMimeType(item) : 'application/pdf';
  const sourceName = kind === 'office_pdf'
    ? metadata.pdf_filename || `${item.id}.pdf`
    : metadata.source_filename || item.download_file_name || item.original_file_name || 'preview';
  const safeId = item.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96);
  const destination = new File(cacheDirectory(), `preview-${safeId}-${sanitizeNativeFileName(sourceName)}`);
  const configuredMax = Math.max(0, Number(item.preview_max_bytes || 0));
  const maxBytes = configuredMax > 0 ? Math.min(configuredMax, NATIVE_PREVIEW_MAX_BYTES) : NATIVE_PREVIEW_MAX_BYTES;
  if (destination.exists && destination.size > 0 && destination.size <= maxBytes) {
    cleanupCache(destination.uri);
    return { file: destination, mimeType };
  }
  if (destination.exists) destination.delete();
  cleanupCache();
  try {
    const downloaded = await downloadAuthenticatedFile(resolveMyFilePreviewContentUrl(item.id), destination, {
      idempotent: true,
      signal: options.signal,
    });
    if (!downloaded.exists || downloaded.size <= 0 || downloaded.size > maxBytes) {
      if (downloaded.exists) downloaded.delete();
      throw new Error('Предпросмотр пустой или превышает допустимый размер');
    }
    cleanupCache(downloaded.uri);
    return { file: downloaded, mimeType };
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}

function myPreviewImageMimeType(item: MyFileRecord): string {
  const mimeType = String(item.download_mime_type || item.mime_type || '').split(';', 1)[0].trim().toLowerCase();
  if (!mimeType.startsWith('image/') || mimeType === 'image/svg+xml') {
    throw new Error('Этот формат изображения нельзя безопасно просмотреть в приложении');
  }
  return mimeType;
}

export async function readNativeMyFileTextPreview(file: File): Promise<string> {
  if (!file.exists || file.size <= 0) throw new Error('Файл пустой или недоступен');
  if (file.size > MY_FILES_TEXT_PREVIEW_MAX_BYTES) {
    throw new Error('Текстовый файл слишком большой для предпросмотра');
  }
  const text = (await file.text()).replace(/\0/g, '\uFFFD');
  if (text.length <= TEXT_PREVIEW_MAX_CHARACTERS) return text;
  return `${text.slice(0, TEXT_PREVIEW_MAX_CHARACTERS)}\n\n[Показаны первые ${TEXT_PREVIEW_MAX_CHARACTERS.toLocaleString('ru-RU')} символов]`;
}

export async function downloadNativeMyFile(
  item: MyFileRecord,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: MyFileTransferProgress) => void;
    userId?: number;
  } = {},
): Promise<File> {
  assertNativeRuntime();
  if (options.userId) {
    const offlineFile = await getNativeMyFilesOfflineFile(options.userId, item);
    if (offlineFile) {
      options.onProgress?.({ loaded: offlineFile.size, total: offlineFile.size, progress: 1 });
      return offlineFile;
    }
  }
  const safeName = sanitizeNativeFileName(item.download_file_name || item.original_file_name || 'file.bin');
  const safeId = item.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96);
  const destination = new File(cacheDirectory(), `${safeId}-${safeName}`);
  const expectedSize = Math.max(0, Number(
    item.storage_mode === 'optimized_media' ? item.stored_size_bytes : item.original_size_bytes,
  ));
  if (destination.exists && (!expectedSize || destination.size === expectedSize)) {
    cleanupCache(destination.uri);
    options.onProgress?.({ loaded: destination.size, total: destination.size, progress: 1 });
    return destination;
  }
  const grant = await createMyFileDownloadGrant(item.id);
  const sourceUrl = resolveMyFileDownloadGrantUrl(grant.download_path);
  if (destination.exists) destination.delete();
  cleanupCache();
  try {
    const downloaded = await File.downloadFileAsync(sourceUrl, destination, {
      idempotent: true,
      signal: options.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : expectedSize || null;
        options.onProgress?.({
          loaded: bytesWritten,
          total,
          progress: total ? Math.max(0, Math.min(1, bytesWritten / total)) : null,
        });
      },
    });
    if (expectedSize && downloaded.size !== expectedSize) {
      if (downloaded.exists) downloaded.delete();
      throw new Error('Скачанный файл имеет неверный размер');
    }
    cleanupCache(downloaded.uri);
    return downloaded;
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}
