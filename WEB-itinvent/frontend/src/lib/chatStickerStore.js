// Единый scoped store стикеров: наборы, избранное и «недавние» живут в
// одном месте и разделяются всеми смонтированными поверхностями —
// вкладкой стикеров в поповере и закреплённом доке (keep-alive монтирует
// её дважды) и полосой подсказок над композером. Раньше каждая держала
// своё состояние и грузила слайсы независимо.
//
// Модель подписки — как у useChatComposerTextBridge/photoUploadQueue:
// модульный subscribe + useSyncExternalStore у потребителя. Записи
// хранятся по scope-ключу `${userId}::${selectedDb}` (та же формула, что
// у кэша listPacks в api/chatStickers). Срез — иммутабельный объект;
// `dv` (data version) растёт только при смене массива данных, поэтому
// подсказки перерендериваются по факту смены контента, а не на каждый
// флип статуса загрузки.
//
// Загрузка ленивая: ensureChatStickerData вызывается видимой вкладкой
// стикеров или первым срабатыванием подсказок — прогретая скрытая вкладка
// (display:none в keep-alive) сети не трогает. Один запрос на срез на
// scope+поколение; in-flight дедуплицируется. Поколение
// (stickerStoreEpoch) растёт при полной инвалидации — поздние ответы
// ушедшей сессии состояние не засоряют.

import {
  cancelRecentStickersSync,
  chatStickersAPI,
  getStickerPacksEpoch,
  peekStickerPacksCache,
  primeStickerPacksCache,
  resolveStickerScope,
  scheduleRecentStickersSync,
} from '../api/chatStickers';
import {
  buildRecentStorageKey,
  buildStickerSearchIndex,
  notifyStickerRecentsChanged,
  readRecentStickerIds,
  RECENT_STICKERS_LIMIT,
  writeRecentStickerIds,
} from '../components/chat/stickerSearchIndex';

const SLICE_PACKS = 'packs';
const SLICE_FAVORITES = 'favorites';
const SLICE_RECENTS = 'recents';

// Операции избранного храним в журнале фиксированной длины: их эффекты
// проигрываются поверх последнего подтверждённого серверного списка, пока
// не подтверждены (см. computeFavoriteItems). 50 — с запасом, очередь
// пользователя короче на порядки.
const FAVORITE_OPLOG_LIMIT = 50;

// Подряд идущие «устаревшие» ответы listPacks (эпоха кэша успела
// инвалидироваться) перезапрашиваются автоматически — видимая вкладка не
// должна зависать на спиннере. Потолок от бесконечного цикла, если
// инвалидации идут непрерывной серией.
const STALE_PACKS_RETRY_LIMIT = 2;

const scopeRecords = new Map();
const scopeMetas = new Map();
const listeners = new Set();
let stickerStoreEpoch = 0;
// Scope, которому последним понадобились данные. Событие
// chat-sticker-packs-changed обновляет только его — рефетч не должен
// писать в записи неактивных/ушедших scope (смена аккаунта, другая БД).
let activeScopeKey = '';

const emitChange = () => {
  listeners.forEach((listener) => listener());
};

const getScopeMeta = (scopeKey) => {
  let meta = scopeMetas.get(scopeKey);
  if (!meta) {
    meta = {
      inFlight: { packs: null, favorites: null, recents: null },
      queue: Promise.resolve(),
      seq: 0,
      opLog: [],
      derived: null,
      packsStaleRetries: 0,
    };
    scopeMetas.set(scopeKey, meta);
  }
  return meta;
};

