import type { MailAttachment } from '../api/mailApi';

export type NativeMailAttachmentKind =
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'image'
  | 'archive'
  | 'audio'
  | 'video'
  | 'text'
  | 'generic';

export type NativeMailAttachmentIcon =
  | 'file-pdf-box'
  | 'file-word-outline'
  | 'file-excel-outline'
  | 'file-powerpoint-outline'
  | 'file-image-outline'
  | 'folder-zip-outline'
  | 'file-music-outline'
  | 'file-video-outline'
  | 'file-document-outline'
  | 'file-outline';

export type NativeMailAttachmentVisual = {
  kind: NativeMailAttachmentKind;
  icon: NativeMailAttachmentIcon;
  label: string;
  color: string;
};

const VISUALS: Record<NativeMailAttachmentKind, NativeMailAttachmentVisual> = {
  pdf: { kind: 'pdf', icon: 'file-pdf-box', label: 'PDF', color: '#d93025' },
  word: { kind: 'word', icon: 'file-word-outline', label: 'Word', color: '#185abd' },
  excel: { kind: 'excel', icon: 'file-excel-outline', label: 'Excel', color: '#107c41' },
  powerpoint: { kind: 'powerpoint', icon: 'file-powerpoint-outline', label: 'PowerPoint', color: '#d24726' },
  image: { kind: 'image', icon: 'file-image-outline', label: 'Изображение', color: '#7e57c2' },
  archive: { kind: 'archive', icon: 'folder-zip-outline', label: 'Архив', color: '#8d6e63' },
  audio: { kind: 'audio', icon: 'file-music-outline', label: 'Аудио', color: '#00838f' },
  video: { kind: 'video', icon: 'file-video-outline', label: 'Видео', color: '#00838f' },
  text: { kind: 'text', icon: 'file-document-outline', label: 'Текст', color: '#546e7a' },
  generic: { kind: 'generic', icon: 'file-outline', label: 'Файл', color: '#64748b' },
};

const EXTENSION_KINDS: Record<string, NativeMailAttachmentKind> = {
  pdf: 'pdf',
  doc: 'word', docx: 'word', docm: 'word', dot: 'word', dotx: 'word', rtf: 'word', odt: 'word',
  xls: 'excel', xlsx: 'excel', xlsm: 'excel', xlt: 'excel', xltx: 'excel', xltm: 'excel', csv: 'excel', ods: 'excel',
  ppt: 'powerpoint', pptx: 'powerpoint', pptm: 'powerpoint', pot: 'powerpoint', potx: 'powerpoint', potm: 'powerpoint', odp: 'powerpoint',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', bmp: 'image', webp: 'image', tif: 'image', tiff: 'image',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio',
  mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video',
  txt: 'text', log: 'text', md: 'text', json: 'text', xml: 'text', yaml: 'text', yml: 'text',
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroenabled.12',
  dot: 'application/msword',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroenabled.12',
  xlt: 'application/vnd.ms-excel',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  xltm: 'application/vnd.ms-excel.template.macroenabled.12',
  csv: 'text/csv',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  pot: 'application/vnd.ms-powerpoint',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
  potm: 'application/vnd.ms-powerpoint.template.macroenabled.12',
  odp: 'application/vnd.oasis.opendocument.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  bz2: 'application/x-bzip2',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
};

const MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

function extension(name: unknown): string {
  const match = String(name || '').trim().match(/\.([a-z0-9]+)$/i);
  return String(match?.[1] || '').toLowerCase();
}

function normalizeMimeType(value: unknown): string {
  const mimeType = String(value || '').split(';', 1)[0].trim().toLowerCase();
  return MIME_TYPE_PATTERN.test(mimeType) ? mimeType : '';
}

export function resolveNativeMailAttachmentMimeType(
  attachment: Pick<MailAttachment, 'name' | 'content_type'>,
  downloadedMimeType?: string | null,
): string {
  const inferred = MIME_BY_EXTENSION[extension(attachment.name)];
  if (inferred) return inferred;
  return normalizeMimeType(attachment.content_type)
    || normalizeMimeType(downloadedMimeType)
    || 'application/octet-stream';
}

export function getNativeMailAttachmentKind(attachment: MailAttachment): NativeMailAttachmentKind {
  const contentType = String(attachment.content_type || '').split(';', 1)[0].trim().toLowerCase();
  const fileExtension = extension(attachment.name);
  const extensionKind = EXTENSION_KINDS[fileExtension];
  if (extensionKind) return extensionKind;
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType.includes('word') || contentType.includes('wordprocessingml')) return 'word';
  if (contentType.includes('excel') || contentType.includes('spreadsheetml') || contentType.includes('csv')) return 'excel';
  if (contentType.includes('powerpoint') || contentType.includes('presentationml')) return 'powerpoint';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.includes('zip') || contentType.includes('compressed')) return 'archive';
  if (contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml')) return 'text';
  return 'generic';
}

export function getNativeMailAttachmentVisual(attachment: MailAttachment): NativeMailAttachmentVisual {
  return VISUALS[getNativeMailAttachmentKind(attachment)];
}

export function getNativeMailAttachmentImageSource(attachment: MailAttachment): string {
  if (getNativeMailAttachmentKind(attachment) !== 'image') return '';
  const localUri = String(attachment.native_preview_uri || '').trim();
  if (/^file:\/\//i.test(localUri)) return localUri;
  const inlineSource = String(attachment.inline_data_url || attachment.inline_src || '').trim();
  return /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(inlineSource)
    ? inlineSource
    : '';
}
