import { Image } from 'expo-image';
import { clearNativeImageCache, nativeImageCacheKey, removeNativeImageCacheEntry } from './nativeImageCache';

const mockDelete = jest.fn();
jest.mock('expo-file-system', () => ({
  File: jest.fn(function () { return { exists: true, delete: mockDelete }; }),
}));

it('keeps stable cache keys while isolating users and server image versions', () => {
  const uri = 'https://hub.test/photo?v=1';
  expect(nativeImageCacheKey(7, uri)).toBe(nativeImageCacheKey(7, uri));
  expect(nativeImageCacheKey(7, uri)).not.toBe(nativeImageCacheKey(8, uri));
  expect(nativeImageCacheKey(7, uri)).not.toBe(nativeImageCacheKey(7, uri.replace('v=1', 'v=2')));
  expect(() => nativeImageCacheKey(0, uri)).toThrow();
});

it('removes only a failed native cache entry so a repair can be cached again', async () => {
  const { File } = jest.requireMock('expo-file-system');
  (Image.getCachePathAsync as jest.Mock).mockResolvedValueOnce('/private/cache/broken');
  await removeNativeImageCacheEntry('broken-key');
  expect(File).toHaveBeenCalledWith('file:///private/cache/broken');
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(Image.clearDiskCache).not.toHaveBeenCalled();
});

it('reports native cache cleanup failure while attempting both memory and disk', async () => {
  (Image.clearDiskCache as jest.Mock).mockResolvedValueOnce(false);
  await expect(clearNativeImageCache()).rejects.toThrow('Не удалось полностью очистить');
  expect(Image.clearMemoryCache).toHaveBeenCalledTimes(1);
  expect(Image.clearDiskCache).toHaveBeenCalledTimes(1);
});
