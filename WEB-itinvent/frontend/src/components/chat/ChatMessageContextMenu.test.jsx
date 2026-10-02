import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import ChatMessageContextMenu from './ChatMessageContextMenu';

vi.mock('../../api/client', () => ({
  chatAPI: {
    getMessageReads: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

import { chatAPI } from '../../api/client';

const theme = createTheme();
const ui = {
  drawerBg: '#17212b',
  surfaceMuted: '#232e3c',
  textStrong: '#f5f7fa',
  textSecondary: 'rgba(255,255,255,0.56)',
  borderSoft: 'rgba(255,255,255,0.08)',
  shadowStrong: '0 16px 48px rgba(0, 0, 0, 0.44)',
};

function renderMenu(overrides = {}) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  return render(
    <ThemeProvider theme={theme}>
      <ChatMessageContextMenu
        theme={theme}
        ui={ui}
        open
        onClose={vi.fn()}
        anchorEl={anchor}
        message={{ id: 'msg-1', kind: 'text', body: 'hello', is_own: true }}
        activeConversation={{ id: 'conv-1', kind: 'direct' }}
        onToggleReactionFromMenu={vi.fn()}
        onReplyFromMessageMenu={vi.fn()}
        onCopyMessage={vi.fn()}
        onSelectMessageFromMenu={vi.fn()}
        {...overrides}
      />
    </ThemeProvider>,
  );
}

describe('ChatMessageContextMenu reactions', () => {
  it('shows more reactions when expanded than when collapsed', () => {
    renderMenu();

    const collapsedCount = screen.getAllByLabelText(/^Реакция /).length;
    expect(collapsedCount).toBeGreaterThan(0);
    expect(collapsedCount).toBeLessThan(16);

    fireEvent.click(screen.getByRole('button', { name: 'Ещё реакции' }));

    const expandedCount = screen.getAllByLabelText(/^Реакция /).length;
    expect(expandedCount).toBe(16);
    expect(expandedCount).toBeGreaterThan(collapsedCount);
  });
});

describe('ChatMessageContextMenu action list (Д2-6)', () => {
  it('renders the compact Telegram action set and drops HUB extras', () => {
    const onDeleteMessageFromMenu = vi.fn();

    renderMenu({
      onDeleteMessageFromMenu,
    });

    // Состав по решению п.4: Ответить, Изменить (свои), Закрепить,
    // Копировать текст, Переслать, Выделить, Удалить сообщение.
    expect(screen.getByRole('menuitem', { name: 'Ответить' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Изменить' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Закрепить' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Копировать текст' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Переслать' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Выделить' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Удалить сообщение' })).toBeInTheDocument();

    expect(screen.queryByRole('menuitem', { name: 'Копировать ссылку на сообщение' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Пожаловаться' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Открыть вложение' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Открыть задачу' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Кто прочитал' })).not.toBeInTheDocument();
  });

  it('hides edit for incoming messages but keeps moderation delete in groups', () => {
    renderMenu({
      message: { id: 'msg-2', kind: 'text', body: 'incoming', is_own: false },
      activeConversation: { id: 'conv-1', kind: 'group' },
    });

    expect(screen.queryByRole('menuitem', { name: 'Изменить' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Удалить сообщение' })).toBeInTheDocument();
  });

  it('shows the compact footer «Прочитали: N» for own group messages and previews readers on hover', async () => {
    chatAPI.getMessageReads.mockResolvedValue({
      items: [
        { user: { id: 2, full_name: 'Анна Иванова' }, read_at: '2026-10-01T10:05:00Z' },
        { user: { id: 3, full_name: 'Борис Петров' }, read_at: '2026-10-01T10:06:00Z' },
      ],
    });
    const onOpenReadsFromMessageMenu = vi.fn();

    renderMenu({
      activeConversation: { id: 'conv-1', kind: 'group' },
      message: { id: 'msg-9', kind: 'text', body: 'own', is_own: true, read_by_count: 2 },
      onOpenReadsFromMessageMenu,
    });

    const footer = screen.getByRole('menuitem', { name: 'Прочитали: 2' });
    expect(footer).toBeInTheDocument();

    fireEvent.mouseEnter(footer.parentElement);
    await waitFor(() => expect(chatAPI.getMessageReads).toHaveBeenCalledWith('msg-9'));
    expect(await screen.findByText('Анна Иванова')).toBeInTheDocument();
    expect(screen.getByText('Борис Петров')).toBeInTheDocument();

    fireEvent.click(footer);
    expect(onOpenReadsFromMessageMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-9' }));
  });

  it('does not show read receipts footer in direct chats or without readers', () => {
    renderMenu({
      activeConversation: { id: 'conv-1', kind: 'direct' },
      message: { id: 'msg-9', kind: 'text', body: 'own', is_own: true, read_by_count: 3 },
    });
    expect(screen.queryByRole('menuitem', { name: /Прочитали/ })).not.toBeInTheDocument();
  });
});
