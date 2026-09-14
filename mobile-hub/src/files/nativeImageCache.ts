import { Image } from 'expo-image';
import { File } from 'expo-file-system';

/** URLs include the server's image version; auth-token rotation must not bust the cache. */
export function nativeImageCacheKey(userId: number, uri: string): string {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Сессия недоступна');
  return JSON.stringify(['hubit-image-v1', userId, uri]);
}

/** Repair only the failed entry returned by the native cache, never other images. */
export async function removeNativeImageCacheEntry(cacheKey: string): Promise<void> {
  const path = await Image.getCachePathAsync(cacheKey);
  if (!path) return;
  const file = new File(path.startsWith('file:') ? path : `file://${path}`);
  if (file.exists) file.delete();
}

export async function clearNativeImageCache(): Promise<void> {
  const results = await Promise.allSettled([Image.clearMemoryCache(), Image.clearDiskCache()]);
  if (results.some((result) => result.status === 'rejected' || !result.value)) {
    throw new Error('Не удалось полностью очистить кэш изображений');
  }
}
