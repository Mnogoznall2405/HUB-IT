import { HUB_WEB_ORIGIN } from '../api/config';

export const CHAT_UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;
export const CHAT_UPLOAD_MAX_FILES = 5;
export const ATTACHMENT_CACHE_MAX_BYTES = 512 * 1024 * 1024;
export const ATTACHMENT_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const BLOCKED_EXTENSIONS = new Set([
  'apk', 'app', 'bat', 'cmd', 'com', 'dll', 'exe', 'hta', 'jar', 'js', 'jse',
  'msi', 'msp', 'pif', 'ps1', 'psm1', 'reg', 'scr', 'vbe', 'vbs', 'wsf',
]);
const BLOCKED_MIME_TYPES = new Set([
  'application/vnd.android.package-archive',
  'application/x-bat',
  'application/x-dosexec',
  'application/x-executable',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-powershell',
]);

export type FilePolicyInput = {
  name: string;
  mimeType?: string | null;
  size: number;
};

export type CacheEntry = {
  uri: string;
  size: number;
  modifiedAt: number;
};

export function sanitizeNativeFileName(value: string): string {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const fallback = normalized || 'hubit-file';
  if (fallback.length <= 180) return fallback;
  const dot = fallback.lastIndexOf('.');
  const extension = dot > 0 ? fallback.slice(dot, dot + 24) : '';
  return `${fallback.slice(0, Math.max(1, 180 - extension.length))}${extension}`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function validateUploadFile(input: FilePolicyInput): FilePolicyInput {
  const name = sanitizeNativeFileName(input.name);
  const mimeType = String(input.mimeType || 'application/octet-stream').trim().toLowerCase();
  const size = Number(input.size || 0);
  if (!Number.isFinite(size) || size <= 0) throw new Error('Файл пустой или недоступен');
  if (size > CHAT_UPLOAD_MAX_BYTES) throw new Error('Размер файла превышает 1 ГБ');
  if (BLOCKED_EXTENSIONS.has(extensionOf(name)) || BLOCKED_MIME_TYPES.has(mimeType)) {
    throw new Error('Этот тип файла нельзя отправить из приложения');
  }
  return { name, mimeType, size };
}

export function validateUploadBatch<T extends FilePolicyInput>(files: T[]): T[] {
  if (files.length > CHAT_UPLOAD_MAX_FILES) {
    throw new Error(`За одно сообщение можно отправить не больше ${CHAT_UPLOAD_MAX_FILES} файлов`);
  }
  const totalBytes = files.reduce((sum, file) => sum + Math.max(0, Number(file.size || 0)), 0);
  if (totalBytes > CHAT_UPLOAD_MAX_BYTES) {
    throw new Error('Общий размер вложений превышает 1 ГБ');
  }
  return files;
}

const TRUSTED_CHAT_MEDIA_PATHS = [
  /^\/api\/v1\/chat\/messages\/[^/]+\/attachments\/[^/]+\/file\/?$/,
  /^\/api\/v1\/chat\/stickers\/[^/]+\/(file|preview)\/?$/,
  /^\/api\/v1\/chat\/sticker-packs\/preview\/[^/]+\/stickers\/[^/]+\/(file|preview)\/?$/,
  /^\/api\/v1\/auth\/avatars\/[1-9]\d*\.jpg\/?$/,
  /^\/api\/v1\/chat\/group-avatars\/[A-Za-z0-9_-]+\.jpg\/?$/,
];

export function resolveTrustedAttachmentUrl(value?: string | null): string {
  return resolveTrustedChatMediaUrl(value, /^\/api\/v1\/chat\/messages\/[^/]+\/attachments\/[^/]+\/file\/?$/);
}

export function resolveTrustedStickerUrl(value?: string | null): string {
  return resolveTrustedChatMediaUrl(value, [
    /^\/api\/v1\/chat\/stickers\/[^/]+\/(file|preview)\/?$/,
    /^\/api\/v1\/chat\/sticker-packs\/preview\/[^/]+\/stickers\/[^/]+\/(file|preview)\/?$/,
  ]);
}

export function resolveTrustedChatMediaUrl(
  value?: string | null,
  allowed: RegExp | RegExp[] = TRUSTED_CHAT_MEDIA_PATHS,
): string {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Ссылка на вложение отсутствует');
  const expectedOrigin = new URL(HUB_WEB_ORIGIN).origin;
  const resolved = new URL(raw, `${expectedOrigin}/`);
  if (resolved.protocol !== 'https:' || resolved.origin !== expectedOrigin) {
    throw new Error('Вложение находится вне защищённого HUB-IT');
  }
  const patterns = Array.isArray(allowed) ? allowed : [allowed];
  if (!patterns.some((pattern) => pattern.test(resolved.pathname))) {
    throw new Error('Недопустимый адрес вложения');
  }
  return resolved.toString();
}

export function selectCacheEvictions(
  entries: CacheEntry[],
  options: {
    now?: number;
    maxAgeMs?: number;
    maxBytes?: number;
    preserveUri?: string;
  } = {},
): string[] {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? ATTACHMENT_CACHE_MAX_AGE_MS;
  const maxBytes = options.maxBytes ?? ATTACHMENT_CACHE_MAX_BYTES;
  const preserveUri = String(options.preserveUri || '');
  const deleted = new Set<string>();
  let total = entries.reduce((sum, entry) => sum + Math.max(0, entry.size || 0), 0);

  for (const entry of entries) {
    if (entry.uri !== preserveUri && now - entry.modifiedAt > maxAgeMs) {
      deleted.add(entry.uri);
      total -= Math.max(0, entry.size || 0);
    }
  }
  const oldestFirst = entries
    .filter((entry) => entry.uri !== preserveUri && !deleted.has(entry.uri))
    .sort((a, b) => a.modifiedAt - b.modifiedAt || a.uri.localeCompare(b.uri));
  for (const entry of oldestFirst) {
    if (total <= maxBytes) break;
    deleted.add(entry.uri);
    total -= Math.max(0, entry.size || 0);
  }
  return [...deleted];
}