const createScopeRecord = (scope) => {
  const userId = scope?.userId ?? null;
  const key = resolveStickerScope(scope);
  const storageKey = buildRecentStorageKey(userId);
  // Тёплый API-кэш наборов (та же scope-формула) — повторное открытие
  // панели и hover→pinned переход не платят ни сетью, ни спиннером.
  const cachedPacks = peekStickerPacksCache(scope);
  const cachedPackItems = Array.isArray(cachedPacks?.items) ? cachedPacks.items : null;
  return {
    key,
    userId,
    storageKey,
    packs: {
      items: cachedPackItems || [],
      status: cachedPackItems ? 'ready' : 'idle',
      error: null,
    },
    favorites: { items: [], serverItems: [], status: 'idle', error: null },
    // «Недавние» стартуют из локальной копии — rail рендерится мгновенно,
    // серверный GET догоняет фоном (stale-while-revalidate).
    recents: { ids: readRecentStickerIds(storageKey), version: 0, status: 'idle', error: null },
    dv: { packs: 0, favorites: 0, recents: 0 },
  };
};

// Ленивое создание записи в getSnapshot — идемпотентно: первый читатель
// создаёт, остальные разделяют. Сетевых запросов здесь нет, только чтение
// тёплых кэшей/localStorage.
export const peekStickerScopeRecord = (scope) => {
  const key = resolveStickerScope(scope);
  let record = scopeRecords.get(key);
  if (!record) {
    record = createScopeRecord(scope);
    scopeRecords.set(key, record);
  }
  return record;
};

export const subscribeChatStickerStore = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getChatStickerStoreEpoch = () => stickerStoreEpoch;

// Полная инвалидация при выходе/смене аккаунта (AuthContext) и в тестах.
// Рост поколения глушит применение поздних ответов и дренаж очереди
// избранного прежнего scope.
export const invalidateChatStickerStore = () => {
  stickerStoreEpoch += 1;
  scopeRecords.clear();
  scopeMetas.clear();
  activeScopeKey = '';
  emitChange();
};

/* ─── Внутренние коммиты ─── */

// Epoch-guard: после инвалидaции (logout, смена аккаунта) ответы и
// оптимистичные коммиты прежнего поколения не применяются.
const applyScopeUpdate = (scopeKey, epochAtStart, updater) => {
  if (epochAtStart !== stickerStoreEpoch) return null;
  const current = scopeRecords.get(scopeKey);
  if (!current) return null;
  const next = updater(current);
  if (!next || next === current) return current;
  scopeRecords.set(scopeKey, next);
  emitChange();
  return next;
};

// Новый срез + dv-бамп только при смене массива данных: подписчики на dv
// (подсказки) не перерендериваются от статусных флипов.
const withSlice = (record, slice, nextSlice, dataChanged) => {
  if (nextSlice === record[slice]) return record;
  return {
    ...record,
    [slice]: nextSlice,
    dv: dataChanged ? { ...record.dv, [slice]: record.dv[slice] + 1 } : record.dv,
  };
};

// Списки бывают объектами (наборы, избранное) и строковыми id («недавние») —
// для строк берём само значение: item?.id у строки undefined.
const sameIdList = (a, b) => (
  Array.isArray(a) && Array.isArray(b)
  && a.length === b.length
  && a.every((item, index) => String(item?.id ?? item) === String(b[index]?.id ?? b[index]))
);

/* ─── Производные: секции, stickersById и ленивый поисковый индекс ─── */
// Секции и индекс строятся один раз на смену данных (по ссылкам массивов)
// и разделяются вкладкой и подсказками. stickerSections повторяет модель
// вкладки: «Недавние», «Избранные», затем наборы с pack_short_name.
const EMPTY_DERIVED = Object.freeze({
  stickersById: new Map(),
  recentStickers: [],
  stickerSections: [],
  searchIndex: null,
  packsItems: null,
  favoritesItems: null,
  recentsIds: null,
});

