import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';
import HubitFolderZip from '../../modules/hubit-folder-zip';
import { API_V1_BASE, HUB_WEB_ORIGIN } from '../api/config';
import { getAuthenticatedAccessToken, withMobileAuthHeaders } from '../api/client';
import {
  createMyFileDownloadGrant,
  normalizeMyFile,
  type MyFilePreview,
  type MyFileRecord,
} from '../api/myFilesApi';
import { getClientDeviceId } from '../auth/tokenStore';
import { downloadAuthenticatedFile } from '../files/authenticatedFileDownload';
import { sanitizeNativeFileName, selectCacheEvictions } from '../files/filePolicy';
import {
  MY_FILES_MAX_FILE_BYTES,
  MY_FILES_TEXT_PREVIEW_MAX_BYTES,
  normalizeMyFilesRetention,
} from './nativeMyFilesModel';

const CACHE_DIRECTORY_NAME = 'hubit-my-files';
const NATIVE_PREVIEW_MAX_BYTES = 64 * 1024 * 1024;
const TEXT_PREVIEW_MAX_CHARACTERS = 200_000;

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

function responseError(status: number, body: string, fallback: string): Error {
  let detail = '';
  try {
    const parsed = JSON.parse(String(body || '')) as { detail?: unknown; message?: unknown };
    detail = String(parsed.detail || parsed.message || '').trim();
  } catch {
    detail = '';
  }
  return new Error(detail || (status === 401 ? 'Сессия истекла. Обновите экран и войдите снова' : fallback));
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
    if (size > MY_FILES_MAX_FILE_BYTES) throw new Error(`Файл «${name}» превышает 1 ГБ`);
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
  if (size > MY_FILES_MAX_FILE_BYTES) throw new Error(`Архив «${name}» превышает 1 ГБ`);
  return {
    uri: asset.uri,
    name,
    mimeType: 'application/zip',
    size,
  };
}

export async function uploadNativeMyFile(
  picked: NativeMyFileUpload,
  retentionDays: number,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: MyFileTransferProgress) => void;
  } = {},
): Promise<MyFileRecord> {
  assertNativeRuntime();
  const source = new File(picked.uri);
  const actualSize = Math.max(0, Number(source.size || picked.size || 0));
  if (!source.exists || actualSize <= 0) throw new Error('Файл пустой или недоступен');
  if (actualSize > MY_FILES_MAX_FILE_BYTES) throw new Error('Размер файла превышает 1 ГБ');
  const accessToken = await getAuthenticatedAccessToken();
  const deviceId = await getClientDeviceId();
  const query = new URLSearchParams({
    file_name: sanitizeNativeFileName(picked.name),
    file_size: String(actualSize),
    retention_days: String(normalizeMyFilesRetention(retentionDays)),
  });
  const task = source.createUploadTask(`${API_V1_BASE}/my-files?${query.toString()}`, {
    httpMethod: 'POST',
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: picked.mimeType || source.type || 'application/octet-stream',
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': picked.mimeType || source.type || 'application/octet-stream',
      ...withMobileAuthHeaders(deviceId),
    },
    onProgress: ({ bytesSent, totalBytes }) => {
      const total = totalBytes > 0 ? totalBytes : actualSize || null;
      options.onProgress?.({
        loaded: bytesSent,
        total,
        progress: total ? Math.max(0, Math.min(1, bytesSent / total)) : null,
      });
    },
  });
  const result = await task.uploadAsync();
  if (result.status < 200 || result.status >= 300) {
    throw responseError(result.status, result.body, 'Не удалось загрузить файл');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(result.body);
  } catch {
    throw new Error('Сервер вернул некорректный результат загрузки');
  }
  const normalized = normalizeMyFile(payload);
  if (!normalized) throw new Error('Сервер вернул некорректную карточку файла');
  return normalized;
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
  } = {},
): Promise<File> {
  assertNativeRuntime();
  const grant = await createMyFileDownloadGrant(item.id);
  const sourceUrl = resolveMyFileDownloadGrantUrl(grant.download_path);
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
