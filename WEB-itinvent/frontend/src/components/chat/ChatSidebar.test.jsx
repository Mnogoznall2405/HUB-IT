import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import ChatSidebar, { CHAT_SIDEBAR_ROW_USES_LAYOUT_ANIMATION } from './ChatSidebar';
import { buildChatUiTokens } from './chatUiTokens';

const theme = createTheme();
const ui = {
  panelBg: '#0f172a',
  sidebarBg: '#17212b',
  sidebarHeaderBg: '#17212b',
  sidebarSearchBg: '#202f3f',
  sidebarRowHover: 'rgba(255,255,255,0.06)',
  sidebarRowActive: '#2b5278',
  accentSoft: 'rgba(96,165,250,0.16)',
  accentText: '#7dd3fc',
  borderSoft: 'rgba(148,163,184,0.2)',
  textSecondary: '#94a3b8',
};

const baseConversation = {
  id: 'conv-1',
  title: 'Проект',
  kind: 'group',
  unread_count: 2,
  member_count: 3,
  members: [],
  last_message_preview: 'Последнее сообщение',
  last_message_at: '2026-03-25T10:00:00Z',
  updated_at: '2026-03-25T10:00:00Z',
  is_archived: false,
  is_muted: false,
  is_pinned: false,
};

const renderWithTheme = (props) => render(
  <ThemeProvider theme={theme}>
    <ChatSidebar {...props} />
  </ThemeProvider>,
);

const buildProps = (overrides = {}) => ({
  theme,
  ui,
  isMobile: false,
  health: { available: true },
  user: { id: 1, full_name: 'Тестовый Пользователь' },
  unreadTotal: 2,
  sidebarQuery: '',
  onSidebarQueryChange: vi.fn(),
  sidebarSearchActive: false,
  searchingSidebar: false,
  searchPeople: [],
  searchChats: [],
  searchResultEmpty: false,
  openingPeerId: '',
  onOpenPeer: vi.fn(),
  activeConversationId: 'conv-1',
  onOpenConversation: vi.fn(),
  conversationsLoading: false,
  conversations: [baseConversation],
  onOpenGroup: vi.fn(),
  sidebarScrollRef: { current: null },
  activeFolderKey: 'all',
  onActiveFolderChange: vi.fn(),
  customFolders: [],
  folderUnreadCounts: {},
  conversationIdsByFolder: {},
  conversationFilter: 'all',
  onConversationFilterChange: vi.fn(),
  conversationFilterCounts: {
    all: 1,
    unread: 1,
    direct: 0,
    group: 1,
    pinned: 0,
    archived: 0,
  },
  draftsByConversation: {
    'conv-1': 'Незавершённый ответ',
  },
  showAiSection: false,
  onUpdateConversationSettings: vi.fn(),
  onRequestDeleteConversation: vi.fn(),
  onRequestLeaveConversation: vi.fn(),
  ...overrides,
});

