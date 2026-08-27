import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { getMailAttachmentPreview, type MailAttachment, type MailUploadFile } from '../api/mailApi';
import { API_V1_BASE } from '../api/config';
import { getSessionUserId } from '../auth/tokenStore';
import { downloadAuthenticatedFile } from '../files/authenticatedFileDownload';
import { sanitizeNativeFileName, validateUploadFile } from '../files/filePolicy';
import {
  getNativeMailAttachmentKind,
  resolveNativeMailAttachmentMimeType,
} from './nativeMailAttachmentVisual';

export const MAIL_UPLOAD_MAX_FILES = 10;
export const MAIL_UPLOAD_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAIL_UPLOAD_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const MAIL_IMAGE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
export const MAIL_INLINE_IMAGE_DATA_MAX_BYTES = 4 * 1024 * 1024;
const MAIL_IMAGE_PREVIEW_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAIL_INLINE_IMAGE_DATA_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAIL_IMAGE_PREVIEW_MAX_FILES = 8;

export function validateMailUploadFiles(files: MailUploadFile[]): MailUploadFile[] {
  if (files.length > MAIL_UPLOAD_MAX_FILES) {
    throw new Error(`К письму можно прикрепить не больше ${MAIL_UPLOAD_MAX_FILES} файлов`);
  }
  const normalized = files.map((file) => {
    const policy = validateUploadFile({ name: file.name, mimeType: file.mimeType, size: file.size });
    if (policy.size > MAIL_UPLOAD_MAX_FILE_BYTES) {
      throw new Error(`Файл «${policy.name}» превышает 15 МБ`);
    }
    return { ...file, name: policy.name, mimeType: policy.mimeType || 'application/octet-stream', size: policy.size };
  });
  const total = normalized.reduce((sum, file) => sum + file.size, 0);
  if (total > MAIL_UPLOAD_MAX_TOTAL_BYTES) throw new Error('Общий размер вложений превышает 25 МБ');
  return normalized;
}

export async function pickMailAttachments(existing: MailUploadFile[] = []): Promise<MailUploadFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
    type: '*/*',
  });
  if (result.canceled) return existing;
  const added = (result.assets || []).map((asset) => {
    const local = new File(asset.uri);
    return {
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType || local.type || 'application/octet-stream',
      size: Number(asset.size || local.size || 0),
    };
  });
  return validateMailUploadFiles([...existing, ...added]);
}

function mailCacheDirectory(): Directory {
  const directory = new Directory(Paths.cache, 'hubit-mail');
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export function clearNativeMailCache(): void {
  for (const entry of mailCacheDirectory().list()) entry.delete();
}

export function getNativeMailCacheSize(): number {
  return mailCacheDirectory().list().reduce((total, entry) => (
    entry instanceof File && entry.exists ? total + Math.max(0, Number(entry.size || 0)) : total
  ), 0);
}

async function mailCacheFile(fileName: string): Promise<File> {
  const userId = Number(await getSessionUserId());
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Сессия истекла. Войдите снова');
  return new File(mailCacheDirectory(), `${userId}-${fileName}`);
}

function attachmentReference(attachment: MailAttachment): string {
  const value = String(attachment.download_token || attachment.id || '').trim();
  if (!value || value.length > 8_192) throw new Error('У вложения отсутствует безопасная ссылка');
  if (attachment.downloadable === false) throw new Error('Это вложение нельзя скачать');
  return value;
}

export function canPreviewMailAttachment(attachment: MailAttachment): boolean {
  const name = String(attachment.name || '').trim().toLowerCase();
  const contentType = String(attachment.content_type || '').trim().toLowerCase();
  return [
    'xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'xltm', 'ods',
    'doc', 'docx', 'docm', 'dot', 'dotx', 'rtf', 'odt',
    'ppt', 'pptx', 'pptm', 'pot', 'potx', 'potm', 'odp',
  ].some((extension) => name.endsWith(`.${extension}`)) || [
    'spreadsheetml', 'ms-excel', 'opendocument.spreadsheet',
    'wordprocessingml', 'msword', 'opendocument.text', 'rtf',
    'presentationml', 'ms-powerpoint', 'opendocument.presentation',
  ].some((marker) => contentType.includes(marker));
}

async function authenticatedMailDownload(
  sourceUrl: string,
  destination: File,
  options: { signal?: AbortSignal } = {},
): Promise<File> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Нативное скачивание доступно только в приложении');
  }
  if (destination.exists) destination.delete();
  try {
    return await downloadAuthenticatedFile(sourceUrl, destination, {
      idempotent: true,
      signal: options.signal,
    });
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}

