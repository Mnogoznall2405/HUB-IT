import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { ChatBubble } from './ChatBubble';
import { getComposerMentionTrigger } from './ChatComposer';
import ChatThread, {
  getChatKeyboardBottomSpacer,
  getChatThreadBottomPadding,
} from './ChatThread';
import {
  isMobileMessageLongPress,
  shouldAnimateChatBubble,
  shouldCancelLongPressMove,
  shouldSuppressNativeMessageGesture,
} from './chatBubbleGesturePolicy';
import { buildChatUiTokens } from './chatUiTokens';

const theme = createTheme();
const ui = {
  textSecondary: '#64748b',
  accentText: '#38bdf8',
  accentSoft: 'rgba(56,189,248,0.16)',
  bubbleOwnBg: '#2b5278',
  bubbleOwnText: '#f8fafc',
  bubbleOtherBg: '#182533',
  bubbleOtherText: '#f8fafc',
  composerBg: '#17212b',
  composerDockBg: '#17212b',
  composerInputBg: '#223140',
  borderSoft: 'rgba(148,163,184,0.2)',
  shadowSoft: '0 10px 24px rgba(15,23,42,0.08)',
  shadowStrong: '0 18px 48px rgba(15,23,42,0.16)',
  threadBg: '#0e1621',
  threadTopbarBg: 'rgba(23,33,43,0.94)',
  sidebarRowHover: 'rgba(255,255,255,0.06)',
};

const renderWithTheme = (node) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);

const getBubbleSurfaceByText = (text) => screen.getByText(text).closest('[data-chat-bubble-surface="true"]');

function installIntersectionObserverMock() {
  const OriginalIntersectionObserver = window.IntersectionObserver;
  const observers = [];

  class MockIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.node = null;
      this.observe = vi.fn((node) => {
        this.node = node;
      });
      this.unobserve = vi.fn();
      this.disconnect = vi.fn();
      observers.push(this);
    }

    trigger(isIntersecting = true) {
      this.callback([{ isIntersecting, target: this.node }]);
    }
  }

  window.IntersectionObserver = MockIntersectionObserver;
  return {
    observers,
    restore: () => {
      window.IntersectionObserver = OriginalIntersectionObserver;
    },
  };
}

const buildThreadProps = (overrides = {}) => ({
  theme,
  ui,
  isMobile: true,
  compactMobile: true,
  activeConversation: {
    id: 'conv-1',
    title: 'Task Assignee',
    kind: 'direct',
    unread_count: 0,
    direct_peer: {
      id: 2,
      username: 'assignee',
      full_name: 'Task Assignee',
      presence: { is_online: true },
    },
  },
  activeConversationId: 'conv-1',
  navigate: vi.fn(),
  threadWallpaperSx: {},
  messages: [],
  messagesLoading: false,
  effectiveLastReadMessageId: '',
  messagesHasMore: false,
  loadingOlder: false,
  onLoadOlder: vi.fn(),
  threadScrollRef: { current: null },
  threadContentRef: { current: null },
  onThreadScroll: vi.fn(),
  bottomRef: { current: null },
  onBack: vi.fn(),
  onOpenInfo: vi.fn(),
  onOpenSearch: vi.fn(),
  onOpenReads: vi.fn(),
  onOpenAttachmentPreview: vi.fn(),
  onReplyMessage: vi.fn(),
  onOpenMessageMenu: vi.fn(),
  onOpenComposerMenu: vi.fn(),
  composerRef: React.createRef(),
  messageText: '',
  onMessageTextChange: vi.fn(),
  onComposerKeyDown: vi.fn(),
  onComposerSelectionSync: vi.fn(),
  onOpenEmojiPicker: vi.fn(),
  onSendMessage: vi.fn(),
  sending: false,
  onComposerPaste: vi.fn(),
  onComposerDrop: vi.fn(),
  onComposerDragOver: vi.fn(),
  onComposerDragLeave: vi.fn(),
  isFileDragActive: false,
  showJumpToLatest: false,
  onJumpToLatest: vi.fn(),
  replyMessage: null,
  onClearReply: vi.fn(),
  pinnedMessage: null,
  aiStatusDisplay: null,
  onOpenPinnedMessage: vi.fn(),
  onUnpinPinnedMessage: vi.fn(),
  highlightedMessageId: '',
  headerSubtitle: 'В сети',
  typingLine: '',
  contextPanelOpen: false,
  selectedFiles: [],
  fileCaption: '',
  onOpenFileDialog: vi.fn(),
  onClearSelectedFiles: vi.fn(),
  preparingFiles: false,
  sendingFiles: false,
  fileUploadProgress: 0,
  selectedFilesSummary: null,
  getReadTargetRef: vi.fn(() => undefined),
  ...overrides,
});

