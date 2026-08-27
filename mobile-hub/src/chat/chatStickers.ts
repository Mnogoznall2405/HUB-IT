import * as SecureStore from 'expo-secure-store';
import type { ChatAttachment, ChatSticker, ChatStickerPack } from '../api/types';

const STORAGE_KEY = 'hubit_native_chat_recent_stickers_v1';
const MAX_RECENT = 20;

type StickerImageSource = {
  preview_url?: string | null;
  file_url?: string | null;
  variant_urls?: Record<string, string>;
  original_url?: string | null;
  download_url?: string | null;
  url?: string | null;
  mime_type?: string | null;
};

export function isStickerChatAttachment(attachment?: ChatAttachment | null): boolean {
  if (!attachment) return false;
  const kind = String(attachment.media_kind || attachment.kind || '').trim().toLowerCase();
  if (kind === 'file' || kind === 'image' || kind === 'video' || kind === 'audio') return false;
  if (kind === 'sticker') return true;
  const mime = String(attachment.mime_type || '').toLowerCase();
  if (mime.includes('tgsticker')) return true;
  const name = String(attachment.file_name || '').toLowerCase();
  return name.startsWith('sticker-') && (
    name.endsWith('.tgs') || name.endsWith('.webp') || name.endsWith('.webm')
  );
}

export function isAnimatedStickerSource(source?: StickerImageSource | null): boolean {
  const mime = String(source?.mime_type || '').toLowerCase();
  return mime.includes('tgsticker') || mime.startsWith('video/');
}

export function stickerEmojiLabel(value?: string | null): string {
  const text = String(value || '').trim();
  if (!text || text.includes('.') || text.toLowerCase().startsWith('sticker-')) return '';
  return text;
}

export function deriveStickerPreviewUrl(fileUrl?: string | null): string | null {
  const source = String(fileUrl || '').trim();
  if (!source) return null;
  const [path, query = ''] = source.split('?', 2);
  if (!/(?:\/chat\/stickers\/[^/]+|\/chat\/sticker-packs\/preview\/[^/]+\/stickers\/[^/]+)\/file$/i.test(path)) {
    return null;
  }
  return `${path.replace(/\/file$/i, '/preview')}${query ? `?${query}` : ''}`;
}

export function pickStickerImageUrl(sticker?: StickerImageSource | null): string | null {
  const preview = String(
    sticker?.preview_url
    || sticker?.variant_urls?.preview
    || sticker?.variant_urls?.thumbnail
    || sticker?.variant_urls?.thumb
    || '',
  ).trim();
  if (preview) return preview;
  const derivedPreview = deriveStickerPreviewUrl(sticker?.file_url);
  if (derivedPreview) return derivedPreview;
  if (isAnimatedStickerSource(sticker)) return null;
  return String(sticker?.file_url || sticker?.original_url || sticker?.download_url || sticker?.url || '').trim() || null;
}

export function stickerFromChatAttachment(attachment: ChatAttachment): Pick<ChatSticker, 'id' | 'emoji' | 'preview_url' | 'file_url' | 'mime_type'> {
  return {
    id: attachment.id,
    emoji: stickerEmojiLabel(attachment.file_name),
    mime_type: attachment.mime_type || undefined,
    preview_url: pickStickerImageUrl({
      preview_url: attachment.preview_url,
      variant_urls: attachment.variant_urls,
      mime_type: attachment.mime_type,
    }),
    file_url: String(
      attachment.original_url || attachment.download_url || attachment.url || '',
    ).trim() || undefined,
  };
}

export function collectRecentStickers(
  packs: ChatStickerPack[],
  recentIds: string[],
): ChatSticker[] {
  const byId = new Map<string, ChatSticker>();
  packs.forEach((pack) => {
    pack.stickers.forEach((sticker) => {
      if (sticker.id) byId.set(sticker.id, sticker);
    });
  });
  return recentIds
    .map((id) => byId.get(id))
    .filter((item): item is ChatSticker => Boolean(item));
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, MAX_RECENT);
}

export async function getRecentStickerIds(userId: number): Promise<string[]> {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    return normalizeIds(parsed[String(userId)]);
  } catch {
    return [];
  }
}

export async function rememberRecentSticker(userId: number, stickerId: string): Promise<string[]> {
  const id = String(stickerId || '').trim();
  if (!Number.isInteger(userId) || userId <= 0 || !id) return [];
  const current = await getRecentStickerIds(userId);
  const next = [id, ...current.filter((item) => item !== id)].slice(0, MAX_RECENT);
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    parsed[String(userId)] = next;
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore store failures
  }
  return next;
}
