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
    expect(screen.getByTestId('mail-row-read-action-msg-1')).toBeVisible();
    expect(screen.getByText('Boss Name')).toBeTruthy();
    expect(screen.getByLabelText('Прочитано')).toBeTruthy();
    fireEvent.mouseEnter(desktopRow);

    const dragHandle = screen.getByTestId('mail-row-drag-handle-msg-1');
    expect(dragHandle).toHaveAttribute('aria-label', 'Перетащить в папку');
    const dragStartEvent = new Event('dragstart', { bubbles: true });
    dragStartEvent.dataTransfer = {
      effectAllowed: '',
      setData: vi.fn(),
    };
    fireEvent(dragHandle, dragStartEvent);
    expect(desktopProps.onStartDragItems).toHaveBeenCalledWith(['msg-1'], expect.objectContaining({ id: 'msg-1' }));

    fireEvent.click(screen.getByTestId('mail-row-more-action-msg-1'));
    expect(screen.getByText('В архив')).toBeVisible();
  });
});