describe('ChatBubble', () => {
  it('highlights plain-text mentions in message bodies', () => {
    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-mention',
          kind: 'text',
          body: 'Посмотри, @assignee',
          is_own: false,
          sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
      />,
    );

    expect(screen.getByText('@assignee')).toBeInTheDocument();
  });

  it('renders own plain-text urls with readable colors on light theme', () => {
    const lightTheme = createTheme({ palette: { mode: 'light' } });
    const lightUi = buildChatUiTokens(lightTheme);

    render(
      <ThemeProvider theme={lightTheme}>
        <ChatBubble
          conversationKind="direct"
          message={{
            id: 'msg-url-own',
            kind: 'text',
            body: 'Смотри https://example.com',
            is_own: true,
          }}
          navigate={vi.fn()}
          theme={lightTheme}
          ui={lightUi}
          onOpenReads={vi.fn()}
          onOpenAttachmentPreview={vi.fn()}
          onReplyMessage={vi.fn()}
        />
      </ThemeProvider>,
    );

    const link = screen.getByRole('link', { name: 'https://example.com' });
    expect(link).toHaveStyle({ color: 'rgb(61, 125, 43)' });
  });

  it('uses a smaller body font for compact mobile messages', () => {
    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-mobile-font',
          kind: 'text',
          body: 'Compact mobile text',
          is_own: false,
          sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        compactMobile
      />,
    );

    expect(screen.getByText('Compact mobile text')).toHaveStyle({ fontSize: '15px' });
  });

  it('uses compact desktop message body font size when compact desktop density is active', () => {
    const compactDesktopUi = buildChatUiTokens(theme, { compactDesktop: true });
    const compactTheme = createTheme({
      typography: {
        body1: {
          fontSize: '0.875rem',
          '@media (min-width:600px) and (max-width:1920px), (min-width:600px) and (max-height:960px)': {
            fontSize: '0.8125rem',
          },
        },
      },
    });

    render(
      <ThemeProvider theme={compactTheme}>
        <ChatBubble
          conversationKind="direct"
          message={{
            id: 'msg-desktop-font',
            kind: 'text',
            body: 'Desktop compact density text',
            is_own: false,
            sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
          }}
          navigate={vi.fn()}
          theme={compactTheme}
          ui={compactDesktopUi}
          onOpenReads={vi.fn()}
          onOpenAttachmentPreview={vi.fn()}
          onReplyMessage={vi.fn()}
          compactMobile={false}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText('Desktop compact density text')).toHaveStyle({ fontSize: '15px' });
  });

  it('uses one compact desktop primary font size for header, message body, and composer', () => {
    const compactDesktopUi = buildChatUiTokens(theme, { compactDesktop: true });
    const hostileTheme = createTheme({
      typography: {
        body1: {
          fontSize: '0.875rem',
          '@media (min-width:600px) and (max-width:1920px), (min-width:600px) and (max-height:960px)': {
            fontSize: '0.8125rem',
          },
        },
      },
    });

    render(
      <ThemeProvider theme={hostileTheme}>
        <ChatThread
          {...buildThreadProps({
            theme: hostileTheme,
            isMobile: false,
            compactMobile: false,
            ui: compactDesktopUi,
            messageText: '',
            activeConversation: {
              id: 'conv-1',
              title: 'Header Person',
              kind: 'direct',
              unread_count: 0,
              direct_peer: {
                id: 2,
                username: 'assignee',
                full_name: 'Header Person',
                presence: { is_online: true },
              },
            },
            messages: [
              {
                id: 'msg-thread-font',
                conversation_id: 'conv-1',
                kind: 'text',
                body: 'Thread scoped desktop text',
                created_at: '2026-03-21T10:02:00Z',
                is_own: false,
                sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
              },
            ],
          })}
        />
      </ThemeProvider>,
    );

    const messageBody = screen.getByText('Thread scoped desktop text');
    const bubbleSurface = getBubbleSurfaceByText('Thread scoped desktop text');
    const composerTextarea = screen.getByTestId('chat-composer-textarea');
    const composerTextareaSlot = screen.getByTestId('chat-composer-textarea-slot');
    const composerCapsule = screen.getByTestId('chat-composer-capsule');

    expect(screen.getByText('Header Person')).toHaveStyle({ fontSize: '15px' });
    expect(messageBody).toHaveStyle({ fontSize: '15px', lineHeight: '1.26' });
    expect(bubbleSurface).toHaveStyle({
      paddingTop: '4px',
      paddingRight: '6.24px',
      paddingBottom: '4px',
      paddingLeft: '6.24px',
    });
    expect(composerTextarea).toHaveStyle({ fontSize: '15px', lineHeight: '1.26' });
    expect(composerTextareaSlot).toHaveStyle({
      alignItems: 'center',
      minHeight: '26px',
      paddingTop: '0px',
      paddingBottom: '0px',
    });
    expect(composerCapsule).toHaveStyle({ minHeight: '34px' });
  });

  it('renders reactions in a Telegram-style footer beside the message time', () => {
    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-reaction-footer',
          kind: 'text',
          body: 'Ara ara',
          created_at: '2026-03-21T10:02:00Z',
          is_own: false,
          sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
          reactions: [
            { emoji: '🔥', count: 1, user_ids: ['1'] },
            { emoji: '🌚', count: 1, user_ids: [] },
          ],
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        onToggleReaction={vi.fn()}
        currentUserId="1"
        compactMobile
      />,
    );

    const footer = screen.getByTestId('chat-bubble-reaction-footer');
    const reactionsBar = within(footer).getByTestId('chat-reactions-bar');
    expect(reactionsBar).toBeInTheDocument();
    expect(within(footer).getByTestId('chat-bubble-meta-bottom')).toBeInTheDocument();
    expect(within(reactionsBar).getAllByTestId('chat-reaction-emoji')[0]).toHaveStyle({ fontSize: '13px' });
    expect(within(reactionsBar).queryByText('1')).not.toBeInTheDocument();
  });

  it('does not run the downward appear animation for outgoing sending messages', () => {
    expect(shouldAnimateChatBubble({
      isOwn: true,
      isOptimistic: true,
      isSending: true,
    })).toBe(false);
    expect(shouldAnimateChatBubble({
      compactMobile: true,
      isOwn: true,
      isOptimistic: true,
      isSending: true,
    })).toBe(false);
    expect(shouldAnimateChatBubble({
      isOwn: true,
      isOptimistic: false,
      isSending: false,
    })).toBe(false);
    expect(shouldAnimateChatBubble({
      isOwn: false,
      isOptimistic: false,
      isSending: false,
    })).toBe(true);
  });

  it('renders attachments together with the optional file caption', () => {
    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-1',
          kind: 'file',
          body: 'Подпись к вложению',
          is_own: true,
          attachments: [
            {
              id: 'att-1',
              file_name: 'report.pdf',
              mime_type: 'application/pdf',
              file_size: 4096,
            },
          ],
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
      />,
    );

    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('Подпись к вложению')).toBeInTheDocument();
  });

  it('renders office mail action details and edit action', () => {
    const onEditAction = vi.fn();
    renderWithTheme(
      <ChatBubble
        conversationKind="ai"
        message={{
          id: 'msg-action-mail',
          kind: 'text',
          body: 'Mail draft',
          body_format: 'markdown',
          is_own: false,
          action_card: {
            id: 'action-mail-1',
            action_type: 'office.mail.send',
            status: 'pending',
            preview: {
              title: 'Отправка письма',
              summary: 'Subject -> ivanov@example.com',
              effects: ['подпись будет добавлена автоматически при отправке'],
              warnings: ['Письмо без темы.'],
              mail: {
                to: ['ivanov@example.com'],
                cc: ['copy@example.com'],
                bcc_count: 1,
                subject: 'Subject',
                body_preview: 'Body preview',
                attachment_count: 2,
              },
            },
          },
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        onConfirmAction={vi.fn()}
        onCancelAction={vi.fn()}
        onEditAction={onEditAction}
      />,
    );

    expect(screen.getByText('Кому: ivanov@example.com')).toBeInTheDocument();
    expect(screen.getByText('Тема: Subject')).toBeInTheDocument();
    expect(screen.getByText('Вложения: 2')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Редактировать'));
    expect(onEditAction).toHaveBeenCalledTimes(1);
  });

  it('hides repeated sender name for grouped messages', () => {
    renderWithTheme(
      <ChatBubble
        conversationKind="group"
        message={{
          id: 'msg-2',
          kind: 'text',
          body: 'Продолжение без повторного имени',
          is_own: false,
          sender: {
            id: 42,
            full_name: 'Иван Петров',
          },
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        groupedWithPrevious
      />,
    );

    expect(screen.queryByText('Иван Петров')).not.toBeInTheDocument();
    expect(screen.getByText('Продолжение без повторного имени')).toBeInTheDocument();
  });

  it('uses inline meta for short text and bottom meta for multiline text', () => {
    const { rerender } = renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-inline',
          kind: 'text',
          body: 'Короткий текст',
          created_at: '2026-03-21T10:03:00Z',
          is_own: true,
          delivery_status: 'sent',
          sender: { id: 1, username: 'author', full_name: 'Task Author' },
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        compactMobile
      />,
    );

    expect(screen.getByTestId('chat-bubble-meta-inline')).toBeInTheDocument();

    rerender(
      <ThemeProvider theme={theme}>
        <ChatBubble
          conversationKind="direct"
          message={{
            id: 'msg-inline-edited',
            kind: 'text',
            body: 'Приятного отдыха',
            created_at: '2026-03-21T01:18:00Z',
            edited_at: '2026-03-21T01:25:00Z',
            is_own: true,
            delivery_status: 'read',
            sender: { id: 1, username: 'author', full_name: 'Task Author' },
          }}
          navigate={vi.fn()}
          theme={theme}
          ui={ui}
          onOpenReads={vi.fn()}
          onOpenAttachmentPreview={vi.fn()}
          onReplyMessage={vi.fn()}
          compactMobile
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('chat-bubble-meta-inline')).toBeInTheDocument();
    expect(screen.getByText(/изм\./)).toBeInTheDocument();

    rerender(
      <ThemeProvider theme={theme}>
        <ChatBubble
          conversationKind="direct"
          message={{
            id: 'msg-bottom',
            kind: 'text',
            body: 'Первая строка\nВторая строка с длинным сообщением',
            created_at: '2026-03-21T10:04:00Z',
            is_own: true,
            delivery_status: 'sent',
            sender: { id: 1, username: 'author', full_name: 'Task Author' },
          }}
          navigate={vi.fn()}
          theme={theme}
          ui={ui}
          onOpenReads={vi.fn()}
          onOpenAttachmentPreview={vi.fn()}
          onReplyMessage={vi.fn()}
          compactMobile
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('chat-bubble-meta-bottom')).toBeInTheDocument();
  });

  it('uses bottom meta for longer single-line desktop messages to avoid text overlap', () => {
    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-desktop-long-single-line',
          kind: 'text',
          body: 'Privet, esli budut voprosy pishi mne',
          created_at: '2026-03-21T10:48:00Z',
          is_own: true,
          delivery_status: 'sent',
          sender: { id: 1, username: 'author', full_name: 'Task Author' },
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        compactMobile={false}
      />,
    );

    const meta = screen.getByTestId('chat-bubble-meta-bottom');
    expect(meta).toBeInTheDocument();
    expect(meta).toHaveStyle({ position: 'relative' });
    expect(screen.queryByTestId('chat-bubble-meta-inline')).not.toBeInTheDocument();
    expect(screen.getByText('Privet, esli budut voprosy pishi mne')).toBeInTheDocument();
  });

  it('renders a forwarded attribution block above the copied message body', () => {
    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-forward',
          kind: 'text',
          body: 'Forwarded copied text',
          created_at: '2026-03-21T10:03:00Z',
          is_own: false,
          sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
          forward_preview: {
            id: 'msg-origin',
            sender_name: 'Task Author',
            kind: 'text',
            body: 'Original snippet should not render',
            attachments_count: 0,
          },
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
      />,
    );

    expect(screen.getByTestId('chat-forward-preview')).toBeInTheDocument();
    expect(screen.getByTestId('chat-forward-preview')).toHaveTextContent('Переслано от Task Author');
    expect(screen.queryByText('Original snippet should not render')).not.toBeInTheDocument();
    expect(screen.getByText('Forwarded copied text')).toBeInTheDocument();
  });

  it('renders markdown message bodies with markdown elements', () => {
    const message = {
      id: 'msg-markdown',
      kind: 'text',
      body_format: 'markdown',
      body: '## Markdown Title\n\n| Name | Value |\n| --- | --- |\n| Printer | Ready |',
      created_at: '2026-03-21T10:03:00Z',
      is_own: false,
      sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
    };
    const { rerender } = renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={message}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Markdown Title' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-table-scroll')).toBeInTheDocument();
    expect(screen.getByRole('table').closest('[data-chat-table-layout="wide"]')).not.toBeNull();
    expect(screen.getByTestId('chat-bubble-meta-bottom')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-bubble-meta-inline')).not.toBeInTheDocument();
    expect(screen.queryByText('## Markdown Title')).not.toBeInTheDocument();

    rerender(
      <ThemeProvider theme={theme}>
        <ChatBubble
          conversationKind="direct"
          message={message}
          navigate={vi.fn()}
          theme={theme}
          ui={ui}
          onOpenReads={vi.fn()}
          onOpenAttachmentPreview={vi.fn()}
          onReplyMessage={vi.fn()}
          selectionMode
          selected
        />
      </ThemeProvider>,
    );
    expect(screen.getAllByTestId('chat-markdown-body')).toHaveLength(1);
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('keeps explicitly plain Telegram-like numbered text literal', () => {
    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-plain-list',
          kind: 'text',
          body_format: 'plain',
          body: '1. купить картридж\n2. закрыть заявку',
          created_at: '2026-03-21T10:03:00Z',
          is_own: true,
          sender: { id: 1, username: 'me', full_name: 'Me' },
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
      />,
    );

    const bodyNode = document.querySelector('[data-chat-message-body="true"]');
    expect(bodyNode).toHaveTextContent('1. купить картридж');
    expect(bodyNode).toHaveTextContent('2. закрыть заявку');
    expect(screen.queryByTestId('chat-markdown-body')).not.toBeInTheDocument();
    expect(document.querySelector('[data-chat-message-body="true"] ol')).toBeNull();
  });

  it('renders explicit markdown ordered and unordered lists with visible markers', () => {
    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-markdown-list',
          kind: 'text',
          body_format: 'markdown',
          body: '1. First item\n2. Second item\n\n- Bullet item',
          created_at: '2026-03-21T10:03:00Z',
          is_own: false,
          sender: { id: 2, username: 'assistant', full_name: 'Assistant' },
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
      />,
    );

    const orderedList = document.querySelector('[data-testid="chat-markdown-body"] ol');
    const unorderedList = document.querySelector('[data-testid="chat-markdown-body"] ul');
    expect(orderedList).not.toBeNull();
    expect(unorderedList).not.toBeNull();
    expect(window.getComputedStyle(orderedList).listStyleType).toBe('decimal');
    expect(window.getComputedStyle(unorderedList).listStyleType).toBe('disc');
    expect(screen.getByText('First item')).toBeInTheDocument();
    expect(screen.getByText('Bullet item')).toBeInTheDocument();
  });

  it('renders forwarded markdown as markdown and keeps the preview attribution-only', () => {
    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-forward-markdown',
          kind: 'text',
          body_format: 'markdown',
          body: '## Forwarded Title\n\n| Model | Status | Owner |\n| --- | --- | --- |\n| Xerox VersaLink C7020 MFP | Ready | ITinvent |\n\n**Source:** ITinvent',
          created_at: '2026-03-21T10:03:00Z',
          is_own: false,
          sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
          forward_preview: {
            id: 'msg-origin',
            sender_name: 'AI',
            kind: 'text',
            body: '## Forwarded Title',
            attachments_count: 0,
          },
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
      />,
    );

    expect(screen.getByTestId('chat-forward-preview')).toHaveTextContent('Переслано от AI');
    expect(screen.getByTestId('chat-forward-preview')).not.toHaveTextContent('Forwarded Title');
    expect(screen.getByTestId('chat-forward-preview')).not.toHaveTextContent('## Forwarded Title');
    expect(screen.getByRole('heading', { name: 'Forwarded Title' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-table-scroll')).toBeInTheDocument();
  });

  it('avoids duplicating the original forwarded text inside the preview block', () => {
    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-forward-same',
          kind: 'text',
          body: 'Оригинал',
          created_at: '2026-03-21T10:03:00Z',
          is_own: false,
          sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
          forward_preview: {
            id: 'msg-origin',
            sender_name: 'Task Author',
            kind: 'text',
            body: 'Оригинал',
            attachments_count: 0,
          },
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
      />,
    );

    expect(screen.getByTestId('chat-forward-preview')).toBeInTheDocument();
    expect(screen.getByTestId('chat-forward-preview')).toHaveTextContent('Переслано от Task Author');
    expect(screen.getAllByText('Оригинал')).toHaveLength(1);
  });

  it('triggers reply on mobile long press', () => {
    vi.useFakeTimers();
    const onReplyMessage = vi.fn();

    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-3',
          kind: 'text',
          body: 'hello',
          is_own: true,
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={onReplyMessage}
        compactMobile
      />,
    );

    fireEvent.touchStart(getBubbleSurfaceByText('hello'));
    vi.advanceTimersByTime(450);

    expect(onReplyMessage).toHaveBeenCalledTimes(1);
    expect(onReplyMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-3' }));
    vi.useRealTimers();
  });

  it('opens the message action menu on mobile long press when provided', () => {
    vi.useFakeTimers();
    const onReplyMessage = vi.fn();
    const onOpenMessageMenu = vi.fn();

    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-4',
          kind: 'text',
          body: 'menu',
          is_own: false,
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={onReplyMessage}
        onOpenMessageMenu={onOpenMessageMenu}
        compactMobile
      />,
    );

    fireEvent.touchStart(getBubbleSurfaceByText('menu'));
    vi.advanceTimersByTime(450);

    expect(onOpenMessageMenu).toHaveBeenCalledTimes(1);
    expect(onOpenMessageMenu.mock.calls[0][0]).toEqual(expect.objectContaining({ id: 'msg-4' }));
    expect(onReplyMessage).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('starts message selection on mobile long press after tiny finger movement', () => {
    vi.useFakeTimers();
    const onStartMessageSelection = vi.fn();

    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-long-select',
          kind: 'text',
          body: 'hold me',
          is_own: false,
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        onStartMessageSelection={onStartMessageSelection}
        compactMobile
      />,
    );

    const bubble = getBubbleSurfaceByText('hold me');
    fireEvent.touchStart(bubble, { touches: [{ clientX: 120, clientY: 240 }] });
    fireEvent.touchMove(bubble, { touches: [{ clientX: 124, clientY: 246 }] });
    vi.advanceTimersByTime(450);

    expect(onStartMessageSelection).toHaveBeenCalledTimes(1);
    expect(onStartMessageSelection).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-long-select' }));
    vi.useRealTimers();
  });

  it('starts message selection on pure mobile hold without requiring finger movement', () => {
    vi.useFakeTimers();
    const onStartMessageSelection = vi.fn();

    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-pure-hold-select',
          kind: 'text',
          body: 'pure hold',
          is_own: false,
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        onStartMessageSelection={onStartMessageSelection}
        mobileInteractionsEnabled
      />,
    );

    const bubble = getBubbleSurfaceByText('pure hold');
    fireEvent.touchStart(bubble, { touches: [{ clientX: 120, clientY: 240 }] });
    vi.advanceTimersByTime(450);

    expect(onStartMessageSelection).toHaveBeenCalledTimes(1);
    expect(onStartMessageSelection).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-pure-hold-select' }));
    vi.useRealTimers();
  });

  it('starts message selection on mobile long press even when the layout is wider than phone', () => {
    vi.useFakeTimers();
    const onStartMessageSelection = vi.fn();

    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-mobile-wide-select',
          kind: 'text',
          body: 'wide mobile hold',
          is_own: false,
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        onStartMessageSelection={onStartMessageSelection}
        compactMobile={false}
        mobileInteractionsEnabled
      />,
    );

    fireEvent.touchStart(getBubbleSurfaceByText('wide mobile hold'), {
      touches: [{ clientX: 140, clientY: 260 }],
    });
    vi.advanceTimersByTime(450);

    expect(onStartMessageSelection).toHaveBeenCalledTimes(1);
    expect(onStartMessageSelection).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-mobile-wide-select' }));
    vi.useRealTimers();
  });

  it('keeps mobile long press alive through native touchcancel after a tiny movement', () => {
    vi.useFakeTimers();
    const onStartMessageSelection = vi.fn();

    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-touchcancel-select',
          kind: 'text',
          body: 'cancel-safe hold',
          is_own: false,
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        onStartMessageSelection={onStartMessageSelection}
        mobileInteractionsEnabled
      />,
    );

    const bubble = getBubbleSurfaceByText('cancel-safe hold');
    fireEvent.touchStart(bubble, { touches: [{ clientX: 120, clientY: 240 }] });
    fireEvent.touchMove(bubble, { touches: [{ clientX: 124, clientY: 246 }] });
    fireEvent.touchCancel(bubble);
    vi.advanceTimersByTime(450);

    expect(onStartMessageSelection).toHaveBeenCalledTimes(1);
    expect(onStartMessageSelection).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-touchcancel-select' }));
    vi.useRealTimers();
  });

  it('keeps mobile long press alive through native touchcancel after pure hold', () => {
    vi.useFakeTimers();
    const onStartMessageSelection = vi.fn();

    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-touchcancel-pure-select',
          kind: 'text',
          body: 'pure cancel hold',
          is_own: false,
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        onStartMessageSelection={onStartMessageSelection}
        mobileInteractionsEnabled
      />,
    );

    const bubble = getBubbleSurfaceByText('pure cancel hold');
    fireEvent.touchStart(bubble, { touches: [{ clientX: 120, clientY: 240 }] });
    fireEvent.touchCancel(bubble);
    vi.advanceTimersByTime(450);

    expect(onStartMessageSelection).toHaveBeenCalledTimes(1);
    expect(onStartMessageSelection).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-touchcancel-pure-select' }));
    vi.useRealTimers();
  });

  it('suppresses mobile native context menu and selects the message instead', () => {
    const onStartMessageSelection = vi.fn();
    const onOpenMessageMenu = vi.fn();

    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-mobile-context-select',
          kind: 'text',
          body: 'context hold',
          is_own: false,
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        onStartMessageSelection={onStartMessageSelection}
        onOpenMessageMenu={onOpenMessageMenu}
        mobileInteractionsEnabled
      />,
    );

    fireEvent.contextMenu(getBubbleSurfaceByText('context hold'));

    expect(onStartMessageSelection).toHaveBeenCalledTimes(1);
    expect(onStartMessageSelection).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-mobile-context-select' }));
    expect(onOpenMessageMenu).not.toHaveBeenCalled();
  });

  it('starts message selection through pointer fallback when touch events are not delivered', () => {
    vi.useFakeTimers();
    const onStartMessageSelection = vi.fn();

    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-pointer-select',
          kind: 'text',
          body: 'pointer hold',
          is_own: false,
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        onStartMessageSelection={onStartMessageSelection}
        mobileInteractionsEnabled
      />,
    );

    const bubble = getBubbleSurfaceByText('pointer hold');
    fireEvent.pointerDown(bubble, {
      pointerType: 'touch',
      pointerId: 9,
      clientX: 120,
      clientY: 240,
    });
    vi.advanceTimersByTime(450);

    expect(onStartMessageSelection).toHaveBeenCalledTimes(1);
    expect(onStartMessageSelection).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-pointer-select' }));
    vi.useRealTimers();
  });

  it('does not double-select when pointer and touch start fire for the same mobile hold', () => {
    vi.useFakeTimers();
    const onStartMessageSelection = vi.fn();

    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-dupe-gesture',
          kind: 'text',
          body: 'dupe hold',
          is_own: false,
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        onStartMessageSelection={onStartMessageSelection}
        mobileInteractionsEnabled
      />,
    );

    const bubble = getBubbleSurfaceByText('dupe hold');
    fireEvent.pointerDown(bubble, {
      pointerType: 'touch',
      pointerId: 4,
      clientX: 120,
      clientY: 240,
    });
    fireEvent.touchStart(bubble, { touches: [{ clientX: 120, clientY: 240 }] });
    vi.advanceTimersByTime(450);

    expect(onStartMessageSelection).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('suppresses mobile context menu during a pending hold without selecting twice', () => {
    vi.useFakeTimers();
    const onStartMessageSelection = vi.fn();
    const onOpenMessageMenu = vi.fn();

    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-context-pending',
          kind: 'text',
          body: 'pending context',
          is_own: false,
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        onStartMessageSelection={onStartMessageSelection}
        onOpenMessageMenu={onOpenMessageMenu}
        mobileInteractionsEnabled
      />,
    );

    const bubble = getBubbleSurfaceByText('pending context');
    fireEvent.pointerDown(bubble, {
      pointerType: 'touch',
      pointerId: 5,
      clientX: 120,
      clientY: 240,
    });
    fireEvent.contextMenu(bubble);
    vi.advanceTimersByTime(450);

    expect(onStartMessageSelection).toHaveBeenCalledTimes(1);
    expect(onOpenMessageMenu).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('cancels mobile long press when the finger moves like a scroll', () => {
    vi.useFakeTimers();
    const onStartMessageSelection = vi.fn();

    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-long-scroll',
          kind: 'text',
          body: 'scroll me',
          is_own: false,
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        onStartMessageSelection={onStartMessageSelection}
        compactMobile
      />,
    );

    const bubble = getBubbleSurfaceByText('scroll me');
    fireEvent.touchStart(bubble, { touches: [{ clientX: 120, clientY: 240 }] });
    fireEvent.touchMove(bubble, { touches: [{ clientX: 122, clientY: 270 }] });
    vi.advanceTimersByTime(450);

    expect(onStartMessageSelection).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('opens the message action menu at the pointer position on desktop right click', () => {
    const onOpenMessageMenu = vi.fn();

    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-ctx',
          kind: 'text',
          body: 'context menu',
          is_own: false,
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        onOpenMessageMenu={onOpenMessageMenu}
      />,
    );

    fireEvent.contextMenu(getBubbleSurfaceByText('context menu'), {
      clientX: 148,
      clientY: 212,
    });

    expect(onOpenMessageMenu).toHaveBeenCalledTimes(1);
    expect(onOpenMessageMenu.mock.calls[0][0]).toEqual(expect.objectContaining({ id: 'msg-ctx' }));
    expect(onOpenMessageMenu.mock.calls[0][1]).toEqual(expect.objectContaining({
      anchorReference: 'anchorPosition',
      anchorPosition: { left: 148, top: 212 },
    }));
  });

  it('renders an unread separator from the effective read marker', () => {
    renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          messages: [
            {
              id: 'msg-1',
              conversation_id: 'conv-1',
              kind: 'text',
              body: 'Read message',
              created_at: '2026-03-21T10:00:00Z',
              is_own: true,
              sender: { id: 1, username: 'author', full_name: 'Task Author' },
            },
            {
              id: 'msg-2',
              conversation_id: 'conv-1',
              kind: 'text',
              body: 'Unread message',
              created_at: '2026-03-21T10:01:00Z',
              is_own: false,
              sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
            },
          ],
          effectiveLastReadMessageId: 'msg-1',
        })}
      />,
    );

    expect(screen.getByTestId('chat-unread-separator')).toBeInTheDocument();
  });

  it('forwards message-list load older and jump-to-latest actions', () => {
    const onLoadOlder = vi.fn();
    const onJumpToLatest = vi.fn();

    renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          activeConversation: {
            ...buildThreadProps().activeConversation,
            unread_count: 2,
          },
          messages: [
            {
              id: 'msg-list-action',
              conversation_id: 'conv-1',
              kind: 'text',
              body: 'List action anchor',
              created_at: '2026-03-21T10:00:00Z',
              is_own: false,
              sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
            },
          ],
          messagesHasMore: true,
          showJumpToLatest: true,
          onLoadOlder,
          onJumpToLatest,
        })}
      />,
    );

    const messageListActionButtons = screen.getAllByRole('button')
      .filter((button) => !button.getAttribute('aria-label') && String(button.textContent || '').trim());

    expect(messageListActionButtons).toHaveLength(2);

    fireEvent.click(messageListActionButtons[0]);
    expect(onLoadOlder).toHaveBeenCalledTimes(1);

    fireEvent.click(messageListActionButtons[1]);
    expect(onJumpToLatest).toHaveBeenCalledTimes(1);
  });

  it('does not auto-load older history on initial mobile render', () => {
    const intersection = installIntersectionObserverMock();
    const onLoadOlder = vi.fn();

    try {
      renderWithTheme(
        <ChatThread
          {...buildThreadProps({
            messages: [
              {
                id: 'msg-mobile-history',
                conversation_id: 'conv-1',
                kind: 'text',
                body: 'Mobile history anchor',
                created_at: '2026-03-21T10:00:00Z',
                is_own: false,
                sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
              },
            ],
            messagesHasMore: true,
            onLoadOlder,
          })}
        />,
      );

      expect(intersection.observers).toHaveLength(0);
      expect(onLoadOlder).not.toHaveBeenCalled();

      const loadOlderButton = screen.getAllByRole('button')
        .find((button) => !button.getAttribute('aria-label') && String(button.textContent || '').trim());
      expect(loadOlderButton).toBeTruthy();
      fireEvent.click(loadOlderButton);
      expect(onLoadOlder).toHaveBeenCalledTimes(1);
    } finally {
      intersection.restore();
    }
  });

  it('does not auto-load older history on initial desktop render', () => {
    const intersection = installIntersectionObserverMock();
    const onLoadOlder = vi.fn();

    try {
      renderWithTheme(
        <ChatThread
          {...buildThreadProps({
            isMobile: false,
            compactMobile: false,
            messages: [
              {
                id: 'msg-desktop-history',
                conversation_id: 'conv-1',
                kind: 'text',
                body: 'Desktop history anchor',
                created_at: '2026-03-21T10:00:00Z',
                is_own: false,
                sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
              },
            ],
            messagesHasMore: true,
            onLoadOlder,
          })}
        />,
      );

      expect(intersection.observers).toHaveLength(0);
      expect(onLoadOlder).not.toHaveBeenCalled();
    } finally {
      intersection.restore();
    }
  });

  it('does not auto-load older history when the thread is not scrollable', async () => {
    const intersection = installIntersectionObserverMock();
    const onLoadOlder = vi.fn();

    try {
      renderWithTheme(
        <ChatThread
          {...buildThreadProps({
            messages: [
              {
                id: 'msg-short-history',
                conversation_id: 'conv-1',
                kind: 'text',
                body: 'Short history anchor',
                created_at: '2026-03-21T10:00:00Z',
                is_own: false,
                sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
              },
            ],
            messagesHasMore: true,
            onLoadOlder,
          })}
        />,
      );

      const scrollRoot = screen.getByTestId('chat-thread-scroll');
      Object.defineProperty(scrollRoot, 'scrollTop', { configurable: true, writable: true, value: 0 });
      Object.defineProperty(scrollRoot, 'scrollHeight', { configurable: true, value: 480 });
      Object.defineProperty(scrollRoot, 'clientHeight', { configurable: true, value: 480 });

      await act(async () => {
        fireEvent.wheel(scrollRoot, { deltaY: -80 });
      });

      expect(intersection.observers).toHaveLength(0);
      expect(onLoadOlder).not.toHaveBeenCalled();
    } finally {
      intersection.restore();
    }
  });

  it('auto-loads older history only after the user scrolls near the top', async () => {
    const intersection = installIntersectionObserverMock();
    const onLoadOlder = vi.fn();

    try {
      renderWithTheme(
        <ChatThread
          {...buildThreadProps({
            messages: [
              {
                id: 'msg-scroll-history',
                conversation_id: 'conv-1',
                kind: 'text',
                body: 'Scroll history anchor',
                created_at: '2026-03-21T10:00:00Z',
                is_own: false,
                sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
              },
            ],
            messagesHasMore: true,
            onLoadOlder,
          })}
        />,
      );

      const scrollRoot = screen.getByTestId('chat-thread-scroll');
      Object.defineProperty(scrollRoot, 'scrollTop', { configurable: true, writable: true, value: 0 });
      Object.defineProperty(scrollRoot, 'scrollHeight', { configurable: true, value: 2400 });
      Object.defineProperty(scrollRoot, 'clientHeight', { configurable: true, value: 600 });

      await act(async () => {
        fireEvent.wheel(scrollRoot, { deltaY: -80 });
      });

      expect(intersection.observers).toHaveLength(1);

      act(() => {
        intersection.observers[0].trigger(true);
      });

      expect(onLoadOlder).toHaveBeenCalledTimes(1);
    } finally {
      intersection.restore();
    }
  });

  it('does not repeat auto-load older while an older request is already loading', async () => {
    const intersection = installIntersectionObserverMock();
    const onLoadOlder = vi.fn();

    try {
      renderWithTheme(
        <ChatThread
          {...buildThreadProps({
            messages: [
              {
                id: 'msg-loading-history',
                conversation_id: 'conv-1',
                kind: 'text',
                body: 'Loading history anchor',
                created_at: '2026-03-21T10:00:00Z',
                is_own: false,
                sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
              },
            ],
            messagesHasMore: true,
            loadingOlder: true,
            onLoadOlder,
          })}
        />,
      );

      const scrollRoot = screen.getByTestId('chat-thread-scroll');
      Object.defineProperty(scrollRoot, 'scrollTop', { configurable: true, writable: true, value: 0 });
      Object.defineProperty(scrollRoot, 'scrollHeight', { configurable: true, value: 2400 });
      Object.defineProperty(scrollRoot, 'clientHeight', { configurable: true, value: 600 });

      await act(async () => {
        fireEvent.wheel(scrollRoot, { deltaY: -80 });
      });

      expect(intersection.observers).toHaveLength(1);

      act(() => {
        intersection.observers[0].trigger(true);
      });

      expect(onLoadOlder).not.toHaveBeenCalled();
    } finally {
      intersection.restore();
    }
  });

  it('renders inline date dividers on mobile without a floating sticky pill', () => {
    vi.setSystemTime(new Date('2026-06-29T12:00:00.000Z'));

    const { container } = renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          isMobile: true,
          compactMobile: true,
          messages: [
            {
              id: 'msg-old',
              conversation_id: 'conv-1',
              kind: 'text',
              body: 'Old message',
              created_at: '2026-06-27T10:00:00.000Z',
              is_own: false,
              sender: { id: 2, username: 'peer', full_name: 'Peer User' },
            },
            {
              id: 'msg-new',
              conversation_id: 'conv-1',
              kind: 'text',
              body: 'Today message',
              created_at: '2026-06-29T10:00:00.000Z',
              is_own: true,
              sender: { id: 1, username: 'author', full_name: 'Task Author' },
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('27 июня')).toBeInTheDocument();
    expect(screen.getByText('Сегодня')).toBeInTheDocument();
    expect(container.querySelector('[data-date-marker]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-date-marker]')).toHaveLength(2);

    vi.useRealTimers();
  });

  it('renders a pinned message bar and forwards open/unpin actions', () => {
    const onOpenPinnedMessage = vi.fn();
    const onUnpinPinnedMessage = vi.fn();

    renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          pinnedMessage: {
            id: 'msg-7',
            senderName: 'Task Author',
            preview: 'Pinned preview',
          },
          onOpenPinnedMessage,
          onUnpinPinnedMessage,
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('chat-pinned-message-open'));
    expect(onOpenPinnedMessage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('chat-pinned-message-close'));
    expect(onUnpinPinnedMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps discussion available and opens the task from a completed-task banner', () => {
    const onOpenTask = vi.fn();

    renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          activeConversation: {
            id: 'task-conv',
            kind: 'task',
            title: 'Задача: Старое название',
            task_id: 'task-1',
            task_title: 'Закрытая задача',
            task_status: 'done',
            task_completed_at: '2026-06-23T09:32:00',
          },
          activeConversationId: 'task-conv',
          onOpenTask,
        })}
      />,
    );

    expect(screen.getByTestId('task-completed-banner')).toHaveTextContent('Задача выполнена 23.06.2026 в 09:32');
    expect(screen.getByText('Закрытая задача')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeEnabled();

    fireEvent.click(within(screen.getByTestId('task-completed-banner')).getByRole('button', { name: 'Открыть задачу' }));
    expect(onOpenTask).toHaveBeenCalledWith('task-1');
  });

  it('does not show the completed-task banner for an active task', () => {
    renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          activeConversation: {
            id: 'task-conv',
            kind: 'task',
            title: 'Активная задача',
            task_id: 'task-1',
            task_status: 'in_progress',
          },
          activeConversationId: 'task-conv',
        })}
      />,
    );

    expect(screen.queryByTestId('task-completed-banner')).not.toBeInTheDocument();
  });

  it('renders Telegram-like message selection controls and actions', () => {
    const onToggleMessageSelection = vi.fn();
    const onClearMessageSelection = vi.fn();
    const onCopySelectedMessages = vi.fn();
    const onReplySelectedMessage = vi.fn();
    const onForwardSelectedMessages = vi.fn();
    const onDeleteSelectedMessages = vi.fn();

    renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          messages: [
            {
              id: 'msg-select-1',
              conversation_id: 'conv-1',
              kind: 'text',
              body: 'Selected message',
              created_at: '2026-03-21T10:00:00Z',
              is_own: true,
              sender: { id: 1, username: 'author', full_name: 'Task Author' },
            },
            {
              id: 'msg-select-2',
              conversation_id: 'conv-1',
              kind: 'text',
              body: 'Second message',
              created_at: '2026-03-21T10:01:00Z',
              is_own: false,
              sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
            },
          ],
          selectedMessageIds: ['msg-select-1'],
          selectedMessageCount: 1,
          canReplySelectedMessage: true,
          canCopySelectedMessages: true,
          canDeleteSelectedMessages: true,
          onToggleMessageSelection,
          onClearMessageSelection,
          onCopySelectedMessages,
          onReplySelectedMessage,
          onForwardSelectedMessages,
          onDeleteSelectedMessages,
        })}
      />,
    );

    expect(screen.getByTestId('chat-selection-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('chat-selection-action-dock')).toBeInTheDocument();
    expect(screen.getByTestId('chat-selection-count-badge')).toHaveTextContent('1');
    expect(screen.getByTestId('chat-selection-reply-action')).toHaveTextContent('Ответить');
    expect(screen.getByTestId('chat-selection-forward-action')).toHaveTextContent('Переслать');
    expect(screen.queryByTestId('chat-selection-count-label')).not.toBeInTheDocument();
    // Удаление на мобильном живёт в верхнем тулбаре (паритет с десктопом),
    // а не в нижнем доке.
    expect(screen.queryByTestId('chat-selection-delete-action')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-selection-header-delete-action')).toBeInTheDocument();
    expect(screen.queryByText('Task Assignee')).not.toBeInTheDocument();
    expect(getComputedStyle(screen.getByText('Selected message').closest('[data-chat-message-id]')).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(screen.getByText('Selected message').closest('[data-chat-bubble-surface="true"]')).toHaveStyle({
      outline: 'none',
      border: 'none',
    });

    fireEvent.click(screen.getByTestId('chat-message-select-msg-select-2'));
    expect(onToggleMessageSelection).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-select-2' }));

    fireEvent.click(screen.getByTestId('chat-selection-copy-action'));
    expect(onCopySelectedMessages).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('chat-selection-reply-action'));
    expect(onReplySelectedMessage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('chat-selection-header-forward-action'));
    expect(onForwardSelectedMessages).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('chat-selection-forward-action'));
    expect(onForwardSelectedMessages).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId('chat-selection-header-delete-action'));
    expect(onDeleteSelectedMessages).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('chat-selection-clear'));
    expect(onClearMessageSelection).toHaveBeenCalledTimes(1);
  });

  it('disables mobile selection reply when multiple messages are selected', () => {
    renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          messages: [
            {
              id: 'msg-select-many-1',
              conversation_id: 'conv-1',
              kind: 'text',
              body: 'First selected message',
              created_at: '2026-03-21T10:00:00Z',
              is_own: true,
              sender: { id: 1, username: 'author', full_name: 'Task Author' },
            },
            {
              id: 'msg-select-many-2',
              conversation_id: 'conv-1',
              kind: 'text',
              body: 'Second selected message',
              created_at: '2026-03-21T10:01:00Z',
              is_own: false,
              sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
            },
          ],
          selectedMessageIds: ['msg-select-many-1', 'msg-select-many-2'],
          selectedMessageCount: 2,
          canReplySelectedMessage: false,
          canCopySelectedMessages: true,
          onClearMessageSelection: vi.fn(),
          onCopySelectedMessages: vi.fn(),
          onForwardSelectedMessages: vi.fn(),
          onReplySelectedMessage: vi.fn(),
        })}
      />,
    );

    expect(screen.getByTestId('chat-selection-count-badge')).toHaveTextContent('2');
    expect(screen.getByTestId('chat-selection-reply-action')).toBeDisabled();
    expect(screen.getByTestId('chat-selection-forward-action')).not.toBeDisabled();
  });

  it('supports a left-edge swipe back gesture on mobile thread', () => {
    const onBack = vi.fn();

    renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          onBack,
          messages: [
            {
              id: 'msg-swipe',
              conversation_id: 'conv-1',
              kind: 'text',
              body: 'Swipe back',
              created_at: '2026-03-21T10:02:00Z',
              is_own: false,
              sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
            },
          ],
        })}
      />,
    );

    const threadRoot = screen.getByTestId('chat-thread-root');
    fireEvent.touchStart(threadRoot, { touches: [{ clientX: 14, clientY: 220 }] });
    fireEvent.touchMove(threadRoot, { touches: [{ clientX: 128, clientY: 224 }] });
    fireEvent.touchEnd(threadRoot, { changedTouches: [{ clientX: 138, clientY: 226 }] });

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders multiple images as a gallery and places message meta on the media surface', () => {
    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-media',
          kind: 'file',
          created_at: '2026-03-21T10:05:00Z',
          is_own: true,
          delivery_status: 'read',
          attachments: [
            { id: 'att-1', file_name: 'one.jpg', mime_type: 'image/jpeg', file_size: 1024, width: 1200, height: 900 },
            { id: 'att-2', file_name: 'two.jpg', mime_type: 'image/jpeg', file_size: 1024, width: 1200, height: 900 },
            { id: 'att-3', file_name: 'three.jpg', mime_type: 'image/jpeg', file_size: 1024, width: 1200, height: 900 },
          ],
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        compactMobile
      />,
    );

    expect(screen.getByTestId('chat-attachment-gallery')).toBeInTheDocument();
    expect(screen.getByTestId('chat-bubble-meta-media')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-bubble-meta-bottom')).not.toBeInTheDocument();
  });

  it('collapses large galleries into four tiles with a +N overlay', () => {
    renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-gallery-large',
          kind: 'file',
          created_at: '2026-03-21T10:06:00Z',
          is_own: false,
          attachments: [
            { id: 'att-1', file_name: 'one.jpg', mime_type: 'image/jpeg', file_size: 1024, width: 1200, height: 900 },
            { id: 'att-2', file_name: 'two.jpg', mime_type: 'image/jpeg', file_size: 1024, width: 1200, height: 900 },
            { id: 'att-3', file_name: 'three.jpg', mime_type: 'image/jpeg', file_size: 1024, width: 1200, height: 900 },
            { id: 'att-4', file_name: 'four.jpg', mime_type: 'image/jpeg', file_size: 1024, width: 1200, height: 900 },
            { id: 'att-5', file_name: 'five.jpg', mime_type: 'image/jpeg', file_size: 1024, width: 1200, height: 900 },
          ],
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        compactMobile
      />,
    );

    expect(screen.getByTestId('chat-attachment-gallery')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('uses an accessible 44px selection target on phone and a compact circle on desktop', () => {
    const { rerender } = renderWithTheme(
      <ChatBubble
        conversationKind="direct"
        message={{
          id: 'msg-circle-size',
          kind: 'text',
          body: 'circle size',
          is_own: false,
        }}
        navigate={vi.fn()}
        theme={theme}
        ui={ui}
        onOpenReads={vi.fn()}
        onOpenAttachmentPreview={vi.fn()}
        onReplyMessage={vi.fn()}
        selectionMode
        selected
        compactMobile
      />,
    );

    expect(screen.getByTestId('chat-message-select-msg-circle-size')).toHaveStyle({
      width: '44px',
      height: '44px',
      top: '50%',
    });

    rerender(
      <ThemeProvider theme={theme}>
        <ChatBubble
          conversationKind="direct"
          message={{
            id: 'msg-circle-size',
            kind: 'text',
            body: 'circle size',
            is_own: false,
          }}
          navigate={vi.fn()}
          theme={theme}
          ui={ui}
          onOpenReads={vi.fn()}
          onOpenAttachmentPreview={vi.fn()}
          onReplyMessage={vi.fn()}
          selectionMode
          selected
          compactMobile={false}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('chat-message-select-msg-circle-size')).toHaveStyle({
      width: '26px',
      height: '26px',
    });
  });
});

