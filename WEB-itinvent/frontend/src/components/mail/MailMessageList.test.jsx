import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({
      children,
      onDragEnd,
      dragElastic,
      dragMomentum,
      whileTap,
      transition,
      drag,
      dragConstraints,
      dragDirectionLock,
      onDragStart,
      onDrag,
      animate,
      ...props
    }, ref) => (
      <div
        ref={ref}
        {...props}
        onDragStart={(event) => onDragStart?.(event, event.detail || { offset: { x: 0, y: 0 } })}
        onDrag={(event) => onDrag?.(event, event.detail || { offset: { x: 0, y: 0 } })}
        onDragEnd={(event) => onDragEnd?.(event, event.detail || { offset: { x: 0, y: 0 } })}
      >
        {children}
      </div>
    )),
  },
}));

import MailMessageList from './MailMessageList';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

function buildProps(overrides = {}) {
  return {
    listSx: {},
    folder: 'inbox',
    viewMode: 'messages',
    listData: {
      items: [
        {
          id: 'msg-1',
          sender: 'boss@example.com',
          sender_email: 'boss@example.com',
          sender_display: 'Boss Name',
          subject: 'Quarterly report',
          body_preview: 'Preview text',
          received_at: '2026-04-08T10:00:00Z',
          is_read: false,
          has_attachments: false,
          attachments_count: 0,
        },
      ],
      has_more: false,
    },
    loading: false,
    loadingMore: false,
    selectedItems: [],
    selectedId: '',
    onSelectId: vi.fn(),
    onToggleSelectedListItem: vi.fn(),
    onStartDragItems: vi.fn(),
    formatTime: () => '10:00',
    getAvatarColor: () => '#1976d2',
    getInitials: () => 'BO',
    hasActiveFilters: false,
    onClearListFilters: vi.fn(),
    noResultsHint: 'Нет писем',
    onLoadMoreMessages: vi.fn(),
    messageListRef: { current: null },
    loadMoreSentinelRef: { current: null },
    isMobile: true,
    density: 'comfortable',
    showPreviewSnippets: true,
    onSwipeRead: vi.fn(),
    onSwipeDelete: vi.fn(),
    onRestoreMessage: vi.fn(),
    onArchiveMessage: vi.fn(),
    onMoveMessage: vi.fn(),
    onOpenHeaders: vi.fn(),
    onDownloadSource: vi.fn(),
    onPrintMessage: vi.fn(),
    moveTargets: [],
    onPullToRefresh: vi.fn(),
    ...overrides,
  };
}

