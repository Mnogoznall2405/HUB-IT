// Поворот снимка на клиенте перед загрузкой: камера телефона иногда отдаёт кадр «на боку».
// Всегда считаем от исходного файла, чтобы повторные повороты не копили потери качества.

const loadBitmap = async (file) => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Не удалось прочитать изображение'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

const withExtension = (name, extension) => {
  const base = String(name || 'photo').replace(/\.[^.\\/]+$/, '');
  return `${base || 'photo'}${extension}`;
};

// degrees — по часовой стрелке, кратно 90. 0 возвращает исходный файл без перекодирования.
export async function rotateImageFile(file, degrees) {
  const angle = (((Math.round(Number(degrees) / 90) * 90) % 360) + 360) % 360;
  if (!angle) return file;
  const bitmap = await loadBitmap(file);
  const width = bitmap.width || bitmap.naturalWidth;
  const height = bitmap.height || bitmap.naturalHeight;
  const swap = angle === 90 || angle === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? height : width;
  canvas.height = swap ? width : height;
  const context = canvas.getContext('2d');
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((angle * Math.PI) / 180);
  context.drawImage(bitmap, -width / 2, -height / 2);
  if (typeof bitmap.close === 'function') bitmap.close();
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((resolve) => { canvas.toBlob(resolve, type, 0.92); });
  if (!blob) throw new Error('Не удалось повернуть изображение');
  return new File([blob], withExtension(file.name, type === 'image/png' ? '.png' : '.jpg'), { type });
}
