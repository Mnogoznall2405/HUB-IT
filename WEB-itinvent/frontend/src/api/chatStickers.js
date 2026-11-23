import apiClient from './http';

// Список наборов меняется редко (импорт/удаление), а панель эмодзи
// открывается часто — кэшируем ответ на время сессии и дедуплицируем
// параллельные запросы, чтобы повторное открытие было мгновенным.
// Кэш scoped по пользователю и выбранной БД: backend возвращает наборы с
// учётом current_user.id (приватные/общие), а заголовок X-Database-ID
// может менять контекст — чужие данные недоступны по чужому ключу.
const stickerPacksCacheByScope = new Map();
const stickerPacksInFlightByScope = new Map();
// Эпоха растёт при инвалидации: ответ запроса, начатого до неё, кэш не
// засоряет — иначе гонка «запрос → инвалидировать → поздний ответ»
// вернула бы устаревший список.
let stickerPacksEpoch = 0;

const getSelectedDatabaseScopePart = () => {
  try {
    return String(window?.localStorage?.getItem('selected_database') || '').trim();
  } catch {
    return '';
  }
};

const resolveStickerPacksScope = (options) => (
  `${String(options?.userId || 'anon')}::${getSelectedDatabaseScopePart() || 'default'}`
);

export const peekStickerPacksCache = (options) => (
  stickerPacksCacheByScope.get(resolveStickerPacksScope(options)) || null
);
export const primeStickerPacksCache = (options, payload) => {
  stickerPacksCacheByScope.set(resolveStickerPacksScope(options), payload);
  return payload;
};
export const invalidateStickerPacksCache = () => {
  stickerPacksCacheByScope.clear();
  stickerPacksInFlightByScope.clear();
  stickerPacksEpoch += 1;
};

export const chatStickersAPI = {
  listPacks: async (options = {}) => {
    const scope = resolveStickerPacksScope(options);
    const cached = stickerPacksCacheByScope.get(scope);
    if (!options?.force && cached) return cached;
    const inFlight = stickerPacksInFlightByScope.get(scope);
    if (inFlight) return inFlight;
    const epochAtStart = stickerPacksEpoch;
    const request = apiClient.get('/chat/sticker-packs')
      .then((response) => {
        if (epochAtStart === stickerPacksEpoch) {
          stickerPacksCacheByScope.set(scope, response.data);
        }
        return response.data;
      })
      .finally(() => {
        stickerPacksInFlightByScope.delete(scope);
      });
    stickerPacksInFlightByScope.set(scope, request);
    return request;
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
        client_message_id: options?.client_message_id || undefined,
        reply_to_message_id: options?.reply_to_message_id || undefined,
      },
    );
    return response.data;
  },
};

export default chatStickersAPI;