describe('MailMessageList', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses a neutral active-row tone and keeps bulk selection softer than the opened message', () => {
    const props = buildProps({
      isMobile: false,
      selectedId: 'msg-1',
      selectedItems: ['msg-2'],
      listData: {
        items: [
          {
            id: 'msg-1',
            sender: 'boss@example.com',
            sender_email: 'boss@example.com',
            sender_display: 'Boss Name',
            subject: 'Quarterly report',
            body_preview: 'Preview text',
            received_at: '2026-04-08T10:00:00Z',
            is_read: false,
            has_attachments: false,
            attachments_count: 0,
          },
          {
            id: 'msg-2',
            sender: 'team@example.com',
            sender_email: 'team@example.com',
            sender_display: 'Team Name',
            subject: 'Second item',
            body_preview: 'Another preview',
            received_at: '2026-04-08T09:00:00Z',
            is_read: true,
            has_attachments: false,
            attachments_count: 0,
          },
        ],
        has_more: false,
      },
    });

    renderWithTheme(<MailMessageList {...props} />);

    const selectedRow = screen.getByTestId('mail-row-msg-1');
    const bulkRow = screen.getByTestId('mail-row-msg-2');
    const selectedStyles = window.getComputedStyle(selectedRow);
    const bulkStyles = window.getComputedStyle(bulkRow);

    expect(selectedStyles.borderLeftColor).not.toBe('transparent');
    expect(bulkStyles.borderLeftColor).not.toBe('transparent');
    expect(selectedStyles.backgroundColor).not.toBe(bulkStyles.backgroundColor);
    expect(screen.getByTestId('mail-row-selected-check-msg-2')).toBeTruthy();
  });

  it('keeps mobile long-press selection and selected checkmark even when row swipes are disabled', () => {
    vi.useFakeTimers();
    const props = buildProps({
      onSwipeRead: undefined,
      onSwipeDelete: undefined,
      selectedItems: ['msg-1'],
    });

    renderWithTheme(<MailMessageList {...props} />);

    expect(screen.getByTestId('mail-row-selected-check-msg-1')).toBeTruthy();
    expect(screen.queryByText('Выбрано')).toBeNull();

    const rowBody = screen.getByTestId('mail-row-msg-1');
    fireEvent.pointerDown(rowBody.parentElement, { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(430);
    });

    expect(props.onToggleSelectedListItem).toHaveBeenCalledWith('msg-1');
  });

  it('shows recipient line instead of sender in drafts folder', () => {
    const props = buildProps({
      folder: 'drafts',
      listData: {
        items: [
          {
            id: 'msg-1',
            sender: 'sender@example.com',
            sender_email: 'sender@example.com',
            sender_display: 'Sender Name',
            to_people: [{ display: 'Recipient Name', email: 'recipient@example.com' }],
            recipients: ['recipient@example.com'],
            subject: 'Draft subject',
            body_preview: 'Draft preview',
            received_at: '2026-04-08T10:00:00Z',
            is_read: false,
            has_attachments: false,
            attachments_count: 0,
          },
        ],
        has_more: false,
      },
      isMobile: false,
    });

    renderWithTheme(<MailMessageList {...props} />);

    expect(screen.getByText('Recipient Name')).toBeTruthy();
    expect(screen.queryByText('Sender Name')).toBeNull();
  });

  it('shows recipient instead of the current user in the sent folder', () => {
    const props = buildProps({
      folder: 'sent',
      listData: {
        items: [
          {
            id: 'msg-1',
            sender: 'me@example.com',
            sender_email: 'me@example.com',
            sender_display: 'Current User',
            to_people: [
              { display: 'Иванов Сергей', email: 'ivanov@example.com' },
              { display: 'Петрова Анна', email: 'petrova@example.com' },
            ],
            subject: 'Sent subject',
            body_preview: 'Sent preview',
            received_at: '2026-04-08T10:00:00Z',
            is_read: true,
            has_attachments: false,
            attachments_count: 0,
          },
        ],
        has_more: false,
      },
      isMobile: false,
      mailboxEmails: ['me@example.com'],
    });

    renderWithTheme(<MailMessageList {...props} />);

    expect(screen.getByText('Иванов Сергей +1')).toBeTruthy();
    expect(screen.queryByText('Current User')).toBeNull();
  });

  it('shows a placeholder in drafts without a recipient', () => {
    const props = buildProps({
      folder: 'drafts',
      listData: {
        items: [
          {
            id: 'msg-1',
            sender_display: 'Current User',
            sender_email: 'me@example.com',
            to_people: [],
            subject: 'Empty draft',
            body_preview: 'Draft preview',
            received_at: '2026-04-08T10:00:00Z',
            is_read: true,
            has_attachments: false,
            attachments_count: 0,
          },
        ],
        has_more: false,
      },
      isMobile: false,
    });

    renderWithTheme(<MailMessageList {...props} />);

    expect(screen.getByText('Без получателя')).toBeTruthy();
  });

  it('prefixes search results with direction', () => {
    const props = buildProps({
      folder: 'inbox',
      isSearch: true,
      mailboxEmails: ['me@example.com'],
      listData: {
        items: [
          {
            id: 'msg-1',
            sender_display: 'Иванов Сергей',
            sender_email: 'ivanov@example.com',
            to_people: [{ display: 'Current User', email: 'me@example.com' }],
            subject: 'Found',
            body_preview: 'Preview',
            received_at: '2026-04-08T10:00:00Z',
            is_read: true,
          },
        ],
        has_more: false,
      },
      isMobile: false,
    });

    renderWithTheme(<MailMessageList {...props} />);
    expect(screen.getByText('От: Иванов Сергей')).toBeTruthy();
  });

  it('keeps row text stable while hover actions appear', () => {
    const props = buildProps({
      isMobile: false,
      listData: {
        items: [
          {
            id: 'msg-att',
            sender: 'boss@example.com',
            sender_email: 'boss@example.com',
            sender_display: 'Boss Name',
            subject: 'Files attached',
            body_preview: 'Preview text',
            received_at: '2026-04-08T10:00:00Z',
            is_read: false,
            has_attachments: true,
            attachments_count: 4,
          },
        ],
        has_more: false,
      },
    });

    renderWithTheme(<MailMessageList {...props} />);

    const row = screen.getByTestId('mail-row-shell-msg-att');
    const before = row.getBoundingClientRect().width;
    expect(screen.getByLabelText('Вложений: 4')).toBeTruthy();
    expect(screen.getByTestId('mail-row-read-action-msg-att')).not.toBeVisible();
    fireEvent.mouseEnter(row);
    expect(screen.getByTestId('mail-row-read-action-msg-att')).toBeVisible();
    expect(row.getBoundingClientRect().width).toBe(before);
    expect(screen.getByText('Files attached')).toBeTruthy();
  });

  it('renders month headings for the full list after another page is appended', () => {
    const props = buildProps({
      listData: {
        items: [
          {
            id: 'may',
            sender_display: 'May Sender',
            subject: 'May message',
            received_at: '2026-05-12T10:00:00Z',
            is_read: true,
          },
          {
            id: 'april',
            sender_display: 'April Sender',
            subject: 'April message',
            received_at: '2026-04-30T10:00:00Z',
            is_read: true,
          },
        ],
        has_more: true,
      },
    });

    renderWithTheme(<MailMessageList {...props} />);

    expect(screen.getByText('Май 2026')).toBeVisible();
    expect(screen.getByText('Апрель 2026')).toBeVisible();
  });

  it('keeps swipe labels hidden at rest, reveals parked actions and commits full swipe on mobile', () => {
    vi.useFakeTimers();
    const props = buildProps();
    renderWithTheme(<MailMessageList {...props} />);

    expect(screen.getByText('Прочитано')).not.toBeVisible();
    expect(screen.getByText('Удалить')).not.toBeVisible();

    const swipeRow = screen.getByTestId('mail-row-motion-msg-1');

    const revealEvent = new Event('dragend', { bubbles: true });
    revealEvent.detail = { offset: { x: 72, y: 4 } };
    fireEvent(swipeRow, revealEvent);
    expect(screen.getByText('Прочитано')).toBeVisible();
    expect(props.onSwipeRead).not.toHaveBeenCalled();

    const commitEvent = new Event('dragend', { bubbles: true });
    commitEvent.detail = { offset: { x: 150, y: 0 } };
    fireEvent(swipeRow, commitEvent);
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(props.onSwipeRead).toHaveBeenCalledTimes(1);
  });

  it('prevents trash full-left auto delete, supports desktop hover rail, drag handle, and guarded pull-to-refresh', () => {
    vi.useFakeTimers();

    const mobileProps = buildProps({ folder: 'trash' });
    const { container, rerender } = renderWithTheme(<MailMessageList {...mobileProps} />);

    const mobileSwipeRow = screen.getByTestId('mail-row-motion-msg-1');
    const trashDeleteEvent = new Event('dragend', { bubbles: true });
    trashDeleteEvent.detail = { offset: { x: -160, y: 0 } };
    fireEvent(mobileSwipeRow, trashDeleteEvent);
    expect(mobileProps.onSwipeDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Навсегда')).toBeVisible();

    const rowBody = screen.getByTestId('mail-row-msg-1');
    fireEvent.pointerDown(rowBody.parentElement, { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(430);
    });
    expect(mobileProps.onToggleSelectedListItem).toHaveBeenCalledWith('msg-1');

    const scrollRoot = container.querySelector('.mail-scroll-hidden');
    scrollRoot.scrollTop = 0;
    fireEvent.touchStart(scrollRoot, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(scrollRoot, { touches: [{ clientY: 180 }] });
    fireEvent.touchEnd(scrollRoot);
    expect(mobileProps.onPullToRefresh).not.toHaveBeenCalled();

    const freshMobileProps = buildProps({ folder: 'trash' });
    rerender(
      <ThemeProvider theme={createTheme()}>
        <MailMessageList key="fresh-mobile" {...freshMobileProps} />
      </ThemeProvider>,
    );

    const freshScrollRoot = container.querySelector('.mail-scroll-hidden');
    freshScrollRoot.scrollTop = 0;
    fireEvent.touchStart(freshScrollRoot, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(freshScrollRoot, { touches: [{ clientY: 180 }] });
    fireEvent.touchEnd(freshScrollRoot);
    expect(freshMobileProps.onPullToRefresh).toHaveBeenCalledTimes(1);

    const desktopProps = buildProps({ isMobile: false });
    rerender(
      <ThemeProvider theme={createTheme()}>
        <MailMessageList {...desktopProps} />
      </ThemeProvider>,
    );

    const desktopRow = screen.getByTestId('mail-row-shell-msg-1');
    expect(screen.getByTestId('mail-row-read-action-msg-1')).not.toBeVisible();
    expect(screen.getByTestId('mail-row-drag-handle-msg-1')).not.toBeVisible();
    expect(screen.getByText('Boss Name')).toBeTruthy();
    expect(screen.getByLabelText('Прочитано')).toBeTruthy();
    fireEvent.mouseEnter(desktopRow);
    expect(screen.getByTestId('mail-row-read-action-msg-1')).toBeVisible();
    expect(screen.getByTestId('mail-row-drag-handle-msg-1')).toBeVisible();
    expect(screen.getByTestId('mail-row-time-msg-1')).toBeVisible();
    expect(screen.getByTestId('mail-row-drag-gutter-msg-1').contains(screen.getByTestId('mail-row-drag-handle-msg-1'))).toBe(true);

    const dragHandle = screen.getByTestId('mail-row-drag-handle-msg-1');
    expect(dragHandle).toHaveAttribute('aria-label', 'Перетащить в папку');
    const dragStartEvent = new Event('dragstart', { bubbles: true });
    dragStartEvent.dataTransfer = {
      effectAllowed: '',
      setData: vi.fn(),
    };
    fireEvent(desktopRow, dragStartEvent);
    expect(desktopProps.onStartDragItems).toHaveBeenCalledWith(['msg-1'], expect.objectContaining({ id: 'msg-1' }));

    fireEvent.click(screen.getByTestId('mail-row-more-action-msg-1'));
    expect(screen.getByText('В архив')).toBeVisible();
  });

  it('lists folder names in the row overflow instead of repeating move labels', () => {
    const props = buildProps({
      isMobile: false,
      moveTargets: [
        { value: 'junk', label: 'Нежелательные' },
        { value: 'sent', label: 'Отправленные' },
        { value: 'rss', label: 'RSS-каналы' },
      ],
    });
    renderWithTheme(<MailMessageList {...props} />);

    fireEvent.mouseEnter(screen.getByTestId('mail-row-shell-msg-1'));
    fireEvent.click(screen.getByTestId('mail-row-more-action-msg-1'));
    expect(screen.getByTestId('mail-move-to-heading')).toHaveTextContent('Переместить в');
    expect(screen.getByTestId('mail-move-to-option-sent')).toHaveTextContent('Отправленные');
    expect(screen.queryByText('Переместить в Отправленные')).toBeNull();
    expect(screen.queryByTestId('mail-move-to-option-rss')).toBeNull();

    fireEvent.click(screen.getByTestId('mail-move-to-option-sent'));

    expect(props.onMoveMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-1' }), 'sent');
  });

  it('makes unread messages visually stronger than read ones', () => {
    const props = buildProps({
      isMobile: false,
      listData: {
        items: [
          {
            id: 'unread-1',
            sender_display: 'Unread Sender',
            subject: 'Unread subject',
            body_preview: 'Unread preview',
            received_at: '2026-04-08T10:00:00Z',
            is_read: false,
          },
          {
            id: 'read-1',
            sender_display: 'Read Sender',
            subject: 'Read subject',
            body_preview: 'Read preview',
            received_at: '2026-04-08T09:00:00Z',
            is_read: true,
          },
        ],
        has_more: false,
      },
    });

    renderWithTheme(<MailMessageList {...props} />);

    const unreadRow = screen.getByTestId('mail-row-unread-1');
    const readRow = screen.getByTestId('mail-row-read-1');
    expect(unreadRow).toHaveAttribute('data-mail-unread', 'true');
    expect(readRow).toHaveAttribute('data-mail-unread', 'false');
    expect(screen.getByTestId('mail-row-unread-dot-unread-1')).toBeTruthy();
    expect(screen.queryByTestId('mail-row-unread-dot-read-1')).toBeNull();

    const unreadStyles = window.getComputedStyle(unreadRow);
    const readStyles = window.getComputedStyle(readRow);
    expect(unreadStyles.borderLeftColor).not.toBe('transparent');
    expect(unreadStyles.backgroundColor).not.toBe(readStyles.backgroundColor);

    expect(window.getComputedStyle(screen.getByText('Unread Sender')).fontWeight)
      .toBe('800');
    expect(window.getComputedStyle(screen.getByText('Read Sender')).fontWeight)
      .toBe('500');
    expect(window.getComputedStyle(screen.getByText('Unread subject')).fontWeight)
      .toBe('700');
    expect(window.getComputedStyle(screen.getByText('Read subject')).fontWeight)
      .toBe('500');
  });

  it('shows an unread count badge on conversation rows with several unread messages', () => {
    const props = buildProps({
      viewMode: 'conversations',
      isMobile: false,
      listData: {
        items: [
          {
            id: 'conv-1',
            conversation_id: 'conv-1',
            participants: ['Unread Sender'],
            participant_people: [{ display: 'Unread Sender', email: 'unread@example.com' }],
            subject: 'Thread subject',
            preview: 'Latest preview',
            last_received_at: '2026-04-08T10:00:00Z',
            unread_count: 4,
            messages_count: 9,
          },
        ],
        has_more: false,
      },
    });

    renderWithTheme(<MailMessageList {...props} />);

    expect(screen.getByTestId('mail-row-conv-1')).toHaveAttribute('data-mail-unread', 'true');
    expect(screen.getByTestId('mail-row-unread-dot-conv-1')).toHaveTextContent('4');
  });
});
