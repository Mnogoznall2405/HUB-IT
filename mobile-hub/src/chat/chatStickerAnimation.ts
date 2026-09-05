import { gunzipSync, strFromU8 } from 'fflate';
import type { AnimationObject } from 'lottie-react-native';

const MAX_TGS_COMPRESSED_BYTES = 512 * 1024;
const MAX_TGS_JSON_BYTES = 4 * 1024 * 1024;

export function isTgsStickerSource(mimeType?: string | null, url?: string | null): boolean {
  return String(mimeType || '').trim().toLowerCase().includes('tgsticker')
    || String(url || '').split('?', 1)[0].toLowerCase().endsWith('.tgs');
}

export function decodeTgsStickerPayload(bytes: Uint8Array): AnimationObject {
  if (!bytes.length || bytes.length > MAX_TGS_COMPRESSED_BYTES) {
    throw new Error('Некорректный размер TGS-стикера');
  }
  const jsonBytes = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  if (!jsonBytes.length || jsonBytes.length > MAX_TGS_JSON_BYTES) {
    throw new Error('Некорректный размер анимации TGS');
  }
  const value = JSON.parse(strFromU8(jsonBytes)) as Partial<AnimationObject>;
  if (
    !value
    || typeof value !== 'object'
    || typeof value.v !== 'string'
    || !Number.isFinite(value.fr)
    || !Number.isFinite(value.ip)
    || !Number.isFinite(value.op)
    || !Array.isArray(value.layers)
  ) {
    throw new Error('Некорректная анимация TGS');
  }
  return value as AnimationObject;
}

export function stickerAnimationCacheName(url: string, tgs: boolean): string {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `chat-sticker-${(hash >>> 0).toString(16)}.${tgs ? 'tgs' : 'webm'}`;
}
