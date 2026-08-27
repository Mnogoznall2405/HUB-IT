import type { MyFileRecord } from '../api/myFilesApi';

export const MY_FILES_RETENTION_OPTIONS = [1, 3, 7, 10, 30] as const;
export const MY_FILES_MAX_FILE_BYTES = 1024 * 1024 * 1024;
export const MY_FILES_TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;
export const MY_FILES_ACTIVE_STATUSES = new Set(['uploading', 'queued', 'scanning', 'processing']);

export type NativeMyFilePreviewKind = 'image' | 'pdf' | 'text';

export type MyFileIconName =
  | 'archive-outline'
  | 'code-tags'
  | 'file-document-outline'
  | 'file-excel-outline'
  | 'file-image-outline'
  | 'file-music-outline'
  | 'file-outline'
  | 'file-pdf-box'
  | 'file-video-outline';

export function myFileName(item: MyFileRecord): string {
  return item.download_file_name || item.original_file_name || 'file.bin';
}

export function myFileMimeType(item: MyFileRecord): string {
  return item.download_mime_type || item.mime_type || 'application/octet-stream';
}

export function formatMyFileSize(value: unknown): string {
  let size = Math.max(0, Number(value) || 0);
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

export function formatMyFileDate(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '—';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export function myFileStatusLabel(item: MyFileRecord): string {
  if (item.status === 'ready') return 'Готов';
  if (item.status === 'uploading') return 'Загрузка';
  if (item.status === 'queued') return 'В очереди';
  if (item.status === 'scanning') return 'Проверка безопасности';
  if (item.status === 'processing') return 'Сжатие';
  if (item.status === 'failed') return item.error_text || 'Ошибка обработки';
  return item.status || 'Неизвестно';
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

const SAFE_RASTER_IMAGE_MIME_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const SAFE_TEXT_EXTENSIONS = new Set([
  'conf', 'css', 'csv', 'htm', 'html', 'ini', 'js', 'json', 'jsx', 'log', 'md',
  'ps1', 'py', 'sql', 'ts', 'tsx', 'txt', 'xml', 'yaml', 'yml',
]);

export function nativeMyFilePreviewKind(item: MyFileRecord): NativeMyFilePreviewKind | null {
  if (!isMyFileReady(item) || item.security_scan_status !== 'clean') return null;
  const mime = myFileMimeType(item).toLowerCase().split(';', 1)[0].trim();
  const extension = extensionOf(myFileName(item));
  if (
    item.preview_available
    && item.preview_status === 'ready'
    && item.preview_kind === 'image'
    && SAFE_RASTER_IMAGE_MIME_TYPES.has(mime)
  ) return 'image';
  if (
    item.preview_available
    && item.preview_status === 'ready'
    && (item.preview_kind === 'pdf' || item.preview_kind === 'office_pdf')
  ) return 'pdf';
  if (
    item.original_size_bytes > 0
    && item.original_size_bytes <= MY_FILES_TEXT_PREVIEW_MAX_BYTES
    && (mime.startsWith('text/') || SAFE_TEXT_EXTENSIONS.has(extension))
  ) return 'text';
  return null;
}

export function myFileIcon(item: MyFileRecord): MyFileIconName {
  const mime = myFileMimeType(item).toLowerCase();
  const extension = extensionOf(myFileName(item).toLowerCase());
  if (mime.startsWith('image/')) return 'file-image-outline';
  if (mime.startsWith('video/')) return 'file-video-outline';
  if (mime.startsWith('audio/')) return 'file-music-outline';
  if (mime.includes('pdf') || extension === 'pdf') return 'file-pdf-box';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(extension)) return 'file-excel-outline';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'zst'].includes(extension)) return 'archive-outline';
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'ps1', 'sql', 'json', 'xml', 'html', 'css', 'md'].includes(extension)) return 'code-tags';
  if (mime.startsWith('text/') || ['doc', 'docx', 'rtf', 'odt', 'txt', 'log'].includes(extension)) return 'file-document-outline';
  return 'file-outline';
}

export function isMyFileReady(item: MyFileRecord): boolean {
  return item.status === 'ready';
}

export function isMyFileProcessing(item: MyFileRecord): boolean {
  return MY_FILES_ACTIVE_STATUSES.has(item.status);
}

export function normalizeMyFilesRetention(value: unknown): number {
  const parsed = Number(value);
  return MY_FILES_RETENTION_OPTIONS.includes(parsed as never) ? parsed : 1;
}

export function buildMyFilePublicUrl(token: string, trustedOrigin: string): string {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken || normalizedToken.length > 512 || /[/?#\\]/.test(normalizedToken)) {
    throw new Error('Некорректная публичная ссылка');
  }
  const trusted = new URL(trustedOrigin);
  if (trusted.protocol !== 'https:') throw new Error('Публичная ссылка должна использовать HTTPS');
  const origin = trusted.origin;
  return new URL(`/shared-files/${encodeURIComponent(normalizedToken)}`, `${origin}/`).toString();
}
