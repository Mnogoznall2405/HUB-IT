import apiClient from './client';

export const chatStickersAPI = {
  listPacks: async () => {
    const response = await apiClient.get('/chat/sticker-packs');
    return response.data;
  },

  previewPack: async (shortName, options = {}) => {
    const response = await apiClient.get(
      `/chat/sticker-packs/preview/${encodeURIComponent(String(shortName || '').trim())}`,
      { signal: options?.signal },
    );
    return response.data;
  },

  importPack: async (source) => {
    const response = await apiClient.post(
      '/chat/sticker-packs/import',
      {
        source: String(source || '').trim(),
      },
      {
        // Telegram packs can contain hundreds of files. Keep the ordinary
        // 30-second API timeout everywhere else, but let this import finish.
        timeout: 120000,
      },
    );
    return response.data;
  },

  removePack: async (packId) => {
    const response = await apiClient.delete(`/chat/sticker-packs/${encodeURIComponent(packId)}`);
    return response.data;
  },

  sendSticker: async (conversationId, stickerId, options = {}) => {
    const response = await apiClient.post(
      `/chat/conversations/${encodeURIComponent(conversationId)}/messages/sticker`,
      {
        sticker_id: stickerId,
        reply_to_message_id: options?.reply_to_message_id || undefined,
      },
    );
    return response.data;
  },
};

export default chatStickersAPI;