export function validateDownloadedMailAttachment(
  file: Pick<File, 'exists' | 'size'>,
  expectedSize = 0,
): void {
  void expectedSize;
  if (!file.exists || Number(file.size || 0) <= 0) {
    throw new Error('Сервер вернул пустой файл вложения');
  }
}

function mailAttachmentDownloadName(attachment: MailAttachment): string {
  const safeName = sanitizeNativeFileName(attachment.name || 'mail-file');
  const contentType = String(attachment.content_type || '').trim().toLowerCase();
  if (contentType === 'message/rfc822' && !safeName.toLowerCase().endsWith('.eml')) {
    return `${safeName}.eml`;
  }
  return safeName;
}

function mailEndpointUrl(path: string, mailboxId: string): string {
  const query = new URLSearchParams();
  if (mailboxId) query.set('mailbox_id', mailboxId);
  return `${API_V1_BASE}${path}${query.size ? `?${query.toString()}` : ''}`;
}

export async function downloadMailMessageSource(
  messageId: string,
  mailboxId: string,
  suggestedName: string,
  options: { signal?: AbortSignal } = {},
): Promise<File> {
  const id = String(messageId || '').trim();
  if (!id || id.length > 8_192) throw new Error('Не указано письмо');
  const baseName = sanitizeNativeFileName(String(suggestedName || 'message').replace(/\.eml$/i, ''));
  const key = id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96);
  const destination = await mailCacheFile(`${key}-${baseName}.eml`);
  return authenticatedMailDownload(
    mailEndpointUrl(`/mail/messages/${encodeURIComponent(id)}/eml`, mailboxId),
    destination,
    options,
  );
}

export async function downloadMailAttachmentPreviewPdf(
  messageId: string,
  mailboxId: string,
  attachment: MailAttachment,
  options: {
    signal?: AbortSignal;
    maxAttempts?: number;
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<File> {
  if (!canPreviewMailAttachment(attachment)) throw new Error('Для этого типа файла PDF-предпросмотр недоступен');
  const id = String(messageId || '').trim();
  if (!id || id.length > 8_192) throw new Error('Не указано письмо');
  const reference = attachmentReference(attachment);
  const attempts = Math.max(1, Math.min(12, Number(options.maxAttempts || 6)));
  const wait = options.wait || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let metadata: Awaited<ReturnType<typeof getMailAttachmentPreview>> = {};
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    metadata = await getMailAttachmentPreview(id, reference, mailboxId);
    const status = String(metadata.status || '').trim().toLowerCase();
    if (status === 'ready') break;
    if (status === 'failed') throw new Error(String(metadata.detail || 'Сервер не смог подготовить PDF-предпросмотр'));
    if (attempt < attempts - 1) await wait(Math.max(100, Math.min(2_000, Number(metadata.retry_after_ms || 500))));
  }
  if (String(metadata.status || '').trim().toLowerCase() !== 'ready') {
    throw new Error('Предпросмотр ещё готовится. Повторите через несколько секунд');
  }
  const baseName = sanitizeNativeFileName(
    String(metadata.pdf_filename || attachment.name || 'preview').replace(/\.[^.]+$/i, ''),
  );
  const key = `${id}-${reference}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96);
  const destination = await mailCacheFile(`${key}-${baseName}.pdf`);
  return authenticatedMailDownload(
    mailEndpointUrl(
      `/mail/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(reference)}/preview/pdf`,
      mailboxId,
    ),
    destination,
    options,
  );
}

export async function downloadMailAttachment(
  messageId: string,
  mailboxId: string,
  attachment: MailAttachment,
  options: { signal?: AbortSignal } = {},
): Promise<File> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Нативное скачивание доступно только в приложении');
  }
  const normalizedMessageId = String(messageId || '').trim();
  if (!normalizedMessageId || normalizedMessageId.length > 8_192) throw new Error('Не указано письмо');
  const reference = attachmentReference(attachment);
  const query = new URLSearchParams();
  if (mailboxId) query.set('mailbox_id', mailboxId);
  const suffix = query.toString();
  const sourceUrl = `${API_V1_BASE}/mail/messages/${encodeURIComponent(normalizedMessageId)}/attachments/${encodeURIComponent(reference)}${suffix ? `?${suffix}` : ''}`;
  const safeName = mailAttachmentDownloadName(attachment);
  const key = `${normalizedMessageId}-${reference}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96);
  const destination = await mailCacheFile(`${key}-${safeName}`);
  const expectedSize = Math.max(0, Number(attachment.size || 0));
  if (destination.exists && Number(destination.size || 0) > 0) return destination;
  if (destination.exists) destination.delete();
  try {
    const downloaded = await downloadAuthenticatedFile(sourceUrl, destination, {
      idempotent: true,
      signal: options.signal,
    });
    validateDownloadedMailAttachment(downloaded, expectedSize);
    return downloaded;
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}

