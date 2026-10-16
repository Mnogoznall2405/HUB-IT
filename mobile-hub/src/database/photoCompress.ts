import { File } from 'expo-file-system';

// Максимальная сторона — как на сервере (ORIG_MAX_EDGE_PX): больше сервер всё равно срежет.
export const PHOTO_UPLOAD_MAX_EDGE_PX = 2560;
const PHOTO_UPLOAD_JPEG_QUALITY = 0.8;

export type PreparedPhoto = { uri: string; name: string; mimeType: string; size: number };

export function localFileSize(uri: string): number {
  return Number(new File(uri).size || 0);
}

// Сжатие снимка на устройстве до отправки: при плохой связи каждый мегабайт на счету.
// Ошибка сжатия не мешает загрузке — уходит исходный файл. Если после сжатия файл
// не меньше исходного, тоже оставляем исходный.
export async function preparePhotoForUpload(file: {
  uri: string;
  name: string;
  mimeType: string;
}): Promise<PreparedPhoto> {
  const original = { uri: file.uri, name: file.name, mimeType: file.mimeType, size: localFileSize(file.uri) };
  try {
    const ImageManipulator = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    const probe = await ImageManipulator.manipulateAsync(file.uri, [], {
      compress: PHOTO_UPLOAD_JPEG_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    const longest = Math.max(Number(probe.width) || 0, Number(probe.height) || 0);
    let result = probe;
    if (longest > PHOTO_UPLOAD_MAX_EDGE_PX) {
      const landscape = Number(probe.width) >= Number(probe.height);
      result = await ImageManipulator.manipulateAsync(
        file.uri,
        [{ resize: landscape ? { width: PHOTO_UPLOAD_MAX_EDGE_PX } : { height: PHOTO_UPLOAD_MAX_EDGE_PX } }],
        { compress: PHOTO_UPLOAD_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
      );
    }
    const size = localFileSize(result.uri);
    if (!size || (original.size && size >= original.size)) return original;
    const base = String(file.name || 'photo').replace(/\.[^./\\]+$/, '') || 'photo';
    return { uri: result.uri, name: `${base}.jpg`, mimeType: 'image/jpeg', size };
  } catch {
    return original;
  }
}
