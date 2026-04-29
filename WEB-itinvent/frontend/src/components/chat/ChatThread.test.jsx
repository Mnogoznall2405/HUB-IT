import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import ChatThread, {
  ChatBubble,
  getChatKeyboardBottomSpacer,
  getComposerMentionTrigger,
  isMobileMessageLongPress,
  shouldSuppressNativeMessageGesture,
  shouldCancelLongPressMove,
} from './ChatThread';

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

  it('does not rescan date markers on every sticky-date scroll frame', async () => {
    renderWithTheme(
      <ChatThread
        {...buildThreadProps({
          messages: [
            {
              id: 'msg-date-1',
              conversation_id: 'conv-1',
              kind: 'text',
              body: 'Morning',
              created_at: '2026-03-21T10:00:00Z',
              is_own: false,
              sender: { id: 2, username: 'assignee', full_name: 'Task Assignee' },
            },
            {
              id: 'msg-date-2',
              conversation_id: 'conv-1',
              kind: 'text',
              body: 'Later',
              created_at: '2026-03-21T10:01:00Z',
              is_own: true,
              sender: { id: 1, username: 'author', full_name: 'Task Author' },
            },
          ],
        })}
      />,
    );

    const threadScroll = screen.getByTestId('chat-thread-scroll');
    const originalQuerySelectorAll = threadScroll.querySelectorAll.bind(threadScroll);
    const querySelectorAll = vi.fn(originalQuerySelectorAll);
    threadScroll.querySelectorAll = querySelectorAll;

    await act(async () => {
      fireEvent.scroll(threadScroll, { target: { scrollTop: 80 } });
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(querySelectorAll).not.toHaveBeenCalled();
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

  it('renders Telegram-like message selection controls and actions', () => {
    const onToggleMessageSelection = vi.fn();
    const onClearMessageSelection = vi.fn();
    const onCopySelectedMessages = vi.fn();
    const onReplySelectedMessage = vi.fn();
    const onForwardSelectedMessages = vi.fn();

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
          onToggleMessageSelection,
          onClearMessageSelection,
          onCopySelectedMessages,
          onReplySelectedMessage,
          onForwardSelectedMessages,
        })}
      />,
    );

    expect(screen.getByTestId('chat-selection-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('chat-selection-action-dock')).toBeInTheDocument();
    expect(screen.getByTestId('chat-selection-count-badge')).toHaveTextContent('1');
    expect(screen.getByTestId('chat-selection-reply-action')).toHaveTextContent('Ответить');
    expect(screen.getByTestId('chat-selection-forward-action')).toHaveTextContent('Переслать');
    expect(screen.queryByTestId('chat-selection-count-label')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-selection-delete-action')).not.toBeInTheDocument();
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

  it('uses smaller selection circles on phone and desktop layouts', () => {
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
      width: '28px',
      height: '28px',
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

  it('renders a mobile composer textarea with iOS-safe font size and disabled send button when empty', () => {
    renderWithTheme(<ChatThread {...buildThreadProps()} />);

    const composer = screen.getByTestId('chat-composer-textarea');
    const capsule = screen.getByTestId('chat-composer-capsule');
    expect(composer).toHaveStyle({ fontSize: '16px', overflowY: 'auto' });
    expect(within(capsule).getByTestId('chat-composer-emoji-button')).toBeInTheDocument();
    expect(within(capsule).getByTestId('chat-composer-menu-button')).toBeInTheDocument();
    expect(screen.getByTestId('chat-composer-send-button')).toBeDisabled();
  });
});
