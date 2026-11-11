import apiClient from './client';

// Докачиваемая загрузка фото оборудования: сессия → куски → завершение.
// Сервер хранит принятые куски, поэтому после обрыва связи (и даже после
// перезапуска приложения) отправляется только недостающее.

export type PhotoUploadState = {
  upload_id: string;
  status: 'uploading' | 'complete';
  item_id: number;
  size: number;
  chunk_size: number;
  total_chunks: number;
  received: number[];
  file_no: number | null;
};

const CHUNK_TIMEOUT_MS = 60_000;

function scoped(databaseId?: string) {
  const normalized = String(databaseId || '').trim();
  return normalized ? { headers: { 'X-Database-ID': normalized } } : {};
}

export async function createPhotoUpload(
  itemId: number,
  payload: { clientId: string; fileName: string; size: number; mimeType: string },
  databaseId?: string,
  signal?: AbortSignal,
): Promise<PhotoUploadState> {
  const { data } = await apiClient.post(
    `/equipment/${encodeURIComponent(String(itemId))}/photo-uploads`,
    { client_id: payload.clientId, file_name: payload.fileName, size: payload.size, mime_type: payload.mimeType },
    { ...scoped(databaseId), signal },
  );
  return data as PhotoUploadState;
}

export async function putPhotoUploadChunk(
  uploadId: string,
  index: number,
  chunk: ArrayBuffer,
  signal?: AbortSignal,
): Promise<PhotoUploadState> {
  const { data } = await apiClient.put(
    `/equipment/photo-uploads/${encodeURIComponent(uploadId)}/chunks/${index}`,
    chunk,
    { headers: { 'Content-Type': 'application/octet-stream' }, timeout: CHUNK_TIMEOUT_MS, signal },
  );
  return data as PhotoUploadState;
}

export async function completePhotoUpload(
  uploadId: string,
  signal?: AbortSignal,
): Promise<{ file_no: number; item_id: number; file_name: string }> {
  const { data } = await apiClient.post(
    `/equipment/photo-uploads/${encodeURIComponent(uploadId)}/complete`,
    null,
    { timeout: CHUNK_TIMEOUT_MS, signal },
  );
  return data as { file_no: number; item_id: number; file_name: string };
}

export async function abortPhotoUpload(uploadId: string): Promise<void> {
  await apiClient.delete(`/equipment/photo-uploads/${encodeURIComponent(uploadId)}`);
}
