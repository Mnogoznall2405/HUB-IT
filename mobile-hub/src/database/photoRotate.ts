// Поворот снимка на устройстве до загрузки: камера иногда отдаёт кадр «на боку».
// degrees — по часовой стрелке, кратно 90; отрицательное значение — против часовой.
export async function rotateLocalPhoto(uri: string, degrees: number): Promise<{ uri: string }> {
  const quarter = Math.round(Number(degrees) / 90) * 90;
  if (!Number.isFinite(quarter) || quarter % 360 === 0) return { uri };
  const ImageManipulator = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
  const result = await ImageManipulator.manipulateAsync(uri, [{ rotate: quarter }], {
    compress: 0.9,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return { uri: result.uri };
}

// После поворота файл всегда JPEG: имя и тип подгоняем под содержимое.
export function asJpegName(name: string): string {
  const base = String(name || 'photo').replace(/\.[^./\\]+$/, '');
  return `${base || 'photo'}.jpg`;
}
