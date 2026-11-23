import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiClientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('./http', () => ({ default: apiClientMock }));

import {
  chatStickersAPI,
  invalidateStickerPacksCache,
  peekStickerPacksCache,
} from './chatStickers';

describe('chatStickersAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateStickerPacksCache();
    window.localStorage.removeItem('selected_database');
  });

  it('allows long Telegram pack imports to finish', async () => {
    apiClientMock.post.mockResolvedValue({ data: { items: [] } });

    await chatStickersAPI.importPack(' https://t.me/addstickers/frrl52 ');

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/chat/sticker-packs/import',
      { source: 'https://t.me/addstickers/frrl52' },
      { timeout: 120000 },
    );
  });

  it('scopes the pack cache by user: another account never reads it', async () => {
    apiClientMock.get
      .mockResolvedValueOnce({ data: { items: [{ id: 'pack-a' }] } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'pack-b' }] } });

    const first = await chatStickersAPI.listPacks({ userId: 'user-a' });
    const second = await chatStickersAPI.listPacks({ userId: 'user-b' });

    expect(first.items[0].id).toBe('pack-a');
    expect(second.items[0].id).toBe('pack-b');
    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    // Повторный запрос первого пользователя — из его кэша, без сети.
    const again = await chatStickersAPI.listPacks({ userId: 'user-a' });
    expect(again.items[0].id).toBe('pack-a');
    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    expect(peekStickerPacksCache({ userId: 'user-b' }).items[0].id).toBe('pack-b');
  });

  it('scopes the pack cache by selected database context', async () => {
    apiClientMock.get
      .mockResolvedValueOnce({ data: { items: [{ id: 'pack-db1' }] } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'pack-db2' }] } });

    window.localStorage.setItem('selected_database', 'ITINVENT');
    await chatStickersAPI.listPacks({ userId: 'user-a' });
    window.localStorage.setItem('selected_database', 'MSK-ITINVENT');
    const secondDb = await chatStickersAPI.listPacks({ userId: 'user-a' });

    expect(secondDb.items[0].id).toBe('pack-db2');
    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    // Возврат к первой БД — её scoped-кэш жив.
    window.localStorage.setItem('selected_database', 'ITINVENT');
    const back = await chatStickersAPI.listPacks({ userId: 'user-a' });
    expect(back.items[0].id).toBe('pack-db1');
    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent listPacks per scope only', async () => {
    const resolvers = [];
    apiClientMock.get.mockImplementation(
      () => new Promise((resolve) => { resolvers.push(resolve); }),
    );

    const a1 = chatStickersAPI.listPacks({ userId: 'user-a' });
    const a2 = chatStickersAPI.listPacks({ userId: 'user-a' });
    expect(apiClientMock.get).toHaveBeenCalledTimes(1);
    const b = chatStickersAPI.listPacks({ userId: 'user-b' });
    expect(apiClientMock.get).toHaveBeenCalledTimes(2);

    resolvers[0]({ data: { items: [{ id: 'shared' }] } });
    await Promise.all([a1, a2]);
    resolvers[1]({ data: { items: [{ id: 'for-b' }] } });
    await b;
  });

  it('drops a stale response that resolves after invalidation', async () => {
    let resolveRequest;
    apiClientMock.get
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveRequest = resolve; }),
      )
      .mockResolvedValueOnce({ data: { items: [{ id: 'fresh' }] } });

    const pending = chatStickersAPI.listPacks({ userId: 'user-a' });
    // Гонка: кэш инвалидирован (импорт/выход), а старый ответ пришёл позже.
    invalidateStickerPacksCache();
    resolveRequest({ data: { items: [{ id: 'stale' }] } });
    await pending;

    // Устаревший ответ не репопулирует кэш — следующий вызов идёт в сеть.
    expect(peekStickerPacksCache({ userId: 'user-a' })).toBeNull();
    const fresh = await chatStickersAPI.listPacks({ userId: 'user-a' });
    expect(fresh.items[0].id).toBe('fresh');
    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
  });

  it('invalidateStickerPacksCache clears every scope (logout/account switch)', async () => {
    apiClientMock.get.mockResolvedValue({ data: { items: [{ id: 'p' }] } });
    await chatStickersAPI.listPacks({ userId: 'user-a' });
    await chatStickersAPI.listPacks({ userId: 'user-b' });
    expect(peekStickerPacksCache({ userId: 'user-a' })).not.toBeNull();
    expect(peekStickerPacksCache({ userId: 'user-b' })).not.toBeNull();

    invalidateStickerPacksCache();

    expect(peekStickerPacksCache({ userId: 'user-a' })).toBeNull();
    expect(peekStickerPacksCache({ userId: 'user-b' })).toBeNull();
  });
});
