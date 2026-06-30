import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatMessageList from './ChatMessageList';

vi.mock('./ChatBubble', () => ({
  MemoChatBubble: ({ message, onOpenAttachmentPreview }) => (
    <button
      type="button"
      data-testid={`bubble-${message.id}`}
      onClick={() => onOpenAttachmentPreview?.(message.id, message.attachments?.[0])}
    >
      {message.body}
    </button>
  ),
}));

const theme = createTheme();
const ui = {
  textSecondary: '#64748b',
  accentText: '#38bdf8',
  accentSoft: 'rgba(56,189,248,0.16)',
  servicePillBg: 'rgba(23,33,43,0.78)',
  servicePillText: '#94a3b8',
  borderSoft: 'rgba(148,163,184,0.2)',
  composerDockBg: '#17212b',
  panelBg: '#17212b',
};

const renderWithTheme = (node) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);

const buildMessage = (index) => ({
  id: `msg-${index}`,
  body: `Message ${index}`,
  created_at: '2026-04-28T08:00:00.000Z',
  is_own: index % 2 === 0,
  kind: 'user',
  sender: { id: 1 },
  attachments: index === 2 ? [{ id: 'att-1', file_name: 'photo.png' }] : [],
});

const buildMessages = (count) => Array.from({ length: count }, (_, index) => buildMessage(index + 1));

const buildProps = (overrides = {}) => {
  const scrollRoot = document.createElement('div');
  return {
    theme,
    ui,
    compactMobile: false,
    mobileInteractionsEnabled: false,
    activeConversation: { id: 'conv-1', kind: 'direct' },
    navigate: vi.fn(),
    messages: [],
    messagesLoading: false,
    effectiveLastReadMessageId: '',
    messagesHasMore: false,
    loadingOlder: false,
    onLoadOlder: vi.fn(),
    threadScrollRef: { current: scrollRoot },
    threadContentRef: { current: null },
    bottomRef: { current: null },
    onOpenReads: vi.fn(),
    onOpenAttachmentPreview: vi.fn(),
    onReplyMessage: vi.fn(),
    onOpenMessageMenu: vi.fn(),
    onConfirmAction: vi.fn(),
    onCancelAction: vi.fn(),
    onEditAction: vi.fn(),
    getReadTargetRef: vi.fn(),
    onToggleReaction: vi.fn(),
    onScrollToMessage: vi.fn(),
    currentUserId: 1,
    ...overrides,
  };
};

describe('ChatMessageList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the timeline for long threads', () => {
    renderWithTheme(
      <ChatMessageList
        {...buildProps({
          messages: buildMessages(48),
          effectiveLastReadMessageId: 'msg-48',
        })}
      />,
    );

    expect(screen.getByTestId('chat-thread-content')).toBeInTheDocument();
    expect(screen.getByTestId('bubble-msg-1')).toBeInTheDocument();
    expect(screen.getByTestId('bubble-msg-48')).toBeInTheDocument();
  });

  it('passes onOpenAttachmentPreview to bubbles and invokes it on click', () => {
    const onOpenAttachmentPreview = vi.fn();
    const messages = buildMessages(45);

    renderWithTheme(
      <ChatMessageList
        {...buildProps({
          messages,
          effectiveLastReadMessageId: 'msg-45',
          onOpenAttachmentPreview,
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('bubble-msg-2'));

    expect(onOpenAttachmentPreview).toHaveBeenCalledTimes(1);
    expect(onOpenAttachmentPreview).toHaveBeenCalledWith('msg-2', {
      id: 'att-1',
      file_name: 'photo.png',
    });
  });

  it('renders the standard timeline path for shorter threads', () => {
    renderWithTheme(
      <ChatMessageList
        {...buildProps({
          messages: buildMessages(45),
          effectiveLastReadMessageId: 'msg-45',
        })}
      />,
    );

    expect(screen.getByTestId('chat-thread-content')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-thread-content-virtual')).not.toBeInTheDocument();
    expect(screen.getByTestId('bubble-msg-1')).toBeInTheDocument();
    expect(screen.getByTestId('bubble-msg-45')).toBeInTheDocument();
  });

  it('renders inline date dividers on mobile without sticky positioning', () => {
    vi.setSystemTime(new Date('2026-06-29T12:00:00.000Z'));

    const { container } = renderWithTheme(
      <ChatMessageList
        {...buildProps({
          isMobile: true,
          compactMobile: true,
          messages: [
            {
              id: 'msg-old',
              body: 'Old message',
              created_at: '2026-06-27T10:00:00.000Z',
              is_own: false,
              kind: 'text',
              sender: { id: 2 },
            },
            {
              id: 'msg-new',
              body: 'Today message',
              created_at: '2026-06-29T10:00:00.000Z',
              is_own: true,
              kind: 'text',
              sender: { id: 1 },
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('27 июня')).toBeInTheDocument();
    expect(screen.getByText('Сегодня')).toBeInTheDocument();
    expect(container.querySelector('[data-date-marker]')).toBeInTheDocument();
    expect(container.querySelector('[data-date-marker]')?.parentElement?.className || '').not.toMatch(/\bsticky\b/);

    vi.useRealTimers();
  });

  it('keeps sticky date dividers on desktop', () => {
    vi.setSystemTime(new Date('2026-06-29T12:00:00.000Z'));

    const { container } = renderWithTheme(
      <ChatMessageList
        {...buildProps({
          isMobile: false,
          messages: [
            {
              id: 'msg-old',
              body: 'Old message',
              created_at: '2026-06-27T10:00:00.000Z',
              is_own: false,
              kind: 'text',
              sender: { id: 2 },
            },
            {
              id: 'msg-new',
              body: 'Today message',
              created_at: '2026-06-29T10:00:00.000Z',
              is_own: true,
              kind: 'text',
              sender: { id: 1 },
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('27 июня')).toBeInTheDocument();
    expect(container.querySelector('.sticky')).toBeInTheDocument();

    vi.useRealTimers();
  });
});
