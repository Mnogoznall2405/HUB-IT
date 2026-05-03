import apiClient from './client';

export const kbAPI = {
  getServices: async () => {
    const response = await apiClient.get('/kb/services');
    return response.data;
  },

  getCards: async (params = {}) => {
    const response = await apiClient.get('/kb/cards', { params });
    return response.data;
  },

  getCard: async (cardId) => {
    const response = await apiClient.get(`/kb/cards/${encodeURIComponent(cardId)}`);
    return response.data;
  },

  createCard: async (payload) => {
    const response = await apiClient.post('/kb/cards', payload);
    return response.data;
  },

  updateCard: async (cardId, payload) => {
    const response = await apiClient.patch(`/kb/cards/${encodeURIComponent(cardId)}`, payload);
    return response.data;
  },

  setCardStatus: async (cardId, payload) => {
    const response = await apiClient.post(`/kb/cards/${encodeURIComponent(cardId)}/status`, payload);
    return response.data;
  },

  getCategories: async () => {
    const response = await apiClient.get('/kb/categories');
    return response.data;
  },

  getArticles: async (params = {}) => {
    const response = await apiClient.get('/kb/articles', { params });
    return response.data;
  },

  getArticle: async (articleId) => {
    const response = await apiClient.get(`/kb/articles/${encodeURIComponent(articleId)}`);
    return response.data;
  },

  createArticle: async (payload) => {
    const response = await apiClient.post('/kb/articles', payload);
    return response.data;
  },

  updateArticle: async (articleId, payload) => {
    const response = await apiClient.patch(`/kb/articles/${encodeURIComponent(articleId)}`, payload);
    return response.data;
  },

  setArticleStatus: async (articleId, payload) => {
    const response = await apiClient.post(`/kb/articles/${encodeURIComponent(articleId)}/status`, payload);
    return response.data;
  },

  getFeed: async (params = {}) => {
    const response = await apiClient.get('/kb/feed', { params });
    return response.data;
  },

  uploadAttachment: async (articleId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post(`/kb/articles/${encodeURIComponent(articleId)}/attachments`, formData);
    return response.data;
  },

  downloadAttachment: async (articleId, attachmentId) => {
    const response = await apiClient.get(
      `/kb/articles/${encodeURIComponent(articleId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { responseType: 'blob' },
    );
    return response;
  },

  removeAttachment: async (articleId, attachmentId) => {
    const response = await apiClient.delete(
      `/kb/articles/${encodeURIComponent(articleId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    return response.data;
  },
};

export default kbAPI;