const buildScopeDerived = (record) => {
  const favoritesItems = record.favorites.items;
  const packsItems = record.packs.items;
  // Избранное идёт первым источником, наборы перезаписывают совпадения —
  // «недавние» резолвятся даже для стикеров из удалённых наборов.
  const stickersById = new Map([
    ...favoritesItems.map((sticker) => [String(sticker?.id || ''), sticker]),
    ...packsItems.flatMap((pack) => (pack?.stickers || []).map((sticker) => [
      String(sticker?.id || ''),
      sticker?.pack_short_name ? sticker : { ...sticker, pack_short_name: pack.short_name },
    ])),
  ]);
  const recentStickers = record.recents.ids
    .map((stickerId) => stickersById.get(stickerId))
    .filter(Boolean);
  const stickerSections = [
    { id: 'recent', title: 'Недавние', stickers: recentStickers, recent: true },
    { id: 'favorites', title: 'Избранные', stickers: favoritesItems, favorites: true },
    ...packsItems.map((pack) => ({
      ...pack,
      stickers: (pack?.stickers || []).map((sticker) => (
        sticker?.pack_short_name ? sticker : { ...sticker, pack_short_name: pack.short_name }
      )),
      recent: false,
    })),
  ];
  return {
    stickersById,
    recentStickers,
    stickerSections,
    searchIndex: null,
    packsItems,
    favoritesItems,
    recentsIds: record.recents.ids,
  };
};

export const getStickerScopeDerived = (scopeKey) => {
  const record = scopeRecords.get(scopeKey);
  if (!record) return EMPTY_DERIVED;
  const meta = getScopeMeta(scopeKey);
  const derived = meta.derived;
  if (
    derived
    && derived.packsItems === record.packs.items
    && derived.favoritesItems === record.favorites.items
    && derived.recentsIds === record.recents.ids
  ) {
    return derived;
  }
  const next = buildScopeDerived(record);
  meta.derived = next;
  return next;
};

// Индекс — самая дорогая производная: строится лениво при первом
// реальном потребителе (поиск во вкладке или подсказки по эмодзи-токену)
// и переиспользуется, пока не поменялись входные массивы.
export const getStickerSearchIndex = (scopeKey) => {
  const derived = getStickerScopeDerived(scopeKey);
  if (derived === EMPTY_DERIVED) return [];
  if (!derived.searchIndex) {
    derived.searchIndex = buildStickerSearchIndex(derived.stickerSections);
  }
  return derived.searchIndex;
};

/* ─── Загрузка срезов (once per scope+generation, in-flight dedup) ─── */

const loadStickerPacks = (scopeKey, { force = false } = {}) => {
  const record = scopeRecords.get(scopeKey);
  if (!record) return Promise.resolve(null);
  const meta = getScopeMeta(scopeKey);
  if (meta.inFlight.packs) return meta.inFlight.packs;
  if (!force && record.packs.status !== 'idle' && record.packs.status !== 'error') {
    return Promise.resolve(null);
  }
  applyScopeUpdate(scopeKey, stickerStoreEpoch, (rec) => withSlice(
    rec, SLICE_PACKS, { ...rec.packs, status: 'loading', error: null }, false,
  ));
  const epochAtStart = stickerStoreEpoch;
  // Эпоха API-кэша захватывается ДО запроса: инвалидация в пути
  // (logout, импорт, удаление набора) делает ответ устаревшим.
  const apiEpoch = getStickerPacksEpoch();
  const request = Promise.resolve()
    .then(() => chatStickersAPI.listPacks({ userId: record.userId, force }))
    .then((payload) => {
      let staleDrop = false;
      applyScopeUpdate(scopeKey, epochAtStart, (rec) => {
        if (apiEpoch !== getStickerPacksEpoch()) {
          // Устаревший ответ не применяем — срез возвращаем в idle, а
          // самовосстановление ниже честно перезапросит список (после
          // инвалидации кэша «idle» навсегда означал бы вечный спиннер).
          staleDrop = true;
          return withSlice(rec, SLICE_PACKS, { ...rec.packs, status: 'idle' }, false);
        }
        meta.packsStaleRetries = 0;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        primeStickerPacksCache({ userId: record.userId }, payload, apiEpoch);
        if (sameIdList(items, rec.packs.items)) {
          return withSlice(rec, SLICE_PACKS, { items: rec.packs.items, status: 'ready', error: null }, false);
        }
        return withSlice(rec, SLICE_PACKS, { items, status: 'ready', error: null }, true);
      });
      if (staleDrop && meta.packsStaleRetries < STALE_PACKS_RETRY_LIMIT) {
        meta.packsStaleRetries += 1;
        // Макротаск, не микротаск: слот in-flight снимает finally выше по
        // цепочке и встаёт в очередь ПОСЛЕ нашего коллбэка — микротаск
        // уперся бы в собственный дедуп и рефетч не состоялся бы.
        setTimeout(() => { void loadStickerPacks(scopeKey); }, 0);
      }
      return payload;
    })
    .catch((error) => {
      applyScopeUpdate(scopeKey, epochAtStart, (rec) => withSlice(
        rec, SLICE_PACKS, { ...rec.packs, status: 'error', error }, false,
      ));
      return null;
    });
  const tracked = request.finally(() => {
    if (meta.inFlight.packs === tracked) meta.inFlight.packs = null;
  });
  meta.inFlight.packs = tracked;
  return tracked;
};

