import apiClient from './client';

// Докачиваемая загрузка фото оборудования: сессия → куски → завершение.
// Сервер хранит принятые куски, поэтому после обрыва связи отправляется только недостающее.

const CHUNK_TIMEOUT_MS = 60_000;

export const equipmentPhotoUploadsAPI = {
  create: async (itemId, payload, params = {}, signal) => {
    const response = await apiClient.post(
      `/equipment/${encodeURIComponent(String(itemId))}/photo-uploads`,
      payload,
      { params, signal },
    );
    return response.data;
  },

  putChunk: async (uploadId, index, chunk, signal) => {
    const response = await apiClient.put(
      `/equipment/photo-uploads/${encodeURIComponent(uploadId)}/chunks/${index}`,
      chunk,
      { headers: { 'Content-Type': 'application/octet-stream' }, timeout: CHUNK_TIMEOUT_MS, signal },
    );
    return response.data;
  },

  complete: async (uploadId, signal) => {
    const response = await apiClient.post(
      `/equipment/photo-uploads/${encodeURIComponent(uploadId)}/complete`,
      null,
      { timeout: CHUNK_TIMEOUT_MS, signal },
    );
    return response.data;
  },

  abort: async (uploadId) => {
    const response = await apiClient.delete(`/equipment/photo-uploads/${encodeURIComponent(uploadId)}`);
    return response.data;
  },
};