describe('ChatThread composer', () => {
  it('keeps mobile message long-press policy independent from compact phone layout', () => {
    expect(isMobileMessageLongPress({ mobileInteractionsEnabled: true, compactMobile: false })).toBe(true);
    expect(isMobileMessageLongPress({ mobileInteractionsEnabled: false, compactMobile: true })).toBe(true);
    expect(isMobileMessageLongPress({ mobileInteractionsEnabled: false, compactMobile: false })).toBe(false);
    expect(shouldSuppressNativeMessageGesture({ mobileInteractionsEnabled: true, compactMobile: false })).toBe(true);
    expect(shouldSuppressNativeMessageGesture({ mobileInteractionsEnabled: false, compactMobile: false })).toBe(false);
    expect(shouldCancelLongPressMove({
      startX: 100,
      startY: 100,
      currentX: 106,
      currentY: 121,
    })).toBe(false);
    expect(shouldCancelLongPressMove({
      startX: 100,
      startY: 100,
      currentX: 103,
      currentY: 132,
    })).toBe(true);
  });

  it('adds only a compact keyboard spacer on mobile and no spacer elsewhere', () => {
    expect(getChatKeyboardBottomSpacer({
      compactMobile: true,
      keyboardInset: 280,
      composerHeight: 112,
    })).toBe(20);
    expect(getChatKeyboardBottomSpacer({
      compactMobile: true,
      keyboardInset: 280,
      composerHeight: 260,
    })).toBe(32);
    expect(getChatKeyboardBottomSpacer({
      compactMobile: false,
      keyboardInset: 280,
      composerHeight: 112,
    })).toBe(0);
    expect(getChatKeyboardBottomSpacer({
      compactMobile: true,
      keyboardInset: 0,
      composerHeight: 112,
    })).toBe(0);
  });

  it('detects a mention trigger at the composer caret', () => {
    expect(getComposerMentionTrigger('Привет @ass', 11)).toEqual({
      start: 7,
      end: 11,
      query: 'ass',
    });
    expect(getComposerMentionTrigger('mail@test', 9)).toBeNull();
    expect(getComposerMentionTrigger('Привет @ass ignee', 16)).toBeNull();
  });

  it('shows mention suggestions and inserts the selected user into the composer', () => {
    function MentionComposerHarness() {
      const [text, setText] = React.useState('');
      return (
        <ChatThread
          {...buildThreadProps({
            messageText: text,
            onMessageTextChange: setText,
            mentionCandidates: [
              {
                id: 2,
                username: 'assignee',
                full_name: 'Task Assignee',
                presence: { is_online: true },
              },
            ],
          })}
        />
      );
    }

    renderWithTheme(<MentionComposerHarness />);
    const composer = screen.getByTestId('chat-composer-textarea');
    fireEvent.change(composer, {
      target: {
        value: '@a',
        selectionStart: 2,
        selectionEnd: 2,
      },
    });

    expect(screen.getByTestId('chat-mention-suggestions')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chat-mention-option-assignee'));
    expect(composer).toHaveValue('@assignee ');
  });

  it('keeps mobile Enter reserved for mention insertion when mention suggestions are open', () => {
    const onComposerKeyDown = vi.fn();

    function MentionComposerHarness() {
      const [text, setText] = React.useState('');
      return (
        <ChatThread
          {...buildThreadProps({
            messageText: text,
            onMessageTextChange: setText,
            onComposerKeyDown,
            mentionCandidates: [
              {
                id: 2,
                username: 'assignee',
                full_name: 'Task Assignee',
                presence: { is_online: true },
              },
            ],
          })}
        />
      );
    }

    renderWithTheme(<MentionComposerHarness />);
    const composer = screen.getByTestId('chat-composer-textarea');
    fireEvent.change(composer, {
      target: {
        value: '@a',
        selectionStart: 2,
        selectionEnd: 2,
      },
    });

    expect(screen.getByTestId('chat-mention-suggestions')).toBeInTheDocument();

    const notPrevented = fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter' });

    expect(notPrevented).toBe(false);
    expect(composer).toHaveValue('@assignee ');
    expect(onComposerKeyDown).not.toHaveBeenCalled();
  });

  it('renders selected files and forwards composer submit interactions', () => {
    const onOpenFileDialog = vi.fn();
    const onClearSelectedFiles = vi.fn();
    const onComposerKeyDown = vi.fn();
    const onSendMessage = vi.fn();

    renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          isMobile: false,
          compactMobile: false,
          messageText: 'ready',
          selectedFiles: [
            new File(['one'], 'report.pdf', { type: 'application/pdf' }),
            new File(['two'], 'photo.png', { type: 'image/png' }),
            new File(['three'], 'archive.zip', { type: 'application/zip' }),
            new File(['four'], 'notes.txt', { type: 'text/plain' }),
          ],
          selectedFilesSummary: {
            finalTotalBytes: 4096,
            originalTotalBytes: 8192,
          },
          fileCaption: 'caption',
          onOpenFileDialog,
          onClearSelectedFiles,
          onComposerKeyDown,
          onSendMessage,
        })}
      />,
    );

    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText('archive.zip')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Изменить'));
    fireEvent.click(screen.getByText('Очистить'));
    expect(onOpenFileDialog).toHaveBeenCalledTimes(1);
    expect(onClearSelectedFiles).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByTestId('chat-composer-textarea'), { key: 'Enter', code: 'Enter' });
    expect(onComposerKeyDown).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('chat-composer-textarea')).toHaveAttribute('enterkeyhint', 'send');

    const sendButton = screen.getByTestId('chat-composer-send-button');
    expect(sendButton).not.toBeDisabled();
    fireEvent.click(sendButton);
    expect(onSendMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps mobile Enter as a textarea newline instead of forwarding submit', () => {
    const onComposerKeyDown = vi.fn();

    renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          compactMobile: true,
          messageText: 'line one',
          onComposerKeyDown,
        })}
      />,
    );

    const composer = screen.getByTestId('chat-composer-textarea');
    expect(composer).toHaveAttribute('enterkeyhint', 'enter');

    const notPrevented = fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter' });

    expect(notPrevented).toBe(true);
    expect(onComposerKeyDown).not.toHaveBeenCalled();
  });

  it('renders Telegram-style file drop panel during drag over', () => {
    renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          isFileDragActive: true,
        })}
      />,
    );

    expect(screen.getByTestId('chat-file-drop-panel')).toBeInTheDocument();
    expect(screen.getByText('Отправить как файл')).toBeInTheDocument();
    expect(screen.getByText('Отпустите мышку, чтобы добавить файл')).toBeInTheDocument();
    expect(screen.queryByText('Отпустите файлы, чтобы добавить их к отправке')).not.toBeInTheDocument();
  });

  it('reserves only a small bottom gap for compact mobile keyboard layout', () => {
    expect(getChatKeyboardBottomSpacer({
      compactMobile: true,
      keyboardInset: 220,
      composerHeight: 96,
    })).toBe(17);

    expect(getChatKeyboardBottomSpacer({
      compactMobile: true,
      keyboardInset: 0,
      composerHeight: 96,
    })).toBe(0);

    expect(getChatKeyboardBottomSpacer({
      compactMobile: false,
      keyboardInset: 220,
      composerHeight: 96,
    })).toBe(0);
  });

  it('preserves thread scroll position when entering selection mode', async () => {
    const messages = [
      {
        id: 'msg-anchor-1',
        conversation_id: 'conv-1',
        kind: 'text',
        body: 'Anchor one',
        created_at: '2026-03-21T10:00:00Z',
        is_own: false,
        sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
      },
      {
        id: 'msg-anchor-2',
        conversation_id: 'conv-1',
        kind: 'text',
        body: 'Anchor two',
        created_at: '2026-03-21T10:01:00Z',
        is_own: true,
        sender: { id: 1, username: 'author', full_name: 'Task Author' },
      },
    ];
    const { rerender } = renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          messages,
          selectedMessageCount: 0,
          selectedMessageIds: [],
        })}
      />,
    );

    const threadScroll = screen.getByTestId('chat-thread-scroll');
    let scrollTop = 240;
    Object.defineProperty(threadScroll, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = Number(value);
      },
    });
    Object.defineProperty(threadScroll, 'scrollHeight', {
      configurable: true,
      get: () => 1200,
    });
    Object.defineProperty(threadScroll, 'clientHeight', {
      configurable: true,
      get: () => 400,
    });

    fireEvent.scroll(threadScroll, { target: { scrollTop: 240 } });
    scrollTop = 312;

    rerender(
      <ThemeProvider theme={theme}>
        <ChatThread
          {...buildThreadProps({
            messages,
            selectedMessageCount: 1,
            selectedMessageIds: ['msg-anchor-1'],
          })}
        />
      </ThemeProvider>,
    );

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(scrollTop).toBe(240);
  });

  it('keeps the thread pinned to bottom when the composer height grows', async () => {
    let resizeObserverCallback = null;
    const originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class ResizeObserverMock {
      constructor(callback) {
        resizeObserverCallback = callback;
      }

      observe() {}

      disconnect() {}
    };

    try {
      renderWithTheme(
        <ChatThread
          {...buildThreadProps({
            messages: [
              {
                id: 'msg-1',
                conversation_id: 'conv-1',
                kind: 'text',
                body: 'Latest message',
                created_at: '2026-03-21T10:02:00Z',
                is_own: true,
                sender: { id: 1, username: 'author', full_name: 'Task Author' },
              },
            ],
          })}
        />,
      );

      const threadScroll = screen.getByTestId('chat-thread-scroll');
      const composerDock = screen.getByTestId('chat-composer-dock');

      let scrollHeight = 1200;
      let clientHeight = 400;
      let scrollTop = 800;

      Object.defineProperty(threadScroll, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight,
      });
      Object.defineProperty(threadScroll, 'clientHeight', {
        configurable: true,
        get: () => clientHeight,
      });
      Object.defineProperty(threadScroll, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = Number(value);
        },
      });

      composerDock.getBoundingClientRect = () => ({
        width: 320,
        height: 168,
        top: 0,
        left: 0,
        right: 320,
        bottom: 168,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      clientHeight = 332;

      await act(async () => {
        resizeObserverCallback?.();
      });

      expect(scrollTop).toBe(scrollHeight - clientHeight);
    } finally {
      global.ResizeObserver = originalResizeObserver;
    }
  });

  it('compensates reaction height from the reacted message upward without moving lower messages', () => {
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    const messageHeights = new Map([
      ['msg-reaction-resize', 72],
      ['msg-after-reaction', 64],
    ]);
    Element.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
      const messageId = this.getAttribute?.('data-message-id');
      if (messageId && messageHeights.has(messageId)) {
        const height = messageHeights.get(messageId);
        return {
          width: 320,
          height,
          top: 0,
          left: 0,
          right: 320,
          bottom: height,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      }
      return originalGetBoundingClientRect.call(this);
    };

    const threadScrollRef = React.createRef();
    const threadContentRef = React.createRef();
    const baseMessages = [
      {
        id: 'msg-reaction-resize',
        conversation_id: 'conv-1',
        kind: 'text',
        body: 'Reacted message',
        created_at: '2026-03-21T10:02:00Z',
        is_own: false,
        sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
      },
      {
        id: 'msg-after-reaction',
        conversation_id: 'conv-1',
        kind: 'text',
        body: 'Lower message must stay anchored',
        created_at: '2026-03-21T10:03:00Z',
        is_own: true,
        sender: { id: 1, username: 'me', full_name: 'Me' },
      },
    ];

    try {
      const { rerender } = renderWithTheme(
        <ChatThread
          {...buildThreadProps({
            messages: baseMessages,
            threadScrollRef,
            threadContentRef,
          })}
        />,
      );

      const threadScroll = screen.getByTestId('chat-thread-scroll');
      let scrollHeight = 1200;
      let clientHeight = 400;
      let scrollTop = 800;

      Object.defineProperty(threadScroll, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight,
      });
      Object.defineProperty(threadScroll, 'clientHeight', {
        configurable: true,
        get: () => clientHeight,
      });
      Object.defineProperty(threadScroll, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = Number(value);
        },
      });

      fireEvent.scroll(threadScroll, { target: { scrollTop: 800 } });
      messageHeights.set('msg-reaction-resize', 96);
      scrollHeight = 1224;

      rerender(
        <ThemeProvider theme={theme}>
          <ChatThread
            {...buildThreadProps({
              messages: [
                {
                  ...baseMessages[0],
                  reactions: [{ emoji: '🔥', count: 1, user_ids: ['1'] }],
                },
                baseMessages[1],
              ],
              threadScrollRef,
              threadContentRef,
            })}
          />
        </ThemeProvider>,
      );

      expect(scrollTop).toBe(824);

      messageHeights.set('msg-reaction-resize', 72);
      scrollHeight = 1200;
      scrollTop = 800;

      rerender(
        <ThemeProvider theme={theme}>
          <ChatThread
            {...buildThreadProps({
              messages: baseMessages,
              threadScrollRef,
              threadContentRef,
            })}
          />
        </ThemeProvider>,
      );

      expect(scrollTop).toBe(800);
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it('shows the AI run status banner for queued and failed AI conversations', () => {
    const { rerender } = renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          activeConversation: {
            id: 'conv-ai',
            title: 'Corp Assistant',
            kind: 'ai',
            unread_count: 0,
          },
          activeConversationId: 'conv-ai',
          aiStatus: {
            conversation_id: 'conv-ai',
            status: 'queued',
            bot_title: 'Corp Assistant',
          },
        })}
      />,
    );

    expect(screen.getByText(/Corp Assistant/i)).toBeInTheDocument();
    expect(screen.getByText(/поставлен в очередь/i)).toBeInTheDocument();

    rerender(
      <ThemeProvider theme={theme}>
        <ChatThread
          {...buildThreadProps({
            activeConversation: {
              id: 'conv-ai',
              title: 'Corp Assistant',
              kind: 'ai',
              unread_count: 0,
            },
            activeConversationId: 'conv-ai',
            aiStatus: {
              conversation_id: 'conv-ai',
              status: 'failed',
              bot_title: 'Corp Assistant',
              error_text: 'OpenRouter unavailable',
            },
          })}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText(/OpenRouter unavailable/i)).toBeInTheDocument();
  });

  it('renders a mobile composer textarea with iOS-safe font size and voice action when empty', () => {
    renderWithTheme(<ChatThread {...buildThreadProps()} />);

    const composer = screen.getByTestId('chat-composer-textarea');
    const capsule = screen.getByTestId('chat-composer-capsule');
    expect(composer).toHaveStyle({
      fontSize: '16px',
      maxHeight: '120px',
      overflowY: 'auto',
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
    });
    expect(screen.getByTestId('chat-composer-dock')).toHaveStyle({ position: 'relative' });
    expect(within(capsule).getByTestId('chat-composer-emoji-button')).toBeInTheDocument();
    expect(within(capsule).getByTestId('chat-composer-menu-button')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-composer-send-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-composer-voice-button')).toBeEnabled();
  });

  it('renders the voice recording waveform, timer, cancel action, and send action', () => {
    const onCancelVoiceRecording = vi.fn();
    const onStopVoiceRecording = vi.fn();

    renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          voiceRecording: true,
          voiceRecordingDuration: 7,
          voiceRecordingLevelRef: { current: 0 },
          onCancelVoiceRecording,
          onStopVoiceRecording,
        })}
      />,
    );

    const activity = screen.getByTestId('chat-voice-recording-activity');
    expect(activity).toHaveAttribute('data-voice-active', 'false');
    expect(screen.getByTestId('chat-voice-recording-waveform')).toBeInTheDocument();
    expect(screen.getAllByTestId('chat-voice-recording-bar')).toHaveLength(18);
    expect(screen.getByText('0:07')).toBeInTheDocument();
    expect(screen.getByTestId('chat-composer-cancel-voice-button')).toBeEnabled();
    expect(screen.getByTestId('chat-composer-send-button')).toBeEnabled();

    fireEvent.click(screen.getByTestId('chat-composer-cancel-voice-button'));
    fireEvent.click(screen.getByTestId('chat-composer-send-button'));
    expect(onCancelVoiceRecording).toHaveBeenCalledTimes(1);
    expect(onStopVoiceRecording).toHaveBeenCalledTimes(1);
  });

  it('marks the voice recording waveform as active when the mic level is high', () => {
    renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          voiceRecording: true,
          voiceRecordingDuration: 12,
          voiceRecordingLevelRef: { current: 0.8 },
        })}
      />,
    );

    const activity = screen.getByTestId('chat-voice-recording-activity');
    expect(activity).toHaveAttribute('data-voice-active', 'true');
    expect(screen.getByText('0:12')).toBeInTheDocument();
    const firstBarHeight = Number.parseFloat(screen.getAllByTestId('chat-voice-recording-bar')[0].style.height);
    expect(firstBarHeight).toBeGreaterThan(6);
  });

  it('keeps bottom scroll padding above an overlaid mobile keyboard', () => {
    expect(getChatThreadBottomPadding({
      compactMobile: true,
      keyboardInset: 0,
      composerHeight: 112,
    })).toBe(8);

    expect(getChatThreadBottomPadding({
      compactMobile: true,
      keyboardInset: 280,
      composerHeight: 168,
    })).toBe(318);

    expect(getChatThreadBottomPadding({
      compactMobile: false,
      keyboardInset: 280,
      composerHeight: 112,
    })).toBe(18);
  });
});
