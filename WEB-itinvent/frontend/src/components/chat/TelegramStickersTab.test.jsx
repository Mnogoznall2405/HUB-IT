import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatStickersAPI, primeStickerPacksCache } from '../../api/chatStickers';
import TelegramStickersTab from './TelegramStickersTab';

const stickerEpochRef = { value: 0 };
vi.mock('../../api/chatStickers', () => {
  const chatStickersAPI = {
    listPacks: vi.fn(),
    importPack: vi.fn(),
    listFavorites: vi.fn(),
    addFavoriteSticker: vi.fn(),
    removeFavoriteSticker: vi.fn(),
    listRecentStickers: vi.fn(),
    pushRecentStickers: vi.fn(),
    setPackOrder: vi.fn(),
  };
  // Дебаунс-синк «недавних» воспроизводим честно, чтобы поведенческие
  // тесты проходили по реальной цепочке schedule → timer → PUT.
  let recentSyncTimer = null;
  let pendingRecentIds = null;
  return {
    chatStickersAPI,
    scheduleRecentStickersSync: vi.fn((stickerIds) => {
      pendingRecentIds = Array.isArray(stickerIds) ? stickerIds : [];
      if (recentSyncTimer !== null) clearTimeout(recentSyncTimer);
      recentSyncTimer = setTimeout(() => {
        recentSyncTimer = null;
        const idsToPush = pendingRecentIds || [];
        pendingRecentIds = null;
        chatStickersAPI.pushRecentStickers(idsToPush).catch(() => {});
      }, 1500);
    }),
    cancelRecentStickersSync: vi.fn(() => {
      if (recentSyncTimer !== null) {
        clearTimeout(recentSyncTimer);
        recentSyncTimer = null;
      }
      pendingRecentIds = null;
    }),
    getStickerPacksEpoch: vi.fn(() => stickerEpochRef.value),
    peekStickerPacksCache: vi.fn(() => null),
    primeStickerPacksCache: vi.fn((scope, payload) => payload),
    invalidateStickerPacksCache: vi.fn(() => { stickerEpochRef.value += 1; }),
  };
});

const theme = createTheme();
const ui = {
  accentText: '#1976d2',
  borderSoft: '#dbe3ec',
  textPrimary: '#17202a',
  textSecondary: '#64748b',
};
const stickerPack = {
  id: 'pack-1',
  short_name: 'OfficeAnimals',
  title: 'Офисные звери',
  sticker_type: 'regular',
  stickers: [
    {
      id: 'sticker-1',
      emoji: '🐈',
      format: 'static',
      mime_type: 'image/webp',
      file_url: '/api/v1/chat/stickers/sticker-1/file',
      preview_url: '/api/v1/chat/stickers/sticker-1/preview',
    },
  ],
};
const secondStickerPack = {
  id: 'pack-2',
  short_name: 'OfficeBirds',
  title: 'Офисные птицы',
  sticker_type: 'regular',
  stickers: [
    {
      id: 'sticker-2',
      emoji: '🦆',
      format: 'static',
      mime_type: 'image/webp',
      file_url: '/api/v1/chat/stickers/sticker-2/file',
      preview_url: '/api/v1/chat/stickers/sticker-2/preview',
    },
  ],
};

const renderTab = (onSendSticker = vi.fn().mockResolvedValue(true), props = {}) => render(
  <ThemeProvider theme={theme}>
    <TelegramStickersTab theme={theme} ui={ui} onSendSticker={onSendSticker} {...props} />
  </ThemeProvider>,
);

