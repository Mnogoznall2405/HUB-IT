import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import ChatSidebar from './ChatSidebar';

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
  ...overrides,
});

describe('ChatSidebar', () => {
  it('shows draft preview for conversations', () => {
    renderWithTheme(buildProps());

    expect(screen.getByText(/Черновик: Незавершённый ответ/i)).toBeInTheDocument();
  });

  it('marks the opened conversation as the active chat row', () => {
    renderWithTheme(buildProps());

    expect(screen.getByRole('button', { current: 'page' })).toHaveAttribute('data-chat-active', 'true');
  });

  it('switches filter from the sidebar menu', () => {
    const onConversationFilterChange = vi.fn();

    renderWithTheme(buildProps({ onConversationFilterChange }));

    fireEvent.click(screen.getByRole('button', { name: /Фильтр списка/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Непрочитанные/i }));

    expect(onConversationFilterChange).toHaveBeenCalledWith('unread');
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
});
