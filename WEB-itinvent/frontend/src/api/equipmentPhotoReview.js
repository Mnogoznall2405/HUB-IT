import apiClient from './client';

// Очередь проверки фото: отклонённые и ещё не проверенные (нужно право database.photo_verify).
export const equipmentPhotoReviewAPI = {
  list: async ({
    status = 'rejected', q = '', offset = 0, limit = 30, sinceDays = 30, dbId = '',
  } = {}) => {
    const response = await apiClient.get('/equipment/photos/review', {
      params: {
        status,
        q: q || undefined,
        offset,
        limit,
        since_days: sinceDays,
        db_id: dbId || undefined,
      },
    });
    return response.data;
  },

  // refresh=true — после собственного действия: сервер кэширует счётчики на минуту.
  summary: async ({ sinceDays = 30, refresh = false, dbId = '' } = {}) => {
    const response = await apiClient.get('/equipment/photos/review/summary', {
      params: {
        since_days: sinceDays,
        refresh: refresh || undefined,
        db_id: dbId || undefined,
      },
    });
    return response.data;
  },
};

export default equipmentPhotoReviewAPI;