// Серверный список избранного + проигрыш журнала операций: PUT/DELETE
// возвращают полный список, но ответ мог стартовать до более поздних
// локальных операций — их эффекты догоняются поверх. Провалившиеся
// операции из проигрыша исключены (это и есть точечный откат).
const computeFavoriteItems = (serverItems, meta) => {
  let items = Array.isArray(serverItems) ? [...serverItems] : [];
  meta.opLog.forEach((op) => {
    if (op.state === 'failed' || op.state === 'dropped') return;
    if (op.type === 'add') {
      if (!items.some((item) => String(item?.id) === op.stickerId)) items.push(op.sticker);
      return;
    }
    items = items.filter((item) => String(item?.id) !== op.stickerId);
  });
  return items;
};

const commitFavorites = (rec, meta, serverItems) => {
  const base = serverItems !== undefined ? serverItems : rec.favorites.serverItems;
  const items = computeFavoriteItems(base, meta);
  if (
    rec.favorites.serverItems === base
    && sameIdList(items, rec.favorites.items)
  ) {
    return rec;
  }
  return withSlice(rec, SLICE_FAVORITES, {
    ...rec.favorites,
    items,
    serverItems: base,
  }, !sameIdList(items, rec.favorites.items));
};

const ensureFavoriteStickers = (scopeKey) => {
  const record = scopeRecords.get(scopeKey);
  if (!record) return Promise.resolve(null);
  const meta = getScopeMeta(scopeKey);
  if (meta.inFlight.favorites) return meta.inFlight.favorites;
  if (record.favorites.status !== 'idle' && record.favorites.status !== 'error') {
    return Promise.resolve(null);
  }
  applyScopeUpdate(scopeKey, stickerStoreEpoch, (rec) => withSlice(
    rec, SLICE_FAVORITES, { ...rec.favorites, status: 'loading', error: null }, false,
  ));
  const epochAtStart = stickerStoreEpoch;
  const request = Promise.resolve()
    .then(() => chatStickersAPI.listFavorites({ userId: record.userId }))
    .then((payload) => {
      applyScopeUpdate(scopeKey, epochAtStart, (rec) => {
        // Ответ GET мог стартовать до уже подтверждённых операций —
        // их эффекты доживают в журнале и проигрываются поверх списка.
        const serverItems = Array.isArray(payload?.items) ? payload.items : [];
        const items = computeFavoriteItems(serverItems, meta);
        return withSlice(rec, SLICE_FAVORITES, {
          items, serverItems, status: 'ready', error: null,
        }, !sameIdList(items, rec.favorites.items));
      });
      return payload;
    })
    .catch(() => {
      applyScopeUpdate(scopeKey, epochAtStart, (rec) => withSlice(
        rec, SLICE_FAVORITES, { ...rec.favorites, status: 'error' }, false,
      ));
      return null;
    });
  const tracked = request.finally(() => {
    if (meta.inFlight.favorites === tracked) meta.inFlight.favorites = null;
  });
  meta.inFlight.favorites = tracked;
  return tracked;
};

