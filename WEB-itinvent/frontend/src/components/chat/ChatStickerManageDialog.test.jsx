import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import ChatStickerManageDialog from './ChatStickerManageDialog';

const theme = createTheme();
const ui = {
  accentText: '#1976d2',
  borderSoft: '#dbe3ec',
  textPrimary: '#17202a',
  textSecondary: '#64748b',
};

const makeSticker = (packId, index) => ({
  id: `${packId}-sticker-${index}`,
  emoji: '🐈',
  format: 'static',
  mime_type: 'image/webp',
  file_url: `/api/v1/chat/stickers/${packId}-sticker-${index}/file`,
  preview_url: `/api/v1/chat/stickers/${packId}-sticker-${index}/preview`,
});

const makePack = (id, title, stickerCount) => ({
  id,
  short_name: id,
  title,
  sticker_type: 'regular',
  stickers: Array.from({ length: stickerCount }, (_, index) => makeSticker(id, index + 1)),
});

const packA = makePack('pack-a', 'Набор А', 3);
const packB = makePack('pack-b', 'Набор Б', 12);

const renderDialog = (props = {}) => render(
  <ThemeProvider theme={theme}>
    <ChatStickerManageDialog
      open
      packs={[packA, packB]}
      theme={theme}
      ui={ui}
      onClose={vi.fn()}
      onOpenPack={vi.fn()}
      onRemovePack={vi.fn().mockResolvedValue(undefined)}
      onReorderPacks={vi.fn().mockResolvedValue(undefined)}
      onAddPack={vi.fn()}
      {...props}
    />
  </ThemeProvider>,
);

describe('ChatStickerManageDialog', () => {
  it('lists installed packs with cover, title and sticker count', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Наборы стикеров' });
    const list = within(dialog).getByRole('list', { name: 'Установленные наборы стикеров' });

    expect(within(list).getByText('Набор А')).toBeInTheDocument();
    expect(within(list).getByText('3 стикера')).toBeInTheDocument();
    expect(within(list).getByText('Набор Б')).toBeInTheDocument();
    expect(within(list).getByText('12 стикеров')).toBeInTheDocument();
    const covers = list.querySelectorAll('[data-testid="chat-sticker-preview-image"]');
    expect(covers).toHaveLength(2);
    expect(covers[0]).toHaveAttribute('src', packA.stickers[0].preview_url);
  });

  it('calls onOpenPack from the row action', () => {
    const onOpenPack = vi.fn();
    renderDialog({ onOpenPack });

    fireEvent.click(screen.getByRole('button', { name: 'Открыть набор Набор Б' }));

    expect(onOpenPack).toHaveBeenCalledWith(expect.objectContaining({ id: 'pack-b' }));
  });

  it('requires inline confirmation before removing a pack', async () => {
    const onRemovePack = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onRemovePack });
    const dialog = screen.getByRole('dialog', { name: 'Наборы стикеров' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить набор Набор А' }));
    expect(onRemovePack).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Подтвердить удаление Набор А' }),
    );
    await waitFor(() => {
      expect(onRemovePack).toHaveBeenCalledWith(expect.objectContaining({ id: 'pack-a' }));
    });
  });

  it('resets the row actions when the removal confirmation is cancelled', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Наборы стикеров' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить набор Набор А' }));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Отменить удаление Набор А' }),
    );

    expect(
      within(dialog).getByRole('button', { name: 'Удалить набор Набор А' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Подтвердить удаление Набор А' }),
    ).not.toBeInTheDocument();
  });

  it('shows the API error when removal fails and keeps the row', async () => {
    const onRemovePack = vi.fn().mockRejectedValue(new Error('Сервер недоступен'));
    renderDialog({ onRemovePack });
    const dialog = screen.getByRole('dialog', { name: 'Наборы стикеров' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить набор Набор А' }));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Подтвердить удаление Набор А' }),
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Сервер недоступен');
    expect(within(dialog).getByText('Набор А')).toBeInTheDocument();
  });

  it('moves the dragged pack to the drop target position and reports the new order', () => {
    const onReorderPacks = vi.fn();
    renderDialog({ onReorderPacks });
    const dialog = screen.getByRole('dialog', { name: 'Наборы стикеров' });

    fireEvent.dragStart(
      within(dialog).getByRole('button', { name: 'Перетащить набор Набор А' }),
    );
    fireEvent.dragOver(within(dialog).getByTestId('sticker-manage-row-pack-b'));
    fireEvent.drop(within(dialog).getByTestId('sticker-manage-row-pack-b'));

    expect(onReorderPacks).toHaveBeenCalledWith(['pack-b', 'pack-a']);
  });

  it('keeps the order when a pack is dropped onto itself', () => {
    const onReorderPacks = vi.fn();
    renderDialog({ onReorderPacks });
    const dialog = screen.getByRole('dialog', { name: 'Наборы стикеров' });

    fireEvent.dragStart(
      within(dialog).getByRole('button', { name: 'Перетащить набор Набор А' }),
    );
    fireEvent.drop(within(dialog).getByTestId('sticker-manage-row-pack-a'));

    expect(onReorderPacks).not.toHaveBeenCalled();
  });

  it('calls onAddPack from the add row', () => {
    const onAddPack = vi.fn();
    renderDialog({ onAddPack });

    fireEvent.click(screen.getByRole('button', { name: 'Добавить набор' }));

    expect(onAddPack).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state and keeps the add action when no packs are installed', () => {
    const onAddPack = vi.fn();
    renderDialog({ packs: [], onAddPack });
    const dialog = screen.getByRole('dialog', { name: 'Наборы стикеров' });

    expect(within(dialog).getByText('Установленных наборов пока нет')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить набор' }));
    expect(onAddPack).toHaveBeenCalledTimes(1);
  });
});
