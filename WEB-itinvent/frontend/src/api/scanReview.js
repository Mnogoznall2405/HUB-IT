import apiClient from './client';

export const scanReviewAPI = {
  getReviewItems: async (params = {}) => {
    const response = await apiClient.get('/scan/review-items', { params });
    return response.data;
  },
};

export default scanReviewAPI;
