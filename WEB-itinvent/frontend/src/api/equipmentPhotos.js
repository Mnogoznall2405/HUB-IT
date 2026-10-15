import apiClient from './client';

export const equipmentPhotosAPI = {
  list: async (itemId, params = {}) => {
    const response = await apiClient.get(
      `/equipment/${encodeURIComponent(String(itemId))}/photos`,
      { params },
    );
    return response.data;
  },

  // rev > 0 — после поворота: сервер отдаёт фото с max-age=60, без нового URL браузер вернул бы старую картинку.
  fetchContent: async (itemId, fileNo, { thumb = false, params = {}, rev = 0 } = {}) => {
    const response = await apiClient.get(
      `/equipment/${encodeURIComponent(String(itemId))}/photos/${encodeURIComponent(String(fileNo))}/content`,
      { params: { ...params, thumb: thumb || undefined, v: rev > 0 ? rev : undefined }, responseType: 'blob' },
    );
    return response;
  },

  upload: async (itemId, file, { description = '', params = {} } = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post(
      `/equipment/${encodeURIComponent(String(itemId))}/photos`,
      formData,
      {
        params: { ...params, description: description || undefined },
        headers: { 'Content-Type': 'multipart/form-data' },
      },
    );
    return response.data;
  },

  // «Проверено»: ставит не загрузивший фото; снимает проверивший или администратор.
  verify: async (itemId, fileNo, params = {}) => {
    const response = await apiClient.post(
      `/equipment/${encodeURIComponent(String(itemId))}/photos/${encodeURIComponent(String(fileNo))}/verify`,
      null,
      { params },
    );
    return response.data;
  },

  // Отказ: причина обязательна, её увидит загрузивший.
  reject: async (itemId, fileNo, reason, params = {}) => {
    const response = await apiClient.post(
      `/equipment/${encodeURIComponent(String(itemId))}/photos/${encodeURIComponent(String(fileNo))}/reject`,
      { reason },
      { params },
    );
    return response.data;
  },

  // Правка текста причины у уже отклонённого фото (отклонивший или админ).
  updateRejectReason: async (itemId, fileNo, reason, params = {}) => {
    const response = await apiClient.patch(
      `/equipment/${encodeURIComponent(String(itemId))}/photos/${encodeURIComponent(String(fileNo))}/reject`,
      { reason },
      { params },
    );
    return response.data;
  },

  // Поворот сохранённого фото на сервере: degrees — 90, 180 или 270 по часовой стрелке.
  rotate: async (itemId, fileNo, degrees, params = {}) => {
    const response = await apiClient.post(
      `/equipment/${encodeURIComponent(String(itemId))}/photos/${encodeURIComponent(String(fileNo))}/rotate`,
      { degrees },
      { params },
    );
    return response.data;
  },

  unverify: async (itemId, fileNo, params = {}) => {
    const response = await apiClient.delete(
      `/equipment/${encodeURIComponent(String(itemId))}/photos/${encodeURIComponent(String(fileNo))}/verify`,
      { params },
    );
    return response.data;
  },

  remove: async (itemId, fileNo, params = {}) => {
    const response = await apiClient.delete(
      `/equipment/${encodeURIComponent(String(itemId))}/photos/${encodeURIComponent(String(fileNo))}`,
      { params },
    );
    return response.data;
  },
};

export default equipmentPhotosAPI;
