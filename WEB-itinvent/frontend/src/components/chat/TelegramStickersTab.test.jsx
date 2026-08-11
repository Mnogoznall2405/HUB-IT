import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatStickersAPI } from '../../api/chatStickers';
import TelegramStickersTab from './TelegramStickersTab';

vi.mock('../../api/chatStickers', () => ({
  chatStickersAPI: {
    listPacks: vi.fn(),
    importPack: vi.fn(),
  },
}));

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
    window.localStorage.clear();
    chatStickersAPI.listPacks.mockResolvedValue({ items: [] });
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

  it('sends a selected sticker without opening its file', async () => {
    const onSendSticker = vi.fn().mockResolvedValue(true);
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack] });
    renderTab(onSendSticker);

    fireEvent.click(await screen.findByRole('button', { name: 'Отправить стикер 🐈' }));

    await waitFor(() => expect(onSendSticker).toHaveBeenCalledWith(stickerPack.stickers[0]));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders recent stickers and all installed packs as consecutive sections', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [stickerPack, secondStickerPack] });
    const { container } = renderTab();

    expect(await screen.findByRole('tabpanel', { name: 'Офисные звери' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Офисные птицы' })).toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll('[data-sticker-section]')).map(
        (section) => section.getAttribute('data-sticker-section'),
      ),
    ).toEqual(['recent', 'pack-1', 'pack-2']);
    expect(screen.getByRole('tab', { name: 'Недавние' })).toBeInTheDocument();
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
});
