import { equipmentPhotoUploadsAPI } from '../api/equipmentPhotoUploads';

// Загрузка фото оборудования кусками с докачкой. Идентификатор загрузки выводится из самого
// файла (имя, размер, дата изменения), поэтому повтор — в том числе после закрытия вкладки и
// повторного выбора того же файла — отправляет только недостающее и не создаёт дубль фото.

// Та же сторона, что режет сервер (ORIG_MAX_EDGE_PX): больше отправлять незачем.
export const PHOTO_UPLOAD_MAX_EDGE_PX = 2560;
const SMALL_ENOUGH_BYTES = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 0.8;
const COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Паузы между повторами при обрыве. После стольких подряд неудач без прогресса загрузка
// останавливается, а страница предлагает «Повторить» (докачка продолжится).
export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000];
const ONLINE_WAIT_MS = 30_000;

export class PermanentUploadError extends Error {}
export class LegacyUploadRequired extends Error {}

const httpStatus = (error) => Number(error?.response?.status) || 0;

// 409 — «ещё собирается / не хватает кусков», 408/429 — перегрузка: пробуем снова.
export const isPermanentFailure = (error) => {
  if (error instanceof PermanentUploadError) return true;
  const status = httpStatus(error);
  return status >= 400 && status < 500 && ![408, 409, 429].includes(status);
};

const loadBitmap = async (file) => {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  }
  throw new Error('createImageBitmap is not available');
};

// Сжатие до отправки: при плохой связи каждый мегабайт на счету. Любая ошибка сжатия
// не мешает загрузке — уходит исходный файл. Результат больше исходного не берём.
export async function shrinkPhoto(file) {
  try {
    if (!COMPRESSIBLE_TYPES.has(file.type)) return file;
    const bitmap = await loadBitmap(file);
    const { width, height } = bitmap;
    const longest = Math.max(width, height);
    if (longest <= PHOTO_UPLOAD_MAX_EDGE_PX && file.size <= SMALL_ENOUGH_BYTES) {
      bitmap.close?.();
      return file;
    }
    const scale = Math.min(1, PHOTO_UPLOAD_MAX_EDGE_PX / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY); });
    if (!blob || blob.size >= file.size) return file;
    const base = String(file.name || 'photo').replace(/\.[^.\\/]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}

const fallbackHash = (text) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const toHex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const fallbackBytesHash = (bytes, seed) => {
  let hash = seed;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

// Идентификатор загрузки. Формат w2 включает дайджест байт файла: два разных снимка с одинаковыми
// именем, размером и датой больше не получают один id (и сервер не вернёт чужой file_no).
// Формат w (legacyId) — прежний, по метаданным: им дозагружаются задания, поставленные в очередь
// до обновления, чтобы уже принятые сервером куски не пропали.
export async function makeClientId(itemId, dbId, file, { legacyId = false } = {}) {
  const seed = `${itemId}|${dbId || ''}|${file.name}|${file.size}|${file.lastModified || 0}`;
  if (legacyId) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
      return `w-${toHex(digest).slice(0, 40)}`;
    } catch {
      return `w-${fallbackHash(seed)}${fallbackHash(seed.split('').reverse().join(''))}`;
    }
  }
  const bytes = await readBlob(file);
  try {
    const content = new Uint8Array(bytes);
    const joined = new Uint8Array(new TextEncoder().encode(`${seed}|`).length + content.length);
    const head = new TextEncoder().encode(`${seed}|`);
    joined.set(head, 0);
    joined.set(content, head.length);
    return `w2-${toHex(await crypto.subtle.digest('SHA-256', joined)).slice(0, 48)}`;
  } catch {
    // Страница без защищённого контекста: тот же вход, но быстрый несекретный хеш.
    const content = new Uint8Array(bytes);
    return `w2-${fallbackBytesHash(content, 2166136261)}${fallbackBytesHash(content, 84696351)}${fallbackHash(seed)}`;
  }
}

const readBlob = (blob) => {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать файл'));
    reader.readAsArrayBuffer(blob);
  });
};

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Нет сети — ждём её возвращения, а не тратим попытки впустую.
const defaultWaitOnline = () => new Promise((resolve) => {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) { resolve(); return; }
  const finish = () => { clearTimeout(timer); window.removeEventListener('online', finish); resolve(); };
  const timer = setTimeout(finish, ONLINE_WAIT_MS);
  window.addEventListener('online', finish);
});

const defaultDeps = {
  api: equipmentPhotoUploadsAPI,
  shrink: shrinkPhoto,
  sleep: defaultSleep,
  waitOnline: defaultWaitOnline,
};

// conflictIsFinal: при создании сессии 409 означает «идентификатор занят другим файлом» — ждать нечего.
async function withRetry(run, deps, signal, { conflictIsFinal = false } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw new PermanentUploadError('Загрузка отменена');
    await deps.waitOnline();
    try {
      return await run();
    } catch (error) {
      if (isPermanentFailure(error) || signal?.aborted) throw error;
      if (conflictIsFinal && httpStatus(error) === 409) throw error;
      if (attempt >= RETRY_DELAYS_MS.length) throw error;
      await deps.sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

export async function uploadPhotoResumable(itemId, file, options = {}, overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };
  const { dbId, description = '', onProgress, signal, legacyId = false } = options;
  const prepared = await deps.shrink(file);
  const { size } = prepared;
  if (!size) throw new PermanentUploadError('Файл пуст');

  const baseId = await makeClientId(itemId, dbId, file, { legacyId });
  const params = dbId ? { db_id: dbId } : {};
  let state = null;
  // Сжатие дало другой размер, чем в прошлый раз: сервер просит новый идентификатор.
  for (let revision = 0; revision < 4 && !state; revision += 1) {
    const clientId = revision ? `${baseId}-r${revision}` : baseId;
    try {
      state = await withRetry(
        () => deps.api.create(itemId, {
          client_id: clientId,
          file_name: prepared.name,
          size,
          mime_type: prepared.type || null,
          description,
        }, params, signal),
        deps,
        signal,
        { conflictIsFinal: true },
      );
    } catch (error) {
      if ([404, 405].includes(httpStatus(error))) throw new LegacyUploadRequired('resumable upload is not supported');
      if (httpStatus(error) !== 409 || revision === 3) throw error;
    }
  }
  if (state.status === 'complete' && state.file_no) {
    return { file_no: state.file_no, item_id: itemId, file_name: prepared.name };
  }

  const have = new Set(state.received || []);
  const chunkSize = state.chunk_size;
  onProgress?.(Math.min(size, have.size * chunkSize), size);
  for (let index = 0; index < state.total_chunks; index += 1) {
    if (have.has(index)) continue;
    const offset = index * chunkSize;
    const chunk = await readBlob(prepared.slice(offset, Math.min(size, offset + chunkSize)));
    await withRetry(() => deps.api.putChunk(state.upload_id, index, chunk, signal), deps, signal);
    onProgress?.(Math.min(size, offset + chunk.byteLength), size);
  }
  return withRetry(() => deps.api.complete(state.upload_id, signal), deps, signal);
}