const ensureRecentStickers = (scopeKey) => {
  const record = scopeRecords.get(scopeKey);
  if (!record) return Promise.resolve(null);
  const meta = getScopeMeta(scopeKey);
  if (meta.inFlight.recents) return meta.inFlight.recents;
  if (record.recents.status !== 'idle' && record.recents.status !== 'error') {
    return Promise.resolve(null);
  }
  applyScopeUpdate(scopeKey, stickerStoreEpoch, (rec) => withSlice(
    rec, SLICE_RECENTS, { ...rec.recents, status: 'loading', error: null }, false,
  ));
  const epochAtStart = stickerStoreEpoch;
  const request = Promise.resolve()
    .then(() => chatStickersAPI.listRecentStickers())
    .then((payload) => {
      applyScopeUpdate(scopeKey, epochAtStart, (rec) => {
        // Семантика как в прежнем компонентном эффекте: серверный список
        // выигрывает; version === 0 — старый backend, поднимаем локальную
        // копию; пустой список при version > 0 — сознательная очистка на
        // этом или другом устройстве (merge не воскрешает удалённое).
        const serverIds = (Array.isArray(payload?.items) ? payload.items : [])
          .map((item) => String(item?.id || '').trim())
          .filter(Boolean)
          .slice(0, RECENT_STICKERS_LIMIT);
        const serverVersion = Number(payload?.version) || 0;
        if (serverIds.length > 0) {
          writeRecentStickerIds(rec.storageKey, serverIds);
          notifyStickerRecentsChanged(rec.storageKey);
          return withSlice(rec, SLICE_RECENTS, {
            ids: serverIds, version: serverVersion, status: 'ready', error: null,
          }, !sameIdList(serverIds, rec.recents.ids));
        }
        if (serverVersion === 0) {
          const localIds = readRecentStickerIds(rec.storageKey);
          if (localIds.length > 0) scheduleRecentStickersSync(localIds, rec.storageKey);
          return withSlice(rec, SLICE_RECENTS, {
            ...rec.recents, version: serverVersion, status: 'ready', error: null,
          }, false);
        }
        if (rec.recents.ids.length > 0 || readRecentStickerIds(rec.storageKey).length > 0) {
          writeRecentStickerIds(rec.storageKey, []);
          notifyStickerRecentsChanged(rec.storageKey);
        }
        return withSlice(rec, SLICE_RECENTS, {
          ids: [], version: serverVersion, status: 'ready', error: null,
        }, rec.recents.ids.length > 0);
      });
      return payload;
    })
    .catch(() => {
      // Офлайн/старый backend — остаёмся на localStorage-копии.
      applyScopeUpdate(scopeKey, epochAtStart, (rec) => withSlice(
        rec, SLICE_RECENTS, { ...rec.recents, status: 'error' }, false,
      ));
      return null;
    });
  const tracked = request.finally(() => {
    if (meta.inFlight.recents === tracked) meta.inFlight.recents = null;
  });
  meta.inFlight.recents = tracked;
  return tracked;
};

// Единая точка «поверхности понадобились данные»: видимая вкладка
// стикеров или первый эмодзи-токен подсказок. Запросы дедуплицируются
// in-flight, срез грузится один раз на scope+поколение.
export const ensureChatStickerData = (scope) => {
  const record = peekStickerScopeRecord(scope);
  activeScopeKey = record.key;
  void loadStickerPacks(record.key);
  void ensureFavoriteStickers(record.key);
  void ensureRecentStickers(record.key);
};

/* ─── Мутации наборов ─── */

// Подтверждённое применение списка наборов (ответ listPacks/импорта/
// удаления/переупорядочивания): праймит API-кэш и коммитит срез. При
// несовпадении эпохи кэша ответ считается устаревшим и отбрасывается.
export const applyStickerPacks = (scopeKey, payload, apiEpoch) => {
  const record = scopeRecords.get(scopeKey);
  if (!record) return false;
  if (apiEpoch !== undefined && apiEpoch !== getStickerPacksEpoch()) return false;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  primeStickerPacksCache({ userId: record.userId }, payload, apiEpoch);
  applyScopeUpdate(scopeKey, stickerStoreEpoch, (rec) => (
    sameIdList(items, rec.packs.items)
      ? rec
      : withSlice(rec, SLICE_PACKS, { items, status: 'ready', error: null }, true)
  ));
  return true;
};

