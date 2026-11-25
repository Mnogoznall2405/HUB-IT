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

// Та же scope-формула для единого sticker store (lib/chatStickerStore):
// ключ склеивает пользователя и выбранную БД — чужой scope никогда не
// получает данные другого контекста.
export const resolveStickerScope = (options) => resolveStickerPacksScope(options);

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
// отправки (вкладка стикеров, подсказки над композером). Очередь хранит
// только flush-коллбэк store — сами операции живут в журнале scope
// (lib/chatStickerStore). Прямо перед срабатыванием scope и сессия
// проверяются ПОВТОРНО: отложенный flush ушедшей сессии (смена аккаунта
// или выбранной БД) не должен уйти под чужим контекстом.
const RECENT_STICKERS_SYNC_DEBOUNCE_MS = 1500;
let recentStickersSyncTimer = null;
let pendingRecentStickersSync = null;

// Чтение id текущего пользователя из сессионного кэша AuthContext —
// без импорта контекста, чтобы не тянуть его в api-слой.
const readSessionUserId = () => {
  try {
    const rawUser = window?.localStorage?.getItem('user');
    const parsed = rawUser ? JSON.parse(rawUser) : null;
    return parsed?.id ?? null;
  } catch {
    return null;
  }
};

// flush() вызывается один раз по таймеру; scope — маркер
// `${userId}::${selectedDb}` (та же формула, что у resolveStickerScope).
export const scheduleRecentStickersSync = ({ userId = null, scopeKey = '' } = {}, flush) => {
  const normalizedScopeKey = String(scopeKey || '');
  if (
    pendingRecentStickersSync
    && pendingRecentStickersSync.scopeKey
    && normalizedScopeKey
    && pendingRecentStickersSync.scopeKey !== normalizedScopeKey
  ) {
    // Под чужим scope ждать нельзя — очередь прежнего контекста сбрасываем.
    pendingRecentStickersSync = null;
  }
  pendingRecentStickersSync = {
    userId,
    scopeKey: normalizedScopeKey,
    flush: typeof flush === 'function' ? flush : null,
  };
  if (recentStickersSyncTimer !== null) clearTimeout(recentStickersSyncTimer);
  recentStickersSyncTimer = setTimeout(() => {
    recentStickersSyncTimer = null;
    const pending = pendingRecentStickersSync;
    pendingRecentStickersSync = null;
    if (!pending || typeof pending.flush !== 'function') return;
    // Повторная проверка прямо перед запросом: за время дебаунса могли
    // смениться выбранная БД (scope-ключ пересчитывается из localStorage)
    // и сама сессия (запись 'user' удалена при logout/смене аккаунта).
    if (
      pending.scopeKey
      && resolveStickerScope({ userId: pending.userId }) !== pending.scopeKey
    ) {
      return;
    }
    const pendingUserId = pending.userId;
    const hasPendingUser = pendingUserId !== null
      && pendingUserId !== undefined
      && String(pendingUserId) !== '';
    if (hasPendingUser && String(readSessionUserId() ?? '') !== String(pendingUserId)) {
      return;
    }
    Promise.resolve()
      .then(() => pending.flush())
      .catch(() => {
        // Синхронизация не критична: операции остаются в журнале store,
        // их довезёт следующий flush или переход в онлайн.
      });
  }, RECENT_STICKERS_SYNC_DEBOUNCE_MS);
};

export const cancelRecentStickersSync = (scopeKey = '') => {
  const normalizedScopeKey = String(scopeKey || '');
  // Отменяем только свою очередь: чужой pending (другого scope) не трогаем.
  if (
    normalizedScopeKey
    && pendingRecentStickersSync?.scopeKey
    && pendingRecentStickersSync.scopeKey !== normalizedScopeKey
  ) {
    return;
  }
  if (recentStickersSyncTimer !== null) {
    clearTimeout(recentStickersSyncTimer);
    recentStickersSyncTimer = null;
  }
  pendingRecentStickersSync = null;
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
    // Список наборов изменился так же, как при импорте: сбрасываем кэш,
    // чтобы listPacks у любого потребителя не вернул удалённый набор.
    invalidateStickerPacksCache();
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

  // Версионированный op-синк: клиент шлёт накопленные ДЕЛЬТА-операции
  // ({op:'bump'|'remove'|'clear', sticker_id}) от последней подтверждённой
  // версии, а не весь список — устаревший список другого устройства не может
  // воскресить сознательно удалённые записи, потому что delta называет
  // только реально затронутые id. ``stickerIds`` — legacy bump-head merge
  // для миграции локальной копии при version===0; ``clear`` — полная замена
  // (или ведущий clear перед ops). ``batchId`` — idempotency key пакета:
  // клиент сохраняет его между retry, и сервер отвечает на повторную
  // доставку того же пакета текущим состоянием без повторного применения.
  // Ответ {items, version} — авторитетный merge-результат, применяемый
  // store как новая база.
  pushRecentStickers: async ({ ops = [], stickerIds = null, baseVersion = null, clear = false, batchId = null } = {}) => {
    const body = {};
    const normalizedOps = (Array.isArray(ops) ? ops : [])
      .map((entry) => ({
        op: String(entry?.op || '').trim(),
        sticker_id: String(entry?.sticker_id || '').trim(),
      }))
      .filter((entry) => (
        entry.op === 'clear' || (entry.sticker_id && (entry.op === 'bump' || entry.op === 'remove'))
      ))
      .map((entry) => (entry.op === 'clear' ? { op: 'clear' } : entry));
    if (normalizedOps.length > 0) body.ops = normalizedOps;
    if (Array.isArray(stickerIds)) {
      body.sticker_ids = stickerIds
        .map((stickerId) => String(stickerId || '').trim())
        .filter(Boolean);
    }
    if (clear === true) body.clear = true;
    if (Number.isFinite(baseVersion)) body.base_version = baseVersion;
    const normalizedBatchId = String(batchId || '').trim();
    if (normalizedBatchId) body.op_batch_id = normalizedBatchId;
    const response = await apiClient.put('/chat/stickers/recent', body);
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
