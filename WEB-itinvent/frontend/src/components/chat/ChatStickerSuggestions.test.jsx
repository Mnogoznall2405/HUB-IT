import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatStickersAPI } from '../../api/chatStickers';
import { invalidateChatStickerStore } from '../../lib/chatStickerStore';
import ChatStickerSuggestions from './ChatStickerSuggestions';

const stickerEpochRef = { value: 0 };
vi.mock('../../api/chatStickers', () => {
  const chatStickersAPI = {
    listPacks: vi.fn(),
    listFavorites: vi.fn(),
    listRecentStickers: vi.fn(),
    pushRecentStickers: vi.fn(),
  };
  // Синк «недавних» мокаем без дебаунса: для поведения компонента важно,
  // что flush журнала операций доезжает до сервера, а не скорость отправки.
  return {
    chatStickersAPI,
    scheduleRecentStickersSync: vi.fn((scope, flush) => {
      void Promise.resolve()
        .then(() => (typeof flush === 'function' ? flush() : null))
        .catch(() => {});
    }),
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

const theme = createTheme();
const ui = {
  accentText: '#1976d2',
  borderSoft: '#dbe3ec',
  textPrimary: '#17202a',
  textSecondary: '#64748b',
  composerDockBg: '#ffffff',
};

const makeSticker = (id, emoji) => ({
  id,
  emoji,
  format: 'static',
  mime_type: 'image/webp',
  file_url: `/api/v1/chat/stickers/${id}/file`,
  preview_url: `/api/v1/chat/stickers/${id}/preview`,
});

const packA = {
  id: 'pack-a',
  short_name: 'PackA',
  title: 'Набор А',
  sticker_type: 'regular',
  stickers: [makeSticker('st-a1', '😂'), makeSticker('st-a2', '👍')],
};
const packB = {
  id: 'pack-b',
  short_name: 'PackB',
  title: 'Набор Б',
  sticker_type: 'regular',
  stickers: [makeSticker('st-b1', '😂')],
};

const renderStrip = (props = {}) => {
  const ref = React.createRef();
  const utils = render(
    <ThemeProvider theme={theme}>
      <ChatStickerSuggestions
        ref={ref}
        theme={theme}
        ui={ui}
        emojiToken="😂"
        onSendSticker={vi.fn().mockResolvedValue(true)}
        onStickerSent={vi.fn()}
        {...props}
      />
    </ThemeProvider>,
  );
  return { ref, ...utils };
};

const keyEvent = (key) => ({
  key,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
});

describe('ChatStickerSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stickerEpochRef.value = 0;
    window.localStorage.clear();
    invalidateChatStickerStore();
    chatStickersAPI.listPacks.mockResolvedValue({ items: [packA, packB] });
    chatStickersAPI.listFavorites.mockResolvedValue({ items: [] });
    chatStickersAPI.listRecentStickers.mockResolvedValue({ items: [] });
    chatStickersAPI.pushRecentStickers.mockResolvedValue({ items: [] });
  });

  it('suggests stickers for the trailing emoji with recents ranked first', async () => {
    window.localStorage.setItem(
      'hubit.chat.recent-stickers.v2:device:default',
      JSON.stringify(['st-b1']),
    );
    // Сервер — авторитет: merged-ответ заменяет базу, поэтому legacy-пуш
    // локальной копии должен вернуть те же id, а не пустой список.
    chatStickersAPI.pushRecentStickers.mockImplementation(({ stickerIds }) => Promise.resolve({
      items: (Array.isArray(stickerIds) ? stickerIds : []).map((id) => ({ id })),
      version: 1,
    }));
    renderStrip();

    const strip = await screen.findByTestId('chat-sticker-suggestions');
    await waitFor(() => {
      expect(within(strip).getAllByRole('option').length).toBe(2);
    });
    // Недавний стикер st-b1 идёт первым, хотя его набор идёт вторым —
    // порядок проверяем по preview-url: у обоих стикеров эмодзи 😂.
    const options = within(strip).getAllByRole('option');
    expect(options[0].querySelector('[data-testid="chat-sticker-preview-image"]')
      .getAttribute('src')).toContain('st-b1');
    expect(options[1].querySelector('[data-testid="chat-sticker-preview-image"]')
      .getAttribute('src')).toContain('st-a1');
    expect(within(strip).queryByRole('option', { name: 'Отправить стикер 👍' })).not.toBeInTheDocument();
  });

  it('sends the clicked suggestion, records recents and notifies the composer', async () => {
    const onSendSticker = vi.fn().mockResolvedValue(true);
    const onStickerSent = vi.fn();
    chatStickersAPI.pushRecentStickers.mockResolvedValue({ items: [{ id: 'st-a1' }], version: 1 });
    renderStrip({ onSendSticker, onStickerSent, currentUserId: 7 });

    const strip = await screen.findByTestId('chat-sticker-suggestions');
    await waitFor(() => {
      expect(within(strip).getAllByRole('option').length).toBeGreaterThan(0);
    });
    // Первый вариант при пустых «недавних» — st-a1 из первого набора.
    fireEvent.click(within(strip).getAllByRole('option')[0]);

    await waitFor(() => {
      expect(onSendSticker).toHaveBeenCalledWith(expect.objectContaining({ id: 'st-a1' }));
    });
    // Отправка идёт delta-операцией bump, а не полным списком.
    await waitFor(() => {
      expect(chatStickersAPI.pushRecentStickers).toHaveBeenCalledWith(
        expect.objectContaining({ ops: [{ op: 'bump', sticker_id: 'st-a1' }] }),
      );
    });
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem('hubit.chat.recent-stickers.v2:7:default')))
        .toEqual(['st-a1']);
    });
    expect(onStickerSent).toHaveBeenCalledTimes(1);
    // После отправки полоса скрывается (токен сброшен композером).
  });

  it('passes plain Enter through when nothing was selected', async () => {
    const ref = React.createRef();
    render(
      <ThemeProvider theme={theme}>
        <ChatStickerSuggestions
          ref={ref}
          theme={theme}
          ui={ui}
          emojiToken="😂"
          onSendSticker={vi.fn().mockResolvedValue(true)}
        />
      </ThemeProvider>,
    );
    await screen.findByTestId('chat-sticker-suggestions');

    const event = keyEvent('Enter');
    expect(ref.current.handleComposerKey(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('navigates with arrows and sends the focused suggestion on Enter', async () => {
    const onSendSticker = vi.fn().mockResolvedValue(true);
    const ref = React.createRef();
    render(
      <ThemeProvider theme={theme}>
        <ChatStickerSuggestions
          ref={ref}
          theme={theme}
          ui={ui}
          emojiToken="😂"
          onSendSticker={onSendSticker}
        />
      </ThemeProvider>,
    );
    const strip = await screen.findByTestId('chat-sticker-suggestions');
    await waitFor(() => {
      expect(within(strip).getAllByRole('option').length).toBe(2);
    });

    // ↑ переносит выбор на полосу; Enter без выбора остаётся отправкой.
    act(() => {
      expect(ref.current.handleComposerKey(keyEvent('ArrowUp'))).toBe(true);
    });
    const options = within(strip).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    act(() => {
      expect(ref.current.handleComposerKey(keyEvent('ArrowRight'))).toBe(true);
    });
    expect(within(strip).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    const enterEvent = keyEvent('Enter');
    act(() => {
      expect(ref.current.handleComposerKey(enterEvent)).toBe(true);
    });
    await waitFor(() => {
      expect(onSendSticker).toHaveBeenCalledWith(expect.objectContaining({ id: 'st-b1' }));
    });
  });

  it('dismisses only the strip on Escape and returns on the next token', async () => {
    const ref = React.createRef();
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <ChatStickerSuggestions
          ref={ref}
          theme={theme}
          ui={ui}
          emojiToken="😂"
          onSendSticker={vi.fn().mockResolvedValue(true)}
        />
      </ThemeProvider>,
    );
    await screen.findByTestId('chat-sticker-suggestions');

    const escapeEvent = keyEvent('Escape');
    act(() => {
      expect(ref.current.handleComposerKey(escapeEvent)).toBe(true);
    });
    expect(escapeEvent.preventDefault).toHaveBeenCalled();
    expect(screen.queryByTestId('chat-sticker-suggestions')).not.toBeInTheDocument();

    // Тот же токен — остаётся скрытой; другой эмодзи — появляется снова.
    rerender(
      <ThemeProvider theme={theme}>
        <ChatStickerSuggestions
          ref={ref}
          theme={theme}
          ui={ui}
          emojiToken="😂"
          onSendSticker={vi.fn().mockResolvedValue(true)}
        />
      </ThemeProvider>,
    );
    expect(screen.queryByTestId('chat-sticker-suggestions')).not.toBeInTheDocument();
    rerender(
      <ThemeProvider theme={theme}>
        <ChatStickerSuggestions
          ref={ref}
          theme={theme}
          ui={ui}
          emojiToken="👍"
          onSendSticker={vi.fn().mockResolvedValue(true)}
        />
      </ThemeProvider>,
    );
    await screen.findByTestId('chat-sticker-suggestions');
  });

  it('stays hidden when the suggestions setting is off', async () => {
    window.localStorage.setItem('hubit.chat.sticker-suggestions.v1', '0');
    renderStrip();

    await act(async () => {});
    expect(screen.queryByTestId('chat-sticker-suggestions')).not.toBeInTheDocument();
    // Выключенная фича не должна будить каталог — запросов нет вообще.
    expect(chatStickersAPI.listPacks).not.toHaveBeenCalled();
    expect(chatStickersAPI.listFavorites).not.toHaveBeenCalled();
  });
});