// Локальное (оптимистичное) переупорядочивание: без прайма кэша —
// подтверждение придёт ответом setPackOrder через applyStickerPacks,
// отказ откатывается тем же сеттером прежнего массива.
export const setStickerPackItems = (scopeKey, items) => {
  const nextItems = Array.isArray(items) ? items : [];
  applyScopeUpdate(scopeKey, stickerStoreEpoch, (rec) => (
    sameIdList(nextItems, rec.packs.items)
      ? rec
      : withSlice(rec, SLICE_PACKS, { ...rec.packs, items: nextItems }, true)
  ));
};

/* ─── Избранное: сериализованная очередь + журнал операций ─── */
// PUT/DELETE возвращают полный список — конкурентные добавления и
// удаления сериализуются в per-scope promise-цепочку, чтобы каждый запрос
// видел свежий серверный порядок, а ответы применялись строго по одному.
// Отображаемый список — «последний подтверждённый серверный + эффекты
// журнала операций», поэтому:
//   • быстрый add→remove одного стикера: ответ add'а не воскрешает его —
//     queued remove проигрывается поверх;
//   • отказ одной операции: её помечаем failed — рекомпьют исключает
//     эффект только её, параллельные операции не страдают;
//   • ответ GET/PRE-PUT старше уже подтверждённых операций — их эффекты
//     в журнале и проигрываются, пока не вытеснены (>50 операций).
const enqueueFavoriteMutation = (scopeKey, op) => {
  const record = scopeRecords.get(scopeKey);
  if (!record) return Promise.resolve({ ok: false });
  const meta = getScopeMeta(scopeKey);
  meta.seq += 1;
  op.seq = meta.seq;
  op.state = 'queued';
  meta.opLog.push(op);
  if (meta.opLog.length > FAVORITE_OPLOG_LIMIT) {
    meta.opLog.splice(0, meta.opLog.length - FAVORITE_OPLOG_LIMIT);
  }
  // Оптимистичное отображение — пересчёт от подтверждённой базы.
  applyScopeUpdate(scopeKey, stickerStoreEpoch, (rec) => commitFavorites(rec, meta));
  const epochAtStart = stickerStoreEpoch;
  meta.queue = meta.queue.then(async () => {
    if (stickerStoreEpoch !== epochAtStart) {
      // Смена аккаунта до старта запроса — мутировать под новой сессией
      // от имени прежнего пользователя нельзя.
      op.state = 'dropped';
      return { ok: false, dropped: true };
    }
    try {
      const payload = op.type === 'add'
        ? await chatStickersAPI.addFavoriteSticker(op.stickerId)
        : await chatStickersAPI.removeFavoriteSticker(op.stickerId);
      if (stickerStoreEpoch !== epochAtStart) {
        op.state = 'dropped';
        return { ok: false, dropped: true };
      }
      op.state = 'ok';
      applyScopeUpdate(scopeKey, epochAtStart, (rec) => (
        Array.isArray(payload?.items) ? commitFavorites(rec, meta, payload.items) : rec
      ));
      return { ok: true };
    } catch (error) {
      if (stickerStoreEpoch !== epochAtStart) {
        op.state = 'dropped';
        return { ok: false, dropped: true, error };
      }
      // Откат — это просто исключение операции из проигрыша: локальный
      // список пересчитывается от подтверждённой базы с остальными
      // операциями, точечно и без гонок с более поздними намерениями.
      op.state = 'failed';
      applyScopeUpdate(scopeKey, epochAtStart, (rec) => commitFavorites(rec, meta));
      return { ok: false, error };
    }
  });
  return meta.queue;
};

export const toggleFavoriteSticker = (scopeKey, sticker) => {
  const record = scopeRecords.get(scopeKey);
  if (!record) return Promise.resolve({ ok: false });
  const stickerId = String(sticker?.id || '').trim();
  if (!stickerId) return Promise.resolve({ ok: false });
  const isFavorite = record.favorites.items.some((item) => String(item?.id) === stickerId);
  return enqueueFavoriteMutation(scopeKey, { type: isFavorite ? 'remove' : 'add', stickerId, sticker });
};

