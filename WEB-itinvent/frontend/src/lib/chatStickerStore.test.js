// Матрица гонок единого sticker store. E2E/компонентные тесты покрывают
// happy path вкладки; здесь — переходы состояний, которые через UI
// воспроизводятся только таймингом: сериализация мутаций избранного,
// проигрыш журнала операций поверх поздних ответов, точечный откат,
// сброс по смене поколения и самовосстановление после устаревшего
// ответа listPacks.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelRecentStickersSync,
  chatStickersAPI,
  peekStickerPacksCache,
  scheduleRecentStickersSync,
} from '../api/chatStickers';
import {
  applyStickerPacks,
  clearRecentStickers,
  ensureChatStickerData,
  getStickerScopeDerived,
  invalidateChatStickerStore,
  peekStickerScopeRecord,
  rememberRecentSticker,
  removeRecentSticker,
  setStickerPackItems,
  subscribeChatStickerStore,
  toggleFavoriteSticker,
} from './chatStickerStore';

const stickerEpochRef = { value: 0 };
vi.mock('../api/chatStickers', () => {
  const chatStickersAPI = {
    listPacks: vi.fn(),
    listFavorites: vi.fn(),
    addFavoriteSticker: vi.fn(),
    removeFavoriteSticker: vi.fn(),
    listRecentStickers: vi.fn(),
    pushRecentStickers: vi.fn(),
  };
  return {
    chatStickersAPI,
    scheduleRecentStickersSync: vi.fn(),
    cancelRecentStickersSync: vi.fn(),
    getStickerPacksEpoch: vi.fn(() => stickerEpochRef.value),
    peekStickerPacksCache: vi.fn(() => null),
    primeStickerPacksCache: vi.fn((scope, payload) => payload),
    invalidateStickerPacksCache: vi.fn(() => { stickerEpochRef.value += 1; }),
    resolveStickerScope: vi.fn((options) => (
      `${String(options?.userId || 'anon')}::${String(window.localStorage.getItem('selected_database') || 'default')}`
    )),
  };
});

// Микротасковые каскады (then-цепочки очереди избранного и рефетч) честнее
// всего дожидаться макротаском — он пропускает вперёд всю очередь промисов.
const flushPromises = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const makeSticker = (id, emoji = '😀') => ({
  id,
  emoji,
  format: 'static',
  mime_type: 'image/webp',
  file_url: `/api/v1/chat/stickers/${id}/file`,
  preview_url: `/api/v1/chat/stickers/${id}/preview`,
});

const stickerX = makeSticker('sticker-x', '🐈');
const stickerY = makeSticker('sticker-y', '🦆');

const packA = {
  id: 'pack-a',
  short_name: 'PackA',
  title: 'Набор А',
  sticker_type: 'regular',
  stickers: [stickerX],
};
const packB = {
  id: 'pack-b',
  short_name: 'PackB',
  title: 'Набор Б',
  sticker_type: 'regular',
  stickers: [stickerY],
};

const scope = { userId: 42 };
const scopeKey = () => peekStickerScopeRecord(scope).key;
const record = () => peekStickerScopeRecord(scope);
const favoriteIds = () => record().favorites.items.map((item) => String(item.id));