describe('ChatSidebar', () => {
  it('keeps conversation row reorders off framer-motion layout animation', () => {
    expect(CHAT_SIDEBAR_ROW_USES_LAYOUT_ANIMATION).toBe(false);
  });

  it('shows draft preview for conversations', () => {
    renderWithTheme(buildProps());

    expect(screen.getByText(/Черновик: Незавершённый ответ/i)).toBeInTheDocument();
  });

  it('marks the opened conversation as the active chat row', () => {
    renderWithTheme(buildProps());

    expect(screen.getByRole('button', { current: 'page' })).toHaveAttribute('data-chat-active', 'true');
  });

  it('renders task chats with task identity metadata and a desktop message preview', () => {
    renderWithTheme(buildProps({
      activeFolderKey: 'all',
      activeConversationId: 'task-conv',
      conversations: [{
        ...baseConversation,
        id: 'task-conv',
        kind: 'task',
        title: 'Задача: Старый заголовок',
        task_id: 'task-1',
        task_title: 'Настроить рабочее место',
        task_status: 'in_progress',
        task_assignee_full_name: 'Пётр Исполнитель',
        task_due_at: '2026-06-29T19:00:00',
      }],
      draftsByConversation: {},
    }));

    expect(screen.getByText('Настроить рабочее место')).toBeInTheDocument();
    expect(screen.getByTestId('task-chat-status-task-conv')).toHaveTextContent('В работе');
    expect(screen.getByTestId('task-chat-meta-task-conv')).toHaveTextContent('Пётр Исполнитель');
    expect(screen.getByTestId('task-chat-preview-task-conv')).toHaveTextContent('Последнее сообщение');
  });

  it('uses a compact two-line task row on mobile', () => {
    renderWithTheme(buildProps({
      isMobile: true,
      compactMobile: true,
      activeConversationId: 'task-conv',
      conversations: [{
        ...baseConversation,
        id: 'task-conv',
        kind: 'task',
        task_id: 'task-1',
        task_title: 'Мобильная задача',
        task_status: 'done',
        task_assignee_full_name: 'Анна Исполнитель',
        task_due_at: null,
      }],
      draftsByConversation: {},
    }));

    expect(screen.getByText('Мобильная задача')).toBeInTheDocument();
    expect(screen.getByTestId('task-chat-meta-task-conv')).toHaveTextContent('Анна Исполнитель • Без срока');
    expect(screen.queryByTestId('task-chat-preview-task-conv')).not.toBeInTheDocument();
  });

  it('groups task chats into active and collapsible completed sections', () => {
    renderWithTheme(buildProps({
      activeFolderKey: 'tasks',
      activeConversationId: 'task-active',
      conversations: [
        {
          ...baseConversation,
          id: 'task-active',
          kind: 'task',
          task_id: 'task-1',
          task_title: 'Активная задача',
          task_status: 'review',
          unread_count: 2,
        },
        {
          ...baseConversation,
          id: 'task-done',
          kind: 'task',
          task_id: 'task-2',
          task_title: 'Завершённая задача',
          task_status: 'done',
          unread_count: 1,
        },
      ],
      draftsByConversation: {},
    }));

    expect(screen.getByTestId('task-section-active')).toHaveTextContent('Активные');
    expect(screen.getByTestId('task-section-completed-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Активная задача')).toBeInTheDocument();
    expect(screen.getByText('Завершённая задача')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('task-section-completed-toggle'));

    expect(screen.getByTestId('task-section-completed-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Завершённая задача')).not.toBeInTheDocument();
    expect(screen.getByText('Активная задача')).toBeInTheDocument();
  });

  it('renders compact desktop chat rows from density tokens', () => {
    const compactUi = buildChatUiTokens(theme, { compactDesktop: true });

    renderWithTheme(buildProps({ ui: compactUi }));

    expect(screen.getByRole('button', { current: 'page' })).toHaveStyle({
      minHeight: '48px',
      padding: '4px 8px',
      margin: '0px 4px',
      borderRadius: '9px',
    });
  });

  it('switches to the task folder from the sidebar tabs', () => {
    const onActiveFolderChange = vi.fn();

    renderWithTheme(buildProps({ onActiveFolderChange }));

    fireEvent.click(screen.getByRole('button', { name: 'Задачи' }));

    expect(onActiveFolderChange).toHaveBeenCalledWith('tasks');
  });

  it('switches folders on mobile list swipe', () => {
    const onActiveFolderChange = vi.fn();
    const onOpenConversation = vi.fn();
    renderWithTheme(buildProps({
      compactMobile: true,
      isMobile: true,
      activeFolderKey: 'personal',
      onActiveFolderChange,
      onOpenConversation,
      conversations: [{
        ...baseConversation,
        kind: 'direct',
      }],
    }));

    const row = screen.getByRole('button', { current: 'page' });
    fireEvent.touchStart(row, { touches: [{ clientX: 220, clientY: 300 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 120, clientY: 302 }] });
    fireEvent.touchEnd(row);

    expect(onActiveFolderChange).toHaveBeenCalledWith('tasks');
    expect(onOpenConversation).not.toHaveBeenCalled();
  });

  it('opens chat actions on right click and forwards pin and delete actions', () => {
    const onUpdateConversationSettings = vi.fn();
    const onRequestDeleteConversation = vi.fn();
    renderWithTheme(buildProps({
      conversations: [{
        ...baseConversation,
        kind: 'direct',
        viewer_member_role: 'member',
      }],
      onUpdateConversationSettings,
      onRequestDeleteConversation,
    }));

    const row = screen.getByRole('button', { current: 'page' });
    fireEvent.contextMenu(row, { clientX: 120, clientY: 80 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Закрепить чат' }));
    expect(onUpdateConversationSettings).toHaveBeenCalledWith('conv-1', { is_pinned: true });

    fireEvent.contextMenu(row, { clientX: 120, clientY: 80 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить чат' }));
    expect(onRequestDeleteConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'conv-1' }));
  });

  it('offers leaving to group members and protects task chats from direct deletion', () => {
    const onRequestLeaveConversation = vi.fn();
    const { rerender } = renderWithTheme(buildProps({
      conversations: [{
        ...baseConversation,
        viewer_member_role: 'member',
      }],
      onRequestLeaveConversation,
    }));

    fireEvent.contextMenu(screen.getByRole('button', { current: 'page' }), { clientX: 80, clientY: 70 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Выйти из группы' }));
    expect(onRequestLeaveConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'conv-1' }));

    rerender(
      <ThemeProvider theme={theme}>
        <ChatSidebar
          {...buildProps({
            activeConversationId: 'task-conv',
            conversations: [{
              ...baseConversation,
              id: 'task-conv',
              kind: 'task',
              task_id: 'task-1',
              task_title: 'Protected task',
            }],
          })}
        />
      </ThemeProvider>,
    );
    fireEvent.contextMenu(screen.getByRole('button', { current: 'page' }), { clientX: 80, clientY: 70 });
    expect(screen.getByRole('menuitem', { name: 'Удаляется вместе с задачей' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('renders AI bots and opens the selected AI chat', () => {
    const onOpenAiBot = vi.fn();
    const onOpenConversation = vi.fn();

    renderWithTheme(buildProps({
      showAiSection: true,
      onOpenConversation,
      aiBots: [{
        id: 'ai-1',
        title: 'Corp Assistant',
        slug: 'corp-assistant',
        description: 'KB bot',
        conversation_id: 'ai-conv-1',
        last_message_preview: 'Последний ответ',
        last_message_at: '2026-04-21T10:00:00Z',
        unread_count: 2,
        draft_preview: 'новый запрос',
      }],
      activeConversationId: 'ai-conv-1',
      onOpenAiBot,
    }));

    fireEvent.click(screen.getByRole('button', { name: /Corp Assistant/i }));

    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText(/Черновик: новый запрос/i)).toBeInTheDocument();
    expect(onOpenConversation).toHaveBeenCalledWith('ai-conv-1');
    expect(onOpenAiBot).not.toHaveBeenCalled();
  });

  it('creates the AI chat only when the bot has no linked conversation yet', () => {
    const onOpenAiBot = vi.fn();

    renderWithTheme(buildProps({
      showAiSection: true,
      aiBots: [{ id: 'ai-2', title: 'Fresh Bot', slug: 'fresh-bot', description: 'Ready' }],
      onOpenAiBot,
    }));

    fireEvent.click(screen.getByRole('button', { name: /Fresh Bot/i }));

    expect(onOpenAiBot).toHaveBeenCalledWith(expect.objectContaining({ id: 'ai-2' }));
  });

  it('shows AI sidebar loading and error states when AI chat is enabled', () => {
    const { rerender } = renderWithTheme(buildProps({
      showAiSection: true,
      aiBotsLoading: true,
    }));

    expect(screen.getByText(/Loading AI bots/i)).toBeInTheDocument();

    rerender(
      <ThemeProvider theme={theme}>
        <ChatSidebar
          {...buildProps({
            showAiSection: true,
            aiBotsError: 'Failed to load AI bots.',
          })}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText(/Failed to load AI bots/i)).toBeInTheDocument();
  });

  it('shows read receipts and full date for own direct messages', () => {
    renderWithTheme(buildProps({
      activeConversationId: 'direct-read',
      conversations: [{
        ...baseConversation,
        id: 'direct-read',
        kind: 'direct',
        title: 'Коллега',
        last_message_at: '2026-06-08T10:00:00.000Z',
        updated_at: '2026-06-08T10:00:00.000Z',
        last_message_is_own: true,
        last_message_delivery_status: 'read',
        unread_count: 0,
      }],
      draftsByConversation: {},
    }));

    expect(screen.getByTestId('sidebar-delivery-read')).toBeInTheDocument();
    expect(screen.getByText('08.06.2026')).toBeInTheDocument();
  });

  it('hides read receipts for incoming direct messages', () => {
    renderWithTheme(buildProps({
      activeConversationId: 'direct-in',
      conversations: [{
        ...baseConversation,
        id: 'direct-in',
        kind: 'direct',
        title: 'Коллега',
        last_message_at: '2026-06-08T10:00:00.000Z',
        updated_at: '2026-06-08T10:00:00.000Z',
        last_message_is_own: false,
        last_message_delivery_status: null,
        unread_count: 1,
      }],
      draftsByConversation: {},
    }));

    expect(screen.queryByTestId('sidebar-delivery-read')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-delivery-sent')).not.toBeInTheDocument();
    expect(screen.getByText('08.06.2026')).toBeInTheDocument();
  });

  it('hides the All folder tab on compact mobile', () => {
    renderWithTheme(buildProps({
      compactMobile: true,
      isMobile: true,
    }));

    expect(screen.getByRole('button', { name: 'Личные' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Задачи' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Все' })).not.toBeInTheDocument();
  });

  it('keeps the All folder tab on desktop', () => {
    renderWithTheme(buildProps());

    expect(screen.getByRole('button', { name: 'Все' })).toBeInTheDocument();
  });

  it('collapses mobile search on list scroll and expands from header icon', async () => {
    renderWithTheme(buildProps({
      compactMobile: true,
      disableMotion: true,
      isMobile: true,
      conversations: Array.from({ length: 12 }, (_, index) => ({
        ...baseConversation,
        id: `conv-${index}`,
        title: `Чат ${index}`,
      })),
    }));

    const list = screen.getByTestId('chat-sidebar-list-scroll');
    Object.defineProperty(list, 'scrollTop', { configurable: true, value: 0, writable: true });
    list.scrollTop = 120;

    fireEvent.scroll(list);
    await act(async () => {
      await new Promise((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(resolve);
        });
      });
    });

    expect(screen.getByRole('button', { name: 'Поиск' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Поиск' }));

    expect(list.scrollTop).toBe(0);
    expect(screen.queryByRole('button', { name: 'Поиск' })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Поиск')).toBeInTheDocument();
  });
});
