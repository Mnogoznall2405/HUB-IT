import { Share } from 'react-native';
import { HUB_WEB_ORIGIN } from '../api/config';

export type NativeOutgoingTextShare = {
  title: string;
  text: string;
  url: string;
};

export function normalizeNativeOutgoingTextShare(
  value: unknown,
  trustedOrigin = HUB_WEB_ORIGIN,
): NativeOutgoingTextShare {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Некорректные параметры отправки');
  }
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload).sort();
  if (keys.some((key) => !['text', 'title', 'url'].includes(key))) {
    throw new Error('Некорректные параметры отправки');
  }
  const title = String(payload.title || '').trim();
  const text = String(payload.text || '').trim();
  const rawUrl = String(payload.url || '').trim();
  if (title.length > 200 || text.length > 4_000) {
    throw new Error('Текст для отправки слишком большой');
  }
  let url = '';
  if (rawUrl) {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || parsed.origin !== String(trustedOrigin || '').replace(/\/$/, '')) {
      throw new Error('Разрешено отправлять только ссылки HUB-IT');
    }
    url = parsed.toString();
  }
  if (!title && !text && !url) throw new Error('Нет текста или ссылки для отправки');
  return { title, text, url };
}

export async function shareNativeText(value: unknown): Promise<{ opened: true }> {
  const payload = normalizeNativeOutgoingTextShare(value);
  const message = [payload.text, payload.url].filter(Boolean).join('\n\n') || payload.title;
  await Share.share({
    title: payload.title || 'HUB-IT',
    message,
  });
  return { opened: true };
}
