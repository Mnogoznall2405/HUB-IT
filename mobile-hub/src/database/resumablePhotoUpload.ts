import { File, FileMode } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import {
  completePhotoUpload,
  createPhotoUpload,
  putPhotoUploadChunk,
  type PhotoUploadState,
} from '../api/equipmentPhotoUploadApi';
import { localFileSize, preparePhotoForUpload, type PreparedPhoto } from './photoCompress';

// Загрузка фото оборудования кусками с докачкой. Сервер помнит принятые куски, а
// идентификатор загрузки выводится из самого файла, поэтому повтор (в том числе после
// перезапуска приложения) отправляет только недостающее и не создаёт дубль фото.

export type ResumableUploadFile = { uri: string; name: string; mimeType: string; uploadKey?: string };

export type ResumableUploadDeps = {
  prepare: (file: ResumableUploadFile) => Promise<PreparedPhoto>;
  readChunk: (uri: string, offset: number, length: number) => ArrayBuffer;
  makeClientId: (seed: string) => Promise<string>;
  create: typeof createPhotoUpload;
  putChunk: typeof putPhotoUploadChunk;
  complete: typeof completePhotoUpload;
  sleep: (ms: number) => Promise<void>;
};

// Пауза между повторами при обрыве; после стольких подряд неудач без прогресса
// загрузка останавливается, а очередь предлагает «Повторить» (докачка продолжится).
export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000];

export class PermanentUploadError extends Error {
  readonly permanent = true;
}

export class LegacyUploadRequired extends Error {}

function httpStatus(error: unknown): number {
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  return Number(status) || 0;
}

export function isPermanentFailure(error: unknown): boolean {
  if (error instanceof PermanentUploadError) return true;
  const status = httpStatus(error);
  // 409 — «ещё собирается / не хватает кусков», 408/429 — перегрузка: пробуем снова.
  return status >= 400 && status < 500 && ![408, 409, 429].includes(status);
}

function defaultReadChunk(uri: string, offset: number, length: number): ArrayBuffer {
  const handle = new File(uri).open(FileMode.ReadOnly);
  try {
    handle.offset = Math.max(0, Math.trunc(offset));
    const bytes = handle.readBytes(Math.max(0, Math.trunc(length)));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } finally {
    try { handle.close(); } catch { /* no-op */ }
  }
}

const defaultDeps: ResumableUploadDeps = {
  prepare: preparePhotoForUpload,
  readChunk: defaultReadChunk,
  makeClientId: async (seed) => `m-${(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, seed)).slice(0, 40)}`,
  create: createPhotoUpload,
  putChunk: putPhotoUploadChunk,
  complete: completePhotoUpload,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// Повторная подготовка того же файла должна дать тот же результат (иначе пропадёт докачка).
const preparedCache = new Map<string, PreparedPhoto>();

// conflictIsFinal: при создании сессии 409 означает «идентификатор занят другим файлом» — ждать нечего.
async function withRetry<T>(
  run: () => Promise<T>,
  deps: ResumableUploadDeps,
  signal?: AbortSignal,
  { conflictIsFinal = false }: { conflictIsFinal?: boolean } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw new PermanentUploadError('Загрузка отменена');
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

export async function uploadPhotoResumable(
  itemId: number,
  file: ResumableUploadFile,
  databaseId?: string,
  options: { signal?: AbortSignal; onProgress?: (sentBytes: number, totalBytes: number) => void } = {},
  overrides: Partial<ResumableUploadDeps> = {},
): Promise<number> {
  const deps = { ...defaultDeps, ...overrides };
  const { signal, onProgress } = options;

  // Ключ не зависит от пути к файлу: копия снимка на диске после перезапуска — тот же снимок.
  const fileKey = file.uploadKey || file.uri;
  const cacheKey = `${itemId}|${fileKey}`;
  let prepared = preparedCache.get(cacheKey);
  if (!prepared) {
    prepared = await deps.prepare(file);
    preparedCache.set(cacheKey, prepared);
  }
  const size = prepared.size || localFileSize(prepared.uri);
  if (!size) throw new PermanentUploadError('Файл фотографии пуст или недоступен');

  const baseId = await deps.makeClientId(`${itemId}|${databaseId || ''}|${fileKey}`);
  let state: PhotoUploadState | null = null;
  // Идентификатор занят файлом другого содержимого (409): берём следующую ревизию.
  for (let revision = 0; revision < 4 && !state; revision += 1) {
    const clientId = revision ? `${baseId}-r${revision}` : baseId;
    try {
      state = await withRetry(
        () => deps.create(itemId, { clientId, fileName: prepared!.name, size, mimeType: prepared!.mimeType }, databaseId, signal),
        deps,
        signal,
        { conflictIsFinal: true },
      );
    } catch (error) {
      // Сервер без докачки (старая версия): вызывающий код отправит файл целиком.
      if ([404, 405].includes(httpStatus(error))) throw new LegacyUploadRequired('resumable upload is not supported');
      if (httpStatus(error) !== 409 || revision === 3) throw error;
    }
  }
  if (!state) throw new Error('Не удалось открыть загрузку фото');
  const session = state;
  if (session.status === 'complete' && session.file_no) {
    preparedCache.delete(cacheKey);
    return Number(session.file_no);
  }

  const have = new Set(session.received);
  const chunkSize = session.chunk_size;
  let sent = Math.min(size, have.size * chunkSize);
  onProgress?.(sent, size);
  for (let index = 0; index < session.total_chunks; index += 1) {
    if (have.has(index)) continue;
    const offset = index * chunkSize;
    const length = Math.min(chunkSize, size - offset);
    const chunk = deps.readChunk(prepared.uri, offset, length);
    await withRetry(() => deps.putChunk(session.upload_id, index, chunk, signal), deps, signal);
    sent = Math.min(size, sent + length);
    onProgress?.(sent, size);
  }

  const done = await withRetry(() => deps.complete(session.upload_id, signal), deps, signal);
  preparedCache.delete(cacheKey);
  return Number(done.file_no) || 0;
}