/**
 * Downloads images through the authenticated native channel. Regular images
 * use a local URI; CID images additionally receive a bounded data URL so the
 * sandboxed HTML document can render them without exposing auth headers.
 */
export async function hydrateNativeMailImages(
  messageId: string,
  mailboxId: string,
  attachments: MailAttachment[] = [],
  options: { signal?: AbortSignal } = {},
): Promise<MailAttachment[]> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return attachments;
  const result = [...attachments];
  const candidates: Array<{ attachment: MailAttachment; index: number }> = [];
  let previewBytes = 0;
  result.forEach((attachment, index) => {
    const size = Math.max(0, Number(attachment.size || 0));
    if (
      candidates.length >= MAIL_IMAGE_PREVIEW_MAX_FILES
      || getNativeMailAttachmentKind(attachment) !== 'image'
      || attachment.downloadable === false
      || /^data:image\//i.test(String(attachment.inline_data_url || attachment.inline_src || '').trim())
      || size <= 0
      || size > MAIL_IMAGE_PREVIEW_MAX_BYTES
      || previewBytes + size > MAIL_IMAGE_PREVIEW_MAX_TOTAL_BYTES
    ) return;
    candidates.push({ attachment, index });
    previewBytes += size;
  });

  let inlineDataBytes = 0;
  for (const { attachment, index } of candidates) {
    if (options.signal?.aborted) break;
    try {
      const file = await downloadMailAttachment(messageId, mailboxId, attachment, options);
      const hydrated: MailAttachment = { ...attachment, native_preview_uri: file.uri };
      if (
        (attachment.is_inline || String(attachment.content_id || '').trim())
        && !String(attachment.inline_data_url || '').trim()
        && Number(file.size || attachment.size || 0) <= MAIL_INLINE_IMAGE_DATA_MAX_BYTES
        && inlineDataBytes + Number(file.size || attachment.size || 0) <= MAIL_INLINE_IMAGE_DATA_MAX_TOTAL_BYTES
      ) {
        const contentType = resolveNativeMailAttachmentMimeType(attachment, file.type);
        if (/^image\/(?:png|jpe?g|gif|webp|bmp)$/i.test(contentType)) {
          hydrated.inline_data_url = `data:${contentType};base64,${await file.base64()}`;
          inlineDataBytes += Number(file.size || attachment.size || 0);
        }
      }
      result[index] = hydrated;
    } catch {
      // Keep the file icon/placeholder if one protected image cannot be loaded.
    }
  }
  return result;
}
