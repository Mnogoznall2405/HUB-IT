import apiClient from './client';

// Распознавание серийных номеров на фото: охват и запуск пакета (запуск — только администратор).
export const equipmentPhotoOcrAPI = {
  summary: async ({ dbId = '' } = {}) => {
    const response = await apiClient.get('/equipment/photos/ocr/summary', {
      params: { db_id: dbId || undefined },
    });
    return response.data;
  },

  run: async ({ limit = 100, dbId = '' } = {}) => {
    const response = await apiClient.post(
      '/equipment/photos/ocr/run',
      { limit },
      { params: { db_id: dbId || undefined } },
    );
    return response.data;
  },
};

export default equipmentPhotoOcrAPI;
