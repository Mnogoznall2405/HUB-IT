import apiClient from './client';

export const chatUploadSessionsAPI = {
  createUploadSession: async (conversationId, payload, options = {}) => {
    const response = await apiClient.post(
      `/chat/conversations/${encodeURIComponent(conversationId)}/upload-sessions`,
      payload,
      { signal: options?.signal },
    );
    return response.data;
  },

  uploadFileChunk: async (sessionId, fileId, chunkIndex, chunk, options = {}) => {
    const response = await apiClient.put(
      `/chat/upload-sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(fileId)}/chunks/${encodeURIComponent(chunkIndex)}`,
      chunk,
      {
        params: {
          offset: Math.max(0, Number(options?.offset || 0)),
        },
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        signal: options?.signal,
      },
    );
    return response.data;
  },

  getUploadSession: async (sessionId, options = {}) => {
    const response = await apiClient.get(
      `/chat/upload-sessions/${encodeURIComponent(sessionId)}`,
      { signal: options?.signal },
    );
    return response.data;
  },

  completeUploadSession: async (sessionId, options = {}) => {
    const response = await apiClient.post(
      `/chat/upload-sessions/${encodeURIComponent(sessionId)}/complete`,
      null,
      { signal: options?.signal },
    );
    return response.data;
  },

  cancelUploadSession: async (sessionId, options = {}) => {
    const response = await apiClient.delete(
      `/chat/upload-sessions/${encodeURIComponent(sessionId)}`,
      { signal: options?.signal },
    );
    return response.data;
  },
};

export default chatUploadSessionsAPI;
