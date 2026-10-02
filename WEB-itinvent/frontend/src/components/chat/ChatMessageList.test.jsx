import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatMessageList, { shouldGroupMessages } from './ChatMessageList';

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
    const firstMessageRow = screen.getByTestId('bubble-msg-1').parentElement;
    expect(firstMessageRow.style.contentVisibility).toBe('');
    expect(firstMessageRow.style.containIntrinsicSize).toBe('');
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

  it('renders inline date dividers on desktop without sticky positioning', () => {
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
    expect(container.querySelector('.sticky')).not.toBeInTheDocument();
    expect(container.querySelector('[data-date-marker]')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('renders the thread load error block and calls the retry callback', () => {
    const onRetryThreadLoad = vi.fn();

    renderWithTheme(
      <ChatMessageList
        {...buildProps({
          threadLoadError: { conversationId: 'conv-1' },
          onRetryThreadLoad,
        })}
      />,
    );

    expect(screen.getByTestId('chat-thread-load-error')).toBeInTheDocument();
    expect(screen.getByText('Не удалось загрузить сообщения')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-thread-content')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('chat-thread-load-retry'));
    expect(onRetryThreadLoad).toHaveBeenCalledTimes(1);
  });

  it('prefers the error block over the loading skeleton', () => {
    const { container } = renderWithTheme(
      <ChatMessageList
        {...buildProps({
          messagesLoading: true,
          threadLoadError: { conversationId: 'conv-1' },
          onRetryThreadLoad: vi.fn(),
        })}
      />,
    );

    expect(screen.getByTestId('chat-thread-load-error')).toBeInTheDocument();
    expect(container.querySelectorAll('.MuiSkeleton-root')).toHaveLength(0);
  });
});

describe('AiRunFeedStatus in the message feed (AI4/AI5/AI9)', () => {
  const aiProps = (overrides = {}) => buildProps({
    activeConversation: { id: 'conv-ai', kind: 'ai', title: 'HUB Ассистент' },
    messages: buildMessages(3),
    ...overrides,
  });

  it('shows error text and «Повторить» on a failed run (AI4)', () => {
    const onRetryAiRun = vi.fn();
    renderWithTheme(
      <ChatMessageList
        {...aiProps({
          aiStatus: {
            status: 'failed',
            error_text: 'Провайдер ИИ не ответил вовремя.',
            updated_at: '2026-08-07T04:00:00.000Z',
          },
          onRetryAiRun,
        })}
      />,
    );

    expect(screen.getByTestId('chat-ai-run-failed')).toBeInTheDocument();
    expect(screen.getByText('AI не смог обработать запрос')).toBeInTheDocument();
    expect(screen.getByText('Провайдер ИИ не ответил вовремя.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onRetryAiRun).toHaveBeenCalledTimes(1);
  });

  it('marks a stale running run as «ИИ не отвечает» with retry and stop (AI5/R33)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T04:00:00.000Z'));
    try {
      const onRetryAiRun = vi.fn().mockResolvedValue(undefined);
      const onStopAiRun = vi.fn().mockResolvedValue(undefined);
      renderWithTheme(
        <ChatMessageList
          {...aiProps({
            aiStatus: {
              status: 'running',
              status_text: 'AI анализирует запрос и файлы',
              completed_stages: ['retrieving_kb'],
              updated_at: '2026-08-07T03:50:00.000Z', // 10 минут назад по серверу
              server_now: '2026-08-07T04:00:00.000Z',
            },
            onRetryAiRun,
            onStopAiRun,
          })}
        />,
      );

      expect(screen.getByText('ИИ не отвечает')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
      expect(onRetryAiRun).toHaveBeenCalledTimes(1);
      // busy снимается в finally — ждём тик, пока действие завершится.
      await vi.advanceTimersByTimeAsync(0);
      // R33: «Остановить» доступна прямо в блоке «ИИ не отвечает».
      fireEvent.click(screen.getByRole('button', { name: 'Остановить' }));
      expect(onStopAiRun).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends one retry for a double click: the button stays disabled until the request settles (R30)', async () => {
    let resolveRetry;
    const onRetryAiRun = vi.fn(() => new Promise((resolve) => { resolveRetry = resolve; }));
    renderWithTheme(
      <ChatMessageList
        {...aiProps({
          aiStatus: { status: 'failed', error_text: 'Провайдер ИИ не ответил вовремя.' },
          onRetryAiRun,
        })}
      />,
    );

    const retryButton = screen.getByRole('button', { name: 'Повторить' });
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);
    expect(onRetryAiRun).toHaveBeenCalledTimes(1);
    expect(retryButton).toBeDisabled();

    resolveRetry();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Повторить' })).not.toBeDisabled());
  });

  it('keeps the normal stage status for a fresh running run', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T04:00:00.000Z'));
    try {
      renderWithTheme(
        <ChatMessageList
          {...aiProps({
            aiStatus: {
              status: 'running',
              status_text: 'AI анализирует запрос и файлы',
              updated_at: '2026-08-07T03:59:50.000Z',
              server_now: '2026-08-07T04:00:00.000Z',
            },
          })}
        />,
      );

      expect(screen.getByTestId('chat-ai-run-status')).toBeInTheDocument();
      expect(screen.getByText('AI анализирует запрос и файлы')).toBeInTheDocument();
      expect(screen.queryByText('ИИ не отвечает')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not flag a fresh run as stale when the client clock is ahead of the server (R36)', () => {
    vi.useFakeTimers();
    // Часы клиента спешат на 10 минут — раньше это давало ложное «ИИ не отвечает».
    vi.setSystemTime(new Date('2026-08-07T04:10:00.000Z'));
    try {
      renderWithTheme(
        <ChatMessageList
          {...aiProps({
            aiStatus: {
              status: 'running',
              status_text: 'AI анализирует запрос и файлы',
              updated_at: '2026-08-07T03:59:50.000Z',
              server_now: '2026-08-07T04:00:00.000Z',
            },
          })}
        />,
      );

      expect(screen.getByTestId('chat-ai-run-status')).toBeInTheDocument();
      expect(screen.queryByText('ИИ не отвечает')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the collapsed «Выполнено N шагов» row for a completed run and expands the steps (AI9)', () => {
    renderWithTheme(
      <ChatMessageList
        {...aiProps({
          aiStatus: {
            status: 'completed',
            completed_stages: ['analyzing_request', 'retrieving_kb', 'generating_answer'],
          },
        })}
      />,
    );

    const toggle = screen.getByRole('button', { name: 'Выполнено 3 шага' });
    expect(toggle).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('Ищу в базе знаний')).toBeInTheDocument();
  });

  it('does not render the AI run status for non-AI conversations', () => {
    renderWithTheme(
      <ChatMessageList
        {...buildProps({
          messages: buildMessages(3),
          aiStatus: { status: 'failed', error_text: 'boom' },
        })}
      />,
    );

    expect(screen.queryByTestId('chat-ai-run-failed')).not.toBeInTheDocument();
  });
});

describe('shouldGroupMessages (Д2-2)', () => {
  const at = (iso) => ({ created_at: iso, sender: { id: 1 }, kind: 'text', is_own: false });

  it('groups consecutive same-author messages regardless of content kind', () => {
    const text = at('2026-09-30T10:00:00Z');
    const photo = { ...at('2026-09-30T10:02:00Z'), kind: 'file', attachments: [{ id: 'a1' }] };
    const poll = { ...at('2026-09-30T10:04:00Z'), kind: 'poll' };
    expect(shouldGroupMessages(text, photo)).toBe(true);
    expect(shouldGroupMessages(photo, poll)).toBe(true);
  });

  it('does not group messages from different sides or over 10 minutes apart', () => {
    const first = at('2026-09-30T10:00:00Z');
    expect(shouldGroupMessages(first, { ...at('2026-09-30T10:01:00Z'), is_own: true })).toBe(false);
    expect(shouldGroupMessages(first, at('2026-09-30T10:12:00Z'))).toBe(false);
    expect(shouldGroupMessages(first, { ...at('2026-09-30T10:01:00Z'), sender: { id: 2 } })).toBe(false);
  });

  it('breaks the series on system messages', () => {
    const text = at('2026-09-30T10:00:00Z');
    const system = { ...at('2026-09-30T10:01:00Z'), kind: 'system' };
    expect(shouldGroupMessages(text, system)).toBe(false);
    expect(shouldGroupMessages(system, text)).toBe(false);
  });
});