describe('chatStickerStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stickerEpochRef.value = 0;
    window.localStorage.clear();
    invalidateChatStickerStore();
    // mockResolvedValue/mockReturnValue переживают clearAllMocks — дефолты
    // выставляем явно, чтобы once-очередь прошлого теста не подтекала.
    peekStickerPacksCache.mockReturnValue(null);
    chatStickersAPI.listPacks.mockResolvedValue({ items: [] });
    chatStickersAPI.listFavorites.mockResolvedValue({ items: [] });
    chatStickersAPI.addFavoriteSticker.mockResolvedValue({ items: [] });
    chatStickersAPI.removeFavoriteSticker.mockResolvedValue({ items: [] });
    chatStickersAPI.listRecentStickers.mockResolvedValue({ items: [] });
    chatStickersAPI.pushRecentStickers.mockResolvedValue({ items: [], version: 1 });
  });

  it('serializes concurrent favorite toggles and replays queued ops over stale lists', async () => {
    const addX = deferred();
    const addY = deferred();
    chatStickersAPI.addFavoriteSticker
      .mockImplementationOnce(() => addX.promise)
      .mockImplementationOnce(() => addY.promise);
    ensureChatStickerData(scope);
    await flushPromises();

    const promiseX = toggleFavoriteSticker(scopeKey(), stickerX);
    // Оптимистичное применение — до первого ответа сервера.
    expect(favoriteIds()).toEqual(['sticker-x']);

    const promiseY = toggleFavoriteSticker(scopeKey(), stickerY);
    expect(favoriteIds()).toEqual(['sticker-x', 'sticker-y']);
    await flushPromises();
    // Очередь сериализована: второй PUT не уходит, пока первый в пути.
    expect(chatStickersAPI.addFavoriteSticker).toHaveBeenCalledTimes(1);

    // Ответ add X пришёл со списком БЕЗ Y (сервер ещё не видел операцию Y) —
    // отложенная операция проигрывается поверх, Y не пропадает.
    addX.resolve({ items: [stickerX] });
    await flushPromises();
    expect(chatStickersAPI.addFavoriteSticker).toHaveBeenCalledTimes(2);
    expect(chatStickersAPI.addFavoriteSticker.mock.calls.map((call) => call[0]))
      .toEqual(['sticker-x', 'sticker-y']);
    expect(favoriteIds()).toEqual(['sticker-x', 'sticker-y']);

    addY.resolve({ items: [stickerX, stickerY] });
    await expect(promiseX).resolves.toEqual({ ok: true });
    await expect(promiseY).resolves.toEqual({ ok: true });
    expect(favoriteIds()).toEqual(['sticker-x', 'sticker-y']);
  });

  it('does not resurrect a sticker removed while its add was still in flight', async () => {
    const add = deferred();
    const remove = deferred();
    chatStickersAPI.addFavoriteSticker.mockImplementationOnce(() => add.promise);
    chatStickersAPI.removeFavoriteSticker.mockImplementationOnce(() => remove.promise);
    ensureChatStickerData(scope);
    await flushPromises();

    const addPromise = toggleFavoriteSticker(scopeKey(), stickerX);
    // Быстрый повторный клик — уже «убрать»: операция встаёт в очередь.
    const removePromise = toggleFavoriteSticker(scopeKey(), stickerX);
    expect(favoriteIds()).toEqual([]);
    expect(chatStickersAPI.removeFavoriteSticker).not.toHaveBeenCalled();

    // Ответ add'а принёс список без X — воскрешать оптимистичный X нельзя:
    // эффект remove живёт в журнале и проигрывается поверх ответа.
    add.resolve({ items: [stickerX] });
    await flushPromises();
    expect(favoriteIds()).toEqual([]);
    expect(chatStickersAPI.removeFavoriteSticker).toHaveBeenCalledTimes(1);

    remove.resolve({ items: [] });
    await expect(addPromise).resolves.toEqual({ ok: true });
    await expect(removePromise).resolves.toEqual({ ok: true });
    expect(favoriteIds()).toEqual([]);
  });

  it('rolls back only the failed op while keeping the others', async () => {
    const addX = deferred();
    const addY = deferred();
    chatStickersAPI.addFavoriteSticker
      .mockImplementationOnce(() => addX.promise)
      .mockImplementationOnce(() => addY.promise);
    ensureChatStickerData(scope);
    await flushPromises();

    toggleFavoriteSticker(scopeKey(), stickerX);
    toggleFavoriteSticker(scopeKey(), stickerY);
    expect(favoriteIds()).toEqual(['sticker-x', 'sticker-y']);

    // Отказ первой операции: её эффект исключается из проигрыша, вторая
    // операция остаётся и держит Y в списке.
    addX.reject(new Error('conflict'));
    await flushPromises();
    expect(favoriteIds()).toEqual(['sticker-y']);

    addY.resolve({ items: [stickerY] });
    await flushPromises();
    expect(favoriteIds()).toEqual(['sticker-y']);
  });

  it('drops queued mutations after store invalidation (session switch)', async () => {
    const add = deferred();
    chatStickersAPI.addFavoriteSticker.mockImplementationOnce(() => add.promise);
    ensureChatStickerData(scope);
    await flushPromises();

    const pending = toggleFavoriteSticker(scopeKey(), stickerX);
    invalidateChatStickerStore();
    // Ответ прилетает уже в новое поколение — операция помечается dropped,
    // запись прежнего scope не засоряется.
    add.resolve({ items: [stickerX] });
    await expect(pending).resolves.toMatchObject({ ok: false, dropped: true });
    await flushPromises();
    expect(favoriteIds()).toEqual([]);
  });

  it('dedups concurrent ensure calls and skips an already loaded slice', async () => {
    const packs = deferred();
    chatStickersAPI.listPacks.mockImplementationOnce(() => packs.promise);

    ensureChatStickerData(scope);
    ensureChatStickerData(scope);
    ensureChatStickerData(scope);
    await flushPromises();
    expect(chatStickersAPI.listPacks).toHaveBeenCalledTimes(1);
    expect(chatStickersAPI.listFavorites).toHaveBeenCalledTimes(1);
    expect(chatStickersAPI.listRecentStickers).toHaveBeenCalledTimes(1);

    packs.resolve({ items: [packA] });
    await flushPromises();
    expect(record().packs.status).toBe('ready');

    // Повторный ensure по готовому срезу — no-op: сети нет.
    ensureChatStickerData(scope);
    await flushPromises();
    expect(chatStickersAPI.listPacks).toHaveBeenCalledTimes(1);
  });

  it('drops a stale packs response and self-heals with a refetch', async () => {
    const first = deferred();
    chatStickersAPI.listPacks
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ items: [packA] });
    ensureChatStickerData(scope);
    await flushPromises();

    // Инвалидация кэша между запросом и ответом: ответ устарел.
    stickerEpochRef.value += 1;
    first.resolve({ items: [packB] });

    // Store сам перезапросил список (макротаск после снятия in-flight) —
    // устаревший packB не применился.
    await vi.waitFor(() => {
      expect(chatStickersAPI.listPacks).toHaveBeenCalledTimes(2);
    });
    await flushPromises();
    expect(record().packs.status).toBe('ready');
    expect(record().packs.items.map((item) => item.id)).toEqual(['pack-a']);
  });

  it('starts from the warm api cache and refetches only on demand', async () => {
    const { peekStickerPacksCache } = await import('../api/chatStickers');
    peekStickerPacksCache.mockReturnValue({ items: [packA] });
    invalidateChatStickerStore();

    const warmed = peekStickerScopeRecord(scope);
    expect(warmed.packs.status).toBe('ready');
    expect(warmed.packs.items.map((item) => item.id)).toEqual(['pack-a']);
    ensureChatStickerData(scope);
    await flushPromises();
    // Горячий кэш закрыл срез наборов — сеть не нужна.
    expect(chatStickersAPI.listPacks).not.toHaveBeenCalled();
    expect(chatStickersAPI.listFavorites).toHaveBeenCalledTimes(1);
  });

  it('applies pack mutations through applyStickerPacks/setStickerPackItems', async () => {
    ensureChatStickerData(scope);
    await flushPromises();

    // Оптимистичная перестановка — без прайма кэша, с бампом dv.
    applyStickerPacks(scopeKey(), { items: [packA, packB] }, stickerEpochRef.value);
    expect(record().packs.items.map((item) => item.id)).toEqual(['pack-a', 'pack-b']);
    const dvBefore = record().dv.packs;
    setStickerPackItems(scopeKey(), [packB, packA]);
    expect(record().packs.items.map((item) => item.id)).toEqual(['pack-b', 'pack-a']);
    expect(record().dv.packs).toBe(dvBefore + 1);

    // Ответ с устаревшей эпохой отбрасывается.
    stickerEpochRef.value += 1;
    const applied = applyStickerPacks(scopeKey(), { items: [packB] }, 0);
    expect(applied).toBe(false);
    expect(record().packs.items.map((item) => item.id)).toEqual(['pack-b', 'pack-a']);
  });

  it('bumps data version only on data change, not on status flips', async () => {
    const packs = deferred();
    chatStickersAPI.listPacks.mockImplementationOnce(() => packs.promise);
    ensureChatStickerData(scope);
    await flushPromises();

    const idleDv = record().dv.packs;
    packs.resolve({ items: [] });
    await flushPromises();
    // Ответ совпал с текущими данными ([]) — dv не растёт, хотя статус
    // прошёл idle → loading → ready: подписчики на dv не просыпаются.
    expect(record().packs.status).toBe('ready');
    expect(record().dv.packs).toBe(idleDv);
  });

  it('notifies subscribers on commits and keeps a stable snapshot otherwise', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeChatStickerStore(listener);
    const before = peekStickerScopeRecord(scope);

    // Без коммитов snapshot — тот же объект: useSyncExternalStore
    // перерендера не делает.
    expect(peekStickerScopeRecord(scope)).toBe(before);
    expect(listener).not.toHaveBeenCalled();

    setStickerPackItems(scopeKey(), [packA]);
    expect(listener).toHaveBeenCalled();
    expect(peekStickerScopeRecord(scope)).not.toBe(before);
    unsubscribe();
  });

  it('moves a remembered recent sticker to the head and schedules the sync', () => {
    ensureChatStickerData(scope);
    const storageKey = record().storageKey;

    rememberRecentSticker(scopeKey(), 'sticker-x');
    rememberRecentSticker(scopeKey(), 'sticker-y');
    rememberRecentSticker(scopeKey(), 'sticker-x');

    expect(record().recents.ids).toEqual(['sticker-x', 'sticker-y']);
    expect(JSON.parse(window.localStorage.getItem(storageKey))).toEqual(['sticker-x', 'sticker-y']);
    // Очередь синка — scope-маркер + flush-коллбэк; сам список больше не
    // уезжает целиком, на сервер идут только дельта-операции.
    expect(scheduleRecentStickersSync).toHaveBeenLastCalledWith(
      { userId: 42, scopeKey: scopeKey() },
      expect.any(Function),
    );
  });

  it('scopes the recents storage key by the selected database', () => {
    window.localStorage.setItem('selected_database', 'MSK-ITINVENT');
    ensureChatStickerData(scope);

    expect(record().storageKey).toBe('hubit.chat.recent-stickers.v2:42:MSK-ITINVENT');
  });

  it('migrates the legacy v1 recents list into the scoped v2 key once', () => {
    window.localStorage.setItem(
      'hubit.chat.recent-stickers.v1:42',
      JSON.stringify(['sticker-x']),
    );
    ensureChatStickerData(scope);

    // v1-ключ не нёс БД-контекста: список принимается первым текущим
    // scope и удаляется — иначе мигрировал бы повторно в scope другой БД.
    expect(record().recents.ids).toEqual(['sticker-x']);
    expect(window.localStorage.getItem('hubit.chat.recent-stickers.v1:42')).toBeNull();
    expect(
      JSON.parse(window.localStorage.getItem('hubit.chat.recent-stickers.v2:42:default')),
    ).toEqual(['sticker-x']);
  });

  it('flushes journaled bump ops with dedupe and base_version', async () => {
    ensureChatStickerData(scope);
    await flushPromises();

    rememberRecentSticker(scopeKey(), 'sticker-x');
    rememberRecentSticker(scopeKey(), 'sticker-y');
    rememberRecentSticker(scopeKey(), 'sticker-x');

    // Дедуп журнала: bump sticker-x схлопнулся к последней позиции —
    // хронология операций [y, x], x окажется головой и на сервере.
    const flush = scheduleRecentStickersSync.mock.calls.at(-1)[1];
    await flush();
    expect(chatStickersAPI.pushRecentStickers).toHaveBeenCalledWith({
      baseVersion: 0,
      ops: [
        { op: 'bump', sticker_id: 'sticker-y' },
        { op: 'bump', sticker_id: 'sticker-x' },
      ],
      batchId: expect.any(String),
    });
  });

  it('applies the server merge result and version to store and localStorage', async () => {
    ensureChatStickerData(scope);
    await flushPromises();
    rememberRecentSticker(scopeKey(), 'sticker-x');
    rememberRecentSticker(scopeKey(), 'sticker-y');

    // Сервер — авторитет: его merged-список и version становятся новой
    // базой (другой порядок головы — законный merge соседнего устройства).
    chatStickersAPI.pushRecentStickers.mockResolvedValue({
      items: [stickerY, stickerX],
      version: 4,
    });
    const flush = scheduleRecentStickersSync.mock.calls.at(-1)[1];
    await flush();

    expect(record().recents.ids).toEqual(['sticker-y', 'sticker-x']);
    expect(record().recents.serverIds).toEqual(['sticker-y', 'sticker-x']);
    expect(record().recents.version).toBe(4);
    expect(JSON.parse(window.localStorage.getItem(record().storageKey)))
      .toEqual(['sticker-y', 'sticker-x']);
  });

  it('replays ops accumulated during a flush on top of the sync response', async () => {
    const first = deferred();
    chatStickersAPI.pushRecentStickers.mockImplementationOnce(() => first.promise);
    ensureChatStickerData(scope);
    await flushPromises();

    rememberRecentSticker(scopeKey(), 'sticker-x');
    const flush = scheduleRecentStickersSync.mock.calls.at(-1)[1];
    const pending = flush();
    // Сериализованный flush захватывает журнал в микротаске цепочки —
    // даём захвату случиться ДО нового bump, иначе bump-y попал бы в
    // первый пакет и проверять было бы нечего.
    await flushPromises();
    // Пока первый пакет в пути — новый bump копится в журнале.
    rememberRecentSticker(scopeKey(), 'sticker-y');
    first.resolve({ items: [stickerX], version: 2 });
    await expect(pending).resolves.toEqual({ ok: true });

    // Ответ покрывает только bump-x; bump-y проигрывается поверх новой
    // базы и не пропадает до собственного flush'а.
    expect(record().recents.ids).toEqual(['sticker-y', 'sticker-x']);
    expect(record().recents.serverIds).toEqual(['sticker-x']);
    expect(record().recents.version).toBe(2);

    const nextFlush = scheduleRecentStickersSync.mock.calls.at(-1)[1];
    await nextFlush();
    expect(chatStickersAPI.pushRecentStickers).toHaveBeenLastCalledWith({
      baseVersion: 2,
      ops: [{ op: 'bump', sticker_id: 'sticker-y' }],
      batchId: expect.any(String),
    });
  });

  it('sends remove and clear as journal ops with an immediate flush', async () => {
    ensureChatStickerData(scope);
    await flushPromises();
    rememberRecentSticker(scopeKey(), 'sticker-x');
    rememberRecentSticker(scopeKey(), 'sticker-y');

    // Сервер применил дельту [bump x, remove y] → итоговый rail [x].
    chatStickersAPI.pushRecentStickers.mockResolvedValue({ items: [stickerX], version: 1 });
    await removeRecentSticker(scopeKey(), 'sticker-y');
    expect(record().recents.ids).toEqual(['sticker-x']);
    // Журнал к моменту flush: [bump x, remove y] — bump-y схлопнулся
    // remove'ом того же id. Всё идёт одним delta-запросом без дебаунса.
    expect(chatStickersAPI.pushRecentStickers).toHaveBeenLastCalledWith({
      baseVersion: 0,
      ops: [
        { op: 'bump', sticker_id: 'sticker-x' },
        { op: 'remove', sticker_id: 'sticker-y' },
      ],
      batchId: expect.any(String),
    });

    chatStickersAPI.pushRecentStickers.mockResolvedValue({ items: [], version: 2 });
    await clearRecentStickers(scopeKey());
    expect(record().recents.ids).toEqual([]);
    // clear стирает журнал целиком — на сервер уходит только он.
    expect(chatStickersAPI.pushRecentStickers).toHaveBeenLastCalledWith(
      expect.objectContaining({ ops: [{ op: 'clear' }] }),
    );
    expect(JSON.parse(window.localStorage.getItem(record().storageKey))).toEqual([]);
  });

  it('drops a late GET whose version is older than the synced version', async () => {
    const getRecents = deferred();
    chatStickersAPI.listRecentStickers.mockImplementation(() => getRecents.promise);
    ensureChatStickerData(scope);

    // PUT подтверждается версией 4 раньше, чем приходит ответ GET.
    rememberRecentSticker(scopeKey(), 'sticker-x');
    chatStickersAPI.pushRecentStickers.mockResolvedValue({ items: [stickerX], version: 4 });
    const flush = scheduleRecentStickersSync.mock.calls.at(-1)[1];
    await flush();
    expect(record().recents.version).toBe(4);

    // Поздний GET со старой версией не откатывает rail и версию.
    getRecents.resolve({ items: [], version: 2 });
    await flushPromises();
    expect(record().recents.ids).toEqual(['sticker-x']);
    expect(record().recents.version).toBe(4);
  });

  it('re-flushes queued ops after a failed sync on reconnect', async () => {
    ensureChatStickerData(scope);
    await flushPromises();
    rememberRecentSticker(scopeKey(), 'sticker-x');

    chatStickersAPI.pushRecentStickers.mockRejectedValueOnce(new Error('offline'));
    const flush = scheduleRecentStickersSync.mock.calls.at(-1)[1];
    await expect(flush()).resolves.toEqual({ ok: false, error: expect.any(Error) });

    // Операция осталась в журнале — переход в онлайн перепланирует flush.
    scheduleRecentStickersSync.mockClear();
    window.dispatchEvent(new Event('online'));
    expect(scheduleRecentStickersSync).toHaveBeenCalledWith(
      { userId: 42, scopeKey: scopeKey() },
      expect.any(Function),
    );

    chatStickersAPI.pushRecentStickers.mockResolvedValue({ items: [stickerX], version: 1 });
    const retryFlush = scheduleRecentStickersSync.mock.calls.at(-1)[1];
    await retryFlush();
    expect(chatStickersAPI.pushRecentStickers).toHaveBeenLastCalledWith({
      baseVersion: 0,
      ops: [{ op: 'bump', sticker_id: 'sticker-x' }],
      batchId: expect.any(String),
    });
  });

  it('keeps the same batchId across retries of an unchanged journal', async () => {
    ensureChatStickerData(scope);
    await flushPromises();
    rememberRecentSticker(scopeKey(), 'sticker-x');

    // Ответ потерян в пути (flush отклонён): журнал не изменился —
    // повторная отправка обязана нести ТОТ ЖЕ op_batch_id, иначе серверная
    // дедупликация не распознает уже применённый пакет.
    chatStickersAPI.pushRecentStickers.mockRejectedValueOnce(new Error('lost response'));
    const flush = scheduleRecentStickersSync.mock.calls.at(-1)[1];
    await expect(flush()).resolves.toMatchObject({ ok: false });
    const firstBatchId = chatStickersAPI.pushRecentStickers.mock.calls.at(-1)[0].batchId;
    expect(firstBatchId).toBeTruthy();

    chatStickersAPI.pushRecentStickers.mockResolvedValue({ items: [stickerX], version: 1 });
    await expect(flush()).resolves.toEqual({ ok: true });
    const secondBatchId = chatStickersAPI.pushRecentStickers.mock.calls.at(-1)[0].batchId;
    expect(secondBatchId).toBe(firstBatchId);
  });

  it('rotates the batchId when the journal composition changes', async () => {
    ensureChatStickerData(scope);
    await flushPromises();
    rememberRecentSticker(scopeKey(), 'sticker-x');

    chatStickersAPI.pushRecentStickers.mockRejectedValueOnce(new Error('offline'));
    const flush = scheduleRecentStickersSync.mock.calls.at(-1)[1];
    await expect(flush()).resolves.toMatchObject({ ok: false });
    const firstBatchId = chatStickersAPI.pushRecentStickers.mock.calls.at(-1)[0].batchId;

    // Новая операция между retry: состав журнала изменился — переиспользовать
    // batchId нельзя, сервер счёл бы новые операции уже применёнными.
    rememberRecentSticker(scopeKey(), 'sticker-y');
    chatStickersAPI.pushRecentStickers.mockResolvedValue({
      items: [stickerY, stickerX],
      version: 1,
    });
    await expect(flush()).resolves.toEqual({ ok: true });
    const secondBatchId = chatStickersAPI.pushRecentStickers.mock.calls.at(-1)[0].batchId;
    expect(secondBatchId).toBeTruthy();
    expect(secondBatchId).not.toBe(firstBatchId);

    // Подтверждённый пакет «израсходован»: следующий за ним flush — новый id.
    rememberRecentSticker(scopeKey(), 'sticker-y');
    await expect(flush()).resolves.toEqual({ ok: true });
    const thirdBatchId = chatStickersAPI.pushRecentStickers.mock.calls.at(-1)[0].batchId;
    expect(thirdBatchId).toBeTruthy();
    expect(thirdBatchId).not.toBe(secondBatchId);
  });

  it('serializes overlapping flushes so the second one no-ops after the drain', async () => {
    const first = deferred();
    chatStickersAPI.pushRecentStickers.mockImplementationOnce(() => first.promise);
    ensureChatStickerData(scope);
    await flushPromises();
    rememberRecentSticker(scopeKey(), 'sticker-x');

    // Два перекрывающихся flush'а одного журнала (дебаунс + поверхностный
    // PUT): цепочка сериализует их — второй стартует только после ответа
    // первого, когда журнал уже подтверждён и пуст, поэтому в сеть уходит
    // ровно один запрос. batchId-дедупликация на сервере остаётся страховкой
    // для потерянных ответов, а не для параллельных пакетов.
    const flush = scheduleRecentStickersSync.mock.calls.at(-1)[1];
    const pendingA = flush();
    const pendingB = flush();
    await flushPromises();
    expect(chatStickersAPI.pushRecentStickers).toHaveBeenCalledTimes(1);

    first.resolve({ items: [stickerX], version: 1 });
    await expect(pendingA).resolves.toEqual({ ok: true });
    await expect(pendingB).resolves.toEqual({ ok: true });
    expect(chatStickersAPI.pushRecentStickers).toHaveBeenCalledTimes(1);
  });

  it('drops queued ops and the pending flush on store invalidation', async () => {
    ensureChatStickerData(scope);
    await flushPromises();
    rememberRecentSticker(scopeKey(), 'sticker-x');
    const flush = scheduleRecentStickersSync.mock.calls.at(-1)[1];

    invalidateChatStickerStore();
    // Инвалидация гасит глобальный дебаунс-таймер очереди.
    expect(cancelRecentStickersSync).toHaveBeenCalled();

    // Flush умершего scope — мягкий no-op: сети и записей нет.
    await expect(flush()).resolves.toEqual({ ok: true });
    expect(chatStickersAPI.pushRecentStickers).not.toHaveBeenCalled();
  });

  it('derives shared sections and reuses them until data changes', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [packA, packB] });
    ensureChatStickerData(scope);
    await flushPromises();

    const derived = getStickerScopeDerived(scopeKey());
    // Модель секций вкладки: «Недавние», «Избранные», затем наборы —
    // стикеры набора получают pack_short_name для отправки.
    expect(derived.stickerSections.map((section) => section.id))
      .toEqual(['recent', 'favorites', 'pack-a', 'pack-b']);
    expect(derived.stickerSections[2].stickers[0].pack_short_name).toBe('PackA');
    // Кэш по ссылкам массивов: без смены данных — та же производная.
    expect(getStickerScopeDerived(scopeKey())).toBe(derived);

    setStickerPackItems(scopeKey(), [packB, packA]);
    expect(getStickerScopeDerived(scopeKey())).not.toBe(derived);
  });
});
