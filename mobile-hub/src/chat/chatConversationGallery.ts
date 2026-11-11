export type ChatGalleryKind = 'image' | 'video' | 'file';

export const CHAT_GALLERY_TABS: Array<{ key: ChatGalleryKind; label: string }> = [
  { key: 'image', label: 'Фото' },
  { key: 'video', label: 'Видео' },
  { key: 'file', label: 'Файлы' },
];

export function chatGalleryEmptyLabel(kind: ChatGalleryKind): string {
  if (kind === 'video') return 'Нет видео';
  if (kind === 'file') return 'Нет файлов';
  return 'Нет фото';
}

export function chatGalleryItemLabel(attachment: {
  kind?: string | null;
  media_kind?: string | null;
  file_name?: string | null;
}): string {
  const name = String(attachment.file_name || '').trim() || 'из диалога';
  const kind = String(attachment.media_kind || attachment.kind || '').trim();
  if (kind === 'video') return `Открыть видео ${name}`;
  if (kind === 'file' || kind === 'audio') return `Открыть файл ${name}`;
  return `Открыть фото ${name}`;
}
