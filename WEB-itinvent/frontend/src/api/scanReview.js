import apiClient from './client';

export const scanReviewAPI = {
  getReviewItems: async (params = {}, options = {}) => {
    const response = await apiClient.get('/scan/review-items', {
      params: { view: 'summary', ...params },
      signal: options?.signal,
    });
    return response.data;
  },
};

export default scanReviewAPI;
