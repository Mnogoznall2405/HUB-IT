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
export const getStickerPacksEpoch = () => stickerPacksEpoch;
export const primeStickerPacksCache = (options, payload, expectedEpoch) => {
  // Epoch guard — компонент, получивший ответ устаревшего запроса, не может
  // им репопулировать кэш: запись пропускается, payload возвращается вызвавшему.
  if (expectedEpoch !== undefined && expectedEpoch !== stickerPacksEpoch) return payload;
  stickerPacksCacheByScope.set(resolveStickerPacksScope(options), payload);
  return payload;
};
export const invalidateStickerPacksCache = () => {
  stickerPacksCacheByScope.clear();
  stickerPacksInFlightByScope.clear();
  stickerPacksEpoch += 1;
};

// Общая trailing-debounce очередь синка «недавних» для всех поверхностей
// отправки (вкладка стикеров, подсказки над композером): серия записей
// схлопывается в один PUT, а scope-маркер не даёт списку ушедшего
// пользователя улететь под чужой сессией после смены аккаунта.
const RECENT_STICKERS_SYNC_DEBOUNCE_MS = 1500;
let recentStickersSyncTimer = null;
let pendingRecentStickerIds = null;
let pendingRecentStickersScope = '';

export const scheduleRecentStickersSync = (stickerIds, scopeKey = '') => {
  if (
    pendingRecentStickerIds !== null
    && pendingRecentStickersScope
    && scopeKey
    && pendingRecentStickersScope !== scopeKey
  ) {
    // Под чужим scope ждать нельзя — список прежнего пользователя сбрасываем.
    pendingRecentStickerIds = null;
  }
  pendingRecentStickerIds = (Array.isArray(stickerIds) ? stickerIds : [])
    .map((stickerId) => String(stickerId || '').trim())
    .filter(Boolean);
  pendingRecentStickersScope = scopeKey;
  if (recentStickersSyncTimer !== null) clearTimeout(recentStickersSyncTimer);
  recentStickersSyncTimer = setTimeout(() => {
    recentStickersSyncTimer = null;
    const stickerIdsToPush = pendingRecentStickerIds || [];
    pendingRecentStickerIds = null;
    chatStickersAPI.pushRecentStickers(stickerIdsToPush).catch(() => {
      // Синхронизация не критична: локальная копия в localStorage уже
      // актуальна, следующая успешная запись довезёт список целиком.
    });
  }, RECENT_STICKERS_SYNC_DEBOUNCE_MS);
};

export const cancelRecentStickersSync = (scopeKey = '') => {
  // Отменяем только свою очередь: чужой pending (другого scope) не трогаем.
  if (scopeKey && pendingRecentStickersScope && scopeKey !== pendingRecentStickersScope) return;
  if (recentStickersSyncTimer !== null) {
    clearTimeout(recentStickersSyncTimer);
    recentStickersSyncTimer = null;
  }
  pendingRecentStickerIds = null;
  pendingRecentStickersScope = '';
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
      });
    const tracked = request.finally(() => {
      // Identity-check: после инвалидации слот мог занять более новый
      // запрос того же scope — устаревший finally не должен его снимать.
      if (stickerPacksInFlightByScope.get(scope) === tracked) {
        stickerPacksInFlightByScope.delete(scope);
      }
    });
    stickerPacksInFlightByScope.set(scope, tracked);
    return tracked;
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
    // Список наборов изменился: сбрасываем кэш всех scope и повышаем epoch,
    // чтобы запрос listPacks, летевший во время импорта, не перезаписал
    // свежий список ответом без нового набора.
    invalidateStickerPacksCache();
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

  // Избранное живёт на сервере и может включать стикеры из неустановленных
  // наборов — без локального кэша, чтобы панель всегда показывала свежий список.
  listFavorites: async (options = {}) => {
    const response = await apiClient.get('/chat/stickers/favorites', {
      signal: options?.signal,
    });
    return response.data;
  },

  // Идемпотентно: PUT/DELETE возвращают актуальный список избранного.
  addFavoriteSticker: async (stickerId) => {
    const response = await apiClient.put(
      `/chat/stickers/favorites/${encodeURIComponent(String(stickerId || '').trim())}`,
    );
    return response.data;
  },

  removeFavoriteSticker: async (stickerId) => {
    const response = await apiClient.delete(
      `/chat/stickers/favorites/${encodeURIComponent(String(stickerId || '').trim())}`,
    );
    return response.data;
  },

  // Недавние синхронизируются с сервером; localStorage — только офлайн-кэш.
  listRecentStickers: async (options = {}) => {
    const response = await apiClient.get('/chat/stickers/recent', {
      signal: options?.signal,
    });
    return response.data;
  },

  // Полная замена списка: сервер дедуплицирует и обрезает до 50.
  pushRecentStickers: async (stickerIds) => {
    const response = await apiClient.put('/chat/stickers/recent', {
      sticker_ids: (Array.isArray(stickerIds) ? stickerIds : [])
        .map((stickerId) => String(stickerId || '').trim())
        .filter(Boolean),
    });
    return response.data;
  },

  // Порядок наборов персистентен — после перестановки кэш списка устаревает.
  setPackOrder: async (packIds) => {
    const response = await apiClient.post('/chat/sticker-packs/order', {
      pack_ids: (Array.isArray(packIds) ? packIds : [])
        .map((packId) => String(packId || '').trim())
        .filter(Boolean),
    });
    invalidateStickerPacksCache();
    return response.data;
  },
};

export default chatStickersAPI;