describe('TelegramStickersTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stickerEpochRef.value = 0;
    window.localStorage.clear();
    chatStickersAPI.listPacks.mockResolvedValue({ items: [] });
    chatStickersAPI.listFavorites.mockResolvedValue({ items: [] });
    chatStickersAPI.listRecentStickers.mockResolvedValue({ items: [] });
    chatStickersAPI.pushRecentStickers.mockResolvedValue({ items: [] });
    chatStickersAPI.addFavoriteSticker.mockResolvedValue({ items: [] });
    chatStickersAPI.removeFavoriteSticker.mockResolvedValue({ items: [] });
    chatStickersAPI.setPackOrder.mockResolvedValue({ items: [] });
  });

  it('imports a Telegram pack from the sticker picker', async () => {
    chatStickersAPI.importPack.mockResolvedValue({ items: [stickerPack] });
    renderTab();

    expect(await screen.findByText('Добавьте первый набор')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить набор стикеров из Telegram' }));
    fireEvent.change(screen.getByLabelText('Ссылка на набор Telegram'), {
      target: { value: 'https://t.me/addstickers/OfficeAnimals' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить набор' }));

    await waitFor(() => {
      expect(chatStickersAPI.importPack).toHaveBeenCalledWith(
        'https://t.me/addstickers/OfficeAnimals',
      );
    });
    expect(await screen.findByText('Офисные звери')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отправить стикер 🐈' })).toBeInTheDocument();
  });

  it('drops a pack response that resolves after cache invalidation', async () => {
    let resolveStale;
    chatStickersAPI.listPacks.mockImplementationOnce(
      () => new Promise((resolve) => { resolveStale = resolve; }),
    );
    renderTab();

    // Инвалидация между запросом и ответом (logout / импорт в другом табе) —
    // устаревший payload не должен ни попасть в кэш, ни отрисоваться.
    stickerEpochRef.value += 1;
    await act(async () => { resolveStale({ items: [stickerPack] }); });

    expect(primeStickerPacksCache).not.toHaveBeenCalled();
    expect(screen.queryByText('Офисные звери')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByLabelText('Загрузка наборов стикеров')).not.toBeInTheDocument();
    });
  });

  it('applies a pack response while the cache epoch is unchanged', async () => {
    let resolveFresh;
    chatStickersAPI.listPacks.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFresh = resolve; }),
    );
    renderTab();

    await act(async () => { resolveFresh({ items: [stickerPack] }); });

    expect(primeStickerPacksCache).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ items: [stickerPack] }),
      expect.anything(),
    );
    expect(await screen.findByText('Офисные звери')).toBeInTheDocument();
  });

  it('sends a selected sticker without opening its file', async () => {
    const onSendSticker = vi.fn().mockResolvedValue(true);
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    renderTab(onSendSticker);

    fireEvent.click(await screen.findByRole('button', { name: 'Отправить стикер 🐈' }));

    await waitFor(() => expect(onSendSticker).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sticker-1',
      pack_short_name: stickerPack.short_name,
    })));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders recent, favorites and all installed packs as consecutive sections', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack, secondStickerPack] });
    const { container } = renderTab();

    expect(await screen.findByRole('tabpanel', { name: 'Офисные звери' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Офисные птицы' })).toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll('[data-sticker-section]')).map(
        (section) => section.getAttribute('data-sticker-section'),
      ),
    ).toEqual(['recent', 'favorites', 'pack-1', 'pack-2']);
    expect(screen.getByRole('tab', { name: 'Недавние' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Избранные' })).toBeInTheDocument();
  });

  it('scrolls to the favorites section from the star tab in the pack strip', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    renderTab();

    expect(await screen.findByRole('tabpanel', { name: 'Офисные звери' })).toBeInTheDocument();
    const scrollRoot = screen.getByTestId('chat-sticker-sections-scroll');
    scrollRoot.scrollTo = vi.fn();
    const favoritesTab = screen.getByRole('tab', { name: 'Избранные' });

    fireEvent.click(favoritesTab);

    expect(favoritesTab).toHaveAttribute('aria-selected', 'true');
    expect(scrollRoot.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });

  it('scrolls an overflowing pack strip horizontally with the mouse wheel', async () => {
    const packs = Array.from({ length: 7 }, (_, index) => ({
      ...stickerPack,
      id: `pack-${index + 1}`,
      short_name: `OfficeAnimals${index + 1}`,
      title: `Набор ${index + 1}`,
      stickers: stickerPack.stickers.map((sticker) => ({
        ...sticker,
        id: `sticker-${index + 1}`,
      })),
    }));
    chatStickersAPI.listPacks.mockResolvedValue({ items: packs });
    renderTab();
    const strip = await screen.findByRole('tablist', { name: 'Наборы стикеров' });
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 180 });
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 520 });
    strip.scrollLeft = 0;

    fireEvent.wheel(strip, { deltaY: 96 });

    expect(strip.scrollLeft).toBe(96);
  });

  it('keeps the selected pack tab visible when it is outside the strip', async () => {
    const packs = Array.from({ length: 7 }, (_, index) => ({
      ...stickerPack,
      id: `pack-${index + 1}`,
      short_name: `OfficeAnimals${index + 1}`,
      title: `Pack ${index + 1}`,
      stickers: stickerPack.stickers.map((sticker) => ({
        ...sticker,
        id: `sticker-${index + 1}`,
      })),
    }));
    chatStickersAPI.listPacks.mockResolvedValue({ items: packs });
    renderTab();
    const strip = await screen.findByRole('tablist');
    const targetTab = screen.getByRole('tab', { name: 'Pack 5' });
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 180 });
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 520 });
    Object.defineProperty(targetTab, 'offsetLeft', { configurable: true, value: 320 });
    Object.defineProperty(targetTab, 'offsetWidth', { configurable: true, value: 40 });
    strip.scrollLeft = 0;
    strip.scrollTo = vi.fn(({ left }) => { strip.scrollLeft = left; });

    fireEvent.click(targetTab);

    await waitFor(() => expect(targetTab).toHaveAttribute('aria-selected', 'true'));
    expect(strip.scrollTo).toHaveBeenCalledWith(expect.objectContaining({
      left: expect.any(Number),
      behavior: 'smooth',
    }));
    expect(strip.scrollLeft).toBeGreaterThan(0);
  });

  it('remembers successfully sent stickers in the per-user recent section', async () => {
    const onSendSticker = vi.fn().mockResolvedValue(true);
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    const firstRender = renderTab(onSendSticker, { currentUserId: 7 });
    const packGrid = await screen.findByRole('tabpanel', { name: 'Офисные звери' });

    fireEvent.click(within(packGrid).getByRole('button', { name: 'Отправить стикер 🐈' }));

    const recentGrid = await screen.findByRole('tabpanel', { name: 'Недавние' });
    expect(within(recentGrid).getByRole('button', { name: 'Отправить стикер 🐈' })).toBeInTheDocument();
    firstRender.unmount();

    renderTab(onSendSticker, { currentUserId: 7 });
    const restoredRecentGrid = await screen.findByRole('tabpanel', { name: 'Недавние' });
    expect(within(restoredRecentGrid).getByRole('button', { name: 'Отправить стикер 🐈' })).toBeInTheDocument();
  });

  it('uses the lightweight preview in the grid instead of mounting the original media', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    renderTab();

    await screen.findByRole('button', { name: /Отправить стикер/ });
    const previews = screen.getAllByTestId('chat-sticker-preview-image');

    expect(previews.length).toBeGreaterThan(0);
    expect(previews.every((item) => item.getAttribute('src') === stickerPack.stickers[0].preview_url)).toBe(true);
  });

  it('shows a fullscreen preview while held and does not send on release', async () => {
    const onSendSticker = vi.fn().mockResolvedValue(true);
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    renderTab(onSendSticker);
    const button = await screen.findByRole('button', { name: /Отправить стикер/ });
    vi.useFakeTimers();

    try {
      fireEvent.pointerDown(button, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 20,
        clientY: 20,
      });
      act(() => vi.advanceTimersByTime(450));

      expect(screen.getByTestId('sticker-hold-preview')).toBeInTheDocument();
      expect(screen.getByTestId('sticker-hold-preview-frame')).toHaveStyle({
        width: 'min(560px, calc(100vw - 24px), calc(100vh - 112px))',
        maxWidth: '100%',
      });

      fireEvent.pointerUp(button, { pointerId: 1, pointerType: 'mouse' });
      fireEvent.click(button);

      expect(screen.queryByTestId('sticker-hold-preview')).not.toBeInTheDocument();
      expect(onSendSticker).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets keyboard users cancel a held preview with Escape', async () => {
    const onSendSticker = vi.fn().mockResolvedValue(true);
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    renderTab(onSendSticker);
    const button = await screen.findByRole('button', { name: /Отправить стикер/ });
    vi.useFakeTimers();

    try {
      fireEvent.keyDown(button, { key: ' ' });
      act(() => vi.advanceTimersByTime(450));
      expect(screen.getByTestId('sticker-hold-preview')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });
      fireEvent.keyUp(button, { key: ' ' });

      expect(screen.queryByTestId('sticker-hold-preview')).not.toBeInTheDocument();
      expect(onSendSticker).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses larger five-column sticker thumbnails in the desktop side panel', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    renderTab(undefined, { dense: true });

    expect(await screen.findByRole('tabpanel', { name: 'Офисные звери' })).toHaveStyle({
      gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    });
    expect(screen.getByRole('tabpanel').querySelector('[data-testid="chat-sticker-preview-image"]')).toHaveStyle({
      width: '68px',
    });
  });

  it('uses larger four-column sticker thumbnails in the compact panel', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    renderTab();

    const grid = await screen.findByRole('tabpanel');
    expect(grid).toHaveStyle({
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    });
    expect(grid.querySelector('[data-testid="chat-sticker-preview-image"]')).toHaveStyle({
      width: '76px',
    });
  });

  it('opens the sticker context menu on right-click with context-aware items', async () => {
    const onSendSticker = vi.fn().mockResolvedValue(true);
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    renderTab(onSendSticker);
    const button = await screen.findByRole('button', { name: 'Отправить стикер 🐈' });

    // Стикер не в избранном и не в недавних: базовый набор действий.
    fireEvent.contextMenu(button, { clientX: 24, clientY: 24 });
    expect(screen.getByRole('menuitem', { name: 'Отправить' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Добавить в избранное' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Открыть набор' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Убрать из недавних' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Отправить' })).not.toBeInTheDocument();
    });

    // После отправки стикер попадает в «недавние» — пункт удаления появляется.
    // Полный pointerdown/up + click: openStickerMenu выставил suppressClick,
    // его снимает именно pointerdown, как в браузере.
    fireEvent.pointerDown(button, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: 'mouse' });
    fireEvent.click(button);
    await screen.findByRole('tabpanel', { name: 'Недавние' });
    fireEvent.contextMenu(button, { clientX: 24, clientY: 24 });
    expect(screen.getByRole('menuitem', { name: 'Убрать из недавних' })).toBeInTheDocument();
    expect(onSendSticker).toHaveBeenCalledTimes(1);
  });

  it('opens the sticker context menu from the keyboard Menu key', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    renderTab();
    const button = await screen.findByRole('button', { name: 'Отправить стикер 🐈' });

    fireEvent.keyDown(button, { key: 'ContextMenu' });

    expect(screen.getByRole('menuitem', { name: 'Отправить' })).toBeInTheDocument();
  });

  it('offers removal for a favorite sticker and hides pack action without an installed pack', async () => {
    const favoriteSticker = {
      ...stickerPack.stickers[0],
      pack_short_name: 'NoSuchPackInstalled',
    };
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    chatStickersAPI.listFavorites.mockResolvedValue({ items: [favoriteSticker] });
    renderTab();

    const favoritesGrid = await screen.findByRole('tabpanel', { name: 'Избранные' });
    const favoriteButton = within(favoritesGrid).getByRole('button', { name: 'Отправить стикер 🐈' });
    fireEvent.contextMenu(favoriteButton, { clientX: 24, clientY: 24 });

    expect(screen.getByRole('menuitem', { name: 'Удалить из избранных' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Добавить в избранное' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Открыть набор' })).not.toBeInTheDocument();
  });

  it('adds a favorite optimistically and keeps it after the API resolves', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    let resolveAdd;
    chatStickersAPI.addFavoriteSticker.mockImplementation(
      () => new Promise((resolve) => { resolveAdd = resolve; }),
    );
    renderTab();
    const button = await screen.findByRole('button', { name: 'Отправить стикер 🐈' });

    fireEvent.contextMenu(button, { clientX: 24, clientY: 24 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Добавить в избранное' }));

    // Оптимистичное обновление: стикер уже в секции, ответ API ещё в пути.
    const favoritesGrid = await screen.findByRole('tabpanel', { name: 'Избранные' });
    expect(
      within(favoritesGrid).getByRole('button', { name: 'Отправить стикер 🐈' }),
    ).toBeInTheDocument();
    expect(chatStickersAPI.addFavoriteSticker).toHaveBeenCalledWith('sticker-1');

    await act(async () => {
      resolveAdd({ items: [{ ...stickerPack.stickers[0], pack_short_name: stickerPack.short_name }] });
    });
    expect(
      within(screen.getByRole('tabpanel', { name: 'Избранные' }))
        .getByRole('button', { name: 'Отправить стикер 🐈' }),
    ).toBeInTheDocument();
  });

  it('rolls back an optimistic favorite add when the API fails', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    chatStickersAPI.addFavoriteSticker.mockRejectedValue({});
    renderTab();
    const button = await screen.findByRole('button', { name: 'Отправить стикер 🐈' });

    fireEvent.contextMenu(button, { clientX: 24, clientY: 24 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Добавить в избранное' }));

    // Оптимистично появился, после ошибки — откат и сообщение об ошибке.
    await screen.findByRole('tabpanel', { name: 'Избранные' });
    await waitFor(() => {
      expect(screen.queryByRole('tabpanel', { name: 'Избранные' })).not.toBeInTheDocument();
    });
    expect(
      screen.getByText('Избранные стикеры появятся здесь — добавьте их через контекстное меню'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Не удалось добавить стикер в избранное.');
  });

  it('removes a sticker from recents through the context menu', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    chatStickersAPI.listRecentStickers.mockResolvedValue({
      items: [{ ...stickerPack.stickers[0], pack_short_name: stickerPack.short_name }],
    });
    renderTab();

    const recentGrid = await screen.findByRole('tabpanel', { name: 'Недавние' });
    const recentButton = within(recentGrid).getByRole('button', { name: 'Отправить стикер 🐈' });
    fireEvent.contextMenu(recentButton, { clientX: 24, clientY: 24 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Убрать из недавних' }));

    await waitFor(() => {
      expect(screen.queryByRole('tabpanel', { name: 'Недавние' })).not.toBeInTheDocument();
    });
    expect(screen.getByText('Отправленные стикеры появятся здесь')).toBeInTheDocument();
    expect(
      JSON.parse(window.localStorage.getItem('hubit.chat.recent-stickers.v1:device')),
    ).toEqual([]);
  });

  it('uses the server recent list when the request succeeds', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack, secondStickerPack] });
    window.localStorage.setItem(
      'hubit.chat.recent-stickers.v1:device',
      JSON.stringify(['sticker-1']),
    );
    chatStickersAPI.listRecentStickers.mockResolvedValue({
      items: [{ ...secondStickerPack.stickers[0], pack_short_name: secondStickerPack.short_name }],
    });
    renderTab();

    const recentGrid = await screen.findByRole('tabpanel', { name: 'Недавние' });
    await waitFor(() => {
      expect(
        within(recentGrid).getByRole('button', { name: 'Отправить стикер 🦆' }),
      ).toBeInTheDocument();
    });
    expect(
      within(recentGrid).queryByRole('button', { name: 'Отправить стикер 🐈' }),
    ).not.toBeInTheDocument();
  });

  it('falls back to the localStorage recent list when the request fails', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    window.localStorage.setItem(
      'hubit.chat.recent-stickers.v1:device',
      JSON.stringify(['sticker-1']),
    );
    chatStickersAPI.listRecentStickers.mockRejectedValue(new Error('offline'));
    renderTab();

    const recentGrid = await screen.findByRole('tabpanel', { name: 'Недавние' });
    expect(
      within(recentGrid).getByRole('button', { name: 'Отправить стикер 🐈' }),
    ).toBeInTheDocument();
  });

  it('pushes the localStorage recent list up when the server list is empty', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    chatStickersAPI.listRecentStickers.mockResolvedValue({ items: [] });
    window.localStorage.setItem(
      'hubit.chat.recent-stickers.v1:device',
      JSON.stringify(['sticker-1']),
    );
    // Таймеры фейканы до рендера: sync-запрос планируется внутри .then
    // монтировочного эффекта и должен попасть под фейковый таймер.
    vi.useFakeTimers();
    try {
      renderTab();
      await act(async () => {});
      await act(async () => { vi.advanceTimersByTime(2000); });
      expect(chatStickersAPI.pushRecentStickers).toHaveBeenCalledWith(['sticker-1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('filters stickers by keyword and restores the sections after Escape', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack, secondStickerPack] });
    renderTab();

    await screen.findByRole('tabpanel', { name: 'Офисные звери' });
    const searchInput = screen.getByLabelText('Поиск стикеров');
    fireEvent.change(searchInput, { target: { value: 'кот' } });

    // В режиме поиска секции и лента наборов скрыты, видна только выдача.
    const results = await screen.findByTestId('chat-sticker-search-results');
    await waitFor(() => {
      expect(within(results).getByRole('button', { name: 'Отправить стикер 🐈' })).toBeInTheDocument();
    });
    expect(within(results).queryByRole('button', { name: 'Отправить стикер 🦆' })).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-sticker-sections-scroll')).toHaveStyle({ display: 'none' });
    expect(screen.getByTestId('chat-sticker-pack-strip-row')).toHaveStyle({ display: 'none' });

    // Escape в поле очищает запрос — обычный список возвращается.
    fireEvent.keyDown(searchInput, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('chat-sticker-search-results')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('tabpanel', { name: 'Офисные звери' })).toBeInTheDocument();
    expect(searchInput).toHaveValue('');
  });

  it('shows the whole pack group when the query matches the pack title', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack, secondStickerPack] });
    renderTab();

    await screen.findByRole('tabpanel', { name: 'Офисные звери' });
    const searchInput = screen.getByLabelText('Поиск стикеров');
    fireEvent.change(searchInput, { target: { value: 'звери' } });

    const results = await screen.findByTestId('chat-sticker-search-results');
    await waitFor(() => {
      expect(within(results).getByText('Офисные звери')).toBeInTheDocument();
    });
    expect(within(results).getByRole('button', { name: 'Отправить стикер 🐈' })).toBeInTheDocument();
    expect(within(results).queryByText('Офисные птицы')).not.toBeInTheDocument();

    fireEvent.keyDown(searchInput, { key: 'Escape' });
  });

  it('matches stickers by the emoji inside the query', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack, secondStickerPack] });
    renderTab();

    await screen.findByRole('tabpanel', { name: 'Офисные звери' });
    const searchInput = screen.getByLabelText('Поиск стикеров');
    fireEvent.change(searchInput, { target: { value: 'привет 🦆' } });

    const results = await screen.findByTestId('chat-sticker-search-results');
    await waitFor(() => {
      expect(within(results).getByRole('button', { name: 'Отправить стикер 🦆' })).toBeInTheDocument();
    });
    expect(within(results).queryByRole('button', { name: 'Отправить стикер 🐈' })).not.toBeInTheDocument();

    fireEvent.keyDown(searchInput, { key: 'Escape' });
  });

  it('shows the not-found state for a query without matches', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    renderTab();

    await screen.findByRole('tabpanel', { name: 'Офисные звери' });
    const searchInput = screen.getByLabelText('Поиск стикеров');
    fireEvent.change(searchInput, { target: { value: 'субмарина' } });

    const results = await screen.findByTestId('chat-sticker-search-results');
    await waitFor(() => {
      expect(within(results).getByText('Ничего не найдено')).toBeInTheDocument();
    });

    fireEvent.keyDown(searchInput, { key: 'Escape' });
  });

  it('sends a sticker from search results and clears the query', async () => {
    const onSendSticker = vi.fn().mockResolvedValue(true);
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    renderTab(onSendSticker);

    await screen.findByRole('tabpanel', { name: 'Офисные звери' });
    const searchInput = screen.getByLabelText('Поиск стикеров');
    fireEvent.change(searchInput, { target: { value: 'кот' } });
    const results = await screen.findByTestId('chat-sticker-search-results');
    const resultButton = await within(results).findByRole('button', { name: 'Отправить стикер 🐈' });

    fireEvent.click(resultButton);

    await waitFor(() => expect(onSendSticker).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sticker-1',
    })));
    // После отправки поиск очищается — как в Telegram Desktop.
    await waitFor(() => expect(searchInput).toHaveValue(''));
    await waitFor(() => {
      expect(screen.queryByTestId('chat-sticker-search-results')).not.toBeInTheDocument();
    });
  });

  it('persists the typing-suggestions toggle in localStorage', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    renderTab();

    await screen.findByRole('tabpanel', { name: 'Офисные звери' });
    const toggle = screen.getByRole('button', { name: 'Подсказки стикеров при вводе эмодзи' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('hubit.chat.sticker-suggestions.v1')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(window.localStorage.getItem('hubit.chat.sticker-suggestions.v1')).toBe('0');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('hubit.chat.sticker-suggestions.v1')).toBe('1');
  });
});