/* ─── «Недавние»: локальная копия + merge-синк на сервер ─── */

export const rememberRecentSticker = (scopeKey, stickerId) => {
  const record = scopeRecords.get(scopeKey);
  const normalizedStickerId = String(stickerId || '').trim();
  if (!record || !normalizedStickerId) return;
  const next = [
    normalizedStickerId,
    ...record.recents.ids.filter((item) => item !== normalizedStickerId),
  ].slice(0, RECENT_STICKERS_LIMIT);
  applyScopeUpdate(scopeKey, stickerStoreEpoch, (rec) => (
    sameIdList(next, rec.recents.ids)
      ? rec
      : withSlice(rec, SLICE_RECENTS, { ...rec.recents, ids: next }, true)
  ));
  writeRecentStickerIds(record.storageKey, next);
  scheduleRecentStickersSync(next, record.storageKey);
  notifyStickerRecentsChanged(record.storageKey);
};

// Явное удаление/очистка — полная замена (clear:true) без дебаунса:
// merge-синк сохранил бы отсутствующие стикеры хвостом серверного
// списка. Отложенный дебаунс отменяется ДО PUT — иначе устаревший список
// вернул бы удалённое уже после замены.
export const removeRecentSticker = (scopeKey, stickerId) => {
  const record = scopeRecords.get(scopeKey);
  const normalizedStickerId = String(stickerId || '').trim();
  if (!record || !normalizedStickerId) return Promise.resolve();
  const next = record.recents.ids.filter((item) => item !== normalizedStickerId);
  applyScopeUpdate(scopeKey, stickerStoreEpoch, (rec) => (
    sameIdList(next, rec.recents.ids)
      ? rec
      : withSlice(rec, SLICE_RECENTS, { ...rec.recents, ids: next }, true)
  ));
  writeRecentStickerIds(record.storageKey, next);
  notifyStickerRecentsChanged(record.storageKey);
  cancelRecentStickersSync(record.storageKey);
  const epochAtStart = stickerStoreEpoch;
  return chatStickersAPI.pushRecentStickers(next, { clear: true })
    .then((payload) => {
      applyScopeUpdate(scopeKey, epochAtStart, (rec) => withSlice(
        rec, SLICE_RECENTS,
        { ...rec.recents, version: Number(payload?.version) || rec.recents.version },
        false,
      ));
      return { ok: true };
    })
    .catch((error) => ({ ok: false, error }));
};

export const clearRecentStickers = (scopeKey) => {
  const record = scopeRecords.get(scopeKey);
  if (!record) return Promise.resolve();
  cancelRecentStickersSync(record.storageKey);
  applyScopeUpdate(scopeKey, stickerStoreEpoch, (rec) => (
    rec.recents.ids.length === 0
      ? rec
      : withSlice(rec, SLICE_RECENTS, { ...rec.recents, ids: [] }, true)
  ));
  writeRecentStickerIds(record.storageKey, []);
  notifyStickerRecentsChanged(record.storageKey);
  const epochAtStart = stickerStoreEpoch;
  return chatStickersAPI.pushRecentStickers([], { clear: true })
    .then((payload) => {
      applyScopeUpdate(scopeKey, epochAtStart, (rec) => withSlice(
        rec, SLICE_RECENTS,
        { ...rec.recents, version: Number(payload?.version) || rec.recents.version },
        false,
      ));
      return { ok: true };
    })
    .catch((error) => ({ ok: false, error }));
};

// Единственный слушатель «наборы изменились» на весь документ — заменяет
// по слушателю на каждую смонтированную вкладку (раньше каждая
// инвалидировала кэш и шла в сеть: N вкладок → N запросов). Рефетчит
// только активный scope и только если его срез уже загружался.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('chat-sticker-packs-changed', () => {
    if (!activeScopeKey) return;
    const record = scopeRecords.get(activeScopeKey);
    if (!record || record.packs.status === 'idle') return;
    void loadStickerPacks(activeScopeKey, { force: true });
  });
}
